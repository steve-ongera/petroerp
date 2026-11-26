"""
PetroERP business logic.

Rules enforced here (never in the frontend):
  * every financial posting goes through post_journal() -> balanced, period-checked, immutable
  * every multi-record operation is @transaction.atomic
  * the costing engine only READS expense allocations -> no double counting
  * AI helpers only read data and create Alerts; they never approve or post

Access control is ROLE based (Role.code). The role sets below are mirrored in src/navigation.js.
"""
import csv
import hashlib
import io
import json
from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal

from django.contrib.contenttypes.models import ContentType
from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Avg, Count, F, Q, Sum
from django.utils import timezone

from .models import *  # noqa: F401,F403  (models + q2/q3/q6/q8/D0 helpers)


def err(msg):
    raise ValidationError(msg)


def today():
    return timezone.localdate()


def as_date(d):
    if isinstance(d, datetime):
        return d.date()
    if isinstance(d, str):
        return date.fromisoformat(d[:10])
    return d or today()


def dec(x):
    return Decimal(str(x if x not in (None, '') else 0))


# =========================================================== role sets (replace the old permission codes)
# Role.code values. Group Administrator / superuser always passes (User.is_group_admin).
# Keep these in step with src/navigation.js.
FINANCE_VIEW_ROLES = ('MD', 'KE_FINANCE_MANAGER', 'DRC_FINANCE_MANAGER', 'ACCOUNTANT', 'CASHIER', 'INTERNAL_AUDITOR')
REPORTS_VIEW_ROLES = ('MD', 'KE_FINANCE_MANAGER', 'DRC_FINANCE_MANAGER', 'ACCOUNTANT', 'PROCUREMENT_MANAGER', 'SALES_MANAGER',
                      'FLEET_MANAGER', 'LOGISTICS_MANAGER', 'READONLY_MANAGER', 'INTERNAL_AUDITOR')
COSTING_VIEW_ROLES = ('MD', 'KE_FINANCE_MANAGER', 'DRC_FINANCE_MANAGER', 'ACCOUNTANT', 'SALES_MANAGER', 'LOGISTICS_MANAGER',
                      'INTERNAL_AUDITOR')
GROUP_VIEW_ROLES = ('MD', 'KE_FINANCE_MANAGER', 'DRC_FINANCE_MANAGER', 'INTERNAL_AUDITOR')
AI_VIEW_ROLES = GROUP_VIEW_ROLES
AI_EDIT_ROLES = ('MD', 'KE_FINANCE_MANAGER', 'DRC_FINANCE_MANAGER')
AUDIT_VIEW_ROLES = ('MD', 'INTERNAL_AUDITOR')
ADMIN_VIEW_ROLES = ('MD', 'INTERNAL_AUDITOR')                 # may READ users/roles; only Group Admin may write

# named actions (were: approvals.decide, finance.post, ...)
APPROVER_ROLES = ('MD', 'KE_FINANCE_MANAGER', 'DRC_FINANCE_MANAGER', 'PROCUREMENT_MANAGER', 'SALES_MANAGER', 'LOGISTICS_MANAGER')
FINANCE_POST_ROLES = ('KE_FINANCE_MANAGER', 'DRC_FINANCE_MANAGER', 'ACCOUNTANT')
PERIOD_CLOSE_ROLES = ('KE_FINANCE_MANAGER', 'DRC_FINANCE_MANAGER')
COSTING_FINALIZE_ROLES = ('KE_FINANCE_MANAGER', 'DRC_FINANCE_MANAGER')
PAYMENT_EXECUTE_ROLES = ('ACCOUNTANT',)
CREDIT_OVERRIDE_ROLES = ('DRC_FINANCE_MANAGER', 'SALES_MANAGER')
MATCH_OVERRIDE_ROLES = ('PROCUREMENT_MANAGER',)
BELOW_MARGIN_ROLES = ('SALES_MANAGER',)
STOCK_ADJUST_ROLES = ('STORE_MANAGER',)
COMPANY_EDIT_ROLES = ('KE_FINANCE_MANAGER',)
GROUP_EDIT_ROLES = ()                                          # () = Group Administrator only (same as before)


def has_role(user, roles):
    """True for Group Administrator/superuser, or when the user's Role.code is in `roles`."""
    if user.is_group_admin:
        return True
    return bool(user.role_id and user.role.code in roles)


# =========================================================== numbering
@transaction.atomic
def next_reference(company, doc_type, on_date=None, short=False):
    seq, _ = NumberSequence.objects.select_for_update().get_or_create(
        company=company, doc_type=doc_type, defaults={'prefix': doc_type[:10]})
    n = seq.next_number
    seq.next_number = n + 1
    seq.save(update_fields=['next_number'])
    num = str(n).zfill(seq.padding)
    if short:
        return f'{seq.prefix}-{num}'
    return f'{company.code}-{seq.prefix}-{as_date(on_date).year}-{num}'


# =========================================================== audit & notifications
def audit(user, action, obj=None, changes=None, company=None, ip=None, model_name=None, object_id=None):
    return AuditLog.objects.create(
        user=user if getattr(user, 'pk', None) else None,
        company_id=company or getattr(obj, 'company_id', None),
        action=action,
        model_name=model_name or (obj.__class__.__name__ if obj is not None else ''),
        object_id=str(object_id or getattr(obj, 'pk', '') or ''),
        object_repr=str(obj)[:200] if obj is not None else '',
        changes=json.loads(json.dumps(changes or {}, default=str)), ip_address=ip)


def verify_audit_chain():
    prev, bad = '', []
    for row in AuditLog.objects.order_by('id').iterator():
        if row.prev_hash != prev or row.hash != row.compute_hash():
            bad.append(row.id)
        prev = row.hash
    return {'ok': not bad, 'tampered_ids': bad}


def notify_roles(company, roles, title, message='', level='INFO', link=''):
    users = User.objects.filter(is_active=True).filter(
        Q(is_superuser=True) | Q(role__code='GROUP_ADMIN') |
        Q(role__code__in=roles, companies=company)).distinct()
    Notification.objects.bulk_create([Notification(user=u, company=company, title=title, message=message,
                                                   level=level, link=link) for u in users])


def notify_user(user, company, title, message='', level='INFO', link=''):
    if user:
        Notification.objects.create(user=user, company=company, title=title, message=message, level=level, link=link)


# =========================================================== currency
def get_rate(frm, to, on_date, _depth=0):
    """Return (rate, rate_date, source) converting 1 unit of `frm` into `to`."""
    frm, to, on_date = str(frm), str(to), as_date(on_date)
    if frm == to:
        return Decimal('1'), on_date, 'IDENTITY'
    for a, b, inv in ((frm, to, False), (to, frm, True)):
        r = ExchangeRate.objects.filter(from_currency_id=a, to_currency_id=b, rate_date__lte=on_date) \
            .order_by('-rate_date', '-id').first()
        if r:
            return (q8(1 / r.rate) if inv else r.rate), r.rate_date, r.source
    if _depth == 0 and 'USD' not in (frm, to):
        r1, d1, s1 = get_rate(frm, 'USD', on_date, 1)
        r2, d2, s2 = get_rate('USD', to, on_date, 1)
        return q8(r1 * r2), min(d1, d2), f'{s1}+{s2}'
    err(f'No exchange rate {frm}->{to} on or before {on_date}. Add one under Currencies & rates.')


def convert(amount, frm, to, on_date):
    rate, _, _ = get_rate(frm, to, on_date)
    return q2(dec(amount) * rate)


def fill_fx(doc):
    """Capture currency, rate, rate date and source on every FX document."""
    co = doc.company
    if doc.currency_id is None:
        doc.currency_id = co.functional_currency_id
    d = getattr(doc, doc.FX_DATE, None)
    d = as_date(d) if d else today()
    if doc.exchange_rate is None:
        rate, rdate, src = get_rate(doc.currency_id, co.functional_currency_id, d)
        doc.exchange_rate, doc.rate_date, doc.rate_source = rate, rdate, src
    elif not doc.rate_source:
        doc.rate_date, doc.rate_source = d, 'MANUAL'


def get_tax_rate(company, code, on_date):
    """Effective-dated, professionally verified tax rate. Raises if not configured."""
    if not code:
        return D0
    t = TaxConfig.objects.filter(company=company, code=code, is_active=True, verified_at__isnull=False,
                                 effective_from__lte=as_date(on_date)) \
        .filter(Q(effective_to__isnull=True) | Q(effective_to__gte=as_date(on_date))).order_by('-effective_from').first()
    if not t:
        err(f'No verified, effective tax configuration "{code}" for {company.code} on {as_date(on_date)}.')
    return t.rate_percent


# =========================================================== accounting engine
def acct(company, key):
    m = AccountMapping.objects.filter(company=company, key=key).select_related('account').first()
    if not m:
        err(f'Account mapping "{key}" is not configured for {company.code}.')
    return m.account


def get_open_period(company, on_date):
    p = AccountingPeriod.objects.filter(company=company, start_date__lte=on_date, end_date__gte=on_date).first()
    if not p:
        err(f'No accounting period for {company.code} on {on_date}. Create the fiscal year first.')
    if p.status != 'OPEN':
        err(f'Accounting period {p.name} is closed for {company.code}; posting is not allowed.')
    return p


@transaction.atomic
def post_journal(company, on_date, description, lines, *, source=None, user=None, reverses=None,
                 is_closing=False, reference=None):
    """
    lines: [{account: Account, debit, credit, shipment?, party_type?, party_id?, narration?,
             currency?, foreign_amount?, exchange_rate?}]
    Raises unless debits == credits. Period must be open. Result is immutable.
    """
    on_date = as_date(on_date)
    period = get_open_period(company, on_date)
    prepared, td, tc = [], D0, D0
    for ln in lines:
        d, c = q2(ln.get('debit', 0)), q2(ln.get('credit', 0))
        if d < 0 or c < 0 or (d and c):
            err('Each journal line must carry either a debit or a credit (positive).')
        if not d and not c:
            continue
        a = ln['account']
        if a.company_id != company.id:
            err(f'Account {a.code} belongs to another legal entity.')
        if not a.is_postable or not a.is_active:
            err(f'Account {a.code} is not postable.')
        td, tc = td + d, tc + c
        prepared.append((a, d, c, ln))
    if not prepared or td != tc:
        err(f'Journal is not balanced (debits {td} vs credits {tc}).')
    j = Journal(company=company, date=on_date, period=period, description=description[:255], status='POSTED',
                source_type=source.__class__.__name__ if source is not None else '',
                source_id=str(source.pk) if source is not None else '', reverses=reverses, is_closing=is_closing,
                total_debit=td, total_credit=tc, posted_by=user if getattr(user, 'pk', None) else None,
                reference=reference or next_reference(company, 'JV', on_date))
    j.save()
    JournalLine.objects.bulk_create([JournalLine(
        journal=j, account=a, debit=d, credit=c, currency_id=ln.get('currency'),
        foreign_amount=ln.get('foreign_amount', D0), exchange_rate=ln.get('exchange_rate'),
        shipment=ln.get('shipment'), party_type=ln.get('party_type', ''), party_id=ln.get('party_id'),
        narration=(ln.get('narration') or '')[:255]) for a, d, c, ln in prepared])
    audit(user, 'POST_JOURNAL', j, {'debit': td, 'source': j.source_type})
    return j


@transaction.atomic
def reverse_journal(journal, user, reason='', on_date=None):
    if journal.status == 'REVERSED':
        err('Journal is already reversed.')
    lines = [{'account': l.account, 'debit': l.credit, 'credit': l.debit, 'shipment': l.shipment,
              'party_type': l.party_type, 'party_id': l.party_id, 'narration': f'Reversal: {l.narration}'}
             for l in journal.lines.select_related('account')]
    rev = post_journal(journal.company, on_date or journal.date, f'Reversal of {journal.reference}. {reason}',
                       lines, user=user, reverses=journal)
    Journal.objects.filter(pk=journal.pk).unsafe_update(status='REVERSED')
    audit(user, 'REVERSE_JOURNAL', journal, {'reversal': rev.reference, 'reason': reason})
    return rev


def post_manual_journal(company, on_date, description, raw_lines, user):
    lines = []
    for r in raw_lines:
        a = Account.objects.filter(company=company, pk=r['account']).first()
        if not a:
            err('Unknown account in journal line.')
        lines.append({'account': a, 'debit': r.get('debit', 0), 'credit': r.get('credit', 0),
                      'narration': r.get('narration', '')})
        if r.get('shipment'):
            lines[-1]['shipment'] = Shipment.objects.filter(pk=r['shipment'], company=company).first()
    return post_journal(company, on_date, description, lines, user=user)


# ---- accounting periods ----------------------------------------------------
@transaction.atomic
def create_fiscal_year(company, name, start, end, user=None):
    start, end = as_date(start), as_date(end)
    fy = FiscalYear.objects.create(company=company, name=name, start_date=start, end_date=end, created_by=user)
    cur = start
    while cur <= end:
        nxt = (cur.replace(day=28) + timedelta(days=4)).replace(day=1)
        AccountingPeriod.objects.create(company=company, fiscal_year=fy, name=cur.strftime('%b %Y'),
                                        start_date=cur, end_date=min(nxt - timedelta(days=1), end), created_by=user)
        cur = nxt
    return fy


@transaction.atomic
def close_period(period, user):
    if period.status == 'CLOSED':
        err('Period already closed.')
    audit(user, 'CLOSE_PERIOD', period)
    period.status, period.closed_by, period.closed_at = 'CLOSED', user, timezone.now()
    period.save()
    return period


@transaction.atomic
def reopen_period(period, user):
    if period.fiscal_year.status == 'CLOSED':
        err('Fiscal year is closed; periods cannot be reopened.')
    period.status, period.closed_by, period.closed_at = 'OPEN', None, None
    period.save()
    audit(user, 'REOPEN_PERIOD', period)
    return period


@transaction.atomic
def close_fiscal_year(fy, user):
    """Year-end closing: transfer P&L to retained earnings, close all periods and the year."""
    if fy.status == 'CLOSED':
        err('Fiscal year already closed.')
    co = fy.company
    bals = _account_balances([co.id], fy.start_date, fy.end_date, types=('REVENUE', 'EXPENSE'), exclude_closing=True)
    lines, net = [], D0
    for a, (d, c) in bals.items():
        bal = d - c
        if bal == 0:
            continue
        lines.append({'account': a, 'debit': -bal if bal < 0 else 0, 'credit': bal if bal > 0 else 0,
                      'narration': 'Year-end closing'})
        net += -bal                                        # profit if credits > debits
    if lines:
        re = acct(co, 'RETAINED_EARNINGS')
        lines.append({'account': re, 'debit': -net if net < 0 else 0, 'credit': net if net > 0 else 0,
                      'narration': f'Profit/(loss) for {fy.name}'})
        post_journal(co, fy.end_date, f'Year-end closing {fy.name}', lines, user=user, is_closing=True)
    AccountingPeriod.objects.filter(fiscal_year=fy).update(status='CLOSED', closed_by=user, closed_at=timezone.now())
    fy.status = 'CLOSED'
    fy.save()
    audit(user, 'CLOSE_FISCAL_YEAR', fy, {'net_profit': net})
    return fy


# =========================================================== approvals
# (from_status, pending_status, approved_status, rejected_status)
APPROVAL_FLOW = {
    'PurchaseRequisition': ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'),
    'PurchaseOrder': ('DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'DRAFT'),
    'SalesOrder': ('DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'DRAFT'),
    'Expense': ('DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'REJECTED'),
    'Payment': ('DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'REJECTED'),
    'TransportBooking': ('DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'DRAFT'),
    'Shipment': ('DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'DRAFT'),
    'StockAdjustment': ('PENDING', 'PENDING', 'APPROVED', 'REJECTED'),
    'ShipmentDelivery': ('PENDING_APPROVAL', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED'),
}


def _amount_of(obj):
    for a in ('total', 'amount', 'total_charge', 'value'):
        v = getattr(obj, a, None)
        if isinstance(v, Decimal):
            return abs(v)
    return D0


@transaction.atomic
def request_approval(obj, user, summary=''):
    name = obj.__class__.__name__
    frm, pending, _, _ = APPROVAL_FLOW[name]
    if obj.status != frm:
        err(f'{name} must be {frm} to be submitted (currently {obj.status}).')
    ct = ContentType.objects.get_for_model(obj)
    if ApprovalRequest.objects.filter(content_type=ct, object_id=obj.pk, status='PENDING').exists():
        err('An approval request is already pending.')
    if obj.status != pending:
        obj.status = pending
        obj.save(update_fields=['status'])
    req = ApprovalRequest.objects.create(company=obj.company, doc_type=name, content_type=ct, object_id=obj.pk,
                                         summary=(summary or str(obj))[:200], amount=_amount_of(obj), created_by=user)
    ApprovalAction.objects.create(request=req, actor=user, action='SUBMITTED')
    notify_roles(obj.company, APPROVER_ROLES, f'Approval needed: {name} {obj}', summary, link='/approvals')
    audit(user, 'SUBMIT_APPROVAL', obj, {'amount': req.amount})
    return req


def required_role(company, doc_type, amount):
    p = ApprovalPolicy.objects.filter(company=company, doc_type=doc_type, min_amount__lte=amount) \
        .order_by('-min_amount').select_related('approver_role').first()
    return p.approver_role if p else None


@transaction.atomic
def decide_approval(req, user, approve, comment=''):
    if req.status != 'PENDING':
        err('Request already decided.')
    if req.created_by_id == user.id:
        err('Segregation of duties: you cannot approve your own request.')
    if req.company_id not in user.allowed_company_ids():
        err('You are not authorised for this legal entity.')
    role = required_role(req.company, req.doc_type, req.amount)
    if role and not user.is_group_admin and user.role_id != role.id:
        err(f'This amount requires approval by role: {role.name}.')
    obj = req.target
    _, _, ok_status, no_status = APPROVAL_FLOW[req.doc_type]
    if obj.status != APPROVAL_FLOW[req.doc_type][1]:
        err('Target record is no longer awaiting approval.')
    obj.status = ok_status if approve else no_status
    obj.save(update_fields=['status'])
    req.status, req.decided_by, req.decided_at = ('APPROVED' if approve else 'REJECTED'), user, timezone.now()
    req.save()
    ApprovalAction.objects.create(request=req, actor=user, action=req.status, comment=comment)
    if approve and req.doc_type in APPROVAL_HOOKS:
        APPROVAL_HOOKS[req.doc_type](obj, user)
    notify_user(req.created_by, req.company, f'{req.doc_type} {obj} {req.status.lower()}', comment)
    audit(user, f'APPROVAL_{req.status}', obj, {'comment': comment})
    return req


def has_pending_policy(company, doc_type, amount):
    return ApprovalPolicy.objects.filter(company=company, doc_type=doc_type, min_amount__lte=amount).exists()


# =========================================================== inventory engine
IN_TYPES = {'OPENING', 'RECEIPT', 'TRANSFER_IN', 'RETURN_IN', 'ADJ_IN'}
OUT_TYPES = {'ISSUE', 'TRANSFER_OUT', 'RETURN_OUT', 'ADJ_OUT'}


def valuation_method(company, product):
    return company.inventory_valuation if product.valuation_method == 'DEFAULT' else product.valuation_method


@transaction.atomic
def move_stock(*, company, tank, product, movement_type, quantity, on_date, unit_cost=None, source=None,
               user=None, shipment=None, narration='', observed_volume=None, temperature_c=None, density=None,
               standardized_volume=None):
    """Single entry point for every stock change. Keeps balance, FIFO layers and movement history in step."""
    qty = q3(quantity)
    if qty <= 0:
        err('Stock quantity must be positive.')
    if tank.company_id != company.id:
        err('Tank belongs to another legal entity.')
    if tank.product_id and tank.product_id != product.id:
        err(f'Tank {tank.code} is assigned to a different product.')
    bal, _ = StockBalance.objects.select_for_update().get_or_create(company=company, tank=tank, product=product)
    if movement_type in IN_TYPES:
        if unit_cost is None:
            err('Unit cost is required for stock receipts.')
        if tank.capacity and bal.quantity + qty > tank.capacity:
            err(f'Receipt exceeds capacity of tank {tank.code} (free space {tank.capacity - bal.quantity} L).')
        cost = q2(qty * dec(unit_cost))
        bal.quantity += qty
        bal.value += cost
        StockLayer.objects.create(company=company, tank=tank, product=product, received_date=as_date(on_date),
                                  remaining_qty=qty, unit_cost=q6(dec(unit_cost)))
        if not tank.product_id:
            tank.product = product
            tank.save(update_fields=['product'])
    else:
        if bal.quantity < qty:
            err(f'Insufficient stock in tank {tank.code}: {bal.quantity} L available, {qty} L requested.')
        avg = bal.value / bal.quantity
        need, fifo = qty, D0
        for layer in StockLayer.objects.select_for_update().filter(
                tank=tank, product=product, remaining_qty__gt=0).order_by('received_date', 'id'):
            take = min(layer.remaining_qty, need)
            fifo += take * layer.unit_cost
            layer.remaining_qty -= take
            layer.save(update_fields=['remaining_qty'])
            need -= take
            if need <= 0:
                break
        fifo += need * avg                                  # opening balances without layers
        if qty == bal.quantity:
            cost = bal.value
        elif valuation_method(company, product) == 'FIFO':
            cost = q2(fifo)
        else:
            cost = q2(qty * avg)
        bal.quantity -= qty
        bal.value -= cost
        if bal.quantity == 0:
            bal.value = D0
    bal.save()
    return StockMovement.objects.create(
        company=company, reference=next_reference(company, 'MV', on_date), movement_type=movement_type,
        movement_date=as_date(on_date), tank=tank, product=product, quantity=qty,
        unit_cost=q6(cost / qty), total_cost=cost, balance_after=bal.quantity, shipment=shipment,
        source_type=source.__class__.__name__ if source is not None else '',
        source_id=str(source.pk) if source is not None else '', narration=narration[:255],
        observed_volume=observed_volume, temperature_c=temperature_c, density=density,
        standardized_volume=standardized_volume, created_by=user if getattr(user, 'pk', None) else None)


def standardize_volume(product, observed, temperature_c):
    """
    Optional, explicit conversion using a CONFIGURED expansion coefficient (linear approximation).
    Returns None when the product has no configured coefficient: observed and standardised volumes
    are never assumed to be equal. Replace with ASTM/API tables where required.
    """
    if product.expansion_coefficient is None or temperature_c is None:
        return None
    vcf = 1 - product.expansion_coefficient * (dec(temperature_c) - product.reference_temp_c)
    return q3(dec(observed) * vcf)


def post_opening_stock(tank, product, qty, unit_cost, on_date, user):
    with transaction.atomic():
        co = tank.company
        mv = move_stock(company=co, tank=tank, product=product, movement_type='OPENING', quantity=qty,
                        on_date=on_date, unit_cost=unit_cost, user=user, narration='Opening stock')
        post_journal(co, on_date, f'Opening stock {tank.code}',
                     [{'account': acct(co, 'INVENTORY'), 'debit': mv.total_cost},
                      {'account': acct(co, 'OPENING_EQUITY'), 'credit': mv.total_cost}], user=user)
        return mv


@transaction.atomic
def transfer_stock(company, from_tank, to_tank, qty, on_date, user, notes=''):
    if from_tank.id == to_tank.id:
        err('Source and destination tanks must differ.')
    product = from_tank.product
    if not product:
        err('Source tank has no product assigned.')
    out = move_stock(company=company, tank=from_tank, product=product, movement_type='TRANSFER_OUT', quantity=qty,
                     on_date=on_date, user=user, narration=notes)
    move_stock(company=company, tank=to_tank, product=product, movement_type='TRANSFER_IN', quantity=qty,
               on_date=on_date, unit_cost=out.unit_cost, user=user, narration=notes)
    t = StockTransfer.objects.create(company=company, from_tank=from_tank, to_tank=to_tank, quantity=qty,
                                     transfer_date=as_date(on_date), notes=notes, status='POSTED', created_by=user)
    audit(user, 'STOCK_TRANSFER', t, {'qty': qty})
    return t


def available_stock(company, depot, product):
    on_hand = StockBalance.objects.filter(company=company, tank__depot=depot, product=product) \
        .aggregate(s=Sum('quantity'))['s'] or D0
    reserved = StockReservation.objects.filter(company=company, depot=depot, product=product, status='ACTIVE') \
        .aggregate(s=Sum('quantity'))['s'] or D0
    return on_hand - reserved


@transaction.atomic
def reserve_stock(order, depot, user):
    if order.status not in ('APPROVED', 'IN_FULFILMENT'):
        err('Only approved sales orders can reserve stock.')
    out = []
    for ln in order.lines.all():
        already = StockReservation.objects.filter(sales_order=order, product=ln.product,
                                                  status__in=('ACTIVE', 'CONSUMED')).aggregate(s=Sum('quantity'))['s'] or D0
        need = ln.quantity - already
        if need <= 0:
            continue
        if available_stock(order.company, depot, ln.product) < need:
            err(f'Insufficient unreserved stock of {ln.product.name} at {depot.name}.')
        out.append(StockReservation.objects.create(company=order.company, depot=depot, product=ln.product,
                                                   quantity=need, sales_order=order, status='ACTIVE', created_by=user))
    audit(user, 'RESERVE_STOCK', order, {'lines': len(out)})
    return out


def tank_position(tank, product, on_date):
    mv = StockMovement.objects.filter(tank=tank, product=product)
    s = lambda qs, types: qs.filter(movement_type__in=types).aggregate(x=Sum('quantity'))['x'] or D0
    before = mv.filter(movement_date__lt=on_date)
    day = mv.filter(movement_date=on_date)
    return {
        'opening': s(before, IN_TYPES) - s(before, OUT_TYPES),
        'receipts': s(day, ['OPENING', 'RECEIPT', 'RETURN_IN']),
        'transfers_in': s(day, ['TRANSFER_IN']),
        'issues': s(day, ['ISSUE', 'RETURN_OUT']),
        'transfers_out': s(day, ['TRANSFER_OUT']),
        'adjustments': s(day, ['ADJ_IN']) - s(day, ['ADJ_OUT']),
    }


@transaction.atomic
def reconcile_tank(tank, on_date, physical_qty, user, product=None):
    """
    Closing book = Opening + Receipts + Transfers in - Issues - Transfers out
    (approved adjustments already posted that day are shown separately and included).
    The physical variance is only RECORDED here; it needs an approved StockAdjustment to hit stock/GL.
    """
    product = product or tank.product
    if not product:
        err('Tank has no product assigned.')
    on_date = as_date(on_date)
    p = tank_position(tank, product, on_date)
    book = p['opening'] + p['receipts'] + p['transfers_in'] - p['issues'] - p['transfers_out'] + p['adjustments']
    physical = q3(physical_qty)
    var = physical - book
    bal = StockBalance.objects.filter(tank=tank, product=product).first()
    avg = bal.avg_cost if bal else D0
    rec, _ = TankReconciliation.objects.update_or_create(
        company=tank.company, tank=tank, recon_date=on_date,
        defaults=dict(product=product, opening_qty=p['opening'], receipts=p['receipts'],
                      transfers_in=p['transfers_in'], issues=p['issues'], transfers_out=p['transfers_out'],
                      adjustments=p['adjustments'], closing_book=book, physical_qty=physical, variance=var,
                      variance_value=q2(var * avg), officer=user, created_by=user,
                      status='NO_VARIANCE' if var == 0 else 'PENDING_ADJUSTMENT'))
    audit(user, 'TANK_RECONCILIATION', rec, {'variance': var})
    return rec


@transaction.atomic
def raise_adjustment(rec, user, reason=''):
    """Create a PENDING StockAdjustment for a reconciliation variance and route it for approval."""
    if rec.variance == 0:
        err('No variance to adjust.')
    if rec.adjustment_id:
        err('An adjustment already exists for this reconciliation.')
    bal = StockBalance.objects.filter(tank=rec.tank, product=rec.product).first()
    unit = bal.avg_cost if bal and bal.quantity else D0
    adj = StockAdjustment.objects.create(company=rec.company, tank=rec.tank, product=rec.product,
                                         adjustment_date=rec.recon_date, quantity=rec.variance, unit_cost=unit,
                                         value=q2(rec.variance * unit), reason=reason or f'Reconciliation {rec.reference}',
                                         status='PENDING', created_by=user)
    rec.adjustment = adj
    rec.save(update_fields=['adjustment'])
    request_approval(adj, user, f'Stock adjustment {adj.quantity} L on {rec.tank.code}')
    return adj


def _approve_stock_adjustment(adj, user):
    co, qty = adj.company, adj.quantity
    unit = adj.unit_cost
    if qty > 0 and not unit:
        last = StockMovement.objects.filter(tank=adj.tank, product=adj.product, unit_cost__gt=0).order_by('-id').first()
        unit = last.unit_cost if last else err('Cannot value a stock gain without a unit cost.')
    mv = move_stock(company=co, tank=adj.tank, product=adj.product, movement_type='ADJ_IN' if qty > 0 else 'ADJ_OUT',
                    quantity=abs(qty), on_date=adj.adjustment_date, unit_cost=unit if qty > 0 else None,
                    source=adj, user=user, narration=adj.reason)
    inv, var = acct(co, 'INVENTORY'), acct(co, 'STOCK_VARIANCE')
    v = mv.total_cost
    post_journal(co, adj.adjustment_date, f'Stock adjustment {adj.reference}',
                 [{'account': inv, 'debit': v if qty > 0 else 0, 'credit': v if qty < 0 else 0},
                  {'account': var, 'debit': v if qty < 0 else 0, 'credit': v if qty > 0 else 0}],
                 source=adj, user=user)
    adj.value = v if qty > 0 else -v
    adj.save(update_fields=['value'])
    TankReconciliation.objects.filter(adjustment=adj).update(status='ADJUSTED')


# =========================================================== procurement
def _tolerance(company):
    return company.match_tolerance_pct / 100


@transaction.atomic
def receive_goods(po, line, tank, user, *, observed_volume, receipt_date=None, temperature_c=None, density=None,
                  standardized_volume=None, delivery_note='', vehicle_reg=''):
    """Goods receipt: stock-in to tank (Dr Inventory / Cr GRNI). Quantity basis is stored, never assumed."""
    if po.status not in ('APPROVED', 'PARTIALLY_RECEIVED'):
        err(f'PO {po.reference} is {po.status}; only approved orders can be received.')
    if line.order_id != po.id:
        err('PO line does not belong to this purchase order.')
    receipt_date = as_date(receipt_date)
    observed = q3(observed_volume)
    std = q3(standardized_volume) if standardized_volume not in (None, '') else None
    qty, basis = (std, 'STANDARDIZED') if std else (observed, 'OBSERVED')
    if line.received_quantity + qty > line.quantity * (1 + _tolerance(po.company)):
        err(f'Receipt would exceed ordered quantity ({line.quantity} L) beyond the tolerance.')
    unit_cost = q6(line.unit_price * po.exchange_rate)
    mv = move_stock(company=po.company, tank=tank, product=line.product, movement_type='RECEIPT', quantity=qty,
                    on_date=receipt_date, unit_cost=unit_cost, source=po, user=user, narration=f'GRN {po.reference}',
                    observed_volume=observed, temperature_c=temperature_c, density=density, standardized_volume=std)
    grn = GoodsReceipt.objects.create(
        company=po.company, purchase_order=po, line=line, depot=tank.depot, tank=tank, receipt_date=receipt_date,
        delivery_note=delivery_note, vehicle_reg=vehicle_reg, observed_volume=observed, temperature_c=temperature_c,
        density=density, standardized_volume=std, volume_basis=basis, quantity=qty, unit_cost=unit_cost,
        total_cost=mv.total_cost, status='POSTED', created_by=user)
    post_journal(po.company, receipt_date, f'Goods receipt {grn.reference} / {po.reference}',
                 [{'account': acct(po.company, 'INVENTORY'), 'debit': mv.total_cost},
                  {'account': acct(po.company, 'GRNI'), 'credit': mv.total_cost}], source=grn, user=user)
    line.received_quantity += qty
    line.save(update_fields=['received_quantity'])
    tol = _tolerance(po.company)
    done = all(l.received_quantity >= l.quantity * (1 - tol) for l in po.lines.all())
    po.status = 'RECEIVED' if done else 'PARTIALLY_RECEIVED'
    po.save(update_fields=['status'])
    audit(user, 'RECEIVE_GOODS', grn, {'qty': qty, 'basis': basis})
    return grn


def match_purchase_invoice(inv):
    """Three-way match: PO <-> supplier invoice <-> actual receipts."""
    tol, notes, status = _tolerance(inv.company), [], 'MATCHED'
    for ln in inv.lines.select_related('po_line'):
        pl = ln.po_line
        if not pl:
            notes.append('Invoice line has no PO line.')
            status = 'NO_RECEIPT'
            continue
        received = GoodsReceipt.objects.filter(line=pl, status='POSTED').aggregate(s=Sum('quantity'))['s'] or D0
        invoiced_before = PurchaseInvoiceLine.objects.filter(po_line=pl, invoice__status__in=(
            'POSTED', 'PART_PAID', 'PAID')).exclude(invoice=inv).aggregate(s=Sum('quantity'))['s'] or D0
        if received == 0:
            status = 'NO_RECEIPT'
            notes.append(f'{pl.product.name}: nothing received yet.')
        elif ln.quantity + invoiced_before > received * (1 + tol):
            status = status if status == 'NO_RECEIPT' else 'QTY_VARIANCE'
            notes.append(f'{pl.product.name}: invoiced {ln.quantity + invoiced_before} L > received {received} L.')
        if pl.unit_price and abs(ln.unit_price - pl.unit_price) / pl.unit_price > tol:
            status = status if status in ('NO_RECEIPT', 'QTY_VARIANCE') else 'PRICE_VARIANCE'
            notes.append(f'{pl.product.name}: invoice price {ln.unit_price} vs PO price {pl.unit_price}.')
    inv.match_status, inv.match_notes = status, '\n'.join(notes)
    inv.save(update_fields=['match_status', 'match_notes'])
    return status


@transaction.atomic
def post_purchase_invoice(inv, user, override=False):
    """Dr GRNI (+/- price variance) + Dr VAT input / Cr Accounts payable."""
    if inv.status != 'DRAFT':
        err('Only draft invoices can be posted.')
    co = inv.company
    inv.recalc()
    if not inv.lines.exists():
        err('Invoice has no lines.')
    status = match_purchase_invoice(inv)
    if status != 'MATCHED' and not override:
        err(f'Three-way match failed ({status}). {inv.match_notes} A user with override permission may post it.')
    rate = inv.exchange_rate
    grni_total = ppv = D0
    for ln in inv.lines.select_related('po_line__order'):
        pl = ln.po_line
        if not pl:
            err('Every invoice line must reference a PO line (three-way matching).')
        relief = q2(ln.quantity * pl.unit_price * pl.order.exchange_rate)
        net_f = q2(ln.line_total * rate)
        grni_total += relief
        ppv += net_f - relief
        SupplierPrice.objects.create(company=co, supplier=inv.supplier, product=ln.product, price=ln.unit_price,
                                     currency=inv.currency, effective_date=inv.invoice_date, source='INVOICE',
                                     created_by=user)
    vat = q2(inv.tax_total * rate)
    ap = grni_total + ppv + vat
    lines = [{'account': acct(co, 'GRNI'), 'debit': grni_total, 'narration': 'GRNI relief'},
             {'account': acct(co, 'PURCHASE_VARIANCE'), 'debit': ppv if ppv > 0 else 0, 'credit': -ppv if ppv < 0 else 0},
             {'account': acct(co, 'VAT_INPUT'), 'debit': vat},
             {'account': acct(co, 'AP'), 'credit': ap, 'party_type': 'SUPPLIER', 'party_id': inv.supplier_id,
              'currency': inv.currency_id, 'foreign_amount': inv.total, 'exchange_rate': rate}]
    j = post_journal(co, inv.invoice_date, f'Supplier invoice {inv.supplier_invoice_no} ({inv.supplier.name})',
                     lines, source=inv, user=user)
    inv.journal, inv.functional_total, inv.status = j, ap, 'POSTED'
    inv.due_date = inv.due_date or inv.invoice_date + timedelta(days=inv.supplier.payment_terms_days)
    inv.save(update_fields=['journal', 'functional_total', 'status', 'due_date'])
    if inv.purchase_order_id:
        PurchaseOrder.objects.filter(pk=inv.purchase_order_id, status='RECEIVED').update(status='INVOICED')
    audit(user, 'POST_PURCHASE_INVOICE', inv, {'match': status, 'override': override})
    return inv


@transaction.atomic
def post_purchase_return(grn, qty, on_date, reason, user):
    """Return stock to the supplier: Dr GRNI / Cr Inventory (supplier credit note then clears AP)."""
    qty = q3(qty)
    if qty <= 0 or qty > grn.quantity:
        err('Invalid return quantity.')
    co = grn.company
    mv = move_stock(company=co, tank=grn.tank, product=grn.line.product, movement_type='RETURN_OUT', quantity=qty,
                    on_date=on_date, source=grn, user=user, narration=reason)
    ret = PurchaseReturn.objects.create(company=co, goods_receipt=grn, quantity=qty, return_date=as_date(on_date),
                                        reason=reason, value=mv.total_cost, status='POSTED', created_by=user)
    post_journal(co, on_date, f'Purchase return {ret.reference}',
                 [{'account': acct(co, 'GRNI'), 'debit': mv.total_cost},
                  {'account': acct(co, 'INVENTORY'), 'credit': mv.total_cost}], source=ret, user=user)
    grn.line.received_quantity -= qty
    grn.line.save(update_fields=['received_quantity'])
    return ret


@transaction.atomic
def post_supplier_credit_note(cn, user):
    if cn.status != 'DRAFT':
        err('Credit note already posted.')
    co, r = cn.company, cn.exchange_rate
    net, vat = q2(cn.amount * r), q2(cn.tax_amount * r)
    j = post_journal(co, cn.note_date, f'Supplier credit note {cn.reference}',
                     [{'account': acct(co, 'AP'), 'debit': net + vat, 'party_type': 'SUPPLIER', 'party_id': cn.supplier_id},
                      {'account': acct(co, 'GRNI'), 'credit': net},
                      {'account': acct(co, 'VAT_INPUT'), 'credit': vat}], source=cn, user=user)
    cn.journal, cn.status = j, 'POSTED'
    cn.save(update_fields=['journal', 'status'])
    if cn.invoice_id:
        PurchaseInvoice.objects.filter(pk=cn.invoice_id).update(amount_credited=F('amount_credited') + cn.amount + cn.tax_amount)
    return cn


# =========================================================== pricing & sales
def calc_price(method, *, cost=None, contract_price=None, base_price=None, premium=0, profit_per_litre=None,
               markup_pct=None, margin_pct=None):
    """
    FIXED      : contract price
    MARKET     : base market price + premium (negative = discount)
    COST_PLUS  : exactly one of
                   profit_per_litre -> price = cost + profit
                   markup_pct       -> price = cost x (1 + markup%)          (markup is on COST)
                   margin_pct       -> price = cost / (1 - margin%)          (margin is on SALES PRICE)
    Percentages are given as e.g. 15 for 15%. Markup and margin are returned separately.
    """
    cost = dec(cost) if cost not in (None, '') else None
    if method == 'FIXED':
        if contract_price in (None, ''):
            err('Fixed pricing needs a contract price.')
        price = dec(contract_price)
    elif method == 'MARKET':
        if base_price in (None, ''):
            err('Market pricing needs a base market price.')
        price = dec(base_price) + dec(premium)
    elif method == 'COST_PLUS':
        if cost is None:
            err('Cost-plus pricing needs an approved cost per litre.')
        given = [x for x in (profit_per_litre, markup_pct, margin_pct) if x not in (None, '')]
        if len(given) != 1:
            err('Provide exactly one of profit per litre, markup % or target margin %.')
        if profit_per_litre not in (None, ''):
            price = cost + dec(profit_per_litre)
        elif markup_pct not in (None, ''):
            price = cost * (1 + dec(markup_pct) / 100)
        else:
            if not (0 <= dec(margin_pct) < 100):
                err('Target margin must be between 0 and 100% (exclusive).')
            price = cost / (1 - dec(margin_pct) / 100)
    else:
        err('Unknown pricing method.')
    out = {'method': method, 'selling_price': q6(price), 'cost_per_litre': q6(cost) if cost is not None else None}
    if cost is not None and price:
        out.update(profit_per_litre=q6(price - cost),
                   markup_pct=q3((price - cost) / cost * 100) if cost else None,
                   margin_pct=q3((price - cost) / price * 100))
    return out


def estimate_cost_per_litre(company, product):
    agg = StockBalance.objects.filter(company=company, product=product, quantity__gt=0) \
        .aggregate(v=Sum('value'), q=Sum('quantity'))
    if agg['q']:
        return q6(agg['v'] / agg['q'])
    last = ShipmentCostSheet.objects.filter(company=company, shipment__product=product,
                                            delivered_cost_per_litre__gt=0).order_by('-id').first()
    return last.delivered_cost_per_litre if last else None


def check_min_margin(company, product, margin_pct, user):
    floor = product.min_margin_pct if product.min_margin_pct is not None else company.min_margin_pct
    if margin_pct is not None and margin_pct < floor and not has_role(user, BELOW_MARGIN_ROLES):
        err(f'Margin {margin_pct}% is below the minimum approved margin {floor}% for {product.name}. '
            f'Only these roles may go below it: {", ".join(BELOW_MARGIN_ROLES)}.')


def apply_line_pricing(company, line, contract, order_date, user):
    """Fill unit_price / margin on a SalesOrderLine (dict) from its pricing method and enforce minimum margin."""
    method = line.get('pricing_method', 'FIXED')
    product = line['product']
    cost = line.get('cost_per_litre') or estimate_cost_per_litre(company, product)
    base = line.get('base_price')
    if method == 'MARKET' and not base:
        mp = MarketPrice.objects.filter(company=company, product=product, reference_date__lte=order_date) \
            .order_by('-reference_date').first()
        base = mp.base_price if mp else None
    res = calc_price(method, cost=cost, contract_price=line.get('unit_price') or (contract.price_per_litre if contract else None),
                     base_price=base, premium=line.get('premium', 0), profit_per_litre=line.get('profit_per_litre'),
                     markup_pct=line.get('markup_pct'), margin_pct=line.get('target_margin_pct'))
    line['unit_price'] = res['selling_price']
    line['cost_per_litre'] = res.get('cost_per_litre') or D0
    line['margin_pct'] = res.get('margin_pct') or D0
    if res.get('margin_pct') is not None:
        check_min_margin(company, product, res['margin_pct'], user)
    return line


def customer_exposure(customer):
    """Open receivable in the entity functional currency."""
    rows = SalesInvoice.objects.filter(customer=customer, status__in=('POSTED', 'PART_PAID'))
    return sum((q2((i.total - i.amount_paid - i.amount_credited) * i.exchange_rate) for i in rows), D0)


@transaction.atomic
def post_sales_invoice(inv, user, override_credit=False):
    """Dr Accounts receivable / Cr Sales revenue + Cr VAT output. Credit limit enforced server-side."""
    if inv.status != 'DRAFT':
        err('Only draft invoices can be posted.')
    co, cust, r = inv.company, inv.customer, inv.exchange_rate
    inv.recalc()
    if not inv.lines.exists():
        err('Invoice has no lines.')
    if cust.status in ('BLOCKED', 'INACTIVE'):
        err(f'Customer {cust.name} is {cust.status}.')
    rev_acct, rev_lines, rev = acct(co, 'SALES_REVENUE'), [], D0
    for ln in inv.lines.select_related('shipment'):
        amt = q2(ln.line_total * r)
        rev += amt
        rev_lines.append({'account': rev_acct, 'credit': amt, 'shipment': ln.shipment, 'narration': ln.product.name})
    vat = q2(inv.tax_total * r)
    ar = rev + vat
    if cust.credit_limit and customer_exposure(cust) + ar > cust.credit_limit and not override_credit:
        err(f'Credit limit exceeded for {cust.name}: exposure {customer_exposure(cust) + ar} > limit {cust.credit_limit}.')
    # partial invoicing guard: cannot invoice more litres than delivered for a shipment
    for ln in inv.lines.filter(shipment__isnull=False):
        delivered = ShipmentDelivery.objects.filter(shipment=ln.shipment, status='APPROVED') \
            .aggregate(s=Sum('delivered_quantity'))['s'] or D0
        invoiced = SalesInvoiceLine.objects.filter(shipment=ln.shipment, invoice__status__in=('POSTED', 'PART_PAID', 'PAID')) \
            .exclude(invoice=inv).aggregate(s=Sum('quantity'))['s'] or D0
        if ln.quantity + invoiced > delivered:
            err(f'Cannot invoice {ln.quantity} L: only {delivered - invoiced} L delivered and not yet invoiced on {ln.shipment.reference}.')
    lines = [{'account': acct(co, 'AR'), 'debit': ar, 'party_type': 'CUSTOMER', 'party_id': cust.id,
              'currency': inv.currency_id, 'foreign_amount': inv.total, 'exchange_rate': r},
             {'account': acct(co, 'VAT_OUTPUT'), 'credit': vat}] + rev_lines
    j = post_journal(co, inv.invoice_date, f'Sales invoice {inv.reference} ({cust.name})', lines, source=inv, user=user)
    inv.journal, inv.functional_total, inv.status = j, ar, 'POSTED'
    inv.due_date = inv.due_date or inv.invoice_date + timedelta(days=cust.credit_period_days)
    inv.save(update_fields=['journal', 'functional_total', 'status', 'due_date'])
    for ln in inv.lines.filter(order_line__isnull=False):
        SalesOrderLine.objects.filter(pk=ln.order_line_id).update(invoiced_quantity=F('invoiced_quantity') + ln.quantity)
    audit(user, 'POST_SALES_INVOICE', inv, {'total': inv.total})
    return inv


@transaction.atomic
def post_sales_credit_note(cn, user):
    if cn.status != 'DRAFT':
        err('Credit note already posted.')
    co, r = cn.company, cn.exchange_rate
    cn.subtotal = q2(cn.quantity * cn.unit_price)
    cn.tax_total = q2(cn.subtotal * cn.tax_rate / 100)
    cn.total = cn.subtotal + cn.tax_total
    inv = cn.invoice
    if cn.total > inv.total - inv.amount_credited:
        err('Credit note exceeds the invoice balance available for crediting.')
    rev, vat = q2(cn.subtotal * r), q2(cn.tax_total * r)
    lines = [{'account': acct(co, 'SALES_RETURNS'), 'debit': rev},
             {'account': acct(co, 'VAT_OUTPUT'), 'debit': vat},
             {'account': acct(co, 'AR'), 'credit': rev + vat, 'party_type': 'CUSTOMER', 'party_id': inv.customer_id}]
    if cn.restock_tank_id and cn.shipment_id and cn.product_id:       # returned fuel back into stock at cost
        sheet = ShipmentCostSheet.objects.filter(shipment=cn.shipment).order_by('-version').first()
        cpl = sheet.delivered_cost_per_litre if sheet else D0
        if cpl:
            mv = move_stock(company=co, tank=cn.restock_tank, product=cn.product, movement_type='RETURN_IN',
                            quantity=cn.quantity, on_date=cn.note_date, unit_cost=cpl, source=cn, user=user)
            lines += [{'account': acct(co, 'INVENTORY'), 'debit': mv.total_cost},
                      {'account': acct(co, 'COGS'), 'credit': mv.total_cost, 'shipment': cn.shipment}]
    j = post_journal(co, cn.note_date, f'Sales credit note {cn.reference}', lines, source=cn, user=user)
    cn.journal, cn.status = j, 'POSTED'
    cn.save()
    SalesInvoice.objects.filter(pk=inv.pk).update(amount_credited=F('amount_credited') + cn.total)
    _refresh_invoice_status(SalesInvoice.objects.get(pk=inv.pk))
    return cn


def _refresh_invoice_status(doc):
    out = doc.total - doc.amount_paid - doc.amount_credited
    doc.status = 'PAID' if out <= 0 else ('PART_PAID' if doc.amount_paid > 0 else 'POSTED')
    doc.save(update_fields=['status'])


# =========================================================== payments, bank, M-Pesa
PARTY_RULES = {  # party -> (control key, advance key, direction)
    'CUSTOMER': ('AR', 'CUSTOMER_ADVANCES', 'RECEIPT'),
    'SUPPLIER': ('AP', 'SUPPLIER_ADVANCES', 'PAYMENT'),
    'TRANSPORTER': ('AP', 'SUPPLIER_ADVANCES', 'PAYMENT'),
}


def _alloc_target(a):
    for f in ('sales_invoice', 'purchase_invoice', 'transporter_invoice', 'expense'):
        if a.get(f):
            return f, a[f]
    err('Allocation needs an invoice.')


def _load_target(company, field, ref):
    Model = {'sales_invoice': SalesInvoice, 'purchase_invoice': PurchaseInvoice,
             'transporter_invoice': TransporterInvoice, 'expense': Expense}[field]
    obj = ref if isinstance(ref, Model) else Model.objects.select_for_update().filter(pk=ref, company=company).first()
    if not obj:
        err('Allocation target not found in this legal entity.')
    return obj


def request_payment_approval(payment, user):
    if payment.direction == 'RECEIPT':
        err('Receipts do not need approval; post them directly.')
    return request_approval(payment, user, f'Payment {payment.amount} {payment.currency_id} to {payment.payee or payment.party_type}')


@transaction.atomic
def post_payment(payment, user, allocations=None):
    """
    Execute a payment/receipt.
      RECEIPT : Dr Bank/Cash/M-Pesa / Cr AR (invoice rates) [+ Cr customer advances] [+/- realized FX]
      PAYMENT : Dr AP (invoice rates) [+ Dr supplier advances] / Cr Bank [+/- realized FX]
    Payments must be APPROVED by someone other than the creator AND executed by someone other than the approver.
    """
    p, co = payment, payment.company
    if p.status == 'POSTED':
        err('Payment already posted.')
    if p.direction == 'PAYMENT':
        if p.status != 'APPROVED':
            err('Payments must be approved before execution.')
        if p.approved_by_id == user.id:
            err('Segregation of duties: the approver cannot execute the payment.')
    elif p.status not in ('DRAFT', 'APPROVED'):
        err(f'Receipt is {p.status}.')
    if p.amount <= 0:
        err('Amount must be positive.')
    if p.bank_account.currency_id != p.currency_id:
        err('Payment currency must equal the bank/cash account currency.')
    p.save()                                              # fills FX if missing
    rate, bank_f = p.exchange_rate, q2(p.amount * p.exchange_rate)
    allocations = allocations or []
    rows, total_alloc = [], D0
    for a in allocations:
        field, ref = _alloc_target(a)
        doc = _load_target(co, field, ref)
        amt = dec(a['amount'])
        if doc.status not in ('POSTED', 'PART_PAID'):
            err(f'{doc} is not open for payment.')
        if doc.currency_id != p.currency_id:
            err(f'Invoice {doc} is in {doc.currency_id}; payment is in {p.currency_id}. Settle in the invoice currency.')
        if amt <= 0 or amt > doc.outstanding:
            err(f'Allocation {amt} exceeds outstanding {doc.outstanding} on {doc}.')
        if p.direction == 'RECEIPT' and field != 'sales_invoice':
            err('Receipts can only be allocated to sales invoices.')
        if p.direction == 'PAYMENT' and field == 'sales_invoice':
            err('Payments cannot be allocated to sales invoices.')
        if field == 'expense' and TransporterInvoice.objects.filter(expense=doc).exists():
            err('This expense is carried by a transporter invoice; allocate the payment to that invoice instead.')
        rows.append((field, doc, amt))
        total_alloc += amt
    if total_alloc > p.amount:
        err('Allocated amount exceeds the payment amount.')
    rem = p.amount - total_alloc
    bank_gl, lines, other, party = p.bank_account.gl_account, [], D0, p.customer_id or p.supplier_id or p.transporter_id
    if p.purpose in ('BANK_CHARGE', 'OTHER'):
        if not p.counter_account_id:
            err('Counter account is required for bank charges / other payments.')
        lines = [{'account': p.counter_account, 'debit': bank_f if p.direction == 'PAYMENT' else 0,
                  'credit': bank_f if p.direction == 'RECEIPT' else 0},
                 {'account': bank_gl, 'debit': bank_f if p.direction == 'RECEIPT' else 0,
                  'credit': bank_f if p.direction == 'PAYMENT' else 0}]
        rows, rem = [], D0
    else:
        control_key, adv_key, direction = PARTY_RULES[p.party_type]
        if direction != p.direction:
            err(f'A {p.party_type.lower()} {p.direction.lower()} is not valid for this party type.')
        sub = []
        for field, doc, amt in rows:
            sub.append({'account': acct(co, control_key), 'amount': q2(amt * doc.exchange_rate),
                        'party_type': p.party_type, 'party_id': party})
        if rem > 0:
            sub.append({'account': acct(co, adv_key), 'amount': q2(rem * rate), 'party_type': p.party_type, 'party_id': party})
        base = sum((s['amount'] for s in sub), D0)
        fx = bank_f - base                         # +ve: we received more / paid more than carrying value
        if p.direction == 'RECEIPT':
            lines.append({'account': bank_gl, 'debit': bank_f})
            lines += [{'account': s['account'], 'credit': s['amount'], 'party_type': s['party_type'], 'party_id': s['party_id']} for s in sub]
            if fx > 0:
                lines.append({'account': acct(co, 'FX_GAIN'), 'credit': fx})
            elif fx < 0:
                lines.append({'account': acct(co, 'FX_LOSS'), 'debit': -fx})
        else:
            lines.append({'account': bank_gl, 'credit': bank_f})
            lines += [{'account': s['account'], 'debit': s['amount'], 'party_type': s['party_type'], 'party_id': s['party_id']} for s in sub]
            if fx > 0:
                lines.append({'account': acct(co, 'FX_LOSS'), 'debit': fx})
            elif fx < 0:
                lines.append({'account': acct(co, 'FX_GAIN'), 'credit': -fx})
    j = post_journal(co, p.payment_date, f'{p.direction.title()} {p.reference} {p.narration}', lines, source=p, user=user)
    for field, doc, amt in rows:
        share = q2(amt * rate) - q2(amt * doc.exchange_rate)
        gl = share if p.direction == 'RECEIPT' else -share
        PaymentAllocation.objects.create(payment=p, amount=amt, fx_gain_loss=gl, **{field: doc})
        doc.amount_paid += amt
        doc.save(update_fields=['amount_paid'])
        _refresh_invoice_status(doc) if field != 'expense' else _refresh_expense(doc)
        if field == 'transporter_invoice' and doc.outstanding <= 0:
            TransportBooking.objects.filter(pk=doc.booking_id).update(status='SETTLED')
    p.allocated_amount, p.journal, p.executed_by, p.status = total_alloc, j, user, 'POSTED'
    p.save()
    if p.purpose == 'ADVANCE' and p.booking_id:
        TransportBooking.objects.filter(pk=p.booking_id).update(advance_paid=F('advance_paid') + p.amount)
    audit(user, 'POST_PAYMENT', p, {'amount': p.amount, 'allocated': total_alloc})
    return p


def _refresh_expense(e):
    e.status = 'PAID' if e.outstanding <= 0 else 'POSTED'
    e.save(update_fields=['status'])


@transaction.atomic
def approve_payment(payment, user):
    if payment.status != 'AWAITING_APPROVAL':
        err('Payment is not awaiting approval.')
    if payment.created_by_id == user.id:
        err('Segregation of duties: you cannot approve a payment you created.')
    payment.status, payment.approved_by, payment.approved_at = 'APPROVED', user, timezone.now()
    payment.save()
    audit(user, 'APPROVE_PAYMENT', payment)
    return payment


@transaction.atomic
def apply_advance(payment, allocations, user):
    """Apply an unallocated advance (customer/supplier/transporter) to invoices: Dr advances / Cr control account."""
    p, co = payment, payment.company
    if p.status != 'POSTED' or p.unallocated_amount <= 0:
        err('Payment has no unallocated balance.')
    control_key, adv_key, _ = PARTY_RULES[p.party_type]
    total, lines = D0, []
    for a in allocations:
        field, ref = _alloc_target(a)
        doc, amt = _load_target(co, field, ref), dec(a['amount'])
        if amt <= 0 or amt > doc.outstanding or doc.currency_id != p.currency_id:
            err(f'Invalid allocation to {doc}.')
        total += amt
        PaymentAllocation.objects.create(payment=p, amount=amt, **{field: doc})
        doc.amount_paid += amt
        doc.save(update_fields=['amount_paid'])
        _refresh_invoice_status(doc) if field != 'expense' else _refresh_expense(doc)
        lines.append((field, doc, q2(amt * doc.exchange_rate)))
    if total > p.unallocated_amount:
        err('Allocation exceeds the unallocated advance.')
    adv_amt = q2(total * p.exchange_rate)
    inv_amt = sum((x[2] for x in lines), D0)
    out = [{'account': acct(co, control_key), 'debit' if p.direction == 'PAYMENT' else 'credit': inv_amt},
           {'account': acct(co, adv_key), 'credit' if p.direction == 'PAYMENT' else 'debit': adv_amt}]
    diff = adv_amt - inv_amt
    if diff:
        gain_loss = (diff > 0) == (p.direction == 'RECEIPT')
        out.append({'account': acct(co, 'FX_GAIN' if gain_loss else 'FX_LOSS'),
                    'credit' if gain_loss else 'debit': abs(diff)})
    # balance: (Dr side) must equal (Cr side)
    d = sum(q2(l.get('debit', 0)) for l in out)
    c = sum(q2(l.get('credit', 0)) for l in out)
    if d != c:
        err('Advance application did not balance.')
    post_journal(co, today(), f'Apply advance {p.reference}', out, source=p, user=user)
    p.allocated_amount += total
    p.save(update_fields=['allocated_amount'])
    return p


@transaction.atomic
def reverse_payment(payment, user, reason=''):
    if payment.status != 'POSTED':
        err('Only posted payments can be reversed.')
    reverse_journal(payment.journal, user, reason)
    for a in payment.allocations.all():
        for f in ('sales_invoice', 'purchase_invoice', 'transporter_invoice', 'expense'):
            doc = getattr(a, f)
            if doc:
                doc.amount_paid -= a.amount
                doc.save(update_fields=['amount_paid'])
                _refresh_invoice_status(doc) if f != 'expense' else _refresh_expense(doc)
    if payment.purpose == 'ADVANCE' and payment.booking_id:
        TransportBooking.objects.filter(pk=payment.booking_id).update(advance_paid=F('advance_paid') - payment.amount)
    payment.status = 'REVERSED'
    payment.save()
    audit(user, 'REVERSE_PAYMENT', payment, {'reason': reason})
    return payment


def suggest_invoice_matches(payment):
    """M-Pesa/bank receipt -> likely customer & invoices (never auto-posts; a human confirms)."""
    co, out = payment.company, []
    cust = payment.customer
    if not cust and payment.payer_phone:
        digits = ''.join(ch for ch in payment.payer_phone if ch.isdigit())[-9:]
        cust = next((c for c in Customer.objects.filter(company=co) if digits and digits in ''.join(ch for ch in c.phone if ch.isdigit())), None)
    if not cust:
        return {'customer': None, 'invoices': []}
    invs = SalesInvoice.objects.filter(customer=cust, status__in=('POSTED', 'PART_PAID'), currency=payment.currency).order_by('due_date')
    for i in invs:
        out.append({'invoice': i.id, 'reference': i.reference, 'outstanding': i.outstanding,
                    'exact_match': i.outstanding == payment.amount})
    out.sort(key=lambda r: not r['exact_match'])
    return {'customer': cust.id, 'customer_name': cust.name, 'invoices': out}


def import_bank_statement(bank_account, text, user, batch=None):
    """CSV columns: date, description, reference, money_in, money_out, balance (header row required)."""
    batch = batch or timezone.now().strftime('%Y%m%d%H%M%S')
    created = skipped = 0
    with transaction.atomic():
        for row in csv.DictReader(io.StringIO(text)):
            row = {k.strip().lower(): (v or '').strip() for k, v in row.items() if k}
            d, mi, mo = as_date(row['date']), dec(row.get('money_in')), dec(row.get('money_out'))
            if BankTransaction.objects.filter(bank_account=bank_account, txn_date=d, reference=row.get('reference', ''),
                                              money_in=mi, money_out=mo).exists():
                skipped += 1
                continue
            BankTransaction.objects.create(company=bank_account.company, bank_account=bank_account, txn_date=d,
                                           description=row.get('description', ''), reference=row.get('reference', ''),
                                           money_in=mi, money_out=mo, balance=dec(row['balance']) if row.get('balance') else None,
                                           batch=batch, created_by=user)
            created += 1
    return {'imported': created, 'duplicates_skipped': skipped, 'batch': batch}


@transaction.atomic
def match_bank_transaction(txn, payment, user):
    if txn.status == 'MATCHED':
        err('Transaction already matched.')
    if payment.status != 'POSTED' or payment.bank_account_id != txn.bank_account_id:
        err('Payment must be posted on the same bank account.')
    amt = txn.money_in if payment.direction == 'RECEIPT' else txn.money_out
    if amt != payment.amount:
        err(f'Amount mismatch: statement {amt} vs payment {payment.amount}.')
    txn.matched_payment, txn.status = payment, 'MATCHED'
    txn.save()
    return txn


def auto_match_bank(bank_account, user):
    """Match unmatched statement lines to posted payments by reference + amount (exact only)."""
    n = 0
    for t in BankTransaction.objects.filter(bank_account=bank_account, status='UNMATCHED'):
        direction, amt = ('RECEIPT', t.money_in) if t.money_in else ('PAYMENT', t.money_out)
        qs = Payment.objects.filter(bank_account=bank_account, status='POSTED', direction=direction, amount=amt)
        qs = qs.filter(Q(mpesa_reference=t.reference) | Q(bank_reference=t.reference) | Q(reference=t.reference)) if t.reference else qs
        qs = qs.exclude(pk__in=BankTransaction.objects.filter(status='MATCHED').values('matched_payment_id'))
        if qs.count() == 1:
            t.matched_payment, t.status = qs.first(), 'MATCHED'
            t.save()
            n += 1
    return n


def book_balance(bank_account, as_of):
    s = JournalLine.objects.filter(account=bank_account.gl_account, journal__date__lte=as_date(as_of)) \
        .aggregate(d=Sum('debit'), c=Sum('credit'))
    return (s['d'] or D0) - (s['c'] or D0)


@transaction.atomic
def create_bank_reconciliation(bank_account, statement_date, statement_balance, user, notes=''):
    book = book_balance(bank_account, statement_date)
    unmatched = BankTransaction.objects.filter(bank_account=bank_account, status='UNMATCHED', txn_date__lte=statement_date).count()
    diff = dec(statement_balance) - book
    r = BankReconciliation.objects.create(
        company=bank_account.company, bank_account=bank_account, statement_date=as_date(statement_date),
        statement_balance=dec(statement_balance), book_balance=book, difference=diff, unmatched_count=unmatched,
        notes=notes, status='RECONCILED' if diff == 0 and unmatched == 0 else 'OPEN', created_by=user)
    return r


# =========================================================== expenses & allocation
def expense_account(exp):
    if exp.account_id:
        return exp.account
    for key in (f'EXP_{exp.category.code}', f'EXP_{exp.category.group}'):
        m = AccountMapping.objects.filter(company=exp.company, key=key).select_related('account').first()
        if m:
            return m.account
    err(f'No accounting code for category {exp.category.code}. Map EXP_{exp.category.code} or EXP_{exp.category.group}.')


@transaction.atomic
def submit_document(obj, user, force_approval=False):
    """Route to approval when a policy applies (or when forced); otherwise auto-approve below thresholds."""
    name = obj.__class__.__name__
    if force_approval or has_pending_policy(obj.company, name, _amount_of(obj)):
        return request_approval(obj, user)
    frm, _, ok, _ = APPROVAL_FLOW[name]
    if obj.status != frm:
        err(f'{name} must be {frm} to submit.')
    obj.status = ok
    obj.save(update_fields=['status'])
    if name in APPROVAL_HOOKS:
        APPROVAL_HOOKS[name](obj, user)
    audit(user, 'AUTO_APPROVED', obj, {'reason': 'no approval policy for this amount'})
    return None


@transaction.atomic
def post_expense(exp, user, source_doc=None):
    """Dr Expense (+VAT input) / Cr AP (credit) or bank/cash/M-Pesa. Auto-allocates direct shipment costs once."""
    if exp.status != 'APPROVED':
        err('Expense must be approved before posting.')
    co, r = exp.company, exp.exchange_rate
    net, vat = q2(exp.amount * r), q2(exp.tax_amount * r)
    if exp.vehicle_id and exp.truck_ownership == 'NA':
        exp.truck_ownership = 'OWNED'
    if exp.transporter_id and exp.truck_ownership == 'NA':
        exp.truck_ownership = 'HIRED'
    party = exp.supplier_id or exp.transporter_id
    lines = [{'account': expense_account(exp), 'debit': net, 'shipment': exp.shipment, 'narration': exp.description,
              'currency': exp.currency_id, 'foreign_amount': exp.amount, 'exchange_rate': r},
             {'account': acct(co, 'VAT_INPUT'), 'debit': vat}]
    if exp.payment_method == 'CREDIT':
        lines.append({'account': acct(co, 'AP'), 'credit': net + vat, 'party_type': 'TRANSPORTER' if exp.transporter_id else 'SUPPLIER',
                      'party_id': party})
    else:
        if not exp.bank_account_id:
            err('Select the bank/cash/M-Pesa account used to pay this expense.')
        if exp.bank_account.currency_id != exp.currency_id:
            err('Expense currency must equal the paying account currency.')
        lines.append({'account': exp.bank_account.gl_account, 'credit': net + vat})
    j = post_journal(co, exp.expense_date, f'Expense {exp.reference}: {exp.description}', lines, source=source_doc or exp, user=user)
    exp.journal, exp.functional_total = j, net + vat
    exp.status = 'POSTED' if exp.payment_method == 'CREDIT' else 'PAID'
    if exp.payment_method != 'CREDIT':
        exp.amount_paid = exp.total
    exp.save()
    if exp.shipment_id and exp.category.cost_component != 'NONE':
        allocate_expense(exp, [{'shipment': exp.shipment}], 'DIRECT', user)
    audit(user, 'POST_EXPENSE', exp, {'total': exp.total})
    return exp


@transaction.atomic
def allocate_expense(exp, targets, method, user, replace=False):
    """Controlled allocation of one posted expense across shipments. Sum of allocations == expense net (no double counting)."""
    if exp.status not in ('POSTED', 'PAID'):
        err('Only posted expenses can be allocated to shipments.')
    if exp.category.cost_component == 'NONE':
        err(f'Category {exp.category.name} is not a shipment cost category.')
    base = q2(exp.amount * exp.exchange_rate)
    existing = ShipmentCostAllocation.objects.filter(expense=exp)
    if existing.exists():
        if not replace:
            err('Expense is already allocated. Use replace to re-allocate.')
        for a in existing:
            if ShipmentCostSheet.objects.filter(shipment=a.shipment, is_final=True).exists():
                err(f'Cost of {a.shipment.reference} is finalised; reopen it first.')
        existing.delete()
    ships = []
    for t in targets:
        sh = t['shipment'] if isinstance(t['shipment'], Shipment) else Shipment.objects.filter(pk=t['shipment']).first()
        if not sh or sh.status == 'CANCELLED':
            err('Invalid or cancelled shipment in allocation.')
        if ShipmentCostSheet.objects.filter(shipment=sh, is_final=True).exists():
            err(f'Cost of {sh.reference} is finalised; reopen it first.')
        ships.append((sh, t))
    if not ships:
        err('No allocation targets.')
    if method == 'DIRECT':
        weights = [Decimal(1)] + [D0] * (len(ships) - 1)
        if len(ships) != 1:
            err('DIRECT allocation takes exactly one shipment.')
    elif method == 'PERCENT':
        weights = [dec(t.get('percentage')) / 100 for _, t in ships]
        if abs(sum(weights) - 1) > Decimal('0.0001'):
            err('Percentages must total 100.')
    elif method == 'AMOUNT':
        amts = [dec(t.get('amount')) for _, t in ships]
        if sum(amts) != base:
            err(f'Amounts must total the expense net amount {base}.')
        weights = [a / base for a in amts]
    elif method == 'LITRES':
        lit = [(sh.loading_quantity or sh.quantity) for sh, _ in ships]
        if not sum(lit):
            err('Shipments have no litres to allocate by.')
        weights = [l / sum(lit) for l in lit]
    elif method == 'EQUAL':
        weights = [Decimal(1) / len(ships)] * len(ships)
    else:
        err('Unknown allocation method.')
    out, running = [], D0
    for i, ((sh, t), w) in enumerate(zip(ships, weights)):
        part = base - running if i == len(ships) - 1 else q2(base * w)
        running += part
        conv = convert(part, exp.company.functional_currency_id, sh.company.functional_currency_id, exp.expense_date)
        out.append(ShipmentCostAllocation.objects.create(company=sh.company, shipment=sh, expense=exp, method=method,
                                                         percentage=q3(w * 100), amount=conv, created_by=user))
    audit(user, 'ALLOCATE_EXPENSE', exp, {'method': method, 'shipments': [a.shipment.reference for a in out]})
    return out


@transaction.atomic
def log_vehicle_expense(vehicle, user, *, category, expense_type, expense_date, amount, currency=None, litres=None,
                        odometer_km=D0, shipment=None, payment_method='CASH', bank_account=None, receipt_no='',
                        description='', tax_amount=D0):
    """Owned-fleet operating expense: one Expense (money) + one VehicleExpense (litres/odometer log)."""
    exp = Expense.objects.create(
        company=vehicle.company, expense_date=as_date(expense_date), category=category, vehicle=vehicle, shipment=shipment,
        description=description or f'{expense_type} {vehicle.registration_number}', truck_ownership='OWNED',
        amount=amount, tax_amount=tax_amount, currency_id=currency, payment_method=payment_method,
        bank_account=bank_account, receipt_no=receipt_no, status='DRAFT', created_by=user)
    ve = VehicleExpense.objects.create(company=vehicle.company, vehicle=vehicle, shipment=shipment, expense_type=expense_type,
                                       expense_date=as_date(expense_date), litres=litres, odometer_km=odometer_km,
                                       amount=amount, expense=exp, created_by=user)
    if odometer_km and odometer_km > vehicle.odometer_km:
        vehicle.odometer_km = odometer_km
        vehicle.save(update_fields=['odometer_km'])
    return exp, ve


# =========================================================== transport
def prepare_booking(b):
    b.total_charge = q2(b.quantity * b.contracted_rate) if b.rate_basis == 'PER_LITRE' else q2(b.contracted_rate)
    return b


def suggest_transport_rate(transporter, origin, destination, on_date):
    return TransporterRate.objects.filter(transporter=transporter, origin__iexact=origin, destination__iexact=destination,
                                          effective_from__lte=as_date(on_date)) \
        .filter(Q(effective_to__isnull=True) | Q(effective_to__gte=as_date(on_date))).order_by('-effective_from').first()


@transaction.atomic
def post_transporter_invoice(inv, user):
    """Posts via a linked Expense (TRUCK_HIRE, HIRED) so hire cost is tracked apart from owned-truck cost."""
    if inv.status != 'DRAFT':
        err('Only draft transporter invoices can be posted.')
    b, co = inv.booking, inv.company
    if b.transporter_id != inv.transporter_id:
        err('Invoice transporter differs from the booking.')
    if b.status not in ('APPROVED', 'IN_TRANSIT', 'DELIVERED'):
        err(f'Booking {b.reference} is {b.status}; it must be approved before invoicing.')
    inv.recalc()
    if inv.subtotal > b.total_charge * (1 + _tolerance(co)):
        err(f'Invoice {inv.subtotal} exceeds the contracted charge {b.total_charge}.')
    cat, _ = ExpenseCategory.objects.get_or_create(
        code='TRUCK_HIRE', defaults={'name': 'Truck hire', 'group': 'TRANSPORT', 'cost_component': 'TRANSPORT_HIRED'})
    exp = Expense.objects.create(
        company=co, expense_date=inv.invoice_date, category=cat, description=f'Truck hire {b.reference} / {inv.invoice_no}',
        shipment=b.shipment, transporter=inv.transporter, payee=inv.transporter.name, truck_ownership='HIRED',
        amount=inv.subtotal, tax_amount=inv.tax_total, currency=inv.currency, exchange_rate=inv.exchange_rate,
        rate_date=inv.rate_date, rate_source=inv.rate_source, payment_method='CREDIT', receipt_no=inv.invoice_no,
        status='APPROVED', created_by=user)
    post_expense(exp, user, source_doc=inv)
    inv.expense, inv.functional_total, inv.status = exp, exp.functional_total, 'POSTED'
    inv.due_date = inv.due_date or inv.invoice_date + timedelta(days=inv.transporter.payment_terms_days)
    inv.save()
    b.status = 'INVOICED'
    b.save(update_fields=['status'])
    for adv in Payment.objects.filter(booking=b, status='POSTED', purpose='ADVANCE'):   # offset advances paid
        free = adv.unallocated_amount
        if free > 0 and inv.outstanding > 0:
            apply_advance(adv, [{'transporter_invoice': inv, 'amount': min(free, inv.outstanding)}], user)
            inv.refresh_from_db()
    _refresh_invoice_status(inv) if inv.amount_paid else None
    audit(user, 'POST_TRANSPORTER_INVOICE', inv, {'total': inv.total})
    return inv


# =========================================================== shipments
ACTIVE_SHIPMENT = ('LOADING', 'LOADED', 'DISPATCHED', 'IN_TRANSIT', 'AT_BORDER', 'UNDER_CUSTOMS', 'CLEARED', 'ARRIVED')
TRANSITIONS = {
    'DRAFT': {'CANCELLED'}, 'AWAITING_APPROVAL': {'CANCELLED'},
    'APPROVED': {'AWAITING_LOADING', 'CANCELLED'}, 'AWAITING_LOADING': {'LOADING', 'CANCELLED'},
    'LOADING': {'LOADED', 'CANCELLED'}, 'LOADED': {'DISPATCHED', 'LOADING'},
    'DISPATCHED': {'IN_TRANSIT', 'AT_BORDER'}, 'IN_TRANSIT': {'AT_BORDER', 'ARRIVED'},
    'AT_BORDER': {'UNDER_CUSTOMS', 'CLEARED'}, 'UNDER_CUSTOMS': {'CLEARED'}, 'CLEARED': {'IN_TRANSIT', 'ARRIVED'},
    'ARRIVED': {'DELIVERED'}, 'DELIVERED': {'RECONCILIATION_PENDING'}, 'RECONCILIATION_PENDING': {'CLOSED'},
}


def check_dispatch_resources(sh, on_date):
    on_date = as_date(on_date)
    if sh.truck_ownership == 'OWNED':
        v, d = sh.vehicle, sh.driver
        if not v or not d:
            err('Assign an owned vehicle and a driver.')
        if v.status in ('MAINTENANCE', 'INACTIVE'):
            err(f'Vehicle {v.registration_number} is {v.status}.')
        if d.employment_status != 'ACTIVE':
            err(f'Driver {d.full_name} is {d.employment_status}.')
        if d.licence_expiry and d.licence_expiry < on_date:
            err(f'Driver licence expired on {d.licence_expiry}.')
        for label, exp in (('insurance', v.insurance_expiry), ('inspection', v.inspection_expiry)):
            if exp and exp < on_date:
                err(f'Vehicle {label} expired on {exp}.')
        busy = Shipment.objects.filter(status__in=ACTIVE_SHIPMENT).exclude(pk=sh.pk)
        if busy.filter(vehicle=v).exists():
            err(f'Vehicle {v.registration_number} is already on another active shipment.')
        if busy.filter(driver=d).exists():
            err(f'Driver {d.full_name} is already on another active shipment.')
    else:
        if not sh.transporter_id or not sh.hired_truck_id:
            err('Select the transporter and hired truck.')
        if not TransportBooking.objects.filter(shipment=sh, status__in=('APPROVED', 'IN_TRANSIT', 'DELIVERED', 'INVOICED')).exists():
            err('An approved transport booking is required for hired-truck shipments.')


@transaction.atomic
def dispatch_stock(sh, user, on_date):
    """Stock leaves the tank into stock-in-transit at actual issue cost (FIFO / weighted average)."""
    if sh.stock_issued:
        err('Stock already issued for this shipment.')
    co, total = sh.company, D0
    for ln in sh.lines.select_related('tank', 'product'):
        if ln.loaded_quantity <= 0:
            continue
        if not ln.tank_id:
            err('Every loaded line needs a source tank.')
        mv = move_stock(company=co, tank=ln.tank, product=ln.product, movement_type='ISSUE', quantity=ln.loaded_quantity,
                        on_date=on_date, source=sh, user=user, shipment=sh, narration=f'Loaded on {sh.reference}')
        ln.unit_cost, ln.cost_total = mv.unit_cost, mv.total_cost
        ln.save()
        total += mv.total_cost
    if total <= 0:
        err('Nothing to dispatch: loaded quantity is zero.')
    post_journal(co, on_date, f'Dispatch {sh.reference}: stock in transit',
                 [{'account': acct(co, 'INVENTORY_IN_TRANSIT'), 'debit': total, 'shipment': sh},
                  {'account': acct(co, 'INVENTORY'), 'credit': total, 'shipment': sh}], source=sh, user=user)
    StockReservation.objects.filter(sales_order_id=sh.sales_order_id, status='ACTIVE').update(status='CONSUMED', shipment=sh) \
        if sh.sales_order_id else None
    sh.stock_issued = True
    sh.save(update_fields=['stock_issued'])


@transaction.atomic
def update_shipment_status(sh, new_status, user, *, when=None, location='', comments='', confirmation_type='NONE',
                           confirmed_by='', attachment=None):
    """Manual status update with permanent history (no GPS dependency)."""
    sh = Shipment.objects.select_for_update().get(pk=sh.pk)
    old = sh.status
    when = when or timezone.now()
    if new_status in ('AWAITING_APPROVAL', 'APPROVED') and old != new_status:
        err('Approval statuses can only be set through the approval workflow.')
    if new_status not in TRANSITIONS.get(old, set()):
        err(f'Transition {old} -> {new_status} is not allowed. Allowed: {", ".join(sorted(TRANSITIONS.get(old, []))) or "none"}.')
    d = as_date(when)
    if new_status == 'LOADING':
        check_dispatch_resources(sh, d)
        if sh.truck_ownership == 'OWNED':
            VehicleAssignment.objects.create(company=sh.company, vehicle=sh.vehicle, trailer=sh.trailer, driver=sh.driver,
                                             shipment=sh, created_by=user)
    elif new_status == 'LOADED':
        lines = list(sh.lines.all())
        if not lines or not any(l.loaded_quantity > 0 for l in lines):
            err('Record the loaded quantity on at least one shipment line.')
        for l in lines:
            if l.loaded_quantity > 0 and not l.tank_id:
                err('Each loaded line needs a source tank.')
        sh.loading_quantity = sum((l.loaded_quantity for l in lines), D0)
    elif new_status == 'DISPATCHED':
        check_dispatch_resources(sh, d)
        dispatch_stock(sh, user, d)
        sh.dispatched_at = when
        if sh.vehicle_id:
            Vehicle.objects.filter(pk=sh.vehicle_id).update(status='ON_TRIP')
    elif new_status == 'DELIVERED':
        if ShipmentDelivery.objects.filter(shipment=sh, status='PENDING_APPROVAL').exists():
            err('A delivery variance is still awaiting approval.')
        if not ShipmentDelivery.objects.filter(shipment=sh, status='APPROVED', is_final=True).exists():
            err('Record the (final) customer delivery first.')
        sh.actual_delivery = when
        TransportBooking.objects.filter(shipment=sh, status__in=('APPROVED', 'IN_TRANSIT')).update(status='DELIVERED')
    elif new_status == 'CLOSED':
        sheet = ShipmentCostSheet.objects.filter(shipment=sh).order_by('-version').first()
        if not sheet or not sheet.is_final:
            err('Finalise the shipment cost sheet before closing.')
        last_alloc = ShipmentCostAllocation.objects.filter(shipment=sh).order_by('-updated_at').first()
        if last_alloc and last_alloc.updated_at > sheet.created_at:
            err('Expenses changed after the cost sheet was finalised; recompute and finalise again.')
        VehicleAssignment.objects.filter(shipment=sh, status='ACTIVE').update(status='COMPLETED', end_at=timezone.now())
        if sh.vehicle_id:
            Vehicle.objects.filter(pk=sh.vehicle_id).update(status='AVAILABLE', odometer_km=F('odometer_km') + sh.distance_km)
    elif new_status == 'CANCELLED':
        if sh.stock_issued:
            err('Cannot cancel after stock has been dispatched.')
        StockReservation.objects.filter(shipment=sh, status='ACTIVE').update(status='RELEASED')
        VehicleAssignment.objects.filter(shipment=sh, status='ACTIVE').update(status='CANCELLED', end_at=timezone.now())
    elif new_status == 'ARRIVED' and sh.vehicle_id:
        pass
    sh.status = new_status
    sh.save()
    h = ShipmentStatusHistory.objects.create(company=sh.company, shipment=sh, previous_status=old, new_status=new_status,
                                             changed_at=when, location=location, updated_by=user, comments=comments,
                                             confirmation_type=confirmation_type, confirmed_by=confirmed_by,
                                             attachment=attachment or '')
    audit(user, 'SHIPMENT_STATUS', sh, {'from': old, 'to': new_status, 'location': location})
    return sh, h


@transaction.atomic
def record_loading(sh, lines, user, loading_date=None):
    """Record actual loaded litres per line while the shipment is LOADING (header is locked after DRAFT)."""
    sh = Shipment.objects.select_for_update().get(pk=sh.pk)
    if sh.status != 'LOADING':
        err('Loaded quantities can only be recorded while the shipment status is LOADING.')
    for l in lines:
        ln = sh.lines.filter(pk=l['id']).first()
        if not ln:
            err(f'Shipment line {l["id"]} not found.')
        ln.loaded_quantity = q3(l['loaded_quantity'])
        if l.get('tank'):
            ln.tank = l['tank']
            if ln.tank.company_id != sh.company_id:
                err('Tank belongs to another legal entity.')
        ln.compartment = l.get('compartment', ln.compartment)
        ln.save()
    total = sum((x.loaded_quantity for x in sh.lines.all()), D0)
    cap = (sh.vehicle.tank_capacity if sh.vehicle_id else sh.hired_truck.capacity if sh.hired_truck_id else D0)
    if cap and total > cap:
        err(f'Loaded {total} L exceeds the truck capacity of {cap} L.')
    sh.loading_quantity = total
    if loading_date:
        sh.loading_date = as_date(loading_date)
    sh.save()
    audit(user, 'RECORD_LOADING', sh, {'loaded': total})
    return sh


def update_trip_data(sh, user, **data):
    if sh.status in ('CLOSED', 'CANCELLED'):
        err('Shipment is closed.')
    for k in ('distance_km', 'fuel_issued_litres', 'fuel_used_litres', 'expected_delivery'):
        if data.get(k) is not None:
            setattr(sh, k, data[k])
    sh.save()
    audit(user, 'TRIP_DATA', sh, {k: v for k, v in data.items() if v is not None})
    return sh


@transaction.atomic
def record_delivery(sh, user, *, delivered_quantity, delivery_date=None, is_final=False, received_by='', notes='',
                    temperature_c=None, density=None, pod_file=None):
    sh = Shipment.objects.select_for_update().get(pk=sh.pk)
    if not sh.stock_issued:
        err('Shipment has not been dispatched.')
    if sh.status != 'ARRIVED':
        err('Deliveries are recorded once the shipment has ARRIVED at destination.')
    lines = list(sh.lines.all())
    loaded = sum((l.loaded_quantity for l in lines), D0)
    done = ShipmentDelivery.objects.filter(shipment=sh, status__in=('APPROVED', 'PENDING_APPROVAL')) \
        .aggregate(s=Sum('delivered_quantity'))['s'] or D0
    remaining, qty = loaded - done, q3(delivered_quantity)
    if qty <= 0 or qty > remaining:
        err(f'Delivered quantity must be between 0 and the {remaining} L still in transit.')
    shortage = remaining - qty if is_final else D0
    pct = q3(shortage / loaded * 100) if loaded else D0
    needs_approval = shortage > 0 and pct > sh.company.delivery_loss_tolerance_pct
    d = ShipmentDelivery.objects.create(
        company=sh.company, shipment=sh, delivery_date=as_date(delivery_date), delivered_quantity=qty, remaining_before=remaining,
        is_final=is_final, shortage_litres=shortage, shortage_pct=pct, temperature_c=temperature_c, density=density,
        received_by=received_by, notes=notes, pod_file=pod_file or '', created_by=user,
        status='PENDING_APPROVAL' if needs_approval else 'APPROVED')
    if needs_approval:
        request_approval(d, user, f'Delivery shortage {shortage} L ({pct}%) on {sh.reference}')
        notify_roles(sh.company, APPROVER_ROLES, f'Shipment variance {sh.reference}', f'{shortage} L short', 'WARNING')
    else:
        _post_delivery(d, user)
    audit(user, 'RECORD_DELIVERY', d, {'qty': qty, 'shortage': shortage})
    return d


@transaction.atomic
def _post_delivery(d, user):
    """COGS (delivered litres at actual cost) and transit loss (final-delivery shortage) out of stock-in-transit."""
    sh, co = d.shipment, d.company
    lines = list(sh.lines.all())
    transit_total = sum((l.cost_total for l in lines), D0)
    loaded = sum((l.loaded_quantity for l in lines), D0)
    prev = ShipmentDelivery.objects.filter(shipment=sh, status='APPROVED').exclude(pk=d.pk)
    expensed = sum((x.cogs_value + x.loss_value for x in prev), D0)
    if d.is_final:
        cogs = q2(d.delivered_quantity * transit_total / loaded)
        loss = transit_total - expensed - cogs
        if loss < 0:
            cogs, loss = cogs + loss, D0
    else:
        cogs, loss = q2(d.delivered_quantity * transit_total / loaded), D0
    j = post_journal(co, d.delivery_date, f'Delivery {d.reference} on {sh.reference}',
                     [{'account': acct(co, 'COGS'), 'debit': cogs, 'shipment': sh},
                      {'account': acct(co, 'TRANSIT_LOSS'), 'debit': loss, 'shipment': sh},
                      {'account': acct(co, 'INVENTORY_IN_TRANSIT'), 'credit': cogs + loss, 'shipment': sh}],
                     source=d, user=user)
    d.cogs_value, d.loss_value, d.journal = cogs, loss, j
    d.save()
    if sh.sales_order_id:
        ol = SalesOrderLine.objects.filter(order_id=sh.sales_order_id, product=sh.product).first()
        if ol:
            ol.delivered_quantity += d.delivered_quantity
            ol.save(update_fields=['delivered_quantity'])


def fuel_variance(sh, tolerance_pct=Decimal('10')):
    """Owned-truck fuel check: expected litres from the vehicle norm (km per litre) vs actual fuel used."""
    v = sh.vehicle
    if not v or not v.fuel_norm_km_per_litre or not sh.distance_km or not sh.fuel_used_litres:
        return None
    expected = q3(sh.distance_km / v.fuel_norm_km_per_litre)
    var = sh.fuel_used_litres - expected
    pct = q3(var / expected * 100) if expected else D0
    return {'expected_litres': expected, 'actual_litres': sh.fuel_used_litres, 'variance_litres': var,
            'variance_pct': pct, 'flag': pct > tolerance_pct}


# =========================================================== shipment costing engine
COMPONENTS = ['LOADING', 'DEPOT', 'TRANSPORT_HIRED', 'TRANSPORT_OWNED', 'DRIVER', 'FUEL', 'BORDER', 'CLEARING',
              'INSURANCE', 'TRANSIT', 'OFFLOADING', 'BANK', 'OTHER']


@transaction.atomic
def compute_cost_sheet(sh, user, *, finalize=False, reopen=False, notes=''):
    """
    Total shipment cost       = petroleum purchase cost + allocated direct shipment expenses
    Delivered cost per litre  = total shipment cost / actual delivered litres
    COGS pool                 = purchase cost + allocated expenses flagged in_cogs
    Gross profit              = revenue - COGS (COGS = pool x invoiced/delivered litres)
    Contribution              = gross profit - direct expenses NOT in COGS (financial / other)
    Margin %                  = contribution / revenue x 100
    Costs are read ONLY from ShipmentCostAllocation (one allocation per expense) -> no double counting.
    Every run creates a new immutable version; final versions are never overwritten.
    """
    sh = Shipment.objects.select_for_update().get(pk=sh.pk)
    co = sh.company
    last = ShipmentCostSheet.objects.filter(shipment=sh).order_by('-version').first()
    if last and last.is_final and not reopen:
        err(f'Cost sheet v{last.version} is final. Pass reopen=true (authorised) to create a new version.')
    lines = list(sh.lines.select_related('product'))
    loaded = sum((l.loaded_quantity for l in lines), D0)
    provisional = not sh.stock_issued
    if sh.stock_issued:
        purchase = sum((l.cost_total for l in lines), D0)
    else:
        purchase = D0
        for l in lines:
            unit = (l.purchase_price * sh.exchange_rate) if l.purchase_price else (estimate_cost_per_litre(co, l.product) or D0)
            purchase += q2((l.loaded_quantity or l.quantity) * unit)
        if not lines:
            purchase = q2(sh.quantity * sh.purchase_price * sh.exchange_rate)
    comp = {c: D0 for c in COMPONENTS}
    cogs_pool, additional = purchase, D0
    for a in ShipmentCostAllocation.objects.filter(shipment=sh, expense__status__in=('POSTED', 'PAID')).select_related('expense__category'):
        cat = a.expense.category
        comp[cat.cost_component] += a.amount
        if cat.in_cogs:
            cogs_pool += a.amount
        else:
            additional += a.amount
    booking = TransportBooking.objects.filter(shipment=sh, status__in=('APPROVED', 'IN_TRANSIT', 'DELIVERED', 'INVOICED', 'SETTLED')).first()
    if booking and comp['TRANSPORT_HIRED'] == 0 and not finalize:       # provisional estimate until the invoice is posted
        est = q2(booking.total_charge * booking.exchange_rate)
        comp['TRANSPORT_HIRED'] += est
        cogs_pool += est
        provisional = True
    direct = sum(comp.values(), D0)
    total_cost = purchase + direct
    dels = ShipmentDelivery.objects.filter(shipment=sh, status='APPROVED')
    delivered = dels.aggregate(s=Sum('delivered_quantity'))['s'] or D0
    final_del = dels.filter(is_final=True).exists()
    shortage = max(loaded - delivered, D0) if final_del else D0
    shortage_value = q2(purchase * shortage / loaded) if loaded else D0
    inv_lines = SalesInvoiceLine.objects.filter(shipment=sh, invoice__status__in=('POSTED', 'PART_PAID', 'PAID')).select_related('invoice__company')
    inv_litres, revenue = D0, D0
    for l in inv_lines:
        inv_litres += l.quantity
        revenue += convert(q2(l.line_total * l.invoice.exchange_rate), l.invoice.company.functional_currency_id,
                           co.functional_currency_id, l.invoice.invoice_date)
    for cn in SalesCreditNote.objects.filter(shipment=sh, status='POSTED').select_related('company'):
        inv_litres -= cn.quantity
        revenue -= convert(q2(cn.subtotal * cn.exchange_rate), cn.company.functional_currency_id, co.functional_currency_id, cn.note_date)
    ratio = min(inv_litres / delivered, Decimal(1)) if delivered else D0
    cogs = q2(cogs_pool * ratio)
    gross = revenue - cogs
    contribution = gross - additional
    margin = q3(contribution / revenue * 100) if revenue else D0
    if finalize:
        if sh.status not in ('DELIVERED', 'RECONCILIATION_PENDING', 'CLOSED'):
            err('Shipment must be delivered before its cost can be finalised.')
        if not final_del or ShipmentDelivery.objects.filter(shipment=sh, status='PENDING_APPROVAL').exists():
            err('Final delivery missing, or a delivery variance is still awaiting approval.')
        open_exp = Expense.objects.filter(shipment=sh, status__in=('DRAFT', 'AWAITING_APPROVAL', 'APPROVED'))
        if open_exp.exists():
            err('Unposted expenses exist for this shipment: ' + ', '.join(open_exp.values_list('reference', flat=True)))
        provisional = False
    sheet = ShipmentCostSheet.objects.create(
        company=co, shipment=sh, version=(last.version + 1) if last else 1, is_final=finalize, is_provisional=provisional,
        purchase_cost=purchase, components={k: str(v) for k, v in comp.items()}, total_direct_expenses=direct,
        total_shipment_cost=total_cost, cogs_pool=cogs_pool, additional_expenses=additional, loaded_litres=loaded,
        delivered_litres=delivered, shortage_litres=shortage, shortage_value=shortage_value, invoiced_litres=inv_litres,
        revenue=revenue, cogs=cogs, gross_profit=gross, contribution=contribution, margin_pct=margin,
        delivered_cost_per_litre=q6(total_cost / delivered) if delivered else D0, notes=notes, created_by=user)
    audit(user, 'FINAL_COST_SHEET' if finalize else 'COST_SHEET', sh, {'version': sheet.version, 'contribution': contribution})
    return sheet


# =========================================================== hooks (called after an approval is granted)
def _approve_payment(p, user):
    p.approved_by, p.approved_at = user, timezone.now()
    p.save(update_fields=['approved_by', 'approved_at'])


APPROVAL_HOOKS = {
    'Payment': _approve_payment,
    'StockAdjustment': _approve_stock_adjustment,
    'ShipmentDelivery': _post_delivery,
}


# =========================================================== fixed assets
@transaction.atomic
def run_depreciation(company, period_end, user):
    """Straight-line monthly depreciation, once per asset per period (unique constraint)."""
    period_end, out = as_date(period_end), []
    for a in FixedAsset.objects.filter(company=company, status='ACTIVE', acquisition_date__lte=period_end):
        if AssetDepreciation.objects.filter(asset=a, period_end=period_end).exists():
            continue
        depreciable = a.cost - a.salvage_value - a.accumulated_depreciation
        if depreciable <= 0 or not a.useful_life_months:
            continue
        amt = min(q2((a.cost - a.salvage_value) / a.useful_life_months), depreciable)
        j = post_journal(company, period_end, f'Depreciation {a.reference} {period_end:%b %Y}',
                         [{'account': acct(company, 'DEPRECIATION_EXP'), 'debit': amt},
                          {'account': acct(company, 'ACCUM_DEPRECIATION'), 'credit': amt}], source=a, user=user)
        AssetDepreciation.objects.create(company=company, asset=a, period_end=period_end, amount=amt, journal=j, created_by=user)
        a.accumulated_depreciation += amt
        a.save(update_fields=['accumulated_depreciation'])
        out.append(a)
    return out


@transaction.atomic
def dispose_asset(asset, proceeds, on_date, bank_account, user):
    if asset.status != 'ACTIVE':
        err('Asset already disposed.')
    co, proceeds = asset.company, q2(proceeds)
    gl = proceeds - asset.net_book_value
    lines = [{'account': bank_account.gl_account, 'debit': proceeds},
             {'account': acct(co, 'ACCUM_DEPRECIATION'), 'debit': asset.accumulated_depreciation},
             {'account': acct(co, 'FIXED_ASSETS'), 'credit': asset.cost},
             {'account': acct(co, 'DISPOSAL_GAIN_LOSS'), 'debit': -gl if gl < 0 else 0, 'credit': gl if gl > 0 else 0}]
    post_journal(co, on_date, f'Disposal {asset.reference}', lines, source=asset, user=user)
    asset.status, asset.disposal_date, asset.disposal_proceeds, asset.disposal_gain_loss = 'DISPOSED', as_date(on_date), proceeds, gl
    asset.save()
    return asset


# =========================================================== payroll (config-driven, per entity/country)
def _bracket_tax(amount, brackets):
    tax, prev = D0, D0
    for b in sorted(brackets, key=lambda x: (x.get('up_to') is None, x.get('up_to') or 0)):
        top = dec(b['up_to']) if b.get('up_to') is not None else None
        slab = (min(amount, top) if top is not None else amount) - prev
        if slab > 0:
            tax += slab * dec(b['rate']) / 100
        if top is None or amount <= top:
            break
        prev = top
    return tax


@transaction.atomic
def run_payroll(run, user, overtime=None):
    if run.status != 'DRAFT':
        err('Payroll run already posted.')
    co, overtime = run.company, overtime or {}
    cfg = list(PayrollConfig.objects.filter(company=co, is_active=True, effective_from__lte=run.period_end)
               .filter(Q(effective_to__isnull=True) | Q(effective_to__gte=run.period_end)))
    emps = Employee.objects.filter(company=co, status='ACTIVE')
    if not emps:
        err('No active employees.')
    tg = td = tn = te = D0
    liab = {}
    run.payslips.all().delete()
    for e in emps:
        allow = sum((dec(a.get('amount')) for a in e.allowances), D0)
        ot = dec(overtime.get(str(e.id), 0))
        gross = e.basic_salary + allow + ot
        ded, emp = {}, {}
        for c in cfg:
            base = gross if c.base == 'GROSS' else e.basic_salary
            v = (base * c.value / 100 if c.calc_type == 'PERCENT' else c.value if c.calc_type == 'FIXED' else _bracket_tax(base, c.brackets))
            v = q2(min(v, c.cap) if c.cap else v)
            (ded if c.kind == 'DEDUCTION' else emp)[c.code] = str(v)
            if c.liability_account_id:
                liab[c.liability_account_id] = liab.get(c.liability_account_id, D0) + v
        tded, temp = sum((dec(x) for x in ded.values()), D0), sum((dec(x) for x in emp.values()), D0)
        Payslip.objects.create(run=run, employee=e, basic=e.basic_salary, allowances=allow, overtime=ot, gross=gross,
                               deductions=ded, total_deductions=tded, employer_contributions=emp, total_employer=temp,
                               net_pay=gross - tded)
        tg, td, tn, te = tg + gross, td + tded, tn + gross - tded, te + temp
    stat_ded = sum((dec(v) for s in run.payslips.all() for v in s.deductions.values()), D0)
    lines = [{'account': acct(co, 'SALARIES_EXP'), 'debit': tg + te},
             {'account': acct(co, 'PAYROLL_PAYABLE'), 'credit': tn}]
    stat_total = stat_ded + te
    for acc_id, v in liab.items():
        lines.append({'account': Account.objects.get(pk=acc_id), 'credit': v})
    unmapped = stat_total - sum(liab.values(), D0)
    if unmapped:
        lines.append({'account': acct(co, 'STATUTORY_PAYABLE'), 'credit': unmapped})
    run.journal = post_journal(co, run.period_end, f'Payroll {run.reference}', lines, source=run, user=user)
    run.total_gross, run.total_deductions, run.total_net, run.total_employer_cost, run.status = tg, td, tn, te, 'POSTED'
    run.save()
    return run


# =========================================================== FX revaluation (unrealized)
@transaction.atomic
def revalue_foreign_balances(company, as_of, user, post=False):
    """Unrealized FX on open foreign-currency AR/AP at the closing rate. Posts one journal (reverse next period)."""
    as_of, fc = as_date(as_of), company.functional_currency_id
    rows, ar_adj, ap_adj = [], D0, D0
    for i in SalesInvoice.objects.filter(company=company, status__in=('POSTED', 'PART_PAID')).exclude(currency_id=fc):
        rate = get_rate(i.currency_id, fc, as_of)[0]
        d = q2(i.outstanding * (rate - i.exchange_rate))
        ar_adj += d
        rows.append(['AR', i.reference, i.currency_id, i.outstanding, i.exchange_rate, rate, d])
    for model, kind in ((PurchaseInvoice, 'AP'), (TransporterInvoice, 'AP')):
        for i in model.objects.filter(company=company, status__in=('POSTED', 'PART_PAID')).exclude(currency_id=fc):
            rate = get_rate(i.currency_id, fc, as_of)[0]
            d = q2(i.outstanding * (rate - i.exchange_rate))
            ap_adj += d
            rows.append([kind, i.reference, i.currency_id, i.outstanding, i.exchange_rate, rate, -d])
    net = ar_adj - ap_adj
    j = None
    if post and (ar_adj or ap_adj):
        lines = [{'account': acct(company, 'AR'), 'debit': ar_adj if ar_adj > 0 else 0, 'credit': -ar_adj if ar_adj < 0 else 0},
                 {'account': acct(company, 'AP'), 'credit': ap_adj if ap_adj > 0 else 0, 'debit': -ap_adj if ap_adj < 0 else 0},
                 {'account': acct(company, 'FX_UNREALIZED'), 'credit': net if net > 0 else 0, 'debit': -net if net < 0 else 0}]
        j = post_journal(company, as_of, f'Unrealized FX revaluation {as_of}', lines, user=user)
    return {'as_of': as_of, 'gain_loss': net, 'journal': j.reference if j else None,
            'columns': ['Type', 'Document', 'Currency', 'Outstanding', 'Booked rate', 'Closing rate', 'Gain/(loss)'], 'rows': rows}


# =========================================================== intercompany & consolidation
def _fx_line(co, diff, gain_when_positive=True):
    if not diff:
        return None
    gain = (diff > 0) == gain_when_positive
    return {'account': acct(co, 'FX_GAIN' if gain else 'FX_LOSS'), 'credit' if gain else 'debit': abs(diff)}


@transaction.atomic
def create_intercompany_sale(seller, buyer, product, quantity, transfer_price, currency, on_date, user, *,
                             from_tank=None, to_tank=None, shipment=None, notes=''):
    """Dual-entity posting: seller (IC receivable/revenue) and buyer (inventory or IC purchases / IC payable)."""
    if seller.id == buyer.id:
        err('Seller and buyer must be different legal entities.')
    allowed = set(user.allowed_company_ids())
    if seller.id not in allowed or buyer.id not in allowed:
        err('You need access to both legal entities.')
    qty, price = q3(quantity), q6(transfer_price)
    amount = q2(qty * price)
    sr, br = get_rate(currency, seller.functional_currency_id, on_date)[0], get_rate(currency, buyer.functional_currency_id, on_date)[0]
    s_amt, b_amt = q2(amount * sr), q2(amount * br)
    ref = next_reference(seller, 'IC', on_date)
    s_lines = [{'account': acct(seller, 'IC_RECEIVABLE'), 'debit': s_amt}, {'account': acct(seller, 'IC_REVENUE'), 'credit': s_amt}]
    if from_tank:
        mv = move_stock(company=seller, tank=from_tank, product=product, movement_type='ISSUE', quantity=qty, on_date=on_date,
                        user=user, narration=f'IC sale {ref}')
        s_lines += [{'account': acct(seller, 'COGS'), 'debit': mv.total_cost}, {'account': acct(seller, 'INVENTORY'), 'credit': mv.total_cost}]
    b_lines = [{'account': acct(buyer, 'IC_PAYABLE'), 'credit': b_amt}]
    if to_tank:
        move_stock(company=buyer, tank=to_tank, product=product, movement_type='RECEIPT', quantity=qty, on_date=on_date,
                   unit_cost=q6(b_amt / qty), user=user, narration=f'IC purchase {ref}')
        b_lines.append({'account': acct(buyer, 'INVENTORY'), 'debit': b_amt})
    else:
        b_lines.append({'account': acct(buyer, 'IC_PURCHASES'), 'debit': b_amt})
    sj = post_journal(seller, on_date, f'IC sale {ref} to {buyer.code}', s_lines, user=user)
    bj = post_journal(buyer, on_date, f'IC purchase {ref} from {seller.code}', b_lines, user=user)
    t = IntercompanyTransaction.objects.create(
        reference=ref, txn_type='SALE', from_company=seller, to_company=buyer, txn_date=as_date(on_date), product=product,
        quantity=qty, transfer_price=price, currency_id=currency, amount=amount, seller_rate=sr, buyer_rate=br,
        from_journal=sj, to_journal=bj, shipment=shipment, notes=notes, status='POSTED', created_by=user)
    if shipment:
        Shipment.objects.filter(pk=shipment.pk).update(intercompany_transaction=t)
    audit(user, 'INTERCOMPANY_SALE', t, {'amount': amount, 'from': seller.code, 'to': buyer.code}, company=seller.id)
    return t


@transaction.atomic
def settle_intercompany(txn, amount, on_date, seller_bank, buyer_bank, user):
    amount = q2(amount)
    if amount <= 0 or amount > txn.outstanding:
        err(f'Settlement must be between 0 and the outstanding {txn.outstanding}.')
    s, b = txn.from_company, txn.to_company
    sr, br = get_rate(txn.currency_id, s.functional_currency_id, on_date)[0], get_rate(txn.currency_id, b.functional_currency_id, on_date)[0]
    s_cash, s_carry = q2(amount * sr), q2(amount * txn.seller_rate)
    b_cash, b_carry = q2(amount * br), q2(amount * txn.buyer_rate)
    sl = [{'account': seller_bank.gl_account, 'debit': s_cash}, {'account': acct(s, 'IC_RECEIVABLE'), 'credit': s_carry}]
    if (x := _fx_line(s, s_cash - s_carry, True)):
        sl.append(x)
    bl = [{'account': acct(b, 'IC_PAYABLE'), 'debit': b_carry}, {'account': buyer_bank.gl_account, 'credit': b_cash}]
    if (x := _fx_line(b, b_cash - b_carry, False)):
        bl.append(x)
    post_journal(s, on_date, f'IC settlement {txn.reference}', sl, user=user)
    post_journal(b, on_date, f'IC settlement {txn.reference}', bl, user=user)
    txn.settled_amount += amount
    txn.status = 'SETTLED' if txn.outstanding <= 0 else 'PART_SETTLED'
    txn.save()
    return txn


def _gl_net(company, subtype, on_date):
    s = JournalLine.objects.filter(journal__company=company, account__subtype=subtype, journal__date__lte=as_date(on_date)) \
        .aggregate(d=Sum('debit'), c=Sum('credit'))
    return (s['d'] or D0) - (s['c'] or D0)


@transaction.atomic
def reconcile_intercompany(as_of, user=None):
    """Counterparty matching: sub-ledger (open IC transactions) vs GL IC accounts, both sides."""
    out = []
    for t in IntercompanyTransaction.objects.exclude(status='SETTLED').values('from_company', 'to_company', 'currency').distinct():
        a, b = Company.objects.get(pk=t['from_company']), Company.objects.get(pk=t['to_company'])
        open_t = IntercompanyTransaction.objects.filter(from_company=a, to_company=b, currency_id=t['currency']).exclude(status='SETTLED')
        sub_r = sum((q2(x.outstanding * x.seller_rate) for x in open_t), D0)
        sub_p = sum((q2(x.outstanding * x.buyer_rate) for x in open_t), D0)
        gl_r, gl_p = _gl_net(a, 'IC_RECEIVABLE', as_of), -_gl_net(b, 'IC_PAYABLE', as_of)
        diff = (gl_r - sub_r) + (gl_p - sub_p)
        IntercompanyBalance.objects.create(company=a, counterparty=b, currency_id=t['currency'], receivable=sub_r, payable=sub_p,
                                           gl_receivable=gl_r, gl_payable=gl_p, difference=diff, as_of_date=as_date(as_of))
        out.append({'seller': a.code, 'buyer': b.code, 'currency': t['currency'], 'subledger_receivable': sub_r,
                    'subledger_payable': sub_p, 'gl_receivable': gl_r, 'gl_payable': gl_p, 'difference': diff, 'reconciled': diff == 0})
    return out


def _account_balances(company_ids, date_from=None, date_to=None, types=None, exclude_closing=False):
    qs = JournalLine.objects.filter(journal__company_id__in=company_ids)
    if date_from:
        qs = qs.filter(journal__date__gte=as_date(date_from))
    if date_to:
        qs = qs.filter(journal__date__lte=as_date(date_to))
    if types:
        qs = qs.filter(account__account_type__in=types)
    if exclude_closing:
        qs = qs.filter(journal__is_closing=False)
    accts = {a.id: a for a in Account.objects.filter(company_id__in=company_ids).select_related('company')}
    return {accts[r['account_id']]: (r['d'] or D0, r['c'] or D0)
            for r in qs.values('account_id').annotate(d=Sum('debit'), c=Sum('credit'))}


def _rep_ccy():
    from django.conf import settings
    return getattr(settings, 'REPORTING_CURRENCY', 'USD')


def _fx_factor(company, on_date, target):
    return get_rate(company.functional_currency_id, target, on_date)[0] if company.functional_currency_id != target else Decimal(1)


@transaction.atomic
def run_consolidation(period_start, period_end, user, reporting_currency=None):
    """
    Translate each entity's GL (single closing rate; no CTA) into the reporting currency, group accounts by
    group_code, then eliminate intercompany balances/revenue so group revenue and expenses are not duplicated.
    """
    rc = reporting_currency or _rep_ccy()
    companies = list(Company.objects.filter(is_active=True))
    groups = defaultdict(lambda: [D0, D0, ''])           # group_code -> [net(Dr-Cr), ... , type]
    per_company, types = {}, {}
    for co in companies:
        f = _fx_factor(co, period_end, rc)
        pl = _account_balances([co.id], period_start, period_end, types=('REVENUE', 'EXPENSE'), exclude_closing=True)
        bs = _account_balances([co.id], None, period_end, types=('ASSET', 'LIABILITY', 'EQUITY'))
        net_pl = D0
        for a, (d, c) in list(pl.items()) + list(bs.items()):
            key = a.group_code or a.code
            v = q2((d - c) * f)
            groups[key][0] += v
            types[key] = a.account_type
            if a.account_type in ('REVENUE', 'EXPENSE'):
                net_pl += v
        per_company[co.code] = {'profit': -net_pl, 'currency': co.functional_currency_id, 'rate': f}
    run = ConsolidationRun.objects.create(reference=f'CONS-{period_end:%Y%m%d}-{ConsolidationRun.objects.count() + 1}',
                                          period_start=as_date(period_start), period_end=as_date(period_end),
                                          reporting_currency_id=rc, created_by=user)
    entries, n = [], 0
    def elim(desc, dr, cr, amount, txn=None):
        nonlocal n
        n += 1
        entries.append(EliminationJournal(run=run, entry_no=n, description=desc, account_group_code=dr, debit=amount, ic_transaction=txn))
        entries.append(EliminationJournal(run=run, entry_no=n, description=desc, account_group_code=cr, credit=amount, ic_transaction=txn))
        groups[dr][0] += amount
        groups[cr][0] -= amount
    rec, pay = groups.get('IC_RECEIVABLE', [D0])[0], groups.get('IC_PAYABLE', [D0])[0]
    if rec or pay:
        elim('Eliminate intercompany receivable vs payable', 'IC_PAYABLE', 'IC_RECEIVABLE', rec)
        if rec + pay:                                    # unmatched residual -> flagged, never silently dropped
            groups['IC_DIFFERENCE'][0] += rec + pay
            types['IC_DIFFERENCE'] = 'EXPENSE'
            groups['IC_PAYABLE'][0] -= rec + pay
    ic_rev = -groups.get('IC_REVENUE', [D0])[0]
    if ic_rev:
        target = 'IC_PURCHASES' if groups.get('IC_PURCHASES', [D0])[0] else 'COGS'
        elim(f'Eliminate intercompany revenue against {target} (review unrealised profit in buyer stock)',
             'IC_REVENUE', target, ic_rev)
    EliminationJournal.objects.bulk_create(entries)
    lines = [{'group_code': k, 'type': types.get(k, ''), 'amount': str(-v[0] if types.get(k) in ('REVENUE', 'LIABILITY', 'EQUITY') else v[0])}
             for k, v in sorted(groups.items()) if v[0]]
    revenue = sum(dec(l['amount']) for l in lines if l['type'] == 'REVENUE')
    expense = sum(dec(l['amount']) for l in lines if l['type'] == 'EXPENSE')
    run.result = {'currency': rc, 'lines': lines, 'entities': per_company, 'group_revenue': str(revenue),
                  'group_expenses': str(expense), 'group_profit': str(revenue - expense), 'eliminations': n}
    run.status = 'COMPLETED'
    run.save()
    audit(user, 'CONSOLIDATION', run, {'profit': revenue - expense}, company=None)
    return run


# =========================================================== reports
def _filters(request_params, user):
    p = request_params
    ids = user.allowed_company_ids()
    if p.get('company'):
        ids = [i for i in ids if str(i) == str(p['company'])]
    if p.get('country'):
        ids = [i for i in ids if Company.objects.get(pk=i).country == p['country']]
    return {'company_ids': ids, 'date_from': as_date(p['date_from']) if p.get('date_from') else None,
            'date_to': as_date(p.get('date_to')) if p.get('date_to') else today(), 'product': p.get('product'),
            'customer': p.get('customer'), 'shipment': p.get('shipment'), 'account': p.get('account'), 'user': user}


def _fin_rows(f, types, cumulative=False, exclude_closing=False):
    """Account balances, translated to the reporting currency when several entities are selected."""
    multi = len(f['company_ids']) > 1
    out, total_rows = [], defaultdict(lambda: D0)
    bal = _account_balances(f['company_ids'], None if cumulative else f['date_from'], f['date_to'], types, exclude_closing)
    for a, (d, c) in sorted(bal.items(), key=lambda x: (x[0].company.code, x[0].code)):
        k = _fx_factor(a.company, f['date_to'], _rep_ccy()) if multi else Decimal(1)
        out.append((a, q2(d * k), q2(c * k)))
    return out, (_rep_ccy() if multi else Company.objects.get(pk=f['company_ids'][0]).functional_currency_id) if f['company_ids'] else ''


def report_trial_balance(f):
    rows, ccy = _fin_rows(f, None, cumulative=True)
    data = [[a.company.code, a.code, a.name, a.account_type, max(d - c, D0), max(c - d, D0)] for a, d, c in rows if d != c]
    td, tc = sum(r[4] for r in data), sum(r[5] for r in data)
    return {'title': f'Trial Balance ({ccy})', 'columns': ['Entity', 'Code', 'Account', 'Type', 'Debit', 'Credit'],
            'rows': data + [['', '', 'TOTAL', '', td, tc]], 'summary': {'balanced': td == tc, 'debit': td, 'credit': tc}}


def report_general_ledger(f):
    if not f['account']:
        err('Select an account (?account=ID).')
    qs = JournalLine.objects.filter(account_id=f['account'], journal__company_id__in=f['company_ids'])
    if f['date_from']:
        qs = qs.filter(journal__date__gte=f['date_from'])
    qs = qs.filter(journal__date__lte=f['date_to']).select_related('journal').order_by('journal__date', 'journal_id', 'id')
    run, rows = D0, []
    for l in qs:
        run += l.debit - l.credit
        rows.append([l.journal.date, l.journal.reference, l.journal.description, l.narration, l.debit, l.credit, run])
    return {'title': 'General Ledger', 'columns': ['Date', 'Journal', 'Description', 'Narration', 'Debit', 'Credit', 'Balance'], 'rows': rows, 'summary': {'closing': run}}


def report_profit_and_loss(f):
    rows, ccy = _fin_rows(f, ('REVENUE', 'EXPENSE'), exclude_closing=True)
    rev = sum((c - d for a, d, c in rows if a.account_type == 'REVENUE'), D0)
    cogs = sum((d - c for a, d, c in rows if a.account_type == 'EXPENSE' and a.subtype == 'COGS'), D0)
    opex = sum((d - c for a, d, c in rows if a.account_type == 'EXPENSE' and a.subtype != 'COGS'), D0)
    out = [['REVENUE', '', '']] + [['', a.name, c - d] for a, d, c in rows if a.account_type == 'REVENUE' and c != d]
    out += [['Total revenue', '', rev], ['COST OF SALES', '', '']] + [['', a.name, d - c] for a, d, c in rows if a.account_type == 'EXPENSE' and a.subtype == 'COGS' and c != d]
    out += [['Gross profit', '', rev - cogs], ['OPERATING & FINANCE EXPENSES', '', '']] + [['', a.name, d - c] for a, d, c in rows if a.account_type == 'EXPENSE' and a.subtype != 'COGS' and c != d]
    out += [['Total expenses', '', opex], ['NET PROFIT / (LOSS)', '', rev - cogs - opex]]
    return {'title': f'Profit and Loss ({ccy})', 'columns': ['Section', 'Account', 'Amount'], 'rows': out,
            'summary': {'revenue': rev, 'gross_profit': rev - cogs, 'net_profit': rev - cogs - opex, 'currency': ccy}}


def report_financial_position(f):
    rows, ccy = _fin_rows(f, None, cumulative=True)
    sec = {'ASSET': [], 'LIABILITY': [], 'EQUITY': []}
    pl = D0
    for a, d, c in rows:
        if a.account_type in sec and d != c:
            sec[a.account_type].append((a, (d - c) if a.account_type == 'ASSET' else (c - d)))
        elif a.account_type in ('REVENUE', 'EXPENSE'):
            pl += c - d
    out, tot = [], {}
    for t in ('ASSET', 'LIABILITY', 'EQUITY'):
        out.append([t, '', ''])
        out += [['', a.name, v] for a, v in sec[t]]
        if t == 'EQUITY':
            out.append(['', 'Current period earnings (unclosed)', pl])
        tot[t] = sum((v for _, v in sec[t]), D0) + (pl if t == 'EQUITY' else D0)
        out.append([f'Total {t.lower()}', '', tot[t]])
    return {'title': f'Statement of Financial Position ({ccy})', 'columns': ['Section', 'Account', 'Amount'], 'rows': out,
            'summary': {'balanced': tot['ASSET'] == tot['LIABILITY'] + tot['EQUITY'], **{k.lower(): v for k, v in tot.items()}}}


def report_cash_flow(f):
    cash = JournalLine.objects.filter(journal__company_id__in=f['company_ids'], account__subtype__in=('CASH', 'BANK', 'MPESA'),
                                      journal__date__lte=f['date_to'])
    opening = cash.filter(journal__date__lt=f['date_from']) if f['date_from'] else cash.none()
    op = (opening.aggregate(d=Sum('debit'), c=Sum('credit')))
    op_bal = (op['d'] or D0) - (op['c'] or D0)
    per = cash.filter(journal__date__gte=f['date_from']) if f['date_from'] else cash
    rows, tin, tout = [], D0, D0
    for r in per.values('journal__source_type').annotate(d=Sum('debit'), c=Sum('credit')).order_by('journal__source_type'):
        rows.append([r['journal__source_type'] or 'Manual journal', r['d'] or D0, r['c'] or D0, (r['d'] or D0) - (r['c'] or D0)])
        tin, tout = tin + (r['d'] or D0), tout + (r['c'] or D0)
    rows.append(['TOTAL', tin, tout, tin - tout])
    return {'title': 'Cash Flow Statement (direct, by source; functional currency of each entity)',
            'columns': ['Source', 'Inflow', 'Outflow', 'Net'], 'rows': rows,
            'summary': {'opening_cash': op_bal, 'net_movement': tin - tout, 'closing_cash': op_bal + tin - tout}}


def report_equity_changes(f):
    eq = _account_balances(f['company_ids'], None, f['date_to'], ('EQUITY',))
    before = _account_balances(f['company_ids'], None, (f['date_from'] - timedelta(days=1)) if f['date_from'] else date.min, ('EQUITY',)) if f['date_from'] else {}
    opening = sum((c - d for d, c in before.values()), D0)
    closing_eq = sum((c - d for d, c in eq.values()), D0)
    pl = report_profit_and_loss(f)['summary']['net_profit']
    return {'title': 'Statement of Changes in Equity', 'columns': ['Item', 'Amount'],
            'rows': [['Opening equity', opening], ['Profit / (loss) for the period', pl],
                     ['Other equity movements', closing_eq - opening], ['Closing equity (booked reserves)', closing_eq]], 'summary': {}}


def _aging(f, receivable):
    as_of, rows, buckets = f['date_to'], [], defaultdict(lambda: [D0] * 5)
    if receivable:
        docs = [(i.customer.name, i) for i in SalesInvoice.objects.filter(company_id__in=f['company_ids'], status__in=('POSTED', 'PART_PAID')).select_related('customer')]
    else:
        carried = TransporterInvoice.objects.exclude(expense=None).values_list('expense_id', flat=True)
        docs = [(i.supplier.name, i) for i in PurchaseInvoice.objects.filter(company_id__in=f['company_ids'], status__in=('POSTED', 'PART_PAID')).select_related('supplier')]
        docs += [(i.transporter.name, i) for i in TransporterInvoice.objects.filter(company_id__in=f['company_ids'], status__in=('POSTED', 'PART_PAID')).select_related('transporter')]
        docs += [(e.payee or 'Expense payee', e) for e in Expense.objects.filter(company_id__in=f['company_ids'], status='POSTED', payment_method='CREDIT').exclude(pk__in=carried)]
    for name, d in docs:
        out = q2(d.outstanding * d.exchange_rate)
        due = getattr(d, 'due_date', None) or getattr(d, 'expense_date', None)
        days = (as_of - due).days if due else 0
        b = 0 if days <= 0 else 1 if days <= 30 else 2 if days <= 60 else 3 if days <= 90 else 4
        buckets[name][b] += out
    rows = [[n, *v, sum(v, D0)] for n, v in sorted(buckets.items())]
    tot = [sum(r[i] for r in rows) if rows else D0 for i in range(1, 7)]
    return {'title': 'Accounts Receivable Aging' if receivable else 'Accounts Payable Aging',
            'columns': ['Party', 'Current', '1-30', '31-60', '61-90', '90+', 'Total'], 'rows': rows + ([['TOTAL', *tot]] if rows else []),
            'summary': {'total': tot[-1]}}


def report_ar_aging(f): return _aging(f, True)
def report_ap_aging(f): return _aging(f, False)


def report_vat(f):
    rows = []
    for co in Company.objects.filter(id__in=f['company_ids']):
        for key, label in (('VAT_INPUT', 'Input tax'), ('VAT_OUTPUT', 'Output tax')):
            a = AccountMapping.objects.filter(company=co, key=key).first()
            if not a:
                continue
            q = JournalLine.objects.filter(account=a.account, journal__date__lte=f['date_to'])
            if f['date_from']:
                q = q.filter(journal__date__gte=f['date_from'])
            s = q.aggregate(d=Sum('debit'), c=Sum('credit'))
            rows.append([co.code, label, s['d'] or D0, s['c'] or D0, (s['d'] or D0) - (s['c'] or D0)])
    return {'title': 'VAT / Tax Report', 'columns': ['Entity', 'Tax account', 'Debits', 'Credits', 'Net'], 'rows': rows, 'summary': {}}


def report_bank_reconciliation(f):
    qs = BankReconciliation.objects.filter(company_id__in=f['company_ids']).select_related('bank_account').order_by('-statement_date')[:50]
    return {'title': 'Bank Reconciliations', 'columns': ['Ref', 'Account', 'Statement date', 'Statement balance', 'Book balance', 'Difference', 'Unmatched', 'Status'],
            'rows': [[r.reference, r.bank_account.name, r.statement_date, r.statement_balance, r.book_balance, r.difference, r.unmatched_count, r.status] for r in qs], 'summary': {}}


# ---- operational
def report_fuel_purchases(f):
    qs = GoodsReceipt.objects.filter(company_id__in=f['company_ids'], receipt_date__lte=f['date_to']).select_related('purchase_order__supplier', 'line__product', 'tank')
    if f['date_from']: qs = qs.filter(receipt_date__gte=f['date_from'])
    if f['product']: qs = qs.filter(line__product_id=f['product'])
    return {'title': 'Fuel Purchases', 'columns': ['Date', 'GRN', 'Supplier', 'Product', 'Tank', 'Basis', 'Litres', 'Cost/L', 'Total cost'],
            'rows': [[g.receipt_date, g.reference, g.purchase_order.supplier.name, g.line.product.name, g.tank.code, g.volume_basis, g.quantity, g.unit_cost, g.total_cost] for g in qs],
            'summary': {'litres': qs.aggregate(s=Sum('quantity'))['s'] or D0, 'cost': qs.aggregate(s=Sum('total_cost'))['s'] or D0}}


def report_fuel_sales(f):
    qs = SalesInvoiceLine.objects.filter(invoice__company_id__in=f['company_ids'], invoice__status__in=('POSTED', 'PART_PAID', 'PAID'), invoice__invoice_date__lte=f['date_to']).select_related('invoice__customer', 'product')
    if f['date_from']: qs = qs.filter(invoice__invoice_date__gte=f['date_from'])
    if f['product']: qs = qs.filter(product_id=f['product'])
    if f['customer']: qs = qs.filter(invoice__customer_id=f['customer'])
    return {'title': 'Fuel Sales', 'columns': ['Date', 'Invoice', 'Customer', 'Product', 'Litres', 'Price/L', 'Net', 'Currency'],
            'rows': [[l.invoice.invoice_date, l.invoice.reference, l.invoice.customer.name, l.product.name, l.quantity, l.unit_price, l.line_total, l.invoice.currency_id] for l in qs],
            'summary': {'litres': qs.aggregate(s=Sum('quantity'))['s'] or D0}}


def report_tank_reconciliation(f):
    qs = TankReconciliation.objects.filter(company_id__in=f['company_ids'], recon_date__lte=f['date_to']).select_related('tank__depot', 'product', 'officer')
    if f['date_from']: qs = qs.filter(recon_date__gte=f['date_from'])
    return {'title': 'Tank Reconciliation', 'columns': ['Date', 'Depot', 'Tank', 'Product', 'Opening', 'Receipts', 'Transfers in', 'Issues', 'Transfers out', 'Closing book', 'Physical', 'Variance', 'Variance value', 'Officer', 'Status'],
            'rows': [[r.recon_date, r.tank.depot.name, r.tank.code, r.product.name, r.opening_qty, r.receipts, r.transfers_in, r.issues, r.transfers_out, r.closing_book, r.physical_qty, r.variance, r.variance_value, str(r.officer or ''), r.status] for r in qs], 'summary': {}}


def report_inventory_movement(f):
    qs = StockMovement.objects.filter(company_id__in=f['company_ids'], movement_date__lte=f['date_to']).select_related('tank', 'product')
    if f['date_from']: qs = qs.filter(movement_date__gte=f['date_from'])
    if f['product']: qs = qs.filter(product_id=f['product'])
    return {'title': 'Inventory Movement', 'columns': ['Date', 'Ref', 'Type', 'Tank', 'Product', 'Litres', 'Unit cost', 'Value', 'Balance after', 'Source'],
            'rows': [[m.movement_date, m.reference, m.movement_type, m.tank.code, m.product.name, m.quantity, m.unit_cost, m.total_cost, m.balance_after, f'{m.source_type} {m.source_id}'] for m in qs.order_by('-movement_date', '-id')[:2000]], 'summary': {}}


def report_stock_valuation(f):
    qs = StockBalance.objects.filter(company_id__in=f['company_ids'], quantity__gt=0).select_related('company', 'tank__depot', 'product')
    if f['product']: qs = qs.filter(product_id=f['product'])
    rows = [[b.company.code, b.tank.depot.name, b.tank.code, b.product.name, b.quantity, b.avg_cost, b.value, valuation_method(b.company, b.product)] for b in qs]
    return {'title': 'Stock Valuation (entity functional currency)', 'columns': ['Entity', 'Depot', 'Tank', 'Product', 'Litres', 'Avg cost/L', 'Value', 'Method'], 'rows': rows,
            'summary': {'litres': sum((r[4] for r in rows), D0)}}


def _latest_sheets(f):
    qs = ShipmentCostSheet.objects.filter(company_id__in=f['company_ids']).select_related('shipment__customer', 'shipment__product', 'shipment__transporter', 'shipment__vehicle').order_by('shipment_id', '-version')
    if f['product']: qs = qs.filter(shipment__product_id=f['product'])
    if f['customer']: qs = qs.filter(shipment__customer_id=f['customer'])
    if f['shipment']: qs = qs.filter(shipment_id=f['shipment'])
    if f['date_from']: qs = qs.filter(shipment__loading_date__gte=f['date_from'])
    seen, out = set(), []
    for s in qs:
        if s.shipment_id not in seen:
            seen.add(s.shipment_id)
            out.append(s)
    return out


def report_shipment_costing(f):
    rows = [[s.shipment.reference, f'v{s.version}{" FINAL" if s.is_final else " prov."}', s.shipment.customer or '', s.shipment.product.name, s.loaded_litres, s.delivered_litres, s.purchase_cost, s.total_direct_expenses, s.total_shipment_cost, s.delivered_cost_per_litre, s.revenue, s.cogs, s.gross_profit, s.contribution, s.margin_pct] for s in _latest_sheets(f)]
    return {'title': 'Shipment Costing', 'columns': ['Shipment', 'Version', 'Customer', 'Product', 'Loaded L', 'Delivered L', 'Purchase cost', 'Direct expenses', 'Total cost', 'Cost/L', 'Revenue', 'COGS', 'Gross profit', 'Contribution', 'Margin %'], 'rows': rows, 'summary': {'contribution': sum((r[13] for r in rows), D0)}}


def report_shipment_profitability(f):
    r = report_shipment_costing(f)
    r['title'] = 'Shipment Profitability'
    r['rows'].sort(key=lambda x: x[13], reverse=True)
    return r


def _group_sheets(f, keyfn, title, label):
    g = defaultdict(lambda: [D0] * 5)
    for s in _latest_sheets(f):
        k = keyfn(s) or 'Unassigned'
        for i, v in enumerate((s.delivered_litres, s.revenue, s.cogs, s.additional_expenses, s.contribution)):
            g[k][i] += v
    rows = [[k, v[0], v[1], v[2], v[3], v[4], q3(v[4] / v[1] * 100) if v[1] else D0] for k, v in sorted(g.items(), key=lambda x: -x[1][4])]
    return {'title': title, 'columns': [label, 'Delivered L', 'Revenue', 'COGS', 'Other direct exp.', 'Contribution', 'Margin %'], 'rows': rows, 'summary': {}}


def report_customer_profitability(f): return _group_sheets(f, lambda s: str(s.shipment.customer or ''), 'Customer Profitability', 'Customer')
def report_product_profitability(f): return _group_sheets(f, lambda s: s.shipment.product.name, 'Product Profitability', 'Product')
def report_transporter_profitability(f): return _group_sheets(f, lambda s: str(s.shipment.transporter) if s.shipment.transporter_id else 'Owned fleet', 'Transporter Profitability', 'Transporter')


def _entity_pl(f, key):
    rows = []
    for co in Company.objects.filter(id__in=f['company_ids']):
        ff = dict(f, company_ids=[co.id])
        s = report_profit_and_loss(ff)['summary']
        rows.append([getattr(co, key) if key != 'country' else co.get_country_display(), co.code, s['currency'], s['revenue'], s['gross_profit'], s['net_profit']])
    return rows


def report_entity_profitability(f):
    return {'title': 'Entity Profitability (functional currencies)', 'columns': ['Entity', 'Code', 'Currency', 'Revenue', 'Gross profit', 'Net profit'], 'rows': _entity_pl(f, 'name'), 'summary': {}}


def report_country_profitability(f):
    return {'title': 'Country Profitability (functional currencies)', 'columns': ['Country', 'Entity', 'Currency', 'Revenue', 'Gross profit', 'Net profit'], 'rows': _entity_pl(f, 'country'), 'summary': {}}


def report_group_consolidated(f):
    run = ConsolidationRun.objects.filter(status='COMPLETED').order_by('-id').first()
    if not run:
        err('Run a consolidation first (Group > Consolidation).')
    r = run.result
    return {'title': f'Group Consolidated ({r["currency"]}) {run.period_start} to {run.period_end}', 'columns': ['Group account', 'Type', 'Amount'],
            'rows': [[l['group_code'], l['type'], dec(l['amount'])] for l in r['lines']], 'summary': {k: r[k] for k in ('group_revenue', 'group_expenses', 'group_profit')}}


def report_fuel_variance(f):
    rows = []
    for s in _latest_sheets(f):
        fv = fuel_variance(s.shipment)
        if s.shortage_litres > 0 or (fv and fv['flag']):
            rows.append([s.shipment.reference, s.loaded_litres, s.delivered_litres, s.shortage_litres, s.shortage_value, fv['expected_litres'] if fv else '', fv['actual_litres'] if fv else '', fv['variance_pct'] if fv else ''])
    return {'title': 'Fuel Variance (transit shortages & truck fuel use)', 'columns': ['Shipment', 'Loaded L', 'Delivered L', 'Shortage L', 'Shortage value', 'Expected truck fuel L', 'Actual truck fuel L', 'Fuel var %'], 'rows': rows, 'summary': {}}


def report_daily_shipments(f):
    qs = Shipment.objects.filter(company_id__in=f['company_ids']).select_related('customer', 'product')
    if f['date_from']: qs = qs.filter(loading_date__gte=f['date_from'])
    qs = qs.filter(Q(loading_date__lte=f['date_to']) | Q(loading_date__isnull=True))
    return {'title': 'Daily Shipments', 'columns': ['Shipment', 'Loading date', 'Customer', 'Product', 'Litres', 'Truck', 'Status', 'Expected delivery'],
            'rows': [[s.reference, s.loading_date, str(s.customer or ''), s.product.name, s.loading_quantity or s.quantity, str(s.vehicle or s.hired_truck or ''), s.status, s.expected_delivery] for s in qs.order_by('-loading_date')[:1000]], 'summary': {}}


def report_daily_operations(f):
    d = f['date_to']
    ids = f['company_ids']
    rows = [['Goods receipts', GoodsReceipt.objects.filter(company_id__in=ids, receipt_date=d).aggregate(s=Sum('quantity'))['s'] or D0],
            ['Litres dispatched', StockMovement.objects.filter(company_id__in=ids, movement_date=d, movement_type='ISSUE').aggregate(s=Sum('quantity'))['s'] or D0],
            ['Litres delivered', ShipmentDelivery.objects.filter(company_id__in=ids, delivery_date=d, status='APPROVED').aggregate(s=Sum('delivered_quantity'))['s'] or D0],
            ['Invoices posted', SalesInvoice.objects.filter(company_id__in=ids, invoice_date=d, status__in=('POSTED', 'PART_PAID', 'PAID')).count()],
            ['Expenses posted', Expense.objects.filter(company_id__in=ids, expense_date=d, status__in=('POSTED', 'PAID')).count()],
            ['Shipments active', Shipment.objects.filter(company_id__in=ids, status__in=ACTIVE_SHIPMENT).count()]]
    return {'title': f'Daily Operations {d}', 'columns': ['Measure', 'Value'], 'rows': rows, 'summary': {}}


# ---- fleet
def _vehicle_rows(f):
    rows = []
    for v in Vehicle.objects.filter(company_id__in=f['company_ids']):
        ex = Expense.objects.filter(vehicle=v, status__in=('POSTED', 'PAID'))
        sh = Shipment.objects.filter(vehicle=v).exclude(status='CANCELLED')
        if f['date_from']: ex, sh = ex.filter(expense_date__gte=f['date_from']), sh.filter(loading_date__gte=f['date_from'])
        cost = sum((e.functional_total for e in ex), D0)
        km, trips = sh.aggregate(s=Sum('distance_km'))['s'] or D0, sh.count()
        sheets = ShipmentCostSheet.objects.filter(shipment__in=sh).order_by('shipment_id', '-version')
        seen, rev, lit = set(), D0, D0
        for s in sheets:
            if s.shipment_id not in seen:
                seen.add(s.shipment_id); rev += s.revenue; lit += s.delivered_litres
        rows.append([v.registration_number, trips, km, cost, q2(cost / km) if km else D0, q2(cost / trips) if trips else D0, q6(cost / lit) if lit else D0, rev, rev - cost])
    return rows


def report_owned_fleet(f):
    return {'title': 'Owned Fleet', 'columns': ['Vehicle', 'Trips', 'Km', 'Operating cost', 'Cost/km', 'Cost/trip', 'Cost/delivered L', 'Revenue', 'Profit'], 'rows': _vehicle_rows(f), 'summary': {}}


def report_vehicle_profitability(f):
    r = report_owned_fleet(f); r['title'] = 'Vehicle Profitability'; r['rows'].sort(key=lambda x: x[-1], reverse=True); return r


def report_trip_costs(f):
    rows = [[s.shipment.reference, str(s.shipment.vehicle or s.shipment.hired_truck or ''), s.shipment.truck_ownership, s.components.get('TRANSPORT_OWNED'), s.components.get('TRANSPORT_HIRED'), s.components.get('DRIVER'), s.components.get('FUEL'), s.components.get('BORDER'), s.total_direct_expenses] for s in _latest_sheets(f)]
    return {'title': 'Trip Costs (owned vs hired kept separate)', 'columns': ['Shipment', 'Truck', 'Ownership', 'Owned transport', 'Hired transport', 'Driver', 'Fuel', 'Border', 'Total direct'], 'rows': rows, 'summary': {}}


def report_hired_fleet(f):
    qs = TransportBooking.objects.filter(company_id__in=f['company_ids']).select_related('transporter', 'truck')
    return {'title': 'Hired Fleet', 'columns': ['Booking', 'Transporter', 'Truck', 'Litres', 'Rate', 'Total charge', 'Advance', 'Balance', 'Status'],
            'rows': [[b.reference, b.transporter.name, b.truck.registration_number, b.quantity, b.contracted_rate, b.total_charge, b.advance_paid, b.balance_payable, b.status] for b in qs], 'summary': {}}


def _expense_by(f, title, **flt):
    qs = Expense.objects.filter(company_id__in=f['company_ids'], status__in=('POSTED', 'PAID'), expense_date__lte=f['date_to'], **flt).select_related('category', 'vehicle')
    if f['date_from']: qs = qs.filter(expense_date__gte=f['date_from'])
    return {'title': title, 'columns': ['Date', 'Ref', 'Category', 'Vehicle', 'Description', 'Total (functional)'],
            'rows': [[e.expense_date, e.reference, e.category.name, str(e.vehicle or ''), e.description, e.functional_total] for e in qs], 'summary': {}}


def report_vehicle_expenses(f): return _expense_by(f, 'Vehicle Expenses', vehicle__isnull=False)
def report_driver_expenses(f): return _expense_by(f, 'Driver Expenses', category__cost_component='DRIVER')


_F, _R, _C, _G = FINANCE_VIEW_ROLES, REPORTS_VIEW_ROLES, COSTING_VIEW_ROLES, GROUP_VIEW_ROLES
REPORTS = {   # name -> (function, roles allowed to run it)
    'trial-balance': (report_trial_balance, _F), 'general-ledger': (report_general_ledger, _F),
    'profit-and-loss': (report_profit_and_loss, _F), 'financial-position': (report_financial_position, _F),
    'cash-flow': (report_cash_flow, _F), 'equity-changes': (report_equity_changes, _F),
    'ar-aging': (report_ar_aging, _F), 'ap-aging': (report_ap_aging, _F),
    'bank-reconciliation': (report_bank_reconciliation, _F), 'vat': (report_vat, _F),
    'daily-operations': (report_daily_operations, _R), 'daily-shipments': (report_daily_shipments, _R),
    'fuel-purchases': (report_fuel_purchases, _R), 'fuel-sales': (report_fuel_sales, _R),
    'tank-reconciliation': (report_tank_reconciliation, _R), 'inventory-movement': (report_inventory_movement, _R),
    'stock-valuation': (report_stock_valuation, _R), 'shipment-costing': (report_shipment_costing, _C),
    'fuel-variance': (report_fuel_variance, _R), 'owned-fleet': (report_owned_fleet, _R),
    'hired-fleet': (report_hired_fleet, _R), 'vehicle-expenses': (report_vehicle_expenses, _R),
    'trip-costs': (report_trip_costs, _C), 'driver-expenses': (report_driver_expenses, _R),
    'vehicle-profitability': (report_vehicle_profitability, _C),
    'customer-profitability': (report_customer_profitability, _C), 'product-profitability': (report_product_profitability, _C),
    'shipment-profitability': (report_shipment_profitability, _C), 'transporter-profitability': (report_transporter_profitability, _C),
    'country-profitability': (report_country_profitability, _F), 'entity-profitability': (report_entity_profitability, _F),
    'group-consolidated': (report_group_consolidated, _G),
}


# =========================================================== dashboard
def _month_start(d, back):
    """First day of the calendar month `back` months before `d`."""
    y, mth = d.year, d.month - back
    while mth < 1:
        mth += 12
        y -= 1
    return d.replace(year=y, month=mth, day=1)


def dashboard_metrics(f, period='monthly'):
    """
    Everything the dashboard page shows, in one payload:
      cards    : single numbers (financial + operational)
      charts   : revenue_trend (line), expense_analysis (donut), shipment_profitability (bar), shipment_status (donut fallback)
      summary  : rows for the summary table (share of revenue is computed here)
    DashboardView strips the financial parts for users without finance access.
    """
    ids, end = f['company_ids'], f['date_to']
    start = f['date_from'] or {'daily': end, 'weekly': end - timedelta(days=6), 'monthly': end.replace(day=1),
                               'annual': end.replace(month=1, day=1)}.get(period, end.replace(day=1))
    rc, missing = _rep_ccy(), set()

    def rep(co, amount, d):
        try:
            return q2(amount * _fx_factor(co, d, rc))
        except ValidationError:
            missing.add(f'{co.functional_currency_id}->{rc}')
            return D0

    cos = {c.id: c for c in Company.objects.filter(id__in=ids)}
    revenue, by_country, purchases, opex, cogs = D0, defaultdict(lambda: D0), D0, D0, D0
    for l in SalesInvoiceLine.objects.filter(invoice__company_id__in=ids, invoice__status__in=('POSTED', 'PART_PAID', 'PAID'),
                                             invoice__invoice_date__range=(start, end)).select_related('invoice'):
        if f['product'] and str(l.product_id) != str(f['product']): continue
        if f['customer'] and str(l.invoice.customer_id) != str(f['customer']): continue
        co = cos[l.invoice.company_id]
        v = rep(co, q2(l.line_total * l.invoice.exchange_rate), end)
        revenue += v
        by_country[co.get_country_display()] += v
    for g in GoodsReceipt.objects.filter(company_id__in=ids, receipt_date__range=(start, end)):
        if f['product'] and str(g.line.product_id) != str(f['product']): continue
        purchases += rep(cos[g.company_id], g.total_cost, end)
    gl = _account_balances(ids, start, end, ('EXPENSE',), exclude_closing=True)
    for a, (d, c) in gl.items():
        v = rep(a.company, d - c, end)
        if a.subtype == 'COGS': cogs += v
        else: opex += v
    gross = revenue - cogs
    net = gross - opex

    def cash_by(sub):
        t = D0
        for co in cos.values():
            t += rep(co, _gl_net_multi(co, sub, end), end)
        return t

    cash, bank, mpesa = cash_by('CASH') + cash_by('PETTY'), cash_by('BANK'), cash_by('MPESA')
    ar = sum((rep(i.company, q2(i.outstanding * i.exchange_rate), end) for i in SalesInvoice.objects.filter(
        company_id__in=ids, status__in=('POSTED', 'PART_PAID')).select_related('company')), D0)
    ap = sum((rep(i.company, q2(i.outstanding * i.exchange_rate), end) for M in (PurchaseInvoice, TransporterInvoice)
             for i in M.objects.filter(company_id__in=ids, status__in=('POSTED', 'PART_PAID')).select_related('company')), D0)
    stock = StockBalance.objects.filter(company_id__in=ids).aggregate(q=Sum('quantity'))['q'] or D0
    transit = ShipmentLine.objects.filter(shipment__company_id__in=ids, shipment__stock_issued=True,
                                          shipment__status__in=ACTIVE_SHIPMENT).aggregate(q=Sum('loaded_quantity'))['q'] or D0
    sh = Shipment.objects.filter(company_id__in=ids)
    if f['product']: sh = sh.filter(product_id=f['product'])
    if f['customer']: sh = sh.filter(customer_id=f['customer'])
    active = sh.filter(status__in=ACTIVE_SHIPMENT + ('APPROVED', 'AWAITING_LOADING')).count()
    delayed = sh.filter(status__in=ACTIVE_SHIPMENT, expected_delivery__lt=timezone.now()).count()
    completed = sh.filter(status__in=('DELIVERED', 'RECONCILIATION_PENDING', 'CLOSED')).count()
    fleet = Vehicle.objects.filter(company_id__in=ids).exclude(status='INACTIVE').count()
    on_trip = Vehicle.objects.filter(company_id__in=ids, status='ON_TRIP').count()
    util = q3(on_trip / fleet * 100) if fleet else D0

    # ---- revenue + margin trend: last 6 calendar months
    months, rev_t, margin_t = [], [], []
    for k in range(5, -1, -1):
        ms = _month_start(end, k)
        me = min((ms.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1), end)
        r = sum((rep(cos[l.invoice.company_id], q2(l.line_total * l.invoice.exchange_rate), me)
                 for l in SalesInvoiceLine.objects.filter(
                     invoice__company_id__in=ids, invoice__status__in=('POSTED', 'PART_PAID', 'PAID'),
                     invoice__invoice_date__range=(ms, me)).select_related('invoice')), D0)
        c = sum((rep(a.company, d - cc, me) for a, (d, cc) in _account_balances(ids, ms, me, ('EXPENSE',), True).items()
                 if a.subtype == 'COGS'), D0)
        months.append(ms.strftime('%b %Y'))
        rev_t.append(r)
        margin_t.append(q3((r - c) / r * 100) if r else D0)

    # ---- expense breakdown
    exp_cat = defaultdict(lambda: D0)
    for e in Expense.objects.filter(company_id__in=ids, status__in=('POSTED', 'PAID'),
                                    expense_date__range=(start, end)).select_related('category', 'company'):
        exp_cat[e.category.name] += rep(e.company, e.functional_total, end)

    # ---- shipment profitability: best 5 plus worst 3 (so losses show up)
    ranked = sorted(_latest_sheets(dict(f, date_from=start)), key=lambda s: -s.contribution)
    top = ranked[:5]
    sheets = top + [s for s in ranked[-3:] if s not in top]

    # ---- shipments by status (operational, not financial)
    status_rows = sh.exclude(status='CANCELLED').values('status').annotate(n=Count('id')).order_by('-n')

    # ---- summary table rows (share of revenue computed here, not in the browser)
    def row(group, label, kind, value, finance=True, pct=False):
        return {'group': group, 'label': label, 'kind': kind, 'value': value, 'finance': finance,
                'share_pct': q3(value / revenue * 100) if (pct and revenue) else None}

    summary = [
        row('Income and profit', 'Group revenue', 'money', revenue, pct=True),
        row('Income and profit', 'Gross profit', 'money', gross, pct=True),
        row('Income and profit', 'Net profit', 'money', net, pct=True),
        row('Costs', 'Total purchases', 'money', purchases, pct=True),
        row('Costs', 'Operating expenses', 'money', opex, pct=True),
        *[row('Revenue by country', name, 'money', v, pct=True) for name, v in sorted(by_country.items(), key=lambda x: -x[1])],
        row('Liquidity', 'Cash balance', 'money', cash),
        row('Liquidity', 'Bank balance', 'money', bank),
        row('Liquidity', 'M-Pesa balance', 'money', mpesa),
        row('Working capital', 'Receivables', 'money', ar),
        row('Working capital', 'Payables', 'money', ap),
        row('Operations', 'Fuel in stock', 'litres', stock, finance=False),
        row('Operations', 'Fuel in transit', 'litres', transit, finance=False),
        row('Operations', 'Active shipments', 'count', active, finance=False),
        row('Operations', 'Completed shipments', 'count', completed, finance=False),
        row('Operations', 'Delayed shipments', 'count', delayed, finance=False),
        row('Operations', 'Fleet utilisation', 'pct', util, finance=False),
    ]

    return {'period': {'from': start, 'to': end, 'granularity': period}, 'currency': rc, 'fx_missing': sorted(missing),
            'cards': {'group_revenue': revenue, 'revenue_by_country': dict(by_country), 'total_purchases': purchases,
                      'operating_expenses': opex, 'gross_profit': gross, 'net_profit': net, 'cash_balance': cash,
                      'bank_balance': bank, 'mpesa_balance': mpesa, 'receivables': ar, 'payables': ap,
                      'fuel_stock_litres': stock, 'stock_in_transit_litres': transit, 'active_shipments': active,
                      'completed_shipments': completed, 'delayed_shipments': delayed, 'fleet_utilization_pct': util},
            'charts': {'revenue_trend': {'labels': months, 'revenue': rev_t, 'margin_pct': margin_t},
                       'expense_analysis': sorted(({'category': k, 'amount': v} for k, v in exp_cat.items()),
                                                  key=lambda x: -x['amount'])[:10],
                       'shipment_profitability': [{'shipment': s.shipment.reference, 'contribution': s.contribution,
                                                   'margin_pct': s.margin_pct} for s in sheets],
                       'shipment_status': [{'status': r['status'], 'count': r['n']} for r in status_rows]},
            'summary': summary}


def _gl_net_multi(company, subtype, on_date):
    return _gl_net(company, subtype, on_date)


# =========================================================== Excel / PDF export
def export_table(title, columns, rows, fmt):
    """Return (bytes, content_type, extension)."""
    clean = lambda v: '' if v is None else (float(v) if isinstance(v, Decimal) else (v if isinstance(v, (int, float, date, datetime)) else str(v)))
    data = [[clean(c) for c in r] for r in rows]
    if fmt == 'xlsx':
        import openpyxl
        from openpyxl.styles import Font, PatternFill
        wb = openpyxl.Workbook(); ws = wb.active; ws.title = title[:30]
        ws.append([title]); ws['A1'].font = Font(bold=True, size=13)
        ws.append(columns)
        for c in ws[2]:
            c.font, c.fill = Font(bold=True, color='FFFFFF'), PatternFill('solid', fgColor='0B1F3A')
        for r in data:
            ws.append([x.replace(tzinfo=None) if isinstance(x, datetime) and x.tzinfo else x for x in r])
        for col in ws.columns:
            ws.column_dimensions[col[0].column_letter].width = min(max(len(str(c.value or '')) for c in col) + 2, 45)
        buf = io.BytesIO(); wb.save(buf)
        return buf.getvalue(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx'
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Table, TableStyle
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=landscape(A4), leftMargin=24, rightMargin=24, topMargin=24, bottomMargin=24)
    t = Table([columns] + [[str(c)[:28] for c in r] for r in data], repeatRows=1)
    t.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#0B1F3A')), ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                           ('FONTSIZE', (0, 0), (-1, -1), 7), ('GRID', (0, 0), (-1, -1), 0.25, colors.lightgrey),
                           ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F3F6F4')])]))
    doc.build([Paragraph(title, getSampleStyleSheet()['Title']), t])
    return buf.getvalue(), 'application/pdf', 'pdf'


def cost_sheet_table(sheet):
    sh = sheet.shipment
    rows = [['Shipment', sh.reference], ['Version', f'{sheet.version} ({"FINAL" if sheet.is_final else "provisional"})'],
            ['Product', sh.product.name], ['Customer', str(sh.customer or '')], ['Loaded litres', sheet.loaded_litres],
            ['Delivered litres', sheet.delivered_litres], ['Shortage litres', sheet.shortage_litres], ['Purchase cost', sheet.purchase_cost]]
    rows += [[k.replace('_', ' ').title(), v] for k, v in sheet.components.items() if dec(v)]
    rows += [['Total direct expenses', sheet.total_direct_expenses], ['TOTAL SHIPMENT COST', sheet.total_shipment_cost],
             ['Delivered cost per litre', sheet.delivered_cost_per_litre], ['Invoiced litres', sheet.invoiced_litres],
             ['Revenue', sheet.revenue], ['COGS', sheet.cogs], ['Gross profit', sheet.gross_profit],
             ['Other direct expenses (not in COGS)', sheet.additional_expenses], ['Contribution', sheet.contribution], ['Margin %', sheet.margin_pct]]
    return f'Shipment Cost Sheet {sh.reference}', ['Item', 'Value'], rows


# =========================================================== AI & intelligence (read-only; alerts only)
def detect_expense_anomalies(company_ids, z=3.0):
    import statistics
    out = []
    for cat in ExpenseCategory.objects.all():
        xs = list(Expense.objects.filter(company_id__in=company_ids, category=cat, status__in=('POSTED', 'PAID')).order_by('id'))
        vals = [float(e.functional_total) for e in xs]
        if len(vals) >= 5 and statistics.pstdev(vals) > 0:
            m, sd = statistics.mean(vals), statistics.pstdev(vals)
            out += [{'expense': e.reference, 'category': cat.name, 'amount': e.functional_total, 'z_score': round((float(e.functional_total) - m) / sd, 2)}
                    for e in xs if abs((float(e.functional_total) - m) / sd) >= z]
    return out


def detect_duplicate_invoices(company_ids):
    out, seen = [], defaultdict(list)
    for i in PurchaseInvoice.objects.filter(company_id__in=company_ids).exclude(status='CANCELLED'):
        seen[(i.company_id, i.supplier_id, i.total, i.invoice_date)].append(i)
    for k, v in seen.items():
        if len(v) > 1:
            out.append({'invoices': [i.supplier_invoice_no for i in v], 'supplier': str(v[0].supplier), 'amount': v[0].total, 'date': v[0].invoice_date})
    return out


def customer_credit_risk(company_ids):
    rows = []
    for c in Customer.objects.filter(company_id__in=company_ids):
        invs = SalesInvoice.objects.filter(customer=c, status__in=('POSTED', 'PART_PAID'))
        od = [i for i in invs if i.due_date and i.due_date < today()]
        exposure, overdue = customer_exposure(c), sum((q2(i.outstanding * i.exchange_rate) for i in od), D0)
        score = min(100, int((overdue / exposure * 60 if exposure else 0) + (max((today() - i.due_date).days for i in od) / 90 * 40 if od else 0)))
        rows.append({'customer': c.name, 'exposure': exposure, 'overdue': overdue, 'credit_limit': c.credit_limit,
                     'utilisation_pct': q3(exposure / c.credit_limit * 100) if c.credit_limit else None, 'risk_score': score,
                     'risk': 'HIGH' if score >= 60 else 'MEDIUM' if score >= 30 else 'LOW'})
    return sorted(rows, key=lambda r: -r['risk_score'])


def cash_forecast(company_ids, days=30):
    cos = Company.objects.filter(id__in=company_ids)
    rc, cash = _rep_ccy(), D0
    for c in cos:
        cash += sum((q2(_gl_net(c, s, today()) * _fx_factor(c, today(), rc)) for s in ('CASH', 'BANK', 'MPESA', 'PETTY')), D0)
    horizon, inflow, outflow = today() + timedelta(days=days), D0, D0
    for i in SalesInvoice.objects.filter(company_id__in=company_ids, status__in=('POSTED', 'PART_PAID'), due_date__lte=horizon).select_related('company'):
        inflow += q2(i.outstanding * i.exchange_rate * _fx_factor(i.company, today(), rc))
    for M in (PurchaseInvoice, TransporterInvoice):
        for i in M.objects.filter(company_id__in=company_ids, status__in=('POSTED', 'PART_PAID'), due_date__lte=horizon).select_related('company'):
            outflow += q2(i.outstanding * i.exchange_rate * _fx_factor(i.company, today(), rc))
    return {'currency': rc, 'horizon_days': days, 'opening_cash': cash, 'expected_collections': inflow, 'expected_payments': outflow,
            'projected_cash': cash + inflow - outflow, 'basis': 'Open invoices falling due within the horizon (no assumed new sales).'}


def price_recommendation(company, product, target_margin_pct):
    cost = estimate_cost_per_litre(company, product)
    if cost is None:
        err('No cost history for this product.')
    r = calc_price('COST_PLUS', cost=cost, margin_pct=target_margin_pct)
    last = SalesInvoiceLine.objects.filter(invoice__company=company, product=product, invoice__status__in=('POSTED', 'PART_PAID', 'PAID')).order_by('-id').first()
    r['last_selling_price'] = last.unit_price if last else None
    return r


def supplier_price_comparison(company_ids, product_id=None):
    qs = SupplierPrice.objects.filter(company_id__in=company_ids).select_related('supplier', 'product', 'currency').order_by('supplier_id', 'product_id', '-effective_date', '-id')
    seen, rows = set(), []
    for p in qs:
        if product_id and str(p.product_id) != str(product_id): continue
        if (p.supplier_id, p.product_id) in seen: continue
        seen.add((p.supplier_id, p.product_id))
        rows.append({'supplier': p.supplier.name, 'product': p.product.name, 'price': p.price, 'currency': p.currency_id, 'date': p.effective_date, 'source': p.source})
    return sorted(rows, key=lambda r: (r['product'], r['price']))


@transaction.atomic
def run_ai_scan(company_ids, user):
    """Persist rule-based findings as Alerts. Alerts inform humans; nothing is approved or posted."""
    made = []
    def add(co, kind, sev, msg, data):
        made.append(Alert.objects.create(company_id=co, kind=kind, severity=sev, message=msg, data=json.loads(json.dumps(data, default=str)), created_by=user))
    co0 = company_ids[0] if company_ids else None
    for a in detect_expense_anomalies(company_ids): add(co0, 'EXPENSE_ANOMALY', 'WARNING', f'Unusual expense {a["expense"]} in {a["category"]} (z={a["z_score"]})', a)
    for d in detect_duplicate_invoices(company_ids): add(co0, 'DUPLICATE_INVOICE', 'CRITICAL', f'Possible duplicate invoices from {d["supplier"]}: {", ".join(d["invoices"])}', d)
    for s in Shipment.objects.filter(company_id__in=company_ids, fuel_used_litres__gt=0):
        fv = fuel_variance(s)
        if fv and fv['flag']: add(s.company_id, 'FUEL_VARIANCE', 'WARNING', f'{s.reference}: truck fuel {fv["variance_pct"]}% above norm', fv)
    for r in customer_credit_risk(company_ids):
        if r['risk'] == 'HIGH': add(co0, 'CREDIT_RISK', 'CRITICAL', f'{r["customer"]} is high credit risk (score {r["risk_score"]})', r)
    return made


def ai_answer(question, f):
    """Deterministic natural-language assistant: maps questions to real database queries (no invented numbers)."""
    q, ids = question.lower(), f['company_ids']
    ff = dict(f, date_from=f['date_to'].replace(day=1))
    sheets = _latest_sheets(ff if ('month' in q) else dict(f, date_from=None))
    if 'highest profit' in q or 'most profit' in q:
        s = max(sheets, key=lambda s: s.contribution, default=None)
        return {'intent': 'top_shipment', 'answer': f'{s.shipment.reference} made the highest contribution: {s.contribution} (margin {s.margin_pct}%).' if s else 'No costed shipments found.', 'data': []}
    if 'transporter' in q and ('expensive' in q or 'cost' in q):
        rows = TransportBooking.objects.filter(company_id__in=ids, quantity__gt=0).exclude(status='CANCELLED').values('transporter__name').annotate(c=Sum('total_charge'), l=Sum('quantity'))
        rk = sorted(((r['transporter__name'], q6(r['c'] / r['l'])) for r in rows), key=lambda x: -x[1])
        return {'intent': 'transporter_cost', 'answer': f'{rk[0][0]} is the most expensive at {rk[0][1]} per litre.' if rk else 'No transporter bookings yet.', 'data': rk}
    if 'transport cost per litre' in q or 'average transport' in q:
        t = sum((dec(s.components.get('TRANSPORT_HIRED')) + dec(s.components.get('TRANSPORT_OWNED')) for s in sheets), D0)
        l = sum((s.delivered_litres for s in sheets), D0)
        return {'intent': 'avg_transport', 'answer': f'Average transport cost is {q6(t / l)} per delivered litre.' if l else 'No delivered litres yet.', 'data': []}
    if 'overdue' in q:
        rows = [[r['customer'], r['overdue']] for r in customer_credit_risk(ids) if r['overdue']]
        return {'intent': 'overdue', 'answer': f'{len(rows)} customer(s) have overdue balances.' if rows else 'No overdue customer balances.', 'data': rows}
    if 'border' in q:
        t = sum((dec(s.components.get('BORDER')) + dec(s.components.get('CLEARING')) for s in sheets), D0)
        return {'intent': 'border_spend', 'answer': f'Border and clearing spend on costed shipments: {t}.', 'data': []}
    if 'profit' in q and ('kenya' in q or 'drc' in q or 'congo' in q):
        code = 'KE' if 'kenya' in q else 'CD'
        co = Company.objects.filter(country=code, id__in=ids).first()
        if not co: return {'intent': 'entity_profit', 'answer': 'You do not have access to that entity.', 'data': []}
        s = report_profit_and_loss(dict(f, company_ids=[co.id]))['summary']
        return {'intent': 'entity_profit', 'answer': f'{co.name} net profit: {s["net_profit"]} {s["currency"]} (revenue {s["revenue"]}).', 'data': []}
    if 'top' in q and 'expense' in q:
        rows = Expense.objects.filter(company_id__in=ids, status__in=('POSTED', 'PAID')).values('category__name').annotate(t=Sum('functional_total')).order_by('-t')[:5]
        return {'intent': 'top_expenses', 'answer': 'Top expenses: ' + '; '.join(f'{r["category__name"]} {r["t"]}' for r in rows), 'data': list(rows)}
    if 'fuel loss' in q or 'shortage' in q or 'loss' in q:
        rows = [[s.shipment.reference, s.shortage_litres, s.shortage_value] for s in sheets if s.shortage_litres > 0]
        return {'intent': 'fuel_loss', 'answer': f'{len(rows)} shipment(s) had transit losses.' if rows else 'No shipment losses recorded.', 'data': rows}
    if 'cash' in q and ('project' in q or 'forecast' in q or 'position' in q):
        c = cash_forecast(ids)
        return {'intent': 'cash_forecast', 'answer': f'Projected 30-day cash: {c["projected_cash"]} {c["currency"]}. {c["basis"]}', 'data': [c]}
    return {'intent': 'unknown', 'answer': 'I can answer questions on shipment profit, transporter cost, border spend, overdue customers, entity profit, top expenses, fuel losses and cash projection.', 'data': []}


# =========================================================== roles (no permission table any more)
ROLE_NAMES = {'GROUP_ADMIN': 'Group Administrator', 'MD': 'Managing Director', 'KE_FINANCE_MANAGER': 'Kenya Finance Manager',
              'DRC_FINANCE_MANAGER': 'DRC Finance Manager', 'ACCOUNTANT': 'Accountant', 'PROCUREMENT_MANAGER': 'Procurement Manager',
              'PROCUREMENT_OFFICER': 'Procurement Officer', 'SALES_MANAGER': 'Sales Manager', 'SALES_OFFICER': 'Sales Officer',
              'FLEET_MANAGER': 'Fleet Manager', 'LOGISTICS_MANAGER': 'Logistics Manager', 'STORE_MANAGER': 'Store Manager',
              'CASHIER': 'Cashier', 'INTERNAL_AUDITOR': 'Internal Auditor', 'READONLY_MANAGER': 'Read-only Manager'}


def seed_roles():
    """Creates the Role rows only. What each role can open is defined in src/navigation.js and the role sets above."""
    for code, name in ROLE_NAMES.items():
        Role.objects.get_or_create(code=code, defaults={'name': name})