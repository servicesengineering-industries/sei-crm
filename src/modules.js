'use strict';
// One definition per record type: fields drive the forms and validation,
// listSql/views/columns drive the list pages, editRoles drive permissions.
const { html } = require('./html');
const C = require('./cells');
const F = require('./format');
const { canEdit } = require('./auth');
const CL = require('./checklists');
const U = require('./uploads');

const OPT = {
  clientStatus: ['Active', 'Prospect', 'Dormant', 'Lost'],
  segment: ['OEM – Passenger cars', 'OEM – Tractors', 'OEM – 3-wheelers', 'OEM – Other', 'Tier-1 supplier', 'Non-automotive', 'Other'],
  department: ['Purchase', 'SQA / Quality', 'Engineering / Development', 'Production', 'Logistics / Stores', 'Accounts', 'Management', 'Other'],
  activityType: ['Call', 'Visit', 'Meeting', 'Email', 'WhatsApp', 'Note'],
  followupStatus: ['Open', 'Done', 'Cancelled'],
  rfqStatus: ['New', 'Costing', 'Quoted', 'Negotiation', 'Won', 'Lost', 'Regretted', 'On hold'],
  orderStatus: ['Open', 'Closed', 'Cancelled'],
  paymentMode: ['NEFT / RTGS', 'Cheque', 'UPI', 'Bill discounting', 'Cash', 'Other'],
  complaintStatus: ['Open', 'Containment done', 'Root cause found', 'Action taken', 'Closed'],
  severity: ['Minor', 'Major', 'Critical'],
  complaintCategory: ['Line rejection', 'Incoming inspection', 'Field failure / warranty', 'Delivery / packing', 'Documentation', 'Other'],
  // Weekly planning
  assetType: ['Machine', 'Tool / die', 'Fixture', 'Gauge', 'Utility'],
  assetStatus: ['Running', 'Breakdown', 'Idle', 'Scrapped'],
  pmFrequency: ['Weekly', 'Fortnightly', 'Monthly', 'Quarterly', 'Half-yearly', 'Yearly'],
  weekday: F.DAYS,
  pmStatus: ['Planned', 'Done', 'Postponed', 'Missed', 'Cancelled'],
  shift: ['General', 'A (day)', 'B (evening)', 'C (night)'],
  operation: ['Blanking / shearing', 'Piercing', 'Forming / bending', 'Drawing', 'Machining', 'Welding (MIG)', 'Spot / projection welding', 'Assembly', 'Painting / powder coating', 'Inspection & packing', 'Other'],
  productionStatus: ['Planned', 'In progress', 'Done', 'Short', 'Cancelled'],
  shortfallReason: ['Machine breakdown', 'Tool / die problem', 'Material shortage', 'Manpower shortage', 'Power cut', 'Quality hold', 'Plan changed', 'Other'],
  supplierCategory: ['Raw material – steel', 'Bought-out parts', 'Consumables & gases', 'Tooling & spares', 'Job work', 'Packaging', 'Transport', 'Services', 'Other'],
  purchaseCategory: ['Raw material', 'Bought-out parts', 'Consumables', 'Machine spares (PM)', 'Tooling', 'Packaging', 'Job work', 'Services', 'Other'],
  unit: ['kg', 'tonne', 'nos', 'sheets', 'metre', 'litre', 'set', 'box', 'cylinder', 'lot'],
  purchaseStatus: ['Planned', 'Indent raised', 'PO placed', 'Part received', 'Received', 'Cancelled'],
  paymentCategory: ['Supplier bill', 'Job work', 'Salary & wages', 'Statutory – GST', 'Statutory – TDS', 'Statutory – PF / ESI', 'Electricity & utilities', 'Rent', 'Loan / EMI', 'Transport & freight', 'Machine repair', 'Other'],
  paymentPriority: ['Must pay', 'Normal', 'Can defer'],
  payMode: ['NEFT / RTGS', 'Cheque', 'UPI', 'Cash', 'Auto-debit'],
  paymentPlanStatus: ['Planned', 'Approved', 'Paid', 'Deferred', 'Cancelled'],
  pettyType: ['Expense', 'Cash top-up'],
  pettyHead: ['Conveyance & travel', 'Tea & refreshments', 'Courier & postage', 'Stationery & printing', 'Small repairs', 'Small consumables', 'Loading & labour', 'Vehicle fuel', 'Staff welfare', 'Miscellaneous'],
  pettyMode: ['Cash', 'UPI'],
  pettyStatus: ['Planned', 'Paid', 'Cancelled'],
  // SEI's own departments (OPT.department above is the client's side)
  seiDept: ['Management', 'Sales', 'Accounts', 'Quality', 'Production', 'Maintenance', 'Tool room', 'Purchase & stores', 'Dispatch & logistics', 'HR & admin'],
  jobPriority: ['Urgent', 'High', 'Normal', 'Low'],
  jobStatus: ['To do', 'In progress', 'Waiting', 'Done', 'Cancelled'],
  checklistFrequency: CL.FREQ,
  runStatus: ['Open', 'Submitted', 'Approved', 'Returned', 'Done'],
  complianceCategory: ['GST', 'TDS / TCS', 'Income tax', 'PF / ESI', 'ROC / MCA', 'Labour laws', 'Licence & registration', 'Fire & safety', 'Pollution control', 'Insurance', 'Calibration', 'Other'],
  complianceFrequency: ['Monthly', 'Quarterly', 'Half-yearly', 'Yearly', 'One-time'],
};

const JOB_OPEN = ['To do', 'In progress', 'Waiting'];
const isAdminUser = (u) => !!u && u.role === 'admin';
// Who may change a job's details: admins, the person who gave it, and the head of its department.
const canManageJob = (u, job) => isAdminUser(u) || (!!job && (job.assigned_by === u.id || (!!u.is_head && !!u.department && u.department === job.department)));
// Who may post progress or change its status: those, plus the person doing it.
const canUpdateJob = (u, job) => canManageJob(u, job) || (!!job && job.assigned_to === u.id);

const PM_OPEN = ['Planned', 'Postponed'];
const PURCHASE_OPEN = ['Planned', 'Indent raised', 'PO placed', 'Part received'];
const PAY_OPEN = ['Planned', 'Approved'];

const RFQ_OPEN = ['New', 'Costing', 'Quoted', 'Negotiation'];
const sqlIn = (arr) => arr.map((s) => `'${s.replace(/'/g, "''")}'`).join(', ');
const STAFF = ['admin', 'sales', 'accounts', 'quality'];

const today = () => F.today();
const inDays = (n) => () => F.addDays(F.today(), n);
const me = (ctx) => ctx.user.id;

// Money goes out only on the word of an admin or the head of Accounts, and "Approved by" always
// names the person who really approved: it is never typed in for somebody else.
const canApprovePayments = (u) => isAdminUser(u) || (!!u && !!u.is_head && u.department === 'Accounts');
const NOT_APPROVER = 'Only an admin or the head of Accounts can approve a payment. Leave it unapproved and ask them';
function approverOnApprove(data, errors, ctx, existing) {
  const already = existing && existing.approved_by && ['Approved', 'Paid'].includes(existing.status);
  if (data.status === 'Approved') {
    if (already) data.approved_by = existing.approved_by;
    else if (!canApprovePayments(ctx.user)) { if (!errors.status) errors.status = NOT_APPROVER; }
    else data.approved_by = ctx.user.id;
  } else if (data.status === 'Paid') {
    data.approved_by = already ? existing.approved_by : null;
  } else {
    data.approved_by = null;
  }
}
// Dates that must come in order, and events that cannot have happened yet.
function notBefore(data, errors, field, earlier, label) {
  if (data[field] && earlier && data[field] < earlier && !errors[field]) errors[field] = `Enter a date on or after the ${label} (${F.fmtDate(earlier)})`;
}
function notFuture(data, errors, field) {
  if (data[field] && data[field] > F.today() && !errors[field]) errors[field] = `This date is in the future. Enter the real date: today (${F.fmtDate(F.today())}) or earlier`;
}
function approverAsSelf(data, errors, ctx, existing) {
  const before = existing ? existing.approved_by : null;
  if (!data.approved_by || data.approved_by === before) { if (!data.approved_by) data.approved_by = null; return; }
  if (!canApprovePayments(ctx.user)) { if (!errors.approved_by) errors.approved_by = NOT_APPROVER; return; }
  data.approved_by = ctx.user.id;
}
const field = (name, label, type = 'text', extra = {}) => ({ name, label, type, ...extra });
const clientCol = { label: 'Client', client: true, render: (r) => C.client(r) };

// Every weekly plan lists this week, next week and last week, and can be opened at any week (?week=).
const thisMonday = () => F.weekOf(F.today());
const WEEK_VIEWS = [
  { key: 'week', label: 'This week', where: 'week_start = :wk' },
  { key: 'next', label: 'Next week', where: 'week_start = :wkn' },
  { key: 'last', label: 'Last week', where: 'week_start = :wkp' },
];
const ALL_WEEKS = { key: 'all', label: 'All weeks' };
const sum = (rows, k) => rows.reduce((n, r) => n + (Number(r[k]) || 0), 0);
// Achievement against plan: shown once the week has started, coloured once the line is due.
function achieved(done, planned, started, due) {
  const p = F.pct(done, planned);
  if (p == null || !started) return C.dash;
  if (!due) return html`<span class="num${p >= 100 ? ' tone-text-ok' : ''}">${p}%</span>`;
  return html`<span class="num ${p >= 100 ? 'tone-text-ok' : p >= 80 ? 'tone-text-warn' : 'tone-text-bad'}">${p}%</span>`;
}
const started = (r) => r.week_start <= F.today();
// A sales line is due after its dispatch day, or after its week if no day is set.
const duePassed = (r) => (r.dispatch_on || F.addDays(r.week_start, 6)) < F.today();

const MODULES = {
  clients: {
    key: 'clients', table: 'clients', singular: 'client', plural: 'Clients', tab: 'details',
    editRoles: ['admin', 'sales'],
    title: (r) => r.name,
    listSql: 'SELECT t.*, u.name AS owner_name FROM clients t LEFT JOIN users u ON u.id = t.owner_id',
    order: 'name',
    csv: ['name', 'status', 'segment', 'owner_name', 'vendor_code', 'payment_terms_days', 'gstin', 'city', 'state', 'address', 'website', 'notes'],
    fields: [
      field('name', 'Company name', 'text', { required: true, section: 'Company' }),
      field('status', 'Status', 'select', { options: OPT.clientStatus, required: true, default: 'Active' }),
      field('segment', 'Segment', 'select', { options: OPT.segment }),
      field('owner_id', 'Account manager', 'user'),
      field('vendor_code', "SEI's vendor code", 'text', { help: 'The supplier code this client uses for SEI' }),
      field('payment_terms_days', 'Payment terms (days)', 'int', { help: 'Used to work out invoice due dates. Blank means 30.' }),
      field('gstin', 'GSTIN', 'text', { upper: true, pattern: /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, patternMsg: 'A GSTIN has 15 characters, like 06ABCDE1234F1Z5', section: 'Address and tax' }),
      field('website', 'Website', 'url'),
      field('city', 'City'),
      field('state', 'State'),
      field('address', 'Address', 'textarea'),
      field('notes', 'Notes', 'textarea', { section: 'Notes' }),
    ],
  },

  contacts: {
    key: 'contacts', table: 'contacts', singular: 'contact', plural: 'Contacts', tab: 'contacts',
    editRoles: STAFF,
    help: 'Everyone SEI deals with at each client, with their numbers.',
    dependents: [
      { table: 'activities', fk: 'contact_id', one: 'activity', many: 'activities' },
      { table: 'followups', fk: 'contact_id', one: 'follow-up' },
      { table: 'rfqs', fk: 'contact_id', one: 'RFQ' },
      { table: 'complaints', fk: 'contact_id', one: 'complaint' },
    ],
    deleteHint: 'Untick “Still works at this client” instead, so the history stays.',
    title: (r) => r.name,
    listSql: 'SELECT t.*, c.name AS client_name FROM contacts t JOIN clients c ON c.id = t.client_id',
    order: 'client_name, is_primary DESC, name',
    search: ['name', 'designation', 'mobile', 'phone', 'email', 'location', 'client_name'],
    views: [{ key: 'active', label: 'Current', where: 'active = 1' }, { key: 'all', label: 'All, incl. people who left' }],
    defaultView: 'active',
    filters: [{ name: 'department', label: 'Department', options: OPT.department }],
    csv: ['client_name', 'name', 'designation', 'department', 'location', 'mobile', 'phone', 'email', 'is_primary', 'active', 'notes'],
    fields: [
      field('client_id', 'Client', 'client', { required: true }),
      field('name', 'Name', 'text', { required: true }),
      field('designation', 'Designation'),
      field('department', 'Department', 'select', { options: OPT.department }),
      field('location', 'Plant / location', 'text', { help: 'For example Manesar plant or head office' }),
      field('mobile', 'Mobile', 'tel'),
      field('phone', 'Office phone / extension', 'tel'),
      field('email', 'Email', 'email'),
      field('is_primary', 'Key contact for this client', 'checkbox'),
      field('active', 'Still works at this client', 'checkbox', { default: 1 }),
      field('notes', 'Notes', 'textarea'),
    ],
    columns: [
      { label: 'Name', render: (r, ctx) => C.edit('contacts', r, r.name, r.designation, ctx) },
      clientCol,
      { label: 'Department', render: (r) => C.text(r.department) },
      { label: 'Plant / location', render: (r) => C.text(r.location) },
      { label: 'Mobile', render: (r) => C.tel(r.mobile) },
      { label: 'Office phone', render: (r) => C.tel(r.phone) },
      { label: 'Email', render: (r) => C.email(r.email) },
      { label: '', render: (r) => html`${r.is_primary ? C.badge('Key contact', 'info') : ''}${r.active ? '' : C.badge('Left', 'muted')}` },
    ],
  },

  activities: {
    key: 'activities', table: 'activities', singular: 'activity', plural: 'Activity log', tab: 'overview',
    editRoles: STAFF,
    help: 'Every call, visit, meeting and note, newest first.',
    title: (r) => r.subject,
    listSql: `SELECT t.*, c.name AS client_name, ct.name AS contact_name, u.name AS user_name
              FROM activities t JOIN clients c ON c.id = t.client_id
              LEFT JOIN contacts ct ON ct.id = t.contact_id LEFT JOIN users u ON u.id = t.user_id`,
    order: 'occurred_on DESC, id DESC',
    search: ['subject', 'notes', 'client_name', 'contact_name'],
    views: [{ key: 'all', label: 'All' }, { key: 'week', label: 'Last 7 days', where: 'occurred_on >= :tm7' }, { key: 'month', label: 'Last 30 days', where: 'occurred_on >= :tm30' }],
    defaultView: 'all',
    filters: [{ name: 'type', label: 'Type', options: OPT.activityType }, { name: 'user_id', label: 'Logged by', type: 'user', mine: true }],
    csv: ['occurred_on', 'client_name', 'type', 'contact_name', 'subject', 'notes', 'user_name'],
    fields: [
      field('client_id', 'Client', 'client', { required: true }),
      field('contact_id', 'With', 'contact'),
      field('type', 'Type', 'select', { options: OPT.activityType, required: true, default: 'Call' }),
      field('occurred_on', 'Date', 'date', { required: true, default: today }),
      field('subject', 'Summary', 'text', { required: true, wide: true }),
      field('notes', 'Details', 'textarea'),
      field('next_title', 'Next follow-up', 'text', { virtual: true, createOnly: true, section: 'Next step (optional)', help: 'Creates a follow-up' }),
      field('next_on', 'Follow-up date', 'date', { virtual: true, createOnly: true }),
      field('next_assigned', 'Assign to', 'user', { virtual: true, createOnly: true, default: me }),
    ],
    validate(data, virt, errors) {
      if (virt.next_title && !virt.next_on) errors.next_on = 'Pick a date for the follow-up';
      if (!virt.next_title && virt.next_on) errors.next_title = 'Say what needs doing';
      if (data.occurred_on && !errors.occurred_on && data.occurred_on > F.today()) errors.occurred_on = 'Can’t be in the future. Plan it as a follow-up instead.';
    },
    beforeInsert(data, ctx) { data.user_id = ctx.user.id; },
    afterInsert(ctx, id, data, virt) {
      if (!virt.next_title || !virt.next_on) return;
      const f = ctx.db.run(`INSERT INTO followups (client_id, contact_id, title, due_on, assigned_to, created_by)
                            VALUES (:client_id, :contact_id, :title, :due_on, :assigned_to, :created_by)`, {
        client_id: data.client_id, contact_id: data.contact_id, title: virt.next_title, due_on: virt.next_on,
        assigned_to: virt.next_assigned || ctx.user.id, created_by: ctx.user.id,
      });
      ctx.audit({ clientId: data.client_id, entity: 'followups', entityId: f.id, action: 'created', summary: `added follow-up “${virt.next_title}” for ${F.fmtDate(virt.next_on)}` });
    },
    columns: [
      { label: 'Date', render: (r) => C.date(r.occurred_on) },
      clientCol,
      { label: 'Type', render: (r) => C.badge(r.type) },
      { label: 'Summary', render: (r, ctx) => C.edit('activities', r, r.subject, C.clip(r.notes, 110), ctx) },
      { label: 'With', render: (r) => C.text(r.contact_name) },
      { label: 'Logged by', render: (r) => C.text(r.user_name) },
    ],
  },

  followups: {
    key: 'followups', table: 'followups', singular: 'follow-up', plural: 'Follow-ups', tab: 'overview',
    editRoles: STAFF,
    help: 'Promised calls, quotes, documents and payment chasers.',
    title: (r) => r.title,
    listSql: `SELECT t.*, c.name AS client_name, ct.name AS contact_name, ct.mobile AS contact_mobile, u.name AS assigned_name
              FROM followups t JOIN clients c ON c.id = t.client_id
              LEFT JOIN contacts ct ON ct.id = t.contact_id LEFT JOIN users u ON u.id = t.assigned_to`,
    order: "CASE status WHEN 'Open' THEN 0 ELSE 1 END, due_on, id",
    search: ['title', 'notes', 'client_name', 'contact_name'],
    views: [
      { key: 'open', label: 'Open', where: "status = 'Open'" },
      { key: 'overdue', label: 'Overdue', where: "status = 'Open' AND due_on < :t" },
      { key: 'week', label: 'Due in 7 days', where: "status = 'Open' AND due_on BETWEEN :t AND :tp7" },
      { key: 'done', label: 'Done', where: "status <> 'Open'" },
      { key: 'all', label: 'All' },
    ],
    defaultView: 'open',
    filters: [{ name: 'assigned_to', label: 'Assigned to', type: 'user', mine: true }],
    csv: ['due_on', 'client_name', 'title', 'contact_name', 'assigned_name', 'status', 'done_on', 'notes'],
    fields: [
      field('client_id', 'Client', 'client', { required: true }),
      field('contact_id', 'Contact', 'contact'),
      field('title', 'What needs doing', 'text', { required: true, wide: true }),
      field('due_on', 'Due', 'date', { required: true, default: inDays(3) }),
      field('assigned_to', 'Assigned to', 'user', { default: me }),
      field('status', 'Status', 'select', { options: OPT.followupStatus, required: true, default: 'Open' }),
      field('notes', 'Notes', 'textarea'),
    ],
    beforeSave(data, ctx, existing) {
      if (data.status === 'Open') data.done_on = null;
      // Keep the original completion date when a finished follow-up is edited later.
      else data.done_on = (existing && existing.status !== 'Open' && existing.done_on) || F.today();
    },
    beforeInsert(data, ctx) { data.created_by = ctx.user.id; },
    columns: [
      { label: 'Due', render: (r) => C.due(r.due_on, r.status === 'Open') },
      { label: 'Follow-up', render: (r, ctx) => C.edit('followups', r, r.title, C.clip(r.notes, 90), ctx) },
      clientCol,
      { label: 'Contact', render: (r) => (r.contact_name ? html`${r.contact_name}${r.contact_mobile ? html`<span class="sub">${C.tel(r.contact_mobile)}</span>` : ''}` : C.dash) },
      { label: 'Assigned to', render: (r) => C.text(r.assigned_name) },
      { label: 'Status', render: (r) => C.badge(r.status) },
      { label: '', render: (r, ctx) => (r.status === 'Open' && canEdit(ctx.user, MODULES.followups) ? C.doneButton(r, ctx) : '') },
    ],
  },

  rfqs: {
    key: 'rfqs', table: 'rfqs', singular: 'RFQ', plural: 'RFQs & quotes', tab: 'rfqs',
    editRoles: ['admin', 'sales'],
    help: 'Every enquiry from drawing received to won or lost.',
    dependents: [{ table: 'orders', fk: 'rfq_id', one: 'order' }],
    deleteHint: 'Set its status to Lost or On hold instead.',
    title: (r) => [r.part_name, r.part_no && `(${r.part_no})`].filter(Boolean).join(' '),
    listSql: `SELECT t.*, c.name AS client_name, ct.name AS contact_name, u.name AS owner_name,
                     t.unit_price * t.annual_volume AS annual_value
              FROM rfqs t JOIN clients c ON c.id = t.client_id
              LEFT JOIN contacts ct ON ct.id = t.contact_id LEFT JOIN users u ON u.id = t.owner_id`,
    order: 'received_on DESC, id DESC',
    search: ['part_name', 'part_no', 'rfq_ref', 'quote_no', 'material', 'client_name'],
    views: [
      { key: 'open', label: 'Open', where: `status IN (${sqlIn(RFQ_OPEN)})` },
      { key: 'due', label: 'Quote due', where: "status IN ('New', 'Costing') AND quote_due_on <= :tp3" },
      { key: 'chase', label: 'Quoted 14+ days ago', where: "status IN ('Quoted', 'Negotiation') AND quoted_on <= :tm14" },
      { key: 'won', label: 'Won', where: "status = 'Won'" },
      { key: 'lost', label: 'Lost or regretted', where: "status IN ('Lost', 'Regretted')" },
      { key: 'all', label: 'All' },
    ],
    defaultView: 'open',
    filters: [{ name: 'status', label: 'Status', options: OPT.rfqStatus }, { name: 'owner_id', label: 'Handled by', type: 'user', mine: true }],
    csv: ['received_on', 'client_name', 'rfq_ref', 'part_name', 'part_no', 'drawing_rev', 'material', 'annual_volume', 'quote_due_on', 'status', 'quote_no', 'quoted_on', 'unit_price', 'tooling_cost', 'annual_value', 'decision_on', 'lost_reason', 'contact_name', 'owner_name', 'notes'],
    fields: [
      field('client_id', 'Client', 'client', { required: true, section: 'Enquiry' }),
      field('contact_id', 'Sent by', 'contact'),
      field('part_name', 'Part', 'text', { required: true }),
      field('part_no', 'Part no'),
      field('drawing_rev', 'Drawing revision'),
      field('material', 'Material'),
      field('annual_volume', 'Yearly volume (pcs)', 'int'),
      field('rfq_ref', "Client's RFQ reference"),
      field('received_on', 'Received on', 'date', { required: true, default: today }),
      field('quote_due_on', 'Quote due by', 'date'),
      field('status', 'Status', 'select', { options: OPT.rfqStatus, required: true, default: 'New', section: 'Quote' }),
      field('owner_id', 'Handled by', 'user', { default: me }),
      field('quote_no', 'Quote no'),
      field('quoted_on', 'Quoted on', 'date', { help: 'The app fills this in when the status moves to Quoted' }),
      field('unit_price', 'Quoted price per piece (₹)', 'money2'),
      field('tooling_cost', 'Tooling cost (₹)', 'money'),
      field('decision_on', 'Decision date', 'date', { section: 'Outcome' }),
      field('lost_reason', 'Why lost or regretted'),
      field('notes', 'Notes', 'textarea'),
    ],
    validate(data, virt, errors) {
      notFuture(data, errors, 'received_on');
      for (const f of ['quote_due_on', 'quoted_on', 'decision_on']) notBefore(data, errors, f, data.received_on, 'received date');
      if (['Quoted', 'Negotiation', 'Won'].includes(data.status) && data.unit_price == null && !errors.unit_price) {
        errors.unit_price = `Enter the quoted price per piece. A quote that is ${data.status.toLowerCase()} has a price`;
      }
    },
    beforeSave(data) {
      if (['Quoted', 'Negotiation'].includes(data.status) && !data.quoted_on) data.quoted_on = F.today();
      if (['Won', 'Lost', 'Regretted'].includes(data.status) && !data.decision_on) data.decision_on = F.today();
    },
    columns: [
      { label: 'Received', render: (r) => C.date(r.received_on) },
      { label: 'Part', render: (r, ctx) => C.edit('rfqs', r, r.part_name, [r.part_no, r.material].filter(Boolean).join(' · '), ctx) },
      clientCol,
      { label: 'Yearly volume', cls: 'r', render: (r) => C.int(r.annual_volume) },
      { label: 'Status', render: (r) => C.badge(r.status) },
      { label: 'Price / pc', cls: 'r', render: (r) => C.money2(r.unit_price) },
      { label: 'Yearly value', cls: 'r', render: (r) => C.money(r.annual_value) },
      {
        label: 'Quote due / sent',
        render: (r) => (['New', 'Costing'].includes(r.status) ? C.due(r.quote_due_on, true)
          : r.quoted_on ? html`${C.date(r.quoted_on)}${['Quoted', 'Negotiation'].includes(r.status) ? html`<span class="sub">${F.relDays(r.quoted_on)}</span>` : ''}` : C.dash),
      },
      { label: 'Handled by', render: (r) => C.text(r.owner_name) },
    ],
  },

  orders: {
    key: 'orders', table: 'orders', singular: 'order', plural: 'Orders & deliveries', tab: 'orders',
    editRoles: ['admin', 'sales'],
    help: 'Purchase orders and schedules, what has been dispatched and what is still due.',
    title: (r) => [r.po_no, r.part_name].filter(Boolean).join(' – '),
    listSql: 'SELECT t.*, c.name AS client_name FROM v_orders t JOIN clients c ON c.id = t.client_id',
    order: "CASE WHEN status = 'Open' AND pending > 0 THEN 0 ELSE 1 END, due_on, id",
    search: ['po_no', 'part_name', 'part_no', 'plant', 'client_name'],
    views: [
      { key: 'open', label: 'Open', where: "status = 'Open'" },
      { key: 'late', label: 'Late', where: "status = 'Open' AND pending > 0 AND due_on < :t" },
      { key: 'week', label: 'Due in 7 days', where: "status = 'Open' AND pending > 0 AND due_on BETWEEN :t AND :tp7" },
      { key: 'closed', label: 'Closed', where: "status <> 'Open'" },
      { key: 'all', label: 'All' },
    ],
    defaultView: 'open',
    children: ['dispatches'],
    dependents: [
      { table: 'dispatches', fk: 'order_id', one: 'dispatch', many: 'dispatches' },
      { table: 'invoices', fk: 'order_id', one: 'invoice' },
    ],
    deleteHint: 'Set its status to Cancelled or Closed instead.',
    validate(data, virt, errors, ctx, existing) {
      notFuture(data, errors, 'po_date');
      notBefore(data, errors, 'due_on', data.po_date, 'PO date');
      if (existing && data.qty != null && !errors.qty) {
        const o = ctx.db.get('SELECT dispatched FROM v_orders WHERE id = :id', { id: existing.id });
        if (o && data.qty < o.dispatched) errors.qty = `${F.num(o.dispatched)} pcs are already dispatched against this PO. Enter ${F.num(o.dispatched)} or more`;
      }
      if (data.client_id && data.po_no && data.part_name && !errors.po_no) {
        const dup = ctx.db.get(`SELECT id FROM orders WHERE client_id = :c AND po_no = :po COLLATE NOCASE AND part_name = :part COLLATE NOCASE
                                AND COALESCE(part_no, '') = COALESCE(:pno, '') AND id <> :id`, {
          c: data.client_id, po: data.po_no, part: data.part_name, pno: data.part_no, id: existing ? existing.id : 0,
        });
        if (dup) errors.po_no = 'This PO already has a line for this part';
      }
    },
    csv: ['po_no', 'po_date', 'client_name', 'part_name', 'part_no', 'plant', 'qty', 'dispatched', 'pending', 'unit_price', 'due_on', 'status', 'last_dispatch_on', 'notes'],
    fields: [
      field('client_id', 'Client', 'client', { required: true }),
      field('rfq_id', 'From RFQ', 'rfq', { help: 'Optional: links the order to the quote it came from' }),
      field('po_no', 'PO / schedule no', 'text', { required: true }),
      field('po_date', 'PO date', 'date', { default: today }),
      field('part_name', 'Part', 'text', { required: true }),
      field('part_no', 'Part no'),
      field('plant', 'Deliver to plant'),
      field('qty', 'Quantity ordered', 'int', { required: true, min: 1 }),
      field('unit_price', 'Rate per piece (₹)', 'money2'),
      field('due_on', 'Delivery due', 'date'),
      field('status', 'Status', 'select', { options: OPT.orderStatus, required: true, default: 'Open', help: 'Close it once the schedule is complete' }),
      field('notes', 'Notes', 'textarea'),
    ],
    prefill(ctx, values) {
      const id = Number(ctx.query.rfq_id);
      if (!id) return;
      const r = ctx.db.get('SELECT client_id, part_name, part_no, unit_price FROM rfqs WHERE id = :id', { id });
      if (r) Object.assign(values, { rfq_id: id, client_id: r.client_id, part_name: r.part_name, part_no: r.part_no, unit_price: r.unit_price });
    },
    childSummary(ctx, id) {
      const o = ctx.db.get('SELECT qty, dispatched, pending FROM v_orders WHERE id = :id', { id });
      return o ? html`<p class="child-sum">Ordered <b>${F.num(o.qty)}</b> · dispatched <b>${F.num(o.dispatched)}</b> · pending <b class="${o.pending > 0 ? '' : 'tone-text-ok'}">${F.num(o.pending)}</b></p>` : '';
    },
    columns: [
      { label: 'PO', render: (r, ctx) => C.edit('orders', r, r.po_no, r.po_date ? F.fmtDate(r.po_date) : null, ctx) },
      clientCol,
      { label: 'Part', render: (r) => html`${r.part_name}${r.part_no ? html`<span class="sub">${r.part_no}</span>` : ''}` },
      { label: 'Plant', render: (r) => C.text(r.plant) },
      { label: 'Ordered', cls: 'r', render: (r) => C.int(r.qty) },
      { label: 'Dispatched', cls: 'r', render: (r) => C.int(r.dispatched) },
      { label: 'Pending', cls: 'r', render: (r) => (r.pending > 0 ? html`<b class="num">${F.num(r.pending)}</b>` : C.int(r.pending)) },
      { label: 'Due', render: (r) => C.due(r.due_on, r.status === 'Open' && r.pending > 0) },
      { label: 'Status', render: (r) => (r.status === 'Open' && r.pending <= 0 ? C.badge('Fully dispatched', 'ok') : C.badge(r.status)) },
    ],
  },

  dispatches: {
    key: 'dispatches', table: 'dispatches', singular: 'dispatch', plural: 'Dispatches', tab: 'orders',
    editRoles: ['admin', 'sales'],
    parent: { field: 'order_id', module: 'orders', table: 'orders' },
    title: (r) => `${F.num(r.qty)} pcs on ${F.fmtDate(r.dispatched_on)}`,
    listSql: `SELECT t.*, c.name AS client_name, o.po_no, o.part_name, u.name AS user_name
              FROM dispatches t JOIN clients c ON c.id = t.client_id JOIN orders o ON o.id = t.order_id
              LEFT JOIN users u ON u.id = t.user_id`,
    order: 'dispatched_on DESC, id DESC',
    search: ['po_no', 'invoice_no', 'part_name', 'client_name'],
    csv: ['dispatched_on', 'client_name', 'po_no', 'part_name', 'qty', 'invoice_no', 'user_name', 'notes'],
    fields: [
      field('order_id', 'Against PO', 'order', { required: true, openOnly: true }),
      field('dispatched_on', 'Dispatched on', 'date', { required: true, default: today }),
      field('qty', 'Quantity dispatched', 'int', { required: true, min: 1 }),
      field('invoice_no', 'Invoice / challan no'),
      field('notes', 'Notes', 'textarea'),
    ],
    validate(data, virt, errors, ctx, existing) {
      notFuture(data, errors, 'dispatched_on');
      if (errors.order_id || !data.order_id) return;
      const o = ctx.db.get('SELECT pending, status FROM v_orders WHERE id = :id', { id: data.order_id });
      if (!o) return;
      // A closed or cancelled PO takes no new dispatches; an existing one can still be corrected.
      if (o.status !== 'Open' && !(existing && existing.order_id === data.order_id)) {
        errors.order_id = `This PO is ${o.status}. Open the PO and set its status to Open first`;
        return;
      }
      if (errors.qty || data.qty == null) return;
      const left = o.pending + (existing && existing.order_id === data.order_id ? existing.qty : 0);
      if (data.qty > left) {
        errors.qty = left > 0
          ? `Only ${F.num(left)} pcs are still pending on this PO. If the client accepted more, raise the PO quantity first.`
          : 'Nothing is pending on this PO. Raise the PO quantity first, or choose another PO.';
      }
    },
    beforeInsert(data, ctx) { data.user_id = ctx.user.id; },
    columns: [
      { label: 'Date', render: (r, ctx) => C.edit('dispatches', r, F.fmtDate(r.dispatched_on), null, ctx) },
      { label: 'PO', render: (r) => r.po_no },
      clientCol,
      { label: 'Qty', cls: 'r', render: (r) => C.int(r.qty) },
      { label: 'Invoice / challan', render: (r) => C.text(r.invoice_no) },
    ],
    childColumns: [
      { label: 'Date', render: (r, ctx) => C.edit('dispatches', r, F.fmtDate(r.dispatched_on), null, ctx) },
      { label: 'Qty', cls: 'r', render: (r) => C.int(r.qty) },
      { label: 'Invoice / challan', render: (r) => C.text(r.invoice_no) },
      { label: 'Entered by', render: (r) => C.text(r.user_name) },
      { label: 'Notes', render: (r) => C.text(C.clip(r.notes, 60)) },
    ],
    emptyChild: 'Nothing dispatched against this PO yet.',
  },

  invoices: {
    key: 'invoices', table: 'invoices', singular: 'invoice', plural: 'Invoices & dues', tab: 'invoices',
    editRoles: ['admin', 'accounts'],
    help: 'What each client owes, what has come in and what is overdue.',
    title: (r) => `Invoice ${r.invoice_no}`,
    listSql: `SELECT t.*, c.name AS client_name, o.po_no
              FROM v_invoices t JOIN clients c ON c.id = t.client_id LEFT JOIN orders o ON o.id = t.order_id`,
    order: 'CASE WHEN balance > 0.5 THEN 0 ELSE 1 END, due_on, id',
    search: ['invoice_no', 'po_no', 'client_name'],
    views: [
      { key: 'unpaid', label: 'Unpaid', where: 'balance > 0.5' },
      { key: 'overdue', label: 'Overdue', where: 'balance > 0.5 AND due_on < :t' },
      { key: 'paid', label: 'Paid', where: 'balance <= 0.5' },
      { key: 'all', label: 'All' },
    ],
    defaultView: 'unpaid',
    children: ['payments'],
    dependents: [{ table: 'payments', fk: 'invoice_id', one: 'payment' }],
    deleteHint: 'Delete its payments first if the invoice was entered by mistake.',
    validate(data, virt, errors, ctx, existing) {
      if (data.invoice_no && !errors.invoice_no) {
        const dup = ctx.db.get('SELECT id FROM invoices WHERE invoice_no = :no COLLATE NOCASE AND id <> :id', { no: data.invoice_no, id: existing ? existing.id : 0 });
        if (dup) errors.invoice_no = 'This invoice number is already entered. Open that invoice instead';
      }
      if (data.due_on && data.invoice_date && data.due_on < data.invoice_date && !errors.due_on) errors.due_on = 'Payment due can’t be before the invoice date';
      if (existing && data.amount != null && !errors.amount) {
        const i = ctx.db.get('SELECT received + deducted AS settled FROM v_invoices WHERE id = :id', { id: existing.id });
        if (i && data.amount + 0.5 < i.settled) errors.amount = `${F.money2(i.settled)} is already received against this invoice. Enter ${F.money2(i.settled)} or more`;
      }
    },
    csv: ['invoice_no', 'invoice_date', 'client_name', 'po_no', 'amount', 'received', 'deducted', 'balance', 'due_on', 'last_payment_on', 'notes'],
    fields: [
      field('client_id', 'Client', 'client', { required: true }),
      field('order_id', 'Against PO', 'order'),
      field('invoice_no', 'Invoice no', 'text', { required: true }),
      field('invoice_date', 'Invoice date', 'date', { required: true, default: today }),
      field('amount', 'Invoice amount incl. GST (₹)', 'money', { required: true, positive: true }),
      field('due_on', 'Payment due', 'date', { help: "Leave blank to use the client's payment terms" }),
      field('notes', 'Notes', 'textarea'),
    ],
    beforeSave(data, ctx) {
      if (data.due_on || !data.invoice_date || !data.client_id) return;
      const c = ctx.db.get('SELECT payment_terms_days FROM clients WHERE id = :id', { id: data.client_id });
      data.due_on = F.addDays(data.invoice_date, c && c.payment_terms_days != null ? c.payment_terms_days : 30);
    },
    childSummary(ctx, id) {
      const i = ctx.db.get('SELECT amount, received, deducted, balance FROM v_invoices WHERE id = :id', { id });
      return i ? html`<p class="child-sum">Invoiced <b>${F.money(i.amount)}</b> · received <b>${F.money(i.received)}</b>${i.deducted ? html` · deducted <b>${F.money(i.deducted)}</b>` : ''} · balance <b class="${i.balance > 0.5 ? 'tone-text-bad' : 'tone-text-ok'}">${F.money(i.balance)}</b></p>` : '';
    },
    columns: [
      { label: 'Invoice', render: (r, ctx) => C.edit('invoices', r, r.invoice_no, r.po_no ? `PO ${r.po_no}` : null, ctx) },
      clientCol,
      { label: 'Date', render: (r) => C.date(r.invoice_date) },
      { label: 'Amount', cls: 'r', render: (r) => C.money(r.amount) },
      { label: 'Received', cls: 'r', render: (r) => C.money(r.received + r.deducted) },
      { label: 'Balance', cls: 'r', render: (r) => (r.balance > 0.5 ? html`<b class="num">${F.money(r.balance)}</b>` : C.badge('Paid', 'ok')) },
      { label: 'Due', render: (r) => C.due(r.due_on, r.balance > 0.5) },
    ],
  },

  payments: {
    key: 'payments', table: 'payments', singular: 'payment', plural: 'Payments received', tab: 'invoices',
    editRoles: ['admin', 'accounts'],
    parent: { field: 'invoice_id', module: 'invoices', table: 'invoices' },
    title: (r) => `${F.money(r.amount)} on ${F.fmtDate(r.received_on)}`,
    listSql: `SELECT t.*, c.name AS client_name, i.invoice_no, u.name AS user_name
              FROM payments t JOIN clients c ON c.id = t.client_id JOIN invoices i ON i.id = t.invoice_id
              LEFT JOIN users u ON u.id = t.user_id`,
    order: 'received_on DESC, id DESC',
    search: ['invoice_no', 'reference', 'client_name'],
    csv: ['received_on', 'client_name', 'invoice_no', 'amount', 'deduction', 'mode', 'reference', 'user_name', 'notes'],
    fields: [
      field('invoice_id', 'Against invoice', 'invoice', { required: true }),
      field('received_on', 'Received on', 'date', { required: true, default: today }),
      field('amount', 'Amount received (₹)', 'money', { required: true }),
      field('deduction', 'TDS or debit note deducted (₹)', 'money', { help: 'Counts towards settling the invoice' }),
      field('mode', 'Mode', 'select', { options: OPT.paymentMode }),
      field('reference', 'UTR / cheque no'),
      field('notes', 'Notes', 'textarea'),
    ],
    prefill(ctx, values) {
      const id = Number(ctx.query.invoice_id);
      if (!id) return;
      const i = ctx.db.get('SELECT balance FROM v_invoices WHERE id = :id', { id });
      if (i && i.balance > 0.5) values.amount = i.balance;
    },
    validate(data, virt, errors, ctx, existing) {
      notFuture(data, errors, 'received_on');
      if (data.invoice_id && !errors.invoice_id) {
        const i = ctx.db.get('SELECT invoice_date FROM invoices WHERE id = :id', { id: data.invoice_id });
        if (i) notBefore(data, errors, 'received_on', i.invoice_date, 'invoice date');
      }
      const total = (data.amount || 0) + (data.deduction || 0);
      if (!errors.amount && total <= 0) errors.amount = 'Enter the amount received';
      if (errors.amount || errors.deduction || errors.invoice_id || !data.invoice_id) return;
      const inv = ctx.db.get('SELECT amount, received, deducted FROM v_invoices WHERE id = :id', { id: data.invoice_id });
      if (!inv) return;
      const mine = existing && existing.invoice_id === data.invoice_id ? existing.amount + (existing.deduction || 0) : 0;
      const due = Math.round((inv.amount - inv.received - inv.deducted + mine) * 100) / 100;
      if (total > due + 0.5) errors.amount = due > 0.5 ? `Only ${F.money2(due)} is still due on this invoice. Enter ${F.money2(due)} or less, with the TDS or debit note` : 'This invoice is already fully paid. Choose another invoice';
    },
    beforeInsert(data, ctx) { data.user_id = ctx.user.id; },
    columns: [
      { label: 'Date', render: (r, ctx) => C.edit('payments', r, F.fmtDate(r.received_on), null, ctx) },
      { label: 'Invoice', render: (r) => r.invoice_no },
      clientCol,
      { label: 'Amount', cls: 'r', render: (r) => C.money(r.amount) },
    ],
    childColumns: [
      { label: 'Date', render: (r, ctx) => C.edit('payments', r, F.fmtDate(r.received_on), null, ctx) },
      { label: 'Amount', cls: 'r', render: (r) => C.money(r.amount) },
      { label: 'Deducted', cls: 'r', render: (r) => (r.deduction ? C.money(r.deduction) : C.dash) },
      { label: 'Mode', render: (r) => C.text(r.mode) },
      { label: 'Reference', render: (r) => C.text(r.reference) },
      { label: 'Entered by', render: (r) => C.text(r.user_name) },
    ],
    emptyChild: 'No payment recorded against this invoice yet.',
  },

  complaints: {
    key: 'complaints', table: 'complaints', singular: 'complaint', plural: 'Quality complaints', tab: 'complaints',
    editRoles: ['admin', 'quality', 'sales'],
    help: 'Client complaints and rejections, from containment to closure.',
    title: (r) => [r.complaint_ref, C.clip(r.defect, 60)].filter(Boolean).join(' – '),
    listSql: `SELECT t.*, c.name AS client_name, u.name AS owner_name
              FROM complaints t JOIN clients c ON c.id = t.client_id LEFT JOIN users u ON u.id = t.owner_id`,
    order: "CASE WHEN status <> 'Closed' THEN 0 ELSE 1 END, CASE severity WHEN 'Critical' THEN 0 WHEN 'Major' THEN 1 ELSE 2 END, received_on DESC",
    search: ['complaint_ref', 'defect', 'part_name', 'part_no', 'root_cause', 'client_name'],
    views: [
      { key: 'open', label: 'Open', where: "status <> 'Closed'" },
      { key: 'overdue', label: 'Past target date', where: "status <> 'Closed' AND target_on < :t" },
      { key: 'closed', label: 'Closed', where: "status = 'Closed'" },
      { key: 'all', label: 'All' },
    ],
    defaultView: 'open',
    filters: [
      { name: 'severity', label: 'Severity', options: OPT.severity },
      { name: 'category', label: 'Type', options: OPT.complaintCategory },
      { name: 'owner_id', label: 'Owner', type: 'user', mine: true },
    ],
    csv: ['received_on', 'client_name', 'complaint_ref', 'category', 'severity', 'part_name', 'part_no', 'defect', 'qty_affected', 'status', 'owner_name', 'target_on', 'containment', 'root_cause', 'corrective_action', 'closed_on', 'notes'],
    fields: [
      field('client_id', 'Client', 'client', { required: true, section: 'Complaint' }),
      field('contact_id', 'Raised by', 'contact'),
      field('complaint_ref', "Client's complaint no"),
      field('received_on', 'Received on', 'date', { required: true, default: today }),
      field('category', 'Type', 'select', { options: OPT.complaintCategory }),
      field('severity', 'Severity', 'select', { options: OPT.severity, required: true, default: 'Major' }),
      field('part_name', 'Part'),
      field('part_no', 'Part no'),
      field('qty_affected', 'Quantity rejected / affected', 'int'),
      field('defect', 'Problem reported', 'textarea', { required: true }),
      field('status', 'Status', 'select', { options: OPT.complaintStatus, required: true, default: 'Open', section: 'Investigation' }),
      field('owner_id', 'Owner at SEI', 'user', { default: me }),
      field('target_on', 'Target closure date', 'date', { default: inDays(7) }),
      field('closed_on', 'Closed on', 'date', { help: 'The app fills this in when the status moves to Closed' }),
      field('containment', 'Containment action', 'textarea'),
      field('root_cause', 'Root cause', 'textarea'),
      field('corrective_action', 'Corrective and preventive action', 'textarea'),
      field('notes', 'Notes', 'textarea'),
    ],
    validate(data, virt, errors, ctx, existing) {
      notFuture(data, errors, 'received_on');
      notFuture(data, errors, 'closed_on');
      for (const f of ['target_on', 'closed_on']) notBefore(data, errors, f, data.received_on, 'received date');
      // A complaint is closed only when the cause is known and the action is recorded.
      const needsCause = ['Root cause found', 'Action taken', 'Closed'].includes(data.status);
      const needsAction = ['Action taken', 'Closed'].includes(data.status);
      if (needsCause && !data.root_cause && !errors.root_cause) errors.root_cause = 'Enter the root cause before you change the status';
      if (needsAction && !data.corrective_action && !errors.corrective_action) errors.corrective_action = 'Enter the corrective and preventive action before you change the status';
      if (data.client_id && data.complaint_ref && !errors.complaint_ref) {
        const dup = ctx.db.get('SELECT id FROM complaints WHERE client_id = :c AND complaint_ref = :r COLLATE NOCASE AND id <> :id', {
          c: data.client_id, r: data.complaint_ref, id: existing ? existing.id : 0,
        });
        if (dup) errors.complaint_ref = 'This complaint number is already entered for this client. Open that complaint instead';
      }
    },
    beforeSave(data) {
      if (data.status === 'Closed') data.closed_on = data.closed_on || F.today();
      else data.closed_on = null;
    },
    columns: [
      { label: 'Received', render: (r) => html`${C.date(r.received_on)}${r.status !== 'Closed' ? html`<span class="sub">${F.plural(F.daysBetween(r.received_on, F.today()), 'day')} open</span>` : ''}` },
      { label: 'Complaint', render: (r, ctx) => C.edit('complaints', r, C.clip(r.defect, 70), [r.complaint_ref, r.part_name, r.part_no].filter(Boolean).join(' · '), ctx) },
      clientCol,
      { label: 'Severity', render: (r) => C.badge(r.severity) },
      { label: 'Status', render: (r) => C.badge(r.status) },
      { label: 'Qty', cls: 'r', render: (r) => C.int(r.qty_affected) },
      { label: 'Owner', render: (r) => C.text(r.owner_name) },
      { label: 'Target', render: (r) => C.due(r.target_on, r.status !== 'Closed') },
    ],
  },

  // ---------- jobs ----------

  jobs: {
    key: 'jobs', table: 'jobs', singular: 'job', plural: 'Jobs', homeList: true,
    editRoles: [],
    // Admins give jobs to anyone; department heads to people in their own department.
    canEditRow: (user, row) => (row ? canManageJob(user, row) : !!user.is_head),
    forbidden: 'Only admins and department heads can give jobs. Only the person who gave a job, or the head of its department, can change it.',
    readonlyNote: 'Only the person who gave this job, the head of its department or an admin can change it. Post an update below to report progress.',
    help: 'Admins and department heads give jobs. See who does what, by when, and how far each job is.',
    title: (r) => r.title,
    listSql: `SELECT t.*, a.name AS assignee_name, b.name AS assigner_name, c.name AS client_name,
                     (SELECT u.note FROM job_updates u WHERE u.job_id = t.id AND u.note IS NOT NULL ORDER BY u.id DESC LIMIT 1) AS last_note,
                     (SELECT COUNT(*) FROM job_updates u WHERE u.job_id = t.id) AS update_count
              FROM jobs t JOIN users a ON a.id = t.assigned_to
              LEFT JOIN users b ON b.id = t.assigned_by LEFT JOIN clients c ON c.id = t.client_id`,
    order: `CASE WHEN status IN (${sqlIn(JOB_OPEN)}) THEN 0 ELSE 1 END, CASE priority WHEN 'Urgent' THEN 0 WHEN 'High' THEN 1 WHEN 'Normal' THEN 2 ELSE 3 END, COALESCE(due_on, '9999'), id`,
    search: ['title', 'details', 'assignee_name', 'assigner_name', 'client_name', 'last_note'],
    views: [
      { key: 'mine', label: 'My jobs', where: `assigned_to = :me AND status IN (${sqlIn(JOB_OPEN)})` },
      { key: 'given', label: 'Given by me', where: `assigned_by = :me AND status IN (${sqlIn(JOB_OPEN)})` },
      { key: 'dept', label: 'My department', where: `department = :dept AND status IN (${sqlIn(JOB_OPEN)})` },
      { key: 'overdue', label: 'Overdue', where: `status IN (${sqlIn(JOB_OPEN)}) AND due_on < :t` },
      { key: 'open', label: 'All open', where: `status IN (${sqlIn(JOB_OPEN)})` },
      { key: 'done', label: 'Done', where: "status = 'Done'" },
      { key: 'all', label: 'All' },
    ],
    defaultView: 'mine',
    filters: [
      { name: 'department', label: 'Department', options: OPT.seiDept },
      { name: 'priority', label: 'Priority', options: OPT.jobPriority },
      { name: 'status', label: 'Status', options: OPT.jobStatus },
      { name: 'assigned_to', label: 'Given to', type: 'user', mine: true },
    ],
    csv: ['due_on', 'title', 'department', 'assignee_name', 'assigner_name', 'priority', 'status', 'done_on', 'client_name', 'last_note', 'details'],
    fields: [
      field('title', 'Job', 'text', { required: true, wide: true, section: 'Job' }),
      field('details', 'Details', 'textarea', { help: 'What needs doing, and what “done” looks like' }),
      field('department', 'Department', 'select', { options: OPT.seiDept, required: true }),
      field('assigned_to', 'Give to', 'assignee', { required: true, help: 'The list shows people by department' }),
      field('priority', 'Priority', 'select', { options: OPT.jobPriority, required: true, default: 'Normal' }),
      field('due_on', 'Due by', 'date', { default: inDays(2) }),
      field('client_id', 'For client', 'client', { help: 'Optional. The job then shows on that client’s timeline.' }),
      field('status', 'Status', 'select', { options: OPT.jobStatus, required: true, default: 'To do' }),
    ],
    prefill(ctx, values) {
      if (ctx.user.department && !values.department) values.department = ctx.user.department;
      const to = Number(ctx.query.assigned_to);
      if (to) values.assigned_to = to;
    },
    validate(data, virt, errors, ctx, existing) {
      const u = ctx.user;
      const admin = isAdminUser(u);
      // Heads work inside their own department; a job already elsewhere may stay where it is.
      if (!admin && data.department && !errors.department && data.department !== u.department && !(existing && existing.department === data.department)) {
        errors.department = u.department ? `You can give jobs in ${u.department} only` : 'Ask an admin to set your department first';
      }
      if (data.assigned_to && !errors.assigned_to) {
        const a = ctx.db.get('SELECT name, department, active FROM users WHERE id = :id', { id: data.assigned_to });
        if (a && !a.active && !(existing && existing.assigned_to === data.assigned_to)) errors.assigned_to = `${a.name} can no longer sign in`;
        else if (a && !admin && data.department && a.department !== data.department) errors.assigned_to = `${a.name} is not in ${data.department}`;
      }
      if (!existing && data.due_on && !errors.due_on && data.due_on < F.today()) errors.due_on = 'Can’t be in the past';
    },
    beforeSave(data, ctx, existing) {
      if (data.status === 'Done') data.done_on = (existing && existing.status === 'Done' && existing.done_on) || F.today();
      else data.done_on = null;
      // Any change of status, here as on the job's progress form, needs a fresh sign-off.
      if (existing && data.status !== existing.status) { data.approved_by = null; data.approved_at = null; }
    },
    beforeInsert(data, ctx) { data.assigned_by = ctx.user.id; },
    afterInsert(ctx, id, data) {
      const a = ctx.db.get('SELECT name FROM users WHERE id = :id', { id: data.assigned_to });
      ctx.db.run('INSERT INTO job_updates (job_id, user_id, status, note) VALUES (:j, :u, :s, :n)', {
        j: id, u: ctx.user.id, s: data.status, n: `Gave this job to ${a ? a.name : 'someone'}${data.due_on ? `, due ${F.fmtDate(data.due_on)}` : ''}.`,
      });
    },
    // Changes made through the form also land in the job's history.
    afterUpdate(ctx, id, data, existing) {
      const notes = [];
      if (data.assigned_to !== existing.assigned_to) {
        const a = ctx.db.get('SELECT name FROM users WHERE id = :id', { id: data.assigned_to });
        notes.push(`Moved this job to ${a ? a.name : 'someone else'}.`);
      }
      if ((data.due_on || null) !== (existing.due_on || null)) notes.push(data.due_on ? `Due date changed to ${F.fmtDate(data.due_on)}.` : 'Due date removed.');
      if (data.priority !== existing.priority) notes.push(`Priority ${existing.priority} → ${data.priority}.`);
      if (!notes.length && data.status === existing.status) return;
      ctx.db.run('INSERT INTO job_updates (job_id, user_id, status, note) VALUES (:j, :u, :s, :n)', {
        j: id, u: ctx.user.id, s: data.status !== existing.status ? data.status : null, n: notes.join(' ') || null,
      });
    },
    // Progress: everyone involved can post an update or move the status; the history sits under the job.
    formExtra(ctx, id) {
      const job = ctx.db.get('SELECT * FROM jobs WHERE id = :id', { id });
      if (!job) return '';
      const ups = ctx.db.all(`SELECT u.*, us.name AS user_name FROM job_updates u LEFT JOIN users us ON us.id = u.user_id
                              WHERE u.job_id = :id ORDER BY u.id DESC`, { id });
      const can = canUpdateJob(ctx.user, job);
      const statuses = canManageJob(ctx.user, job) ? OPT.jobStatus : OPT.jobStatus.filter((s) => s !== 'Cancelled');
      const signOff = job.status === 'Done' && !job.approved_at && canManageJob(ctx.user, job) && (job.assigned_to !== ctx.user.id || isAdminUser(ctx.user))
        ? html`<form method="post" action="/jobs/${id}/review" class="form job-signoff">${C.csrf(ctx)}
<p><b>Done and waiting for your sign-off.</b> Check the updates and photos below.</p>
<div class="field"><label for="jr_note">Remark</label><input id="jr_note" name="note" placeholder="Needed when sending it back"></div>
<div class="form-actions spaced"><button class="btn btn-primary" name="decision" value="approve" type="submit">Sign off</button><button class="btn" name="decision" value="return" type="submit">Send back</button></div>
</form><div class="spacer"></div>`
        : '';
      const form = can ? html`${signOff}<form method="post" action="/jobs/${id}/update" enctype="multipart/form-data" class="form job-update">${C.csrf(ctx)}
<div class="fgrid">
  <div class="field"><label for="ju_status">Status</label><select id="ju_status" name="status">${statuses.map((s) => html`<option${s === job.status ? html` selected` : ''}>${s}</option>`)}</select></div>
  <div class="field"><label for="ju_files">Photos or PDF</label><input id="ju_files" type="file" name="files" accept="image/*,application/pdf" multiple></div>
  <div class="field wide"><label for="ju_note">Update</label><textarea id="ju_note" name="note" rows="3" placeholder="What has been done, what comes next, or what is holding it up"></textarea></div>
</div>
<div class="form-actions"><button class="btn btn-primary" type="submit">Post update</button></div>
</form>` : '';
      const list = ups.length
        ? html`<ol class="tl">${ups.map((u) => html`<li class="tl-item"><div class="tl-day"><b>${F.fmtDate(F.localDay(u.at))}</b>${F.relDays(F.localDay(u.at))}</div><div>
<div class="tl-title">${u.user_name || 'Someone'}${u.status ? html` ${C.badge(u.status)}` : ''}</div>
${u.note ? html`<div class="tl-notes">${u.note}</div>` : ''}
${U.gallery(U.listFor(ctx.db, 'job_updates', u.id))}
<div class="tl-meta">${F.fmtDateTime(u.at)}</div>
</div></li>`)}</ol>`
        : html`<p class="dim">No updates yet.</p>`;
      return html`<section class="card" id="progress"><div class="card-h"><h2>Progress${job.approved_at ? html` ${C.badge('Signed off', 'ok')}` : ''}</h2><span class="dim">${F.plural(ups.length, 'update')}</span></div><div class="card-b">${form}${form ? html`<div class="spacer"></div>` : ''}${list}</div></section>`;
    },
    columns: [
      { label: 'Due', render: (r) => (r.due_on ? C.due(r.due_on, JOB_OPEN.includes(r.status)) : C.dash) },
      { label: 'Job', render: (r, ctx) => C.edit('jobs', r, r.title, r.last_note ? C.clip(r.last_note, 90) : C.clip(r.details, 90), ctx) },
      { label: 'Given to', render: (r) => html`${r.assignee_name}<span class="sub">${r.department}</span>` },
      { label: 'Given by', render: (r) => C.text(r.assigner_name) },
      { label: 'Priority', render: (r) => C.badge(r.priority) },
      { label: 'Status', render: (r) => html`${r.status === 'Done' && r.approved_at ? C.badge('Signed off', 'ok') : C.badge(r.status)}${r.status === 'Done' && !r.approved_at ? html`<span class="sub tone-text-warn">waiting for sign-off</span>` : r.done_on ? html`<span class="sub">${F.fmtDate(r.done_on)}</span>` : ''}` },
      { label: 'Client', render: (r) => (r.client_id ? html`<a href="/clients/${r.client_id}">${r.client_name}</a>` : C.dash) },
      {
        label: '',
        render: (r, ctx) => {
          if (!canUpdateJob(ctx.user, r) || !JOB_OPEN.includes(r.status)) return '';
          return r.status === 'To do'
            ? C.actionButton(`/jobs/${r.id}/update`, 'Start', ctx, { status: 'In progress' }, r.title)
            : C.actionButton(`/jobs/${r.id}/update`, 'Done', ctx, { status: 'Done' }, r.title);
        },
      },
    ],
  },

  // ---------- the company checklist ----------

  checklists: {
    key: 'checklists', table: 'checklists', singular: 'checklist', plural: 'Checklist templates', noClient: true,
    editRoles: [],
    // Past or filled-in days are the record; only today's untouched copy goes with a mistaken template.
    dependents: [{ table: 'checklist_runs', fk: 'checklist_id', where: "status <> 'Open' OR due_on < :t", one: 'filled-in or missed day', many: 'filled-in or missed days' }],
    deleteHint: 'Untick In use instead, so its history stays.',
    canEditRow: (u, row) => CL.canManageChecklist(u, row),
    forbidden: 'Only admins and department heads can set up checklists, and heads only for their own department.',
    readonlyNote: 'Only the head of this department or an admin can change this checklist.',
    help: 'What gets checked, how often and by whom. On each day it is due, a new copy shows in My checklists.',
    title: (r) => r.title,
    listSql: `SELECT t.*, u.name AS assignee_name, a.code AS asset_code,
                     (SELECT COUNT(*) FROM checklist_runs r WHERE r.checklist_id = t.id AND r.due_on >= date(:t, '-28 days') AND r.due_on < :t) AS due28,
                     (SELECT COUNT(*) FROM checklist_runs r WHERE r.checklist_id = t.id AND r.due_on >= date(:t, '-28 days') AND r.due_on < :t
                        AND r.status IN ('Submitted', 'Approved', 'Done')) AS done28
              FROM checklists t LEFT JOIN users u ON u.id = t.assignee_id LEFT JOIN assets a ON a.id = t.asset_id`,
    order: 'active DESC, department, title',
    search: ['title', 'department', 'items_text', 'assignee_name', 'asset_code'],
    views: [{ key: 'active', label: 'In use', where: 'active = 1' }, { key: 'dept', label: 'My department', where: 'department = :dept' }, { key: 'all', label: 'All' }],
    defaultView: 'active',
    filters: [{ name: 'department', label: 'Department', options: OPT.seiDept }, { name: 'frequency', label: 'How often', options: CL.FREQ }],
    csv: ['title', 'department', 'frequency', 'weekday', 'month_day', 'assignee_name', 'asset_code', 'needs_approval', 'active', 'items_text', 'notes'],
    fields: [
      field('title', 'Checklist', 'text', { required: true, wide: true, section: 'Checklist' }),
      field('department', 'Department', 'select', { options: OPT.seiDept, required: true }),
      field('assignee_id', 'Filled in by', 'assignee', { help: 'Leave blank for anyone in the department' }),
      field('frequency', 'How often', 'select', { options: CL.FREQ, required: true, default: 'Daily (Mon–Sat)' }),
      field('weekday', 'Day of the week', 'select', { options: F.DAYS, help: 'For weekly checklists' }),
      field('month_day', 'Day of the month', 'int', { min: 1, help: 'For monthly checklists. 31 means the last day.' }),
      field('asset_id', 'For machine or tool', 'asset', { help: 'Optional' }),
      field('needs_approval', 'The head signs off each one', 'checkbox', { default: 1 }),
      field('active', 'In use', 'checkbox', { default: 1 }),
      field('items_text', 'Items to check', 'textarea', {
        required: true, rows: 12, section: 'Items',
        help: 'One per line. For a reading, end the line with its limits, like “Air pressure [5-6 kg/cm²]”. Or give only the unit, like “Diesel level [litres]”.',
      }),
      field('notes', 'Notes', 'textarea'),
    ],
    prefill(ctx, values) { if (ctx.user.department && !values.department) values.department = ctx.user.department; },
    validate(data, virt, errors, ctx, existing) {
      const u = ctx.user;
      if (!isAdminUser(u) && data.department && !errors.department && data.department !== u.department && !(existing && existing.department === data.department)) {
        errors.department = u.department ? `You can set up checklists for ${u.department} only` : 'Ask an admin to set your department first';
      }
      if (data.frequency === 'Weekly' && !data.weekday && !errors.weekday) errors.weekday = 'Pick the day';
      if (data.frequency === 'Monthly' && !errors.month_day && (!data.month_day || data.month_day > 31)) errors.month_day = 'Enter a day from 1 to 31';
      if (data.items_text && !errors.items_text && !CL.parseItems(data.items_text).length) errors.items_text = 'Add at least one item';
      if (data.assignee_id && !errors.assignee_id && !isAdminUser(u)) {
        const a = ctx.db.get('SELECT name, department FROM users WHERE id = :id', { id: data.assignee_id });
        if (a && a.department !== data.department) errors.assignee_id = `${a.name} is not in ${data.department}`;
      }
    },
    beforeSave(data) {
      if (data.frequency !== 'Weekly') data.weekday = null;
      if (data.frequency !== 'Monthly') data.month_day = null;
    },
    afterInsert(ctx, id) { CL.refreshToday(ctx.db, ctx.db.get('SELECT * FROM checklists WHERE id = :id', { id })); },
    afterUpdate(ctx, id) { CL.refreshToday(ctx.db, ctx.db.get('SELECT * FROM checklists WHERE id = :id', { id })); },
    listActions: (ctx) => (isAdminUser(ctx.user)
      ? html`<form method="post" action="/checklists/standard" class="inline" data-confirm="Add the standard checklists for a sheet-metal and welding plant? Ones with the same name are skipped.">${C.csrf(ctx)}<button class="btn" type="submit">Add standard checklists</button></form>`
      : ''),
    columns: [
      { label: 'Checklist', render: (r, ctx) => C.edit('checklists', r, r.title, [CL.describe(r), r.asset_code].filter(Boolean).join(' · '), ctx) },
      { label: 'Department', render: (r) => C.text(r.department) },
      { label: 'Filled in by', render: (r) => (r.assignee_name ? r.assignee_name : html`<span class="dim">Anyone in ${r.department}</span>`) },
      { label: 'Items', cls: 'r', render: (r) => C.int(CL.parseItems(r.items_text).length) },
      { label: 'Sign-off', render: (r) => (r.needs_approval ? C.badge('Head signs off', 'info') : C.dash) },
      { label: 'Done, last 4 weeks', cls: 'r', render: (r) => (r.due28 ? html`<span class="num ${r.done28 / r.due28 >= 0.9 ? 'tone-text-ok' : r.done28 / r.due28 >= 0.7 ? 'tone-text-warn' : 'tone-text-bad'}">${F.pct(r.done28, r.due28)}%</span><span class="sub">${r.done28} of ${r.due28}</span>` : C.dash) },
      { label: 'Status', render: (r) => (r.active ? C.badge('In use', 'ok') : C.badge('Not in use', 'muted')) },
    ],
  },

  checklist_runs: {
    key: 'checklist_runs', table: 'checklist_runs', singular: 'checklist', many: 'checklists', plural: 'Checklist register', noClient: true,
    editRoles: [],
    readOnly: true, // no generic new / edit / delete pages, admins included: filled in and signed off on its own page
    canEditRow: () => false,
    forbidden: 'Fill in checklists from My checklists.',
    help: 'Every checklist that has come due: who filled it in, when, what was wrong, and who signed it off.',
    title: (r) => `Checklist for ${F.fmtDate(r.due_on)}`,
    listSql: `SELECT t.*, c.title, c.needs_approval, u.name AS assignee_name, s.name AS submitter_name, v.name AS reviewer_name
              FROM checklist_runs t JOIN checklists c ON c.id = t.checklist_id
              LEFT JOIN users u ON u.id = t.assignee_id LEFT JOIN users s ON s.id = t.submitted_by LEFT JOIN users v ON v.id = t.reviewed_by`,
    order: 'due_on DESC, department, title',
    search: ['title', 'department', 'assignee_name', 'submitter_name', 'remarks', 'review_note'],
    views: [
      { key: 'today', label: 'Today', where: 'due_on = :t' },
      { key: 'missed', label: 'Missed', where: "status IN ('Open', 'Returned') AND due_on < :t" },
      { key: 'issues', label: 'With problems', where: 'issues > 0' },
      { key: 'review', label: 'Waiting for sign-off', where: "status = 'Submitted'" },
      { key: 'week', label: 'This week', where: 'due_on >= :wk' },
      { key: 'all', label: 'All' },
    ],
    defaultView: 'today',
    filters: [{ name: 'department', label: 'Department', options: OPT.seiDept }, { name: 'status', label: 'Status', options: OPT.runStatus }],
    csv: ['due_on', 'title', 'department', 'assignee_name', 'status', 'issues', 'submitter_name', 'submitted_at', 'reviewer_name', 'reviewed_at', 'review_note', 'remarks'],
    fields: [],
    columns: [
      { label: 'Due', render: (r) => html`${C.date(r.due_on)}${CL.RUN_OPEN.includes(r.status) && r.due_on < F.today() ? html`<span class="sub tone-text-bad">Missed</span>` : ''}` },
      { label: 'Checklist', render: (r) => html`<a class="rowlink" href="/checklist_runs/${r.id}">${r.title}</a><span class="sub">${r.department}</span>` },
      { label: 'Filled in by', render: (r) => (r.submitter_name ? html`${r.submitter_name}<span class="sub">${F.fmtDateTime(r.submitted_at)}</span>` : html`<span class="dim">${r.assignee_name || `Anyone in ${r.department}`}</span>`) },
      { label: 'Problems', cls: 'r', render: (r) => (r.issues ? html`<b class="num tone-text-bad">${r.issues}</b>` : C.dash) },
      { label: 'Status', render: (r) => C.runStatus(r.status) },
      { label: 'Signed off by', render: (r) => (r.reviewer_name ? html`${r.reviewer_name}<span class="sub">${F.fmtDate(F.localDay(r.reviewed_at))}</span>` : C.dash) },
    ],
  },

  compliance_items: {
    key: 'compliance_items', table: 'compliance_items', singular: 'compliance item', plural: 'Compliance calendar', noClient: true,
    editRoles: [],
    dependents: [{ table: 'compliance_filings', fk: 'item_id', one: 'filing' }],
    deleteHint: 'Untick In use instead, so its filings stay.',
    canEditRow: (u, row) => isAdminUser(u) || u.role === 'accounts' || (row ? !!u.is_head && u.department === row.department : !!u.is_head),
    forbidden: 'Only admins, accounts and department heads can change the compliance calendar.',
    help: 'Statutory returns and payments, licence and insurance renewals, calibration. See what is due, when, who files it, and the proof.',
    title: (r) => r.title,
    listSql: `SELECT t.*, u.name AS owner_name, date(t.due_on, '-' || t.remind_days || ' days') AS remind_on,
                     (SELECT MAX(f.done_on) FROM compliance_filings f WHERE f.item_id = t.id) AS last_done
              FROM compliance_items t LEFT JOIN users u ON u.id = t.owner_id`,
    order: 'active DESC, due_on, title',
    search: ['title', 'category', 'authority', 'notes', 'owner_name'],
    views: [
      { key: 'month', label: 'Next 30 days', where: 'active = 1 AND due_on <= :tp30' },
      { key: 'due', label: 'Due soon or overdue', where: 'active = 1 AND remind_on <= :t' },
      { key: 'overdue', label: 'Overdue', where: 'active = 1 AND due_on < :t' },
      { key: 'active', label: 'All in use', where: 'active = 1' },
      { key: 'all', label: 'All' },
    ],
    defaultView: 'month',
    filters: [
      { name: 'category', label: 'Category', options: OPT.complianceCategory },
      { name: 'frequency', label: 'How often', options: OPT.complianceFrequency },
      { name: 'owner_id', label: 'Owner', type: 'user', mine: true },
    ],
    csv: ['due_on', 'title', 'category', 'frequency', 'owner_name', 'department', 'authority', 'remind_days', 'last_done', 'active', 'notes'],
    fields: [
      field('title', 'What', 'text', { required: true, wide: true, section: 'Compliance item' }),
      field('category', 'Category', 'select', { options: OPT.complianceCategory, required: true }),
      field('frequency', 'How often', 'select', { options: OPT.complianceFrequency, required: true, default: 'Monthly' }),
      field('due_on', 'Next due on', 'date', { required: true }),
      field('remind_days', 'Remind this many days before', 'int', { required: true, default: 7 }),
      field('owner_id', 'Owner', 'assignee', { help: 'Who files it or gets it renewed' }),
      field('department', 'Department', 'select', { options: OPT.seiDept }),
      field('authority', 'Filed with', 'text', { help: 'For example GST portal, EPFO, fire department, insurer' }),
      field('active', 'In use', 'checkbox', { default: 1 }),
      field('notes', 'Notes', 'textarea'),
    ],
    prefill(ctx, values) { if (ctx.user.department && !values.department) values.department = ctx.user.department; },
    // Admins and accounts look after every item; a department head only after their own department's.
    validate(data, virt, errors, ctx, existing) {
      const u = ctx.user;
      if (isAdminUser(u) || u.role === 'accounts' || errors.department) return;
      if (data.department !== u.department && !(existing && existing.department === data.department)) {
        errors.department = u.department ? `You can add compliance items for ${u.department} only` : 'Ask an admin to set your department first';
      }
    },
    beforeSave(data) { if (data.due_on) data.due_day = Number(String(data.due_on).slice(8)); },
    listActions: (ctx) => (isAdminUser(ctx.user)
      ? html`<form method="post" action="/compliance_items/standard" class="inline" data-confirm="Add the standard statutory dates (GST, TDS, PF, ESI, advance tax, ROC, income tax)? Ones already there are skipped.">${C.csrf(ctx)}<button class="btn" type="submit">Add standard statutory dates</button></form>`
      : ''),
    formExtra: (ctx, id, values) => require('./routes/checklists').complianceExtra(ctx, id, values),
    columns: [
      { label: 'Due', render: (r) => (r.active ? C.due(r.due_on, true) : C.date(r.due_on)) },
      { label: 'What', render: (r, ctx) => C.edit('compliance_items', r, r.title, [r.category, r.authority].filter(Boolean).join(' · '), ctx) },
      { label: 'How often', render: (r) => C.text(r.frequency) },
      { label: 'Owner', render: (r) => html`${C.text(r.owner_name)}${r.department ? html`<span class="sub">${r.department}</span>` : ''}` },
      { label: 'Last done', render: (r) => C.date(r.last_done) },
      { label: '', render: (r) => (r.active ? html`<a class="btn btn-sm" href="/compliance_items/${r.id}/edit#done">Mark done</a>` : '') },
    ],
  },

  // ---------- weekly planning ----------

  sales_plans: {
    key: 'sales_plans', table: 'sales_plans', singular: 'sales plan line', plural: 'Sales plan', weekly: true, homeList: true,
    editRoles: ['admin', 'sales'],
    help: 'What each client should get each week, against what was actually dispatched that week.',
    title: (r) => `${r.part_name} – week of ${F.fmtDate(r.week_start)}`,
    listSql: `SELECT t.*, c.name AS client_name, o.po_no, u.name AS owner_name
              FROM v_sales_plans t JOIN clients c ON c.id = t.client_id
              LEFT JOIN orders o ON o.id = t.order_id LEFT JOIN users u ON u.id = t.owner_id`,
    order: 'week_start DESC, client_name, part_name',
    search: ['part_name', 'part_no', 'po_no', 'client_name'],
    views: [...WEEK_VIEWS, { key: 'behind', label: 'Behind plan', where: "actual_qty < planned_qty AND COALESCE(dispatch_on, date(week_start, '+6 days')) < :t" }, ALL_WEEKS],
    defaultView: 'week',
    filters: [{ name: 'owner_id', label: 'Handled by', type: 'user', mine: true }],
    csv: ['week_start', 'client_name', 'po_no', 'part_name', 'part_no', 'planned_qty', 'rate', 'planned_value', 'actual_qty', 'actual_value', 'balance_qty', 'dispatch_on', 'owner_name', 'notes'],
    fields: [
      field('week_start', 'Plan week', 'date', { required: true, default: thisMonday, help: 'Any day in the week; it is saved against that Monday' }),
      field('client_id', 'Client', 'client', { required: true }),
      field('order_id', 'Against PO / schedule', 'order', { help: 'Optional. With a PO, only dispatches against it count as actual' }),
      field('part_name', 'Part', 'text', { required: true }),
      field('part_no', 'Part no'),
      field('planned_qty', 'Planned dispatch (pcs)', 'int', { required: true, min: 1 }),
      field('rate', 'Rate per piece (₹)', 'money2', { help: 'Taken from the PO if left blank' }),
      field('dispatch_on', 'Planned dispatch day', 'date'),
      field('owner_id', 'Handled by', 'user', { default: me }),
      field('notes', 'Notes', 'textarea'),
    ],
    prefill(ctx, values) {
      const id = Number(ctx.query.order_id);
      if (!id) return;
      const o = ctx.db.get('SELECT client_id, part_name, part_no, unit_price, pending FROM v_orders WHERE id = :id', { id });
      if (o) Object.assign(values, { order_id: id, client_id: o.client_id, part_name: o.part_name, part_no: o.part_no, rate: o.unit_price, planned_qty: o.pending > 0 ? o.pending : null });
    },
    validate(data, virt, errors, ctx, existing) {
      if (!data.week_start || errors.week_start) return;
      const ws = F.weekOf(data.week_start);
      if (data.dispatch_on && !errors.dispatch_on && F.weekOf(data.dispatch_on) !== ws) errors.dispatch_on = `Pick a day in the week of ${F.weekLabel(ws)}`;
      if (data.client_id && data.part_name && !errors.part_name) {
        const dup = ctx.db.get(`SELECT id FROM sales_plans WHERE week_start = :ws AND client_id = :c AND part_name = :p COLLATE NOCASE
                                AND COALESCE(part_no, '') = COALESCE(:pno, '') COLLATE NOCASE AND COALESCE(order_id, 0) = COALESCE(:o, 0) AND id <> :id`, {
          ws, c: data.client_id, p: data.part_name, pno: data.part_no, o: data.order_id, id: existing ? existing.id : 0,
        });
        if (dup) errors.part_name = 'This week already has a line for this part. Change its quantity instead.';
      }
    },
    beforeSave(data, ctx) {
      data.week_start = F.weekOf(data.week_start);
      if (data.rate == null && data.order_id) {
        const o = ctx.db.get('SELECT unit_price FROM orders WHERE id = :id', { id: data.order_id });
        if (o) data.rate = o.unit_price;
      }
    },
    listSummary(ctx, rows) {
      if (!rows.length) return '';
      const pv = sum(rows, 'planned_value');
      const av = sum(rows, 'actual_value');
      return C.sumbar([
        { label: 'planned', value: `${F.num(sum(rows, 'planned_qty'))} pcs · ${F.moneyShort(pv)}` },
        { label: 'dispatched', value: `${F.num(sum(rows, 'actual_qty'))} pcs · ${F.moneyShort(av)}` },
        { label: 'of plan value dispatched', value: pv > 0 ? `${F.pct(av, pv)}%` : '—' },
        { label: 'lines past their day and short', value: rows.filter((r) => duePassed(r) && r.actual_qty < r.planned_qty).length, tone: rows.some((r) => duePassed(r) && r.actual_qty < r.planned_qty) ? 'bad' : '' },
      ]);
    },
    columns: [
      { label: 'Week', render: (r) => C.week(r.week_start) },
      { label: 'Part', render: (r, ctx) => C.edit('sales_plans', r, r.part_name, [r.part_no, r.po_no && `PO ${r.po_no}`].filter(Boolean).join(' · '), ctx) },
      clientCol,
      { label: 'Planned', cls: 'r', render: (r) => C.int(r.planned_qty) },
      { label: 'Dispatched', cls: 'r', render: (r) => C.int(r.actual_qty) },
      { label: 'Achieved', cls: 'r', render: (r) => achieved(r.actual_qty, r.planned_qty, started(r), duePassed(r)) },
      { label: 'Plan value', cls: 'r', render: (r) => C.money(r.planned_value) },
      { label: 'Dispatch day', render: (r) => (r.dispatch_on ? html`${F.dayName(r.dispatch_on).slice(0, 3)} ${F.fmtDate(r.dispatch_on)}` : C.dash) },
      { label: 'Handled by', render: (r) => C.text(r.owner_name) },
    ],
  },

  production_plans: {
    key: 'production_plans', table: 'production_plans', singular: 'production plan line', plural: 'Production plan', weekly: true, homeList: true,
    editRoles: ['admin', 'production'],
    help: 'Day and shift plan for each machine, with what was actually produced and rejected.',
    title: (r) => `${r.part_name} on ${F.fmtDate(r.plan_date)}`,
    listSql: `SELECT t.*, c.name AS client_name, a.code AS asset_code, a.name AS asset_name, a.status AS asset_status, u.name AS supervisor_name,
                     (SELECT COUNT(*) FROM pm_tasks p WHERE p.asset_id = t.asset_id AND p.planned_on = t.plan_date AND p.status IN (${sqlIn(PM_OPEN)})) AS pm_clash
              FROM production_plans t LEFT JOIN clients c ON c.id = t.client_id
              LEFT JOIN assets a ON a.id = t.asset_id LEFT JOIN users u ON u.id = t.supervisor_id`,
    order: 'plan_date, shift, asset_code, id',
    search: ['part_name', 'part_no', 'asset_code', 'asset_name', 'client_name', 'notes'],
    views: [...WEEK_VIEWS, { key: 'short', label: 'Short or not updated', where: "plan_date < :t AND status NOT IN ('Done', 'Cancelled')" }, ALL_WEEKS],
    defaultView: 'week',
    filters: [
      { name: 'status', label: 'Status', options: OPT.productionStatus },
      { name: 'operation', label: 'Operation', options: OPT.operation },
      { name: 'shift', label: 'Shift', options: OPT.shift },
    ],
    csv: ['plan_date', 'shift', 'asset_code', 'asset_name', 'operation', 'client_name', 'part_name', 'part_no', 'planned_qty', 'produced_qty', 'rejected_qty', 'status', 'shortfall_reason', 'supervisor_name', 'notes'],
    fields: [
      field('plan_date', 'Date', 'date', { required: true, default: today, section: 'Plan' }),
      field('shift', 'Shift', 'select', { options: OPT.shift, default: 'General' }),
      field('asset_id', 'Machine', 'machine'),
      field('operation', 'Operation', 'select', { options: OPT.operation }),
      field('client_id', 'For client', 'client'),
      field('part_name', 'Part', 'text', { required: true }),
      field('part_no', 'Part no'),
      field('planned_qty', 'Planned quantity (pcs)', 'int', { required: true, min: 1 }),
      field('supervisor_id', 'Supervisor', 'user', { default: me }),
      field('produced_qty', 'Produced (OK pcs)', 'int', { section: 'Actual' }),
      field('rejected_qty', 'Rejected (pcs)', 'int'),
      field('status', 'Status', 'select', { options: OPT.productionStatus, required: true, default: 'Planned', help: 'Moves to Done or Short by itself when you enter the produced quantity' }),
      field('shortfall_reason', 'Reason if short', 'select', { options: OPT.shortfallReason }),
      field('notes', 'Notes', 'textarea'),
    ],
    validate(data, virt, errors) {
      // The same rule as beforeSave below: a produced quantity moves the status to Done or Short.
      const status = data.produced_qty != null && ['Planned', 'In progress'].includes(data.status)
        ? (data.produced_qty >= data.planned_qty ? 'Done' : 'Short') : data.status;
      if (status === 'Short' && !data.shortfall_reason && !errors.shortfall_reason) errors.shortfall_reason = 'Choose why the quantity is short';
    },
    beforeSave(data) {
      data.week_start = F.weekOf(data.plan_date);
      if (data.produced_qty != null && ['Planned', 'In progress'].includes(data.status)) data.status = data.produced_qty >= data.planned_qty ? 'Done' : 'Short';
    },
    listSummary(ctx, rows) {
      if (!rows.length) return '';
      const planned = sum(rows, 'planned_qty');
      const made = sum(rows, 'produced_qty');
      const rej = sum(rows, 'rejected_qty');
      const clashes = rows.filter((r) => r.pm_clash || r.asset_status === 'Breakdown').length;
      return C.sumbar([
        { label: 'pcs planned', value: F.num(planned) },
        { label: 'produced', value: `${F.num(made)}${planned ? ` (${F.pct(made, planned)}%)` : ''}` },
        { label: 'rejection', value: made + rej > 0 ? `${((rej / (made + rej)) * 100).toFixed(1)}%` : '—', tone: rej > 0.02 * (made + rej) ? 'bad' : '' },
        { label: 'lines short', value: rows.filter((r) => r.status === 'Short').length, tone: rows.some((r) => r.status === 'Short') ? 'bad' : '' },
        ...(clashes ? [{ label: 'on a machine under PM or breakdown', value: clashes, tone: 'bad' }] : []),
      ]);
    },
    columns: [
      { label: 'Date', render: (r) => html`<span class="nowrap">${F.dayName(r.plan_date).slice(0, 3)} ${F.fmtDate(r.plan_date)}</span><span class="sub">${r.shift || ''}</span>` },
      {
        label: 'Machine',
        render: (r) => (r.asset_id ? html`<a href="/assets/${r.asset_id}/edit">${r.asset_code}</a><span class="sub">${r.asset_name}</span>${r.asset_status === 'Breakdown' ? C.badge('Breakdown', 'bad') : ''}${r.pm_clash ? C.badge('PM same day', 'warn') : ''}` : C.dash),
      },
      { label: 'Part', render: (r, ctx) => C.edit('production_plans', r, r.part_name, [r.part_no, r.client_name].filter(Boolean).join(' · '), ctx) },
      { label: 'Operation', render: (r) => C.text(r.operation) },
      { label: 'Planned', cls: 'r', render: (r) => C.int(r.planned_qty) },
      { label: 'Produced', cls: 'r', render: (r) => C.int(r.produced_qty) },
      { label: 'Rejected', cls: 'r', render: (r) => C.int(r.rejected_qty) },
      { label: 'Status', render: (r) => html`${C.badge(r.status)}${r.shortfall_reason ? html`<span class="sub">${r.shortfall_reason}</span>` : ''}` },
    ],
  },

  assets: {
    key: 'assets', table: 'assets', singular: 'machine or tool', many: 'machines and tools', plural: 'Machines & tools', noClient: true,
    editRoles: ['admin', 'production'],
    help: 'Every machine, die, fixture and gauge, each with its own preventive maintenance checklist, frequency and history.',
    children: ['pm_tasks'],
    dependents: [
      { table: 'pm_tasks', fk: 'asset_id', one: 'PM task' },
      { table: 'production_plans', fk: 'asset_id', one: 'production plan line' },
    ],
    deleteHint: 'Set its status to Scrapped instead, so its PM history stays.',
    title: (r) => [r.code, r.name].filter(Boolean).join(' – '),
    listSql: 'SELECT t.*, u.name AS responsible_name FROM v_assets t LEFT JOIN users u ON u.id = t.responsible_id',
    order: "CASE asset_type WHEN 'Machine' THEN 0 WHEN 'Utility' THEN 1 WHEN 'Tool / die' THEN 2 WHEN 'Fixture' THEN 3 ELSE 4 END, code",
    search: ['code', 'name', 'category', 'location', 'make', 'part_name', 'serial_no'],
    views: [
      { key: 'active', label: 'In use', where: "status <> 'Scrapped'" },
      { key: 'due', label: 'PM due by next week', where: "status <> 'Scrapped' AND pm_frequency IS NOT NULL AND (next_pm_on IS NULL OR next_pm_on <= :wkne)" },
      { key: 'breakdown', label: 'Breakdown', where: "status = 'Breakdown'" },
      { key: 'all', label: 'All' },
    ],
    defaultView: 'active',
    filters: [
      { name: 'asset_type', label: 'Type', options: OPT.assetType },
      { name: 'pm_frequency', label: 'PM frequency', options: OPT.pmFrequency },
    ],
    csv: ['code', 'name', 'asset_type', 'category', 'location', 'make', 'model_no', 'serial_no', 'capacity', 'part_name', 'status', 'installed_on', 'pm_frequency', 'pm_day', 'pm_minutes', 'responsible_name', 'last_done_on', 'next_pm_on', 'pm_checklist', 'notes'],
    fields: [
      field('code', 'Code', 'text', { required: true, upper: true, section: 'Machine or tool', help: 'Short and unique, like PP-01 or DIE-PBL-01' }),
      field('name', 'Name', 'text', { required: true }),
      field('asset_type', 'Type', 'select', { options: OPT.assetType, required: true, default: 'Machine' }),
      field('category', 'Kind', 'text', { help: 'For example Power press 200 T, MIG welder, Blanking die' }),
      field('location', 'Line / bay'),
      field('part_name', 'Used for part', 'text', { help: 'For dies, fixtures and gauges' }),
      field('make', 'Make'),
      field('model_no', 'Model'),
      field('serial_no', 'Serial / asset tag no'),
      field('capacity', 'Capacity', 'text', { help: 'For example 200 T, 400 A, 15 HP' }),
      field('installed_on', 'Installed on', 'date'),
      field('status', 'Status', 'select', { options: OPT.assetStatus, required: true, default: 'Running' }),
      field('pm_frequency', 'PM frequency', 'select', { options: OPT.pmFrequency, section: 'Preventive maintenance', help: 'Monthly is every 4 weeks, quarterly 13, half-yearly 26, yearly 52' }),
      field('pm_day', 'PM day', 'select', { options: OPT.weekday, help: 'The day of its week the PM is planned' }),
      field('pm_minutes', 'Planned downtime (minutes)', 'int'),
      field('responsible_id', 'Responsible', 'user'),
      field('last_pm_on', 'Last PM done before this register', 'date', { help: 'Needed once, so the first due date is right. After that the CRM uses the PM tasks marked Done.' }),
      field('pm_checklist', 'PM checklist', 'textarea', { rows: 9, help: 'One check per line: what to check, what is OK, and how. Copied into each PM task.' }),
      field('notes', 'Notes', 'textarea', { section: 'Notes' }),
    ],
    validate(data, virt, errors, ctx, existing) {
      if (data.code && !errors.code && ctx.db.get('SELECT id FROM assets WHERE code = :c AND id <> :id', { c: data.code, id: existing ? existing.id : 0 })) errors.code = 'Another machine or tool already has this code';
      if (data.pm_frequency && !data.pm_checklist) errors.pm_checklist = 'Add at least one check so the PM task says what to do';
    },
    childSummary(ctx, id) {
      const a = ctx.db.get('SELECT * FROM v_assets WHERE id = :id', { id });
      if (!a) return '';
      if (!a.pm_frequency) return html`<p class="child-sum">No PM frequency set, so this ${a.asset_type.toLowerCase()} is never planned automatically.</p>`;
      return html`<p class="child-sum">PM <b>${a.pm_frequency.toLowerCase()}</b>${a.pm_day ? html` on <b>${a.pm_day}</b>` : ''} · last done <b>${a.last_done_on ? F.fmtDate(a.last_done_on) : 'never'}</b> · next due <b class="${!a.next_pm_on || a.next_pm_on < F.today() ? 'tone-text-bad' : ''}">${a.next_pm_on ? F.fmtDate(a.next_pm_on) : 'now'}</b>${a.open_tasks ? html` · ${F.plural(a.open_tasks, 'open task')}` : ''}</p>`;
    },
    columns: [
      { label: 'Machine or tool', render: (r, ctx) => C.edit('assets', r, `${r.code} – ${r.name}`, [r.category, r.part_name && `for ${r.part_name}`].filter(Boolean).join(' · '), ctx) },
      { label: 'Type', render: (r) => C.text(r.asset_type) },
      { label: 'Line / bay', render: (r) => C.text(r.location) },
      { label: 'PM', render: (r) => (r.pm_frequency ? html`${r.pm_frequency}<span class="sub">${r.pm_day || 'any day'}</span>` : C.dash) },
      { label: 'Last PM', render: (r) => C.date(r.last_done_on) },
      {
        label: 'Next PM',
        render: (r) => (!r.pm_frequency || r.status === 'Scrapped' ? C.dash
          : r.next_planned_on ? html`${C.due(r.next_planned_on, true)}<span class="sub">planned</span>`
            : r.next_pm_on ? C.due(r.next_pm_on, true) : html`<span class="tone-text-bad">Due now</span>`),
      },
      { label: 'Status', render: (r) => C.badge(r.status) },
    ],
  },

  pm_tasks: {
    key: 'pm_tasks', table: 'pm_tasks', singular: 'PM task', plural: 'Preventive maintenance', noClient: true, weekly: true,
    editRoles: ['admin', 'production', 'quality'],
    help: 'Each week’s preventive maintenance, machine by machine and tool by tool. To fill a week, press “Plan PM for this week” on the Week planner.',
    parent: { field: 'asset_id', module: 'assets', table: 'assets', noClient: true, standalone: true },
    title: (r) => `PM on ${F.fmtDate(r.planned_on)}`,
    listSql: `SELECT t.*, a.code AS asset_code, a.name AS asset_name, a.asset_type, a.location, u.name AS assigned_name
              FROM pm_tasks t JOIN assets a ON a.id = t.asset_id LEFT JOIN users u ON u.id = t.assigned_to`,
    order: `CASE WHEN status IN (${sqlIn(PM_OPEN)}) THEN 0 ELSE 1 END, planned_on, asset_code`,
    childOrder: `CASE WHEN status IN (${sqlIn(PM_OPEN)}) THEN 0 ELSE 1 END, planned_on DESC`, // on a machine's page: open first, then newest history
    search: ['asset_code', 'asset_name', 'location', 'technician', 'findings', 'spares_used'],
    views: [
      WEEK_VIEWS[0], WEEK_VIEWS[1],
      { key: 'overdue', label: 'Overdue', where: `status IN (${sqlIn(PM_OPEN)}) AND planned_on < :t` },
      WEEK_VIEWS[2],
      { key: 'done', label: 'Done', where: "status = 'Done'" },
      ALL_WEEKS,
    ],
    defaultView: 'week',
    filters: [
      { name: 'status', label: 'Status', options: OPT.pmStatus },
      { name: 'asset_type', label: 'Type', options: OPT.assetType },
      { name: 'assigned_to', label: 'Responsible', type: 'user', mine: true },
    ],
    csv: ['planned_on', 'asset_code', 'asset_name', 'asset_type', 'location', 'assigned_name', 'technician', 'status', 'done_on', 'downtime_min', 'findings', 'spares_used', 'cost', 'checklist', 'notes'],
    fields: [
      field('asset_id', 'Machine or tool', 'asset', { required: true }),
      field('planned_on', 'Planned on', 'date', { required: true, default: today }),
      field('assigned_to', 'Responsible', 'user'),
      field('technician', 'Done by (fitter / technician)'),
      field('status', 'Status', 'select', { options: OPT.pmStatus, required: true, default: 'Planned' }),
      field('checklist', 'Checklist', 'textarea', { rows: 8, help: 'Filled from the machine’s checklist if left blank' }),
      field('done_on', 'Done on', 'date', { section: 'Result', help: 'The app fills this in when the status moves to Done' }),
      field('downtime_min', 'Downtime (minutes)', 'int'),
      field('findings', 'Findings and abnormalities', 'textarea'),
      field('spares_used', 'Spares used'),
      field('cost', 'Cost of spares and service (₹)', 'money'),
      field('notes', 'Notes', 'textarea'),
    ],
    prefill(ctx, values) {
      const a = values.asset_id && ctx.db.get('SELECT * FROM v_assets WHERE id = :id', { id: values.asset_id });
      if (!a) return;
      values.checklist = a.pm_checklist;
      values.assigned_to = a.responsible_id;
      if (a.pm_day) values.planned_on = F.addDays(thisMonday(), F.DAYS.indexOf(a.pm_day));
    },
    validate(data, virt, errors) {
      if (data.status === 'Done' && data.done_on && !errors.done_on && data.done_on > F.today()) errors.done_on = 'Can’t be in the future';
    },
    beforeSave(data, ctx, existing) {
      data.week_start = F.weekOf(data.planned_on);
      if (data.status === 'Done') data.done_on = data.done_on || (existing && existing.done_on) || F.today();
      else data.done_on = null;
      if (!data.checklist && data.asset_id) {
        const a = ctx.db.get('SELECT pm_checklist FROM assets WHERE id = :id', { id: data.asset_id });
        if (a) data.checklist = a.pm_checklist;
      }
    },
    beforeInsert(data, ctx) { data.user_id = ctx.user.id; },
    listSummary(ctx, rows) {
      if (!rows.length) return '';
      const t = F.today();
      const open = rows.filter((r) => PM_OPEN.includes(r.status));
      return C.sumbar([
        { label: 'PM tasks', value: rows.length },
        { label: 'done', value: rows.filter((r) => r.status === 'Done').length, tone: 'ok' },
        { label: 'still open', value: open.length },
        { label: 'overdue', value: open.filter((r) => r.planned_on < t).length, tone: open.some((r) => r.planned_on < t) ? 'bad' : '' },
        { label: 'missed', value: rows.filter((r) => r.status === 'Missed').length, tone: rows.some((r) => r.status === 'Missed') ? 'bad' : '' },
        { label: 'downtime', value: `${F.num(sum(rows, 'downtime_min'))} min` },
      ]);
    },
    columns: [
      { label: 'Planned', render: (r) => html`${C.due(r.planned_on, PM_OPEN.includes(r.status))}<span class="sub">${F.dayName(r.planned_on)}</span>` },
      { label: 'Machine or tool', render: (r, ctx) => C.edit('pm_tasks', r, `${r.asset_code} – ${r.asset_name}`, [r.asset_type, r.location].filter(Boolean).join(' · '), ctx) },
      { label: 'Checks', render: (r) => (r.checklist ? html`${F.plural(r.checklist.split('\n').filter((l) => l.trim()).length, 'check')}<span class="sub">${C.clip(r.checklist.split('\n')[0], 60)}</span>` : C.dash) },
      { label: 'Responsible', render: (r) => html`${C.text(r.assigned_name)}${r.technician ? html`<span class="sub">Done by ${r.technician}</span>` : ''}` },
      { label: 'Status', render: (r) => html`${C.badge(r.status)}${r.done_on ? html`<span class="sub">${F.fmtDate(r.done_on)}</span>` : ''}` },
      { label: '', render: (r, ctx) => (PM_OPEN.includes(r.status) && canEdit(ctx.user, MODULES.pm_tasks) ? C.actionButton(`/pm_tasks/${r.id}/done`, 'Done', ctx, {}, `PM of ${r.asset_code || ''} ${r.asset_name || ''}`.trim()) : '') },
    ],
    childColumns: [
      { label: 'Planned', render: (r, ctx) => C.edit('pm_tasks', r, F.fmtDate(r.planned_on), F.dayName(r.planned_on), ctx) },
      { label: 'Status', render: (r) => C.badge(r.status) },
      { label: 'Done on', render: (r) => C.date(r.done_on) },
      { label: 'Done by', render: (r) => C.text(r.technician) },
      { label: 'Downtime', cls: 'r', render: (r) => (r.downtime_min != null ? html`<span class="num">${F.num(r.downtime_min)} min</span>` : C.dash) },
      { label: 'Findings', render: (r) => C.text(C.clip(r.findings, 70)) },
    ],
    emptyChild: 'No PM planned or done for this machine or tool yet.',
  },

  purchase_plans: {
    key: 'purchase_plans', table: 'purchase_plans', singular: 'purchase plan line', plural: 'Purchase plan', noClient: true, weekly: true,
    editRoles: ['admin', 'purchase'],
    help: 'What has to be bought each week, from whom, by when, and whether it has arrived.',
    dependents: [],
    title: (r) => `${r.item} by ${F.fmtDate(r.required_by)}`,
    listSql: `SELECT t.*, ROUND(t.qty * t.rate, 2) AS amount, s.name AS supplier_name, u.name AS owner_name
              FROM purchase_plans t LEFT JOIN suppliers s ON s.id = t.supplier_id LEFT JOIN users u ON u.id = t.owner_id`,
    order: `CASE WHEN status IN (${sqlIn(PURCHASE_OPEN)}) THEN 0 ELSE 1 END, required_by, item`,
    search: ['item', 'spec', 'purpose', 'po_no', 'supplier_name'],
    views: [...WEEK_VIEWS, { key: 'late', label: 'Not received in time', where: `status IN (${sqlIn(PURCHASE_OPEN)}) AND required_by < :t` }, ALL_WEEKS],
    defaultView: 'week',
    filters: [
      { name: 'category', label: 'Category', options: OPT.purchaseCategory },
      { name: 'status', label: 'Status', options: OPT.purchaseStatus },
      { name: 'owner_id', label: 'Buyer', type: 'user', mine: true },
    ],
    csv: ['required_by', 'item', 'spec', 'category', 'purpose', 'supplier_name', 'qty', 'unit', 'rate', 'amount', 'status', 'po_no', 'po_date', 'received_qty', 'received_on', 'owner_name', 'notes'],
    fields: [
      field('item', 'Item', 'text', { required: true, section: 'What and when', help: 'For example CRCA sheet, MIG wire, die springs' }),
      field('spec', 'Grade / size / spec'),
      field('category', 'Category', 'select', { options: OPT.purchaseCategory, required: true, default: 'Raw material' }),
      field('purpose', 'For', 'text', { help: 'Part, machine or job it is needed for' }),
      field('qty', 'Quantity', 'decimal', { required: true, positive: true }),
      field('unit', 'Unit', 'select', { options: OPT.unit, default: 'kg' }),
      field('rate', 'Rate per unit (₹)', 'money2'),
      field('required_by', 'Needed by', 'date', { required: true, default: inDays(3) }),
      field('supplier_id', 'Supplier', 'supplier'),
      field('owner_id', 'Buyer', 'user', { default: me }),
      field('status', 'Status', 'select', { options: OPT.purchaseStatus, required: true, default: 'Planned', section: 'Order and receipt' }),
      field('po_no', 'Our PO no'),
      field('po_date', 'PO date', 'date'),
      field('received_qty', 'Quantity received', 'decimal'),
      field('received_on', 'Received on', 'date', { help: 'The app fills this in when the status moves to Received' }),
      field('notes', 'Notes', 'textarea'),
    ],
    validate(data, virt, errors) {
      if (['PO placed', 'Part received', 'Received'].includes(data.status) && !data.supplier_id && !errors.supplier_id) errors.supplier_id = 'Pick the supplier the PO went to';
      notFuture(data, errors, 'po_date');
      notFuture(data, errors, 'received_on');
      if (data.received_qty != null && data.qty != null && data.received_qty > data.qty * 1.1 && !errors.received_qty) errors.received_qty = 'More than 10% above the quantity ordered. Raise the quantity first if this is right.';
      if (data.status === 'Received' && data.received_qty != null && data.qty != null && data.received_qty < data.qty && !errors.received_qty) {
        errors.received_qty = `Only ${F.num(data.received_qty)} of ${F.num(data.qty)} is received. Choose Part received, or enter the full quantity`;
      }
    },
    beforeSave(data) {
      data.week_start = F.weekOf(data.required_by);
      if (data.status === 'Received') {
        data.received_on = data.received_on || F.today();
        if (data.received_qty == null) data.received_qty = data.qty;
      }
      if (['PO placed', 'Part received', 'Received'].includes(data.status) && !data.po_date) data.po_date = F.today();
    },
    listSummary(ctx, rows) {
      if (!rows.length) return '';
      const open = rows.filter((r) => PURCHASE_OPEN.includes(r.status));
      const t = F.today();
      return C.sumbar([
        { label: 'planned value', value: F.moneyShort(sum(rows.filter((r) => r.status !== 'Cancelled'), 'amount')) },
        { label: 'still to come', value: `${open.length} · ${F.moneyShort(sum(open, 'amount'))}` },
        { label: 'received', value: rows.filter((r) => r.status === 'Received').length, tone: 'ok' },
        { label: 'late', value: open.filter((r) => r.required_by < t).length, tone: open.some((r) => r.required_by < t) ? 'bad' : '' },
        { label: 'without a supplier', value: open.filter((r) => !r.supplier_id).length },
      ]);
    },
    columns: [
      { label: 'Needed by', render: (r) => C.due(r.required_by, PURCHASE_OPEN.includes(r.status)) },
      { label: 'Item', render: (r, ctx) => C.edit('purchase_plans', r, r.item, [r.spec, r.purpose && `for ${r.purpose}`].filter(Boolean).join(' · '), ctx) },
      { label: 'Category', render: (r) => C.text(r.category) },
      { label: 'Supplier', render: (r) => (r.supplier_id ? html`<a href="/suppliers/${r.supplier_id}/edit">${r.supplier_name}</a>` : html`<span class="tone-text-warn">Not chosen</span>`) },
      { label: 'Qty', cls: 'r', render: (r) => html`<span class="num">${F.num(r.qty)}</span> ${r.unit || ''}${r.received_qty != null && r.status !== 'Received' ? html`<span class="sub">${F.num(r.received_qty)} received</span>` : ''}` },
      { label: 'Amount', cls: 'r', render: (r) => C.money(r.amount) },
      { label: 'Status', render: (r) => html`${C.badge(r.status)}${r.po_no ? html`<span class="sub">PO ${r.po_no}</span>` : ''}` },
    ],
  },

  suppliers: {
    key: 'suppliers', table: 'suppliers', singular: 'supplier', plural: 'Suppliers', noClient: true,
    editRoles: ['admin', 'purchase', 'accounts'],
    help: 'Who SEI buys from: steel, bought-out parts, consumables, spares, job work and services.',
    dependents: [
      { table: 'purchase_plans', fk: 'supplier_id', one: 'purchase plan line' },
      { table: 'payment_plans', fk: 'supplier_id', one: 'planned payment' },
    ],
    deleteHint: 'Untick “Still buying from them” instead.',
    title: (r) => r.name,
    listSql: `SELECT t.*,
                     (SELECT COUNT(*) FROM purchase_plans p WHERE p.supplier_id = t.id AND p.status IN (${sqlIn(PURCHASE_OPEN)})) AS open_purchases,
                     (SELECT COALESCE(SUM(p.amount), 0) FROM payment_plans p WHERE p.supplier_id = t.id AND p.status IN (${sqlIn(PAY_OPEN)})) AS to_pay
              FROM suppliers t`,
    order: 'active DESC, name',
    search: ['name', 'contact_person', 'mobile', 'email', 'gstin', 'city', 'notes'],
    views: [{ key: 'active', label: 'Current', where: 'active = 1' }, { key: 'all', label: 'All' }],
    defaultView: 'active',
    filters: [{ name: 'category', label: 'Category', options: OPT.supplierCategory }],
    csv: ['name', 'category', 'contact_person', 'mobile', 'email', 'gstin', 'payment_terms_days', 'city', 'active', 'open_purchases', 'to_pay', 'notes'],
    fields: [
      field('name', 'Supplier name', 'text', { required: true }),
      field('category', 'Supplies', 'select', { options: OPT.supplierCategory }),
      field('contact_person', 'Contact person'),
      field('mobile', 'Mobile', 'tel'),
      field('email', 'Email', 'email'),
      field('gstin', 'GSTIN', 'text', { upper: true, pattern: /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, patternMsg: 'A GSTIN has 15 characters, like 06ABCDE1234F1Z5' }),
      field('payment_terms_days', 'Credit days', 'int'),
      field('city', 'City'),
      field('active', 'Still buying from them', 'checkbox', { default: 1 }),
      field('notes', 'Notes', 'textarea'),
    ],
    validate(data, virt, errors, ctx, existing) {
      if (data.name && !errors.name && ctx.db.get('SELECT id FROM suppliers WHERE name = :n AND id <> :id', { n: data.name, id: existing ? existing.id : 0 })) errors.name = 'A supplier with this name already exists';
    },
    columns: [
      { label: 'Supplier', render: (r, ctx) => html`${C.edit('suppliers', r, r.name, r.category, ctx)}${r.active ? '' : C.badge('Not in use', 'muted')}` },
      { label: 'Contact', render: (r) => (r.contact_person || r.mobile ? html`${r.contact_person || ''}${r.mobile ? html`<span class="sub">${C.tel(r.mobile)}</span>` : ''}` : C.dash) },
      { label: 'City', render: (r) => C.text(r.city) },
      { label: 'Credit days', cls: 'r', render: (r) => C.int(r.payment_terms_days) },
      { label: 'Open purchases', cls: 'r', render: (r) => (r.open_purchases ? html`<a href="/purchase_plans?view=all&amp;q=${encodeURIComponent(r.name)}">${r.open_purchases}</a>` : C.dash) },
      { label: 'Planned to pay', cls: 'r', render: (r) => (r.to_pay > 0 ? C.money(r.to_pay) : C.dash) },
    ],
  },

  payment_plans: {
    key: 'payment_plans', table: 'payment_plans', singular: 'planned payment', plural: 'Payment plan', noClient: true, weekly: true,
    editRoles: ['admin', 'accounts'],
    help: 'Payments SEI has to make each week: supplier bills, salaries, statutory dues and other bills, in order of priority.',
    title: (r) => `${F.money(r.amount)} to ${r.payee}`,
    listSql: `SELECT t.*, s.name AS supplier_name, u.name AS approved_name
              FROM payment_plans t LEFT JOIN suppliers s ON s.id = t.supplier_id LEFT JOIN users u ON u.id = t.approved_by`,
    order: `CASE WHEN status IN (${sqlIn(PAY_OPEN)}) THEN 0 ELSE 1 END, plan_date, CASE priority WHEN 'Must pay' THEN 0 WHEN 'Normal' THEN 1 ELSE 2 END, id`,
    search: ['payee', 'bill_no', 'reference', 'supplier_name', 'notes'],
    views: [...WEEK_VIEWS, { key: 'overdue', label: 'Not paid on the planned day', where: `status IN (${sqlIn(PAY_OPEN)}) AND plan_date < :t` }, { key: 'deferred', label: 'Deferred', where: "status = 'Deferred'" }, ALL_WEEKS],
    defaultView: 'week',
    filters: [
      { name: 'category', label: 'Category', options: OPT.paymentCategory },
      { name: 'status', label: 'Status', options: OPT.paymentPlanStatus },
      { name: 'priority', label: 'Priority', options: OPT.paymentPriority },
    ],
    csv: ['plan_date', 'payee', 'supplier_name', 'category', 'bill_no', 'bill_date', 'due_on', 'amount', 'priority', 'mode', 'status', 'approved_name', 'paid_on', 'paid_amount', 'reference', 'notes'],
    fields: [
      field('category', 'Category', 'select', { options: OPT.paymentCategory, required: true, default: 'Supplier bill', section: 'Payment' }),
      field('supplier_id', 'Supplier', 'supplier', { help: 'For supplier bills and job work' }),
      field('payee', 'Pay to', 'text', { help: 'Filled from the supplier if left blank' }),
      field('bill_no', 'Bill / reference no'),
      field('bill_date', 'Bill date', 'date'),
      field('due_on', 'Bill due on', 'date', { help: 'Leave blank to use the supplier’s credit days from the bill date' }),
      field('amount', 'Amount to pay (₹)', 'money', { required: true, positive: true }),
      field('plan_date', 'Planned payment date', 'date', { required: true, default: today }),
      field('priority', 'Priority', 'select', { options: OPT.paymentPriority, required: true, default: 'Normal', help: 'Must pay: salaries, statutory dues, critical suppliers' }),
      field('mode', 'Mode', 'select', { options: OPT.payMode, default: 'NEFT / RTGS' }),
      field('status', 'Status', 'select', { options: OPT.paymentPlanStatus, required: true, default: 'Planned', section: 'Approval and payment' }),
      field('approved_by', 'Approved by', 'user', { auto: true, help: 'Your name goes here when you set Approved. Only an admin or the head of Accounts can approve' }),
      field('paid_on', 'Paid on', 'date', { help: 'The app fills this in when the status moves to Paid' }),
      field('paid_amount', 'Amount paid (₹)', 'money', { help: 'The planned amount if left blank' }),
      field('reference', 'UTR / cheque no'),
      field('notes', 'Notes', 'textarea'),
    ],
    validate(data, virt, errors, ctx, existing) {
      if (!data.supplier_id && !data.payee && !errors.supplier_id) errors.payee = 'Say who is being paid, or pick a supplier';
      notFuture(data, errors, 'bill_date');
      notBefore(data, errors, 'due_on', data.bill_date, 'bill date');
      approverOnApprove(data, errors, ctx, existing);
      if (data.paid_amount != null && data.amount != null && data.paid_amount > data.amount + 0.5 && !errors.paid_amount) errors.paid_amount = 'More than the amount planned. Raise the planned amount first.';
    },
    beforeSave(data, ctx) {
      data.week_start = F.weekOf(data.plan_date);
      const s = data.supplier_id ? ctx.db.get('SELECT name, payment_terms_days FROM suppliers WHERE id = :id', { id: data.supplier_id }) : null;
      if (!data.payee && s) data.payee = s.name;
      if (!data.due_on && data.bill_date && s && s.payment_terms_days != null) data.due_on = F.addDays(data.bill_date, s.payment_terms_days);
      if (data.status === 'Paid') {
        data.paid_on = data.paid_on || F.today();
        if (data.paid_amount == null) data.paid_amount = data.amount;
      } else {
        data.paid_on = null;
        data.paid_amount = null;
      }
    },
    listSummary(ctx, rows) {
      if (!rows.length) return '';
      const open = rows.filter((r) => PAY_OPEN.includes(r.status));
      return C.sumbar([
        { label: 'to pay', value: F.moneyShort(sum(open, 'amount')) },
        { label: 'must pay', value: F.moneyShort(sum(open.filter((r) => r.priority === 'Must pay'), 'amount')), tone: open.some((r) => r.priority === 'Must pay') ? 'warn' : '' },
        { label: 'paid', value: F.moneyShort(sum(rows, 'paid_amount')), tone: 'ok' },
        { label: 'past the planned day', value: open.filter((r) => r.plan_date < F.today()).length, tone: open.some((r) => r.plan_date < F.today()) ? 'bad' : '' },
      ]);
    },
    columns: [
      { label: 'Pay on', render: (r) => html`${C.due(r.plan_date, PAY_OPEN.includes(r.status))}<span class="sub">${F.dayName(r.plan_date)}</span>` },
      { label: 'Pay to', render: (r, ctx) => C.edit('payment_plans', r, r.payee, [r.category, r.bill_no && `bill ${r.bill_no}`].filter(Boolean).join(' · '), ctx) },
      { label: 'Priority', render: (r) => C.badge(r.priority) },
      { label: 'Amount', cls: 'r', render: (r) => C.money(r.amount) },
      { label: 'Mode', render: (r) => C.text(r.mode) },
      { label: 'Bill due', render: (r) => C.due(r.due_on, PAY_OPEN.includes(r.status)) },
      { label: 'Status', render: (r) => html`${C.badge(r.status)}${r.paid_on ? html`<span class="sub">${F.fmtDate(r.paid_on)}${r.reference ? ` · ${r.reference}` : ''}</span>` : ''}` },
    ],
  },

  petty_cash: {
    key: 'petty_cash', table: 'petty_cash', singular: 'petty cash entry', many: 'petty cash entries', plural: 'Petty cash (Cash / UPI)', noClient: true, weekly: true,
    editRoles: ['admin', 'accounts'],
    help: 'Small payments, planned week by week and paid in cash or by UPI. Also the cash put into the box.',
    title: (r) => `${r.description} on ${F.fmtDate(r.plan_date)}`,
    listSql: 'SELECT t.*, u.name AS approved_name FROM petty_cash t LEFT JOIN users u ON u.id = t.approved_by',
    order: 'plan_date DESC, id DESC',
    search: ['description', 'paid_to', 'voucher_no', 'upi_ref', 'head', 'notes'],
    views: [...WEEK_VIEWS, { key: 'planned', label: 'Not paid yet', where: "status = 'Planned'" }, ALL_WEEKS],
    defaultView: 'week',
    filters: [
      { name: 'entry_type', label: 'Entry', options: OPT.pettyType },
      { name: 'head', label: 'Head', options: OPT.pettyHead },
      { name: 'mode', label: 'Paid by', options: OPT.pettyMode },
      { name: 'status', label: 'Status', options: OPT.pettyStatus },
    ],
    csv: ['plan_date', 'entry_type', 'head', 'description', 'paid_to', 'mode', 'planned_amount', 'amount', 'status', 'voucher_no', 'upi_ref', 'approved_name', 'notes'],
    fields: [
      field('entry_type', 'Entry', 'select', { options: OPT.pettyType, required: true, default: 'Expense', help: 'Cash top-up is money added to the petty cash box' }),
      field('plan_date', 'Date', 'date', { required: true, default: today }),
      field('head', 'Expense head', 'select', { options: OPT.pettyHead }),
      field('description', 'What for', 'text', { required: true, wide: true }),
      field('paid_to', 'Paid to'),
      field('mode', 'Paid by', 'select', { options: OPT.pettyMode, required: true, default: 'Cash' }),
      field('planned_amount', 'Planned amount (₹)', 'money', { required: true, positive: true }),
      field('status', 'Status', 'select', { options: OPT.pettyStatus, required: true, default: 'Planned', section: 'Payment' }),
      field('amount', 'Actual amount paid (₹)', 'money', { help: 'The planned amount if left blank when marked Paid' }),
      field('voucher_no', 'Voucher no'),
      field('upi_ref', 'UPI reference'),
      field('approved_by', 'Approved by', 'user', { help: 'Only an admin or the head of Accounts can fill this in, with their own name' }),
      field('notes', 'Notes', 'textarea'),
    ],
    validate(data, virt, errors, ctx, existing) {
      approverAsSelf(data, errors, ctx, existing);
      if (data.entry_type === 'Cash top-up' && data.mode === 'UPI' && !errors.mode) errors.mode = 'A top-up is cash put into the box. Choose Cash.';
      if (data.entry_type === 'Expense' && !data.head && !errors.head) errors.head = 'Pick an expense head';
      if (data.status === 'Paid' && data.mode === 'UPI' && data.entry_type === 'Expense' && !data.upi_ref && !errors.upi_ref) errors.upi_ref = 'Enter the UPI reference so the payment can be traced';
    },
    beforeSave(data) {
      data.week_start = F.weekOf(data.plan_date);
      if (data.status === 'Paid') { if (data.amount == null) data.amount = data.planned_amount; } else data.amount = null;
      if (data.entry_type === 'Cash top-up') data.head = null;
    },
    beforeInsert(data, ctx) { data.user_id = ctx.user.id; },
    listSummary(ctx, rows) {
      const box = ctx.db.get(`SELECT COALESCE(SUM(CASE WHEN entry_type = 'Cash top-up' THEN amount ELSE 0 END), 0)
                                   - COALESCE(SUM(CASE WHEN entry_type = 'Expense' AND mode = 'Cash' THEN amount ELSE 0 END), 0) AS cash
                              FROM petty_cash WHERE status = 'Paid'`).cash;
      const exp = rows.filter((r) => r.entry_type === 'Expense' && r.status !== 'Cancelled');
      const paid = exp.filter((r) => r.status === 'Paid');
      return C.sumbar([
        { label: 'cash in the box now', value: F.money(box), tone: box < 0 ? 'bad' : '' },
        { label: 'planned spend', value: F.money(sum(exp, 'planned_amount')) },
        { label: 'paid in cash', value: F.money(sum(paid.filter((r) => r.mode === 'Cash'), 'amount')) },
        { label: 'paid by UPI', value: F.money(sum(paid.filter((r) => r.mode === 'UPI'), 'amount')) },
        { label: 'topped up', value: F.money(sum(rows.filter((r) => r.entry_type === 'Cash top-up'), 'amount')), tone: 'ok' },
      ]);
    },
    columns: [
      { label: 'Date', render: (r) => html`${C.date(r.plan_date)}<span class="sub">${F.dayName(r.plan_date)}</span>` },
      { label: 'What for', render: (r, ctx) => C.edit('petty_cash', r, r.description, [r.entry_type === 'Cash top-up' ? 'Cash top-up' : r.head, r.paid_to].filter(Boolean).join(' · '), ctx) },
      { label: 'Paid by', render: (r) => C.badge(r.mode) },
      { label: 'Planned', cls: 'r', render: (r) => C.money(r.planned_amount) },
      { label: 'Paid', cls: 'r', render: (r) => (r.entry_type === 'Cash top-up' && r.amount != null ? html`<span class="num tone-text-ok">+${F.money(r.amount)}</span>` : C.money(r.amount)) },
      { label: 'Status', render: (r) => C.badge(r.status) },
      { label: 'Voucher / UPI ref', render: (r) => C.text([r.voucher_no, r.upi_ref].filter(Boolean).join(' · ')) },
    ],
  },
};

module.exports = { MODULES, OPT, RFQ_OPEN, PM_OPEN, PURCHASE_OPEN, PAY_OPEN, JOB_OPEN, canManageJob, canUpdateJob, sqlIn };
