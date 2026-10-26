import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const $ = (id) => document.getElementById(id);
const configured = !SUPABASE_URL.includes('YOUR-PROJECT') && !SUPABASE_ANON_KEY.includes('YOUR-PUBLISHABLE');

const sb = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const STATUS_NEXT = {
  requested: ['confirmed', 'cancelled'],
  confirmed: ['checked_in', 'cancelled'],
  checked_in: ['checked_out'],
  checked_out: [],
  cancelled: [],
};
const money = (cents) => '$' + Math.round(cents / 100).toLocaleString('en-US');
const isoDate = (d) => d.toISOString().slice(0, 10);
let channel = null;
let refreshTimer = null;

function cell(text) {
  const td = document.createElement('td');
  td.textContent = text == null ? '—' : String(text);
  return td;
}

function renderRows(tbody, rows, build) {
  tbody.replaceChildren(...rows.map(build));
}

function showSignIn() {
  $('signin').hidden = false;
  $('console').hidden = true;
  $('sign-out').hidden = true;
}

async function showConsole(session) {
  $('signin').hidden = true;
  $('console').hidden = false;
  $('sign-out').hidden = false;
  const { data, error } = await sb
    .from('memberships')
    .select('org_id, role, orgs(name, slug)')
    .eq('user_id', session.user.id);
  if (error || !data.length) {
    $('console-status').textContent = 'Your account is not linked to a client yet. Ask the owner to add you.';
    $('console-status').className = 'status err';
    return;
  }
  const select = $('org-select');
  select.replaceChildren(...data.map((m) => {
    const opt = document.createElement('option');
    opt.value = m.org_id;
    opt.textContent = `${m.orgs.name} (${m.role})`;
    return opt;
  }));
  const today = new Date();
  const from = new Date(today);
  from.setDate(today.getDate() - 14);
  const to = new Date(today);
  to.setDate(today.getDate() + 30);
  $('range-from').value = isoDate(from);
  $('range-to').value = isoDate(to);
  await loadAll();
  subscribeLive(select.value);
}

async function loadAll() {
  const org = $('org-select').value;
  const from = $('range-from').value;
  const to = $('range-to').value;
  if (!org || !from || !to) return;
  $('console-status').textContent = 'Loading…';
  $('console-status').className = 'status';

  const [summary, daily, reservations, customers, leads] = await Promise.all([
    sb.rpc('report_summary', { p_org: org, p_from: from, p_to: to }),
    sb.rpc('report_daily_occupancy', { p_org: org, p_from: from, p_to: to }),
    sb.from('reservations')
      .select('id, check_in, check_out, guests, status, customers(full_name, email), suites(name)')
      .eq('org_id', org)
      .lt('check_in', to)
      .gt('check_out', from)
      .order('check_in'),
    sb.from('customers')
      .select('full_name, email, phone, created_at')
      .eq('org_id', org)
      .order('created_at', { ascending: false })
      .limit(200),
    sb.from('leads')
      .select('id, name, email, company, intent, status, created_at')
      .eq('org_id', org)
      .order('created_at', { ascending: false })
      .limit(100),
  ]);

  const failed = [summary, daily, reservations, customers, leads].find((r) => r.error);
  if (failed) {
    $('console-status').textContent = failed.error.message;
    $('console-status').className = 'status err';
    return;
  }

  const s = summary.data;
  $('kpi-occupancy').textContent = `${s.occupancy_pct}%`;
  $('kpi-revenue').textContent = money(s.revenue_cents);
  $('kpi-nights').textContent = s.nights_booked;
  $('kpi-bookings').textContent = s.bookings;
  $('kpi-leads').textContent = s.leads;

  const active = daily.data.length ? Number(daily.data[0].suites_active) : 0;
  $('daily-bars').replaceChildren(...daily.data.map((row) => {
    const bar = document.createElement('div');
    const pct = active ? (Number(row.nights_booked) / active) * 100 : 0;
    bar.style.height = `${Math.min(100, pct)}%`;
    bar.title = `${row.day}: ${row.nights_booked} of ${active} suites booked`;
    return bar;
  }));

  renderRows($('reservations-body'), reservations.data, (r) => {
    const tr = document.createElement('tr');
    tr.append(cell(r.customers?.full_name), cell(r.suites?.name), cell(`${r.check_in} → ${r.check_out}`), cell(r.guests));
    const st = document.createElement('td');
    const pill = document.createElement('span');
    pill.className = 'pill';
    pill.textContent = r.status.replace('_', ' ');
    st.append(pill);
    tr.append(st);
    const actions = document.createElement('td');
    actions.className = 'actions';
    (STATUS_NEXT[r.status] || []).forEach((next) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = next.replace('_', ' ');
      btn.addEventListener('click', () => setReservationStatus(r.id, next));
      actions.append(btn);
    });
    tr.append(actions);
    return tr;
  });

  renderRows($('customers-body'), customers.data, (c) => {
    const tr = document.createElement('tr');
    tr.append(cell(c.full_name), cell(c.email), cell(c.phone), cell(new Date(c.created_at).toLocaleDateString()));
    return tr;
  });

  renderRows($('leads-body'), leads.data, (l) => {
    const tr = document.createElement('tr');
    tr.append(cell(l.name), cell(l.email), cell(l.company), cell(l.intent));
    const st = document.createElement('td');
    const sel = document.createElement('select');
    ['new', 'contacted', 'won', 'lost'].forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      opt.selected = v === l.status;
      sel.append(opt);
    });
    sel.addEventListener('change', () => setLeadStatus(l.id, sel.value));
    st.append(sel);
    tr.append(st, cell(new Date(l.created_at).toLocaleDateString()));
    return tr;
  });

  $('console-status').textContent = `Updated ${new Date().toLocaleTimeString()}`;
}

async function setReservationStatus(id, status) {
  const { error } = await sb.from('reservations').update({ status }).eq('id', id);
  if (error) {
    $('console-status').textContent = error.message;
    $('console-status').className = 'status err';
    return;
  }
  loadAll();
}

async function setLeadStatus(id, status) {
  const { error } = await sb.from('leads').update({ status }).eq('id', id);
  if (error) {
    $('console-status').textContent = error.message;
    $('console-status').className = 'status err';
  }
}

function subscribeLive(org) {
  if (channel) sb.removeChannel(channel);
  const refresh = () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(loadAll, 400);
  };
  channel = sb.channel(`org-${org}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations', filter: `org_id=eq.${org}` }, refresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'leads', filter: `org_id=eq.${org}` }, refresh)
    .subscribe();
}

if (configured) {
  boot();
} else {
  $('config-notice').hidden = false;
}

function boot() {
  $('signin-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    if (!form.reportValidity()) return;
    const email = form.email.value.trim();
    $('signin-submit').disabled = true;
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.href.split('#')[0] },
    });
    $('signin-submit').disabled = false;
    $('signin-status').textContent = error
      ? 'Could not send the link. Please try again.'
      : 'Check your inbox for the sign-in link.';
    $('signin-status').className = error ? 'status err' : 'status ok';
  });

  $('sign-out').addEventListener('click', async () => {
    await sb.auth.signOut();
  });

  $('org-select').addEventListener('change', () => {
    loadAll();
    subscribeLive($('org-select').value);
  });
  $('range-from').addEventListener('change', loadAll);
  $('range-to').addEventListener('change', loadAll);

  sb.auth.getSession().then(({ data: { session } }) => {
    if (session) showConsole(session); else showSignIn();
  });
  sb.auth.onAuthStateChange((event, session) => {
    if (session && event === 'SIGNED_IN') showConsole(session);
    if (!session) showSignIn();
  });
}
