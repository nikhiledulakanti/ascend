import * as THREE from 'three';
import Lenis from 'https://unpkg.com/lenis@1.3.23/dist/lenis.mjs';

const TIFF_URL = 'assets/earth/land_shallow_topo_8192.tif';
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

if (!reduced) {
  const lenis = new Lenis({ duration: 1.15, smoothWheel: true, touchMultiplier: 1.5 });
  const raf = (t) => { lenis.raf(t); requestAnimationFrame(raf); };
  requestAnimationFrame(raf);
}

const io = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  });
}, { threshold: 0.18, rootMargin: '0px 0px -8% 0px' });
document.querySelectorAll('[data-reveal]').forEach((el) => {
  if (reduced) el.classList.add('in'); else io.observe(el);
});

const statusEl = document.getElementById('earth-status');
const barEl = document.getElementById('earth-bar');
const barWrap = document.getElementById('earth-progress');
const viewCanvas = document.getElementById('earth-view');

async function loadEarth() {
  statusEl.textContent = 'Connecting to the satellite archive…';
  const res = await fetch(TIFF_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 27797968;
  const reader = res.body.getReader();
  const parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    barEl.style.width = Math.min(100, (got / total) * 100) + '%';
    statusEl.textContent = `Downloading NASA Earth image… ${(got / 1048576).toFixed(1)} MB`;
  }
  const bytes = new Uint8Array(got);
  let off = 0;
  parts.forEach((p) => { bytes.set(p, off); off += p.length; });

  statusEl.textContent = 'Decoding TIFF…';
  await new Promise((r) => setTimeout(r, 50));
  const ifd = window.UTIF.decode(bytes.buffer)[0];
  window.UTIF.decodeImage(bytes.buffer, ifd);
  const rgba = window.UTIF.toRGBA8(ifd);
  const canvas = document.createElement('canvas');
  canvas.width = ifd.width;
  canvas.height = ifd.height;
  canvas.getContext('2d').putImageData(
    new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength), ifd.width, ifd.height), 0, 0
  );
  return canvas;
}

const earthPromise = loadEarth().catch((err) => {
  console.warn('Satellite image failed to load.', err);
  return null;
});

const view = { x: 0, y: 0, w: 0, h: 0 };
let src = null;
const vctx = viewCanvas.getContext('2d');

const clampView = () => {
  view.w = clamp(view.w, 256, src.width);
  view.h = view.w / 2;
  view.x = clamp(view.x, 0, src.width - view.w);
  view.y = clamp(view.y, 0, src.height - view.h);
};
const drawView = () => {
  vctx.drawImage(src, view.x, view.y, view.w, view.h, 0, 0, viewCanvas.width, viewCanvas.height);
};
const zoomAt = (factor, ax = 0.5, ay = 0.5) => {
  const px = view.x + ax * view.w, py = view.y + ay * view.h;
  view.w *= factor;
  clampView();
  view.x = px - ax * view.w;
  view.y = py - ay * view.h;
  clampView();
  drawView();
};
const resetView = () => {
  view.w = src.width; view.x = 0; view.y = 0;
  clampView();
  drawView();
};

viewCanvas.width = 1600;
viewCanvas.height = 800;
earthPromise.then((canvas) => {
  if (!canvas) {
    barWrap.hidden = true;
    statusEl.textContent = 'The satellite image could not be loaded. Please refresh the page.';
    return;
  }
  src = canvas;
  resetView();
  barWrap.hidden = true;
  statusEl.textContent = `NASA Blue Marble, ${src.width} × ${src.height} px. Drag to pan, scroll to zoom.`;
});

let drag = null;
viewCanvas.addEventListener('pointerdown', (e) => {
  if (!src) return;
  drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
  viewCanvas.setPointerCapture(e.pointerId);
  viewCanvas.classList.add('grabbing');
});
viewCanvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const rect = viewCanvas.getBoundingClientRect();
  const scale = view.w / rect.width;
  view.x = drag.vx - (e.clientX - drag.x) * scale;
  view.y = drag.vy - (e.clientY - drag.y) * scale;
  clampView();
  drawView();
});
const endDrag = () => { drag = null; viewCanvas.classList.remove('grabbing'); };
viewCanvas.addEventListener('pointerup', endDrag);
viewCanvas.addEventListener('pointercancel', endDrag);
viewCanvas.addEventListener('wheel', (e) => {
  if (!src) return;
  e.preventDefault();
  const rect = viewCanvas.getBoundingClientRect();
  zoomAt(e.deltaY > 0 ? 1.15 : 1 / 1.15, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
}, { passive: false });
document.getElementById('zoom-in').addEventListener('click', () => src && zoomAt(1 / 1.5));
document.getElementById('zoom-out').addEventListener('click', () => src && zoomAt(1.5));
document.getElementById('zoom-reset').addEventListener('click', () => src && resetView());

const heroCanvas = document.getElementById('planet');
const renderer = new THREE.WebGLRenderer({ canvas: heroCanvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.setClearColor(0x000000, 0);

const heroScene = new THREE.Scene();
const heroCam = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 100);
heroCam.position.set(0, 0, 9);

const sun = new THREE.DirectionalLight(0xffffff, 2.1);
sun.position.set(-6, 3, 6);
heroScene.add(sun);
heroScene.add(new THREE.AmbientLight(0xffffff, 0.45));

const earth = new THREE.Mesh(
  new THREE.SphereGeometry(2.4, 128, 128),
  new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 })
);
earth.visible = false;
const atmosphere = new THREE.Mesh(
  new THREE.SphereGeometry(2.52, 96, 96),
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    vertexShader: `
      varying vec3 vN; varying vec3 vV;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec3 vN; varying vec3 vV;
      void main(){
        float f = pow(1.0 - max(dot(normalize(vN), normalize(vV)), 0.0), 3.5);
        gl_FragColor = vec4(vec3(0.42, 0.68, 1.0), f * 0.55);
      }`,
  })
);
const globe = new THREE.Group();
globe.add(earth, atmosphere);
globe.position.set(0, -3.4, 0);
globe.rotation.z = 0.41;
heroScene.add(globe);

earthPromise.then((canvas) => {
  if (!canvas) return;
  const tex = new THREE.CanvasTexture(canvas);
  tex.encoding = THREE.sRGBEncoding;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  earth.material.map = tex;
  earth.material.needsUpdate = true;
  earth.visible = true;
});

const onHeroResize = () => {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  heroCam.aspect = window.innerWidth / window.innerHeight;
  heroCam.updateProjectionMatrix();
};
window.addEventListener('resize', onHeroResize);

const sanctuary = document.getElementById('sanctuary');
const sceneSections = [...document.querySelectorAll('[data-scene]')];
const dunesCanvas = document.getElementById('dunes');

const PALETTES = {
  dawn:   { skyTop: '#8dbde6', skyHor: '#fbe9d2', sand: '#f2dcb9', shadow: '#cfae8a', mount: '#c9d8e8', sun: '#fff4dc', star: 0.0 },
  golden: { skyTop: '#f4b889', skyHor: '#fde6c8', sand: '#f4d6a6', shadow: '#c99468', mount: '#e8c3b0', sun: '#ffe6b0', star: 0.0 },
  noon:   { skyTop: '#a9d6f2', skyHor: '#f7f2e6', sand: '#f6e8cc', shadow: '#dcbf9a', mount: '#d8e4ef', sun: '#fffbe9', star: 0.0 },
};
const COLOR_KEYS = ['skyTop', 'skyHor', 'sand', 'shadow', 'mount', 'sun'];
const state = {};
COLOR_KEYS.forEach((k) => { state[k] = new THREE.Color(PALETTES.dawn[k]); });
state.star = PALETTES.dawn.star;
const palTarget = {};
Object.keys(PALETTES).forEach((k) => {
  palTarget[k] = { star: PALETTES[k].star, c: {} };
  COLOR_KEYS.forEach((key) => { palTarget[k].c[key] = new THREE.Color(PALETTES[k][key]); });
});

const sunDir = new THREE.Vector3(0.4, 0.5, -0.7).normalize();
const U = {
  uTime: { value: 0 }, uWind: { value: 0 }, uSunDir: { value: sunDir },
  uSand: { value: state.sand }, uShadow: { value: state.shadow }, uSkyTop: { value: state.skyTop },
  uSkyHor: { value: state.skyHor }, uSun: { value: state.sun }, uMount: { value: state.mount },
  uStar: { value: state.star },
};

const SNOISE = `
vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0); const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy)); vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz); vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy); vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + 1.0 * C.xxx; vec3 x2 = x0 - i2 + 2.0 * C.xxx; vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
  i = mod(i, 289.0);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 1.0/7.0; vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z *ns.z);
  vec4 x_ = floor(j * ns.z); vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ *ns.x + ns.yyyy; vec4 y = y_ *ns.x + ns.yyyy; vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy); vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0; vec4 s1 = floor(b1)*2.0 + 1.0; vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy; vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy,h.x); vec3 p1 = vec3(a0.zw,h.y); vec3 p2 = vec3(a1.xy,h.z); vec3 p3 = vec3(a1.zw,h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0); m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}`;

const duneRenderer = new THREE.WebGLRenderer({ canvas: dunesCanvas, antialias: false });
duneRenderer.setPixelRatio(Math.min(window.devicePixelRatio, window.innerWidth < 768 ? 1 : 1.5));
duneRenderer.setSize(window.innerWidth, window.innerHeight, false);
const duneScene = new THREE.Scene();
const duneCam = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1000);
duneCam.position.set(0, 20, 30);

const seg = window.innerWidth < 768 ? 110 : 220;
const terrainGeo = new THREE.PlaneGeometry(700, 600, seg, seg);
terrainGeo.rotateX(-Math.PI / 2);
terrainGeo.translate(0, 0, -120);
duneScene.add(new THREE.Mesh(terrainGeo, new THREE.ShaderMaterial({
  uniforms: { uTime: U.uTime, uWind: U.uWind, uSand: U.uSand, uShadow: U.uShadow, uSkyHor: U.uSkyHor, uLightDir: U.uSunDir },
  vertexShader: `
    uniform float uWind;
    varying vec3 vW; varying vec3 vN;
    ${SNOISE}
    float ht(vec2 p){
      float h = snoise(vec3(p.x*0.009, 0.0, p.y*0.009 + uWind*0.02)) * 18.0;
      h += snoise(vec3(p.x*0.03 + uWind*0.12, 1.7, p.y*0.03)) * 3.2;
      h += snoise(vec3(p.x*0.11, 3.1, p.y*0.11 - uWind*0.25)) * 0.5;
      return h - 6.0;
    }
    void main(){
      vec2 p = position.xz;
      float h = ht(p);
      float e = 0.6;
      float hx = ht(p + vec2(e, 0.0));
      float hz = ht(p + vec2(0.0, e));
      vN = normalize(vec3(h - hx, e, h - hz));
      vW = vec3(p.x, h, p.y);
      gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
    }`,
  fragmentShader: `
    uniform float uTime; uniform vec3 uSand; uniform vec3 uShadow; uniform vec3 uSkyHor; uniform vec3 uLightDir;
    varying vec3 vW; varying vec3 vN;
    ${SNOISE}
    void main(){
      vec3 n = normalize(vN);
      float ndl = max(dot(n, normalize(uLightDir)), 0.0);
      float lit = smoothstep(0.05, 0.85, ndl);
      vec3 col = mix(uShadow, uSand, lit);
      col *= 0.92 + 0.08 * snoise(vec3(vW.xz * 0.35, 0.0));
      col += 0.02 * snoise(vec3(vW.x * 0.6, 0.0, vW.z * 0.06 + uTime * 0.01));
      float d = length(vW - cameraPosition);
      col = mix(col, uSkyHor, smoothstep(60.0, 380.0, d));
      gl_FragColor = vec4(col, 1.0);
    }`,
})));

const mountains = new THREE.Mesh(
  new THREE.PlaneGeometry(1600, 200, 320, 1).translate(0, 100, -440),
  new THREE.ShaderMaterial({
    uniforms: { uMount: U.uMount, uSkyHor: U.uSkyHor },
    vertexShader: `
      varying float vY;
      ${SNOISE}
      void main(){
        float r = pow(1.0 - abs(snoise(vec3(position.x * 0.004, 4.0, 0.0))), 3.0);
        vec3 p = vec3(position.x, -40.0 + 130.0 * r, position.z);
        vY = p.y;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uMount; uniform vec3 uSkyHor; varying float vY;
      void main(){
        float t = smoothstep(-40.0, 60.0, vY);
        gl_FragColor = vec4(mix(uMount, uSkyHor, 0.35 + 0.25 * (1.0 - t)), 1.0);
      }`,
  })
);
duneScene.add(mountains);

const sky = new THREE.Mesh(
  new THREE.SphereGeometry(300, 32, 16),
  new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uSkyTop: U.uSkyTop, uSkyHor: U.uSkyHor, uSun: U.uSun, uStar: U.uStar, uSunDir: U.uSunDir },
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: `
      varying vec3 vDir;
      void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uSkyTop; uniform vec3 uSkyHor; uniform vec3 uSun; uniform float uStar; uniform vec3 uSunDir;
      varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(uSkyHor, uSkyTop, smoothstep(0.0, 0.55, h));
        col += uSun * pow(max(dot(d, normalize(uSunDir)), 0.0), 18.0) * 0.7;
        vec3 g = floor(d * 220.0);
        float r = fract(sin(dot(g, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
        float tw = 0.7 + 0.3 * sin(uTime * 2.0 + r * 80.0);
        col += step(0.9965, r) * uStar * smoothstep(0.08, 0.45, h) * tw;
        gl_FragColor = vec4(col, 1.0);
      }`,
  })
);
sky.renderOrder = -1;
duneScene.add(sky);

const onDuneResize = () => {
  duneRenderer.setSize(window.innerWidth, window.innerHeight, false);
  duneCam.aspect = window.innerWidth / window.innerHeight;
  duneCam.updateProjectionMatrix();
};
window.addEventListener('resize', onDuneResize);

const progressBar = document.querySelector('.scroll-progress');
const parallax = [...document.querySelectorAll('[data-parallax]')];

let mix = 0;
let t = 0;
let last = performance.now() / 1000;
let spin = 0;

const frame = () => {
  const now = performance.now() / 1000;
  const dt = Math.min(now - last, 0.05);
  last = now;
  if (!reduced) t += dt;
  U.uTime.value = t;
  U.uWind.value = t;

  const sy = window.scrollY;
  const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  progressBar.style.transform = `scaleX(${sy / max})`;

  const onTarget = sy > sanctuary.offsetTop - window.innerHeight * 0.6 ? 1 : 0;
  mix += (onTarget - mix) * Math.min(1, dt * 2.2);
  const pd = clamp((sy - sanctuary.offsetTop) / Math.max(1, max - sanctuary.offsetTop), 0, 1);

  const mid = window.innerHeight / 2;
  let best = null, bestDist = Infinity;
  sceneSections.forEach((s) => {
    const r = s.getBoundingClientRect();
    const dist = Math.abs(r.top + r.height / 2 - mid);
    if (dist < bestDist) { bestDist = dist; best = s; }
  });
  const tgt = palTarget[best ? best.dataset.scene : 'dawn'];
  const a = Math.min(1, dt * 1.4);
  COLOR_KEYS.forEach((k) => state[k].lerp(tgt.c[k], a));
  state.star += (tgt.star - state.star) * a;
  U.uStar.value = state.star;

  duneCam.position.set(Math.sin(t * 0.15) * 2.5, 20 + Math.sin(t * 0.4) * 0.6, 30 - pd * 190);
  duneCam.lookAt(Math.sin(t * 0.1) * 3, 4, duneCam.position.z - 60);
  sky.position.copy(duneCam.position);

  const planetOp = 1 - mix;
  window.__planetOpacity = planetOp < 0.01 ? 0 : planetOp;
  heroCanvas.style.opacity = planetOp.toFixed(3);
  dunesCanvas.style.opacity = mix.toFixed(3);
  if (mix > 0.01) duneRenderer.render(duneScene, duneCam);

  if (window.__planetOpacity !== 0) {
    if (!reduced) spin += dt * 0.04;
    globe.rotation.y = spin;
    renderer.render(heroScene, heroCam);
  }

  parallax.forEach((el) => {
    const rect = el.getBoundingClientRect();
    const baseTop = rect.top - (el._y || 0);
    const y = (baseTop + rect.height / 2 - window.innerHeight / 2) * parseFloat(el.dataset.parallax);
    el._y = y;
    el.style.translate = `0 ${y.toFixed(1)}px`;
  });

  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
