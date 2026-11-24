# SEI Client CRM — MVP Prompts (ASD-STE100)

These prompts use ASD-STE100 Simplified Technical English:

- Each instruction is one sentence of 20 words or fewer. It starts with a verb.
- Each description is one sentence of 25 words or fewer.
- The sentences use the active voice.
- Technical names, file names, commands and code stay as they are.

There are three prompts:

- **A. Full build prompt.** Use this prompt in an empty folder. An AI agent then writes the code for the full MVP.
- **B. Change prompt.** Use this prompt in this repository. An AI agent then adds or changes one feature.
- **C. Short description.** Use this text in a proposal, or to tell a person about the application.

The full design is in [`ARCHITECTURE.md`](ARCHITECTURE.md).

---

## A. Full build prompt

~~~text
ROLE AND TASK

You are a senior full-stack engineer.
Write "SEI Client CRM". This is an MVP web application for Services Engineering Industries (SEI).
SEI is an Indian company. It makes sheet-metal and welded parts for automotive OEMs and Tier-1 suppliers.
Between 10 and 50 SEI staff will use the application. They use office PCs and mobile phones.
Do the work in this folder.
Ask a question only if you cannot do a requirement.
If a requirement is not clear, make a decision.
Write each decision in README.md.

======================================================================
1. LIMITS THAT YOU MUST OBEY
======================================================================
1.1  Use Node.js 22.13 or a later version.
1.2  Do not use npm packages.
1.3  Use only these Node.js built-in modules: node:http, node:sqlite, node:crypto, node:zlib,
     node:fs, node:path and node:test.
1.4  Do not make a package-lock.json file or a node_modules folder.
1.5  Use SQLite through node:sqlite (DatabaseSync).
1.6  Set these SQLite options: journal_mode WAL, foreign_keys ON, busy_timeout 5000 and
     synchronous NORMAL.
1.7  Make all pages as HTML on the server.
1.8  Use HTML forms with GET and POST only.
1.9  Do not use a single-page application, a framework or a build step.
1.10 Use one small JavaScript file in the browser. This file only adds convenience.
1.11 Make each task possible when JavaScript is off.
1.12 Use a strict Content Security Policy (CSP).
1.13 Do not use inline <script> elements.
1.14 Do not use inline style="" attributes.
1.15 Do not use a CDN.
1.16 Put the font files in the project.
1.17 Use Inter for body text and numbers. Use Instrument Serif for headings.
     Both fonts have the SIL Open Font License.
1.18 Get the time zone from the configuration. The default value is Asia/Kolkata.
1.19 Use this time zone to calculate "today", "overdue" and the start of each week.
1.20 Use Indian formats. Show money as ₹ with en-IN digit groups.
1.21 Show dates as "24 Nov 2026". Keep dates in the database as YYYY-MM-DD.
1.22 Write all text on the pages in plain English.
1.23 Make each error message tell the user what to do.
1.24 Do not use words that shop-floor staff do not know.

======================================================================
2. FILES AND FOLDERS
======================================================================
Make these files. The text after each name tells what the file does.

server.js
  Starts the HTTP server. Sets headersTimeout to 30 s and requestTimeout to 300 s.
  Stops correctly on SIGINT and SIGTERM.
src/config.js
  Reads the .env file. Real environment variables have priority. Returns the configuration object.
src/app.js
  Contains the request pipeline (section 6). Makes the first admin user. Adds the demo data.
src/router.js
  Finds the route for each request. Uses patterns such as '/rfqs/:id/edit'.
  The ':id' part matches digits only.
src/http.js
  Contains HttpError and the cookie functions. Reads form data up to 1 MB.
  Contains safeReturn(). This function stops redirects to other sites.
src/html.js
  Contains the html`` tagged template. This template escapes each value.
  The raw() function marks HTML that is safe.
src/db.js
  Contains the MIGRATIONS list, the VIEWS and a database wrapper.
  The wrapper gives all, get, run, exec and tx.
  It uses named :params. It keeps prepared statements in a cache.
src/modules.js
  Contains the record-type registry (section 4).
src/crud.js
  Makes the list, form, add, change, delete and CSV functions from the registry.
src/ui.js
  Contains the page layout, the menu with counts, form controls, tables, tiles and the filter bar.
src/cells.js
  Shows values in table cells: badge, money, date, due date, telephone and email.
src/format.js
  Calculates dates in the configured time zone. Formats money and numbers for India.
  Each week starts on Monday.
src/auth.js
  Contains the roles, scrypt password hashes, password rules, sign-in limits and canEdit().
src/checklists.js
  Reads checklist items. Calculates due days. Makes the daily checklist copies.
  Calculates the scorecards.
src/planning.js
  Plans preventive maintenance (PM). Collects the data for one week.
  Makes the Excel file for one week.
src/uploads.js
  Reads multipart forms. Examines file types. Keeps files and sends them.
src/xlsx.js
  Writes .xlsx files without packages. Uses zlib deflateRaw for the zip file.
  Uses SpreadsheetML for the sheets.
src/demo.js
  Adds realistic demo data. All demo data is invented.
src/routes/*.js
  Contains the pages that you make by hand: auth, dashboard, clients, checklists,
  planning, jobs, followups, users and search.
public/
  Contains app.css, app.js, favicon.svg and the fonts folder.
scripts/backup.js
  Uses VACUUM INTO to write data/backups/<timestamp>.db. Keeps the 30 newest copies.
  Copies the new uploaded files.
scripts/planning-template.js
  Writes an Excel planning template. Staff can use it without the application.
test/smoke.test.js
  Does an end-to-end test through HTTP. Uses a temporary data folder.

Add these scripts to package.json:
  start, dev (--watch), demo (--demo), backup, sheets and test (node --test test/).

======================================================================
3. DATA MODEL
======================================================================
Rules for all tables:
- Give each business table the columns created_at and updated_at.
- Make an index for each foreign key that a list uses.
- Make an index for each status and due-date pair that an "overdue" count uses.

The lists below are the table definitions. They are technical data.

3.1 Core tables
- meta(key PK, value)
- users(name, username UNIQUE NOCASE, email UNIQUE NOCASE NULL, role, department, is_head,
  password_hash, must_change_password, active, last_login_at)
- sessions(id = sha256(token) PK, user_id, csrf, flash, expires_at)
- audit_log(at, user_id, client_id, entity, entity_id, action, summary)
- attachments(entity, entity_id, filename, stored UNIQUE, mime, size, user_id, at)

3.2 Commercial tables
Each of these tables has client_id. It refers to clients with ON DELETE CASCADE.
- clients(name UNIQUE NOCASE, status Active|Prospect|Dormant|Lost, segment, owner_id,
  vendor_code, payment_terms_days, gstin, city, state, address, website, notes)
- contacts(name, designation, department, location, mobile, phone, email, is_primary, active)
- activities(contact_id, type Call|Visit|Meeting|Email|WhatsApp|Note, occurred_on, subject,
  notes, user_id)
- followups(contact_id, title, due_on, assigned_to, status Open|Done|Cancelled, done_on, created_by)
- rfqs(contact_id, part_name, part_no, drawing_rev, material, annual_volume, rfq_ref,
  received_on, quote_due_on, status New|Costing|Quoted|Negotiation|Won|Lost|Regretted|On hold,
  quote_no, quoted_on, unit_price, tooling_cost, decision_on, lost_reason, owner_id)
- orders(rfq_id, po_no, po_date, part_name, part_no, plant, qty, unit_price, due_on,
  status Open|Closed|Cancelled)
- dispatches(order_id, dispatched_on, qty, invoice_no, user_id)
- invoices(order_id, invoice_no, invoice_date, amount incl. GST, due_on)
- payments(invoice_id, received_on, amount, deduction (TDS or debit note), mode, reference, user_id)
- complaints(contact_id, complaint_ref, received_on, category, severity Minor|Major|Critical,
  part_name, part_no, defect, qty_affected, status Open|Containment done|Root cause found|
  Action taken|Closed, owner_id, target_on, containment, root_cause, corrective_action, closed_on)

3.3 People and company checklist tables
- jobs(title, details, department, assigned_to, assigned_by, client_id NULL,
  priority Urgent|High|Normal|Low, due_on, status To do|In progress|Waiting|Done|Cancelled,
  done_on, approved_by, approved_at)
- job_updates(job_id, user_id, status, note, at)
- checklists(title, department, frequency 'Daily (Mon–Sat)'|Daily|Weekly|Monthly, weekday,
  month_day, assignee_id NULL, asset_id NULL, needs_approval, items_text, active)
- checklist_runs(checklist_id, due_on, UNIQUE(checklist_id, due_on), department, assignee_id,
  status Open|Submitted|Approved|Returned|Done, issues, remarks, submitted_by, submitted_at,
  reviewed_by, reviewed_at, review_note)
- checklist_answers(run_id, position, text, kind check|reading, unit, min, max, value, ok, note)
- compliance_items(title, category, frequency Monthly|Quarterly|Half-yearly|Yearly|One-time,
  due_on, due_day, remind_days, owner_id, department, authority, active)
- compliance_filings(item_id, period_due_on, done_on, done_by, reference, amount, note)

3.4 Weekly planning tables
The value of week_start is always a Monday.
- suppliers(name UNIQUE, category, contact_person, mobile, email, gstin, payment_terms_days,
  city, active)
- assets(code UNIQUE, name, asset_type Machine|Tool / die|Fixture|Gauge|Utility, category,
  location, make, model_no, serial_no, capacity, part_name,
  status Running|Breakdown|Idle|Scrapped,
  pm_frequency Weekly|Fortnightly|Monthly|Quarterly|Half-yearly|Yearly, pm_day, pm_minutes,
  pm_checklist, responsible_id, last_pm_on)
- pm_tasks(asset_id, planned_on, week_start, checklist, assigned_to, technician,
  status Planned|Done|Postponed|Missed|Cancelled, done_on, downtime_min, findings,
  spares_used, cost)
- sales_plans(week_start, client_id, order_id, part_name, part_no, planned_qty, rate,
  dispatch_on, owner_id)
- production_plans(plan_date, week_start, shift, asset_id, operation, client_id, part_name,
  planned_qty, produced_qty, rejected_qty, status Planned|In progress|Done|Short|Cancelled,
  shortfall_reason, supervisor_id)
- purchase_plans(required_by, week_start, category, item, spec, purpose, supplier_id, qty,
  unit, rate, status Planned|Indent raised|PO placed|Part received|Received|Cancelled, po_no,
  po_date, received_qty, received_on, owner_id)
- payment_plans(plan_date, week_start, category, supplier_id, payee, bill_no, bill_date,
  due_on, amount, priority Must pay|Normal|Can defer, mode,
  status Planned|Approved|Paid|Deferred|Cancelled, approved_by, paid_on, paid_amount, reference)
- petty_cash(plan_date, week_start, entry_type Expense|Cash top-up, head, description,
  paid_to, mode Cash|UPI, planned_amount, amount, status Planned|Paid|Cancelled, voucher_no,
  upi_ref, approved_by, user_id)

3.5 Calculated values
Do not keep calculated values in table columns.
Calculate them in SQL views.
Delete the views and make them again at each start.
- v_orders
  dispatched is the sum of dispatches.qty.
  pending is qty minus dispatched.
  The view also gives last_dispatch_on.
- v_invoices
  The view gives received and deducted.
  balance is ROUND(amount − Σ(amount + deduction), 2).
  The view also gives last_payment_on.
  An invoice is paid when balance is 0.5 or less.
- v_assets
  pm_days has these values: Weekly 7, Fortnightly 14, Monthly 28, Quarterly 91,
  Half-yearly 182, Yearly 364.
  last_done_on is the later date of the last Done PM task and last_pm_on.
  The view also gives next_pm_on and open_tasks.
- v_sales_plans
  actual_qty is the quantity sent to the client in that week.
  If the line has a PO, count the dispatches against that PO.
  If the line has no PO, count the dispatches by part.
  Do not count a PO that a different line of the same week uses.
  The view also gives planned_value, actual_value and balance_qty.

3.6 Migrations
- Keep the migrations in a list.
- Add new migrations only at the end of the list.
- Use PRAGMA user_version to record the number of migrations that ran.
- Run each step inside BEGIN IMMEDIATE.
- Read user_version again inside the lock.
- Let a step have the form { fkOff: true, up(raw) }.
- Use this form when you must make a table again with a new structure.
- In an fkOff step, stop the foreign keys first.
- In an fkOff step, run PRAGMA foreign_key_check before the commit.
- Do not change a migration after you release it.

======================================================================
4. RECORD-TYPE REGISTRY
======================================================================
Make this part first. It is the most important pattern in the application.
src/modules.js exports MODULES.
MODULES has one object for each record type.
src/crud.js must make all standard pages from MODULES.
To add a record type, add one migration and one definition. Do not add more.

4.1 Keys in a definition
key, table
  The URL segment and the SQL table.
singular, plural, many
  The words for headings, buttons and counts.
editRoles[]
  The roles that can add and change records. An admin can always do this.
canEditRow(user, row)
  Optional. Gives permission for each record. It overrides editRoles.
fields[]
  { name, label, type, required, default, options, min, positive, pattern, patternMsg,
  upper, help, section, wide, virtual, createOnly }.
  The default can be a value or fn(ctx).
listSql, order
  The base SELECT and the ORDER BY. listSql joins the names. It can read a view.
views[] {key, label, where}, defaultView
  The tabs above a list. The where text can use the date parameters
  :t, :tm7, :tm14, :tm30, :tp7, :wk, :wkp and :wkn.
filters[]
  Drop-down filters. One filter type selects a user. It has a "Me" option.
search[]
  The columns for the text search. Use LIKE with escape characters.
columns[], childColumns[]
  { label, cls, render(row, ctx) }.
csv[]
  The columns in the CSV file.
tab
  The tab on the client page that shows this record type.
noClient
  The record is not related to a client.
weekly
  The record has week_start.
homeList
  After a save, go back to the list. Do not go to the client page.
parent {field, module, table}, children[]
  A child record. Examples: dispatch → order, payment → invoice, pm_task → asset.
  The child copies client_id from the parent.
dependents[] {table, fk, one, many}, deleteHint
  Related records that stop a delete. deleteHint tells the user what to do.
readOnly
  The module has only a list and a CSV file. Its records have pages that you make by hand.
validate(data, virt, errors, ctx, existing)
  Rules that use more than one field, or that read the database.
prefill(ctx, values)
  Puts values from the query string into a new form.
beforeSave, beforeInsert, afterInsert, afterUpdate
  Hooks. They run inside the save transaction.
childSummary, formExtra, listSummary, listActions
  Extra HTML.

4.2 Field types
Do the validation in coerce() in src/crud.js.
- text: 200 characters maximum.
- textarea: 5000 characters maximum.
- int: A whole number. It must be equal to min or more than min.
- decimal: A number that can have decimals.
- money, money2: Rupees. Round the value to paise. The value must be 0 or more.
  With "positive", the value must be more than 0.
- date: A real calendar day from 1990 to 2100.
- select: The value must be one of the options.
- checkbox, email, tel, url.
- Foreign-key pickers: client, contact, user, assignee, rfq, order, invoice, supplier,
  asset, machine.

Rules for foreign keys:
- The related record must exist.
- A contact, RFQ, order or invoice must belong to the same client as the record.

4.3 Routes for each module k
GET /k
  The list. It has views, filters, search, ?client= and ?week=.
  Show 100 rows on each page.
  Show a maximum of 2000 rows. Show a note when there are more.
GET /k.csv
  All rows that agree with the filters. Excel can open the file.
  The file name is sei-k-YYYY-MM-DD.csv.
GET /k/new and POST /k/new
  Add a record.
GET /k/:id
  Go to /k/:id/edit.
GET /k/:id/edit and POST /k/:id/edit
  Change a record.
POST /k/:id/delete
  Delete a record.

Rules for these routes:
- Write an audit_log entry for each add, change and delete.
- For a change, record each field as "old value → new value".
- If a role cannot change a record, show the form as read-only. Show a note.
- Let only an admin delete a record.
- Do not delete a record that has dependents.
- When you delete a record, also delete its attached files.

4.4 Modules
Register these 21 modules:
- Commercial: clients, contacts, activities, followups, rfqs, orders, dispatches, invoices,
  payments, complaints.
- Company checklist: jobs, checklists, checklist_runs (a read-only register), compliance_items.
- Weekly planning: sales_plans, production_plans, assets, pm_tasks, purchase_plans,
  suppliers, payment_plans, petty_cash.

======================================================================
5. BUSINESS RULES
======================================================================
Apply each rule on the server.
Write a test for each rule.

5.1 Clients
- A client name must be unique. Upper case and lower case are the same.
- A GSTIN must agree with this pattern: ^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$
- Do not delete a client that has related records.
- Tell the user to set the status to Dormant or Lost.

5.2 Activities
- The activity date cannot be after today.
- The activity form has three optional fields for the next follow-up: title, date and assignee.
- These three fields are virtual. They show only on a new form.
- If the user gives a title, the user must also give a date.
- If the user gives a date, the user must also give a title.
- When the user gives both, make a follow-up.

5.3 RFQs
- When an RFQ has the status Won, show a "Create order" button.
- This button opens the order form with the values of the RFQ in it.

5.4 Orders
- Each client can have only one line for each PO, part and part number.
- The quantity cannot be less than the quantity that is already dispatched.

5.5 Dispatches
- The quantity cannot be more than the pending quantity of the PO.
- When the user changes a dispatch, add its old quantity to the pending quantity first.
- The PO picker shows only open POs.

5.6 Invoices
- The invoice number must be unique.
- If the due date is empty, calculate it: invoice date + payment_terms_days of the client.
- If the client has no payment terms, use 30 days.
- The due date cannot be before the invoice date.
- The amount cannot be less than the amount that is already settled.

5.7 Payments
- amount + deduction must be more than 0.
- amount + deduction cannot be more than the balance.
- A new payment form shows the balance as the amount.
- A deduction (TDS or debit note) also settles the invoice.

5.8 Contacts
- Do not delete a contact that other records use.
- Tell the user to clear "Still works at this client".

5.9 Jobs
- An admin can give a job to any user.
- A department head can give a job only to users in the same department.
- The assignee can write updates and change the status.
- Show Start and Done buttons in the lists.
- The assignee cannot change the job details. The assignee cannot cancel the job.
- The person who gave the job can change it or cancel it.
- The head of the department and an admin can also change or cancel the job.
- Keep each update and each change in job_updates.
- A Done job must get a sign-off from the giver, the head or an admin.
- If one of them sends the job back, set the status to In progress.
- Give these views: My jobs, Given by me, My department, Overdue, All open, Done.

5.10 Checklists: items
- items_text has one item on each line.
- Remove bullets and numbers at the start of a line.
- "Text [5-6 kg/cm²]" is a reading with limits.
- "Text [litres]" is a reading without limits.
- All other lines are checks. The answers are OK, Not OK and N/A.
- A checklist has a maximum of 80 items.

5.11 Checklists: due days
- "Daily (Mon–Sat)": every day except Sunday.
- "Daily": every day.
- "Weekly": on the selected weekday.
- "Monthly": on month_day. The value 31 means the last day of the month.

5.12 Checklists: daily copies
- At the first request of each day, make the copies for all due days since the last time.
- Go back a maximum of 31 days.
- Use INSERT OR IGNORE.
- Thus a day without users still counts as a missed day.
- If a user changes a template, change today's copy only if nobody started it.

5.13 Checklists: fill-in and sign-off
- A Not OK answer must have a note.
- A reading outside its limits must have a note.
- The user can attach a maximum of 5 photos or PDF files.
- If needs_approval is set, the status goes to Submitted. Then it goes to Approved or Returned.
- A Returned copy must have a remark.
- If needs_approval is not set, the status goes to Done.
- The assignee, the department head and an admin can fill in a copy.
- If the copy has no assignee, each user in the department can fill it in.
- The department head or an admin can sign off a copy.
- A user cannot sign off a copy that the same user submitted. An admin can.
- A copy with no problems can get a sign-off from the list.

5.14 Compliance
- "Mark done" records a filing: the date, the reference, the amount and a proof file.
- Then move due_on to the next period.
- Keep due_day. Thus a due date on the 31st does not change to the 28th.
- An admin, an accounts user, the owner and the department head can mark an item done.
- Let an admin add a standard Indian calendar.
- The calendar has TDS on the 7th, GSTR-1 on the 11th, PF/ESI on the 15th and GSTR-3B on the 20th.
- It also has advance tax, quarterly TDS returns, AOC-4, MGT-7, company ITR and GSTR-9.
- Show a note on the page: the government can extend these dates.

5.15 Preventive maintenance
The "Plan PM for this week" button operates on any week.
Do these steps for each asset that is not scrapped and has a PM frequency:
1. If the asset has a task in that week that is not cancelled, go to the next asset.
2. If the asset has an open task with a planned day in the past, go to the next asset.
   Show that task as overdue.
3. Find the later date of these two: the last done date and the last open planned date
   before this week.
4. Add pm_days to that date. The result is the due date.
5. If the asset never had PM, the due date is the start of the week.
6. If the due date is after the last day of the week, go to the next asset.
7. Plan a task on the PM day of the asset.
8. Give the task the checklist and the responsible person of the asset.
Do all the steps in one transaction.
Write an audit entry for each task.
Return the list of new tasks.

5.16 Production
- When the user enters produced_qty, set the status to Done or Short automatically.

5.17 Petty cash
- Cash in the box = paid cash top-ups − paid cash expenses.
- UPI payments do not change the cash in the box.
- A UPI payment must have a UPI reference.

5.18 Payment plan
- If the bill due date is empty, calculate it: bill date + payment_terms_days of the supplier.

======================================================================
6. REQUEST PIPELINE AND SECURITY
======================================================================
6.1 Request pipeline
In app.handle(), do these steps in this sequence:
1.  Read the URL. If the URL is not correct, send 400.
2.  Make ctx. It contains req, res, cfg, db, path, method, query, params, body, cookies and ip.
3.  Treat HEAD as GET.
4.  Send the files in /static/. Examine each file name with a strict regular expression.
5.  Let browsers keep font files for 1 year.
6.  Send "ok" for /healthz.
7.  Read the session. Calculate the sha256 of the cookie token.
8.  Find the session. Join it to an active user.
9.  Find the route.
10. If there is no route, send a signed-out user to /login. Send 404 to a signed-in user.
11. If a private route has no user, send a redirect. Do this before you read the body.
12. Read the body. Accept urlencoded forms up to 1 MB.
13. Accept multipart forms up to 41 MB only on routes with {multipart:true}.
14. Send 415 for all other body types.
15. Examine the CSRF token on each private POST.
16. Compare _csrf with the session token in constant time.
17. If must_change_password is set, let the user open only routes with allowPasswordChange.
18. Run the handler.
19. If an error occurs, show a friendly error page.
20. Write the details of 5xx errors only to the server log.

6.2 Headers
Send these headers with each response:
- Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self';
  font-src 'self'; script-src 'self'; form-action 'self'; frame-ancestors 'none';
  base-uri 'none'; object-src 'none'
- X-Content-Type-Options: nosniff
- X-Frame-Options: DENY
- Referrer-Policy: same-origin
- Permissions-Policy: camera=(), microphone=(), geolocation=()
- Cache-Control: no-store (on pages)
- Strict-Transport-Security (when COOKIE_SECURE=1)

6.3 Roles
Each signed-in user can see all data.
The roles can change these records:
- admin: All records. This includes users and all deletes.
- sales: clients, contacts, RFQs, orders, dispatches, complaints, activities, follow-ups
  and the sales plan.
- accounts: invoices, payments, contacts, activities, follow-ups, the payment plan,
  petty cash and suppliers.
- quality: complaints, contacts, activities, follow-ups and PM tasks.
- production (production and maintenance): the production plan, assets and PM tasks.
- purchase (purchase and stores): suppliers and the purchase plan.
- viewer: No records.

6.4 Departments
- The departments are: Management, Sales, Accounts, Quality, Production, Maintenance,
  Tool room, Purchase & stores, Dispatch & logistics, HR & admin.
- Each user has an optional department and an is_head flag.
- A head gets more permissions in the same department.
- These permissions are for jobs, checklist templates, sign-off and compliance.
- These permissions are in addition to the role.

6.5 Sign-in
- The user signs in with a user name. The application also accepts an email address.
- Use scrypt for password hashes: N=16384, r=8, p=1, keylen 64.
- Examine passwords asynchronously.
- Examine a maximum of 2 passwords at the same time. Let a maximum of 64 wait.
- If more requests arrive, send 503 with the message "busy".
- If the user name does not exist, examine a dummy hash. Thus the time is the same.

6.6 Sign-in limits
- Keep the counts in memory.
- When there are too many keys, remove the keys that you used least recently.
- Count each attempt before you examine the password.
- Remove that count when the password is correct.
- For each IP address, permit 30 failures in 15 minutes.
- For IPv6, use the /64 block as the address.
- Change IPv4-mapped IPv6 addresses to IPv4.
- For each IP address and account pair, permit 10 failures.
- For each account from all addresses, permit 5 failures without a wait.
- After 5 failures, make the account wait 1, 2, 4 ... up to 60 seconds between attempts.
- Refuse an attempt that comes before the end of the wait. Do not delay it.
- Give a signed HMAC "known browser" cookie for 180 days.
- With this cookie, the owner of the account does not wait.

6.7 Password rules
A new password must agree with all these rules:
- It has 10 to 200 characters.
- It has at least 5 different characters.
- It is not only digits.
- It is not a common word. Change leet characters back to letters before you compare.
- It is not a keyboard sequence.
- It is not the name, user name or email of the user.

6.8 Sessions
- Put a 32-byte random token in the cookie.
- Set HttpOnly and SameSite=Lax on the cookie.
- Set Secure when the configuration tells you to.
- Keep only the sha256 of the token in the database.
- When a user changes the password, close all other sessions of that user.

6.9 First start
- On an empty database, make the user "admin".
- Give this user a one-time password that is easy to read.
- Write the password to data/first-login.txt with mode 0600.
- Make the admin change the password.
- Delete the file after the change.
- Let the admin make all other users.
- Give each new user a one-time password. Show it only to the admin.

6.10 Other security rules
- Give the login form its own double-submit CSRF cookie.
- After sign-in, send the user only to a path on the same site. Use safeReturn().
- Use X-Forwarded-For only when TRUST_PROXY=1 and the peer is loopback.
- From X-Forwarded-For, use only the last address.
- Do not start demo mode unless HOST is loopback and COOKIE_SECURE is off.
- Show a warning if HOST is not loopback and COOKIE_SECURE is not 1.
- Examine TZ_NAME at start.

6.11 Uploads
- Write your own multipart parser.
- Accept a maximum of 5 files. Each file must be 8 MB or less.
- Accept only JPEG, PNG, WebP and PDF files.
- Find the file type from the first bytes of the file.
- Do not use the file name or the type that the browser sends.
- Keep each file as <uuid>.<ext> with mode 0600 in data/uploads.
- Write the file inside the transaction of its record.
- Send files only through /attachments/:id.
- Examine the stored name with a strict pattern.
- Remove unsafe characters from the file name in Content-Disposition.
- On systems that are not Windows, set umask 077.
- On systems that are not Windows, set the data folder to 0700.

======================================================================
7. PAGES
======================================================================
7.1 Sign-in pages
Make /login, /account/password and POST /logout.

7.2 Dashboard (/)
The dashboard changes with the role of the user.
- "Your day" (all users)
  Show checklists to fill in, sign-offs that wait, open jobs, follow-ups and compliance dates.
  For each, show the number of late items.
- Commercial part (sales, accounts and management)
  Show the clients that need attention and my follow-ups.
  Show the money owed, by age.
  Show the deliveries that are late or due this week.
  Show the recent calls and visits.
- Plant part (production, maintenance, quality, stores and dispatch)
  Show "Plant today": today's production plan, PM due and machines with a breakdown.
  Also show material due and deliveries due.
- Admins see both parts.

7.3 Client list (/clients)
- Use one grouped query for each page.
- For each client, the query calculates open POs, late POs, money owed and money overdue.
- It also calculates the last contact, open follow-ups and overdue follow-ups.
- It also calculates open RFQs, quotes older than 14 days, open complaints and critical complaints.
- Give flags with these weights:
    Overdue money ................................................ 3
    Late PO ...................................................... 3
    Critical complaint ........................................... 3
    Open complaint ............................................... 2
    Overdue follow-up ............................................ 2
    Quote to chase ............................................... 1
    Active client with no contact in more than 30 days ........... 1
    Active client with no contact at all ......................... 0.5
- The score is the sum of the weights.
- Sort by score first.
- Let the user sort by money owed.
- Let the user filter by "needs attention" (score 1 or more).
- Let the user filter by status, segment and account manager.

7.4 Client page (/clients/:id)
- Make these tabs: Overview, Contacts, RFQs & quotes, Orders & deliveries, Invoices & dues,
  Complaints, Company details.
- On each tab, show a count.
- On the Overview tab, put a quick form to log a call or visit.
- This form can also add the next follow-up.
- The Overview tab also shows a timeline of activities and audit entries.
- It also shows the open follow-ups and the contacts.

7.5 Module pages
Make the lists and forms for all 21 modules from the registry (section 4).

7.6 Checklist pages
- /my-checklists: Show the copies to fill in today and the copies missed in the last 14 days.
  Also show the copies done today.
- /checklist_runs/:id: Show the fill-in form.
  Use large OK, Not OK and N/A buttons.
  Add reading fields, notes and a camera upload.
- /approvals: Show the checklist copies and finished jobs that wait for my sign-off.
- The register has these views: Today, Missed, With problems, Waiting for sign-off,
  This week, All.
- /scorecards: Show one week (Monday to Sunday), by department and by person.
  Show checklists on time, late and missed, and the problems found.
  Show jobs on time and late, PM done and compliance overdue.
  Let the user open earlier weeks.
- Give admins a button that adds these 12 standard checklists:
    Press start-up check, Welding cell start-up check, Shop floor 5S round, Safety round,
    First-piece and gauge check, Stores closing, Dispatch closing,
    Compressor and utilities check, Weekly accounts close, Weekly maintenance review,
    Fire extinguisher inspection (monthly), Gauge calibration review (monthly).
- Give admins a button that adds the statutory calendar.

7.7 Week planner (/planning)
- Let the user open any week.
- Show a tile for each plan.
- Show a board with one column for each day.
- The board shows PM, production, dispatches, material due, payments and petty cash.
- Show a cash view: money due from customers, payments out and the cash in the box.
- Show a list of items that need attention:
    Production on a machine with a breakdown.
    Production on a machine with PM on the same day.
    PM, purchases and payments from earlier weeks that are not done.
- Add a "Plan PM for this week" button.
- Add a "Download week as Excel" button. It opens /planning.xlsx?week=.
- Give each PM task a Done button that needs one click.

7.8 Search (/search)
- Search clients, contacts, phone numbers and part numbers.
- Also search PO numbers, invoice numbers and complaint numbers.
- For a phone number, compare digits only.
- Show the results in groups.
- Make the "/" key move the cursor to the search box.

7.9 Users (/users, admin only)
- Let the admin add users.
- Let the admin change the role, department, head flag and active flag.
- Let the admin reset a password. The user then gets a new one-time password.
- If the user name is empty, make it from the name of the person.
- Make the email optional.

7.10 Menu
- Put the menu on the left.
- On a phone, let the user open and close the menu.
- Show a count badge on some items. The text in brackets tells what the count is.
- Dashboard, Clients, Contacts, Jobs (my open jobs), Follow-ups (my follow-ups that are due),
  Activity log.
- Company checklist: My checklists, Approvals, Compliance (due in the reminder period),
  Scorecards.
- Business: RFQs & quotes, Orders & deliveries (late POs), Invoices & dues (overdue),
  Quality complaints (open).
- Weekly planning: Week planner, Sales plan, Production plan, Preventive maintenance
  (overdue), Machines & tools (breakdown).
- Also in Weekly planning: Purchase plan (late), Suppliers, Payment plan (overdue),
  Petty cash.
- Admin: Users.

======================================================================
8. APPEARANCE
======================================================================
- Use these brand colors: navy #14263d and action red #c83b43.
- Use #f4f6f8 and #e6ebf0 as background colors.
- Use a simple ring as the logo.
- Use Instrument Serif for headings.
- Use Inter with tabular figures for body text and all numbers.
- Make a dense, calm business interface.
- Use the tone classes ok, warn, bad, info and muted.
- Use each tone class in the same way on all pages.
- On a phone, show each table row as a card of labels and values.
- Do not let a page move sideways on a phone.
- Make the checklist OK, Not OK and N/A buttons 44px tall or more.
- Put a "Download as CSV" link on each list.
- Show a message after each save.
- Ask for confirmation before a destructive action. Use data-confirm on the form.
- In demo mode, show a banner.
- Let app.js do only these tasks:
    Show the confirmation dialogs.
    Open and close the phone menu.
    In pickers, show only the contacts, RFQs, POs and invoices of the selected client.
    Submit a filter form when a drop-down changes.
    Make a note necessary for a Not OK answer or a reading outside its limits.
    Examine the number and size of files before the upload.
    Move the cursor to the search box when the user pushes "/".

======================================================================
9. START DATA AND DEMO DATA
======================================================================
- At the first start, add the SEI customers one time:
    Maruti Suzuki, Suzuki, CNH Industrial, Escorts, Piaggio, Kongsberg Automotive,
    JBM Group, Bellsonica, NIFCO, Terra Motors, Krishna Maruti, IFB, Groz, Aditya,
    Udaan, Jupiter.
- Set the segment only where it is clear.
- For npm run demo, use a separate database, data/demo.db, on port 3001.
- Add invented contacts, RFQs, orders, dispatches, invoices, payments and complaints.
- Add a full planning week, machines with PM history, jobs and checklist copies.
- Make sure that each page shows data.
- Make these demo users:
    admin
    anil (sales head)
    pooja (sales)
    rakesh (accounts head)
    sunil (quality head)
    vijay (production head)
    neeraj (purchase head)
    kavita (accounts)
    ramesh (fitter, viewer role, has jobs)
    viewer
- Give all demo users the DEMO_PASSWORD from .env.example.

======================================================================
10. OPERATION
======================================================================
- Make .env.example with these settings: HOST, PORT, DATA_DIR, DB_FILE, ADMIN_EMAIL,
  TZ_NAME, SESSION_DAYS, COOKIE_SECURE, TRUST_PROXY and DEMO_PASSWORD.
- Make all settings optional. Give each setting a default value.
- Write README.md for an owner who is not a developer.
- In README.md, tell how to start the application and how to do the first sign-in.
- Also tell about the demo, the roles, daily use, jobs, checklists, compliance and weekly planning.
- Also tell about Excel, sign-in protection, backups, settings and notes for developers.
- For backups, tell the owner to make a backup each day.
- Tell the owner to copy the backups to a different computer.
- For a VPS, tell the owner to do these steps:
    Use a systemd unit with UMask=0077.
    Use Caddy with request_body max_size 45MB.
    Set COOKIE_SECURE=1 and TRUST_PROXY=1.
    Do not open port 3000 to the internet.

======================================================================
11. TESTS AND COMPLETION
======================================================================
- Write test/smoke.test.js with node:test.
- Make the test start the application in a temporary DATA_DIR.
- Make the test send real HTTP requests and keep the cookies.
The test must examine these items:
- The first admin sign-in and the forced password change.
- The CSRF refusal (403).
- Role limits. A viewer gets 403 for a change. A user with the wrong role also gets 403.
- Each business rule in section 5.
- pending in v_orders.
- balance in v_invoices with a TDS deduction.
- The client attention flags.
- The job flow, with sign-off and send-back.
- Checklist copies for missed days.
- A reading outside its limits without a note. The application must refuse it.
- The upload type check. The application must refuse a false .jpg file.
- The sign-off rules.
- A compliance due date on the 31st. The next date must be on the 31st when the month has one.
- The PM plan function. A machine must not get two tasks in one week.
- The week planner and the Excel download. The file must be a valid zip file.
- The CSV export, the search and the delete protection by dependents.
- The sign-in limit functions.
- Date calculations at the end of a month and in leap years.

The work is complete when all these conditions are true:
- npm test passes.
- npm start in an empty folder makes the database and the first-login file.
- npm run demo shows data on each page.
- The browser console shows no errors.
- The browser shows no CSP violations.
- Each page is usable at a width of 375px.
- The project has no npm packages.

======================================================================
12. WORK SEQUENCE
======================================================================
Do these steps in this sequence:
1. Write config, http, html, router and db with migration 1 and the wrapper.
   Then write the app pipeline, sign-in, sessions and the layout.
2. Write the registry and the generic CRUD.
   Then write clients, contacts, activities and follow-ups.
   Then write the client page and the audit timeline.
3. Write RFQs, orders with dispatches, invoices with payments and complaints.
   Then write the views, the dashboard, search and CSV.
4. Write user administration, departments, heads and jobs with updates and sign-off.
5. Write the checklist engine, approvals, the register, compliance, uploads and scorecards.
6. Write suppliers, assets, PM tasks with automatic PM plans and the five weekly plans.
   Then write the Week planner.
7. Write the xlsx writer, the week download and the template script.
   Then write the backup script.
8. Write the demo data, README.md and the full smoke test.
   Then examine each page on a phone and for CSP errors.
After each step, run the tests.
Make sure that all tests pass before you start the next step.
~~~

---

## B. Change prompt (for work in this repository)

~~~text
ROLE AND CONTEXT

You work in the SEI Client CRM repository.
The application uses Node.js and node:sqlite. The server makes all pages as HTML.
The application has no npm packages.
First, read docs/ARCHITECTURE.md and README.md.
Then read the files that you will change.

TASK

<Write the feature or the change in plain words.>
<Tell who uses it.>
<Tell what "complete" means for this task.>

OBEY THE CURRENT DESIGN

New record type
1. Add a migration at the end of MIGRATIONS in src/db.js.
2. Do not change a migration that is released.
3. Add a definition to MODULES in src/modules.js.
4. Add a NAV entry and an icon in src/ui.js.
5. If the record type can be overdue, add a count in countNav.
6. Let src/crud.js make the pages.

New field
1. Add an ALTER TABLE migration.
2. Add the field to fields, columns and csv in the module definition.

Calculated values
- Calculate them in SQL views in VIEWS.
- Do not keep them in table columns.

Page that you make by hand
- Add register(router) in src/routes/.
- Connect it in createApp.
- Use ctx.page, UI.pageHeader, UI.table, the C.* cells and html``.
- Put C.csrf(ctx) in each POST form.
- Mark upload routes with { multipart: true }.

Permissions and audit
- Use editRoles or canEditRow, and canEdit().
- Let only admins delete.
- Write an audit entry for each change.

RULES

- Do not add npm packages.
- Do not use inline <script> or style="". The CSP stops them.
- Escape all values with html``.
- Write labels and errors in plain English.
- Make each error tell the user what to do.
- Use Indian ₹ and date formats.
- If you change public/app.css or public/app.js, increase ASSET_V in src/ui.js.
- Update README.md for each change that users can see.
- Update docs/ARCHITECTURE.md for each change to the design.
- Add tests to test/smoke.test.js.
- Run npm test. Continue until all tests pass.
- Examine each changed page at a width of 375px.

REPORT

Before you write code, list the files that you will change.
Also tell which migration you will add, if you add one.
After you write code, tell what changed.
Give the test result.
Tell which items you did not examine.
~~~

---

## C. Short description

> SEI Client CRM is a web application for Services Engineering Industries. The company operates
> it on its own computer or server. It keeps all customer data in one location: customers,
> contacts, calls, follow-ups, RFQs, POs, dispatches, invoices, payments and quality complaints.
> It shows which clients need attention, for example overdue money, late POs, critical
> complaints, quotes to chase and no contact in 30 days.
>
> The application also controls the work of the plant for each week. It has plans for sales,
> production, purchases, payments and petty cash. It plans preventive maintenance for each
> machine and tool. It has daily checklists with photos and a sign-off by the department head. It
> also has jobs for each person, the statutory compliance calendar and weekly scorecards.
>
> The application operates with only Node.js and SQLite. It does not need an installation or an
> internet connection. It operates on mobile phones, and it exports CSV and Excel files. It has
> protection for use on a VPS with HTTPS: a strict CSP, CSRF tokens, scrypt passwords and sign-in
> limits. An audit log records each change, and the owner can make a backup each day.
