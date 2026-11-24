# SEI Client CRM — Structural Design

Status: MVP, built and running. This document describes the system as it is in the code today
(`server.js`, `src/`, `public/`, `scripts/`, `test/`). Where it says "must", the code enforces it.

---

## 1. What the system is

A single-company CRM and plant-operations tool for Services Engineering Industries (sheet-metal and
welding, automotive Tier-1/OEM customers). One app covers three areas:

| Area | Covers |
|---|---|
| **Commercial** | Clients, contacts, activity log, follow-ups, RFQs and quotes, POs and dispatches, invoices and payments (incl. TDS / debit notes), quality complaints |
| **Company checklist** | Jobs given to people, recurring checklists with sign-off, compliance calendar (GST, TDS, PF/ESI, ROC, licences), weekly scorecards |
| **Weekly planning** | Week planner, sales / production / purchase / payment plans, petty cash (Cash / UPI), machines and tools with preventive maintenance (PM), suppliers, Excel export |

Users: about 10–50 internal staff, on office PCs and phones. Everyone signed in can read
everything; who can *change* what depends on role, department and "head of department".

---

## 2. Design principles

These choices shape every file. Keep them when extending the app.

1. **Zero runtime dependencies.** No `node_modules`. Only Node built-ins: `node:http`,
   `node:sqlite`, `node:crypto`, `node:zlib`. Fonts are bundled. `npm start` works on a clean PC.
2. **Server-rendered HTML, no build step.** Pages are built with a tagged-template `html```
   helper that escapes by default. The browser gets plain HTML forms. One small script
   (`public/app.js`, 94 lines) adds progressive enhancement only; every flow works without it.
3. **One record-type registry drives the CRUD.** `src/modules.js` declares each record type
   (fields, list SQL, views, filters, columns, roles, hooks). `src/crud.js` turns that into list
   pages, forms, validation, CSV export, delete rules and audit entries. Hand-built pages exist only
   where a generic list/form is not enough.
4. **SQLite as the single source of truth.** Derived numbers (pending qty, invoice balance, next
   PM date, actual sales) are SQL views, recreated on every start, never stored.
5. **Secure by default.** Strict CSP with no inline script or style, CSRF on every POST, hashed
   session tokens, scrypt passwords, layered sign-in throttling, content-sniffed uploads.
6. **Plain-language UI.** Labels and errors use the words the plant uses ("PO", "dispatch",
   "TDS", "Not OK"). Every error tells the user what to do next.

---

## 3. Runtime topology

```
 Browser (PC / phone)
   │  HTML forms, GET/POST only, cookies: sei_sid (session), sei_dev (known browser), sei_lcsrf (login CSRF)
   ▼
 [ Caddy / HTTPS ]  (VPS only; TRUST_PROXY=1, COOKIE_SECURE=1)
   ▼
 node server.js  ── single process, single thread (scrypt runs on the libuv pool)
   │
   ├─ src/app.js        request pipeline: static, session, router, body parse, CSRF, error page
   ├─ src/router.js     pattern routes  ('/rfqs/:id/edit', ':id' = digits only)
   ├─ src/routes/*.js   hand-built pages
   ├─ src/crud.js       generated pages for every entry in MODULES
   │
   ▼
 data/crm.db  (SQLite, WAL)      data/uploads/<uuid>.<ext>      data/backups/
```

Demo mode (`npm run demo`) is the same process pointed at `data/demo.db` on port 3001, seeded with
invented data. It refuses to start unless `HOST` is loopback and `COOKIE_SECURE` is off, because its
password is published in the README.

---

## 4. Source layout

| Path | Lines | Responsibility |
|---|---:|---|
| `server.js` | 49 | Boot: load config, `createApp`, HTTP server timeouts, graceful shutdown |
| `src/config.js` | 37 | Minimal `.env` reader; returns the config object |
| `src/app.js` | 254 | Security headers, static files, session load, routing, body parsing, CSRF, forced password change, error pages, first-admin bootstrap |
| `src/router.js` | 29 | Regex router; `:id` matches digits only |
| `src/http.js` | 57 | `HttpError`, cookie parse/build, 1 MB form body reader, `safeReturn` (open-redirect guard) |
| `src/html.js` | 23 | `html``` tagged template with auto-escaping, `raw()`, `SafeHtml` |
| `src/db.js` | 732 | Schema migrations, SQL views, the `node:sqlite` wrapper (named params, statement cache, `tx`), client seed |
| `src/modules.js` | 1486 | **The registry**: option lists (`OPT`) and one definition per record type (21 types) |
| `src/crud.js` | 434 | Generic list / form / create / update / delete / CSV from a module definition |
| `src/ui.js` | 308 | Page layout, navigation with live counts, form controls, tables, tiles, filter bar |
| `src/cells.js` | 70 | Table cell renderers: badge, money, date, due, tel, email, buttons |
| `src/format.js` | 84 | Dates in the configured time zone, Indian number/money formats, week helpers |
| `src/auth.js` | 190 | Roles, scrypt hashing with a bounded verify queue, password rules, throttling, known-browser token, `canEdit` |
| `src/checklists.js` | 259 | Checklist item parser, due rules, daily run generation, permissions, compliance due dates, scorecard |
| `src/planning.js` | 235 | PM planning for a week, `loadWeek`, the week's Excel workbook |
| `src/uploads.js` | 130 | Multipart parser, file sniffing, storage, gallery, file serving |
| `src/xlsx.js` | 324 | Dependency-free `.xlsx` writer (zip + SpreadsheetML) |
| `src/usernames.js` | 27 | User-name rules and generation from a person's name |
| `src/pm-checklists.js` | 141 | Standard PM check points per machine type |
| `src/demo.js` | 650 | Demo data seeders |
| `src/routes/auth.js` | 167 | Sign-in, sign-out, change password |
| `src/routes/dashboard.js` | 245 | Role-aware dashboard |
| `src/routes/clients.js` | 279 | Client list with attention scoring; client page with tabs |
| `src/routes/checklists.js` | 409 | My checklists, fill-in, sign-off, approvals, compliance "mark done", scorecards, attachments |
| `src/routes/planning.js` | 178 | Week planner, plan PM, Excel download, PM done |
| `src/routes/jobs.js` | 75 | Job updates and job sign-off |
| `src/routes/followups.js` | 24 | Mark follow-up done |
| `src/routes/users.js` | 149 | User admin |
| `src/routes/search.js` | 75 | Global search |
| `public/app.css` | 729 | All styles; brand tokens; mobile card layout for tables |
| `public/app.js` | 94 | Confirm dialogs, mobile menu, client-scoped pickers, auto-submit filters, checklist pre-checks, `/` for search |
| `scripts/backup.js` | 39 | `VACUUM INTO` dated copy, keep newest 30, copy new uploads |
| `scripts/planning-template.js` | 477 | Writes the offline Excel planning template and a demo week |
| `test/smoke.test.js` | 701 | End-to-end test against a throwaway database (`node --test`) |

---

## 5. Request lifecycle

Every request goes through `createApp().handle` in `src/app.js`, in this order:

1. **Parse URL.** A malformed URL gets a plain 400.
2. **Build `ctx`**: `req, res, cfg, db, url, path, method` (HEAD is treated as GET), `query`,
   `params`, `body`, `cookies`, `ip` (last `X-Forwarded-For` hop only when `TRUST_PROXY=1` and the
   peer is loopback).
3. **Decorate `ctx`** with `send`, `redirect` (303), `page` (wraps body in the layout), `flash` /
   `takeFlash` (stored on the session row), `audit` (writes `audit_log`).
4. **Static files** under `/static/` (name must match `^(fonts/)?[a-z0-9][a-z0-9._-]*$`; fonts get
   a one-year immutable cache). `/healthz` returns `ok`.
5. **Load session**: cookie `sei_sid` → `sha256(token)` → `sessions` row joined to an active user.
6. **Route match.** No match: signed-out users go to `/login`, signed-in users get 404.
7. **Auth gate.** A private route with no user is redirected *before* the body is read.
8. **Body parse** (POST only). `application/x-www-form-urlencoded` up to 1 MB. Routes marked
   `{ multipart: true }` also accept `multipart/form-data` up to 41 MB. Anything else is 415.
9. **CSRF.** Every private POST must carry `_csrf` equal to the session's token (constant-time
   compare). Login has its own double-submit cookie `sei_lcsrf`.
10. **Forced password change.** `must_change_password` users can reach only routes marked
    `allowPasswordChange`.
11. **Handler runs.** A handler that sends nothing is a bug and becomes a 500.
12. **Errors** become a friendly page inside the layout (signed in) or a bare page (signed out).
    5xx details go to the server log only.

Every response carries: `Content-Security-Policy` (`default-src 'self'`, no inline script or
style, `frame-ancestors 'none'`, `form-action 'self'`), `X-Content-Type-Options`,
`X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, `Permissions-Policy`, `Cache-Control:
no-store` for pages, and `Strict-Transport-Security` when `COOKIE_SECURE=1`.

---

## 6. The module registry (core pattern)

### 6.1 Definition shape

Each entry in `MODULES` (`src/modules.js`) is a plain object. The keys in use:

| Key | Meaning |
|---|---|
| `key`, `table` | URL segment and SQL table |
| `singular`, `plural`, `many` | Words for headings, buttons and counts |
| `editRoles` | Roles that may create / edit (admin always may). `[]` means "decided per record" |
| `canEditRow(user, row)` | Per-record permission, overrides `editRoles` (jobs, checklists) |
| `fields[]` | `{ name, label, type, required, default, options, min, positive, pattern, patternMsg, upper, help, section, wide, virtual, createOnly, openOnly }` |
| `listSql` | Base `SELECT` for lists, joins in display names; may read a view |
| `order` | `ORDER BY` for lists |
| `views[]` | Tabs above a list: `{ key, label, where }` using date params (`:t`, `:tm7`, `:tp7`, `:wk`, …) |
| `defaultView` | Which view opens first |
| `filters[]` | Drop-downs: `{ name, label, options }` or `{ type: 'user', mine: true }` |
| `search[]` | Columns matched by the list's text box (`LIKE` with escaping) |
| `columns[]`, `childColumns[]` | Table columns: `{ label, cls, render(row, ctx) }` |
| `csv[]` | Columns in the CSV download |
| `tab` | Which client-page tab this record belongs to |
| `noClient` | Record is not tied to a client (planning, checklists) |
| `weekly` | Record has `week_start`; list gets This / Next / Last week and `?week=` |
| `homeList` | After save, return to the module list, not the client page |
| `parent` | Child record (dispatch → order, payment → invoice, PM task → asset); inherits `client_id` from the parent |
| `children[]` | Child modules listed under the parent's edit form |
| `dependents[]` | Records that block delete: `{ table, fk, one, many }`; `deleteHint` says what to do instead |
| `readOnly` | List and CSV only; records have their own hand-built pages |
| `validate(data, virt, errors, ctx, existing)` | Cross-field and database rules |
| `prefill(ctx, values)` | Fill a new form from a query (`?rfq_id=` → order form) |
| `beforeSave`, `beforeInsert`, `afterInsert`, `afterUpdate` | Hooks inside the save transaction |
| `childSummary`, `formExtra`, `listSummary`, `listActions` | Extra HTML on forms and lists |

### 6.2 Field types

`text`, `textarea`, `int`, `decimal`, `money`, `money2`, `date`, `select`, `checkbox`, `email`,
`tel`, `url`, and foreign-key pickers `client`, `contact`, `user`, `assignee`, `rfq`, `order`,
`invoice`, `supplier`, `asset`, `machine`.

`coerce()` in `src/crud.js` validates each type: whole numbers ≥ `min`, rupee amounts rounded to
paise, real calendar dates between 1990 and 2100 (31 Feb is refused), options from the list only,
200-character text and 5000-character textarea limits. Foreign keys must exist, and `contact`,
`rfq`, `order` and `invoice` must belong to the same client as the record.

### 6.3 Generated routes

For every module key `k` (`registerCrud`):

| Method | Path | Action |
|---|---|---|
| GET | `/k` | List with views, filters, search, `?client=`, `?week=`, pages of 100 rows (capped at 2000; CSV has all) |
| GET | `/k.csv` | CSV of the current filters, opens in Excel |
| GET | `/k/new` | New form (query keys like `client_id` prefill) |
| POST | `/k/new` | Create → audit → `afterInsert` |
| GET | `/k/:id` | Redirect to edit |
| GET | `/k/:id/edit` | Form (read-only if the role can't edit), children, delete button for admins |
| POST | `/k/:id/edit` | Update → audit with a field-by-field change summary → `afterUpdate` |
| POST | `/k/:id/delete` | Admin only; blocked by `dependents`; deletes attached files |

`readOnly` modules register only the list and CSV routes.

### 6.4 Registered modules (21)

| Group | Modules |
|---|---|
| Commercial | `clients`, `contacts`, `activities`, `followups`, `rfqs`, `orders`, `dispatches` (child of orders), `invoices`, `payments` (child of invoices), `complaints` |
| Company checklist | `jobs`, `checklists`, `checklist_runs` (register), `compliance_items` |
| Weekly planning | `sales_plans`, `production_plans`, `assets`, `pm_tasks` (child of assets), `purchase_plans`, `suppliers`, `payment_plans`, `petty_cash` |

---

## 7. Data model

SQLite, `PRAGMA journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`, `synchronous=NORMAL`.
Dates are ISO `YYYY-MM-DD` text. Timestamps are UTC `datetime('now')`. Every business table has
`created_at` and `updated_at`.

### 7.1 Entity map

```
users ─┬─< sessions
       ├─< audit_log >── clients
       └── (owner / assigned / approved / created_by on most tables)

clients ─┬─< contacts
         ├─< activities ──> contacts
         ├─< followups  ──> contacts
         ├─< rfqs ──────┐
         ├─< orders <───┘ (rfq_id)  ─< dispatches
         ├─< invoices ──> orders     ─< payments
         ├─< complaints ──> contacts
         ├─< sales_plans ──> orders
         ├─< production_plans ──> assets
         └─< jobs

suppliers ─< purchase_plans
          └< payment_plans
assets ─< pm_tasks
       └< checklists (optional machine link)
checklists ─< checklist_runs ─< checklist_answers
compliance_items ─< compliance_filings
attachments (entity, entity_id) → checklist_runs | jobs | compliance_filings | …
meta (key/value: device_key, clients_seeded, checklists_through, first_login_user)
```

### 7.2 Tables

| Table | Key columns |
|---|---|
| `users` | `username` (unique, NOCASE), `email` (optional, unique), `role`, `department`, `is_head`, `password_hash`, `must_change_password`, `active`, `last_login_at` |
| `sessions` | `id` = sha256 of the cookie token, `user_id`, `csrf`, `flash`, `expires_at` |
| `clients` | `name` (unique), `status` (Active / Prospect / Dormant / Lost), `segment`, `owner_id`, `vendor_code`, `payment_terms_days`, `gstin`, address fields |
| `contacts` | `client_id`, `name`, `designation`, `department`, `location`, `mobile`, `phone`, `email`, `is_primary`, `active` |
| `activities` | `client_id`, `contact_id`, `type` (Call / Visit / Meeting / Email / WhatsApp / Note), `occurred_on`, `subject`, `user_id` |
| `followups` | `client_id`, `title`, `due_on`, `assigned_to`, `status` (Open / Done / Cancelled), `done_on` |
| `rfqs` | `part_name`, `part_no`, `drawing_rev`, `material`, `annual_volume`, `received_on`, `quote_due_on`, `status` (New → Costing → Quoted → Negotiation → Won / Lost / Regretted / On hold), `quote_no`, `unit_price`, `tooling_cost`, `lost_reason` |
| `orders` | `po_no`, `po_date`, `part_name`, `part_no`, `plant`, `qty`, `unit_price`, `due_on`, `status` (Open / Closed / Cancelled), `rfq_id` |
| `dispatches` | `order_id`, `client_id` (copied from order), `dispatched_on`, `qty`, `invoice_no` |
| `invoices` | `invoice_no`, `invoice_date`, `amount` (incl. GST), `due_on`, `order_id` |
| `payments` | `invoice_id`, `received_on`, `amount`, `deduction` (TDS / debit note), `mode`, `reference` |
| `complaints` | `complaint_ref`, `received_on`, `category`, `severity` (Minor / Major / Critical), `defect`, `qty_affected`, `status` (Open → Containment done → Root cause found → Action taken → Closed), `containment`, `root_cause`, `corrective_action`, `target_on`, `closed_on` |
| `audit_log` | `at`, `user_id`, `client_id`, `entity`, `entity_id`, `action`, `summary` |
| `suppliers` | `name` (unique), `category`, `payment_terms_days`, `gstin`, `active` |
| `assets` | `code` (unique), `asset_type` (Machine / Tool-die / Fixture / Gauge / Utility), `status` (Running / Breakdown / Idle / Scrapped), `pm_frequency`, `pm_day`, `pm_checklist`, `responsible_id`, `last_pm_on` |
| `pm_tasks` | `asset_id`, `planned_on`, `week_start`, `checklist`, `assigned_to`, `status` (Planned / Done / Postponed / Missed / Cancelled), `done_on`, `downtime_min`, `findings`, `spares_used`, `cost` |
| `sales_plans` | `week_start`, `client_id`, `order_id`, `part_name`, `planned_qty`, `rate`, `dispatch_on` |
| `production_plans` | `plan_date`, `week_start`, `shift`, `asset_id`, `operation`, `part_name`, `planned_qty`, `produced_qty`, `rejected_qty`, `status`, `shortfall_reason` |
| `purchase_plans` | `required_by`, `week_start`, `category`, `item`, `supplier_id`, `qty`, `unit`, `rate`, `status` (Planned → Indent raised → PO placed → Part received → Received), `po_no`, `received_qty` |
| `payment_plans` | `plan_date`, `week_start`, `category`, `supplier_id`, `payee`, `bill_no`, `due_on`, `amount`, `priority` (Must pay / Normal / Can defer), `status` (Planned / Approved / Paid / Deferred / Cancelled), `approved_by`, `paid_amount` |
| `petty_cash` | `plan_date`, `week_start`, `entry_type` (Expense / Cash top-up), `head`, `mode` (Cash / UPI), `planned_amount`, `amount`, `status`, `voucher_no`, `upi_ref` |
| `jobs` | `title`, `details`, `department`, `assigned_to`, `assigned_by`, `client_id`, `priority`, `due_on`, `status` (To do / In progress / Waiting / Done / Cancelled), `approved_by`, `approved_at` |
| `job_updates` | `job_id`, `user_id`, `status`, `note`, `at` |
| `checklists` | `title`, `department`, `frequency`, `weekday`, `month_day`, `assignee_id`, `asset_id`, `needs_approval`, `items_text`, `active` |
| `checklist_runs` | `checklist_id`, `due_on` (unique together), `department`, `assignee_id`, `status` (Open / Submitted / Approved / Returned / Done), `issues`, `submitted_by/at`, `reviewed_by/at`, `review_note` |
| `checklist_answers` | `run_id`, `position`, `text`, `kind` (check / reading), `unit`, `min`, `max`, `value`, `ok`, `note` |
| `compliance_items` | `title`, `category`, `frequency`, `due_on`, `due_day`, `remind_days`, `owner_id`, `department`, `authority`, `active` |
| `compliance_filings` | `item_id`, `period_due_on`, `done_on`, `done_by`, `reference`, `amount`, `note` |
| `attachments` | `entity`, `entity_id`, `filename`, `stored` (uuid file name), `mime`, `size`, `user_id` |
| `meta` | key/value settings |

### 7.3 Derived views (rebuilt on every start)

| View | Adds |
|---|---|
| `v_orders` | `dispatched`, `pending = qty − dispatched`, `last_dispatch_on` |
| `v_invoices` | `received`, `deducted`, `balance = amount − Σ(amount + deduction)` (rounded to paise), `last_payment_on` |
| `v_assets` | `pm_days`, `last_done_on` (later of last Done task and `last_pm_on`), `next_pm_on`, `open_tasks`, `next_planned_on` |
| `v_sales_plans` | `actual_qty` counted from that week's dispatches (by PO, or by part when the line has no PO and no other line claims the PO), `planned_value`, `actual_value`, `balance_qty` |

"Paid" means `balance <= 0.5` rupee, so rounding never leaves an invoice open.

### 7.4 Migrations

`MIGRATIONS` in `src/db.js` is an append-only array; `PRAGMA user_version` records how many have
run. Each step runs inside `BEGIN IMMEDIATE`, so two processes starting together can't both run
it. A step can be a SQL string or `{ fkOff: true, up(raw) }` for table rebuilds; that runs with
foreign keys paused and fails if `PRAGMA foreign_key_check` finds a broken link. **Never edit a
migration that has shipped.** Views are not migrations; edit `VIEWS` freely.

| # | Adds |
|---|---|
| 1 | Users, sessions, commercial tables, audit log, indexes |
| 2 | Indexes for duplicate-invoice and duplicate-PO checks |
| 3 | Weekly planning: suppliers, assets, PM tasks, five weekly plans |
| 4 | Departments and heads on users; jobs and job updates |
| 5 | User names (rebuilds `users`; email becomes optional) |
| 6 | Checklists, runs, answers, compliance, attachments, job sign-off |
| 7 | `compliance_items.due_day` so dates on the 29th–31st don't drift |

### 7.5 Database wrapper

`openDb()` returns `{ all, get, run, exec, tx, close, raw }`. SQL uses named parameters
(`:name`). The wrapper binds only the names a statement uses (`node:sqlite` throws on extras),
turns `undefined` into `NULL` and booleans into 0/1, caches up to 500 prepared statements, and
`tx(fn)` wraps `BEGIN IMMEDIATE … COMMIT` with rollback on error. `run()` returns `{ changes, id }`.

---

## 8. Business rules enforced in code

| Area | Rule |
|---|---|
| Clients | Name is unique (case-insensitive). A client with any linked records can't be deleted: set it Dormant or Lost. GSTIN must match the 15-character pattern. |
| Activities | Can't be dated in the future. The same form can create a follow-up (title and date must come together). |
| RFQs | A Won RFQ offers "Create order", which prefills the order from the RFQ. |
| Orders | One line per PO + part + part no per client. Quantity can't drop below what is already dispatched. |
| Dispatches | Quantity can't exceed what is pending on the PO. Client comes from the PO. |
| Invoices | Invoice number unique. Due date defaults to invoice date + client payment terms (30 days if unset). Due date can't be before the invoice date. Amount can't drop below what is already settled. |
| Payments | Amount + deduction must be above zero and can't exceed the balance. The form prefills the balance. |
| Contacts | Can't be deleted while referenced; untick "Still works at this client" instead. |
| Jobs | Admins give jobs to anyone; heads only within their department. The assignee can post updates and change status, not details. Giver, head or admin can edit or cancel. Done jobs wait for sign-off; sending back reopens as In progress. |
| Checklists | A run is created per due day, including days nobody opened the app (up to 31 days back). Not OK or an out-of-limit reading needs a note. Nobody signs off their own run except an admin. |
| Compliance | "Mark done" records a filing with proof and rolls the due date to the next period, keeping the intended day of month. |
| PM | One task per machine per week. An overdue open task blocks planning a second one. Monthly = 28 days, quarterly 91, half-yearly 182, yearly 364, so each PM lands in a planning week. |
| Production | Status turns Done or Short from produced quantity. |
| Petty cash | Only cash expenses reduce the cash box; UPI payments need a reference. |
| Payment plan | Bill due date defaults from the supplier's credit days. |
| Delete | Admin only, everywhere. Blocked while `dependents` exist. Attached files are removed with the record. |
| Audit | Every create, update (with a change summary) and delete is written to `audit_log` and shows on the client's timeline. |

---

## 9. Users, roles and permissions

### 9.1 Roles (`src/auth.js`)

| Role | Can change |
|---|---|
| `admin` | Everything, incl. users and deletes |
| `sales` | Clients, contacts, RFQs, orders, dispatches, complaints, activities, follow-ups, sales plan |
| `accounts` | Invoices, payments, contacts, activities, follow-ups, payment plan, petty cash, suppliers |
| `quality` | Complaints, contacts, activities, follow-ups, PM tasks |
| `production` | Production plan, machines and tools, PM tasks |
| `purchase` | Suppliers, purchase plan |
| `viewer` | Nothing (reads everything) |

`canEdit(user, mod, row)`: admin → yes; else `mod.canEditRow(user, row)` if defined; else
`mod.editRoles.includes(user.role)`.

### 9.2 Department overlay

Each user has an optional `department` (Management, Sales, Accounts, Quality, Production,
Maintenance, Tool room, Purchase & stores, Dispatch & logistics, HR & admin) and `is_head`. Being
head adds powers on top of the role, scoped to that department: give jobs, manage checklist
templates, sign off runs and finished jobs, mark compliance items done.

### 9.3 Sign-in and sessions

- Sign in with user name (or email if set). Passwords: scrypt (N=16384, r=8, p=1, 64-byte key),
  verified off the main thread, at most 2 at once with 64 waiting; beyond that, "busy" (503).
- Unknown user names are checked against a dummy hash so timing doesn't reveal them.
- Throttling, counted *before* the password check and refunded on success:
  per address 30 failures / 15 min (IPv6 grouped by /64); per address + account 10;
  per account from anywhere 5 free, then 1, 2, 4 … 60 s between attempts.
- A signed "known browser" cookie (`sei_dev`, HMAC, 180 days) skips the per-account wait, so an
  attacker can't lock the owner out. It never replaces the password.
- Session token: 32 random bytes in the cookie, only its sha256 stored. `HttpOnly`,
  `SameSite=Lax`, `Secure` when `COOKIE_SECURE=1`. Lifetime `SESSION_DAYS` (default 7).
- New passwords: 10–200 characters, at least 5 different characters; digits-only (phone
  numbers), common words (with leet-speak undone), keyboard runs and the user's own name, user
  name or email are refused. Changing a password signs out every other session.
- First run creates `admin` with a one-time password in `data/first-login.txt` (mode 0600). The
  file is deleted when that admin sets their own password.

---

## 10. Feature domains

### 10.1 Clients and attention scoring (`src/routes/clients.js`)

One summary query computes, per client: open / late POs, unpaid invoices, outstanding and overdue
amount, last contact, contact count, open / overdue follow-ups, open RFQs, quotes older than 14
days, open / critical complaints. Totals use grouped joins, not per-row sums, so the list stays
fast as history grows.

`clientFlags()` turns that into weighted flags:

| Flag | Tone | Weight |
|---|---|---:|
| Money overdue | bad | 3 |
| Late PO | bad | 3 |
| Critical complaint | bad | 3 |
| Open complaint (non-critical) | warn | 2 |
| Overdue follow-up | bad | 2 |
| Quote to chase (> 14 days) | warn | 1 |
| Active client, no contact in 30+ days | warn | 1 |
| Active client, never contacted | muted | 0.5 |

The score is the sum. The client list sorts by score by default and can filter to score ≥ 1.

Client page tabs: Overview (quick "log a call" form, timeline from activities + audit, open
follow-ups, contacts), Contacts, RFQs & quotes, Orders & deliveries, Invoices & dues, Complaints,
Company details. The middle tabs reuse each module's list columns filtered to the client.

### 10.2 Dashboard (`src/routes/dashboard.js`)

- **Your day** for everyone: checklists to fill, sign-offs waiting, open jobs, follow-ups due,
  compliance dates, each with what is late.
- **Commercial side** (sales, accounts, management): clients needing attention, my follow-ups,
  money owed with ageing, deliveries late or due this week, recent calls and visits.
- **Plant side** (production, maintenance, quality, stores, dispatch): Plant today — today's
  production plan, PM due, machines under breakdown, material due, deliveries due.
- Admins see both. The side is chosen from role and department.

### 10.3 Navigation counts (`src/ui.js`)

Computed once per request and shown as badges: my open jobs, my follow-ups due, my checklists
(today + missed in 14 days), approvals waiting, compliance due within reminder window, late POs,
overdue invoices, open complaints, overdue PM, breakdowns, late purchases, overdue payments. The
first page view of the day also generates the day's checklist runs (`CL.ensureRuns`).

### 10.4 Checklist engine (`src/checklists.js`, `src/routes/checklists.js`)

- **Template items** are one per line. `Air pressure [5-6 kg/cm²]` → reading with limits;
  `Diesel [litres]` → reading without limits; anything else → OK / Not OK / N/A. Bullets and
  numbering are stripped. Max 80 items.
- **Frequencies**: Daily (Mon–Sat), Daily, Weekly on a weekday, Monthly on a day (31 = last day).
- **Runs**: `ensureRuns` creates a run for every due day since `meta.checklists_through`
  (≤ 31 days back) with `INSERT OR IGNORE` on `(checklist_id, due_on)`. Editing a template
  refreshes today's run only if nobody has started it.
- **Fill-in**: per-item answer, reading and note; up to 5 photos/PDFs of 8 MB each. `issues` counts
  Not OK and out-of-limit answers.
- **Sign-off**: `needs_approval` runs go to Submitted, then Approved or Returned (with a remark).
  Others go straight to Done. Runs with no issues can be signed off from the list.
- **Register** views: Today, Missed, With problems, Waiting for sign-off, This week, All; CSV.
- **Standard sets**: 12 sheet-metal/welding checklists and the Indian statutory calendar
  (TDS 7th, GSTR-1 11th, PF/ESI 15th, GSTR-3B 20th, advance tax, quarterly TDS, AOC-4, MGT-7,
  ITR, GSTR-9) can be loaded by an admin.
- **Scorecards**: per week (Mon–Sun), by department and person: checklists on time / late / missed,
  problems found, jobs on time / late, PM done, compliance overdue.

### 10.5 Weekly planning (`src/planning.js`, `src/routes/planning.js`)

- Every plan row carries `week_start` (a Monday). Lists open on this week; `?week=` opens any week.
- **Plan PM for this week** (`planPmWeek`): for each non-scrapped asset with a PM frequency, skip if
  it already has a task that week or an open task whose day has passed; otherwise due date =
  last done (or last open planned) + frequency days; if due by week end, plan it on the asset's
  PM day with its checklist and responsible person. Runs in one transaction; audited.
- **Week planner** (`loadWeek`): tiles per plan, a day-by-day board (PM, production, dispatches,
  material due, payments, petty cash), a cash view (customer money due in vs. payments out, cash
  box), and attention items: production booked on a machine under breakdown or with PM that day,
  and PM / purchases / payments carried over from earlier weeks.
- **Excel**: `/planning.xlsx?week=` builds the week's workbook (summary, sales, production, PM,
  machines, purchase, payment, receivables, petty cash) with `src/xlsx.js`. `npm run sheets`
  writes an offline template with drop-downs, formulas, a 52-week PM calendar and one PM card per
  machine.

### 10.6 Search (`src/routes/search.js`)

One box (top bar, `/` shortcut) searching clients, contacts, phone numbers (digits only match),
part numbers, PO, invoice and complaint numbers. Results grouped by type.

### 10.7 Uploads (`src/uploads.js`)

Own multipart parser; at most 5 files, 8 MB each, 41 MB per request. Type is decided from the
file's first bytes (JPEG, PNG, WebP, PDF only), never from the name or browser-sent type. Files
are saved as `<uuid>.<ext>` with mode 0600 inside the save transaction and served only through
`/attachments/:id` after a strict name check, with a sanitised `Content-Disposition`.

---

## 11. UI system

- **Layout**: left rail navigation (collapsible on phones), top bar with search, user, password,
  sign out. Sections: core, Company checklist, Business, Weekly planning, Admin.
- **Brand**: navy `#14263d`, action red `#c83b43`, grounds `#f4f6f8` / `#e6ebf0`, ring mark;
  Instrument Serif for headings, Inter for body and all figures (tabular numerals, has ₹).
  Fonts bundled under the SIL Open Font License.
- **Tables** turn into label/value cards on phones; no sideways scrolling.
- **Tones**: `ok`, `warn`, `bad`, `info`, `muted` used consistently for badges, flags and due dates.
- **Money and numbers**: Indian grouping (`en-IN`), ₹; dates shown as `24 Nov 2026`.
- **Progressive enhancement** (`public/app.js`): confirm on destructive forms (`data-confirm`),
  client-scoped pickers hide other clients' contacts/RFQs/POs/invoices, filters auto-submit,
  checklist form requires notes and checks file count/size before upload, `/` focuses search.
- Static asset cache-busting via `ASSET_V` in `src/ui.js`; bump it when CSS or JS changes.

---

## 12. Configuration and operations

| Setting | Default | Purpose |
|---|---|---|
| `HOST`, `PORT` | `127.0.0.1`, `3000` (`3001` demo) | Listen address |
| `DATA_DIR`, `DB_FILE` | `data`, `crm.db` | Database location |
| `ADMIN_EMAIL` | `admin@sei.local` | First admin's email |
| `TZ_NAME` | `Asia/Kolkata` | "Today" and "overdue"; validated at start |
| `SESSION_DAYS` | `7` | Sign-in lifetime |
| `COOKIE_SECURE`, `TRUST_PROXY` | `0` | Set both to `1` behind HTTPS |
| `COMPANY_NAME` | Services Engineering Industries | Footer and Excel titles |
| `DEMO_PASSWORD` | in `.env.example` | Demo users only |

| Command | Does |
|---|---|
| `npm start` | Run on the real database |
| `npm run dev` | Same with `--watch` |
| `npm run demo` | Demo database on 3001 |
| `npm run backup` | `VACUUM INTO data/backups/<date>.db`, keep 30, copy new uploads |
| `npm run sheets` | Write the Excel planning template |
| `npm test` | End-to-end test on a throwaway database |

Deployment target: a VPS with Node ≥ 22.13, systemd unit (`UMask=0077`), Caddy for HTTPS with
`request_body max_size 45MB`, daily backup via cron copied off the server. Port 3000 is never
exposed directly.

---

## 13. Testing

`test/smoke.test.js` (`node --test`) starts the app on a temporary data directory and drives it
over HTTP like a browser: first-admin sign-in and forced password change, CSRF refusal, role
limits, each module's create / edit / validation rules, derived balances and pending quantities,
client attention flags, jobs and sign-off, checklist runs and uploads, compliance roll-forward,
PM planning, the week planner and Excel download, CSV, search, and delete protection. Two smaller
tests cover date arithmetic and the sign-in throttling helpers.

---

## 14. How to extend

**Add a record type**

1. Append a migration with the table and indexes to `MIGRATIONS` in `src/db.js`.
2. Add a definition to `MODULES` in `src/modules.js` (fields, `listSql`, `order`, `columns`,
   `csv`, `editRoles`, views/filters, `validate` if needed).
3. Add a `NAV` entry in `src/ui.js` (and an icon in `ICONS`); add a count in `countNav` if it has
   an "overdue" state.
4. Add it to the smoke test.

**Add a field to an existing type**: migration `ALTER TABLE … ADD COLUMN`, then the field in the
module's `fields`, `columns` and `csv`.

**Add a hand-built page**: a `register(router)` in `src/routes/`, wired in `createApp`. Use
`ctx.page`, `UI.pageHeader`, `UI.table`, `C.*` cells and `html```. Mark upload routes
`{ multipart: true }`. Every POST form must include `C.csrf(ctx)`.

**Rules to keep**: no new dependencies; no inline `<script>` or `style=""` (CSP blocks them);
escape everything through `html```; derived numbers belong in views; audit every change; admins
only delete; every error message says what to do.

---

## 15. Known limits of the MVP

- Single Node process. Throttling counts live in memory and reset on restart.
- SQLite suits one site and tens of users; heavy concurrent writing would need Postgres.
- Search uses `LIKE`; no full-text index yet.
- No email, SMS or WhatsApp notifications; reminders show only inside the app.
- No GST e-invoice, Tally or bank-statement integration; amounts are typed in.
- No per-client visibility limits: everyone signed in sees every client.
- Lists cap at 2000 rows on screen (CSV has all).
- Attachments are on local disk; backups copy them but never prune.
