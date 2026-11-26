"""
PetroERP permission + role seeder  (single source of truth)
============================================================

Put this file at:   backend/api/management/commands/seed_permissions.py
(api/management/ and api/management/commands/ each need an empty __init__.py)

It does four things:
  1. CATALOGUE   every permission code the API, the sidebar and the services use, with a description
  2. ROLES       which role gets which codes (the Dalmar guide roles + the older roles, upgraded)
  3. --assign    put a user on a role (and a legal entity) without opening the shell
  4. --report    show, per user, exactly which sidebar items they will get and why others are hidden

Usage
-----
    python manage.py seed_permissions                       create what is missing (additive, safe to re-run)
    python manage.py seed_permissions --sync                make each role EXACTLY match this file (removes stale codes)
    python manage.py seed_permissions --dry-run             show the changes, save nothing
    python manage.py seed_permissions --assign ops=OPS_MANAGER:DPK
    python manage.py seed_permissions --report ops          sidebar for one user  (add -v 2 to list hidden items)
    python manage.py seed_permissions --report              sidebar for every user
    python manage.py seed_permissions --no-seed --report    report only, change nothing

How permissions are checked (views.py)
--------------------------------------
  * ModulePermission: GET needs <module>.view, any write needs <module>.edit, unless a perm_map entry says otherwise.
  * navigation.js hides sidebar items by the same codes. The sidebar is convenience, the API is the security check.
  * Approvals, Notifications and Profile have no sidebar permission, but the approvals API needs approvals.view,
    so EVERY role below is given approvals.view (COMMON).

views.py lines that must match this file (otherwise a page shows in the sidebar but its API returns 403):
    reg('purchase-requisitions', m.PurchaseRequisition, 'requisitions', ... perm_map={... 'requisitions.create' ...})
    PurchaseOrderViewSet  perm_map -> procurement.create for writes, 'receive': 'receipts.create'
    reg('goods-receipts', m.GoodsReceipt, 'receipts', readonly=True, date_field='receipt_date')

Do NOT also run services.seed_roles(): it overwrites roles with the old matrix. This command replaces it.
"""
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from api.models import Company, Permission, Role, User


# =====================================================================================================
# 1. CATALOGUE:  module -> (title, {action: what it allows})      code = "<module>.<action>"
# =====================================================================================================
CATALOGUE = {
    'admin': ('Administration', {
        'view': 'See users, roles and system settings',
        'edit': 'Create and change users',
    }),
    'company': ('Company setup', {
        'view': 'See companies, structure, taxes, currencies and policies',
        'edit': 'Change companies, taxes, currencies, exchange rates and approval policies',
    }),
    'finance': ('Finance and ledger', {
        'view': 'See accounts, journals, fiscal years, mappings and financial reports',
        'edit': 'Change the chart of accounts and account mappings',
        'post': 'Post and reverse journals, run depreciation and payroll',
        'close_period': 'Close periods and fiscal years, run FX revaluation',
    }),
    'suppliers': ('Suppliers', {
        'view': 'See suppliers, contracts, prices and quotations',
        'edit': 'Create and change suppliers, contracts, prices and quotations',
    }),
    'requisitions': ('Purchase requisitions', {
        'view': 'See purchase requisitions',
        'create': 'Raise, edit and submit a purchase requisition',
        'approve': 'Approve or reject a purchase requisition',
    }),
    'procurement': ('Procurement', {
        'view': 'See purchase orders, supplier invoices and returns',
        'edit': 'Create and change supplier invoices, credit notes and returns',
        'create': 'Create purchase orders and convert requisitions',
        'approve': 'Approve purchase orders above the policy limit',
        'override_match': 'Post a supplier invoice that failed the three-way match',
    }),
    'receipts': ('Goods receipts', {
        'view': 'See goods receipts',
        'create': 'Record a goods receipt against a purchase order',
    }),
    'inventory': ('Inventory', {
        'view': 'See products, tanks, depots, stock and reconciliations',
        'edit': 'Record tank readings, transfers, opening stock and reconciliations',
        'adjust': 'Raise stock adjustments from reconciliation variances',
    }),
    'customers': ('Customers', {
        'view': 'See customers, contacts and customer contracts',
        'edit': 'Create and change customers, contacts and customer contracts',
    }),
    'sales': ('Sales', {
        'view': 'See quotations, orders, invoices, credit notes and pricing',
        'edit': 'Create and change quotations, orders, invoices and credit notes',
        'below_margin': 'Sell below the minimum approved margin',
    }),
    'credit': ('Credit control', {
        'override': 'Override a customer credit limit',
    }),
    'fleet': ('Fleet', {
        'view': 'See vehicles, drivers, maintenance and vehicle expenses',
        'edit': 'Create and change vehicles, drivers and maintenance, log vehicle expenses',
    }),
    'transport': ('Third-party transport', {
        'view': 'See transporters, rates, bookings and transporter invoices',
        'edit': 'Create and change transporters, rates, bookings and transporter invoices',
    }),
    'shipments': ('Shipments', {
        'view': 'See shipments, timelines and deliveries',
        'edit': 'Create shipments, update status, record loading and deliveries',
    }),
    'costing': ('Shipment costing', {
        'view': 'See shipment cost sheets and profitability',
        'edit': 'Allocate expenses to shipments and compute cost sheets',
        'finalize': 'Finalise or reopen a shipment cost sheet',
    }),
    'customs': ('Customs and compliance', {
        'view': 'See border crossings, declarations and compliance checks',
        'edit': 'Create and change export declarations and compliance checks',
    }),
    'expenses': ('Expenses', {
        'view': 'See expenses and expense categories',
        'edit': 'Create, change, post and allocate expenses',
    }),
    'payments': ('Payments and banking', {
        'view': 'See payments, bank accounts, statements and reconciliations',
        'edit': 'Create payments and receipts, import statements, reconcile banks',
        'execute': 'Execute an approved payment (separate from approving it)',
        'approve': 'Approve a payment',
    }),
    'assets': ('Fixed assets', {
        'view': 'See fixed assets and depreciation',
        'edit': 'Create and change fixed assets',
    }),
    'hr': ('Payroll and HR', {
        'view': 'See employees, leave and payroll runs',
        'edit': 'Create and change employees, leave and payroll runs',
    }),
    'group': ('Group accounting', {
        'view': 'See intercompany transactions and consolidation',
        'edit': 'Create intercompany sales, settle them, run consolidation',
    }),
    'approvals': ('Approvals', {
        'view': 'Open the approvals page and see approval requests',
        'decide': 'Approve or reject approval requests',
    }),
    'audit': ('Audit', {
        'view': 'See the audit log and verify its integrity',
    }),
    'ai': ('AI insights', {
        'view': 'Use the AI assistant, forecasts and alerts',
        'edit': 'Run the AI scan that creates alerts',
    }),
    'reports': ('Reports and dashboard', {
        'view': 'Open the dashboard and operational reports',
    }),
}

PERMISSIONS = {f'{mod}.{act}': f'{title}: {what}'
               for mod, (title, acts) in CATALOGUE.items() for act, what in acts.items()}
ALL_CODES = sorted(PERMISSIONS)
ALL_VIEW = [c for c in ALL_CODES if c.endswith('.view')]


# =====================================================================================================
# 2. ROLES
# =====================================================================================================
def view(*mods):
    """<module>.view for each module."""
    return [f'{x}.view' for x in mods]


def edit(*mods):
    """<module>.view + <module>.edit for each module."""
    return [f'{x}.{a}' for x in mods for a in ('view', 'edit')]


COMMON = ['approvals.view']        # every role: the Approvals page and the badge need it


ROLES = {
    # ------------------------------------------------------------------ the guide roles
    'GROUP_ADMIN': dict(
        name='Group Administrator',
        perms=ALL_CODES,                                   # User.has_perm_code() is True anyway
    ),
    # Raises the fuel need and runs trips. Cannot choose supplier or price, cannot pay.
    'OPS_MANAGER': dict(
        name='Operations manager',
        perms=view('reports', 'requisitions', 'shipments', 'fleet', 'customs', 'transport',
                   'customers', 'sales', 'inventory', 'expenses') + ['requisitions.create'],
    ),
    # Sources and orders. Cannot raise its own requisition or pay.
    'PROCUREMENT': dict(
        name='Procurement',
        perms=view('reports', 'suppliers', 'requisitions', 'procurement', 'receipts',
                   'inventory')                            # inventory.view: product and tank pickers on PO / receipt forms
        + ['suppliers.edit', 'procurement.create'],
    ),
    # Pays, invoices, sets exchange rates. Closing periods is Owner-only in the guide:
    # add 'finance.close_period' here if Finance should close the books too.
    'FINANCE': dict(
        name='Finance',
        perms=view('reports', 'company', 'finance', 'expenses', 'payments', 'suppliers', 'procurement',
                   'receipts', 'customers', 'sales', 'transport', 'assets', 'hr', 'costing')
        + ['finance.edit', 'finance.post', 'expenses.edit', 'payments.edit', 'payments.execute',
           'procurement.edit',                             # supplier invoices
           'company.edit'],                                # exchange rates (also lets Finance edit companies and taxes)
    ),
    'CLEARING': dict(
        name='Clearing / admin officer',
        perms=view('shipments', 'customs', 'expenses') + ['customs.edit'],
    ),
    'WORKSHOP': dict(
        name='Workshop / fleet officer',
        perms=view('fleet', 'expenses') + ['fleet.edit'],
    ),
    # If the receipt form's purchase-order dropdown returns 403, add 'procurement.view' (it shows PO prices).
    'DEPOT_OFFICER': dict(
        name='Depot officer',
        perms=view('inventory', 'receipts') + ['inventory.edit', 'receipts.create'],
    ),
    # Approves and sees everything except user administration.
    'OWNER': dict(
        name='Owner / MD',
        perms=view('reports', 'company', 'finance', 'audit', 'suppliers', 'requisitions', 'procurement', 'receipts',
                   'inventory', 'customers', 'sales', 'shipments', 'customs', 'fleet', 'transport', 'expenses',
                   'payments', 'assets', 'hr', 'group', 'ai', 'costing')
        + ['finance.close_period', 'requisitions.approve', 'procurement.approve', 'approvals.decide'],
    ),

    # ------------------------------------------------------------------ older roles, upgraded to the new codes
    'MD': dict(
        name='Managing Director',
        perms=ALL_VIEW + ['approvals.decide', 'payments.approve', 'requisitions.approve', 'procurement.approve', 'ai.edit'],
    ),
    'KE_FINANCE_MANAGER': dict(
        name='Kenya Finance Manager',
        perms=edit('finance', 'payments', 'expenses', 'costing', 'assets', 'hr', 'ai', 'company')
        + view('reports', 'suppliers', 'procurement', 'inventory', 'shipments', 'group', 'transport', 'fleet',
               'receipts', 'requisitions')
        + ['approvals.decide', 'payments.approve', 'payments.execute', 'finance.post', 'finance.close_period',
           'costing.finalize'],
    ),
    'DRC_FINANCE_MANAGER': dict(
        name='DRC Finance Manager',
        perms=edit('finance', 'payments', 'expenses', 'costing', 'assets', 'hr', 'ai', 'customers')
        + view('reports', 'sales', 'inventory', 'shipments', 'group')
        + ['approvals.decide', 'payments.approve', 'payments.execute', 'finance.post', 'finance.close_period',
           'costing.finalize', 'credit.override'],
    ),
    'ACCOUNTANT': dict(
        name='Accountant',
        perms=edit('finance', 'expenses', 'payments', 'costing')
        + view('reports', 'suppliers', 'customers', 'procurement', 'sales', 'shipments', 'inventory', 'receipts')
        + ['finance.post', 'payments.execute'],
    ),
    'PROCUREMENT_MANAGER': dict(
        name='Procurement Manager',
        perms=edit('suppliers', 'procurement', 'inventory')
        + view('reports', 'shipments', 'requisitions', 'receipts')
        + ['approvals.decide', 'procurement.override_match', 'procurement.create', 'procurement.approve',
           'receipts.create'],
    ),
    'PROCUREMENT_OFFICER': dict(
        name='Procurement Officer',
        perms=edit('suppliers', 'procurement') + view('inventory', 'requisitions', 'receipts')
        + ['procurement.create'],
    ),
    'SALES_MANAGER': dict(
        name='Sales Manager',
        perms=edit('customers', 'sales') + view('shipments', 'inventory', 'reports', 'costing')
        + ['approvals.decide', 'sales.below_margin', 'credit.override'],
    ),
    'SALES_OFFICER': dict(
        name='Sales Officer',
        perms=edit('customers', 'sales') + view('inventory', 'shipments', 'reports'),
    ),
    'FLEET_MANAGER': dict(
        name='Fleet Manager',
        perms=edit('fleet', 'transport', 'expenses', 'shipments') + view('inventory', 'reports'),
    ),
    'LOGISTICS_MANAGER': dict(
        name='Logistics Manager',
        perms=edit('shipments', 'customs', 'transport', 'fleet', 'expenses')
        + view('inventory', 'procurement', 'sales', 'reports', 'costing', 'requisitions')
        + ['approvals.decide'],
    ),
    'STORE_MANAGER': dict(
        name='Store Manager',
        perms=edit('inventory') + view('procurement', 'shipments', 'receipts', 'reports')
        + ['inventory.adjust', 'receipts.create'],
    ),
    'CASHIER': dict(
        name='Cashier',
        perms=edit('payments') + view('customers', 'finance'),
    ),
    'INTERNAL_AUDITOR': dict(
        name='Internal Auditor',
        perms=ALL_VIEW,
    ),
    'READONLY_MANAGER': dict(
        name='Read-only Manager',
        perms=view('suppliers', 'procurement', 'inventory', 'customers', 'sales', 'fleet', 'transport',
                   'shipments', 'reports', 'requisitions', 'receipts'),
    ),
}


# =====================================================================================================
# 3. SIDEBAR (mirror of navigation.js, used only by --report).   (group, label, permission or None)
# =====================================================================================================
NAV = [
    ('', 'Dashboard', 'reports.view'),
    ('Administration', 'Companies', 'company.view'),
    ('Administration', 'Structure', 'company.view'),
    ('Administration', 'Fiscal years', 'finance.view'),
    ('Administration', 'Taxes', 'company.view'),
    ('Administration', 'Currencies', 'company.view'),
    ('Administration', 'Account mappings', 'finance.view'),
    ('Administration', 'Policies', 'company.view'),
    ('Administration', 'Users', 'admin.view'),
    ('Administration', 'Audit log', 'audit.view'),
    ('Procurement', 'Requisitions', 'requisitions.view'),
    ('Procurement', 'Suppliers', 'suppliers.view'),
    ('Procurement', 'Contracts', 'suppliers.view'),
    ('Procurement', 'Purchase orders', 'procurement.view'),
    ('Procurement', 'Goods receipts', 'receipts.view'),
    ('Procurement', 'Purchase invoices', 'procurement.view'),
    ('Procurement', 'Returns', 'procurement.view'),
    ('Inventory', 'Products', 'inventory.view'),
    ('Inventory', 'Tanks & depots', 'inventory.view'),
    ('Inventory', 'Stock', 'inventory.view'),
    ('Inventory', 'Adjustments', 'inventory.view'),
    ('Inventory', 'Reconciliation', 'inventory.view'),
    ('Sales', 'Customers', 'customers.view'),
    ('Sales', 'Contracts', 'sales.view'),
    ('Sales', 'Pricing', 'sales.view'),
    ('Sales', 'Sales orders', 'sales.view'),
    ('Sales', 'Sales invoices', 'sales.view'),
    ('Sales', 'Credit notes', 'sales.view'),
    ('Logistics', 'Shipments', 'shipments.view'),
    ('Logistics', 'Customs', 'customs.view'),
    ('Logistics', 'Vehicles', 'fleet.view'),
    ('Logistics', 'Drivers', 'fleet.view'),
    ('Logistics', 'Maintenance', 'fleet.view'),
    ('Logistics', 'Transporters', 'transport.view'),
    ('Logistics', 'Bookings', 'transport.view'),
    ('Logistics', 'Transporter invoices', 'transport.view'),
    ('Finance', 'Expenses', 'expenses.view'),
    ('Finance', 'Payments', 'payments.view'),
    ('Finance', 'Bank', 'payments.view'),
    ('Finance', 'Accounts', 'finance.view'),
    ('Finance', 'Journals', 'finance.view'),
    ('Finance', 'Fixed assets', 'assets.view'),
    ('Finance', 'Payroll', 'hr.view'),
    ('Group', 'Intercompany', 'group.view'),
    ('Group', 'Consolidation', 'group.view'),
    ('Group', 'FX revaluation', 'finance.close_period'),
    ('Intelligence', 'Reports', 'reports.view'),
    ('Intelligence', 'AI assistant', 'ai.view'),
    ('', 'Approvals', None),
    ('', 'Notifications', None),
    ('', 'Profile', None),
]


def _validate():
    """Catch typos before anything is written."""
    known = set(PERMISSIONS)
    for code, spec in ROLES.items():
        bad = sorted(set(spec['perms']) - known)
        if bad:
            raise CommandError(f'Role {code} uses unknown permission codes: {", ".join(bad)}')
    bad = sorted({p for _, _, p in NAV if p and p not in known})
    if bad:
        raise CommandError(f'NAV uses unknown permission codes: {", ".join(bad)}')
    bad = sorted(set(COMMON) - known)
    if bad:
        raise CommandError(f'COMMON uses unknown permission codes: {", ".join(bad)}')


class Command(BaseCommand):
    help = 'Seed permissions and roles, assign users to roles, and report who sees which sidebar items.'

    def add_arguments(self, parser):
        parser.add_argument('--sync', action='store_true',
                            help='Make each managed role EXACTLY match this file (removes codes not listed).')
        parser.add_argument('--dry-run', action='store_true', help='Show the changes but save nothing.')
        parser.add_argument('--assign', action='append', default=[], metavar='USER=ROLE[:COMPANY]',
                            help='Put a user on a role, optionally adding a legal entity. Repeatable.')
        parser.add_argument('--report', nargs='?', const='*', metavar='USER',
                            help='Show the sidebar each user (or one user) will get.')
        parser.add_argument('--no-seed', action='store_true', help='Skip seeding; only assign/report.')

    @transaction.atomic
    def handle(self, *args, **opts):
        _validate()
        if not opts['no_seed']:
            self._seed_permissions()
            self._seed_roles(opts['sync'])
        for spec in opts['assign']:
            self._assign(spec)
        if opts['report'] is not None:
            self._report(opts['report'], opts['verbosity'])
        if opts['dry_run']:
            transaction.set_rollback(True)
            self.stdout.write(self.style.WARNING('\nDry run: nothing was saved.'))

    # ------------------------------------------------------------------ permissions
    def _seed_permissions(self):
        existing = {p.code: p for p in Permission.objects.all()}
        created = updated = 0
        for code in ALL_CODES:
            desc = PERMISSIONS[code][:200]
            obj = existing.get(code)
            if obj is None:
                Permission.objects.create(code=code, description=desc)
                created += 1
            elif obj.description != desc:
                obj.description = desc
                obj.save(update_fields=['description'])
                updated += 1
        self.stdout.write(self.style.SUCCESS(
            f'Permissions: {created} created, {updated} descriptions refreshed, {len(ALL_CODES)} in catalogue.'))
        extra = sorted(set(existing) - set(PERMISSIONS))
        if extra:
            self.stdout.write(f'  Not in the catalogue (left alone, no view or API uses them): {", ".join(extra)}')

    # ------------------------------------------------------------------ roles
    def _seed_roles(self, sync):
        by_code = {p.code: p for p in Permission.objects.all()}
        self.stdout.write('\nRoles:')
        for code, spec in ROLES.items():
            wanted = set(ALL_CODES) if code == 'GROUP_ADMIN' else set(spec['perms']) | set(COMMON)
            role, made = Role.objects.get_or_create(code=code, defaults={'name': spec['name']})
            if sync and not made and role.name != spec['name']:
                role.name = spec['name']
                role.save(update_fields=['name'])
            have = set(role.permissions.values_list('code', flat=True))
            add = wanted - have
            drop = (have - wanted) if sync else set()
            if add:
                role.permissions.add(*[by_code[c] for c in add])
            if drop:
                role.permissions.remove(*Permission.objects.filter(code__in=drop))
            state = 'created' if made else 'updated' if (add or drop) else 'unchanged'
            self.stdout.write(f'  {code:<22} {state:<10} +{len(add)} -{len(drop)}  ({len(wanted)} permissions)')
        unmanaged = Role.objects.exclude(code__in=ROLES).values_list('code', 'name')
        for rcode, rname in unmanaged:
            self.stdout.write(self.style.WARNING(
                f'  {rcode:<22} NOT managed by this file ("{rname}"): users on it keep their old codes. '
                f'Move them with --assign.'))

    # ------------------------------------------------------------------ assign
    def _assign(self, spec):
        if '=' not in spec:
            raise CommandError('Use --assign username=ROLE or username=ROLE:COMPANY_CODE')
        username, rest = spec.split('=', 1)
        role_code, _, company_code = rest.partition(':')
        user = User.objects.filter(username=username.strip()).first()
        if not user:
            raise CommandError(f'No user "{username}". Existing: {", ".join(User.objects.values_list("username", flat=True))}')
        role = Role.objects.filter(code=role_code.strip()).first()
        if not role:
            raise CommandError(f'No role "{role_code}". Run the seeder first. Managed roles: {", ".join(ROLES)}')
        user.role = role
        user.save(update_fields=['role'])
        msg = f'Assigned {user.username} -> {role.code}'
        if company_code.strip():
            company = Company.objects.filter(code=company_code.strip()).first()
            if not company:
                raise CommandError(f'No company with code "{company_code}".')
            user.companies.add(company)
            msg += f' @ {company.code}'
        self.stdout.write(self.style.SUCCESS(msg))

    # ------------------------------------------------------------------ report
    def _report(self, which, verbosity):
        users = User.objects.select_related('role').order_by('username')
        if which != '*':
            users = users.filter(username=which)
            if not users.exists():
                raise CommandError(f'No user "{which}".')
        for u in users:
            companies = list(u.companies.values_list('code', flat=True))
            shown, hidden = [], []
            for group, label, perm in NAV:
                name = f'{group} > {label}' if group else label
                (shown if u.has_perm_code(perm) or perm is None else hidden).append((name, perm))
            role = f'{u.role.code} ({u.role.name})' if u.role_id else 'NO ROLE'
            self.stdout.write(self.style.MIGRATE_HEADING(
                f'\n{u.username}: role={role} | companies={",".join(companies) or "NONE"} | '
                f'{"group admin" if u.is_group_admin else str(len(u.perm_codes())) + " permissions"}'))
            self.stdout.write('  sidebar: ' + (', '.join(n for n, _ in shown) or 'nothing'))
            if verbosity >= 2 and hidden:
                self.stdout.write('  hidden:  ' + ', '.join(f'{n} [{p}]' for n, p in hidden))
            elif hidden:
                self.stdout.write(f'  hidden:  {len(hidden)} items (run with -v 2 to list them)')
            if not u.is_group_admin:
                if not u.role_id:
                    self.stdout.write(self.style.WARNING('  ! no role: only Approvals, Notifications and Profile show'))
                elif u.role.code not in ROLES:
                    self.stdout.write(self.style.WARNING(
                        f'  ! role {u.role.code} is not managed here: its codes may not match the sidebar'))
                if not companies:
                    self.stdout.write(self.style.WARNING(
                        '  ! no legal entity: lists come back empty and creating records is refused'))
                if not u.has_perm_code('approvals.view'):
                    self.stdout.write(self.style.WARNING('  ! missing approvals.view: the Approvals page returns 403'))