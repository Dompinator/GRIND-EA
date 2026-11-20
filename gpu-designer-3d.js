/* ============================================================
 * GRIND-EA · Procedural 3D GPU CAD Designer (Three.js PBR)
 * Smooth Fan Cutouts · Red/Blue 3D Size Arrows · Modular Elements
 * ============================================================ */
(function () {
  'use strict';

  const DEFAULT_CONFIG = {
    length: 300,       // 180..420 mm
    width: 125,        // 90..180 mm
    thickness: 52,     // 38..76 mm
    body: 'plastic',   // plastic | metallic | carbon
    shroud: 'rounded', // rounded | angular | compact
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
      const n = 120 + Math.floor(Math.random() * 20);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = n;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(7, 3.5);
    proceduralTex.plasticBump = tex;
    return tex;
  }

  function getBrushedMetalTexture() {
    if (proceduralTex.brushedMetal) return proceduralTex.brushedMetal;
    const w = 512, h = 256;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#aeb8c4';
    ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y++) {
      const v = 158 + Math.floor(Math.random() * 38);
      ctx.fillStyle = `rgb(${v},${v + 3},${v + 8})`;
      ctx.fillRect(0, y, w, 1);
    }
    for (let i = 0; i < 450; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const len = 35 + Math.random() * 140;
      ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.09)' : 'rgba(12,16,24,0.08)';
      ctx.fillRect(x, y, len, 1);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 2);
    tex.anisotropy = 8;
    proceduralTex.brushedMetal = tex;
    return tex;
  }

  function getCarbonTextures() {
    if (proceduralTex.carbonColor) return { color: proceduralTex.carbonColor, bump: proceduralTex.carbonBump };
    const size = 128;
    const cc = document.createElement('canvas');
    const cb = document.createElement('canvas');
    cc.width = cc.height = cb.width = cb.height = size;
    const ctxC = cc.getContext('2d');
    const ctxB = cb.getContext('2d');
    const cell = 16;
    for (let y = 0; y < size; y += cell) {
      for (let x = 0; x < size; x += cell) {
        const shift = ((x / cell + y / cell) % 2) === 0;
        const g = ctxC.createLinearGradient(x, y, x + cell, y + cell);
        if (shift) {
          g.addColorStop(0, '#141820');
          g.addColorStop(0.5, '#303848');
          g.addColorStop(1, '#151922');
        } else {
          g.addColorStop(0, '#1f2530');
          g.addColorStop(0.5, '#0e1118');
          g.addColorStop(1, '#282f3e');
        }
        ctxC.fillStyle = g;
        ctxC.fillRect(x, y, cell, cell);
        ctxB.fillStyle = shift ? '#bcbcbc' : '#5e5e5e';
        ctxB.fillRect(x + 1, y + 1, cell - 2, cell - 2);
      }
    }
    const color = new THREE.CanvasTexture(cc);
    color.colorSpace = THREE.SRGBColorSpace;
    color.wrapS = color.wrapT = THREE.RepeatWrapping;
    color.repeat.set(11, 5.5);
    color.anisotropy = 8;
    const bump = new THREE.CanvasTexture(cb);
    bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
    bump.repeat.set(11, 5.5);
    proceduralTex.carbonColor = color;
    proceduralTex.carbonBump = bump;
    return { color, bump };
  }

  function getPcbTexture() {
    if (proceduralTex.pcb) return proceduralTex.pcb;
    const w = 512, h = 256;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#0c1c17';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(44, 134, 96, 0.34)';
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 44; i++) {
      const y = 16 + (i * 224) / 44;
      ctx.beginPath();
      ctx.moveTo(10, y);
      ctx.lineTo(130 + (i % 5) * 32, y);
      ctx.lineTo(165 + (i % 5) * 32, y + (i % 2 === 0 ? 10 : -10));
      ctx.lineTo(w - 14, y + (i % 2 === 0 ? 10 : -10));
      ctx.stroke();
    }
    // GDDR VRAM module silkscreen + pads around die
    ctx.strokeStyle = 'rgba(212, 175, 95, 0.45)';
    ctx.strokeRect(188, 72, 114, 112);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      ctx.fillStyle = '#181c24';
      ctx.fillRect(245 + Math.cos(a) * 76 - 9, 128 + Math.sin(a) * 62 - 7, 18, 14);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    proceduralTex.pcb = tex;
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

    const bevel = shapeType === 'compact' ? 0.012 : 0.026;
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(0.04, h - bevel * 2),
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: shapeType === 'angular' ? 1 : 4,
      curveSegments: 40
    });
    geo.rotateX(-Math.PI / 2);
    geo.computeBoundingBox();
    const minY = geo.boundingBox.min.y;
    const maxY = geo.boundingBox.max.y;
    geo.translate(0, -(minY + maxY) / 2, 0);
    return geo;
  }

  function makeBodyMaterial(bodyType) {
    if (bodyType === 'metallic') {
      const tex = getBrushedMetalTexture();
      return new THREE.MeshPhysicalMaterial({
        color: 0xc2cbd8,
        map: tex,
        bumpMap: tex,
        bumpScale: 0.007,
        metalness: 0.9,
        roughness: 0.22,
        clearcoat: 0.35,
        clearcoatRoughness: 0.25
      });
    }
    if (bodyType === 'carbon') {
      const { color, bump } = getCarbonTextures();
      return new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        map: color,
        bumpMap: bump,
        bumpScale: 0.012,
        metalness: 0.38,
        roughness: 0.32,
        clearcoat: 0.82,
        clearcoatRoughness: 0.16
      });
    }
    return new THREE.MeshStandardMaterial({
      color: 0x262936,
      bumpMap: getPlasticBumpTexture(),
      bumpScale: 0.006,
      metalness: 0.12,
      roughness: 0.56
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

  function buildFanInCutout(layout, index, yBoreCenter, boreDepth, accentMat) {
    const fGroup = new THREE.Group();
    fGroup.position.set(layout.fx, yBoreCenter, 0);
    fGroup.userData.elementId = layout.id;

    const r = layout.r;
    const type = layout.fanType || 'basic';
    const isSmall = type === 'gpu_small_fans';
    const isMedium = type === 'gpu_medium_fans';
    const isSmart = type === 'gpu_smart_fans';

    // Machined fan bore trim ring framing the subtracted shroud cutout smoothly
    const ringMat = new THREE.MeshStandardMaterial({
      color: isSmart ? accentMat.color : isMedium ? 0xadb7c6 : isSmall ? 0x768191 : 0x3b4150,
      metalness: isSmart || isMedium ? 0.85 : 0.3,
      roughness: isSmart || isMedium ? 0.22 : 0.45,
      emissive: isSmart ? accentMat.color : new THREE.Color(0x000000),
      emissiveIntensity: isSmart ? 0.25 : 0
    });
    const boreBezel = new THREE.Mesh(
      new THREE.TorusGeometry(r * 1.03, Math.max(0.014, r * 0.048), 14, 48),
      ringMat
    );
    boreBezel.rotation.x = Math.PI / 2;
    boreBezel.position.y = boreDepth * 0.5;
    fGroup.add(boreBezel);

    // Smooth cylindrical inner bore sleeve lining the cutout wall cleanly
    const sleeveMat = new THREE.MeshStandardMaterial({
      color: 0x0e1118,
      metalness: 0.4,
      roughness: 0.42,
      side: THREE.DoubleSide
    });
    const sleeve = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 1.03, r * 1.03, boreDepth * 1.02, 48, 1, true),
      sleeveMat
    );
    fGroup.add(sleeve);

    // Three subtle stator struts underneath the rotor connecting hub to bore wall
    for (let s = 0; s < 3; s++) {
      const armPivot = new THREE.Group();
      armPivot.rotation.y = (s * Math.PI * 2) / 3 + 0.35;
      const strut = new THREE.Mesh(new THREE.BoxGeometry(r * 0.96, 0.012, 0.018), sleeveMat);
      strut.position.set(r * 0.48, -boreDepth * 0.28, 0);
      armPivot.add(strut);
      fGroup.add(armPivot);
    }

    // Rotor sits RECESSED neatly inside the shroud hole!
    const rotor = new THREE.Group();
    rotor.position.y = boreDepth * 0.16;
    fGroup.add(rotor);

    const bladeCount = isSmart ? 13 : isMedium ? 11 : isSmall ? 9 : 7;
    const bladeLen = r * 0.68;
    const bladeWid = r * (isSmart ? 0.22 : isMedium ? 0.24 : 0.26);
    const bladePitch = isSmart ? 0.46 : isMedium ? 0.42 : 0.37;
    const bladeMat = new THREE.MeshStandardMaterial({
      color: isSmart ? 0x2c3447 : isMedium ? 0x232936 : isSmall ? 0x1c212b : 0x171b23,
      metalness: isSmart ? 0.62 : isMedium ? 0.48 : 0.2,
      roughness: isSmart ? 0.24 : 0.38
    });

    const bShape = new THREE.Shape();
    bShape.moveTo(0, -bladeWid * 0.35);
    bShape.quadraticCurveTo(bladeLen * 0.55, -bladeWid * (isMedium || isSmart ? 0.64 : 0.44), bladeLen, -bladeWid * 0.22);
    bShape.lineTo(bladeLen, bladeWid * 0.38);
    bShape.quadraticCurveTo(bladeLen * 0.45, bladeWid * 0.46, 0, bladeWid * 0.3);
    bShape.closePath();
    const bladeGeo = new THREE.ExtrudeGeometry(bShape, { depth: 0.012, bevelEnabled: false });
    bladeGeo.rotateX(Math.PI / 2);

    for (let i = 0; i < bladeCount; i++) {
      const pivot = new THREE.Group();
      pivot.rotation.y = (i / bladeCount) * Math.PI * 2;
      const blade = new THREE.Mesh(bladeGeo, bladeMat);
      blade.position.set(r * 0.24, 0, 0);
      blade.rotation.x = bladePitch;
      if (isMedium || isSmart) blade.rotation.z = 0.07;
      pivot.add(blade);
      rotor.add(pivot);
    }

    if (isSmart || isMedium) {
      const barrier = new THREE.Mesh(new THREE.TorusGeometry(r * 0.93, 0.011, 8, 44), bladeMat);
      barrier.rotation.x = Math.PI / 2;
      rotor.add(barrier);
    }

    // Center hub + metallic cap
    const hubMat = new THREE.MeshStandardMaterial({
      color: isSmart || isMedium ? 0xd2dbe7 : 0x2a303d,
      metalness: isSmart || isMedium ? 0.88 : 0.35,
      roughness: isSmart || isMedium ? 0.2 : 0.45
    });
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.26, r * 0.28, 0.038, 32), hubMat);
    hub.position.y = 0.004;
    rotor.add(hub);

    const centerRing = new THREE.Mesh(
      new THREE.RingGeometry(r * 0.14, r * 0.21, 32),
      ringMat
    );
    centerRing.rotation.x = -Math.PI / 2;
    centerRing.position.y = 0.025;
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
      baseEmissive: isSmart ? 0.25 : 0,
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
    const accentColor = config.accentColor || '#a855f7';

    const shroudMat = makeBodyMaterial(bodyType);
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x10131b, metalness: 0.45, roughness: 0.42 });
    const trimMetal = new THREE.MeshStandardMaterial({ color: 0xa2adbc, metalness: 0.88, roughness: 0.22 });
    const accentMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(accentColor),
      metalness: bodyType === 'metallic' ? 0.72 : 0.36,
      roughness: 0.28
    });
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xd9b15f, metalness: 0.92, roughness: 0.2 });
    const copperMat = new THREE.MeshStandardMaterial({ color: 0xc47b43, metalness: 0.9, roughness: 0.2 });
    const finMat = new THREE.MeshStandardMaterial({ color: 0xbcc6d4, metalness: 0.86, roughness: 0.26 });
    const pcbMat = new THREE.MeshStandardMaterial({ map: getPcbTexture(), metalness: 0.24, roughness: 0.52 });

    // Compute smooth non-overlapping fan cutout layouts
    const fanElements = (config.elements || []).filter(e => e.kind === 'fan').slice(0, 6);
    const fanLayouts = computeSafeFanLayouts(fanElements, w, d);

    // ---- 1. Backplate Layer ----
    if (config.backplate !== false) {
      const bpMat = bodyType === 'carbon'
        ? makeBodyMaterial('carbon')
        : bodyType === 'metallic'
          ? makeBodyMaterial('metallic')
          : new THREE.MeshStandardMaterial({ color: 0x1b1f2b, metalness: 0.5, roughness: 0.38 });
      const bpGeo = createShroudGeometryWithHoles(w * 0.96, 0.036, d * 0.96, shapeType === 'angular' ? 'angular' : 'compact', []);
      const bp = new THREE.Mesh(bpGeo, bpMat);
      bp.position.y = -h * 0.62 - 0.062;
      bp.castShadow = !isSoftwareGl;
      bp.receiveShadow = !isSoftwareGl;
      backplateLayer.add(bp);

      // Flow-through cooling vent ribs + precision backplate screws
      for (let i = 0; i < 6; i++) {
        makeBox(backplateLayer, 0.02, 0.012, d * 0.5, darkMat, w * 0.14 + i * w * 0.048, -h * 0.62 - 0.078, 0);
      }
      for (const sx of [-w * 0.41, w * 0.41]) {
        for (const sz of [-d * 0.38, d * 0.38]) {
          const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.015, 12), trimMetal);
          screw.position.set(sx, -h * 0.62 - 0.08, sz);
          backplateLayer.add(screw);
        }
      }
    }

    // ---- 2. PCB Layer + Die + VRM + PCIe Fingers + 12V-2x6 + I/O Bracket ----
    makeBox(pcbLayer, w * 0.96, 0.034, d * 0.93, pcbMat, 0, -h * 0.42, 0);
    makeBox(pcbLayer, 0.34, 0.02, 0.34, new THREE.MeshStandardMaterial({ color: 0x1d3b32, metalness: 0.32, roughness: 0.4 }), -0.05, -h * 0.42 + 0.024, 0);
    makeBox(pcbLayer, 0.19, 0.022, 0.19, new THREE.MeshStandardMaterial({ color: 0x333c4d, metalness: 0.94, roughness: 0.12 }), -0.05, -h * 0.42 + 0.036, 0);

    const chokeCount = Math.max(6, Math.round(lenScale * 11));
    const chokeMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 0.032, 0.05), darkMat, chokeCount);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < chokeCount; i++) {
      dummy.position.set(-w * 0.36 + (i / (chokeCount - 1)) * w * 0.72, -h * 0.42 + 0.03, -d * 0.33);
      dummy.updateMatrix();
      chokeMesh.setMatrixAt(i, dummy.matrix);
    }
    pcbLayer.add(chokeMesh);

    // Textured Gold PCIe 5.0 x16 Connector (+Z edge)
    const pcieMat = new THREE.MeshStandardMaterial({ map: getPcieFingersTexture(), metalness: 0.65, roughness: 0.3 });
    makeBox(pcbLayer, w * 0.45, 0.024, 0.095, pcieMat, -w * 0.12, -h * 0.42, d * 0.5);

    // 12V-2x6 Power Connector (-Z edge)
    makeBox(pcbLayer, 0.18, 0.065, 0.08, darkMat, w * 0.22, -h * 0.42 + 0.028, -d * 0.46);
    makeBox(pcbLayer, 0.14, 0.036, 0.022, goldMat, w * 0.22, -h * 0.42 + 0.028, -d * 0.49);

    // Dual-slot Stainless Steel I/O Bracket (-X end) with recessed DisplayPort + HDMI
    makeBox(pcbLayer, 0.042, h * 1.15, d * 0.95, trimMetal, -w * 0.5 - 0.02, 0, 0);
    makeBox(pcbLayer, 0.052, 0.034, d * 0.95, trimMetal, -w * 0.5 - 0.02, -h * 0.56, 0);
    for (let i = 0; i < 4; i++) {
      makeBox(pcbLayer, 0.025, 0.048, 0.11, trimMetal, -w * 0.5 - 0.042, h * 0.07, -d * 0.3 + i * d * 0.2);
      makeBox(pcbLayer, 0.028, 0.026, 0.085, darkMat, -w * 0.5 - 0.046, h * 0.07, -d * 0.3 + i * d * 0.2);
    }

    // ---- 3. Dense Aluminum Heatsink Fin Array + Copper Coldplate + Heatpipes ----
    // Visible right through the circular fan cutout holes AND open side exhaust windows!
    const finCount = clamp(Math.round(w * 24), 32, 86);
    const finMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.011, h * 0.62, d * 0.86), finMat, finCount);
    for (let i = 0; i < finCount; i++) {
      dummy.position.set(-w * 0.45 + (i / (finCount - 1)) * w * 0.9, -h * 0.04, 0);
      dummy.updateMatrix();
      finMesh.setMatrixAt(i, dummy.matrix);
    }
    finMesh.castShadow = !isSoftwareGl;
    heatsinkLayer.add(finMesh);

    makeBox(heatsinkLayer, 0.4, 0.036, 0.4, copperMat, -0.05, -h * 0.33, 0);
    for (let i = 0; i < 4; i++) {
      const zOff = (-0.32 + i * 0.215) * d;
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-w * 0.42, -h * 0.03, zOff * 0.85),
        new THREE.Vector3(-w * 0.13, -h * 0.2, zOff * 0.45),
        new THREE.Vector3(w * 0.15, -h * 0.12, zOff * 0.88),
        new THREE.Vector3(w * 0.43, -h * 0.01, zOff * 0.82)
      ]);
      const pipe = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.024, 12, false), copperMat);
      heatsinkLayer.add(pipe);
    }

    // ---- 4. Shroud Layer with REAL Smooth Circular Fan Cutout Holes! ----
    const outerShroudH = h * 0.62;
    const mainShroudY = h * 0.26;
    const mainShroudGeo = createShroudGeometryWithHoles(w, outerShroudH, d, shapeType, fanLayouts);
    const mainShroud = new THREE.Mesh(mainShroudGeo, shroudMat);
    mainShroud.position.y = mainShroudY;
    mainShroud.castShadow = !isSoftwareGl;
    mainShroud.receiveShadow = !isSoftwareGl;
    shroudLayer.add(mainShroud);

    // Top inner sculpted trim deck (also punched with the exact circular fan holes!)
    const deckH = 0.048;
    const deckY = mainShroudY + outerShroudH * 0.42;
    const deckGeo = createShroudGeometryWithHoles(w * 0.92, deckH, d * 0.88, shapeType, fanLayouts);
    const deckMesh = new THREE.Mesh(deckGeo, darkMat);
    deckMesh.position.y = deckY;
    shroudLayer.add(deckMesh);

    // Accent side rails framing the shroud
    for (const side of [-1, 1]) {
      makeBox(shroudLayer, w * 0.78, 0.026, 0.024, accentMat, 0, deckY + 0.01, side * d * 0.472);
    }
    if (shapeType === 'angular') {
      makeBox(shroudLayer, w * 0.12, 0.032, d * 0.9, accentMat, -w * 0.4, deckY + 0.02, 0);
      makeBox(shroudLayer, w * 0.12, 0.032, d * 0.9, accentMat, w * 0.4, deckY + 0.02, 0);
    }

    // ---- 5. Recessed Fans Seated Inside Their Cutouts ----
    const boreCenterY = mainShroudY + 0.02;
    const boreDepth = outerShroudH + 0.02;
    fanLayouts.forEach((layout, i) => buildFanInCutout(layout, i, boreCenterY, boreDepth, accentMat));

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
    scene.environmentIntensity = 0.9;

    scene.add(new THREE.HemisphereLight(0xdce6ff, 0x161224, 1.35));
    const keyLight = new THREE.DirectionalLight(0xfff6eb, 2.55);
    keyLight.position.set(3.5, 5.8, 4.2);
    if (!isSoftwareGl) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.bias = -0.0005;
    }
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x9d6bff, 1.85);
    rimLight.position.set(-4.2, 2.6, -3.5);
    scene.add(rimLight);

    plinthGroup = new THREE.Group();
    const shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(5.6, 3.6),
      new THREE.MeshBasicMaterial({ map: getContactShadowTexture(), transparent: true, depthWrite: false, opacity: 0.72 })
    );
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = -0.44;
    plinthGroup.add(shadowPlane);

    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(2.55, 2.65, 0.05, 64),
      new THREE.MeshStandardMaterial({ color: 0x120f1e, metalness: 0.45, roughness: 0.55 })
    );
    disc.position.y = -0.49;
    disc.receiveShadow = !isSoftwareGl;
    plinthGroup.add(disc);
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