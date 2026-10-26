const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const hasGlobe = Boolean(document.getElementById('planet'));

const ITEM_SEL = '.card, .stat, .kpi, .post, .job, .suite, .cta-card, .dashboard, .form, .reserve-form, .table-wrap, .earth-viewer, .feature-grid, .suite-grid, .stats, .calc, .cal, .table-wrap, .contact-item';
const BLOCK_SEL = `${ITEM_SEL}, h1, h2, h3, p, .eyebrow, .lead, .crumbs, .btn, .notice, .tag, .badge, .list, table, .logos, .hero-actions, .copy, .copyright, .footer-brand, .footer-col, .price, .section-head, .controls, .toolbar, .kpis, .bars, .legend, .earth-credit, .globe-hud, .page-hero > *`;
const PARALLAX = [['.section-head h2, .page-hero h1, .hero-title', -0.06], ['.section-head p, .page-hero .lead', -0.03]];
const CARD_DIRS = ['left', 'right', 'zoom'];

function markReveals() {
  const roots = document.querySelectorAll('main, footer, .hero, .page, .site-footer, .footer');
  const seen = new Set();
  const perParent = new Map();
  roots.forEach((root) => {
    root.querySelectorAll(BLOCK_SEL).forEach((el) => {
      if (seen.has(el) || el.hasAttribute('data-reveal')) return;
      if (['SCRIPT', 'STYLE', 'CANVAS', 'OPTION', 'SELECT', 'INPUT', 'TEXTAREA', 'LABEL'].includes(el.tagName)) return;
      if (el.closest('select, option, .nav, .site-nav, .scroll-progress, .ambient')) return;
      const container = el.parentElement && el.parentElement.closest(ITEM_SEL);
      if (container && container !== el && container.hasAttribute('data-reveal')) return;
      if (el.parentElement && el.parentElement.closest(ITEM_SEL) && el.matches(ITEM_SEL) === false) return;
      seen.add(el);
      const parent = el.parentElement;
      const index = perParent.get(parent) || 0;
      perParent.set(parent, index + 1);
      el.setAttribute('data-reveal', '');
      const isCard = el.matches(ITEM_SEL);
      const dir = isCard ? CARD_DIRS[index % CARD_DIRS.length] : (el.tagName === 'P' ? 'fade' : 'up');
      el.dataset.dir = dir === 'up' ? '' : dir;
      if (!el.dataset.dir) delete el.dataset.dir;
      el.style.setProperty('--rd', `${Math.min(index, 6) * 90}ms`);
    });
  });
}

function startReveal() {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  document.querySelectorAll('[data-reveal]').forEach((el) => io.observe(el));
}

function startParallax() {
  PARALLAX.forEach(([sel, speed]) => {
    document.querySelectorAll(sel).forEach((el) => {
      if (!el.hasAttribute('data-parallax')) el.dataset.parallax = String(speed);
    });
  });
  const items = [...document.querySelectorAll('[data-parallax]')];
  const update = () => {
    items.forEach((el) => {
      const rect = el.getBoundingClientRect();
      const base = rect.top - (el._y || 0);
      const y = (base + rect.height / 2 - window.innerHeight / 2) * parseFloat(el.dataset.parallax);
      el._y = y;
      el.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0)`;
    });
  };
  let ticking = false;
  const request = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { update(); ticking = false; });
  };
  window.addEventListener('scroll', request, { passive: true });
  window.addEventListener('resize', request);
  update();
}

function startChrome() {
  let bar = document.querySelector('.scroll-progress');
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'scroll-progress';
    bar.setAttribute('aria-hidden', 'true');
    document.body.prepend(bar);
  }
  const nav = document.querySelector('.site-nav, .nav');
  const onScroll = () => {
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    bar.style.transform = `scaleX(${window.scrollY / max})`;
    if (nav) nav.classList.toggle('scrolled', window.scrollY > 12);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

function startTilt() {
  if (!window.matchMedia('(pointer: fine)').matches) return;
  document.querySelectorAll('.card').forEach((card) => {
    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      card.style.setProperty('--ry', `${(x * 7).toFixed(2)}deg`);
      card.style.setProperty('--rx', `${(-y * 7).toFixed(2)}deg`);
    });
    card.addEventListener('pointerleave', () => {
      card.style.setProperty('--rx', '0deg');
      card.style.setProperty('--ry', '0deg');
    });
  });
}

function startAmbient() {
  if (hasGlobe) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'ambient';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  let w = 0, h = 0;
  const resize = () => {
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener('resize', resize);

  const count = Math.round(Math.min(64, (window.innerWidth * window.innerHeight) / 22000));
  const nodes = Array.from({ length: count }, () => ({
    x: Math.random(), y: Math.random(),
    vx: (Math.random() - 0.5) * 0.00004, vy: (Math.random() - 0.5) * 0.00004,
    r: 1 + Math.random() * 1.8,
  }));
  const orbs = [
    { x: 0.2, y: 0.3, r: 0.45, c: '169,214,242', s: 0.00005 },
    { x: 0.8, y: 0.75, r: 0.5, c: '244,214,166', s: 0.00004 },
  ];
  let t = 0;
  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(now - last, 50);
    last = now;
    if (!reduced) {
      t += dt;
      nodes.forEach((n) => {
        n.x += n.vx * dt;
        n.y += n.vy * dt;
        if (n.x < 0 || n.x > 1) n.vx *= -1;
        if (n.y < 0 || n.y > 1) n.vy *= -1;
      });
    }
    ctx.clearRect(0, 0, w, h);
    orbs.forEach((o, i) => {
      const cx = (o.x + Math.sin(t * o.s + i) * 0.08) * w;
      const cy = (o.y + Math.cos(t * o.s + i) * 0.08) * h;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, o.r * Math.max(w, h));
      g.addColorStop(0, `rgba(${o.c},0.45)`);
      g.addColorStop(1, `rgba(${o.c},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    });
    const maxD = Math.min(w, h) * 0.2;
    const pts = nodes.map((n) => ({ x: n.x * w, y: n.y * h, r: n.r }));
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
        if (d < maxD) {
          ctx.strokeStyle = `rgba(11,143,98,${((1 - d / maxD) * 0.16).toFixed(3)})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(pts[i].x, pts[i].y);
          ctx.lineTo(pts[j].x, pts[j].y);
          ctx.stroke();
        }
      }
    }
    pts.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(11,143,98,0.5)';
      ctx.fill();
    });
    if (!reduced) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  window.addEventListener('scroll', () => {
    canvas.style.transform = `translateY(${(window.scrollY * 0.12).toFixed(1)}px)`;
  }, { passive: true });
}

function start() {
  startChrome();
  startAmbient();
  markReveals();
  if (reduced) {
    document.querySelectorAll('[data-reveal]').forEach((el) => el.classList.add('in'));
    return;
  }
  startReveal();
  startParallax();
  startTilt();
}

if (!document.querySelector('link[data-motion]')) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('motion.css', import.meta.url).href;
  link.dataset.motion = '';
  document.head.append(link);
}

start();
