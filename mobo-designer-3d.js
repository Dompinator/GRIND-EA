/* ============================================================
 * GRIND-EA · Procedural 3D Motherboard CAD Designer (Three.js PBR)
 * Real-World Millimeter Scale (1.0 unit = 100mm):
 *   - Small (Mini-ITX): 170 x 170 mm (1.70 x 1.70)
 *   - Medium (ATX):     244 x 305 mm (2.44 x 3.05)
 *   - Large (E-ATX):    285 x 330 mm (2.85 x 3.30)
 * Standalone MoboDesigner3D.buildAssembly(THREE, cfg, opts)
 * Also plugs directly 1:1 into PcDesigner3D & PcAssemblyRitual!
 * ============================================================ */
(function () {
  'use strict';

  const BOARD_DIMENSIONS = {
    small: { w: 1.70, d: 1.70, mmW: 170, mmH: 170, label: 'Mini-ITX', camDist: 2.85 },
    medium: { w: 2.44, d: 3.05, mmW: 244, mmH: 305, label: 'ATX', camDist: 3.95 },
    large: { w: 2.85, d: 3.30, mmW: 285, mmH: 330, label: 'E-ATX', camDist: 4.35 }
  };

  const DEFAULT_CONFIG = {
    boardSize: 'small',    // 'small' | 'medium' | 'large'
    ramSlots: 0,           // 0 | 1 | 2 | 4 | 6
    pcbColor: '#121620',   // dark charcoal, emerald, arctic, slate, crimson
    armorColor: '#1f2533',
    accentColor: '#a855f7',
    vrmStyle: 'finned',    // 'minimal' | 'finned' | 'armored'
    ioShield: true,
    m2Shield: true,
    rgbAccent: false,
    name: 'CoreBoard M1',
    companyName: '',
    logoUrl: '',
    score: 4
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
  let pmremGen = null;
  let resizeObserver = null;

  let moboRoot = null;
  let currentAsm = null;
  let config = { ...DEFAULT_CONFIG };

  let rafId = 0;
  let timerId = 0;
  let lastMs = 0;
  let elapsedSec = 0;
  let autoSpin = false;
  let currentExplode = 0;
  let targetExplode = 0;
  let camAnimActive = false;
  const camTargetPos = { x: 2.15, y: 2.55, z: 2.35 };
  const camTargetLook = { x: 0, y: 0.04, z: 0 };

  let offscreenPromise = null;
  let thumbQueueBusy = false;
  const moboThumbQueue = [];

  const logoImageCache = new Map();
  const pcbTexCache = new Map();
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  function getBoardDimensions(sizeKey) {
    return BOARD_DIMENSIONS[sizeKey] || BOARD_DIMENSIONS.small;
  }

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
        console.warn('Motherboard 3D designer failed to load Three.js:', err);
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

  function roundedBoardGeo(T, w, d, thickness, r) {
    const hw = w / 2;
    const hd = d / 2;
    const rad = Math.min(r, hw * 0.2, hd * 0.2);
    const shape = new T.Shape();
    shape.moveTo(-hw + rad, -hd);
    shape.lineTo(hw - rad, -hd);
    shape.quadraticCurveTo(hw, -hd, hw, -hd + rad);
    shape.lineTo(hw, hd - rad);
    shape.quadraticCurveTo(hw, hd, hw - rad, hd);
    shape.lineTo(-hw + rad, hd);
    shape.quadraticCurveTo(-hw, hd, -hw, hd - rad);
    shape.lineTo(-hw, -hd + rad);
    shape.quadraticCurveTo(-hw, -hd, -hw + rad, -hd);
    const geo = new T.ExtrudeGeometry(shape, {
      depth: Math.max(0.012, thickness),
      bevelEnabled: true,
      bevelThickness: 0.004,
      bevelSize: 0.004,
      bevelSegments: 2,
      curveSegments: 8
    });
    geo.rotateX(-Math.PI / 2);
    geo.computeBoundingBox();
    geo.translate(0, -(geo.boundingBox.min.y + geo.boundingBox.max.y) / 2, 0);
    geo.computeVertexNormals();
    return geo;
  }

  function getCachedLogo(url, onReady) {
    if (!url) return null;
    const cached = logoImageCache.get(url);
    if (cached === 'loading' || cached === 'error') return null;
    if (cached) return cached;
    logoImageCache.set(url, 'loading');
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      logoImageCache.set(url, img);
      if (typeof onReady === 'function') onReady();
    };
    img.onerror = () => { logoImageCache.set(url, 'error'); };
    img.src = url;
    return null;
  }

  function buildPcbCanvasTexture(T, cfg, dims, onLogoReady) {
    const pcbHex = cfg.pcbColor || '#121620';
    const accHex = cfg.accentColor || '#a855f7';
    const nameStr = String(cfg.name || 'COREBOARD').slice(0, 22);
    const compStr = String(cfg.companyName || '').slice(0, 18);
    const logoImg = cfg.logoUrl ? getCachedLogo(cfg.logoUrl, onLogoReady) : null;
    const sig = [pcbHex, accHex, dims.label, cfg.ramSlots, nameStr, compStr, logoImg ? 'img' : 'no'].join('|');
    if (pcbTexCache.has(sig)) return pcbTexCache.get(sig);

    const c = document.createElement('canvas');
    c.width = 768;
    c.height = 768;
    const ctx = c.getContext('2d');

    ctx.fillStyle = pcbHex;
    ctx.fillRect(0, 0, 768, 768);

    const isLight = /^#(e|f|d)/i.test(pcbHex);
    const traceCol = isLight ? 'rgba(30,41,59,0.14)' : 'rgba(203,213,225,0.11)';
    const busCol = isLight ? 'rgba(30,41,59,0.22)' : 'rgba(148,163,184,0.18)';

    // Diagonal & orthogonal copper memory/PCIe traces
    ctx.strokeStyle = traceCol;
    ctx.lineWidth = 2.2;
    for (let i = 32; i < 736; i += 14) {
      ctx.beginPath();
      ctx.moveTo(28, i);
      ctx.lineTo(310, i);
      ctx.lineTo(350, i + ((i / 14) % 2 === 0 ? 18 : -18));
      ctx.lineTo(740, i + ((i / 14) % 2 === 0 ? 18 : -18));
      ctx.stroke();
    }

    // Gold plated via grid & vertical bus traces near RAM area
    ctx.strokeStyle = busCol;
    ctx.lineWidth = 1.6;
    for (let x = 440; x < 690; x += 11) {
      ctx.beginPath();
      ctx.moveTo(x, 110);
      ctx.lineTo(x, 420);
      ctx.stroke();
    }

    // Silkscreen perimeter line + PCB revision mark
    ctx.strokeStyle = accHex;
    ctx.globalAlpha = 0.42;
    ctx.lineWidth = 3;
    ctx.strokeRect(18, 18, 732, 732);
    ctx.globalAlpha = 1;

    // Silkscreen text block (bottom-left above audio zone / PCB edge)
    ctx.fillStyle = isLight ? '#0f172a' : '#e2e8f0';
    ctx.font = '800 22px Inter, system-ui, sans-serif';
    ctx.fillText(nameStr.toUpperCase(), 38, 712);

    ctx.fillStyle = accHex;
    ctx.font = '700 16px Inter, system-ui, sans-serif';
    ctx.fillText(
      `${dims.label} · ${cfg.ramSlots > 0 ? cfg.ramSlots + '× DDR5' : '0 RAM SLOTS'} · PCIe 5.0`,
      38,
      738
    );

    if (logoImg) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(576, 650, 74, 74, 10);
      ctx.clip();
      ctx.drawImage(logoImg, 576, 650, 74, 74);
      ctx.restore();
    } else if (compStr) {
      ctx.fillStyle = isLight ? '#334155' : '#94a3b8';
      ctx.font = '700 18px Inter, system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(compStr.toUpperCase(), 730, 725);
      ctx.textAlign = 'left';
    }

    const tex = new T.CanvasTexture(c);
    tex.colorSpace = T.SRGBColorSpace;
    tex.anisotropy = 4;
    if (pcbTexCache.size > 24) pcbTexCache.clear();
    pcbTexCache.set(sig, tex);
    return tex;
  }

  function buildChipsetBadgeTexture(T, cfg) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext('2d');
    ctx.fillStyle = cfg.armorColor || '#1f2533';
    ctx.fillRect(0, 0, 256, 256);

    ctx.strokeStyle = cfg.accentColor || '#a855f7';
    ctx.lineWidth = 8;
    ctx.strokeRect(14, 14, 228, 228);

    // Diagonal brushed vents
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 6;
    for (let i = -256; i < 512; i += 24) {
      ctx.beginPath();
      ctx.moveTo(i, 20);
      ctx.lineTo(i + 180, 236);
      ctx.stroke();
    }

    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'center';
    ctx.font = '900 32px Inter, system-ui, sans-serif';
    ctx.fillText((cfg.companyName || 'GRIND').slice(0, 10).toUpperCase(), 128, 122);
    ctx.fillStyle = cfg.accentColor || '#a855f7';
    ctx.font = '800 20px Inter, system-ui, sans-serif';
    ctx.fillText(String(cfg.name || 'CHIPSET').slice(0, 14).toUpperCase(), 128, 162);

    const tex = new T.CanvasTexture(c);
    tex.colorSpace = T.SRGBColorSpace;
    return tex;
  }

  // Standalone Builder: returns full hierarchical assembly usable by MoboDesigner3D, ProductPreviewModal & PcDesigner3D!
  function buildAssembly(T, rawCfg, opts = {}) {
    if (!T) return null;
    const cfg = {
      ...DEFAULT_CONFIG,
      ...(rawCfg && typeof rawCfg === 'object' ? rawCfg : {})
    };
    const dims = getBoardDimensions(cfg.boardSize);
    const w = dims.w;
    const d = dims.d;
    const pcbThick = 0.026; // real 2.6mm thick multi-layer PCB

    const pcbCol = new T.Color(cfg.pcbColor || '#121620');
    const armorCol = new T.Color(cfg.armorColor || '#1f2533');
    const accCol = new T.Color(cfg.accentColor || '#a855f7');

    const pcbTex = buildPcbCanvasTexture(T, cfg, dims, opts.onAssetReady || opts.onLogoReady);
    const badgeTex = buildChipsetBadgeTexture(T, cfg);

    const pcbMat = new T.MeshPhysicalMaterial({
      color: 0xffffff,
      map: pcbTex,
      metalness: 0.16,
      roughness: 0.46,
      clearcoat: 0.22
    });
    const pcbEdgeMat = new T.MeshStandardMaterial({
      color: pcbCol.clone().multiplyScalar(0.85),
      metalness: 0.2,
      roughness: 0.55
    });
    const darkPlasticMat = new T.MeshStandardMaterial({
      color: 0x11151d,
      metalness: 0.18,
      roughness: 0.56
    });
    const dimmBodyMat = new T.MeshStandardMaterial({
      color: 0x171b24,
      metalness: 0.22,
      roughness: 0.48
    });
    const dimmAltMat = new T.MeshStandardMaterial({
      color: 0x262c3a,
      metalness: 0.28,
      roughness: 0.44
    });
    const armorMat = new T.MeshPhysicalMaterial({
      color: armorCol,
      metalness: 0.72,
      roughness: 0.30,
      clearcoat: 0.18
    });
    const brushedSteelMat = new T.MeshPhysicalMaterial({
      color: 0xd0d8e4,
      metalness: 0.92,
      roughness: 0.20
    });
    const darkSteelMat = new T.MeshStandardMaterial({
      color: 0x252b36,
      metalness: 0.82,
      roughness: 0.32
    });
    const goldMat = new T.MeshStandardMaterial({
      color: 0xe6be5a,
      metalness: 0.94,
      roughness: 0.18
    });
    const copperMat = new T.MeshStandardMaterial({
      color: 0xd47a45,
      metalness: 0.92,
      roughness: 0.20
    });
    const accentMat = new T.MeshPhysicalMaterial({
      color: accCol,
      metalness: 0.62,
      roughness: 0.24,
      emissive: cfg.rgbAccent ? accCol : new T.Color(0x000000),
      emissiveIntensity: cfg.rgbAccent ? 1.15 : 0
    });

    const addBox = (parent, bw, bh, bd, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
      const m = new T.Mesh(new T.BoxGeometry(bw, bh, bd), mat);
      m.position.set(x, y, z);
      if (rx || ry || rz) m.rotation.set(rx, ry, rz);
      parent.add(m);
      return m;
    };

    const root = new T.Group();
    const pcbGroup = new T.Group();
    const vrmGroup = new T.Group();
    const ioGroup = new T.Group();
    const socketGroup = new T.Group();
    const ramGroup = new T.Group();
    const pcieGroup = new T.Group();
    const heatsinksGroup = new T.Group();

    const surfaceY = pcbThick / 2;

    // 1. Main Fiberglass PCB + Gold Screw Standoff Mounting Holes
    const boardMesh = new T.Mesh(roundedBoardGeo(T, w, d, pcbThick, 0.04), [pcbMat, pcbEdgeMat]);
    pcbGroup.add(boardMesh);

    const screwPts = [
      [-w * 0.44, -d * 0.44], [0, -d * 0.44], [w * 0.44, -d * 0.44],
      [-w * 0.44, d * 0.44], [0, d * 0.44], [w * 0.44, d * 0.44]
    ];
    if (cfg.boardSize !== 'small') {
      screwPts.push([-w * 0.44, 0], [w * 0.44, 0]);
    }
    const padGeo = new T.CylinderGeometry(0.036, 0.036, pcbThick + 0.004, 16);
    const holeGeo = new T.CylinderGeometry(0.018, 0.018, pcbThick + 0.008, 12);
    screwPts.forEach(([sx, sz]) => {
      const pad = new T.Mesh(padGeo, goldMat);
      pad.position.set(sx, 0, sz);
      const hole = new T.Mesh(holeGeo, darkPlasticMat);
      hole.position.set(sx, 0, sz);
      pcbGroup.add(pad, hole);
    });

    // ATX 24-pin Power Header (+X right edge) & SATA ports
    const atxX = w * 0.5 - 0.085;
    const atxZ = cfg.boardSize === 'small' ? -0.02 : -0.22;
    addBox(pcbGroup, 0.078, 0.088, 0.44, darkPlasticMat, atxX, surfaceY + 0.044, atxZ);
    // Visible brass pins inside ATX 24-pin header
    for (let p = 0; p < 12; p++) {
      const pz = atxZ - 0.18 + (p / 11) * 0.36;
      addBox(pcbGroup, 0.01, 0.035, 0.01, goldMat, atxX - 0.014, surfaceY + 0.075, pz);
      addBox(pcbGroup, 0.01, 0.035, 0.01, goldMat, atxX + 0.014, surfaceY + 0.075, pz);
    }

    // 8-pin EPS CPU Power Header (top-left -Z edge)
    const epsX = -w * 0.25;
    const epsZ = -d * 0.5 + 0.075;
    addBox(pcbGroup, 0.19, 0.082, 0.078, darkPlasticMat, epsX, surfaceY + 0.041, epsZ);
    for (let e = 0; e < 4; e++) {
      const ex = epsX - 0.06 + e * 0.04;
      addBox(pcbGroup, 0.01, 0.03, 0.01, goldMat, ex, surfaceY + 0.07, epsZ - 0.014);
      addBox(pcbGroup, 0.01, 0.03, 0.01, goldMat, ex, surfaceY + 0.07, epsZ + 0.014);
    }

    // SATA right-angle ports on lower-right edge (4 on medium/large, 2 on small)
    const sataCount = cfg.boardSize === 'small' ? 2 : 4;
    for (let s = 0; s < sataCount; s++) {
      addBox(pcbGroup, 0.085, 0.062, 0.11, darkPlasticMat, w * 0.5 - 0.055, surfaceY + 0.031, d * 0.24 + s * 0.13);
    }

    // Audio Capacitors cluster (bottom-left corner)
    for (let ac = 0; ac < 4; ac++) {
      const cap = new T.Mesh(new T.CylinderGeometry(0.022, 0.022, 0.058, 12), goldMat);
      cap.position.set(-w * 0.42 + ac * 0.062, surfaceY + 0.029, d * 0.41);
      pcbGroup.add(cap);
    }

    // Layout coordinates (local X, local Z — mapped via rotX(+90°) in PcDesigner3D!)
    const sockX = cfg.boardSize === 'large' ? -0.18 : cfg.boardSize === 'medium' ? -0.14 : -0.08;
    const sockZ = cfg.boardSize === 'large' ? -0.56 : cfg.boardSize === 'medium' ? -0.52 : -0.16;
    const sockPad = cfg.boardSize === 'small' ? 0.54 : 0.58;

    // 2. LGA CPU Socket + Articulated Hinged Steel ILM Frame & Lever
    const sockBaseY = surfaceY + 0.018;
    addBox(socketGroup, sockPad + 0.13, 0.036, sockPad + 0.13, darkSteelMat, sockX, sockBaseY, sockZ);
    // Gold LGA Pin Contact Bed inside socket cavity
    const pinBed = new T.Mesh(new T.BoxGeometry(sockPad * 0.88, 0.016, sockPad * 0.88), goldMat);
    pinBed.position.set(sockX, surfaceY + 0.028, sockZ);
    socketGroup.add(pinBed);
    // Central SMD capacitors inside socket cutout
    addBox(socketGroup, sockPad * 0.34, 0.022, sockPad * 0.34, darkPlasticMat, sockX, surfaceY + 0.030, sockZ);

    const asmOpts = opts.assembly && typeof opts.assembly === 'object' ? opts.assembly : {};
    const hoodW = sockPad + 0.11;
    const hoodD = sockPad + 0.13;
    const hoodBar = 0.082;

    // Hinged at top edge (-Z side of socket), swings upward when open!
    const ilmHoodPivot = new T.Group();
    ilmHoodPivot.position.set(sockX, surfaceY + 0.058, sockZ - hoodD / 2);
    // Top bar, bottom lip, left & right rails (built along +Z from pivot)
    addBox(ilmHoodPivot, hoodW, 0.022, hoodBar, brushedSteelMat, 0, 0, hoodBar / 2);
    addBox(ilmHoodPivot, hoodW * 0.78, 0.022, hoodBar * 0.92, brushedSteelMat, 0, 0, hoodD - hoodBar / 2);
    addBox(ilmHoodPivot, hoodBar, 0.022, hoodD - hoodBar * 1.4, brushedSteelMat, -hoodW / 2 + hoodBar / 2, 0, hoodD / 2);
    addBox(ilmHoodPivot, hoodBar, 0.022, hoodD - hoodBar * 1.4, brushedSteelMat, hoodW / 2 - hoodBar / 2, 0, hoodD / 2);
    addBox(ilmHoodPivot, 0.15, 0.024, 0.052, brushedSteelMat, 0, -0.004, hoodD + 0.012);
    // Note: around X-axis, positive rotation lifts +Z upward toward +Y? Wait:
    // +Z rotated around +X by θ: y' = y cosθ - z sinθ, z' = y sinθ + z cosθ.
    // For z > 0, θ < 0 makes y' = -z sinθ > 0 (lifts UP off socket!). Matches PcDesigner3D (-1.18)!
    ilmHoodPivot.rotation.x = asmOpts.latchOpen ? -1.18 : 0;
    socketGroup.add(ilmHoodPivot);

    // Side Steel Cam Lever (hinged at bottom-right +Z/+X corner)
    const ilmLeverPivot = new T.Group();
    ilmLeverPivot.position.set(sockX + hoodW / 2 + 0.05, surfaceY + 0.034, sockZ + hoodD / 2 + 0.02);
    const leverStem = new T.Mesh(new T.CylinderGeometry(0.015, 0.015, hoodD * 1.04, 12), brushedSteelMat);
    leverStem.rotation.x = Math.PI / 2;
    leverStem.position.set(0, 0.016, -hoodD * 0.52);
    ilmLeverPivot.add(leverStem);
    addBox(ilmLeverPivot, 0.13, 0.03, 0.03, brushedSteelMat, -0.05, 0.016, -hoodD * 1.03);
    addBox(ilmLeverPivot, 0.055, 0.038, 0.072, accentMat, 0.015, 0.018, -hoodD * 1.0);
    // For z < 0, positive rotX gives y' = -z sinθ > 0 (lifts UP!). Matches PcDesigner3D (+1.28)!
    ilmLeverPivot.rotation.x = asmOpts.latchOpen ? 1.28 : 0;
    socketGroup.add(ilmLeverPivot);

    // 3. VRM Power Delivery (Ferrite Chokes + Caps + Extruded Finned Heatsinks)
    const vrmLeftX = sockX - hoodW / 2 - 0.11;
    const chokeCountL = cfg.boardSize === 'small' ? 5 : 8;
    const chokeSpanL = Math.min(d * 0.36, 0.72);
    for (let i = 0; i < chokeCountL; i++) {
      const cz = sockZ - chokeSpanL * 0.45 + (i / Math.max(1, chokeCountL - 1)) * chokeSpanL * 0.9;
      addBox(vrmGroup, 0.068, 0.044, 0.068, darkSteelMat, vrmLeftX, surfaceY + 0.022, cz);
      const cap = new T.Mesh(new T.CylinderGeometry(0.022, 0.022, 0.055, 12), brushedSteelMat);
      cap.position.set(vrmLeftX + 0.072, surfaceY + 0.027, cz);
      vrmGroup.add(cap);
    }

    // Left VRM Heatsink (finned or armored extruded block)
    const hsLeftX = vrmLeftX - 0.11;
    const hsLeftLen = cfg.boardSize === 'small' ? 0.56 : 0.88;
    const hsHeight = cfg.vrmStyle === 'armored' ? 0.22 : cfg.vrmStyle === 'finned' ? 0.17 : 0.10;
    addBox(vrmGroup, 0.15, hsHeight, hsLeftLen, armorMat, hsLeftX, surfaceY + hsHeight / 2, sockZ - 0.02);
    if (cfg.vrmStyle !== 'minimal') {
      const finCt = cfg.boardSize === 'small' ? 6 : 9;
      for (let f = 0; f < finCt; f++) {
        const fz = (sockZ - 0.02) - hsLeftLen * 0.44 + (f / (finCt - 1)) * hsLeftLen * 0.88;
        addBox(vrmGroup, 0.17, hsHeight + 0.018, 0.022, brushedSteelMat, hsLeftX, surfaceY + (hsHeight + 0.018) / 2, fz);
      }
      addBox(vrmGroup, 0.04, 0.02, hsLeftLen * 0.75, accentMat, hsLeftX + 0.055, surfaceY + hsHeight + 0.012, sockZ - 0.02);
    }

    // Top VRM Chokes & Heatsink (on Medium/Large ATX boards, or compact bar on Small)
    const vrmTopZ = sockZ - hoodD / 2 - 0.10;
    const topChokeCt = cfg.boardSize === 'small' ? 3 : 5;
    for (let i = 0; i < topChokeCt; i++) {
      const cx = sockX - 0.18 + (i / Math.max(1, topChokeCt - 1)) * 0.36;
      addBox(vrmGroup, 0.064, 0.042, 0.064, darkSteelMat, cx, surfaceY + 0.021, vrmTopZ);
    }
    if (cfg.boardSize !== 'small' || cfg.vrmStyle !== 'minimal') {
      const topHsW = cfg.boardSize === 'small' ? 0.52 : 0.74;
      const topHsZ = vrmTopZ - 0.11;
      addBox(vrmGroup, topHsW, hsHeight * 0.82, 0.13, armorMat, sockX, surfaceY + (hsHeight * 0.82) / 2, topHsZ);
      addBox(vrmGroup, topHsW * 0.82, 0.018, 0.028, accentMat, sockX, surfaceY + hsHeight * 0.82 + 0.008, topHsZ);
      // Copper heatpipe linking Left + Top VRM heatsinks
      if (cfg.vrmStyle === 'armored') {
        const hpCurve = new T.CatmullRomCurve3([
          new T.Vector3(hsLeftX, surfaceY + hsHeight * 0.65, sockZ + 0.15),
          new T.Vector3(hsLeftX, surfaceY + hsHeight * 0.72, topHsZ),
          new T.Vector3(sockX + topHsW * 0.35, surfaceY + hsHeight * 0.72, topHsZ)
        ]);
        vrmGroup.add(new T.Mesh(new T.TubeGeometry(hpCurve, 16, 0.018, 10, false), copperMat));
      }
    }

    // 4. Rear I/O Port Cluster + Optional Integrated I/O Shroud (-X edge)
    const ioEdgeX = -w / 2 + 0.095;
    const ioCenterZ = sockZ - 0.02;
    const ioSpanZ = Math.min(d * 0.44, 1.05);
    // Individual metallic Rear I/O Port Blocks (USB, HDMI/DP, RJ45, Audio Stack)
    addBox(ioGroup, 0.15, 0.13, 0.16, brushedSteelMat, ioEdgeX, surfaceY + 0.065, ioCenterZ - ioSpanZ * 0.34); // Dual USB + Display
    addBox(ioGroup, 0.15, 0.14, 0.18, brushedSteelMat, ioEdgeX, surfaceY + 0.070, ioCenterZ - ioSpanZ * 0.04); // USB-C + USB 3.2 Red
    addBox(ioGroup, 0.16, 0.15, 0.16, brushedSteelMat, ioEdgeX, surfaceY + 0.075, ioCenterZ + ioSpanZ * 0.22); // 2.5G LAN + USB
    // Blue USB & Red USB tongues visible from -X
    addBox(ioGroup, 0.014, 0.03, 0.08, new T.MeshStandardMaterial({ color: 0x0284c7 }), -w / 2 + 0.016, surfaceY + 0.08, ioCenterZ - ioSpanZ * 0.34);
    addBox(ioGroup, 0.014, 0.03, 0.08, new T.MeshStandardMaterial({ color: 0xdc2626 }), -w / 2 + 0.016, surfaceY + 0.08, ioCenterZ - ioSpanZ * 0.04);
    // Wi-Fi gold SMA connectors
    [-0.03, 0.03].forEach(dz => {
      const sma = new T.Mesh(new T.CylinderGeometry(0.018, 0.018, 0.065, 12), goldMat);
      sma.rotation.z = Math.PI / 2;
      sma.position.set(-w / 2 - 0.02, surfaceY + 0.06, ioCenterZ + ioSpanZ * 0.42 + dz);
      ioGroup.add(sma);
    });
    if (cfg.ioShield !== false) {
      addBox(ioGroup, 0.19, 0.21, ioSpanZ + 0.12, armorMat, -w / 2 + 0.10, surfaceY + 0.12, ioCenterZ);
      addBox(ioGroup, 0.036, 0.026, ioSpanZ * 0.85, accentMat, -w / 2 + 0.17, surfaceY + 0.228, ioCenterZ);
    }

    // 5. Keyed DDR5 RAM DIMM Slots (0, 1, 2, 4, or 6 Slots!)
    const ramCount = clamp(Number(cfg.ramSlots || 0), 0, 6);
    if (ramCount > 0) {
      const slotLen = cfg.boardSize === 'small' ? 0.92 : 1.18;
      const ramStartX = sockX + hoodW / 2 + 0.13;
      const ramMaxX = atxX - 0.11;
      const availW = Math.max(0.28, ramMaxX - ramStartX);
      const pitch = ramCount > 1 ? Math.min(0.088, (availW - 0.04) / (ramCount - 1)) : 0;
      const spanW = (ramCount - 1) * pitch;
      const centerRamX = (ramStartX + ramMaxX) / 2;

      for (let r = 0; r < ramCount; r++) {
        const rx = ramCount === 1 ? centerRamX : (centerRamX - spanW / 2 + r * pitch);
        const slotMat = (r % 2 === 0) ? dimmBodyMat : dimmAltMat;
        const slotG = new T.Group();
        slotG.position.set(rx, surfaceY + 0.038, sockZ);
        // Main DDR5 plastic housing
        addBox(slotG, 0.038, 0.076, slotLen, slotMat, 0, 0, 0);
        // Inner dark pin trench + gold contacts
        addBox(slotG, 0.016, 0.026, slotLen * 0.90, darkPlasticMat, 0, 0.032, 0);
        addBox(slotG, 0.008, 0.018, slotLen * 0.86, goldMat, 0, 0.028, 0);
        // Keying notch barrier
        addBox(slotG, 0.022, 0.032, 0.024, slotMat, 0, 0.03, 0.06);
        // Top & Bottom Retention Latches
        addBox(slotG, 0.044, 0.042, 0.048, accentMat, 0, 0.032, -slotLen / 2 - 0.024);
        addBox(slotG, 0.044, 0.042, 0.048, accentMat, 0, 0.032, slotLen / 2 + 0.024);
        ramGroup.add(slotG);
      }
    }

    // 6. PCIe Expansion Slots, M.2 NVMe Shields, Chipset PCH & CMOS Coin Battery
    const pcieZ = cfg.boardSize === 'small' ? 0.54 : cfg.boardSize === 'medium' ? 0.42 : 0.44;
    const pcieX = cfg.boardSize === 'small' ? -0.14 : sockX - 0.06;
    const pcieLen = cfg.boardSize === 'small' ? 0.94 : 1.06;

    // Steel-Reinforced Primary PCIe x16 Slot
    addBox(pcieGroup, pcieLen, 0.088, 0.076, brushedSteelMat, pcieX, surfaceY + 0.044, pcieZ);
    addBox(pcieGroup, pcieLen * 0.93, 0.094, 0.034, darkPlasticMat, pcieX, surfaceY + 0.046, pcieZ);
    addBox(pcieGroup, pcieLen * 0.88, 0.024, 0.012, goldMat, pcieX, surfaceY + 0.068, pcieZ);
    addBox(pcieGroup, 0.075, 0.07, 0.082, accentMat, pcieX + pcieLen / 2 + 0.035, surfaceY + 0.042, pcieZ);

    // Secondary PCIe slots on ATX / E-ATX boards
    if (cfg.boardSize !== 'small') {
      addBox(pcieGroup, pcieLen * 0.45, 0.078, 0.064, darkPlasticMat, pcieX - pcieLen * 0.25, surfaceY + 0.039, pcieZ + 0.34);
      addBox(pcieGroup, pcieLen, 0.082, 0.072, darkSteelMat, pcieX, surfaceY + 0.041, pcieZ + 0.68);
    }

    // M.2 NVMe Armored Heatsink Shield (between CPU socket and Primary PCIe x16)
    const m2Z = (sockZ + hoodD / 2 + pcieZ) * 0.5;
    if (cfg.m2Shield !== false) {
      const m2W = Math.min(w * 0.38, 0.92);
      addBox(heatsinksGroup, m2W, 0.044, 0.14, armorMat, sockX + 0.04, surfaceY + 0.022, m2Z);
      addBox(heatsinksGroup, m2W * 0.72, 0.012, 0.028, accentMat, sockX + 0.04, surfaceY + 0.046, m2Z);
      [-m2W * 0.44, m2W * 0.44].forEach(dx => {
        const ms = new T.Mesh(new T.CylinderGeometry(0.016, 0.016, 0.015, 10), brushedSteelMat);
        ms.position.set(sockX + 0.04 + dx, surfaceY + 0.048, m2Z);
        heatsinksGroup.add(ms);
      });
    } else {
      // Exposed M.2 slot + bare NVMe SSD stick
      addBox(heatsinksGroup, 0.74, 0.018, 0.12, darkPlasticMat, sockX + 0.04, surfaceY + 0.014, m2Z);
    }

    // Chipset PCH Heatsink Block with Silkscreen Badge
    const chipX = cfg.boardSize === 'small' ? w * 0.28 : w * 0.24;
    const chipZ = cfg.boardSize === 'small' ? d * 0.22 : pcieZ + 0.40;
    const chipW = cfg.boardSize === 'small' ? 0.38 : 0.66;
    const chipD = cfg.boardSize === 'small' ? 0.34 : 0.56;
    const badgeMat = new T.MeshPhysicalMaterial({ map: badgeTex, metalness: 0.45, roughness: 0.28 });
    const chipBlock = new T.Mesh(new T.BoxGeometry(chipW, 0.072, chipD), [armorMat, armorMat, badgeMat, armorMat, armorMat, armorMat]);
    chipBlock.position.set(chipX, surfaceY + 0.036, chipZ);
    heatsinksGroup.add(chipBlock);

    // Silver CR2032 CMOS Battery
    const cmosX = cfg.boardSize === 'small' ? -w * 0.36 : pcieX - 0.12;
    const cmosZ = cfg.boardSize === 'small' ? d * 0.16 : pcieZ + 0.18;
    const cmosHolder = new T.Mesh(new T.CylinderGeometry(0.088, 0.088, 0.028, 18), darkPlasticMat);
    cmosHolder.position.set(cmosX, surfaceY + 0.014, cmosZ);
    const cmosCoin = new T.Mesh(new T.CylinderGeometry(0.074, 0.074, 0.032, 20), brushedSteelMat);
    cmosCoin.position.set(cmosX, surfaceY + 0.016, cmosZ);
    pcbGroup.add(cmosHolder, cmosCoin);

    // Optional RGB underglow strip along right PCB edge
    if (cfg.rgbAccent) {
      addBox(pcbGroup, 0.022, 0.022, d * 0.76, accentMat, w * 0.47, surfaceY + 0.014, 0);
    }

    root.add(pcbGroup, vrmGroup, ioGroup, socketGroup, ramGroup, pcieGroup, heatsinksGroup);

    // Compute exact local layout coordinates in PcDesigner3D space AFTER rotX(+90°):
    // rotX(+90°) maps local (x, y, z) -> parent (x, -z, +y) relative to motherboard center!
    return {
      root,
      pcbGroup,
      vrmGroup,
      ioGroup,
      socketGroup,
      ramGroup,
      pcieGroup,
      heatsinksGroup,
      ilmHoodPivot,
      ilmLeverPivot,
      dims,
      layout: {
        pcbThick,
        surfaceY,
        // Local coordinates (before rotX(+90°))
        sockX,
        sockZ,
        pcieX,
        pcieZ,
        atxX,
        atxZ,
        // After rotX(+90°) around center: X unchanged, Y = -localZ, Z = +localY!
        sockWorldOffsetX: sockX,
        sockWorldOffsetY: -sockZ,
        pcieWorldOffsetX: pcieX,
        pcieWorldOffsetY: -pcieZ,
        atxWorldOffsetX: atxX,
        atxWorldOffsetY: -atxZ,
        surfaceWorldZ: surfaceY
      }
    };
  }

  // ---------- Interactive Viewport Dock & Rendering ----------
  function rebuildStageModel() {
    if (!THREE || !moboRoot) return;
    clearGroup(moboRoot);
    currentAsm = buildAssembly(THREE, config, {
      isSoftwareGl,
      onAssetReady: () => rebuildStageModel()
    });
    if (currentAsm?.root) moboRoot.add(currentAsm.root);
    applyExplode(0);
  }

  function applyExplode(dt) {
    if (!currentAsm) return;
    currentExplode += (targetExplode - currentExplode) * (dt > 0 ? Math.min(1, dt * 8) : 1);
    const e = currentExplode;
    if (currentAsm.pcbGroup) currentAsm.pcbGroup.position.y = -0.14 * e;
    if (currentAsm.socketGroup) currentAsm.socketGroup.position.y = 0.24 * e;
    if (currentAsm.ramGroup) currentAsm.ramGroup.position.y = 0.36 * e;
    if (currentAsm.vrmGroup) currentAsm.vrmGroup.position.y = 0.48 * e;
    if (currentAsm.ioGroup) currentAsm.ioGroup.position.x = -0.34 * e;
    if (currentAsm.pcieGroup) currentAsm.pcieGroup.position.y = 0.28 * e;
    if (currentAsm.heatsinksGroup) currentAsm.heatsinksGroup.position.y = 0.56 * e;
  }

  function setCameraPreset(preset) {
    const dims = getBoardDimensions(config.boardSize);
    const s = dims.camDist / 2.85;
    camAnimActive = true;
    camTargetLook.x = 0; camTargetLook.y = 0.04; camTargetLook.z = 0;
    if (preset === 'top') Object.assign(camTargetPos, { x: 0.01, y: 3.85 * s, z: 0.35 * s });
    else if (preset === 'io') Object.assign(camTargetPos, { x: -3.25 * s, y: 1.25 * s, z: 0.9 * s });
    else if (preset === 'ram') Object.assign(camTargetPos, { x: 2.95 * s, y: 1.65 * s, z: 1.65 * s });
    else if (preset === 'back') Object.assign(camTargetPos, { x: 0.3 * s, y: -2.45 * s, z: 2.25 * s });
    else Object.assign(camTargetPos, { x: 2.15 * s, y: 2.55 * s, z: 2.35 * s });
  }

  function renderDock() {
    if (!stageEl) return;
    dockEl = stageEl.querySelector('#eaMoboDock');
    if (dockEl) return;
    dockEl = document.createElement('div');
    dockEl.id = 'eaMoboDock';
    dockEl.className = 'gpu-3d-dock';
    dockEl.innerHTML =
      '<div class="gpu-3d-pills">' +
        '<button type="button" data-mobo-cam="hero" class="active">3/4 Hero</button>' +
        '<button type="button" data-mobo-cam="top">Top</button>' +
        '<button type="button" data-mobo-cam="io">Rear I/O</button>' +
        '<button type="button" data-mobo-cam="ram">RAM / ATX</button>' +
        '<button type="button" data-mobo-cam="back">Back PCB</button>' +
      '</div>' +
      '<div class="gpu-3d-actions">' +
        '<button type="button" id="eaMoboSpinBtn">Spin</button>' +
        '<button type="button" id="eaMoboExplodeBtn">Explode</button>' +
      '</div>';
    stageEl.appendChild(dockEl);

    dockEl.querySelectorAll('[data-mobo-cam]').forEach(btn => {
      btn.addEventListener('click', () => {
        dockEl.querySelectorAll('[data-mobo-cam]').forEach(b => b.classList.toggle('active', b === btn));
        setCameraPreset(btn.dataset.moboCam);
      });
    });
    dockEl.querySelector('#eaMoboSpinBtn')?.addEventListener('click', e => {
      autoSpin = !autoSpin;
      e.currentTarget.classList.toggle('active', autoSpin);
    });
    dockEl.querySelector('#eaMoboExplodeBtn')?.addEventListener('click', e => {
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

      if (autoSpin && moboRoot) moboRoot.rotation.y += dt * 0.52;
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
      containerEl.innerHTML = '<div class="gpu-3d-error">3D Motherboard Designer unavailable on this browser.</div>';
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
    scene.environmentIntensity = 1.05;

    scene.add(new THREE.HemisphereLight(0xe6eeff, 0x181426, 1.3));
    const key = new THREE.DirectionalLight(0xfff5e8, 2.2);
    key.position.set(4.5, 6.5, 4.2);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xa78bfa, 1.35);
    rim.position.set(-4.2, 3.0, -3.6);
    scene.add(rim);

    camera = new THREE.PerspectiveCamera(36, 16 / 10, 0.08, 60);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 1.25;
    controls.maxDistance = 9.5;
    controls.addEventListener('start', () => { camAnimActive = false; });

    moboRoot = new THREE.Group();
    scene.add(moboRoot);
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
    const prevSize = config.boardSize;
    config = { ...DEFAULT_CONFIG, ...(nextCfg && typeof nextCfg === 'object' ? nextCfg : {}) };
    if (THREE && moboRoot) {
      rebuildStageModel();
      if (prevSize !== config.boardSize) setCameraPreset('hero');
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
      offScene.environmentIntensity = 1.05;
      pm.dispose();

      offScene.add(new THREE.HemisphereLight(0xe6eeff, 0x181426, 1.3));
      const key = new THREE.DirectionalLight(0xfff5e8, 2.2);
      key.position.set(4.5, 6.5, 4.2);
      offScene.add(key);
      const rim = new THREE.DirectionalLight(0xa78bfa, 1.35);
      rim.position.set(-4.2, 3.0, -3.6);
      offScene.add(rim);

      const offCamera = new THREE.PerspectiveCamera(36, 4 / 3, 0.08, 60);
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

    const dims = getBoardDimensions(cfg?.boardSize);
    const s = dims.camDist / 2.85;
    offRenderer.setSize(width, height, false);
    offCamera.aspect = width / height;
    offCamera.updateProjectionMatrix();
    offCamera.position.set(2.15 * s, 2.55 * s, 2.35 * s);
    offCamera.lookAt(0, 0.04, 0);
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
    if (thumbQueueBusy || !moboThumbQueue.length) return;
    thumbQueueBusy = true;
    const job = moboThumbQueue.shift();
    captureHeroSnapshot(job.cfg, job.width, job.height)
      .then(url => job.cb?.(url))
      .catch(() => job.cb?.(''))
      .finally(() => {
        thumbQueueBusy = false;
        if (moboThumbQueue.length) setTimeout(processQueue, 16);
      });
  }

  function enqueueThumbnail(cfg, cb, width = 360, height = 270) {
    moboThumbQueue.push({ cfg, cb, width, height });
    processQueue();
  }

  window.MoboDesigner3D = {
    BOARD_DIMENSIONS,
    getBoardDimensions,
    buildAssembly,
    mount,
    update,
    resize,
    captureSnapshot,
    captureHeroSnapshot,
    enqueueThumbnail
  };
})();
