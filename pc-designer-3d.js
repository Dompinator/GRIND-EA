/* ============================================================
 * GRIND-EA · Procedural 3D PC Case & Full PC CAD Designer (Three.js PBR)
 * Small / Medium / Large Chassis · Tempered Glass · Placeable Fans · RGB
 * Live Installed CPU + GPU Assembly & Offscreen Product Thumbnails
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
    fans: [],            // [{ id, fanType: 'pc_small_fans'|'pc_medium_fans'|'pc_smart_fans', mount: 'front'|'top'|'rear'|'bottom', position: 0..1, bladeColor: 'dark'|'white'|'accent', rgbRing: false }]
    cpu: null,           // { name, companyName, cores, threads, cooling, body, vCache }
    gpu: null            // { name, companyName, length, width, thickness, primaryColor, accentColor, body, fanCount, rgb }
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
  let chassisGroup = null;
  let frontGroup = null;
  let glassDoorGroup = null;
  let fansGroup = null;
  let rgbGroup = null;
  let hardwareGroup = null;
  let airflowGroup = null;

  let offscreenHostEl = null;
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
  const camTargetPos = { x: 2.35, y: 1.55, z: 2.55 };
  const camTargetLook = { x: 0, y: 0.05, z: 0 };

  const fanRotors = [];
  const rgbMats = [];
  const airflowArrows = [];
  const texCache = new Map();

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

  function getMeshTexture() {
    const key = 'mesh_perforated_v1';
    if (texCache.has(key)) return texCache.get(key);
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#151924';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#05070c';
    for (let y = 8; y < 128; y += 16) {
      const off = (y / 16) % 2 === 0 ? 0 : 8;
      for (let x = 4; x < 128; x += 16) {
        ctx.beginPath();
        ctx.arc((x + off) % 128, y, 4.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 5);
    texCache.set(key, tex);
    return tex;
  }

  function getPcbBoardTexture() {
    const key = 'pc_mobo_tex_v1';
    if (texCache.has(key)) return texCache.get(key);
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#12151f';
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = 'rgba(148,163,184,0.12)';
    ctx.lineWidth = 1.5;
    for (let i = 16; i < 240; i += 14) {
      ctx.beginPath();
      ctx.moveTo(16, i);
      ctx.lineTo(240, i);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(168,85,247,0.22)';
    ctx.lineWidth = 2;
    ctx.strokeRect(10, 10, 236, 236);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    texCache.set(key, tex);
    return tex;
  }

  function getChassisDimensions(caseSize) {
    if (caseSize === 'large') return { w: 1.52, h: 1.56, d: 0.72, wall: 0.04 };
    if (caseSize === 'medium') return { w: 1.28, h: 1.32, d: 0.62, wall: 0.036 };
    return { w: 1.04, h: 1.04, d: 0.52, wall: 0.032 };
  }

  function addBox(parent, w, h, d, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    if (rx || ry || rz) m.rotation.set(rx, ry, rz);
    parent.add(m);
    return m;
  }

  function buildChassis(cfg, targetGroups) {
    const {
      chassisG, frontG, glassG, fansG, rgbG, hwG, airG,
      rotorsList, rgbList, arrowsList
    } = targetGroups;

    clearGroup(chassisG);
    clearGroup(frontG);
    clearGroup(glassG);
    clearGroup(fansG);
    clearGroup(rgbG);
    clearGroup(hwG);
    clearGroup(airG);

    const dims = getChassisDimensions(cfg.caseSize);
    const { w, h, d, wall } = dims;

    const primCol = new THREE.Color(cfg.primaryColor || '#1a1f2b');
    const accCol = new THREE.Color(cfg.accentColor || '#a855f7');
    const isAlum = cfg.material === 'aluminum';
    const isShowcase = cfg.material === 'glass_showcase';

    const shellMat = new THREE.MeshStandardMaterial({
      color: primCol,
      metalness: isAlum ? 0.78 : 0.35,
      roughness: isAlum ? 0.28 : 0.56
    });
    const frameMat = new THREE.MeshStandardMaterial({
      color: primCol.clone().multiplyScalar(0.72),
      metalness: 0.55,
      roughness: 0.42
    });
    const darkMetalMat = new THREE.MeshStandardMaterial({
      color: 0x0f1219,
      metalness: 0.6,
      roughness: 0.45
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: accCol,
      metalness: 0.65,
      roughness: 0.25
    });
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xa5b4fc,
      metalness: 0.05,
      roughness: 0.08,
      transparent: true,
      opacity: isSoftwareGl ? 0.24 : 0.22,
      transmission: isSoftwareGl ? 0 : 0.62,
      ior: 1.5,
      depthWrite: false
    });

    // Bottom base + 4 machined case feet
    addBox(chassisG, w, wall, d, shellMat, 0, -h / 2 + wall / 2, 0);
    const footY = -h / 2 - 0.032;
    const fx = w * 0.41;
    const fz = d * 0.37;
    [[-fx, -fz], [fx, -fz], [-fx, fz], [fx, fz]].forEach(([x, z]) => {
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.062, 0.064, 16), frameMat);
      foot.position.set(x, footY, z);
      chassisG.add(foot);
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.012, 16), accentMat);
      ring.position.set(x, footY + 0.022, z);
      chassisG.add(ring);
    });

    // Top panel with ventilated magnetic dust filter & top I/O buttons
    addBox(chassisG, w, wall, d, shellMat, 0, h / 2 - wall / 2, 0);
    const topFilterMat = new THREE.MeshStandardMaterial({
      color: 0x222736,
      map: getMeshTexture(),
      metalness: 0.35,
      roughness: 0.65
    });
    addBox(chassisG, w * 0.68, 0.008, d * 0.66, topFilterMat, -w * 0.06, h / 2 + 0.002, 0);
    // Power button + USB-C + USB-A front-top header
    addBox(chassisG, 0.16, 0.012, 0.07, frameMat, w * 0.34, h / 2 + 0.003, d * 0.28);
    const pwrBtn = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.014, 14), accentMat);
    pwrBtn.position.set(w * 0.38, h / 2 + 0.006, d * 0.28);
    chassisG.add(pwrBtn);

    // Rear panel (left side = -w/2) with I/O shield cutout, PCIe brackets & exhaust grille
    addBox(chassisG, wall, h - wall * 2, d, shellMat, -w / 2 + wall / 2, 0, 0);
    addBox(chassisG, 0.012, h * 0.28, d * 0.28, darkMetalMat, -w / 2 - 0.003, h * 0.16, -d * 0.24);
    const pcieSlots = cfg.caseSize === 'large' ? 8 : cfg.caseSize === 'medium' ? 7 : 4;
    for (let i = 0; i < pcieSlots; i++) {
      const sy = -h * 0.04 - i * 0.042;
      if (sy < -h * 0.34) break;
      addBox(chassisG, 0.012, 0.024, d * 0.42, frameMat, -w / 2 - 0.003, sy, -d * 0.04);
    }

    // Back wall (motherboard spine on -z side)
    addBox(chassisG, w - wall * 2, h - wall * 2, wall * 0.85, frameMat, 0, 0, -d / 2 + wall * 0.42);
    // Raised motherboard tray with cable routing grommets
    addBox(chassisG, w * 0.72, h * 0.72, 0.014, darkMetalMat, -w * 0.08, h * 0.06, -d / 2 + wall + 0.015);
    addBox(chassisG, 0.055, h * 0.42, 0.018, accentMat, w * 0.23, h * 0.06, -d / 2 + wall + 0.016);

    // PSU shroud bay at bottom-left
    const shroudH = h * 0.22;
    const shroudW = w * 0.78;
    addBox(chassisG, shroudW, 0.022, d - wall * 2, frameMat, -w / 2 + wall + shroudW / 2, -h / 2 + wall + shroudH, 0);
    addBox(chassisG, 0.022, shroudH, d - wall * 2, frameMat, -w / 2 + wall + shroudW, -h / 2 + wall + shroudH / 2, 0);
    // Visible PSU unit inside shroud window
    addBox(chassisG, w * 0.34, shroudH * 0.76, d * 0.68, darkMetalMat, -w * 0.28, -h / 2 + wall + shroudH * 0.46, 0);
    addBox(chassisG, 0.18, shroudH * 0.28, 0.012, accentMat, -w * 0.28, -h / 2 + wall + shroudH * 0.48, d * 0.36);

    // Front Panel (right side = +w/2)
    const frontX = w / 2 - wall / 2;
    if (cfg.frontStyle === 'glass' || isShowcase) {
      addBox(frontG, wall * 0.6, h, 0.045, frameMat, frontX, 0, -d / 2 + 0.022);
      addBox(frontG, wall * 0.6, h, 0.045, frameMat, frontX, 0, d / 2 - 0.022);
      addBox(frontG, wall * 0.6, 0.05, d, frameMat, frontX, h / 2 - 0.025, 0);
      addBox(frontG, wall * 0.6, 0.05, d, frameMat, frontX, -h / 2 + 0.025, 0);
      addBox(frontG, 0.014, h - 0.09, d - 0.08, glassMat, frontX + 0.008, 0, 0);
    } else if (cfg.frontStyle === 'solid') {
      addBox(frontG, wall, h - wall * 1.4, d - 0.01, shellMat, frontX, 0, 0);
      addBox(frontG, 0.012, h * 0.72, 0.028, accentMat, frontX + wall * 0.45, 0, d * 0.36);
    } else {
      // Mesh airflow front bezel
      addBox(frontG, wall * 0.75, h, 0.04, frameMat, frontX, 0, -d / 2 + 0.02);
      addBox(frontG, wall * 0.75, h, 0.04, frameMat, frontX, 0, d / 2 - 0.02);
      addBox(frontG, wall * 0.75, 0.045, d, frameMat, frontX, h / 2 - 0.022, 0);
      addBox(frontG, wall * 0.75, 0.045, d, frameMat, frontX, -h / 2 + 0.022, 0);
      const meshMat = new THREE.MeshStandardMaterial({
        color: primCol.clone().multiplyScalar(0.85),
        map: getMeshTexture(),
        metalness: 0.42,
        roughness: 0.52
      });
      addBox(frontG, 0.014, h - 0.08, d - 0.075, meshMat, frontX + 0.006, 0, 0);
    }

    // Tempered Glass Side Panel (+z side)
    const panelZ = d / 2 - 0.012;
    glassG.position.set(-w / 2 + wall, 0, panelZ);
    glassG.rotation.y = cfg.openPanel ? -0.92 : 0;
    const panelCenterX = (w - wall) / 2;
    addBox(glassG, w - wall * 1.1, h - wall * 1.1, 0.014, glassMat, panelCenterX, 0, 0);
    // Steel edge trim + thumbscrews on glass panel
    addBox(glassG, 0.032, h - wall * 1.1, 0.018, frameMat, 0.016, 0, 0);
    addBox(glassG, 0.028, h - wall * 1.1, 0.018, frameMat, w - wall * 1.25, 0, 0);
    [[-h * 0.38], [h * 0.38]].forEach(([sy]) => {
      const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.028, 12), accentMat);
      screw.rotation.x = Math.PI / 2;
      screw.position.set(w - wall * 1.5, sy, 0.006);
      glassG.add(screw);
    });

    // Optional Case RGB Lighting Strips (requires pc_rgb_case)
    if (cfg.rgbEnabled) {
      const baseRgbCol = new THREE.Color(cfg.rgbColor || cfg.accentColor || '#a855f7');
      const rgbMat = new THREE.MeshStandardMaterial({
        color: baseRgbCol,
        emissive: baseRgbCol,
        emissiveIntensity: 2.1,
        roughness: 0.2,
        metalness: 0.1
      });
      rgbMat.userData = { rgbMode: cfg.rgbMode || 'solid', baseColor: baseRgbCol.clone() };
      rgbList.push(rgbMat);

      // Front vertical lightbar, interior shroud lightbar, and top edge accent bar
      addBox(rgbG, 0.016, h * 0.84, 0.022, rgbMat, w / 2 - 0.008, 0, d / 2 - 0.05);
      addBox(rgbG, shroudW * 0.92, 0.018, 0.018, rgbMat, -w / 2 + wall + shroudW / 2, -h / 2 + wall + shroudH + 0.012, d * 0.36);
      addBox(rgbG, w * 0.78, 0.015, 0.015, rgbMat, 0, h / 2 - wall - 0.012, d * 0.32);
    }

    // Placeable Case Fans
    const fans = Array.isArray(cfg.fans) ? cfg.fans : [];
    fans.forEach((fan, idx) => {
      const fanGrp = new THREE.Group();
      const radius = fan.fanType === 'pc_smart_fans'
        ? (cfg.caseSize === 'small' ? 0.145 : 0.165)
        : fan.fanType === 'pc_medium_fans'
          ? (cfg.caseSize === 'small' ? 0.125 : 0.14)
          : 0.105;

      const frameOuter = radius + 0.016;
      const housingMat = new THREE.MeshStandardMaterial({ color: 0x161922, metalness: 0.45, roughness: 0.42 });
      const bladeHex = fan.bladeColor === 'white' ? '#eef2f6' : fan.bladeColor === 'accent' ? (cfg.accentColor || '#a855f7') : '#232836';
      const bladeMat = new THREE.MeshStandardMaterial({ color: bladeHex, metalness: 0.35, roughness: 0.38 });

      // Square-ish outer shroud frame (4 bars around rotor)
      const barThick = 0.024;
      const span = frameOuter * 2;
      addBox(fanGrp, span, barThick, 0.036, housingMat, 0, frameOuter - barThick / 2, 0);
      addBox(fanGrp, span, barThick, 0.036, housingMat, 0, -frameOuter + barThick / 2, 0);
      addBox(fanGrp, barThick, span - barThick * 2, 0.036, housingMat, -frameOuter + barThick / 2, 0, 0);
      addBox(fanGrp, barThick, span - barThick * 2, 0.036, housingMat, frameOuter - barThick / 2, 0, 0);

      // Rotating fan hub + curved angled blades
      const rotor = new THREE.Group();
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.28, radius * 0.28, 0.026, 16), frameMat);
      hub.rotation.x = Math.PI / 2;
      rotor.add(hub);
      const bladeCount = fan.fanType === 'pc_smart_fans' ? 9 : fan.fanType === 'pc_medium_fans' ? 7 : 5;
      for (let b = 0; b < bladeCount; b++) {
        const angle = (b / bladeCount) * Math.PI * 2;
        const bPivot = new THREE.Group();
        bPivot.rotation.z = angle;
        const blade = new THREE.Mesh(new THREE.BoxGeometry(radius * 0.64, radius * 0.22, 0.008), bladeMat);
        blade.position.x = radius * 0.56;
        blade.rotation.x = 0.46;
        bPivot.add(blade);
        rotor.add(bPivot);
      }
      fanGrp.add(rotor);
      const speedMult = fan.fanType === 'pc_smart_fans' ? 9.5 : fan.fanType === 'pc_medium_fans' ? 6.5 : 4.2;
      rotorsList.push({ rotor, speed: speedMult + (idx % 3) * 0.4 });

      // RGB Halo Ring if RGB Case unlocked and enabled on fan
      if (fan.rgbRing && cfg.rgbEnabled) {
        const ringCol = new THREE.Color(cfg.rgbColor || cfg.accentColor || '#a855f7');
        const ringMat = new THREE.MeshStandardMaterial({
          color: ringCol,
          emissive: ringCol,
          emissiveIntensity: 2.0,
          roughness: 0.2
        });
        ringMat.userData = { rgbMode: cfg.rgbMode || 'solid', baseColor: ringCol.clone() };
        rgbList.push(ringMat);
        const halo = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.96, 0.011, 10, 28), ringMat);
        halo.position.z = 0.016;
        fanGrp.add(halo);
      }

      // Position & orient on chosen chassis mount
      const posT = clamp(Number(fan.position ?? 0.5), 0.12, 0.88);
      const mount = fan.mount || 'front';
      if (mount === 'front') {
        const minY = -h / 2 + wall + frameOuter + 0.05;
        const maxY = h / 2 - wall - frameOuter - 0.05;
        fanGrp.position.set(w / 2 - wall - 0.036, minY + posT * Math.max(0.05, maxY - minY), 0);
        fanGrp.rotation.y = Math.PI / 2;
      } else if (mount === 'rear') {
        const minY = -h * 0.05;
        const maxY = h / 2 - wall - frameOuter - 0.05;
        fanGrp.position.set(-w / 2 + wall + 0.036, minY + posT * Math.max(0.02, maxY - minY), 0);
        fanGrp.rotation.y = -Math.PI / 2;
      } else if (mount === 'top') {
        const minX = -w / 2 + wall + frameOuter + 0.08;
        const maxX = w / 2 - wall - frameOuter - 0.08;
        fanGrp.position.set(minX + posT * Math.max(0.05, maxX - minX), h / 2 - wall - 0.036, 0);
        fanGrp.rotation.x = Math.PI / 2;
      } else {
        // bottom shroud / lower intake
        const minX = -w * 0.1;
        const maxX = w / 2 - wall - frameOuter - 0.06;
        fanGrp.position.set(minX + posT * Math.max(0.05, maxX - minX), -h / 2 + wall + shroudH + 0.034, 0);
        fanGrp.rotation.x = -Math.PI / 2;
      }
      fansG.add(fanGrp);

      // Optional airflow stream indicator arrow
      if (cfg.showAirflow) {
        const isIntake = mount === 'front' || mount === 'bottom';
        const arrowCol = isIntake ? 0x38bdf8 : 0xf97316;
        const arrowMat = new THREE.MeshStandardMaterial({
          color: arrowCol,
          emissive: arrowCol,
          emissiveIntensity: 1.4,
          transparent: true,
          opacity: 0.86
        });
        const stream = new THREE.Group();
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 10), arrowMat);
        shaft.rotation.z = Math.PI / 2;
        const head = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.06, 12), arrowMat);
        head.rotation.z = -Math.PI / 2;
        head.position.x = 0.095;
        stream.add(shaft, head);
        stream.position.copy(fanGrp.position);
        if (mount === 'front') stream.rotation.y = Math.PI; // points left (into case)
        else if (mount === 'rear') stream.rotation.y = Math.PI; // points left (out back)
        else if (mount === 'top') stream.rotation.z = Math.PI / 2; // points up (exhaust)
        else stream.rotation.z = Math.PI / 2; // points up (intake)
        arrowsList.push({ mesh: stream, basePos: stream.position.clone(), mount });
        airG.add(stream);
      }
    });

    // Motherboard + Installed CPU & GPU inside PC Build mode (and clean tray preview in Case mode)
    const moboZ = -d / 2 + wall + 0.032;
    const moboW = cfg.caseSize === 'small' ? w * 0.56 : w * 0.54;
    const moboH = cfg.caseSize === 'small' ? h * 0.58 : h * 0.62;
    const moboX = -w * 0.12;
    const moboY = h * 0.09;
    const moboMat = new THREE.MeshStandardMaterial({
      color: 0x171c29,
      map: getPcbBoardTexture(),
      metalness: 0.25,
      roughness: 0.58
    });
    addBox(hwG, moboW, moboH, 0.022, moboMat, moboX, moboY, moboZ);
    // VRM heatsinks & PCIe x16 slot
    addBox(hwG, 0.055, moboH * 0.44, 0.048, frameMat, moboX - moboW * 0.36, moboY + moboH * 0.2, moboZ + 0.03);
    addBox(hwG, moboW * 0.42, 0.048, 0.042, frameMat, moboX - moboW * 0.05, moboY + moboH * 0.42, moboZ + 0.03);
    const silverSlotMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.85, roughness: 0.22 });
    addBox(hwG, moboW * 0.56, 0.022, 0.032, silverSlotMat, moboX - moboW * 0.04, moboY - moboH * 0.18, moboZ + 0.022);
    // Empty RAM slots (future RAM companies)
    for (let r = 0; r < 4; r++) {
      addBox(hwG, 0.012, moboH * 0.34, 0.02, darkMetalMat, moboX + moboW * 0.2 + r * 0.024, moboY + moboH * 0.18, moboZ + 0.018);
    }

    // CPU Socket + CPU / Cooler
    const sockX = moboX - moboW * 0.04;
    const sockY = moboY + moboH * 0.18;
    addBox(hwG, 0.17, 0.17, 0.022, frameMat, sockX, sockY, moboZ + 0.018);
    if (cfg.cpu) {
      const ihsCol = cfg.cpu.body === 'titanium' ? 0xe2e8f0 : cfg.cpu.body === 'carbon' ? 0x334155 : cfg.cpu.body === 'silicon' ? 0x64748b : 0x94a3b8;
      const cpuMat = new THREE.MeshStandardMaterial({ color: ihsCol, metalness: 0.72, roughness: 0.28 });
      addBox(hwG, 0.135, 0.135, 0.026, cpuMat, sockX, sockY, moboZ + 0.034);
      // Scale CPU cooler block with CPU cooling spec
      const coolLvl = Number(cfg.cpu.cooling || 0);
      if (coolLvl >= 3) {
        // Liquid / Vapor-chamber pump block + braided tubes
        const pump = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.08, 0.085, 20), accentMat);
        pump.rotation.x = Math.PI / 2;
        pump.position.set(sockX, sockY, moboZ + 0.085);
        hwG.add(pump);
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.056, 0.016, 20), darkMetalMat);
        cap.rotation.x = Math.PI / 2;
        cap.position.set(sockX, sockY, moboZ + 0.128);
        hwG.add(cap);
      } else if (coolLvl >= 1) {
        // Tower air heatsink
        addBox(hwG, 0.145, 0.155, 0.12, silverSlotMat, sockX, sockY, moboZ + 0.105);
        addBox(hwG, 0.15, 0.16, 0.018, darkMetalMat, sockX, sockY, moboZ + 0.165);
      } else {
        // Compact low-profile cooler
        const lp = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.078, 0.052, 18), silverSlotMat);
        lp.rotation.x = Math.PI / 2;
        lp.position.set(sockX, sockY, moboZ + 0.068);
        hwG.add(lp);
      }
    }

    // Installed GPU inside PCIe slot
    if (cfg.gpu) {
      const lenMm = clamp(Number(cfg.gpu.length || 280), 210, 360);
      const thickMm = clamp(Number(cfg.gpu.thickness || 50), 38, 76);
      const gpuLen = Math.min(w * 0.72, 0.36 + ((lenMm - 210) / 150) * (w * 0.24));
      const gpuThick = 0.065 + ((thickMm - 38) / 38) * 0.055;
      const gpuDepth = Math.min(d * 0.56, 0.24);
      const gpuY = moboY - moboH * 0.18;
      const gpuX = -w / 2 + wall + gpuLen / 2 + 0.025;
      const gpuZ = moboZ + 0.032 + gpuDepth / 2;

      const gPrim = new THREE.MeshStandardMaterial({
        color: new THREE.Color(cfg.gpu.primaryColor || '#222733'),
        metalness: cfg.gpu.body === 'carbon' ? 0.3 : cfg.gpu.body === 'metallic' ? 0.8 : 0.25,
        roughness: cfg.gpu.body === 'metallic' ? 0.26 : 0.48
      });
      const gAcc = new THREE.MeshStandardMaterial({
        color: new THREE.Color(cfg.gpu.accentColor || '#a855f7'),
        metalness: 0.65,
        roughness: 0.25
      });

      addBox(hwG, gpuLen, gpuThick, gpuDepth, gPrim, gpuX, gpuY, gpuZ);
      // Backplate on top side of horizontal GPU
      addBox(hwG, gpuLen * 0.98, 0.012, gpuDepth * 0.98, darkMetalMat, gpuX, gpuY + gpuThick / 2 + 0.006, gpuZ);
      // Side accent trim & power connector
      addBox(hwG, gpuLen * 0.72, 0.018, 0.014, gAcc, gpuX, gpuY, gpuZ + gpuDepth / 2 + 0.005);
      addBox(hwG, 0.055, 0.026, 0.042, darkMetalMat, gpuX + gpuLen * 0.28, gpuY + gpuThick * 0.35, gpuZ + gpuDepth * 0.26);

      if (cfg.gpu.rgb) {
        const gRgbCol = new THREE.Color(cfg.gpu.accentColor || '#a855f7');
        const gRgbMat = new THREE.MeshStandardMaterial({
          color: gRgbCol,
          emissive: gRgbCol,
          emissiveIntensity: 1.9
        });
        gRgbMat.userData = { rgbMode: 'solid', baseColor: gRgbCol.clone() };
        rgbList.push(gRgbMat);
        addBox(hwG, gpuLen * 0.56, 0.012, 0.012, gRgbMat, gpuX - gpuLen * 0.04, gpuY + gpuThick * 0.25, gpuZ + gpuDepth / 2 + 0.008);
      }
    }
  }

  function renderFrameNow() {
    if (!renderer || !scene || !camera || contextLost) return;
    renderer.render(scene, camera);
  }

  function stepAnimation(dt, totalSec) {
    fanRotors.forEach(item => {
      if (item.rotor) item.rotor.rotation.z -= dt * item.speed;
    });
    rgbMats.forEach(mat => {
      if (mat.userData?.rgbMode === 'rainbow') {
        const hue = (totalSec * 0.22) % 1;
        mat.color.setHSL(hue, 0.95, 0.58);
        mat.emissive.setHSL(hue, 0.95, 0.52);
      }
    });
    airflowArrows.forEach((a, idx) => {
      const pulse = Math.sin(totalSec * 4.5 + idx * 0.9) * 0.032;
      a.mesh.position.copy(a.basePos);
      if (a.mount === 'front') a.mesh.position.x -= pulse;
      else if (a.mount === 'rear') a.mesh.position.x -= pulse;
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
        if (Math.hypot(camera.position.x - camTargetPos.x, camera.position.y - camTargetPos.y, camera.position.z - camTargetPos.z) < 0.01) {
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

  function setCameraPreset(preset) {
    const s = state.caseSize === 'large' ? 1.24 : state.caseSize === 'medium' ? 1.1 : 0.94;
    if (preset === 'interior') {
      Object.assign(camTargetPos, { x: 0.15 * s, y: 0.25 * s, z: 2.55 * s });
      Object.assign(camTargetLook, { x: -0.05, y: 0.05, z: 0 });
    } else if (preset === 'front') {
      Object.assign(camTargetPos, { x: 2.45 * s, y: 0.35 * s, z: 0.75 * s });
      Object.assign(camTargetLook, { x: 0, y: 0, z: 0 });
    } else if (preset === 'rear') {
      Object.assign(camTargetPos, { x: -2.45 * s, y: 0.35 * s, z: 0.65 * s });
      Object.assign(camTargetLook, { x: 0, y: 0, z: 0 });
    } else if (preset === 'top') {
      Object.assign(camTargetPos, { x: 0.1 * s, y: 2.65 * s, z: 0.95 * s });
      Object.assign(camTargetLook, { x: 0, y: 0, z: 0 });
    } else {
      Object.assign(camTargetPos, { x: 2.2 * s, y: 1.35 * s, z: 2.35 * s });
      Object.assign(camTargetLook, { x: 0, y: 0.04, z: 0 });
    }
    camAnimActive = true;
  }

  function rebuildMainScene() {
    if (!pcRoot || !THREE) return;
    fanRotors.length = 0;
    rgbMats.length = 0;
    airflowArrows.length = 0;
    buildChassis(state, {
      chassisG: chassisGroup,
      frontG: frontGroup,
      glassG: glassDoorGroup,
      fansG: fansGroup,
      rgbG: rgbGroup,
      hwG: hardwareGroup,
      airG: airflowGroup,
      rotorsList: fanRotors,
      rgbList: rgbMats,
      arrowsList: airflowArrows
    });
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
    renderer.toneMappingExposure = 1.12;
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
    pmrem.dispose();

    const key = new THREE.DirectionalLight(0xffffff, 1.35);
    key.position.set(3.2, 4.5, 3.8);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xa855f7, 0.75);
    rim.position.set(-3.5, 2.2, -2.5);
    scene.add(rim);
    scene.add(new THREE.AmbientLight(0xd8ccf2, 0.42));

    camera = new THREE.PerspectiveCamera(40, 1.3, 0.1, 40);
    camera.position.set(2.2, 1.35, 2.35);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.08;
    controls.minDistance = 1.25;
    controls.maxDistance = 6.5;
    controls.target.set(0, 0.04, 0);
    controls.addEventListener('start', () => { camAnimActive = false; });

    pcRoot = new THREE.Group();
    chassisGroup = new THREE.Group();
    frontGroup = new THREE.Group();
    glassDoorGroup = new THREE.Group();
    fansGroup = new THREE.Group();
    rgbGroup = new THREE.Group();
    hardwareGroup = new THREE.Group();
    airflowGroup = new THREE.Group();
    pcRoot.add(chassisGroup, frontGroup, glassDoorGroup, fansGroup, rgbGroup, hardwareGroup, airflowGroup);
    scene.add(pcRoot);

    dockEl = null;
    buildDock();

    if (resizeObserver) resizeObserver.disconnect();
    resizeObserver = new ResizeObserver(() => resizeRenderer());
    resizeObserver.observe(el);

    resizeRenderer();
    rebuildMainScene();
    startLoop();
  }

  function update(nextCfg) {
    if (!nextCfg) return;
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
      fans: merged.fans,
      cpu: merged.cpu ? { b: merged.cpu.body, c: merged.cpu.cooling } : null,
      gpu: merged.gpu ? { l: merged.gpu.length, t: merged.gpu.thickness, p: merged.gpu.primaryColor, a: merged.gpu.accentColor, b: merged.gpu.body, r: merged.gpu.rgb } : null
    });
    state = merged;
    if (sig !== lastStructSig) {
      lastStructSig = sig;
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
      const url = renderer.domElement.toDataURL('image/webp', 0.86);
      return url;
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
      offRenderer.toneMappingExposure = 1.12;
      offRenderer.setPixelRatio(1);
      offRenderer.setSize(width, height, false);

      const offScene = new THREE.Scene();
      const pmrem = new THREE.PMREMGenerator(offRenderer);
      offScene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();

      const key = new THREE.DirectionalLight(0xffffff, 1.35);
      key.position.set(3.2, 4.5, 3.8);
      offScene.add(key);
      offScene.add(new THREE.AmbientLight(0xd8ccf2, 0.45));

      const offCam = new THREE.PerspectiveCamera(40, width / height, 0.1, 40);
      const root = new THREE.Group();
      const chassisG = new THREE.Group();
      const frontG = new THREE.Group();
      const glassG = new THREE.Group();
      const fansG = new THREE.Group();
      const rgbG = new THREE.Group();
      const hwG = new THREE.Group();
      const airG = new THREE.Group();
      root.add(chassisG, frontG, glassG, fansG, rgbG, hwG, airG);
      offScene.add(root);
      offscreenHostEl = offRenderer.domElement;
      return { offRenderer, offScene, offCam, chassisG, frontG, glassG, fansG, rgbG, hwG, airG };
    })();
    return offscreenPromise;
  }

  async function captureHeroSnapshot(cfg, width = 360, height = 270) {
    const ctx = await ensureOffscreen(width, height);
    if (!ctx) return '';
    const { offRenderer, offScene, offCam, chassisG, frontG, glassG, fansG, rgbG, hwG, airG } = ctx;
    const rotorsList = [];
    const rgbList = [];
    const arrowsList = [];
    const merged = { ...DEFAULT_CONFIG, ...(cfg || {}), openPanel: cfg?.openPanel ?? true, showAirflow: false };
    buildChassis(merged, { chassisG, frontG, glassG, fansG, rgbG, hwG, airG, rotorsList, rgbList, arrowsList });
    const s = merged.caseSize === 'large' ? 1.24 : merged.caseSize === 'medium' ? 1.1 : 0.94;
    offCam.aspect = width / height;
    offCam.position.set(2.2 * s, 1.35 * s, 2.35 * s);
    offCam.lookAt(0, 0.04, 0);
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
    mount,
    update,
    resize,
    captureSnapshot,
    captureHeroSnapshot,
    enqueueThumbnail
  };
})();
