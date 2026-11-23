/* ============================================================
 * GRIND-EA · Procedural 3D Hardware CPU CAD Designer (Three.js)
 * Zero external assets · Physically Based Materials · Silky-smooth damping
 * ============================================================ */
(function () {
  'use strict';

  const STAGE_ID = 'cpuPreviewStage';
  const MOUNT_ID = 'cpuCanvasMount';
  const DOCK_ID = 'cpuViewportDock';

  const DEFAULT_STATE = {
    body: 'gray', // gray | silicon | carbon | titanium
    cores: 0,     // 0 | 1 | 2 | 4 | 8 | 16 | 32 | 64 | 86
    threads: 0,   // 0 | 4 | 6 | 8 | 12 | 18 | 36 | 64 | 86 | 108
    cooling: 0,   // 0 | 1 | 2 | 3 | 4
    graphics: '',
    ai: '',
    vCache: 'none',
    name: '',
    companyName: '',
    score: 0,
    tier: 'F',
    logoUrl: ''
  };

  let THREE = null;
  let OrbitControls = null;
  let RoomEnvironment = null;

  let initialized = false;
  let initPromise = null;
  let isSoftwareGl = false;
  let contextLost = false;

  let stageEl = null;
  let mountEl = null;
  let renderer = null;
  let scene = null;
  let camera = null;
  let controls = null;
  let pmremGenerator = null;
  let envTexture = null;

  // Cached Company Logo Image for Apple-style CPU top printing
  let loadedLogoUrl = '';
  let loadedLogoImg = null;

  // Dynamic model state & smooth animation targets
  let activeState = { ...DEFAULT_STATE };
  let currentExplode = 0;
  let targetExplode = 0;
  let currentLidOpen = 0;
  let targetLidOpen = 0;
  let autoSpin = false;
  let dockCollapsed = false;

  // Camera transition state (smooth exponential damp, cancelled on user input)
  let camAnimActive = false;
  const camTargetPos = { x: 2.95, y: 2.45, z: 3.15 };
  const camTargetLook = { x: 0, y: 0.14, z: 0 };

  // Component pop-in entrance multipliers (smooth spring settle when toggled)
  const animWeights = {
    cores: 1,
    threads: 1,
    cooling: 1,
    bodyPulse: 0
  };

  // Scene hierarchy groups
  let cpuRoot = null;
  let plinthGroup = null;
  let pinsGroup = null;
  let pcbGroup = null;
  let interposerGroup = null;
  let diesGroup = null;
  let threadsGroup = null;
  let ihsGroup = null;
  let aiBadgeGroup = null;
  let coolingGroup = null;
  let fanRotorGroup = null;

  // Reusable PBR materials & procedural textures
  const mats = {};
  const textures = {};
  const threadPipeMaterials = [];

  // Module-scope reusable math helpers (zero GC inside frame loop)
  let _vec3A = null;
  let _vec3B = null;
  let _mat4 = null;
  let _dummy = null;
  let _color = null;

  // Loop & visibility tracking
  let rafId = 0;
  let timerId = 0;
  let lastFrameMs = 0;
  let elapsedSec = 0;
  let pageVisible = false;
  let resizeObserver = null;
  let mutationObserver = null;

  function detectSoftwareWebGL() {
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param) || '');
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    } catch (e) {
      return true;
    }
  }

  async function loadThreeModules() {
    if (THREE && OrbitControls && RoomEnvironment) return true;
    try {
      const [threeMod, orbitMod, envMod] = await Promise.all([
        import('three'),
        import('three/addons/controls/OrbitControls.js'),
        import('three/addons/environments/RoomEnvironment.js')
      ]);
      THREE = threeMod;
      OrbitControls = orbitMod.OrbitControls;
      RoomEnvironment = envMod.RoomEnvironment;
      _vec3A = new THREE.Vector3();
      _vec3B = new THREE.Vector3();
      _mat4 = new THREE.Matrix4();
      _dummy = new THREE.Object3D();
      _color = new THREE.Color();
      return true;
    } catch (err) {
      console.warn('3D module load note:', err);
      return false;
    }
  }

  // ---------- Procedural Canvas Textures ----------

  function createContactShadowTexture() {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 12, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(0, 0, 0, 0.72)');
    g.addColorStop(0.45, 'rgba(6, 4, 14, 0.42)');
    g.addColorStop(0.8, 'rgba(6, 4, 14, 0.10)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function createPcbTextures(bodyType) {
    const size = 1024;
    const cColor = document.createElement('canvas');
    cColor.width = size;
    cColor.height = size;
    const ctx = cColor.getContext('2d');

    const cBump = document.createElement('canvas');
    cBump.width = size;
    cBump.height = size;
    const bctx = cBump.getContext('2d');

    // Palette by substrate material
    let bgA = '#4e5460';
    let bgB = '#3b404a';
    let traceColor = 'rgba(205, 212, 224, 0.36)';
    let goldColor = '#d4af57';
    let padRing = 'rgba(220, 185, 95, 0.72)';

    if (bodyType === 'silicon') {
      bgA = '#102a46';
      bgB = '#091b30';
      traceColor = 'rgba(94, 214, 255, 0.56)';
      goldColor = '#cfefff';
      padRing = 'rgba(130, 225, 255, 0.85)';
    } else if (bodyType === 'carbon') {
      bgA = '#171a22';
      bgB = '#0d0f15';
      traceColor = 'rgba(229, 184, 92, 0.48)';
      goldColor = '#f2c864';
      padRing = 'rgba(242, 200, 100, 0.85)';
    } else if (bodyType === 'titanium') {
      bgA = '#555d6b';
      bgB = '#252c38';
      traceColor = 'rgba(160, 210, 255, 0.58)';
      goldColor = '#e6edf5';
      padRing = 'rgba(195, 220, 245, 0.88)';
    }

    const grad = ctx.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, bgA);
    grad.addColorStop(1, bgB);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    bctx.fillStyle = '#404040';
    bctx.fillRect(0, 0, size, size);

    // Subtle carbon 2x2 twill weave or fiberglass micro-weave
    if (bodyType === 'carbon') {
      for (let y = 0; y < size; y += 16) {
        for (let x = 0; x < size; x += 16) {
          const shift = ((y / 16) % 2) * 8;
          ctx.fillStyle = ((x + shift) % 32 === 0) ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.22)';
          ctx.fillRect(x, y, 14, 7);
          ctx.fillStyle = ((x + shift) % 32 === 0) ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.16)';
          ctx.fillRect(x + 2, y + 8, 12, 7);

          bctx.fillStyle = ((x + shift) % 32 === 0) ? '#888' : '#252525';
          bctx.fillRect(x, y, 14, 7);
        }
      }
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.03)';
      ctx.lineWidth = 1;
      for (let i = 0; i < size; i += 12) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, size); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(size, i); ctx.stroke();
      }
    }

    // Radiating differential serpentine PCB bus traces
    const cx = size / 2;
    const cy = size / 2;
    ctx.strokeStyle = traceColor;
    ctx.lineWidth = 2.4;
    bctx.strokeStyle = '#c8c8c8';
    bctx.lineWidth = 2.6;

    const lanesPerSide = 26;
    for (let side = 0; side < 4; side++) {
      ctx.save();
      bctx.save();
      ctx.translate(cx, cy);
      bctx.translate(cx, cy);
      ctx.rotate((side * Math.PI) / 2);
      bctx.rotate((side * Math.PI) / 2);

      for (let i = 0; i < lanesPerSide; i++) {
        const offset = (i - (lanesPerSide - 1) / 2) * 16;
        const rInner = 165;
        const rMid1 = 235 + (i % 3) * 14;
        const rMid2 = 340;
        const rOuter = 458;
        const spread = offset * 1.48;

        ctx.beginPath();
        ctx.moveTo(offset, -rInner);
        ctx.lineTo(offset, -rMid1);
        ctx.lineTo(spread, -rMid2);
        ctx.lineTo(spread, -rOuter);
        ctx.stroke();

        bctx.beginPath();
        bctx.moveTo(offset, -rInner);
        bctx.lineTo(offset, -rMid1);
        bctx.lineTo(spread, -rMid2);
        bctx.lineTo(spread, -rOuter);
        bctx.stroke();

        // Micro-via pad
        ctx.fillStyle = padRing;
        ctx.beginPath();
        ctx.arc(spread, -rOuter, 3.8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      bctx.restore();
    }

    // Center socket perimeter copper keepout frame
    ctx.strokeStyle = goldColor;
    ctx.lineWidth = 4;
    ctx.strokeRect(cx - 185, cy - 185, 370, 370);
    bctx.strokeStyle = '#ffffff';
    bctx.lineWidth = 4;
    bctx.strokeRect(cx - 185, cy - 185, 370, 370);

    // Pin-1 Gold Corner Triangle Alignment Mark
    ctx.fillStyle = goldColor;
    ctx.beginPath();
    ctx.moveTo(46, size - 46);
    ctx.lineTo(116, size - 46);
    ctx.lineTo(46, size - 116);
    ctx.closePath();
    ctx.fill();

    // Fine outer copper ground rim
    ctx.strokeStyle = padRing;
    ctx.lineWidth = 6;
    ctx.strokeRect(24, 24, size - 48, size - 48);

    const map = new THREE.CanvasTexture(cColor);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 4;

    const bumpMap = new THREE.CanvasTexture(cBump);
    bumpMap.anisotropy = map.anisotropy;
    return { map, bumpMap };
  }

  function createSiliconDieTexture() {
    const size = 512;
    const cColor = document.createElement('canvas');
    cColor.width = size;
    cColor.height = size;
    const ctx = cColor.getContext('2d');

    const grad = ctx.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, '#142d4c');
    grad.addColorStop(0.5, '#1b4965');
    grad.addColorStop(1, '#2d1e4f');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    // Dense lithography core blocks & L2/L3 SRAM cache banks
    const blocks = [
      [28, 28, 210, 140, 'rgba(90, 215, 255, 0.30)'],
      [274, 28, 210, 140, 'rgba(90, 215, 255, 0.30)'],
      [28, 186, 210, 140, 'rgba(176, 132, 255, 0.28)'],
      [274, 186, 210, 140, 'rgba(176, 132, 255, 0.28)'],
      [28, 344, 456, 140, 'rgba(110, 235, 210, 0.24)']
    ];

    blocks.forEach(([x, y, w, h, tint]) => {
      ctx.fillStyle = tint;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(200, 245, 255, 0.6)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);

      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 1;
      for (let gx = x + 12; gx < x + w; gx += 12) {
        ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx, y + h); ctx.stroke();
      }
      for (let gy = y + 12; gy < y + h; gy += 12) {
        ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x + w, gy); ctx.stroke();
      }
    });

    const tex = new THREE.CanvasTexture(cColor);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 4;
    return tex;
  }

  function createIhsEtchTexture(state) {
    const size = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    const body = state.body;
    let baseTop = '#bfc4cd';
    let baseBot = '#888e99';
    let inkPrimary = '#22262f';
    let inkMuted = 'rgba(34, 38, 47, 0.68)';
    let accent = '#6e42c1';

    if (body === 'silicon') {
      baseTop = '#d7e8f6';
      baseBot = '#7f9cb5';
      inkPrimary = '#0c1f33';
      inkMuted = 'rgba(12, 31, 51, 0.72)';
      accent = '#0284c7';
    } else if (body === 'carbon') {
      baseTop = '#252934';
      baseBot = '#12151c';
      inkPrimary = '#f3e8ff';
      inkMuted = 'rgba(242, 200, 100, 0.82)';
      accent = '#eab308';
    } else if (body === 'titanium') {
      baseTop = '#d9e0e8';
      baseBot = '#778596';
      inkPrimary = '#17212e';
      inkMuted = 'rgba(23, 33, 46, 0.72)';
      accent = '#38bdf8';
    }

    const grad = ctx.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, baseTop);
    grad.addColorStop(0.55, baseBot);
    grad.addColorStop(1, baseTop);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    // Anisotropic horizontal brushed metal lines (or carbon micro-weave)
    if (body === 'carbon') {
      for (let y = 0; y < size; y += 16) {
        for (let x = 0; x < size; x += 16) {
          const shift = ((y / 16) % 2) * 8;
          ctx.fillStyle = ((x + shift) % 32 === 0) ? 'rgba(255,255,255,0.065)' : 'rgba(0,0,0,0.22)';
          ctx.fillRect(x, y, 14, 7);
        }
      }
    } else {
      for (let y = 0; y < size; y += 2) {
        ctx.fillStyle = (y % 4 === 0) ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.035)';
        ctx.fillRect(0, y, size, 1);
      }
    }

    // Subtle milled inner frame border
    ctx.strokeStyle = inkMuted;
    ctx.lineWidth = 4;
    ctx.strokeRect(72, 72, size - 144, size - 144);

    // Corner precision bracket ticks
    const bLen = 48;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 8;
    [
      [72, 72, 1, 1],
      [size - 72, 72, -1, 1],
      [72, size - 72, 1, -1],
      [size - 72, size - 72, -1, -1]
    ].forEach(([cx, cy, dx, dy]) => {
      ctx.beginPath();
      ctx.moveTo(cx + dx * bLen, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + dy * bLen);
      ctx.stroke();
    });

    // Logo centered in the middle & biggest, with the CPU name cleanly underneath
    const hasCustomLogo = Boolean(
      loadedLogoImg &&
      loadedLogoUrl === (state.logoUrl || '') &&
      loadedLogoImg.complete &&
      loadedLogoImg.naturalWidth > 0
    );

    const rawName = String(state.name || '').trim();
    const rawCompany = String(state.companyName || '').trim();
    const displayName = (rawName || rawCompany || 'CPU').slice(0, 24);
    const coreTxt = state.cores > 0 ? `${state.cores} CORE${state.cores > 1 ? 'S' : ''}` : 'NO CORE';
    const threadTxt = state.threads > 0 ? `${state.threads} THREADS` : 'NO THREADS';
    const specTxt = `${coreTxt}  ·  ${threadTxt}  ·  TIER ${state.tier || 'F'}`;

    ctx.textAlign = 'center';
    if (hasCustomLogo) {
      const logoSize = 520;
      const lx = (size - logoSize) / 2;
      const ly = 158;
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.shadowColor = body === 'carbon' ? 'rgba(0,0,0,0.7)' : 'rgba(15,23,42,0.32)';
      ctx.shadowBlur = 16;
      ctx.shadowOffsetY = 5;
      ctx.drawImage(loadedLogoImg, lx, ly, logoSize, logoSize);
      ctx.restore();
    } else {
      const mono = (rawCompany || displayName).replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || '◈';
      const cx = size / 2;
      const cy = 414;
      const r = 196;
      ctx.save();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = inkMuted;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(cx, cy, r - 22, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = inkPrimary;
      ctx.textBaseline = 'middle';
      ctx.font = '900 176px "Plus Jakarta Sans", system-ui, sans-serif';
      ctx.fillText(mono, cx, cy + 6);
      ctx.restore();
      ctx.textBaseline = 'alphabetic';
    }

    ctx.fillStyle = inkPrimary;
    const fontSize = displayName.length > 18 ? 42 : displayName.length > 13 ? 50 : 58;
    ctx.font = `900 ${fontSize}px "Plus Jakarta Sans", system-ui, sans-serif`;
    ctx.fillText(displayName, size / 2, 774);

    ctx.fillStyle = inkMuted;
    ctx.font = '700 26px "JetBrains Mono", monospace';
    ctx.fillText(specTxt, size / 2, 842);

    if (state.vCache && state.vCache !== 'none') {
      const cacheLabel = ({basic:'V-CACHE',advanced:'V-CACHE+',basic_3d:'3D V-CACHE',advanced_3d:'3D V-CACHE+'})[state.vCache] || 'V-CACHE';
      ctx.save(); ctx.fillStyle = '#172554'; ctx.strokeStyle = '#60a5fa'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.roundRect(310, 70, 404, 78, 16); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#dbeafe'; ctx.font = '800 28px "JetBrains Mono", monospace'; ctx.textAlign = 'center'; ctx.fillText(cacheLabel, 512, 120); ctx.restore();
    }

    if (state.graphics) {
      ctx.save();
      ctx.fillStyle = '#111827';
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.roundRect(720, 72, 238, 72, 16);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#e0f2fe';
      ctx.textAlign = 'center';
      ctx.font = '800 26px "JetBrains Mono", monospace';
      ctx.fillText('INTEGRATED GRAPHICS', 839, 118);
      ctx.restore();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 4;
    return tex;
  }

  function createCoolingCapLogoTexture(state) {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    const grad = ctx.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, '#2a3040');
    grad.addColorStop(0.5, '#191d28');
    grad.addColorStop(1, '#10131b');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    // Brushed horizontal grain
    for (let y = 0; y < size; y += 2) {
      ctx.fillStyle = (y % 4 === 0) ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.05)';
      ctx.fillRect(0, y, size, 1);
    }

    ctx.strokeStyle = 'rgba(226,232,240,0.22)';
    ctx.lineWidth = 4;
    ctx.strokeRect(26, 26, size - 52, size - 52);

    const hasCustomLogo = Boolean(
      loadedLogoImg &&
      loadedLogoUrl === (state.logoUrl || '') &&
      loadedLogoImg.complete &&
      loadedLogoImg.naturalWidth > 0
    );

    const rawName = String(state.name || '').trim();
    const rawCompany = String(state.companyName || '').trim();
    const displayName = (rawName || rawCompany || 'CPU').slice(0, 22);

    if (hasCustomLogo) {
      const ls = 312;
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 12;
      ctx.drawImage(loadedLogoImg, (size - ls) / 2, 52, ls, ls);
      ctx.restore();
    } else {
      const mono = (rawCompany || displayName).replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || '◈';
      ctx.save();
      ctx.strokeStyle = 'rgba(168,85,247,0.8)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(size / 2, 204, 108, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#f8fafc';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '900 102px "Plus Jakarta Sans", system-ui, sans-serif';
      ctx.fillText(mono, size / 2, 208);
      ctx.restore();
    }

    ctx.fillStyle = '#e2e8f0';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const nameSize = displayName.length > 15 ? 24 : 28;
    ctx.font = `800 ${nameSize}px "Plus Jakarta Sans", system-ui, sans-serif`;
    ctx.fillText(displayName, size / 2, 422);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '700 16px "JetBrains Mono", monospace';
    ctx.fillText(state.cooling >= 3 ? 'VAPOR CHAMBER' : state.cooling >= 2 ? 'GREAT COOLING' : 'BUILT-IN COOLING', size / 2, 460);
    if (state.graphics) {
      ctx.fillStyle = '#082f49';
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.roundRect(322, 22, 168, 32, 8); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#e0f2fe'; ctx.font = '700 13px "JetBrains Mono", monospace';
      ctx.fillText('INTEGRATED GRAPHICS', 406, 43);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 4;
    return tex;
  }

  function ensureLogoImageLoaded(url) {
    const clean = String(url || '').trim();
    if (!clean) {
      if (loadedLogoUrl) {
        loadedLogoUrl = '';
        loadedLogoImg = null;
        if (initialized) applyBodyMaterialFinish(activeState.body);
      }
      return Promise.resolve(null);
    }
    if (clean === loadedLogoUrl && loadedLogoImg && loadedLogoImg.complete) {
      return Promise.resolve(loadedLogoImg);
    }
    loadedLogoUrl = clean;
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const done = (res) => resolve(res || null);
      const timer = setTimeout(() => done(null), 1500);
      img.onload = () => {
        clearTimeout(timer);
        if (loadedLogoUrl === clean) {
          loadedLogoImg = img;
          if (initialized) applyBodyMaterialFinish(activeState.body);
        }
        done(img);
      };
      img.onerror = () => {
        clearTimeout(timer);
        done(null);
      };
      img.src = clean;
    });
  }

  // ---------- Extruded Geometry Builders ----------

  function createNotchedSubstrateGeometry() {
    // 2.40 x 2.40 CPU PCB with corner Pin-1 bevel & side socket keying notches
    const hw = 1.20;
    const r = 0.08;
    const nr = 0.095;
    const shape = new THREE.Shape();

    // Start bottom-left (Pin-1 chamfered corner)
    shape.moveTo(-hw + 0.16, -hw);
    shape.lineTo(hw - r, -hw);
    shape.quadraticCurveTo(hw, -hw, hw, -hw + r);
    // Right side with socket notch at y = 0
    shape.lineTo(hw, -nr);
    shape.absarc(hw, 0, nr, -Math.PI / 2, Math.PI / 2, true);
    shape.lineTo(hw, hw - r);
    shape.quadraticCurveTo(hw, hw, hw - r, hw);
    // Top side
    shape.lineTo(-hw + r, hw);
    shape.quadraticCurveTo(-hw, hw, -hw, hw - r);
    // Left side with socket notch at y = 0
    shape.lineTo(-hw, nr);
    shape.absarc(-hw, 0, nr, Math.PI / 2, -Math.PI / 2, true);
    // Corner Pin-1 45-deg chamfer
    shape.lineTo(-hw, -hw + 0.16);
    shape.closePath();

    const geom = new THREE.ExtrudeGeometry(shape, {
      depth: 0.09,
      steps: 1,
      bevelEnabled: true,
      bevelThickness: 0.014,
      bevelSize: 0.014,
      bevelSegments: 3
    });
    geom.rotateX(-Math.PI / 2);
    geom.center();

    // Remap planar top-down UVs cleanly across [-hw, +hw]
    const pos = geom.attributes.position;
    const uvs = new Float32Array(pos.count * 2);
    const span = hw * 2.04;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const pz = pos.getZ(i);
      uvs[i * 2] = (px + span / 2) / span;
      uvs[i * 2 + 1] = 1 - (pz + span / 2) / span;
    }
    geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geom.computeVertexNormals();
    if (geom.computeTangents) geom.computeTangents();
    return geom;
  }

  function createRoundedRectGeometry(width, height, depth, radius, bevel = 0.015) {
    const hw = width / 2;
    const hh = height / 2;
    const r = Math.min(radius, hw * 0.45, hh * 0.45);
    const shape = new THREE.Shape();
    shape.moveTo(-hw + r, -hh);
    shape.lineTo(hw - r, -hh);
    shape.quadraticCurveTo(hw, -hh, hw, -hh + r);
    shape.lineTo(hw, hh - r);
    shape.quadraticCurveTo(hw, hh, hw - r, hh);
    shape.lineTo(-hw + r, hh);
    shape.quadraticCurveTo(-hw, hh, -hw, hh - r);
    shape.lineTo(-hw, -hh + r);
    shape.quadraticCurveTo(-hw, -hh, -hw + r, -hh);

    const geom = new THREE.ExtrudeGeometry(shape, {
      depth,
      steps: 1,
      bevelEnabled: bevel > 0,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 3
    });
    geom.rotateX(-Math.PI / 2);
    geom.center();

    const pos = geom.attributes.position;
    const uvs = new Float32Array(pos.count * 2);
    const sw = width + bevel * 2;
    const sh = height + bevel * 2;
    for (let i = 0; i < pos.count; i++) {
      uvs[i * 2] = (pos.getX(i) + sw / 2) / sw;
      uvs[i * 2 + 1] = 1 - (pos.getZ(i) + sh / 2) / sh;
    }
    geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geom.computeVertexNormals();
    if (geom.computeTangents) geom.computeTangents();
    return geom;
  }

  function createWingedIhsFlangeGeometry() {
    // Classic winged IHS base collar (cross-flange shoulders)
    const shape = new THREE.Shape();
    const wOuter = 1.04;
    const wWing = 0.72;
    const step = 0.20;
    shape.moveTo(-wWing, -wOuter);
    shape.lineTo(wWing, -wOuter);
    shape.lineTo(wWing, -wOuter + step);
    shape.lineTo(wOuter, -wOuter + step);
    shape.lineTo(wOuter, wOuter - step);
    shape.lineTo(wWing, wOuter - step);
    shape.lineTo(wWing, wOuter);
    shape.lineTo(-wWing, wOuter);
    shape.lineTo(-wWing, wOuter - step);
    shape.lineTo(-wOuter, wOuter - step);
    shape.lineTo(-wOuter, -wOuter + step);
    shape.lineTo(-wWing, -wOuter + step);
    shape.closePath();

    const geom = new THREE.ExtrudeGeometry(shape, {
      depth: 0.055,
      steps: 1,
      bevelEnabled: true,
      bevelThickness: 0.015,
      bevelSize: 0.015,
      bevelSegments: 2
    });
    geom.rotateX(-Math.PI / 2);
    geom.center();
    geom.computeVertexNormals();
    return geom;
  }

  function clearGroupDynamic(group) {
    if (!group) return;
    const sharedMats = new Set(Object.values(mats));
    const geoms = new Set();
    const localMats = new Set();
    group.traverse(obj => {
      if (obj.geometry) geoms.add(obj.geometry);
      if (obj.material) {
        const arr = Array.isArray(obj.material) ? obj.material : [obj.material];
        arr.forEach(m => {
          if (m && !sharedMats.has(m)) localMats.add(m);
        });
      }
    });
    while (group.children.length) {
      group.remove(group.children[0]);
    }
    geoms.forEach(g => { try { g.dispose(); } catch (e) {} });
    localMats.forEach(m => { try { m.dispose(); } catch (e) {} });
  }

  // ---------- Scene & Material Initialization ----------

  function buildMaterials() {
    textures.pcbGray = createPcbTextures('gray');
    textures.pcbSilicon = createPcbTextures('silicon');
    textures.pcbCarbon = createPcbTextures('carbon');
    textures.pcbTitanium = createPcbTextures('titanium');
    textures.siliconDie = createSiliconDieTexture();
    textures.ihs = createIhsEtchTexture(activeState);
    textures.coolingLogo = createCoolingCapLogoTexture(activeState);

    mats.pcb = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: textures.pcbGray.map,
      bumpMap: textures.pcbGray.bumpMap,
      bumpScale: 0.012,
      roughness: 0.56,
      metalness: 0.14,
      clearcoat: 0.12
    });

    mats.pinsGold = new THREE.MeshStandardMaterial({
      color: 0xe6be5a,
      metalness: 0.96,
      roughness: 0.16
    });

    mats.ceramicCap = new THREE.MeshStandardMaterial({
      color: 0xb98d59,
      metalness: 0.08,
      roughness: 0.42
    });

    mats.solderEnd = new THREE.MeshStandardMaterial({
      color: 0xd6dde8,
      metalness: 0.92,
      roughness: 0.22
    });

    mats.interposer = new THREE.MeshStandardMaterial({
      color: 0x202634,
      metalness: 0.35,
      roughness: 0.52
    });

    mats.dieSilicon = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: textures.siliconDie,
      metalness: 0.58,
      roughness: 0.11,
      clearcoat: 1.0,
      clearcoatRoughness: 0.06,
      iridescence: 0.92,
      iridescenceIOR: 1.45,
      iridescenceThicknessRange: [140, 480]
    });

    mats.iodSilicon = new THREE.MeshPhysicalMaterial({
      color: 0x20324a,
      metalness: 0.65,
      roughness: 0.14,
      clearcoat: 0.95,
      iridescence: 0.65
    });

    mats.copper = new THREE.MeshPhysicalMaterial({
      color: 0xd67c49,
      metalness: 0.95,
      roughness: 0.18,
      anisotropy: 0.55
    });

    mats.alumFin = new THREE.MeshPhysicalMaterial({
      color: 0xcbd5e1,
      metalness: 0.92,
      roughness: 0.24,
      anisotropy: 0.72
    });

    mats.darkAnodized = new THREE.MeshPhysicalMaterial({
      color: 0x1e222e,
      metalness: 0.82,
      roughness: 0.30,
      anisotropy: 0.45
    });

    mats.ihsTop = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: textures.ihs,
      metalness: 0.25,
      roughness: 0.45,
      clearcoat: 0.20,
      anisotropy: 0.80,
      transparent: true,
      opacity: 1.0
    });

    mats.ihsFlange = new THREE.MeshPhysicalMaterial({
      color: 0x8f96a3,
      metalness: 0.65,
      roughness: 0.34,
      anisotropy: 0.65,
      transparent: true,
      opacity: 1.0
    });

    mats.fanBlade = new THREE.MeshPhysicalMaterial({
      color: 0x262c3a,
      metalness: 0.32,
      roughness: 0.26,
      clearcoat: 0.65
    });

    mats.cryoAccent = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0284c7,
      emissiveIntensity: 0.85,
      metalness: 0.4,
      roughness: 0.25
    });

    mats.coolingLogoCap = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: textures.coolingLogo,
      metalness: 0.48,
      roughness: 0.28,
      clearcoat: 0.45
    });
  }

  function buildStaticSubstrateAndPins() {
    // 1. Plinth & Contact Shadow (grounded at y = -0.68)
    plinthGroup = new THREE.Group();
    const shadowTex = createContactShadowTexture();
    const shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(4.4, 4.4),
      new THREE.MeshBasicMaterial({
        map: shadowTex,
        transparent: true,
        depthWrite: false,
        opacity: 0.62
      })
    );
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = -0.74;
    plinthGroup.add(shadowPlane);

    const plinthRing = new THREE.Mesh(
      new THREE.RingGeometry(1.62, 1.72, 72),
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
    plinthRing.position.y = -0.72;
    plinthGroup.add(plinthRing);
    scene.add(plinthGroup);

    // 2. Underside Gold Pins (InstancedMesh) + Underside Ceramic Decoupling Caps
    pinsGroup = new THREE.Group();
    const pinGeom = new THREE.CylinderGeometry(0.020, 0.013, 0.095, 8);
    const gridN = 17;
    const spacing = 0.125;
    const pinPositions = [];
    for (let ix = 0; ix < gridN; ix++) {
      for (let iz = 0; iz < gridN; iz++) {
        // Leave central cavity open for underside SMD decoupling capacitors
        const cx = Math.abs(ix - (gridN - 1) / 2);
        const cz = Math.abs(iz - (gridN - 1) / 2);
        if (cx <= 3.2 && cz <= 3.2) continue;
        // Skip Pin-1 corner triangle chamfer area
        if (ix === 0 && iz === gridN - 1) continue;
        pinPositions.push([
          (ix - (gridN - 1) / 2) * spacing,
          -0.095,
          (iz - (gridN - 1) / 2) * spacing
        ]);
      }
    }

    const pinsMesh = new THREE.InstancedMesh(pinGeom, mats.pinsGold, pinPositions.length);
    pinsMesh.castShadow = !isSoftwareGl;
    pinsMesh.receiveShadow = true;
    pinPositions.forEach(([px, py, pz], idx) => {
      _dummy.position.set(px, py, pz);
      _dummy.rotation.set(0, 0, 0);
      _dummy.scale.set(1, 1, 1);
      _dummy.updateMatrix();
      pinsMesh.setMatrixAt(idx, _dummy.matrix);
    });
    pinsMesh.instanceMatrix.needsUpdate = true;
    pinsMesh.computeBoundingSphere();
    pinsGroup.add(pinsMesh);

    // Underside SMD MLCC Capacitors inside the center pin-cutout cavity (InstancedMesh)
    const capBodyGeom = new THREE.BoxGeometry(0.085, 0.036, 0.044);
    const capGrid = 4;
    const capsMesh = new THREE.InstancedMesh(capBodyGeom, mats.ceramicCap, capGrid * capGrid);
    const capEndsGeom = new THREE.BoxGeometry(0.102, 0.032, 0.042);
    const capEndsMesh = new THREE.InstancedMesh(capEndsGeom, mats.solderEnd, capGrid * capGrid);
    let ci = 0;
    for (let x = 0; x < capGrid; x++) {
      for (let z = 0; z < capGrid; z++) {
        const px = (x - 1.5) * 0.16;
        const pz = (z - 1.5) * 0.16;
        _dummy.position.set(px, -0.068, pz);
        _dummy.rotation.set(0, (x + z) % 2 === 0 ? 0 : Math.PI / 2, 0);
        _dummy.scale.set(1, 1, 1);
        _dummy.updateMatrix();
        capsMesh.setMatrixAt(ci, _dummy.matrix);
        capEndsMesh.setMatrixAt(ci, _dummy.matrix);
        ci++;
      }
    }
    capsMesh.instanceMatrix.needsUpdate = true;
    capEndsMesh.instanceMatrix.needsUpdate = true;
    capsMesh.computeBoundingSphere();
    capEndsMesh.computeBoundingSphere();
    pinsGroup.add(capsMesh, capEndsMesh);
    cpuRoot.add(pinsGroup);

    // 3. Main Beveled PCB Substrate + Perimeter Top-Side SMD Capacitors
    pcbGroup = new THREE.Group();
    const pcbGeom = createNotchedSubstrateGeometry();
    const pcbMesh = new THREE.Mesh(pcbGeom, mats.pcb);
    pcbMesh.castShadow = !isSoftwareGl;
    pcbMesh.receiveShadow = true;
    pcbGroup.add(pcbMesh);

    const topCapGeom = new THREE.BoxGeometry(0.065, 0.025, 0.034);
    const topCapPositions = [];
    for (let k = -3; k <= 3; k++) {
      if (k === 0) continue;
      topCapPositions.push([k * 0.18, 0.068, -1.03, 0]);
      topCapPositions.push([k * 0.18, 0.068, 1.03, 0]);
    }
    const topCapsMesh = new THREE.InstancedMesh(topCapGeom, mats.ceramicCap, topCapPositions.length);
    topCapPositions.forEach(([px, py, pz, ry], idx) => {
      _dummy.position.set(px, py, pz);
      _dummy.rotation.set(0, ry, 0);
      _dummy.scale.set(1, 1, 1);
      _dummy.updateMatrix();
      topCapsMesh.setMatrixAt(idx, _dummy.matrix);
    });
    topCapsMesh.instanceMatrix.needsUpdate = true;
    topCapsMesh.computeBoundingSphere();
    pcbGroup.add(topCapsMesh);
    cpuRoot.add(pcbGroup);

    // 4. Organic Interposer Package Frame
    interposerGroup = new THREE.Group();
    const interpBase = new THREE.Mesh(
      createRoundedRectGeometry(1.56, 1.56, 0.028, 0.05, 0.008),
      mats.interposer
    );
    interpBase.castShadow = !isSoftwareGl;
    interpBase.receiveShadow = true;
    interposerGroup.add(interpBase);

    const interpRing = new THREE.Mesh(
      createRoundedRectGeometry(1.60, 1.60, 0.012, 0.05, 0.004),
      mats.copper
    );
    interpRing.position.y = 0.018;
    interposerGroup.add(interpRing);
    cpuRoot.add(interposerGroup);

    // 5. Dynamic containers for Cores, Threads, IHS, Cooling
    diesGroup = new THREE.Group();
    threadsGroup = new THREE.Group();
    ihsGroup = new THREE.Group();
    coolingGroup = new THREE.Group();
    cpuRoot.add(diesGroup, threadsGroup, ihsGroup, coolingGroup);

    buildSculptedIhs();
  }

  function buildSculptedIhs() {
    clearGroupDynamic(ihsGroup);
    const flange = new THREE.Mesh(createWingedIhsFlangeGeometry(), mats.ihsFlange);
    flange.castShadow = !isSoftwareGl;
    flange.receiveShadow = true;
    flange.position.y = -0.02;

    const crown = new THREE.Mesh(
      createRoundedRectGeometry(1.66, 1.66, 0.085, 0.10, 0.022),
      mats.ihsTop
    );
    crown.castShadow = !isSoftwareGl;
    crown.receiveShadow = true;
    crown.position.y = 0.045;

    ihsGroup.add(flange, crown);
    aiBadgeGroup = new THREE.Group();
    ihsGroup.add(aiBadgeGroup);
    rebuildAiBadge(activeState.ai);
  }

  function rebuildAiBadge(aiType) {
    if (!aiBadgeGroup) return;
    clearGroupDynamic(aiBadgeGroup);
    if (!aiType) return;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#21133f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#a78bfa';
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, canvas.width - 10, canvas.height - 10);
    ctx.fillStyle = '#f5f3ff';
    ctx.font = '900 82px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('AI', 128, 66);
    const labelTexture = new THREE.CanvasTexture(canvas);
    labelTexture.colorSpace = THREE.SRGBColorSpace;
    const backing = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.20, 0.035), mats.darkAnodized);
    backing.castShadow = !isSoftwareGl;
    backing.position.set(0.55, 0.12, 0.84);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.37, 0.15), new THREE.MeshBasicMaterial({ map: labelTexture, transparent: false, toneMapped: false }));
    label.position.set(0.55, 0.12, 0.861);
    aiBadgeGroup.add(backing, label);
  }

  // ---------- Dynamic Hardware Rebuild per Research Selection ----------

  function rebuildSiliconCores(coreCount) {
    clearGroupDynamic(diesGroup);

    const iodGeom = createRoundedRectGeometry(0.38, 0.30, 0.04, 0.025, 0.006);
    const iodMesh = new THREE.Mesh(iodGeom, mats.iodSilicon);
    iodMesh.castShadow = !isSoftwareGl;
    iodMesh.position.set(0, 0.025, coreCount >= 64 ? 0.86 : coreCount >= 32 ? 0.78 : 0.48);
    diesGroup.add(iodMesh);

    if (coreCount <= 0) {
      const miniGeom = createRoundedRectGeometry(0.34, 0.24, 0.036, 0.02, 0.006);
      const miniMesh = new THREE.Mesh(miniGeom, mats.dieSilicon);
      miniMesh.position.set(0, 0.02, -0.22);
      diesGroup.add(miniMesh);
      return;
    }

    const cols = coreCount >= 86 ? 11 : coreCount >= 64 ? 8 : coreCount <= 1 ? 1 : coreCount <= 4 ? 2 : coreCount <= 8 ? 4 : 8;
    const rows = Math.ceil(coreCount / cols);
    const spacingX = coreCount >= 86 ? 0.18 : coreCount >= 64 ? 0.22 : coreCount >= 16 ? 0.22 : coreCount >= 8 ? 0.30 : 0.72 / Math.max(1, cols - 1);
    const spacingZ = coreCount >= 64 ? 0.15 : coreCount >= 16 ? 0.22 : coreCount >= 8 ? 0.30 : 0.40;
    const dieW = coreCount >= 64 ? 0.135 : coreCount >= 32 ? 0.15 : coreCount >= 16 ? 0.19 : coreCount >= 8 ? 0.25 : coreCount >= 4 ? 0.42 : coreCount === 2 ? 0.54 : 0.68;
    const dieH = coreCount >= 64 ? 0.125 : coreCount >= 32 ? 0.14 : coreCount >= 16 ? 0.17 : coreCount >= 8 ? 0.22 : coreCount >= 4 ? 0.28 : coreCount === 2 ? 0.34 : 0.40;

    const chipGeom = createRoundedRectGeometry(dieW, dieH, 0.035, 0.02, 0.005);
    const frameGeom = createRoundedRectGeometry(dieW + 0.035, dieH + 0.035, 0.012, 0.025, 0.003);
    for (let i = 0; i < coreCount; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = (col - (Math.min(cols, coreCount) - 1) / 2) * spacingX;
      const cz = (coreCount >= 64 ? -0.72 : -0.34) + row * spacingZ;
      const collar = new THREE.Mesh(frameGeom, mats.copper);
      collar.position.set(cx, 0.008, cz);
      diesGroup.add(collar);
      const chip = new THREE.Mesh(chipGeom, mats.dieSilicon);
      chip.castShadow = !isSoftwareGl;
      chip.receiveShadow = true;
      chip.position.set(cx, 0.034, cz);
      diesGroup.add(chip);
    }
  }

  function rebuildThreadInterconnects(threadCount, coreCount) {
    clearGroupDynamic(threadsGroup);
    threadPipeMaterials.length = 0;
    if (threadCount <= 0) return;

    const lanes = Math.min(18, Math.max(4, threadCount));
    const zIod = coreCount >= 4 ? 0.32 : 0.14;
    const zTarget = coreCount >= 4 ? -0.34 : -0.18;

    for (let i = 0; i < lanes; i++) {
      const t = lanes === 1 ? 0 : (i / (lanes - 1)) * 2 - 1; // [-1 .. 1]
      const xStart = t * 0.16;
      const xEnd = t * (coreCount >= 2 ? 0.44 : 0.24);
      const archH = 0.068 + (i % 2) * 0.018;

      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(xStart, 0.028, zIod),
        new THREE.Vector3((xStart + xEnd) * 0.5, archH, (zIod + zTarget) * 0.5),
        new THREE.Vector3(xEnd, 0.028, zTarget)
      ]);
      const pipeGeom = new THREE.TubeGeometry(curve, 16, 0.014, 8, false);
      const isCyan = i % 2 === 1;
      const pipeMat = new THREE.MeshPhysicalMaterial({
        color: isCyan ? 0x38bdf8 : 0xf59e0b,
        emissive: isCyan ? 0x0284c7 : 0xb45309,
        emissiveIntensity: 0.45,
        metalness: 0.85,
        roughness: 0.18
      });
      threadPipeMaterials.push(pipeMat);

      const pipeMesh = new THREE.Mesh(pipeGeom, pipeMat);
      pipeMesh.castShadow = !isSoftwareGl;
      threadsGroup.add(pipeMesh);
    }

    // Precision collector crossbar
    const barGeom = createRoundedRectGeometry(1.06, 0.06, 0.018, 0.015, 0.004);
    const barMesh = new THREE.Mesh(barGeom, mats.copper);
    barMesh.position.set(0, 0.024, zIod + 0.08);
    threadsGroup.add(barMesh);
  }

  function rebuildCoolingStack(coolingLevel) {
    clearGroupDynamic(coolingGroup);
    fanRotorGroup = null;
    if (coolingLevel <= 0) return;

    const isUltra = coolingLevel >= 4;
    const isGreat = coolingLevel >= 2 && !isUltra;
    const isVapor = coolingLevel === 3;

    // 1. Machined retention bracket & 4 corner hex screws
    const bracketGeom = createRoundedRectGeometry(1.78, 1.78, 0.022, 0.09, 0.006);
    const bracketMesh = new THREE.Mesh(bracketGeom, mats.darkAnodized);
    bracketMesh.castShadow = !isSoftwareGl;
    bracketMesh.position.y = 0.01;
    coolingGroup.add(bracketMesh);

    const boltGeom = new THREE.CylinderGeometry(0.045, 0.045, 0.048, 6);
    const bolts = new THREE.InstancedMesh(boltGeom, mats.alumFin, 4);
    [[-0.78, -0.78], [0.78, -0.78], [-0.78, 0.78], [0.78, 0.78]].forEach(([bx, bz], i) => {
      _dummy.position.set(bx, 0.032, bz);
      _dummy.rotation.set(0, 0, 0);
      _dummy.scale.set(1, 1, 1);
      _dummy.updateMatrix();
      bolts.setMatrixAt(i, _dummy.matrix);
    });
    bolts.instanceMatrix.needsUpdate = true;
    bolts.computeBoundingSphere();
    coolingGroup.add(bolts);

    // 2. Copper Vapor Coldplate Collar
    const blockGeom = createRoundedRectGeometry(isVapor ? 1.38 : isGreat ? 1.18 : 0.96, isVapor ? 1.38 : isGreat ? 1.18 : 0.96, isVapor ? 0.14 : isGreat ? 0.11 : 0.055, 0.06, 0.010);
    const blockMesh = new THREE.Mesh(blockGeom, mats.copper);
    blockMesh.castShadow = !isSoftwareGl;
    blockMesh.position.y = isGreat ? 0.065 : 0.038;
    coolingGroup.add(blockMesh);

    // 3. Built-In Cooling: small precision copper pipes going right INTO the CPU
    //    Great Cooling: noticeably bigger, thicker high-capacity copper pipes plunging deep INSIDE the CPU
    const pipeRadius = isGreat ? 0.056 : 0.022;
    const collarOuterR = isGreat ? 0.088 : 0.042;
    const collarHeight = isGreat ? 0.065 : 0.042;
    const finStackBottomY = isGreat ? 0.22 : 0.095;
    const finStackTopY = isGreat ? 0.70 : 0.28;
    const pipeEntryDepthY = isGreat ? -0.105 : -0.075; // Plunges directly inside the CPU IHS & die pocket!

    const collarGeom = new THREE.CylinderGeometry(collarOuterR, collarOuterR * 1.1, collarHeight, 16);

    if (!isGreat && !isUltra) {
      // Built-In Cooling: 4 sleek small copper heatpipes arching out of compact fin core and diving into CPU socket ports
      const pipeOffsetsZ = [-0.42, -0.16, 0.16, 0.42];
      pipeOffsetsZ.forEach((oz) => {
        const pipeCurve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(-0.62, pipeEntryDepthY, oz),
          new THREE.Vector3(-0.62, 0.045, oz),
          new THREE.Vector3(-0.48, 0.19, oz),
          new THREE.Vector3(0.0, 0.22, oz),
          new THREE.Vector3(0.48, 0.19, oz),
          new THREE.Vector3(0.62, 0.045, oz),
          new THREE.Vector3(0.62, pipeEntryDepthY, oz)
        ]);
        const pGeom = new THREE.TubeGeometry(pipeCurve, 32, pipeRadius, 12, false);
        const pMesh = new THREE.Mesh(pGeom, mats.copper);
        pMesh.castShadow = !isSoftwareGl;
        coolingGroup.add(pMesh);

        [-0.62, 0.62].forEach((cx) => {
          const cMesh = new THREE.Mesh(collarGeom, mats.darkAnodized);
          cMesh.position.set(cx, -0.005, oz);
          coolingGroup.add(cMesh);
        });
      });

      // Compact low-profile aluminum fin stack + printed Company Logo top plate
      const finCount = 10;
      const finGeom = new THREE.BoxGeometry(1.18, 0.012, 1.14);
      const fins = new THREE.InstancedMesh(finGeom, mats.alumFin, finCount);
      fins.castShadow = !isSoftwareGl;
      fins.receiveShadow = true;
      for (let i = 0; i < finCount; i++) {
        const fy = finStackBottomY + (i / (finCount - 1)) * (finStackTopY - finStackBottomY);
        _dummy.position.set(0, fy, 0);
        _dummy.rotation.set(0, 0, 0);
        _dummy.scale.set(1, 1, 1);
        _dummy.updateMatrix();
        fins.setMatrixAt(i, _dummy.matrix);
      }
      fins.instanceMatrix.needsUpdate = true;
      fins.computeBoundingSphere();
      coolingGroup.add(fins);

      const capGeom = createRoundedRectGeometry(1.22, 1.18, 0.028, 0.05, 0.008);
      const capMesh = new THREE.Mesh(capGeom, [mats.coolingLogoCap, mats.darkAnodized]);
      capMesh.castShadow = !isSoftwareGl;
      capMesh.position.y = finStackTopY + 0.024;
      coolingGroup.add(capMesh);
    } else if (isUltra) {
      // Ultra Cooling keeps the compact Built-In Cooling footprint but upgrades its
      // low-profile fin plates and top plate to solid copper.
      const pipeOffsetsZ = [-0.42, -0.16, 0.16, 0.42];
      pipeOffsetsZ.forEach((oz) => {
        const pipeCurve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(-0.62, pipeEntryDepthY, oz),
          new THREE.Vector3(-0.62, 0.045, oz),
          new THREE.Vector3(-0.48, 0.19, oz),
          new THREE.Vector3(0.0, 0.22, oz),
          new THREE.Vector3(0.48, 0.19, oz),
          new THREE.Vector3(0.62, 0.045, oz),
          new THREE.Vector3(0.62, pipeEntryDepthY, oz)
        ]);
        const pGeom = new THREE.TubeGeometry(pipeCurve, 32, pipeRadius, 12, false);
        const pMesh = new THREE.Mesh(pGeom, mats.copper);
        pMesh.castShadow = !isSoftwareGl;
        coolingGroup.add(pMesh);
        [-0.62, 0.62].forEach((cx) => {
          const cMesh = new THREE.Mesh(collarGeom, mats.darkAnodized);
          cMesh.position.set(cx, -0.005, oz);
          coolingGroup.add(cMesh);
        });
      });

      // Ten tightly spaced copper plates, matching the Built-In stack's low profile.
      const ultraFinCount = 10;
      const ultraFinGeom = new THREE.BoxGeometry(1.18, 0.018, 1.14);
      const ultraFins = new THREE.InstancedMesh(ultraFinGeom, mats.copper, ultraFinCount);
      ultraFins.castShadow = !isSoftwareGl;
      ultraFins.receiveShadow = true;
      for (let i = 0; i < ultraFinCount; i++) {
        const fy = 0.095 + (i / (ultraFinCount - 1)) * 0.185;
        _dummy.position.set(0, fy, 0);
        _dummy.rotation.set(0, 0, 0);
        _dummy.scale.set(1, 1, 1);
        _dummy.updateMatrix();
        ultraFins.setMatrixAt(i, _dummy.matrix);
      }
      ultraFins.instanceMatrix.needsUpdate = true;
      ultraFins.computeBoundingSphere();
      coolingGroup.add(ultraFins);

      const copperTopPlate = new THREE.Mesh(
        createRoundedRectGeometry(1.22, 1.18, 0.035, 0.05, 0.008),
        mats.copper
      );
      copperTopPlate.castShadow = !isSoftwareGl;
      copperTopPlate.position.y = 0.315;
      coolingGroup.add(copperTopPlate);
    } else if (isVapor) {
      // Vapor Chamber Cooling: a broad sealed copper chamber feeds one dense fin tower.
      // This is intentionally a different architecture from Great Cooling's twin towers.
      const chamberBase = new THREE.Mesh(
        new THREE.BoxGeometry(1.62, 0.105, 1.62),
        mats.copper
      );
      chamberBase.position.set(0, 0.105, 0);
      chamberBase.castShadow = !isSoftwareGl;
      chamberBase.receiveShadow = true;
      coolingGroup.add(chamberBase);

      // Dark perimeter gasket and raised machined chamber rim.
      const gasket = new THREE.Mesh(
        new THREE.BoxGeometry(1.54, 0.025, 1.54),
        mats.darkAnodized
      );
      gasket.position.set(0, 0.164, 0);
      coolingGroup.add(gasket);

      const chamberLid = new THREE.Mesh(
        new THREE.BoxGeometry(1.50, 0.055, 1.50),
        mats.copper
      );
      chamberLid.position.set(0, 0.197, 0);
      chamberLid.castShadow = !isSoftwareGl;
      coolingGroup.add(chamberLid);

      // Visible flattened vapor channels branching from the central evaporator zone.
      const channelMat = mats.alumFin;
      const channelGeom = new THREE.BoxGeometry(0.035, 0.012, 1.12);
      for (let i = -3; i <= 3; i++) {
        const channel = new THREE.Mesh(channelGeom, channelMat);
        channel.position.set(i * 0.19, 0.231, 0);
        coolingGroup.add(channel);
      }
      const evaporator = new THREE.Mesh(
        new THREE.CylinderGeometry(0.27, 0.27, 0.025, 48),
        mats.darkAnodized
      );
      evaporator.position.set(0, 0.239, 0);
      coolingGroup.add(evaporator);
      const evaporatorCore = new THREE.Mesh(
        new THREE.CylinderGeometry(0.19, 0.19, 0.03, 48),
        mats.copper
      );
      evaporatorCore.position.set(0, 0.258, 0);
      coolingGroup.add(evaporatorCore);

      // One broad, tightly packed fin tower (not Great Cooling's two towers).
      const vaporFinCount = 24;
      const vaporFinGeom = new THREE.BoxGeometry(1.34, 0.46, 0.018);
      const vaporFins = new THREE.InstancedMesh(vaporFinGeom, mats.alumFin, vaporFinCount);
      vaporFins.castShadow = !isSoftwareGl;
      vaporFins.receiveShadow = true;
      for (let i = 0; i < vaporFinCount; i++) {
        _dummy.position.set(0, 0.50, -0.57 + i * (1.14 / (vaporFinCount - 1)));
        _dummy.rotation.set(0, 0, 0);
        _dummy.scale.set(1, 1, 1);
        _dummy.updateMatrix();
        vaporFins.setMatrixAt(i, _dummy.matrix);
      }
      vaporFins.instanceMatrix.needsUpdate = true;
      vaporFins.computeBoundingSphere();
      coolingGroup.add(vaporFins);

      // Single front-mounted axial fan with a distinct circular shroud.
      const fanY = 0.51;
      const shroud = new THREE.Mesh(
        new THREE.TorusGeometry(0.39, 0.035, 12, 40),
        mats.darkAnodized
      );
      shroud.rotation.y = Math.PI / 2;
      shroud.position.set(0, fanY, 0.72);
      coolingGroup.add(shroud);

      fanRotorGroup = new THREE.Group();
      fanRotorGroup.position.set(0, fanY, 0.72);
      const hub = new THREE.Mesh(
        new THREE.CylinderGeometry(0.105, 0.105, 0.09, 24),
        mats.alumFin
      );
      hub.rotation.x = Math.PI / 2;
      fanRotorGroup.add(hub);

      const bladeGeom = new THREE.BoxGeometry(0.015, 0.25, 0.075);
      for (let b = 0; b < 9; b++) {
        const bladePivot = new THREE.Group();
        bladePivot.rotation.z = (b / 9) * Math.PI * 2;
        const blade = new THREE.Mesh(bladeGeom, mats.fanBlade);
        blade.position.y = 0.20;
        blade.rotation.z = 0.35;
        bladePivot.add(blade);
        fanRotorGroup.add(bladePivot);
      }
      coolingGroup.add(fanRotorGroup);

      const vaporBadge = new THREE.Mesh(
        createRoundedRectGeometry(0.72, 0.24, 0.025, 0.045, 0.008),
        [mats.coolingLogoCap, mats.darkAnodized]
      );
      vaporBadge.position.set(0, 0.755, -0.39);
      coolingGroup.add(vaporBadge);
    } else {
      // Great Cooling: 4 BIG thick copper heatpipes sweeping from dual towers straight inside the CPU!
      const pipeOffsetsZ = [-0.46, -0.16, 0.16, 0.46];
      pipeOffsetsZ.forEach((oz) => {
        const pipeCurve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(-0.32, pipeEntryDepthY, oz),
          new THREE.Vector3(-0.34, 0.08, oz),
          new THREE.Vector3(-0.62, 0.24, oz),
          new THREE.Vector3(-0.56, finStackTopY + 0.03, oz),
          new THREE.Vector3(-0.56, finStackTopY + 0.08, oz)
        ]);
        const pGeomL = new THREE.TubeGeometry(pipeCurve, 28, pipeRadius, 14, false);
        const pMeshL = new THREE.Mesh(pGeomL, mats.copper);
        pMeshL.castShadow = !isSoftwareGl;
        coolingGroup.add(pMeshL);

        const pipeCurveR = new THREE.CatmullRomCurve3([
          new THREE.Vector3(0.32, pipeEntryDepthY, oz),
          new THREE.Vector3(0.34, 0.08, oz),
          new THREE.Vector3(0.62, 0.24, oz),
          new THREE.Vector3(0.56, finStackTopY + 0.03, oz),
          new THREE.Vector3(0.56, finStackTopY + 0.08, oz)
        ]);
        const pGeomR = new THREE.TubeGeometry(pipeCurveR, 28, pipeRadius, 14, false);
        const pMeshR = new THREE.Mesh(pGeomR, mats.copper);
        pMeshR.castShadow = !isSoftwareGl;
        coolingGroup.add(pMeshR);

        // Oversized machined pipe intake sockets where big pipes plunge inside CPU
        [-0.32, 0.32].forEach((cx) => {
          const cMesh = new THREE.Mesh(collarGeom, mats.darkAnodized);
          cMesh.position.set(cx, 0.012, oz);
          coolingGroup.add(cMesh);
        });
      });

      // Twin cooling towers + center PWM axial rotor fan
      const towerFinCount = 13;
      const finGeom = new THREE.BoxGeometry(0.52, 0.015, 1.44);
      const fins = new THREE.InstancedMesh(finGeom, mats.darkAnodized, towerFinCount * 2);
      fins.castShadow = !isSoftwareGl;
      fins.receiveShadow = true;

      let fi = 0;
      [-0.56, 0.56].forEach(tx => {
        for (let i = 0; i < towerFinCount; i++) {
          const fy = finStackBottomY + (i / (towerFinCount - 1)) * (finStackTopY - finStackBottomY);
          _dummy.position.set(tx, fy, 0);
          _dummy.rotation.set(0, 0, 0);
          _dummy.scale.set(1, 1, 1);
          _dummy.updateMatrix();
          fins.setMatrixAt(fi++, _dummy.matrix);
        }
      });
      fins.instanceMatrix.needsUpdate = true;
      fins.computeBoundingSphere();
      coolingGroup.add(fins);

      // Machined top shroud caps + cryo light accent strips + Center Company Logo Crest Bridge
      const topPlateGeom = createRoundedRectGeometry(0.56, 1.48, 0.03, 0.04, 0.008);
      const stripGeom = new THREE.BoxGeometry(0.42, 0.012, 0.045);
      [-0.56, 0.56].forEach(tx => {
        const tp = new THREE.Mesh(topPlateGeom, mats.alumFin);
        tp.position.set(tx, finStackTopY + 0.04, 0);
        coolingGroup.add(tp);

        const strip = new THREE.Mesh(stripGeom, mats.cryoAccent);
        strip.position.set(tx, finStackTopY + 0.062, 0);
        coolingGroup.add(strip);
      });

      // Printed Company Logo Top Crest Plate bridging Great Cooling towers cleanly on top
      const bridgeBadgeGeom = createRoundedRectGeometry(0.76, 0.76, 0.032, 0.06, 0.010);
      const bridgeBadge = new THREE.Mesh(bridgeBadgeGeom, [mats.coolingLogoCap, mats.darkAnodized]);
      bridgeBadge.castShadow = !isSoftwareGl;
      bridgeBadge.position.set(0, finStackTopY + 0.075, 0);
      coolingGroup.add(bridgeBadge);

      // Center PWM Axial Fan Assembly (shroud ring + spinning 9-blade hub)
      const fanY = (finStackBottomY + finStackTopY) * 0.48;
      const shroudGeom = new THREE.TorusGeometry(0.40, 0.032, 12, 36);
      const shroud = new THREE.Mesh(shroudGeom, mats.darkAnodized);
      shroud.rotation.y = Math.PI / 2;
      shroud.position.set(0, fanY, 0);
      coolingGroup.add(shroud);

      fanRotorGroup = new THREE.Group();
      fanRotorGroup.position.set(0, fanY, 0);

      const hubGeom = new THREE.CylinderGeometry(0.105, 0.105, 0.08, 24);
      const hubMesh = new THREE.Mesh(hubGeom, mats.alumFin);
      hubMesh.rotation.z = Math.PI / 2;
      fanRotorGroup.add(hubMesh);

      const bladeGeom = new THREE.BoxGeometry(0.015, 0.26, 0.08);
      const bladesCount = 9;
      for (let b = 0; b < bladesCount; b++) {
        const angle = (b / bladesCount) * Math.PI * 2;
        const pivot = new THREE.Group();
        pivot.rotation.x = angle;
        const blade = new THREE.Mesh(bladeGeom, mats.fanBlade);
        blade.position.y = 0.21;
        blade.rotation.y = 0.45; // aero pitch
        pivot.add(blade);
        fanRotorGroup.add(pivot);
      }

      coolingGroup.add(fanRotorGroup);
    }
  }

  function applyBodyMaterialFinish(bodyType) {
    if (!mats.pcb || !mats.ihsTop || !mats.ihsFlange || !mats.pinsGold) return;

    const texSet = bodyType === 'titanium' ? textures.pcbTitanium : bodyType === 'carbon' ? textures.pcbCarbon : bodyType === 'silicon' ? textures.pcbSilicon : textures.pcbGray;

    mats.pcb.map = texSet.map;
    mats.pcb.bumpMap = texSet.bumpMap;
    mats.pcb.roughness = bodyType === 'titanium' ? 0.24 : bodyType === 'silicon' ? 0.22 : bodyType === 'carbon' ? 0.34 : 0.60;
    mats.pcb.metalness = bodyType === 'titanium' ? 0.88 : bodyType === 'silicon' ? 0.55 : bodyType === 'carbon' ? 0.25 : 0.10;
    mats.pcb.clearcoat = bodyType === 'titanium' ? 0.72 : bodyType === 'silicon' ? 0.85 : bodyType === 'carbon' ? 0.42 : 0.08;
    mats.pcb.needsUpdate = true;

    if (bodyType === 'silicon') {
      mats.pinsGold.color.setHex(0xd2e9ff);
      mats.pinsGold.roughness = 0.12;
      mats.ihsTop.metalness = 0.86;
      mats.ihsTop.roughness = 0.16;
      mats.ihsTop.clearcoat = 0.72;
      mats.ihsFlange.color.setHex(0x9fc2de);
      mats.ihsFlange.metalness = 0.92;
      mats.ihsFlange.roughness = 0.18;
    } else if (bodyType === 'titanium') {
      mats.pinsGold.color.setHex(0xe6edf5);
      mats.pinsGold.roughness = 0.12;
      mats.ihsTop.metalness = 0.92;
      mats.ihsTop.roughness = 0.14;
      mats.ihsTop.clearcoat = 0.92;
      mats.ihsFlange.color.setHex(0x8998aa);
      mats.ihsFlange.metalness = 0.96;
      mats.ihsFlange.roughness = 0.14;
    } else if (bodyType === 'carbon') {
      mats.pinsGold.color.setHex(0xf2c864);
      mats.pinsGold.roughness = 0.15;
      mats.ihsTop.metalness = 0.45;
      mats.ihsTop.roughness = 0.28;
      mats.ihsTop.clearcoat = 0.85;
      mats.ihsFlange.color.setHex(0x4a4d57);
      mats.ihsFlange.metalness = 0.88;
      mats.ihsFlange.roughness = 0.22;
    } else {
      mats.pinsGold.color.setHex(0xe6be5a);
      mats.pinsGold.roughness = 0.18;
      mats.ihsTop.metalness = 0.22;
      mats.ihsTop.roughness = 0.52;
      mats.ihsTop.clearcoat = 0.12;
      mats.ihsFlange.color.setHex(0x7c8391);
      mats.ihsFlange.metalness = 0.55;
      mats.ihsFlange.roughness = 0.38;
    }

    // Re-etch IHS plate & cooling top cap with live company logo + name + spec + finish
    if (textures.ihs) textures.ihs.dispose();
    textures.ihs = createIhsEtchTexture(activeState);
    mats.ihsTop.map = textures.ihs;
    mats.ihsTop.needsUpdate = true;

    if (mats.coolingLogoCap) {
      if (textures.coolingLogo) textures.coolingLogo.dispose();
      textures.coolingLogo = createCoolingCapLogoTexture(activeState);
      mats.coolingLogoCap.map = textures.coolingLogo;
      mats.coolingLogoCap.needsUpdate = true;
    }
  }

  // ---------- Dock & Camera Presets ----------

  function setCameraPreset(preset) {
    if (!camera || !controls) return;
    camAnimActive = true;
    if (preset === 'top') {
      camTargetPos.x = 0.01; camTargetPos.y = 4.35; camTargetPos.z = 0.25;
      camTargetLook.x = 0; camTargetLook.y = 0.08; camTargetLook.z = 0;
    } else if (preset === 'side') {
      camTargetPos.x = 3.85; camTargetPos.y = 0.68; camTargetPos.z = 0.05;
      camTargetLook.x = 0; camTargetLook.y = 0.18; camTargetLook.z = 0;
    } else if (preset === 'pins') {
      camTargetPos.x = 1.95; camTargetPos.y = -2.45; camTargetPos.z = 2.15;
      camTargetLook.x = 0; camTargetLook.y = -0.04; camTargetLook.z = 0;
    } else {
      // 'iso' default hero angle
      camTargetPos.x = 2.85; camTargetPos.y = 2.30; camTargetPos.z = 3.00;
      camTargetLook.x = 0; camTargetLook.y = 0.12; camTargetLook.z = 0;
    }
  }

  function buildViewportUi() {
    if (!stageEl) return;

    // Clear legacy 2D CSS box fallback inside stage
    stageEl.innerHTML = '';

    mountEl = document.createElement('div');
    mountEl.id = MOUNT_ID;
    mountEl.className = 'cpu-canvas-mount';
    stageEl.appendChild(mountEl);

    const dockWrap = document.createElement('div');
    dockWrap.id = DOCK_ID;
    dockWrap.className = 'cpu-viewport-dock-wrap';
    dockWrap.innerHTML = `
      <button type="button" class="cpu-dock-collapse-btn" id="cpuDockToggleBtn" title="Toggle 3D viewport controls">▾ Controls</button>
      <div class="cpu-viewport-dock" id="cpuDockPanel">
        <label class="cpu-dock-slider" title="Explode CPU hardware layers">
          <span>Explode</span>
          <input type="range" id="cpuExplodeSlider" min="0" max="100" value="0">
        </label>
        <div class="cpu-dock-divider"></div>
        <div class="cpu-dock-group" role="group" aria-label="Camera angles">
          <button type="button" class="cpu-dock-btn active" data-cpu-cam="iso">Iso</button>
          <button type="button" class="cpu-dock-btn" data-cpu-cam="top">Top</button>
          <button type="button" class="cpu-dock-btn" data-cpu-cam="side">Side</button>
          <button type="button" class="cpu-dock-btn" data-cpu-cam="pins">Pins</button>
        </div>
        <div class="cpu-dock-divider"></div>
        <div class="cpu-dock-group">
          <button type="button" class="cpu-dock-btn" id="cpuLidToggleBtn" title="Open IHS lid to inspect silicon dies">Open Lid</button>
          <button type="button" class="cpu-dock-btn" id="cpuSpinToggleBtn" title="Toggle turntable spin">Spin</button>
        </div>
      </div>
    `;
    stageEl.appendChild(dockWrap);

    // Stop pointer propagation so dock interactions never drag OrbitControls
    dockWrap.addEventListener('pointerdown', e => e.stopPropagation());

    const slider = dockWrap.querySelector('#cpuExplodeSlider');
    slider?.addEventListener('input', () => {
      targetExplode = Math.max(0, Math.min(1, Number(slider.value || 0) / 100));
    });

    dockWrap.querySelectorAll('[data-cpu-cam]').forEach(btn => {
      btn.addEventListener('click', () => {
        dockWrap.querySelectorAll('[data-cpu-cam]').forEach(x => x.classList.toggle('active', x === btn));
        setCameraPreset(btn.dataset.cpuCam);
      });
    });

    const lidBtn = dockWrap.querySelector('#cpuLidToggleBtn');
    const syncLidBtn = () => {
      if (!lidBtn) return;
      const isOpen = targetLidOpen > 0.5;
      lidBtn.classList.toggle('active', isOpen);
      lidBtn.textContent = isOpen ? 'Close Lid' : 'Open Lid';
    };
    dockWrap._syncLidBtn = syncLidBtn;
    lidBtn?.addEventListener('click', () => {
      targetLidOpen = targetLidOpen > 0.5 ? 0 : 1;
      syncLidBtn();
    });

    const spinBtn = dockWrap.querySelector('#cpuSpinToggleBtn');
    spinBtn?.addEventListener('click', () => {
      autoSpin = !autoSpin;
      spinBtn.classList.toggle('active', autoSpin);
      if (controls && !isSoftwareGl) {
        controls.autoRotate = autoSpin;
      }
    });

    const collapseBtn = dockWrap.querySelector('#cpuDockToggleBtn');
    const panel = dockWrap.querySelector('#cpuDockPanel');
    collapseBtn?.addEventListener('click', () => {
      dockCollapsed = !dockCollapsed;
      panel?.classList.toggle('is-collapsed', dockCollapsed);
      collapseBtn.textContent = dockCollapsed ? '▴ Controls' : '▾ Controls';
    });
  }

  // ---------- Frame Loop & Lifecycle ----------

  function syncStageSize() {
    if (!renderer || !camera || !mountEl) return;
    const w = Math.max(240, mountEl.clientWidth || stageEl.clientWidth || 540);
    const h = Math.max(260, mountEl.clientHeight || stageEl.clientHeight || 440);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }

  function updateVisibilityState() {
    const pageEl = document.getElementById('page-company-design');
    const designerEl = document.getElementById('cpuDesigner');
    const nowVisible =
      !document.hidden &&
      Boolean(pageEl && !pageEl.classList.contains('hidden')) &&
      Boolean(designerEl && !designerEl.classList.contains('hidden'));

    if (nowVisible !== pageVisible) {
      pageVisible = nowVisible;
      if (pageVisible) {
        syncStageSize();
        lastFrameMs = performance.now();
        scheduleNextFrame();
      } else {
        stopLoop();
      }
    }
  }

  function stopLoop() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    if (timerId) {
      clearTimeout(timerId);
      timerId = 0;
    }
  }

  function afterDraw(cb) {
    try {
      const gl = renderer.getContext();
      if (!gl || typeof gl.fenceSync !== 'function') {
        timerId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (!pageVisible || contextLost) return;
        const st = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (st === gl.UNSIGNALED) {
          timerId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          timerId = window.setTimeout(cb, 80);
        }
      };
      timerId = window.setTimeout(poll, 5);
    } catch (e) {
      timerId = window.setTimeout(cb, 80);
    }
  }

  function scheduleNextFrame() {
    if (!pageVisible || contextLost || !renderer) return;
    if (rafId || timerId) return;
    rafId = requestAnimationFrame(tick);
  }

  function tick(nowMs) {
    rafId = 0;
    if (!pageVisible || contextLost || !renderer || !scene || !camera) return;

    const rawDt = lastFrameMs ? (nowMs - lastFrameMs) / 1000 : 0.016;
    const dt = Math.min(0.05, Math.max(0.001, rawDt));
    lastFrameMs = nowMs;
    elapsedSec += dt;

    // 1. Exponential damping for Explode slider, Lid reveal & Part entrance springs
    currentExplode = THREE.MathUtils.damp(currentExplode, targetExplode, 8.5, dt);
    currentLidOpen = THREE.MathUtils.damp(currentLidOpen, targetLidOpen, 8.5, dt);
    animWeights.cores = THREE.MathUtils.damp(animWeights.cores, 1, 10, dt);
    animWeights.threads = THREE.MathUtils.damp(animWeights.threads, 1, 10, dt);
    animWeights.cooling = THREE.MathUtils.damp(animWeights.cooling, 1, 9, dt);
    animWeights.bodyPulse = THREE.MathUtils.damp(animWeights.bodyPulse, 0, 7, dt);

    // 2. Apply vertical exploded separation across physical CPU strata
    const e = currentExplode;
    const coolingActive = activeState.cooling > 0;
    const lidLift = Math.max(currentLidOpen * 0.56, e * 0.42);
    const lidEffective = Math.max(currentLidOpen, e * 0.45);

    if (pinsGroup) pinsGroup.position.y = -e * 0.40;
    if (pcbGroup) pcbGroup.position.y = 0;
    if (interposerGroup) interposerGroup.position.y = 0.068 + e * 0.16;
    if (diesGroup) {
      diesGroup.position.y = 0.095 + e * 0.28;
      diesGroup.scale.setScalar(0.88 + 0.12 * animWeights.cores);
    }
    if (threadsGroup) {
      threadsGroup.position.y = 0.105 + e * 0.36;
      threadsGroup.scale.setScalar(0.88 + 0.12 * animWeights.threads);
    }
    if (ihsGroup) {
      ihsGroup.position.y = 0.165 + lidLift;
      ihsGroup.rotation.x = -currentLidOpen * 0.24 * (1 - e * 0.5);
      const alpha = coolingActive && currentLidOpen > 0.5
        ? 0.24
        : 1 - currentLidOpen * 0.74;
      mats.ihsTop.opacity = alpha;
      mats.ihsFlange.opacity = alpha;
      mats.ihsTop.depthWrite = alpha > 0.92;
      mats.ihsFlange.depthWrite = alpha > 0.92;
    }
    if (coolingGroup) {
      const popLift = (1 - animWeights.cooling) * 0.25;
      coolingGroup.position.y = 0.255 + e * 0.92 + currentLidOpen * 0.56 + popLift;
      coolingGroup.scale.setScalar(0.92 + 0.08 * animWeights.cooling);
    }

    // Keep slight organic hover on plinth when assembled & idle
    if (cpuRoot) {
      const pulseScale = 1 + animWeights.bodyPulse * 0.025;
      cpuRoot.scale.setScalar(pulseScale);
      cpuRoot.position.y = Math.sin(elapsedSec * 1.45) * 0.015;
    }

    // 3. Spin Great Cooling PWM fan smoothly
    if (fanRotorGroup) {
      fanRotorGroup.rotation.x += dt * 9.5;
    }

    // 4. Subtle hardware signal pulse on Thread interconnect lanes
    if (threadPipeMaterials.length) {
      for (let i = 0; i < threadPipeMaterials.length; i++) {
        threadPipeMaterials[i].emissiveIntensity = 0.35 + 0.35 * Math.sin(elapsedSec * 3.8 + i * 0.85);
      }
    }

    // 5. Smooth preset camera transition (yields immediately when user grabs OrbitControls)
    if (camAnimActive && controls) {
      camera.position.x = THREE.MathUtils.damp(camera.position.x, camTargetPos.x, 7.5, dt);
      camera.position.y = THREE.MathUtils.damp(camera.position.y, camTargetPos.y, 7.5, dt);
      camera.position.z = THREE.MathUtils.damp(camera.position.z, camTargetPos.z, 7.5, dt);
      controls.target.x = THREE.MathUtils.damp(controls.target.x, camTargetLook.x, 8.5, dt);
      controls.target.y = THREE.MathUtils.damp(controls.target.y, camTargetLook.y, 8.5, dt);
      controls.target.z = THREE.MathUtils.damp(controls.target.z, camTargetLook.z, 8.5, dt);
      if (
        Math.abs(camera.position.x - camTargetPos.x) < 0.008 &&
        Math.abs(camera.position.y - camTargetPos.y) < 0.008 &&
        Math.abs(camera.position.z - camTargetPos.z) < 0.008
      ) {
        camAnimActive = false;
      }
    }

    if (controls) {
      if (isSoftwareGl && autoSpin && cpuRoot) {
        cpuRoot.rotation.y += dt * 0.65;
      }
      controls.update();
    }

    renderer.render(scene, camera);

    if (isSoftwareGl) {
      afterDraw(() => {
        if (pageVisible && !contextLost) {
          rafId = requestAnimationFrame(tick);
        }
      });
    } else {
      rafId = requestAnimationFrame(tick);
    }
  }

  async function initIfNeeded() {
    if (initialized) return true;
    if (initPromise) return initPromise;

    initPromise = (async () => {
      stageEl = document.getElementById(STAGE_ID);
      if (!stageEl) return false;

      const ok = await loadThreeModules();
      if (!ok || !THREE) {
        stageEl.innerHTML = `
          <div class="cpu-webgl-fallback">
            <strong>3D Studio Preview Unavailable</strong>
            <span>Check connection or WebGL settings to inspect the 3D processor.</span>
          </div>`;
        return false;
      }

      isSoftwareGl = detectSoftwareWebGL();
      buildViewportUi();

      scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0d0919);
      scene.fog = new THREE.FogExp2(0x0d0919, 0.058);

      const w = Math.max(240, mountEl.clientWidth || stageEl.clientWidth || 540);
      const h = Math.max(260, mountEl.clientHeight || stageEl.clientHeight || 440);
      camera = new THREE.PerspectiveCamera(36, w / h, 0.1, 45);
      camera.position.set(2.85, 2.30, 3.00);

      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance'
      });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.16;
      renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h, false);
      renderer.shadowMap.enabled = !isSoftwareGl;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      mountEl.appendChild(renderer.domElement);

      renderer.domElement.addEventListener('webglcontextlost', e => {
        e.preventDefault();
        contextLost = true;
        stopLoop();
      });
      renderer.domElement.addEventListener('webglcontextrestored', () => {
        contextLost = false;
        syncStageSize();
        scheduleNextFrame();
      });

      // Mandatory procedural Studio RoomEnvironment IBL
      pmremGenerator = new THREE.PMREMGenerator(renderer);
      const roomEnv = new RoomEnvironment();
      envTexture = pmremGenerator.fromScene(roomEnv, 0.04).texture;
      scene.environment = envTexture;
      roomEnv.dispose();
      pmremGenerator.dispose();
      pmremGenerator = null;

      // Balanced 3-Point Warm/Cool Studio Lighting
      const hemi = new THREE.HemisphereLight(0xaecbff, 0x1a112b, 0.72);
      scene.add(hemi);

      const keyLight = new THREE.DirectionalLight(0xfff1dc, 2.45);
      keyLight.position.set(4.2, 6.0, 3.6);
      keyLight.castShadow = !isSoftwareGl;
      keyLight.shadow.mapSize.set(isSoftwareGl ? 512 : 2048, isSoftwareGl ? 512 : 2048);
      keyLight.shadow.camera.left = -2.6;
      keyLight.shadow.camera.right = 2.6;
      keyLight.shadow.camera.top = 2.6;
      keyLight.shadow.camera.bottom = -2.6;
      keyLight.shadow.camera.near = 1;
      keyLight.shadow.camera.far = 16;
      keyLight.shadow.bias = -0.0004;
      keyLight.shadow.normalBias = 0.025;
      scene.add(keyLight);

      const rimLight = new THREE.DirectionalLight(0xb28dff, 1.85);
      rimLight.position.set(-4.5, 3.2, -4.0);
      scene.add(rimLight);

      const fillLight = new THREE.DirectionalLight(0xd4e8ff, 0.85);
      fillLight.position.set(-3.2, -1.8, 3.8);
      scene.add(fillLight);

      cpuRoot = new THREE.Group();
      scene.add(cpuRoot);

      buildMaterials();
      buildStaticSubstrateAndPins();
      rebuildSiliconCores(activeState.cores);
      rebuildThreadInterconnects(activeState.threads, activeState.cores);
      rebuildCoolingStack(activeState.cooling);
      applyBodyMaterialFinish(activeState.body);

      if (!isSoftwareGl && typeof renderer.compile === 'function') {
        renderer.compile(scene, camera);
      }

      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = !isSoftwareGl;
      controls.dampingFactor = 0.055;
      controls.rotateSpeed = 0.78;
      controls.zoomSpeed = 0.85;
      controls.enablePan = false;
      controls.minDistance = 2.15;
      controls.maxDistance = 7.4;
      controls.minPolarAngle = 0.08;
      controls.maxPolarAngle = Math.PI - 0.12;
      controls.target.set(0, 0.12, 0);
      controls.autoRotateSpeed = 1.65;

      // Immediately yield camera animations when user interacts manually
      controls.addEventListener('start', () => {
        camAnimActive = false;
      });

      if (typeof ResizeObserver === 'function') {
        resizeObserver = new ResizeObserver(() => syncStageSize());
        resizeObserver.observe(stageEl);
      } else {
        window.addEventListener('resize', syncStageSize);
      }

      const pageEl = document.getElementById('page-company-design');
      const designerEl = document.getElementById('cpuDesigner');
      if (typeof MutationObserver === 'function' && (pageEl || designerEl)) {
        mutationObserver = new MutationObserver(() => updateVisibilityState());
        if (pageEl) mutationObserver.observe(pageEl, { attributes: true, attributeFilter: ['class'] });
        if (designerEl) mutationObserver.observe(designerEl, { attributes: true, attributeFilter: ['class'] });
      }
      document.addEventListener('visibilitychange', updateVisibilityState);

      initialized = true;
      updateVisibilityState();
      return true;
    })();

    return initPromise;
  }

  async function updateCpuDesigner3D(nextState) {
    if (!nextState || typeof nextState !== 'object') return;
    const prev = { ...activeState };
    activeState = {
      body: nextState.body || 'gray',
      cores: Number(nextState.cores || 0),
      threads: Number(nextState.threads || 0),
      cooling: Number(nextState.cooling || 0),
      graphics: String(nextState.graphics || ''),
      ai: String(nextState.ai || ''),
      name: String(nextState.name ?? ''),
      companyName: String(nextState.companyName ?? ''),
      score: Number(nextState.score || 0),
      tier: String(nextState.tier || 'F'),
      logoUrl: String(nextState.logoUrl || '')
    };

    ensureLogoImageLoaded(activeState.logoUrl);

    const ready = await initIfNeeded();
    if (!ready || !THREE) return;

    const coresChanged = prev.cores !== activeState.cores;
    const threadsChanged = prev.threads !== activeState.threads;
    const coolingChanged = prev.cooling !== activeState.cooling;
    const bodyOrLabelChanged =
      prev.body !== activeState.body ||
      prev.name !== activeState.name ||
      prev.companyName !== activeState.companyName ||
      prev.score !== activeState.score ||
      prev.tier !== activeState.tier ||
      prev.graphics !== activeState.graphics ||
      prev.ai !== activeState.ai ||
      prev.logoUrl !== activeState.logoUrl;

    const syncLid = (open) => {
      targetLidOpen = open ? 1 : 0;
      const dock = document.getElementById(DOCK_ID);
      if (dock && typeof dock._syncLidBtn === 'function') dock._syncLidBtn();
    };

    if (coresChanged) {
      rebuildSiliconCores(activeState.cores);
      animWeights.cores = 0.25;
      // Thread bus endpoints adapt to core layout
      rebuildThreadInterconnects(activeState.threads, activeState.cores);
      if (activeState.cores > 0 && activeState.cooling === 0) syncLid(true);
    }
    if (threadsChanged && !coresChanged) {
      rebuildThreadInterconnects(activeState.threads, activeState.cores);
      animWeights.threads = 0.25;
      if (activeState.threads > 0 && activeState.cooling === 0) syncLid(true);
    }
    if (coolingChanged) {
      rebuildCoolingStack(activeState.cooling);
      animWeights.cooling = 0.15;
      if (activeState.cooling > 0) syncLid(false);
    }
    if (prev.body !== activeState.body) {
      animWeights.bodyPulse = 1;
    }
    if (prev.ai !== activeState.ai) rebuildAiBadge(activeState.ai);
    if (bodyOrLabelChanged || coresChanged || threadsChanged || coolingChanged) {
      applyBodyMaterialFinish(activeState.body);
    }

    updateVisibilityState();
  }

  let snapshotQueueBusy = false;
  const thumbQueue = [];

  async function captureCpuHeroSnapshot(stateOverride = null, size = 320) {
    const ready = await initIfNeeded();
    if (!ready || !THREE || !renderer || !scene || !camera || contextLost) return '';

    const prevState = { ...activeState };
    const snapState = stateOverride && typeof stateOverride === 'object'
      ? {
          body: stateOverride.body || 'gray',
          cores: Number(stateOverride.cores || 0),
          threads: Number(stateOverride.threads || 0),
          cooling: Number(stateOverride.cooling || 0),
          graphics: String(stateOverride.graphics || ''),
          ai: String(stateOverride.ai || ''),
          name: String(stateOverride.name ?? ''),
          companyName: String(stateOverride.companyName ?? ''),
          score: Number(stateOverride.score || 0),
          tier: String(stateOverride.tier || 'F'),
          logoUrl: String(stateOverride.logoUrl || '')
        }
      : { ...activeState };

    if (snapState.logoUrl) {
      await ensureLogoImageLoaded(snapState.logoUrl);
    } else if (loadedLogoUrl) {
      await ensureLogoImageLoaded('');
    }

    // Wait if stateOverride swapped scene geometry
    const needRebuild =
      prevState.body !== snapState.body ||
      prevState.cores !== snapState.cores ||
      prevState.threads !== snapState.threads ||
      prevState.cooling !== snapState.cooling ||
      prevState.graphics !== snapState.graphics ||
      prevState.ai !== snapState.ai ||
      prevState.name !== snapState.name ||
      prevState.companyName !== snapState.companyName ||
      prevState.score !== snapState.score ||
      prevState.tier !== snapState.tier ||
      prevState.logoUrl !== snapState.logoUrl;

    // Save camera, controls, CPU transforms, and layer positions
    const prevPos = camera.position.clone();
    const prevQuat = camera.quaternion.clone();
    const prevAspect = camera.aspect;
    const prevFov = camera.fov;
    const prevCtrlTarget = controls ? controls.target.clone() : null;
    const prevCtrlEnabled = controls ? controls.enabled : true;

    const prevCpuPos = cpuRoot.position.clone();
    const prevCpuRot = cpuRoot.rotation.clone();
    const prevCpuScale = cpuRoot.scale.clone();
    const prevPinsY = pinsGroup ? pinsGroup.position.y : 0;
    const prevPcbY = pcbGroup ? pcbGroup.position.y : 0;
    const prevIntY = interposerGroup ? interposerGroup.position.y : 0.068;
    const prevDiesY = diesGroup ? diesGroup.position.y : 0.095;
    const prevDiesScale = diesGroup ? diesGroup.scale.clone() : null;
    const prevThrY = threadsGroup ? threadsGroup.position.y : 0.105;
    const prevThrScale = threadsGroup ? threadsGroup.scale.clone() : null;
    const prevIhsY = ihsGroup ? ihsGroup.position.y : 0.165;
    const prevIhsRotX = ihsGroup ? ihsGroup.rotation.x : 0;
    const prevIhsRotZ = ihsGroup ? ihsGroup.rotation.z : 0;
    const prevIhsTopOp = mats.ihsTop ? mats.ihsTop.opacity : 1;
    const prevIhsTopDw = mats.ihsTop ? mats.ihsTop.depthWrite : true;
    const prevIhsFlgOp = mats.ihsFlange ? mats.ihsFlange.opacity : 1;
    const prevIhsFlgDw = mats.ihsFlange ? mats.ihsFlange.depthWrite : true;
    const prevCoolY = coolingGroup ? coolingGroup.position.y : 0.255;
    const prevCoolScale = coolingGroup ? coolingGroup.scale.clone() : null;
    const prevPR = renderer.getPixelRatio();

    if (needRebuild) {
      activeState = { ...snapState };
      if (prevState.cores !== snapState.cores) rebuildSiliconCores(snapState.cores);
      if (prevState.threads !== snapState.threads || prevState.cores !== snapState.cores) {
        rebuildThreadInterconnects(snapState.threads, snapState.cores);
      }
      if (prevState.cooling !== snapState.cooling) rebuildCoolingStack(snapState.cooling);
      if (prevState.ai !== snapState.ai) rebuildAiBadge(snapState.ai);
      applyBodyMaterialFinish(snapState.body);
    }

    // Pose cleanly assembled at a showcase studio hero 3/4 angle
    if (controls) controls.enabled = false;
    cpuRoot.position.set(0, 0, 0);
    cpuRoot.rotation.set(0, 0, 0);
    cpuRoot.scale.setScalar(1);
    if (pinsGroup) pinsGroup.position.y = 0;
    if (pcbGroup) pcbGroup.position.y = 0;
    if (interposerGroup) interposerGroup.position.y = 0.068;
    if (diesGroup) {
      diesGroup.position.y = 0.095;
      diesGroup.scale.setScalar(1);
    }
    if (threadsGroup) {
      threadsGroup.position.y = 0.105;
      threadsGroup.scale.setScalar(1);
    }
    if (ihsGroup) {
      ihsGroup.position.y = 0.165;
      ihsGroup.rotation.set(0, 0, 0);
    }
    if (mats.ihsTop) {
      mats.ihsTop.opacity = 1;
      mats.ihsTop.depthWrite = true;
    }
    if (mats.ihsFlange) {
      mats.ihsFlange.opacity = 1;
      mats.ihsFlange.depthWrite = true;
    }
    if (coolingGroup) {
      coolingGroup.position.y = 0.255;
      coolingGroup.scale.setScalar(1);
    }

    camera.aspect = 1;
    camera.fov = 33;
    camera.updateProjectionMatrix();

    if (snapState.cooling >= 2) {
      camera.position.set(2.88, 2.34, 3.00);
      camera.lookAt(0, 0.30, 0);
    } else if (snapState.cooling === 1) {
      camera.position.set(2.50, 2.08, 2.60);
      camera.lookAt(0, 0.16, 0);
    } else {
      camera.position.set(2.12, 2.22, 2.26);
      camera.lookAt(0, 0.02, 0);
    }

    const outSize = Math.max(160, Math.min(512, size));
    renderer.setPixelRatio(1);
    renderer.setSize(outSize, outSize, false);
    renderer.render(scene, camera);

    let dataUrl = '';
    try {
      const snapCanvas = document.createElement('canvas');
      snapCanvas.width = outSize;
      snapCanvas.height = outSize;
      const ctx = snapCanvas.getContext('2d');
      ctx.drawImage(renderer.domElement, 0, 0, outSize, outSize);
      dataUrl = snapCanvas.toDataURL('image/webp', 0.86);
      if (!dataUrl || !dataUrl.startsWith('data:image/webp')) {
        dataUrl = snapCanvas.toDataURL('image/png');
      }
    } catch (err) {
      dataUrl = '';
    }

    // Restore live scene & camera synchronously
    if (needRebuild) {
      activeState = { ...prevState };
      if (prevState.logoUrl !== snapState.logoUrl) {
        ensureLogoImageLoaded(prevState.logoUrl);
      }
      if (snapState.cores !== prevState.cores) rebuildSiliconCores(prevState.cores);
      if (snapState.threads !== prevState.threads || snapState.cores !== prevState.cores) {
        rebuildThreadInterconnects(prevState.threads, prevState.cores);
      }
      if (snapState.cooling !== prevState.cooling) rebuildCoolingStack(prevState.cooling);
      if (snapState.ai !== prevState.ai) rebuildAiBadge(prevState.ai);
      applyBodyMaterialFinish(prevState.body);
    }

    cpuRoot.position.copy(prevCpuPos);
    cpuRoot.rotation.copy(prevCpuRot);
    cpuRoot.scale.copy(prevCpuScale);
    if (pinsGroup) pinsGroup.position.y = prevPinsY;
    if (pcbGroup) pcbGroup.position.y = prevPcbY;
    if (interposerGroup) interposerGroup.position.y = prevIntY;
    if (diesGroup) {
      diesGroup.position.y = prevDiesY;
      if (prevDiesScale) diesGroup.scale.copy(prevDiesScale);
    }
    if (threadsGroup) {
      threadsGroup.position.y = prevThrY;
      if (prevThrScale) threadsGroup.scale.copy(prevThrScale);
    }
    if (ihsGroup) ihsGroup.rotation.set(prevIhsRotX, 0, prevIhsRotZ);
    if (ihsGroup) ihsGroup.position.y = prevIhsY;
    if (mats.ihsTop) {
      mats.ihsTop.opacity = prevIhsTopOp;
      mats.ihsTop.depthWrite = prevIhsTopDw;
    }
    if (mats.ihsFlange) {
      mats.ihsFlange.opacity = prevIhsFlgOp;
      mats.ihsFlange.depthWrite = prevIhsFlgDw;
    }
    if (coolingGroup) {
      coolingGroup.position.y = prevCoolY;
      if (prevCoolScale) coolingGroup.scale.copy(prevCoolScale);
    }

    camera.fov = prevFov;
    camera.aspect = prevAspect;
    camera.position.copy(prevPos);
    camera.quaternion.copy(prevQuat);
    camera.updateProjectionMatrix();
    if (controls) {
      if (prevCtrlTarget) controls.target.copy(prevCtrlTarget);
      controls.enabled = prevCtrlEnabled;
      controls.update();
    }

    renderer.setPixelRatio(prevPR);
    syncStageSize();
    if (pageVisible) renderer.render(scene, camera);

    return dataUrl;
  }

  async function processThumbQueue() {
    if (snapshotQueueBusy || !thumbQueue.length) return;
    snapshotQueueBusy = true;
    try {
      while (thumbQueue.length) {
        const job = thumbQueue.shift();
        try {
          const url = await captureCpuHeroSnapshot(job.spec, job.size || 256);
          if (typeof job.onDone === 'function') job.onDone(url);
        } catch (e) {
          if (typeof job.onDone === 'function') job.onDone('');
        }
        await new Promise((r) => setTimeout(r, 12));
      }
    } finally {
      snapshotQueueBusy = false;
    }
  }

  function enqueueCpuThumbnail(spec, onDone, size = 256) {
    thumbQueue.push({ spec, onDone, size });
    processThumbQueue();
  }

  // ---------- Standalone Reusable 3D CPU Assembly Builder ----------
  const standaloneLogoCache = new Map();

  function buildStandaloneCpuAssembly(T, rawSpec, opts = {}) {
    if (!T) return null;
    const spec = {
      ...DEFAULT_STATE,
      ...(rawSpec && typeof rawSpec === 'object' ? rawSpec : {}),
      cores: Number(rawSpec?.cores || 0),
      threads: Number(rawSpec?.threads || 0),
      cooling: Number(rawSpec?.cooling || 0),
      vCache: String(rawSpec?.vCache || rawSpec?.v_cache_type || 'none'),
      graphics: String(rawSpec?.graphics || rawSpec?.graphics_type || ''),
      ai: String(rawSpec?.ai || ''),
      body: String(rawSpec?.body || 'gray'),
      name: String(rawSpec?.name ?? 'CPU'),
      companyName: String(rawSpec?.companyName ?? ''),
      tier: String(rawSpec?.tier || 'F'),
      logoUrl: String(rawSpec?.logoUrl || '')
    };
    const isSoft = !!opts.isSoftwareGl;
    const dum = new T.Object3D();

    // Helper: temporarily point module helpers' logo reference if cached
    let logoImg = null;
    const cleanLogoUrl = spec.logoUrl.trim();
    if (cleanLogoUrl) {
      const cached = standaloneLogoCache.get(cleanLogoUrl);
      if (cached && cached !== 'loading') {
        logoImg = cached;
      } else if (cached !== 'loading') {
        standaloneLogoCache.set(cleanLogoUrl, 'loading');
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          standaloneLogoCache.set(cleanLogoUrl, img);
          opts.onLogoReady?.(img);
        };
        img.onerror = () => standaloneLogoCache.delete(cleanLogoUrl);
        img.src = cleanLogoUrl;
      }
    }

    const mkRounded = (width, height, depth, radius, bevel = 0.015) => {
      const hw = width / 2, hh = height / 2;
      const r = Math.min(radius, hw * 0.45, hh * 0.45);
      const s = new T.Shape();
      s.moveTo(-hw + r, -hh); s.lineTo(hw - r, -hh);
      s.quadraticCurveTo(hw, -hh, hw, -hh + r); s.lineTo(hw, hh - r);
      s.quadraticCurveTo(hw, hh, hw - r, hh); s.lineTo(-hw + r, hh);
      s.quadraticCurveTo(-hw, hh, -hw, hh - r); s.lineTo(-hw, -hh + r);
      s.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
      const g = new T.ExtrudeGeometry(s, { depth, steps: 1, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2 });
      g.rotateX(-Math.PI / 2);
      g.center();
      const pos = g.attributes.position;
      const uvs = new Float32Array(pos.count * 2);
      const sw = width + bevel * 2, sh = height + bevel * 2;
      for (let i = 0; i < pos.count; i++) {
        uvs[i * 2] = (pos.getX(i) + sw / 2) / sw;
        uvs[i * 2 + 1] = 1 - (pos.getZ(i) + sh / 2) / sh;
      }
      g.setAttribute('uv', new T.BufferAttribute(uvs, 2));
      g.computeVertexNormals();
      return g;
    };

    const mkNotchedPcbGeo = () => {
      const hw = 1.20, r = 0.08, nr = 0.095;
      const s = new T.Shape();
      s.moveTo(-hw + 0.16, -hw); s.lineTo(hw - r, -hw);
      s.quadraticCurveTo(hw, -hw, hw, -hw + r); s.lineTo(hw, -nr);
      s.absarc(hw, 0, nr, -Math.PI / 2, Math.PI / 2, true);
      s.lineTo(hw, hw - r); s.quadraticCurveTo(hw, hw, hw - r, hw);
      s.lineTo(-hw + r, hw); s.quadraticCurveTo(-hw, hw, -hw, hw - r);
      s.lineTo(-hw, nr); s.absarc(-hw, 0, nr, Math.PI / 2, -Math.PI / 2, true);
      s.lineTo(-hw, -hw + 0.16); s.closePath();
      const g = new T.ExtrudeGeometry(s, { depth: 0.09, steps: 1, bevelEnabled: true, bevelThickness: 0.014, bevelSize: 0.014, bevelSegments: 2 });
      g.rotateX(-Math.PI / 2);
      g.center();
      const pos = g.attributes.position;
      const uvs = new Float32Array(pos.count * 2);
      const span = hw * 2.04;
      for (let i = 0; i < pos.count; i++) {
        uvs[i * 2] = (pos.getX(i) + span / 2) / span;
        uvs[i * 2 + 1] = 1 - (pos.getZ(i) + span / 2) / span;
      }
      g.setAttribute('uv', new T.BufferAttribute(uvs, 2));
      g.computeVertexNormals();
      return g;
    };

    const mkWingedFlangeGeo = () => {
      const s = new T.Shape();
      const wOuter = 1.04, wWing = 0.72, step = 0.20;
      s.moveTo(-wWing, -wOuter); s.lineTo(wWing, -wOuter);
      s.lineTo(wWing, -wOuter + step); s.lineTo(wOuter, -wOuter + step);
      s.lineTo(wOuter, wOuter - step); s.lineTo(wWing, wOuter - step);
      s.lineTo(wWing, wOuter); s.lineTo(-wWing, wOuter);
      s.lineTo(-wWing, wOuter - step); s.lineTo(-wOuter, wOuter - step);
      s.lineTo(-wOuter, -wOuter + step); s.lineTo(-wWing, -wOuter + step);
      s.closePath();
      const g = new T.ExtrudeGeometry(s, { depth: 0.055, steps: 1, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2 });
      g.rotateX(-Math.PI / 2);
      g.center();
      g.computeVertexNormals();
      return g;
    };

    // Build textures using caller's T
    const body = spec.body;
    const prevThree = THREE;
    const prevLoadedLogoUrl = loadedLogoUrl;
    const prevLoadedLogoImg = loadedLogoImg;
    THREE = T;
    if (logoImg) {
      loadedLogoUrl = cleanLogoUrl;
      loadedLogoImg = logoImg;
    } else if (!cleanLogoUrl) {
      loadedLogoUrl = '';
      loadedLogoImg = null;
    }
    const pcbTexSet = createPcbTextures(body);
    const dieTex = createSiliconDieTexture();
    const ihsTex = createIhsEtchTexture(spec);
    const coolLogoTex = createCoolingCapLogoTexture(spec);
    THREE = prevThree;
    loadedLogoUrl = prevLoadedLogoUrl;
    loadedLogoImg = prevLoadedLogoImg;

    const pcbMat = new T.MeshPhysicalMaterial({
      color: 0xffffff,
      map: pcbTexSet.map,
      bumpMap: pcbTexSet.bumpMap,
      bumpScale: 0.012,
      roughness: body === 'titanium' ? 0.24 : body === 'silicon' ? 0.22 : body === 'carbon' ? 0.34 : 0.60,
      metalness: body === 'titanium' ? 0.88 : body === 'silicon' ? 0.55 : body === 'carbon' ? 0.25 : 0.10,
      clearcoat: body === 'titanium' ? 0.72 : body === 'silicon' ? 0.85 : body === 'carbon' ? 0.42 : 0.08
    });
    const pinColor = body === 'silicon' ? 0xd2e9ff : body === 'titanium' ? 0xe6edf5 : body === 'carbon' ? 0xf2c864 : 0xe6be5a;
    const pinsGoldMat = new T.MeshStandardMaterial({ color: pinColor, metalness: 0.96, roughness: 0.14 });
    const ceramicCapMat = new T.MeshStandardMaterial({ color: 0xb98d59, metalness: 0.08, roughness: 0.42 });
    const solderEndMat = new T.MeshStandardMaterial({ color: 0xd6dde8, metalness: 0.92, roughness: 0.22 });
    const interposerMat = new T.MeshStandardMaterial({ color: 0x202634, metalness: 0.35, roughness: 0.52 });
    const dieSiliconMat = new T.MeshPhysicalMaterial({ color: 0xffffff, map: dieTex, metalness: 0.58, roughness: 0.11, clearcoat: 1.0, iridescence: 0.92 });
    const iodSiliconMat = new T.MeshPhysicalMaterial({ color: 0x20324a, metalness: 0.65, roughness: 0.14, clearcoat: 0.95, iridescence: 0.65 });
    const copperMat = new T.MeshPhysicalMaterial({ color: 0xd67c49, metalness: 0.95, roughness: 0.18 });
    const alumFinMat = new T.MeshPhysicalMaterial({ color: 0xcbd5e1, metalness: 0.92, roughness: 0.24 });
    const darkAnodizedMat = new T.MeshPhysicalMaterial({ color: 0x1e222e, metalness: 0.82, roughness: 0.30 });
    const fanBladeMat = new T.MeshPhysicalMaterial({ color: 0x262c3a, metalness: 0.32, roughness: 0.26, clearcoat: 0.65 });
    const cryoAccentMat = new T.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0284c7, emissiveIntensity: 0.85, metalness: 0.4, roughness: 0.25 });
    const coolingLogoCapMat = new T.MeshPhysicalMaterial({ color: 0xffffff, map: coolLogoTex, metalness: 0.48, roughness: 0.28, clearcoat: 0.45 });

    const ihsTopMat = new T.MeshPhysicalMaterial({
      color: 0xffffff,
      map: ihsTex,
      metalness: body === 'titanium' ? 0.92 : body === 'silicon' ? 0.86 : body === 'carbon' ? 0.45 : 0.22,
      roughness: body === 'titanium' ? 0.14 : body === 'silicon' ? 0.16 : body === 'carbon' ? 0.28 : 0.52,
      clearcoat: body === 'titanium' ? 0.92 : body === 'carbon' ? 0.85 : body === 'silicon' ? 0.72 : 0.12,
      transparent: true,
      opacity: 1.0
    });
    const ihsFlangeMat = new T.MeshPhysicalMaterial({
      color: body === 'silicon' ? 0x9fc2de : body === 'titanium' ? 0x8998aa : body === 'carbon' ? 0x4a4d57 : 0x7c8391,
      metalness: body === 'gray' ? 0.55 : 0.90,
      roughness: body === 'gray' ? 0.38 : 0.18,
      transparent: true,
      opacity: 1.0
    });

    const root = new T.Group();
    const pinsGroup = new T.Group();
    const pcbGroup = new T.Group();
    const interposerGroup = new T.Group();
    const diesGroup = new T.Group();
    const threadsGroup = new T.Group();
    const ihsGroup = new T.Group();
    const coolingGroup = new T.Group();

    // Pins & MLCC caps
    const pinGeom = new T.CylinderGeometry(0.020, 0.013, 0.095, 7);
    const gridN = opts.compactPins ? 13 : 17;
    const spacing = opts.compactPins ? 0.16 : 0.125;
    const pinPositions = [];
    for (let ix = 0; ix < gridN; ix++) {
      for (let iz = 0; iz < gridN; iz++) {
        const cx = Math.abs(ix - (gridN - 1) / 2);
        const cz = Math.abs(iz - (gridN - 1) / 2);
        if (cx <= (gridN * 0.19) && cz <= (gridN * 0.19)) continue;
        if (ix === 0 && iz === gridN - 1) continue;
        pinPositions.push([(ix - (gridN - 1) / 2) * spacing, -0.095, (iz - (gridN - 1) / 2) * spacing]);
      }
    }
    const pinsMesh = new T.InstancedMesh(pinGeom, pinsGoldMat, pinPositions.length);
    pinPositions.forEach(([px, py, pz], idx) => {
      dum.position.set(px, py, pz); dum.rotation.set(0, 0, 0); dum.scale.set(1, 1, 1); dum.updateMatrix();
      pinsMesh.setMatrixAt(idx, dum.matrix);
    });
    pinsGroup.add(pinsMesh);
    const capBodyGeom = new T.BoxGeometry(0.085, 0.036, 0.044);
    const capsMesh = new T.InstancedMesh(capBodyGeom, ceramicCapMat, 16);
    const capEndsMesh = new T.InstancedMesh(new T.BoxGeometry(0.102, 0.032, 0.042), solderEndMat, 16);
    let ci = 0;
    for (let x = 0; x < 4; x++) {
      for (let z = 0; z < 4; z++) {
        dum.position.set((x - 1.5) * 0.16, -0.068, (z - 1.5) * 0.16);
        dum.rotation.set(0, (x + z) % 2 === 0 ? 0 : Math.PI / 2, 0); dum.scale.set(1, 1, 1); dum.updateMatrix();
        capsMesh.setMatrixAt(ci, dum.matrix); capEndsMesh.setMatrixAt(ci, dum.matrix); ci++;
      }
    }
    pinsGroup.add(capsMesh, capEndsMesh);

    // PCB
    const pcbMesh = new T.Mesh(mkNotchedPcbGeo(), pcbMat);
    pcbMesh.castShadow = !isSoft; pcbMesh.receiveShadow = true;
    pcbGroup.add(pcbMesh);
    const topCapPositions = [];
    for (let k = -3; k <= 3; k++) {
      if (k === 0) continue;
      topCapPositions.push([k * 0.18, 0.068, -1.03]);
      topCapPositions.push([k * 0.18, 0.068, 1.03]);
    }
    const topCapsMesh = new T.InstancedMesh(new T.BoxGeometry(0.065, 0.025, 0.034), ceramicCapMat, topCapPositions.length);
    topCapPositions.forEach(([px, py, pz], idx) => {
      dum.position.set(px, py, pz); dum.rotation.set(0, 0, 0); dum.scale.set(1, 1, 1); dum.updateMatrix();
      topCapsMesh.setMatrixAt(idx, dum.matrix);
    });
    pcbGroup.add(topCapsMesh);

    // Interposer
    const interpBase = new T.Mesh(mkRounded(1.56, 1.56, 0.028, 0.05, 0.008), interposerMat);
    const interpRing = new T.Mesh(mkRounded(1.60, 1.60, 0.012, 0.05, 0.004), copperMat);
    interpRing.position.y = 0.018;
    interposerGroup.add(interpBase, interpRing);
    interposerGroup.position.y = 0.068;

    // Cores / Dies
    const coreCount = spec.cores;
    const iodMesh = new T.Mesh(mkRounded(0.38, 0.30, 0.04, 0.025, 0.006), iodSiliconMat);
    iodMesh.position.set(0, 0.025, coreCount >= 64 ? 0.86 : coreCount >= 32 ? 0.78 : 0.48);
    diesGroup.add(iodMesh);
    if (coreCount <= 0) {
      const mini = new T.Mesh(mkRounded(0.34, 0.24, 0.036, 0.02, 0.006), dieSiliconMat);
      mini.position.set(0, 0.02, -0.22);
      diesGroup.add(mini);
    } else {
      const cols = coreCount >= 86 ? 11 : coreCount >= 64 ? 8 : coreCount <= 1 ? 1 : coreCount <= 4 ? 2 : coreCount <= 8 ? 4 : 8;
      const spacingX = coreCount >= 86 ? 0.18 : coreCount >= 64 ? 0.22 : coreCount >= 16 ? 0.22 : coreCount >= 8 ? 0.30 : 0.72 / Math.max(1, cols - 1);
      const spacingZ = coreCount >= 64 ? 0.15 : coreCount >= 16 ? 0.22 : coreCount >= 8 ? 0.30 : 0.40;
      const dieW = coreCount >= 64 ? 0.135 : coreCount >= 32 ? 0.15 : coreCount >= 16 ? 0.19 : coreCount >= 8 ? 0.25 : coreCount >= 4 ? 0.42 : coreCount === 2 ? 0.54 : 0.68;
      const dieH = coreCount >= 64 ? 0.125 : coreCount >= 32 ? 0.14 : coreCount >= 16 ? 0.17 : coreCount >= 8 ? 0.22 : coreCount >= 4 ? 0.28 : coreCount === 2 ? 0.34 : 0.40;
      const chipGeom = mkRounded(dieW, dieH, 0.035, 0.02, 0.005);
      const frameGeom = mkRounded(dieW + 0.035, dieH + 0.035, 0.012, 0.025, 0.003);
      for (let i = 0; i < coreCount; i++) {
        const col = i % cols, row = Math.floor(i / cols);
        const cx = (col - (Math.min(cols, coreCount) - 1) / 2) * spacingX;
        const cz = (coreCount >= 64 ? -0.72 : -0.34) + row * spacingZ;
        const collar = new T.Mesh(frameGeom, copperMat);
        collar.position.set(cx, 0.008, cz);
        const chip = new T.Mesh(chipGeom, dieSiliconMat);
        chip.position.set(cx, 0.034, cz);
        diesGroup.add(collar, chip);
      }
    }
    diesGroup.position.y = 0.095;

    // Thread interconnects
    if (spec.threads > 0) {
      const lanes = Math.min(18, Math.max(4, spec.threads));
      const zIod = coreCount >= 4 ? 0.32 : 0.14;
      const zTarget = coreCount >= 4 ? -0.34 : -0.18;
      for (let i = 0; i < lanes; i++) {
        const t = lanes === 1 ? 0 : (i / (lanes - 1)) * 2 - 1;
        const xStart = t * 0.16, xEnd = t * (coreCount >= 2 ? 0.44 : 0.24);
        const curve = new T.CatmullRomCurve3([
          new T.Vector3(xStart, 0.028, zIod),
          new T.Vector3((xStart + xEnd) * 0.5, 0.068 + (i % 2) * 0.018, (zIod + zTarget) * 0.5),
          new T.Vector3(xEnd, 0.028, zTarget)
        ]);
        const isCyan = i % 2 === 1;
        const pipeMat = new T.MeshPhysicalMaterial({
          color: isCyan ? 0x38bdf8 : 0xf59e0b,
          emissive: isCyan ? 0x0284c7 : 0xb45309,
          emissiveIntensity: 0.45, metalness: 0.85, roughness: 0.18
        });
        threadsGroup.add(new T.Mesh(new T.TubeGeometry(curve, 14, 0.014, 8, false), pipeMat));
      }
      const bar = new T.Mesh(mkRounded(1.06, 0.06, 0.018, 0.015, 0.004), copperMat);
      bar.position.set(0, 0.024, zIod + 0.08);
      threadsGroup.add(bar);
    }
    threadsGroup.position.y = 0.105;

    // IHS
    const flange = new T.Mesh(mkWingedFlangeGeo(), ihsFlangeMat);
    flange.position.y = -0.02;
    const crown = new T.Mesh(mkRounded(1.66, 1.66, 0.085, 0.10, 0.022), ihsTopMat);
    crown.position.y = 0.045;
    ihsGroup.add(flange, crown);
    if (spec.ai) {
      const c = document.createElement('canvas'); c.width = 256; c.height = 128;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#21133f'; ctx.fillRect(0, 0, 256, 128);
      ctx.strokeStyle = '#a78bfa'; ctx.lineWidth = 10; ctx.strokeRect(5, 5, 246, 118);
      ctx.fillStyle = '#f5f3ff'; ctx.font = '900 82px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('AI', 128, 66);
      const lblTex = new T.CanvasTexture(c); lblTex.colorSpace = T.SRGBColorSpace;
      const backing = new T.Mesh(new T.BoxGeometry(0.42, 0.20, 0.035), darkAnodizedMat);
      backing.position.set(0.55, 0.12, 0.84);
      const label = new T.Mesh(new T.PlaneGeometry(0.37, 0.15), new T.MeshBasicMaterial({ map: lblTex, toneMapped: false }));
      label.position.set(0.55, 0.12, 0.861);
      ihsGroup.add(backing, label);
    }
    ihsGroup.position.y = 0.165;

    // Cooling Stack (levels 1..4)
    let rotorRef = null;
    const coolingLevel = spec.cooling;
    if (coolingLevel > 0) {
      const isUltra = coolingLevel >= 4;
      const isGreat = coolingLevel >= 2 && !isUltra;
      const isVapor = coolingLevel === 3;
      const bracketMesh = new T.Mesh(mkRounded(1.78, 1.78, 0.022, 0.09, 0.006), darkAnodizedMat);
      bracketMesh.position.y = 0.01;
      coolingGroup.add(bracketMesh);

      const bolts = new T.InstancedMesh(new T.CylinderGeometry(0.045, 0.045, 0.048, 6), alumFinMat, 4);
      [[-0.78, -0.78], [0.78, -0.78], [-0.78, 0.78], [0.78, 0.78]].forEach(([bx, bz], i) => {
        dum.position.set(bx, 0.032, bz); dum.rotation.set(0, 0, 0); dum.scale.set(1, 1, 1); dum.updateMatrix();
        bolts.setMatrixAt(i, dum.matrix);
      });
      coolingGroup.add(bolts);

      const blockSize = isVapor ? 1.38 : isGreat ? 1.18 : 0.96;
      const blockMesh = new T.Mesh(mkRounded(blockSize, blockSize, isVapor ? 0.14 : isGreat ? 0.11 : 0.055, 0.06, 0.010), copperMat);
      blockMesh.position.y = isGreat ? 0.065 : 0.038;
      coolingGroup.add(blockMesh);

      const pipeRadius = isGreat ? 0.056 : 0.022;
      const collarOuterR = isGreat ? 0.088 : 0.042;
      const collarHeight = isGreat ? 0.065 : 0.042;
      const finStackBottomY = isGreat ? 0.22 : 0.095;
      const finStackTopY = isGreat ? 0.70 : 0.28;
      const pipeEntryDepthY = isGreat ? -0.105 : -0.075;
      const collarGeom = new T.CylinderGeometry(collarOuterR, collarOuterR * 1.1, collarHeight, 14);

      if (!isGreat && !isUltra) {
        [-0.42, -0.16, 0.16, 0.42].forEach(oz => {
          const curve = new T.CatmullRomCurve3([
            new T.Vector3(-0.62, pipeEntryDepthY, oz), new T.Vector3(-0.62, 0.045, oz),
            new T.Vector3(-0.48, 0.19, oz), new T.Vector3(0, 0.22, oz),
            new T.Vector3(0.48, 0.19, oz), new T.Vector3(0.62, 0.045, oz), new T.Vector3(0.62, pipeEntryDepthY, oz)
          ]);
          coolingGroup.add(new T.Mesh(new T.TubeGeometry(curve, 24, pipeRadius, 10, false), copperMat));
          [-0.62, 0.62].forEach(cx => { const cm = new T.Mesh(collarGeom, darkAnodizedMat); cm.position.set(cx, -0.005, oz); coolingGroup.add(cm); });
        });
        const fins = new T.InstancedMesh(new T.BoxGeometry(1.18, 0.012, 1.14), alumFinMat, 10);
        for (let i = 0; i < 10; i++) {
          dum.position.set(0, finStackBottomY + (i / 9) * (finStackTopY - finStackBottomY), 0);
          dum.rotation.set(0, 0, 0); dum.scale.set(1, 1, 1); dum.updateMatrix();
          fins.setMatrixAt(i, dum.matrix);
        }
        coolingGroup.add(fins);
        const capMesh = new T.Mesh(mkRounded(1.22, 1.18, 0.028, 0.05, 0.008), [coolingLogoCapMat, darkAnodizedMat]);
        capMesh.position.y = finStackTopY + 0.024;
        coolingGroup.add(capMesh);
      } else if (isUltra) {
        [-0.42, -0.16, 0.16, 0.42].forEach(oz => {
          const curve = new T.CatmullRomCurve3([
            new T.Vector3(-0.62, pipeEntryDepthY, oz), new T.Vector3(-0.62, 0.045, oz),
            new T.Vector3(-0.48, 0.19, oz), new T.Vector3(0, 0.22, oz),
            new T.Vector3(0.48, 0.19, oz), new T.Vector3(0.62, 0.045, oz), new T.Vector3(0.62, pipeEntryDepthY, oz)
          ]);
          coolingGroup.add(new T.Mesh(new T.TubeGeometry(curve, 24, pipeRadius, 10, false), copperMat));
          [-0.62, 0.62].forEach(cx => { const cm = new T.Mesh(collarGeom, darkAnodizedMat); cm.position.set(cx, -0.005, oz); coolingGroup.add(cm); });
        });
        const fins = new T.InstancedMesh(new T.BoxGeometry(1.18, 0.018, 1.14), copperMat, 10);
        for (let i = 0; i < 10; i++) {
          dum.position.set(0, 0.095 + (i / 9) * 0.185, 0);
          dum.rotation.set(0, 0, 0); dum.scale.set(1, 1, 1); dum.updateMatrix();
          fins.setMatrixAt(i, dum.matrix);
        }
        coolingGroup.add(fins);
        const capMesh = new T.Mesh(mkRounded(1.22, 1.18, 0.035, 0.05, 0.008), copperMat);
        capMesh.position.y = 0.315;
        coolingGroup.add(capMesh);
      } else if (isVapor) {
        const chBase = new T.Mesh(new T.BoxGeometry(1.62, 0.105, 1.62), copperMat); chBase.position.y = 0.105;
        const gasket = new T.Mesh(new T.BoxGeometry(1.54, 0.025, 1.54), darkAnodizedMat); gasket.position.y = 0.164;
        const chLid = new T.Mesh(new T.BoxGeometry(1.50, 0.055, 1.50), copperMat); chLid.position.y = 0.197;
        coolingGroup.add(chBase, gasket, chLid);
        for (let i = -3; i <= 3; i++) {
          const ch = new T.Mesh(new T.BoxGeometry(0.035, 0.012, 1.12), alumFinMat);
          ch.position.set(i * 0.19, 0.231, 0); coolingGroup.add(ch);
        }
        const evap = new T.Mesh(new T.CylinderGeometry(0.27, 0.27, 0.025, 32), darkAnodizedMat); evap.position.y = 0.239;
        const evapC = new T.Mesh(new T.CylinderGeometry(0.19, 0.19, 0.03, 32), copperMat); evapC.position.y = 0.258;
        coolingGroup.add(evap, evapC);
        const vf = new T.InstancedMesh(new T.BoxGeometry(1.34, 0.46, 0.018), alumFinMat, 22);
        for (let i = 0; i < 22; i++) {
          dum.position.set(0, 0.50, -0.57 + i * (1.14 / 21));
          dum.rotation.set(0, 0, 0); dum.scale.set(1, 1, 1); dum.updateMatrix();
          vf.setMatrixAt(i, dum.matrix);
        }
        coolingGroup.add(vf);
        const shroud = new T.Mesh(new T.TorusGeometry(0.39, 0.035, 10, 32), darkAnodizedMat);
        shroud.rotation.y = Math.PI / 2; shroud.position.set(0, 0.51, 0.72);
        coolingGroup.add(shroud);
        rotorRef = new T.Group(); rotorRef.position.set(0, 0.51, 0.72);
        const hub = new T.Mesh(new T.CylinderGeometry(0.105, 0.105, 0.09, 20), alumFinMat); hub.rotation.x = Math.PI / 2; rotorRef.add(hub);
        for (let b = 0; b < 9; b++) {
          const bp = new T.Group(); bp.rotation.z = (b / 9) * Math.PI * 2;
          const bl = new T.Mesh(new T.BoxGeometry(0.015, 0.25, 0.075), fanBladeMat); bl.position.y = 0.20; bl.rotation.z = 0.35;
          bp.add(bl); rotorRef.add(bp);
        }
        coolingGroup.add(rotorRef);
        const badge = new T.Mesh(mkRounded(0.72, 0.24, 0.025, 0.045, 0.008), [coolingLogoCapMat, darkAnodizedMat]);
        badge.position.set(0, 0.755, -0.39);
        coolingGroup.add(badge);
      } else {
        [-0.46, -0.16, 0.16, 0.46].forEach(oz => {
          const cL = new T.CatmullRomCurve3([new T.Vector3(-0.32, pipeEntryDepthY, oz), new T.Vector3(-0.34, 0.08, oz), new T.Vector3(-0.62, 0.24, oz), new T.Vector3(-0.56, finStackTopY + 0.08, oz)]);
          const cR = new T.CatmullRomCurve3([new T.Vector3(0.32, pipeEntryDepthY, oz), new T.Vector3(0.34, 0.08, oz), new T.Vector3(0.62, 0.24, oz), new T.Vector3(0.56, finStackTopY + 0.08, oz)]);
          coolingGroup.add(new T.Mesh(new T.TubeGeometry(cL, 22, pipeRadius, 10, false), copperMat));
          coolingGroup.add(new T.Mesh(new T.TubeGeometry(cR, 22, pipeRadius, 10, false), copperMat));
          [-0.32, 0.32].forEach(cx => { const cm = new T.Mesh(collarGeom, darkAnodizedMat); cm.position.set(cx, 0.012, oz); coolingGroup.add(cm); });
        });
        const fins = new T.InstancedMesh(new T.BoxGeometry(0.52, 0.015, 1.44), darkAnodizedMat, 26);
        let fi = 0;
        [-0.56, 0.56].forEach(tx => {
          for (let i = 0; i < 13; i++) {
            dum.position.set(tx, finStackBottomY + (i / 12) * (finStackTopY - finStackBottomY), 0);
            dum.rotation.set(0, 0, 0); dum.scale.set(1, 1, 1); dum.updateMatrix();
            fins.setMatrixAt(fi++, dum.matrix);
          }
        });
        coolingGroup.add(fins);
        const topP = mkRounded(0.56, 1.48, 0.03, 0.04, 0.008);
        const stG = new T.BoxGeometry(0.42, 0.012, 0.045);
        [-0.56, 0.56].forEach(tx => {
          const tp = new T.Mesh(topP, alumFinMat); tp.position.set(tx, finStackTopY + 0.04, 0);
          const st = new T.Mesh(stG, cryoAccentMat); st.position.set(tx, finStackTopY + 0.062, 0);
          coolingGroup.add(tp, st);
        });
        const br = new T.Mesh(mkRounded(0.76, 0.76, 0.032, 0.06, 0.010), [coolingLogoCapMat, darkAnodizedMat]);
        br.position.set(0, finStackTopY + 0.075, 0);
        coolingGroup.add(br);
        const fanY = (finStackBottomY + finStackTopY) * 0.48;
        const sh = new T.Mesh(new T.TorusGeometry(0.40, 0.032, 10, 28), darkAnodizedMat);
        sh.rotation.y = Math.PI / 2; sh.position.set(0, fanY, 0);
        coolingGroup.add(sh);
        rotorRef = new T.Group(); rotorRef.position.set(0, fanY, 0);
        const hub = new T.Mesh(new T.CylinderGeometry(0.105, 0.105, 0.08, 20), alumFinMat); hub.rotation.z = Math.PI / 2; rotorRef.add(hub);
        for (let b = 0; b < 9; b++) {
          const pv = new T.Group(); pv.rotation.x = (b / 9) * Math.PI * 2;
          const bl = new T.Mesh(new T.BoxGeometry(0.015, 0.26, 0.08), fanBladeMat); bl.position.y = 0.21; bl.rotation.y = 0.45;
          pv.add(bl); rotorRef.add(pv);
        }
        coolingGroup.add(rotorRef);
      }
      coolingGroup.position.y = 0.255;
    }

    root.add(pinsGroup, pcbGroup, interposerGroup, diesGroup, threadsGroup, ihsGroup, coolingGroup);
    return {
      root,
      pinsGroup,
      pcbGroup,
      interposerGroup,
      diesGroup,
      threadsGroup,
      ihsGroup,
      coolingGroup,
      fanRotor: rotorRef,
      fanAxis: coolingLevel === 3 ? 'z' : 'x',
      ihsMats: [ihsTopMat, ihsFlangeMat]
    };
  }

  window.CpuDesigner3D = {
    buildAssembly: buildStandaloneCpuAssembly
  };
  window.updateCpuDesigner3D = updateCpuDesigner3D;
  window.captureCpuHeroSnapshot = captureCpuHeroSnapshot;
  window.enqueueCpuThumbnail = enqueueCpuThumbnail;

  // Boot gracefully if DOM is already on design page
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initIfNeeded());
  } else {
    initIfNeeded();
  }
})();
