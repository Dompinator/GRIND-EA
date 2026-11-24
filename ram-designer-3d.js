/* ============================================================
 * GRIND-EA · Realistic Three.js PBR 3D RAM Stick Designer
 * Single DDR5 UDIMM Stick · Exposed Gold Fingers & Keying Notch
 * DRAM ICs + PMIC · Machined Heatspreaders · Add Element Decals & RGB
 * Shared by RAM Studio, Previews, Thumbnails, & PcDesigner3D
 * ============================================================ */
(function () {
  'use strict';

  const THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.164.1/+esm';
  let THREE = null;
  let OrbitControls = null;
  let RoomEnvironment = null;
  let threePromise = null;

  const STICK_DIMS = {
    w: 1.34,       // 133mm real DDR5 UDIMM length ratio
    pcbH: 0.30,    // PCB height
    d: 0.088       // stick total thickness
  };

  const DEFAULT_CONFIG = {
    capacityKey: '512mb',
    capacityLabel: '512MB',
    capacityGb: 0.5,
    heatspreader: 'angular', // 'angular' | 'minimal' | 'ridged'
    finish: 'satin',         // 'matte' | 'satin' | 'gloss'
    primaryColor: '#1a1f2b',
    accentColor: '#a855f7',
    pcbColor: '#121620',
    name: 'VeloDDR5 16GB',
    companyName: '',
    logoUrl: '',
    elements: []
  };

  let stageEl = null;
  let mountEl = null;
  let dockEl = null;
  let renderer = null;
  let scene = null;
  let camera = null;
  let controls = null;
  let pmremGen = null;
  let envTexture = null;
  let stickRoot = null;
  let currentAsm = null;
  let resizeObserver = null;
  let contextLost = false;
  let isSoftwareGl = false;
  let rafId = 0;
  let timerId = 0;
  let lastMs = 0;
  let elapsedSec = 0;

  let config = { ...DEFAULT_CONFIG };
  let autoSpin = false;
  let targetExplode = 0;
  let currentExplode = 0;
  let camAnimActive = false;
  const camTargetPos = { x: 1.38, y: 0.92, z: 1.56 };
  const camTargetLook = { x: 0, y: 0.02, z: 0 };

  let offscreenPromise = null;
  const ramThumbQueue = [];
  let thumbQueueBusy = false;

  const texCache = new Map();
  const decalTexCache = new Map();
  const loadedImgCache = new Map();
  const pendingImgSet = new Set();

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function detectSoftwareWebGL() {
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      if (!gl) return true;
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const r = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '').toLowerCase() : '';
      return /swiftshader|llvmpipe|software|mesa offscreen/.test(r);
    } catch (_) {
      return true;
    }
  }

  async function ensureThree() {
    if (THREE && OrbitControls && RoomEnvironment) return true;
    if (threePromise) return threePromise;
    threePromise = (async () => {
      try {
        const [tMod, oMod, rMod] = await Promise.all([
          import('three'),
          import('three/addons/controls/OrbitControls.js'),
          import('three/addons/environments/RoomEnvironment.js')
        ]);
        THREE = tMod;
        OrbitControls = oMod.OrbitControls;
        RoomEnvironment = rMod.RoomEnvironment;
        return true;
      } catch (err) {
        try {
          const tMod = await import(THREE_CDN);
          THREE = tMod;
          OrbitControls = (await import('https://cdn.jsdelivr.net/npm/three@0.164.1/examples/jsm/controls/OrbitControls.js/+esm')).OrbitControls;
          RoomEnvironment = (await import('https://cdn.jsdelivr.net/npm/three@0.164.1/examples/jsm/environments/RoomEnvironment.js/+esm')).RoomEnvironment;
          return true;
        } catch (err2) {
          console.warn('RamDesigner3D Three load failed:', err || err2);
          threePromise = null;
          return false;
        }
      }
    })();
    return threePromise;
  }

  function clearGroup(grp) {
    if (!grp) return;
    while (grp.children.length) {
      const ch = grp.children.pop();
      ch.traverse?.(o => {
        if (o.geometry && typeof o.geometry.dispose === 'function') o.geometry.dispose();
        if (o.material) {
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          ms.forEach(m => m?.dispose?.());
        }
      });
    }
  }

  function getBrushedMetalTexture(T) {
    if (texCache.has('brushed')) return texCache.get('brushed');
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#dcdcdc';
    ctx.fillRect(0, 0, 256, 128);
    for (let y = 0; y < 128; y++) {
      const v = 198 + ((y * 23) % 44);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(0, y, 256, 1);
    }
    const tex = new T.CanvasTexture(c);
    tex.wrapS = T.RepeatWrapping;
    tex.wrapT = T.RepeatWrapping;
    tex.colorSpace = T.SRGBColorSpace;
    texCache.set('brushed', tex);
    return tex;
  }

  function getPcbTracesTexture(T, hex) {
    const key = 'pcb_' + (hex || '#121620');
    if (texCache.has(key)) return texCache.get(key);
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = hex || '#121620';
    ctx.fillRect(0, 0, 512, 128);

    ctx.strokeStyle = 'rgba(220, 200, 120, 0.20)';
    ctx.lineWidth = 1.4;
    for (let x = 16; x < 496; x += 6) {
      if (x > 260 && x < 284) continue; // notch zone
      ctx.beginPath();
      ctx.moveTo(x, 124);
      ctx.lineTo(x, 86);
      ctx.lineTo(x + (x % 12 === 0 ? 4 : -4), 66);
      ctx.lineTo(x + (x % 12 === 0 ? 4 : -4), 12);
      ctx.stroke();
    }
    const tex = new T.CanvasTexture(c);
    tex.colorSpace = T.SRGBColorSpace;
    texCache.set(key, tex);
    return tex;
  }

  function getGoldPinsTexture(T) {
    if (texCache.has('gold_pins')) return texCache.get('gold_pins');
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 64;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#0e1318';
    ctx.fillRect(0, 0, 1024, 64);

    // 144 visible teeth per side with DDR5 center-right keying notch cutout
    for (let i = 0; i < 140; i++) {
      const x = 12 + i * 7.15;
      if (x > 532 && x < 576) continue;
      const g = ctx.createLinearGradient(0, 4, 0, 62);
      g.addColorStop(0, '#c89b38');
      g.addColorStop(0.5, '#f6d97a');
      g.addColorStop(1, '#d4a644');
      ctx.fillStyle = g;
      ctx.fillRect(x, 6, 4.2, 54);
    }
    const tex = new T.CanvasTexture(c);
    tex.colorSpace = T.SRGBColorSpace;
    tex.anisotropy = 4;
    texCache.set('gold_pins', tex);
    return tex;
  }

  function requestLogoImage(url, onReady) {
    const clean = String(url || '').trim();
    if (!clean) return null;
    if (loadedImgCache.has(clean)) return loadedImgCache.get(clean);
    if (pendingImgSet.has(clean)) return null;
    pendingImgSet.add(clean);
    const img = new Image();
    if (!clean.startsWith('data:')) img.crossOrigin = 'anonymous';
    img.onload = () => {
      pendingImgSet.delete(clean);
      loadedImgCache.set(clean, img);
      decalTexCache.forEach((_, k) => { if (k.startsWith('logo|')) decalTexCache.delete(k); });
      if (typeof onReady === 'function') onReady();
      else rebuildStageModel();
    };
    img.onerror = () => pendingImgSet.delete(clean);
    img.src = clean;
    return null;
  }

  function getTextDecalTexture(T, text, colorHex) {
    const clean = String(text || 'DDR5').trim().slice(0, 24) || 'DDR5';
    const col = colorHex || '#ffffff';
    const sig = `txt|${clean}|${col}`;
    if (decalTexCache.has(sig)) return decalTexCache.get(sig);

    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 256;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 1024, 256);

    ctx.font = '900 122px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(6, 8, 16, 0.85)';
    ctx.lineWidth = 14;
    ctx.strokeText(clean, 512, 132, 950);
    ctx.fillStyle = col;
    ctx.fillText(clean, 512, 132, 950);

    const tex = new T.CanvasTexture(c);
    tex.colorSpace = T.SRGBColorSpace;
    tex.anisotropy = 8;
    decalTexCache.set(sig, tex);
    return tex;
  }

  function getLogoDecalTexture(T, url, tintHex, onReady) {
    const img = requestLogoImage(url, onReady);
    const sig = `logo|${url || 'none'}|${img ? 'ok' : 'wait'}|${tintHex || ''}`;
    if (decalTexCache.has(sig)) return decalTexCache.get(sig);

    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 256, 256);

    if (img) {
      const s = Math.min(220 / img.width, 220 / img.height);
      ctx.drawImage(img, (256 - img.width * s) / 2, (256 - img.height * s) / 2, img.width * s, img.height * s);
    } else {
      ctx.strokeStyle = tintHex || '#a855f7';
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.roundRect(28, 28, 200, 200, 32);
      ctx.stroke();
      ctx.fillStyle = '#f8fafc';
      ctx.font = '900 58px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('RAM', 128, 130);
    }

    const tex = new T.CanvasTexture(c);
    tex.colorSpace = T.SRGBColorSpace;
    tex.anisotropy = 8;
    decalTexCache.set(sig, tex);
    return tex;
  }

  function makeBox(T, parent, w, h, d, mat, x = 0, y = 0, z = 0) {
    const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  // Build side heatspreader silhouette along X/Y extruded along Z
  function makeHeatspreaderPlateGeo(T, w, h, thick, style) {
    const hw = w / 2;
    const hh = h / 2;
    const shape = new T.Shape();

    if (style === 'angular') {
      const c = 0.048;
      const notchW = w * 0.14;
      shape.moveTo(-hw + c, -hh);
      shape.lineTo(hw - c, -hh);
      shape.lineTo(hw, -hh + c);
      shape.lineTo(hw, hh - c * 1.4);
      shape.lineTo(hw - c * 1.5, hh);
      shape.lineTo(notchW, hh);
      shape.lineTo(notchW - 0.04, hh - 0.024);
      shape.lineTo(-notchW + 0.04, hh - 0.024);
      shape.lineTo(-notchW, hh);
      shape.lineTo(-hw + c * 1.5, hh);
      shape.lineTo(-hw, hh - c * 1.4);
      shape.lineTo(-hw, -hh + c);
      shape.closePath();
    } else if (style === 'ridged') {
      const c = 0.028;
      shape.moveTo(-hw + c, -hh);
      shape.lineTo(hw - c, -hh);
      shape.lineTo(hw, -hh + c);
      shape.lineTo(hw, hh - 0.032);
      const teeth = 7;
      for (let i = teeth; i >= 0; i--) {
        const tx = -hw + (i / teeth) * w;
        const clampedX = clamp(tx, -hw + 0.022, hw - 0.022);
        const yTop = (i % 2 === 0) ? hh : hh - 0.022;
        shape.lineTo(clampedX, yTop);
      }
      shape.lineTo(-hw, hh - 0.032);
      shape.lineTo(-hw, -hh + c);
      shape.closePath();
    } else {
      const r = 0.024;
      shape.moveTo(-hw + r, -hh);
      shape.lineTo(hw - r, -hh);
      shape.quadraticCurveTo(hw, -hh, hw, -hh + r);
      shape.lineTo(hw, hh - r);
      shape.quadraticCurveTo(hw, hh, hw - r, hh);
      shape.lineTo(-hw + r, hh);
      shape.quadraticCurveTo(-hw, hh, -hw, hh - r);
      shape.lineTo(-hw, -hh + r);
      shape.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
    }

    const bevel = 0.0055;
    const geo = new T.ExtrudeGeometry(shape, {
      depth: Math.max(0.012, thick - bevel * 2),
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 2,
      curveSegments: 8
    });
    geo.computeBoundingBox();
    const cz = (geo.boundingBox.min.z + geo.boundingBox.max.z) * 0.5;
    const cy = (geo.boundingBox.min.y + geo.boundingBox.max.y) * 0.5;
    geo.translate(0, -cy, -cz);
    geo.computeVertexNormals();
    return geo;
  }

  function buildAssembly(T, rawCfg, opts = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...(rawCfg && typeof rawCfg === 'object' ? rawCfg : {}) };
    const w = STICK_DIMS.w;
    const style = ['angular', 'minimal', 'ridged'].includes(cfg.heatspreader) ? cfg.heatspreader : 'angular';
    const spreaderH = style === 'minimal' ? 0.255 : style === 'ridged' ? 0.305 : 0.285;
    const hasRgbStrip = Array.isArray(cfg.elements) && cfg.elements.some(e => e.kind === 'rgb_strip');
    const topBarH = hasRgbStrip ? 0.056 : 0.024;

    const pcbH = STICK_DIMS.pcbH;
    const pcbThick = 0.018;
    const plateThick = 0.026;
    const stickD = pcbThick + plateThick * 2 + 0.012;

    const pcbBottomY = -pcbH * 0.5 - 0.035;
    const pcbCenterY = pcbBottomY + pcbH * 0.5;
    const plateCenterY = pcbCenterY + 0.058;
    const plateTopY = plateCenterY + spreaderH * 0.5;
    const topBarY = plateTopY + topBarH * 0.42;

    const root = new T.Group();
    const pcbGroup = new T.Group();
    const icGroup = new T.Group();
    const frontPlateGroup = new T.Group();
    const backPlateGroup = new T.Group();
    const topBarGroup = new T.Group();
    const elementsGroup = new T.Group();

    const finish = cfg.finish || 'satin';
    const isMatte = finish === 'matte';
    const isGloss = finish === 'gloss';
    const brushedTex = getBrushedMetalTexture(T);

    const primaryCol = new T.Color(cfg.primaryColor || '#1a1f2b');
    const accentCol = new T.Color(cfg.accentColor || '#a855f7');
    const pcbCol = new T.Color(cfg.pcbColor || '#121620');

    const bodyMat = new T.MeshPhysicalMaterial({
      color: primaryCol,
      map: brushedTex,
      bumpMap: brushedTex,
      bumpScale: 0.0025,
      metalness: isMatte ? 0.64 : 0.86,
      roughness: isMatte ? 0.44 : isGloss ? 0.14 : 0.24,
      clearcoat: isMatte ? 0.06 : isGloss ? 0.80 : 0.32,
      clearcoatRoughness: isGloss ? 0.08 : 0.24
    });

    const accentMat = new T.MeshPhysicalMaterial({
      color: accentCol,
      metalness: 0.78,
      roughness: 0.22,
      clearcoat: 0.40
    });

    const pcbMat = new T.MeshStandardMaterial({
      color: pcbCol,
      map: getPcbTracesTexture(T, cfg.pcbColor || '#121620'),
      metalness: 0.24,
      roughness: 0.52
    });

    const goldPinsMat = new T.MeshPhysicalMaterial({
      map: getGoldPinsTexture(T),
      metalness: 0.88,
      roughness: 0.22,
      clearcoat: 0.3
    });

    const dramMat = new T.MeshStandardMaterial({ color: 0x0b0e14, metalness: 0.22, roughness: 0.46 });
    const pmicMat = new T.MeshStandardMaterial({ color: 0x262c3a, metalness: 0.65, roughness: 0.34 });
    const smdMat = new T.MeshStandardMaterial({ color: 0xb89356, metalness: 0.68, roughness: 0.32 });

    // 1. Multi-layer PCB substrate with exposed bottom gold edge connector & DDR5 notch
    const leftEdgeW = w * 0.52;
    const rightEdgeW = w * 0.43;
    const notchGap = w - leftEdgeW - rightEdgeW; // ~0.067
    const leftEdgeX = -w / 2 + leftEdgeW / 2;
    const rightEdgeX = w / 2 - rightEdgeW / 2;

    // Upper PCB body
    makeBox(T, pcbGroup, w, pcbH - 0.048, pcbThick, pcbMat, 0, pcbCenterY + 0.024, 0);
    // Split bottom connector fingers on either side of DDR5 keying notch
    makeBox(T, pcbGroup, leftEdgeW, 0.050, pcbThick + 0.002, goldPinsMat, leftEdgeX, pcbBottomY + 0.025, 0);
    makeBox(T, pcbGroup, rightEdgeW, 0.050, pcbThick + 0.002, goldPinsMat, rightEdgeX, pcbBottomY + 0.025, 0);

    // PCB retention notches on left/right vertical ends
    makeBox(T, pcbGroup, 0.022, 0.036, pcbThick + 0.003, pcbMat, -w / 2 + 0.008, pcbCenterY - 0.02, 0);
    makeBox(T, pcbGroup, 0.022, 0.036, pcbThick + 0.003, pcbMat, w / 2 - 0.008, pcbCenterY - 0.02, 0);

    // 2. DRAM ICs, Central PMIC & SMD Capacitors mounted on both PCB faces
    const icCount = 8;
    const icSpan = w * 0.84;
    for (let i = 0; i < icCount; i++) {
      const ix = -icSpan / 2 + (i / (icCount - 1)) * icSpan;
      // Skip middle gap for PMIC if odd/center, or nudge
      const nx = Math.abs(ix) < 0.055 ? (ix < 0 ? -0.08 : 0.08) : ix;
      makeBox(T, icGroup, 0.088, 0.115, 0.009, dramMat, nx, pcbCenterY + 0.012, pcbThick / 2 + 0.004);
      makeBox(T, icGroup, 0.088, 0.115, 0.009, dramMat, nx, pcbCenterY + 0.012, -pcbThick / 2 - 0.004);
      // Visible gold SMD decoupling capacitors along lower PCB lip
      makeBox(T, icGroup, 0.018, 0.012, 0.006, smdMat, nx - 0.02, pcbBottomY + 0.068, pcbThick / 2 + 0.003);
      makeBox(T, icGroup, 0.018, 0.012, 0.006, smdMat, nx + 0.02, pcbBottomY + 0.068, -pcbThick / 2 - 0.003);
    }
    // Central PMIC chip on front side
    makeBox(T, icGroup, 0.055, 0.055, 0.010, pmicMat, 0, pcbCenterY + 0.01, pcbThick / 2 + 0.005);

    // 3. Front & Back CNC-Machined Aluminum Heatspreader Shells
    const plateGeo = makeHeatspreaderPlateGeo(T, w * 0.99, spreaderH, plateThick, style);
    const frontZ = pcbThick / 2 + plateThick / 2 + 0.009;
    const backZ = -(pcbThick / 2 + plateThick / 2 + 0.009);

    const frontMesh = new T.Mesh(plateGeo, bodyMat);
    frontMesh.position.set(0, plateCenterY, frontZ);
    frontPlateGroup.add(frontMesh);

    const backMesh = new T.Mesh(plateGeo.clone(), bodyMat);
    backMesh.position.set(0, plateCenterY, backZ);
    backPlateGroup.add(backMesh);

    // Machined beveled groove ribs on heatspreader faces
    if (style === 'angular' || style === 'ridged') {
      const grooveMat = new T.MeshStandardMaterial({
        color: primaryCol.clone().multiplyScalar(0.55),
        metalness: 0.72,
        roughness: 0.36
      });
      const ribPositions = style === 'ridged' ? [-0.46, -0.28, -0.10, 0.10, 0.28, 0.46] : [-0.42, 0.42];
      ribPositions.forEach(rx => {
        makeBox(T, frontPlateGroup, 0.016, spreaderH * 0.62, 0.006, grooveMat, rx, plateCenterY - 0.01, frontZ + plateThick / 2 + 0.001);
        makeBox(T, backPlateGroup, 0.016, spreaderH * 0.62, 0.006, grooveMat, rx, plateCenterY - 0.01, backZ - plateThick / 2 - 0.001);
      });
    }

    // Precision Accent Trim Rail along bottom shoulder of heatspreader
    makeBox(T, frontPlateGroup, w * 0.82, 0.012, 0.005, accentMat, 0, plateCenterY - spreaderH * 0.42, frontZ + plateThick / 2 + 0.002);
    makeBox(T, backPlateGroup, w * 0.82, 0.012, 0.005, accentMat, 0, plateCenterY - spreaderH * 0.42, backZ - plateThick / 2 - 0.002);

    // 4. Top Spine / RGB Diffuser Lightbar Assembly
    const rainbowRgbMats = [];
    const rgbElements = (Array.isArray(cfg.elements) ? cfg.elements : []).filter(e => e.kind === 'rgb_strip');

    if (rgbElements.length > 0) {
      const rgbEl = rgbElements[rgbElements.length - 1];
      const isRainbow = rgbEl.colorMode === 'rainbow' || rgbEl.color === 'rainbow' || !!rgbEl.rainbow;
      const baseRgbCol = new T.Color(isRainbow ? '#a855f7' : (rgbEl.color || cfg.accentColor || '#a855f7'));
      const mode = rgbEl.placement || 'top';

      const makeLedMat = offset => {
        const c = isRainbow ? new T.Color().setHSL(offset % 1, 0.95, 0.56) : baseRgbCol;
        const m = new T.MeshStandardMaterial({
          color: c,
          emissive: c.clone(),
          emissiveIntensity: 1.65,
          roughness: 0.22,
          metalness: 0.08,
          transparent: true,
          opacity: 0.94
        });
        if (isRainbow) rainbowRgbMats.push({ mat: m, offset });
        return m;
      };

      // Frosted milky acrylic outer diffuser + segmented LED bar
      const segs = isRainbow ? 12 : 1;
      const barSpan = w * 0.96;
      const segW = barSpan / segs;
      for (let i = 0; i < segs; i++) {
        const sx = -barSpan / 2 + segW * (i + 0.5);
        const ledMat = makeLedMat(i / segs);
        makeBox(T, topBarGroup, segW + 0.002, topBarH * 0.82, stickD * 0.78, ledMat, sx, topBarY, 0);
        if (mode === 'side_slit' || mode === 'full') {
          makeBox(T, elementsGroup, segW + 0.002, 0.016, 0.006, ledMat, sx, plateTopY - 0.025, frontZ + plateThick / 2 + 0.002);
          makeBox(T, elementsGroup, segW + 0.002, 0.016, 0.006, ledMat, sx, plateTopY - 0.025, backZ - plateThick / 2 - 0.002);
        }
      }
      // Side end-cap aluminum clasps holding the diffuser bar
      makeBox(T, topBarGroup, 0.045, topBarH * 0.92, stickD * 0.86, bodyMat, -w / 2 + 0.025, topBarY, 0);
      makeBox(T, topBarGroup, 0.045, topBarH * 0.92, stickD * 0.86, bodyMat, w / 2 - 0.025, topBarY, 0);
    } else {
      // Solid machined aluminum top bridge bar
      makeBox(T, topBarGroup, w * 0.96, topBarH, stickD * 0.78, bodyMat, 0, topBarY, 0);
      makeBox(T, topBarGroup, w * 0.68, 0.006, stickD * 0.42, accentMat, 0, topBarY + topBarH * 0.52, 0);
    }

    // 5. Add Elements: Text Labels, Logos, & Accent Trim Bars
    const faceFrontZ = frontZ + plateThick / 2 + 0.0055;
    const faceBackZ = backZ - plateThick / 2 - 0.0055;
    const topFaceY = topBarY + topBarH * 0.5 + 0.005;

    const mountDecal = (el, side, tex, planeW, planeH, isText, glowText) => {
      const pos = clamp(Number(el.position ?? 0.5), 0.14, 0.86);
      const xCoord = -w / 2 + w * pos;
      const col = new T.Color(el.color || '#ffffff');
      const mat = new T.MeshStandardMaterial({
        map: tex,
        transparent: true,
        alphaTest: 0.04,
        roughness: 0.24,
        metalness: 0.2,
        emissive: isText ? col : new T.Color(0x000000),
        emissiveMap: isText ? tex : null,
        emissiveIntensity: isText ? (glowText ? 1.45 : 0.28) : 0,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3
      });
      const mesh = new T.Mesh(new T.PlaneGeometry(planeW, planeH), mat);
      mesh.renderOrder = 3;

      if (side === 'top') {
        const topW = Math.min(w * 0.82, planeW * 0.65);
        const topH = Math.min(stickD * 0.68, planeH * 0.45);
        mesh.geometry.dispose();
        mesh.geometry = new T.PlaneGeometry(topW, topH);
        mesh.position.set(xCoord, topFaceY, 0);
        mesh.rotation.x = -Math.PI / 2;
      } else if (side === 'back') {
        mesh.position.set(xCoord, plateCenterY, faceBackZ);
        mesh.rotation.y = Math.PI;
      } else {
        mesh.position.set(xCoord, plateCenterY, faceFrontZ);
      }
      elementsGroup.add(mesh);
    };

    const elements = Array.isArray(cfg.elements) ? cfg.elements : [];
    for (const el of elements) {
      if (el.kind === 'text') {
        const scale = clamp(Number(el.size ?? 1.0), 0.55, 1.55);
        const placement = el.placement || 'front';
        const planeH = clamp(spreaderH * 0.58 * scale, 0.075, spreaderH * 0.86);
        const planeW = Math.min(w * 0.78, planeH * 3.85);
        const tex = getTextDecalTexture(T, el.text || 'DDR5', el.color || '#ffffff');
        const glow = !!el.glow;
        if (placement === 'both_sides') {
          mountDecal(el, 'front', tex, planeW, planeH, true, glow);
          mountDecal(el, 'back', tex, planeW, planeH, true, glow);
        } else {
          mountDecal(el, placement, tex, planeW, planeH, true, glow);
        }
      } else if (el.kind === 'logo') {
        const scale = clamp(Number(el.size ?? 1.0), 0.5, 1.55);
        const placement = el.placement || 'front';
        const sz = clamp(spreaderH * 0.72 * scale, 0.085, spreaderH * 0.90);
        const tex = getLogoDecalTexture(T, el.logoUrl || cfg.logoUrl || '', cfg.accentColor || '#a855f7', opts.onAssetReady);
        if (placement === 'both_sides') {
          mountDecal(el, 'front', tex, sz, sz, false, false);
          mountDecal(el, 'back', tex, sz, sz, false, false);
        } else {
          mountDecal(el, placement, tex, sz, sz, false, false);
        }
      } else if (el.kind === 'accent_bar') {
        const scale = clamp(Number(el.size ?? 1.0), 0.35, 2.0);
        const placement = el.placement || 'front';
        const pos = clamp(Number(el.position ?? 0.5), 0.14, 0.86);
        const xCoord = -w / 2 + w * pos;
        const barW = Math.min(w * 0.84, 0.44 * scale);
        const barMat = new T.MeshPhysicalMaterial({
          color: new T.Color(el.color || cfg.accentColor || '#a855f7'),
          metalness: 0.82,
          roughness: 0.20,
          clearcoat: 0.48
        });
        const addBar = side => {
          if (side === 'top') {
            makeBox(T, elementsGroup, barW, 0.008, stickD * 0.42, barMat, xCoord, topFaceY, 0);
          } else if (side === 'back') {
            makeBox(T, elementsGroup, barW, 0.022, 0.008, barMat, xCoord, plateCenterY + spreaderH * 0.22, faceBackZ);
          } else {
            makeBox(T, elementsGroup, barW, 0.022, 0.008, barMat, xCoord, plateCenterY + spreaderH * 0.22, faceFrontZ);
          }
        };
        if (placement === 'both_sides') {
          addBar('front');
          addBar('back');
        } else {
          addBar(placement);
        }
      }
    }

    root.add(pcbGroup, icGroup, frontPlateGroup, backPlateGroup, topBarGroup, elementsGroup);

    const topMostY = topBarY + topBarH * 0.5;
    const totalH = topMostY - pcbBottomY;
    return {
      root,
      pcbGroup,
      icGroup,
      frontPlateGroup,
      backPlateGroup,
      topBarGroup,
      elementsGroup,
      rainbowRgbMats,
      dims: {
        w,
        h: totalH,
        d: stickD,
        bottomY: pcbBottomY,
        topY: topMostY
      }
    };
  }

  function rebuildStageModel() {
    if (!THREE || !stickRoot) return;
    clearGroup(stickRoot);
    currentAsm = buildAssembly(THREE, config, {
      isSoftwareGl,
      onAssetReady: () => rebuildStageModel()
    });
    if (currentAsm?.root) stickRoot.add(currentAsm.root);
    applyExplode(0);
  }

  function applyExplode(dt) {
    if (!currentAsm) return;
    currentExplode += (targetExplode - currentExplode) * (dt > 0 ? Math.min(1, dt * 8) : 1);
    const e = currentExplode;
    if (currentAsm.frontPlateGroup) currentAsm.frontPlateGroup.position.z = 0.22 * e;
    if (currentAsm.backPlateGroup) currentAsm.backPlateGroup.position.z = -0.22 * e;
    if (currentAsm.topBarGroup) currentAsm.topBarGroup.position.y = 0.24 * e;
    if (currentAsm.icGroup) currentAsm.icGroup.position.z = 0.04 * e;
    if (currentAsm.elementsGroup) currentAsm.elementsGroup.position.y = 0.06 * e;
  }

  function setCameraPreset(preset) {
    camAnimActive = true;
    camTargetLook.x = 0; camTargetLook.y = 0.02; camTargetLook.z = 0;
    if (preset === 'front') Object.assign(camTargetPos, { x: 0.02, y: 0.08, z: 1.95 });
    else if (preset === 'back') Object.assign(camTargetPos, { x: -0.02, y: 0.08, z: -1.95 });
    else if (preset === 'top') Object.assign(camTargetPos, { x: 0.02, y: 1.78, z: 0.45 });
    else if (preset === 'pins') Object.assign(camTargetPos, { x: 0.65, y: -1.15, z: 1.35 });
    else Object.assign(camTargetPos, { x: 1.38, y: 0.92, z: 1.56 });
  }

  function focusPlacement(placement) {
    if (placement === 'back') setCameraPreset('back');
    else if (placement === 'top') setCameraPreset('top');
    else if (placement === 'front') setCameraPreset('front');
    else setCameraPreset('hero');
  }

  function renderDock() {
    if (!stageEl) return;
    dockEl = stageEl.querySelector('#eaRamDock');
    if (dockEl) return;
    dockEl = document.createElement('div');
    dockEl.id = 'eaRamDock';
    dockEl.className = 'gpu-3d-dock';
    dockEl.innerHTML =
      '<div class="gpu-3d-pills">' +
        '<button type="button" data-ram-cam="hero" class="active">3/4 Hero</button>' +
        '<button type="button" data-ram-cam="front">Front</button>' +
        '<button type="button" data-ram-cam="back">Back</button>' +
        '<button type="button" data-ram-cam="top">Top RGB</button>' +
        '<button type="button" data-ram-cam="pins">Gold Pins</button>' +
      '</div>' +
      '<div class="gpu-3d-actions">' +
        '<button type="button" id="eaRamSpinBtn">Spin</button>' +
        '<button type="button" id="eaRamExplodeBtn">Explode</button>' +
      '</div>';
    stageEl.appendChild(dockEl);

    dockEl.querySelectorAll('[data-ram-cam]').forEach(btn => {
      btn.addEventListener('click', () => {
        dockEl.querySelectorAll('[data-ram-cam]').forEach(b => b.classList.toggle('active', b === btn));
        setCameraPreset(btn.dataset.ramCam);
      });
    });
    dockEl.querySelector('#eaRamSpinBtn')?.addEventListener('click', e => {
      autoSpin = !autoSpin;
      e.currentTarget.classList.toggle('active', autoSpin);
    });
    dockEl.querySelector('#eaRamExplodeBtn')?.addEventListener('click', e => {
      targetExplode = targetExplode > 0.5 ? 0 : 1;
      e.currentTarget.classList.toggle('active', targetExplode > 0.5);
    });
  }

  function resize() {
    if (!renderer || !camera || !stageEl) return;
    const w = Math.max(260, stageEl.clientWidth || 600);
    const h = Math.max(260, stageEl.clientHeight || 420);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }

  function stopLoop() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    if (timerId) { clearTimeout(timerId); timerId = 0; }
  }

  function startLoop() {
    if (rafId || timerId) return;
    lastMs = performance.now();
    const tick = now => {
      rafId = 0;
      timerId = 0;
      if (!renderer || !scene || !camera || contextLost || !stageEl?.offsetParent) return;
      const dt = Math.min(0.05, Math.max(0.001, (now - lastMs) / 1000));
      lastMs = now;
      elapsedSec += dt;

      if (autoSpin && stickRoot) stickRoot.rotation.y += dt * 0.55;
      if (currentAsm?.rainbowRgbMats?.length) {
        for (const rm of currentAsm.rainbowRgbMats) {
          const hue = (elapsedSec * 0.25 + (rm.offset || 0)) % 1;
          rm.mat.color.setHSL(hue, 0.95, 0.55);
          rm.mat.emissive.setHSL(hue, 0.95, 0.55);
        }
      }
      applyExplode(dt);

      if (camAnimActive && controls) {
        camera.position.x += (camTargetPos.x - camera.position.x) * Math.min(1, dt * 7);
        camera.position.y += (camTargetPos.y - camera.position.y) * Math.min(1, dt * 7);
        camera.position.z += (camTargetPos.z - camera.position.z) * Math.min(1, dt * 7);
        controls.target.x += (camTargetLook.x - controls.target.x) * Math.min(1, dt * 7);
        controls.target.y += (camTargetLook.y - controls.target.y) * Math.min(1, dt * 7);
        controls.target.z += (camTargetLook.z - controls.target.z) * Math.min(1, dt * 7);
        if (Math.hypot(camera.position.x - camTargetPos.x, camera.position.y - camTargetPos.y, camera.position.z - camTargetPos.z) < 0.015) {
          camAnimActive = false;
        }
      }

      controls?.update();
      renderer.render(scene, camera);
      if (isSoftwareGl) timerId = window.setTimeout(() => { rafId = requestAnimationFrame(tick); }, 80);
      else rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  async function mount(containerEl) {
    if (!containerEl) return false;
    if (stageEl === containerEl && renderer && mountEl && containerEl.contains(mountEl)) {
      resize();
      startLoop();
      return true;
    }
    const ok = await ensureThree();
    if (!ok) {
      containerEl.innerHTML = '<div class="gpu-3d-error">3D RAM Designer unavailable on this browser.</div>';
      return false;
    }

    resizeObserver?.disconnect();
    stopLoop();
    controls?.dispose?.();
    envTexture?.dispose?.();
    pmremGen?.dispose?.();
    renderer?.dispose?.();

    stageEl = containerEl;
    isSoftwareGl = detectSoftwareWebGL();
    try {
      renderer = new THREE.WebGLRenderer({ antialias: !isSoftwareGl, alpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    } catch (_) {
      stageEl.innerHTML = '<div class="gpu-3d-error">WebGL 3D rendering unavailable.</div>';
      return false;
    }
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    renderer.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); contextLost = true; stopLoop(); });
    renderer.domElement.addEventListener('webglcontextrestored', () => { contextLost = false; startLoop(); });

    mountEl = renderer.domElement;
    stageEl.innerHTML = '';
    stageEl.appendChild(mountEl);

    scene = new THREE.Scene();
    pmremGen = new THREE.PMREMGenerator(renderer);
    envTexture = pmremGen.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTexture;
    scene.environmentIntensity = 1.08;

    scene.add(new THREE.HemisphereLight(0xe6eeff, 0x181426, 1.3));
    const key = new THREE.DirectionalLight(0xfff5e8, 2.25);
    key.position.set(3.5, 4.8, 3.8);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xa78bfa, 1.35);
    rim.position.set(-3.5, 2.5, -3.2);
    scene.add(rim);

    camera = new THREE.PerspectiveCamera(34, 16 / 10, 0.05, 50);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 0.75;
    controls.maxDistance = 6.5;
    controls.addEventListener('start', () => { camAnimActive = false; });

    stickRoot = new THREE.Group();
    scene.add(stickRoot);
    rebuildStageModel();

    setCameraPreset('hero');
    camera.position.set(camTargetPos.x, camTargetPos.y, camTargetPos.z);
    controls.target.set(camTargetLook.x, camTargetLook.y, camTargetLook.z);
    controls.update();
    camAnimActive = false;

    renderDock();
    resizeObserver = new ResizeObserver(() => resize());
    resizeObserver.observe(stageEl);
    resize();
    startLoop();
    return true;
  }

  function update(nextCfg) {
    config = {
      ...DEFAULT_CONFIG,
      ...(nextCfg && typeof nextCfg === 'object' ? nextCfg : {}),
      elements: Array.isArray(nextCfg?.elements) ? nextCfg.elements.map(e => ({ ...e })) : []
    };
    if (THREE && stickRoot) {
      rebuildStageModel();
      if (renderer && scene && camera) renderer.render(scene, camera);
      startLoop();
    }
  }

  function captureSnapshot(opts = {}) {
    if (!renderer || !scene || !camera || contextLost) return '';
    try {
      renderer.render(scene, camera);
      const w = opts.width || 360;
      const h = opts.height || 270;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#0d0919';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(renderer.domElement, 0, 0, w, h);
      return c.toDataURL('image/png');
    } catch (_) {
      return '';
    }
  }

  async function ensureOffscreen() {
    if (offscreenPromise) return offscreenPromise;
    offscreenPromise = (async () => {
      const ok = await ensureThree();
      if (!ok) return null;
      const soft = detectSoftwareWebGL();
      const offRenderer = new THREE.WebGLRenderer({ antialias: !soft, alpha: true, preserveDrawingBuffer: true });
      offRenderer.outputColorSpace = THREE.SRGBColorSpace;
      offRenderer.toneMapping = THREE.ACESFilmicToneMapping;
      offRenderer.toneMappingExposure = 1.15;

      const offScene = new THREE.Scene();
      const pm = new THREE.PMREMGenerator(offRenderer);
      offScene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
      offScene.environmentIntensity = 1.08;
      pm.dispose();

      offScene.add(new THREE.HemisphereLight(0xe6eeff, 0x181426, 1.3));
      const key = new THREE.DirectionalLight(0xfff5e8, 2.25);
      key.position.set(3.5, 4.8, 3.8);
      offScene.add(key);
      const rim = new THREE.DirectionalLight(0xa78bfa, 1.35);
      rim.position.set(-3.5, 2.5, -3.2);
      offScene.add(rim);

      const offCamera = new THREE.PerspectiveCamera(34, 4 / 3, 0.05, 50);
      const root = new THREE.Group();
      offScene.add(root);

      return { offRenderer, offScene, offCamera, root };
    })();
    return offscreenPromise;
  }

  async function captureHeroSnapshot(cfg, width = 360, height = 270) {
    const ctxObj = await ensureOffscreen();
    if (!ctxObj) return '';
    const { offRenderer, offScene, offCamera, root } = ctxObj;
    clearGroup(root);
    const asm = buildAssembly(THREE, cfg, { isSoftwareGl: detectSoftwareWebGL() });
    if (!asm?.root) return '';
    root.add(asm.root);

    offRenderer.setSize(width, height, false);
    offCamera.aspect = width / height;
    offCamera.updateProjectionMatrix();
    offCamera.position.set(1.22, 0.84, 1.48);
    offCamera.lookAt(0, 0.02, 0);
    offRenderer.render(offScene, offCamera);

    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    const octx = out.getContext('2d');
    octx.fillStyle = '#0d0919';
    octx.fillRect(0, 0, width, height);
    octx.drawImage(offRenderer.domElement, 0, 0, width, height);
    clearGroup(root);
    return out.toDataURL('image/png');
  }

  function processQueue() {
    if (thumbQueueBusy || !ramThumbQueue.length) return;
    thumbQueueBusy = true;
    const job = ramThumbQueue.shift();
    captureHeroSnapshot(job.cfg, job.width, job.height)
      .then(url => job.cb?.(url))
      .catch(() => job.cb?.(''))
      .finally(() => {
        thumbQueueBusy = false;
        if (ramThumbQueue.length) setTimeout(processQueue, 16);
      });
  }

  function enqueueThumbnail(cfg, cb, width = 360, height = 270) {
    ramThumbQueue.push({ cfg, cb, width, height });
    processQueue();
  }

  window.RamDesigner3D = {
    STICK_DIMS,
    buildAssembly,
    mount,
    update,
    resize,
    focusPlacement,
    captureSnapshot,
    captureHeroSnapshot,
    enqueueThumbnail
  };
})();
