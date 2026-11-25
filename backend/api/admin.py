"""
PetroERP Django admin.

Design notes
------------
* Immutable records (Journal, JournalLine, StockMovement, ShipmentStatusHistory, AuditLog,
  PaymentAllocation, Payslip, IntercompanyBalance, EliminationJournal, ShipmentCostSheet)
  do not allow add/change/delete — even superusers. That mirrors the model guards and
  services rules. If you need to correct something, use the API (reversing entry).
* Status for STATUS_MANAGED workflow documents is not editable here either — status is
  driven only by services (submit → approve → post). Admin is for master data, config,
  inspection and support, not for bypassing the workflow.
* Every list page shows the useful identifying columns, and everything FK-heavy is
  searchable in a small dropdown (`autocomplete_fields` where the target has a search field,
  otherwise `raw_id_fields`).
"""
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin

from . import models as m


# ----------------------------------------------------------------------------- helpers
class ReadOnlyAdmin(admin.ModelAdmin):
    """No add / change / delete. Detail view still available for inspection."""

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def get_actions(self, request):
        return {}


class ImmutableInline(admin.TabularInline):
    """Read-only inline used on the immutable headers (Journal, PayrollRun...)."""
    can_delete = False
    extra = 0
    show_change_link = False

    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False


# =============================================================================
# CONTROL
# =============================================================================
@admin.register(m.Permission)
class PermissionAdmin(admin.ModelAdmin):
    list_display = ('code', 'description')
    search_fields = ('code', 'description')
    ordering = ('code',)


@admin.register(m.Role)
class RoleAdmin(admin.ModelAdmin):
    list_display = ('code', 'name', 'permission_count')
    search_fields = ('code', 'name')
    filter_horizontal = ('permissions',)

    @admin.display(description='Permissions')
    def permission_count(self, obj):
        return obj.permissions.count()


@admin.register(m.User)
class UserAdmin(DjangoUserAdmin):
    list_display = ('username', 'full_name', 'email', 'role', 'is_active', 'is_superuser')
    list_filter = ('is_active', 'is_superuser', 'role', 'companies')
    search_fields = ('username', 'first_name', 'last_name', 'email', 'phone')
    autocomplete_fields = ('role',)
    filter_horizontal = ('companies', 'groups', 'user_permissions')
    fieldsets = DjangoUserAdmin.fieldsets + (
        ('PetroERP', {'fields': ('role', 'companies', 'phone')}),
    )
    add_fieldsets = DjangoUserAdmin.add_fieldsets + (
        ('PetroERP', {'fields': ('role', 'companies', 'phone')}),
    )

    @admin.display(description='Name')
    def full_name(self, obj):
        return obj.get_full_name() or obj.username


@admin.register(m.Currency)
class CurrencyAdmin(admin.ModelAdmin):
    list_display = ('code', 'name', 'symbol', 'decimal_places', 'is_active')
    list_filter = ('is_active',)
    search_fields = ('code', 'name')
    ordering = ('code',)


@admin.register(m.Company)
class CompanyAdmin(admin.ModelAdmin):
    list_display = ('code', 'name', 'country', 'functional_currency', 'inventory_valuation', 'is_active')
    list_filter = ('country', 'inventory_valuation', 'is_active')
    search_fields = ('code', 'name', 'tax_pin', 'registration_number')
    autocomplete_fields = ('functional_currency',)


@admin.register(m.ExchangeRate)
class ExchangeRateAdmin(admin.ModelAdmin):
    list_display = ('rate_date', 'from_currency', 'to_currency', 'rate', 'source')
    list_filter = ('source', 'from_currency', 'to_currency')
    search_fields = ('from_currency__code', 'to_currency__code', 'source')
    autocomplete_fields = ('from_currency', 'to_currency')
    date_hierarchy = 'rate_date'
    ordering = ('-rate_date',)


@admin.register(m.Branch)
class BranchAdmin(admin.ModelAdmin):
    list_display = ('code', 'name', 'company', 'is_active')
    list_filter = ('company', 'is_active')
    search_fields = ('code', 'name')
    autocomplete_fields = ('company',)


@admin.register(m.Department)
class DepartmentAdmin(admin.ModelAdmin):
    list_display = ('code', 'name', 'company', 'branch')
    list_filter = ('company',)
    search_fields = ('code', 'name')
    autocomplete_fields = ('company', 'branch')


@admin.register(m.FiscalYear)
class FiscalYearAdmin(admin.ModelAdmin):
    list_display = ('company', 'name', 'start_date', 'end_date', 'status')
    list_filter = ('company', 'status')
    search_fields = ('name',)
    autocomplete_fields = ('company',)


@admin.register(m.AccountingPeriod)
class AccountingPeriodAdmin(admin.ModelAdmin):
    list_display = ('company', 'name', 'fiscal_year', 'start_date', 'end_date', 'status')
    list_filter = ('company', 'status', 'fiscal_year')
    search_fields = ('name',)
    autocomplete_fields = ('company', 'fiscal_year', 'closed_by')
    date_hierarchy = 'start_date'


@admin.register(m.TaxConfig)
class TaxConfigAdmin(admin.ModelAdmin):
    list_display = ('company', 'code', 'name', 'tax_type', 'rate_percent', 'effective_from', 'is_active', 'verified_at')
    list_filter = ('company', 'tax_type', 'is_active')
    search_fields = ('code', 'name')
    autocomplete_fields = ('company', 'verified_by')
    readonly_fields = ('verified_by', 'verified_at')


@admin.register(m.NumberSequence)
class NumberSequenceAdmin(admin.ModelAdmin):
    list_display = ('company', 'doc_type', 'prefix', 'padding', 'next_number')
    list_filter = ('company',)
    search_fields = ('doc_type', 'prefix')
    autocomplete_fields = ('company',)


@admin.register(m.ApprovalPolicy)
class ApprovalPolicyAdmin(admin.ModelAdmin):
    list_display = ('company', 'doc_type', 'min_amount', 'approver_role')
    list_filter = ('company', 'doc_type')
    search_fields = ('doc_type',)
    autocomplete_fields = ('company', 'approver_role')


@admin.register(m.Account)
class AccountAdmin(admin.ModelAdmin):
    list_display = ('code', 'name', 'company', 'account_type', 'subtype', 'is_postable', 'is_active')
    list_filter = ('company', 'account_type', 'is_postable', 'is_active', 'is_intercompany')
    search_fields = ('code', 'name', 'group_code', 'subtype')
    autocomplete_fields = ('company', 'parent')
    ordering = ('company', 'code')


@admin.register(m.AccountMapping)
class AccountMappingAdmin(admin.ModelAdmin):
    list_display = ('company', 'key', 'account')
    list_filter = ('company', 'key')
    search_fields = ('key', 'account__code', 'account__name')
    autocomplete_fields = ('company', 'account')


class ApprovalActionInline(admin.TabularInline):
    model = m.ApprovalAction
    extra = 0
    can_delete = False
    readonly_fields = ('actor', 'action', 'comment', 'created_at')

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(m.ApprovalRequest)
class ApprovalRequestAdmin(admin.ModelAdmin):
    list_display = ('id', 'company', 'doc_type', 'object_id', 'summary', 'amount', 'status', 'created_at')
    list_filter = ('company', 'doc_type', 'status')
    search_fields = ('summary', 'doc_type')
    autocomplete_fields = ('company', 'decided_by')
    readonly_fields = ('content_type', 'object_id', 'target', 'created_at', 'updated_at', 'decided_at', 'decided_by')
    inlines = (ApprovalActionInline,)
    date_hierarchy = 'created_at'


@admin.register(m.AuditLog)
class AuditLogAdmin(ReadOnlyAdmin):
    list_display = ('id', 'created_at', 'user', 'company', 'action', 'model_name', 'object_repr', 'ip_address')
    list_filter = ('action', 'model_name', 'company')
    search_fields = ('object_repr', 'object_id', 'action', 'model_name')
    autocomplete_fields = ('user', 'company')
    date_hierarchy = 'created_at'


@admin.register(m.Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'company', 'title', 'level', 'is_read', 'created_at')
    list_filter = ('level', 'is_read', 'company')
    search_fields = ('title', 'message')
    autocomplete_fields = ('user', 'company')
    readonly_fields = ('created_at',)


@admin.register(m.Attachment)
class AttachmentAdmin(admin.ModelAdmin):
    list_display = ('id', 'company', 'content_type', 'object_id', 'file', 'description', 'created_at')
    list_filter = ('content_type', 'company')
    search_fields = ('description',)
    autocomplete_fields = ('company',)
    readonly_fields = ('content_type', 'object_id', 'target', 'created_at', 'updated_at', 'created_by')


@admin.register(m.Alert)
class AlertAdmin(admin.ModelAdmin):
    list_display = ('id', 'company', 'kind', 'severity', 'message', 'is_resolved', 'created_at')
    list_filter = ('kind', 'severity', 'is_resolved', 'company')
    search_fields = ('kind', 'message')
    autocomplete_fields = ('company',)


# =============================================================================
# SUPPLIERS
# =============================================================================
class SupplierContactInline(admin.TabularInline):
    model = m.SupplierContact
    extra = 0


@admin.register(m.Supplier)
class SupplierAdmin(admin.ModelAdmin):
    list_display = ('code', 'name', 'company', 'country', 'status', 'payment_terms_days', 'credit_limit')
    list_filter = ('company', 'country', 'status')
    search_fields = ('code', 'name', 'tax_pin', 'contact_person', 'phone', 'email')
    autocomplete_fields = ('company', 'currency')
    inlines = (SupplierContactInline,)


@admin.register(m.SupplierContact)
class SupplierContactAdmin(admin.ModelAdmin):
    list_display = ('name', 'supplier', 'position', 'phone', 'email')
    search_fields = ('name', 'supplier__name', 'phone', 'email')
    autocomplete_fields = ('supplier',)


@admin.register(m.SupplierContract)
class SupplierContractAdmin(admin.ModelAdmin):
    list_display = ('reference', 'supplier', 'product', 'start_date', 'end_date', 'status')
    list_filter = ('status', 'company')
    search_fields = ('reference', 'supplier__name')
    autocomplete_fields = ('company', 'supplier', 'product')
    readonly_fields = ('reference',)


@admin.register(m.SupplierPrice)
class SupplierPriceAdmin(admin.ModelAdmin):
    list_display = ('effective_date', 'supplier', 'product', 'price', 'currency', 'source')
    list_filter = ('source', 'company', 'currency')
    search_fields = ('supplier__name', 'product__code', 'product__name')
    autocomplete_fields = ('company', 'supplier', 'product', 'currency')
    date_hierarchy = 'effective_date'


@admin.register(m.SupplierQuotation)
class SupplierQuotationAdmin(admin.ModelAdmin):
    list_display = ('reference', 'supplier', 'product', 'quantity', 'unit_price', 'currency', 'status')
    list_filter = ('status', 'company')
    search_fields = ('reference', 'supplier__name')
    autocomplete_fields = ('company', 'supplier', 'product', 'currency')
    readonly_fields = ('reference',)


# =============================================================================
# PRODUCTS & INVENTORY
# =============================================================================
@admin.register(m.Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = ('code', 'name', 'category', 'unit', 'valuation_method', 'min_margin_pct', 'status')
    list_filter = ('category', 'valuation_method', 'status')
    search_fields = ('code', 'name')
    ordering = ('code',)


@admin.register(m.Depot)
class DepotAdmin(admin.ModelAdmin):
    list_display = ('code', 'name', 'company', 'country', 'is_active')
    list_filter = ('company', 'country', 'is_active')
    search_fields = ('code', 'name', 'location')
    autocomplete_fields = ('company',)


@admin.register(m.StorageTank)
class StorageTankAdmin(admin.ModelAdmin):
    # NOTE: StorageTank has no `name` field (Coded only gives `code`).
    list_display = ('code', 'depot', 'product', 'capacity', 'min_level', 'status')
    list_filter = ('depot', 'product', 'status')
    search_fields = ('code',)
    autocomplete_fields = ('company', 'depot', 'product')


@admin.register(m.TankCalibration)
class TankCalibrationAdmin(admin.ModelAdmin):
    list_display = ('tank', 'calibration_date', 'certificate_no', 'next_due', 'calibrated_by')
    search_fields = ('certificate_no', 'calibrated_by')
    autocomplete_fields = ('tank',)
    date_hierarchy = 'calibration_date'


@admin.register(m.StockBalance)
class StockBalanceAdmin(admin.ModelAdmin):
    list_display = ('tank', 'product', 'company', 'quantity', 'value', 'avg_cost')
    list_filter = ('company', 'product')
    search_fields = ('tank__code', 'product__code', 'product__name')
    autocomplete_fields = ('company', 'tank', 'product')


@admin.register(m.StockLayer)
class StockLayerAdmin(admin.ModelAdmin):
    list_display = ('tank', 'product', 'received_date', 'remaining_qty', 'unit_cost')
    list_filter = ('company', 'product')
    search_fields = ('tank__code', 'product__code')
    autocomplete_fields = ('company', 'tank', 'product')
    date_hierarchy = 'received_date'


@admin.register(m.StockMovement)
class StockMovementAdmin(ReadOnlyAdmin):
    list_display = ('reference', 'movement_date', 'movement_type', 'tank', 'product', 'quantity', 'unit_cost', 'balance_after')
    list_filter = ('movement_type', 'company', 'product')
    search_fields = ('reference', 'narration')
    autocomplete_fields = ('company', 'tank', 'product', 'shipment', 'created_by')
    date_hierarchy = 'movement_date'


@admin.register(m.StockReservation)
class StockReservationAdmin(admin.ModelAdmin):
    list_display = ('reference', 'company', 'depot', 'product', 'quantity', 'status', 'sales_order')
    list_filter = ('status', 'company')
    search_fields = ('reference',)
    autocomplete_fields = ('company', 'depot', 'product', 'sales_order', 'shipment')
    readonly_fields = ('reference',)


@admin.register(m.TankReading)
class TankReadingAdmin(admin.ModelAdmin):
    list_display = ('tank', 'reading_date', 'reading_type', 'observed_volume', 'temperature_c', 'density')
    list_filter = ('reading_type', 'company')
    search_fields = ('tank__code',)
    autocomplete_fields = ('company', 'tank')
    date_hierarchy = 'reading_date'


@admin.register(m.TankReconciliation)
class TankReconciliationAdmin(admin.ModelAdmin):
    list_display = ('reference', 'recon_date', 'tank', 'product', 'closing_book', 'physical_qty', 'variance', 'status')
    list_filter = ('status', 'company')
    search_fields = ('reference', 'tank__code')
    autocomplete_fields = ('company', 'tank', 'product', 'officer', 'adjustment')
    readonly_fields = ('reference',)
    date_hierarchy = 'recon_date'


@admin.register(m.StockAdjustment)
class StockAdjustmentAdmin(admin.ModelAdmin):
    list_display = ('reference', 'adjustment_date', 'tank', 'product', 'quantity', 'value', 'status')
    list_filter = ('status', 'company')
    search_fields = ('reference', 'reason')
    autocomplete_fields = ('company', 'tank', 'product')
    readonly_fields = ('reference',)
    date_hierarchy = 'adjustment_date'


@admin.register(m.StockTransfer)
class StockTransferAdmin(admin.ModelAdmin):
    list_display = ('reference', 'transfer_date', 'from_tank', 'to_tank', 'quantity', 'status')
    list_filter = ('status', 'company')
    search_fields = ('reference',)
    autocomplete_fields = ('company', 'from_tank', 'to_tank')
    readonly_fields = ('reference',)
    date_hierarchy = 'transfer_date'


# =============================================================================
# PROCUREMENT
# =============================================================================
@admin.register(m.PurchaseRequisition)
class PurchaseRequisitionAdmin(admin.ModelAdmin):
    list_display = ('reference', 'product', 'quantity', 'required_date', 'status')
    list_filter = ('status', 'company')
    search_fields = ('reference', 'reason')
    autocomplete_fields = ('company', 'department', 'product')
    readonly_fields = ('reference',)


class PurchaseOrderLineInline(admin.TabularInline):
    model = m.PurchaseOrderLine
    extra = 0
    fields = ('product', 'quantity', 'unit_price', 'tax_code', 'tax_rate', 'tax_amount', 'line_total', 'received_quantity')
    readonly_fields = ('tax_amount', 'line_total')
    autocomplete_fields = ('product',)


@admin.register(m.PurchaseOrder)
class PurchaseOrderAdmin(admin.ModelAdmin):
    list_display = ('reference', 'supplier', 'order_date', 'expected_loading_date', 'total', 'status')
    list_filter = ('status', 'company', 'supplier')
    search_fields = ('reference', 'supplier__name')
    autocomplete_fields = ('company', 'supplier', 'requisition', 'loading_depot', 'currency')
    readonly_fields = ('reference', 'exchange_rate', 'rate_date', 'rate_source', 'subtotal', 'tax_total', 'total')
    inlines = (PurchaseOrderLineInline,)
    date_hierarchy = 'order_date'


@admin.register(m.PurchaseOrderLine)
class PurchaseOrderLineAdmin(admin.ModelAdmin):
    """Registered so PurchaseOrderLine.autocomplete_fields work in other admins."""
    list_display = ('id', 'order', 'product', 'quantity', 'unit_price',
                    'received_quantity', 'tax_amount', 'line_total')
    list_filter = ('order__status',)
    search_fields = ('order__reference', 'product__code', 'product__name')
    autocomplete_fields = ('order', 'product')


@admin.register(m.GoodsReceipt)
class GoodsReceiptAdmin(admin.ModelAdmin):
    list_display = ('reference', 'receipt_date', 'purchase_order', 'tank', 'quantity',
                    'volume_basis', 'unit_cost', 'total_cost', 'status')
    list_filter = ('status', 'volume_basis', 'company')
    search_fields = ('reference', 'delivery_note', 'vehicle_reg')
    autocomplete_fields = ('company', 'purchase_order', 'line', 'depot', 'tank')
    readonly_fields = ('reference',)


class PurchaseInvoiceLineInline(admin.TabularInline):
    model = m.PurchaseInvoiceLine
    extra = 0
    fields = ('product', 'po_line', 'quantity', 'unit_price', 'tax_code', 'tax_rate', 'tax_amount', 'line_total')
    readonly_fields = ('tax_amount', 'line_total')
    autocomplete_fields = ('product', 'po_line')


@admin.register(m.PurchaseInvoice)
class PurchaseInvoiceAdmin(admin.ModelAdmin):
    list_display = ('reference', 'supplier', 'supplier_invoice_no', 'invoice_date', 'total', 'match_status', 'status')
    list_filter = ('status', 'match_status', 'company', 'supplier')
    search_fields = ('reference', 'supplier_invoice_no', 'supplier__name')
    autocomplete_fields = ('company', 'supplier', 'purchase_order', 'currency', 'journal')
    readonly_fields = ('reference', 'exchange_rate', 'rate_date', 'rate_source', 'subtotal', 'tax_total', 'total',
                       'functional_total', 'amount_paid', 'amount_credited', 'match_status', 'match_notes')
    inlines = (PurchaseInvoiceLineInline,)
    date_hierarchy = 'invoice_date'


@admin.register(m.PurchaseReturn)
class PurchaseReturnAdmin(admin.ModelAdmin):
    list_display = ('reference', 'goods_receipt', 'quantity', 'return_date', 'value', 'status')
    list_filter = ('status', 'company')
    search_fields = ('reference', 'reason')
    autocomplete_fields = ('company', 'goods_receipt')
    readonly_fields = ('reference', 'value')


@admin.register(m.SupplierCreditNote)
class SupplierCreditNoteAdmin(admin.ModelAdmin):
    list_display = ('reference', 'supplier', 'invoice', 'note_date', 'amount', 'tax_amount', 'status')
    list_filter = ('status', 'company', 'supplier')
    search_fields = ('reference', 'supplier__name')
    autocomplete_fields = ('company', 'supplier', 'invoice', 'currency', 'journal')
    readonly_fields = ('reference', 'exchange_rate', 'rate_date', 'rate_source')


# =============================================================================
# CUSTOMERS & SALES
# =============================================================================
class CustomerContactInline(admin.TabularInline):
    model = m.CustomerContact
    extra = 0


@admin.register(m.Customer)
class CustomerAdmin(admin.ModelAdmin):
    list_display = ('code', 'name', 'company', 'country', 'credit_limit', 'credit_period_days', 'status')
    list_filter = ('company', 'country', 'status')
    search_fields = ('code', 'name', 'tax_registration', 'contact_person', 'phone', 'email')
    autocomplete_fields = ('company', 'currency')
    inlines = (CustomerContactInline,)


@admin.register(m.CustomerContact)
class CustomerContactAdmin(admin.ModelAdmin):
    list_display = ('name', 'customer', 'position', 'phone', 'email')
    search_fields = ('name', 'customer__name', 'phone', 'email')
    autocomplete_fields = ('customer',)


@admin.register(m.CustomerCreditLimit)
class CustomerCreditLimitAdmin(admin.ModelAdmin):
    list_display = ('customer', 'limit', 'effective_date', 'approved_by', 'reason')
    search_fields = ('customer__name', 'reason')
    autocomplete_fields = ('customer', 'approved_by')
    date_hierarchy = 'effective_date'


@admin.register(m.CustomerContract)
class CustomerContractAdmin(admin.ModelAdmin):
    list_display = ('reference', 'customer', 'product', 'pricing_method', 'price_per_litre', 'valid_from', 'valid_to', 'status')
    list_filter = ('status', 'pricing_method', 'company')
    search_fields = ('reference', 'customer__name')
    autocomplete_fields = ('company', 'customer', 'product', 'currency')
    readonly_fields = ('reference',)


@admin.register(m.MarketPrice)
class MarketPriceAdmin(admin.ModelAdmin):
    list_display = ('reference_date', 'product', 'market_reference', 'base_price', 'currency', 'source')
    list_filter = ('company', 'currency')
    search_fields = ('market_reference', 'source', 'product__code')
    autocomplete_fields = ('company', 'product', 'currency')
    date_hierarchy = 'reference_date'


@admin.register(m.SalesQuotation)
class SalesQuotationAdmin(admin.ModelAdmin):
    list_display = ('reference', 'customer', 'product', 'quantity', 'quote_date', 'selling_price', 'status')
    list_filter = ('status', 'pricing_method', 'company')
    search_fields = ('reference', 'customer__name')
    autocomplete_fields = ('company', 'customer', 'product', 'currency')
    readonly_fields = ('reference', 'exchange_rate', 'rate_date', 'rate_source')
    date_hierarchy = 'quote_date'


class SalesOrderLineInline(admin.TabularInline):
    model = m.SalesOrderLine
    extra = 0
    fields = ('product', 'quantity', 'pricing_method', 'unit_price', 'cost_per_litre',
              'margin_pct', 'delivered_quantity', 'invoiced_quantity', 'tax_amount', 'line_total')
    readonly_fields = ('margin_pct', 'tax_amount', 'line_total', 'delivered_quantity', 'invoiced_quantity')
    autocomplete_fields = ('product',)


@admin.register(m.SalesOrder)
class SalesOrderAdmin(admin.ModelAdmin):
    list_display = ('reference', 'customer', 'order_date', 'required_date', 'total', 'status')
    list_filter = ('status', 'company', 'customer')
    search_fields = ('reference', 'customer__name')
    autocomplete_fields = ('company', 'customer', 'contract', 'quotation', 'currency')
    readonly_fields = ('reference', 'exchange_rate', 'rate_date', 'rate_source', 'subtotal', 'tax_total', 'total')
    inlines = (SalesOrderLineInline,)
    date_hierarchy = 'order_date'


@admin.register(m.SalesOrderLine)
class SalesOrderLineAdmin(admin.ModelAdmin):
    """Registered so SalesOrderLine.autocomplete_fields work in other admins."""
    list_display = ('id', 'order', 'product', 'quantity', 'pricing_method',
                    'unit_price', 'margin_pct', 'delivered_quantity', 'invoiced_quantity')
    list_filter = ('order__status', 'pricing_method')
    search_fields = ('order__reference', 'product__code', 'product__name')
    autocomplete_fields = ('order', 'product')


class SalesInvoiceLineInline(admin.TabularInline):
    model = m.SalesInvoiceLine
    extra = 0
    fields = ('product', 'order_line', 'shipment', 'quantity', 'unit_price', 'tax_code',
              'tax_rate', 'tax_amount', 'line_total')
    readonly_fields = ('tax_amount', 'line_total')
    autocomplete_fields = ('product', 'order_line', 'shipment')


@admin.register(m.SalesInvoice)
class SalesInvoiceAdmin(admin.ModelAdmin):
    list_display = ('reference', 'customer', 'invoice_date', 'total', 'amount_paid', 'amount_credited', 'status')
    list_filter = ('status', 'company', 'customer')
    search_fields = ('reference', 'customer__name')
    autocomplete_fields = ('company', 'customer', 'sales_order', 'currency', 'journal')
    readonly_fields = ('reference', 'exchange_rate', 'rate_date', 'rate_source', 'subtotal', 'tax_total', 'total',
                       'functional_total', 'amount_paid', 'amount_credited')
    inlines = (SalesInvoiceLineInline,)
    date_hierarchy = 'invoice_date'


@admin.register(m.SalesCreditNote)
class SalesCreditNoteAdmin(admin.ModelAdmin):
    list_display = ('reference', 'invoice', 'product', 'note_date', 'quantity', 'unit_price', 'total', 'status')
    list_filter = ('status', 'company')
    search_fields = ('reference', 'reason')
    autocomplete_fields = ('company', 'invoice', 'shipment', 'product', 'restock_tank', 'currency', 'journal')
    readonly_fields = ('reference', 'exchange_rate', 'rate_date', 'rate_source',
                       'subtotal', 'tax_total', 'total')


# =============================================================================
# FLEET
# =============================================================================
@admin.register(m.Vehicle)
class VehicleAdmin(admin.ModelAdmin):
    list_display = ('code', 'registration_number', 'make', 'model', 'truck_type', 'ownership', 'status')
    list_filter = ('company', 'ownership', 'status')
    search_fields = ('code', 'registration_number', 'make', 'model')
    autocomplete_fields = ('company', 'trailer')


@admin.register(m.Trailer)
class TrailerAdmin(admin.ModelAdmin):
    list_display = ('code', 'registration_number', 'capacity', 'status')
    list_filter = ('company', 'status')
    search_fields = ('code', 'registration_number')
    autocomplete_fields = ('company',)


@admin.register(m.Driver)
class DriverAdmin(admin.ModelAdmin):
    list_display = ('code', 'full_name', 'licence_number', 'licence_category', 'licence_expiry', 'employment_status')
    list_filter = ('company', 'employment_status')
    search_fields = ('code', 'full_name', 'id_number', 'licence_number', 'phone')
    autocomplete_fields = ('company',)
    date_hierarchy = 'licence_expiry'


@admin.register(m.VehicleAssignment)
class VehicleAssignmentAdmin(admin.ModelAdmin):
    list_display = ('vehicle', 'driver', 'shipment', 'start_at', 'end_at', 'status')
    list_filter = ('status', 'company')
    search_fields = ('vehicle__registration_number', 'driver__full_name')
    autocomplete_fields = ('company', 'vehicle', 'trailer', 'driver', 'shipment')


@admin.register(m.VehicleMaintenance)
class VehicleMaintenanceAdmin(admin.ModelAdmin):
    list_display = ('vehicle', 'maintenance_type', 'maintenance_date', 'cost', 'odometer_km', 'next_due_date', 'vendor')
    list_filter = ('maintenance_type', 'company')
    search_fields = ('vehicle__registration_number', 'description', 'vendor')
    autocomplete_fields = ('company', 'vehicle', 'currency', 'expense')
    date_hierarchy = 'maintenance_date'


@admin.register(m.VehicleExpense)
class VehicleExpenseAdmin(admin.ModelAdmin):
    list_display = ('vehicle', 'expense_type', 'expense_date', 'litres', 'odometer_km', 'amount', 'shipment')
    list_filter = ('expense_type', 'company')
    search_fields = ('vehicle__registration_number',)
    autocomplete_fields = ('company', 'vehicle', 'shipment', 'expense')
    date_hierarchy = 'expense_date'


@admin.register(m.VehicleDocument)
class VehicleDocumentAdmin(admin.ModelAdmin):
    list_display = ('vehicle', 'doc_type', 'number', 'expiry_date')
    list_filter = ('doc_type', 'company')
    search_fields = ('vehicle__registration_number', 'number')
    autocomplete_fields = ('company', 'vehicle')
    date_hierarchy = 'expiry_date'


# =============================================================================
# THIRD-PARTY TRANSPORT
# =============================================================================
@admin.register(m.Transporter)
class TransporterAdmin(admin.ModelAdmin):
    list_display = ('code', 'name', 'company', 'contact_person', 'phone', 'payment_terms_days', 'status')
    list_filter = ('company', 'status')
    search_fields = ('code', 'name', 'tax_pin', 'contact_person', 'phone', 'email')
    autocomplete_fields = ('company', 'currency')


@admin.register(m.TransporterContract)
class TransporterContractAdmin(admin.ModelAdmin):
    list_display = ('reference', 'transporter', 'start_date', 'end_date', 'status')
    list_filter = ('status', 'company')
    search_fields = ('reference', 'transporter__name')
    autocomplete_fields = ('company', 'transporter')
    readonly_fields = ('reference',)


@admin.register(m.TransporterRate)
class TransporterRateAdmin(admin.ModelAdmin):
    list_display = ('transporter', 'origin', 'destination', 'rate_per_litre', 'rate_per_trip', 'currency', 'effective_from')
    list_filter = ('company', 'currency')
    search_fields = ('transporter__name', 'origin', 'destination')
    autocomplete_fields = ('company', 'transporter', 'currency')
    date_hierarchy = 'effective_from'


@admin.register(m.TransporterVehicle)
class TransporterVehicleAdmin(admin.ModelAdmin):
    list_display = ('registration_number', 'transporter', 'kind', 'capacity', 'driver_name', 'status')
    list_filter = ('kind', 'status', 'company')
    search_fields = ('registration_number', 'transporter__name', 'driver_name', 'driver_licence')
    autocomplete_fields = ('company', 'transporter')


@admin.register(m.TransportBooking)
class TransportBookingAdmin(admin.ModelAdmin):
    list_display = ('reference', 'transporter', 'booking_date', 'quantity', 'rate_basis', 'total_charge', 'status')
    list_filter = ('status', 'rate_basis', 'company', 'transporter')
    search_fields = ('reference', 'origin', 'destination', 'driver_name')
    autocomplete_fields = ('company', 'shipment', 'transporter', 'truck', 'trailer', 'product', 'currency')
    readonly_fields = ('reference', 'exchange_rate', 'rate_date', 'rate_source',
                       'total_charge', 'advance_paid', 'balance_payable')
    date_hierarchy = 'booking_date'


@admin.register(m.TransporterInvoice)
class TransporterInvoiceAdmin(admin.ModelAdmin):
    list_display = ('reference', 'transporter', 'invoice_no', 'invoice_date', 'total', 'amount_paid', 'status')
    list_filter = ('status', 'company', 'transporter')
    search_fields = ('reference', 'invoice_no', 'transporter__name')
    autocomplete_fields = ('company', 'transporter', 'booking', 'currency', 'expense')
    readonly_fields = ('reference', 'exchange_rate', 'rate_date', 'rate_source',
                       'subtotal', 'tax_total', 'total', 'functional_total',
                       'amount_paid', 'amount_credited')
    date_hierarchy = 'invoice_date'


# =============================================================================
# SHIPMENTS
# =============================================================================
class ShipmentLineInline(admin.TabularInline):
    model = m.ShipmentLine
    extra = 0
    fields = ('product', 'tank', 'compartment', 'quantity', 'loaded_quantity',
              'purchase_price', 'selling_price', 'unit_cost', 'cost_total')
    readonly_fields = ('unit_cost', 'cost_total')
    autocomplete_fields = ('product', 'tank')


class ShipmentStageInline(admin.TabularInline):
    model = m.ShipmentStage
    extra = 0
    autocomplete_fields = ('company',)


@admin.register(m.Shipment)
class ShipmentAdmin(admin.ModelAdmin):
    list_display = ('reference', 'product', 'customer', 'supplier', 'loading_date', 'loading_quantity',
                    'truck_ownership', 'status')
    list_filter = ('status', 'truck_ownership', 'company', 'product')
    search_fields = ('reference', 'origin', 'destination', 'customer__name', 'supplier__name')
    autocomplete_fields = ('company', 'customer', 'supplier', 'purchase_order', 'sales_order', 'product',
                           'depot', 'loading_tank', 'vehicle', 'trailer', 'driver', 'transporter',
                           'hired_truck', 'border_crossing', 'currency', 'intercompany_transaction')
    readonly_fields = ('reference', 'exchange_rate', 'rate_date', 'rate_source', 'stock_issued')
    inlines = (ShipmentLineInline, ShipmentStageInline)
    date_hierarchy = 'loading_date'


@admin.register(m.ShipmentStage)
class ShipmentStageAdmin(admin.ModelAdmin):
    list_display = ('shipment', 'stage', 'planned_at', 'actual_at', 'location')
    list_filter = ('stage', 'company')
    search_fields = ('shipment__reference', 'location')
    autocomplete_fields = ('company', 'shipment')


@admin.register(m.ShipmentStatusHistory)
class ShipmentStatusHistoryAdmin(ReadOnlyAdmin):
    list_display = ('id', 'shipment', 'previous_status', 'new_status', 'changed_at', 'location', 'updated_by')
    list_filter = ('new_status', 'confirmation_type', 'company')
    search_fields = ('shipment__reference', 'location', 'comments')
    autocomplete_fields = ('company', 'shipment', 'updated_by')
    date_hierarchy = 'changed_at'


@admin.register(m.ShipmentDocument)
class ShipmentDocumentAdmin(admin.ModelAdmin):
    list_display = ('shipment', 'doc_type', 'number', 'notes')
    list_filter = ('doc_type', 'company')
    search_fields = ('shipment__reference', 'number', 'notes')
    autocomplete_fields = ('company', 'shipment')


@admin.register(m.ShipmentDelivery)
class ShipmentDeliveryAdmin(admin.ModelAdmin):
    list_display = ('reference', 'shipment', 'delivery_date', 'delivered_quantity',
                    'is_final', 'shortage_litres', 'status')
    list_filter = ('status', 'is_final', 'company')
    search_fields = ('reference', 'received_by', 'notes')
    autocomplete_fields = ('company', 'shipment', 'journal')
    readonly_fields = ('reference', 'remaining_before', 'shortage_litres', 'shortage_pct',
                       'cogs_value', 'loss_value')
    date_hierarchy = 'delivery_date'


@admin.register(m.ShipmentCostAllocation)
class ShipmentCostAllocationAdmin(admin.ModelAdmin):
    list_display = ('shipment', 'expense', 'method', 'percentage', 'amount')
    list_filter = ('method', 'company')
    search_fields = ('shipment__reference', 'expense__reference')
    autocomplete_fields = ('company', 'shipment', 'expense')


@admin.register(m.ShipmentCostSheet)
class ShipmentCostSheetAdmin(ReadOnlyAdmin):
    list_display = ('shipment', 'version', 'is_final', 'is_provisional', 'delivered_cost_per_litre',
                    'gross_profit', 'contribution', 'margin_pct', 'created_at')
    list_filter = ('is_final', 'is_provisional', 'company')
    search_fields = ('shipment__reference', 'notes')
    autocomplete_fields = ('company', 'shipment', 'created_by')
    date_hierarchy = 'created_at'


# =============================================================================
# EXPORT & CUSTOMS
# =============================================================================
@admin.register(m.BorderCrossing)
class BorderCrossingAdmin(admin.ModelAdmin):
    list_display = ('code', 'name', 'country_from', 'country_to', 'is_active')
    list_filter = ('country_from', 'country_to', 'is_active')
    search_fields = ('code', 'name')


@admin.register(m.ComplianceRequirement)
class ComplianceRequirementAdmin(admin.ModelAdmin):
    list_display = ('code', 'name', 'applies_to', 'mandatory', 'effective_from', 'effective_to')
    list_filter = ('applies_to', 'mandatory')
    search_fields = ('code', 'name')
    autocomplete_fields = ('company',)


@admin.register(m.ExportDeclaration)
class ExportDeclarationAdmin(admin.ModelAdmin):
    list_display = ('reference', 'shipment', 'declaration_number', 'export_date', 'clearance_date', 'status')
    list_filter = ('status', 'company')
    search_fields = ('reference', 'declaration_number', 'customs_reference', 'customs_broker')
    autocomplete_fields = ('company', 'shipment', 'border_crossing')
    readonly_fields = ('reference',)
    date_hierarchy = 'export_date'


@admin.register(m.ShipmentComplianceCheck)
class ShipmentComplianceCheckAdmin(admin.ModelAdmin):
    list_display = ('shipment', 'requirement', 'status', 'document_ref', 'checked_by', 'checked_at')
    list_filter = ('status', 'company')
    search_fields = ('shipment__reference', 'requirement__name', 'document_ref')
    autocomplete_fields = ('company', 'shipment', 'requirement', 'checked_by')


# =============================================================================
# EXPENSES
# =============================================================================
@admin.register(m.ExpenseCategory)
class ExpenseCategoryAdmin(admin.ModelAdmin):
    list_display = ('code', 'name', 'group', 'cost_component', 'in_cogs', 'is_active')
    list_filter = ('group', 'cost_component', 'in_cogs', 'is_active')
    search_fields = ('code', 'name')


@admin.register(m.Expense)
class ExpenseAdmin(admin.ModelAdmin):
    list_display = ('reference', 'expense_date', 'category', 'description', 'amount', 'tax_amount',
                    'payment_method', 'status')
    list_filter = ('status', 'payment_method', 'truck_ownership', 'company', 'category')
    search_fields = ('reference', 'description', 'payee', 'receipt_no')
    autocomplete_fields = ('company', 'category', 'shipment', 'vehicle', 'supplier', 'transporter',
                           'bank_account', 'account', 'currency', 'journal')
    readonly_fields = ('reference', 'exchange_rate', 'rate_date', 'rate_source',
                       'duplicate_key', 'amount_paid', 'functional_total')
    date_hierarchy = 'expense_date'


# =============================================================================
# FINANCE
# =============================================================================
class JournalLineInline(ImmutableInline):
    model = m.JournalLine
    fields = ('account', 'debit', 'credit', 'currency', 'foreign_amount', 'exchange_rate',
              'shipment', 'party_type', 'party_id', 'narration')
    autocomplete_fields = ('account', 'currency', 'shipment')


@admin.register(m.Journal)
class JournalAdmin(ReadOnlyAdmin):
    list_display = ('reference', 'date', 'company', 'description', 'status', 'total_debit', 'total_credit', 'posted_at')
    list_filter = ('status', 'company', 'source_type', 'is_closing')
    search_fields = ('reference', 'description', 'source_type', 'source_id')
    autocomplete_fields = ('company', 'period', 'reverses', 'posted_by')
    inlines = (JournalLineInline,)
    date_hierarchy = 'date'


@admin.register(m.JournalLine)
class JournalLineAdmin(ReadOnlyAdmin):
    list_display = ('journal', 'account', 'debit', 'credit', 'currency', 'foreign_amount', 'narration')
    list_filter = ('currency', 'account__account_type')
    search_fields = ('journal__reference', 'account__code', 'account__name', 'narration')
    autocomplete_fields = ('journal', 'account', 'currency', 'shipment')


@admin.register(m.BankAccount)
class BankAccountAdmin(admin.ModelAdmin):
    list_display = ('name', 'company', 'account_type', 'bank_name', 'account_number', 'currency', 'is_active')
    list_filter = ('account_type', 'company', 'currency', 'is_active')
    search_fields = ('name', 'bank_name', 'account_number', 'mpesa_shortcode')
    autocomplete_fields = ('company', 'currency', 'gl_account')


@admin.register(m.BankTransaction)
class BankTransactionAdmin(admin.ModelAdmin):
    list_display = ('txn_date', 'bank_account', 'reference', 'money_in', 'money_out', 'balance', 'status')
    list_filter = ('status', 'company', 'bank_account')
    search_fields = ('reference', 'description', 'batch')
    autocomplete_fields = ('company', 'bank_account', 'matched_payment')
    date_hierarchy = 'txn_date'


@admin.register(m.BankReconciliation)
class BankReconciliationAdmin(admin.ModelAdmin):
    list_display = ('reference', 'bank_account', 'statement_date', 'statement_balance',
                    'book_balance', 'difference', 'unmatched_count', 'status')
    list_filter = ('status', 'company', 'bank_account')
    search_fields = ('reference', 'notes')
    autocomplete_fields = ('company', 'bank_account')
    readonly_fields = ('reference', 'book_balance', 'difference')
    date_hierarchy = 'statement_date'


class PaymentAllocationInline(ImmutableInline):
    model = m.PaymentAllocation
    fields = ('sales_invoice', 'purchase_invoice', 'transporter_invoice', 'expense', 'amount', 'fx_gain_loss', 'created_at')
    readonly_fields = ('created_at',)
    autocomplete_fields = ('sales_invoice', 'purchase_invoice', 'transporter_invoice', 'expense')


@admin.register(m.Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = ('reference', 'payment_date', 'direction', 'party_type', 'amount',
                    'allocated_amount', 'method', 'status')
    list_filter = ('status', 'direction', 'party_type', 'method', 'company')
    search_fields = ('reference', 'narration', 'mpesa_reference', 'bank_reference', 'payer_phone', 'payee')
    autocomplete_fields = ('company', 'customer', 'supplier', 'transporter', 'bank_account',
                           'booking', 'counter_account', 'currency', 'approved_by',
                           'executed_by', 'journal')
    readonly_fields = ('reference', 'exchange_rate', 'rate_date', 'rate_source',
                       'allocated_amount', 'approved_by', 'approved_at', 'executed_by', 'journal')
    inlines = (PaymentAllocationInline,)
    date_hierarchy = 'payment_date'


@admin.register(m.PaymentAllocation)
class PaymentAllocationAdmin(ReadOnlyAdmin):
    list_display = ('payment', 'amount', 'fx_gain_loss', 'created_at')
    search_fields = ('payment__reference',)
    autocomplete_fields = ('payment',)


@admin.register(m.FixedAsset)
class FixedAssetAdmin(admin.ModelAdmin):
    list_display = ('reference', 'name', 'category', 'acquisition_date', 'cost',
                    'accumulated_depreciation', 'net_book_value', 'status')
    list_filter = ('category', 'status', 'company')
    search_fields = ('reference', 'name', 'location')
    autocomplete_fields = ('company', 'vehicle', 'tank')
    readonly_fields = ('reference', 'accumulated_depreciation',
                       'disposal_proceeds', 'disposal_gain_loss', 'net_book_value')
    date_hierarchy = 'acquisition_date'


@admin.register(m.AssetDepreciation)
class AssetDepreciationAdmin(admin.ModelAdmin):
    list_display = ('asset', 'period_end', 'amount', 'journal')
    search_fields = ('asset__reference', 'asset__name')
    autocomplete_fields = ('company', 'asset', 'journal')
    date_hierarchy = 'period_end'


# =============================================================================
# PAYROLL & HR
# =============================================================================
@admin.register(m.Employee)
class EmployeeAdmin(admin.ModelAdmin):
    list_display = ('code', 'full_name', 'job_title', 'department', 'hire_date',
                    'basic_salary', 'currency', 'is_driver', 'status')
    list_filter = ('status', 'is_driver', 'company')
    search_fields = ('code', 'full_name', 'national_id', 'tax_number', 'bank_account')
    autocomplete_fields = ('company', 'department', 'currency')


@admin.register(m.LeaveRequest)
class LeaveRequestAdmin(admin.ModelAdmin):
    list_display = ('reference', 'employee', 'leave_type', 'start_date', 'end_date', 'days', 'status')
    list_filter = ('leave_type', 'status', 'company')
    search_fields = ('reference', 'employee__full_name')
    autocomplete_fields = ('company', 'employee')
    readonly_fields = ('reference',)
    date_hierarchy = 'start_date'


@admin.register(m.PayrollConfig)
class PayrollConfigAdmin(admin.ModelAdmin):
    list_display = ('company', 'code', 'name', 'kind', 'calc_type', 'base',
                    'value', 'effective_from', 'effective_to', 'is_active')
    list_filter = ('kind', 'calc_type', 'base', 'is_active', 'company')
    search_fields = ('code', 'name')
    autocomplete_fields = ('company', 'liability_account')
    date_hierarchy = 'effective_from'


class PayslipInline(ImmutableInline):
    model = m.Payslip
    fields = ('employee', 'basic', 'allowances', 'overtime', 'gross',
              'total_deductions', 'net_pay', 'total_employer')
    autocomplete_fields = ('employee',)


@admin.register(m.PayrollRun)
class PayrollRunAdmin(admin.ModelAdmin):
    list_display = ('reference', 'period_start', 'period_end', 'total_gross',
                    'total_deductions', 'total_net', 'total_employer_cost', 'status')
    list_filter = ('status', 'company')
    search_fields = ('reference',)
    autocomplete_fields = ('company', 'journal')
    readonly_fields = ('reference', 'total_gross', 'total_deductions',
                       'total_net', 'total_employer_cost', 'journal')
    inlines = (PayslipInline,)
    date_hierarchy = 'period_end'


@admin.register(m.Payslip)
class PayslipAdmin(ReadOnlyAdmin):
    list_display = ('run', 'employee', 'gross', 'total_deductions', 'net_pay', 'total_employer')
    list_filter = ('run',)
    search_fields = ('run__reference', 'employee__full_name')
    autocomplete_fields = ('run', 'employee')


# =============================================================================
# GROUP ACCOUNTING
# =============================================================================
@admin.register(m.IntercompanyTransaction)
class IntercompanyTransactionAdmin(admin.ModelAdmin):
    list_display = ('reference', 'txn_date', 'txn_type', 'from_company', 'to_company',
                    'amount', 'settled_amount', 'status')
    list_filter = ('txn_type', 'status', 'currency')
    search_fields = ('reference', 'notes')
    autocomplete_fields = ('from_company', 'to_company', 'product', 'currency',
                           'from_journal', 'to_journal', 'shipment')
    readonly_fields = ('settled_amount',)


@admin.register(m.IntercompanyBalance)
class IntercompanyBalanceAdmin(ReadOnlyAdmin):
    list_display = ('company', 'counterparty', 'currency', 'receivable', 'payable',
                    'gl_receivable', 'gl_payable', 'difference', 'as_of_date')
    list_filter = ('company', 'counterparty', 'currency')
    autocomplete_fields = ('company', 'counterparty', 'currency')
    date_hierarchy = 'as_of_date'


@admin.register(m.ConsolidationRun)
class ConsolidationRunAdmin(admin.ModelAdmin):
    list_display = ('reference', 'period_start', 'period_end', 'reporting_currency', 'status')
    list_filter = ('status',)
    search_fields = ('reference',)
    autocomplete_fields = ('reporting_currency',)


@admin.register(m.EliminationJournal)
class EliminationJournalAdmin(ReadOnlyAdmin):
    list_display = ('run', 'entry_no', 'description', 'account_group_code', 'debit', 'credit', 'ic_transaction')
    list_filter = ('run',)
    search_fields = ('description', 'account_group_code', 'run__reference')
    autocomplete_fields = ('run', 'ic_transaction')


# =============================================================================
# small admin tuning
# =============================================================================
admin.site.site_header = 'PetroERP · Administration'
admin.site.site_title = 'PetroERP'
admin.site.index_title = 'PetroERP configuration and data'