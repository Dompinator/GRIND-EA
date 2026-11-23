/* ============================================================
 * GRIND-EA · Procedural 3D PC Case & Full PC CAD Designer (Three.js PBR)
 * Real-World Millimeter Scale (1.0 unit = 100mm):
 *   - Small Mini-ITX: 370 x 345 x 208 mm · max 280mm GPU · 92/120/140mm fans
 *   - Medium ATX:     465 x 460 x 235 mm · max 340mm GPU
 *   - Large E-ATX:    545 x 540 x 265 mm · max 390mm GPU
 * Mounts ACTUAL CpuDesigner3D & GpuDesigner3D Assemblies at True Size!
 * ============================================================ */
(function () {
  'use strict';

  const DEFAULT_CONFIG = {
    mode: 'case',        // 'case' | 'pc'
    caseSize: 'small',   // 'small' | 'medium' | 'large'
    material: 'steel',   // 'steel' | 'aluminum' | 'glass_showcase'
    frontStyle: 'mesh',  // 'mesh' | 'solid' | 'glass'
    primaryColor: '#1a1f2b',
    accentColor: '#a855f7',
    rgbEnabled: false,
    rgbMode: 'solid',    // 'solid' | 'rainbow'
    rgbColor: '#a855f7',
    openPanel: true,
    showAirflow: false,
    gpuMount: 'horizontal', // 'horizontal' | 'vertical'
    fans: [],            // [{ id, fanType, mount, position, bladeColor, rgbRing }]
    motherboard: null,   // full Motherboard cfg built by buildMoboConfigFromProduct
    cpu: null,           // full CPU spec resolved by resolveCpuProductSpec
    gpu: null            // full GPU cfg built by buildGpuConfigFromProduct
  };

  let THREE = null;
  let OrbitControls = null;
  let RoomEnvironment = null;
  let initPromise = null;
  let isSoftwareGl = false;
  let contextLost = false;

  let stageEl = null;
  let mountEl = null;
  let dockEl = null;
  let renderer = null;
  let scene = null;
  let camera = null;
  let controls = null;
  let envTexture = null;
  let resizeObserver = null;

  let pcRoot = null;
  let assemblyContainer = null;

  let offscreenPromise = null;
  let thumbQueueBusy = false;
  const pcThumbQueue = [];

  let state = { ...DEFAULT_CONFIG, fans: [] };
  let lastStructSig = '';
  let rafId = 0;
  let timerId = 0;
  let lastMs = 0;
  let elapsedSec = 0;
  let camAnimActive = false;
  const camTargetPos = { x: 4.9, y: 2.9, z: 5.5 };
  const camTargetLook = { x: 0, y: 0.08, z: 0 };

  let activeFanRotors = [];
  let activeCpuSpinners = [];
  let activeRgbMats = [];
  let activeAirflowArrows = [];
  const texCache = new WeakMap();

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  function detectSoftwareWebGL() {
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const gpu = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
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
        return true;
      } catch (err) {
        console.warn('PC 3D designer failed to load Three.js:', err);
        initPromise = null;
        return false;
      }
    })();
    return initPromise;
  }

  function disposeObject(obj) {
    if (!obj) return;
    if (obj.geometry && !obj.userData?.sharedGeo) obj.geometry.dispose();
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach(m => {
        if (m && !m.userData?.sharedMat) m.dispose();
      });
    }
  }

  function clearGroup(grp) {
    if (!grp) return;
    while (grp.children.length) {
      const child = grp.children[0];
      grp.remove(child);
      child.traverse(disposeObject);
    }
  }

  function getCachedTextures(T) {
    if (texCache.has(T)) return texCache.get(T);

    // Perforated airflow mesh texture
    const mc = document.createElement('canvas');
    mc.width = 128;
    mc.height = 128;
    const mctx = mc.getContext('2d');
    mctx.fillStyle = '#181d28';
    mctx.fillRect(0, 0, 128, 128);
    mctx.fillStyle = '#04060a';
    for (let y = 6; y < 128; y += 12) {
      const off = (y / 12) % 2 === 0 ? 0 : 6;
      for (let x = 3; x < 128; x += 12) {
        mctx.beginPath();
        mctx.arc((x + off) % 128, y, 3.5, 0, Math.PI * 2);
        mctx.fill();
      }
    }
    const meshTex = new T.CanvasTexture(mc);
    meshTex.colorSpace = T.SRGBColorSpace;
    meshTex.wrapS = T.RepeatWrapping;
    meshTex.wrapT = T.RepeatWrapping;
    meshTex.repeat.set(6, 10);

    // Detailed PCB motherboard trace texture
    const pc = document.createElement('canvas');
    pc.width = 512;
    pc.height = 512;
    const pctx = pc.getContext('2d');
    pctx.fillStyle = '#10141d';
    pctx.fillRect(0, 0, 512, 512);
    pctx.strokeStyle = 'rgba(148,163,184,0.11)';
    pctx.lineWidth = 2;
    for (let i = 20; i < 492; i += 14) {
      pctx.beginPath();
      pctx.moveTo(20, i);
      pctx.lineTo(220, i);
      pctx.lineTo(250, i + (i % 28 === 0 ? 12 : -12));
      pctx.lineTo(492, i + (i % 28 === 0 ? 12 : -12));
      pctx.stroke();
    }
    pctx.fillStyle = 'rgba(148,163,184,0.22)';
    for (let i = 36; i < 476; i += 44) {
      for (let j = 36; j < 476; j += 44) {
        pctx.beginPath();
        pctx.arc(i, j, 2.5, 0, Math.PI * 2);
        pctx.fill();
      }
    }
    pctx.strokeStyle = 'rgba(168,85,247,0.28)';
    pctx.lineWidth = 3;
    pctx.strokeRect(14, 14, 484, 484);
    const moboTex = new T.CanvasTexture(pc);
    moboTex.colorSpace = T.SRGBColorSpace;

    // PSU wattage badge texture
    const uc = document.createElement('canvas');
    uc.width = 256;
    uc.height = 96;
    const uctx = uc.getContext('2d');
    uctx.fillStyle = '#0f131c';
    uctx.fillRect(0, 0, 256, 96);
    uctx.strokeStyle = '#64748b';
    uctx.lineWidth = 4;
    uctx.strokeRect(4, 4, 248, 88);
    uctx.fillStyle = '#f8fafc';
    uctx.font = '900 30px Inter, system-ui, sans-serif';
    uctx.fillText('850W', 22, 46);
    uctx.fillStyle = '#fbbf24';
    uctx.font = '800 18px Inter, system-ui, sans-serif';
    uctx.fillText('80+ GOLD · ATX 3.1', 22, 74);
    const psuTex = new T.CanvasTexture(uc);
    psuTex.colorSpace = T.SRGBColorSpace;

    const bundle = { meshTex, moboTex, psuTex };
    texCache.set(T, bundle);
    return bundle;
  }

  function getChassisDimensions(caseSize) {
    // 1.0 unit = 100mm real-world millimeter scale
    if (caseSize === 'large') {
      return {
        w: 5.45, h: 5.40, d: 2.65, wall: 0.058,
        shroudH: 0.98, shroudW: 4.25,
        moboW: 2.85, moboH: 3.25,
        maxGpuMm: 390, camScale: 1.44
      };
    }
    if (caseSize === 'medium') {
      return {
        w: 4.65, h: 4.60, d: 2.35, wall: 0.052,
        shroudH: 0.88, shroudW: 3.60,
        moboW: 2.44, moboH: 3.05,
        maxGpuMm: 340, camScale: 1.24
      };
    }
    return {
      w: 3.70, h: 3.45, d: 2.08, wall: 0.048,
      shroudH: 0.72, shroudW: 2.86,
      moboW: 1.75, moboH: 1.75,
      maxGpuMm: 280, camScale: 1.0
    };
  }

  // Standalone Builder: returns full hierarchical assembly usable by BOTH PcDesigner3D & ProductPreviewModal
  function buildStandalonePcAssembly(T, rawCfg, opts = {}) {
    if (!T) return null;
    const cfg = {
      ...DEFAULT_CONFIG,
      ...(rawCfg && typeof rawCfg === 'object' ? rawCfg : {}),
      fans: Array.isArray(rawCfg?.fans) ? rawCfg.fans.map(f => ({ ...f })) : []
    };
    const isSoft = !!opts.isSoftwareGl;
    const dims = getChassisDimensions(cfg.caseSize);
    const { w, h, d, wall, shroudH, shroudW, moboW, moboH } = dims;
    const textures = getCachedTextures(T);

    const primCol = new T.Color(cfg.primaryColor || '#1a1f2b');
    const accCol = new T.Color(cfg.accentColor || '#a855f7');
    const isAlum = cfg.material === 'aluminum';
    const isShowcase = cfg.material === 'glass_showcase';

    const shellMat = new T.MeshPhysicalMaterial({
      color: primCol,
      metalness: isAlum ? 0.82 : 0.36,
      roughness: isAlum ? 0.26 : 0.52,
      clearcoat: isAlum ? 0.25 : 0.1
    });
    const frameMat = new T.MeshStandardMaterial({
      color: primCol.clone().multiplyScalar(0.68),
      metalness: 0.58,
      roughness: 0.42
    });
    const darkMetalMat = new T.MeshStandardMaterial({
      color: 0x0e1118,
      metalness: 0.62,
      roughness: 0.44
    });
    const brushedSilverMat = new T.MeshPhysicalMaterial({
      color: 0xcbd5e1,
      metalness: 0.9,
      roughness: 0.22
    });
    const accentMat = new T.MeshStandardMaterial({
      color: accCol,
      metalness: 0.65,
      roughness: 0.24
    });
    const copperMat = new T.MeshStandardMaterial({
      color: 0xd97742,
      metalness: 0.92,
      roughness: 0.2
    });
    const glassMat = new T.MeshPhysicalMaterial({
      color: 0x9eb8f0,
      metalness: 0.05,
      roughness: 0.07,
      transparent: true,
      opacity: isSoft ? 0.22 : 0.19,
      transmission: isSoft ? 0 : 0.65,
      ior: 1.5,
      depthWrite: false
    });

    const addBox = (parent, bw, bh, bd, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
      const m = new T.Mesh(new T.BoxGeometry(bw, bh, bd), mat);
      m.position.set(x, y, z);
      if (rx || ry || rz) m.rotation.set(rx, ry, rz);
      parent.add(m);
      return m;
    };

    const root = new T.Group();
    const chassisGroup = new T.Group();
    const topPanelGroup = new T.Group();
    const frontGroup = new T.Group();
    const glassDoorGroup = new T.Group();
    const fansGroup = new T.Group();
    const rgbGroup = new T.Group();
    const motherboardGroup = new T.Group();
    const cpuGroup = new T.Group();
    const gpuGroup = new T.Group();
    const cablesGroup = new T.Group();
    const airflowGroup = new T.Group();

    const rotorsList = [];
    const cpuSpinners = [];
    const rgbList = [];
    const arrowsList = [];

    // 1. Base chassis + CNC machined feet
    addBox(chassisGroup, w, wall, d, shellMat, 0, -h / 2 + wall / 2, 0);
    const footH = 0.14;
    const footY = -h / 2 - footH / 2 + 0.005;
    const fx = w * 0.41;
    const fz = d * 0.37;
    [[-fx, -fz], [fx, -fz], [-fx, fz], [fx, fz]].forEach(([x, z]) => {
      const foot = new T.Mesh(new T.CylinderGeometry(0.16, 0.19, footH, 20), frameMat);
      foot.position.set(x, footY, z);
      chassisGroup.add(foot);
      const ring = new T.Mesh(new T.CylinderGeometry(0.17, 0.17, 0.025, 20), accentMat);
      ring.position.set(x, footY + footH * 0.32, z);
      chassisGroup.add(ring);
    });

    // Rear wall (-X) with motherboard I/O shield + exhaust grill + PCIe expansion slots + PSU bay
    addBox(chassisGroup, wall, h - wall * 2, d, shellMat, -w / 2 + wall / 2, 0, 0);
    // Corner structural pillars
    addBox(chassisGroup, 0.08, h - wall * 2, 0.08, frameMat, -w / 2 + 0.04, 0, d / 2 - 0.04);
    addBox(chassisGroup, 0.08, h - wall * 2, 0.08, frameMat, w / 2 - 0.04, 0, d / 2 - 0.04);

    // Back spine wall (-Z)
    const spineZ = -d / 2 + wall * 0.45;
    addBox(chassisGroup, w - wall * 2, h - wall * 2, wall * 0.9, frameMat, 0, 0, spineZ);
    // Inner motherboard tray + rubber cable routing grommets
    const trayZ = -d / 2 + wall + 0.08;
    addBox(chassisGroup, moboW + 0.24, h - wall * 2.5 - shroudH, 0.025, darkMetalMat, -w / 2 + wall + moboW / 2 + 0.08, shroudH * 0.45, trayZ - 0.02);
    // Standoffs
    const moboX = -w / 2 + wall + moboW / 2 + 0.06;
    const topClear = cfg.caseSize === 'large' ? 0.36 : cfg.caseSize === 'medium' ? 0.32 : 0.28;
    const moboY = h / 2 - wall - topClear - moboH / 2;
    const grommetX = moboX + moboW / 2 + 0.14;
    for (let g = 0; g < 3; g++) {
      addBox(chassisGroup, 0.11, 0.34, 0.036, darkMetalMat, grommetX, moboY + (g - 1) * (moboH * 0.32), trayZ - 0.005);
      addBox(chassisGroup, 0.02, 0.26, 0.042, accentMat, grommetX + 0.035, moboY + (g - 1) * (moboH * 0.32), trayZ - 0.003);
    }

    // PSU Shroud + Modular 850W PSU Window
    const shroudTopY = -h / 2 + wall + shroudH;
    addBox(chassisGroup, shroudW, 0.035, d - wall * 2, frameMat, -w / 2 + wall + shroudW / 2, shroudTopY, 0);
    addBox(chassisGroup, 0.035, shroudH, d - wall * 2, frameMat, -w / 2 + wall + shroudW, -h / 2 + wall + shroudH / 2, 0);
    // Visible PSU body (standard ATX: 160x86x150 mm -> 1.60 x 0.86 x 1.50)
    const psuLen = Math.min(shroudW * 0.52, 1.62);
    const psuH = Math.min(shroudH * 0.82, 0.86);
    const psuD = Math.min(d * 0.72, 1.50);
    const psuX = -w / 2 + wall + psuLen / 2 + 0.06;
    const psuY = -h / 2 + wall + psuH / 2 + 0.02;
    addBox(chassisGroup, psuLen, psuH, psuD, darkMetalMat, psuX, psuY, -d * 0.05);
    const psuBadgeMat = new T.MeshStandardMaterial({ map: textures.psuTex, metalness: 0.35, roughness: 0.45 });
    const psuBadge = new T.Mesh(new T.PlaneGeometry(psuLen * 0.68, psuH * 0.56), psuBadgeMat);
    psuBadge.position.set(psuX, psuY, -d * 0.05 + psuD / 2 + 0.004);
    chassisGroup.add(psuBadge);
    // PCIe slots on rear chassis
    const pcieSlotCount = cfg.caseSize === 'large' ? 8 : cfg.caseSize === 'medium' ? 7 : 3;
    const firstPcieY = moboY - moboH * 0.16;
    for (let i = 0; i < pcieSlotCount; i++) {
      const sy = firstPcieY - i * 0.20;
      if (sy < shroudTopY + 0.08) break;
      addBox(chassisGroup, 0.02, 0.11, 1.15, frameMat, -w / 2 - 0.005, sy, -d * 0.05);
    }

    // 2. Top Panel (separate group so Explode can lift it cleanly)
    addBox(topPanelGroup, w, wall, d, shellMat, 0, h / 2 - wall / 2, 0);
    const meshMat = new T.MeshStandardMaterial({
      color: 0x202634,
      map: textures.meshTex,
      metalness: 0.4,
      roughness: 0.58
    });
    addBox(topPanelGroup, w * 0.68, 0.016, d * 0.64, meshMat, -w * 0.06, h / 2 + 0.004, 0);
    // Top Front I/O: Power button, USB-C, 2x USB-A
    addBox(topPanelGroup, 0.44, 0.022, 0.18, frameMat, w * 0.34, h / 2 + 0.006, d * 0.32);
    const pwrBtn = new T.Mesh(new T.CylinderGeometry(0.045, 0.045, 0.026, 16), accentMat);
    pwrBtn.position.set(w * 0.42, h / 2 + 0.01, d * 0.32);
    topPanelGroup.add(pwrBtn);
    addBox(topPanelGroup, 0.065, 0.024, 0.04, darkMetalMat, w * 0.31, h / 2 + 0.01, d * 0.32);
    addBox(topPanelGroup, 0.065, 0.024, 0.04, darkMetalMat, w * 0.23, h / 2 + 0.01, d * 0.32);

    // 3. Front Panel (explodes +X)
    const frontX = w / 2 - wall / 2;
    if (cfg.frontStyle === 'glass' || isShowcase) {
      addBox(frontGroup, wall * 0.75, h, 0.08, frameMat, frontX, 0, -d / 2 + 0.04);
      addBox(frontGroup, wall * 0.75, h, 0.08, frameMat, frontX, 0, d / 2 - 0.04);
      addBox(frontGroup, wall * 0.75, 0.09, d, frameMat, frontX, h / 2 - 0.045, 0);
      addBox(frontGroup, wall * 0.75, 0.09, d, frameMat, frontX, -h / 2 + 0.045, 0);
      addBox(frontGroup, 0.028, h - 0.16, d - 0.14, glassMat, frontX + 0.014, 0, 0);
    } else if (cfg.frontStyle === 'solid') {
      addBox(frontGroup, wall, h - wall * 1.3, d - 0.02, shellMat, frontX, 0, 0);
      addBox(frontGroup, 0.024, h * 0.74, 0.06, accentMat, frontX + wall * 0.45, 0, d * 0.38);
    } else {
      addBox(frontGroup, wall * 0.8, h, 0.08, frameMat, frontX, 0, -d / 2 + 0.04);
      addBox(frontGroup, wall * 0.8, h, 0.08, frameMat, frontX, 0, d / 2 - 0.04);
      addBox(frontGroup, wall * 0.8, 0.09, d, frameMat, frontX, h / 2 - 0.045, 0);
      addBox(frontGroup, wall * 0.8, 0.09, d, frameMat, frontX, -h / 2 + 0.045, 0);
      addBox(frontGroup, 0.026, h - 0.16, d - 0.15, meshMat, frontX + 0.01, 0, 0);
    }

    // 4. Tempered Glass Side Door (hinged on rear pillar, swings open or explodes +Z)
    const glassZ = d / 2 - 0.02;
    glassDoorGroup.position.set(-w / 2 + wall, 0, glassZ);
    glassDoorGroup.rotation.y = cfg.openPanel ? -0.92 : 0;
    addBox(glassDoorGroup, w - wall * 1.1, h - wall * 1.1, 0.028, glassMat, (w - wall) / 2, 0, 0);
    addBox(glassDoorGroup, 0.07, h - wall * 1.1, 0.034, frameMat, 0.035, 0, 0);
    addBox(glassDoorGroup, 0.06, h - wall * 1.1, 0.034, frameMat, w - wall * 1.25, 0, 0);
    [[-h * 0.38], [h * 0.38]].forEach(([sy]) => {
      const screw = new T.Mesh(new T.CylinderGeometry(0.032, 0.032, 0.045, 14), accentMat);
      screw.rotation.x = Math.PI / 2;
      screw.position.set(w - wall * 1.55, sy, 0.01);
      glassDoorGroup.add(screw);
    });

    // 5. Optional Case RGB Lightbars
    if (cfg.rgbEnabled) {
      const baseRgbCol = new T.Color(cfg.rgbColor || cfg.accentColor || '#a855f7');
      const rgbMat = new T.MeshStandardMaterial({
        color: baseRgbCol,
        emissive: baseRgbCol,
        emissiveIntensity: 2.0,
        roughness: 0.2
      });
      rgbMat.userData = { rgbMode: cfg.rgbMode || 'solid', baseColor: baseRgbCol.clone() };
      rgbList.push(rgbMat);

      addBox(rgbGroup, 0.032, h * 0.85, 0.04, rgbMat, w / 2 - 0.015, 0, d / 2 - 0.08);
      addBox(rgbGroup, shroudW * 0.92, 0.032, 0.032, rgbMat, -w / 2 + wall + shroudW / 2, shroudTopY + 0.02, d * 0.38);
      addBox(rgbGroup, w * 0.76, 0.026, 0.026, rgbMat, 0, h / 2 - wall - 0.025, d * 0.36);
    }

    // 6. Real-Scale Placeable Case Fans (92mm = 0.92, 120mm = 1.20, 140mm = 1.40 diameter!)
    const fans = Array.isArray(cfg.fans) ? cfg.fans : [];
    fans.forEach((fan, idx) => {
      const fanGrp = new T.Group();
      const diam = fan.fanType === 'pc_smart_fans' ? 1.40 : fan.fanType === 'pc_medium_fans' ? 1.20 : 0.92;
      const radius = diam / 2;
      const fanDepth = 0.25; // standard 25mm fan thickness
      const frameHalf = radius;
      const housingMat = new T.MeshStandardMaterial({ color: 0x161922, metalness: 0.45, roughness: 0.42 });
      const bladeHex = fan.bladeColor === 'white' ? '#eef2f6' : fan.bladeColor === 'accent' ? (cfg.accentColor || '#a855f7') : '#242938';
      const bladeMat = new T.MeshStandardMaterial({ color: bladeHex, metalness: 0.35, roughness: 0.36 });

      const barThick = 0.065;
      addBox(fanGrp, diam, barThick, fanDepth, housingMat, 0, frameHalf - barThick / 2, 0);
      addBox(fanGrp, diam, barThick, fanDepth, housingMat, 0, -frameHalf + barThick / 2, 0);
      addBox(fanGrp, barThick, diam - barThick * 2, fanDepth, housingMat, -frameHalf + barThick / 2, 0, 0);
      addBox(fanGrp, barThick, diam - barThick * 2, fanDepth, housingMat, frameHalf - barThick / 2, 0, 0);
      const innerShroud = new T.Mesh(new T.CylinderGeometry(radius * 0.92, radius * 0.92, fanDepth * 0.95, 28, 1, true), housingMat);
      innerShroud.rotation.x = Math.PI / 2;
      fanGrp.add(innerShroud);

      const rotor = new T.Group();
      const hub = new T.Mesh(new T.CylinderGeometry(radius * 0.26, radius * 0.26, fanDepth * 0.65, 18), frameMat);
      hub.rotation.x = Math.PI / 2;
      rotor.add(hub);
      const bladeCount = fan.fanType === 'pc_smart_fans' ? 9 : fan.fanType === 'pc_medium_fans' ? 7 : 5;
      for (let b = 0; b < bladeCount; b++) {
        const angle = (b / bladeCount) * Math.PI * 2;
        const bPivot = new T.Group();
        bPivot.rotation.z = angle;
        const blade = new T.Mesh(new T.BoxGeometry(radius * 0.62, radius * 0.24, 0.02), bladeMat);
        blade.position.x = radius * 0.56;
        blade.rotation.x = 0.48;
        bPivot.add(blade);
        rotor.add(bPivot);
      }
      fanGrp.add(rotor);
      const speedMult = fan.fanType === 'pc_smart_fans' ? 9.5 : fan.fanType === 'pc_medium_fans' ? 6.5 : 4.4;
      rotorsList.push({ rotor, speed: speedMult + (idx % 3) * 0.4 });

      if (fan.rgbRing && cfg.rgbEnabled) {
        const ringCol = new T.Color(cfg.rgbColor || cfg.accentColor || '#a855f7');
        const ringMat = new T.MeshStandardMaterial({
          color: ringCol,
          emissive: ringCol,
          emissiveIntensity: 1.9,
          roughness: 0.2
        });
        ringMat.userData = { rgbMode: cfg.rgbMode || 'solid', baseColor: ringCol.clone() };
        rgbList.push(ringMat);
        const halo = new T.Mesh(new T.TorusGeometry(radius * 0.9, 0.025, 10, 32), ringMat);
        halo.position.z = fanDepth * 0.48;
        fanGrp.add(halo);
      }

      const posT = clamp(Number(fan.position ?? 0.5), 0.1, 0.9);
      const mount = fan.mount || 'front';
      if (mount === 'front') {
        const minY = -h / 2 + wall + frameHalf + 0.14;
        const maxY = h / 2 - wall - frameHalf - 0.14;
        fanGrp.position.set(w / 2 - wall - fanDepth / 2 - 0.04, minY + posT * Math.max(0.05, maxY - minY), 0);
        fanGrp.rotation.y = Math.PI / 2;
      } else if (mount === 'rear') {
        const minY = firstPcieY + 0.35;
        const maxY = h / 2 - wall - frameHalf - 0.14;
        fanGrp.position.set(-w / 2 + wall + fanDepth / 2 + 0.04, minY + posT * Math.max(0.04, maxY - minY), -d * 0.06);
        fanGrp.rotation.y = -Math.PI / 2;
      } else if (mount === 'top') {
        const minX = -w / 2 + wall + frameHalf + 0.22;
        const maxX = w / 2 - wall - frameHalf - 0.22;
        fanGrp.position.set(minX + posT * Math.max(0.05, maxX - minX), h / 2 - wall - fanDepth / 2 - 0.04, -d * 0.05);
        fanGrp.rotation.x = Math.PI / 2;
      } else {
        const minX = -w * 0.02;
        const maxX = w / 2 - wall - frameHalf - 0.22;
        fanGrp.position.set(minX + posT * Math.max(0.05, maxX - minX), shroudTopY + fanDepth / 2 + 0.04, 0);
        fanGrp.rotation.x = -Math.PI / 2;
      }
      fansGroup.add(fanGrp);

      if (cfg.showAirflow) {
        const isIntake = mount === 'front' || mount === 'bottom';
        const arrowCol = isIntake ? 0x38bdf8 : 0xf97316;
        const arrowMat = new T.MeshStandardMaterial({
          color: arrowCol,
          emissive: arrowCol,
          emissiveIntensity: 1.4,
          transparent: true,
          opacity: 0.88
        });
        const stream = new T.Group();
        const shaft = new T.Mesh(new T.CylinderGeometry(0.028, 0.028, 0.42, 10), arrowMat);
        shaft.rotation.z = Math.PI / 2;
        const head = new T.Mesh(new T.ConeGeometry(0.075, 0.16, 12), arrowMat);
        head.rotation.z = -Math.PI / 2;
        head.position.x = 0.26;
        stream.add(shaft, head);
        stream.position.copy(fanGrp.position);
        if (mount === 'front' || mount === 'rear') stream.rotation.y = Math.PI;
        else stream.rotation.z = Math.PI / 2;
        arrowsList.push({ mesh: stream, basePos: stream.position.clone(), mount });
        airflowGroup.add(stream);
      }
    });

    // 7. Real 1:1 Selected Motherboard OR Stock Case Tray Motherboard
    const moboZ = trayZ + 0.065; // standoffs clearance
    const asmOpts = opts.assembly && typeof opts.assembly === 'object' ? opts.assembly : {};
    const moboLeft = -w / 2 + wall + 0.06;
    const moboTop = h / 2 - wall - topClear;

    let sockX = moboX - moboW * 0.05;
    let sockY = moboY + moboH * 0.17;
    let pcieY = moboY - moboH * 0.16;
    let moboSurfaceZ = moboZ + 0.016;
    let atxHeaderPos = { x: moboX + moboW * 0.44, y: moboY + moboH * 0.08, z: moboZ + 0.05 };
    let ilmHoodPivot = null;
    let ilmLeverPivot = null;
    let mountedMoboAsm = null;
    const moboScrews = [];

    const makeScrewUnit = (parentGroup, px, py, pz, rx, ry, rz, isUnscrewed) => {
      const sWrap = new T.Group();
      sWrap.position.set(px, py, pz);
      sWrap.rotation.set(rx, ry, rz);

      // Threaded bracket boss collar
      const boss = new T.Mesh(new T.CylinderGeometry(0.052, 0.056, 0.03, 16), frameMat);
      boss.rotation.x = Math.PI / 2;
      boss.position.z = -0.012;
      sWrap.add(boss);

      // Subtle glowing guide ring (highlighted during screwing step)
      const ringMat = new T.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.0, side: T.DoubleSide });
      const guideRing = new T.Mesh(new T.RingGeometry(0.062, 0.085, 24), ringMat);
      guideRing.position.z = 0.008;
      sWrap.add(guideRing);

      // Screw mesh (rotates around local Z & translates in local Z as driven flush!)
      const screwPivot = new T.Group();
      const shaft = new T.Mesh(new T.CylinderGeometry(0.022, 0.020, 0.12, 12), brushedSilverMat);
      shaft.rotation.x = Math.PI / 2;
      shaft.position.z = -0.045;
      screwPivot.add(shaft);

      const head = new T.Mesh(new T.CylinderGeometry(0.052, 0.048, 0.036, 18), brushedSilverMat);
      head.rotation.x = Math.PI / 2;
      head.position.z = 0.022;
      screwPivot.add(head);

      // Machined Phillips / hex slot on top of screw head so rotation is super visible!
      const slotMat = new T.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.5, roughness: 0.5 });
      const slotA = new T.Mesh(new T.BoxGeometry(0.064, 0.014, 0.01), slotMat);
      slotA.position.z = 0.04;
      const slotB = new T.Mesh(new T.BoxGeometry(0.014, 0.064, 0.01), slotMat);
      slotB.position.z = 0.04;
      screwPivot.add(slotA, slotB);

      sWrap.add(screwPivot);
      parentGroup.add(sWrap);

      return { wrap: sWrap, pivot: screwPivot, head, guideRing, ringMat, seated: !isUnscrewed };
    };

    const addBrassStandoffs = (mx, my, mw, mh) => {
      const brassMat = new T.MeshStandardMaterial({ color: 0xd4a439, metalness: 0.9, roughness: 0.25 });
      const pts = [
        [mx - mw * 0.44, my - mh * 0.44], [mx, my - mh * 0.44], [mx + mw * 0.44, my - mh * 0.44],
        [mx - mw * 0.44, my + mh * 0.44], [mx, my + mh * 0.44], [mx + mw * 0.44, my + mh * 0.44]
      ];
      const stGeo = new T.CylinderGeometry(0.028, 0.028, 0.052, 8);
      pts.forEach(([sx, sy]) => {
        const st = new T.Mesh(stGeo, brassMat);
        st.rotation.x = Math.PI / 2;
        st.position.set(sx, sy, (trayZ + moboZ) * 0.5);
        chassisGroup.add(st);
      });
    };

    if (cfg.motherboard && typeof window.MoboDesigner3D?.buildAssembly === 'function') {
      const moboAsm = window.MoboDesigner3D.buildAssembly(T, cfg.motherboard, {
        isSoftwareGl: isSoft,
        assembly: asmOpts,
        onAssetReady: opts.onAssetReady
      });
      if (moboAsm && moboAsm.root) {
        const actW = moboAsm.dims.w;
        const actH = moboAsm.dims.d;
        const actX = moboLeft + actW / 2;
        const actY = moboTop - actH / 2;

        addBrassStandoffs(actX, actY, actW, actH);

        moboAsm.root.rotation.x = Math.PI / 2;
        moboAsm.root.position.set(actX, actY, moboZ);
        motherboardGroup.add(moboAsm.root);

        sockX = actX + moboAsm.layout.sockWorldOffsetX;
        sockY = actY + moboAsm.layout.sockWorldOffsetY;
        pcieY = actY + moboAsm.layout.pcieWorldOffsetY;
        moboSurfaceZ = moboZ + moboAsm.layout.surfaceWorldZ;
        atxHeaderPos = {
          x: actX + moboAsm.layout.atxWorldOffsetX,
          y: actY + moboAsm.layout.atxWorldOffsetY,
          z: moboSurfaceZ + 0.05
        };
        ilmHoodPivot = moboAsm.ilmHoodPivot;
        ilmLeverPivot = moboAsm.ilmLeverPivot;
        mountedMoboAsm = moboAsm;

        // 4 corner standoff mounting screws on Motherboard PCB
        [
          [actX - actW * 0.44, actY + actH * 0.44],
          [actX + actW * 0.44, actY + actH * 0.44],
          [actX - actW * 0.44, actY - actH * 0.44],
          [actX + actW * 0.44, actY - actH * 0.44]
        ].forEach(([sx, sy]) => {
          moboScrews.push(makeScrewUnit(motherboardGroup, sx, sy, moboSurfaceZ + 0.002, 0, 0, 0, !!asmOpts.unscrewedMobo));
        });
      }
    }

    if (!mountedMoboAsm) {
      addBrassStandoffs(moboX, moboY, moboW, moboH);
      const moboMat = new T.MeshStandardMaterial({
        color: 0x161b26,
        map: textures.moboTex,
        metalness: 0.28,
        roughness: 0.54
      });
      addBox(motherboardGroup, moboW, moboH, 0.032, moboMat, moboX, moboY, moboZ);
      // Motherboard rear I/O shroud & top VRM heatsink
      addBox(motherboardGroup, 0.26, moboH * 0.42, 0.14, frameMat, moboX - moboW * 0.41, moboY + moboH * 0.25, moboZ + 0.085);
      addBox(motherboardGroup, 0.28, moboH * 0.42, 0.022, accentMat, moboX - moboW * 0.41, moboY + moboH * 0.25, moboZ + 0.158);
      addBox(motherboardGroup, moboW * 0.42, 0.18, 0.12, brushedSilverMat, moboX - moboW * 0.05, moboY + moboH * 0.42, moboZ + 0.075);
      // Chipset heatsink block & CMOS battery
      addBox(motherboardGroup, moboW * 0.24, moboH * 0.18, 0.07, frameMat, moboX + moboW * 0.30, moboY - moboH * 0.28, moboZ + 0.045);
      const cmos = new T.Mesh(new T.CylinderGeometry(0.08, 0.08, 0.025, 18), brushedSilverMat);
      cmos.rotation.x = Math.PI / 2;
      cmos.position.set(moboX - moboW * 0.18, moboY - moboH * 0.32, moboZ + 0.024);
      motherboardGroup.add(cmos);
      // M.2 NVMe Shield right above PCIe x16
      addBox(motherboardGroup, moboW * 0.36, 0.11, 0.042, darkMetalMat, moboX - moboW * 0.04, pcieY + 0.15, moboZ + 0.032);
      // Steel-reinforced PCIe x16 slot
      addBox(motherboardGroup, moboW * 0.46, 0.068, 0.09, brushedSilverMat, moboX - moboW * 0.12, pcieY, moboZ + 0.055);
      addBox(motherboardGroup, moboW * 0.42, 0.032, 0.095, darkMetalMat, moboX - moboW * 0.12, pcieY, moboZ + 0.058);
      // 4x DDR5 DIMM slots (2 for Mini-ITX)
      const ramSlots = cfg.caseSize === 'small' ? 2 : 4;
      for (let r = 0; r < ramSlots; r++) {
        const rx = moboX + moboW * 0.22 + r * 0.085;
        addBox(motherboardGroup, 0.038, Math.min(1.25, moboH * 0.40), 0.075, darkMetalMat, rx, sockY, moboZ + 0.048);
      }
      // 24-pin ATX header on right edge of mobo
      addBox(motherboardGroup, 0.065, 0.38, 0.08, darkMetalMat, atxHeaderPos.x, atxHeaderPos.y, atxHeaderPos.z);

      // Hinged LGA CPU Socket + Articulated Metal ILM Retention Bracket & Lever
      const sockPad = cfg.caseSize === 'small' ? 0.56 : 0.60;
      addBox(motherboardGroup, sockPad + 0.14, sockPad + 0.14, 0.038, darkMetalMat, sockX, sockY, moboZ + 0.028);
      addBox(motherboardGroup, sockPad * 0.96, sockPad * 0.96, 0.044, new T.MeshStandardMaterial({ color: 0x1a202c, metalness: 0.72, roughness: 0.34 }), sockX, sockY, moboZ + 0.032);

      ilmHoodPivot = new T.Group();
      const hoodH = sockPad + 0.14;
      const hoodW = sockPad + 0.12;
      const hoodBar = 0.09;
      const hoodRestZ = moboSurfaceZ + 0.068;
      ilmHoodPivot.position.set(sockX, sockY + hoodH / 2, hoodRestZ);
      addBox(ilmHoodPivot, hoodW, hoodBar, 0.024, brushedSilverMat, 0, -hoodBar / 2, 0);
      addBox(ilmHoodPivot, hoodW * 0.78, hoodBar * 0.95, 0.024, brushedSilverMat, 0, -hoodH + hoodBar / 2, 0);
      addBox(ilmHoodPivot, hoodBar, hoodH - hoodBar * 1.4, 0.024, brushedSilverMat, -hoodW / 2 + hoodBar / 2, -hoodH / 2, 0);
      addBox(ilmHoodPivot, hoodBar, hoodH - hoodBar * 1.4, 0.024, brushedSilverMat, hoodW / 2 - hoodBar / 2, -hoodH / 2, 0);
      addBox(ilmHoodPivot, 0.16, 0.055, 0.026, brushedSilverMat, 0, -hoodH - 0.015, -0.004);
      ilmHoodPivot.rotation.x = asmOpts.latchOpen ? -1.18 : 0;
      motherboardGroup.add(ilmHoodPivot);

      ilmLeverPivot = new T.Group();
      const leverX = sockX + hoodW / 2 + 0.055;
      const leverBottomY = sockY - hoodH / 2 - 0.02;
      ilmLeverPivot.position.set(leverX, leverBottomY, moboSurfaceZ + 0.038);
      const leverStem = new T.Mesh(new T.CylinderGeometry(0.016, 0.016, hoodH * 1.06, 12), brushedSilverMat);
      leverStem.position.set(0, hoodH * 0.53, 0.018);
      ilmLeverPivot.add(leverStem);
      addBox(ilmLeverPivot, 0.14, 0.032, 0.032, brushedSilverMat, -0.055, hoodH * 1.05, 0.018);
      addBox(ilmLeverPivot, 0.06, 0.075, 0.042, accentMat, 0.015, hoodH * 1.02, 0.02);
      ilmLeverPivot.rotation.x = asmOpts.latchOpen ? 1.28 : 0;
      motherboardGroup.add(ilmLeverPivot);
    }

    const cpuScale = cfg.caseSize === 'small' ? 0.24 : 0.255;

    // 8. ACTUAL 3D CPU Assembly Mounted in Socket!
    const cpuHolder = new T.Group();
    const cpuDockedPos = { x: sockX, y: sockY, z: moboSurfaceZ + 0.05 + 0.08 * cpuScale };
    cpuHolder.position.set(cpuDockedPos.x, cpuDockedPos.y, cpuDockedPos.z);
    cpuGroup.add(cpuHolder);

    const pasteAnchor = new T.Group();
    pasteAnchor.position.set(0, 0, 0.252 * cpuScale);
    cpuHolder.add(pasteAnchor);

    let mountedCpuAsm = null;
    if (cfg.cpu) {
      let mountedRealCpu = false;
      if (typeof window.CpuDesigner3D?.buildAssembly === 'function') {
        const cpuAsm = window.CpuDesigner3D.buildAssembly(T, cfg.cpu, {
          isSoftwareGl: isSoft,
          compactPins: true,
          onLogoReady: opts.onAssetReady
        });
        if (cpuAsm && cpuAsm.root) {
          cpuAsm.root.rotation.x = Math.PI / 2;
          cpuAsm.root.scale.setScalar(cpuScale);
          if (asmOpts.hideCpuCooler && cpuAsm.coolingGroup) {
            cpuAsm.coolingGroup.visible = false;
          }
          cpuHolder.add(cpuAsm.root);
          if (cpuAsm.fanRotor) {
            cpuSpinners.push({ rotor: cpuAsm.fanRotor, axis: cpuAsm.fanAxis || 'z', speed: 8.5 });
          }
          mountedCpuAsm = cpuAsm;
          mountedRealCpu = true;
        }
      }
      if (!mountedRealCpu) {
        addBox(cpuHolder, 0.42, 0.42, 0.06, brushedSilverMat, 0, 0, 0.01);
      }
    }

    // Braided 24-pin ATX power cable & GPU power cable
    const addBraidedCable = (pts, radius, hexCol) => {
      const curve = new T.CatmullRomCurve3(pts.map(([x, y, z]) => new T.Vector3(x, y, z)));
      const mat = new T.MeshStandardMaterial({ color: hexCol, roughness: 0.72, metalness: 0.15 });
      cablesGroup.add(new T.Mesh(new T.TubeGeometry(curve, 18, radius, 8, false), mat));
    };
    const cableCol = 0x181c24;
    addBraidedCable([
      [atxHeaderPos.x, atxHeaderPos.y, atxHeaderPos.z + 0.03],
      [atxHeaderPos.x + 0.14, atxHeaderPos.y, atxHeaderPos.z + 0.16],
      [grommetX + 0.04, moboY, trayZ - 0.01]
    ], 0.048, cableCol);

    // 9. ACTUAL 3D GPU Assembly Plugged Into PCIe x16 Slot at Exact Millimeter Size + 4 Bracket Screws!
    const isVerticalGpu = cfg.gpuMount === 'vertical';
    const gpuHolder = new T.Group();
    gpuGroup.add(gpuHolder);
    let mountedGpuAsm = null;
    let gpuDockedPos = { x: 0, y: pcieY, z: moboSurfaceZ + 0.4 };
    const gpuScrews = [];

    if (cfg.gpu) {
      let mountedRealGpu = false;
      if (typeof window.GpuDesigner3D?.buildAssembly === 'function') {
        const gpuAsm = window.GpuDesigner3D.buildAssembly(T, cfg.gpu, {
          isSoftwareGl: isSoft,
          invertSideDecals: !isVerticalGpu,
          onAssetReady: opts.onAssetReady
        });
        if (gpuAsm && gpuAsm.root) {
          const gDims = gpuAsm.dims;
          const realLen = clamp(Number(gDims.safeLength || cfg.gpu.length || 280), 210, 390) / 100;
          const realWid = clamp(Number(gDims.safeWidth || cfg.gpu.width || 125), 105, 165) / 100;
          const sx = realLen / gDims.w;
          const sz = realWid / gDims.d;
          const sy = (sx + sz) * 0.5;
          gpuAsm.root.scale.set(sx, sy, sz);

          const ioCenterX = -w / 2 + wall + (gDims.w * sx) / 2 + 0.045;
          if (isVerticalGpu) {
            const vertY = Math.max(shroudTopY + (gDims.d * sz) / 2 + 0.18, pcieY + 0.08);
            const vertZ = moboSurfaceZ + 0.24 + (gDims.d * sz * 0.15);
            gpuAsm.root.rotation.x = Math.PI / 2;
            gpuDockedPos = { x: ioCenterX, y: vertY, z: vertZ };
            gpuHolder.position.set(gpuDockedPos.x, gpuDockedPos.y, gpuDockedPos.z);

            addBox(gpuGroup, 0.28, 0.24, 0.36, darkMetalMat, ioCenterX - gDims.w * sx * 0.13, shroudTopY + 0.12, vertZ - 0.06);
            addBox(gpuGroup, moboW * 0.38, 0.015, 0.32, darkMetalMat, moboX - moboW * 0.12, pcieY - 0.02, (moboSurfaceZ + vertZ) * 0.5);

            // 4 mounting screws on vertical PCIe bracket + riser base
            const bracketX = -w / 2 + wall + 0.075;
            gpuScrews.push(
              makeScrewUnit(gpuGroup, bracketX, vertY + realWid * 0.30, vertZ + 0.06, 0, Math.PI * 0.34, 0, !!asmOpts.unscrewedGpu),
              makeScrewUnit(gpuGroup, bracketX, vertY - realWid * 0.30, vertZ + 0.06, 0, Math.PI * 0.34, 0, !!asmOpts.unscrewedGpu),
              makeScrewUnit(gpuGroup, ioCenterX - gDims.w * sx * 0.20, shroudTopY + 0.07, vertZ + 0.18, -0.35, 0, 0, !!asmOpts.unscrewedGpu),
              makeScrewUnit(gpuGroup, ioCenterX - gDims.w * sx * 0.05, shroudTopY + 0.07, vertZ + 0.18, -0.35, 0, 0, !!asmOpts.unscrewedGpu)
            );
          } else {
            const gpuY = pcieY;
            const gpuZ = moboSurfaceZ + 0.055 + (gDims.d * sz) * 0.485;
            gpuAsm.root.rotation.x = Math.PI;
            gpuDockedPos = { x: ioCenterX, y: gpuY, z: gpuZ };
            gpuHolder.position.set(gpuDockedPos.x, gpuDockedPos.y, gpuDockedPos.z);

            const pwrWorldX = ioCenterX + (gDims.pwrCenterX || 0) * sx;
            const pwrWorldY = gpuY - (gDims.pwrY || 0) * sy;
            const pwrWorldZ = gpuZ - (gDims.pwrZ || 0) * sz;
            addBraidedCable([
              [pwrWorldX, pwrWorldY + 0.02, pwrWorldZ + 0.02],
              [pwrWorldX + 0.05, pwrWorldY + 0.10, Math.min(glassZ - 0.12, pwrWorldZ + 0.26)],
              [pwrWorldX + 0.04, shroudTopY + 0.18, pwrWorldZ + 0.12],
              [pwrWorldX, shroudTopY - 0.02, d * 0.12]
            ], 0.036, cableCol);

            // PCIe bracket clamp bar & 4 screws right along the GPU's rear mounting flange
            const bracketX = -w / 2 + wall + 0.055;
            const frontZ = gpuZ + realWid * 0.46;
            const backZ = moboSurfaceZ + 0.16;
            addBox(gpuGroup, 0.06, 0.38, 0.10, frameMat, bracketX - 0.015, gpuY, frontZ);
            addBox(gpuGroup, 0.06, 0.38, 0.10, frameMat, bracketX - 0.015, gpuY, backZ);
            gpuScrews.push(
              makeScrewUnit(gpuGroup, bracketX + 0.025, gpuY + 0.125, frontZ, 0, Math.PI * 0.32, 0, !!asmOpts.unscrewedGpu),
              makeScrewUnit(gpuGroup, bracketX + 0.025, gpuY - 0.125, frontZ, 0, Math.PI * 0.32, 0, !!asmOpts.unscrewedGpu),
              makeScrewUnit(gpuGroup, bracketX + 0.025, gpuY + 0.125, backZ, 0, Math.PI * 0.32, 0, !!asmOpts.unscrewedGpu),
              makeScrewUnit(gpuGroup, bracketX + 0.025, gpuY - 0.125, backZ, 0, Math.PI * 0.32, 0, !!asmOpts.unscrewedGpu)
            );
          }

          gpuHolder.add(gpuAsm.root);
          mountedGpuAsm = gpuAsm;
          (gpuAsm.fanRotors || []).forEach(fr => {
            if (fr && fr.rotor) cpuSpinners.push({ rotor: fr.rotor, axis: 'y', speed: fr.speed || 2.8 });
          });
          (gpuAsm.rainbowRgbMats || []).forEach(rm => {
            if (rm && rm.mat) {
              rm.mat.userData = { rgbMode: 'rainbow', offset: rm.offset || 0 };
              rgbList.push(rm.mat);
            }
          });
          mountedRealGpu = true;
        }
      }
      if (!mountedRealGpu) {
        const realLen = clamp(Number(cfg.gpu.length || 280), 210, 390) / 100;
        const realWid = clamp(Number(cfg.gpu.width || 125), 105, 165) / 100;
        const realThick = clamp(Number(cfg.gpu.thickness || 50), 38, 76) / 100;
        const gMat = new T.MeshStandardMaterial({ color: cfg.gpu.primaryColor || '#222733', metalness: 0.45, roughness: 0.35 });
        gpuDockedPos = { x: -w / 2 + wall + realLen / 2 + 0.05, y: pcieY, z: moboSurfaceZ + 0.06 + realWid / 2 };
        gpuHolder.position.set(gpuDockedPos.x, gpuDockedPos.y, gpuDockedPos.z);
        addBox(gpuHolder, realLen, realThick, realWid, gMat, 0, 0, 0);
      }
    }

    root.add(
      chassisGroup,
      topPanelGroup,
      frontGroup,
      glassDoorGroup,
      fansGroup,
      rgbGroup,
      motherboardGroup,
      cpuGroup,
      gpuGroup,
      cablesGroup,
      airflowGroup
    );

    return {
      root,
      chassisGroup,
      topPanelGroup,
      frontGroup,
      glassDoorGroup,
      fansGroup,
      rgbGroup,
      motherboardGroup,
      moboAsm: mountedMoboAsm,
      moboScrews,
      cpuGroup,
      cpuHolder,
      cpuAsm: mountedCpuAsm,
      pasteAnchor,
      ilmHoodPivot,
      ilmLeverPivot,
      gpuGroup,
      gpuHolder,
      gpuAsm: mountedGpuAsm,
      gpuScrews,
      cablesGroup,
      airflowGroup,
      dims,
      sockPos: { x: sockX, y: sockY, z: moboSurfaceZ },
      cpuDockedPos,
      gpuDockedPos,
      isVerticalGpu,
      fanRotors: rotorsList,
      cpuFanSpinners: cpuSpinners,
      rgbMats: rgbList,
      airflowArrows: arrowsList
    };
  }

  function renderFrameNow() {
    if (!renderer || !scene || !camera || contextLost) return;
    renderer.render(scene, camera);
  }

  function stepAnimation(dt, totalSec) {
    activeFanRotors.forEach(item => {
      if (item.rotor) item.rotor.rotation.z -= dt * item.speed;
    });
    activeCpuSpinners.forEach(item => {
      if (item.rotor) item.rotor.rotation[item.axis || 'y'] -= dt * item.speed;
    });
    activeRgbMats.forEach(mat => {
      if (mat.userData?.rgbMode === 'rainbow') {
        const hue = (totalSec * 0.22 + (mat.userData.offset || 0)) % 1;
        mat.color.setHSL(hue, 0.95, 0.58);
        mat.emissive.setHSL(hue, 0.95, 0.52);
      }
    });
    activeAirflowArrows.forEach((a, idx) => {
      const pulse = Math.sin(totalSec * 4.5 + idx * 0.9) * 0.07;
      a.mesh.position.copy(a.basePos);
      if (a.mount === 'front' || a.mount === 'rear') a.mesh.position.x -= pulse;
      else a.mesh.position.y += pulse;
    });
  }

  function startLoop() {
    if (rafId || timerId) return;
    lastMs = performance.now();
    const tick = now => {
      rafId = 0;
      timerId = 0;
      if (!renderer || !scene || !camera || contextLost || !stageEl?.isConnected) return;
      const dt = Math.min(0.05, Math.max(0.001, (now - lastMs) / 1000));
      lastMs = now;
      elapsedSec += dt;

      if (camAnimActive && controls) {
        camera.position.x += (camTargetPos.x - camera.position.x) * Math.min(1, dt * 8);
        camera.position.y += (camTargetPos.y - camera.position.y) * Math.min(1, dt * 8);
        camera.position.z += (camTargetPos.z - camera.position.z) * Math.min(1, dt * 8);
        controls.target.x += (camTargetLook.x - controls.target.x) * Math.min(1, dt * 8);
        controls.target.y += (camTargetLook.y - controls.target.y) * Math.min(1, dt * 8);
        controls.target.z += (camTargetLook.z - controls.target.z) * Math.min(1, dt * 8);
        if (Math.hypot(camera.position.x - camTargetPos.x, camera.position.y - camTargetPos.y, camera.position.z - camTargetPos.z) < 0.02) {
          camAnimActive = false;
        }
      }

      controls?.update();
      stepAnimation(dt, elapsedSec);
      renderer.render(scene, camera);

      if (isSoftwareGl) {
        timerId = window.setTimeout(() => { rafId = requestAnimationFrame(tick); }, 90);
      } else {
        rafId = requestAnimationFrame(tick);
      }
    };
    rafId = requestAnimationFrame(tick);
  }

  function stopLoop() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    if (timerId) { clearTimeout(timerId); timerId = 0; }
  }

  function setCameraPreset(preset, snapImmediate = false) {
    const s = getChassisDimensions(state.caseSize).camScale;
    if (preset === 'interior') {
      Object.assign(camTargetPos, { x: 0.45 * s, y: 0.45 * s, z: 6.45 * s });
      Object.assign(camTargetLook, { x: -0.15 * s, y: 0.1 * s, z: 0 });
    } else if (preset === 'front') {
      Object.assign(camTargetPos, { x: 6.4 * s, y: 0.6 * s, z: 1.85 * s });
      Object.assign(camTargetLook, { x: 0, y: 0.05, z: 0 });
    } else if (preset === 'rear') {
      Object.assign(camTargetPos, { x: -6.4 * s, y: 0.6 * s, z: 1.75 * s });
      Object.assign(camTargetLook, { x: 0, y: 0.05, z: 0 });
    } else if (preset === 'top') {
      Object.assign(camTargetPos, { x: 0.25 * s, y: 6.8 * s, z: 2.35 * s });
      Object.assign(camTargetLook, { x: 0, y: 0.05, z: 0 });
    } else {
      Object.assign(camTargetPos, { x: 4.9 * s, y: 2.9 * s, z: 5.5 * s });
      Object.assign(camTargetLook, { x: 0, y: 0.06, z: 0 });
    }
    if (snapImmediate && camera && controls) {
      camera.position.set(camTargetPos.x, camTargetPos.y, camTargetPos.z);
      controls.target.set(camTargetLook.x, camTargetLook.y, camTargetLook.z);
      controls.update();
      camAnimActive = false;
    } else {
      camAnimActive = true;
    }
  }

  function rebuildMainScene() {
    if (!pcRoot || !assemblyContainer || !THREE) return;
    clearGroup(assemblyContainer);
    activeFanRotors = [];
    activeCpuSpinners = [];
    activeRgbMats = [];
    activeAirflowArrows = [];

    const asm = buildStandalonePcAssembly(THREE, state, {
      isSoftwareGl,
      onAssetReady: () => rebuildMainScene()
    });
    if (asm && asm.root) {
      assemblyContainer.add(asm.root);
      activeFanRotors = asm.fanRotors || [];
      activeCpuSpinners = asm.cpuFanSpinners || [];
      activeRgbMats = asm.rgbMats || [];
      activeAirflowArrows = asm.airflowArrows || [];
    }
    renderFrameNow();
  }

  function resizeRenderer() {
    if (!renderer || !camera || !stageEl) return;
    const w = Math.max(240, stageEl.clientWidth || 520);
    const h = Math.max(240, stageEl.clientHeight || 420);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    renderFrameNow();
  }

  function buildDock() {
    if (!stageEl || dockEl) return;
    dockEl = document.createElement('div');
    dockEl.className = 'gpu-3d-dock pc-3d-dock';
    dockEl.innerHTML =
      '<div class="gpu-3d-pills">' +
        '<button type="button" data-pc-cam="iso" class="active">3/4 View</button>' +
        '<button type="button" data-pc-cam="interior">Interior</button>' +
        '<button type="button" data-pc-cam="front">Front</button>' +
        '<button type="button" data-pc-cam="rear">Rear</button>' +
        '<button type="button" data-pc-cam="top">Top</button>' +
      '</div>' +
      '<div class="gpu-3d-actions">' +
        '<button type="button" data-pc-panel class="' + (state.openPanel ? 'active' : '') + '">Open Glass</button>' +
        '<button type="button" data-pc-airflow class="' + (state.showAirflow ? 'active' : '') + '">Airflow</button>' +
      '</div>';
    stageEl.appendChild(dockEl);

    dockEl.querySelectorAll('[data-pc-cam]').forEach(btn => btn.addEventListener('click', () => {
      dockEl.querySelectorAll('[data-pc-cam]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setCameraPreset(btn.dataset.pcCam);
    }));
    dockEl.querySelector('[data-pc-panel]')?.addEventListener('click', btn => {
      state.openPanel = !state.openPanel;
      btn.currentTarget.classList.toggle('active', state.openPanel);
      rebuildMainScene();
    });
    dockEl.querySelector('[data-pc-airflow]')?.addEventListener('click', btn => {
      state.showAirflow = !state.showAirflow;
      btn.currentTarget.classList.toggle('active', state.showAirflow);
      rebuildMainScene();
    });
  }

  async function mount(el) {
    if (!el) return;
    if (stageEl === el && renderer && renderer.domElement?.parentElement === mountEl) {
      resizeRenderer();
      startLoop();
      return;
    }
    if (renderer && mountEl && !contextLost) {
      stageEl = el;
      el.innerHTML = '';
      el.appendChild(mountEl);
      if (dockEl) el.appendChild(dockEl);
      else buildDock();
      if (resizeObserver) resizeObserver.disconnect();
      resizeObserver = new ResizeObserver(() => resizeRenderer());
      resizeObserver.observe(el);
      resizeRenderer();
      rebuildMainScene();
      setCameraPreset('iso', true);
      startLoop();
      return;
    }
    stageEl = el;
    const ok = await ensureThree();
    if (!ok) {
      el.innerHTML = '<div class="gpu-3d-error">3D preview unavailable in this browser.</div>';
      return;
    }

    isSoftwareGl = detectSoftwareWebGL();
    el.innerHTML = '';
    mountEl = document.createElement('div');
    mountEl.className = 'ea-chip-canvas-mount';
    el.appendChild(mountEl);

    renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      alpha: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    mountEl.appendChild(renderer.domElement);

    renderer.domElement.addEventListener('webglcontextlost', e => {
      e.preventDefault();
      contextLost = true;
      stopLoop();
    });
    renderer.domElement.addEventListener('webglcontextrestored', () => {
      contextLost = false;
      startLoop();
    });

    scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTexture;
    scene.environmentIntensity = 1.05;
    pmrem.dispose();

    scene.add(new THREE.HemisphereLight(0xe4ecff, 0x161424, 1.15));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(7.5, 10.5, 9.5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xa855f7, 0.85);
    rim.position.set(-8.5, 5.2, -6.5);
    scene.add(rim);

    camera = new THREE.PerspectiveCamera(40, 1.3, 0.1, 80);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.08;
    controls.minDistance = 2.4;
    controls.maxDistance = 18.0;
    controls.addEventListener('start', () => { camAnimActive = false; });

    pcRoot = new THREE.Group();
    assemblyContainer = new THREE.Group();
    pcRoot.add(assemblyContainer);
    scene.add(pcRoot);

    dockEl = null;
    buildDock();
    setCameraPreset('iso', true);

    if (resizeObserver) resizeObserver.disconnect();
    resizeObserver = new ResizeObserver(() => resizeRenderer());
    resizeObserver.observe(el);

    resizeRenderer();
    rebuildMainScene();
    startLoop();
  }

  function update(nextCfg) {
    if (!nextCfg) return;
    const prevSize = state.caseSize;
    const merged = {
      ...DEFAULT_CONFIG,
      ...nextCfg,
      fans: Array.isArray(nextCfg.fans) ? nextCfg.fans.map(f => ({ ...f })) : []
    };
    const sig = JSON.stringify({
      mode: merged.mode,
      caseSize: merged.caseSize,
      material: merged.material,
      frontStyle: merged.frontStyle,
      primaryColor: merged.primaryColor,
      accentColor: merged.accentColor,
      rgbEnabled: merged.rgbEnabled,
      rgbMode: merged.rgbMode,
      rgbColor: merged.rgbColor,
      openPanel: merged.openPanel,
      showAirflow: merged.showAirflow,
      gpuMount: merged.gpuMount,
      fans: merged.fans,
      motherboard: merged.motherboard || null,
      cpu: merged.cpu || null,
      gpu: merged.gpu || null
    });
    state = merged;
    if (sig !== lastStructSig) {
      lastStructSig = sig;
      if (prevSize !== merged.caseSize) {
        setCameraPreset('iso', false);
      }
      rebuildMainScene();
    }
  }

  function captureSnapshot(opts = {}) {
    if (!renderer || !scene || !camera || contextLost) return '';
    const prevW = renderer.domElement.width;
    const prevH = renderer.domElement.height;
    const w = opts.width || 360;
    const h = opts.height || 270;
    try {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL('image/webp', 0.86);
    } catch (_) {
      return '';
    } finally {
      if (stageEl && prevW && prevH) {
        resizeRenderer();
      }
    }
  }

  async function ensureOffscreen(width, height) {
    if (offscreenPromise) return offscreenPromise;
    offscreenPromise = (async () => {
      const ok = await ensureThree();
      if (!ok) return null;
      const offRenderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true
      });
      offRenderer.outputColorSpace = THREE.SRGBColorSpace;
      offRenderer.toneMapping = THREE.ACESFilmicToneMapping;
      offRenderer.toneMappingExposure = 1.15;
      offRenderer.setPixelRatio(1);
      offRenderer.setSize(width, height, false);

      const offScene = new THREE.Scene();
      const pmrem = new THREE.PMREMGenerator(offRenderer);
      offScene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      offScene.environmentIntensity = 1.05;
      pmrem.dispose();

      offScene.add(new THREE.HemisphereLight(0xe4ecff, 0x161424, 1.15));
      const key = new THREE.DirectionalLight(0xffffff, 1.5);
      key.position.set(7.5, 10.5, 9.5);
      offScene.add(key);

      const offCam = new THREE.PerspectiveCamera(40, width / height, 0.1, 80);
      const offContainer = new THREE.Group();
      offScene.add(offContainer);
      return { offRenderer, offScene, offCam, offContainer };
    })();
    return offscreenPromise;
  }

  async function captureHeroSnapshot(cfg, width = 360, height = 270) {
    const ctx = await ensureOffscreen(width, height);
    if (!ctx) return '';
    const { offRenderer, offScene, offCam, offContainer } = ctx;
    clearGroup(offContainer);
    const merged = { ...DEFAULT_CONFIG, ...(cfg || {}), openPanel: cfg?.openPanel ?? true, showAirflow: false };
    const asm = buildStandalonePcAssembly(THREE, merged, { isSoftwareGl: false });
    if (asm && asm.root) offContainer.add(asm.root);

    const s = getChassisDimensions(merged.caseSize).camScale;
    offCam.aspect = width / height;
    offCam.position.set(4.85 * s, 2.85 * s, 5.45 * s);
    offCam.lookAt(0, 0.06, 0);
    offCam.updateProjectionMatrix();
    offRenderer.setSize(width, height, false);
    offRenderer.render(offScene, offCam);
    try {
      return offRenderer.domElement.toDataURL('image/webp', 0.86);
    } catch (_) {
      return '';
    }
  }

  function processThumbQueue() {
    if (thumbQueueBusy || !pcThumbQueue.length) return;
    thumbQueueBusy = true;
    const job = pcThumbQueue.shift();
    captureHeroSnapshot(job.cfg, job.width, job.height)
      .then(url => job.cb(url))
      .catch(() => job.cb(''))
      .finally(() => {
        thumbQueueBusy = false;
        if (pcThumbQueue.length) setTimeout(processThumbQueue, 24);
      });
  }

  function enqueueThumbnail(cfg, cb, width = 360, height = 270) {
    pcThumbQueue.push({ cfg, cb, width, height });
    processThumbQueue();
  }

  function resize() {
    resizeRenderer();
  }

  window.PcDesigner3D = {
    buildAssembly: buildStandalonePcAssembly,
    getChassisDimensions,
    mount,
    update,
    resize,
    captureSnapshot,
    captureHeroSnapshot,
    enqueueThumbnail
  };
})();
