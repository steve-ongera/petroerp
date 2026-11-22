"""
PetroERP business logic.

Rules enforced here (never in the frontend):
  * every financial posting goes through post_journal() -> balanced, period-checked, immutable
  * every multi-record operation is @transaction.atomic
  * the costing engine only READS expense allocations -> no double counting
  * AI helpers only read data and create Alerts; they never approve or post
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


def notify_perm(company, perm, title, message='', level='INFO', link=''):
    users = User.objects.filter(is_active=True).filter(
        Q(is_superuser=True) | Q(role__code='GROUP_ADMIN') |
        Q(role__permissions__code=perm, companies=company)).distinct()
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
    notify_perm(obj.company, 'approvals.decide', f'Approval needed: {name} {obj}', summary, link='/approvals')
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
    if margin_pct is not None and margin_pct < floor and not user.has_perm_code('sales.below_margin'):
        err(f'Margin {margin_pct}% is below the minimum approved margin {floor}% for {product.name}. '
            f'Authorisation (sales.below_margin) is required.')


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
        notify_perm(sh.company, 'approvals.decide', f'Shipment variance {sh.reference}', f'{shortage} L short', 'WARNING')
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
def _approve_booking(b, user):
    pass


APPROVAL_HOOKS = {
    'StockAdjustment': _approve_stock_adjustment,
    'ShipmentDelivery': _post_delivery,
}