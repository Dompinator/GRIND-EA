/* ============================================================
 * GRIND-EA · Procedural 3D GPU CAD Designer (Three.js PBR)
 * Smooth Fan Cutouts · Red/Blue 3D Size Arrows · Modular Elements
 * ============================================================ */
(function () {
  'use strict';

  const DEFAULT_CUSTOM_POINTS = [
    [-0.96, -0.88],
    [-0.58, -0.98],
    [0.58, -0.98],
    [0.98, -0.62],
    [0.98, 0.62],
    [0.58, 0.98],
    [-0.58, 0.98],
    [-0.96, 0.88]
  ];

  const DEFAULT_CONFIG = {
    length: 300,       // 210..360 mm
    width: 125,        // 105..150 mm
    thickness: 52,     // 38..76 mm
    body: 'plastic',   // plastic | metallic | carbon | custom
    finish: 'satin',   // satin | matte | gloss
    shroud: 'rounded', // rounded | angular | compact | founders | stealth | triple
    customShape: {
      points: DEFAULT_CUSTOM_POINTS.map(p => [...p]),
      extrudeDepth: 1.0,
      bevel: 0.018,
      material: 'plastic'
    },
    primaryColor: '#222733',
    accentColor: '#a855f7',
    backplate: false,
    backplateStyle: 'off', // off | solid | flow_through | louvered
    finStyle: 'silver',    // silver | black | copper
    pipeStyle: 'copper',   // copper | nickel | black
    powerType: '12v2x6',   // 1x8pin | 2x8pin | 3x8pin | 12v2x6
    ioStyle: 'steel',      // steel | black
    elements: [
      { id: 'fan_1', kind: 'fan', fanType: 'basic', position: 0.28, size: 1.0 },
      { id: 'fan_2', kind: 'fan', fanType: 'basic', position: 0.72, size: 1.0 }
    ]
  };

  let THREE = null;
  let OrbitControls = null;
  let RoomEnvironment = null;
  let initPromise = null;
  let isSoftwareGl = false;
  let contextLost = false;

  let stageEl = null;
  let offscreenHostEl = null;
  let offscreenPromise = null;
  let dockEl = null;
  let sizeHudEl = null;
  let renderer = null;
  let scene = null;
  let camera = null;
  let controls = null;
  let pmremGenerator = null;
  let envTexture = null;
  let resizeObserver = null;
  let thumbQueueBusy = false;
  const gpuThumbQueue = [];

  let gpuRoot = null;
  let backplateLayer = null;
  let pcbLayer = null;
  let heatsinkLayer = null;
  let shroudLayer = null;
  let fansGroup = null;
  let elementsGroup = null;
  let sizeGizmoGroup = null;
  let plinthGroup = null;

  let fanAssemblies = [];     // [{ id, index, group, rotor, hitMesh, ringMat, yTop, baseEmissive, speed, fanType, r, pos }]
  let draggableDecals = [];   // [{ id, group, hitMesh, dragPlaneAxis, dragPlaneConst }]
  let sizeArrowHandles = [];  // [{ axis: 'x'|'z', sign: 1|-1, hitMesh, mat, baseColor }]
  let rainbowRgbMats = [];    // [{ mat, offset }]
  const logoImageCache = new Map(); // url -> HTMLImageElement | 'loading'
  const decalTexCache = new Map();  // sig -> THREE.CanvasTexture
  const proceduralTex = {};
  const proceduralGeo = {};
  const sharedAssets = new Set();

  let config = {
    ...DEFAULT_CONFIG,
    elements: DEFAULT_CONFIG.elements.map(e => ({ ...e }))
  };
  let callbacks = {};

  // Animation & interaction state
  let rafId = 0;
  let timerId = 0;
  let lastMs = 0;
  let autoSpin = false;
  let sizeMode = false;
  let currentExplode = 0;
  let targetExplode = 0;
  let rainbowPhase = 0;
  let camAnimActive = false;
  const camTargetPos = { x: 2.9, y: 2.45, z: -3.15 };
  const camTargetLook = { x: 0, y: 0.05, z: 0 };

  // Raycast interaction & differential rebuild state
  let raycaster = null;
  let pointerNdc = null;
  let dragPlane = null;
  let dragHitPoint = null;
  let activeDrag = null; // { mode: 'size'|'element', axis?, sign?, id?, offsetX? }
  let pendingRebuild = false;
  let pendingFastMode = false;
  let hiResSettleTimer = 0;
  let lastUpdateCallMs = 0;
  let lastStructSig = '';
  let lastDecalsSig = '';
  let lastShroudSig = '';
  let lastFanGeomSig = '';
  let lastGizmoSig = '';
  let cachedSurfaceBounds = null;

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  const GPU_MIN_LEN = 210;
  const GPU_MAX_LEN = 360;
  const GPU_MIN_WID = 105;
  const GPU_MAX_WID = 150;
  const GPU_MIN_RATIO = 1.75; // length / width
  const GPU_MAX_RATIO = 2.95;

  function clampLengthForWidth(rawLen, wid) {
    const w = clamp(Math.round(Number(wid) || 125), GPU_MIN_WID, GPU_MAX_WID);
    const minL = Math.max(GPU_MIN_LEN, Math.ceil(w * GPU_MIN_RATIO));
    const maxL = Math.min(GPU_MAX_LEN, Math.floor(w * GPU_MAX_RATIO));
    return clamp(Math.round(Number(rawLen) || 300), minL, maxL);
  }

  function clampWidthForLength(rawWid, len) {
    const l = clamp(Math.round(Number(len) || 300), GPU_MIN_LEN, GPU_MAX_LEN);
    const minW = Math.max(GPU_MIN_WID, Math.ceil(l / GPU_MAX_RATIO));
    const maxW = Math.min(GPU_MAX_WID, Math.floor(l / GPU_MIN_RATIO));
    return clamp(Math.round(Number(rawWid) || 125), minW, maxW);
  }

  function detectSoftwareWebGL() {
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(name);
    } catch (_) {
      return true;
    }
  }

  async function ensureThree() {
    if (THREE && OrbitControls && RoomEnvironment) return true;
    if (initPromise) return initPromise;
    initPromise = (async () => {
      try {
        const [threeMod, orbitMod, envMod] = await Promise.all([
          import('three'),
          import('three/addons/controls/OrbitControls.js'),
          import('three/addons/environments/RoomEnvironment.js')
        ]);
        THREE = threeMod;
        OrbitControls = orbitMod.OrbitControls;
        RoomEnvironment = envMod.RoomEnvironment;
        raycaster = new THREE.Raycaster();
        pointerNdc = new THREE.Vector2();
        dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        dragHitPoint = new THREE.Vector3();
        return true;
      } catch (err) {
        console.error('GPU 3D editor could not load Three.js:', err);
        initPromise = null;
        return false;
      }
    })();
    return initPromise;
  }

  // ---------- Procedural Hardware Textures ----------
  function getPlasticBumpTexture() {
    if (proceduralTex.plasticBump) return proceduralTex.plasticBump;
    const size = 256;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = 122 + Math.floor(Math.random() * 16);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = n;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(8, 4);
    proceduralTex.plasticBump = tex;
    return tex;
  }

  function getBrushedMetalTexture() {
    if (proceduralTex.brushedMetal) return proceduralTex.brushedMetal;
    const w = 1024, h = 512;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ebeff5';
    ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y++) {
      const v = 220 + Math.floor(Math.random() * 32);
      ctx.fillStyle = `rgb(${v},${v + 1},${v + 3})`;
      ctx.fillRect(0, y, w, 1);
    }
    for (let i = 0; i < 900; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const len = 45 + Math.random() * 200;
      ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.14)' : 'rgba(15,23,42,0.08)';
      ctx.fillRect(x, y, len, 1);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 1.5);
    tex.anisotropy = 8;
    proceduralTex.brushedMetal = tex;
    return tex;
  }

  function getCarbonTextures() {
    if (proceduralTex.carbonColor) return { color: proceduralTex.carbonColor, bump: proceduralTex.carbonBump };
    const size = 256;
    const cc = document.createElement('canvas');
    const cb = document.createElement('canvas');
    cc.width = cc.height = cb.width = cb.height = size;
    const ctxC = cc.getContext('2d');
    const ctxB = cb.getContext('2d');
    // Match CPU's crisp 2x2 diagonal carbon twill weave in normalized grayscale
    ctxC.fillStyle = '#8b93a3';
    ctxC.fillRect(0, 0, size, size);
    ctxB.fillStyle = '#404040';
    ctxB.fillRect(0, 0, size, size);
    const cell = 16;
    for (let y = 0; y < size; y += cell) {
      for (let x = 0; x < size; x += cell) {
        const shift = ((y / cell) % 2) * 8;
        const even = ((x + shift) % 32 === 0);
        ctxC.fillStyle = even ? '#c8d0de' : '#4a5160';
        ctxC.fillRect(x, y, 14, 7);
        ctxC.fillStyle = even ? '#aeb6c5' : '#586070';
        ctxC.fillRect(x + 2, y + 8, 12, 7);

        ctxB.fillStyle = even ? '#989898' : '#262626';
        ctxB.fillRect(x, y, 14, 7);
        ctxB.fillStyle = even ? '#787878' : '#303030';
        ctxB.fillRect(x + 2, y + 8, 12, 7);
      }
    }
    const color = new THREE.CanvasTexture(cc);
    color.colorSpace = THREE.SRGBColorSpace;
    color.wrapS = color.wrapT = THREE.RepeatWrapping;
    color.repeat.set(14, 6);
    color.anisotropy = 8;
    const bump = new THREE.CanvasTexture(cb);
    bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
    bump.repeat.set(14, 6);
    proceduralTex.carbonColor = color;
    proceduralTex.carbonBump = bump;
    return { color, bump };
  }

  function getPcbTexture() {
    if (proceduralTex.pcb) return proceduralTex.pcb;
    const w = 1024, h = 512;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#0a1914');
    g.addColorStop(1, '#06110e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // Fine fiberglass weave
    ctx.strokeStyle = 'rgba(255,255,255,0.02)';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 12) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y < h; y += 12) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

    // High-density differential copper serpentine routing & via arrays
    ctx.strokeStyle = 'rgba(56, 178, 128, 0.34)';
    ctx.lineWidth = 1.6;
    for (let i = 0; i < 64; i++) {
      const y = 20 + (i * (h - 40)) / 64;
      const jog = (i % 2 === 0 ? 14 : -14);
      ctx.beginPath();
      ctx.moveTo(18, y);
      ctx.lineTo(240 + (i % 6) * 44, y);
      ctx.lineTo(290 + (i % 6) * 44, y + jog);
      ctx.lineTo(w - 22, y + jog);
      ctx.stroke();

      ctx.fillStyle = 'rgba(226, 185, 92, 0.65)';
      ctx.beginPath();
      ctx.arc(w - 28, y + jog, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Gold perimeter ground ring + keepout frame around GPU package
    ctx.strokeStyle = 'rgba(218, 176, 86, 0.55)';
    ctx.lineWidth = 3;
    ctx.strokeRect(12, 12, w - 24, h - 24);
    ctx.strokeRect(w * 0.33, h * 0.24, w * 0.28, h * 0.52);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    proceduralTex.pcb = tex;
    return tex;
  }

  function getSiliconDieTexture() {
    if (proceduralTex.siliconDie) return proceduralTex.siliconDie;
    const size = 512;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, '#132a46');
    grad.addColorStop(0.5, '#1d4d6b');
    grad.addColorStop(1, '#2b1e4d');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    for (let r = 0; r < 6; r++) {
      for (let col = 0; col < 6; col++) {
        ctx.fillStyle = (r + col) % 2 === 0 ? 'rgba(90,215,255,0.22)' : 'rgba(176,132,255,0.20)';
        ctx.fillRect(28 + col * 76, 28 + r * 76, 66, 66);
        ctx.strokeStyle = 'rgba(200,245,255,0.55)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(28 + col * 76, 28 + r * 76, 66, 66);
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    proceduralTex.siliconDie = tex;
    return tex;
  }

  function getPcieFingersTexture() {
    if (proceduralTex.pcie) return proceduralTex.pcie;
    const w = 512, h = 64;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#12261e';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#eab308';
    for (let x = 8; x < w - 8; x += 9) {
      if (x > 96 && x < 114) continue; // x1/x16 key notch visual
      ctx.fillRect(x, 6, 5, h - 12);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    proceduralTex.pcie = tex;
    return tex;
  }

  function getContactShadowTexture() {
    if (proceduralTex.contactShadow) return proceduralTex.contactShadow;
    const size = 256;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 18, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.72)');
    g.addColorStop(0.55, 'rgba(6,4,14,0.34)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    proceduralTex.contactShadow = tex;
    return tex;
  }

  function requestLogoImage(url) {
    const clean = String(url || '').trim();
    if (!clean) return null;
    const existing = logoImageCache.get(clean);
    if (existing && existing !== 'loading') return existing;
    if (existing === 'loading') return null;
    logoImageCache.set(clean, 'loading');
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      logoImageCache.set(clean, img);
      decalTexCache.clear();
      lastDecalsSig = '';
      if (renderer && gpuRoot) {
        pendingRebuild = true;
        pendingFastMode = false;
      }
    };
    img.onerror = () => { logoImageCache.delete(clean); };
    img.src = clean;
    return null;
  }

  function getTextDecalTexture(text, colorHex) {
    const clean = String(text || 'GPU').trim().slice(0, 24) || 'GPU';
    const col = colorHex || '#ffffff';
    const sig = `txt2|${clean}|${col}`;
    if (decalTexCache.has(sig)) return decalTexCache.get(sig);

    const c = document.createElement('canvas');
    c.width = 1024; c.height = 256;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 1024, 256);

    ctx.font = '900 118px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(8, 10, 18, 0.85)';
    ctx.lineWidth = 14;
    ctx.strokeText(clean, 512, 132, 950);
    ctx.fillStyle = col;
    ctx.fillText(clean, 512, 132, 950);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    decalTexCache.set(sig, tex);
    return tex;
  }

  function getLogoDecalTexture(url, tintHex) {
    const img = requestLogoImage(url);
    const sig = `logo|${url || 'none'}|${img ? 'ok' : 'wait'}|${tintHex || ''}`;
    if (decalTexCache.has(sig)) return decalTexCache.get(sig);

    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 256, 256);

    if (img) {
      const s = Math.min(220 / img.width, 220 / img.height);
      ctx.drawImage(img, (256 - img.width * s) / 2, (256 - img.height * s) / 2, img.width * s, img.height * s);
    } else {
      ctx.strokeStyle = tintHex || '#c084fc';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(128, 128, 86, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#f8fafc';
      ctx.font = '900 54px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('GPU', 128, 130);
    }

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    decalTexCache.set(sig, tex);
    return tex;
  }

  // ---------- Shroud Silhouette with Smooth Fan Cutout Holes ----------
  const DECK_W_RATIO = 0.965;
  const DECK_D_RATIO = 0.90;

  function computeDeckSafeLimits(w, d, shapeType) {
    const deckW = w * DECK_W_RATIO;
    const deckD = d * DECK_D_RATIO;
    const hwDeck = deckW / 2;
    const hdDeck = deckD / 2;
    const mainBevel = shapeType === 'compact' ? 0.011 : 0.018;
    const deckBevel = shapeType === 'compact' ? 0.008 : 0.011;
    const cornerCutZ = (shapeType === 'angular' || shapeType === 'founders' || shapeType === 'triple')
      ? Math.min(0.14, deckW * 0.065, deckD * 0.14) * 1.3
      : (shapeType === 'rounded')
        ? Math.min(0.18, deckW * 0.085, deckD * 0.22)
        : 0.025;
    const edgeMargin = 0.022;

    const maxXForR = r => {
      const holeR = r * 1.028 + deckBevel;
      const flatZ = Math.max(0.12, hdDeck - cornerCutZ);
      const cornerInset = holeR > flatZ ? (holeR - flatZ) * 0.78 : 0;
      return Math.max(0.04, hwDeck - edgeMargin - cornerInset - holeR);
    };

    const maxRForX = fx => {
      const avail = hwDeck - edgeMargin - Math.abs(fx) - deckBevel;
      return clamp(avail / 1.028, 0.10, hdDeck - 0.032 - deckBevel);
    };

    return { hwDeck, hdDeck, mainBevel, deckBevel, maxXForR, maxRForX };
  }

  function computeSafeFanLayouts(fanElements, w, d, shapeType) {
    const hw = w / 2;
    const count = fanElements.length;
    if (!count) return [];

    const { hdDeck, mainBevel, deckBevel, maxXForR, maxRForX } = computeDeckSafeLimits(w, d, shapeType);

    const items = fanElements.map((f, idx) => {
      const pos = clamp(Number(f.position ?? ((idx + 0.5) / count)), 0.06, 0.94);
      const scale = clamp(Number(f.size ?? 1.0), 0.65, 1.25);
      const baseMax = Math.min(hdDeck * 0.85, (w * 0.88) / (Math.max(1, count) * 2.04));
      const desiredR = clamp(baseMax * scale, 0.12, hdDeck - 0.045);
      return {
        id: f.id,
        fanType: f.fanType || 'basic',
        bladeColor: f.bladeColor || 'dark',
        hubStyle: f.hubStyle || 'auto',
        rgbRing: !!f.rgbRing,
        pos,
        fx: -hw + w * pos,
        desiredR,
        r: desiredR
      };
    });

    const sorted = [...items].sort((a, b) => a.fx - b.fx);
    const minFanR = 0.115;
    const absMaxX = maxXForR(minFanR);

    for (const item of sorted) {
      item.fx = clamp(item.fx, -absMaxX, absMaxX);
      const roomR = maxRForX(item.fx);
      item.r = clamp(Math.min(item.desiredR, roomR), minFanR, hdDeck - 0.045);
      const safeX = maxXForR(item.r);
      item.fx = clamp(item.fx, -safeX, safeX);
    }

    const minClear = 0.042;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i];
        const b = sorted[i + 1];
        let gap = b.fx - a.fx;
        if (gap < a.r + b.r + minClear) {
          if (gap < 0.25) {
            const push = (0.25 - gap) * 0.5;
            a.fx = clamp(a.fx - push, -absMaxX, absMaxX);
            b.fx = clamp(b.fx + push, -absMaxX, absMaxX);
            gap = Math.max(0.16, b.fx - a.fx);
          }
          const factor = Math.max(0.38, (gap - minClear) / Math.max(0.01, a.r + b.r));
          if (factor < 1) {
            a.r = Math.max(0.085, a.r * factor);
            b.r = Math.max(0.085, b.r * factor);
          }
        }
      }
    }

    for (const item of sorted) {
      const safeX = maxXForR(item.r);
      item.fx = clamp(item.fx, -safeX, safeX);
      item.r = clamp(Math.min(item.r, maxRForX(item.fx)), 0.085, hdDeck - 0.036);
      item.mainHoleR = item.r * 1.028 + mainBevel;
      item.deckHoleR = item.r * 1.028 + deckBevel;
    }

    return items;
  }

  function polySignedArea(pts) {
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % pts.length];
      area += x1 * y2 - x2 * y1;
    }
    return area * 0.5;
  }

  function pointInPolygon(px, py, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      const intersect = ((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / ((yj - yi) || 1e-9) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function distToPolygonEdges(px, py, pts) {
    let minD = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[(i + 1) % pts.length];
      const abx = bx - ax, aby = by - ay;
      const lenSq = abx * abx + aby * aby;
      const t = lenSq > 1e-8 ? clamp(((px - ax) * abx + (py - ay) * aby) / lenSq, 0, 1) : 0;
      const cx = ax + t * abx, cy = ay + t * aby;
      const d = Math.hypot(px - cx, py - cy);
      if (d < minD) minD = d;
    }
    return minD;
  }

  function createShroudGeometryWithHoles(w, h, d, shapeType, holesList, fastMode = false, isDeck = false, rectCutout = null, customShape = null) {
    const hw = w / 2;
    const hd = d / 2;
    const shape = new THREE.Shape();
    let customWorldPts = null;

    if (customShape && Array.isArray(customShape.points) && customShape.points.length >= 3) {
      let pts = customShape.points
        .filter(p => Array.isArray(p) && p.length >= 2)
        .map(([nx, nz]) => [clamp(Number(nx) || 0, -1, 1) * hw, clamp(Number(nz) || 0, -1, 1) * hd]);
      if (pts.length >= 3) {
        if (polySignedArea(pts) < 0) pts = pts.slice().reverse();
        customWorldPts = pts;
        shape.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) {
          shape.lineTo(pts[i][0], pts[i][1]);
        }
        shape.closePath();
      }
    }

    if (!customWorldPts) {
      if (shapeType === 'angular' || shapeType === 'founders' || shapeType === 'triple') {
        const c1 = isDeck ? Math.min(0.14, w * 0.065, d * 0.14) : Math.min(0.16, w * 0.075, d * 0.15);
        const asym = shapeType === 'triple' ? 1.55 : shapeType === 'founders' ? 1.15 : 1.35;
        shape.moveTo(-hw + c1, -hd);
        shape.lineTo(hw - c1 * asym, -hd);
        shape.lineTo(hw, -hd + c1 * 1.3);
        shape.lineTo(hw, hd - c1 * 1.3);
        shape.lineTo(hw - c1 * (shapeType === 'triple' ? 0.9 : asym), hd);
        shape.lineTo(-hw + c1, hd);
        shape.lineTo(-hw, hd - c1);
        shape.lineTo(-hw, -hd + c1);
        shape.closePath();
      } else if (shapeType === 'compact' || shapeType === 'stealth') {
        const r = shapeType === 'stealth' ? Math.min(0.06, w * 0.03, d * 0.06) : Math.min(0.036, w * 0.02, d * 0.04);
        shape.moveTo(-hw + r, -hd);
        shape.lineTo(hw - r, -hd);
        shape.quadraticCurveTo(hw, -hd, hw, -hd + r);
        shape.lineTo(hw, hd - r);
        shape.quadraticCurveTo(hw, hd, hw - r, hd);
        shape.lineTo(-hw + r, hd);
        shape.quadraticCurveTo(-hw, hd, -hw, hd - r);
        shape.lineTo(-hw, -hd + r);
        shape.quadraticCurveTo(-hw, -hd, -hw + r, -hd);
      } else {
        const r = isDeck ? Math.min(0.18, w * 0.085, d * 0.22) : Math.min(0.20, w * 0.095, d * 0.24);
        shape.moveTo(-hw + r, -hd);
        shape.lineTo(hw - r, -hd);
        shape.quadraticCurveTo(hw, -hd, hw, -hd + r);
        shape.lineTo(hw, hd - r);
        shape.quadraticCurveTo(hw, hd, hw - r, hd);
        shape.lineTo(-hw + r, hd);
        shape.quadraticCurveTo(-hw, hd, -hw, hd - r);
        shape.lineTo(-hw, -hd + r);
        shape.quadraticCurveTo(-hw, -hd, -hw + r, -hd);
      }
    }

    const customBevel = customWorldPts ? clamp(Number(customShape?.bevel ?? 0.018), 0.002, 0.04) : null;
    const bevel = customBevel !== null
      ? (isDeck ? Math.min(0.016, customBevel * 0.65) : customBevel)
      : isDeck
        ? ((shapeType === 'compact' || shapeType === 'stealth') ? 0.008 : 0.011)
        : ((shapeType === 'compact' || shapeType === 'stealth') ? 0.011 : 0.018);

    // Always bore smooth circular fan cutouts directly through both main shroud & deck!
    for (const hSpec of holesList) {
      const desiredR = (isDeck ? hSpec.deckHoleR : hSpec.mainHoleR) || (hSpec.r * 1.028 + bevel);
      let holeR = Math.min(desiredR, hw - Math.abs(hSpec.fx) - 0.01, hd - 0.012);
      if (customWorldPts) {
        if (!pointInPolygon(hSpec.fx, 0, customWorldPts)) continue;
        const edgeDist = distToPolygonEdges(hSpec.fx, 0, customWorldPts);
        holeR = Math.min(holeR, edgeDist - 0.018);
      }
      if (holeR > 0.06) {
        const hole = new THREE.Path();
        hole.absarc(hSpec.fx, 0, holeR, 0, Math.PI * 2, true);
        shape.holes.push(hole);
      }
    }

    // Optional rectangular flow-through radiator cutout window (used by Flow-Through Backplate)
    if (rectCutout && rectCutout.rw > 0.08 && rectCutout.rd > 0.08) {
      const cx = rectCutout.cx || 0;
      const rx = rectCutout.rw / 2;
      const rz = rectCutout.rd / 2;
      const rr = Math.min(0.05, rx * 0.25, rz * 0.25);
      if (cx + rx < hw - 0.04 && cx - rx > -hw + 0.04 && rz < hd - 0.04) {
        const win = new THREE.Path();
        win.moveTo(cx - rx + rr, -rz);
        win.lineTo(cx + rx - rr, -rz);
        win.quadraticCurveTo(cx + rx, -rz, cx + rx, -rz + rr);
        win.lineTo(cx + rx, rz - rr);
        win.quadraticCurveTo(cx + rx, rz, cx + rx - rr, rz);
        win.lineTo(cx - rx + rr, rz);
        win.quadraticCurveTo(cx - rx, rz, cx - rx, rz - rr);
        win.lineTo(cx - rx, -rz + rr);
        win.quadraticCurveTo(cx - rx, -rz, cx - rx + rr, -rz);
        const pts = win.getPoints(16).reverse();
        const cwWin = new THREE.Path(pts);
        shape.holes.push(cwWin);
      }
    }

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(0.025, h - bevel * 2),
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: fastMode ? 1 : (shapeType === 'angular' || customWorldPts ? 2 : 3),
      curveSegments: fastMode ? 20 : 40
    });
    geo.rotateX(-Math.PI / 2);
    geo.computeBoundingBox();
    const minY = geo.boundingBox.min.y;
    const maxY = geo.boundingBox.max.y;
    geo.translate(0, -(minY + maxY) / 2, 0);
    geo.computeVertexNormals();

    const pos = geo.attributes.position;
    const norm = geo.attributes.normal;
    const uvs = new Float32Array(pos.count * 2);
    const sw = Math.max(0.4, w + bevel * 2);
    const sd = Math.max(0.4, d + bevel * 2);
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
      const ny = Math.abs(norm.getY(i));
      const nx = Math.abs(norm.getX(i));
      if (ny > 0.5) {
        uvs[i * 2] = (px + sw / 2) / sw;
        uvs[i * 2 + 1] = 1 - (pz + sd / 2) / sd;
      } else if (nx > 0.55) {
        uvs[i * 2] = (pz + sd / 2) / sd;
        uvs[i * 2 + 1] = (py + h * 0.5) * 1.8 + 0.5;
      } else {
        uvs[i * 2] = (px + sw / 2) / sw;
        uvs[i * 2 + 1] = (py + h * 0.5) * 1.8 + 0.5;
      }
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    return geo;
  }

  function makeBodyMaterial(bodyType, primaryHex, darkenFactor = 1.0, finish = 'satin') {
    const baseCol = new THREE.Color(primaryHex || '#222733');
    if (darkenFactor !== 1.0) baseCol.multiplyScalar(darkenFactor);

    const isMatte = finish === 'matte';
    const isGloss = finish === 'gloss';

    if (bodyType === 'metallic') {
      const tex = getBrushedMetalTexture();
      return new THREE.MeshPhysicalMaterial({
        color: baseCol,
        map: tex,
        bumpMap: tex,
        bumpScale: 0.005,
        metalness: isMatte ? 0.72 : 0.88,
        roughness: isMatte ? 0.40 : isGloss ? 0.14 : 0.22,
        clearcoat: isMatte ? 0.08 : isGloss ? 0.78 : 0.30,
        clearcoatRoughness: isGloss ? 0.08 : 0.24,
        anisotropy: 0.72
      });
    }
    if (bodyType === 'carbon') {
      const { color, bump } = getCarbonTextures();
      const lum = baseCol.getHSL({ h: 0, s: 0, l: 0 }).l;
      const carbonTint = lum < 0.14
        ? baseCol.clone().lerp(new THREE.Color(0x282f3e), 0.35)
        : baseCol.clone();
      return new THREE.MeshPhysicalMaterial({
        color: carbonTint,
        map: color,
        bumpMap: bump,
        bumpScale: 0.0085,
        metalness: isGloss ? 0.28 : 0.20,
        roughness: isMatte ? 0.58 : isGloss ? 0.26 : 0.44,
        clearcoat: isMatte ? 0.06 : isGloss ? 0.68 : 0.26,
        clearcoatRoughness: isGloss ? 0.12 : 0.30
      });
    }
    return new THREE.MeshPhysicalMaterial({
      color: baseCol,
      bumpMap: getPlasticBumpTexture(),
      bumpScale: 0.0045,
      metalness: isGloss ? 0.20 : 0.14,
      roughness: isMatte ? 0.62 : isGloss ? 0.18 : 0.44,
      clearcoat: isMatte ? 0.04 : isGloss ? 0.72 : 0.18,
      clearcoatRoughness: isGloss ? 0.10 : 0.36
    });
  }

  function makeBox(parent, w, h, d, material, x = 0, y = 0, z = 0) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = !isSoftwareGl;
    mesh.receiveShadow = !isSoftwareGl;
    parent.add(mesh);
    return mesh;
  }

  function getUnitBladeGeo(isCurved) {
    const key = isCurved ? 'bladeCurved' : 'bladeStd';
    if (proceduralGeo[key]) return proceduralGeo[key];
    const bladeLen = 0.70;
    const bladeWid = isCurved ? 0.22 : 0.25;
    const bShape = new THREE.Shape();
    bShape.moveTo(0, -bladeWid * 0.3);
    bShape.quadraticCurveTo(bladeLen * 0.5, -bladeWid * (isCurved ? 0.68 : 0.48), bladeLen, -bladeWid * 0.16);
    bShape.lineTo(bladeLen * 0.98, bladeWid * 0.34);
    bShape.quadraticCurveTo(bladeLen * 0.44, bladeWid * 0.48, 0, bladeWid * 0.28);
    bShape.closePath();
    const geo = new THREE.ExtrudeGeometry(bShape, {
      depth: 0.008,
      bevelEnabled: true,
      bevelSize: 0.0018,
      bevelThickness: 0.0018,
      bevelSegments: 1,
      curveSegments: 6
    });
    geo.rotateX(Math.PI / 2);
    sharedAssets.add(geo);
    proceduralGeo[key] = geo;
    return geo;
  }

  function getSharedFanHitGeo() {
    if (proceduralGeo.fanHit) return proceduralGeo.fanHit;
    const geo = new THREE.CylinderGeometry(1.02, 1.02, 1, 14);
    sharedAssets.add(geo);
    proceduralGeo.fanHit = geo;
    return geo;
  }

  function getSharedHitMaterial() {
    if (proceduralGeo.hitMat) return proceduralGeo.hitMat;
    const mat = new THREE.MeshBasicMaterial({ visible: false });
    sharedAssets.add(mat);
    proceduralGeo.hitMat = mat;
    return mat;
  }

  function buildFanInCutout(layout, index, yBoreCenter, boreDepth, accentMat, primaryHex) {
    const fGroup = new THREE.Group();
    fGroup.position.set(layout.fx, yBoreCenter, 0);
    fGroup.userData.elementId = layout.id;

    const r = layout.r;
    const type = layout.fanType || 'basic';
    const isSmall = type === 'gpu_small_fans';
    const isMedium = type === 'gpu_medium_fans';
    const isSmart = type === 'gpu_smart_fans';
    const rgbHalo = !!layout.rgbRing;
    const bladeChoice = layout.bladeColor || 'dark';
    const hubChoice = layout.hubStyle || 'auto';

    // Precision CNC-chamfered thin metallic fan cowl ring (supports RGB ring glow!)
    const ringMat = new THREE.MeshPhysicalMaterial({
      color: (isSmart || rgbHalo) ? accentMat.color : isMedium ? 0xbec7d5 : isSmall ? 0x8691a2 : 0x454d5e,
      metalness: isSmart || isMedium ? 0.9 : 0.48,
      roughness: isSmart || isMedium ? 0.2 : 0.36,
      clearcoat: 0.3,
      emissive: (isSmart || rgbHalo) ? accentMat.color : new THREE.Color(0x000000),
      emissiveIntensity: rgbHalo ? 1.15 : (isSmart ? 0.28 : 0)
    });

    const cowlPts = [
      new THREE.Vector2(r * 0.985, boreDepth * 0.42),
      new THREE.Vector2(r * 0.995, boreDepth * 0.515),
      new THREE.Vector2(r * 1.032, boreDepth * 0.518),
      new THREE.Vector2(r * 1.045, boreDepth * 0.49),
      new THREE.Vector2(r * 1.028, boreDepth * 0.44)
    ];
    const cowlGeo = new THREE.LatheGeometry(cowlPts, 40);
    fGroup.add(new THREE.Mesh(cowlGeo, ringMat));

    const sleeveCol = new THREE.Color(primaryHex || '#141822').multiplyScalar(0.45);
    const sleeveMat = new THREE.MeshStandardMaterial({
      color: sleeveCol,
      metalness: 0.45,
      roughness: 0.4,
      side: THREE.DoubleSide
    });
    const sleeve = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 1.025, r * 1.025, boreDepth * 1.01, 40, 1, true),
      sleeveMat
    );
    fGroup.add(sleeve);

    for (let s = 0; s < 3; s++) {
      const armPivot = new THREE.Group();
      armPivot.rotation.y = (s * Math.PI * 2) / 3 + 0.35;
      const strut = new THREE.Mesh(new THREE.BoxGeometry(r * 0.96, 0.009, 0.014), sleeveMat);
      strut.position.set(r * 0.48, -boreDepth * 0.3, 0);
      armPivot.add(strut);
      fGroup.add(armPivot);
    }

    const rotor = new THREE.Group();
    rotor.position.y = boreDepth * 0.14;
    fGroup.add(rotor);

    const bladeCount = isSmart ? 13 : isMedium ? 11 : isSmall ? 9 : 7;
    const bladePitch = isSmart ? 0.46 : isMedium ? 0.42 : 0.36;
    const bladeHex = bladeChoice === 'white'
      ? 0xe2e8f0
      : bladeChoice === 'silver'
        ? 0x9aa4b5
        : bladeChoice === 'graphite'
          ? 0x3b4456
          : bladeChoice === 'accent'
            ? accentMat.color
            : (isSmart ? 0x262d3d : isMedium ? 0x1e2432 : isSmall ? 0x181c26 : 0x141720);
    const bladeMat = new THREE.MeshPhysicalMaterial({
      color: bladeHex,
      metalness: bladeChoice === 'silver' ? 0.82 : isSmart ? 0.48 : 0.26,
      roughness: bladeChoice === 'white' ? 0.28 : isSmart ? 0.24 : 0.32,
      clearcoat: 0.58,
      clearcoatRoughness: 0.2
    });

    const unitBladeGeo = getUnitBladeGeo(isMedium || isSmart);
    for (let i = 0; i < bladeCount; i++) {
      const pivot = new THREE.Group();
      pivot.rotation.y = (i / bladeCount) * Math.PI * 2;
      const blade = new THREE.Mesh(unitBladeGeo, bladeMat);
      blade.scale.set(r, 1, r);
      blade.position.set(r * 0.23, 0, 0);
      blade.rotation.x = bladePitch;
      if (isMedium || isSmart) blade.rotation.z = 0.08;
      pivot.add(blade);
      rotor.add(pivot);
    }

    if (isSmart || isMedium) {
      rotor.add(new THREE.Mesh(
        new THREE.CylinderGeometry(r * 0.945, r * 0.945, 0.018, 36, 1, true),
        bladeMat
      ));
    }

    const hubCol = hubChoice === 'chrome'
      ? 0xd8e0eb
      : hubChoice === 'gold'
        ? 0xe2bc5e
        : hubChoice === 'dark'
          ? 0x1c212c
          : hubChoice === 'accent'
            ? accentMat.color
            : ((isSmart || isMedium) ? 0xcfd7e3 : 0x2f3646);
    const hubMat = new THREE.MeshPhysicalMaterial({
      color: hubCol,
      metalness: (hubChoice === 'chrome' || hubChoice === 'gold' || (hubChoice === 'auto' && (isSmart || isMedium))) ? 0.92 : 0.55,
      roughness: 0.20,
      clearcoat: 0.35,
      anisotropy: 0.7
    });
    const hubPts = [
      new THREE.Vector2(0, 0.022),
      new THREE.Vector2(r * 0.18, 0.022),
      new THREE.Vector2(r * 0.24, 0.015),
      new THREE.Vector2(r * 0.255, -0.018),
      new THREE.Vector2(0, -0.018)
    ];
    rotor.add(new THREE.Mesh(new THREE.LatheGeometry(hubPts, 28), hubMat));

    const centerRing = new THREE.Mesh(
      new THREE.RingGeometry(r * 0.125, r * 0.165, 28),
      ringMat
    );
    centerRing.rotation.x = -Math.PI / 2;
    centerRing.position.y = 0.0235;
    rotor.add(centerRing);

    const hitMesh = new THREE.Mesh(getSharedFanHitGeo(), getSharedHitMaterial());
    hitMesh.scale.set(r, Math.max(0.14, boreDepth * 1.6), r);
    hitMesh.userData.dragId = layout.id;
    hitMesh.userData.dragKind = 'fan';
    fGroup.add(hitMesh);

    fansGroup.add(fGroup);
    fanAssemblies.push({
      id: layout.id,
      index,
      group: fGroup,
      rotor,
      hitMesh,
      ringMat,
      yTop: yBoreCenter + boreDepth * 0.5,
      baseEmissive: rgbHalo ? 1.15 : (isSmart ? 0.28 : 0),
      speed: isSmart ? 3.4 : isMedium ? 2.6 : isSmall ? 2.9 : 2.1
    });
  }

  function mountSingleDecalMesh(el, placement, bounds, tex, planeW, planeH, isText, colorHex, glowText = false) {
    const pos = clamp(Number(el.position ?? 0.5), 0.12, 0.88);
    const zPos = clamp(Number(el.zPosition ?? (placement === 'top' ? 0.88 : 0.5)), 0.08, 0.92);
    const xCoord = -bounds.w / 2 + bounds.w * pos;
    const zAcross = (-bounds.d / 2 + bounds.d * zPos) * 0.78;
    const zAlongEnd = (-bounds.d / 2 + bounds.d * pos) * 0.68;

    const g = new THREE.Group();
    const col = new THREE.Color(colorHex || '#ffffff');
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      transparent: true,
      alphaTest: 0.04,
      roughness: 0.24,
      metalness: 0.2,
      emissive: isText ? col : new THREE.Color(0x000000),
      emissiveMap: isText ? tex : null,
      emissiveIntensity: isText ? (glowText ? 1.35 : 0.35) : 0,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3
    });

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(planeW, planeH), mat);
    mesh.renderOrder = 3;

    let dragPlaneAxis = 'y';
    let dragPlaneConst = 0;

    if (placement === 'top') {
      g.position.set(xCoord, bounds.deckTopY + 0.015, zAcross);
      mesh.rotation.x = -Math.PI / 2;
      dragPlaneAxis = 'y';
      dragPlaneConst = g.position.y;
    } else if (placement === 'back') {
      g.position.set(xCoord, bounds.backBottomY - 0.015, (-bounds.d / 2 + bounds.d * clamp(Number(el.zPosition ?? 0.5), 0.12, 0.88)) * 0.72);
      mesh.rotation.x = Math.PI / 2;
      dragPlaneAxis = 'y';
      dragPlaneConst = g.position.y;
    } else if (placement === 'opposite' || placement === 'front') {
      g.position.set(xCoord, bounds.shroudMidY, bounds.frontZ + 0.016);
      dragPlaneAxis = 'z';
      dragPlaneConst = g.position.z;
    } else if (placement === 'right') {
      const endW = Math.min(planeW, bounds.d * 0.78);
      const endH = endW * (planeH / planeW);
      mesh.geometry.dispose();
      mesh.geometry = new THREE.PlaneGeometry(endW, endH);
      g.position.set(bounds.rightX + 0.016, bounds.shroudMidY, zAlongEnd);
      mesh.rotation.y = Math.PI / 2;
      dragPlaneAxis = 'x';
      dragPlaneConst = g.position.x;
    } else if (placement === 'left') {
      const endW = Math.min(planeW, bounds.d * 0.72);
      const endH = endW * (planeH / planeW);
      mesh.geometry.dispose();
      mesh.geometry = new THREE.PlaneGeometry(endW, endH);
      g.position.set(bounds.leftX - 0.016, bounds.shroudMidY - 0.02, zAlongEnd);
      mesh.rotation.y = -Math.PI / 2;
      dragPlaneAxis = 'x';
      dragPlaneConst = g.position.x;
    } else {
      g.position.set(xCoord, bounds.shroudMidY, bounds.backZ - 0.016);
      mesh.rotation.y = Math.PI;
      dragPlaneAxis = 'z';
      dragPlaneConst = g.position.z;
    }

    g.add(mesh);

    const hitW = (placement === 'right' || placement === 'left') ? 0.14 : planeW * 1.15;
    const hitH = (placement === 'top' || placement === 'back') ? 0.16 : Math.max(0.14, planeH * 1.5);
    const hitD = (placement === 'right' || placement === 'left') ? planeW * 1.15 : (placement === 'top' || placement === 'back') ? planeH * 1.5 : 0.16;
    const hitMesh = new THREE.Mesh(getSharedHitBoxGeo(), getSharedHitMaterial());
    hitMesh.scale.set(hitW, hitH, hitD);
    hitMesh.userData.dragId = el.id;
    hitMesh.userData.dragKind = 'decal';
    g.add(hitMesh);

    elementsGroup.add(g);
    draggableDecals.push({
      id: el.id,
      placement,
      group: g,
      hitMesh,
      dragPlaneAxis,
      dragPlaneConst
    });
  }

  function getSharedHitBoxGeo() {
    if (proceduralGeo.hitBox) return proceduralGeo.hitBox;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    sharedAssets.add(geo);
    proceduralGeo.hitBox = geo;
    return geo;
  }

  function buildPlacedDecalsAndStrips(bounds, accentHex) {
    rainbowRgbMats = [];
    const elements = Array.isArray(config.elements) ? config.elements : [];

    for (const el of elements) {
      if (el.kind === 'text') {
        const scale = clamp(Number(el.size ?? 1.0), 0.55, 1.6);
        const placement = el.placement || 'side';
        const isEdge = placement === 'side' || placement === 'rear' || placement === 'opposite' || placement === 'front' || placement === 'both_sides' || placement === 'right' || placement === 'left';
        const planeH = isEdge ? clamp(bounds.outerShroudH * 0.85 * scale, 0.09, bounds.outerShroudH * 1.1) : Math.min(bounds.d * 0.28 * scale, 0.32);
        const planeW = Math.min(bounds.w * 0.72, planeH * 3.85);
        const tex = getTextDecalTexture(el.text || 'GPU', el.color || '#ffffff');
        const glow = !!el.glow;

        if (placement === 'both_sides') {
          mountSingleDecalMesh(el, 'side', bounds, tex, planeW, planeH, true, el.color, glow);
          mountSingleDecalMesh(el, 'opposite', bounds, tex, planeW, planeH, true, el.color, glow);
        } else {
          mountSingleDecalMesh(el, placement, bounds, tex, planeW, planeH, true, el.color, glow);
        }
      } else if (el.kind === 'logo') {
        const scale = clamp(Number(el.size ?? 1.0), 0.5, 1.6);
        const placement = el.placement || 'back';
        const isEdge = placement === 'side' || placement === 'rear' || placement === 'opposite' || placement === 'front' || placement === 'both_sides' || placement === 'right' || placement === 'left';
        const sz = isEdge ? clamp(bounds.outerShroudH * 0.92 * scale, 0.1, bounds.outerShroudH * 1.15) : Math.min(bounds.d * 0.52, 0.38) * scale;
        const tex = getLogoDecalTexture(el.logoUrl || '', accentHex);

        if (placement === 'both_sides') {
          mountSingleDecalMesh(el, 'side', bounds, tex, sz, sz, false);
          mountSingleDecalMesh(el, 'opposite', bounds, tex, sz, sz, false);
        } else {
          mountSingleDecalMesh(el, placement, bounds, tex, sz, sz, false);
        }
      } else if (el.kind === 'accent_bar') {
        const scale = clamp(Number(el.size ?? 1.0), 0.4, 2.0);
        const placement = el.placement || 'top';
        const pos = clamp(Number(el.position ?? 0.5), 0.12, 0.88);
        const zPos = clamp(Number(el.zPosition ?? 0.86), 0.08, 0.92);
        const xCoord = -bounds.w / 2 + bounds.w * pos;
        const zAcross = (-bounds.d / 2 + bounds.d * zPos) * 0.78;
        const barW = Math.min(bounds.w * 0.75, 0.52 * scale);
        const barMat = new THREE.MeshPhysicalMaterial({
          color: new THREE.Color(el.color || accentHex || '#a855f7'),
          metalness: 0.78,
          roughness: 0.22,
          clearcoat: 0.45
        });
        const g = new THREE.Group();
        let dragPlaneAxis = 'y', dragPlaneConst = 0;
        if (placement === 'side' || placement === 'rear') {
          makeBox(g, barW, Math.max(0.02, bounds.outerShroudH * 0.22), 0.018, barMat, 0, 0, 0);
          g.position.set(xCoord, bounds.shroudMidY, bounds.backZ - 0.012);
          dragPlaneAxis = 'z'; dragPlaneConst = g.position.z;
        } else if (placement === 'back') {
          makeBox(g, barW, 0.014, 0.042, barMat, 0, 0, 0);
          g.position.set(xCoord, bounds.backBottomY - 0.01, zAcross);
          dragPlaneAxis = 'y'; dragPlaneConst = g.position.y;
        } else {
          makeBox(g, barW, 0.015, 0.046, barMat, 0, 0, 0);
          g.position.set(xCoord, bounds.deckTopY + 0.008, zAcross);
          dragPlaneAxis = 'y'; dragPlaneConst = g.position.y;
        }
        const hitMesh = new THREE.Mesh(getSharedHitBoxGeo(), getSharedHitMaterial());
        hitMesh.scale.set(barW * 1.15, 0.14, 0.16);
        hitMesh.userData.dragId = el.id;
        hitMesh.userData.dragKind = 'decal';
        g.add(hitMesh);
        elementsGroup.add(g);
        draggableDecals.push({ id: el.id, placement, group: g, hitMesh, dragPlaneAxis, dragPlaneConst });
      } else if (el.kind === 'vent_grille') {
        const scale = clamp(Number(el.size ?? 1.0), 0.5, 1.8);
        const placement = el.placement || 'top';
        const pos = clamp(Number(el.position ?? 0.5), 0.12, 0.88);
        const zPos = clamp(Number(el.zPosition ?? 0.86), 0.08, 0.92);
        const xCoord = -bounds.w / 2 + bounds.w * pos;
        const zAcross = (-bounds.d / 2 + bounds.d * zPos) * 0.78;
        const gw = Math.min(bounds.w * 0.55, 0.36 * scale);
        const gd = Math.min(bounds.d * 0.42, 0.16 * scale);
        const frameMat = new THREE.MeshPhysicalMaterial({ color: 0x1a1f2b, metalness: 0.72, roughness: 0.32 });
        const slotMat = new THREE.MeshStandardMaterial({ color: 0x090b10, metalness: 0.25, roughness: 0.75 });
        const g = new THREE.Group();
        makeBox(g, gw, 0.012, gd, frameMat, 0, 0, 0);
        const slats = 6;
        for (let s = 0; s < slats; s++) {
          const sx = -gw * 0.38 + (s / (slats - 1)) * gw * 0.76;
          makeBox(g, gw * 0.07, 0.016, gd * 0.76, slotMat, sx, 0.002, 0);
        }
        let dragPlaneAxis = 'y', dragPlaneConst = 0;
        if (placement === 'back') {
          g.position.set(xCoord, bounds.backBottomY - 0.009, zAcross);
          dragPlaneAxis = 'y'; dragPlaneConst = g.position.y;
        } else if (placement === 'side' || placement === 'rear') {
          g.rotation.x = Math.PI / 2;
          g.position.set(xCoord, bounds.shroudMidY, bounds.backZ - 0.010);
          dragPlaneAxis = 'z'; dragPlaneConst = g.position.z;
        } else {
          g.position.set(xCoord, bounds.deckTopY + 0.006, zAcross);
          dragPlaneAxis = 'y'; dragPlaneConst = g.position.y;
        }
        const hitMesh = new THREE.Mesh(getSharedHitBoxGeo(), getSharedHitMaterial());
        hitMesh.scale.set(gw * 1.15, 0.14, Math.max(0.16, gd * 1.3));
        hitMesh.userData.dragId = el.id;
        hitMesh.userData.dragKind = 'decal';
        g.add(hitMesh);
        elementsGroup.add(g);
        draggableDecals.push({ id: el.id, placement, group: g, hitMesh, dragPlaneAxis, dragPlaneConst });
      } else if (el.kind === 'rgb_strip') {
        const isRainbow = el.colorMode === 'rainbow' || el.color === 'rainbow' || !!el.rainbow;
        const mode = el.placement || 'side';
        const col = new THREE.Color(isRainbow ? '#a855f7' : (el.color || accentHex || '#a855f7'));
        const makeRgbMat = (offset = 0) => {
          const startCol = isRainbow ? new THREE.Color().setHSL((rainbowPhase + offset) % 1, 0.95, 0.54) : col;
          const m = new THREE.MeshStandardMaterial({
            color: startCol,
            emissive: startCol.clone(),
            emissiveIntensity: 1.75,
            roughness: 0.18,
            metalness: 0.1
          });
          if (isRainbow) rainbowRgbMats.push({ mat: m, offset });
          return m;
        };

        const addSegmentedRail = (spanW, hBar, dBar, yPos, zPos) => {
          if (!isRainbow) {
            makeBox(elementsGroup, spanW, hBar, dBar, makeRgbMat(0), 0, yPos, zPos);
            return;
          }
          const segs = 14;
          const segW = spanW / segs;
          for (let i = 0; i < segs; i++) {
            const xPos = -spanW / 2 + segW * (i + 0.5);
            makeBox(elementsGroup, segW + 0.002, hBar, dBar, makeRgbMat(i / segs), xPos, yPos, zPos);
          }
        };

        if (mode === 'top' || mode === 'halo') {
          addSegmentedRail(bounds.w * 0.84, 0.018, 0.018, bounds.deckTopY + 0.008, bounds.d * 0.43);
          addSegmentedRail(bounds.w * 0.84, 0.018, 0.018, bounds.deckTopY + 0.008, -bounds.d * 0.43);
        }
        if (mode === 'side' || mode === 'halo') {
          addSegmentedRail(bounds.w * 0.86, 0.02, 0.018, bounds.shroudMidY + bounds.outerShroudH * 0.25, bounds.frontZ + 0.006);
          addSegmentedRail(bounds.w * 0.86, 0.02, 0.018, bounds.shroudMidY + bounds.outerShroudH * 0.25, bounds.backZ - 0.006);
        }
        if (mode === 'slash') {
          for (let s = 0; s < 3; s++) {
            const bar = makeBox(elementsGroup, 0.022, 0.016, bounds.d * 0.22, makeRgbMat(s * 0.22), bounds.w * 0.31 + s * 0.065, bounds.deckTopY + 0.008, -bounds.d * 0.30);
            bar.rotation.y = 0.46;
          }
        }
      }
    }
  }

  // ---------- Red & Blue 3D Size Arrows ----------
  function buildArrowMesh(colorHex, axis, sign) {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: colorHex,
      emissive: colorHex,
      emissiveIntensity: 0.68,
      roughness: 0.25,
      metalness: 0.3
    });

    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.24, 16), mat);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.068, 0.16, 20), mat);
    head.position.y = 0.18;

    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.012, 10, 24), mat);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = -0.1;

    const arrowGeoGroup = new THREE.Group();
    arrowGeoGroup.add(shaft, head, collar);

    // Cylinder/cone point +Y by default; rotate to point along +X/-X (Red) or +Z/-Z (Blue)
    if (axis === 'x') {
      arrowGeoGroup.rotation.z = sign > 0 ? -Math.PI / 2 : Math.PI / 2;
    } else {
      arrowGeoGroup.rotation.x = sign > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
    group.add(arrowGeoGroup);

    // Oversized invisible hit box for effortless dragging
    const hitMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 12, 12),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hitMesh.userData.dragKind = 'size';
    hitMesh.userData.axis = axis;
    hitMesh.userData.sign = sign;
    group.add(hitMesh);

    return { group, hitMesh, mat };
  }

  function buildSizeGizmos(w, d) {
    if (!sizeGizmoGroup) return;
    disposeGroupContents(sizeGizmoGroup);
    sizeArrowHandles = [];
    sizeGizmoGroup.visible = sizeMode;
    if (!sizeMode) return;

    const yLevel = 0.04;
    const offset = 0.26;

    // Red Arrows (Length along X axis)
    for (const sign of [-1, 1]) {
      const a = buildArrowMesh(0xef4444, 'x', sign);
      a.group.position.set(sign * (w / 2 + offset), yLevel, 0);
      sizeGizmoGroup.add(a.group);
      sizeArrowHandles.push({ axis: 'x', sign, hitMesh: a.hitMesh, mat: a.mat, baseColor: 0xef4444 });
    }

    // Blue Arrows (Width along Z axis)
    for (const sign of [-1, 1]) {
      const a = buildArrowMesh(0x3b82f6, 'z', sign);
      a.group.position.set(0, yLevel, sign * (d / 2 + offset));
      sizeGizmoGroup.add(a.group);
      sizeArrowHandles.push({ axis: 'z', sign, hitMesh: a.hitMesh, mat: a.mat, baseColor: 0x3b82f6 });
    }

    // Subtle wireframe outline guide around card footprint
    const outlineGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(w + 0.06, 0.34, d + 0.06));
    const outline = new THREE.LineSegments(
      outlineGeo,
      new THREE.LineBasicMaterial({ color: 0xc084fc, transparent: true, opacity: 0.45 })
    );
    outline.position.y = 0.02;
    sizeGizmoGroup.add(outline);
  }

  function disposeGroupContents(group) {
    if (!group) return;
    while (group.children.length) {
      const child = group.children.pop();
      child.traverse?.(obj => {
        if (obj.geometry && !sharedAssets.has(obj.geometry) && typeof obj.geometry.dispose === 'function') {
          obj.geometry.dispose();
        }
        if (Array.isArray(obj.material)) {
          obj.material.forEach(m => { if (m && !sharedAssets.has(m)) m.dispose?.(); });
        } else if (obj.material && !sharedAssets.has(obj.material) && typeof obj.material.dispose === 'function') {
          obj.material.dispose();
        }
      });
    }
  }

  function buildModel(fastMode = false) {
    if (!THREE || !gpuRoot) return;

    const safeLength = clamp(Math.round(Number(config.length) || 300), GPU_MIN_LEN, GPU_MAX_LEN);
    const safeWidth = clampWidthForLength(config.width, safeLength);
    config.length = safeLength;
    config.width = safeWidth;

    const lenScale = safeLength / 300;
    const widScale = safeWidth / 125;
    const safeThickMm = clamp(Math.round(Number(config.thickness) || 52), 38, 76);
    config.thickness = safeThickMm;
    const thickScale = clamp(safeThickMm / 52, 0.72, 1.48);

    const w = 2.85 * lenScale;
    const d = 1.18 * widScale;
    const h = 0.25 * thickScale;

    const bodyType = config.body || 'plastic';
    const customShapeCfg = bodyType === 'custom'
      ? {
          points: Array.isArray(config.customShape?.points) && config.customShape.points.length >= 3
            ? config.customShape.points
            : DEFAULT_CUSTOM_POINTS,
          extrudeDepth: clamp(Number(config.customShape?.extrudeDepth ?? 1.0), 0.55, 1.75),
          bevel: clamp(Number(config.customShape?.bevel ?? 0.018), 0.002, 0.04),
          material: config.customShape?.material || 'plastic'
        }
      : null;
    const renderMaterialBody = bodyType === 'custom'
      ? (customShapeCfg.material === 'metallic' || customShapeCfg.material === 'carbon' ? customShapeCfg.material : 'plastic')
      : bodyType;
    const finishType = config.finish || 'satin';
    const shapeType = config.shroud || 'rounded';
    const primaryColor = config.primaryColor || '#222733';
    const accentColor = config.accentColor || '#a855f7';
    const backplateStyle = config.backplate === false ? 'off' : (config.backplateStyle || 'flow_through');
    const finStyle = config.finStyle || 'silver';
    const pipeStyle = config.pipeStyle || 'copper';
    const powerType = config.powerType || '12v2x6';
    const ioStyle = config.ioStyle || 'steel';

    const fanElements = (config.elements || []).filter(e => e.kind === 'fan').slice(0, 6);
    const fanLayouts = computeSafeFanLayouts(fanElements, w, d, shapeType);

    const outerShroudH = h * 0.62 * (customShapeCfg ? customShapeCfg.extrudeDepth : 1.0);
    const mainShroudY = h * 0.26 + (customShapeCfg ? (outerShroudH - h * 0.62) * 0.35 : 0);
    const deckH = 0.034;
    const deckY = mainShroudY + outerShroudH * 0.44;
    const boreCenterY = mainShroudY + 0.02;
    const boreDepth = outerShroudH + 0.02;

    const customSig = customShapeCfg ? JSON.stringify(customShapeCfg) : '';
    const structSig = `${safeLength}|${safeWidth}|${safeThickMm}|${bodyType}|${renderMaterialBody}|${finishType}|${shapeType}|${primaryColor}|${accentColor}|${backplateStyle}|${finStyle}|${pipeStyle}|${powerType}|${ioStyle}|${customSig}`;
    const shroudSig = `${safeLength}|${safeWidth}|${safeThickMm}|${bodyType}|${renderMaterialBody}|${finishType}|${shapeType}|${primaryColor}|${accentColor}|${fastMode ? 1 : 0}|${customSig}|` +
      fanLayouts.map(l => `${l.fx.toFixed(4)}:${l.r.toFixed(4)}`).join(',');
    const fanGeomSig = `${safeLength}|${safeWidth}|${safeThickMm}|${renderMaterialBody}|${primaryColor}|${accentColor}|` +
      fanLayouts.map(l => `${l.id}:${l.fanType}:${l.bladeColor}:${l.hubStyle}:${l.rgbRing ? 1 : 0}:${l.r.toFixed(4)}`).join('|');
    const nonFanElements = (config.elements || []).filter(e => e.kind !== 'fan');
    const decalsSig = `${structSig}|` + JSON.stringify(nonFanElements);
    const gizmoSig = `${safeLength}|${safeWidth}|${sizeMode ? 1 : 0}`;

    const accentMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(accentColor),
      metalness: renderMaterialBody === 'metallic' ? 0.78 : 0.44,
      roughness: 0.22,
      clearcoat: 0.45
    });
    const trimMetal = new THREE.MeshPhysicalMaterial({ color: 0xc2cbd6, metalness: 0.92, roughness: 0.2, anisotropy: 0.72 });
    const darkMat = new THREE.MeshPhysicalMaterial({ color: 0x11151e, metalness: 0.55, roughness: 0.36, clearcoat: 0.15 });
    const dummy = new THREE.Object3D();

    // ---- 1-3. Static Structural Hardware (Backplate + PCB + Heatsink) ----
    if (structSig !== lastStructSig) {
      lastStructSig = structSig;
      disposeGroupContents(backplateLayer);
      disposeGroupContents(pcbLayer);
      disposeGroupContents(heatsinkLayer);

      const goldMat = new THREE.MeshStandardMaterial({ color: 0xe2bc5e, metalness: 0.94, roughness: 0.18 });
      const copperMat = new THREE.MeshPhysicalMaterial({ color: 0xd47a45, metalness: 0.95, roughness: 0.18, anisotropy: 0.55 });
      const pipeColor = pipeStyle === 'nickel' ? 0xcfd7e4 : pipeStyle === 'black' ? 0x1d222e : 0xd47a45;
      const pipeMat = new THREE.MeshPhysicalMaterial({ color: pipeColor, metalness: pipeStyle === 'black' ? 0.75 : 0.95, roughness: pipeStyle === 'black' ? 0.32 : 0.17, clearcoat: 0.25 });
      const finColor = finStyle === 'black' ? 0x1e2430 : finStyle === 'copper' ? 0xd47a45 : 0xc8d2df;
      const finMat = new THREE.MeshPhysicalMaterial({ color: finColor, metalness: 0.90, roughness: finStyle === 'black' ? 0.34 : 0.24, anisotropy: 0.72 });
      const ioBracketMat = ioStyle === 'black'
        ? new THREE.MeshPhysicalMaterial({ color: 0x1a1e28, metalness: 0.85, roughness: 0.28, anisotropy: 0.5 })
        : trimMetal;
      const pcbMat = new THREE.MeshPhysicalMaterial({ map: getPcbTexture(), metalness: 0.2, roughness: 0.48, clearcoat: 0.14 });

      let backBottomY = -h * 0.42 - 0.02;
      if (backplateStyle !== 'off') {
        const bpMat = makeBodyMaterial(renderMaterialBody, primaryColor, 0.92, finishType);
        const flowCutout = backplateStyle === 'flow_through'
          ? { cx: w * 0.26, rw: w * 0.27, rd: d * 0.62 }
          : null;
        const bpGeo = createShroudGeometryWithHoles(
          w * 0.96, 0.032, d * 0.95,
          shapeType === 'angular' || shapeType === 'founders' || shapeType === 'triple' ? 'angular' : 'compact',
          [], false, false, flowCutout, customShapeCfg
        );
        const bp = new THREE.Mesh(bpGeo, bpMat);
        bp.position.y = -h * 0.62 - 0.058;
        bp.castShadow = !isSoftwareGl;
        bp.receiveShadow = !isSoftwareGl;
        backplateLayer.add(bp);
        bpGeo.computeBoundingBox();
        backBottomY = bp.position.y + bpGeo.boundingBox.min.y;

        const bpUndersideY = bp.position.y - 0.017;
        if (backplateStyle === 'louvered') {
          for (let i = 0; i < 11; i++) {
            const rib = makeBox(backplateLayer, 0.022, 0.01, d * 0.56, darkMat, -w * 0.02 + i * w * 0.04, bpUndersideY, 0);
            rib.rotation.y = 0.32;
          }
        } else if (backplateStyle === 'solid') {
          makeBox(backplateLayer, w * 0.72, 0.01, 0.018, trimMetal, 0, bpUndersideY, 0);
        } else {
          // Machined frame collar around flow-through exhaust cutout
          makeBox(backplateLayer, w * 0.29, 0.01, 0.018, accentMat, w * 0.26, bpUndersideY, d * 0.31);
          makeBox(backplateLayer, w * 0.29, 0.01, 0.018, accentMat, w * 0.26, bpUndersideY, -d * 0.31);
        }
        makeBox(backplateLayer, w * 0.58, 0.009, 0.016, accentMat, -w * 0.10, bpUndersideY, -d * 0.37);

        const xBrk1 = makeBox(backplateLayer, 0.32, 0.012, 0.036, trimMetal, -0.05, bpUndersideY - 0.003, 0);
        xBrk1.rotation.y = Math.PI / 4;
        const xBrk2 = makeBox(backplateLayer, 0.32, 0.012, 0.036, trimMetal, -0.05, bpUndersideY - 0.003, 0);
        xBrk2.rotation.y = -Math.PI / 4;
        for (const sx of [-w * 0.41, -0.17, 0.07, w * 0.41]) {
          for (const sz of [-d * 0.36, d * 0.36]) {
            const isBracket = (sx === -0.17 || sx === 0.07);
            if (isBracket && Math.abs(sz) > d * 0.25) continue;
            if (backplateStyle === 'flow_through' && sx > w * 0.12 && Math.abs(sz) < d * 0.34) continue;
            const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.012, 6), trimMetal);
            screw.position.set(sx, bpUndersideY - 0.002, sz);
            backplateLayer.add(screw);
          }
        }
      }

      // High-Density 12-Layer PCB + Iridescent Die + GDDR6X + VRM + Power Connectors + I/O
      makeBox(pcbLayer, w * 0.96, 0.032, d * 0.92, pcbMat, 0, -h * 0.42, 0);
      const dieX = -0.05;
      const dieY = -h * 0.42 + 0.022;
      makeBox(pcbLayer, 0.42, 0.016, 0.42, new THREE.MeshStandardMaterial({ color: 0x16322b, metalness: 0.3, roughness: 0.45 }), dieX, dieY, 0);
      makeBox(pcbLayer, 0.44, 0.01, 0.02, trimMetal, dieX, dieY + 0.005, -0.21);
      makeBox(pcbLayer, 0.44, 0.01, 0.02, trimMetal, dieX, dieY + 0.005, 0.21);
      const dieMat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        map: getSiliconDieTexture(),
        metalness: 0.62,
        roughness: 0.1,
        clearcoat: 1.0,
        clearcoatRoughness: 0.05,
        iridescence: 0.92,
        iridescenceIOR: 1.45,
        iridescenceThicknessRange: [140, 480]
      });
      makeBox(pcbLayer, 0.21, 0.018, 0.21, dieMat, dieX, dieY + 0.012, 0);

      const vramMat = new THREE.MeshPhysicalMaterial({ color: 0x191d26, metalness: 0.35, roughness: 0.34, clearcoat: 0.2 });
      const vramCoords = [
        [-0.31, -0.14], [-0.31, 0], [-0.31, 0.14],
        [-0.14, -0.29], [0, -0.29], [0.14, -0.29],
        [0.21, -0.14], [0.21, 0.14],
        [-0.14, 0.29], [0.04, 0.29]
      ];
      const vramMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.085, 0.016, 0.068), vramMat, vramCoords.length);
      vramCoords.forEach(([vx, vz], idx) => {
        dummy.position.set(dieX + vx, dieY + 0.004, vz);
        dummy.rotation.set(0, Math.abs(vx) > 0.2 ? Math.PI / 2 : 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        vramMesh.setMatrixAt(idx, dummy.matrix);
      });
      pcbLayer.add(vramMesh);

      const chokeCount = Math.max(8, Math.round(lenScale * 13));
      const chokeMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.046, 0.03, 0.046), new THREE.MeshStandardMaterial({ color: 0x262b38, metalness: 0.65, roughness: 0.32 }), chokeCount);
      const capMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.016, 0.016, 0.032, 12), trimMetal, chokeCount);
      for (let i = 0; i < chokeCount; i++) {
        const cx = -w * 0.36 + (i / (chokeCount - 1)) * w * 0.72;
        dummy.position.set(cx, -h * 0.42 + 0.028, -d * 0.32);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        chokeMesh.setMatrixAt(i, dummy.matrix);
        dummy.position.set(cx, -h * 0.42 + 0.028, -d * 0.39);
        dummy.updateMatrix();
        capMesh.setMatrixAt(i, dummy.matrix);
      }
      pcbLayer.add(chokeMesh, capMesh);

      const pcieMat = new THREE.MeshStandardMaterial({ map: getPcieFingersTexture(), metalness: 0.72, roughness: 0.25 });
      makeBox(pcbLayer, w * 0.44, 0.022, 0.088, pcieMat, -w * 0.13, -h * 0.42, d * 0.485);

      // Configurable Power Connectors (1x 8-Pin | 2x 8-Pin | 3x 8-Pin | 12V-2x6)
      const pwrZ = -d * 0.462;
      const pwrCount = powerType === '3x8pin' ? 3 : powerType === '2x8pin' ? 2 : 1;
      const sockW = powerType === '12v2x6' ? 0.20 : 0.145;
      const sockGap = 0.165;
      const pwrCenterX = powerType === '3x8pin' ? w * 0.15 : w * 0.21;
      const cavityMat = new THREE.MeshStandardMaterial({ color: 0x07090e, roughness: 0.7 });
      const cols = powerType === '12v2x6' ? 6 : 4;
      const pinMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.012, 0.012, 0.024), goldMat, pwrCount * cols * 2);
      let pi = 0;
      for (let s = 0; s < pwrCount; s++) {
        const sx = pwrCenterX + (s - (pwrCount - 1) / 2) * sockGap;
        makeBox(pcbLayer, sockW, 0.068, 0.085, darkMat, sx, -h * 0.42 + 0.032, pwrZ);
        makeBox(pcbLayer, sockW * 0.80, 0.044, 0.02, cavityMat, sx, -h * 0.42 + 0.034, pwrZ - 0.036);
        const stepX = (sockW * 0.65) / Math.max(1, cols - 1);
        for (let r = 0; r < 2; r++) {
          for (let c = 0; c < cols; c++) {
            dummy.position.set(sx - (sockW * 0.325) + c * stepX, -h * 0.42 + 0.026 + r * 0.018, pwrZ - 0.04);
            dummy.rotation.set(0, 0, 0);
            dummy.updateMatrix();
            pinMesh.setMatrixAt(pi++, dummy.matrix);
          }
        }
      }
      pcbLayer.add(pinMesh);

      const ioX = -w * 0.5 - 0.018;
      makeBox(pcbLayer, 0.026, h * 1.12, d * 0.94, ioBracketMat, ioX, 0, 0);
      makeBox(pcbLayer, 0.065, 0.028, d * 0.94, ioBracketMat, ioX + 0.01, -h * 0.55, 0);
      for (let v = 0; v < 5; v++) {
        makeBox(pcbLayer, 0.032, 0.016, d * 0.12, darkMat, ioX - 0.002, h * 0.28, -d * 0.34 + v * d * 0.17);
      }
      for (let i = 0; i < 4; i++) {
        const pz = -d * 0.3 + i * d * 0.2;
        makeBox(pcbLayer, 0.038, 0.042, 0.105, ioBracketMat, ioX - 0.012, -h * 0.1, pz);
        makeBox(pcbLayer, 0.042, 0.022, 0.082, darkMat, ioX - 0.015, -h * 0.1, pz);
      }

      // Heatsink Fins + Vapor Chamber + 5 Heatpipes
      const finCount = clamp(Math.round(w * 34), 48, 108);
      const finMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.006, h * 0.58, d * 0.85), finMat, finCount);
      for (let i = 0; i < finCount; i++) {
        dummy.position.set(-w * 0.455 + (i / (finCount - 1)) * w * 0.91, -h * 0.05, 0);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        finMesh.setMatrixAt(i, dummy.matrix);
      }
      finMesh.castShadow = !isSoftwareGl;
      heatsinkLayer.add(finMesh);

      makeBox(heatsinkLayer, w * 0.88, 0.022, 0.024, darkMat, 0, -h * 0.26, -d * 0.415);
      makeBox(heatsinkLayer, w * 0.88, 0.022, 0.024, darkMat, 0, -h * 0.26, d * 0.415);
      makeBox(heatsinkLayer, 0.44, 0.034, 0.42, copperMat, -0.05, -h * 0.32, 0);
      for (let i = 0; i < 5; i++) {
        const zOff = (-0.34 + i * 0.17) * d;
        const curve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(-w * 0.43, -h * 0.02, zOff * 0.84),
          new THREE.Vector3(-w * 0.14, -h * 0.2, zOff * 0.44),
          new THREE.Vector3(w * 0.14, -h * 0.12, zOff * 0.88),
          new THREE.Vector3(w * 0.44, -h * 0.01, zOff * 0.82)
        ]);
        heatsinkLayer.add(new THREE.Mesh(
          new THREE.TubeGeometry(curve, 24, 0.019, 12, false),
          pipeMat
        ));
      }

      const mainBevel = (shapeType === 'compact' || shapeType === 'stealth') ? 0.011 : 0.018;
      const deckBevel = (shapeType === 'compact' || shapeType === 'stealth') ? 0.008 : 0.011;
      cachedSurfaceBounds = {
        w,
        d,
        outerShroudH,
        shroudMidY: mainShroudY,
        frontZ: d * 0.5 + mainBevel,
        backZ: -d * 0.5 - mainBevel,
        rightX: w * 0.5 + mainBevel,
        leftX: -w * 0.5 - 0.045,
        deckTopY: deckY + deckH * 0.5 + deckBevel,
        backBottomY
      };
    }

    // ---- 4. Sculpted Multi-Piece Shroud + Guaranteed Through-Cutouts ----
    if (shroudSig !== lastShroudSig) {
      lastShroudSig = shroudSig;
      disposeGroupContents(shroudLayer);

      const shroudMat = makeBodyMaterial(renderMaterialBody, primaryColor, 1.0, finishType);
      const primaryLuminance = new THREE.Color(primaryColor).getHSL({ h: 0, s: 0, l: 0 }).l;
      const deckMat = makeBodyMaterial(renderMaterialBody, primaryColor, primaryLuminance > 0.45 ? 0.78 : 0.76, finishType);

      const mainShroudGeo = createShroudGeometryWithHoles(w, outerShroudH, d, shapeType, fanLayouts, fastMode, false, null, customShapeCfg);
      const mainShroud = new THREE.Mesh(mainShroudGeo, shroudMat);
      mainShroud.position.y = mainShroudY;
      mainShroud.castShadow = !isSoftwareGl;
      mainShroud.receiveShadow = !isSoftwareGl;
      shroudLayer.add(mainShroud);

      const deckGeo = createShroudGeometryWithHoles(w * DECK_W_RATIO, deckH, d * DECK_D_RATIO, shapeType, fanLayouts, fastMode, true, null, customShapeCfg);
      const deckMesh = new THREE.Mesh(deckGeo, deckMat);
      deckMesh.position.y = deckY;
      shroudLayer.add(deckMesh);

      for (const side of [-1, 1]) {
        makeBox(shroudLayer, w * 0.72, 0.014, 0.014, accentMat, 0, deckY + 0.012, side * d * 0.462);
      }

      // Signature shroud architecture trim per style
      if (shapeType === 'founders') {
        const railY = deckY + deckH * 0.5 + 0.008;
        makeBox(shroudLayer, w * 0.88, 0.012, 0.026, trimMetal, 0, railY, d * 0.415);
        makeBox(shroudLayer, w * 0.88, 0.012, 0.026, trimMetal, 0, railY, -d * 0.415);
        makeBox(shroudLayer, 0.028, 0.012, d * 0.84, trimMetal, w * 0.44, railY, 0);
        makeBox(shroudLayer, 0.028, 0.012, d * 0.84, trimMetal, -w * 0.44, railY, 0);
      } else if (shapeType === 'stealth') {
        makeBox(shroudLayer, w * 0.82, 0.008, 0.022, darkMat, 0, deckY + deckH * 0.5 + 0.005, -d * 0.40);
      } else if (shapeType === 'triple') {
        const brow1 = makeBox(shroudLayer, w * 0.24, 0.014, 0.022, accentMat, -w * 0.30, deckY + deckH * 0.5 + 0.008, d * 0.40);
        brow1.rotation.y = 0.2;
        const brow2 = makeBox(shroudLayer, w * 0.24, 0.014, 0.022, accentMat, w * 0.30, deckY + deckH * 0.5 + 0.008, -d * 0.40);
        brow2.rotation.y = 0.2;
      }

      const screwX = w * 0.44;
      const screwZ = d * 0.39;
      const screwTopY = deckY + deckH * 0.5 + 0.004;
      for (const sx of [-screwX, screwX]) {
        for (const sz of [-screwZ, screwZ]) {
          const hitsHole = fanLayouts.some(f => Math.hypot(sx - f.fx, sz) < f.r * 1.18);
          if (hitsHole) continue;
          const sHead = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.008, 6), trimMetal);
          sHead.position.set(sx, screwTopY, sz);
          shroudLayer.add(sHead);
        }
      }
    }

    // ---- 5. Recessed Machined Fans (Translate Existing Groups When Only X Moves!) ----
    if (fanGeomSig !== lastFanGeomSig) {
      lastFanGeomSig = fanGeomSig;
      disposeGroupContents(fansGroup);
      fanAssemblies = [];
      fanLayouts.forEach((layout, i) => buildFanInCutout(layout, i, boreCenterY, boreDepth, accentMat, primaryColor));
    } else {
      fanLayouts.forEach((layout, i) => {
        if (fanAssemblies[i]) {
          fanAssemblies[i].group.position.x = layout.fx;
          fanAssemblies[i].group.position.y = boreCenterY;
        }
      });
    }

    // ---- 6. Modular Placed Elements (Cached Separately From Fan Positions) ----
    if (decalsSig !== lastDecalsSig && cachedSurfaceBounds) {
      lastDecalsSig = decalsSig;
      disposeGroupContents(elementsGroup);
      draggableDecals = [];
      buildPlacedDecalsAndStrips(cachedSurfaceBounds, accentColor);
    }

    // ---- 7. Red & Blue Size Arrows ----
    if (gizmoSig !== lastGizmoSig) {
      lastGizmoSig = gizmoSig;
      buildSizeGizmos(w, d);
    }

    gpuRoot.userData.cardWidth = w;
    gpuRoot.userData.cardDepth = d;
    updateSizeHud();
  }

  // ---------- Stage Dock & Size HUD ----------
  function updateSizeHud() {
    if (!sizeHudEl) return;
    sizeHudEl.classList.toggle('hidden', !sizeMode);
    if (sizeMode) {
      sizeHudEl.innerHTML =
        '<span class="gpu-size-dot red"></span>Length <b>' + Math.round(config.length) + ' mm</b>' +
        ' · <span class="gpu-size-dot blue"></span>Width <b>' + Math.round(config.width) + ' mm</b>' +
        ' · Thickness <b>' + Math.round(config.thickness || 52) + ' mm</b>' +
        ' <small>(Drag Red or Blue arrows)</small>';
    }
  }

  function createDock() {
    if (!stageEl || dockEl) return;

    sizeHudEl = document.createElement('div');
    sizeHudEl.className = 'gpu-3d-size-hud hidden';
    stageEl.appendChild(sizeHudEl);

    dockEl = document.createElement('div');
    dockEl.className = 'gpu-3d-dock';
    dockEl.innerHTML =
      '<div class="gpu-3d-pills">' +
        '<button type="button" data-gpu-cam="hero" class="active">3/4 Hero</button>' +
        '<button type="button" data-gpu-cam="top">Top</button>' +
        '<button type="button" data-gpu-cam="side">Side</button>' +
        '<button type="button" data-gpu-cam="end">End</button>' +
        '<button type="button" data-gpu-cam="back">Backplate</button>' +
      '</div>' +
      '<div class="gpu-3d-actions">' +
        '<button type="button" data-gpu-act="size">Change Size</button>' +
        '<button type="button" data-gpu-act="spin">Spin</button>' +
        '<button type="button" data-gpu-act="explode">Explode</button>' +
      '</div>';
    stageEl.appendChild(dockEl);

    dockEl.querySelectorAll('[data-gpu-cam]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        dockEl.querySelectorAll('[data-gpu-cam]').forEach(b => b.classList.toggle('active', b === btn));
        setCameraPreset(btn.dataset.gpuCam);
      });
    });

    dockEl.querySelectorAll('[data-gpu-act]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const act = btn.dataset.gpuAct;
        if (act === 'spin') {
          autoSpin = !autoSpin;
          btn.classList.toggle('active', autoSpin);
        } else if (act === 'explode') {
          targetExplode = targetExplode > 0.5 ? 0 : 1;
          btn.classList.toggle('active', targetExplode > 0.5);
        } else if (act === 'size') {
          setSizeMode(!sizeMode);
        }
      });
    });
  }

  function setSizeMode(enabled) {
    sizeMode = !!enabled;
    dockEl?.querySelector('[data-gpu-act="size"]')?.classList.toggle('active', sizeMode);
    if (gpuRoot) {
      buildSizeGizmos(gpuRoot.userData.cardWidth || 2.85, gpuRoot.userData.cardDepth || 1.18);
    }
    updateSizeHud();
    callbacks.onSizeModeChange?.(sizeMode);
  }

  function setCameraPreset(preset) {
    camAnimActive = true;
    camTargetLook.x = 0; camTargetLook.y = 0.05; camTargetLook.z = 0;
    if (preset === 'top') {
      camTargetPos.x = 0.01; camTargetPos.y = 4.3; camTargetPos.z = 0.45;
    } else if (preset === 'side' || preset === 'rear') {
      camTargetPos.x = -0.08; camTargetPos.y = 0.35; camTargetPos.z = -4.15;
    } else if (preset === 'opposite') {
      camTargetPos.x = 0.08; camTargetPos.y = 0.35; camTargetPos.z = 4.15;
    } else if (preset === 'end') {
      camTargetPos.x = 4.2; camTargetPos.y = 0.5; camTargetPos.z = -0.25;
    } else if (preset === 'io') {
      camTargetPos.x = -4.2; camTargetPos.y = 0.5; camTargetPos.z = -0.25;
    } else if (preset === 'back') {
      camTargetPos.x = 0.25; camTargetPos.y = -2.35; camTargetPos.z = 2.85;
    } else {
      // 3/4 Hero on Power Side so Power Side labels/connectors are visible immediately
      camTargetPos.x = 2.9; camTargetPos.y = 2.45; camTargetPos.z = -3.15;
    }
    const activeBtnKey = preset === 'rear' ? 'side' : preset;
    dockEl?.querySelectorAll('[data-gpu-cam]').forEach(b => {
      b.classList.toggle('active', b.dataset.gpuCam === activeBtnKey);
    });
  }

  function focusPlacement(placement) {
    const map = {
      side: 'side',
      rear: 'side',
      both_sides: 'side',
      opposite: 'opposite',
      front: 'opposite',
      top: 'top',
      back: 'back',
      right: 'end',
      left: 'io'
    };
    setCameraPreset(map[placement] || 'side');
  }

  // ---------- Pointer Raycasting (Size Arrows + Elements Dragging) ----------
  function updatePointerNdc(e) {
    if (!renderer || !pointerNdc) return;
    const rect = renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function pickInteractiveTarget(e) {
    if (!raycaster || !camera) return null;
    updatePointerNdc(e);
    raycaster.setFromCamera(pointerNdc, camera);

    // 1. Prioritize Size Arrows when Change Size is active
    if (sizeMode && sizeArrowHandles.length) {
      const arrowHits = raycaster.intersectObjects(sizeArrowHandles.map(h => h.hitMesh), false);
      if (arrowHits.length) {
        return { kind: 'size', axis: arrowHits[0].object.userData.axis, sign: arrowHits[0].object.userData.sign };
      }
    }

    // 2. Placed decals (Text labels / Logos)
    if (draggableDecals.length) {
      const decalHits = raycaster.intersectObjects(draggableDecals.map(d => d.hitMesh), false);
      if (decalHits.length) {
        return { kind: 'decal', id: decalHits[0].object.userData.dragId };
      }
    }

    // 3. Recessed Fans
    if (fanAssemblies.length) {
      const fanHits = raycaster.intersectObjects(fanAssemblies.map(f => f.hitMesh), false);
      if (fanHits.length) {
        return { kind: 'fan', id: fanHits[0].object.userData.dragId };
      }
    }

    return null;
  }

  function updateHoverStates(target) {
    for (const h of sizeArrowHandles) {
      const lit = target?.kind === 'size' && target.axis === h.axis && target.sign === h.sign;
      h.mat.emissiveIntensity = lit ? 1.55 : 0.68;
    }
    for (const f of fanAssemblies) {
      const lit = (target?.kind === 'fan' && target.id === f.id) || (activeDrag?.mode === 'element' && activeDrag.id === f.id);
      f.ringMat.emissiveIntensity = lit ? Math.max(1.25, f.baseEmissive) : f.baseEmissive;
    }
    if (renderer?.domElement) {
      if (activeDrag) renderer.domElement.style.cursor = 'grabbing';
      else if (target?.kind === 'size') renderer.domElement.style.cursor = target.axis === 'x' ? 'ew-resize' : 'ns-resize';
      else if (target) renderer.domElement.style.cursor = 'ew-resize';
      else renderer.domElement.style.cursor = 'grab';
    }
  }

  function attachInteractions() {
    if (!renderer?.domElement) return;
    const dom = renderer.domElement;

    dom.addEventListener('pointerdown', e => {
      if (e.button !== 0 || contextLost) return;
      camAnimActive = false;
      const target = pickInteractiveTarget(e);
      if (!target) return;

      if (target.kind === 'size') {
        dragPlane.set(new THREE.Vector3(0, 1, 0), -(gpuRoot?.position.y || 0) - 0.04);
        updatePointerNdc(e);
        raycaster.setFromCamera(pointerNdc, camera);
        if (raycaster.ray.intersectPlane(dragPlane, dragHitPoint)) {
          activeDrag = { mode: 'size', axis: target.axis, sign: target.sign };
          if (controls) controls.enabled = false;
          dom.setPointerCapture?.(e.pointerId);
          updateHoverStates(target);
          e.stopPropagation();
        }
        return;
      }

      const fanAsm = fanAssemblies.find(f => f.id === target.id);
      const decAsm = draggableDecals.find(d => d.id === target.id);
      const asm = fanAsm || decAsm;
      if (!asm) return;

      const axis = decAsm?.dragPlaneAxis || 'y';
      const planeConst = decAsm ? decAsm.dragPlaneConst : (asm.yTop || 0.14);
      const rootPos = gpuRoot?.position || new THREE.Vector3();
      if (axis === 'z') {
        dragPlane.set(new THREE.Vector3(0, 0, 1), -(rootPos.z + planeConst));
      } else if (axis === 'x') {
        dragPlane.set(new THREE.Vector3(1, 0, 0), -(rootPos.x + planeConst));
      } else {
        dragPlane.set(new THREE.Vector3(0, 1, 0), -(rootPos.y + planeConst));
      }

      updatePointerNdc(e);
      raycaster.setFromCamera(pointerNdc, camera);
      if (raycaster.ray.intersectPlane(dragPlane, dragHitPoint)) {
        const localPt = gpuRoot.worldToLocal(dragHitPoint.clone());
        activeDrag = {
          mode: 'element',
          id: target.id,
          dragKind: target.kind,
          planeAxis: axis,
          placement: decAsm?.placement || 'top',
          offsetX: asm.group.position.x - localPt.x,
          offsetZ: asm.group.position.z - localPt.z
        };
        if (controls) controls.enabled = false;
        dom.setPointerCapture?.(e.pointerId);
        updateHoverStates(target);
        e.stopPropagation();
      }
    }, true);

    dom.addEventListener('pointermove', e => {
      if (contextLost) return;
      if (activeDrag) {
        updatePointerNdc(e);
        raycaster.setFromCamera(pointerNdc, camera);
        if (raycaster.ray.intersectPlane(dragPlane, dragHitPoint)) {
          const localPt = gpuRoot.worldToLocal(dragHitPoint.clone());

          if (activeDrag.mode === 'size') {
            if (activeDrag.axis === 'x') {
              const targetHalfW = Math.max(0.45, localPt.x * activeDrag.sign - 0.24);
              const rawLen = ((targetHalfW * 2) / 2.85) * 300;
              const newLen = clampLengthForWidth(rawLen, config.width);
              if (newLen !== config.length) {
                config.length = newLen;
                pendingRebuild = true;
                pendingFastMode = true;
                callbacks.onSizeChange?.({ length: config.length, width: config.width });
              }
            } else {
              const targetHalfD = Math.max(0.25, localPt.z * activeDrag.sign - 0.24);
              const rawWid = ((targetHalfD * 2) / 1.18) * 125;
              const newWid = clampWidthForLength(rawWid, config.length);
              if (newWid !== config.width) {
                config.width = newWid;
                pendingRebuild = true;
                pendingFastMode = true;
                callbacks.onSizeChange?.({ length: config.length, width: config.width });
              }
            }
          } else if (activeDrag.mode === 'element') {
            const w = gpuRoot?.userData?.cardWidth || 2.85;
            const d = gpuRoot?.userData?.cardDepth || 1.18;
            const el = (config.elements || []).find(item => item.id === activeDrag.id);
            if (el) {
              if (activeDrag.planeAxis === 'x') {
                const z = clamp(localPt.z + activeDrag.offsetZ, -d * 0.34, d * 0.34);
                el.position = clamp(Number(((z / 0.68 + d / 2) / d).toFixed(3)), 0.12, 0.88);
                pendingRebuild = true;
                pendingFastMode = true;
              } else {
                const isFan = el.kind === 'fan';
                const maxSpan = isFan ? w * 0.44 : w * 0.40;
                const x = clamp(localPt.x + activeDrag.offsetX, -maxSpan, maxSpan);
                el.position = clamp(Number(((x + w / 2) / w).toFixed(3)), isFan ? 0.06 : 0.10, isFan ? 0.94 : 0.90);
                if (activeDrag.dragKind === 'decal' && (activeDrag.placement === 'top' || activeDrag.placement === 'back')) {
                  const z = clamp(localPt.z + activeDrag.offsetZ, -d * 0.42, d * 0.42);
                  el.zPosition = clamp(Number(((z / 0.78 + d / 2) / d).toFixed(3)), 0.08, 0.92);
                }
                pendingRebuild = true;
                pendingFastMode = true;
              }
              callbacks.onElementsChange?.(config.elements.map(item => ({ ...item })));
            }
          }
        }
        return;
      }

      updateHoverStates(pickInteractiveTarget(e));
    });

    const releaseDrag = e => {
      if (!activeDrag) return;
      activeDrag = null;
      if (controls) controls.enabled = true;
      updateHoverStates(null);
      try { dom.releasePointerCapture?.(e.pointerId); } catch (_) {}
      pendingRebuild = true;
      pendingFastMode = false;
    };
    dom.addEventListener('pointerup', releaseDrag);
    dom.addEventListener('pointercancel', releaseDrag);
  }

  // ---------- Animation Loop ----------
  function stepAnimation(dt) {
    if (pendingRebuild) {
      const useFast = pendingFastMode;
      pendingRebuild = false;
      buildModel(useFast);
    }

    currentExplode = THREE.MathUtils.damp(currentExplode, targetExplode, 7.5, dt);
    if (backplateLayer) backplateLayer.position.y = -0.34 * currentExplode;
    if (pcbLayer) pcbLayer.position.y = -0.11 * currentExplode;
    if (heatsinkLayer) heatsinkLayer.position.y = 0.08 * currentExplode;
    if (shroudLayer) shroudLayer.position.y = 0.28 * currentExplode;
    if (fansGroup) fansGroup.position.y = 0.28 * currentExplode;
    if (elementsGroup) elementsGroup.position.y = 0.28 * currentExplode;

    if (gpuRoot) {
      if (autoSpin) gpuRoot.rotation.y += dt * 0.45;
      else gpuRoot.rotation.y = THREE.MathUtils.damp(gpuRoot.rotation.y, 0, 3.8, dt);
    }

    for (const f of fanAssemblies) {
      f.rotor.rotation.y -= dt * f.speed;
    }

    if (rainbowRgbMats.length) {
      rainbowPhase = (rainbowPhase + dt * 0.32) % 1;
      for (const entry of rainbowRgbMats) {
        const hue = (rainbowPhase + entry.offset) % 1;
        entry.mat.color.setHSL(hue, 0.96, 0.56);
        entry.mat.emissive.setHSL(hue, 0.96, 0.52);
      }
    }

    if (camAnimActive && camera && controls) {
      camera.position.x = THREE.MathUtils.damp(camera.position.x, camTargetPos.x, 6.5, dt);
      camera.position.y = THREE.MathUtils.damp(camera.position.y, camTargetPos.y, 6.5, dt);
      camera.position.z = THREE.MathUtils.damp(camera.position.z, camTargetPos.z, 6.5, dt);
      controls.target.x = THREE.MathUtils.damp(controls.target.x, camTargetLook.x, 6.5, dt);
      controls.target.y = THREE.MathUtils.damp(controls.target.y, camTargetLook.y, 6.5, dt);
      controls.target.z = THREE.MathUtils.damp(controls.target.z, camTargetLook.z, 6.5, dt);
      const dist = Math.hypot(camera.position.x - camTargetPos.x, camera.position.y - camTargetPos.y, camera.position.z - camTargetPos.z);
      if (dist < 0.015) camAnimActive = false;
    }

    controls?.update();
  }

  function scheduleNext() {
    if (!renderer) return;
    if (isSoftwareGl) {
      timerId = setTimeout(() => { rafId = requestAnimationFrame(loop); }, 40);
    } else {
      rafId = requestAnimationFrame(loop);
    }
  }

  function loop(nowMs) {
    if (!renderer || !scene || !camera || contextLost) return;
    const isVisible = stageEl && stageEl.offsetParent !== null && !stageEl.closest('.hidden');
    if (isVisible && stageEl.clientWidth > 10 && stageEl.clientHeight > 10) {
      const dt = lastMs ? clamp((nowMs - lastMs) / 1000, 0.001, 0.05) : 0.016;
      lastMs = nowMs;
      const cw = Math.max(1, stageEl.clientWidth);
      const ch = Math.max(1, stageEl.clientHeight);
      if (Math.abs(renderer.domElement.width - cw * renderer.getPixelRatio()) > 4 ||
          Math.abs(renderer.domElement.height - ch * renderer.getPixelRatio()) > 4) {
        resize();
      }
      stepAnimation(dt);
      renderer.render(scene, camera);
    }
    scheduleNext();
  }

  function startLoop() {
    stopLoop();
    lastMs = 0;
    rafId = requestAnimationFrame(loop);
  }

  function stopLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    if (timerId) clearTimeout(timerId);
    rafId = 0;
    timerId = 0;
  }

  // ---------- Lifecycle API ----------
  async function mount(el, opts) {
    if (!el) return;
    stageEl = el;
    if (opts && typeof opts === 'object') callbacks = { ...callbacks, ...opts };

    const ok = await ensureThree();
    if (!ok) {
      el.innerHTML = '<div class="gpu-3d-error">3D GPU editor could not initialize. Refresh the page and try again.</div>';
      return;
    }

    el.querySelectorAll('.gpu-3d-loading, .gpu-3d-error').forEach(node => node.remove());

    if (renderer) {
      if (offscreenHostEl && el !== offscreenHostEl) {
        if (offscreenHostEl.parentNode) offscreenHostEl.remove();
        offscreenHostEl = null;
      }
      if (renderer.domElement.parentNode !== el) el.prepend(renderer.domElement);
      if (sizeHudEl && sizeHudEl.parentNode !== el) el.appendChild(sizeHudEl);
      if (dockEl && dockEl.parentNode !== el) el.appendChild(dockEl);
      renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
      resizeObserver?.disconnect();
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(el);
      resize();
      buildModel();
      if (!rafId && !timerId) startLoop();
      return;
    }

    isSoftwareGl = detectSoftwareWebGL();
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        alpha: true,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: true
      });
    } catch (err) {
      console.error('WebGL init failed:', err);
      el.innerHTML = '<div class="gpu-3d-error">WebGL 3D preview is unavailable on this browser/device.</div>';
      return;
    }

    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = !isSoftwareGl;
    if (!isSoftwareGl) renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    renderer.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); contextLost = true; stopLoop(); });
    renderer.domElement.addEventListener('webglcontextrestored', () => { contextLost = false; buildModel(); startLoop(); });

    el.innerHTML = '';
    el.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(34, 16 / 10, 0.1, 80);
    camera.position.set(2.9, 2.45, -3.15);

    pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();
    envTexture = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTexture;
    scene.environmentIntensity = 1.08;

    scene.add(new THREE.HemisphereLight(0xe4ecff, 0x181426, 1.35));
    const keyLight = new THREE.DirectionalLight(0xfff5e8, 2.75);
    keyLight.position.set(3.8, 5.8, -4.4);
    if (!isSoftwareGl) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.bias = -0.0004;
    }
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xbcd2ff, 1.25);
    fillLight.position.set(-3.4, 3.6, 3.8);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xa78bfa, 1.45);
    rimLight.position.set(-4.2, 2.2, -3.4);
    scene.add(rimLight);

    plinthGroup = new THREE.Group();
    const shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(5.6, 3.8),
      new THREE.MeshBasicMaterial({ map: getContactShadowTexture(), transparent: true, depthWrite: false, opacity: 0.65 })
    );
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = -0.47;
    plinthGroup.add(shadowPlane);

    const plinthRing = new THREE.Mesh(
      new THREE.RingGeometry(1.88, 1.98, 72),
      new THREE.MeshStandardMaterial({
        color: 0x5c3c8a,
        metalness: 0.72,
        roughness: 0.32,
        emissive: 0x2d174d,
        emissiveIntensity: 0.55,
        side: THREE.DoubleSide
      })
    );
    plinthRing.rotation.x = -Math.PI / 2;
    plinthRing.position.y = -0.455;
    plinthGroup.add(plinthRing);
    scene.add(plinthGroup);

    gpuRoot = new THREE.Group();
    gpuRoot.position.y = 0.05;
    backplateLayer = new THREE.Group();
    pcbLayer = new THREE.Group();
    heatsinkLayer = new THREE.Group();
    shroudLayer = new THREE.Group();
    fansGroup = new THREE.Group();
    elementsGroup = new THREE.Group();
    sizeGizmoGroup = new THREE.Group();
    gpuRoot.add(backplateLayer, pcbLayer, heatsinkLayer, shroudLayer, fansGroup, elementsGroup, sizeGizmoGroup);
    scene.add(gpuRoot);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 1.9;
    controls.maxDistance = 7.8;
    controls.maxPolarAngle = Math.PI * 0.88;
    controls.target.set(0, 0.05, 0);
    controls.addEventListener('start', () => { camAnimActive = false; });

    attachInteractions();
    createDock();

    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(el);
    resize();
    buildModel();
    startLoop();
  }

  function resize() {
    if (!renderer || !stageEl || !camera) return;
    const w = stageEl.clientWidth;
    const h = stageEl.clientHeight;
    if (w < 8 || h < 8) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function update(next, opts) {
    if (next && typeof next === 'object') {
      config = {
        ...config,
        ...next,
        elements: Array.isArray(next.elements) ? next.elements.map(e => ({ ...e })) : config.elements
      };
    }
    if (!renderer) {
      if (stageEl) mount(stageEl);
      return;
    }
    const now = performance.now();
    const rapid = !!(opts?.fast || (now - lastUpdateCallMs < 180));
    lastUpdateCallMs = now;
    pendingRebuild = true;
    pendingFastMode = rapid;
    if (hiResSettleTimer) {
      clearTimeout(hiResSettleTimer);
      hiResSettleTimer = 0;
    }
    if (rapid) {
      hiResSettleTimer = setTimeout(() => {
        hiResSettleTimer = 0;
        if (renderer && gpuRoot) {
          pendingRebuild = true;
          pendingFastMode = false;
        }
      }, 150);
    }
  }

  async function ensureOffscreenMounted() {
    if (renderer && scene && camera && !contextLost) return true;
    if (offscreenPromise) return offscreenPromise;
    offscreenPromise = (async () => {
      try {
        if (!stageEl || !document.body.contains(stageEl)) {
          if (!offscreenHostEl) {
            offscreenHostEl = document.createElement('div');
            offscreenHostEl.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:360px;height:270px;opacity:0;pointer-events:none;overflow:hidden;';
            document.body.appendChild(offscreenHostEl);
          }
          await mount(offscreenHostEl);
        }
        return !!(renderer && scene && camera && !contextLost);
      } finally {
        offscreenPromise = null;
      }
    })();
    return offscreenPromise;
  }

  function renderSnapshotSync(configOverride = null, width = 360, height = 270) {
    if (!renderer || !scene || !camera || contextLost) return '';
    let prevConfig = null;
    try {
      const outW = Math.max(160, Math.min(640, Math.round(Number(width) || 360)));
      const outH = Math.max(120, Math.min(480, Math.round(Number(height) || 270)));

      const prevPos = camera.position.clone();
      const prevQuat = camera.quaternion.clone();
      const prevAspect = camera.aspect;
      const prevFov = camera.fov;
      const prevTarget = controls ? controls.target.clone() : new THREE.Vector3(0, 0.05, 0);
      const prevCtrlEnabled = controls ? controls.enabled : true;
      const prevSpin = gpuRoot ? gpuRoot.rotation.y : 0;
      const prevExp = currentExplode;
      const prevGizmo = sizeGizmoGroup ? sizeGizmoGroup.visible : false;
      const prevPR = renderer.getPixelRatio();

      if (configOverride && typeof configOverride === 'object') {
        prevConfig = {
          ...config,
          elements: Array.isArray(config.elements) ? config.elements.map(e => ({ ...e })) : []
        };
        config = {
          ...DEFAULT_CONFIG,
          ...configOverride,
          elements: Array.isArray(configOverride.elements) ? configOverride.elements.map(e => ({ ...e })) : []
        };
        pendingRebuild = false;
        pendingFastMode = false;
        buildModel(false);
      } else if (pendingRebuild || pendingFastMode) {
        pendingRebuild = false;
        pendingFastMode = false;
        buildModel(false);
      }

      if (controls) controls.enabled = false;
      if (gpuRoot) gpuRoot.rotation.set(0, 0, 0);
      if (sizeGizmoGroup) sizeGizmoGroup.visible = false;
      currentExplode = 0;
      if (backplateLayer) backplateLayer.position.y = 0;
      if (pcbLayer) pcbLayer.position.y = 0;
      if (heatsinkLayer) heatsinkLayer.position.y = 0;
      if (shroudLayer) shroudLayer.position.y = 0;
      if (fansGroup) fansGroup.position.y = 0;
      if (elementsGroup) elementsGroup.position.y = 0;

      camera.fov = 34;
      camera.aspect = outW / outH;
      camera.position.set(2.8, 2.2, -2.98);
      camera.lookAt(0, 0.05, 0);
      camera.updateProjectionMatrix();

      renderer.setPixelRatio(1);
      renderer.setSize(outW, outH, false);
      renderer.render(scene, camera);

      let dataUrl = '';
      try {
        const snapCanvas = document.createElement('canvas');
        snapCanvas.width = outW;
        snapCanvas.height = outH;
        const ctx = snapCanvas.getContext('2d');
        ctx.drawImage(renderer.domElement, 0, 0, outW, outH);
        dataUrl = snapCanvas.toDataURL('image/webp', 0.84);
        if (!dataUrl || !dataUrl.startsWith('data:image/webp')) {
          dataUrl = snapCanvas.toDataURL('image/png');
        }
      } catch (_) {
        dataUrl = renderer.domElement.toDataURL('image/webp', 0.84);
      }

      if (prevConfig) {
        config = prevConfig;
        buildModel(false);
      }
      if (sizeGizmoGroup) sizeGizmoGroup.visible = prevGizmo;
      if (gpuRoot) gpuRoot.rotation.y = prevSpin;
      currentExplode = prevExp;
      if (backplateLayer) backplateLayer.position.y = -0.34 * prevExp;
      if (pcbLayer) pcbLayer.position.y = -0.11 * prevExp;
      if (heatsinkLayer) heatsinkLayer.position.y = 0.08 * prevExp;
      if (shroudLayer) shroudLayer.position.y = 0.28 * prevExp;
      if (fansGroup) fansGroup.position.y = 0.28 * prevExp;
      if (elementsGroup) elementsGroup.position.y = 0.28 * prevExp;

      camera.fov = prevFov;
      camera.aspect = prevAspect;
      camera.position.copy(prevPos);
      camera.quaternion.copy(prevQuat);
      camera.updateProjectionMatrix();
      if (controls) {
        controls.target.copy(prevTarget);
        controls.enabled = prevCtrlEnabled;
        controls.update();
      }
      renderer.setPixelRatio(prevPR);
      resize();
      if (stageEl && stageEl !== offscreenHostEl && stageEl.offsetParent !== null && !stageEl.closest('.hidden')) {
        renderer.render(scene, camera);
      }
      return dataUrl;
    } catch (_) {
      if (prevConfig) {
        try { config = prevConfig; buildModel(false); } catch (__) {}
      }
      return '';
    }
  }

  function captureSnapshot(opts) {
    return renderSnapshotSync(opts?.config || null, opts?.width || 360, opts?.height || 270);
  }

  async function captureHeroSnapshot(configOverride = null, width = 360, height = 270) {
    const ok = await ensureOffscreenMounted();
    if (!ok) return '';
    return renderSnapshotSync(configOverride, width, height);
  }

  async function processGpuThumbQueue() {
    if (thumbQueueBusy || !gpuThumbQueue.length) return;
    thumbQueueBusy = true;
    try {
      while (gpuThumbQueue.length) {
        const job = gpuThumbQueue.shift();
        try {
          const url = await captureHeroSnapshot(job.config, job.width || 360, job.height || 270);
          if (typeof job.onDone === 'function') job.onDone(url);
        } catch (_) {
          if (typeof job.onDone === 'function') job.onDone('');
        }
        await new Promise(r => setTimeout(r, 12));
      }
    } finally {
      thumbQueueBusy = false;
    }
  }

  function enqueueThumbnail(configOverride, onDone, width = 360, height = 270) {
    gpuThumbQueue.push({ config: configOverride, onDone, width, height });
    processGpuThumbQueue();
  }

  function dispose() {
    stopLoop();
    if (hiResSettleTimer) {
      clearTimeout(hiResSettleTimer);
      hiResSettleTimer = 0;
    }
    resizeObserver?.disconnect();
    resizeObserver = null;
    controls?.dispose?.();
    disposeGroupContents(backplateLayer);
    disposeGroupContents(pcbLayer);
    disposeGroupContents(heatsinkLayer);
    disposeGroupContents(shroudLayer);
    disposeGroupContents(fansGroup);
    disposeGroupContents(elementsGroup);
    rainbowRgbMats = [];
    disposeGroupContents(sizeGizmoGroup);
    disposeGroupContents(plinthGroup);
    Object.values(proceduralTex).forEach(t => t?.dispose?.());
    Object.values(proceduralGeo).forEach(a => a?.dispose?.());
    sharedAssets.clear();
    decalTexCache.forEach(t => t?.dispose?.());
    decalTexCache.clear();
    lastStructSig = '';
    lastDecalsSig = '';
    lastShroudSig = '';
    lastFanGeomSig = '';
    lastGizmoSig = '';
    cachedSurfaceBounds = null;
    envTexture?.dispose?.();
    pmremGenerator?.dispose?.();
    renderer?.dispose?.();
    if (offscreenHostEl?.parentNode) offscreenHostEl.remove();
    offscreenHostEl = null;
    renderer = null;
    scene = null;
    camera = null;
    controls = null;
    gpuRoot = null;
    dockEl = null;
    sizeHudEl = null;
  }

  // ---------- Standalone Reusable 3D GPU Assembly Builder ----------
  const standaloneGpuLogoCache = new Map();

  function buildStandaloneGpuAssembly(T, rawCfg, opts = {}) {
    if (!T) return null;
    const cfg = {
      ...DEFAULT_CONFIG,
      ...(rawCfg && typeof rawCfg === 'object' ? rawCfg : {}),
      elements: Array.isArray(rawCfg?.elements) ? rawCfg.elements.map(e => ({ ...e })) : DEFAULT_CONFIG.elements.map(e => ({ ...e }))
    };
    const isSoft = !!opts.isSoftwareGl;
    const invertSideDecals = !!opts.invertSideDecals;

    const safeLength = clamp(Math.round(Number(cfg.length) || 300), GPU_MIN_LEN, GPU_MAX_LEN);
    const safeWidth = clampWidthForLength(cfg.width, safeLength);
    const safeThickMm = clamp(Math.round(Number(cfg.thickness) || 52), 38, 76);

    const lenScale = safeLength / 300;
    const widScale = safeWidth / 125;
    const thickScale = clamp(safeThickMm / 52, 0.72, 1.48);

    const w = 2.85 * lenScale;
    const d = 1.18 * widScale;
    const h = 0.25 * thickScale;

    const bodyType = cfg.body || 'plastic';
    const customShapeCfg = bodyType === 'custom'
      ? {
          points: Array.isArray(cfg.customShape?.points) && cfg.customShape.points.length >= 3
            ? cfg.customShape.points
            : DEFAULT_CUSTOM_POINTS,
          extrudeDepth: clamp(Number(cfg.customShape?.extrudeDepth ?? 1.0), 0.55, 1.75),
          bevel: clamp(Number(cfg.customShape?.bevel ?? 0.018), 0.002, 0.04),
          material: cfg.customShape?.material || 'plastic'
        }
      : null;
    const renderMaterialBody = bodyType === 'custom'
      ? (customShapeCfg.material === 'metallic' || customShapeCfg.material === 'carbon' ? customShapeCfg.material : 'plastic')
      : bodyType;
    const finishType = cfg.finish || 'satin';
    const shapeType = cfg.shroud || 'rounded';
    const primaryColor = cfg.primaryColor || '#222733';
    const accentColor = cfg.accentColor || '#a855f7';
    const backplateStyle = cfg.backplate === false ? 'off' : (cfg.backplateStyle || 'flow_through');
    const finStyle = cfg.finStyle || 'silver';
    const pipeStyle = cfg.pipeStyle || 'copper';
    const powerType = cfg.powerType || '12v2x6';
    const ioStyle = cfg.ioStyle || 'steel';

    const fanElements = (cfg.elements || []).filter(e => e.kind === 'fan').slice(0, 6);
    const fanLayouts = computeSafeFanLayouts(fanElements, w, d, shapeType);
    const outerShroudH = h * 0.62 * (customShapeCfg ? customShapeCfg.extrudeDepth : 1.0);
    const mainShroudY = h * 0.26 + (customShapeCfg ? (outerShroudH - h * 0.62) * 0.35 : 0);
    const deckH = 0.034;
    const deckY = mainShroudY + outerShroudH * 0.44;
    const boreCenterY = mainShroudY + 0.02;
    const boreDepth = outerShroudH + 0.02;

    // Local clean Three builders bound to caller's T
    const mkBox = (parent, bw, bh, bd, material, x = 0, y = 0, z = 0) => {
      const mesh = new T.Mesh(new T.BoxGeometry(bw, bh, bd), material);
      mesh.position.set(x, y, z);
      mesh.castShadow = !isSoft;
      mesh.receiveShadow = !isSoft;
      parent.add(mesh);
      return mesh;
    };

    const mkShroudGeo = (sw, sh, sd, holes, isDeck, flowCutout) => {
      const prevThree = THREE;
      THREE = T;
      const g = createShroudGeometryWithHoles(sw, sh, sd, shapeType, holes, false, isDeck, flowCutout, customShapeCfg);
      THREE = prevThree;
      return g;
    };

    // Build clean procedural textures under T
    const prevThree = THREE;
    THREE = T;
    const mkBodyMat = (bType, pHex, darken = 1.0) => {
      const col = new T.Color(pHex || '#222733');
      if (darken !== 1.0) col.multiplyScalar(darken);
      const isMatte = finishType === 'matte';
      const isGloss = finishType === 'gloss';
      if (bType === 'metallic') {
        const c = document.createElement('canvas'); c.width = 512; c.height = 256;
        const ctx = c.getContext('2d'); ctx.fillStyle = '#edf1f7'; ctx.fillRect(0, 0, 512, 256);
        for (let y = 0; y < 256; y++) { ctx.fillStyle = `rgba(15,23,42,${(y % 3) * 0.02})`; ctx.fillRect(0, y, 512, 1); }
        const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace;
        return new T.MeshPhysicalMaterial({ color: col, map: tex, bumpMap: tex, bumpScale: 0.004, metalness: isMatte ? 0.72 : 0.88, roughness: isMatte ? 0.40 : isGloss ? 0.14 : 0.22, clearcoat: isMatte ? 0.08 : isGloss ? 0.78 : 0.30, anisotropy: 0.7 });
      }
      if (bType === 'carbon') {
        const sz = 128; const cc = document.createElement('canvas'); cc.width = cc.height = sz;
        const cx = cc.getContext('2d'); cx.fillStyle = '#8b93a3'; cx.fillRect(0, 0, sz, sz);
        for (let y = 0; y < sz; y += 16) for (let x = 0; x < sz; x += 16) {
          const ev = (((x + ((y / 16) % 2) * 8)) % 32) === 0;
          cx.fillStyle = ev ? '#c8d0de' : '#4a5160'; cx.fillRect(x, y, 14, 7);
          cx.fillStyle = ev ? '#aeb6c5' : '#586070'; cx.fillRect(x + 2, y + 8, 12, 7);
        }
        const tex = new T.CanvasTexture(cc); tex.colorSpace = T.SRGBColorSpace; tex.wrapS = tex.wrapT = T.RepeatWrapping; tex.repeat.set(12, 5);
        const lum = col.getHSL({ h: 0, s: 0, l: 0 }).l;
        const tint = lum < 0.14 ? col.clone().lerp(new T.Color(0x282f3e), 0.35) : col;
        return new T.MeshPhysicalMaterial({ color: tint, map: tex, bumpMap: tex, bumpScale: 0.006, metalness: isGloss ? 0.28 : 0.20, roughness: isMatte ? 0.58 : isGloss ? 0.26 : 0.44, clearcoat: isMatte ? 0.06 : isGloss ? 0.68 : 0.26 });
      }
      return new T.MeshPhysicalMaterial({ color: col, metalness: isGloss ? 0.20 : 0.14, roughness: isMatte ? 0.62 : isGloss ? 0.18 : 0.44, clearcoat: isMatte ? 0.04 : isGloss ? 0.72 : 0.18 });
    };

    const pcbCanvas = document.createElement('canvas'); pcbCanvas.width = 512; pcbCanvas.height = 256;
    const pCtx = pcbCanvas.getContext('2d'); pCtx.fillStyle = '#071510'; pCtx.fillRect(0, 0, 512, 256);
    pCtx.strokeStyle = 'rgba(56,178,128,0.34)'; pCtx.lineWidth = 1.4;
    for (let i = 0; i < 36; i++) { const yy = 12 + (i * 232) / 36; pCtx.beginPath(); pCtx.moveTo(10, yy); pCtx.lineTo(498, yy + (i % 2 ? 6 : -6)); pCtx.stroke(); }
    pCtx.strokeStyle = 'rgba(218,176,86,0.55)'; pCtx.lineWidth = 2.5; pCtx.strokeRect(8, 8, 496, 240);
    const pcbTex = new T.CanvasTexture(pcbCanvas); pcbTex.colorSpace = T.SRGBColorSpace;

    const pcieC = document.createElement('canvas'); pcieC.width = 256; pcieC.height = 32;
    const pfCtx = pcieC.getContext('2d'); pfCtx.fillStyle = '#12261e'; pfCtx.fillRect(0, 0, 256, 32);
    pfCtx.fillStyle = '#eab308';
    for (let x = 4; x < 252; x += 6) { if (x > 48 && x < 58) continue; pfCtx.fillRect(x, 3, 3.5, 26); }
    const pcieTex = new T.CanvasTexture(pcieC); pcieTex.colorSpace = T.SRGBColorSpace;
    THREE = prevThree;

    const accentMat = new T.MeshPhysicalMaterial({ color: new T.Color(accentColor), metalness: renderMaterialBody === 'metallic' ? 0.78 : 0.44, roughness: 0.22, clearcoat: 0.45 });
    const trimMetal = new T.MeshPhysicalMaterial({ color: 0xc2cbd6, metalness: 0.92, roughness: 0.2 });
    const darkMat = new T.MeshPhysicalMaterial({ color: 0x11151e, metalness: 0.55, roughness: 0.36 });
    const goldMat = new T.MeshStandardMaterial({ color: 0xe2bc5e, metalness: 0.94, roughness: 0.18 });
    const copperMat = new T.MeshPhysicalMaterial({ color: 0xd47a45, metalness: 0.95, roughness: 0.18 });
    const pipeColor = pipeStyle === 'nickel' ? 0xcfd7e4 : pipeStyle === 'black' ? 0x1d222e : 0xd47a45;
    const pipeMat = new T.MeshPhysicalMaterial({ color: pipeColor, metalness: pipeStyle === 'black' ? 0.75 : 0.95, roughness: pipeStyle === 'black' ? 0.32 : 0.17 });
    const finColor = finStyle === 'black' ? 0x1e2430 : finStyle === 'copper' ? 0xd47a45 : 0xc8d2df;
    const finMat = new T.MeshPhysicalMaterial({ color: finColor, metalness: 0.90, roughness: finStyle === 'black' ? 0.34 : 0.24 });
    const ioBracketMat = ioStyle === 'black' ? new T.MeshPhysicalMaterial({ color: 0x1a1e28, metalness: 0.85, roughness: 0.28 }) : trimMetal;
    const pcbMat = new T.MeshPhysicalMaterial({ map: pcbTex, metalness: 0.2, roughness: 0.48, clearcoat: 0.14 });
    const dum = new T.Object3D();

    const root = new T.Group();
    const bpLayer = new T.Group();
    const pcbL = new T.Group();
    const hsLayer = new T.Group();
    const shLayer = new T.Group();
    const fnGroup = new T.Group();
    const elGroup = new T.Group();

    // 1. Backplate
    let backBottomY = -h * 0.42 - 0.02;
    if (backplateStyle !== 'off') {
      const bpMat = mkBodyMat(renderMaterialBody, primaryColor, 0.92);
      const flowCut = backplateStyle === 'flow_through' ? { cx: w * 0.26, rw: w * 0.27, rd: d * 0.62 } : null;
      const bpGeo = mkShroudGeo(w * 0.96, 0.032, d * 0.95, [], false, flowCut);
      const bp = new T.Mesh(bpGeo, bpMat);
      bp.position.y = -h * 0.62 - 0.058;
      bp.castShadow = !isSoft; bp.receiveShadow = !isSoft;
      bpLayer.add(bp);
      bpGeo.computeBoundingBox();
      backBottomY = bp.position.y + bpGeo.boundingBox.min.y;
      const bpU = bp.position.y - 0.017;
      if (backplateStyle === 'louvered') {
        for (let i = 0; i < 11; i++) {
          const rib = mkBox(bpLayer, 0.022, 0.01, d * 0.56, darkMat, -w * 0.02 + i * w * 0.04, bpU, 0);
          rib.rotation.y = 0.32;
        }
      } else if (backplateStyle === 'solid') {
        mkBox(bpLayer, w * 0.72, 0.01, 0.018, trimMetal, 0, bpU, 0);
      } else {
        mkBox(bpLayer, w * 0.29, 0.01, 0.018, accentMat, w * 0.26, bpU, d * 0.31);
        mkBox(bpLayer, w * 0.29, 0.01, 0.018, accentMat, w * 0.26, bpU, -d * 0.31);
      }
      mkBox(bpLayer, w * 0.58, 0.009, 0.016, accentMat, -w * 0.10, bpU, -d * 0.37);
      const xb1 = mkBox(bpLayer, 0.32, 0.012, 0.036, trimMetal, -0.05, bpU - 0.003, 0); xb1.rotation.y = Math.PI / 4;
      const xb2 = mkBox(bpLayer, 0.32, 0.012, 0.036, trimMetal, -0.05, bpU - 0.003, 0); xb2.rotation.y = -Math.PI / 4;
    }

    // 2. PCB + Die + VRAM + PCIe + Power Connectors + I/O Bracket
    mkBox(pcbL, w * 0.96, 0.032, d * 0.92, pcbMat, 0, -h * 0.42, 0);
    const dieX = -0.05, dieY = -h * 0.42 + 0.022;
    mkBox(pcbL, 0.42, 0.016, 0.42, new T.MeshStandardMaterial({ color: 0x16322b, metalness: 0.3, roughness: 0.45 }), dieX, dieY, 0);
    mkBox(pcbL, 0.21, 0.018, 0.21, new T.MeshPhysicalMaterial({ color: 0x1e4d73, metalness: 0.65, roughness: 0.12, iridescence: 0.9 }), dieX, dieY + 0.012, 0);
    const vramMat = new T.MeshPhysicalMaterial({ color: 0x191d26, metalness: 0.35, roughness: 0.34 });
    const vramCoords = [[-0.31, -0.14], [-0.31, 0], [-0.31, 0.14], [-0.14, -0.29], [0, -0.29], [0.14, -0.29], [0.21, -0.14], [0.21, 0.14], [-0.14, 0.29], [0.04, 0.29]];
    const vramMesh = new T.InstancedMesh(new T.BoxGeometry(0.085, 0.016, 0.068), vramMat, vramCoords.length);
    vramCoords.forEach(([vx, vz], idx) => {
      dum.position.set(dieX + vx, dieY + 0.004, vz); dum.rotation.set(0, Math.abs(vx) > 0.2 ? Math.PI / 2 : 0, 0); dum.scale.set(1, 1, 1); dum.updateMatrix();
      vramMesh.setMatrixAt(idx, dum.matrix);
    });
    pcbL.add(vramMesh);

    const pcieMat = new T.MeshStandardMaterial({ map: pcieTex, metalness: 0.72, roughness: 0.25 });
    mkBox(pcbL, w * 0.44, 0.022, 0.088, pcieMat, -w * 0.13, -h * 0.42, d * 0.485);

    const pwrZ = -d * 0.462;
    const pwrCount = powerType === '3x8pin' ? 3 : powerType === '2x8pin' ? 2 : 1;
    const sockW = powerType === '12v2x6' ? 0.20 : 0.145;
    const sockGap = 0.165;
    const pwrCenterX = powerType === '3x8pin' ? w * 0.15 : w * 0.21;
    const cavityMat = new T.MeshStandardMaterial({ color: 0x07090e, roughness: 0.7 });
    const cols = powerType === '12v2x6' ? 6 : 4;
    const pinM = new T.InstancedMesh(new T.BoxGeometry(0.012, 0.012, 0.024), goldMat, pwrCount * cols * 2);
    let pi = 0;
    for (let s = 0; s < pwrCount; s++) {
      const sx = pwrCenterX + (s - (pwrCount - 1) / 2) * sockGap;
      mkBox(pcbL, sockW, 0.068, 0.085, darkMat, sx, -h * 0.42 + 0.032, pwrZ);
      mkBox(pcbL, sockW * 0.80, 0.044, 0.02, cavityMat, sx, -h * 0.42 + 0.034, pwrZ - 0.036);
      const stepX = (sockW * 0.65) / Math.max(1, cols - 1);
      for (let r = 0; r < 2; r++) for (let c = 0; c < cols; c++) {
        dum.position.set(sx - (sockW * 0.325) + c * stepX, -h * 0.42 + 0.026 + r * 0.018, pwrZ - 0.04);
        dum.rotation.set(0, 0, 0); dum.scale.set(1, 1, 1); dum.updateMatrix();
        pinM.setMatrixAt(pi++, dum.matrix);
      }
    }
    pcbL.add(pinM);

    const ioX = -w * 0.5 - 0.018;
    mkBox(pcbL, 0.026, h * 1.12, d * 0.94, ioBracketMat, ioX, 0, 0);
    mkBox(pcbL, 0.065, 0.028, d * 0.94, ioBracketMat, ioX + 0.01, -h * 0.55, 0);
    for (let v = 0; v < 5; v++) mkBox(pcbL, 0.032, 0.016, d * 0.12, darkMat, ioX - 0.002, h * 0.28, -d * 0.34 + v * d * 0.17);
    for (let i = 0; i < 4; i++) {
      const pz = -d * 0.3 + i * d * 0.2;
      mkBox(pcbL, 0.038, 0.042, 0.105, ioBracketMat, ioX - 0.012, -h * 0.1, pz);
      mkBox(pcbL, 0.042, 0.022, 0.082, darkMat, ioX - 0.015, -h * 0.1, pz);
    }

    // 3. Heatsink Fins + Vapor Chamber + Heatpipes
    const finCount = clamp(Math.round(w * 28), 38, 86);
    const finMesh = new T.InstancedMesh(new T.BoxGeometry(0.006, h * 0.58, d * 0.85), finMat, finCount);
    for (let i = 0; i < finCount; i++) {
      dum.position.set(-w * 0.455 + (i / (finCount - 1)) * w * 0.91, -h * 0.05, 0);
      dum.rotation.set(0, 0, 0); dum.scale.set(1, 1, 1); dum.updateMatrix();
      finMesh.setMatrixAt(i, dum.matrix);
    }
    hsLayer.add(finMesh);
    mkBox(hsLayer, 0.44, 0.034, 0.42, copperMat, -0.05, -h * 0.32, 0);
    for (let i = 0; i < 5; i++) {
      const zOff = (-0.34 + i * 0.17) * d;
      const curve = new T.CatmullRomCurve3([
        new T.Vector3(-w * 0.43, -h * 0.02, zOff * 0.84),
        new T.Vector3(-w * 0.14, -h * 0.2, zOff * 0.44),
        new T.Vector3(w * 0.14, -h * 0.12, zOff * 0.88),
        new T.Vector3(w * 0.44, -h * 0.01, zOff * 0.82)
      ]);
      hsLayer.add(new T.Mesh(new T.TubeGeometry(curve, 18, 0.019, 10, false), pipeMat));
    }

    // 4. Shroud + Deck
    const shroudMat = mkBodyMat(renderMaterialBody, primaryColor, 1.0);
    const primLum = new T.Color(primaryColor).getHSL({ h: 0, s: 0, l: 0 }).l;
    const deckMat = mkBodyMat(renderMaterialBody, primaryColor, primLum > 0.45 ? 0.78 : 0.76);
    const mainShroud = new T.Mesh(mkShroudGeo(w, outerShroudH, d, fanLayouts, false, null), shroudMat);
    mainShroud.position.y = mainShroudY; mainShroud.castShadow = !isSoft; mainShroud.receiveShadow = !isSoft;
    shLayer.add(mainShroud);
    const deckMesh = new T.Mesh(mkShroudGeo(w * DECK_W_RATIO, deckH, d * DECK_D_RATIO, fanLayouts, true, null), deckMat);
    deckMesh.position.y = deckY;
    shLayer.add(deckMesh);
    mkBox(shLayer, w * 0.72, 0.014, 0.014, accentMat, 0, deckY + 0.012, d * 0.462);
    mkBox(shLayer, w * 0.72, 0.014, 0.014, accentMat, 0, deckY + 0.012, -d * 0.462);
    if (shapeType === 'founders') {
      const railY = deckY + deckH * 0.5 + 0.008;
      mkBox(shLayer, w * 0.88, 0.012, 0.026, trimMetal, 0, railY, d * 0.415);
      mkBox(shLayer, w * 0.88, 0.012, 0.026, trimMetal, 0, railY, -d * 0.415);
      mkBox(shLayer, 0.028, 0.012, d * 0.84, trimMetal, w * 0.44, railY, 0);
      mkBox(shLayer, 0.028, 0.012, d * 0.84, trimMetal, -w * 0.44, railY, 0);
    }

    // 5. Recessed Fans
    const rotorList = [];
    const rgbList = [];
    const prevBladePrev = THREE;
    THREE = T;
    const unitStdBlade = createBladeGeoFor(T, false);
    const unitCurvedBlade = createBladeGeoFor(T, true);
    THREE = prevBladePrev;

    fanLayouts.forEach(fl => {
      const fg = new T.Group();
      fg.position.set(fl.fx, boreCenterY, 0);
      const r = fl.r;
      const isSm = fl.fanType === 'gpu_small_fans';
      const isMd = fl.fanType === 'gpu_medium_fans';
      const isSmt = fl.fanType === 'gpu_smart_fans';
      const rgbHalo = !!fl.rgbRing;

      const ringMat = new T.MeshPhysicalMaterial({
        color: (isSmt || rgbHalo) ? accentMat.color : isMd ? 0xbec7d5 : isSm ? 0x8691a2 : 0x454d5e,
        metalness: (isSmt || isMd) ? 0.9 : 0.48,
        roughness: (isSmt || isMd) ? 0.2 : 0.36,
        emissive: (isSmt || rgbHalo) ? accentMat.color : new T.Color(0x000000),
        emissiveIntensity: rgbHalo ? 1.15 : (isSmt ? 0.28 : 0)
      });
      const cowlPts = [
        new T.Vector2(r * 0.985, boreDepth * 0.42),
        new T.Vector2(r * 0.995, boreDepth * 0.515),
        new T.Vector2(r * 1.032, boreDepth * 0.518),
        new T.Vector2(r * 1.045, boreDepth * 0.49),
        new T.Vector2(r * 1.028, boreDepth * 0.44)
      ];
      fg.add(new T.Mesh(new T.LatheGeometry(cowlPts, 32), ringMat));

      const sleeveMat = new T.MeshStandardMaterial({ color: new T.Color(primaryColor).multiplyScalar(0.45), metalness: 0.45, roughness: 0.4, side: T.DoubleSide });
      fg.add(new T.Mesh(new T.CylinderGeometry(r * 1.025, r * 1.025, boreDepth * 1.01, 32, 1, true), sleeveMat));

      const rotor = new T.Group();
      rotor.position.y = boreDepth * 0.14;
      fg.add(rotor);

      const bladeCount = isSmt ? 13 : isMd ? 11 : isSm ? 9 : 7;
      const bladePitch = isSmt ? 0.46 : isMd ? 0.42 : 0.36;
      const bladeHex = fl.bladeColor === 'white' ? 0xe2e8f0 : fl.bladeColor === 'silver' ? 0x9aa4b5 : fl.bladeColor === 'graphite' ? 0x3b4456 : fl.bladeColor === 'accent' ? accentMat.color : (isSmt ? 0x262d3d : isMd ? 0x1e2432 : 0x141720);
      const bladeMat = new T.MeshPhysicalMaterial({ color: bladeHex, metalness: fl.bladeColor === 'silver' ? 0.82 : isSmt ? 0.48 : 0.26, roughness: 0.30, clearcoat: 0.55 });
      const bGeo = (isMd || isSmt) ? unitCurvedBlade : unitStdBlade;
      for (let i = 0; i < bladeCount; i++) {
        const pv = new T.Group(); pv.rotation.y = (i / bladeCount) * Math.PI * 2;
        const bl = new T.Mesh(bGeo, bladeMat);
        bl.scale.set(r, 1, r); bl.position.set(r * 0.23, 0, 0); bl.rotation.x = bladePitch;
        if (isMd || isSmt) bl.rotation.z = 0.08;
        pv.add(bl); rotor.add(pv);
      }
      if (isSmt || isMd) rotor.add(new T.Mesh(new T.CylinderGeometry(r * 0.945, r * 0.945, 0.018, 28, 1, true), bladeMat));

      const hubCol = fl.hubStyle === 'chrome' ? 0xd8e0eb : fl.hubStyle === 'gold' ? 0xe2bc5e : fl.hubStyle === 'dark' ? 0x1c212c : fl.hubStyle === 'accent' ? accentMat.color : ((isSmt || isMd) ? 0xcfd7e3 : 0x2f3646);
      const hubMat = new T.MeshPhysicalMaterial({ color: hubCol, metalness: (fl.hubStyle === 'chrome' || fl.hubStyle === 'gold') ? 0.92 : 0.55, roughness: 0.22 });
      rotor.add(new T.Mesh(new T.LatheGeometry([
        new T.Vector2(0, 0.022), new T.Vector2(r * 0.18, 0.022), new T.Vector2(r * 0.24, 0.015), new T.Vector2(r * 0.255, -0.018), new T.Vector2(0, -0.018)
      ], 22), hubMat));
      const cRing = new T.Mesh(new T.RingGeometry(r * 0.125, r * 0.165, 22), ringMat);
      cRing.rotation.x = -Math.PI / 2; cRing.position.y = 0.0235;
      rotor.add(cRing);

      fnGroup.add(fg);
      rotorList.push({ rotor, speed: isSmt ? 3.4 : isMd ? 2.6 : isSm ? 2.9 : 2.1 });
    });

    // 6. Placed Decals, Logos, Accent Bars, Vent Grilles & RGB Strips
    const mainBevel = (shapeType === 'compact' || shapeType === 'stealth') ? 0.011 : 0.018;
    const deckBevel = (shapeType === 'compact' || shapeType === 'stealth') ? 0.008 : 0.011;
    const bounds = {
      w, d, outerShroudH,
      shroudMidY: mainShroudY,
      frontZ: d * 0.5 + mainBevel,
      backZ: -d * 0.5 - mainBevel,
      rightX: w * 0.5 + mainBevel,
      leftX: -w * 0.5 - 0.045,
      deckTopY: deckY + deckH * 0.5 + deckBevel,
      backBottomY
    };

    const mkDecalTextTex = (text, colorHex) => {
      const clean = String(text || 'GPU').trim().slice(0, 24) || 'GPU';
      const c = document.createElement('canvas'); c.width = 512; c.height = 128;
      const ctx = c.getContext('2d'); ctx.clearRect(0, 0, 512, 128);
      ctx.font = '900 58px Inter, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(8,10,18,0.85)'; ctx.lineWidth = 8;
      ctx.strokeText(clean, 256, 66, 476);
      ctx.fillStyle = colorHex || '#ffffff'; ctx.fillText(clean, 256, 66, 476);
      const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace;
      return t;
    };

    const mkDecalLogoTex = (url) => {
      const clean = String(url || '').trim();
      let img = clean ? standaloneGpuLogoCache.get(clean) : null;
      if (clean && !img) {
        standaloneGpuLogoCache.set(clean, 'loading');
        const im = new Image(); im.crossOrigin = 'anonymous';
        im.onload = () => { standaloneGpuLogoCache.set(clean, im); opts.onAssetReady?.(); };
        im.onerror = () => standaloneGpuLogoCache.delete(clean);
        im.src = clean;
      }
      const c = document.createElement('canvas'); c.width = 192; c.height = 192;
      const ctx = c.getContext('2d'); ctx.clearRect(0, 0, 192, 192);
      if (img && img !== 'loading') {
        const s = Math.min(168 / img.width, 168 / img.height);
        ctx.drawImage(img, (192 - img.width * s) / 2, (192 - img.height * s) / 2, img.width * s, img.height * s);
      } else {
        ctx.strokeStyle = accentColor || '#c084fc'; ctx.lineWidth = 8;
        ctx.beginPath(); ctx.arc(96, 96, 64, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#f8fafc'; ctx.font = '900 40px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('GPU', 96, 98);
      }
      const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace;
      return t;
    };

    const mountDecal = (el, placement, tex, pw, ph, isText, colorHex, glow) => {
      const pos = clamp(Number(el.position ?? 0.5), 0.12, 0.88);
      const zPos = clamp(Number(el.zPosition ?? (placement === 'top' ? 0.88 : 0.5)), 0.08, 0.92);
      const xCoord = -bounds.w / 2 + bounds.w * pos;
      const zAcross = (-bounds.d / 2 + bounds.d * zPos) * 0.78;
      const zAlongEnd = (-bounds.d / 2 + bounds.d * pos) * 0.68;
      const col = new T.Color(colorHex || '#ffffff');
      const mat = new T.MeshStandardMaterial({
        map: tex, transparent: true, alphaTest: 0.04, roughness: 0.24, metalness: 0.2,
        emissive: isText ? col : new T.Color(0x000000),
        emissiveMap: isText ? tex : null,
        emissiveIntensity: isText ? (glow ? 1.35 : 0.35) : 0,
        polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3
      });
      const g = new T.Group();
      let mesh = new T.Mesh(new T.PlaneGeometry(pw, ph), mat);
      mesh.renderOrder = 3;
      if (placement === 'top') {
        g.position.set(xCoord, bounds.deckTopY + 0.015, zAcross);
        mesh.rotation.x = -Math.PI / 2;
      } else if (placement === 'back') {
        g.position.set(xCoord, bounds.backBottomY - 0.015, (-bounds.d / 2 + bounds.d * clamp(Number(el.zPosition ?? 0.5), 0.12, 0.88)) * 0.72);
        mesh.rotation.x = Math.PI / 2;
      } else if (placement === 'opposite' || placement === 'front') {
        g.position.set(xCoord, bounds.shroudMidY, bounds.frontZ + 0.016);
        if (invertSideDecals) mesh.rotation.z = Math.PI;
      } else if (placement === 'right') {
        const endW = Math.min(pw, bounds.d * 0.78);
        mesh.geometry.dispose();
        mesh.geometry = new T.PlaneGeometry(endW, endW * (ph / pw));
        g.position.set(bounds.rightX + 0.016, bounds.shroudMidY, zAlongEnd);
        mesh.rotation.y = Math.PI / 2;
      } else if (placement === 'left') {
        const endW = Math.min(pw, bounds.d * 0.72);
        mesh.geometry.dispose();
        mesh.geometry = new T.PlaneGeometry(endW, endW * (ph / pw));
        g.position.set(bounds.leftX - 0.016, bounds.shroudMidY - 0.02, zAlongEnd);
        mesh.rotation.y = -Math.PI / 2;
      } else {
        g.position.set(xCoord, bounds.shroudMidY, bounds.backZ - 0.016);
        mesh.rotation.y = Math.PI;
        if (invertSideDecals) mesh.rotation.z = Math.PI;
      }
      g.add(mesh);
      elGroup.add(g);
    };

    for (const el of (cfg.elements || [])) {
      if (el.kind === 'text') {
        const scale = clamp(Number(el.size ?? 1.0), 0.55, 1.6);
        const placement = el.placement || 'side';
        const isEdge = placement === 'side' || placement === 'rear' || placement === 'opposite' || placement === 'front' || placement === 'both_sides' || placement === 'right' || placement === 'left';
        const ph = isEdge ? clamp(outerShroudH * 0.85 * scale, 0.09, outerShroudH * 1.1) : Math.min(d * 0.28 * scale, 0.32);
        const pw = Math.min(w * 0.72, ph * 3.85);
        const tex = mkDecalTextTex(el.text || 'GPU', el.color || '#ffffff');
        if (placement === 'both_sides') {
          mountDecal(el, 'side', tex, pw, ph, true, el.color, !!el.glow);
          mountDecal(el, 'opposite', tex, pw, ph, true, el.color, !!el.glow);
        } else mountDecal(el, placement, tex, pw, ph, true, el.color, !!el.glow);
      } else if (el.kind === 'logo') {
        const scale = clamp(Number(el.size ?? 1.0), 0.5, 1.6);
        const placement = el.placement || 'back';
        const isEdge = placement === 'side' || placement === 'rear' || placement === 'opposite' || placement === 'front' || placement === 'both_sides' || placement === 'right' || placement === 'left';
        const sz = isEdge ? clamp(outerShroudH * 0.92 * scale, 0.1, outerShroudH * 1.15) : Math.min(d * 0.52, 0.38) * scale;
        const tex = mkDecalLogoTex(el.logoUrl || '');
        if (placement === 'both_sides') {
          mountDecal(el, 'side', tex, sz, sz, false);
          mountDecal(el, 'opposite', tex, sz, sz, false);
        } else mountDecal(el, placement, tex, sz, sz, false);
      } else if (el.kind === 'accent_bar') {
        const scale = clamp(Number(el.size ?? 1.0), 0.4, 2.0);
        const placement = el.placement || 'top';
        const pos = clamp(Number(el.position ?? 0.5), 0.12, 0.88);
        const zPos = clamp(Number(el.zPosition ?? 0.86), 0.08, 0.92);
        const xCoord = -w / 2 + w * pos;
        const zAcross = (-d / 2 + d * zPos) * 0.78;
        const barW = Math.min(w * 0.75, 0.52 * scale);
        const barMat = new T.MeshPhysicalMaterial({ color: new T.Color(el.color || accentColor || '#a855f7'), metalness: 0.78, roughness: 0.22 });
        if (placement === 'side' || placement === 'rear') mkBox(elGroup, barW, Math.max(0.02, outerShroudH * 0.22), 0.018, barMat, xCoord, mainShroudY, bounds.backZ - 0.012);
        else if (placement === 'back') mkBox(elGroup, barW, 0.014, 0.042, barMat, xCoord, backBottomY - 0.01, zAcross);
        else mkBox(elGroup, barW, 0.015, 0.046, barMat, xCoord, bounds.deckTopY + 0.008, zAcross);
      } else if (el.kind === 'vent_grille') {
        const scale = clamp(Number(el.size ?? 1.0), 0.5, 1.8);
        const placement = el.placement || 'top';
        const pos = clamp(Number(el.position ?? 0.5), 0.12, 0.88);
        const zPos = clamp(Number(el.zPosition ?? 0.86), 0.08, 0.92);
        const xCoord = -w / 2 + w * pos;
        const zAcross = (-d / 2 + d * zPos) * 0.78;
        const gw = Math.min(w * 0.55, 0.36 * scale), gd = Math.min(d * 0.42, 0.16 * scale);
        const vg = new T.Group();
        mkBox(vg, gw, 0.012, gd, new T.MeshPhysicalMaterial({ color: 0x1a1f2b, metalness: 0.72, roughness: 0.32 }), 0, 0, 0);
        if (placement === 'back') vg.position.set(xCoord, backBottomY - 0.009, zAcross);
        else if (placement === 'side' || placement === 'rear') { vg.rotation.x = Math.PI / 2; vg.position.set(xCoord, mainShroudY, bounds.backZ - 0.010); }
        else vg.position.set(xCoord, bounds.deckTopY + 0.006, zAcross);
        elGroup.add(vg);
      } else if (el.kind === 'rgb_strip') {
        const isRainbow = el.colorMode === 'rainbow' || el.color === 'rainbow' || !!el.rainbow;
        const mode = el.placement || 'side';
        const col = new T.Color(isRainbow ? '#a855f7' : (el.color || accentColor || '#a855f7'));
        const mkRgbMat = (off = 0) => {
          const sc = isRainbow ? new T.Color().setHSL(off % 1, 0.95, 0.54) : col;
          const m = new T.MeshStandardMaterial({ color: sc, emissive: sc.clone(), emissiveIntensity: 1.75, roughness: 0.18, metalness: 0.1 });
          if (isRainbow) rgbList.push({ mat: m, offset: off });
          return m;
        };
        const addRail = (spanW, hB, dB, yP, zP) => {
          if (!isRainbow) { mkBox(elGroup, spanW, hB, dB, mkRgbMat(0), 0, yP, zP); return; }
          const segs = 12, segW = spanW / segs;
          for (let i = 0; i < segs; i++) mkBox(elGroup, segW + 0.002, hB, dB, mkRgbMat(i / segs), -spanW / 2 + segW * (i + 0.5), yP, zP);
        };
        if (mode === 'top' || mode === 'halo') {
          addRail(w * 0.84, 0.018, 0.018, bounds.deckTopY + 0.008, d * 0.43);
          addRail(w * 0.84, 0.018, 0.018, bounds.deckTopY + 0.008, -d * 0.43);
        }
        if (mode === 'side' || mode === 'halo') {
          addRail(w * 0.86, 0.02, 0.018, mainShroudY + outerShroudH * 0.25, bounds.frontZ + 0.006);
          addRail(w * 0.86, 0.02, 0.018, mainShroudY + outerShroudH * 0.25, bounds.backZ - 0.006);
        }
        if (mode === 'slash') {
          for (let s = 0; s < 3; s++) {
            const bar = mkBox(elGroup, 0.022, 0.016, d * 0.22, mkRgbMat(s * 0.22), w * 0.31 + s * 0.065, bounds.deckTopY + 0.008, -d * 0.30);
            bar.rotation.y = 0.46;
          }
        }
      }
    }

    root.add(bpLayer, pcbL, hsLayer, shLayer, fnGroup, elGroup);
    return {
      root,
      backplateLayer: bpLayer,
      pcbLayer: pcbL,
      heatsinkLayer: hsLayer,
      shroudLayer: shLayer,
      fansGroup: fnGroup,
      elementsGroup: elGroup,
      fanRotors: rotorList,
      rainbowRgbMats: rgbList,
      dims: { w, d, h, safeLength, safeWidth, safeThickMm, pwrCenterX, pwrY: -h * 0.42 + 0.032, pwrZ: -d * 0.462 }
    };
  }

  function createBladeGeoFor(T, isCurved) {
    const bladeLen = 0.70;
    const bladeWid = isCurved ? 0.22 : 0.25;
    const bShape = new T.Shape();
    bShape.moveTo(0, -bladeWid * 0.3);
    bShape.quadraticCurveTo(bladeLen * 0.5, -bladeWid * (isCurved ? 0.68 : 0.48), bladeLen, -bladeWid * 0.16);
    bShape.lineTo(bladeLen * 0.98, bladeWid * 0.34);
    bShape.quadraticCurveTo(bladeLen * 0.44, bladeWid * 0.48, 0, bladeWid * 0.28);
    bShape.closePath();
    const geo = new T.ExtrudeGeometry(bShape, { depth: 0.008, bevelEnabled: true, bevelSize: 0.0018, bevelThickness: 0.0018, bevelSegments: 1, curveSegments: 6 });
    geo.rotateX(Math.PI / 2);
    return geo;
  }

  window.GpuDesigner3D = {
    DEFAULT_CUSTOM_POINTS,
    buildAssembly: buildStandaloneGpuAssembly,
    mount,
    update,
    setSizeMode,
    setCameraPreset,
    focusPlacement,
    captureSnapshot,
    captureHeroSnapshot,
    enqueueThumbnail,
    resize,
    dispose
  };
})();