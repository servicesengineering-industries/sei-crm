# SEI Client CRM

A client CRM for Services Engineering Industries. It keeps every customer in one place, along with:

- the people SEI deals with there and their numbers;
- every call, visit and note, plus follow-ups with due dates;
- RFQs and quotes, from drawing received to won or lost;
- purchase orders, dispatches and what is still pending;
- invoices, payments (including TDS and debit notes), dues and overdue days;
- quality complaints, from containment to closure.

The dashboard and the client list flag the clients that need attention: money overdue, late POs, critical or open complaints, overdue follow-ups, quotes to chase and clients nobody has contacted in 30 days.

It runs on Node.js alone (version 22.13 or newer; this PC has 26). There is nothing to install: the database is SQLite through Node's built-in `node:sqlite`, and the fonts are bundled.

## Start it

From this folder:

```powershell
npm start
```

Open http://127.0.0.1:3000.

On the very first start the app creates the database in `data/`, adds SEI's customers from sei.co.in to the client list, and creates one admin account. **The admin's email and one-time password are in `data/first-login.txt`.** Sign in with them, choose your own password, and the file deletes itself.

Then go to **Users** and add everyone else. Each person gets a one-time password that only you see, and chooses their own when they first sign in.

## Try it with made-up data first

```powershell
npm run demo
```

Open http://127.0.0.1:3001. This uses a separate database, `data/demo.db`, filled with invented contacts, RFQs, orders, invoices and complaints so every screen has something on it. It never touches the real database.

Demo sign-ins: `admin@demo.local`, `anil@demo.local` (sales), `pooja@demo.local` (sales), `rakesh@demo.local` (accounts), `sunil@demo.local` (quality) and `viewer@demo.local` (view only). They all use the `DEMO_PASSWORD` from `.env.example`. To start the demo again from scratch, stop it and delete the `data/demo.*` files. Because that password is published here, demo mode refuses to start unless `HOST` is `127.0.0.1` and `COOKIE_SECURE` is off.

## Roles

| Role | Can change |
|---|---|
| Admin | Everything, including users and deleting records |
| Sales | Clients, contacts, RFQs and quotes, orders and dispatches, complaints, activities, follow-ups |
| Accounts | Invoices and payments, contacts, activities, follow-ups |
| Quality | Complaints, contacts, activities, follow-ups |
| View only | Nothing; can see everything |

Everyone who can sign in can see every client. Only admins can delete, and a client with any linked records can't be deleted. Set it to Dormant or Lost instead.

## Everyday use

- **Log a call or visit** from the client's page. Add a next follow-up in the same form and it lands on that person's dashboard.
- **Search** (top bar, or press `/`) finds clients, people, phone numbers (digits only is fine), part numbers, PO, invoice and complaint numbers.
- **Invoice due dates** come from the client's payment terms if you leave them blank. Without terms set, the app uses 30 days.
- **Payments**: record what came in plus any TDS or debit-note deduction. Both count towards settling the invoice.
- Every list has a **Download as CSV** link that opens in Excel.
- Every change is recorded with who made it, and shows on the client's timeline.

## Backups

```powershell
npm run backup
```

This writes a dated copy to `data/backups/` and keeps the newest 30. It is safe while the app is running. Schedule it daily (Windows Task Scheduler on a PC, cron on a VPS) and copy `data/backups/` somewhere off the machine.

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
           max_size 2MB
       }
       reverse_proxy 127.0.0.1:3000
   }
   ```

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

- `server.js` starts the app. `src/app.js` handles sessions, CSRF, security headers and routing.
- `src/modules.js` defines each record type (fields, list views, filters, columns and who can edit). The forms, lists, validation, CSV export and audit trail in `src/crud.js` are generated from it.
- `src/routes/` holds the hand-built pages: dashboard, clients, sign-in, users and search.
- `src/db.js` holds the schema. Add new migrations to the end of `MIGRATIONS`; never edit one that has already run.
- `npm test` runs an end-to-end check against a throwaway database.
