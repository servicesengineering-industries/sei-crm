# SEI Client CRM

A client CRM for Services Engineering Industries. It keeps every client in one place, along with:

- the people SEI deals with there and their numbers;
- every call, visit and note, plus follow-ups with due dates;
- RFQs and quotes, from drawing received to won or lost;
- purchase orders, dispatches and what is still pending;
- invoices, payments (including TDS and debit notes), dues and overdue days;
- quality complaints, from containment to closure;
- weekly planning: sales, production, preventive maintenance for each machine and tool, purchase, payments and petty cash (Cash / UPI), on one Week planner page and as Excel sheets.

The dashboard and the client list flag the clients that need attention: money overdue, late POs, critical or open complaints, overdue follow-ups, quotes to chase and clients nobody has contacted in 30 days.

It runs on Node.js alone (version 22.13 or newer; this PC has 26). There is nothing to install: the database is SQLite through Node's built-in `node:sqlite`, and the fonts are bundled.

## Start it

From this folder:

```powershell
npm start
```

Open http://127.0.0.1:3000.

On the very first start the app creates the database in `data/`, adds SEI's clients from sei.co.in to the client list, and creates one admin account. **The admin's user name (`admin`) and one-time password are in `data/first-login.txt`.** Sign in with them, choose your own password, and the file deletes itself.

Then go to **Users** and add everyone else. Each person gets a one-time password that only you see, and chooses their own when they first sign in.

## Try it with made-up data first

```powershell
npm run demo
```

Open http://127.0.0.1:3001. This uses a separate database, `data/demo.db`, filled with invented contacts, RFQs, orders, invoices and complaints so every screen has something on it. It never touches the real database.

Demo user names: `admin`, `anil` (sales), `pooja` (sales), `rakesh` (accounts), `sunil` (quality), `vijay` (production & maintenance), `neeraj` (purchase & stores), `kavita` (accounts), `ramesh` (a fitter with a view-only role, who has jobs to do) and `viewer` (view only). Anil, Rakesh, Sunil, Vijay and Neeraj are the heads of Sales, Accounts, Quality, Production and Purchase & stores. They all use the `DEMO_PASSWORD` from `.env.example`. To start the demo again from scratch, stop it and delete the `data/demo.*` files. Because that password is published here, demo mode refuses to start unless `HOST` is `127.0.0.1` and `COOKIE_SECURE` is off.

## Roles

| Role | Can change |
|---|---|
| Admin | Everything, including users and deleting records |
| Sales | Clients, contacts, RFQs and quotes, orders and dispatches, complaints, activities, follow-ups, the sales plan |
| Accounts | Invoices and payments, contacts, activities, follow-ups, the payment plan, petty cash, suppliers |
| Quality | Complaints, contacts, activities, follow-ups, PM tasks |
| Production & maintenance | The production plan, machines and tools, PM tasks |
| Purchase & stores | Suppliers and the purchase plan |
| View only | Nothing; can see everything |

Everyone who can sign in can see every client. Only admins can delete, and a client with any linked records (jobs included) can't be deleted. Set it to Dormant or Lost instead. In the same way, a checklist with any filled-in or missed day, and a compliance item with any filing, can't be deleted: untick **In use** instead, so the history stays. A checklist made by mistake today can still be deleted. Deleting or changing a logged call or visit shows on the client's timeline.

## Everyday use

- **The dashboard fits the person.** Everyone gets **Your day** at the top: checklists to fill in, sign-offs waiting, open jobs, follow-ups and compliance dates, each with what is late. Sales, accounts and management then see money owed, late deliveries, RFQs, complaints and the clients needing attention. Production, maintenance, quality, stores and dispatch people see **Plant today** instead: today's production plan, PM due, machines under breakdown and material due, plus deliveries due. Admins see both.
- **On a PC**, the menu is a strip of icons across the top of the page. To see the rest of it, use the arrows at each end, turn the mouse wheel over the strip, or swipe sideways on a touchpad. The current page's item starts in the middle.
- **On a phone**, every list shows each row as a small card of label and value, so nothing scrolls sideways. The filters fold behind one **Filters** button (it stays open while a filter is in use), buttons are big enough for a finger, and **Change password** is in the menu.
- Long lists show 100 rows a page, with Previous and Next at the bottom. Totals above a list, and the CSV download, still cover every row that matches.
- **Log a call or visit** from the client's page. Add a next follow-up in the same form and it lands on that person's dashboard.
- **With the keyboard**: in a list's filters the arrow keys only move through the choices; press **Apply** to use them. After a failed save, the focus goes to the summary of what to correct, and each field is read out with its error or help.
- **Search** (top bar, or press `/`) finds clients, people, phone numbers (digits only is fine), part numbers, PO, invoice and complaint numbers.
- **A new PO from an RFQ**: press **Create PO from this RFQ** on a won RFQ, or choose the RFQ under **From RFQ** on a new PO. Either way the client, part, part no and rate fill in by themselves (choosing from the list fills only the fields that are still empty).
- **Invoice due dates** come from the client's payment terms if you leave them blank. Without terms set, the app uses 30 days.
- **Payments**: record what came in plus any TDS or debit-note deduction. Both count towards settling the invoice.
- **The status must agree with the record.** A complaint moves to Root cause found, Action taken or Closed only with its root cause (and, from Action taken, its corrective action). A quote that is Quoted, in Negotiation or Won has its price. Short production says why. A purchase is Received only when all of it is in; otherwise choose Part received. A closed or cancelled PO takes no new dispatches. A client's complaint number can be entered once.
- **Dates must be in order.** A quote's due, sent and decision dates, and a complaint's target and closed dates, come on or after the date it was received. A PO's delivery date comes on or after the PO date, and a supplier bill's due date on or after the bill date. A payment comes on or after its invoice date. Things that have already happened (a dispatch, a payment received, a complaint received or closed, a PO or bill date, material received) can't be dated in the future.
- Every list has a **Download as CSV** link that opens in Excel.
- Every change is recorded with who made it, and shows on the client's timeline.

## People, departments and jobs

Everyone signs in with their own **user name** and password, such as `anil` or `ramesh.k`. An admin creates each login on **Users** and hands over the one-time password. The user name is made from the person's name if left blank. Email is optional, so people without one can still have a login; typing an email at sign-in also works for anyone who has one. On the same page the admin sets each person's **department** (Management, Sales, Accounts, Quality, Production, Maintenance, Tool room, Purchase & stores, Dispatch & logistics, HR & admin) and ticks **Head of this department** for its head. Being a head comes on top of the person's role.

**Jobs** (menu, and **My jobs** on the dashboard) are tasks handed to people:

- **Admins** give jobs to anyone. **Department heads** give jobs to people in their own department only. Each job has a due date, a priority (Urgent, High, Normal, Low) and, optionally, a client, so it also shows on that client's timeline.
- The **person doing it** opens the job, posts updates and moves it from To do to In progress, Waiting and Done. **Start** and **Done** buttons sit in every list. They can't change the job's details or cancel it.
- The person who gave the job, the head of its department and admins can change or cancel it. Every update and change is kept as the job's history, with who did it and when.
- Views: **My jobs**, **Given by me**, **My department**, **Overdue**, **All open** and **Done**. The menu shows how many open jobs you have.

## Company checklist

Under **Company checklist** in the menu. It covers the daily and weekly checks, statutory due dates and renewals, sign-off by heads, and a weekly score for each person and department. It works the same on a phone and a PC.

**Checklist templates** (open **Templates** on My checklists) say what gets checked, how often and by whom:

- How often: every working day (Monday to Saturday), every day, weekly on a chosen day, or monthly on a chosen day of the month (31 means the last day).
- **Filled in by**: one person, or blank for anyone in the department. Optionally a machine or tool from Machines & tools.
- **The head signs off each one**: when ticked, a filled-in checklist waits for the department head. When not ticked, it is done once submitted.
- Admins set up checklists for any department. Department heads set them up for their own department only.
- **Add standard checklists** (admins) loads 12 starting checklists for a sheet-metal and welding plant: press and welding cell start-up, 5S round, safety round, first-piece and gauge check, stores closing, dispatch closing, compressor and utilities, the weekly accounts close and maintenance review, the monthly fire extinguisher inspection and gauge calibration review. Edit them, or add your own company checklists the same way.

**Items to check** go one per line in the template. Numbers or bullets at the start of a line are dropped.

```
Guards and light curtain in place and working
Air pressure at the clutch [5-6 kg/cm²]
Diesel level [litres]
```

- A plain line is answered **OK**, **Not OK** or **N/A**.
- A line ending in limits in square brackets asks for a reading. A reading outside the limits counts as a problem.
- A line ending in just a unit, like `[litres]` or `[₹]`, asks for a reading with no limits.

**My checklists** shows what is to be filled in today, what was missed in the last two weeks, and what is done today. Each day a checklist is due, a fresh copy appears by itself. A day nobody opened the app still counts, so nothing goes missing silently.

- Filling in: big OK / Not OK / N/A buttons, a box for each reading, and a note on every item. A Not OK answer, or a reading outside its limits, needs a note saying what is wrong or what was done.
- **Photos or PDF**: up to 5 at a time, 8 MB each, taken straight from the phone camera. JPG, PNG, WebP and PDF only, checked by the file's content.
- The phone checks the form before it sends anything: every item needs an answer, Not OK and a reading outside its limits need a note, and the photos must be within the limits. So a missed item never costs you the photos.
- A checklist that was sent back shows the head's remark at the top, ready to fill in again.

**Sign-offs** lists the checklists and finished jobs waiting for you. A checklist with no problems can be signed off from the list. Otherwise open it to see the answers, notes and photos, then **Sign off** or **Send back** with a remark. Department heads sign off their department, admins sign off anything, and nobody signs off a checklist they filled in themselves (except an admin). Finished jobs wait for the person who gave them, the department head or an admin. Sending a job back reopens it as In progress.

**Checklist register** (the **Register** button on My checklists) is the full record: who filled in each checklist and when, what was wrong, and who signed it off. Views: Today, Missed, With problems, Waiting for sign-off, This week, All. It downloads as CSV.

**Compliance** is the calendar of statutory returns, payments and renewals:

- **Add standard statutory dates** (admins) loads the usual due dates: TDS deposit (7th), GSTR-1 (11th), PF and ESI (15th), GSTR-3B (20th), advance tax and quarterly TDS returns, AOC-4, MGT-7, the company income tax return and GSTR-9. Dates move when the government extends them, so check before filing.
- Add your own items with their real dates: factory licence, fire NOC, pollution control consent, insurance policies, weighing scale stamping, air receiver test and others. Each has an owner, a department, how often it recurs and how many days before to remind.
- **Mark done** records the date, reference number, amount paid and the challan or acknowledgement as proof, then moves the due date to the next period. Each item keeps its full history, showing whether each filing was on time.
- The menu counts items due within their reminder window or overdue. Admins, accounts, the item's owner and the department head can mark items done.

**Scorecards** show each week (Monday to Sunday) by department and by person. On time means filled in, or a job finished, by the day it was due. The page shows checklists done on time, late and missed, the problems they found, jobs done on time and late, PM tasks done, and compliance items overdue. Earlier weeks are one click away.

## Weekly planning

Under **Weekly planning** in the menu. Every plan works week by week (Monday to Sunday) and opens on this week, with next week and last week one click away.

- **Week planner**: the whole week on one page. Tiles for each plan, a day-by-day board (PM, production, dispatches, material due, payments, petty cash), a cash view (client money due in against payments out) and a list of what needs attention: production booked on a machine under breakdown or with PM that day, PM, purchases and payments left over from earlier weeks.
- **Machines & tools**: every machine, die, fixture and gauge, each with its own PM frequency, PM day, responsible person and checklist. A machine's page shows its PM plan and full PM history. Monthly PM is every 4 weeks, quarterly 13, half-yearly 26 and yearly 52, so each PM lands in a planning week.
- **Preventive maintenance**: press **Plan PM for this week** on the Week planner (any week) to add a PM task for every machine and tool that falls due, on its PM day, with its checklist. It never plans a machine twice, and a PM whose day has passed without being done stays as overdue instead of being planned again. Mark a task **Done** in one click, then open it to add findings, spares, cost and downtime.
- **Sales plan**: planned dispatch quantity per client and part (or PO) for the week. What was actually dispatched that week is counted from the dispatches, so there is nothing to type twice.
- **Production plan**: day, shift and machine plan with produced and rejected quantities. The status turns Done or Short by itself when the produced quantity is entered.
- **Purchase plan** and **Suppliers**: what to buy, from whom, by when, the PO and what was received. Late items are counted on the menu.
- **Payment plan**: supplier bills, salaries, statutory dues and other payments for the week, with priority (Must pay first), approval and payment details. The bill due date comes from the supplier's credit days if left blank. Only an admin or the head of Accounts can set a payment to Approved, and **Approved by** then shows their name by itself; nobody can type in another person's name. On petty cash, too, only an admin or the head of Accounts can fill in Approved by, and only with their own name.
- **Petty cash (Cash / UPI)**: small payments planned and paid in cash or by UPI, plus cash put into the box. It keeps the cash in the box (only cash payments reduce it) and asks for the UPI reference on UPI payments.

**Excel sheets.** On the Week planner, **Download week as Excel** gives that week's workbook from live data: summary, sales, production, PM, machines and tools, purchase, payment, client payments due, and petty cash. For planning in Excel without the CRM:

```powershell
npm run sheets
```

This writes two files to `sheets/`: `SEI Weekly Planning Template.xlsx`, with every plan, drop-down lists, formulas, a week summary, a 52-week PM calendar and one PM card per machine or tool, and `SEI Weekly Plan - demo week.xlsx`, a sample of the download. The example rows in both are the made-up demo data.

## Sign-in protection

- One address can try 30 wrong passwords in 15 minutes, and 10 for any one account. IPv6 addresses count by their /64 block.
- One account, tried from anywhere, gets 5 wrong passwords free. After that, each attempt has to wait 1, 2, 4 and up to 60 seconds after the last one. Early attempts are refused, so sending many at once doesn't help.
- A browser that has signed in to an account before skips that wait. So if someone is guessing your password, you can still sign in from your usual PC or phone.
- Passwords are checked off the main thread, a few at a time. A flood of sign-in attempts can't freeze the app for people already signed in.
- New passwords need at least 10 characters. Common ones such as `Welcome@123`, `Admin@2026`, keyboard runs or a phone number are refused.
- The counts are kept in memory, so restarting the app clears them.

## Backups

```powershell
npm run backup
```

This writes a dated copy of the database to `data/backups/` and keeps the newest 30. It also copies new photos and PDFs from `data/uploads/` to `data/backups/uploads/`. It is safe while the app is running. Schedule it daily (Windows Task Scheduler on a PC, cron on a VPS) and copy the whole `data/backups/` folder somewhere off the machine.

## Moving to a VPS later

1. Install Node.js 22.13 or newer (the current LTS is fine) on the server.
2. Copy this whole folder across, including `data/` so you keep your records. Stop the app on the PC first.
3. Copy `.env.example` to `.env` and set `COOKIE_SECURE=1` and `TRUST_PROXY=1`. Keep `HOST=127.0.0.1`.
4. Run it as a service. A systemd unit, `/etc/systemd/system/sei-crm.service`:

   ```ini
   [Unit]
   Description=SEI Client CRM
   After=network.target

   [Service]
   WorkingDirectory=/opt/sei-crm
   ExecStart=/usr/bin/node server.js
   Restart=always
   User=seicrm
   UMask=0077

   [Install]
   WantedBy=multi-user.target
   ```

5. Put HTTPS in front with Caddy. It gets the certificate by itself. In `/etc/caddy/Caddyfile`:

   ```
   crm.sei.co.in {
       request_body {
           max_size 45MB
       }
       reverse_proxy 127.0.0.1:3000
   }
   ```

   The 45 MB limit lets a checklist carry five full-size phone photos. The app itself refuses a form over 41 MB, or a file over 8 MB.

   With `COOKIE_SECURE=1` the app also sends `Strict-Transport-Security`, so browsers stick to HTTPS. Keep `TRUST_PROXY=1` behind Caddy; without it every visitor looks like 127.0.0.1 and sign-in throttling treats them as one person.

6. Add a daily `npm run backup` to cron, and copy the backups off the server.

Never expose port 3000 directly to the internet. Always go through the HTTPS proxy.

## Settings

All optional; see `.env.example`.

| Setting | Default | What it does |
|---|---|---|
| `HOST`, `PORT` | `127.0.0.1`, `3000` | Where the app listens. Use `0.0.0.0` to reach it from other PCs on the office network. |
| `DATA_DIR`, `DB_FILE` | `data`, `crm.db` | Where the database lives. |
| `ADMIN_EMAIL` | `admin@sei.local` | Email for the first admin account. |
| `TZ_NAME` | `Asia/Kolkata` | Time zone used for "today" and "overdue". |
| `SESSION_DAYS` | `7` | How long a sign-in lasts. |
| `COOKIE_SECURE`, `TRUST_PROXY` | `0` | Set both to `1` behind HTTPS on a VPS. |

## Look and feel

The colours and type follow SEI's brand: navy `#14263d`, action red `#c83b43`, the grey-blue grounds `#f4f6f8` and `#e6ebf0`, the ring mark, and Instrument Serif for headings. Body text and all figures use Inter. It is easier to read in dense tables, its figures line up in columns, and Instrument Serif has no ₹ sign and a `1` that reads like `l`. Both fonts are bundled in `public/fonts/` under the SIL Open Font License.

## For developers

The full structural design (request pipeline, module registry, data model, rules, roles, security) is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). A build prompt for the MVP is in [`docs/MVP-PROMPT.md`](docs/MVP-PROMPT.md).

- `server.js` starts the app. `src/app.js` handles sessions, CSRF, security headers and routing.
- `src/modules.js` defines each record type (fields, list views, filters, columns and who can edit). The forms, lists, validation, CSV export and audit trail in `src/crud.js` are generated from it.
- `src/routes/` holds the hand-built pages: dashboard, clients, sign-in, users, search and the Week planner.
- `src/planning.js` plans a week's PM and gathers a week for the planner and its Excel download. `src/xlsx.js` writes `.xlsx` files with no dependencies. `src/pm-checklists.js` holds the standard PM check points used by the demo and the template.
- `src/db.js` holds the schema. Add new migrations to the end of `MIGRATIONS`; never edit one that has already run.
- `npm test` runs an end-to-end check against a throwaway database.
