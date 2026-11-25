"""
api/management/commands/seed_data.py

Seeds PetroERP with ~8 months of realistic Kenya -> DRC fuel trading data, ending TODAY.

    python manage.py seed_data                # only if DB has no Company yet
    python manage.py seed_data --flush        # wipes the WHOLE database first (django flush)
    python manage.py seed_data --months 8 --seed 42

Every user's password is:  password123

Notes
-----
* References / codes are generated here (per-company counters) and written back to NumberSequence at the
  end, so `services.next_reference` continues after the seeded numbers.
* Posted journals, stock movements, shipment history and audit logs are created the same way the app
  does (append-only). Every journal is checked to balance before it is written.
* Statutory rates (VAT, PAYE, NSSF, SHIF, Housing Levy) are SAMPLE values stored as configuration rows.
  Have a tax professional verify them before using them for anything real.
"""
import math
import random
from calendar import monthrange
from datetime import date, datetime, time, timedelta
from decimal import Decimal as D

from django.conf import settings
from django.contrib.contenttypes.models import ContentType
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from api import models as M

PASSWORD = 'password123'
D0 = D('0')
q2, q3, q6, q8 = M.q2, M.q3, M.q6, M.q8
IN_TYPES = {'OPENING', 'RECEIPT', 'TRANSFER_IN', 'RETURN_IN', 'ADJ_IN'}


# ------------------------------------------------------------------ static reference data
PERMISSIONS = [
    'dashboard.view', 'master.manage', 'purchase.create', 'purchase.approve', 'inventory.view', 'inventory.adjust',
    'inventory.approve', 'sales.create', 'sales.approve', 'shipment.manage', 'shipment.approve', 'finance.post',
    'finance.approve', 'payment.approve', 'payment.execute', 'report.view', 'payroll.manage', 'audit.view',
    'user.manage', 'fleet.manage', 'customs.manage',
]
ROLES = {
    'GROUP_ADMIN': ('Group Administrator', PERMISSIONS),
    'FINANCE_MANAGER': ('Finance Manager', ['dashboard.view', 'finance.post', 'finance.approve', 'payment.approve',
                                            'payment.execute', 'report.view', 'payroll.manage', 'purchase.approve',
                                            'sales.approve', 'audit.view', 'inventory.view']),
    'OPERATIONS_MANAGER': ('Operations Manager', ['dashboard.view', 'shipment.manage', 'shipment.approve',
                                                  'inventory.view', 'inventory.approve', 'fleet.manage',
                                                  'customs.manage', 'sales.approve', 'report.view']),
    'DEPOT_OFFICER': ('Depot Officer', ['dashboard.view', 'inventory.view', 'inventory.adjust', 'shipment.manage']),
    'PROCUREMENT_OFFICER': ('Procurement Officer', ['dashboard.view', 'purchase.create', 'master.manage',
                                                    'inventory.view']),
    'SALES_OFFICER': ('Sales Officer', ['dashboard.view', 'sales.create', 'master.manage', 'shipment.manage']),
    'ACCOUNTANT': ('Accountant', ['dashboard.view', 'finance.post', 'payment.execute', 'report.view']),
}

# code, name, type, subtype, key (group_code and AccountMapping key)
CHART = [
    ('1000', 'Cash on Hand', 'ASSET', 'CASH', 'CASH'),
    ('1010', 'Equity Bank - KES Current', 'ASSET', 'BANK', 'BANK'),
    ('1020', 'M-Pesa Paybill Collection', 'ASSET', 'MPESA', 'MPESA'),
    ('1030', 'USD Bank Account', 'ASSET', 'BANK', 'BANK_USD'),
    ('1100', 'Accounts Receivable', 'ASSET', 'AR', 'AR'),
    ('1200', 'Fuel Inventory', 'ASSET', 'INVENTORY', 'INVENTORY'),
    ('1210', 'Fuel in Transit', 'ASSET', 'TRANSIT', 'TRANSIT'),
    ('1300', 'Input VAT', 'ASSET', 'VAT_INPUT', 'VAT_INPUT'),
    ('1400', 'Intercompany Receivable', 'ASSET', 'IC_RECEIVABLE', 'IC_RECEIVABLE'),
    ('1500', 'Fixed Assets - Vehicles & Trailers', 'ASSET', 'FIXED_ASSET', 'FIXED_ASSET'),
    ('1510', 'Accumulated Depreciation', 'ASSET', 'ACCUM_DEP', 'ACCUM_DEP'),
    ('2000', 'Accounts Payable', 'LIABILITY', 'AP', 'AP'),
    ('2010', 'Goods Received Not Invoiced', 'LIABILITY', 'GRNI', 'GRNI'),
    ('2100', 'Output VAT', 'LIABILITY', 'VAT_OUTPUT', 'VAT_OUTPUT'),
    ('2110', 'Payroll Liabilities (PAYE/NSSF/SHIF/AHL)', 'LIABILITY', 'PAYROLL', 'PAYROLL_LIABILITY'),
    ('2200', 'Intercompany Payable', 'LIABILITY', 'IC_PAYABLE', 'IC_PAYABLE'),
    ('3000', 'Share Capital', 'EQUITY', '', 'SHARE_CAPITAL'),
    ('3100', 'Retained Earnings', 'EQUITY', '', 'RETAINED'),
    ('4000', 'Fuel Sales Revenue', 'REVENUE', 'REVENUE', 'REVENUE'),
    ('4100', 'Other Income & Group Service Fees', 'REVENUE', 'OTHER_INCOME', 'OTHER_INCOME'),
    ('4900', 'Realised FX Gain', 'REVENUE', 'FX_GAIN', 'FX_GAIN'),
    ('5000', 'Cost of Goods Sold - Fuel', 'EXPENSE', 'COGS', 'COGS'),
    ('5100', 'Fuel Shortage / Transit Loss', 'EXPENSE', 'INVENTORY_LOSS', 'INVENTORY_LOSS'),
    ('5200', 'Transport Costs - Hired', 'EXPENSE', 'COGS', 'EXP_TRANSPORT_HIRED'),
    ('5210', 'Transport Costs - Own Fleet', 'EXPENSE', 'COGS', 'EXP_TRANSPORT_OWNED'),
    ('5220', 'Loading & Depot Charges', 'EXPENSE', 'COGS', 'EXP_LOADING'),
    ('5230', 'Border, Customs & Clearing', 'EXPENSE', 'COGS', 'EXP_BORDER'),
    ('5240', 'Transit Insurance', 'EXPENSE', 'COGS', 'EXP_INSURANCE'),
    ('5250', 'Offloading & Delivery', 'EXPENSE', 'COGS', 'EXP_OFFLOADING'),
    ('6000', 'Salaries & Wages', 'EXPENSE', 'OPEX', 'SALARIES'),
    ('6100', 'Depreciation', 'EXPENSE', 'OPEX', 'DEPRECIATION'),
    ('6200', 'Bank Charges', 'EXPENSE', 'OPEX', 'EXP_BANK'),
    ('6300', 'Office & Administration', 'EXPENSE', 'OPEX', 'EXP_ADMIN'),
    ('6400', 'Vehicle Repairs & Maintenance', 'EXPENSE', 'OPEX', 'EXP_MAINTENANCE'),
    ('6500', 'Realised FX Loss', 'EXPENSE', 'OPEX', 'FX_LOSS'),
]

# code, name, group, cost_component, in_cogs, GL key
CATEGORIES = [
    ('LOADING', 'Loading & Throughput Charges', 'PROCUREMENT', 'LOADING', True, 'EXP_LOADING'),
    ('DEPOT', 'Depot Storage & Handling', 'PROCUREMENT', 'DEPOT', True, 'EXP_LOADING'),
    ('TRANS-HIRE', 'Hired Transport (Third-party)', 'TRANSPORT', 'TRANSPORT_HIRED', True, 'EXP_TRANSPORT_HIRED'),
    ('TRANS-OWN', 'Own Fleet Running Cost', 'TRANSPORT', 'TRANSPORT_OWNED', True, 'EXP_TRANSPORT_OWNED'),
    ('DRV-ALLOW', 'Driver Trip Allowance', 'TRANSPORT', 'DRIVER', True, 'EXP_TRANSPORT_OWNED'),
    ('TRIP-FUEL', 'Trip Fuel (Diesel)', 'TRANSPORT', 'FUEL', True, 'EXP_TRANSPORT_OWNED'),
    ('BORDER-FEES', 'Border & Transit Fees', 'BORDER', 'BORDER', True, 'EXP_BORDER'),
    ('CLEARING', 'Clearing & Forwarding Agent', 'BORDER', 'CLEARING', True, 'EXP_BORDER'),
    ('INS-TRANSIT', 'Cargo Transit Insurance', 'BORDER', 'INSURANCE', True, 'EXP_INSURANCE'),
    ('OFFLOAD', 'Offloading & Delivery', 'DELIVERY', 'OFFLOADING', True, 'EXP_OFFLOADING'),
    ('ADMIN', 'Office & Administration', 'ADMIN', 'OTHER', False, 'EXP_ADMIN'),
    ('BANK-CHG', 'Bank Charges', 'FINANCE', 'BANK', False, 'EXP_BANK'),
    ('VEH-MAINT', 'Vehicle Repairs & Maintenance', 'TRANSPORT', 'TRANSPORT_OWNED', False, 'EXP_MAINTENANCE'),
]
CAT_ACCT = {c[0]: c[5] for c in CATEGORIES}

PRODUCTS = [
    # code, name, category, dens_min, dens_max, spec, expansion, base buy price KES/L
    ('AGO', 'Automotive Gas Oil (Diesel)', 'DIESEL', '0.8200', '0.8600', 'KS 1851 / EN 590 (500ppm)', '0.0008300', 128),
    ('PMS', 'Premium Motor Spirit (Petrol)', 'PETROL', '0.7200', '0.7800', 'KS 1850 RON 91', '0.0012000', 134),
    ('DPK', 'Illuminating Kerosene (DPK)', 'KEROSENE', '0.7750', '0.8400', 'KS 1853', '0.0009500', 118),
    ('JET', 'Jet A-1 Aviation Fuel', 'JET_FUEL', '0.7750', '0.8400', 'DEF STAN 91-091', '0.0009900', 150),
]
BASE_PRICE = {p[0]: p[7] for p in PRODUCTS}
PHASE = {'AGO': 0.0, 'PMS': 1.0, 'DPK': 2.0, 'JET': 3.0}

DEPOTS = [
    ('MSA', 'Mombasa Kipevu Depot', 'Kipevu Oil Terminal, Mombasa', 30),
    ('NBO', 'Nairobi Embakasi Depot', 'Embakasi, Nairobi', 23),
    ('ELD', 'Eldoret Depot', 'Industrial Area, Eldoret', 20),
]
TANKS = [  # depot, product, capacity, min_level
    ('MSA', 'AGO', 500000, 60000), ('MSA', 'PMS', 300000, 40000), ('MSA', 'DPK', 100000, 15000),
    ('MSA', 'JET', 150000, 20000), ('NBO', 'AGO', 200000, 30000), ('NBO', 'PMS', 150000, 25000),
    ('ELD', 'AGO', 150000, 25000), ('ELD', 'PMS', 80000, 15000),
]

DEST = {  # transit days, hired haul KES/L, border, route midpoint, address
    'GOMA': dict(km=1850, days=8, haul=17.0, border='BUNAGANA', mid='Nakuru, Kenya',
                 addr='Goma, North Kivu, DRC'),
    'BUKAVU': dict(km=2050, days=9, haul=18.5, border='BUNAGANA', mid='Nakuru, Kenya',
                   addr='Bukavu, South Kivu, DRC'),
    'LUBUMBASHI': dict(km=3350, days=14, haul=25.0, border='KASUMBALESA', mid='Mbeya, Tanzania',
                       addr='Lubumbashi, Haut-Katanga, DRC'),
    'KOLWEZI': dict(km=3500, days=15, haul=26.5, border='KASUMBALESA', mid='Mbeya, Tanzania',
                    addr='Kolwezi, Lualaba, DRC'),
}
BORDERS = [
    ('MALABA', 'Malaba One Stop Border Post', 'Kenya', 'Uganda'),
    ('BUNAGANA', 'Bunagana Border Post', 'Uganda', 'DRC'),
    ('KASUMBALESA', 'Kasumbalesa Border Post', 'Zambia', 'DRC'),
    ('TUNDUMA', 'Tunduma / Nakonde Border Post', 'Tanzania', 'Zambia'),
]
CUSTOMERS = [  # name, city key, credit limit KES, credit days, contact, phone
    ('Katanga Mining Logistics SARL', 'LUBUMBASHI', 40000000, 30, 'Patrick Kasongo', '+243 99 481 2203'),
    ('Kolwezi Energie SARL', 'KOLWEZI', 30000000, 30, 'Marie Ilunga', '+243 97 330 8841'),
    ('Goma Fuel Distributors SARL', 'GOMA', 25000000, 21, 'Eric Bahati', '+243 99 770 1156'),
    ('Kivu Petroleum Distribution SARL', 'BUKAVU', 20000000, 21, 'Claudine Mushagalusa', '+243 81 905 6672'),
    ('Haut-Katanga Transport Group', 'LUBUMBASHI', 35000000, 30, 'Joel Mutombo', '+243 82 214 7790'),
]
SUPPLIERS = [  # name, city, pin, terms, credit limit, contact, phone
    ('Coastal Bulk Petroleum Ltd', 'Mombasa', 'P051427760C', 14, 400000000, 'Hamisi Mwinyi', '+254 722 410 118'),
    ('Lake Basin Fuels Ltd', 'Kisumu', 'P051660931M', 30, 250000000, 'Grace Atieno', '+254 733 902 441'),
    ('Savannah Energy Traders Ltd', 'Nairobi', 'P051903347T', 21, 300000000, 'Brian Kariuki', '+254 720 553 092'),
    ('Kipevu Jet Services Ltd', 'Mombasa', 'P051288415J', 14, 150000000, 'Salim Bakari', '+254 711 284 706'),
    ('Bahari Clearing & Forwarding Ltd', 'Mombasa', 'P051572209R', 30, 20000000, 'Fatuma Juma', '+254 722 118 604'),
    ('Pwani Marine Insurance Brokers Ltd', 'Mombasa', 'P051194872Q', 30, 10000000, 'Ali Shee', '+254 733 640 275'),
]
VEHICLES = [('KDG 412M', 'Scania', 'R 460'), ('KDH 118T', 'Volvo', 'FH 440'), ('KDK 905P', 'Scania', 'R 500'),
            ('KDL 267A', 'Mercedes-Benz', 'Actros 2645'), ('KDM 340C', 'Volvo', 'FH 460'),
            ('KDN 771B', 'MAN', 'TGS 26.440')]
TRAILERS = ['ZG 2145', 'ZG 2146', 'ZH 3302', 'ZH 3303', 'ZJ 1190', 'ZJ 1191']
DRIVERS = [('Joseph Kiprono', 'DL-4471829', 'CE'), ('Hassan Abdi', 'DL-3920174', 'CE'),
           ('Samuel Mutua', 'DL-5108836', 'CE'), ('Daniel Ochieng', 'DL-4283019', 'CE'),
           ('Ibrahim Salim', 'DL-3774502', 'CE'), ('Moses Njoroge', 'DL-4890267', 'CE')]
TRANSPORTERS = [('Mara Haulers Ltd', 'P051739204B', 'David Maina', '1.00'),
                ('Trans-Africa Tankers Ltd', 'P051481956N', 'Nancy Wambui', '1.03'),
                ('Jambo Freight Services Ltd', 'P051820643H', 'Said Omar', '0.98')]
EMPLOYEES = [  # name, title, dept, basic, allowances, is_driver
    ('Amos Kiptoo', 'General Manager', 'Operations', 380000, 60000, False),
    ('Wanjiru Kamau', 'Finance Manager', 'Finance', 260000, 35000, False),
    ('Omar Hassan', 'Operations Manager', 'Operations', 240000, 30000, False),
    ('Peter Otieno', 'Depot Supervisor', 'Operations', 150000, 20000, False),
    ('Faith Chebet', 'Procurement Officer', 'Procurement', 120000, 15000, False),
    ('Kevin Mwangi', 'Sales Officer', 'Sales', 110000, 15000, False),
    ('Amina Yusuf', 'Accountant', 'Finance', 130000, 15000, False),
    ('Lucy Njeri', 'Logistics Coordinator', 'Fleet & Logistics', 105000, 12000, False),
    ('Tabitha Akinyi', 'Customs & Compliance Officer', 'Fleet & Logistics', 115000, 12000, False),
    ('Mohamed Ali', 'Depot Clerk', 'Operations', 62000, 8000, False),
] + [(d[0], 'Truck Driver', 'Fleet & Logistics', 55000, 20000, True) for d in DRIVERS]
CONGO_RECEIVERS = ['Patrick Kasongo', 'Jean Mulumba', 'Eric Bahati', 'Dieudonne Kalala', 'Joel Mutombo',
                   'Esther Kabeya']

STEPS = ['DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'AWAITING_LOADING', 'LOADING', 'LOADED', 'DISPATCHED',
         'IN_TRANSIT', 'AT_BORDER', 'UNDER_CUSTOMS', 'CLEARED', 'ARRIVED', 'DELIVERED', 'RECONCILIATION_PENDING',
         'CLOSED']


def add_months(d, n):
    y, mo = divmod(d.year * 12 + d.month - 1 + n, 12)
    mo += 1
    return date(y, mo, min(d.day, monthrange(y, mo)[1]))


def month_end(d):
    return date(d.year, d.month, monthrange(d.year, d.month)[1])


def dt(d, hh=9, mm=0):
    v = datetime.combine(d, time(hh, mm))
    return timezone.make_aware(v) if settings.USE_TZ else v


def upd(obj, **kw):
    """Plain queryset update (skips model.save side effects) + keep the instance in sync."""
    type(obj)._base_manager.filter(pk=obj.pk).update(**kw)
    for k, v in kw.items():
        setattr(obj, k, v)


class Command(BaseCommand):
    help = 'Seed ~8 months of realistic PetroERP data ending today (all passwords: password123).'

    def add_arguments(self, parser):
        parser.add_argument('--flush', action='store_true', help='Wipe the whole database first.')
        parser.add_argument('--months', type=int, default=8)
        parser.add_argument('--seed', type=int, default=42)

    # ================================================================== entry
    def handle(self, *args, **o):
        if o['flush']:
            call_command('flush', interactive=False, verbosity=0)
        elif M.Company.objects.exists():
            raise CommandError('Data already exists. Re-run with --flush to wipe the database first.')
        self.opts = o
        with transaction.atomic():
            self.run()
        self.report()

    def run(self):
        self.today = date.today()
        self.start = add_months(self.today, -self.opts['months'])
        self.rnd = random.Random(self.opts['seed'])
        self.counters, self.acct, self.periods, self.banks = {}, {}, {}, {}
        self.bal, self.layers, self.mlog, self.last_move = {}, {}, {}, {}
        self.tanks, self.tank_list, self.latest_po, self.busy, self.odo = {}, [], {}, {}, {}
        self.rcp = 0
        self.stats = {'shipments': 0, 'pos': 0}

        self.s_currency_fx()
        self.s_companies()
        self.s_users()
        self.s_finance_setup()
        self.s_org_and_parties()
        self.s_inventory_masters()
        self.s_fleet_transport()
        self.s_hr_misc_masters()
        self.s_opening_balances()
        self.s_transactions()
        self.s_monthly_cycles()
        self.s_intercompany()
        self.s_closing_touches()
        self.s_sequences()

    # ================================================================== helpers
    def nxt(self, co, typ):
        k = (co.id, typ)
        self.counters[k] = self.counters.get(k, 0) + 1
        return self.counters[k]

    def ref(self, co, typ):
        return f'{typ}-{self.nxt(co, typ):05d}'

    def rate_usd(self, d):
        """USD->KES, weekly steps, gently moving around 129."""
        anchor = self.start + timedelta(days=((d - self.start).days // 7) * 7)
        return D(str(round(129.0 + 0.45 * math.sin(anchor.toordinal() / 17.0), 4)))

    def fx(self, cur, d):
        if cur.code == 'KES':
            return dict(currency=cur, exchange_rate=D('1'), rate_date=d, rate_source='FUNCTIONAL')
        return dict(currency=cur, exchange_rate=self.rate_usd(d), rate_date=d, rate_source='CBK')

    def buy_price(self, code, d):
        f = 1 + 0.035 * math.sin(d.toordinal() / 40.0 + PHASE[code])
        return q6(D(str(round(BASE_PRICE[code] * f, 4))))

    def sell_price(self, code, d, dest, margin):
        cost_kes = float(self.buy_price(code, d)) + DEST[dest]['haul'] + 7.0
        return q6(D(str(round(cost_kes / float(self.rate_usd(d)) * (1 + float(margin)), 4))))

    def bank_for(self, co, method, cur):
        key = {'BANK': 'BANK_USD' if cur.code == 'USD' else 'BANK', 'MPESA': 'MPESA', 'CASH': 'CASH'}[method]
        return self.banks[(co.id, key)], key

    def post(self, co, d, desc, lines, src=('', ''), user=None):
        """lines: (account_key, debit, credit[, extra]) -> immutable balanced journal."""
        lines = [l for l in lines if q2(l[1]) != 0 or q2(l[2]) != 0]
        dr = sum((q2(l[1]) for l in lines), D0)
        cr = sum((q2(l[2]) for l in lines), D0)
        if dr != cr:
            raise CommandError(f'Unbalanced journal "{desc}": Dr {dr} / Cr {cr}')
        j = M.Journal.objects.create(
            company=co, reference=self.ref(co, 'JV'), date=d, period=self.periods[co.id][(d.year, d.month)],
            description=desc[:255], status='POSTED', source_type=src[0], source_id=str(src[1]),
            total_debit=dr, total_credit=cr, posted_by=user or self.u['finance'], posted_at=dt(d, 17))
        M.JournalLine.objects.bulk_create([
            M.JournalLine(journal=j, account=self.acct[co.id][l[0]], debit=q2(l[1]), credit=q2(l[2]),
                          **(l[3] if len(l) > 3 else {})) for l in lines])
        return j

    def audit(self, user, co, action, obj, changes=None, d=None):
        M.AuditLog.objects.create(
            user=user, company=co, action=action, model_name=obj.__class__.__name__, object_id=str(obj.pk),
            object_repr=str(obj)[:200], changes=changes or {},
            ip_address=f'41.80.{self.rnd.randint(1, 250)}.{self.rnd.randint(1, 250)}',
            created_at=dt(d or self.today, self.rnd.randint(8, 17), self.rnd.randint(0, 59)))

    def approval(self, co, obj, doc_type, amount, summary, requester, approver, status, d):
        req = M.ApprovalRequest.objects.create(
            company=co, doc_type=doc_type, content_type=ContentType.objects.get_for_model(obj), object_id=obj.pk,
            summary=summary[:200], amount=q2(amount), status=status, created_by=requester,
            decided_by=None if status == 'PENDING' else approver,
            decided_at=None if status == 'PENDING' else dt(d, 11))
        M.ApprovalAction.objects.create(request=req, actor=requester, action='SUBMITTED',
                                        comment='Submitted for approval')
        if status != 'PENDING':
            M.ApprovalAction.objects.create(request=req, actor=approver, action=status,
                                            comment='Reviewed and approved.' if status == 'APPROVED' else 'Rejected.')

    # ================================================================== stock engine
    def move(self, d, mtype, tank, qty, unit_cost=None, *, ref='', shipment=None, src=('', ''), narration='',
             user=None, **extra):
        b = self.bal[tank.id]
        qty = q3(qty)
        if mtype in IN_TYPES:
            cost = q6(unit_cost)
            total = q2(qty * cost)
            b[0] += qty
            b[1] += total
            self.layers[tank.id].append([d, qty, cost])
        else:
            cost = q6(b[1] / b[0]) if b[0] else q6(unit_cost or 0)
            total = q2(qty * cost)
            if qty > b[0]:
                raise CommandError(f'Negative stock on tank {tank.code}: {qty} > {b[0]} ({mtype} {d})')
            b[0] -= qty
            b[1] = D0 if b[0] == 0 else b[1] - total
            rem = qty
            for layer in self.layers[tank.id]:
                if rem <= 0:
                    break
                t = min(layer[1], rem)
                layer[1] -= t
                rem -= t
        M.StockMovement.objects.create(
            company=self.ke, reference=ref or self.ref(self.ke, 'MOV'), movement_type=mtype, movement_date=d,
            tank=tank, product=tank.product, quantity=qty, unit_cost=cost, total_cost=total, balance_after=b[0],
            shipment=shipment, source_type=src[0], source_id=str(src[1]), narration=narration[:255],
            created_by=user or self.u['depot'], **extra)
        self.mlog[tank.id].append((d, mtype, qty, b[0], b[1]))
        self.last_move[tank.id] = max(self.last_move[tank.id], d)
        return cost, total

    # ================================================================== 1. currencies & FX
    def s_currency_fx(self):
        self.KES = M.Currency.objects.create(code='KES', name='Kenya Shilling', symbol='KSh')
        self.USD = M.Currency.objects.create(code='USD', name='US Dollar', symbol='$')
        self.CDF = M.Currency.objects.create(code='CDF', name='Congolese Franc', symbol='FC')
        rows, d = [], self.start - timedelta(days=28)
        while d <= self.today + timedelta(days=7):
            r = self.rate_usd(d)
            rows.append(M.ExchangeRate(from_currency=self.USD, to_currency=self.KES, rate=r, rate_date=d,
                                       source='CBK'))
            rows.append(M.ExchangeRate(from_currency=self.KES, to_currency=self.USD, rate=q8(1 / r), rate_date=d,
                                       source='CBK'))
            if d.day <= 7:
                rows.append(M.ExchangeRate(from_currency=self.USD, to_currency=self.CDF,
                                           rate=D(str(2780 + 6 * (d.month % 5))), rate_date=d, source='BCC'))
            d += timedelta(days=7)
        M.ExchangeRate.objects.bulk_create(rows)

    # ================================================================== 2. companies
    def s_companies(self):
        self.ke = M.Company.objects.create(
            code='DPK', name='Dalmar Petroleum Kenya Ltd', country='KE', functional_currency=self.KES,
            tax_pin='P051284936K', registration_number='CPR/2019/284715',
            address='Kipevu Oil Terminal Road, Mombasa, Kenya', phone='+254 41 222 4410',
            email='accounts@dalmarpetroleum.co.ke', inventory_valuation='WAVG', min_margin_pct=D('3'),
            match_tolerance_pct=D('1'), delivery_loss_tolerance_pct=D('0.5'))
        self.cd = M.Company.objects.create(
            code='DPC', name='Dalmar Congo SARL', country='CD', functional_currency=self.USD,
            tax_pin='A2108471X', registration_number='CD/LSH/RCCM/21-B-01542',
            address='Avenue Kasavubu 118, Lubumbashi, DRC', phone='+243 99 410 2288',
            email='finance@dalmarcongo.cd', inventory_valuation='FIFO', min_margin_pct=D('3'),
            match_tolerance_pct=D('1'), delivery_loss_tolerance_pct=D('0.5'))

    # ================================================================== 3. roles & users
    def s_users(self):
        perms = {c: M.Permission.objects.create(code=c, description=c.replace('.', ' ').title())
                 for c in PERMISSIONS}
        roles = {}
        for code, (name, plist) in ROLES.items():
            r = M.Role.objects.create(code=code, name=name)
            r.permissions.set([perms[p] for p in plist])
            roles[code] = r
        spec = [  # username, first, last, role, companies, phone
            ('admin', 'System', 'Administrator', 'GROUP_ADMIN', [self.ke, self.cd], '+254700000001'),
            ('finance', 'Wanjiru', 'Kamau', 'FINANCE_MANAGER', [self.ke, self.cd], '+254722100200'),
            ('ops', 'Omar', 'Hassan', 'OPERATIONS_MANAGER', [self.ke], '+254733411522'),
            ('depot', 'Peter', 'Otieno', 'DEPOT_OFFICER', [self.ke], '+254711622833'),
            ('procurement', 'Faith', 'Chebet', 'PROCUREMENT_OFFICER', [self.ke], '+254720733944'),
            ('sales', 'Kevin', 'Mwangi', 'SALES_OFFICER', [self.ke], '+254722844055'),
            ('accountant', 'Amina', 'Yusuf', 'ACCOUNTANT', [self.ke], '+254733955166'),
            ('drc_finance', 'Jean-Claude', 'Mbuyi', 'FINANCE_MANAGER', [self.cd], '+243994102288'),
        ]
        self.u = {}
        for uname, fn, ln, role, cos, phone in spec:
            u, _ = M.User.objects.get_or_create(username=uname)
            u.first_name, u.last_name, u.email = fn, ln, f'{uname}@dalmar.example'
            u.role, u.phone = roles[role], phone
            u.is_active = True
            u.is_staff = u.is_superuser = (uname == 'admin')
            u.set_password(PASSWORD)
            u.save()
            u.companies.set(cos)
            self.u[uname] = u

    # ================================================================== 4. fiscal, tax, CoA, banks
    def s_finance_setup(self):
        admin = self.u['admin']
        for co in (self.ke, self.cd):
            self.periods[co.id], self.acct[co.id] = {}, {}
            for y in range(self.start.year, self.today.year + 1):
                fy = M.FiscalYear.objects.create(company=co, name=f'FY{y}', start_date=date(y, 1, 1),
                                                 end_date=date(y, 12, 31), status='OPEN')
                for mo in range(1, 13):
                    s, e = date(y, mo, 1), month_end(date(y, mo, 1))
                    closed = e < add_months(self.today.replace(day=1), -1)
                    self.periods[co.id][(y, mo)] = M.AccountingPeriod.objects.create(
                        company=co, fiscal_year=fy, name=f'{y}-{mo:02d}', start_date=s, end_date=e,
                        status='CLOSED' if closed else 'OPEN', closed_by=admin if closed else None,
                        closed_at=dt(e + timedelta(days=5), 10) if closed else None)
            for code, name, atype, sub, key in CHART:
                self.acct[co.id][key] = M.Account.objects.create(
                    company=co, code=code, name=name, account_type=atype, subtype=sub, group_code=key,
                    is_postable=True, is_intercompany=key in ('IC_RECEIVABLE', 'IC_PAYABLE'))
                M.AccountMapping.objects.create(company=co, key=key, account=self.acct[co.id][key])
            for k, tgt in (('EXP_OTHER', 'EXP_ADMIN'),):
                M.AccountMapping.objects.create(company=co, key=k, account=self.acct[co.id][tgt])
            # SAMPLE statutory configuration - must be verified by a tax professional
            if co == self.ke:
                taxes = [('VAT16', 'VAT Standard Rate', 'VAT', '16', 'Standard rated supplies'),
                         ('ZERO', 'VAT Zero-rated (exports)', 'VAT', '0', 'Export of fuel to DRC'),
                         ('EXEMPT', 'VAT Exempt', 'VAT', '0', 'Exempt supplies')]
            else:
                taxes = [('TVA16', 'TVA Standard Rate', 'VAT', '16', 'Standard rated supplies'),
                         ('ZERO', 'TVA Zero-rated', 'VAT', '0', 'Zero-rated')]
            for code, name, typ, rate, note in taxes:
                M.TaxConfig.objects.create(company=co, code=code, name=name, tax_type=typ, rate_percent=D(rate),
                                           effective_from=date(2020, 1, 1), is_active=True, verified_by=admin,
                                           verified_at=dt(date(2026, 1, 15), 10), notes=note + ' (sample - verify)')
        for dtyp, amt, role in [('PurchaseOrder', 1000000, 'FINANCE_MANAGER'),
                                ('PurchaseOrder', 20000000, 'GROUP_ADMIN'), ('SalesOrder', 5000000, 'FINANCE_MANAGER'),
                                ('Expense', 500000, 'FINANCE_MANAGER'), ('Payment', 1000000, 'FINANCE_MANAGER'),
                                ('StockAdjustment', 0, 'OPERATIONS_MANAGER'),
                                ('ShipmentDelivery', 0, 'OPERATIONS_MANAGER')]:
            M.ApprovalPolicy.objects.create(company=self.ke, doc_type=dtyp, min_amount=D(amt),
                                            approver_role=M.Role.objects.get(code=role))
        banks = [  # name, type, bank, number, currency, key, shortcode
            ('Equity Bank KES Current', 'BANK', 'Equity Bank Kenya', '0120192837465', self.KES, 'BANK', ''),
            ('Stanbic Bank USD Current', 'BANK', 'Stanbic Bank Kenya', '9100004827163', self.USD, 'BANK_USD', ''),
            ('M-Pesa Paybill 4012956', 'MPESA', 'Safaricom M-Pesa', '4012956', self.KES, 'MPESA', '4012956'),
            ('Petty Cash - Mombasa', 'PETTY', '', '', self.KES, 'CASH', ''),
        ]
        for name, typ, bank, num, cur, key, sc in banks:
            self.banks[(self.ke.id, key)] = M.BankAccount.objects.create(
                company=self.ke, name=name, account_type=typ, bank_name=bank, account_number=num, currency=cur,
                gl_account=self.acct[self.ke.id][key], mpesa_shortcode=sc)
        self.banks[(self.cd.id, 'BANK_USD')] = M.BankAccount.objects.create(
            company=self.cd, name='Rawbank USD Current', account_type='BANK', bank_name='Rawbank',
            account_number='05100-00231-90021', currency=self.USD, gl_account=self.acct[self.cd.id]['BANK_USD'])

    # ================================================================== 5. org, suppliers, customers
    def s_org_and_parties(self):
        ke = self.ke
        self.branch = {}
        for nm, addr in [('Mombasa HQ', 'Kipevu Oil Terminal Road, Mombasa'), ('Nairobi', 'Embakasi, Nairobi'),
                         ('Eldoret', 'Industrial Area, Eldoret')]:
            self.branch[nm] = M.Branch.objects.create(company=ke, code=self.ref(ke, 'BR'), name=nm, address=addr)
        self.dept = {}
        for nm in ['Operations', 'Finance', 'Procurement', 'Sales', 'Fleet & Logistics', 'HR & Admin']:
            self.dept[nm] = M.Department.objects.create(company=ke, code=self.ref(ke, 'DEP'), name=nm,
                                                        branch=self.branch['Mombasa HQ'])
        self.suppliers = []
        for i, (nm, city, pin, terms, limit, contact, phone) in enumerate(SUPPLIERS):
            s = M.Supplier.objects.create(
                company=ke, code=self.ref(ke, 'SUP'), name=nm, country='Kenya', tax_pin=pin,
                registration_number=f'CPR/20{12 + i}/{100000 + i * 7311}', address=f'{city}, Kenya',
                contact_person=contact, phone=phone, email=f'accounts@{nm.split()[0].lower()}.co.ke',
                bank_name=['KCB Bank Kenya', 'Co-operative Bank', 'NCBA Bank', 'Stanbic Bank Kenya',
                           'Equity Bank Kenya', 'Absa Bank Kenya'][i], bank_account=f'11{i}0293847{i}',
                bank_swift=['KCBLKENX', 'KCOOKENA', 'CBAFKENX', 'SBICKENX', 'EQBLKENA', 'BARCKENX'][i],
                payment_terms_days=terms, credit_limit=D(limit), currency=self.KES, status='ACTIVE')
            M.SupplierContact.objects.create(supplier=s, name=contact, position='Accounts Manager',
                                             phone=phone, email=s.email)
            self.suppliers.append(s)
        self.fuel_sups, self.agent, self.insurer = self.suppliers[:4], self.suppliers[4], self.suppliers[5]
        self.customers, self.cust_dest, self.contracts = [], {}, {}
        for nm, city, limit, days, contact, phone in CUSTOMERS:
            c = M.Customer.objects.create(
                company=ke, code=self.ref(ke, 'CUS'), name=nm, country='DRC', address=DEST[city]['addr'],
                tax_registration=f'RCCM/CD/{city[:3]}/{self.rnd.randint(10, 24)}-B-0{self.rnd.randint(1000, 9999)}',
                contact_person=contact, phone=phone, email=f'{contact.split()[0].lower()}@{nm.split()[0].lower()}.cd',
                currency=self.USD, credit_limit=D(limit), payment_terms=f'Net {days}', credit_period_days=days,
                status='ACTIVE')
            M.CustomerContact.objects.create(customer=c, name=contact, position='Procurement Manager',
                                             phone=phone, email=c.email)
            M.CustomerCreditLimit.objects.create(customer=c, limit=D(limit),
                                                 effective_date=self.start - timedelta(days=45),
                                                 approved_by=self.u['finance'], reason='Annual credit review')
            self.customers.append(c)
            self.cust_dest[c.id] = city

    # ================================================================== 6. products, depots, tanks
    def s_inventory_masters(self):
        ke = self.ke
        self.products, self.depots = {}, {}
        for code, name, cat, dmin, dmax, spec, exp, _ in PRODUCTS:
            self.products[code] = M.Product.objects.create(
                code=code, name=name, category=cat, unit='L', density_min=D(dmin), density_max=D(dmax),
                specification=spec, tax_category='VAT16', valuation_method='DEFAULT', reference_temp_c=D('15'),
                expansion_coefficient=D(exp), min_margin_pct=D('3'), status='ACTIVE')
        self.temp = {}
        for key, name, loc, temp in DEPOTS:
            self.depots[key] = M.Depot.objects.create(company=ke, code=self.ref(ke, 'DPT'), name=name,
                                                      location=loc, country='Kenya')
            self.temp[key] = temp
        for dk, pc, cap, minl in TANKS:
            t = M.StorageTank.objects.create(company=ke, code=self.ref(ke, 'TNK'), depot=self.depots[dk],
                                             product=self.products[pc], capacity=D(cap), min_level=D(minl))
            self.tanks[(dk, pc)] = t
            self.tank_list.append(((dk, pc), t))
            self.bal[t.id], self.layers[t.id], self.mlog[t.id] = [D0, D0], [], []
            self.last_move[t.id] = self.start
            M.TankCalibration.objects.create(
                tank=t, calibration_date=self.start - timedelta(days=120),
                certificate_no=f'KEBS/CAL/{self.start.year}/{t.id:04d}', calibrated_by='Kenya Bureau of Standards',
                next_due=self.start + timedelta(days=245),
                strapping_table=[{'dip_cm': h, 'litres': int(cap * h / 600)} for h in range(0, 601, 50)])
        # market reference prices (monthly, USD/L)
        d = date(self.start.year, self.start.month, 1)
        while d <= self.today:
            for code in self.products:
                M.MarketPrice.objects.create(
                    company=ke, product=self.products[code], market_reference='Platts CFR Mombasa (adj.)',
                    reference_date=d, base_price=q6(float(self.buy_price(code, d)) / float(self.rate_usd(d))),
                    currency=self.USD, source='Platts / internal desk')
            d = add_months(d, 1)
        # supplier contracts
        for s, code in [(self.suppliers[0], 'AGO'), (self.suppliers[1], 'PMS'), (self.suppliers[3], 'JET')]:
            M.SupplierContract.objects.create(
                company=ke, reference=self.ref(ke, 'SCT'), supplier=s, product=self.products[code],
                start_date=self.start - timedelta(days=60), end_date=self.start + timedelta(days=305),
                price_basis='Monthly average posted price + agreed premium', max_quantity=D(6000000),
                terms='Payment per supplier terms; quality per KEBS spec.', status='ACTIVE')
        # customer contracts
        mk = lambda c, code, pm, price: M.CustomerContract.objects.create(  # noqa: E731
            company=ke, reference=self.ref(ke, 'CCT'), customer=c, product=self.products[code], pricing_method=pm,
            price_per_litre=price, currency=self.USD, contract_quantity=D(2000000),
            valid_from=self.start - timedelta(days=30), valid_to=self.start + timedelta(days=335),
            delivery_terms='DAP', status='ACTIVE')
        self.contracts[(self.customers[0].id, 'AGO')] = mk(self.customers[0], 'AGO', 'FIXED', D('1.34'))
        self.contracts[(self.customers[2].id, 'AGO')] = mk(self.customers[2], 'AGO', 'COST_PLUS', D0)

    # ================================================================== 7. fleet & transporters
    def s_fleet_transport(self):
        ke = self.ke
        self.vehicles, self.drivers, self.veh_driver = [], [], {}
        for i, (reg, make, model) in enumerate(VEHICLES):
            tr = M.Trailer.objects.create(company=ke, code=self.ref(ke, 'TRL'), registration_number=TRAILERS[i],
                                          capacity=D(36000), compartments=[12000, 12000, 12000])
            v = M.Vehicle.objects.create(
                company=ke, code=self.ref(ke, 'VEH'), registration_number=reg, make=make, model=model,
                truck_type='Prime mover + tanker trailer', trailer=tr, tank_capacity=D(36000),
                compartments=[12000, 12000, 12000], ownership='OWNED', purchase_value=D(9500000 + i * 150000),
                purchase_date=self.start - timedelta(days=400 + i * 20),
                insurance_expiry=self.today + timedelta(days=[26, 90, 150, 200, 260, 320][i]),
                inspection_expiry=self.today + timedelta(days=[60, 110, 45, 220, 170, 300][i]),
                fuel_norm_km_per_litre=D('2.10'), odometer_km=D(210000 + i * 15000), status='AVAILABLE')
            nm, lic, cat = DRIVERS[i]
            dr = M.Driver.objects.create(company=ke, code=self.ref(ke, 'DRV'), full_name=nm,
                                         id_number=str(20100000 + i * 913477), licence_number=lic,
                                         licence_category=cat,
                                         licence_expiry=self.today + timedelta(days=[40, 400, 520, 610, 300, 700][i]),
                                         phone=f'+2547{10 + i}55{i}{i}210')
            self.vehicles.append(v)
            self.drivers.append(dr)
            self.veh_driver[v.id] = dr
            self.busy[v.id] = self.start - timedelta(days=1)
            self.odo[v.id] = v.odometer_km
            M.VehicleDocument.objects.create(company=ke, vehicle=v, doc_type='INSURANCE',
                                             number=f'POL/{self.today.year}/{4100 + i}',
                                             expiry_date=v.insurance_expiry)
            M.VehicleDocument.objects.create(company=ke, vehicle=v, doc_type='INSPECTION',
                                             number=f'NTSA/INS/{7700 + i}', expiry_date=v.inspection_expiry)
        self.transporters, self.trn_trucks, self.trn_factor = [], {}, {}
        for i, (nm, pin, contact, factor) in enumerate(TRANSPORTERS):
            t = M.Transporter.objects.create(
                company=ke, code=self.ref(ke, 'TRN'), name=nm, registration_number=f'CPR/201{i + 5}/3{i}8841',
                contact_person=contact, phone=f'+25472{i}8830{i}1', email=f'ops@{nm.split()[0].lower()}.co.ke',
                tax_pin=pin, bank_name='Equity Bank Kenya', bank_account=f'0170{i}8827364', payment_terms_days=30,
                credit_limit=D(25000000), currency=self.KES, status='ACTIVE')
            M.TransporterContract.objects.create(
                company=ke, reference=self.ref(ke, 'TCT'), transporter=t, start_date=self.start - timedelta(days=50),
                end_date=self.start + timedelta(days=315), terms='Per-litre rates per route; 50% advance on dispatch.',
                status='ACTIVE')
            self.trn_factor[t.id] = D(factor)
            for dk, info in DEST.items():
                M.TransporterRate.objects.create(
                    company=ke, transporter=t, origin='Mombasa', destination=info['addr'].split(',')[0],
                    rate_per_litre=q6(D(str(info['haul'])) * D(factor)), currency=self.KES,
                    effective_from=self.start - timedelta(days=50))
            trucks = []
            for k in range(3):
                tk = M.TransporterVehicle.objects.create(
                    company=ke, transporter=t, kind='TRUCK', registration_number=f'K{"BCD"[i]}{"ABC"[k]} {i}{k}4{k}Z',
                    capacity=D(36000), compartments=[12000, 12000, 12000],
                    driver_name=['John Ruto', 'Abdi Noor', 'Simon Kioko', 'Ali Mohamed', 'Paul Wekesa', 'Isaac Onyango',
                                 'Juma Hamisi', 'George Opiyo', 'Edwin Kiplagat'][i * 3 + k],
                    driver_licence=f'DL-{5200000 + i * 311 + k * 17}', driver_phone=f'+2547{3 + k}0{i}41{k}88')
                tl = M.TransporterVehicle.objects.create(
                    company=ke, transporter=t, kind='TRAILER', registration_number=f'Z{"KLM"[i]} {i}{k}7{k}',
                    capacity=D(36000), compartments=[12000, 12000, 12000])
                trucks.append((tk, tl))
            self.transporters.append(t)
            self.trn_trucks[t.id] = trucks

    # ================================================================== 8. HR, compliance, categories
    def s_hr_misc_masters(self):
        ke = self.ke
        self.cats = {c[0]: M.ExpenseCategory.objects.create(code=c[0], name=c[1], group=c[2], cost_component=c[3],
                                                            in_cogs=c[4]) for c in CATEGORIES}
        self.borders = {c: M.BorderCrossing.objects.create(code=c, name=n, country_from=a, country_to=b)
                        for c, n, a, b in BORDERS}
        self.reqs = [M.ComplianceRequirement.objects.create(
            company=ke, code=c, name=n, applies_to=a, product_category='', mandatory=True,
            effective_from=date(2024, 1, 1), notes='Sample checklist item - configure per regulator guidance.')
            for c, n, a in [('EXP-DECL', 'Export declaration (customs entry)', 'EXPORT'),
                            ('COO', 'Certificate of origin', 'EXPORT'),
                            ('COMM-INV', 'Commercial invoice', 'EXPORT'),
                            ('TRANSIT-DOC', 'Transit / bond document', 'TRANSIT'),
                            ('DRC-IMPORT', 'DRC import declaration', 'IMPORT')]]
        # payroll configuration (SAMPLE rates - verify)
        liab = self.acct[ke.id]['PAYROLL_LIABILITY']
        self.paye_brackets = [{'up_to': 24000, 'rate': 10}, {'up_to': 32333, 'rate': 25},
                              {'up_to': 500000, 'rate': 30}, {'up_to': 800000, 'rate': 32.5},
                              {'up_to': None, 'rate': 35}]
        pc = lambda **kw: M.PayrollConfig.objects.create(  # noqa: E731
            company=ke, liability_account=liab, effective_from=date(2025, 7, 1), **kw)
        pc(code='PAYE', name='PAYE', kind='DEDUCTION', calc_type='BRACKETS', base='GROSS', value=D0,
           brackets=self.paye_brackets)
        pc(code='NSSF', name='NSSF (employee)', kind='DEDUCTION', calc_type='PERCENT', base='GROSS', value=D('6'),
           cap=D('6480'))
        pc(code='SHIF', name='SHIF', kind='DEDUCTION', calc_type='PERCENT', base='GROSS', value=D('2.75'))
        pc(code='AHL', name='Affordable Housing Levy (employee)', kind='DEDUCTION', calc_type='PERCENT',
           base='GROSS', value=D('1.5'))
        pc(code='NSSF-ER', name='NSSF (employer)', kind='EMPLOYER_CONTRIBUTION', calc_type='PERCENT', base='GROSS',
           value=D('6'), cap=D('6480'))
        pc(code='AHL-ER', name='Affordable Housing Levy (employer)', kind='EMPLOYER_CONTRIBUTION',
           calc_type='PERCENT', base='GROSS', value=D('1.5'))
        self.employees = []
        for i, (nm, title, dept, basic, allow, is_drv) in enumerate(EMPLOYEES):
            e = M.Employee.objects.create(
                company=ke, code=self.ref(ke, 'EMP'), full_name=nm, national_id=str(24000000 + i * 731211),
                job_title=title, department=self.dept[dept], hire_date=date(2019 + i % 6, 1 + i % 12, 3),
                basic_salary=D(basic), currency=self.KES,
                allowances=[{'name': 'Housing', 'amount': int(allow * 0.6)},
                            {'name': 'Transport' if not is_drv else 'Hardship', 'amount': int(allow * 0.4)}],
                bank_name='Equity Bank Kenya', bank_account=f'0170{i:02d}8271645', tax_number=f'A00{i}4471{i}Z',
                is_driver=is_drv)
            self.employees.append(e)
        for emp, lt, off, days in [(self.employees[3], 'ANNUAL', -80, 10), (self.employees[6], 'SICK', -35, 3),
                                   (self.employees[4], 'ANNUAL', -12, 5), (self.employees[11], 'ANNUAL', 14, 7)]:
            s = self.today + timedelta(days=off)
            M.LeaveRequest.objects.create(company=ke, reference=self.ref(ke, 'LV'), employee=emp, leave_type=lt,
                                          start_date=s, end_date=s + timedelta(days=days - 1), days=D(days),
                                          status='APPROVED' if off < 0 else 'DRAFT')

    # ================================================================== 9. opening balances
    def s_opening_balances(self):
        ke, cd, S = self.ke, self.cd, self.start
        # fixed assets
        total_cost = total_acc = D0
        for i, v in enumerate(self.vehicles):
            for nm, cat, cost, veh in [(f'{v.make} {v.model} - {v.registration_number}', 'TRUCK', v.purchase_value, v),
                                       (f'Tanker trailer {v.trailer.registration_number}', 'TRAILER',
                                        D(3100000 + i * 40000), None)]:
                salv = q2(cost * D('0.10'))
                months = max((S - (v.purchase_date or S)).days // 30, 0)
                acc = q2((cost - salv) / 60 * months)
                M.FixedAsset.objects.create(
                    company=ke, reference=self.ref(ke, 'FA'), name=nm, category=cat,
                    acquisition_date=v.purchase_date, cost=cost, salvage_value=salv, useful_life_months=60,
                    accumulated_depreciation=acc, location='Mombasa', vehicle=veh, status='ACTIVE')
                total_cost += cost
                total_acc += acc
        # opening stock
        inv_total = D0
        for key, t in self.tank_list:
            qty = D(int(t.capacity * D('0.45') // 1000) * 1000)
            cost = q6(self.buy_price(key[1], S) * D('0.985'))
            _, tot = self.move(S, 'OPENING', t, qty, cost, narration='Opening stock balance',
                               user=self.u['depot'])
            inv_total += tot
        kes_bank, usd_bank, cash = D('450000000'), D('1200000'), D('500000')
        usd_kes = q2(usd_bank * self.rate_usd(S))
        capital = D('300000000')
        retained = kes_bank + usd_kes + cash + inv_total + total_cost - total_acc - capital
        self.post(ke, S, 'Opening balances', [
            ('BANK', kes_bank, 0), ('BANK_USD', usd_kes, 0, dict(currency=self.USD, foreign_amount=usd_bank,
                                                                  exchange_rate=self.rate_usd(S))),
            ('CASH', cash, 0), ('INVENTORY', inv_total, 0), ('FIXED_ASSET', total_cost, 0),
            ('ACCUM_DEP', 0, total_acc), ('SHARE_CAPITAL', 0, capital), ('RETAINED', 0, retained)],
            ('Opening', 'KE'))
        self.post(cd, S, 'Opening balances - capital injection', [
            ('BANK_USD', D('1500000'), 0), ('SHARE_CAPITAL', 0, D('1000000')), ('RETAINED', 0, D('500000'))],
            ('Opening', 'CD'), user=self.u['drc_finance'])

    # ================================================================== 10. transaction engine
    def s_transactions(self):
        dates, d = [], self.start + timedelta(days=3)
        span = max((self.today - self.start).days, 1)
        while d <= self.today:
            dates.append(d)
            prog = (d - self.start).days / span
            d += timedelta(days=self.rnd.randint(3, 8 - int(2 * prog)))
        dates += [self.today + timedelta(days=n) for n in (2, 6, 7)]       # upcoming: approved / awaiting / draft
        self.months = []
        m0 = date(self.start.year, self.start.month, 1)
        while m0 <= self.today:
            self.months.append(month_end(m0))
            m0 = add_months(m0, 1)
        self.me_queue = [me for me in self.months if me < self.today]
        self.me_index = {me: i for i, me in enumerate(self.months)}
        last_done = self.me_queue[-1] if self.me_queue else None
        self.var_plan = {(('MSA', 'AGO'), 3): D('-0.0012'), (('MSA', 'PMS'), 5): D('0.0006'),
                         (('NBO', 'AGO'), self.me_index.get(last_done, 0)): D('-0.0021')}
        self.last_completed = last_done
        for d in dates:
            while self.me_queue and d - timedelta(days=3) > self.me_queue[0]:
                self.month_end_stock(self.me_queue.pop(0))
            self.make_shipment(d)
        while self.me_queue:
            self.month_end_stock(self.me_queue.pop(0))

    # ---------------------------------------------------------------- procurement cycle
    def fuel_supplier(self, code):
        if code == 'JET':
            return self.suppliers[3]
        if code == 'DPK':
            return self.suppliers[1]
        return self.fuel_sups[self.stats['pos'] % 3]

    def replenish(self, tank, need_date):
        ke, T = self.ke, self.today
        code = tank.product.code
        d_r = max(need_date - timedelta(days=2), self.last_move[tank.id])
        od = d_r - timedelta(days=3)
        qty = ((tank.capacity * D('0.9') - self.bal[tank.id][0]) // 1000) * 1000
        sup = self.fuel_supplier(code)
        self.stats['pos'] += 1
        dk = [k for k, t in self.tank_list if t.id == tank.id][0][0]
        price = q6(self.buy_price(code, od) * D(str(round(1 + self.rnd.uniform(-0.004, 0.004), 5))))
        prod = tank.product
        pr = M.PurchaseRequisition.objects.create(
            company=ke, reference=self.ref(ke, 'PR'), department=self.dept['Operations'], product=prod,
            quantity=qty, required_date=d_r, reason=f'Replenish {prod.name} at {tank.depot.name}',
            status='CONVERTED', created_by=self.u['depot'])
        M.SupplierQuotation.objects.create(
            company=ke, reference=self.ref(ke, 'SQ'), supplier=sup, product=prod, quantity=qty, unit_price=price,
            currency=self.KES, valid_until=od + timedelta(days=5), status='ACCEPTED', created_by=self.u['procurement'])
        M.SupplierPrice.objects.create(company=ke, supplier=sup, product=prod, price=price, currency=self.KES,
                                       effective_date=od, source='QUOTATION')
        po = M.PurchaseOrder.objects.create(
            company=ke, reference=self.ref(ke, 'PO'), supplier=sup, requisition=pr, order_date=od,
            loading_depot=tank.depot, delivery_location=tank.depot.name, expected_loading_date=d_r,
            payment_terms_days=sup.payment_terms_days, status='APPROVED', created_by=self.u['procurement'],
            **self.fx(self.KES, od))
        line = M.PurchaseOrderLine.objects.create(order=po, product=prod, quantity=qty, unit_price=price,
                                                  tax_code='VAT16', tax_rate=D('16'))
        po.recalc()
        if po.total >= 1000000:
            self.approval(ke, po, 'PurchaseOrder', po.total, f'{po.reference} - {sup.name} - {qty:,.0f} L {code}',
                          self.u['procurement'], self.u['finance'], 'APPROVED', od)
        self.audit(self.u['procurement'], ke, 'CREATE', po, {'total': str(po.total)}, od)
        # goods receipt (temperature-corrected volumes)
        temp = D(str(self.temp[dk])) + D(str(round(self.rnd.uniform(-1, 1), 2)))
        std = q3(qty * D(str(round(1 + self.rnd.uniform(-0.0012, 0.0012), 6))))
        obs = q3(std / (1 - prod.expansion_coefficient * (temp - 15)))
        dens = ((prod.density_min + prod.density_max) / 2).quantize(D('0.0001'))
        grn = M.GoodsReceipt.objects.create(
            company=ke, reference=self.ref(ke, 'GRN'), purchase_order=po, line=line, depot=tank.depot, tank=tank,
            receipt_date=d_r, delivery_note=f'DN-{self.rnd.randint(100000, 999999)}',
            vehicle_reg=f'KC{self.rnd.choice("ABCDE")} {self.rnd.randint(100, 999)}{self.rnd.choice("ABCDEFGH")}',
            observed_volume=obs, temperature_c=temp, density=dens, standardized_volume=std,
            volume_basis='STANDARDIZED', quantity=std, unit_cost=price, total_cost=q2(std * price), status='POSTED',
            created_by=self.u['depot'])
        upd(line, received_quantity=std)
        self.move(d_r, 'RECEIPT', tank, std, price, ref=grn.reference, src=('GoodsReceipt', grn.id),
                  narration=f'Receipt {grn.reference} from {sup.name}', observed_volume=obs, temperature_c=temp,
                  density=dens, standardized_volume=std)
        self.post(ke, d_r, f'Goods receipt {grn.reference}', [
            ('INVENTORY', grn.total_cost, 0, {'narration': f'{std:,.0f} L {code}'}),
            ('GRNI', 0, grn.total_cost)], ('GoodsReceipt', grn.id), user=self.u['depot'])
        upd(po, status='RECEIVED')
        # supplier invoice, three-way matched
        pi_date = d_r + timedelta(days=2)
        if pi_date <= T:
            pi = M.PurchaseInvoice.objects.create(
                company=ke, reference=self.ref(ke, 'PINV'), supplier=sup, purchase_order=po,
                supplier_invoice_no=f'{sup.name[:3].upper()}/{pi_date:%y%m}/{self.rnd.randint(1000, 9999)}',
                invoice_date=pi_date, due_date=pi_date + timedelta(days=sup.payment_terms_days),
                match_status='MATCHED', match_notes='Three-way match within tolerance.', status='POSTED',
                created_by=self.u['accountant'], **self.fx(self.KES, pi_date))
            M.PurchaseInvoiceLine.objects.create(invoice=pi, po_line=line, product=prod, quantity=std,
                                                 unit_price=price, tax_code='VAT16', tax_rate=D('16'))
            pi.recalc()
            j = self.post(ke, pi_date, f'Purchase invoice {pi.supplier_invoice_no}', [
                ('GRNI', pi.subtotal, 0), ('VAT_INPUT', pi.tax_total, 0),
                ('AP', 0, pi.total, {'party_type': 'SUPPLIER', 'party_id': sup.id})], ('PurchaseInvoice', pi.id))
            upd(pi, journal=j, functional_total=pi.total)
            upd(po, status='INVOICED')
            pay_d = pi.due_date + timedelta(days=self.rnd.randint(-2, 4))
            if pay_d <= T:
                self.pay_out('SUPPLIER', sup, pay_d, pi.total, alloc_field='purchase_invoice', doc=pi)
                upd(po, status='CLOSED')
        self.latest_po[tank.id] = po
        return po

    # ---------------------------------------------------------------- payments
    def pay_out(self, ptype, party, d, amount, *, alloc_field=None, doc=None, purpose='INVOICE', booking=None,
                method='BANK'):
        ke = self.ke
        bank, key = self.bank_for(ke, method, self.KES)
        amount = q2(amount)
        p = M.Payment.objects.create(
            company=ke, reference=self.ref(ke, 'PAY'), direction='PAYMENT', party_type=ptype,
            **{ptype.lower(): party}, method=method, bank_account=bank, payment_date=d, amount=amount,
            purpose=purpose, booking=booking, bank_reference=f'EQB{self.rnd.randint(10 ** 8, 10 ** 9 - 1)}',
            narration=f'Payment to {party.name}', allocated_amount=amount if doc is not None else D0,
            approved_by=self.u['finance'], approved_at=dt(d, 10), executed_by=self.u['accountant'],
            status='POSTED', created_by=self.u['accountant'], **self.fx(self.KES, d))
        j = self.post(ke, d, f'{p.reference} payment to {party.name}', [
            ('AP', amount, 0, {'party_type': ptype, 'party_id': party.id}), (key, 0, amount)],
            ('Payment', p.id))
        upd(p, journal=j)
        if doc is not None:
            M.PaymentAllocation.objects.create(payment=p, amount=amount, **{alloc_field: doc})
            paid = doc.amount_paid + amount
            upd(doc, amount_paid=paid, status='PAID' if paid >= doc.total else 'PART_PAID')
        self.audit(self.u['accountant'], ke, 'POST', p, {'amount': str(amount)}, d)
        return p

    def receive(self, inv, d, amount):
        ke = self.ke
        bank, key = self.bank_for(ke, 'BANK', self.USD)
        rp, ri = self.rate_usd(d), inv.exchange_rate
        amount = q2(amount)
        p = M.Payment.objects.create(
            company=ke, reference=self.ref(ke, 'PAY'), direction='RECEIPT', party_type='CUSTOMER',
            customer=inv.customer, method='BANK', bank_account=bank, payment_date=d, amount=amount,
            purpose='INVOICE', bank_reference=f'SWF{self.rnd.randint(10 ** 8, 10 ** 9 - 1)}',
            narration=f'Receipt {inv.reference} from {inv.customer.name}', allocated_amount=amount,
            approved_by=self.u['finance'], approved_at=dt(d, 10), executed_by=self.u['accountant'],
            status='POSTED', created_by=self.u['accountant'], **self.fx(self.USD, d))
        dr_bank, cr_ar = q2(amount * rp), q2(amount * ri)
        diff = dr_bank - cr_ar
        fxl = dict(currency=self.USD, foreign_amount=amount)
        lines = [(key, dr_bank, 0, dict(fxl, exchange_rate=rp)),
                 ('AR', 0, cr_ar, dict(fxl, exchange_rate=ri, party_type='CUSTOMER', party_id=inv.customer_id))]
        if diff > 0:
            lines.append(('FX_GAIN', 0, diff))
        elif diff < 0:
            lines.append(('FX_LOSS', -diff, 0))
        j = self.post(ke, d, f'{p.reference} receipt {inv.reference}', lines, ('Payment', p.id))
        upd(p, journal=j)
        M.PaymentAllocation.objects.create(payment=p, sales_invoice=inv, amount=amount, fx_gain_loss=diff)
        paid = inv.amount_paid + amount
        upd(inv, amount_paid=paid, status='PAID' if paid >= inv.total - inv.amount_credited else 'PART_PAID')
        self.audit(self.u['accountant'], ke, 'POST', p, {'amount': str(amount), 'currency': 'USD'}, d)

    # ---------------------------------------------------------------- expenses
    def expense(self, d, cat_code, desc, amount, *, shipment=None, vehicle=None, supplier=None, transporter=None,
                payee='', owner='NA', tax_rate=D0, method='BANK', credit=False, user=None):
        if d > self.today:
            return None
        ke = self.ke
        amount = q2(amount)
        tax = q2(amount * tax_rate / 100)
        total = amount + tax
        bank = key = None
        if not credit:
            bank, key = self.bank_for(ke, method, self.KES)
        self.rcp += 1
        exp = M.Expense.objects.create(
            company=ke, reference=self.ref(ke, 'EXP'), expense_date=d, category=self.cats[cat_code],
            description=desc[:255], shipment=shipment, vehicle=vehicle, supplier=supplier, transporter=transporter,
            payee=payee[:150], truck_ownership=owner, amount=amount, tax_amount=tax,
            payment_method='CREDIT' if credit else method, bank_account=bank,
            receipt_no=f'RCP-{d:%y%m}-{self.rcp:05d}', amount_paid=D0 if credit else total, functional_total=total,
            status='POSTED' if credit else 'PAID', created_by=user or self.u['accountant'], **self.fx(self.KES, d))
        lines = [(CAT_ACCT[cat_code], amount, 0, {'shipment': shipment, 'narration': desc[:255]})]
        if tax:
            lines.append(('VAT_INPUT', tax, 0))
        if credit:
            party = transporter or supplier
            lines.append(('AP', 0, total, {'party_type': 'TRANSPORTER' if transporter else 'SUPPLIER',
                                            'party_id': party.id}))
        else:
            lines.append((key, 0, total))
        upd(exp, journal=self.post(ke, d, f'{exp.reference} {desc}', lines, ('Expense', exp.id)))
        if shipment is not None:
            M.ShipmentCostAllocation.objects.create(company=ke, shipment=shipment, expense=exp, method='DIRECT',
                                                    percentage=D('100'), amount=amount)
        return exp

    # ---------------------------------------------------------------- one shipment, end to end
    def timeline(self, d, days):
        offs = [-7, -6, -4, -1, 0, 0, 1, 2, days - 4, days - 3, days - 2, days, days + 1, days + 3, days + 7]
        return [(s, d + timedelta(days=o)) for s, o in zip(STEPS, offs) if d + timedelta(days=o) <= self.today]

    def make_shipment(self, d):
        ke, T = self.ke, self.today
        rnd = self.rnd
        u = self.u
        code = rnd.choices(['AGO', 'PMS', 'DPK', 'JET'], [6, 3, 1.2, 0.8])[0]
        cust = rnd.choice(self.customers)
        dest = self.cust_dest[cust.id]
        info = DEST[dest]
        qty = D(rnd.choice([30000, 33000, 35000, 36000]))
        dk = 'MSA' if code in ('DPK', 'JET') else rnd.choices(['MSA', 'NBO', 'ELD'], [6, 2, 1])[0]
        tank, prod, depot = self.tanks[(dk, code)], self.products[code], self.depots[dk]
        steps = self.timeline(d, info['days'])
        reached = dict(steps)
        status = steps[-1][0]
        loaded = 'LOADED' in reached
        full = {s: d + timedelta(days=o) for s, o in zip(STEPS, [-7, -6, -4, -1, 0, 0, 1, 2, info['days'] - 4,
                                                                  info['days'] - 3, info['days'] - 2, info['days'],
                                                                  info['days'] + 1, info['days'] + 3,
                                                                  info['days'] + 7])}
        po = None
        if loaded:
            if self.bal[tank.id][0] < qty + tank.min_level:
                self.replenish(tank, d)
            po = self.latest_po.get(tank.id)
        # pricing
        buy, rate = self.buy_price(code, d), self.rate_usd(d)
        contract = self.contracts.get((cust.id, code))
        margin = D(rnd.choice(['0.055', '0.06', '0.065', '0.07', '0.08', '0.09']))
        if contract and contract.pricing_method == 'FIXED':
            pm, sell = 'FIXED', contract.price_per_litre
        else:
            pm = 'COST_PLUS' if contract else rnd.choice(['MARKET', 'COST_PLUS'])
            sell = self.sell_price(code, d, dest, margin)
        cost_usd = q6((float(buy) + info['haul'] + 7) / float(rate))
        base = q6(float(buy) / float(rate))
        # fleet
        veh = next((v for v in self.vehicles if self.busy[v.id] < d - timedelta(days=1)), None)
        owned = veh is not None and rnd.random() < 0.75
        trn = trk = trl = None
        if owned:
            self.busy[veh.id] = d + timedelta(days=2 * info['days'] + 4)
        else:
            trn = rnd.choice(self.transporters)
            trk, trl = rnd.choice(self.trn_trucks[trn.id])
        # quotation + order
        qd = d - timedelta(days=10)
        sq = M.SalesQuotation.objects.create(
            company=ke, reference=self.ref(ke, 'SQT'), customer=cust, product=prod, quantity=qty, quote_date=qd,
            valid_until=qd + timedelta(days=7), pricing_method=pm, cost_per_litre=cost_usd, selling_price=sell,
            expected_profit=q2(qty * (sell - cost_usd)), status='CONVERTED', created_by=u['sales'],
            **self.fx(self.USD, qd))
        od = d - timedelta(days=7)
        so = M.SalesOrder.objects.create(
            company=ke, reference=self.ref(ke, 'SO'), customer=cust, contract=contract, quotation=sq,
            order_date=od, required_date=d + timedelta(days=info['days'] + 2),
            delivery_location=info['addr'], delivery_terms='DAP', status='DRAFT', created_by=u['sales'],
            **self.fx(self.USD, od))
        sol = M.SalesOrderLine.objects.create(
            order=so, product=prod, quantity=qty, unit_price=sell, tax_code='ZERO', tax_rate=D0,
            pricing_method=pm, cost_per_litre=cost_usd, base_price=base, premium=q6(sell - base),
            markup_pct=q3((sell - cost_usd) / cost_usd * 100) if pm == 'COST_PLUS' else None,
            target_margin_pct=q3(margin * 100), profit_per_litre=q6(sell - cost_usd),
            margin_pct=q3((sell - cost_usd) / sell * 100))
        so.recalc()
        self.audit(u['sales'], ke, 'CREATE', so, {'total_usd': str(so.total)}, od)
        # shipment
        n = self.stats['shipments'] = self.stats['shipments'] + 1
        sh = M.Shipment.objects.create(
            company=ke, reference=self.ref(ke, 'SHP'), customer=cust, supplier=po.supplier if po else None,
            purchase_order=po, sales_order=so, product=prod, quantity=qty, purchase_price=buy, selling_price=sell,
            depot=depot, loading_tank=tank, loading_date=d, loading_quantity=qty if loaded else D0,
            truck_ownership='OWNED' if owned else 'HIRED', vehicle=veh if owned else None,
            trailer=veh.trailer if owned else None, driver=self.veh_driver[veh.id] if owned else None,
            transporter=trn, hired_truck=trk, origin=f'{depot.location}', destination=info['addr'],
            border_crossing=self.borders[info['border']], expected_delivery=dt(d + timedelta(days=info['days'] + 1), 12),
            distance_km=D(info['km']), status=status, created_by=u['ops'], **self.fx(self.USD, d))
        self.audit(u['ops'], ke, 'CREATE', sh, {'qty': str(qty), 'dest': dest}, max(d - timedelta(days=7), self.start))
        if 'APPROVED' in reached:
            self.approval(ke, so, 'SalesOrder', so.total * rate, f'{so.reference} - {cust.name}', u['sales'],
                          u['ops'], 'APPROVED', full['APPROVED'])
        elif 'AWAITING_APPROVAL' in reached:
            self.approval(ke, so, 'SalesOrder', so.total * rate, f'{so.reference} - {cust.name}', u['sales'],
                          u['ops'], 'PENDING', full['AWAITING_APPROVAL'])
        if d > T and 'APPROVED' in reached:
            M.StockReservation.objects.create(company=ke, reference=self.ref(ke, 'RSV'), depot=depot, product=prod,
                                              quantity=qty, sales_order=so, shipment=sh, status='ACTIVE',
                                              created_by=u['ops'])
        # status history (permanent, manual tracking)
        locs = {'DRAFT': 'Head Office, Mombasa', 'AWAITING_APPROVAL': 'Head Office, Mombasa',
                'APPROVED': 'Head Office, Mombasa', 'IN_TRANSIT': info['mid'], 'AT_BORDER': sh.border_crossing.name,
                'UNDER_CUSTOMS': sh.border_crossing.name, 'CLEARED': sh.border_crossing.name,
                'ARRIVED': info['addr'], 'DELIVERED': info['addr'], 'RECONCILIATION_PENDING': 'Head Office, Mombasa',
                'CLOSED': 'Head Office, Mombasa'}
        hist, prev = [], ''
        for st, sd in steps:
            hist.append(M.ShipmentStatusHistory(
                company=ke, shipment=sh, previous_status=prev, new_status=st,
                changed_at=dt(sd, 8 + len(hist) % 9, rnd.randint(0, 59)), location=locs.get(st, depot.location),
                updated_by=u['ops'], comments=f'Status moved to {st.replace("_", " ").title()}.',
                confirmation_type='CUSTOMER' if st == 'DELIVERED' else 'NONE',
                confirmed_by=rnd.choice(CONGO_RECEIVERS) if st == 'DELIVERED' else ''))
            prev = st
        M.ShipmentStatusHistory.objects.bulk_create(hist)
        # stages
        for stage, st in [('LOADING', 'LOADED'), ('DEPARTURE', 'DISPATCHED'), ('BORDER', 'AT_BORDER'),
                          ('CUSTOMS', 'UNDER_CUSTOMS'), ('DELIVERY', 'DELIVERED')]:
            M.ShipmentStage.objects.create(
                company=ke, shipment=sh, stage=stage, planned_at=dt(full[st], 9),
                actual_at=dt(reached[st], 10) if st in reached else None,
                location=locs.get(st, depot.location), notes='')
        # compliance
        for rq in self.reqs:
            ok = 'DISPATCHED' in reached
            M.ShipmentComplianceCheck.objects.create(
                company=ke, shipment=sh, requirement=rq, status='PROVIDED' if ok else 'PENDING',
                document_ref=f'{rq.code}-{n:04d}' if ok else '', checked_by=u['ops'] if ok else None,
                checked_at=dt(reached['DISPATCHED'], 15) if ok else None)
        # fleet assignment
        if owned:
            done = d + timedelta(days=2 * info['days'] + 3)
            M.VehicleAssignment.objects.create(
                company=ke, vehicle=veh, trailer=veh.trailer, driver=self.veh_driver[veh.id], shipment=sh,
                start_at=dt(d, 7), end_at=dt(done, 18) if done <= T else None,
                status='COMPLETED' if done <= T else 'ACTIVE')
            if done <= T:
                self.odo[veh.id] += D(2 * info['km'])
        comps = {}

        def spend(k, *a, **kw):
            e = self.expense(*a, shipment=sh, **kw)
            if e is not None:
                comps[k] = comps.get(k, D0) + e.amount
            return e

        if not loaded:
            self.finish_shipment(sh, so, sol, status, comps, None, None, reached, D0, D0)
            return
        # stock issue -> goods in transit
        cost, total = self.move(d, 'ISSUE', tank, qty, ref=self.ref(ke, 'MOV'), shipment=sh,
                                src=('Shipment', sh.id), narration=f'Loaded for {sh.reference} to {dest.title()}',
                                user=u['depot'])
        self.post(ke, d, f'Stock issue {sh.reference}', [
            ('TRANSIT', total, 0, {'shipment': sh}), ('INVENTORY', 0, total)], ('Shipment', sh.id), user=u['depot'])
        M.ShipmentLine.objects.create(shipment=sh, product=prod, tank=tank, compartment='1-3', quantity=qty,
                                      loaded_quantity=qty, purchase_price=cost, selling_price=sell,
                                      unit_cost=cost, cost_total=total)
        upd(sh, stock_issued=True, purchase_price=cost, dispatched_at=dt(reached['DISPATCHED'], 14)
            if 'DISPATCHED' in reached else None)
        # loading & insurance
        spend('LOADING', d, 'LOADING', f'Loading / throughput {sh.reference}', qty * D('0.45'), payee=depot.name + ' operator',
              tax_rate=D('16'), user=u['depot'])
        spend('INSURANCE', d, 'INS-TRANSIT', f'Cargo transit insurance {sh.reference}', total * D('0.0015'),
              supplier=self.insurer, credit=True)
        dispatch = reached.get('DISPATCHED')
        booking = trn_exp = None
        if owned and dispatch:
            litres = D(round(info['km'] / 2.1))
            fuel_price = D(str(round(182 + 6 * math.sin(d.toordinal() / 30), 2)))
            fe = spend('FUEL', dispatch, 'TRIP-FUEL', f'Trip diesel {veh.registration_number} - {sh.reference}',
                       litres * fuel_price, vehicle=veh, payee='Fuel card - Total Energies Mombasa', owner='OWNED',
                       tax_rate=D0)
            M.VehicleExpense.objects.create(company=ke, vehicle=veh, shipment=sh, expense_type='FUEL',
                                            expense_date=dispatch, litres=litres, odometer_km=self.odo[veh.id],
                                            amount=fe.amount if fe else D0, expense=fe)
            ae = spend('DRIVER', dispatch, 'DRV-ALLOW', f'Driver allowance {sh.reference}',
                       D(rnd.choice([45000, 55000, 65000, 75000])), vehicle=veh,
                       payee=self.veh_driver[veh.id].full_name, owner='OWNED', method='MPESA')
            M.VehicleExpense.objects.create(company=ke, vehicle=veh, shipment=sh, expense_type='ALLOWANCE',
                                            expense_date=dispatch, odometer_km=self.odo[veh.id],
                                            amount=ae.amount if ae else D0, expense=ae)
            upd(sh, fuel_issued_litres=litres)
        elif not owned:
            rate_l = q6(D(str(info['haul'])) * self.trn_factor[trn.id])
            charge = q2(qty * rate_l)
            bd = d - timedelta(days=2)
            booking = M.TransportBooking.objects.create(
                company=ke, reference=self.ref(ke, 'TB'), shipment=sh, transporter=trn, truck=trk, trailer=trl,
                driver_name=trk.driver_name, product=prod, quantity=qty, booking_date=bd, origin='Mombasa',
                destination=info['addr'].split(',')[0], rate_basis='PER_LITRE', contracted_rate=rate_l,
                total_charge=charge, expected_delivery=d + timedelta(days=info['days'] + 1),
                status='IN_TRANSIT' if dispatch else 'APPROVED', created_by=u['ops'], **self.fx(self.KES, bd))
            if dispatch:
                adv = q2(charge * D('0.5'))
                adv_pay = self.pay_out('TRANSPORTER', trn, dispatch, adv, purpose='ADVANCE', booking=booking)
                upd(booking, advance_paid=adv)
        # border / customs
        if 'AT_BORDER' in reached:
            spend('BORDER', reached['AT_BORDER'], 'BORDER-FEES', f'Border & transit fees {sh.reference}',
                  D(rnd.randint(85, 125) * 1000), payee=sh.border_crossing.name, owner='OWNED' if owned else 'HIRED',
                  method='CASH')
        if 'UNDER_CUSTOMS' in reached:
            spend('CLEARING', reached['UNDER_CUSTOMS'], 'CLEARING', f'Clearing & forwarding {sh.reference}',
                  D(rnd.randint(55, 75) * 1000), supplier=self.agent, credit=True, tax_rate=D('16'))
        if dispatch:
            M.ExportDeclaration.objects.create(
                company=ke, reference=self.ref(ke, 'EXD'), shipment=sh,
                declaration_number=f'KE-EXP-{d:%Y}-{self.nxt(ke, "EXDNO"):05d}', customs_reference=f'KRA/C/{d:%y}/{n:05d}',
                commercial_invoice_no=f'CI-{n:05d}', certificate_of_origin_no=f'COO-{n:05d}',
                transit_document_no=f'TRN-{n:05d}', customs_broker=self.agent.name,
                border_crossing=sh.border_crossing, export_date=dispatch,
                clearance_date=reached.get('CLEARED'), import_document_no=f'CD-IMP-{n:05d}' if 'CLEARED' in reached else '',
                import_clearance_date=reached.get('ARRIVED') if 'CLEARED' in reached else None,
                status='CLEARED' if 'CLEARED' in reached else 'SUBMITTED', created_by=u['ops'])
            for dtp in ('COMMERCIAL_INVOICE', 'TRANSIT_DOC', 'EXPORT_DECLARATION', 'CERTIFICATE_OF_ORIGIN'):
                M.ShipmentDocument.objects.create(company=ke, shipment=sh, doc_type=dtp, number=f'{dtp[:3]}-{n:05d}')
        # delivery, COGS, invoice
        delivered_qty = shortage = D0
        loss_val = cogs_val = D0
        si = None
        if 'DELIVERED' in reached:
            dd = reached['DELIVERED']
            spend('OFFLOADING', dd, 'OFFLOAD', f'Offloading & delivery {sh.reference}', D(rnd.randint(38, 52) * 1000),
                  payee=cust.name, owner='OWNED' if owned else 'HIRED', method='CASH')
            pct = D(rnd.choice(['0', '0.05', '0.1', '0.18', '0.25', '0.3', '0.42', '0.75', '1.2']))
            delivered_qty = q3(qty * (1 - pct / 100))
            shortage = qty - delivered_qty
            pending = pct > self.ke.delivery_loss_tolerance_pct and (T - dd).days < 4
            cogs_val = q2(delivered_qty * cost)
            loss_val = total - cogs_val
            dlv = M.ShipmentDelivery.objects.create(
                company=ke, reference=self.ref(ke, 'DLV'), shipment=sh, delivery_date=dd, delivered_quantity=delivered_qty,
                remaining_before=qty, is_final=True, shortage_litres=shortage, shortage_pct=q3(pct),
                cogs_value=cogs_val, loss_value=loss_val, temperature_c=D(str(rnd.randint(24, 31))),
                density=((prod.density_min + prod.density_max) / 2).quantize(D('0.0001')),
                received_by=rnd.choice(CONGO_RECEIVERS), notes='Delivered and signed POD.',
                status='PENDING_APPROVAL' if pending else 'APPROVED', created_by=u['ops'])
            if pct > self.ke.delivery_loss_tolerance_pct:
                self.approval(ke, dlv, 'ShipmentDelivery', loss_val, f'{sh.reference} shortage {pct}%', u['ops'],
                              u['finance'], 'PENDING' if pending else 'APPROVED', dd)
            M.ShipmentDocument.objects.create(company=ke, shipment=sh, doc_type='POD', number=f'POD-{n:05d}')
            M.ShipmentDocument.objects.create(company=ke, shipment=sh, doc_type='DELIVERY_NOTE',
                                              number=f'DN-{n:05d}')
            if not pending:
                upd(dlv, journal=self.post(ke, dd, f'Delivery {dlv.reference} - COGS', [
                    ('COGS', cogs_val, 0, {'shipment': sh}), ('INVENTORY_LOSS', loss_val, 0, {'shipment': sh}),
                    ('TRANSIT', 0, total, {'shipment': sh})], ('ShipmentDelivery', dlv.id)))
                si = self.invoice(sh, so, sol, cust, prod, delivered_qty, sell, dd)
            else:
                status = 'DELIVERED'
            upd(sh, actual_delivery=dt(dd, 13), fuel_used_litres=q3(sh.fuel_issued_litres * D('0.97')))
            upd(sol, delivered_quantity=delivered_qty)
        # hired transport invoice / settlement
        if booking and 'DELIVERED' in reached:
            ti_d = reached['DELIVERED'] + timedelta(days=3)
            if ti_d <= T:
                e = spend('TRANSPORT_HIRED', ti_d, 'TRANS-HIRE', f'Hired transport {booking.reference} - {sh.reference}',
                          booking.total_charge, transporter=trn, credit=True, owner='HIRED')
                ti = M.TransporterInvoice.objects.create(
                    company=ke, reference=self.ref(ke, 'TINV'), transporter=trn, booking=booking,
                    invoice_no=f'{trn.name[:3].upper()}/{ti_d:%y%m}/{self.rnd.randint(100, 999)}', invoice_date=ti_d,
                    due_date=ti_d + timedelta(days=30), subtotal=booking.total_charge, tax_total=D0,
                    total=booking.total_charge, amount_credited=D0, amount_paid=booking.advance_paid,
                    functional_total=booking.total_charge, expense=e, status='PART_PAID',
                    created_by=u['accountant'], **self.fx(self.KES, ti_d))
                M.PaymentAllocation.objects.create(payment=adv_pay, transporter_invoice=ti, amount=booking.advance_paid)
                upd(adv_pay, allocated_amount=booking.advance_paid)
                upd(booking, status='INVOICED')
                bal_d = ti.due_date + timedelta(days=rnd.randint(-3, 3))
                if bal_d <= T:
                    self.pay_out('TRANSPORTER', trn, bal_d, ti.total - ti.amount_paid, alloc_field='transporter_invoice',
                                 doc=ti)
                    upd(e, amount_paid=e.total, status='PAID')
                    upd(booking, status='SETTLED')
            else:
                upd(booking, status='DELIVERED')
        # settle clearing/insurance credit expenses ~30 days later
        for e in M.Expense.objects.filter(shipment=sh, payment_method='CREDIT', supplier__isnull=False, amount_paid=0):
            pd_ = e.expense_date + timedelta(days=30 + rnd.randint(0, 6))
            if pd_ <= T:
                self.pay_out('SUPPLIER', e.supplier, pd_, e.total, alloc_field='expense', doc=e)
        self.finish_shipment(sh, so, sol, status, comps, si, cost, reached, delivered_qty, shortage,
                             total=total, qty=qty, sell=sell, cost_total=total, loss_val=loss_val)

    def invoice(self, sh, so, sol, cust, prod, qty, sell, dd):
        ke, T, rnd = self.ke, self.today, self.rnd
        si = M.SalesInvoice.objects.create(
            company=ke, reference=self.ref(ke, 'INV'), customer=cust, sales_order=so, invoice_date=dd,
            due_date=dd + timedelta(days=cust.credit_period_days), status='POSTED', created_by=self.u['accountant'],
            **self.fx(self.USD, dd))
        M.SalesInvoiceLine.objects.create(invoice=si, order_line=sol, shipment=sh, product=prod, quantity=qty,
                                          unit_price=sell, tax_code='ZERO', tax_rate=D0)
        si.recalc()
        func = q2(si.total * si.exchange_rate)
        j = self.post(ke, dd, f'Sales invoice {si.reference} - {cust.name}', [
            ('AR', func, 0, dict(currency=self.USD, foreign_amount=si.total, exchange_rate=si.exchange_rate,
                                 party_type='CUSTOMER', party_id=cust.id, shipment=sh)),
            ('REVENUE', 0, func, {'shipment': sh})], ('SalesInvoice', si.id))
        upd(si, journal=j, functional_total=func)
        upd(sol, invoiced_quantity=qty)
        self.audit(self.u['accountant'], ke, 'POST', si, {'total_usd': str(si.total)}, dd)
        # occasional quality / price credit note
        if rnd.random() < 0.08 and dd + timedelta(days=7) <= T:
            nd, cq = dd + timedelta(days=7), D(rnd.choice([300, 500, 800]))
            sub = q2(cq * sell)
            cn = M.SalesCreditNote.objects.create(
                company=ke, reference=self.ref(ke, 'SCRN'), invoice=si, shipment=sh, product=prod, note_date=nd,
                quantity=cq, unit_price=sell, tax_rate=D0, subtotal=sub, tax_total=D0, total=sub,
                reason='Quality / density variance claim', status='POSTED', created_by=self.u['accountant'],
                **self.fx(self.USD, nd))
            cf = q2(sub * self.rate_usd(nd))
            upd(cn, journal=self.post(ke, nd, f'Credit note {cn.reference}', [
                ('REVENUE', cf, 0, {'shipment': sh}),
                ('AR', 0, cf, dict(currency=self.USD, foreign_amount=sub, exchange_rate=self.rate_usd(nd),
                                   party_type='CUSTOMER', party_id=cust.id))], ('SalesCreditNote', cn.id)))
            upd(si, amount_credited=sub)
        # customer receipts
        target = si.total - si.amount_credited
        d1 = dd + timedelta(days=rnd.randint(22, 52))
        plan = [(d1, D('0.6')), (d1 + timedelta(days=rnd.randint(18, 30)), D('0.4'))] if rnd.random() < 0.15 else \
            [(d1, D('1'))]
        paid = D0
        for k, (pd_, share) in enumerate(plan):
            if pd_ <= T:
                amt = q2(target * share) if k < len(plan) - 1 else target - paid
                self.receive(si, pd_, amt)
                paid += amt
        return si

    def finish_shipment(self, sh, so, sol, status, comps, si, cost, reached, delivered_qty, shortage, total=D0,
                        qty=D0, sell=D0, cost_total=D0, loss_val=D0):
        """Final statuses, cost sheets and vehicle status."""
        ke = self.ke
        if status in ('DELIVERED', 'RECONCILIATION_PENDING', 'CLOSED') and si is None:
            status = 'ARRIVED' if status == 'DELIVERED' and delivered_qty == 0 else status
        if status in ('RECONCILIATION_PENDING', 'CLOSED') and si is None:
            status = 'DELIVERED'
        upd(sh, status=status)
        idx = STEPS.index(status)
        so_status = ('DRAFT' if idx == 0 else 'AWAITING_APPROVAL' if idx == 1 else 'APPROVED' if idx <= 5 else
                     'IN_FULFILMENT' if idx <= 11 else 'COMPLETED')
        if si is None and idx >= 12:
            so_status = 'IN_FULFILMENT'
        upd(so, status=so_status)
        if 'LOADED' not in reached:
            return
        direct = sum(comps.values(), D0)
        revenue = si.functional_total if si else D0
        base = dict(company=ke, shipment=sh, purchase_cost=cost_total, total_direct_expenses=direct,
                    total_shipment_cost=cost_total + direct, cogs_pool=cost_total + direct, additional_expenses=D0,
                    loaded_litres=qty, delivered_litres=delivered_qty, shortage_litres=shortage,
                    shortage_value=loss_val, invoiced_litres=delivered_qty if si else D0, revenue=revenue,
                    components={k: str(v) for k, v in comps.items()}, created_by=self.u['finance'])

        def sheet(ver, final):
            cogs = base['total_shipment_cost'] if si else D0
            gp = revenue - cogs
            M.ShipmentCostSheet.objects.create(
                version=ver, is_final=final, is_provisional=not final, cogs=cogs, gross_profit=gp, contribution=gp,
                margin_pct=q3(gp / revenue * 100) if revenue else D0,
                delivered_cost_per_litre=q6(base['total_shipment_cost'] / delivered_qty) if delivered_qty else D0,
                notes='Final after reconciliation.' if final else 'Provisional - updates as costs post.', **base)

        sheet(1, False)
        if status == 'CLOSED':
            sheet(2, True)

    # ================================================================== month-end stock reconciliation
    def month_end_stock(self, me):
        ke = self.ke
        ms = date(me.year, me.month, 1)
        mi = self.me_index[me]
        for key, tank in self.tank_list:
            opening = closing = closing_val = rec = iss = adj = D0
            for ld, t, q, qa, va in self.mlog[tank.id]:
                if ld <= me:
                    closing, closing_val = qa, va
                if ld < ms or t == 'OPENING':
                    if ld <= me:
                        opening = qa
                elif ld <= me:
                    if t == 'RECEIPT':
                        rec += q
                    elif t == 'ISSUE':
                        iss += q
                    elif t == 'ADJ_OUT':
                        adj -= q
                    elif t == 'ADJ_IN':
                        adj += q
            pct = self.var_plan.get((key, mi), D0)
            var = q3(closing * pct)
            phys = closing + var
            avg = q6(closing_val / closing) if closing else D0
            prod = tank.product
            temp = D(str(self.temp[key[0]]))
            M.TankReading.objects.create(
                company=ke, tank=tank, reading_date=me, reading_time=time(18, 0), reading_type='CLOSING',
                dip_cm=q2(phys / tank.capacity * 600), observed_volume=q3(phys / (1 - prod.expansion_coefficient * (temp - 15))),
                temperature_c=temp, density=((prod.density_min + prod.density_max) / 2).quantize(D('0.0001')),
                standardized_volume=phys, notes='Month-end physical dip', created_by=self.u['depot'])
            adjustment, status = None, 'NO_VARIANCE'
            if var != 0:
                late = me == self.last_completed
                adjustment = M.StockAdjustment.objects.create(
                    company=ke, reference=self.ref(ke, 'ADJ'), tank=tank, product=prod, adjustment_date=me,
                    quantity=var, unit_cost=avg, value=q2(var * avg),
                    reason='Month-end dip variance vs book', status='PENDING' if late else 'APPROVED',
                    created_by=self.u['depot'])
                self.approval(ke, adjustment, 'StockAdjustment', abs(adjustment.value), adjustment.reference,
                              self.u['depot'], self.u['ops'], 'PENDING' if late else 'APPROVED', me)
                status = 'PENDING_ADJUSTMENT'
                if not late:
                    ad = max(me, self.last_move[tank.id])
                    mt = 'ADJ_IN' if var > 0 else 'ADJ_OUT'
                    _, tot = self.move(ad, mt, tank, abs(var), avg, ref=adjustment.reference,
                                       src=('StockAdjustment', adjustment.id), narration=adjustment.reason,
                                       user=self.u['ops'])
                    self.post(ke, ad, f'Stock adjustment {adjustment.reference}', [
                        ('INVENTORY_LOSS', tot, 0), ('INVENTORY', 0, tot)] if var < 0 else [
                        ('INVENTORY', tot, 0), ('INVENTORY_LOSS', 0, tot)],
                        ('StockAdjustment', adjustment.id), user=self.u['ops'])
                    status = 'ADJUSTED'
            M.TankReconciliation.objects.create(
                company=ke, reference=self.ref(ke, 'TRC'), tank=tank, product=prod, recon_date=me,
                opening_qty=opening, receipts=rec, issues=iss, adjustments=adj, closing_book=closing,
                physical_qty=phys, variance=var, variance_value=q2(var * avg), officer=self.u['depot'],
                adjustment=adjustment, status=status, created_by=self.u['depot'])

    # ================================================================== monthly: payroll, depreciation, overheads
    def paye(self, taxable):
        tax, prev = D0, D0
        for b in self.paye_brackets:
            up = D(str(b['up_to'])) if b['up_to'] is not None else None
            top = taxable if up is None else min(taxable, up)
            if top > prev:
                tax += (top - prev) * D(str(b['rate'])) / 100
            if up is None or taxable <= up:
                break
            prev = up
        return max(q2(tax - D('2400')), D0)

    def s_monthly_cycles(self):
        ke, T = self.ke, self.today
        assets = list(M.FixedAsset.objects.filter(company=ke))
        ms = date(self.start.year, self.start.month, 1)
        for me in self.months:
            ms = date(me.year, me.month, 1)
            done = me < T
            # payroll
            run = M.PayrollRun.objects.create(company=ke, reference=self.ref(ke, 'PRN'), period_start=ms,
                                              period_end=me, status='DRAFT', created_by=self.u['finance'])
            tg = td = tn = te = D0
            for e in self.employees:
                allow = sum((D(str(a['amount'])) for a in e.allowances), D0)
                ot = D(self.rnd.randint(0, 12) * 1000) if e.is_driver else D0
                gross = e.basic_salary + allow + ot
                nssf = min(q2(gross * D('0.06')), D('6480'))
                shif = max(q2(gross * D('0.0275')), D('300'))
                ahl = q2(gross * D('0.015'))
                paye = self.paye(gross - nssf - shif - ahl)
                ded = nssf + shif + ahl + paye
                er = {'NSSF': str(nssf), 'AHL': str(ahl)}
                M.Payslip.objects.create(
                    run=run, employee=e, basic=e.basic_salary, allowances=allow, overtime=ot, gross=gross,
                    deductions={'PAYE': str(paye), 'NSSF': str(nssf), 'SHIF': str(shif), 'AHL': str(ahl)},
                    total_deductions=ded, employer_contributions=er, total_employer=nssf + ahl, net_pay=gross - ded)
                tg, td, tn, te = tg + gross, td + ded, tn + gross - ded, te + nssf + ahl
            upd(run, total_gross=tg, total_deductions=td, total_net=tn, total_employer_cost=tg + te)
            if done:
                j = self.post(ke, me, f'Payroll {me:%B %Y}', [
                    ('SALARIES', tg + te, 0), ('BANK', 0, tn), ('PAYROLL_LIABILITY', 0, td + te)],
                    ('PayrollRun', run.id), user=self.u['finance'])
                upd(run, journal=j, status='POSTED')
                # depreciation (one journal per month, one row per asset)
                dep = {a.id: q2((a.cost - a.salvage_value) / a.useful_life_months) for a in assets}
                dj = self.post(ke, me, f'Depreciation {me:%B %Y}', [
                    ('DEPRECIATION', sum(dep.values(), D0), 0), ('ACCUM_DEP', 0, sum(dep.values(), D0))],
                    ('Depreciation', me.isoformat()))
                M.AssetDepreciation.objects.bulk_create([
                    M.AssetDepreciation(company=ke, asset=a, period_end=me, amount=dep[a.id], journal=dj)
                    for a in assets])
                for a in assets:
                    a.accumulated_depreciation += dep[a.id]
            # overheads
            S = self.start
            for dd, cat, desc, amt, payee, vat in [
                (ms, 'ADMIN', f'Office rent {me:%b %Y} - Kipevu Road, Mombasa', D('380000'), 'Nyali Plaza Properties Ltd', 0),
                (ms + timedelta(days=4), 'ADMIN', f'Electricity & water {me:%b %Y}', D(self.rnd.randint(85, 140) * 1000),
                 'Kenya Power / Mombasa Water', 0),
                (ms + timedelta(days=7), 'ADMIN', f'Internet & telephone {me:%b %Y}', D('62000'), 'Safaricom Business', 16),
                (me, 'BANK-CHG', f'Bank charges & SMS alerts {me:%b %Y}', D(self.rnd.randint(25, 60) * 1000),
                 'Equity Bank Kenya', 0)]:
                if dd >= S:
                    self.expense(dd, cat, desc, amt, payee=payee, tax_rate=D(vat), method='BANK')
            if me.month in (3, 6, 9, 12) and ms + timedelta(days=14) >= S:
                self.expense(ms + timedelta(days=14), 'ADMIN', f'Audit & tax advisory retainer Q{(me.month - 1) // 3 + 1}',
                             D('150000'), payee='Mwangi & Associates, CPA', tax_rate=D('16'))
            for v in self.vehicles:
                dd = ms + timedelta(days=self.rnd.randint(8, 24))
                if self.rnd.random() < 0.3 and S <= dd <= T:
                    cost = D(self.rnd.randint(18, 160) * 1000)
                    mt = self.rnd.choice(['SERVICE', 'REPAIR', 'TYRES', 'INSPECTION'])
                    e = self.expense(dd, 'VEH-MAINT', f'{mt.title()} - {v.registration_number}', cost, vehicle=v,
                                     payee='Mombasa Truck Centre Ltd', owner='OWNED', tax_rate=D('16'))
                    M.VehicleMaintenance.objects.create(
                        company=ke, vehicle=v, maintenance_type=mt, maintenance_date=dd,
                        description=f'{mt.title()} for {v.registration_number}', cost=cost, currency=self.KES,
                        odometer_km=self.odo[v.id], next_due_date=dd + timedelta(days=90), vendor='Mombasa Truck Centre Ltd',
                        expense=e)
        for a in assets:
            upd(a, accumulated_depreciation=a.accumulated_depreciation)

    # ================================================================== intercompany + consolidation
    def s_intercompany(self):
        ke, cd, T = self.ke, self.cd, self.today
        fees = [(add_months(T, -5), D('18500')), (add_months(T, -3), D('18500')), (add_months(T, -1), D('21200'))]
        outstanding = D0
        fee_rows = []
        for i, (d, usd) in enumerate(fees, 1):
            d = max(d, self.start + timedelta(days=5))
            r = self.rate_usd(d)
            kes = q2(usd * r)
            fj = self.post(ke, d, 'Group sourcing & logistics service fee', [
                ('IC_RECEIVABLE', kes, 0, dict(currency=self.USD, foreign_amount=usd, exchange_rate=r)),
                ('OTHER_INCOME', 0, kes)], ('IntercompanyTransaction', i))
            tj = self.post(cd, d, 'Group sourcing & logistics service fee - Dalmar Petroleum Kenya', [
                ('EXP_ADMIN', usd, 0), ('IC_PAYABLE', 0, usd)], ('IntercompanyTransaction', i),
                user=self.u['drc_finance'])
            ic = M.IntercompanyTransaction.objects.create(
                reference=f'ICT-{d.year}-{i:04d}', txn_type='SERVICE', from_company=ke, to_company=cd, txn_date=d,
                quantity=D0, transfer_price=D0, currency=self.USD, amount=usd, seller_rate=r, buyer_rate=D('1'),
                from_journal=fj, to_journal=tj, status='POSTED', notes='Monthly sourcing & logistics support',
                created_by=self.u['finance'])
            fee_rows.append((ic, usd, d))
        # settle the first fully, the second partly
        for (ic, usd, d), share in zip(fee_rows[:2], (D('1'), D('0.5'))):
            amt = q2(usd * share)
            sd = d + timedelta(days=35)
            if sd > T:
                continue
            rp, ri = self.rate_usd(sd), ic.seller_rate
            dr_bank, cr_ic = q2(amt * rp), q2(amt * ri)
            diff = dr_bank - cr_ic
            lines = [('BANK_USD', dr_bank, 0, dict(currency=self.USD, foreign_amount=amt, exchange_rate=rp)),
                     ('IC_RECEIVABLE', 0, cr_ic, dict(currency=self.USD, foreign_amount=amt, exchange_rate=ri))]
            lines.append(('FX_GAIN', 0, diff) if diff > 0 else ('FX_LOSS', -diff, 0))
            fj = self.post(ke, sd, f'Intercompany settlement {ic.reference}', lines, ('IntercompanyTransaction', ic.id))
            tj = self.post(cd, sd, f'Intercompany settlement {ic.reference}', [
                ('IC_PAYABLE', amt, 0), ('BANK_USD', 0, amt)], ('IntercompanyTransaction', ic.id),
                user=self.u['drc_finance'])
            M.IntercompanyTransaction.objects.create(
                reference=f'{ic.reference}-S', txn_type='SETTLEMENT', from_company=ke, to_company=cd, txn_date=sd,
                currency=self.USD, amount=amt, seller_rate=rp, buyer_rate=D('1'), from_journal=fj, to_journal=tj,
                status='SETTLED', notes=f'Settlement of {ic.reference}', created_by=self.u['finance'])
            upd(ic, settled_amount=amt, status='SETTLED' if amt >= usd else 'PART_SETTLED')
            ic.settled_amount = amt
        outstanding = sum((ic.amount - ic.settled_amount for ic, _, _ in fee_rows), D0)
        asof = self.today
        M.IntercompanyBalance.objects.create(company=ke, counterparty=cd, currency=self.USD, receivable=outstanding,
                                             payable=D0, gl_receivable=outstanding, gl_payable=D0, difference=D0,
                                             as_of_date=asof)
        M.IntercompanyBalance.objects.create(company=cd, counterparty=ke, currency=self.USD, receivable=D0,
                                             payable=outstanding, gl_receivable=D0, gl_payable=outstanding,
                                             difference=D0, as_of_date=asof)
        if self.last_completed:
            me = self.last_completed
            run = M.ConsolidationRun.objects.create(
                reference=f'CON-{me:%Y-%m}', period_start=date(me.year, me.month, 1), period_end=me,
                reporting_currency=self.USD, status='COMPLETED', created_by=self.u['finance'],
                result={'entities': ['DPK', 'DPC'], 'eliminations': 2, 'ic_outstanding_usd': str(outstanding),
                        'note': 'Sample consolidation - translation at CBK closing rate.'})
            M.EliminationJournal.objects.create(run=run, entry_no=1, description='Eliminate IC receivable/payable',
                                                account_group_code='IC_PAYABLE', debit=outstanding, credit=D0)
            M.EliminationJournal.objects.create(run=run, entry_no=1, description='Eliminate IC receivable/payable',
                                                account_group_code='IC_RECEIVABLE', debit=D0, credit=outstanding)
            M.EliminationJournal.objects.create(run=run, entry_no=2, description='Eliminate IC service fee income/expense',
                                                account_group_code='OTHER_INCOME', debit=fees[-1][1], credit=D0)
            M.EliminationJournal.objects.create(run=run, entry_no=2, description='Eliminate IC service fee income/expense',
                                                account_group_code='EXP_ADMIN', debit=D0, credit=fees[-1][1])

    # ================================================================== bank recon, alerts, balances
    def s_closing_touches(self):
        ke, T = self.ke, self.today
        # persist stock balances & FIFO layers
        bal_rows, layer_rows = [], []
        for key, t in self.tank_list:
            q, v = self.bal[t.id]
            bal_rows.append(M.StockBalance(company=ke, tank=t, product=t.product, quantity=q, value=v))
            for ld, rem, cost in self.layers[t.id]:
                if rem > 0:
                    layer_rows.append(M.StockLayer(company=ke, tank=t, product=t.product, received_date=ld,
                                                   remaining_qty=rem, unit_cost=cost))
        M.StockBalance.objects.bulk_create(bal_rows)
        M.StockLayer.objects.bulk_create(layer_rows)
        # vehicle status / odometer
        for i, v in enumerate(self.vehicles):
            st = 'ON_TRIP' if self.busy[v.id] >= T else 'AVAILABLE'
            if i == len(self.vehicles) - 1 and st == 'AVAILABLE':
                st = 'MAINTENANCE'
            upd(v, odometer_km=self.odo[v.id], status=st)
            upd(v.trailer, status='ON_TRIP' if st == 'ON_TRIP' else 'AVAILABLE')
        # bank statement lines (last 45 days) + reconciliations
        pays = M.Payment.objects.filter(company=ke, payment_date__gte=T - timedelta(days=45), status='POSTED')
        for p in pays:
            M.BankTransaction.objects.create(
                company=ke, bank_account=p.bank_account, txn_date=p.payment_date, description=p.narration,
                reference=p.bank_reference or p.reference, money_in=p.amount if p.direction == 'RECEIPT' else D0,
                money_out=p.amount if p.direction == 'PAYMENT' else D0, batch=f'STMT-{T:%Y-%m}',
                matched_payment=p, status='MATCHED')
        eq = self.banks[(ke.id, 'BANK')]
        for k, (desc, amt) in enumerate([('SMS alert charges', 1850), ('Excise duty on bank fees', 420),
                                          ('Unidentified deposit - ref 77421', 150000)]):
            M.BankTransaction.objects.create(
                company=ke, bank_account=eq, txn_date=T - timedelta(days=3 + k), description=desc,
                reference=f'STMT{self.rnd.randint(10000, 99999)}', money_in=D(amt) if k == 2 else D0,
                money_out=D0 if k == 2 else D(amt), batch=f'STMT-{T:%Y-%m}', status='UNMATCHED')
        for back, st in ((2, 'RECONCILED'), (1, 'OPEN')):
            sd = month_end(add_months(T.replace(day=1), -back))
            if sd < self.start:
                continue
            agg = M.JournalLine.objects.filter(account=eq.gl_account, journal__date__lte=sd).aggregate(
                d=Sum('debit'), c=Sum('credit'))
            book = (agg['d'] or D0) - (agg['c'] or D0)
            diff = D0 if st == 'RECONCILED' else D('150000')
            M.BankReconciliation.objects.create(
                company=ke, reference=self.ref(ke, 'BRC'), bank_account=eq, statement_date=sd,
                statement_balance=book + diff, book_balance=book, difference=diff,
                unmatched_count=0 if diff == 0 else 3, notes='' if diff == 0 else 'Unidentified deposit pending',
                status=st, created_by=self.u['accountant'])
        # alerts & notifications (inform only - never approve/post)
        for key, t in self.tank_list:
            q = self.bal[t.id][0]
            if q < t.min_level * D('1.5'):
                M.Alert.objects.create(company=ke, kind='LOW_STOCK', severity='WARNING' if q >= t.min_level else 'CRITICAL',
                                       message=f'{t.code} ({t.product.code}) at {q:,.0f} L vs minimum {t.min_level:,.0f} L',
                                       data={'tank': t.code, 'qty': str(q)})
        for v in self.vehicles:
            if v.insurance_expiry and (v.insurance_expiry - T).days <= 45:
                M.Alert.objects.create(company=ke, kind='INSURANCE_EXPIRY', severity='WARNING',
                                       message=f'Insurance for {v.registration_number} expires {v.insurance_expiry}',
                                       data={'vehicle': v.registration_number})
        for dr in self.drivers:
            if dr.licence_expiry and (dr.licence_expiry - T).days <= 60:
                M.Alert.objects.create(company=ke, kind='LICENCE_EXPIRY', severity='WARNING',
                                       message=f'Driving licence for {dr.full_name} expires {dr.licence_expiry}',
                                       data={'driver': dr.full_name})
        for inv in M.SalesInvoice.objects.filter(company=ke, status__in=['POSTED', 'PART_PAID'], due_date__lt=T):
            M.Alert.objects.create(company=ke, kind='OVERDUE_INVOICE', severity='WARNING',
                                   message=f'{inv.reference} overdue since {inv.due_date} - USD {inv.total - inv.amount_paid:,.2f} outstanding',
                                   data={'invoice': inv.reference, 'customer': inv.customer.name})
        for d in M.ShipmentDelivery.objects.filter(company=ke, status='PENDING_APPROVAL'):
            M.Alert.objects.create(company=ke, kind='SHORTAGE_OVER_TOLERANCE', severity='CRITICAL',
                                   message=f'{d.shipment.reference}: shortage {d.shortage_pct}% exceeds tolerance',
                                   data={'shipment': d.shipment.reference})
        for uname, title, msg, lvl in [
                ('finance', 'Approvals waiting', 'Delivery shortage and stock adjustment need your approval.', 'WARNING'),
                ('ops', 'Upcoming loading', 'Three shipments are scheduled for loading this week.', 'INFO'),
                ('depot', 'Tank variance pending', 'A month-end variance is awaiting adjustment approval.', 'WARNING'),
                ('accountant', 'Bank reconciliation open', 'Last month\'s Equity KES reconciliation is still open.', 'INFO')]:
            M.Notification.objects.create(user=self.u[uname], company=ke, title=title, message=msg, level=lvl,
                                          link='/dashboard')

    def s_sequences(self):
        rows = []
        for (co_id, typ), n in self.counters.items():
            rows.append(M.NumberSequence(company_id=co_id, doc_type=typ, prefix=typ, padding=5, next_number=n + 1))
        M.NumberSequence.objects.bulk_create(rows)

    # ================================================================== summary
    def report(self):
        out = self.stdout.write
        out(self.style.SUCCESS(f'\nSeeded {self.opts["months"]} months of data: {self.start} -> {self.today}'))
        for label, mdl in [('Shipments', M.Shipment), ('Sales orders', M.SalesOrder), ('Sales invoices', M.SalesInvoice),
                           ('Purchase orders', M.PurchaseOrder), ('Goods receipts', M.GoodsReceipt),
                           ('Payments', M.Payment), ('Expenses', M.Expense), ('Stock movements', M.StockMovement),
                           ('Journals', M.Journal), ('Journal lines', M.JournalLine), ('Payroll runs', M.PayrollRun),
                           ('Tank reconciliations', M.TankReconciliation), ('Audit log rows', M.AuditLog)]:
            out(f'  {label:<22}{mdl.objects.count():>7}')
        out('\nLogins (password for ALL users: password123)')
        for uname, u in self.u.items():
            out(f'  {uname:<14} {u.get_full_name()}')