# PetroERP

Integrated ERP for a petroleum trading & distribution group operating in **Kenya** (purchasing, storage, fleet,
export) and the **DRC** (customers, local inventory, invoicing, collections).
Stack: **Django + Django REST Framework** (one app, `api`) · **React + Vite** frontend · SQLite (dev) / PostgreSQL (prod).

All business logic (accounting, costing, stock, approvals, permissions) runs **on the server**. The frontend only
calls the API; it never calculates or posts anything financial.

---

## 1. Build status (honest)

| Area | State |
|---|---|
| Data model - every table in section 5 of the spec (~110 models) | ✅ written, migrated |
| Services: accounting engine, inventory, procurement + 3-way match, pricing, sales, payments/FX, expenses & allocation, shipments, delivery variance, costing engine, intercompany, consolidation, payroll, fixed assets, reports, dashboard, AI helpers | ✅ written |
| REST API (87 resources + ~60 action endpoints), JWT auth, MFA (TOTP), role permissions, entity scoping, Excel/PDF export | ✅ written |
| Verified so far | `manage.py check` clean · migrations apply · `seed_demo` runs · login works · **all 87 list endpoints return 200** · security spot-check (Fleet Manager gets 403 on journals / payments / trial balance; dashboard hides financial cards) |
| **Not yet verified** | The 12 acceptance scenarios (section 12) have **not** been executed end-to-end. Until they pass, treat posting logic as *implemented, not proven*. This is deliberate: the spec says not to claim completion before testing. |
| Frontend (React/Vite) | ⏳ next step (structure in section 9) |
| Live M-Pesa / bank integrations | ⏳ not built - sandbox first, as the spec requires |

---

## 2. Project structure

```
petroerp/
├── README.md
├── backend/
│   ├── manage.py
│   ├── requirements.txt
│   ├── .env.example
│   ├── petroerp/                    # Django project package
│   │   ├── settings.py              # env-driven config, JWT, DRF, CORS, ATOMIC_REQUESTS
│   │   ├── urls.py                  # main URL conf  ->  /admin/  and  /api/
│   │   ├── wsgi.py / asgi.py
│   └── api/                         # the single application
│       ├── models.py                # all tables, immutability guards
│       ├── services.py              # ALL business logic (accounting, stock, costing, reports, AI ...)
│       ├── serializers.py           # generated serializers + nested documents + action inputs
│       ├── views.py                 # viewsets, permissions, entity scoping, exports, reports
│       ├── urls.py                  # app URL conf (router + non-CRUD endpoints)
│       ├── pagination.py
│       ├── admin.py                 # read-only admin for immutable tables
│       ├── apps.py
│       ├── migrations/
│       └── management/commands/
│           └── seed_demo.py         # roles, 2 entities, COA, mappings, master data, demo users
└── frontend/                        # React + Vite (planned - section 9)
    ├── index.html · package.json · vite.config.js
    └── src/
        ├── main.jsx
        ├── App.jsx                  # routes, auth guard, permission guard
        ├── services/api.js          # every API endpoint in one place
        ├── styles/main.css          # navy / white / restrained green theme
        ├── components/              # Navbar.jsx · Sidebar.jsx · AppLayout.jsx (+ a few shared pieces)
        └── pages/                   # grouped by domain
            ├── auth/ · dashboard/ · admin/ · procurement/ · inventory/
            ├── sales/ · logistics/ · finance/ · group/ · reports/ · ai/
```

---

## 3. Quick start (backend)

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # edit values (export them or use your process manager)
python manage.py migrate
python manage.py seed_demo --password 'Choose-A-Strong-One-1'
python manage.py runserver      # http://localhost:8000/api/
```

Login: `POST /api/auth/login/ {"username":"admin","password":"..."}` → `{access, refresh, user}`.
Send `Authorization: Bearer <access>` on every call. Seeded users (one per role): `admin, md, ke_finance, drc_finance,
accountant, proc_mgr, proc_officer, sales_mgr, sales_officer, fleet_mgr, logistics_mgr, store_mgr, cashier, auditor, readonly`.
**Change all passwords before any real use.**

### Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `DEBUG` | `1` dev / `0` production (turns on HTTPS/HSTS/secure cookies, requires real `SECRET_KEY`) | `1` |
| `SECRET_KEY` | Django secret | dev placeholder |
| `ALLOWED_HOSTS`, `CORS_ORIGINS` | comma-separated | localhost / Vite port 5173 |
| `DB_NAME` `DB_USER` `DB_PASSWORD` `DB_HOST` `DB_PORT` | PostgreSQL (unset `DB_NAME` → SQLite) | - |
| `REPORTING_CURRENCY` | group dashboard / consolidation currency | `USD` |
| `ACCESS_MINUTES`, `REFRESH_HOURS`, `LOGIN_THROTTLE` | JWT lifetimes, login rate limit | 30 / 12 / 10 per min |

---

## 4. Core design decisions

**Legal-entity separation.** Every transaction has `company`. Users see only `user.companies`
(Group Admin sees all). Querysets are filtered server-side and creates are checked. Numbering sequences,
chart of accounts, tax configs, bank accounts, customers, suppliers and approval policies are per entity
(`KE-PO-2026-00001`).

**One accounting gate.** Every posting calls `post_journal()`: lines must balance, the period must be open,
accounts must belong to the entity and be postable. `Journal`, `JournalLine`, `StockMovement`,
`ShipmentStatusHistory` and `AuditLog` are **immutable** (model guards + a queryset that blocks `update/delete`).
Corrections are reversing entries (`reverse_journal`). Add database triggers in PostgreSQL for defence in depth.

**GL by nature, costing as a sub-ledger (no double counting).** Expenses post to the GL once (Dr expense / Cr AP or
bank). The shipment costing engine **only reads** `ShipmentCostAllocation` (unique per expense × shipment; allocations
must sum to the expense net). Product cost leaves stock → *Inventory in transit* at dispatch, then *COGS* (delivered
litres) and *Transit loss* (shortage) at delivery. Transporter invoices post *through* an Expense, so hired-truck cost is
tracked separately from owned-truck cost (`TRANSPORT_HIRED` vs `TRANSPORT_OWNED`).

**Nothing hard-coded.** Tax/duty rates (`TaxConfig`, effective-dated, usable only after verification by a *different*
user), payroll statutory items (`PayrollConfig`), customs checklists (`ComplianceRequirement`), approval thresholds
(`ApprovalPolicy`), system accounts (`AccountMapping`). *Seed values are samples - verify professionally.*

**Measurement.** Goods receipts store observed volume, temperature, density and standardised volume with an explicit
`volume_basis`. Volumes are never assumed equal; conversion happens only when a coefficient is configured on the product.

**Approvals & segregation of duties.** Generic `ApprovalRequest` for POs, shipments, expenses, payments, bookings,
requisitions, stock adjustments and delivery variances. Requesters cannot approve their own items; thresholds map to roles.
Payments: **creator ≠ approver ≠ executor**.

**Audit trail.** Hash-chained `AuditLog` (each row hashes the previous). `GET /api/audit-logs/verify/` detects tampering.
Every resource has `GET /<resource>/{id}/history/`.

---

## 5. Business formulas (all in `services.py`)

```
Closing book stock   = Opening + Receipts + Transfers in − Issues − Transfers out   (adjustments shown separately)
Variance             = Physical − Closing book         (recorded; needs an APPROVED adjustment to touch stock/GL)

Selling price (profit/L)  = Cost/L + Target profit/L
Selling price (markup)    = Cost/L × (1 + markup%)        markup is on COST
Selling price (margin)    = Cost/L ÷ (1 − margin%)        margin is on SALES PRICE
Market price              = Base market price + premium (− discount)

Total shipment cost       = Purchase cost + allocated direct shipment expenses
Delivered cost per litre  = Total shipment cost ÷ actual delivered litres
COGS                      = (Purchase cost + in-COGS expenses) × invoiced litres ÷ delivered litres
Gross profit              = Revenue − COGS
Contribution              = Gross profit − direct expenses not in COGS (bank/financial)
Margin %                  = Contribution ÷ Revenue × 100

Realized FX (receipt)     = settled amount × (payment rate − invoice rate)       gain if positive
Realized FX (payment)     = settled amount × (payment rate − invoice rate)       loss if positive
```
Every cost-sheet run creates a **new version**; a *final* version is never overwritten (reopen requires `costing.finalize`).

---

## 6. Workflows → endpoints

| Workflow | Steps (endpoint) |
|---|---|
| **Purchase** | `POST /purchase-requisitions/` → `…/{id}/submit/` → `POST /approvals/{id}/approve/` → `POST /purchase-orders/` → `…/submit/` → approve → `POST /purchase-orders/{id}/receive/` (stock + Dr Inventory/Cr GRNI) → `POST /purchase-invoices/` → `…/post/` (3-way match; Dr GRNI, VAT / Cr AP) → pay |
| **Sales** | quotation → `customer-contracts` → `POST /sales-orders/` (pricing method per line; min-margin enforced) → submit/approve → `…/reserve/` → shipment → delivery → `POST /sales-invoices/` → `…/post/` (credit limit enforced) → `POST /payments/` (receipt) |
| **Shipment** | `POST /shipments/` → `submit` → approve → `update-status` (AWAITING_LOADING → LOADING) → `record-loading` → LOADED → DISPATCHED (stock issued) → IN_TRANSIT → AT_BORDER → UNDER_CUSTOMS → CLEARED → ARRIVED → `record-delivery` (shortage > tolerance → approval) → DELIVERED → `cost` → `cost {finalize:true}` → RECONCILIATION_PENDING → CLOSED |
| **Transport (hired)** | `transport-bookings` → approve → advance `payments` (`purpose=ADVANCE`, `booking`) → `transporter-invoices/{id}/post/` (advance auto-applied) → pay balance → booking SETTLED |
| **Payment** | create → `submit` → approver `approve` → executor `post` (allocations) → optional `reverse` |
| **Accounting** | approved business doc → journal (automatic) → `reports/trial-balance` → P&L / Financial Position / Cash Flow |
| **Intercompany** | `POST /intercompany/sale/` (posts BOTH entities) → `…/settle/` → `POST /intercompany/reconcile/` → `POST /consolidation-runs/run/` (eliminations) |

---

## 7. Roles

15 roles, ~190 permission codes of the form `<module>.view|edit` plus special ones:
`approvals.decide · payments.approve · payments.execute · finance.post · finance.close_period · sales.below_margin ·
procurement.override_match · credit.override · inventory.adjust · costing.finalize`.
The matrix lives in `services.ROLE_PERMISSIONS` and is loaded by `seed_demo` (`seed_roles()`); admins can edit roles' permissions in the DB.

---

## 8. API conventions

* Base: `/api/` · JSON · JWT bearer · paginated lists (`{count,next,previous,results}`, `?page=&page_size=`).
* Filtering: `?company=&status=&<fk>=&date_from=&date_to=&search=&ordering=`.
* **Export any table:** append `?export=xlsx` or `?export=pdf` to a list; reports and shipment cost sheets too.
* Errors: `400 {"detail": "business rule message"}` for rule violations, `403` for permission/entity, `401` unauthenticated.
* Workflow documents: `status` is read-only on PUT/PATCH; use the action endpoints. Edits only while `DRAFT`; only drafts can be deleted.
* Reports: `GET /reports/` (what you may run) · `GET /reports/<name>/` with `company, country, date_from, date_to, product, customer, shipment, account`.
  Names: `trial-balance, general-ledger, profit-and-loss, financial-position, cash-flow, equity-changes, ar-aging, ap-aging,
  bank-reconciliation, vat, daily-operations, daily-shipments, fuel-purchases, fuel-sales, tank-reconciliation,
  inventory-movement, stock-valuation, shipment-costing, fuel-variance, owned-fleet, hired-fleet, vehicle-expenses,
  trip-costs, driver-expenses, vehicle-profitability, customer-profitability, product-profitability,
  shipment-profitability, transporter-profitability, country-profitability, entity-profitability, group-consolidated`.
* AI: `POST /ai/ask/ {question}` · `POST /ai/scan/` (creates Alerts) · `GET /ai/cash-forecast|credit-risk|anomalies|supplier-prices/` · `POST /ai/price-recommendation/`.
  The assistant is deterministic: it maps questions to real queries and **never approves or posts anything**.

### System account keys (per entity, `AccountMapping`)
`INVENTORY, INVENTORY_IN_TRANSIT, GRNI, AP, AR, VAT_INPUT, VAT_OUTPUT, SALES_REVENUE, SALES_RETURNS, COGS, TRANSIT_LOSS,
PURCHASE_VARIANCE, STOCK_VARIANCE, FX_GAIN, FX_LOSS, FX_UNREALIZED, CUSTOMER_ADVANCES, SUPPLIER_ADVANCES, IC_RECEIVABLE,
IC_PAYABLE, IC_REVENUE, IC_PURCHASES, RETAINED_EARNINGS, OPENING_EQUITY, FIXED_ASSETS, ACCUM_DEPRECIATION, DEPRECIATION_EXP,
DISPOSAL_GAIN_LOSS, SALARIES_EXP, PAYROLL_PAYABLE, STATUTORY_PAYABLE, EXP_<CATEGORY> / EXP_<GROUP>`.

---

## 9. Frontend plan (React + Vite)

Build order agreed: `src/services/api.js` (all endpoints) → `App.jsx` → `styles/main.css` → `components/` (Navbar, Sidebar, AppLayout).
To keep the project manageable, pages are grouped by domain and most list/CRUD screens share **one** generic
`DataTable` + `RecordForm` driven by a small config object per resource.

```
pages/
  auth/        Login
  dashboard/   Executive dashboard (filters, KPI cards, charts)
  admin/       Companies, Branches, Departments, Fiscal years & periods, Tax configs, Currencies & rates,
               Users & roles, Approval policies, Number sequences, Audit log, Notifications
  procurement/ Suppliers, Contracts, Quotations, Requisitions, Purchase orders, Goods receipts, Invoices, Returns
  inventory/   Products, Depots, Tanks, Readings, Reconciliation, Adjustments, Transfers, Stock movements/balances
  sales/       Customers, Contracts, Pricing calculator, Quotations, Orders, Invoices, Credit notes
  logistics/   Vehicles, Drivers, Transporters, Bookings, Shipments (+ manual status form & timeline), Customs
  finance/     Expenses, Payments (M-Pesa/Bank/Cash), Bank reconciliation, Journals, Chart of accounts, Fixed assets, Payroll
  group/       Intercompany, Consolidation, FX revaluation
  reports/     Report runner (filters + Excel/PDF)
  ai/          Assistant, alerts, forecasts
```
Theme: dark navy sidebar/top bar, white content, restrained green accent; responsive (collapsible sidebar on tablet/mobile).
Menu items and buttons are hidden by `user.permissions` from `/auth/me/` - **cosmetic only**; the server is the authority.

---

## 10. Phases (from the spec) and where we are

1. Foundation - auth, entities, roles, audit ✅ backend
2. Procurement & inventory ✅ backend
3. Sales & customers ✅ backend
4. Fleet & logistics ✅ backend
5. Financial management ✅ backend
6. Multi-company finance ✅ backend
7. Advanced (AI, BI, alerts) ✅ backend (rule-based)
8. Testing & deployment ⏳

---

## 11. Known limitations (read before relying on it)

* Payments settle invoices **in the invoice currency** (cross-currency settlement of one invoice is rejected, not guessed).
* Consolidation translates every entity at a **single closing rate** (no average-rate P&L / CTA yet). Unrealised profit in
  buyer stock after an intercompany transfer is flagged for review, not computed.
* Volume standardisation is a configurable **linear approximation**; plug in ASTM/API tables if your contracts require them.
* Customer credit limits are expressed in the entity's functional currency.
* A shipment's COGS posts in the shipment-owning entity; selling to the other entity must go through `intercompany/sale`.
* MFA enrolment stores the pending secret in the session - use a real session/cache backend in production.
* Statutory payroll values, tax rates and border crossings in the seed are **samples**.

---

## 12. Acceptance tests (spec section 10)

| # | Scenario | Status |
|---|---|---|
| 1 | Supplier → PO → receive → supplier invoice (3-way match) | ⏳ to run |
| 2 | 50,000 L tank receipt; physical vs book variance → approved adjustment | ⏳ |
| 3 | Owned-truck shipment, expenses, profit | ⏳ |
| 4 | Hired truck: booking, advance, settle balance | ⏳ |
| 5 | Dispatch → border updates → clearance → proof of delivery | ⏳ |
| 6 | Partial delivery → variance flagged → approval | ⏳ |
| 7 | Credit sale, partial payment, outstanding | ⏳ |
| 8 | USD sale translated to functional currency; realised FX | ⏳ |
| 9 | Intercompany sale reconciled in both entities | ⏳ |
| 10 | Trial balance, P&L, financial position, consolidated report | ⏳ |
| 11 | Shipment profitability sheet | ⏳ |
| 12 | Security: user without finance permission blocked | ✅ spot-checked (journals, payments, trial balance → 403; dashboard redacted) |

They will be automated as Django tests (`python manage.py test api`) against `seed_demo` data.

---

## 13. Deployment & backup

```bash
# Production sketch
export DEBUG=0 SECRET_KEY=... DB_NAME=petroerp DB_USER=... DB_PASSWORD=... ALLOWED_HOSTS=erp.example.com
python manage.py migrate && python manage.py collectstatic --noinput
gunicorn petroerp.wsgi:application --bind 127.0.0.1:8000 --workers 3     # behind nginx with TLS
```
* Serve `/media/` (receipts, PODs, customs files) from private storage; do not expose it publicly.
* **Backups:** nightly `pg_dump -Fc petroerp > petroerp_$(date +%F).dump` + media sync; keep 30 days; **test a restore monthly**
  (`createdb petroerp_restore && pg_restore -d petroerp_restore file.dump`, then run `GET /audit-logs/verify/` and the trial balance).
* Run `seed_demo` only on empty/staging databases; for production create entities, users and mappings through the API/admin.
* Before go-live: run the 12 acceptance scenarios, security review, data-migration dry run, UAT sign-off.