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

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function countUp(el, to, fmt = (v) => Math.round(v).toLocaleString('en-US')) {
  const from = Number(el.dataset.value) || 0;
  el.dataset.value = String(to);
  const start = performance.now();
  const duration = reducedMotion ? 0 : 900;
  const step = (now) => {
    const t = duration ? Math.min(1, (now - start) / duration) : 1;
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = fmt(from + (to - from) * eased);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function startOpsCanvas() {
  const canvas = document.getElementById('ops-canvas');
  const stage = document.getElementById('ops-stage');
  const copy = document.getElementById('ops-copy');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const nodes = Array.from({ length: 28 }, () => ({
    x: Math.random(), y: Math.random(), phase: Math.random() * Math.PI * 2,
  }));
  const packets = Array.from({ length: 16 }, () => newPacket());
  function newPacket() {
    return { a: Math.floor(Math.random() * nodes.length), b: Math.floor(Math.random() * nodes.length), t: Math.random() };
  }
  let w = 0, h = 0, time = 0, last = performance.now();
  const resize = () => {
    const r = canvas.getBoundingClientRect();
    w = r.width;
    h = r.height;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  const maxLink = () => Math.min(w, h) * 0.5;

  const frame = (now) => {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (!reducedMotion) time += dt;
    ctx.clearRect(0, 0, w, h);

    const pts = nodes.map((n) => ({
      x: n.x * w + Math.sin(time * 0.4 + n.phase) * 6,
      y: n.y * h + Math.cos(time * 0.3 + n.phase) * 6,
      p: n.phase,
    }));
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y;
        const d = Math.hypot(dx, dy);
        if (d < maxLink()) {
          ctx.strokeStyle = `rgba(11,143,98,${(1 - d / maxLink()) * 0.22})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(pts[i].x, pts[i].y);
          ctx.lineTo(pts[j].x, pts[j].y);
          ctx.stroke();
        }
      }
    }
    pts.forEach((p) => {
      const pulse = 2.2 + Math.sin(time * 2 + p.p) * 0.8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, pulse, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(11,143,98,0.85)';
      ctx.fill();
    });
    packets.forEach((k, i) => {
      if (!reducedMotion) k.t += dt * 0.35;
      if (k.t >= 1) packets[i] = newPacket();
      const a = pts[packets[i].a], b = pts[packets[i].b];
      if (!a || !b) return;
      const x = a.x + (b.x - a.x) * packets[i].t;
      const y = a.y + (b.y - a.y) * packets[i].t;
      ctx.beginPath();
      ctx.arc(x, y, 2.6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(7,112,77,0.9)';
      ctx.fill();
    });

    if (!reducedMotion) requestAnimationFrame(frame);
  };

  const onScroll = () => {
    const y = window.scrollY;
    canvas.style.transform = `translateY(${(y * 0.25).toFixed(1)}px)`;
    stage.style.opacity = Math.max(0, 1 - y / 420).toFixed(3);
    copy.style.transform = `translateY(${(y * -0.12).toFixed(1)}px)`;
  };
  window.addEventListener('resize', () => { resize(); });
  window.addEventListener('scroll', onScroll, { passive: true });
  resize();
  onScroll();
  requestAnimationFrame(frame);
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
  countUp($('kpi-occupancy'), Number(s.occupancy_pct), (v) => `${v.toFixed(1)}%`);
  countUp($('kpi-revenue'), s.revenue_cents / 100, (v) => money(v * 100));
  countUp($('kpi-nights'), Number(s.nights_booked));
  countUp($('kpi-bookings'), Number(s.bookings));
  countUp($('kpi-leads'), Number(s.leads));

  const active = daily.data.length ? Number(daily.data[0].suites_active) : 0;
  const bars = daily.data.map((row) => {
    const bar = document.createElement('div');
    const pct = active ? (Number(row.nights_booked) / active) * 100 : 0;
    bar.dataset.target = `${Math.min(100, pct)}%`;
    bar.style.height = '0%';
    bar.title = `${row.day}: ${row.nights_booked} of ${active} suites booked`;
    return bar;
  });
  $('daily-bars').replaceChildren(...bars);
  requestAnimationFrame(() => {
    bars.forEach((bar, i) => {
      bar.style.transitionDelay = `${i * 35}ms`;
      bar.style.height = bar.dataset.target;
    });
  });

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

startOpsCanvas();
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
