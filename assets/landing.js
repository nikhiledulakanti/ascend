import * as THREE from 'three';
import Lenis from 'https://unpkg.com/lenis@1.3.23/dist/lenis.mjs';

const TIFF_URL = 'assets/earth/land_shallow_topo_8192.tif';
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const deg = THREE.MathUtils.degToRad;
const normLon = (l) => ((l + 540) % 360 + 360) % 360 - 180;

if (!reduced) {
  const lenis = new Lenis({ duration: 1.15, smoothWheel: true, touchMultiplier: 1.5 });
  const raf = (t) => { lenis.raf(t); requestAnimationFrame(raf); };
  requestAnimationFrame(raf);
}

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

const GLOBE_RADIUS = 1.7;
const NEAR_DIST = 2.15;
const HERO_PIVOT_Y = -1.6;
const MAX_ZOOM = 2;
const MAP_MIN_Z = 3;
const MAP_MAX_Z = 18;

const heroCanvas = document.getElementById('planet');
const renderer = new THREE.WebGLRenderer({ canvas: heroCanvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.setClearColor(0x000000, 0);

const heroScene = new THREE.Scene();
const heroCam = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 100);
const farDist = () => Math.max(10.8, (GLOBE_RADIUS * 1.2) / (Math.tan(deg(17.5)) * heroCam.aspect));
const globeState = {
  yaw: 0, pitch: 0, zoom: 0, zoomTarget: 0,
  targetYaw: null, targetPitch: null,
  dragging: false, lastX: 0, lastY: 0,
  mapLat: 20, mapLon: 0,
  mapDrag: null,
};
const globeZoom = () => Math.min(globeState.zoom, 1);
const mapMix = () => clamp((globeState.zoom - 1) / 0.08, 0, 1);
const mapZoomLevel = () => MAP_MIN_Z + clamp(globeState.zoom - 1, 0, 1) * (MAP_MAX_Z - MAP_MIN_Z);

const applyZoom = () => {
  heroCam.position.set(0, 0, THREE.MathUtils.lerp(farDist(), NEAR_DIST, globeZoom()));
  heroCam.lookAt(0, 0, 0);
};
applyZoom();

const sun = new THREE.DirectionalLight(0xffffff, 2.1);
sun.position.set(-6, 3, 6);
heroScene.add(sun);
heroScene.add(new THREE.AmbientLight(0xffffff, 0.8));

const earth = new THREE.Mesh(
  new THREE.SphereGeometry(GLOBE_RADIUS, 256, 256),
  new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 })
);
earth.visible = false;
const atmosphere = new THREE.Mesh(
  new THREE.SphereGeometry(GLOBE_RADIUS * 1.06, 128, 128),
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
globe.position.set(0, HERO_PIVOT_Y, 0);
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
  applyZoom();
  resizeMap();
};
window.addEventListener('resize', onHeroResize);

const heroText = document.querySelectorAll('.hero-inner, .logos');
const gStatus = document.getElementById('globe-status');
const mapCredit = document.getElementById('map-credit');

const updateGlobe = (dt) => {
  const gs = globeState;
  gs.zoom += (gs.zoomTarget - gs.zoom) * Math.min(1, dt * 5);
  if (gs.targetYaw !== null) {
    const dy = Math.atan2(Math.sin(gs.targetYaw - gs.yaw), Math.cos(gs.targetYaw - gs.yaw));
    gs.yaw += dy * Math.min(1, dt * 2.5);
    gs.pitch += (gs.targetPitch - gs.pitch) * Math.min(1, dt * 2.5);
    if (Math.abs(dy) < 0.002 && Math.abs(gs.targetPitch - gs.pitch) < 0.002) {
      gs.yaw = gs.targetYaw;
      gs.pitch = gs.targetPitch;
      gs.targetYaw = null;
      gs.targetPitch = null;
    }
  } else if (!gs.dragging && !reduced && gs.zoom < 1) {
    gs.yaw += dt * 0.06;
  }
  globe.rotation.set(gs.pitch, gs.yaw, 0);
  globe.position.y = THREE.MathUtils.lerp(HERO_PIVOT_Y, 0, globeZoom());
  if (gs.zoom <= 1 && gs.targetYaw === null) {
    gs.mapLat = clamp(THREE.MathUtils.radToDeg(gs.pitch), -85, 85);
    gs.mapLon = normLon(THREE.MathUtils.radToDeg(Math.PI / 2 - gs.yaw) - 180);
  }
  heroText.forEach((el) => { el.style.opacity = (1 - globeZoom() * 0.9).toFixed(3); });
  applyZoom();
};

function goTo(lat, lon, zoomTarget) {
  const gs = globeState;
  gs.targetYaw = Math.PI / 2 - deg(lon + 180);
  gs.targetPitch = deg(lat);
  gs.mapLat = lat;
  gs.mapLon = lon;
  gs.zoomTarget = zoomTarget;
  gs.dragging = false;
}

const heroEl = document.querySelector('.hero');
heroEl.addEventListener('pointerdown', (e) => {
  if (e.target.closest('a,button,input,form') || window.scrollY > 40) return;
  const gs = globeState;
  gs.dragging = true;
  gs.targetYaw = null;
  gs.targetPitch = null;
  gs.lastX = e.clientX;
  gs.lastY = e.clientY;
  if (gs.zoom > 1) {
    const z = mapZoomLevel();
    gs.mapDrag = { cx: lonToX(gs.mapLon, z), cy: latToY(gs.mapLat, z), x: e.clientX, y: e.clientY, z };
  }
  heroEl.setPointerCapture(e.pointerId);
});
heroEl.addEventListener('pointermove', (e) => {
  const gs = globeState;
  if (!gs.dragging) return;
  if (gs.mapDrag) {
    const { cx, cy, x, y, z } = gs.mapDrag;
    gs.mapLon = xToLon(cx - (e.clientX - x), z);
    gs.mapLat = clamp(yToLat(cy - (e.clientY - y), z), -85, 85);
    return;
  }
  const dx = e.clientX - gs.lastX;
  const dy = e.clientY - gs.lastY;
  gs.lastX = e.clientX;
  gs.lastY = e.clientY;
  gs.yaw += dx * 0.005;
  gs.pitch = clamp(gs.pitch + dy * 0.005, -1.2, 1.2);
});
const endGlobeDrag = () => { globeState.dragging = false; globeState.mapDrag = null; };
heroEl.addEventListener('pointerup', endGlobeDrag);
heroEl.addEventListener('pointercancel', endGlobeDrag);

heroEl.addEventListener('wheel', (e) => {
  if (window.scrollY > 40) return;
  const gs = globeState;
  if ((e.deltaY > 0 && gs.zoomTarget < MAX_ZOOM) || (e.deltaY < 0 && gs.zoomTarget > 0)) {
    e.preventDefault();
    gs.zoomTarget = clamp(gs.zoomTarget + Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY) / 600, 0.15), 0, MAX_ZOOM);
  }
}, { passive: false });

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
heroEl.addEventListener('dblclick', (e) => {
  if (globeState.zoom > 1 || e.target.closest('a,button,input,form')) return;
  const rect = heroCanvas.getBoundingClientRect();
  ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, heroCam);
  const hit = raycaster.intersectObject(earth, false)[0];
  if (!hit) return;
  const local = earth.worldToLocal(hit.point.clone());
  const lat = THREE.MathUtils.radToDeg(Math.asin(clamp(local.y / GLOBE_RADIUS, -1, 1)));
  const lon = normLon(THREE.MathUtils.radToDeg(Math.atan2(local.z, -local.x)) - 180);
  goTo(lat, lon, 1.5);
  gStatus.textContent = `Viewing ${lat.toFixed(3)}, ${lon.toFixed(3)}`;
});

document.getElementById('globe-in').addEventListener('click', () => {
  globeState.zoomTarget = clamp(globeState.zoomTarget + 0.2, 0, MAX_ZOOM);
});
document.getElementById('globe-out').addEventListener('click', () => {
  globeState.zoomTarget = clamp(globeState.zoomTarget - 0.2, 0, MAX_ZOOM);
});
document.getElementById('globe-locate').addEventListener('click', () => {
  if (!navigator.geolocation) { gStatus.textContent = 'Location is not available in this browser.'; return; }
  gStatus.textContent = 'Finding your location…';
  navigator.geolocation.getCurrentPosition((pos) => {
    const { latitude, longitude } = pos.coords;
    goTo(latitude, longitude, 1.7);
    gStatus.textContent = `You are here: ${latitude.toFixed(3)}, ${longitude.toFixed(3)}`;
  }, () => {
    gStatus.textContent = 'Location permission was not granted.';
  }, { enableHighAccuracy: false, timeout: 10000 });
});

const placeForm = document.getElementById('place-form');
placeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = document.getElementById('place-input').value.trim();
  if (!q) return;
  gStatus.textContent = 'Searching…';
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`, {
      headers: { 'Accept-Language': 'en' },
    });
    const data = await res.json();
    if (!data.length) { gStatus.textContent = 'No place found. Try a different search.'; return; }
    goTo(parseFloat(data[0].lat), parseFloat(data[0].lon), 1.7);
    gStatus.textContent = data[0].display_name.slice(0, 110);
  } catch {
    gStatus.textContent = 'Search is unavailable right now.';
  }
});

const mapCanvas = document.getElementById('map-view');
const mctx = mapCanvas.getContext('2d');
const TILE = 256;
const tileCache = new Map();
let pendingTiles = 0;
let mapW = 1;
let mapH = 1;
const tileUrl = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;

function getTile(z, x, y) {
  const key = `${z}/${x}/${y}`;
  let t = tileCache.get(key);
  if (t) return t;
  if (tileCache.size > 500) tileCache.delete(tileCache.keys().next().value);
  const img = new Image();
  img.decoding = 'async';
  t = { img, ready: false, loadedAt: 0 };
  tileCache.set(key, t);
  pendingTiles++;
  img.onload = () => { t.ready = true; t.loadedAt = performance.now(); pendingTiles--; };
  img.onerror = () => { pendingTiles--; };
  img.src = tileUrl(z, x, y);
  return t;
}

const worldSize = (z) => TILE * Math.pow(2, z);
const lonToX = (lon, z) => (lon + 180) / 360 * worldSize(z);
const latToY = (lat, z) => (1 - Math.log(Math.tan(deg(lat)) + 1 / Math.cos(deg(lat))) / Math.PI) / 2 * worldSize(z);
const xToLon = (x, z) => x / worldSize(z) * 360 - 180;
const yToLat = (y, z) => THREE.MathUtils.radToDeg(Math.atan(Math.sinh(Math.PI * (1 - 2 * y / worldSize(z)))));

function resizeMap() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  mapW = window.innerWidth;
  mapH = window.innerHeight;
  mapCanvas.width = mapW * dpr;
  mapCanvas.height = mapH * dpr;
  mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
resizeMap();

function drawFallback(z, x, y, dx, dy, size) {
  if (z <= 0) return;
  const pz = z - 1, px = x >> 1, py = y >> 1;
  const parent = tileCache.get(`${pz}/${px}/${py}`);
  if (!parent || !parent.ready) return;
  mctx.drawImage(parent.img, (x & 1) * 128, (y & 1) * 128, 128, 128, dx, dy, size, size);
}

function drawTile(z, x, y, dx, dy, size, now) {
  const t = getTile(z, x, y);
  if (t.ready) {
    const a = Math.min(1, (now - t.loadedAt) / 350);
    if (a < 1) drawFallback(z, x, y, dx, dy, size);
    mctx.globalAlpha = a;
    mctx.drawImage(t.img, dx, dy, size, size);
    mctx.globalAlpha = 1;
  } else {
    drawFallback(z, x, y, dx, dy, size);
  }
}

function drawMap(now, opacity) {
  mctx.clearRect(0, 0, mapW, mapH);
  if (opacity <= 0.001) return;
  const z = mapZoomLevel();
  const tz = Math.min(MAP_MAX_Z, Math.floor(z));
  const scale = Math.pow(2, z - tz);
  const cx = lonToX(globeState.mapLon, z) * Math.pow(2, tz - z);
  const cy = latToY(globeState.mapLat, z) * Math.pow(2, tz - z);
  const left = cx - mapW / (2 * scale);
  const top = cy - mapH / (2 * scale);
  const n = Math.pow(2, tz);
  const x0 = Math.floor(left / TILE), x1 = Math.floor((left + mapW / scale) / TILE);
  const y0 = Math.floor(top / TILE), y1 = Math.floor((top + mapH / scale) / TILE);
  mctx.globalAlpha = opacity;
  for (let ty = Math.max(0, y0); ty <= Math.min(n - 1, y1); ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const wx = ((tx % n) + n) % n;
      drawTile(tz, wx, ty, (tx * TILE - left) * scale, (ty * TILE - top) * scale, TILE * scale, now);
    }
  }
  mctx.globalAlpha = 1;
}

const dunesCanvas = document.getElementById('dunes');
const sanctuary = document.getElementById('features');
const sceneSections = [...document.querySelectorAll('[data-scene]')];
const duneRenderer = new THREE.WebGLRenderer({ canvas: dunesCanvas, antialias: false });
duneRenderer.setPixelRatio(Math.min(window.devicePixelRatio, window.innerWidth < 768 ? 1 : 1.5));
duneRenderer.setSize(window.innerWidth, window.innerHeight, false);
const duneScene = new THREE.Scene();
const duneCam = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1000);
duneCam.position.set(0, 20, 30);

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
const mapStatus = document.getElementById('map-status');

let mix = 0;
let t = 0;
let last = performance.now() / 1000;

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

  updateGlobe(dt);
  const mapOpacity = mapMix() * (1 - mix);
  const globeOpacity = (1 - mix) * (1 - mapMix());
  window.__planetOpacity = globeOpacity < 0.01 ? 0 : globeOpacity;
  heroCanvas.style.opacity = globeOpacity.toFixed(3);
  mapCanvas.style.opacity = mapOpacity.toFixed(3);
  dunesCanvas.style.opacity = mix.toFixed(3);
  mapCredit.style.opacity = mapOpacity.toFixed(3);
  if (mix > 0.01) duneRenderer.render(duneScene, duneCam);
  if (window.__planetOpacity !== 0) renderer.render(heroScene, heroCam);

  if (mapOpacity > 0.001) {
    drawMap(performance.now(), 1);
    mapStatus.textContent = pendingTiles > 0 ? `Loading imagery… ${pendingTiles} tiles` : `Zoom ${mapZoomLevel().toFixed(1)} · ${globeState.mapLat.toFixed(3)}, ${globeState.mapLon.toFixed(3)}`;
  } else {
    mctx.clearRect(0, 0, mapW, mapH);
  }

  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
