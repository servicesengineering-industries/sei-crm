'use strict';
// One definition per record type: fields drive the forms and validation,
// listSql/views/columns drive the list pages, editRoles drive permissions.
const { html } = require('./html');
const C = require('./cells');
const F = require('./format');
const { canEdit } = require('./auth');

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
};

const RFQ_OPEN = ['New', 'Costing', 'Quoted', 'Negotiation'];
const sqlIn = (arr) => arr.map((s) => `'${s.replace(/'/g, "''")}'`).join(', ');
const STAFF = ['admin', 'sales', 'accounts', 'quality'];

const today = () => F.today();
const inDays = (n) => () => F.addDays(F.today(), n);
const me = (ctx) => ctx.user.id;
const field = (name, label, type = 'text', extra = {}) => ({ name, label, type, ...extra });
const clientCol = { label: 'Client', client: true, render: (r) => C.client(r) };

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
      field('quoted_on', 'Quoted on', 'date', { help: 'Filled in automatically when the status moves to Quoted' }),
      field('unit_price', 'Quoted price per piece (₹)', 'money2'),
      field('tooling_cost', 'Tooling cost (₹)', 'money'),
      field('decision_on', 'Decision date', 'date', { section: 'Outcome' }),
      field('lost_reason', 'Why lost or regretted'),
      field('notes', 'Notes', 'textarea'),
    ],
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
      if (existing && data.qty != null && !errors.qty) {
        const o = ctx.db.get('SELECT dispatched FROM v_orders WHERE id = :id', { id: existing.id });
        if (o && data.qty < o.dispatched) errors.qty = `${F.num(o.dispatched)} pcs have already been dispatched against this PO`;
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
      if (errors.qty || errors.order_id || !data.order_id || data.qty == null) return;
      const o = ctx.db.get('SELECT pending FROM v_orders WHERE id = :id', { id: data.order_id });
      if (!o) return;
      const left = o.pending + (existing && existing.order_id === data.order_id ? existing.qty : 0);
      if (data.qty > left) {
        errors.qty = left > 0
          ? `Only ${F.num(left)} pcs are still pending on this PO. If the customer accepted more, raise the PO quantity first.`
          : 'Nothing is pending on this PO.';
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
        if (dup) errors.invoice_no = 'This invoice number is already entered';
      }
      if (data.due_on && data.invoice_date && data.due_on < data.invoice_date && !errors.due_on) errors.due_on = 'Payment due can’t be before the invoice date';
      if (existing && data.amount != null && !errors.amount) {
        const i = ctx.db.get('SELECT received + deducted AS settled FROM v_invoices WHERE id = :id', { id: existing.id });
        if (i && data.amount + 0.5 < i.settled) errors.amount = `${F.money2(i.settled)} has already been received against this invoice`;
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
      const total = (data.amount || 0) + (data.deduction || 0);
      if (!errors.amount && total <= 0) errors.amount = 'Enter the amount received';
      if (errors.amount || errors.deduction || errors.invoice_id || !data.invoice_id) return;
      const inv = ctx.db.get('SELECT amount, received, deducted FROM v_invoices WHERE id = :id', { id: data.invoice_id });
      if (!inv) return;
      const mine = existing && existing.invoice_id === data.invoice_id ? existing.amount + (existing.deduction || 0) : 0;
      const due = Math.round((inv.amount - inv.received - inv.deducted + mine) * 100) / 100;
      if (total > due + 0.5) errors.amount = due > 0.5 ? `Only ${F.money2(due)} is still due on this invoice` : 'This invoice is already fully paid';
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
    help: 'Customer complaints and rejections, from containment to closure.',
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
      field('closed_on', 'Closed on', 'date', { help: 'Filled in automatically when the status moves to Closed' }),
      field('containment', 'Containment action', 'textarea'),
      field('root_cause', 'Root cause', 'textarea'),
      field('corrective_action', 'Corrective and preventive action', 'textarea'),
      field('notes', 'Notes', 'textarea'),
    ],
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
};

module.exports = { MODULES, OPT, RFQ_OPEN, sqlIn };
