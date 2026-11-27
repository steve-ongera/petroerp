"""
PetroERP API views.

Security model (server-side):
  * authentication    : every endpoint needs a signed-in user
  * roles             : NOT enforced here. Page/menu access by role is handled in the frontend (navigation.js).
                        `role_ok` / `RolePermission` are kept as no-op shims so existing `roles = ...` attributes are ignored.
  * entity scoping    : querysets are filtered to the user's allowed legal entities; creates are checked too
  * workflow documents: status can only change through action endpoints (services), edits only while DRAFT
  * posted / immutable records (journals, stock movements, audit logs, shipment history) expose no write verbs
"""
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError
from django.db.models import Q, Sum

from django.http import HttpResponse
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import AuthenticationFailed, PermissionDenied
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView, exception_handler
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.views import TokenObtainPairView

from . import models as m
from . import serializers as sz
from . import services as svc

from . import shipment_extras as sx


ROUTES = []          # (prefix, viewset) pairs consumed by api/urls.py
D0 = m.D0

# Legacy role codes. Kept only so old `roles = ...` attributes still import; they are no longer enforced.
ADMIN_ONLY = ()
AUDIT_ROLES = ('OWNER', 'AUDITOR')
FINANCE_ROLES = ('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'AUDITOR')


# ====================================================================== plumbing
def api_exception_handler(exc, context):
    """Business-rule errors raised in services become clean 400 responses."""
    if isinstance(exc, DjangoValidationError):
        exc = DRFValidationError({'detail': ' '.join(exc.messages)})
    elif isinstance(exc, IntegrityError):
        exc = DRFValidationError({'detail': 'This record conflicts with an existing one (duplicate or invalid reference).'})
    return exception_handler(exc, context)


def role_ok(user, roles):
    """Role restrictions are enforced in the frontend only. Always True."""
    return True


class RolePermission(BasePermission):
    """Kept so existing `permission_classes` keep working; only requires a signed-in user."""

    def has_permission(self, request, view):
        u = request.user
        return bool(u and u.is_authenticated)


def allowed(user):
    return user.allowed_company_ids()


def check_company(user, company):
    if company is not None and company.id not in allowed(user):
        raise PermissionDenied('You are not authorised for this legal entity.')


def file_response(body, ctype, name):
    r = HttpResponse(body, content_type=ctype)
    r['Content-Disposition'] = f'attachment; filename="{name}"'
    return r


def table_response(request, rep):
    """JSON by default; ?export=xlsx|pdf returns a file."""
    fmt = request.query_params.get('export')
    if fmt in ('xlsx', 'pdf'):
        body, ctype, ext = svc.export_table(rep['title'], rep['columns'], rep['rows'], fmt)
        return file_response(body, ctype, f'{rep["title"][:40].replace(" ", "_")}.{ext}')
    return Response(rep)


# ====================================================================== generic CRUD base
class BaseViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, RolePermission]
    roles = None                   # ignored (roles are enforced in the frontend)
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    ordering_fields = '__all__'
    ordering = ['-pk']
    model = None
    scope = 'company'              # path to the legal entity; None = global master data
    date_field = None
    EDITABLE = ('DRAFT',)          # statuses in which a STATUS_MANAGED record may be edited; None = always
    simple_status = ()             # statuses that may be set through POST set-status
    approval_amount_field = None
    parsers = (JSONParser, MultiPartParser, FormParser)

    def get_serializer_class(self):
        return sz.serializer_for(self.model)

    def _fill_company(self, data):
        """If the form sent no company, fill it from ?company=, the linked requisition, or the user's only entity."""
        if not any(f.name == 'company' for f in self.model._meta.get_fields()) or data.get('company'):
            return data
        ids = [str(i) for i in allowed(self.request.user)]
        cid = self.request.query_params.get('company')
        if not cid and data.get('requisition'):
            r = m.PurchaseRequisition.objects.filter(pk=data.get('requisition')).first()
            cid = r.company_id if r else None
        if not cid and len(ids) == 1:
            cid = ids[0]
        if cid and str(cid) in ids:
            data = data.copy()
            data['company'] = cid
        return data

    def get_serializer(self, *args, **kwargs):
        if kwargs.get('data') is not None and getattr(self, 'action', None) == 'create':
            kwargs['data'] = self._fill_company(kwargs['data'])
        return super().get_serializer(*args, **kwargs)

    def get_queryset(self):
        fks = [f.name for f in self.model._meta.get_fields() if f.many_to_one and f.concrete and f.name != 'created_by']
        qs = self.model.objects.select_related(*fks)
        u = self.request.user
        if self.scope:
            qs = qs.filter(**{f'{self.scope}__in': allowed(u)})
        p = self.request.query_params
        if self.date_field:
            if p.get('date_from'):
                qs = qs.filter(**{f'{self.date_field}__gte': p['date_from']})
            if p.get('date_to'):
                qs = qs.filter(**{f'{self.date_field}__lte': p['date_to']})
        return qs

    # ---- hooks
    def after_save(self, obj):
        pass

    def perform_create(self, serializer):
        check_company(self.request.user, serializer.validated_data.get('company'))
        obj = serializer.save(created_by=self.request.user) if not hasattr(serializer, '_save_lines') else serializer.save()
        self.after_save(obj)
        svc.audit(self.request.user, 'CREATE', obj)

    def perform_update(self, serializer):
        inst = serializer.instance
        if getattr(self.model, 'STATUS_MANAGED', False) and self.EDITABLE is not None and inst.status not in self.EDITABLE:
            raise DRFValidationError({'detail': f'{inst} is {inst.status} and can no longer be edited.'})
        check_company(self.request.user, serializer.validated_data.get('company'))
        obj = serializer.save()
        self.after_save(obj)
        svc.audit(self.request.user, 'UPDATE', obj, {k: str(v) for k, v in serializer.validated_data.items() if k != 'lines'})

    def perform_destroy(self, inst):
        if getattr(self.model, 'STATUS_MANAGED', False) and inst.status != 'DRAFT':
            raise DRFValidationError({'detail': 'Only draft records can be deleted. Cancel or reverse instead.'})
        svc.audit(self.request.user, 'DELETE', inst)
        inst.delete()

    def list(self, request, *a, **kw):
        fmt = request.query_params.get('export')
        if fmt in ('xlsx', 'pdf'):
            data = self.get_serializer(self.filter_queryset(self.get_queryset())[:5000], many=True).data
            cols = [k for k, v in (data[0].items() if data else []) if not isinstance(v, (list, dict))]
            title = self.model._meta.verbose_name_plural.title()
            return table_response(request, {'title': title, 'columns': cols, 'rows': [[r.get(c) for c in cols] for r in data]})
        return super().list(request, *a, **kw)

    # ---- generic actions available on every resource
    @action(detail=True, methods=['get'])
    def history(self, request, pk=None):
        o = self.get_object()
        qs = m.AuditLog.objects.filter(model_name=self.model.__name__, object_id=str(o.pk)).order_by('-id')[:200]
        return Response(sz.AuditLogSerializer(qs, many=True).data)

    @action(detail=True, methods=['get', 'post'], parser_classes=[MultiPartParser, FormParser])
    def attachments(self, request, pk=None):
        o = self.get_object()
        ct = m.ContentType.objects.get_for_model(o)
        if request.method == 'POST':
            f = request.FILES.get('file')
            if not f:
                raise DRFValidationError({'detail': 'No file uploaded.'})
            if f.size > 10 * 1024 * 1024 or f.name.rsplit('.', 1)[-1].lower() not in ('pdf', 'png', 'jpg', 'jpeg', 'xlsx', 'csv', 'docx'):
                raise DRFValidationError({'detail': 'Files must be pdf/png/jpg/xlsx/csv/docx and under 10 MB.'})
            m.Attachment.objects.create(company_id=getattr(o, 'company_id', None), content_type=ct, object_id=o.pk, file=f,
                                        description=request.data.get('description', ''), created_by=request.user)
        rows = m.Attachment.objects.filter(content_type=ct, object_id=o.pk)
        return Response([{'id': a.id, 'file': request.build_absolute_uri(a.file.url), 'description': a.description, 'at': a.created_at} for a in rows])

    @action(detail=True, methods=['post'])
    def submit(self, request, pk=None):
        o = self.get_object()
        if self.model.__name__ not in svc.APPROVAL_FLOW:
            raise DRFValidationError({'detail': 'This record type has no approval workflow.'})
        req = svc.submit_document(o, request.user)
        o.refresh_from_db()
        return Response({'status': o.status, 'approval_request': req.id if req else None})

    @action(detail=True, methods=['post'], url_path='set-status')
    def set_status(self, request, pk=None):
        o, new = self.get_object(), request.data.get('status')
        if new not in self.simple_status:
            raise DRFValidationError({'detail': f'Status must be one of: {", ".join(self.simple_status) or "none"}.'})
        o.status = new
        o.save(update_fields=['status'])
        svc.audit(request.user, f'STATUS_{new}', o)
        return Response({'status': o.status})


def make_viewset(model, *, search=(), filters_=(), date_field=None, readonly=False, scope='company',
                 simple_status=(), editable='DEFAULT', roles=None):
    names = {f.name for f in model._meta.get_fields()}
    sf = [f for f in ('reference', 'name', 'code', 'registration_number', 'full_name', 'description') if f in names] + list(search)
    ff = [f for f in ['company', 'status', *filters_] if f in names]
    attrs = dict(model=model, scope=scope, date_field=date_field, search_fields=sf, filterset_fields=ff,
                 queryset=model.objects.none(), simple_status=simple_status, roles=roles)
    if readonly:
        attrs['http_method_names'] = ['get', 'head', 'options']
    if editable != 'DEFAULT':
        attrs['EDITABLE'] = editable
    return type(f'{model.__name__}ViewSet', (BaseViewSet,), attrs)


def reg(prefix, model, **kw):
    vs = make_viewset(model, **kw)
    ROUTES.append((prefix, vs))
    return vs


def route(prefix):
    def deco(cls):
        ROUTES.append((prefix, cls))
        return cls
    return deco


# ====================================================================== auth
PURCHASE_POST_ROLES = ('OPERATIONS_MANAGER',) + svc.FINANCE_POST_ROLES   # + both finance managers, accountant
# To override a failed match, a user must be able to post AND be in services' override list.
PURCHASE_OVERRIDE_ROLES = tuple(r for r in PURCHASE_POST_ROLES if r in svc.MATCH_OVERRIDE_ROLES)


def role_list(codes):
    names = ['Group Administrator'] + [svc.ROLE_NAMES.get(c, c.replace('_', ' ').title()) for c in codes]
    return ', '.join(names)


def user_role_name(user):
    if user.role_id:
        return user.role.name
    return 'Superuser' if user.is_superuser else 'No role assigned'


def me_payload(u):
    return {'id': u.id, 'username': u.username, 'name': u.get_full_name() or u.username, 'email': u.email,
            'role': u.role.code if u.role_id else ('SUPERUSER' if u.is_superuser else None),
            'role_name': u.role.name if u.role_id else None, 'role_label': user_role_name(u),
            'mfa_enabled': bool(u.mfa_secret),
            'purchase_posting': {
                'can_post': svc.has_role(u, PURCHASE_POST_ROLES),
                'can_override': svc.has_role(u, PURCHASE_OVERRIDE_ROLES),
                'post_roles': role_list(PURCHASE_POST_ROLES),
                'override_roles': role_list(PURCHASE_OVERRIDE_ROLES),
            },
            'companies': [{'id': c.id, 'code': c.code, 'name': c.name, 'country': c.country, 'currency': c.functional_currency_id}
                          for c in m.Company.objects.filter(id__in=u.allowed_company_ids())]}

class LoginSerializer(TokenObtainPairSerializer):
    def validate(self, attrs):
        data = super().validate(attrs)
        u = self.user
        if u.mfa_secret:
            import pyotp
            if not pyotp.TOTP(u.mfa_secret).verify(str(self.initial_data.get('otp', '')), valid_window=1):
                raise AuthenticationFailed('A valid authenticator code (otp) is required.')
        svc.audit(u, 'LOGIN', u)
        data['user'] = me_payload(u)
        return data


class LoginView(TokenObtainPairView):
    serializer_class = LoginSerializer
    throttle_scope = 'login'


class MeView(APIView):
    def get(self, request):
        return Response(me_payload(request.user))


class MfaView(APIView):
    """POST {} -> new secret + otpauth URI;  POST {otp} -> confirm and enable;  DELETE -> disable (needs otp)."""

    def post(self, request):
        import pyotp
        u = request.user
        if request.data.get('otp'):
            secret = request.session.get('pending_mfa') or request.data.get('secret', '')
            if not secret or not pyotp.TOTP(secret).verify(str(request.data['otp']), valid_window=1):
                raise DRFValidationError({'detail': 'Invalid code.'})
            u.mfa_secret = secret
            u.save(update_fields=['mfa_secret'])
            svc.audit(u, 'MFA_ENABLED', u)
            return Response({'mfa_enabled': True})
        secret = pyotp.random_base32()
        request.session['pending_mfa'] = secret
        return Response({'secret': secret, 'otpauth_uri': pyotp.TOTP(secret).provisioning_uri(u.username, issuer_name='PetroERP')})


class MetaView(APIView):
    def get(self, request):
        return Response({'shipment_statuses': m.SHIPMENT_STATUSES.split(), 'shipment_transitions': {k: sorted(v) for k, v in svc.TRANSITIONS.items()},
                         'cost_components': svc.COMPONENTS, 'reports': [{'name': k} for k in svc.REPORTS],
                         'reporting_currency': svc._rep_ccy()})


# ====================================================================== administration & company
@route('users')
class UserViewSet(viewsets.ModelViewSet):
    roles = ADMIN_ONLY                      # ignored: user management is restricted in the frontend
    permission_classes = [IsAuthenticated, RolePermission]
    serializer_class = sz.UserSerializer
    queryset = m.User.objects.select_related('role').order_by('username')

    def perform_create(self, s):
        u = s.save()
        svc.audit(self.request.user, 'CREATE_USER', u)

    def perform_update(self, s):
        u = s.save()
        svc.audit(self.request.user, 'UPDATE_USER', u, {'role': u.role_id})


@route('roles')
class RoleViewSet(viewsets.ReadOnlyModelViewSet):
    roles = ADMIN_ONLY
    permission_classes = [IsAuthenticated, RolePermission]
    serializer_class = sz.RoleSerializer
    queryset = m.Role.objects.prefetch_related('permissions').order_by('code')


@route('companies')
class CompanyViewSet(make_viewset(m.Company, scope='id')):
    def perform_create(self, s):
        if not self.request.user.is_group_admin:
            raise PermissionDenied('Only the Group Administrator can register companies.')
        c = s.save(created_by=self.request.user)
        svc.audit(self.request.user, 'CREATE', c)


reg('branches', m.Branch)
reg('departments', m.Department)
reg('currencies', m.Currency, scope=None)
reg('exchange-rates', m.ExchangeRate, scope=None, date_field='rate_date', filters_=('from_currency', 'to_currency'))
reg('tax-configs', m.TaxConfig, filters_=('tax_type',))
reg('number-sequences', m.NumberSequence)
reg('approval-policies', m.ApprovalPolicy)
reg('account-mappings', m.AccountMapping)
reg('border-crossings', m.BorderCrossing, scope=None)
reg('compliance-requirements', m.ComplianceRequirement, scope=None)


class TaxVerify(APIView):
    """Professional verification of a tax/duty configuration (required before it can be used)."""

    def post(self, request, pk):
        t = m.TaxConfig.objects.get(pk=pk, company_id__in=allowed(request.user))
        if t.created_by_id == request.user.id:
            raise DRFValidationError({'detail': 'Segregation of duties: someone else must verify this configuration.'})
        t.verified_by, t.verified_at = request.user, svc.timezone.now()
        t.save()
        svc.audit(request.user, 'VERIFY_TAX', t)
        return Response({'verified': True})


class FiscalYearViewSet(make_viewset(m.FiscalYear)):
    def create(self, request, *a, **kw):
        d = sz.FiscalYearIn(data=request.data)
        d.is_valid(raise_exception=True)
        v = d.validated_data
        check_company(request.user, v['company'])
        fy = svc.create_fiscal_year(v['company'], v['name'], v['start_date'], v['end_date'], request.user)
        return Response(sz.serializer_for(m.FiscalYear)(fy).data, status=201)

    @action(detail=True, methods=['post'])
    def close(self, request, pk=None):
        return Response(sz.serializer_for(m.FiscalYear)(svc.close_fiscal_year(self.get_object(), request.user)).data)


ROUTES.append(('fiscal-years', FiscalYearViewSet))


class PeriodViewSet(make_viewset(m.AccountingPeriod, readonly=True)):
    http_method_names = ['get', 'post', 'head', 'options']

    @action(detail=True, methods=['post'])
    def close(self, request, pk=None):
        return Response(sz.serializer_for(m.AccountingPeriod)(svc.close_period(self.get_object(), request.user)).data)

    @action(detail=True, methods=['post'])
    def reopen(self, request, pk=None):
        return Response(sz.serializer_for(m.AccountingPeriod)(svc.reopen_period(self.get_object(), request.user)).data)


ROUTES.append(('accounting-periods', PeriodViewSet))


# ====================================================================== suppliers
def _statement(rows):
    """rows: (date, type, ref, currency, debit, credit); running balance per currency."""
    run, out = {}, []
    for d, t, r, c, dr, cr in sorted(rows, key=lambda x: (x[0], x[2])):
        run[c] = run.get(c, D0) + dr - cr
        out.append({'date': d, 'type': t, 'reference': r, 'currency': c, 'debit': dr, 'credit': cr, 'balance': run[c]})
    return {'rows': out, 'closing': run}


@route('suppliers')
class SupplierViewSet(make_viewset(m.Supplier, search=('tax_pin',), filters_=('country',))):
    @action(detail=True, methods=['get'])
    def statement(self, request, pk=None):
        s = self.get_object()
        rows = [(i.invoice_date, 'Invoice', i.supplier_invoice_no, i.currency_id, D0, i.total) for i in m.PurchaseInvoice.objects.filter(supplier=s).exclude(status__in=('DRAFT', 'CANCELLED'))]
        rows += [(c.note_date, 'Credit note', c.reference, c.currency_id, c.amount + c.tax_amount, D0) for c in m.SupplierCreditNote.objects.filter(supplier=s, status='POSTED')]
        rows += [(p.payment_date, 'Payment', p.reference, p.currency_id, p.amount, D0) for p in m.Payment.objects.filter(supplier=s, status='POSTED')]
        return Response(_statement(rows))

    @action(detail=True, methods=['get'], url_path='price-history')
    def price_history(self, request, pk=None):
        qs = m.SupplierPrice.objects.filter(supplier=self.get_object()).select_related('product').order_by('-effective_date')[:200]
        return Response([{'date': p.effective_date, 'product': p.product.name, 'price': p.price, 'currency': p.currency_id, 'source': p.source} for p in qs])

    @action(detail=True, methods=['get'])
    def performance(self, request, pk=None):
        s = self.get_object()
        lines = m.PurchaseOrderLine.objects.filter(order__supplier=s).exclude(order__status__in=('DRAFT', 'CANCELLED'))
        ordered = lines.aggregate(q=Sum('quantity'))['q'] or D0
        recvd = lines.aggregate(q=Sum('received_quantity'))['q'] or D0
        bad = m.PurchaseInvoice.objects.filter(supplier=s).exclude(match_status__in=('MATCHED', 'UNMATCHED')).count()
        return Response({'orders': lines.values('order').distinct().count(), 'litres_ordered': ordered, 'litres_received': recvd,
                         'fill_rate_pct': m.q3(recvd / ordered * 100) if ordered else None, 'invoice_match_exceptions': bad})


reg('supplier-contacts', m.SupplierContact, scope='supplier__company')
reg('supplier-contracts', m.SupplierContract, simple_status=('ACTIVE', 'EXPIRED', 'CANCELLED'), editable=None)
reg('supplier-prices', m.SupplierPrice, date_field='effective_date', filters_=('supplier', 'product'))
reg('supplier-quotations', m.SupplierQuotation, simple_status=('RECEIVED', 'ACCEPTED', 'REJECTED', 'EXPIRED'), editable=None)


# ====================================================================== procurement
reg('purchase-requisitions', m.PurchaseRequisition, simple_status=('CONVERTED',), editable=('DRAFT',))


@route('purchase-orders')
class PurchaseOrderViewSet(make_viewset(m.PurchaseOrder, filters_=('supplier', 'requisition'), date_field='order_date')):
    def perform_create(self, serializer):
        r = serializer.validated_data.get('requisition')
        if r and r.status != 'APPROVED':
            raise DRFValidationError({'requisition': 'Only an approved requisition can be turned into a purchase order.'})
        super().perform_create(serializer)

    def after_save(self, obj):
        r = obj.requisition
        if r and r.status == 'APPROVED':
            r.status = 'CONVERTED'
            r.save(update_fields=['status'])

    @action(detail=True, methods=['post'])
    def receive(self, request, pk=None):
        po = self.get_object()
        d = sz.ReceiveGoodsIn(data=request.data)
        d.is_valid(raise_exception=True)
        v = d.validated_data
        grn = svc.receive_goods(po, v.pop('line'), v.pop('tank'), request.user, **v)
        return Response(sz.serializer_for(m.GoodsReceipt)(grn).data, status=201)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        po = self.get_object()
        if po.status not in ('DRAFT', 'AWAITING_APPROVAL', 'APPROVED') or m.GoodsReceipt.objects.filter(purchase_order=po).exists():
            raise DRFValidationError({'detail': 'Only orders without receipts can be cancelled.'})
        po.status = 'CANCELLED'
        po.save(update_fields=['status'])
        svc.audit(request.user, 'CANCEL', po)
        return Response({'status': po.status})


reg('goods-receipts', m.GoodsReceipt, readonly=True, date_field='receipt_date')


@route('purchase-returns')
class PurchaseReturnViewSet(make_viewset(m.PurchaseReturn)):
    def create(self, request, *a, **kw):
        d = sz.PurchaseReturnIn(data=request.data)
        d.is_valid(raise_exception=True)
        v = d.validated_data
        check_company(request.user, v['goods_receipt'].company)
        r = svc.post_purchase_return(v['goods_receipt'], v['quantity'], v.get('return_date'), v.get('reason', ''), request.user)
        return Response(sz.serializer_for(m.PurchaseReturn)(r).data, status=201)


@route('purchase-invoices')
class PurchaseInvoiceViewSet(make_viewset(m.PurchaseInvoice, filters_=('supplier', 'match_status'), date_field='invoice_date')):
    @action(detail=True, methods=['post'])
    def match(self, request, pk=None):
        inv = self.get_object()
        return Response({'match_status': svc.match_purchase_invoice(inv), 'notes': inv.match_notes})

    @action(detail=True, methods=['post'])
    def post(self, request, pk=None):
        u = request.user
        if not svc.has_role(u, PURCHASE_POST_ROLES):
            raise PermissionDenied(
                f'Your role is "{user_role_name(u)}". You cannot post purchase invoices. '
                f'Only these can post: {role_list(PURCHASE_POST_ROLES)}.')
        d = sz.PostInvoiceIn(data=request.data)
        d.is_valid(raise_exception=True)
        override = d.validated_data['override']
        if override and not svc.has_role(u, PURCHASE_OVERRIDE_ROLES):
            raise PermissionDenied(
                f'Your role is "{user_role_name(u)}". You cannot override a failed three-way match. '
                f'Only these can: {role_list(PURCHASE_OVERRIDE_ROLES)}.')
        inv = svc.post_purchase_invoice(self.get_object(), u, override)
        return Response(sz.serializer_for(m.PurchaseInvoice)(inv).data)


@route('supplier-credit-notes')
class SupplierCreditNoteViewSet(make_viewset(m.SupplierCreditNote)):
    @action(detail=True, methods=['post'])
    def post(self, request, pk=None):
        return Response(sz.serializer_for(m.SupplierCreditNote)(svc.post_supplier_credit_note(self.get_object(), request.user)).data)


# ====================================================================== products, depots, tanks, stock
reg('products', m.Product, scope=None, filters_=('category',))
reg('depots', m.Depot)
reg('tank-calibrations', m.TankCalibration, scope='tank__company')
reg('stock-movements', m.StockMovement, readonly=True, date_field='movement_date', filters_=('tank', 'product', 'movement_type', 'shipment'))
reg('stock-balances', m.StockBalance, readonly=True, filters_=('tank', 'product'))
reg('stock-reservations', m.StockReservation, readonly=True)
reg('tank-readings', m.TankReading, date_field='reading_date', filters_=('tank',))
reg('stock-adjustments', m.StockAdjustment, readonly=True)
reg('stock-transfers', m.StockTransfer, readonly=True)


@route('storage-tanks')
class TankViewSet(make_viewset(m.StorageTank, filters_=('depot', 'product'))):
    @action(detail=True, methods=['get'])
    def position(self, request, pk=None):
        t = self.get_object()
        d = svc.as_date(request.query_params.get('date'))
        p = svc.tank_position(t, t.product, d) if t.product else {}
        bal = m.StockBalance.objects.filter(tank=t).first()
        return Response({'date': d, 'on_hand': bal.quantity if bal else D0, 'value': bal.value if bal else D0, **p})


@route('tank-reconciliations')
class TankReconViewSet(make_viewset(m.TankReconciliation, readonly=True, date_field='recon_date', filters_=('tank',))):
    http_method_names = ['get', 'post', 'head', 'options']

    def create(self, request, *a, **kw):
        d = sz.TankReconcileIn(data=request.data)
        d.is_valid(raise_exception=True)
        v = d.validated_data
        check_company(request.user, v['tank'].company)
        rec = svc.reconcile_tank(v['tank'], v['date'], v['physical_qty'], request.user)
        return Response(sz.serializer_for(m.TankReconciliation)(rec).data, status=201)

    @action(detail=True, methods=['post'], url_path='raise-adjustment')
    def raise_adjustment(self, request, pk=None):
        adj = svc.raise_adjustment(self.get_object(), request.user, request.data.get('reason', ''))
        return Response(sz.serializer_for(m.StockAdjustment)(adj).data, status=201)


class StockOps(APIView):
    """POST /stock/transfer/   POST /stock/opening/"""

    def post(self, request, op):
        if op == 'transfer':
            d = sz.TransferIn(data=request.data)
            d.is_valid(raise_exception=True)
            v = d.validated_data
            check_company(request.user, v['company'])
            t = svc.transfer_stock(v['company'], v['from_tank'], v['to_tank'], v['quantity'], v['date'], request.user, v.get('notes', ''))
            return Response(sz.serializer_for(m.StockTransfer)(t).data, status=201)
        d = sz.OpeningStockIn(data=request.data)
        d.is_valid(raise_exception=True)
        v = d.validated_data
        check_company(request.user, v['tank'].company)
        mv = svc.post_opening_stock(v['tank'], v['product'], v['quantity'], v['unit_cost'], v['date'], request.user)
        return Response({'movement': mv.reference, 'value': mv.total_cost}, status=201)


# ====================================================================== customers & sales
@route('customers')
class CustomerViewSet(make_viewset(m.Customer, search=('tax_registration',), filters_=('country',))):
    @action(detail=True, methods=['get'])
    def statement(self, request, pk=None):
        c = self.get_object()
        rows = [(i.invoice_date, 'Invoice', i.reference, i.currency_id, i.total, D0) for i in m.SalesInvoice.objects.filter(customer=c).exclude(status__in=('DRAFT', 'CANCELLED'))]
        rows += [(n.note_date, 'Credit note', n.reference, n.currency_id, D0, n.total) for n in m.SalesCreditNote.objects.filter(invoice__customer=c, status='POSTED')]
        rows += [(p.payment_date, 'Receipt', p.reference, p.currency_id, D0, p.amount) for p in m.Payment.objects.filter(customer=c, status='POSTED')]
        return Response(_statement(rows))

    @action(detail=True, methods=['get'], url_path='credit-status')
    def credit_status(self, request, pk=None):
        c = self.get_object()
        exp = svc.customer_exposure(c)
        od = [i for i in m.SalesInvoice.objects.filter(customer=c, status__in=('POSTED', 'PART_PAID')) if i.due_date and i.due_date < svc.today()]
        return Response({'credit_limit': c.credit_limit, 'exposure': exp, 'available': c.credit_limit - exp if c.credit_limit else None,
                         'overdue_invoices': [{'reference': i.reference, 'due': i.due_date, 'outstanding': i.outstanding} for i in od]})

    @action(detail=True, methods=['post'], url_path='set-credit-limit')
    def set_credit_limit(self, request, pk=None):
        c = self.get_object()
        new = m.dec(request.data.get('limit'))
        m.CustomerCreditLimit.objects.create(customer=c, limit=new, effective_date=svc.today(), approved_by=request.user,
                                             reason=request.data.get('reason', ''), created_by=request.user)
        c.credit_limit = new
        c.save(update_fields=['credit_limit'])
        svc.audit(request.user, 'CREDIT_LIMIT', c, {'limit': new})
        return Response({'credit_limit': new})


reg('customer-contacts', m.CustomerContact, scope='customer__company')
reg('customer-credit-limits', m.CustomerCreditLimit, scope='customer__company', readonly=True)
reg('customer-contracts', m.CustomerContract, simple_status=('ACTIVE', 'EXPIRED', 'CANCELLED'), editable=None)
reg('market-prices', m.MarketPrice, date_field='reference_date', filters_=('product',))
reg('sales-quotations', m.SalesQuotation, simple_status=('SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CONVERTED'), editable=('DRAFT', 'SENT'))


@route('sales-orders')
class SalesOrderViewSet(make_viewset(m.SalesOrder, filters_=('customer',), date_field='order_date')):
    @action(detail=True, methods=['post'])
    def reserve(self, request, pk=None):
        d = sz.ReserveIn(data=request.data)
        d.is_valid(raise_exception=True)
        res = svc.reserve_stock(self.get_object(), d.validated_data['depot'], request.user)
        return Response(sz.serializer_for(m.StockReservation)(res, many=True).data, status=201)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        so = self.get_object()
        if so.status in ('COMPLETED', 'CANCELLED') or m.SalesInvoice.objects.filter(sales_order=so).exclude(status='CANCELLED').exists():
            raise DRFValidationError({'detail': 'Order cannot be cancelled.'})
        m.StockReservation.objects.filter(sales_order=so, status='ACTIVE').update(status='RELEASED')
        so.status = 'CANCELLED'
        so.save(update_fields=['status'])
        return Response({'status': so.status})


@route('sales-invoices')
class SalesInvoiceViewSet(make_viewset(m.SalesInvoice, filters_=('customer',), date_field='invoice_date')):
    @action(detail=True, methods=['post'])
    def post(self, request, pk=None):
        d = sz.PostInvoiceIn(data=request.data)
        d.is_valid(raise_exception=True)
        inv = svc.post_sales_invoice(self.get_object(), request.user, d.validated_data['override'])
        return Response(sz.serializer_for(m.SalesInvoice)(inv).data)


@route('sales-credit-notes')
class SalesCreditNoteViewSet(make_viewset(m.SalesCreditNote, date_field='note_date')):
    @action(detail=True, methods=['post'])
    def post(self, request, pk=None):
        return Response(sz.serializer_for(m.SalesCreditNote)(svc.post_sales_credit_note(self.get_object(), request.user)).data)


class PricingView(APIView):
    """Preview selling price / margin / markup for any of the three pricing methods."""

    def post(self, request):
        d = sz.PricingIn(data=request.data)
        d.is_valid(raise_exception=True)
        v = d.validated_data
        return Response(svc.calc_price(v['method'], cost=v.get('cost'), contract_price=v.get('contract_price'), base_price=v.get('base_price'),
                                       premium=v.get('premium', 0), profit_per_litre=v.get('profit_per_litre'),
                                       markup_pct=v.get('markup_pct'), margin_pct=v.get('margin_pct')))


# ====================================================================== fleet & transport
@route('vehicles')
class VehicleViewSet(make_viewset(m.Vehicle, search=('make', 'model'), filters_=('ownership',))):
    @action(detail=True, methods=['post'], url_path='log-expense')
    def log_expense(self, request, pk=None):
        v = self.get_object()
        d = sz.VehicleExpenseIn(data=request.data)
        d.is_valid(raise_exception=True)
        x = d.validated_data
        exp, ve = svc.log_vehicle_expense(v, request.user, category=x['category'], expense_type=x['expense_type'], expense_date=x['expense_date'],
                                          amount=x['amount'], currency=x.get('currency'), litres=x.get('litres'), odometer_km=x['odometer_km'],
                                          shipment=x.get('shipment'), payment_method=x['payment_method'], bank_account=x.get('bank_account'),
                                          receipt_no=x.get('receipt_no', ''), description=x.get('description', ''))
        return Response({'expense': exp.id, 'expense_reference': exp.reference, 'vehicle_expense': ve.id}, status=201)

    @action(detail=True, methods=['get'])
    def metrics(self, request, pk=None):
        v = self.get_object()
        f = svc._filters(request.query_params, request.user)
        f['company_ids'] = [v.company_id]
        row = next((r for r in svc._vehicle_rows(f) if r[0] == v.registration_number), None)
        keys = ['vehicle', 'trips', 'km', 'operating_cost', 'cost_per_km', 'cost_per_trip', 'cost_per_delivered_litre', 'revenue', 'profit']
        return Response(dict(zip(keys, row)) if row else {})


reg('trailers', m.Trailer)
reg('drivers', m.Driver, search=('licence_number', 'id_number'))
reg('vehicle-assignments', m.VehicleAssignment, readonly=True)
reg('vehicle-maintenance', m.VehicleMaintenance, date_field='maintenance_date', filters_=('vehicle',))
reg('vehicle-expenses', m.VehicleExpense, date_field='expense_date', filters_=('vehicle', 'shipment'), readonly=True)
reg('vehicle-documents', m.VehicleDocument, filters_=('vehicle',))


@route('transporters')
class TransporterViewSet(make_viewset(m.Transporter, search=('tax_pin',))):
    @action(detail=True, methods=['get'])
    def performance(self, request, pk=None):
        t = self.get_object()
        bk = m.TransportBooking.objects.filter(transporter=t).exclude(status__in=('DRAFT', 'CANCELLED'))
        ships = m.Shipment.objects.filter(transporter=t, actual_delivery__isnull=False)
        late = sum(1 for s in ships if s.expected_delivery and s.actual_delivery > s.expected_delivery)
        short = m.ShipmentDelivery.objects.filter(shipment__transporter=t, status='APPROVED').aggregate(s=Sum('shortage_litres'))['s'] or D0
        lit, chg = bk.aggregate(q=Sum('quantity'))['q'] or D0, bk.aggregate(c=Sum('total_charge'))['c'] or D0
        return Response({'bookings': bk.count(), 'delivered_shipments': ships.count(), 'late_deliveries': late,
                         'on_time_pct': m.q3((ships.count() - late) / ships.count() * 100) if ships.count() else None,
                         'shortage_litres': short, 'avg_rate_per_litre': m.q6(chg / lit) if lit else None})

    @action(detail=True, methods=['get'])
    def statement(self, request, pk=None):
        t = self.get_object()
        rows = [(i.invoice_date, 'Invoice', i.invoice_no, i.currency_id, D0, i.total) for i in m.TransporterInvoice.objects.filter(transporter=t).exclude(status__in=('DRAFT', 'CANCELLED'))]
        rows += [(p.payment_date, 'Payment', p.reference, p.currency_id, p.amount, D0) for p in m.Payment.objects.filter(transporter=t, status='POSTED')]
        return Response(_statement(rows))


reg('transporter-contracts', m.TransporterContract, simple_status=('ACTIVE', 'EXPIRED', 'CANCELLED'), editable=None)
reg('transporter-rates', m.TransporterRate, filters_=('transporter',))
reg('transporter-vehicles', m.TransporterVehicle, filters_=('transporter', 'kind'))


@route('transport-bookings')
class TransportBookingViewSet(make_viewset(m.TransportBooking, filters_=('transporter', 'shipment'), date_field='booking_date')):
    def after_save(self, obj):
        svc.prepare_booking(obj)
        m.TransportBooking.objects.filter(pk=obj.pk).update(total_charge=obj.total_charge)

    @action(detail=False, methods=['get'], url_path='suggest-rate')
    def suggest_rate(self, request):
        p = request.query_params
        r = svc.suggest_transport_rate(m.Transporter.objects.get(pk=p['transporter'], company_id__in=allowed(request.user)), p['origin'], p['destination'], p.get('date'))
        return Response({'rate_per_litre': r.rate_per_litre, 'rate_per_trip': r.rate_per_trip, 'currency': r.currency_id} if r else {})


@route('transporter-invoices')
class TransporterInvoiceViewSet(make_viewset(m.TransporterInvoice, filters_=('transporter', 'booking'), date_field='invoice_date')):
    def after_save(self, obj):
        obj.recalc()

    @action(detail=True, methods=['post'])
    def post(self, request, pk=None):
        return Response(sz.serializer_for(m.TransporterInvoice)(svc.post_transporter_invoice(self.get_object(), request.user)).data)


# ====================================================================== shipments, customs


@route('shipments')
class ShipmentViewSet(make_viewset(m.Shipment,
                                   filters_=('customer', 'supplier', 'product', 'truck_ownership', 'transporter', 'vehicle',
                                             'shipment_type', 'priority', 'sales_order'),
                                   search=('origin', 'destination', 'destination_county', 'customer__name'),
                                   date_field='loading_date')):
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    @action(detail=True, methods=['post'], url_path='update-status')
    def update_status(self, request, pk=None):
        d = sz.StatusUpdateIn(data=request.data)
        d.is_valid(raise_exception=True)
        v = d.validated_data
        sh, h = svc.update_shipment_status(self.get_object(), v['new_status'], request.user, when=v.get('when'), location=v.get('location', ''),
                                           comments=v.get('comments', ''), confirmation_type=v['confirmation_type'],
                                           confirmed_by=v.get('confirmed_by', ''), attachment=v.get('attachment'))
        return Response({'status': sh.status, 'history_id': h.id})

    @action(detail=True, methods=['post'], url_path='record-loading')
    def record_loading(self, request, pk=None):
        d = sz.LoadingIn(data=request.data)
        d.is_valid(raise_exception=True)
        v = d.validated_data
        sh = svc.record_loading(self.get_object(), [dict(l) for l in v['lines']], request.user, v.get('loading_date'))
        return Response({'loading_quantity': sh.loading_quantity})

    @action(detail=True, methods=['post'], url_path='trip-data')
    def trip_data(self, request, pk=None):
        d = sz.TripDataIn(data=request.data)
        d.is_valid(raise_exception=True)
        svc.update_trip_data(self.get_object(), request.user, **d.validated_data)
        return Response({'ok': True})

    @action(detail=True, methods=['post'], url_path='record-delivery')
    def record_delivery(self, request, pk=None):
        d = sz.DeliveryIn(data=request.data)
        d.is_valid(raise_exception=True)
        v = dict(d.validated_data)
        # services.record_delivery does not know the receiver details; store them on the delivery afterwards.
        extras = {k: v.pop(k) for k in ('receiver_contact', 'delivery_note_no', 'receiver_signature') if k in v}
        dv = svc.record_delivery(self.get_object(), request.user, **v)
        if extras:
            for k, val in extras.items():
                setattr(dv, k, val)
            dv.save(update_fields=list(extras))
        return Response(sz.serializer_for(m.ShipmentDelivery)(dv, context=self.get_serializer_context()).data, status=201)

    @action(detail=True, methods=['post'])
    def cost(self, request, pk=None):
        d = sz.CostIn(data=request.data)
        d.is_valid(raise_exception=True)
        v = d.validated_data
        sheet = svc.compute_cost_sheet(self.get_object(), request.user, finalize=v['finalize'], reopen=v['reopen'], notes=v.get('notes', ''))
        return Response(sz.ShipmentCostSheetSerializer(sheet).data, status=201)

    @action(detail=True, methods=['get'], url_path='cost-sheets')
    def cost_sheets(self, request, pk=None):
        qs = m.ShipmentCostSheet.objects.filter(shipment=self.get_object())
        return Response(sz.ShipmentCostSheetSerializer(qs, many=True).data)

    @action(detail=True, methods=['get'], url_path='cost-sheet/export')
    def export_cost_sheet(self, request, pk=None):
        sheet = m.ShipmentCostSheet.objects.filter(shipment=self.get_object()).order_by('-version').first()
        if not sheet:
            raise DRFValidationError({'detail': 'No cost sheet yet. Compute one first.'})
        title, cols, rows = svc.cost_sheet_table(sheet)
        return table_response(request, {'title': title, 'columns': cols, 'rows': rows})

    @action(detail=True, methods=['get'])
    def fuel(self, request, pk=None):
        return Response(svc.fuel_variance(self.get_object()) or {})

    @action(detail=True, methods=['get'])
    def compliance(self, request, pk=None):
        """Vehicle / driver / truck readiness checklist (display only; the server still enforces it at loading and dispatch)."""
        return Response(sx.shipment_compliance(self.get_object()))

    @action(detail=True, methods=['get'])
    def timeline(self, request, pk=None):
        qs = m.ShipmentStatusHistory.objects.filter(shipment=self.get_object()).select_related('updated_by')
        return Response([{'id': h.id, 'from': h.previous_status, 'to': h.new_status, 'at': h.changed_at, 'location': h.location,
                          'by': str(h.updated_by or ''), 'comments': h.comments, 'confirmation': h.confirmation_type,
                          'confirmed_by': h.confirmed_by, 'attachment': request.build_absolute_uri(h.attachment.url) if h.attachment else None} for h in qs])


reg('shipment-status-history', m.ShipmentStatusHistory, readonly=True, filters_=('shipment',))
reg('shipment-stages', m.ShipmentStage, filters_=('shipment',))
reg('shipment-documents', m.ShipmentDocument, filters_=('shipment', 'doc_type'))
reg('shipment-deliveries', m.ShipmentDelivery, readonly=True, filters_=('shipment',), date_field='delivery_date')
reg('shipment-allocations', m.ShipmentCostAllocation, readonly=True, filters_=('shipment', 'expense'))
reg('export-declarations', m.ExportDeclaration, filters_=('shipment',), simple_status=('SUBMITTED', 'QUERIED', 'CLEARED', 'REJECTED'), editable=None)
reg('compliance-checks', m.ShipmentComplianceCheck, filters_=('shipment',))


@route('cost-sheets')
class CostSheetViewSet(make_viewset(m.ShipmentCostSheet, readonly=True, filters_=('shipment', 'is_final'))):
    pass


@route('trip-advances')
class TripAdvanceViewSet(make_viewset(m.TripAdvance, filters_=('shipment', 'recipient'),
                                      search=('recipient_name', 'payment_reference'))):
    """
    Trip budget -> advance -> reconciliation.
      POST   /trip-advances/                         create (DRAFT) with lines
      PUT    /trip-advances/:id/                     edit (DRAFT only; handled by BaseViewSet)
      POST   /trip-advances/:id/submit/              send for approval (BaseViewSet, uses the approval policy)
      POST   /trip-advances/:id/adjust/              approver reduces approved amounts (while awaiting approval)
      POST   /trip-advances/:id/pay/                 record the payment (after approval)
      POST   /trip-advances/:id/submit-reconciliation/    actual spend submitted
      POST   /trip-advances/:id/approve-reconciliation/   another user approves -> draft Expenses are created
      POST   /trip-advances/:id/reject-reconciliation/
      Approve / reject of the advance itself happens on the Approvals page (/approvals/:id/approve|reject).
    """

    def _out(self, adv):
        adv.refresh_from_db()
        return Response(sz.serializer_for(m.TripAdvance)(adv, context=self.get_serializer_context()).data)

    @action(detail=True, methods=['post'])
    def adjust(self, request, pk=None):
        d = sz.TripAdvanceAdjustIn(data=request.data)
        d.is_valid(raise_exception=True)
        adv = sx.adjust_approved_amounts(self.get_object(), request.user, [dict(l) for l in d.validated_data['lines']])
        return self._out(adv)

    @action(detail=True, methods=['post'])
    def pay(self, request, pk=None):
        d = sz.TripAdvancePayIn(data=request.data)
        d.is_valid(raise_exception=True)
        v = d.validated_data
        adv = sx.pay_trip_advance(self.get_object(), request.user, payment_method=v['payment_method'],
                                  bank_account=v.get('bank_account'), payment_reference=v.get('payment_reference', ''),
                                  recipient=v.get('recipient'), recipient_name=v.get('recipient_name', ''),
                                  recipient_phone=v.get('recipient_phone', ''))
        return self._out(adv)

    @action(detail=True, methods=['post'], url_path='submit-reconciliation')
    def submit_reconciliation(self, request, pk=None):
        d = sz.TripAdvanceReconcileIn(data=request.data)
        d.is_valid(raise_exception=True)
        v = d.validated_data
        adv = sx.submit_reconciliation(self.get_object(), request.user, [dict(l) for l in v['lines']],
                                       returned_amount=v.get('returned_amount', 0), return_reference=v.get('return_reference', ''),
                                       notes=v.get('notes', ''))
        return self._out(adv)

    @action(detail=True, methods=['post'], url_path='approve-reconciliation')
    def approve_reconciliation(self, request, pk=None):
        return self._out(sx.approve_reconciliation(self.get_object(), request.user))

    @action(detail=True, methods=['post'], url_path='reject-reconciliation')
    def reject_reconciliation(self, request, pk=None):
        d = sz.ApprovalDecisionIn(data=request.data)
        d.is_valid(raise_exception=True)
        return self._out(sx.reject_reconciliation(self.get_object(), request.user, d.validated_data.get('comment', '')))



@route('cost-sheets')
class CostSheetViewSet(make_viewset(m.ShipmentCostSheet, readonly=True, filters_=('shipment', 'is_final'))):
    pass


# ====================================================================== expenses & payments
reg('expense-categories', m.ExpenseCategory, scope=None)


@route('expenses')
class ExpenseViewSet(make_viewset(m.Expense, filters_=('category', 'shipment', 'vehicle', 'supplier', 'transporter'), date_field='expense_date')):
    @action(detail=True, methods=['post'])
    def post(self, request, pk=None):
        return Response(sz.ExpenseSerializer(svc.post_expense(self.get_object(), request.user), context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def allocate(self, request, pk=None):
        d = sz.ExpenseAllocateIn(data=request.data)
        d.is_valid(raise_exception=True)
        v = d.validated_data
        out = svc.allocate_expense(self.get_object(), [dict(t) for t in v['targets']], v['method'], request.user, v['replace'])
        return Response(sz.serializer_for(m.ShipmentCostAllocation)(out, many=True).data, status=201)


@route('payments')
class PaymentViewSet(make_viewset(m.Payment, filters_=('direction', 'party_type', 'method', 'bank_account', 'customer', 'supplier', 'transporter'),
                                  search=('mpesa_reference', 'bank_reference', 'payer_phone'), date_field='payment_date')):
    @action(detail=True, methods=['post'])
    def submit(self, request, pk=None):
        req = svc.request_payment_approval(self.get_object(), request.user)
        return Response({'status': 'AWAITING_APPROVAL', 'approval_request': req.id})

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        p = self.get_object()
        req = m.ApprovalRequest.objects.filter(content_type=m.ContentType.objects.get_for_model(p), object_id=p.pk, status='PENDING').first()
        if not req:
            raise DRFValidationError({'detail': 'Submit the payment for approval first.'})
        svc.decide_approval(req, request.user, True, request.data.get('comment', ''))
        return Response({'status': 'APPROVED'})

    @action(detail=True, methods=['post'])
    def post(self, request, pk=None):
        p = self.get_object()
        d = sz.PaymentPostIn(data=request.data)
        d.is_valid(raise_exception=True)
        allocs = [{k: (v.pk if hasattr(v, 'pk') else v) for k, v in a.items()} for a in d.validated_data.get('allocations', [])]
        return Response(sz.serializer_for(m.Payment)(svc.post_payment(p, request.user, allocs)).data)

    @action(detail=True, methods=['post'], url_path='apply-advance')
    def apply_advance(self, request, pk=None):
        d = sz.PaymentPostIn(data=request.data)
        d.is_valid(raise_exception=True)
        allocs = [{k: (v.pk if hasattr(v, 'pk') else v) for k, v in a.items()} for a in d.validated_data.get('allocations', [])]
        return Response(sz.serializer_for(m.Payment)(svc.apply_advance(self.get_object(), allocs, request.user)).data)

    @action(detail=True, methods=['post'])
    def reverse(self, request, pk=None):
        return Response(sz.serializer_for(m.Payment)(svc.reverse_payment(self.get_object(), request.user, request.data.get('reason', ''))).data)

    @action(detail=True, methods=['get'], url_path='suggest-matches')
    def suggest_matches(self, request, pk=None):
        return Response(svc.suggest_invoice_matches(self.get_object()))


@route('bank-accounts')
class BankAccountViewSet(make_viewset(m.BankAccount, filters_=('account_type', 'currency'))):
    @action(detail=True, methods=['post'], url_path='import-statement', parser_classes=[MultiPartParser, FormParser, JSONParser])
    def import_statement(self, request, pk=None):
        ba = self.get_object()
        d = sz.StatementImportIn(data=request.data)
        d.is_valid(raise_exception=True)
        text = d.validated_data.get('csv') or (d.validated_data['file'].read().decode('utf-8-sig') if d.validated_data.get('file') else '')
        if not text:
            raise DRFValidationError({'detail': 'Upload a CSV file or send csv text.'})
        return Response(svc.import_bank_statement(ba, text, request.user))

    @action(detail=True, methods=['post'], url_path='auto-match')
    def auto_match(self, request, pk=None):
        return Response({'matched': svc.auto_match_bank(self.get_object(), request.user)})

    @action(detail=True, methods=['post'])
    def reconcile(self, request, pk=None):
        d = sz.BankReconIn(data=request.data)
        d.is_valid(raise_exception=True)
        v = d.validated_data
        r = svc.create_bank_reconciliation(self.get_object(), v['statement_date'], v['statement_balance'], request.user, v.get('notes', ''))
        return Response(sz.serializer_for(m.BankReconciliation)(r).data, status=201)

    @action(detail=True, methods=['get'])
    def balance(self, request, pk=None):
        ba = self.get_object()
        return Response({'book_balance': svc.book_balance(ba, request.query_params.get('as_of')), 'currency': ba.currency_id})


@route('bank-transactions')
class BankTransactionViewSet(make_viewset(m.BankTransaction, readonly=True, filters_=('bank_account',), date_field='txn_date')):
    http_method_names = ['get', 'post', 'head', 'options']

    @action(detail=True, methods=['post'])
    def match(self, request, pk=None):
        d = sz.MatchIn(data=request.data)
        d.is_valid(raise_exception=True)
        return Response(sz.serializer_for(m.BankTransaction)(svc.match_bank_transaction(self.get_object(), d.validated_data['payment'], request.user)).data)

    @action(detail=True, methods=['post'])
    def ignore(self, request, pk=None):
        t = self.get_object()
        t.status = 'IGNORED'
        t.save(update_fields=['status'])
        return Response({'status': t.status})


reg('bank-reconciliations', m.BankReconciliation, readonly=True)


# ====================================================================== general ledger & finance
reg('accounts', m.Account, filters_=('account_type', 'subtype'), search=('group_code',))


@route('journals')
class JournalViewSet(viewsets.ReadOnlyModelViewSet):
    """Posted journals are read-only; manual journals via /manual/, corrections via /reverse/."""
    permission_classes = [IsAuthenticated, RolePermission]
    serializer_class = sz.JournalSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['company', 'status', 'source_type', 'is_closing']
    search_fields = ['reference', 'description']

    def get_queryset(self):
        qs = m.Journal.objects.filter(company_id__in=allowed(self.request.user)).prefetch_related('lines__account').select_related('company', 'period')
        p = self.request.query_params
        if p.get('date_from'): qs = qs.filter(date__gte=p['date_from'])
        if p.get('date_to'): qs = qs.filter(date__lte=p['date_to'])
        if p.get('account'): qs = qs.filter(lines__account_id=p['account']).distinct()
        return qs

    @action(detail=False, methods=['post'])
    def manual(self, request):
        d = sz.ManualJournalIn(data=request.data)
        d.is_valid(raise_exception=True)
        v = d.validated_data
        check_company(request.user, v['company'])
        j = svc.post_manual_journal(v['company'], v['date'], v['description'], [dict(l) for l in v['lines']], request.user)
        return Response(sz.JournalSerializer(j).data, status=201)

    @action(detail=True, methods=['post'])
    def reverse(self, request, pk=None):
        d = sz.ReverseIn(data=request.data)
        d.is_valid(raise_exception=True)
        rev = svc.reverse_journal(self.get_object(), request.user, d.validated_data.get('reason', ''), d.validated_data.get('date'))
        return Response(sz.JournalSerializer(rev).data, status=201)


@route('fixed-assets')
class FixedAssetViewSet(make_viewset(m.FixedAsset, filters_=('category',), date_field='acquisition_date')):
    @action(detail=False, methods=['post'], url_path='run-depreciation')
    def run_depreciation(self, request):
        d = sz.DepreciationIn(data=request.data)
        d.is_valid(raise_exception=True)
        check_company(request.user, d.validated_data['company'])
        out = svc.run_depreciation(d.validated_data['company'], d.validated_data['period_end'], request.user)
        return Response({'depreciated': [a.reference for a in out]})

    @action(detail=True, methods=['post'])
    def dispose(self, request, pk=None):
        d = sz.DisposeIn(data=request.data)
        d.is_valid(raise_exception=True)
        v = d.validated_data
        return Response(sz.serializer_for(m.FixedAsset)(svc.dispose_asset(self.get_object(), v['proceeds'], v['date'], v['bank_account'], request.user)).data)

    @action(detail=True, methods=['post'])
    def transfer(self, request, pk=None):
        a = self.get_object()
        a.location = request.data.get('location', a.location)
        a.save(update_fields=['location'])
        svc.audit(request.user, 'ASSET_TRANSFER', a, {'location': a.location})
        return Response({'location': a.location})


# ====================================================================== payroll / HR
reg('employees', m.Employee, search=('national_id',))
reg('leave-requests', m.LeaveRequest, simple_status=('APPROVED', 'REJECTED'), editable=('DRAFT',), filters_=('employee',))
reg('payroll-configs', m.PayrollConfig)


@route('payroll-runs')
class PayrollRunViewSet(make_viewset(m.PayrollRun, date_field='period_end')):
    @action(detail=True, methods=['post'])
    def process(self, request, pk=None):
        d = sz.PayrollIn(data=request.data)
        d.is_valid(raise_exception=True)
        run = svc.run_payroll(self.get_object(), request.user, {str(k): v for k, v in d.validated_data.get('overtime', {}).items()})
        return Response(sz.serializer_for(m.PayrollRun)(run).data)

    @action(detail=True, methods=['get'])
    def payslips(self, request, pk=None):
        qs = m.Payslip.objects.filter(run=self.get_object()).select_related('employee')
        return Response([{'employee': str(p.employee), 'basic': p.basic, 'allowances': p.allowances, 'overtime': p.overtime, 'gross': p.gross,
                          'deductions': p.deductions, 'total_deductions': p.total_deductions, 'net_pay': p.net_pay} for p in qs])


# ====================================================================== group accounting
@route('intercompany')
class IntercompanyViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAuthenticated, RolePermission]
    serializer_class = sz.IntercompanySerializer

    def get_queryset(self):
        ids = allowed(self.request.user)
        return m.IntercompanyTransaction.objects.filter(Q(from_company_id__in=ids) | Q(to_company_id__in=ids)).order_by('-id')

    @action(detail=False, methods=['post'])
    def sale(self, request):
        d = sz.IntercompanySaleIn(data=request.data)
        d.is_valid(raise_exception=True)
        v = d.validated_data
        t = svc.create_intercompany_sale(v['seller'], v['buyer'], v['product'], v['quantity'], v['transfer_price'], v['currency'], v['date'],
                                         request.user, from_tank=v.get('from_tank'), to_tank=v.get('to_tank'), shipment=v.get('shipment'), notes=v.get('notes', ''))
        return Response(sz.IntercompanySerializer(t).data, status=201)

    @action(detail=True, methods=['post'])
    def settle(self, request, pk=None):
        d = sz.IntercompanySettleIn(data=request.data)
        d.is_valid(raise_exception=True)
        v = d.validated_data
        t = svc.settle_intercompany(self.get_object(), v['amount'], v['date'], v['seller_bank'], v['buyer_bank'], request.user)
        return Response(sz.IntercompanySerializer(t).data)

    @action(detail=False, methods=['post'])
    def reconcile(self, request):
        return Response(svc.reconcile_intercompany(svc.as_date(request.data.get('as_of'))))


@route('consolidation-runs')
class ConsolidationViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAuthenticated, RolePermission]
    queryset = m.ConsolidationRun.objects.order_by('-id')
    serializer_class = sz.make_serializer(m.ConsolidationRun)

    @action(detail=False, methods=['post'])
    def run(self, request):
        if not request.user.is_group_admin and len(allowed(request.user)) < m.Company.objects.filter(is_active=True).count():
            raise PermissionDenied('Consolidation needs access to every group entity.')
        d = sz.ConsolidateIn(data=request.data)
        d.is_valid(raise_exception=True)
        v = d.validated_data
        run = svc.run_consolidation(v['period_start'], v['period_end'], request.user, v.get('reporting_currency'))
        return Response(self.get_serializer(run).data, status=201)

    @action(detail=True, methods=['get'])
    def eliminations(self, request, pk=None):
        qs = m.EliminationJournal.objects.filter(run=self.get_object()).order_by('entry_no', 'id')
        return Response([{'entry': e.entry_no, 'description': e.description, 'account': e.account_group_code, 'debit': e.debit, 'credit': e.credit} for e in qs])


class RevalueView(APIView):
    def post(self, request):
        d = sz.RevalueIn(data=request.data)
        d.is_valid(raise_exception=True)
        v = d.validated_data
        check_company(request.user, v['company'])
        res = svc.revalue_foreign_balances(v['company'], v['as_of'], request.user, v['post'])
        return table_response(request, {'title': 'Unrealized FX', **res})


# ====================================================================== approvals, notifications, audit
@route('approvals')
class ApprovalViewSet(make_viewset(m.ApprovalRequest, readonly=True, filters_=('doc_type',))):
    http_method_names = ['get', 'post', 'head', 'options']

    def _decide(self, request, ok):
        d = sz.ApprovalDecisionIn(data=request.data)
        d.is_valid(raise_exception=True)
        svc.decide_approval(self.get_object(), request.user, ok, d.validated_data.get('comment', ''))
        return Response({'status': 'APPROVED' if ok else 'REJECTED'})

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        return self._decide(request, True)

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        return self._decide(request, False)


@route('notifications')
class NotificationViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = sz.NotificationSerializer

    def get_queryset(self):
        return m.Notification.objects.filter(user=self.request.user).order_by('-id')

    @action(detail=True, methods=['post'], url_path='read')
    def read(self, request, pk=None):
        self.get_queryset().filter(pk=pk).update(is_read=True)
        return Response({'ok': True})

    @action(detail=False, methods=['post'], url_path='read-all')
    def read_all(self, request):
        self.get_queryset().update(is_read=True)
        return Response({'ok': True})

    @action(detail=False, methods=['get'])
    def unread(self, request):
        return Response({'count': self.get_queryset().filter(is_read=False).count()})


@route('audit-logs')
class AuditViewSet(viewsets.ReadOnlyModelViewSet):
    roles = AUDIT_ROLES                      # ignored: restricted in the frontend
    permission_classes = [IsAuthenticated, RolePermission]
    serializer_class = sz.AuditLogSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['company', 'user', 'action', 'model_name']
    search_fields = ['object_repr', 'object_id', 'action']

    def get_queryset(self):
        ids = allowed(self.request.user)
        return m.AuditLog.objects.filter(Q(company_id__in=ids) | Q(company__isnull=True)).order_by('-id') if self.request.user.is_group_admin else \
            m.AuditLog.objects.filter(company_id__in=ids).order_by('-id')

    @action(detail=False, methods=['get'])
    def verify(self, request):
        return Response(svc.verify_audit_chain())


reg('alerts', m.Alert, filters_=('kind', 'severity', 'is_resolved'))


# ====================================================================== reports, dashboard, AI
class ReportListView(APIView):
    def get(self, request):
        return Response([{'name': k} for k in svc.REPORTS])


class ReportView(APIView):
    """GET /reports/<name>/?company=&country=&date_from=&date_to=&product=&customer=&shipment=&account=&export=xlsx|pdf"""

    def get(self, request, name):
        if name not in svc.REPORTS:
            raise DRFValidationError({'detail': 'Unknown report.'})
        fn = svc.REPORTS[name][0]
        f = svc._filters(request.query_params, request.user)
        if not f['company_ids']:
            raise PermissionDenied('No authorised legal entity selected.')
        return table_response(request, fn(f))


class DashboardView(APIView):
    """Dashboard figures. Which cards a role sees is decided in the frontend; the API returns everything
    for the user's allowed legal entities."""

    def get(self, request):
        u = request.user
        f = svc._filters(request.query_params, u)
        data = svc.dashboard_metrics(f, request.query_params.get('period', 'monthly'))
        data['summary'] = [{k: v for k, v in r.items() if k != 'finance'} for r in data['summary']]
        return Response(data)


class AIView(APIView):
    def post(self, request, op):
        if op == 'ask':
            d = sz.AIAskIn(data=request.data)
            d.is_valid(raise_exception=True)
            return Response(svc.ai_answer(d.validated_data['question'], svc._filters(request.data, request.user)))
        if op == 'scan':
            ids = svc._filters(request.data, request.user)['company_ids']
            made = svc.run_ai_scan(ids, request.user)
            return Response({'alerts_created': len(made)})
        if op == 'price-recommendation':
            d = sz.PriceRecIn(data=request.data)
            d.is_valid(raise_exception=True)
            v = d.validated_data
            check_company(request.user, v['company'])
            return Response(svc.price_recommendation(v['company'], v['product'], v['target_margin_pct']))
        raise DRFValidationError({'detail': 'Unknown AI operation.'})

    def get(self, request, op):
        ids = svc._filters(request.query_params, request.user)['company_ids']
        if op == 'cash-forecast':
            return Response(svc.cash_forecast(ids, int(request.query_params.get('days', 30))))
        if op == 'credit-risk':
            return Response(svc.customer_credit_risk(ids))
        if op == 'anomalies':
            return Response({'expense_anomalies': svc.detect_expense_anomalies(ids), 'duplicate_invoices': svc.detect_duplicate_invoices(ids)})
        if op == 'supplier-prices':
            return Response(svc.supplier_price_comparison(ids, request.query_params.get('product')))
        raise DRFValidationError({'detail': 'Unknown AI operation.'})