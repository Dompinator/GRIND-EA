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
    body: 'gray', // 'gray' | 'silicon' | 'carbon'
    cores: 0,     // 0 | 1 | 2 | 4
    threads: 0,   // 0 | 4 | 6 | 8
    cooling: 0,   // 0 | 1 | 2
    name: 'Baseline CPU',
    score: 0,
    tier: 'F'
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

    // Laser-etched markings
    ctx.textAlign = 'center';
    ctx.fillStyle = inkMuted;
    ctx.font = '800 38px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillText(
      body === 'carbon' ? 'GRIND // CARBON EDITION' : body === 'silicon' ? 'GRIND // SILICON SERIES' : 'GRIND // ARCHITECTURE',
      size / 2,
      250
    );

    const safeName = (String(state.name || 'Baseline CPU').trim() || 'Baseline CPU').slice(0, 24);
    ctx.fillStyle = inkPrimary;
    const fontSize = safeName.length > 16 ? 68 : safeName.length > 11 ? 84 : 98;
    ctx.font = `900 ${fontSize}px "Plus Jakarta Sans", system-ui, sans-serif`;
    ctx.fillText(safeName, size / 2, 470);

    // Spec line
    const coreTxt = state.cores > 0 ? `${state.cores} CORE${state.cores > 1 ? 'S' : ''}` : 'NO CORE';
    const threadTxt = state.threads > 0 ? `${state.threads} THREADS` : 'NO THREADS';
    ctx.fillStyle = inkMuted;
    ctx.font = '700 36px "JetBrains Mono", monospace';
    ctx.fillText(`${coreTxt}  ·  ${threadTxt}`, size / 2, 575);

    // Tier stamp box
    const tierTxt = `TIER ${state.tier || 'F'}  ·  SCORE ${Number(state.score || 0)}`;
    ctx.fillStyle = accent;
    ctx.font = '800 34px "JetBrains Mono", monospace';
    ctx.fillText(tierTxt, size / 2, 720);

    // Bottom wafer serial micro-code
    ctx.fillStyle = inkMuted;
    ctx.font = '600 24px "JetBrains Mono", monospace';
    ctx.fillText('GRIND SEMICONDUCTOR · FAB EA-01', size / 2, 845);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 4;
    return tex;
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
    textures.siliconDie = createSiliconDieTexture();
    textures.ihs = createIhsEtchTexture(activeState);

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
  }

  // ---------- Dynamic Hardware Rebuild per Research Selection ----------

  function rebuildSiliconCores(coreCount) {
    clearGroupDynamic(diesGroup);

    // Central I/O Controller Die (always anchors the architecture)
    const iodGeom = createRoundedRectGeometry(0.46, 0.38, 0.045, 0.03, 0.008);
    const iodMesh = new THREE.Mesh(iodGeom, mats.iodSilicon);
    iodMesh.castShadow = !isSoftwareGl;
    iodMesh.position.set(0, 0.025, 0.24);
    diesGroup.add(iodMesh);

    if (coreCount === 0) {
      // Minimal baseline diagnostic bridge chiplet
      const miniGeom = createRoundedRectGeometry(0.34, 0.24, 0.036, 0.02, 0.006);
      const miniMesh = new THREE.Mesh(miniGeom, mats.dieSilicon);
      miniMesh.position.set(0, 0.02, -0.22);
      diesGroup.add(miniMesh);
      return;
    }

    let chipletCoords = [];
    let dieW = 0.54;
    let dieH = 0.36;
    if (coreCount === 1) {
      chipletCoords = [[0, -0.24]];
      dieW = 0.72;
      dieH = 0.42;
    } else if (coreCount === 2) {
      chipletCoords = [[-0.36, -0.25], [0.36, -0.25]];
      dieW = 0.56;
      dieH = 0.38;
    } else {
      chipletCoords = [
        [-0.38, -0.38], [0.38, -0.38],
        [-0.38, 0.02], [0.38, 0.02]
      ];
      dieW = 0.48;
      dieH = 0.30;
      iodMesh.position.set(0, 0.025, 0.44);
    }

    const chipGeom = createRoundedRectGeometry(dieW, dieH, 0.055, 0.025, 0.008);
    const frameGeom = createRoundedRectGeometry(dieW + 0.05, dieH + 0.05, 0.015, 0.03, 0.004);

    chipletCoords.forEach(([cx, cz]) => {
      const collar = new THREE.Mesh(frameGeom, mats.copper);
      collar.position.set(cx, 0.008, cz);
      diesGroup.add(collar);

      const chip = new THREE.Mesh(chipGeom, mats.dieSilicon);
      chip.castShadow = !isSoftwareGl;
      chip.receiveShadow = true;
      chip.position.set(cx, 0.034, cz);
      diesGroup.add(chip);
    });
  }

  function rebuildThreadInterconnects(threadCount, coreCount) {
    clearGroupDynamic(threadsGroup);
    threadPipeMaterials.length = 0;
    if (threadCount <= 0) return;

    const lanes = Math.min(8, Math.max(4, threadCount));
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

    const isGreat = coolingLevel >= 2;

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

    // 2. Copper Coldplate Vapor Chamber Block
    const blockGeom = createRoundedRectGeometry(1.22, 1.22, isGreat ? 0.12 : 0.08, 0.06, 0.012);
    const blockMesh = new THREE.Mesh(blockGeom, mats.copper);
    blockMesh.castShadow = !isSoftwareGl;
    blockMesh.position.y = isGreat ? 0.075 : 0.055;
    coolingGroup.add(blockMesh);

    // 3. Sintered U-Bent Copper Heatpipes (2 for Built-In, 4 for Great Cooling)
    const pipeCount = isGreat ? 4 : 2;
    const finStackBottomY = isGreat ? 0.22 : 0.13;
    const finStackTopY = isGreat ? 0.72 : 0.42;

    for (let p = 0; p < pipeCount; p++) {
      const offsetZ = (p - (pipeCount - 1) / 2) * (isGreat ? 0.28 : 0.42);
      const spreadX = isGreat ? 0.62 : 0.48;
      const pipeCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-spreadX, finStackTopY + 0.05, offsetZ),
        new THREE.Vector3(-spreadX, finStackBottomY, offsetZ),
        new THREE.Vector3(-0.25, 0.07, offsetZ),
        new THREE.Vector3(0.25, 0.07, offsetZ),
        new THREE.Vector3(spreadX, finStackBottomY, offsetZ),
        new THREE.Vector3(spreadX, finStackTopY + 0.05, offsetZ)
      ]);
      const pGeom = new THREE.TubeGeometry(pipeCurve, 32, 0.036, 12, false);
      const pMesh = new THREE.Mesh(pGeom, mats.copper);
      pMesh.castShadow = !isSoftwareGl;
      coolingGroup.add(pMesh);
    }

    // 4. Skived Fin Stack (InstancedMesh)
    if (!isGreat) {
      const finCount = 14;
      const finGeom = new THREE.BoxGeometry(1.36, 0.014, 1.32);
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

      const capGeom = createRoundedRectGeometry(1.38, 1.34, 0.025, 0.04, 0.008);
      const capMesh = new THREE.Mesh(capGeom, mats.darkAnodized);
      capMesh.position.y = finStackTopY + 0.03;
      coolingGroup.add(capMesh);
    } else {
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

      // Machined top shroud caps + cryo light accent strips
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

      // Center PWM Axial Fan Assembly (shroud ring + spinning 9-blade hub)
      const fanY = (finStackBottomY + finStackTopY) * 0.52;
      const shroudGeom = new THREE.TorusGeometry(0.42, 0.035, 12, 36);
      const shroud = new THREE.Mesh(shroudGeom, mats.darkAnodized);
      shroud.rotation.y = Math.PI / 2;
      shroud.position.set(0, fanY, 0);
      coolingGroup.add(shroud);

      fanRotorGroup = new THREE.Group();
      fanRotorGroup.position.set(0, fanY, 0);

      const hubGeom = new THREE.CylinderGeometry(0.11, 0.11, 0.08, 24);
      const hubMesh = new THREE.Mesh(hubGeom, mats.alumFin);
      hubMesh.rotation.z = Math.PI / 2;
      fanRotorGroup.add(hubMesh);

      const bladeGeom = new THREE.BoxGeometry(0.015, 0.28, 0.085);
      const bladesCount = 9;
      for (let b = 0; b < bladesCount; b++) {
        const angle = (b / bladesCount) * Math.PI * 2;
        const pivot = new THREE.Group();
        pivot.rotation.x = angle;
        const blade = new THREE.Mesh(bladeGeom, mats.fanBlade);
        blade.position.y = 0.22;
        blade.rotation.y = 0.45; // aero pitch
        pivot.add(blade);
        fanRotorGroup.add(pivot);
      }

      coolingGroup.add(fanRotorGroup);
    }
  }

  function applyBodyMaterialFinish(bodyType) {
    if (!mats.pcb || !mats.ihsTop || !mats.ihsFlange || !mats.pinsGold) return;

    const texSet = bodyType === 'carbon'
      ? textures.pcbCarbon
      : bodyType === 'silicon'
        ? textures.pcbSilicon
        : textures.pcbGray;

    mats.pcb.map = texSet.map;
    mats.pcb.bumpMap = texSet.bumpMap;
    mats.pcb.roughness = bodyType === 'silicon' ? 0.22 : bodyType === 'carbon' ? 0.34 : 0.60;
    mats.pcb.metalness = bodyType === 'silicon' ? 0.55 : bodyType === 'carbon' ? 0.25 : 0.10;
    mats.pcb.clearcoat = bodyType === 'silicon' ? 0.85 : bodyType === 'carbon' ? 0.42 : 0.08;
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

    // Re-etch IHS plate with live name + spec + finish
    if (textures.ihs) textures.ihs.dispose();
    textures.ihs = createIhsEtchTexture(activeState);
    mats.ihsTop.map = textures.ihs;
    mats.ihsTop.needsUpdate = true;
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
      name: String(nextState.name || 'Baseline CPU'),
      score: Number(nextState.score || 0),
      tier: String(nextState.tier || 'F')
    };

    const ready = await initIfNeeded();
    if (!ready || !THREE) return;

    const coresChanged = prev.cores !== activeState.cores;
    const threadsChanged = prev.threads !== activeState.threads;
    const coolingChanged = prev.cooling !== activeState.cooling;
    const bodyOrLabelChanged =
      prev.body !== activeState.body ||
      prev.name !== activeState.name ||
      prev.score !== activeState.score ||
      prev.tier !== activeState.tier;

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
    if (bodyOrLabelChanged || coresChanged || threadsChanged) {
      applyBodyMaterialFinish(activeState.body);
    }

    updateVisibilityState();
  }

  window.updateCpuDesigner3D = updateCpuDesigner3D;

  // Boot gracefully if DOM is already on design page
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initIfNeeded());
  } else {
    initIfNeeded();
  }
})();
