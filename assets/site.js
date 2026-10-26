import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, ORG_SLUG } from './config.js';
import './motion.js';

const configured = !SUPABASE_URL.includes('YOUR-PROJECT') && !SUPABASE_ANON_KEY.includes('YOUR-PUBLISHABLE');
const sb = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
const isoDate = (d) => d.toISOString().slice(0, 10);
const todayIso = isoDate(new Date());

const setStatus = (el, msg, kind = '') => {
  if (!el) return;
  el.textContent = msg;
  el.className = `status ${kind}`;
};

const NOT_CONNECTED = 'Online booking is not connected yet. Please contact the team directly.';

const toggle = $('.nav-toggle');
if (toggle) {
  toggle.addEventListener('click', () => {
    const open = $('.nav-links').classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });
}

$$('[data-tabs]').forEach((root) => {
  const tabs = $$('.tab', root);
  const select = (id) => {
    tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === id)));
    $$('.panel', root).forEach((p) => { p.hidden = p.dataset.panel !== id; });
  };
  tabs.forEach((t) => t.addEventListener('click', () => select(t.dataset.tab)));
  if (tabs[0]) select(tabs[0].dataset.tab);
});

const plansRoot = $('[data-plans]');
if (plansRoot) {
  const buttons = $$('[data-billing]', plansRoot);
  const render = (cycle) => {
    buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.billing === cycle)));
    $$('[data-price]', plansRoot).forEach((el) => {
      const monthly = Number(el.dataset.monthly);
      const value = cycle === 'annual' ? monthly * 0.8 : monthly;
      el.textContent = monthly === 0 ? 'Free' : `${money(value)} / mo`;
    });
    $('#billing-note').textContent = cycle === 'annual' ? 'Billed yearly. Save 20% versus monthly.' : 'Billed monthly. Cancel anytime.';
  };
  buttons.forEach((b) => b.addEventListener('click', () => render(b.dataset.billing)));
  render('monthly');
}

const roi = $('[data-roi]');
if (roi) {
  const fields = { leads: 'leads', rate: 'rate', value: 'value', lift: 'lift' };
  const calc = () => {
    const leads = Number($('#leads').value);
    const rate = Number($('#rate').value) / 100;
    const value = Number($('#value').value);
    const lift = Number($('#lift').value) / 100;
    $('#out-leads').textContent = leads.toLocaleString('en-US');
    $('#out-rate').textContent = (rate * 100).toFixed(1) + '%';
    $('#out-value').textContent = money(value);
    $('#out-lift').textContent = (lift * 100).toFixed(0) + '%';
    const current = leads * rate * value * 12;
    const improved = leads * (rate * (1 + lift)) * value * 12;
    $('#roi-now').textContent = money(current);
    $('#roi-gain').textContent = money(improved - current);
    $('#roi-total').textContent = money(improved);
  };
  Object.values(fields).forEach((id) => $('#' + id).addEventListener('input', calc));
  calc();
}

const suitesRoot = $('[data-suites]');
if (suitesRoot) {
  const priceSel = $('#max-price');
  const sortSel = $('#sort');
  const cards = $$('[data-suite-card]', suitesRoot);
  const apply = () => {
    const max = Number(priceSel.value);
    const visible = cards
      .filter((c) => Number(c.dataset.price) <= max)
      .sort((a, b) => sortSel.value === 'price-asc'
        ? Number(a.dataset.price) - Number(b.dataset.price)
        : Number(b.dataset.price) - Number(a.dataset.price));
    cards.forEach((c) => { c.hidden = true; });
    visible.forEach((c) => { c.hidden = false; c.parentElement.appendChild(c); });
    $('#suites-empty').hidden = visible.length > 0;
  };
  priceSel.addEventListener('change', apply);
  sortSel.addEventListener('change', apply);
  apply();
}

const blogRoot = $('[data-blog]');
if (blogRoot) {
  const q = $('#blog-search');
  const posts = $$('.post', blogRoot);
  q.addEventListener('input', () => {
    const term = q.value.trim().toLowerCase();
    let shown = 0;
    posts.forEach((p) => {
      const hit = !term || p.textContent.toLowerCase().includes(term);
      p.hidden = !hit;
      if (hit) shown++;
    });
    $('#blog-empty').hidden = shown > 0;
  });
}

const careersRoot = $('[data-careers]');
if (careersRoot) {
  const dept = $('#dept');
  const jobs = $$('.job', careersRoot);
  dept.addEventListener('change', () => {
    let shown = 0;
    jobs.forEach((j) => {
      const hit = dept.value === 'all' || j.dataset.dept === dept.value;
      j.hidden = !hit;
      if (hit) shown++;
    });
    $('#jobs-empty').hidden = shown > 0;
  });
}

async function loadBookings() {
  if (!sb) return [];
  const { data, error } = await sb.rpc('public_suite_availability', { p_org: ORG_SLUG });
  return error ? null : data;
}

function renderCalendar(container, suite, bookings, monthOffset = 0) {
  const base = new Date();
  const first = new Date(base.getFullYear(), base.getMonth() + monthOffset, 1);
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const title = first.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const lead = first.getDay();
  let html = `<div class="cal-title" style="margin-top:20px;font-weight:700">${title}</div><div class="cal">`;
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach((d) => { html += `<div class="dow">${d}</div>`; });
  for (let i = 0; i < lead; i++) html += '<div class="blank"></div>';
  for (let d = 1; d <= days; d++) {
    const iso = isoDate(new Date(first.getFullYear(), first.getMonth(), d));
    const isBooked = bookings && bookings.some((b) => b.suite === suite && iso >= b.check_in && iso < b.check_out);
    const cls = ['day', isBooked ? 'booked' : '', iso < todayIso ? 'past' : ''].join(' ').trim();
    html += `<div class="${cls}" title="${isBooked ? 'Booked' : 'Available'}">${d}</div>`;
  }
  html += '</div>';
  container.insertAdjacentHTML('beforeend', html);
}

const suiteRoot = $('[data-suite-page]');
if (suiteRoot) {
  const suite = suiteRoot.dataset.suitePage;
  const cal = $('#availability');
  (async () => {
    const bookings = await loadBookings();
    if (bookings === null) { cal.insertAdjacentHTML('beforeend', '<p class="empty">Availability could not be loaded right now.</p>'); return; }
    if (!sb) { cal.insertAdjacentHTML('beforeend', '<p class="empty">Live availability appears once booking is connected.</p>'); return; }
    renderCalendar(cal, suite, bookings, 0);
    renderCalendar(cal, suite, bookings, 1);
  })();
}

const reserveForm = $('[data-reserve-form]');
if (reserveForm) {
  const params = new URLSearchParams(location.search);
  const suiteSel = $('#suite-select', reserveForm);
  if (params.get('suite')) suiteSel.value = params.get('suite');
  const checkIn = $('#check-in', reserveForm);
  const checkOut = $('#check-out', reserveForm);
  const status = $('#status', reserveForm);
  const submit = $('#submit', reserveForm);
  checkIn.min = todayIso;
  checkOut.min = todayIso;
  let booked = [];

  const overlaps = (suite, a, b) => booked.some((x) => x.suite === suite && a < x.check_out && b > x.check_in);
  const check = () => {
    const a = checkIn.value, b = checkOut.value;
    if (!a || !b) return true;
    if (b <= a) { setStatus(status, 'Check-out must be after check-in.', 'err'); return false; }
    if (overlaps(suiteSel.value, a, b)) { setStatus(status, 'That suite is already booked for those dates.', 'err'); return false; }
    if (sb) setStatus(status, 'Those dates are available.', 'ok');
    return true;
  };
  [suiteSel, checkIn, checkOut].forEach((el) => el.addEventListener('change', check));

  (async () => {
    if (!sb) { submit.disabled = true; setStatus(status, NOT_CONNECTED, 'err'); return; }
    booked = (await loadBookings()) || [];
    check();
  })();

  reserveForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!sb || !reserveForm.reportValidity() || !check()) return;
    submit.disabled = true;
    setStatus(status, 'Sending your request…');
    const fd = new FormData(reserveForm);
    const { error } = await sb.rpc('submit_reservation', {
      p_org: ORG_SLUG,
      p_suite: fd.get('suite'),
      p_check_in: fd.get('check_in'),
      p_check_out: fd.get('check_out'),
      p_guests: Number(fd.get('guests')),
      p_name: fd.get('guest_name').trim(),
      p_email: fd.get('email').trim(),
      p_phone: (fd.get('phone') || '').trim() || null,
    });
    submit.disabled = false;
    if (error) {
      const message = error.code === '23P01'
        ? 'Those dates were just booked. Please choose different dates.'
        : error.code === '53400' || error.code === '22023'
          ? error.message
          : 'Something went wrong. Please try again or contact the team.';
      setStatus(status, message, 'err');
      if (error.code === '23P01') booked = (await loadBookings()) || booked;
      return;
    }
    reserveForm.reset();
    setStatus(status, 'Request received. The concierge will confirm your stay by email.', 'ok');
    booked = (await loadBookings()) || booked;
  });
}

const leadForm = $('[data-lead-form]');
if (leadForm) {
  const status = $('#status', leadForm);
  const submit = $('#submit', leadForm);
  if (!sb) { submit.disabled = true; setStatus(status, NOT_CONNECTED, 'err'); }
  leadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!sb || !leadForm.reportValidity()) return;
    submit.disabled = true;
    setStatus(status, 'Sending…');
    const fd = new FormData(leadForm);
    const { error } = await sb.rpc('submit_lead', {
      p_org: ORG_SLUG,
      p_intent: leadForm.dataset.leadForm,
      p_name: fd.get('name').trim(),
      p_email: fd.get('email').trim(),
      p_company: (fd.get('company') || '').trim() || null,
      p_message: (fd.get('message') || '').trim() || null,
    });
    submit.disabled = false;
    if (error) {
      setStatus(status, error.code === '53400' ? error.message : 'Something went wrong. Please try again.', 'err');
      return;
    }
    leadForm.reset();
    setStatus(status, 'Thanks. We will be in touch shortly.', 'ok');
  });
}
