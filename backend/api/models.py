"""
PetroERP data model (single Django app: `api`).

Conventions
-----------
* Every transaction belongs to a legal entity (`company`) and carries a unique,
  per-entity `reference` generated from NumberSequence.
* Workflow documents set STATUS_MANAGED = True: their `status` is changed only
  by services (never by a plain PUT/PATCH) and they can only be edited in DRAFT.
* Posted journals, journal lines, stock movements, shipment status history and
  audit logs are IMMUTABLE (guards below). Corrections = reversing entries.
* Money = 18,2 | litres = 18,3 | price per litre = 18,6 | FX rates = 18,8.
"""
import hashlib
import json
from decimal import ROUND_HALF_UP, Decimal

from django.contrib.auth.models import AbstractUser
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q
from django.utils import timezone

D0 = Decimal('0')


def q2(x): return Decimal(x or 0).quantize(Decimal('0.01'), ROUND_HALF_UP)
def q3(x): return Decimal(x or 0).quantize(Decimal('0.001'), ROUND_HALF_UP)
def q6(x): return Decimal(x or 0).quantize(Decimal('0.000001'), ROUND_HALF_UP)
def q8(x): return Decimal(x or 0).quantize(Decimal('0.00000001'), ROUND_HALF_UP)


# ---------------------------------------------------------------- field helpers
def Money(**kw): kw.setdefault('default', D0); return models.DecimalField(max_digits=18, decimal_places=2, **kw)
def Qty(**kw): kw.setdefault('default', D0); return models.DecimalField(max_digits=18, decimal_places=3, **kw)
def Price(**kw): kw.setdefault('default', D0); return models.DecimalField(max_digits=18, decimal_places=6, **kw)
def Pct(**kw): kw.setdefault('default', D0); return models.DecimalField(max_digits=7, decimal_places=3, **kw)
def Rate(**kw): return models.DecimalField(max_digits=18, decimal_places=8, **kw)
def Char(n=120, **kw): kw.setdefault('blank', True); return models.CharField(max_length=n, **kw)
def Text(**kw): kw.setdefault('blank', True); return models.TextField(**kw)
def Flag(default=True): return models.BooleanField(default=default)
def Date(**kw): return models.DateField(**kw)
def ODate(**kw): kw.update(null=True, blank=True); return models.DateField(**kw)
def OTime(**kw): kw.update(null=True, blank=True); return models.DateTimeField(**kw)


def FK(to, **kw):
    kw.setdefault('on_delete', models.PROTECT)
    kw.setdefault('related_name', '+')
    return models.ForeignKey(to, **kw)


def OFK(to, **kw):
    kw.update(null=True, blank=True)
    return FK(to, **kw)


def Choice(values, default=None, n=30, **kw):
    vals = values.split()
    return models.CharField(max_length=n, choices=[(v, v.replace('_', ' ').title()) for v in vals],
                            default=default or vals[0], **kw)


class ImmutableQuerySet(models.QuerySet):
    def update(self, **kw): raise ValidationError('Records are immutable; use a reversing entry.')
    def delete(self): raise ValidationError('Records are immutable and cannot be deleted.')
    def unsafe_update(self, **kw): return super().update(**kw)


# ---------------------------------------------------------------- abstract bases
class Stamped(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey('User', null=True, blank=True, editable=False,
                                   on_delete=models.SET_NULL, related_name='+')
    LABELS = ('reference', 'name', 'code', 'registration_number', 'full_name', 'title')

    class Meta:
        abstract = True

    def __str__(self):
        for a in self.LABELS:
            v = getattr(self, a, None)
            if v:
                return str(v)
        return f'{self.__class__.__name__} #{self.pk}'


class Coded(Stamped):
    """Master record owned by a legal entity with an auto code (e.g. SUP-00001)."""
    company = FK('Company')
    code = Char(40)
    CODE_TYPE = 'GEN'

    class Meta:
        abstract = True
        constraints = [models.UniqueConstraint(fields=['company', 'code'], name='%(class)s_code_uniq')]

    def save(self, *a, **kw):
        if not self.code:
            from . import services
            self.code = services.next_reference(self.company, self.CODE_TYPE, short=True)
        super().save(*a, **kw)


class Doc(Stamped):
    """Transaction header: legal entity + unique reference (+ status in subclasses)."""
    company = FK('Company')
    reference = Char(40, db_index=True)
    STATUS_MANAGED = True
    DOC_TYPE = 'DOC'

    class Meta:
        abstract = True
        constraints = [models.UniqueConstraint(fields=['company', 'reference'], condition=~Q(reference=''),
                                               name='%(class)s_ref_uniq')]

    def save(self, *a, **kw):
        if not self.reference:
            from . import services
            self.reference = services.next_reference(self.company, self.DOC_TYPE)
        super().save(*a, **kw)


class FXDoc(Doc):
    """Retains original currency, rate, rate date and rate source (Module 18)."""
    currency = OFK('Currency')
    exchange_rate = Rate(null=True, blank=True)
    rate_date = ODate()
    rate_source = Char(60)
    FX_DATE = 'created_at'

    class Meta(Doc.Meta):
        abstract = True

    def save(self, *a, **kw):
        from . import services
        services.fill_fx(self)
        super().save(*a, **kw)

    def functional(self, amount):
        return q2(Decimal(amount) * (self.exchange_rate or 1))


class TotalsMixin(models.Model):
    subtotal = Money()
    tax_total = Money()
    total = Money()

    class Meta:
        abstract = True

    def recalc(self):
        lines = list(self.lines.all())
        self.subtotal = sum((l.line_total for l in lines), D0)
        self.tax_total = sum((l.tax_amount for l in lines), D0)
        self.total = self.subtotal + self.tax_total
        models.Model.save(self, update_fields=['subtotal', 'tax_total', 'total'])

    @property
    def outstanding(self):
        return self.total - getattr(self, 'amount_paid', D0) - getattr(self, 'amount_credited', D0)


class Line(models.Model):
    product = FK('Product')
    quantity = Qty()
    unit_price = Price()
    tax_code = Char(20)
    tax_rate = Pct()
    tax_amount = Money(editable=False)
    line_total = Money(editable=False)

    class Meta:
        abstract = True

    def save(self, *a, **kw):
        self.line_total = q2(self.quantity * self.unit_price)
        self.tax_amount = q2(self.line_total * self.tax_rate / 100)
        super().save(*a, **kw)


# ================================================================ CONTROL
class Permission(models.Model):
    code = models.CharField(max_length=60, unique=True)
    description = Char(200)

    def __str__(self): return self.code


class Role(models.Model):
    code = models.CharField(max_length=40, unique=True)
    name = models.CharField(max_length=80)
    permissions = models.ManyToManyField(Permission, blank=True, related_name='roles')

    def __str__(self): return self.name


class User(AbstractUser):
    role = OFK('Role')
    companies = models.ManyToManyField('Company', blank=True, related_name='users')
    phone = Char(30)
    mfa_secret = Char(64, editable=False)

    @property
    def is_group_admin(self):
        return self.is_superuser or (self.role_id is not None and self.role.code == 'GROUP_ADMIN')

    def allowed_company_ids(self):
        if self.is_group_admin:
            return list(Company.objects.values_list('id', flat=True))
        return list(self.companies.values_list('id', flat=True))

    def perm_codes(self):
        if not hasattr(self, '_perm_cache'):
            self._perm_cache = set(self.role.permissions.values_list('code', flat=True)) if self.role_id else set()
        return self._perm_cache

    def has_perm_code(self, code):
        return self.is_group_admin or code in self.perm_codes()


class Currency(models.Model):
    code = models.CharField(max_length=3, primary_key=True)
    name = models.CharField(max_length=60)
    symbol = Char(6)
    decimal_places = models.PositiveSmallIntegerField(default=2)
    is_active = Flag()

    def __str__(self): return self.code


class Company(Stamped):
    code = models.CharField(max_length=10, unique=True)
    name = models.CharField(max_length=200)
    country = Choice('KE CD', n=2)
    functional_currency = FK('Currency')
    tax_pin = Char(40)
    registration_number = Char(60)
    address = Text()
    phone = Char(40)
    email = models.EmailField(blank=True)
    inventory_valuation = Choice('WAVG FIFO')
    min_margin_pct = Pct()                                   # minimum approved selling margin
    match_tolerance_pct = Pct(default=Decimal('1'))          # three-way match tolerance
    delivery_loss_tolerance_pct = Pct()                      # 0 => every delivery shortage needs approval
    is_active = Flag()


class ExchangeRate(Stamped):
    from_currency = FK('Currency')
    to_currency = FK('Currency')
    rate = Rate()
    rate_date = Date()
    source = Char(60, default='MANUAL')

    class Meta:
        constraints = [models.UniqueConstraint(fields=['from_currency', 'to_currency', 'rate_date', 'source'],
                                               name='fx_unique')]
        indexes = [models.Index(fields=['from_currency', 'to_currency', '-rate_date'])]


class Branch(Coded):
    CODE_TYPE = 'BR'
    name = models.CharField(max_length=120)
    address = Text()
    is_active = Flag()


class Department(Coded):
    CODE_TYPE = 'DEP'
    name = models.CharField(max_length=120)
    branch = OFK('Branch')


class FiscalYear(Stamped):
    company = FK('Company')
    name = models.CharField(max_length=40)
    start_date = Date()
    end_date = Date()
    status = Choice('OPEN CLOSED')

    class Meta:
        constraints = [models.UniqueConstraint(fields=['company', 'name'], name='fy_unique')]


class AccountingPeriod(Stamped):
    company = FK('Company')
    fiscal_year = FK('FiscalYear')
    name = models.CharField(max_length=40)
    start_date = Date()
    end_date = Date()
    status = Choice('OPEN CLOSED')
    closed_by = OFK('User')
    closed_at = OTime()

    class Meta:
        constraints = [models.UniqueConstraint(fields=['company', 'start_date'], name='period_unique')]
        ordering = ['company', 'start_date']


class TaxConfig(Stamped):
    """Effective-dated tax / levy / duty configuration. Never hard-coded in code."""
    company = FK('Company')
    code = models.CharField(max_length=20)
    name = models.CharField(max_length=100)
    tax_type = Choice('VAT EXCISE DUTY LEVY WHT OTHER')
    rate_percent = Pct()
    effective_from = Date()
    effective_to = ODate()
    is_active = Flag()
    verified_by = OFK('User')          # professional verification required before use
    verified_at = OTime()
    notes = Text()


class NumberSequence(models.Model):
    company = FK('Company')
    doc_type = models.CharField(max_length=20)
    prefix = models.CharField(max_length=10)
    padding = models.PositiveSmallIntegerField(default=5)
    next_number = models.PositiveIntegerField(default=1)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['company', 'doc_type'], name='seq_unique')]


class ApprovalPolicy(Stamped):
    company = FK('Company')
    doc_type = models.CharField(max_length=40)          # model class name, e.g. PurchaseOrder
    min_amount = Money()
    approver_role = FK('Role')


class Account(Stamped):
    company = FK('Company')
    code = models.CharField(max_length=20)
    name = models.CharField(max_length=150)
    account_type = Choice('ASSET LIABILITY EQUITY REVENUE EXPENSE')
    subtype = Char(30)          # CASH BANK MPESA AR AP INVENTORY TRANSIT COGS OPEX IC_RECEIVABLE ...
    group_code = Char(40)       # maps entity accounts to the consolidated chart
    parent = OFK('self')
    is_postable = Flag()
    is_intercompany = Flag(False)
    is_active = Flag()

    class Meta:
        constraints = [models.UniqueConstraint(fields=['company', 'code'], name='account_code_uniq')]
        ordering = ['company', 'code']

    def __str__(self): return f'{self.code} {self.name}'


class AccountMapping(Stamped):
    """System account keys (INVENTORY, AP, AR, GRNI ...) -> entity account."""
    company = FK('Company')
    key = models.CharField(max_length=40)
    account = FK('Account')

    class Meta:
        constraints = [models.UniqueConstraint(fields=['company', 'key'], name='acctmap_unique')]


class ApprovalRequest(Stamped):
    company = FK('Company')
    doc_type = models.CharField(max_length=40)
    content_type = FK('contenttypes.ContentType')
    object_id = models.PositiveBigIntegerField()
    target = GenericForeignKey('content_type', 'object_id')
    summary = Char(200)
    amount = Money()
    status = Choice('PENDING APPROVED REJECTED CANCELLED')
    decided_by = OFK('User')
    decided_at = OTime()

    class Meta:
        indexes = [models.Index(fields=['content_type', 'object_id'])]


class ApprovalAction(models.Model):
    request = models.ForeignKey(ApprovalRequest, on_delete=models.CASCADE, related_name='actions')
    actor = FK('User')
    action = Choice('SUBMITTED APPROVED REJECTED')
    comment = Text()
    created_at = models.DateTimeField(auto_now_add=True)


class AuditLogQuerySet(ImmutableQuerySet):
    pass


class AuditLog(models.Model):
    """Append-only, hash-chained (each row hashes the previous row's hash)."""
    user = OFK('User', on_delete=models.SET_NULL)
    company = OFK('Company')
    action = models.CharField(max_length=40)
    model_name = models.CharField(max_length=60, db_index=True)
    object_id = models.CharField(max_length=40, db_index=True)
    object_repr = Char(200)
    changes = models.JSONField(default=dict, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now)
    prev_hash = Char(64)
    hash = Char(64)
    objects = AuditLogQuerySet.as_manager()

    def compute_hash(self):
        payload = json.dumps([self.prev_hash, self.user_id, self.company_id, self.action, self.model_name,
                              self.object_id, self.changes, self.created_at.isoformat()], sort_keys=True, default=str)
        return hashlib.sha256(payload.encode()).hexdigest()

    def save(self, *a, **kw):
        if self.pk:
            raise ValidationError('Audit log entries cannot be modified.')
        last = AuditLog.objects.order_by('-id').first()
        self.prev_hash = last.hash if last else ''
        self.hash = self.compute_hash()
        super().save(*a, **kw)

    def delete(self, *a, **kw): raise ValidationError('Audit log entries cannot be deleted.')


class Notification(models.Model):
    user = FK('User', on_delete=models.CASCADE)
    company = OFK('Company')
    title = models.CharField(max_length=160)
    message = Text()
    level = Choice('INFO WARNING CRITICAL')
    link = Char(200)
    is_read = Flag(False)
    created_at = models.DateTimeField(auto_now_add=True)


class Attachment(Stamped):
    company = OFK('Company')
    content_type = FK('contenttypes.ContentType')
    object_id = models.PositiveBigIntegerField()
    target = GenericForeignKey('content_type', 'object_id')
    file = models.FileField(upload_to='attachments/%Y/%m/')
    description = Char(200)


class Alert(Stamped):
    """AI / rule-based alerts. Alerts inform; they never approve or post anything."""
    company = OFK('Company')
    kind = models.CharField(max_length=40)
    severity = Choice('INFO WARNING CRITICAL')
    message = Text()
    data = models.JSONField(default=dict, blank=True)
    is_resolved = Flag(False)


# ================================================================ SUPPLIERS
class Supplier(Coded):
    CODE_TYPE = 'SUP'
    name = models.CharField(max_length=200)
    country = Char(60, default='Kenya')
    tax_pin = Char(40)
    registration_number = Char(60)
    address = Text()
    contact_person = Char(120)
    phone = Char(40)
    email = models.EmailField(blank=True)
    bank_name = Char(120)
    bank_account = Char(60)
    bank_swift = Char(20)
    payment_terms_days = models.PositiveIntegerField(default=30)
    credit_limit = Money()
    currency = FK('Currency')
    status = Choice('ONBOARDING ACTIVE SUSPENDED INACTIVE', default='ACTIVE')


class SupplierContact(Stamped):
    supplier = FK('Supplier')
    name = models.CharField(max_length=120)
    position = Char(80)
    phone = Char(40)
    email = models.EmailField(blank=True)


class SupplierContract(Doc):
    DOC_TYPE = 'SCT'
    supplier = FK('Supplier')
    product = OFK('Product')
    start_date = Date()
    end_date = ODate()
    price_basis = Char(120)
    max_quantity = Qty()
    terms = Text()
    status = Choice('DRAFT ACTIVE EXPIRED CANCELLED')


class SupplierPrice(Stamped):
    company = FK('Company')
    supplier = FK('Supplier')
    product = FK('Product')
    price = Price()
    currency = FK('Currency')
    effective_date = Date()
    source = Choice('QUOTATION CONTRACT INVOICE MANUAL', default='MANUAL')


class SupplierQuotation(Doc):
    DOC_TYPE = 'SQ'
    supplier = FK('Supplier')
    product = FK('Product')
    quantity = Qty()
    unit_price = Price()
    currency = FK('Currency')
    valid_until = ODate()
    status = Choice('DRAFT RECEIVED ACCEPTED REJECTED EXPIRED')


# ================================================================ PRODUCTS & INVENTORY
class Product(Stamped):
    code = models.CharField(max_length=20, unique=True)
    name = models.CharField(max_length=100)
    category = Choice('DIESEL PETROL KEROSENE JET_FUEL LPG LUBRICANT OTHER')
    unit = Char(10, default='L')
    density_min = models.DecimalField(max_digits=7, decimal_places=4, null=True, blank=True)
    density_max = models.DecimalField(max_digits=7, decimal_places=4, null=True, blank=True)
    specification = Text()
    tax_category = Char(20)
    valuation_method = Choice('DEFAULT FIFO WAVG')
    reference_temp_c = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('15'))
    expansion_coefficient = models.DecimalField(max_digits=9, decimal_places=7, null=True, blank=True)  # configurable
    min_margin_pct = Pct(null=True, blank=True)
    status = Choice('ACTIVE INACTIVE')


class Depot(Coded):
    CODE_TYPE = 'DEP'
    name = models.CharField(max_length=120)
    location = Char(200)
    country = Char(60, default='Kenya')
    is_active = Flag()


class StorageTank(Coded):
    CODE_TYPE = 'TNK'
    depot = FK('Depot')
    product = OFK('Product')
    capacity = Qty()
    min_level = Qty()
    status = Choice('ACTIVE MAINTENANCE INACTIVE')


class TankCalibration(Stamped):
    tank = FK('StorageTank')
    calibration_date = Date()
    certificate_no = Char(60)
    strapping_table = models.JSONField(default=list, blank=True)     # [{"dip_cm": 10, "litres": 1234}]
    next_due = ODate()
    calibrated_by = Char(120)


class StockBalance(models.Model):
    company = FK('Company')
    tank = FK('StorageTank')
    product = FK('Product')
    quantity = Qty()
    value = Money()                   # functional currency
    class Meta:
        constraints = [models.UniqueConstraint(fields=['tank', 'product'], name='balance_unique')]

    @property
    def avg_cost(self): return q6(self.value / self.quantity) if self.quantity else D0


class StockLayer(models.Model):
    """FIFO cost layers (maintained for every receipt; consumed oldest-first)."""
    company = FK('Company')
    tank = FK('StorageTank')
    product = FK('Product')
    received_date = Date()
    remaining_qty = Qty()
    unit_cost = Price()


class StockMovement(models.Model):
    objects = ImmutableQuerySet.as_manager()
    TYPES = 'OPENING RECEIPT TRANSFER_IN RETURN_IN ADJ_IN ISSUE TRANSFER_OUT RETURN_OUT ADJ_OUT'
    company = FK('Company')
    reference = Char(40, db_index=True)
    movement_type = Choice(TYPES)
    movement_date = Date()
    tank = FK('StorageTank')
    product = FK('Product')
    quantity = Qty()                                  # always positive; direction from type
    unit_cost = Price()
    total_cost = Money()
    balance_after = Qty()
    shipment = OFK('Shipment')
    source_type = Char(40)
    source_id = Char(40)
    observed_volume = Qty(null=True, blank=True)
    temperature_c = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    density = models.DecimalField(max_digits=7, decimal_places=4, null=True, blank=True)
    standardized_volume = Qty(null=True, blank=True)
    narration = Char(255)
    created_by = OFK('User', on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=['tank', 'movement_date'])]

    def save(self, *a, **kw):
        if self.pk:
            raise ValidationError('Stock movements are immutable.')
        super().save(*a, **kw)

    def delete(self, *a, **kw): raise ValidationError('Stock movements cannot be deleted.')

    def __str__(self): return self.reference


class StockReservation(Doc):
    DOC_TYPE = 'RSV'
    depot = FK('Depot')
    product = FK('Product')
    quantity = Qty()
    sales_order = OFK('SalesOrder')
    shipment = OFK('Shipment')
    status = Choice('ACTIVE RELEASED CONSUMED')


class TankReading(Stamped):
    company = FK('Company')
    tank = FK('StorageTank')
    reading_date = Date()
    reading_time = models.TimeField(null=True, blank=True)
    reading_type = Choice('CLOSING OPENING ADHOC')
    dip_cm = models.DecimalField(max_digits=9, decimal_places=2, null=True, blank=True)
    observed_volume = Qty()
    temperature_c = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    density = models.DecimalField(max_digits=7, decimal_places=4, null=True, blank=True)
    standardized_volume = Qty(null=True, blank=True)
    notes = Char(255)


class TankReconciliation(Doc):
    DOC_TYPE = 'TRC'
    tank = FK('StorageTank')
    product = FK('Product')
    recon_date = Date()
    opening_qty = Qty()
    receipts = Qty()
    transfers_in = Qty()
    issues = Qty()
    transfers_out = Qty()
    adjustments = Qty()               # approved adjustments already posted that day (shown separately)
    closing_book = Qty()              # opening + receipts + transfers_in - issues - transfers_out (+adjustments)
    physical_qty = Qty()
    variance = Qty()
    variance_value = Money()
    officer = OFK('User', on_delete=models.SET_NULL)
    adjustment = OFK('StockAdjustment')
    status = Choice('NO_VARIANCE PENDING_ADJUSTMENT ADJUSTED')


class StockAdjustment(Doc):
    DOC_TYPE = 'ADJ'
    tank = FK('StorageTank')
    product = FK('Product')
    adjustment_date = Date()
    quantity = Qty()                   # signed: +gain / -loss
    unit_cost = Price()
    value = Money()
    reason = Char(255)
    status = Choice('PENDING APPROVED REJECTED')


class StockTransfer(Doc):
    DOC_TYPE = 'TRF'
    from_tank = FK('StorageTank')
    to_tank = FK('StorageTank')
    quantity = Qty()
    transfer_date = Date()
    notes = Char(255)
    status = Choice('POSTED')


# ================================================================ PROCUREMENT
class PurchaseRequisition(Doc):
    DOC_TYPE = 'PR'
    department = OFK('Department')
    product = FK('Product')
    quantity = Qty()
    required_date = ODate()
    reason = Text()
    status = Choice('DRAFT SUBMITTED APPROVED REJECTED CONVERTED')


class PurchaseOrder(FXDoc, TotalsMixin):
    DOC_TYPE = 'PO'
    FX_DATE = 'order_date'
    supplier = FK('Supplier')
    requisition = OFK('PurchaseRequisition')
    order_date = Date()
    loading_depot = OFK('Depot')
    delivery_location = Char(200)
    expected_loading_date = ODate()
    payment_terms_days = models.PositiveIntegerField(default=30)
    status = Choice('DRAFT AWAITING_APPROVAL APPROVED PARTIALLY_RECEIVED RECEIVED INVOICED CLOSED CANCELLED')


class PurchaseOrderLine(Line):
    order = models.ForeignKey(PurchaseOrder, on_delete=models.CASCADE, related_name='lines')
    received_quantity = Qty()


class GoodsReceipt(Doc):
    DOC_TYPE = 'GRN'
    purchase_order = FK('PurchaseOrder')
    line = FK('PurchaseOrderLine')
    depot = FK('Depot')
    tank = FK('StorageTank')
    receipt_date = Date()
    delivery_note = Char(60)
    vehicle_reg = Char(30)
    observed_volume = Qty()
    temperature_c = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    density = models.DecimalField(max_digits=7, decimal_places=4, null=True, blank=True)
    standardized_volume = Qty(null=True, blank=True)
    volume_basis = Choice('OBSERVED STANDARDIZED')       # basis of `quantity` (never assumed equal)
    quantity = Qty()
    unit_cost = Price()                                    # functional currency
    total_cost = Money()
    status = Choice('POSTED RETURNED')


class PurchaseInvoice(FXDoc, TotalsMixin):
    DOC_TYPE = 'PINV'
    FX_DATE = 'invoice_date'
    supplier = FK('Supplier')
    purchase_order = OFK('PurchaseOrder')
    supplier_invoice_no = models.CharField(max_length=60)
    invoice_date = Date()
    due_date = ODate()
    amount_paid = Money()
    amount_credited = Money()
    functional_total = Money(editable=False)
    match_status = Choice('UNMATCHED MATCHED QTY_VARIANCE PRICE_VARIANCE NO_RECEIPT')
    match_notes = Text()
    journal = OFK('Journal', editable=False)
    status = Choice('DRAFT POSTED PART_PAID PAID CANCELLED')

    class Meta(FXDoc.Meta):
        constraints = FXDoc.Meta.constraints + [
            models.UniqueConstraint(fields=['company', 'supplier', 'supplier_invoice_no'], name='supplier_inv_uniq')]


class PurchaseInvoiceLine(Line):
    invoice = models.ForeignKey(PurchaseInvoice, on_delete=models.CASCADE, related_name='lines')
    po_line = OFK('PurchaseOrderLine')


class PurchaseReturn(Doc):
    DOC_TYPE = 'PRT'
    goods_receipt = FK('GoodsReceipt')
    quantity = Qty()
    return_date = Date()
    reason = Char(255)
    value = Money(editable=False)
    status = Choice('POSTED')


class SupplierCreditNote(FXDoc):
    DOC_TYPE = 'SCN'
    FX_DATE = 'note_date'
    supplier = FK('Supplier')
    invoice = OFK('PurchaseInvoice')
    note_date = Date()
    amount = Money()
    tax_amount = Money()
    reason = Char(255)
    journal = OFK('Journal', editable=False)
    status = Choice('DRAFT POSTED')


# ================================================================ CUSTOMERS & SALES
class Customer(Coded):
    CODE_TYPE = 'CUS'
    name = models.CharField(max_length=200)
    country = Char(60, default='DRC')
    address = Text()
    tax_registration = Char(60)
    contact_person = Char(120)
    phone = Char(40)
    email = models.EmailField(blank=True)
    currency = FK('Currency')
    credit_limit = Money()                      # expressed in the entity functional currency
    payment_terms = Char(60)
    credit_period_days = models.PositiveIntegerField(default=30)
    status = Choice('ACTIVE ON_HOLD BLOCKED INACTIVE')


class CustomerContact(Stamped):
    customer = FK('Customer')
    name = models.CharField(max_length=120)
    position = Char(80)
    phone = Char(40)
    email = models.EmailField(blank=True)


class CustomerCreditLimit(Stamped):
    customer = FK('Customer')
    limit = Money()
    effective_date = Date()
    approved_by = OFK('User')
    reason = Char(255)


class CustomerContract(Doc):
    DOC_TYPE = 'CCT'
    customer = FK('Customer')
    product = FK('Product')
    pricing_method = Choice('FIXED MARKET COST_PLUS')
    price_per_litre = Price()
    currency = FK('Currency')
    contract_quantity = Qty()
    valid_from = Date()
    valid_to = ODate()
    delivery_terms = Char(40)
    status = Choice('DRAFT ACTIVE EXPIRED CANCELLED')


class MarketPrice(Stamped):
    company = FK('Company')
    product = FK('Product')
    market_reference = models.CharField(max_length=80)
    reference_date = Date()
    base_price = Price()
    currency = FK('Currency')
    source = Char(120)


class SalesQuotation(FXDoc):
    DOC_TYPE = 'SQT'
    FX_DATE = 'quote_date'
    customer = FK('Customer')
    product = FK('Product')
    quantity = Qty()
    quote_date = Date()
    valid_until = ODate()
    pricing_method = Choice('FIXED MARKET COST_PLUS')
    cost_per_litre = Price()
    selling_price = Price()
    expected_profit = Money()
    status = Choice('DRAFT SENT ACCEPTED REJECTED EXPIRED CONVERTED')


class SalesOrder(FXDoc, TotalsMixin):
    DOC_TYPE = 'SO'
    FX_DATE = 'order_date'
    customer = FK('Customer')
    contract = OFK('CustomerContract')
    quotation = OFK('SalesQuotation')
    order_date = Date()
    required_date = ODate()
    delivery_location = Char(200)
    delivery_terms = Char(40)
    status = Choice('DRAFT AWAITING_APPROVAL APPROVED IN_FULFILMENT COMPLETED CANCELLED')


class SalesOrderLine(Line):
    order = models.ForeignKey(SalesOrder, on_delete=models.CASCADE, related_name='lines')
    pricing_method = Choice('FIXED MARKET COST_PLUS')
    cost_per_litre = Price()
    base_price = Price()
    premium = Price()                      # +premium / -discount
    markup_pct = Pct(null=True, blank=True)
    target_margin_pct = Pct(null=True, blank=True)
    profit_per_litre = Price(null=True, blank=True)
    margin_pct = Pct(editable=False)
    delivered_quantity = Qty()
    invoiced_quantity = Qty()


class SalesInvoice(FXDoc, TotalsMixin):
    DOC_TYPE = 'INV'
    FX_DATE = 'invoice_date'
    customer = FK('Customer')
    sales_order = OFK('SalesOrder')
    invoice_date = Date()
    due_date = ODate()
    amount_paid = Money()
    amount_credited = Money()
    functional_total = Money(editable=False)
    journal = OFK('Journal', editable=False)
    status = Choice('DRAFT POSTED PART_PAID PAID CANCELLED')


class SalesInvoiceLine(Line):
    invoice = models.ForeignKey(SalesInvoice, on_delete=models.CASCADE, related_name='lines')
    order_line = OFK('SalesOrderLine')
    shipment = OFK('Shipment')


class SalesCreditNote(FXDoc):
    DOC_TYPE = 'SCRN'
    FX_DATE = 'note_date'
    invoice = FK('SalesInvoice')
    shipment = OFK('Shipment')
    product = OFK('Product')
    note_date = Date()
    quantity = Qty()
    unit_price = Price()
    tax_rate = Pct()
    subtotal = Money(editable=False)
    tax_total = Money(editable=False)
    total = Money(editable=False)
    reason = Char(255)
    restock_tank = OFK('StorageTank')
    journal = OFK('Journal', editable=False)
    status = Choice('DRAFT POSTED')


# ================================================================ FLEET
class Vehicle(Coded):
    CODE_TYPE = 'VEH'
    registration_number = models.CharField(max_length=30)
    make = Char(60)
    model = Char(60)
    truck_type = Char(60)
    trailer = OFK('Trailer')
    tank_capacity = Qty()
    compartments = models.JSONField(default=list, blank=True)       # [5000, 10000, ...]
    ownership = Choice('OWNED LEASED')
    purchase_value = Money()
    purchase_date = ODate()
    insurance_expiry = ODate()
    inspection_expiry = ODate()
    fuel_norm_km_per_litre = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    odometer_km = Qty()
    status = Choice('AVAILABLE ON_TRIP MAINTENANCE INACTIVE')


class Trailer(Coded):
    CODE_TYPE = 'TRL'
    registration_number = models.CharField(max_length=30)
    capacity = Qty()
    compartments = models.JSONField(default=list, blank=True)
    status = Choice('AVAILABLE ON_TRIP MAINTENANCE INACTIVE')


class Driver(Coded):
    CODE_TYPE = 'DRV'
    full_name = models.CharField(max_length=150)
    id_number = Char(40)
    licence_number = Char(40)
    licence_category = Char(20)
    licence_expiry = ODate()
    phone = Char(40)
    employment_status = Choice('ACTIVE SUSPENDED TERMINATED')


class VehicleAssignment(Stamped):
    company = FK('Company')
    vehicle = FK('Vehicle')
    trailer = OFK('Trailer')
    driver = FK('Driver')
    shipment = OFK('Shipment')
    start_at = models.DateTimeField(default=timezone.now)
    end_at = OTime()
    status = Choice('ACTIVE COMPLETED CANCELLED')


class VehicleMaintenance(Stamped):
    company = FK('Company')
    vehicle = FK('Vehicle')
    maintenance_type = Choice('SERVICE REPAIR TYRES INSPECTION INSURANCE OTHER')
    maintenance_date = Date()
    description = Char(255)
    cost = Money()
    currency = OFK('Currency')
    odometer_km = Qty()
    next_due_date = ODate()
    vendor = Char(120)
    expense = OFK('Expense')


class VehicleExpense(Stamped):
    """Operational log (litres, odometer). The money lives in the linked Expense -> no double counting."""
    company = FK('Company')
    vehicle = FK('Vehicle')
    shipment = OFK('Shipment')
    expense_type = Choice('FUEL ALLOWANCE ROAD PARKING REPAIR TYRES OTHER')
    expense_date = Date()
    litres = Qty(null=True, blank=True)
    odometer_km = Qty()
    amount = Money()
    expense = OFK('Expense')


class VehicleDocument(Stamped):
    company = FK('Company')
    vehicle = FK('Vehicle')
    doc_type = Choice('INSURANCE INSPECTION REGISTRATION LICENCE OTHER')
    number = Char(60)
    expiry_date = ODate()
    file = models.FileField(upload_to='vehicle_docs/%Y/%m/', blank=True)


# ================================================================ THIRD-PARTY TRANSPORT
class Transporter(Coded):
    CODE_TYPE = 'TRN'
    name = models.CharField(max_length=200)
    registration_number = Char(60)
    contact_person = Char(120)
    phone = Char(40)
    email = models.EmailField(blank=True)
    tax_pin = Char(40)
    bank_name = Char(120)
    bank_account = Char(60)
    payment_terms_days = models.PositiveIntegerField(default=30)
    credit_limit = Money()
    currency = FK('Currency')
    status = Choice('ACTIVE SUSPENDED INACTIVE')


class TransporterContract(Doc):
    DOC_TYPE = 'TCT'
    transporter = FK('Transporter')
    start_date = Date()
    end_date = ODate()
    terms = Text()
    status = Choice('DRAFT ACTIVE EXPIRED CANCELLED')


class TransporterRate(Stamped):
    company = FK('Company')
    transporter = FK('Transporter')
    origin = Char(120)
    destination = Char(120)
    rate_per_litre = Price(null=True, blank=True)
    rate_per_trip = Money(null=True, blank=True)
    currency = FK('Currency')
    effective_from = Date()
    effective_to = ODate()


class TransporterVehicle(Stamped):
    company = FK('Company')
    transporter = FK('Transporter')
    kind = Choice('TRUCK TRAILER')
    registration_number = models.CharField(max_length=30)
    capacity = Qty()
    compartments = models.JSONField(default=list, blank=True)
    driver_name = Char(120)
    driver_licence = Char(40)
    driver_phone = Char(40)
    status = Choice('ACTIVE INACTIVE')


class TransportBooking(FXDoc):
    DOC_TYPE = 'TB'
    FX_DATE = 'booking_date'
    shipment = OFK('Shipment')
    transporter = FK('Transporter')
    truck = FK('TransporterVehicle')
    trailer = OFK('TransporterVehicle')
    driver_name = Char(120)
    product = FK('Product')
    quantity = Qty()
    booking_date = Date()
    origin = Char(120)
    destination = Char(120)
    rate_basis = Choice('PER_LITRE PER_TRIP')
    contracted_rate = Price()
    total_charge = Money()
    advance_paid = Money(editable=False)
    expected_delivery = ODate()
    status = Choice('DRAFT AWAITING_APPROVAL APPROVED IN_TRANSIT DELIVERED INVOICED SETTLED CANCELLED')

    @property
    def balance_payable(self): return self.total_charge - self.advance_paid


class TransporterInvoice(FXDoc, TotalsMixin):
    DOC_TYPE = 'TINV'
    FX_DATE = 'invoice_date'
    transporter = FK('Transporter')
    booking = FK('TransportBooking')
    invoice_no = models.CharField(max_length=60)
    invoice_date = Date()
    due_date = ODate()
    amount_paid = Money()
    amount_credited = Money()
    functional_total = Money(editable=False)
    expense = models.OneToOneField('Expense', null=True, blank=True, editable=False,
                                   on_delete=models.PROTECT, related_name='+')
    status = Choice('DRAFT POSTED PART_PAID PAID CANCELLED')

    class Meta(FXDoc.Meta):
        constraints = FXDoc.Meta.constraints + [
            models.UniqueConstraint(fields=['company', 'transporter', 'invoice_no'], name='transporter_inv_uniq')]

    def recalc(self):          # transporter invoices are header-only (subtotal given)
        self.tax_total = self.tax_total or D0
        self.total = self.subtotal + self.tax_total
        models.Model.save(self, update_fields=['total'])


# ================================================================ SHIPMENTS
SHIPMENT_STATUSES = ('DRAFT AWAITING_APPROVAL APPROVED AWAITING_LOADING LOADING LOADED DISPATCHED IN_TRANSIT '
                     'AT_BORDER UNDER_CUSTOMS CLEARED ARRIVED DELIVERED RECONCILIATION_PENDING CLOSED CANCELLED')


class Shipment(FXDoc):
    DOC_TYPE = 'SHP'
    FX_DATE = 'loading_date'
    customer = OFK('Customer')
    supplier = OFK('Supplier')
    purchase_order = OFK('PurchaseOrder')
    sales_order = OFK('SalesOrder')
    product = FK('Product')
    quantity = Qty()
    purchase_price = Price()
    selling_price = Price()
    depot = OFK('Depot')
    loading_tank = OFK('StorageTank')
    loading_date = ODate()
    loading_quantity = Qty()
    truck_ownership = Choice('OWNED HIRED')
    vehicle = OFK('Vehicle')
    trailer = OFK('Trailer')
    driver = OFK('Driver')
    transporter = OFK('Transporter')
    hired_truck = OFK('TransporterVehicle')
    origin = Char(120)
    destination = Char(160)
    border_crossing = OFK('BorderCrossing')
    expected_delivery = OTime()
    actual_delivery = OTime()
    distance_km = Qty()
    fuel_issued_litres = Qty()
    fuel_used_litres = Qty()
    dispatched_at = OTime()
    stock_issued = models.BooleanField(default=False, editable=False)
    intercompany_transaction = OFK('IntercompanyTransaction')
    status = Choice(SHIPMENT_STATUSES, n=30)


class ShipmentLine(models.Model):
    shipment = models.ForeignKey(Shipment, on_delete=models.CASCADE, related_name='lines')
    product = FK('Product')
    tank = OFK('StorageTank')
    compartment = Char(20)
    quantity = Qty()
    loaded_quantity = Qty()
    purchase_price = Price()
    selling_price = Price()
    unit_cost = Price(editable=False)          # actual cost per litre at stock issue (functional)
    cost_total = Money(editable=False)


class ShipmentStage(Stamped):
    company = FK('Company')
    shipment = FK('Shipment')
    stage = Choice('LOADING DEPARTURE BORDER CUSTOMS DELIVERY')
    planned_at = OTime()
    actual_at = OTime()
    location = Char(160)
    notes = Char(255)


class ShipmentStatusHistory(models.Model):
    """Permanent manual-tracking history (no GPS dependency)."""
    objects = ImmutableQuerySet.as_manager()
    company = FK('Company')
    shipment = FK('Shipment')
    previous_status = Char(30)
    new_status = models.CharField(max_length=30)
    changed_at = models.DateTimeField(default=timezone.now)
    location = Char(160)
    updated_by = OFK('User', on_delete=models.SET_NULL)
    comments = Text()
    attachment = models.FileField(upload_to='shipment_updates/%Y/%m/', blank=True)
    confirmation_type = Choice('NONE CUSTOMER TRANSPORTER')
    confirmed_by = Char(120)

    class Meta:
        ordering = ['changed_at', 'id']

    def save(self, *a, **kw):
        if self.pk:
            raise ValidationError('Shipment history is permanent.')
        super().save(*a, **kw)

    def delete(self, *a, **kw): raise ValidationError('Shipment history is permanent.')


class ShipmentDocument(Stamped):
    company = FK('Company')
    shipment = FK('Shipment')
    doc_type = Choice('COMMERCIAL_INVOICE CERTIFICATE_OF_ORIGIN TRANSIT_DOC EXPORT_DECLARATION IMPORT_DOC '
                      'DELIVERY_NOTE POD PHOTO OTHER', default='OTHER')
    number = Char(60)
    file = models.FileField(upload_to='shipment_docs/%Y/%m/', blank=True)
    notes = Char(255)


class ShipmentDelivery(Doc):
    DOC_TYPE = 'DLV'
    shipment = FK('Shipment')
    delivery_date = Date()
    delivered_quantity = Qty()
    remaining_before = Qty(editable=False)
    is_final = models.BooleanField(default=False)           # last delivery: any remaining litres = shortage
    shortage_litres = Qty(editable=False)
    shortage_pct = Pct(editable=False)
    cogs_value = Money(editable=False)
    loss_value = Money(editable=False)
    temperature_c = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    density = models.DecimalField(max_digits=7, decimal_places=4, null=True, blank=True)
    received_by = Char(120)
    pod_file = models.FileField(upload_to='pod/%Y/%m/', blank=True)
    notes = Char(255)
    journal = OFK('Journal', editable=False)
    status = Choice('PENDING_APPROVAL APPROVED REJECTED')


class ShipmentCostAllocation(Stamped):
    company = FK('Company')
    shipment = FK('Shipment')
    expense = FK('Expense')
    method = Choice('DIRECT PERCENT AMOUNT LITRES EQUAL')
    percentage = Pct()
    amount = Money()                 # functional currency

    class Meta:
        constraints = [models.UniqueConstraint(fields=['shipment', 'expense'], name='alloc_unique')]


class ShipmentCostSheet(models.Model):
    """Versioned costing snapshot; finalised after reconciliation, never overwritten."""
    company = FK('Company')
    shipment = FK('Shipment')
    version = models.PositiveIntegerField()
    is_final = models.BooleanField(default=False)
    is_provisional = models.BooleanField(default=True)
    purchase_cost = Money()
    components = models.JSONField(default=dict)       # LOADING, DEPOT, TRANSPORT_HIRED, TRANSPORT_OWNED, ...
    total_direct_expenses = Money()
    total_shipment_cost = Money()
    cogs_pool = Money()
    additional_expenses = Money()
    loaded_litres = Qty()
    delivered_litres = Qty()
    shortage_litres = Qty()
    shortage_value = Money()
    invoiced_litres = Qty()
    revenue = Money()
    cogs = Money()
    gross_profit = Money()
    contribution = Money()
    margin_pct = Pct()
    delivered_cost_per_litre = Price()
    notes = Text()
    created_by = OFK('User', on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['shipment', 'version'], name='costsheet_unique')]
        ordering = ['shipment', '-version']

    def __str__(self): return f'{self.shipment} v{self.version}'


# ================================================================ EXPORT & CUSTOMS
class BorderCrossing(Stamped):
    code = models.CharField(max_length=20, unique=True)
    name = models.CharField(max_length=120)
    country_from = Char(60, default='Kenya')
    country_to = Char(60, default='DRC')
    is_active = Flag()


class ComplianceRequirement(Stamped):
    """Configurable, effective-dated checklist item (no hard-coded rules)."""
    company = OFK('Company')
    code = models.CharField(max_length=30)
    name = models.CharField(max_length=160)
    applies_to = Choice('EXPORT IMPORT TRANSIT')
    product_category = Char(20)
    mandatory = Flag()
    effective_from = Date()
    effective_to = ODate()
    notes = Text()


class ExportDeclaration(Doc):
    DOC_TYPE = 'EXD'
    shipment = FK('Shipment')
    declaration_number = Char(60)
    customs_reference = Char(60)
    commercial_invoice_no = Char(60)
    certificate_of_origin_no = Char(60)
    transit_document_no = Char(60)
    customs_broker = Char(120)
    border_crossing = OFK('BorderCrossing')
    export_date = ODate()
    clearance_date = ODate()
    import_document_no = Char(60)
    import_clearance_date = ODate()
    notes = Text()
    status = Choice('DRAFT SUBMITTED QUERIED CLEARED REJECTED')


class ShipmentComplianceCheck(Stamped):
    company = FK('Company')
    shipment = FK('Shipment')
    requirement = FK('ComplianceRequirement')
    status = Choice('PENDING PROVIDED WAIVED NOT_APPLICABLE')
    document_ref = Char(80)
    file = models.FileField(upload_to='compliance/%Y/%m/', blank=True)
    checked_by = OFK('User', on_delete=models.SET_NULL)
    checked_at = OTime()


# ================================================================ EXPENSES
class ExpenseCategory(Stamped):
    code = models.CharField(max_length=30, unique=True)
    name = models.CharField(max_length=100)
    group = Choice('PROCUREMENT TRANSPORT BORDER DELIVERY ADMIN FINANCE')
    cost_component = Choice('NONE LOADING DEPOT TRANSPORT_HIRED TRANSPORT_OWNED DRIVER FUEL BORDER CLEARING '
                            'INSURANCE TRANSIT OFFLOADING BANK OTHER')
    in_cogs = Flag(True)                 # part of landed cost / COGS (False => deducted after gross profit)
    is_active = Flag()


class Expense(FXDoc):
    DOC_TYPE = 'EXP'
    FX_DATE = 'expense_date'
    expense_date = Date()
    category = FK('ExpenseCategory')
    description = Char(255)
    shipment = OFK('Shipment')
    vehicle = OFK('Vehicle')
    supplier = OFK('Supplier')
    transporter = OFK('Transporter')
    payee = Char(150)
    truck_ownership = Choice('NA OWNED HIRED')
    amount = Money()                                   # net, transaction currency
    tax_amount = Money()
    payment_method = Choice('CREDIT CASH BANK MPESA')
    bank_account = OFK('BankAccount')
    receipt_no = Char(60)
    receipt = models.FileField(upload_to='receipts/%Y/%m/', blank=True)
    account = OFK('Account')                           # accounting code override
    duplicate_key = Char(64, editable=False)
    amount_paid = Money(editable=False)
    functional_total = Money(editable=False)
    journal = OFK('Journal', editable=False)
    status = Choice('DRAFT AWAITING_APPROVAL APPROVED POSTED PAID REJECTED')

    class Meta(FXDoc.Meta):
        constraints = FXDoc.Meta.constraints + [
            models.UniqueConstraint(fields=['company', 'duplicate_key'], condition=~Q(duplicate_key=''),
                                    name='expense_dup_uniq')]

    @property
    def total(self): return self.amount + self.tax_amount

    @property
    def outstanding(self): return self.total - self.amount_paid

    def save(self, *a, **kw):
        if not self.duplicate_key:
            raw = '|'.join(str(x) for x in (self.company_id, self.category_id, self.expense_date, self.amount,
                                            self.tax_amount, self.receipt_no or self.description,
                                            self.payee or self.supplier_id or self.transporter_id or '',
                                            self.shipment_id or ''))
            self.duplicate_key = hashlib.sha1(raw.encode()).hexdigest()
        super().save(*a, **kw)


# ================================================================ FINANCE
class JournalQuerySet(ImmutableQuerySet):
    pass


class Journal(models.Model):
    objects = JournalQuerySet.as_manager()
    company = FK('Company')
    reference = models.CharField(max_length=40)
    date = Date()
    period = FK('AccountingPeriod')
    description = Char(255)
    status = Choice('POSTED REVERSED')
    source_type = Char(40)
    source_id = Char(40)
    reverses = OFK('self')
    is_closing = models.BooleanField(default=False)
    total_debit = Money()
    total_credit = Money()
    posted_by = OFK('User', on_delete=models.SET_NULL)
    posted_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['company', 'reference'], name='journal_ref_uniq')]
        indexes = [models.Index(fields=['company', 'date'])]
        ordering = ['-date', '-id']

    def save(self, *a, **kw):
        if self.pk:
            raise ValidationError('Posted journals cannot be edited; post a reversing entry.')
        super().save(*a, **kw)

    def delete(self, *a, **kw): raise ValidationError('Posted journals cannot be deleted.')

    def __str__(self): return self.reference


class JournalLine(models.Model):
    objects = ImmutableQuerySet.as_manager()
    journal = models.ForeignKey(Journal, on_delete=models.PROTECT, related_name='lines')
    account = FK('Account')
    debit = Money()
    credit = Money()
    currency = OFK('Currency')
    foreign_amount = Money()
    exchange_rate = Rate(null=True, blank=True)
    shipment = OFK('Shipment')
    party_type = Char(20)
    party_id = models.PositiveIntegerField(null=True, blank=True)
    narration = Char(255)

    class Meta:
        indexes = [models.Index(fields=['account', 'journal'])]

    def save(self, *a, **kw):
        if self.pk:
            raise ValidationError('Journal lines are immutable.')
        super().save(*a, **kw)

    def delete(self, *a, **kw): raise ValidationError('Journal lines cannot be deleted.')


class BankAccount(Stamped):
    company = FK('Company')
    name = models.CharField(max_length=120)
    account_type = Choice('BANK CASH MPESA PETTY')
    bank_name = Char(120)
    account_number = Char(60)
    currency = FK('Currency')
    gl_account = FK('Account')
    mpesa_shortcode = Char(20)
    is_active = Flag()


class BankTransaction(Stamped):
    company = FK('Company')
    bank_account = FK('BankAccount')
    txn_date = Date()
    description = Char(255)
    reference = Char(80, db_index=True)
    money_in = Money()
    money_out = Money()
    balance = Money(null=True, blank=True)
    batch = Char(40)
    matched_payment = OFK('Payment')
    status = Choice('UNMATCHED MATCHED IGNORED')


class BankReconciliation(Doc):
    DOC_TYPE = 'BRC'
    bank_account = FK('BankAccount')
    statement_date = Date()
    statement_balance = Money()
    book_balance = Money()
    difference = Money()
    unmatched_count = models.PositiveIntegerField(default=0)
    notes = Char(255)
    status = Choice('OPEN RECONCILED')


class Payment(FXDoc):
    DOC_TYPE = 'PAY'
    FX_DATE = 'payment_date'
    direction = Choice('RECEIPT PAYMENT')
    party_type = Choice('CUSTOMER SUPPLIER TRANSPORTER OTHER')
    customer = OFK('Customer')
    supplier = OFK('Supplier')
    transporter = OFK('Transporter')
    payee = Char(150)
    method = Choice('BANK CASH MPESA')
    bank_account = FK('BankAccount')
    payment_date = Date()
    amount = Money()
    purpose = Choice('INVOICE ADVANCE BANK_CHARGE OTHER')
    booking = OFK('TransportBooking')
    counter_account = OFK('Account')
    mpesa_reference = Char(40, db_index=True)
    payer_phone = Char(30)
    bank_reference = Char(60)
    narration = Char(255)
    allocated_amount = Money(editable=False)
    approved_by = OFK('User', on_delete=models.SET_NULL, editable=False)
    approved_at = OTime(editable=False)
    executed_by = OFK('User', on_delete=models.SET_NULL, editable=False)
    journal = OFK('Journal', editable=False)
    status = Choice('DRAFT AWAITING_APPROVAL APPROVED POSTED REVERSED REJECTED')

    class Meta(FXDoc.Meta):
        constraints = FXDoc.Meta.constraints + [
            models.UniqueConstraint(fields=['company', 'mpesa_reference'], condition=~Q(mpesa_reference=''),
                                    name='mpesa_ref_uniq')]

    @property
    def unallocated_amount(self): return self.amount - self.allocated_amount


class PaymentAllocation(models.Model):
    payment = models.ForeignKey(Payment, on_delete=models.PROTECT, related_name='allocations')
    sales_invoice = OFK('SalesInvoice')
    purchase_invoice = OFK('PurchaseInvoice')
    transporter_invoice = OFK('TransporterInvoice')
    expense = OFK('Expense')
    amount = Money()                       # in invoice currency
    fx_gain_loss = Money()
    created_at = models.DateTimeField(auto_now_add=True)


class FixedAsset(Doc):
    DOC_TYPE = 'FA'
    name = models.CharField(max_length=150)
    category = Choice('TRUCK TRAILER DEPOT TANK EQUIPMENT OFFICE OTHER')
    acquisition_date = Date()
    cost = Money()
    salvage_value = Money()
    useful_life_months = models.PositiveIntegerField(default=60)
    accumulated_depreciation = Money(editable=False)
    location = Char(160)
    vehicle = OFK('Vehicle')
    tank = OFK('StorageTank')
    disposal_date = ODate()
    disposal_proceeds = Money(editable=False)
    disposal_gain_loss = Money(editable=False)
    status = Choice('ACTIVE DISPOSED')

    @property
    def net_book_value(self): return self.cost - self.accumulated_depreciation


class AssetDepreciation(Stamped):
    company = FK('Company')
    asset = FK('FixedAsset')
    period_end = Date()
    amount = Money()
    journal = FK('Journal')

    class Meta:
        constraints = [models.UniqueConstraint(fields=['asset', 'period_end'], name='dep_unique')]


# ================================================================ PAYROLL & HR
class Employee(Coded):
    CODE_TYPE = 'EMP'
    full_name = models.CharField(max_length=150)
    national_id = Char(40)
    job_title = Char(100)
    department = OFK('Department')
    hire_date = ODate()
    basic_salary = Money()
    currency = FK('Currency')
    allowances = models.JSONField(default=list, blank=True)       # [{"name": "Housing", "amount": 1000}]
    bank_name = Char(120)
    bank_account = Char(60)
    tax_number = Char(40)
    is_driver = Flag(False)
    status = Choice('ACTIVE SUSPENDED TERMINATED')


class LeaveRequest(Doc):
    DOC_TYPE = 'LV'
    employee = FK('Employee')
    leave_type = Choice('ANNUAL SICK MATERNITY PATERNITY UNPAID OTHER')
    start_date = Date()
    end_date = Date()
    days = models.DecimalField(max_digits=5, decimal_places=1, default=1)
    status = Choice('DRAFT APPROVED REJECTED')


class PayrollConfig(Stamped):
    """Country/entity specific, effective-dated statutory items (nothing hard-coded)."""
    company = FK('Company')
    code = models.CharField(max_length=30)
    name = models.CharField(max_length=100)
    kind = Choice('DEDUCTION EMPLOYER_CONTRIBUTION')
    calc_type = Choice('PERCENT FIXED BRACKETS')
    base = Choice('GROSS BASIC')
    value = Price()                                                # percent or fixed amount
    brackets = models.JSONField(default=list, blank=True)          # [{"up_to": 24000, "rate": 10}, ...]
    cap = Money(null=True, blank=True)
    liability_account = OFK('Account')
    effective_from = Date()
    effective_to = ODate()
    is_active = Flag()


class PayrollRun(Doc):
    DOC_TYPE = 'PRN'
    period_start = Date()
    period_end = Date()
    total_gross = Money(editable=False)
    total_deductions = Money(editable=False)
    total_net = Money(editable=False)
    total_employer_cost = Money(editable=False)
    journal = OFK('Journal', editable=False)
    status = Choice('DRAFT POSTED')


class Payslip(models.Model):
    run = models.ForeignKey(PayrollRun, on_delete=models.PROTECT, related_name='payslips')
    employee = FK('Employee')
    basic = Money()
    allowances = Money()
    overtime = Money()
    gross = Money()
    deductions = models.JSONField(default=dict)
    total_deductions = Money()
    employer_contributions = models.JSONField(default=dict)
    total_employer = Money()
    net_pay = Money()


# ================================================================ GROUP ACCOUNTING
class IntercompanyTransaction(Stamped):
    reference = models.CharField(max_length=40, unique=True)
    txn_type = Choice('SALE INVENTORY_TRANSFER SERVICE SETTLEMENT')
    from_company = FK('Company')            # seller / lender
    to_company = FK('Company')              # buyer / borrower
    txn_date = Date()
    product = OFK('Product')
    quantity = Qty()
    transfer_price = Price()
    currency = FK('Currency')
    amount = Money()
    seller_rate = Rate(default=Decimal('1'))
    buyer_rate = Rate(default=Decimal('1'))
    from_journal = OFK('Journal', related_name='+')
    to_journal = OFK('Journal', related_name='+')
    shipment = OFK('Shipment', related_name='+')
    settled_amount = Money()
    status = Choice('POSTED PART_SETTLED SETTLED')
    notes = Char(255)

    @property
    def outstanding(self): return self.amount - self.settled_amount


class IntercompanyBalance(models.Model):
    company = FK('Company')
    counterparty = FK('Company')
    currency = FK('Currency')
    receivable = Money()
    payable = Money()
    gl_receivable = Money()
    gl_payable = Money()
    difference = Money()
    as_of_date = Date()
    created_at = models.DateTimeField(auto_now_add=True)


class ConsolidationRun(Stamped):
    reference = models.CharField(max_length=40, unique=True)
    period_start = Date()
    period_end = Date()
    reporting_currency = FK('Currency')
    status = Choice('DRAFT COMPLETED')
    result = models.JSONField(default=dict, blank=True)


class EliminationJournal(models.Model):
    run = models.ForeignKey(ConsolidationRun, on_delete=models.CASCADE, related_name='eliminations')
    entry_no = models.PositiveIntegerField()
    description = Char(255)
    account_group_code = models.CharField(max_length=40)
    debit = Money()
    credit = Money()
    ic_transaction = OFK('IntercompanyTransaction')