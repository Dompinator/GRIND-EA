/* ============================================================
 * GRIND-EA · Procedural 3D GPU CAD Designer (Three.js PBR)
 * Smooth Fan Cutouts · Red/Blue 3D Size Arrows · Modular Elements
 * ============================================================ */
(function () {
  'use strict';

  const DEFAULT_CONFIG = {
    length: 300,       // 210..360 mm
    width: 125,        // 105..150 mm
    thickness: 52,     // 38..76 mm
    body: 'plastic',   // plastic | metallic | carbon
    shroud: 'rounded', // rounded | angular | compact
    primaryColor: '#222733',
    accentColor: '#a855f7',
    backplate: true,
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
  let dockEl = null;
  let sizeHudEl = null;
  let renderer = null;
  let scene = null;
  let camera = null;
  let controls = null;
  let pmremGenerator = null;
  let envTexture = null;
  let resizeObserver = null;

  let gpuRoot = null;
  let backplateLayer = null;
  let pcbLayer = null;
  let heatsinkLayer = null;
  let shroudLayer = null;
  let fansGroup = null;
  let elementsGroup = null;
  let sizeGizmoGroup = null;
  let plinthGroup = null;

  let fanAssemblies = [];     // [{ id, group, rotor, hitMesh, ringMat, yTop, baseEmissive, speed }]
  let draggableDecals = [];   // [{ id, group, hitMesh, minX, maxX, yPlane }]
  let sizeArrowHandles = [];  // [{ axis: 'x'|'z', sign: 1|-1, hitMesh, visualMat, baseColor }]
  const logoImageCache = new Map(); // url -> HTMLImageElement | 'loading'
  const decalTexCache = new Map();  // sig -> THREE.CanvasTexture
  const proceduralTex = {};

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
  let camAnimActive = false;
  const camTargetPos = { x: 2.9, y: 2.45, z: -3.15 };
  const camTargetLook = { x: 0, y: 0.05, z: 0 };

  // Raycast interaction state
  let raycaster = null;
  let pointerNdc = null;
  let dragPlane = null;
  let dragHitPoint = null;
  let activeDrag = null; // { mode: 'size'|'element', axis?, sign?, id?, offsetX?, startLen?, startWid? }
  let pendingRebuild = false;

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
    ctxC.fillStyle = '#8b92a1';
    ctxC.fillRect(0, 0, size, size);
    ctxB.fillStyle = '#383838';
    ctxB.fillRect(0, 0, size, size);
    const cell = 16;
    for (let y = 0; y < size; y += cell) {
      for (let x = 0; x < size; x += cell) {
        const shift = ((y / cell) % 2) * 8;
        const even = ((x + shift) % 32 === 0);
        ctxC.fillStyle = even ? 'rgba(255,255,255,0.34)' : 'rgba(18,22,30,0.45)';
        ctxC.fillRect(x, y, cell - 2, cell / 2 - 1);
        ctxC.fillStyle = even ? 'rgba(255,255,255,0.16)' : 'rgba(18,22,30,0.32)';
        ctxC.fillRect(x + 2, y + cell / 2, cell - 4, cell / 2 - 1);

        ctxB.fillStyle = even ? '#b5b5b5' : '#4a4a4a';
        ctxB.fillRect(x + 1, y + 1, cell - 2, cell / 2 - 1);
      }
    }
    const color = new THREE.CanvasTexture(cc);
    color.colorSpace = THREE.SRGBColorSpace;
    color.wrapS = color.wrapT = THREE.RepeatWrapping;
    color.repeat.set(6, 3);
    color.anisotropy = 8;
    const bump = new THREE.CanvasTexture(cb);
    bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
    bump.repeat.set(6, 3);
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
      if (renderer && gpuRoot) buildModel();
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
  function computeSafeFanLayouts(fanElements, w, d) {
    const hw = w / 2;
    const hd = d / 2;
    const count = fanElements.length;
    if (!count) return [];

    // Sort indices by X position to prevent adjacent cutout hole intersections
    const items = fanElements.map((f, idx) => {
      const pos = clamp(Number(f.position ?? ((idx + 0.5) / count)), 0.08, 0.92);
      const scale = clamp(Number(f.size ?? 1.0), 0.65, 1.25);
      const baseMax = Math.min(d * 0.40, (w * 0.88) / (Math.max(1, count) * 2.04));
      const desiredR = clamp(baseMax * scale, 0.13, hd - 0.075);
      return {
        id: f.id,
        fanType: f.fanType || 'basic',
        pos,
        fx: -hw + w * pos,
        desiredR,
        r: desiredR
      };
    });

    // Ensure every fan hole stays strictly inside outer shroud and non-overlapping with neighbors
    const sorted = [...items].sort((a, b) => a.fx - b.fx);
    const edgePad = 0.068;
    for (const item of sorted) {
      const maxEdgeR = Math.min(hd - edgePad, hw - edgePad - Math.abs(item.fx));
      item.r = clamp(item.desiredR, 0.09, Math.max(0.09, maxEdgeR));
      // If user pushed close to left/right edge, clamp fx inside valid hole zone cleanly
      const maxX = Math.max(0.05, hw - edgePad - item.r);
      item.fx = clamp(item.fx, -maxX, maxX);
    }

    // Resolve any adjacent hole overlaps so ExtrudeGeometry triangulation is always 100% clean
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      const gap = Math.abs(b.fx - a.fx);
      const minClear = 0.045;
      if (gap < a.r + b.r + minClear) {
        const shrinkFactor = Math.max(0.45, (gap - minClear) / Math.max(0.01, a.r + b.r));
        if (gap < 0.24) {
          // Separate gently if stacked almost on top of each other
          const push = (0.24 - gap) * 0.5;
          a.fx = clamp(a.fx - push, -hw + edgePad + 0.09, hw - edgePad - 0.09);
          b.fx = clamp(b.fx + push, -hw + edgePad + 0.09, hw - edgePad - 0.09);
          const newGap = Math.abs(b.fx - a.fx);
          const f2 = Math.max(0.4, (newGap - minClear) / Math.max(0.01, a.r + b.r));
          a.r = Math.max(0.085, a.r * f2);
          b.r = Math.max(0.085, b.r * f2);
        } else {
          a.r = Math.max(0.085, a.r * shrinkFactor);
          b.r = Math.max(0.085, b.r * shrinkFactor);
        }
      }
    }

    return items;
  }

  function createShroudGeometryWithHoles(w, h, d, shapeType, holesList) {
    const hw = w / 2;
    const hd = d / 2;
    const shape = new THREE.Shape();

    if (shapeType === 'angular') {
      const c1 = Math.min(0.17, w * 0.08, d * 0.16);
      shape.moveTo(-hw + c1, -hd);
      shape.lineTo(hw - c1 * 1.4, -hd);
      shape.lineTo(hw, -hd + c1 * 1.3);
      shape.lineTo(hw, hd - c1 * 1.3);
      shape.lineTo(hw - c1 * 1.4, hd);
      shape.lineTo(-hw + c1, hd);
      shape.lineTo(-hw, hd - c1);
      shape.lineTo(-hw, -hd + c1);
      shape.closePath();
    } else if (shapeType === 'compact') {
      const r = Math.min(0.038, w * 0.02, d * 0.04);
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
      const r = Math.min(0.22, w * 0.11, d * 0.25);
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

    // Subtract smooth circular fan cutouts directly from the GPU shroud shape!
    for (const hSpec of holesList) {
      const holeR = hSpec.r * 1.03;
      // Ensure hole stays strictly inside shape bounds with safe bevel clearance
      if (Math.abs(hSpec.fx) + holeR < hw - 0.032 && holeR < hd - 0.032) {
        const hole = new THREE.Path();
        hole.absarc(hSpec.fx, 0, holeR, 0, Math.PI * 2, true);
        shape.holes.push(hole);
      }
    }

    const bevel = shapeType === 'compact' ? 0.012 : 0.022;
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(0.04, h - bevel * 2),
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: shapeType === 'angular' ? 2 : 4,
      curveSegments: 44
    });
    geo.rotateX(-Math.PI / 2);
    geo.computeBoundingBox();
    const minY = geo.boundingBox.min.y;
    const maxY = geo.boundingBox.max.y;
    geo.translate(0, -(minY + maxY) / 2, 0);
    geo.computeVertexNormals();

    // Clean triplanar UV mapping so brushed metal & carbon twill stay crisp without stretching!
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

  function makeBodyMaterial(bodyType, primaryHex, darkenFactor = 1.0) {
    const baseCol = new THREE.Color(primaryHex || '#222733');
    if (darkenFactor !== 1.0) baseCol.multiplyScalar(darkenFactor);

    if (bodyType === 'metallic') {
      const tex = getBrushedMetalTexture();
      return new THREE.MeshPhysicalMaterial({
        color: baseCol,
        map: tex,
        bumpMap: tex,
        bumpScale: 0.005,
        metalness: 0.86,
        roughness: 0.22,
        clearcoat: 0.3,
        clearcoatRoughness: 0.22,
        anisotropy: 0.72
      });
    }
    if (bodyType === 'carbon') {
      const { color, bump } = getCarbonTextures();
      // Keep deep weave contrast while carrying Primary Color tint
      const carbonTint = baseCol.clone().lerp(new THREE.Color(0x555c6e), 0.22);
      return new THREE.MeshPhysicalMaterial({
        color: carbonTint,
        map: color,
        bumpMap: bump,
        bumpScale: 0.011,
        metalness: 0.42,
        roughness: 0.28,
        clearcoat: 0.86,
        clearcoatRoughness: 0.14
      });
    }
    return new THREE.MeshPhysicalMaterial({
      color: baseCol,
      bumpMap: getPlasticBumpTexture(),
      bumpScale: 0.0045,
      metalness: 0.14,
      roughness: 0.44,
      clearcoat: 0.18,
      clearcoatRoughness: 0.36
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

  function buildFanInCutout(layout, index, yBoreCenter, boreDepth, accentMat, primaryHex) {
    const fGroup = new THREE.Group();
    fGroup.position.set(layout.fx, yBoreCenter, 0);
    fGroup.userData.elementId = layout.id;

    const r = layout.r;
    const type = layout.fanType || 'basic';
    const isSmall = type === 'gpu_small_fans';
    const isMedium = type === 'gpu_medium_fans';
    const isSmart = type === 'gpu_smart_fans';

    // Precision CNC-chamfered thin metallic fan cowl ring (no bulky donut torus!)
    const ringMat = new THREE.MeshPhysicalMaterial({
      color: isSmart ? accentMat.color : isMedium ? 0xbec7d5 : isSmall ? 0x8691a2 : 0x454d5e,
      metalness: isSmart || isMedium ? 0.9 : 0.48,
      roughness: isSmart || isMedium ? 0.2 : 0.36,
      clearcoat: 0.3,
      emissive: isSmart ? accentMat.color : new THREE.Color(0x000000),
      emissiveIntensity: isSmart ? 0.28 : 0
    });

    const cowlPts = [
      new THREE.Vector2(r * 0.985, boreDepth * 0.42),
      new THREE.Vector2(r * 0.995, boreDepth * 0.515),
      new THREE.Vector2(r * 1.032, boreDepth * 0.518),
      new THREE.Vector2(r * 1.045, boreDepth * 0.49),
      new THREE.Vector2(r * 1.028, boreDepth * 0.44)
    ];
    const cowlGeo = new THREE.LatheGeometry(cowlPts, 56);
    const boreBezel = new THREE.Mesh(cowlGeo, ringMat);
    fGroup.add(boreBezel);

    // Smooth cylindrical inner bore liner with faint shroud color tie-in
    const sleeveCol = new THREE.Color(primaryHex || '#141822').multiplyScalar(0.45);
    const sleeveMat = new THREE.MeshStandardMaterial({
      color: sleeveCol,
      metalness: 0.45,
      roughness: 0.4,
      side: THREE.DoubleSide
    });
    const sleeve = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 1.025, r * 1.025, boreDepth * 1.01, 56, 1, true),
      sleeveMat
    );
    fGroup.add(sleeve);

    // Subtle thin stator arms supporting hub underneath the rotor
    for (let s = 0; s < 3; s++) {
      const armPivot = new THREE.Group();
      armPivot.rotation.y = (s * Math.PI * 2) / 3 + 0.35;
      const strut = new THREE.Mesh(new THREE.BoxGeometry(r * 0.96, 0.009, 0.014), sleeveMat);
      strut.position.set(r * 0.48, -boreDepth * 0.3, 0);
      armPivot.add(strut);
      fGroup.add(armPivot);
    }

    // Recessed swept axial-tech fan rotor sitting flush inside cutout
    const rotor = new THREE.Group();
    rotor.position.y = boreDepth * 0.14;
    fGroup.add(rotor);

    const bladeCount = isSmart ? 13 : isMedium ? 11 : isSmall ? 9 : 7;
    const bladeLen = r * 0.70;
    const bladeWid = r * (isSmart ? 0.21 : isMedium ? 0.23 : 0.25);
    const bladePitch = isSmart ? 0.46 : isMedium ? 0.42 : 0.36;
    const bladeMat = new THREE.MeshPhysicalMaterial({
      color: isSmart ? 0x262d3d : isMedium ? 0x1e2432 : isSmall ? 0x181c26 : 0x141720,
      metalness: isSmart ? 0.48 : 0.26,
      roughness: isSmart ? 0.24 : 0.32,
      clearcoat: 0.58,
      clearcoatRoughness: 0.2
    });

    const bShape = new THREE.Shape();
    bShape.moveTo(0, -bladeWid * 0.3);
    bShape.quadraticCurveTo(bladeLen * 0.5, -bladeWid * (isMedium || isSmart ? 0.68 : 0.48), bladeLen, -bladeWid * 0.16);
    bShape.lineTo(bladeLen * 0.98, bladeWid * 0.34);
    bShape.quadraticCurveTo(bladeLen * 0.44, bladeWid * 0.48, 0, bladeWid * 0.28);
    bShape.closePath();
    const bladeGeo = new THREE.ExtrudeGeometry(bShape, { depth: 0.008, bevelEnabled: true, bevelSize: 0.002, bevelThickness: 0.002, bevelSegments: 1 });
    bladeGeo.rotateX(Math.PI / 2);

    for (let i = 0; i < bladeCount; i++) {
      const pivot = new THREE.Group();
      pivot.rotation.y = (i / bladeCount) * Math.PI * 2;
      const blade = new THREE.Mesh(bladeGeo, bladeMat);
      blade.position.set(r * 0.23, 0, 0);
      blade.rotation.x = bladePitch;
      if (isMedium || isSmart) blade.rotation.z = 0.08;
      pivot.add(blade);
      rotor.add(pivot);
    }

    if (isSmart || isMedium) {
      const barrier = new THREE.Mesh(
        new THREE.CylinderGeometry(r * 0.945, r * 0.945, 0.018, 48, 1, true),
        bladeMat
      );
      rotor.add(barrier);
    }

    // Stepped machined metallic spinner hub + crisp accent center ring
    const hubMat = new THREE.MeshPhysicalMaterial({
      color: isSmart || isMedium ? 0xcfd7e3 : 0x2f3646,
      metalness: isSmart || isMedium ? 0.9 : 0.55,
      roughness: 0.22,
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
    const hub = new THREE.Mesh(new THREE.LatheGeometry(hubPts, 36), hubMat);
    rotor.add(hub);

    const centerRing = new THREE.Mesh(
      new THREE.RingGeometry(r * 0.125, r * 0.165, 36),
      ringMat
    );
    centerRing.rotation.x = -Math.PI / 2;
    centerRing.position.y = 0.0235;
    rotor.add(centerRing);

    // Invisible drag hit volume for easy repositioning
    const hitMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 1.02, r * 1.02, Math.max(0.14, boreDepth * 1.6), 16),
      new THREE.MeshBasicMaterial({ visible: false })
    );
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
      baseEmissive: isSmart ? 0.28 : 0,
      speed: isSmart ? 3.4 : isMedium ? 2.6 : isSmall ? 2.9 : 2.1
    });
  }

  function mountSingleDecalMesh(el, placement, bounds, tex, planeW, planeH, isText, colorHex) {
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
      emissiveIntensity: isText ? 0.35 : 0,
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
      // 'side' / 'rear' -> Main Power Side (-Z edge) with no black box backing
      g.position.set(xCoord, bounds.shroudMidY, bounds.backZ - 0.016);
      mesh.rotation.y = Math.PI;
      dragPlaneAxis = 'z';
      dragPlaneConst = g.position.z;
    }

    g.add(mesh);

    const hitW = (placement === 'right' || placement === 'left') ? 0.14 : planeW * 1.15;
    const hitH = (placement === 'top' || placement === 'back') ? 0.16 : Math.max(0.14, planeH * 1.5);
    const hitD = (placement === 'right' || placement === 'left') ? planeW * 1.15 : (placement === 'top' || placement === 'back') ? planeH * 1.5 : 0.16;
    const hitMesh = new THREE.Mesh(
      new THREE.BoxGeometry(hitW, hitH, hitD),
      new THREE.MeshBasicMaterial({ visible: false })
    );
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

  function buildPlacedDecalsAndStrips(bounds, accentHex) {
    const elements = Array.isArray(config.elements) ? config.elements : [];

    for (const el of elements) {
      if (el.kind === 'text') {
        const scale = clamp(Number(el.size ?? 1.0), 0.55, 1.6);
        const placement = el.placement || 'side';
        const isEdge = placement === 'side' || placement === 'rear' || placement === 'opposite' || placement === 'front' || placement === 'both_sides' || placement === 'right' || placement === 'left';
        const planeH = isEdge ? clamp(bounds.outerShroudH * 0.85 * scale, 0.09, bounds.outerShroudH * 1.1) : Math.min(bounds.d * 0.28 * scale, 0.32);
        const planeW = Math.min(bounds.w * 0.72, planeH * 3.85);
        const tex = getTextDecalTexture(el.text || 'GPU', el.color || '#ffffff');

        if (placement === 'both_sides') {
          mountSingleDecalMesh(el, 'side', bounds, tex, planeW, planeH, true, el.color);
          mountSingleDecalMesh(el, 'opposite', bounds, tex, planeW, planeH, true, el.color);
        } else {
          mountSingleDecalMesh(el, placement, bounds, tex, planeW, planeH, true, el.color);
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
      } else if (el.kind === 'rgb_strip') {
        const col = new THREE.Color(el.color || accentHex || '#a855f7');
        const rgbMat = new THREE.MeshStandardMaterial({
          color: col,
          emissive: col,
          emissiveIntensity: 1.75,
          roughness: 0.18,
          metalness: 0.1
        });
        const mode = el.placement || 'side';
        if (mode === 'top' || mode === 'halo') {
          makeBox(elementsGroup, bounds.w * 0.84, 0.018, 0.018, rgbMat, 0, bounds.deckTopY + 0.008, bounds.d * 0.43);
          makeBox(elementsGroup, bounds.w * 0.84, 0.018, 0.018, rgbMat, 0, bounds.deckTopY + 0.008, -bounds.d * 0.43);
        }
        if (mode === 'side' || mode === 'halo') {
          makeBox(elementsGroup, bounds.w * 0.86, 0.02, 0.018, rgbMat, 0, bounds.shroudMidY + bounds.outerShroudH * 0.25, bounds.frontZ + 0.006);
          makeBox(elementsGroup, bounds.w * 0.86, 0.02, 0.018, rgbMat, 0, bounds.shroudMidY + bounds.outerShroudH * 0.25, bounds.backZ - 0.006);
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
        if (obj.geometry && typeof obj.geometry.dispose === 'function') obj.geometry.dispose();
        if (Array.isArray(obj.material)) obj.material.forEach(m => m?.dispose?.());
        else if (obj.material && typeof obj.material.dispose === 'function') obj.material.dispose();
      });
    }
  }

  function buildModel() {
    if (!THREE || !gpuRoot) return;

    disposeGroupContents(backplateLayer);
    disposeGroupContents(pcbLayer);
    disposeGroupContents(heatsinkLayer);
    disposeGroupContents(shroudLayer);
    disposeGroupContents(fansGroup);
    disposeGroupContents(elementsGroup);
    fanAssemblies = [];
    draggableDecals = [];

    const safeLength = clamp(Math.round(Number(config.length) || 300), GPU_MIN_LEN, GPU_MAX_LEN);
    const safeWidth = clampWidthForLength(config.width, safeLength);
    config.length = safeLength;
    config.width = safeWidth;

    const lenScale = safeLength / 300;
    const widScale = safeWidth / 125;
    const thickScale = clamp(Number(config.thickness || 52) / 52, 0.8, 1.35);

    const w = 2.85 * lenScale;
    const d = 1.18 * widScale;
    const h = 0.25 * thickScale;

    const bodyType = config.body || 'plastic';
    const shapeType = config.shroud || 'rounded';
    const primaryColor = config.primaryColor || '#222733';
    const accentColor = config.accentColor || '#a855f7';

    const shroudMat = makeBodyMaterial(bodyType, primaryColor, 1.0);
    // Complementary stepped trim deck material derived cleanly from primaryColor
    const primaryLuminance = new THREE.Color(primaryColor).getHSL({ h: 0, s: 0, l: 0 }).l;
    const deckMat = makeBodyMaterial(bodyType === 'carbon' ? 'metallic' : bodyType, primaryColor, primaryLuminance > 0.45 ? 0.78 : 0.68);
    const darkMat = new THREE.MeshPhysicalMaterial({ color: 0x11151e, metalness: 0.55, roughness: 0.36, clearcoat: 0.15 });
    const trimMetal = new THREE.MeshPhysicalMaterial({ color: 0xc2cbd6, metalness: 0.92, roughness: 0.2, anisotropy: 0.72 });
    const accentMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(accentColor),
      metalness: bodyType === 'metallic' ? 0.78 : 0.44,
      roughness: 0.22,
      clearcoat: 0.45
    });
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xe2bc5e, metalness: 0.94, roughness: 0.18 });
    const copperMat = new THREE.MeshPhysicalMaterial({ color: 0xd47a45, metalness: 0.95, roughness: 0.18, anisotropy: 0.55 });
    const nickelPipeMat = new THREE.MeshPhysicalMaterial({ color: 0xcfd7e4, metalness: 0.95, roughness: 0.16, clearcoat: 0.25 });
    const finMat = new THREE.MeshPhysicalMaterial({ color: 0xc8d2df, metalness: 0.92, roughness: 0.24, anisotropy: 0.72 });
    const pcbMat = new THREE.MeshPhysicalMaterial({ map: getPcbTexture(), metalness: 0.2, roughness: 0.48, clearcoat: 0.14 });

    // Compute smooth non-overlapping fan cutout layouts
    const fanElements = (config.elements || []).filter(e => e.kind === 'fan').slice(0, 6);
    const fanLayouts = computeSafeFanLayouts(fanElements, w, d);
    const dummy = new THREE.Object3D();

    // ---- 1. Backplate Layer (Primary Color & Finish + Flow-Through Louvers + Retention X-Bracket) ----
    if (config.backplate !== false) {
      const bpMat = makeBodyMaterial(bodyType, primaryColor, 0.92);
      const bpGeo = createShroudGeometryWithHoles(w * 0.96, 0.032, d * 0.95, shapeType === 'angular' ? 'angular' : 'compact', []);
      const bp = new THREE.Mesh(bpGeo, bpMat);
      bp.position.y = -h * 0.62 - 0.058;
      bp.castShadow = !isSoftwareGl;
      bp.receiveShadow = !isSoftwareGl;
      backplateLayer.add(bp);

      const bpUndersideY = bp.position.y - 0.017;
      // Machined flow-through exhaust louver slots + secondary pinstripe rail
      for (let i = 0; i < 7; i++) {
        makeBox(backplateLayer, 0.016, 0.008, d * 0.48, darkMat, w * 0.15 + i * w * 0.038, bpUndersideY, 0);
      }
      makeBox(backplateLayer, w * 0.64, 0.009, 0.016, accentMat, -w * 0.06, bpUndersideY, -d * 0.36);

      // Anodized steel GPU core retention X-bracket + corner Torx screws
      const xBrk1 = makeBox(backplateLayer, 0.32, 0.012, 0.036, trimMetal, -0.05, bpUndersideY - 0.003, 0);
      xBrk1.rotation.y = Math.PI / 4;
      const xBrk2 = makeBox(backplateLayer, 0.32, 0.012, 0.036, trimMetal, -0.05, bpUndersideY - 0.003, 0);
      xBrk2.rotation.y = -Math.PI / 4;
      for (const sx of [-w * 0.41, -0.17, 0.07, w * 0.41]) {
        for (const sz of [-d * 0.36, d * 0.36]) {
          const isBracket = (sx === -0.17 || sx === 0.07);
          if (isBracket && Math.abs(sz) > d * 0.25) continue;
          const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.012, 6), trimMetal);
          screw.position.set(sx, bpUndersideY - 0.002, sz);
          backplateLayer.add(screw);
        }
      }
    }

    // ---- 2. High-Density 12-Layer PCB + Iridescent Die + GDDR6X Array + VRM + 12V-2x6 + Slotted I/O ----
    makeBox(pcbLayer, w * 0.96, 0.032, d * 0.92, pcbMat, 0, -h * 0.42, 0);
    // GPU substrate interposer + retention shim frame + iridescent lithography die (matching CPU)
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

    // 10-chip GDDR6X VRAM array surrounding the GPU package
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

    // VRM Alloy Chokes + Solid-State Polymer Capacitors
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

    // Textured Gold PCIe 5.0 x16 Connector (+Z edge)
    const pcieMat = new THREE.MeshStandardMaterial({ map: getPcieFingersTexture(), metalness: 0.72, roughness: 0.25 });
    makeBox(pcbLayer, w * 0.44, 0.022, 0.088, pcieMat, -w * 0.13, -h * 0.42, d * 0.485);

    // Detailed 12V-2x6 (16-Pin) Power Header (-Z Power Side) with molded shroud & gold pin matrix
    const pwrX = w * 0.22;
    const pwrZ = -d * 0.462;
    makeBox(pcbLayer, 0.2, 0.068, 0.085, darkMat, pwrX, -h * 0.42 + 0.032, pwrZ);
    makeBox(pcbLayer, 0.16, 0.044, 0.02, new THREE.MeshStandardMaterial({ color: 0x07090e, roughness: 0.7 }), pwrX, -h * 0.42 + 0.034, pwrZ - 0.036);
    const pinMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.012, 0.012, 0.024), goldMat, 12);
    let pi = 0;
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 6; c++) {
        dummy.position.set(pwrX - 0.055 + c * 0.022, -h * 0.42 + 0.026 + r * 0.018, pwrZ - 0.04);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        pinMesh.setMatrixAt(pi++, dummy.matrix);
      }
    }
    pcbLayer.add(pinMesh);

    // Dual-slot Stainless Steel I/O Bracket (-X end) with louvered vents + 4 recessed DisplayPort/HDMI ports
    const ioX = -w * 0.5 - 0.018;
    makeBox(pcbLayer, 0.026, h * 1.12, d * 0.94, trimMetal, ioX, 0, 0);
    makeBox(pcbLayer, 0.065, 0.028, d * 0.94, trimMetal, ioX + 0.01, -h * 0.55, 0);
    // Slotted airflow louvers on top half of stainless bracket
    for (let v = 0; v < 5; v++) {
      makeBox(pcbLayer, 0.032, 0.016, d * 0.12, darkMat, ioX - 0.002, h * 0.28, -d * 0.34 + v * d * 0.17);
    }
    // 4 recessed metal display cages (3× DisplayPort + 1× HDMI)
    for (let i = 0; i < 4; i++) {
      const pz = -d * 0.3 + i * d * 0.2;
      makeBox(pcbLayer, 0.038, 0.042, 0.105, trimMetal, ioX - 0.012, -h * 0.1, pz);
      makeBox(pcbLayer, 0.042, 0.022, 0.082, darkMat, ioX - 0.015, -h * 0.1, pz);
    }

    // ---- 3. High-Density Stamped Radiator Fins + Copper Vapor Chamber + 5 Heatpipes ----
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

    // Internal structural anti-sag spine rail linking heatsink stack cleanly
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
      const pipe = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 28, 0.019, 14, false),
        i % 2 === 0 ? copperMat : nickelPipeMat
      );
      heatsinkLayer.add(pipe);
    }

    // ---- 4. Sculpted Multi-Piece Shroud + Seamless Fan Cutouts (Zero Protruding Boxes!) ----
    const outerShroudH = h * 0.62;
    const mainShroudY = h * 0.26;
    const mainShroudGeo = createShroudGeometryWithHoles(w, outerShroudH, d, shapeType, fanLayouts);
    const mainShroud = new THREE.Mesh(mainShroudGeo, shroudMat);
    mainShroud.position.y = mainShroudY;
    mainShroud.castShadow = !isSoftwareGl;
    mainShroud.receiveShadow = !isSoftwareGl;
    shroudLayer.add(mainShroud);

    // Inset stepped inner trim bezel matching Primary Color tone (zero overhang!)
    const deckH = 0.034;
    const deckY = mainShroudY + outerShroudH * 0.44;
    const deckGeo = createShroudGeometryWithHoles(w * 0.90, deckH, d * 0.86, shapeType, fanLayouts);
    const deckMesh = new THREE.Mesh(deckGeo, deckMat);
    deckMesh.position.y = deckY;
    shroudLayer.add(deckMesh);

    // Precision Secondary (Accent) Trim Pinstripes safely inset along Power Side (-Z) & Opposite Edge (+Z)
    for (const side of [-1, 1]) {
      makeBox(shroudLayer, w * 0.72, 0.014, 0.014, accentMat, 0, deckY + 0.012, side * d * 0.445);
    }

    // Milled perimeter Torx shroud screws (clean hardware detail on all 4 corners)
    const screwX = w * 0.42;
    const screwZ = d * 0.37;
    const screwTopY = deckY + deckH * 0.5 + 0.004;
    for (const sx of [-screwX, screwX]) {
      for (const sz of [-screwZ, screwZ]) {
        const sHead = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.008, 6), trimMetal);
        sHead.position.set(sx, screwTopY, sz);
        shroudLayer.add(sHead);
      }
    }

    // ---- 5. Recessed Machined Fans Seated Inside Their Cutouts ----
    const boreCenterY = mainShroudY + 0.02;
    const boreDepth = outerShroudH + 0.02;
    fanLayouts.forEach((layout, i) => buildFanInCutout(layout, i, boreCenterY, boreDepth, accentMat, primaryColor));

    // ---- 6. Modular Placed Elements (Exact Outer Surface Bounding Boxes) ----
    mainShroudGeo.computeBoundingBox();
    deckGeo.computeBoundingBox();
    const mainBox = mainShroudGeo.boundingBox;
    const deckBox = deckGeo.boundingBox;
    let backBottomY = -h * 0.42 - 0.02;
    if (backplateLayer.children[0]?.geometry) {
      backplateLayer.children[0].geometry.computeBoundingBox();
      backBottomY = backplateLayer.children[0].position.y + backplateLayer.children[0].geometry.boundingBox.min.y;
    }
    const surfaceBounds = {
      w,
      d,
      outerShroudH,
      shroudMidY: mainShroudY + (mainBox.min.y + mainBox.max.y) * 0.5,
      frontZ: mainBox.max.z,
      backZ: mainBox.min.z,
      rightX: mainBox.max.x,
      leftX: -w * 0.5 - 0.045,
      deckTopY: deckY + deckBox.max.y,
      backBottomY
    };
    buildPlacedDecalsAndStrips(surfaceBounds, accentColor);

    // ---- 7. Red & Blue Size Arrows (when Change Size active) ----
    buildSizeGizmos(w, d);

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
        ' <small>(210–360 × 105–150 mm · Drag Red or Blue arrows)</small>';
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
                callbacks.onSizeChange?.({ length: config.length, width: config.width });
              }
            } else {
              const targetHalfD = Math.max(0.25, localPt.z * activeDrag.sign - 0.24);
              const rawWid = ((targetHalfD * 2) / 1.18) * 125;
              const newWid = clampWidthForLength(rawWid, config.length);
              if (newWid !== config.width) {
                config.width = newWid;
                pendingRebuild = true;
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
              } else {
                const x = clamp(localPt.x + activeDrag.offsetX, -w * 0.4, w * 0.4);
                el.position = clamp(Number(((x + w / 2) / w).toFixed(3)), 0.1, 0.9);
                if (activeDrag.dragKind === 'decal' && (activeDrag.placement === 'top' || activeDrag.placement === 'back')) {
                  const z = clamp(localPt.z + activeDrag.offsetZ, -d * 0.42, d * 0.42);
                  el.zPosition = clamp(Number(((z / 0.78 + d / 2) / d).toFixed(3)), 0.08, 0.92);
                }
                pendingRebuild = true;
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
    };
    dom.addEventListener('pointerup', releaseDrag);
    dom.addEventListener('pointercancel', releaseDrag);
  }

  // ---------- Animation Loop ----------
  function stepAnimation(dt) {
    if (pendingRebuild) {
      pendingRebuild = false;
      buildModel();
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
      if (renderer.domElement.parentNode !== el) el.prepend(renderer.domElement);
      if (sizeHudEl && sizeHudEl.parentNode !== el) el.appendChild(sizeHudEl);
      if (dockEl && dockEl.parentNode !== el) el.appendChild(dockEl);
      resizeObserver?.disconnect();
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(el);
      resize();
      buildModel();
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

  function update(next) {
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
    buildModel();
    resize();
  }

  function captureSnapshot() {
    if (!renderer || !scene || !camera || contextLost) return '';
    try {
      const prevPos = camera.position.clone();
      const prevTarget = controls ? controls.target.clone() : new THREE.Vector3(0, 0.05, 0);
      const prevSpin = gpuRoot ? gpuRoot.rotation.y : 0;
      const prevExp = currentExplode;
      const prevGizmo = sizeGizmoGroup ? sizeGizmoGroup.visible : false;

      if (gpuRoot) gpuRoot.rotation.y = 0;
      if (sizeGizmoGroup) sizeGizmoGroup.visible = false;
      currentExplode = 0;
      camera.position.set(2.8, 2.2, -2.98);
      camera.lookAt(0, 0.05, 0);
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      const dataUrl = renderer.domElement.toDataURL('image/webp', 0.84);

      if (sizeGizmoGroup) sizeGizmoGroup.visible = prevGizmo;
      camera.position.copy(prevPos);
      if (controls) controls.target.copy(prevTarget);
      camera.lookAt(prevTarget);
      if (gpuRoot) gpuRoot.rotation.y = prevSpin;
      currentExplode = prevExp;
      renderer.render(scene, camera);
      return dataUrl;
    } catch (_) {
      return '';
    }
  }

  function dispose() {
    stopLoop();
    resizeObserver?.disconnect();
    resizeObserver = null;
    controls?.dispose?.();
    disposeGroupContents(backplateLayer);
    disposeGroupContents(pcbLayer);
    disposeGroupContents(heatsinkLayer);
    disposeGroupContents(shroudLayer);
    disposeGroupContents(fansGroup);
    disposeGroupContents(elementsGroup);
    disposeGroupContents(sizeGizmoGroup);
    disposeGroupContents(plinthGroup);
    Object.values(proceduralTex).forEach(t => t?.dispose?.());
    decalTexCache.forEach(t => t?.dispose?.());
    decalTexCache.clear();
    envTexture?.dispose?.();
    pmremGenerator?.dispose?.();
    renderer?.dispose?.();
    renderer = null;
    scene = null;
    camera = null;
    controls = null;
    gpuRoot = null;
    dockEl = null;
    sizeHudEl = null;
  }

  window.GpuDesigner3D = { mount, update, setSizeMode, setCameraPreset, focusPlacement, captureSnapshot, resize, dispose };
})();