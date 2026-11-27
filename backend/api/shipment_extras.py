"""
shipment_extras.py  -  NEW FILE (put it next to services.py / views.py in the `api` app).

Business logic for the new shipment features. It is deliberately kept out of services.py so nothing
in the existing modules has to change:

  * registers the TripAdvance approval workflow into services.APPROVAL_FLOW / APPROVAL_HOOKS
    (this happens when views.py imports this module)
  * trip advance actions: adjust approved amounts, pay, submit reconciliation, approve / reject reconciliation
  * shipment_compliance(): vehicle / driver / truck readiness checklist for the detail page

Accounting note
  Paying an advance only RECORDS the payment (method, reference, who, when). It does not post a journal.
  When the reconciliation is approved, one DRAFT Expense per line with actual spend is created for the
  shipment. Those expenses go through the normal Expenses flow (approve -> post), which is where the
  ledger entry and the shipment costing allocation happen. Cash handed back needs no entry for that reason.
"""
from django.db import transaction
from django.utils import timezone

from . import services as svc
from .models import D0, Expense, Shipment, TransportBooking, TripAdvance, q2

err = svc.err


# =========================================================== approval workflow registration
# (from_status, pending_status, approved_status, rejected_status)  - a rejected advance goes back to DRAFT
svc.APPROVAL_FLOW['TripAdvance'] = ('DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'DRAFT')


def _approve_trip_advance(adv, user):
    """Runs when the approval is granted. Unless the approver adjusted the amounts, approve what was requested."""
    lines = list(adv.lines.all())
    if not any(l.approved_amount for l in lines):
        for l in lines:
            l.approved_amount = l.requested_amount
            l.save(update_fields=['approved_amount'])


svc.APPROVAL_HOOKS['TripAdvance'] = _approve_trip_advance


# =========================================================== trip advance actions
@transaction.atomic
def adjust_approved_amounts(adv, user, items):
    """Approver may reduce amounts while the advance is awaiting approval. items: [{id, approved_amount}]."""
    adv = TripAdvance.objects.select_for_update().get(pk=adv.pk)
    if adv.status != 'AWAITING_APPROVAL':
        err('Approved amounts can only be adjusted while the advance is awaiting approval.')
    by_id = {l.id: l for l in adv.lines.all()}
    for it in items:
        line = by_id.get(it['id'])
        if not line:
            err(f'Line {it["id"]} does not belong to this advance.')
        amount = q2(it['approved_amount'])
        if amount < 0 or amount > line.requested_amount:
            err(f'Approved amount for {line.category.name} must be between 0 and the requested {line.requested_amount}.')
        line.approved_amount = amount
        line.save(update_fields=['approved_amount'])
    svc.audit(user, 'TRIP_ADVANCE_ADJUST', adv, {'approved_total': adv.approved_total})
    return adv


@transaction.atomic
def pay_trip_advance(adv, user, *, payment_method, bank_account=None, payment_reference='', recipient=None,
                     recipient_name='', recipient_phone=''):
    adv = TripAdvance.objects.select_for_update().get(pk=adv.pk)
    if adv.status != 'APPROVED':
        err('Only an approved trip advance can be paid.')
    total = adv.approved_total
    if total <= 0:
        err('The approved total is zero; there is nothing to pay.')
    if payment_method in ('MPESA', 'BANK') and not payment_reference:
        err('Enter the M-Pesa / bank payment reference.')
    if bank_account is not None and bank_account.company_id != adv.company_id:
        err('The paying account belongs to another legal entity.')
    adv.payment_method = payment_method
    adv.bank_account = bank_account
    adv.payment_reference = payment_reference
    if recipient is not None:
        adv.recipient = recipient
    if recipient_name:
        adv.recipient_name = recipient_name
    if recipient_phone:
        adv.recipient_phone = recipient_phone
    if not adv.recipient_name:
        err('Enter the name of the person receiving the advance.')
    adv.paid_amount, adv.paid_at, adv.paid_by, adv.status = total, timezone.now(), user, 'PAID'
    adv.save()
    svc.audit(user, 'TRIP_ADVANCE_PAID', adv, {'amount': total, 'method': payment_method, 'reference': payment_reference})
    return adv


@transaction.atomic
def submit_reconciliation(adv, user, lines, returned_amount=0, return_reference='', notes=''):
    """The driver / responsible employee submits actual spend. lines: [{id, actual_amount, receipt_no?, legal_basis?, issuing_authority?}]."""
    adv = TripAdvance.objects.select_for_update().get(pk=adv.pk)
    if adv.status not in ('PAID', 'RECONCILIATION_PENDING'):
        err('Expenses can only be reconciled for an advance that has been paid.')
    by_id = {l.id: l for l in adv.lines.all()}
    for it in lines:
        line = by_id.get(it['id'])
        if not line:
            err(f'Line {it["id"]} does not belong to this advance.')
        actual = q2(it['actual_amount'])
        if actual < 0:
            err('Actual amounts cannot be negative.')
        line.actual_amount = actual
        for f in ('receipt_no', 'legal_basis', 'issuing_authority'):
            if f in it and it[f] is not None:
                setattr(line, f, it[f])
        line.save()
    returned = q2(returned_amount)
    if returned < 0 or returned > adv.paid_amount:
        err('The returned amount must be between 0 and the advance that was paid.')
    adv.returned_amount, adv.return_reference, adv.reconciliation_notes = returned, return_reference, notes[:255]
    adv.status, adv.reconciled_by, adv.reconciled_at = 'RECONCILIATION_PENDING', user, timezone.now()
    adv.save()
    svc.audit(user, 'TRIP_ADVANCE_RECONCILE_SUBMIT', adv, {'actual': adv.actual_total, 'returned': returned})
    return adv


@transaction.atomic
def approve_reconciliation(adv, user):
    """A DIFFERENT user approves. Creates a draft Expense per line with actual spend (posted later in Expenses)."""
    adv = TripAdvance.objects.select_for_update().get(pk=adv.pk)
    if adv.status != 'RECONCILIATION_PENDING':
        err('This advance is not awaiting reconciliation approval.')
    if adv.reconciled_by_id == user.id:
        err('Segregation of duties: someone other than the person who submitted the reconciliation must approve it.')
    if adv.company_id not in user.allowed_company_ids():
        err('You are not authorised for this legal entity.')
    sh = adv.shipment
    owned = sh.truck_ownership == 'OWNED'
    for line in adv.lines.select_related('category'):
        if line.actual_amount <= 0 or line.expense_id:
            continue
        exp = Expense.objects.create(
            company=adv.company, expense_date=svc.today(), category=line.category,
            description=f'{adv.reference} - {line.description or line.category.name}'[:255],
            shipment=sh, vehicle=sh.vehicle if owned else None, payee=(adv.recipient_name or '')[:150],
            truck_ownership='OWNED' if owned else 'HIRED', amount=line.actual_amount,
            payment_method=adv.payment_method, bank_account=adv.bank_account, receipt_no=line.receipt_no,
            status='DRAFT', created_by=user)
        line.expense = exp
        line.save(update_fields=['expense'])
    adv.status = 'RECONCILED'
    adv.reconciliation_approved_by, adv.reconciliation_approved_at = user, timezone.now()
    adv.save()
    svc.audit(user, 'TRIP_ADVANCE_RECONCILED', adv, {'actual': adv.actual_total, 'to_return': adv.balance_to_return})
    return adv


@transaction.atomic
def reject_reconciliation(adv, user, comment=''):
    adv = TripAdvance.objects.select_for_update().get(pk=adv.pk)
    if adv.status != 'RECONCILIATION_PENDING':
        err('This advance is not awaiting reconciliation approval.')
    if adv.reconciled_by_id == user.id:
        err('Segregation of duties: someone other than the person who submitted the reconciliation must decide.')
    adv.status = 'PAID'
    if comment:
        adv.reconciliation_notes = f'Rejected: {comment}'[:255]
    adv.save()
    svc.audit(user, 'TRIP_ADVANCE_RECONCILE_REJECTED', adv, {'comment': comment})
    return adv


# =========================================================== fleet / driver readiness (display only)
def shipment_compliance(sh):
    """
    Checklist shown on the shipment page. It mirrors services.check_dispatch_resources (which still
    enforces the rules when the shipment goes to LOADING / DISPATCHED) and adds the capacity check.
    """
    today = svc.today()
    checks, info = [], {'vehicle': None, 'driver': None, 'transporter': None, 'hired_truck': None}

    def add(key, label, ok, detail=''):
        checks.append({'key': key, 'label': label, 'ok': bool(ok), 'detail': detail})

    capacity = D0
    if sh.truck_ownership == 'OWNED':
        v, d = sh.vehicle, sh.driver
        add('vehicle_assigned', 'Vehicle assigned', v, '' if v else 'No vehicle selected')
        add('driver_assigned', 'Driver assigned', d, '' if d else 'No driver selected')
        if v:
            capacity = v.tank_capacity
            info['vehicle'] = {'id': v.id, 'registration_number': v.registration_number, 'truck_type': v.truck_type,
                               'make': v.make, 'model': v.model, 'tank_capacity': v.tank_capacity, 'status': v.status,
                               'insurance_expiry': v.insurance_expiry, 'inspection_expiry': v.inspection_expiry,
                               'odometer_km': v.odometer_km}
            add('vehicle_available', 'Vehicle available for trips', v.status not in ('MAINTENANCE', 'INACTIVE'),
                f'Status: {v.status}')
            add('insurance', 'Insurance valid', not v.insurance_expiry or v.insurance_expiry >= today,
                f'Expires {v.insurance_expiry}' if v.insurance_expiry else 'No expiry date recorded')
            add('inspection', 'Inspection valid', not v.inspection_expiry or v.inspection_expiry >= today,
                f'Expires {v.inspection_expiry}' if v.inspection_expiry else 'No expiry date recorded')
            busy = Shipment.objects.filter(status__in=svc.ACTIVE_SHIPMENT, vehicle=v).exclude(pk=sh.pk)
            add('vehicle_free', 'Vehicle not on another active shipment', not busy.exists(),
                ', '.join(busy.values_list('reference', flat=True)[:3]))
        if d:
            info['driver'] = {'id': d.id, 'full_name': d.full_name, 'phone': d.phone, 'licence_number': d.licence_number,
                              'licence_category': d.licence_category, 'licence_expiry': d.licence_expiry,
                              'employment_status': d.employment_status}
            add('driver_active', 'Driver is active', d.employment_status == 'ACTIVE', f'Status: {d.employment_status}')
            add('licence', 'Driving licence valid', not d.licence_expiry or d.licence_expiry >= today,
                f'Expires {d.licence_expiry}' if d.licence_expiry else 'No expiry date recorded')
            busy = Shipment.objects.filter(status__in=svc.ACTIVE_SHIPMENT, driver=d).exclude(pk=sh.pk)
            add('driver_free', 'Driver not on another active shipment', not busy.exists(),
                ', '.join(busy.values_list('reference', flat=True)[:3]))
    else:
        t, truck = sh.transporter, sh.hired_truck
        add('transporter_assigned', 'Transporter selected', t, '' if t else 'No transporter selected')
        add('truck_assigned', 'Hired truck selected', truck, '' if truck else 'No hired truck selected')
        if t:
            info['transporter'] = {'id': t.id, 'name': t.name, 'phone': t.phone}
        if truck:
            capacity = truck.capacity
            info['hired_truck'] = {'id': truck.id, 'registration_number': truck.registration_number, 'capacity': truck.capacity,
                                   'driver_name': truck.driver_name, 'driver_phone': truck.driver_phone,
                                   'driver_licence': truck.driver_licence, 'status': truck.status}
            add('truck_active', 'Hired truck is active', truck.status == 'ACTIVE', f'Status: {truck.status}')
        booked = TransportBooking.objects.filter(shipment=sh, status__in=('APPROVED', 'IN_TRANSIT', 'DELIVERED', 'INVOICED')).exists()
        add('booking', 'Approved transport booking', booked, '' if booked else 'Required before loading')

    if capacity:
        add('capacity', 'Quantity within truck capacity', sh.quantity <= capacity,
            f'{sh.quantity} L allocated, capacity {capacity} L')

    return {'ready': all(c['ok'] for c in checks) and bool(checks), 'checks': checks, **info}