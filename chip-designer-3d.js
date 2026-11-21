/* ============================================================
 * GRIND-EA · Procedural 3D GPU Chip CAD Designer (Three.js PBR)
 * Exposed Iridescent GPU Die · Anti-Crush Shim · BGA & VRAM Arrays
 * ============================================================ */
(function () {
  'use strict';

  const DEFAULT_STATE = {
    name: 'Nova GPU Chip',
    companyName: '',
    logoUrl: '',
    substrate: 'obsidian', // obsidian | blue | green
    shimStyle: 'steel',    // steel | dark | copper
    speedLevel: 'none',
    powerLevel: 'none',
    vramLevel: 'none'
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

  let chipRoot = null;
  let plinthGroup = null;
  let bgaGroup = null;
  let pcbGroup = null;
  let interposerGroup = null;
  let dieGroup = null;
  let vramGroup = null;
  let powerGroup = null;
  let shimGroup = null;

  let loadedLogoUrl = '';
  let loadedLogoImg = null;
  let state = { ...DEFAULT_STATE };
  let lastBuildSig = '';

  let rafId = 0;
  let timerId = 0;
  let lastMs = 0;
  let elapsedSec = 0;
  let autoSpin = false;
  let currentExplode = 0;
  let targetExplode = 0;
  let camAnimActive = false;
  const camTargetPos = { x: 2.75, y: 2.35, z: 2.85 };
  const camTargetLook = { x: 0, y: 0.08, z: 0 };

  const powerRailMats = [];
  const texCache = new Map();
  const sharedMaterials = {};
  const popWeights = { die: 1, vram: 1, power: 1 };

  let _dummy = null;

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
        _dummy = new THREE.Object3D();
        return true;
      } catch (err) {
        console.warn('Chip 3D designer failed to load Three.js:', err);
        initPromise = null;
        return false;
      }
    })();
    return initPromise;
  }

  // ---------- Tier Parsers ----------
  function parseSpeedTier(level) {
    const map = {
      none: 0,
      chip_ok_speed: 1,
      chip_decent_speed: 2,
      chip_good_speed: 3,
      chip_fast_speed: 4,
      chip_insane_speed: 5,
      chip_super_speed: 6
    };
    return map[level] ?? 0;
  }

  function parsePowerTier(level) {
    const map = {
      none: 0,
      chip_decent_power: 1,
      chip_good_power: 2,
      chip_strong_power: 3,
      chip_super_powerful: 4
    };
    return map[level] ?? 0;
  }

  function parseVramSpec(level) {
    const map = {
      none: { count: 0, kind: 'none', label: '0GB' },
      chip_vram_1gb_simple: { count: 2, kind: 'simple', label: '1G' },
      chip_vram_2gb_simple: { count: 4, kind: 'simple', label: '2G' },
      chip_vram_4gb_simple: { count: 6, kind: 'simple', label: '4G' },
      chip_vram_6gb_simple: { count: 6, kind: 'simple_dense', label: '6G' },
      chip_vram_4gb_advanced: { count: 8, kind: 'adv', label: '4G+' },
      chip_vram_6gb_advanced: { count: 8, kind: 'adv_fast', label: '6G+' },
      chip_vram_8gb_advanced: { count: 10, kind: 'adv_wide', label: '8G+' },
      chip_vram_12gb_advanced: { count: 12, kind: 'adv_flagship', label: '12G' },
      chip_vram_16gb_advanced: { count: 4, kind: 'hbm', label: '16G HBM' },
      chip_vram_32gb_advanced: { count: 6, kind: 'hbm_ultra', label: '32G HBM3' }
    };
    return map[level] || map.none;
  }

  // ---------- Procedural Canvas Textures ----------
  function createContactShadowTexture() {
    if (texCache.has('shadow')) return texCache.get('shadow');
    const s = 256;
    const c = document.createElement('canvas');
    c.width = s; c.height = s;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(s / 2, s / 2, 12, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.74)');
    g.addColorStop(0.5, 'rgba(8,5,18,0.40)');
    g.addColorStop(0.85, 'rgba(8,5,18,0.08)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    texCache.set('shadow', tex);
    return tex;
  }

  function getSubstrateTextures(theme) {
    const key = 'pcb_' + theme;
    if (texCache.has(key)) return texCache.get(key);

    const size = 1024;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');

    const b = document.createElement('canvas');
    b.width = size; b.height = size;
    const bctx = b.getContext('2d');

    let bgA = '#0f3b2c', bgB = '#072219', trace = 'rgba(134,239,172,0.34)', gold = '#e5be60';
    if (theme === 'obsidian') {
      bgA = '#1a1d26'; bgB = '#0c0e14';
      trace = 'rgba(229,184,92,0.36)';
      gold = '#f3cb6a';
    } else if (theme === 'blue') {
      bgA = '#0e2948'; bgB = '#08182e';
      trace = 'rgba(103,232,249,0.42)';
      gold = '#d8e7ff';
    }

    const grad = ctx.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, bgA);
    grad.addColorStop(1, bgB);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    bctx.fillStyle = '#383838';
    bctx.fillRect(0, 0, size, size);

    // Fiberglass weave micro-texture
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    for (let i = 0; i < size; i += 10) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(size, i); ctx.stroke();
    }

    // Serpentine differential fan-out traces radiating from center GPU interposer
    const cx = size / 2;
    const cy = size / 2;
    ctx.strokeStyle = trace;
    ctx.lineWidth = 2.4;
    bctx.strokeStyle = '#c8c8c8';
    bctx.lineWidth = 2.4;

    for (let side = 0; side < 4; side++) {
      ctx.save();
      bctx.save();
      ctx.translate(cx, cy);
      bctx.translate(cx, cy);
      ctx.rotate((side * Math.PI) / 2);
      bctx.rotate((side * Math.PI) / 2);
      for (let i = -14; i <= 14; i++) {
        const x0 = i * 16;
        const y0 = 155;
        const y1 = 290;
        const x1 = i * 26;
        const y2 = 445;
        for (const t of [ctx, bctx]) {
          t.beginPath();
          t.moveTo(x0, y0);
          t.lineTo(x0, y1 - 24);
          t.lineTo(x1, y1 + 24);
          t.lineTo(x1, y2);
          t.stroke();
        }
        ctx.fillStyle = gold;
        ctx.beginPath();
        ctx.arc(x1, y2, 3.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      bctx.restore();
    }

    // Perimeter silkscreen fiducials & Pin-1 triangle
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 4;
    ctx.strokeRect(24, 24, size - 48, size - 48);

    ctx.fillStyle = gold;
    ctx.beginPath();
    ctx.moveTo(36, size - 36);
    ctx.lineTo(96, size - 36);
    ctx.lineTo(36, size - 96);
    ctx.closePath();
    ctx.fill();

    // Copper ground ring test vias
    for (const [fx, fy] of [[78, 78], [size - 78, 78], [size - 78, size - 78]]) {
      ctx.fillStyle = gold;
      ctx.beginPath(); ctx.arc(fx, fy, 16, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0a0d14';
      ctx.beginPath(); ctx.arc(fx, fy, 8, 0, Math.PI * 2); ctx.fill();
    }

    const map = new THREE.CanvasTexture(c);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 4;

    const bump = new THREE.CanvasTexture(b);
    const out = { map, bump };
    texCache.set(key, out);
    return out;
  }

  function getGpuDieFloorplanTexture(speedTier) {
    const key = 'die_fp_' + speedTier;
    if (texCache.has(key)) return texCache.get(key);

    const s = 1024;
    const c = document.createElement('canvas');
    c.width = s; c.height = s;
    const ctx = c.getContext('2d');

    const grad = ctx.createLinearGradient(0, 0, s, s);
    grad.addColorStop(0, '#0f1c30');
    grad.addColorStop(0.5, '#1b3556');
    grad.addColorStop(1, '#261844');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);

    // GPC / Shader Engine Matrix inside GPU die
    const cols = 4 + Math.min(4, Math.floor(speedTier / 1.5));
    const rows = 4 + Math.min(4, Math.floor(speedTier / 2));
    const padX = 78;
    const padY = 78;
    const cellW = (s - padX * 2) / cols;
    const cellH = (s - padY * 2) / rows;

    for (let r = 0; r < rows; r++) {
      for (let col = 0; col < cols; col++) {
        // Central horizontal L2 cache spine gap
        const isSpine = rows >= 4 && r === Math.floor(rows / 2);
        const x = padX + col * cellW + 5;
        const y = padY + r * cellH + 5;
        const w = cellW - 10;
        const h = cellH - 10;

        ctx.fillStyle = isSpine ? 'rgba(168,85,247,0.34)' : 'rgba(56,189,248,0.22)';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = isSpine ? 'rgba(216,180,254,0.65)' : 'rgba(125,211,252,0.48)';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);

        // Micro SM / Tensor / RT sub-tiles
        const sub = isSpine ? 2 : 4;
        ctx.fillStyle = 'rgba(255,255,255,0.10)';
        for (let k = 0; k < sub; k++) {
          const sx = x + 6 + (k * (w - 12)) / sub;
          ctx.fillRect(sx, y + 6, (w - 12) / sub - 3, h - 12);
        }
      }
    }

    // Perimeter Memory Controllers + PCIe PHY pads
    ctx.strokeStyle = 'rgba(245,196,81,0.55)';
    ctx.lineWidth = 6;
    ctx.strokeRect(24, 24, s - 48, s - 48);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 4;
    texCache.set(key, tex);
    return tex;
  }

  function getVramChipTexture(label) {
    const key = 'vram_' + label;
    if (texCache.has(key)) return texCache.get(key);

    const s = 256;
    const c = document.createElement('canvas');
    c.width = s; c.height = s;
    const ctx = c.getContext('2d');

    const grad = ctx.createLinearGradient(0, 0, s, s);
    grad.addColorStop(0, '#222633');
    grad.addColorStop(1, '#10131a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);

    // Subtle IC package hairline border
    ctx.strokeStyle = 'rgba(148,163,184,0.28)';
    ctx.lineWidth = 6;
    ctx.strokeRect(10, 10, s - 20, s - 20);

    // Pin 1 dimple
    ctx.fillStyle = 'rgba(226,232,240,0.42)';
    ctx.beginPath();
    ctx.arc(36, 36, 10, 0, Math.PI * 2);
    ctx.fill();

    // Laser-marked capacity label
    ctx.fillStyle = '#cbd5e1';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 50px "JetBrains Mono", monospace';
    ctx.fillText(label.replace(' HBM3', '').replace(' HBM', ''), s / 2, s / 2 - 14);

    ctx.fillStyle = label.includes('HBM') ? '#67e8f9' : '#94a3b8';
    ctx.font = '700 22px "JetBrains Mono", monospace';
    ctx.fillText(label.includes('HBM') ? 'HBM' : 'GDDR', s / 2, s / 2 + 36);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 4;
    texCache.set(key, tex);
    return tex;
  }

  function getShimEtchTexture(nameText, companyText) {
    const key = 'shim_' + (nameText || '') + '|' + (companyText || '') + '|' + (loadedLogoImg ? loadedLogoUrl : '');
    if (texCache.has(key)) return texCache.get(key);

    const w = 1024, h = 256;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');

    ctx.fillStyle = '#181d28';
    ctx.fillRect(0, 0, w, h);

    for (let y = 0; y < h; y += 2) {
      ctx.fillStyle = 'rgba(255,255,255,0.02)';
      ctx.fillRect(0, y, w, 1);
    }

    ctx.strokeStyle = 'rgba(226,232,240,0.35)';
    ctx.lineWidth = 4;
    ctx.strokeRect(12, 12, w - 24, h - 24);

    const hasLogo = Boolean(loadedLogoImg && loadedLogoUrl === state.logoUrl && loadedLogoImg.complete && loadedLogoImg.naturalWidth > 0);
    if (hasLogo) {
      ctx.save();
      ctx.drawImage(loadedLogoImg, 44, 34, 188, 188);
      ctx.restore();
    } else {
      const mono = (companyText || nameText || 'GP').replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || 'GP';
      ctx.strokeStyle = 'rgba(168,85,247,0.85)';
      ctx.lineWidth = 6;
      ctx.strokeRect(48, 38, 180, 180);
      ctx.fillStyle = '#f8fafc';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '900 76px "Plus Jakarta Sans", system-ui, sans-serif';
      ctx.fillText(mono, 138, 128);
    }

    const title = (String(nameText || '').trim() || 'GPU SILICON').slice(0, 22).toUpperCase();
    ctx.fillStyle = '#f1f5f9';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '900 54px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillText(title, 266, 98);

    const sub = (String(companyText || '').trim() || 'GRAPHICS ARCHITECTURE').slice(0, 26).toUpperCase();
    ctx.fillStyle = '#a855f7';
    ctx.font = '700 28px "JetBrains Mono", monospace';
    ctx.fillText(sub, 266, 168);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 4;
    texCache.set(key, tex);
    return tex;
  }

  function ensureLogoImageLoaded(url) {
    const clean = String(url || '').trim();
    if (!clean) {
      loadedLogoUrl = '';
      loadedLogoImg = null;
      return;
    }
    if (clean === loadedLogoUrl && loadedLogoImg) return;
    loadedLogoUrl = clean;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (loadedLogoUrl === clean) {
        loadedLogoImg = img;
        lastBuildSig = '';
        rebuildChipModel();
      }
    };
    img.src = clean;
  }

  // ---------- Geometry Builders ----------
  function createChamferedPcbGeometry(width, height, depth, bevel = 0.015) {
    const hw = width / 2;
    const hh = height / 2;
    const r = 0.09;
    const shape = new THREE.Shape();
    shape.moveTo(-hw + 0.18, -hh);
    shape.lineTo(hw - r, -hh);
    shape.quadraticCurveTo(hw, -hh, hw, -hh + r);
    shape.lineTo(hw, hh - r);
    shape.quadraticCurveTo(hw, hh, hw - r, hh);
    shape.lineTo(-hw + r, hh);
    shape.quadraticCurveTo(-hw, hh, -hw, hh - r);
    shape.lineTo(-hw, -hh + 0.18);
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth,
      steps: 1,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 3
    });
    geo.rotateX(-Math.PI / 2);
    geo.center();

    const pos = geo.attributes.position;
    const uvs = new Float32Array(pos.count * 2);
    const sw = width + bevel * 2;
    const sh = height + bevel * 2;
    for (let i = 0; i < pos.count; i++) {
      uvs[i * 2] = (pos.getX(i) + sw / 2) / sw;
      uvs[i * 2 + 1] = 1 - (pos.getZ(i) + sh / 2) / sh;
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.computeVertexNormals();
    if (geo.computeTangents) geo.computeTangents();
    return geo;
  }

  function createShimWindowGeometry(outerW, outerD, innerW, innerD, thickness) {
    const ow = outerW / 2;
    const od = outerD / 2;
    const r = 0.06;
    const shape = new THREE.Shape();
    shape.moveTo(-ow + r, -od);
    shape.lineTo(ow - r, -od);
    shape.quadraticCurveTo(ow, -od, ow, -od + r);
    shape.lineTo(ow, od - r);
    shape.quadraticCurveTo(ow, od, ow - r, od);
    shape.lineTo(-ow + r, od);
    shape.quadraticCurveTo(-ow, od, -ow, od - r);
    shape.lineTo(-ow, -od + r);
    shape.quadraticCurveTo(-ow, -od, -ow + r, -od);

    const iw = innerW / 2;
    const id = innerD / 2;
    const hole = new THREE.Path();
    hole.moveTo(-iw, -id);
    hole.lineTo(iw, -id);
    hole.lineTo(iw, id);
    hole.lineTo(-iw, id);
    hole.closePath();
    shape.holes.push(hole);

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: thickness,
      steps: 1,
      bevelEnabled: true,
      bevelThickness: 0.009,
      bevelSize: 0.009,
      bevelSegments: 2
    });
    geo.rotateX(-Math.PI / 2);
    geo.center();
    geo.computeVertexNormals();
    return geo;
  }

  function disposeGroupContents(group) {
    if (!group) return;
    const sharedSet = new Set(Object.values(sharedMaterials));
    while (group.children.length) {
      const child = group.children.pop();
      child.traverse?.(obj => {
        if (obj.geometry && typeof obj.geometry.dispose === 'function') obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach(m => { if (m && !sharedSet.has(m)) m.dispose?.(); });
        } else if (obj.material && !sharedSet.has(obj.material) && typeof obj.material.dispose === 'function') {
          obj.material.dispose();
        }
      });
    }
  }

  function ensureSharedMaterials() {
    if (sharedMaterials.gold) return;
    sharedMaterials.gold = new THREE.MeshStandardMaterial({ color: 0xe6be5a, metalness: 0.96, roughness: 0.16 });
    sharedMaterials.ceramicCap = new THREE.MeshStandardMaterial({ color: 0xb98d59, metalness: 0.08, roughness: 0.42 });
    sharedMaterials.solderEnd = new THREE.MeshStandardMaterial({ color: 0xd6dde8, metalness: 0.92, roughness: 0.22 });
    sharedMaterials.underfill = new THREE.MeshStandardMaterial({ color: 0x161214, metalness: 0.1, roughness: 0.72 });
    sharedMaterials.choke = new THREE.MeshPhysicalMaterial({ color: 0x2a2f3d, metalness: 0.65, roughness: 0.34, clearcoat: 0.12 });
    sharedMaterials.pcb = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.48, metalness: 0.16, clearcoat: 0.18, bumpScale: 0.01 });
  }

  // ---------- Model Builder ----------
  function buildStaticPlinthAndBga() {
    plinthGroup = new THREE.Group();
    const shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(4.6, 4.6),
      new THREE.MeshBasicMaterial({ map: createContactShadowTexture(), transparent: true, depthWrite: false, opacity: 0.62 })
    );
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = -0.72;
    plinthGroup.add(shadowPlane);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.74, 1.84, 72),
      new THREE.MeshStandardMaterial({
        color: 0x5c3c8a,
        metalness: 0.72,
        roughness: 0.32,
        emissive: 0x2d174d,
        emissiveIntensity: 0.55,
        side: THREE.DoubleSide
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.70;
    plinthGroup.add(ring);
    scene.add(plinthGroup);

    // Underside BGA Solder Ball Grid + Center MLCC Decoupling Array
    const ballGeo = new THREE.SphereGeometry(0.023, 8, 8);
    const cols = 18;
    const rows = 15;
    const sx = 0.132;
    const sz = 0.132;
    const coords = [];
    for (let ix = 0; ix < cols; ix++) {
      for (let iz = 0; iz < rows; iz++) {
        const cx = Math.abs(ix - (cols - 1) / 2);
        const cz = Math.abs(iz - (rows - 1) / 2);
        if (cx <= 3.6 && cz <= 2.8) continue; // open capacitor island
        if (ix === 0 && iz === rows - 1) continue; // chamfer
        coords.push([(ix - (cols - 1) / 2) * sx, -0.072, (iz - (rows - 1) / 2) * sz]);
      }
    }
    const balls = new THREE.InstancedMesh(ballGeo, sharedMaterials.gold, coords.length);
    coords.forEach(([px, py, pz], idx) => {
      _dummy.position.set(px, py, pz);
      _dummy.rotation.set(0, 0, 0);
      _dummy.scale.set(1, 0.85, 1);
      _dummy.updateMatrix();
      balls.setMatrixAt(idx, _dummy.matrix);
    });
    balls.instanceMatrix.needsUpdate = true;
    balls.computeBoundingSphere();
    bgaGroup.add(balls);

    const capGeo = new THREE.BoxGeometry(0.082, 0.032, 0.042);
    const capEndGeo = new THREE.BoxGeometry(0.100, 0.028, 0.040);
    const capCount = 5 * 4;
    const caps = new THREE.InstancedMesh(capGeo, sharedMaterials.ceramicCap, capCount);
    const capEnds = new THREE.InstancedMesh(capEndGeo, sharedMaterials.solderEnd, capCount);
    let ci = 0;
    for (let x = 0; x < 5; x++) {
      for (let z = 0; z < 4; z++) {
        _dummy.position.set((x - 2) * 0.165, -0.068, (z - 1.5) * 0.155);
        _dummy.rotation.set(0, (x + z) % 2 === 0 ? 0 : Math.PI / 2, 0);
        _dummy.scale.set(1, 1, 1);
        _dummy.updateMatrix();
        caps.setMatrixAt(ci, _dummy.matrix);
        capEnds.setMatrixAt(ci, _dummy.matrix);
        ci++;
      }
    }
    caps.instanceMatrix.needsUpdate = true;
    capEnds.instanceMatrix.needsUpdate = true;
    caps.computeBoundingSphere();
    capEnds.computeBoundingSphere();
    bgaGroup.add(caps, capEnds);
  }

  function rebuildChipModel() {
    if (!THREE || !chipRoot) return;
    ensureSharedMaterials();

    const sig = JSON.stringify({
      name: state.name,
      company: state.companyName,
      logo: loadedLogoImg ? state.logoUrl : '',
      sub: state.substrate,
      shim: state.shimStyle,
      spd: state.speedLevel,
      pwr: state.powerLevel,
      vram: state.vramLevel
    });
    if (sig === lastBuildSig) return;
    lastBuildSig = sig;

    const speedTier = parseSpeedTier(state.speedLevel);
    const powerTier = parsePowerTier(state.powerLevel);
    const vramSpec = parseVramSpec(state.vramLevel);

    disposeGroupContents(pcbGroup);
    disposeGroupContents(interposerGroup);
    disposeGroupContents(dieGroup);
    disposeGroupContents(vramGroup);
    disposeGroupContents(powerGroup);
    disposeGroupContents(shimGroup);
    powerRailMats.length = 0;

    // 1. Rectangular Chamfered GPU BGA Substrate
    const subW = 2.68;
    const subD = 2.18;
    const subTex = getSubstrateTextures(state.substrate || 'obsidian');
    sharedMaterials.pcb.map = subTex.map;
    sharedMaterials.pcb.bumpMap = subTex.bump;
    sharedMaterials.pcb.needsUpdate = true;

    const pcbMesh = new THREE.Mesh(createChamferedPcbGeometry(subW, subD, 0.088, 0.015), sharedMaterials.pcb);
    pcbMesh.castShadow = !isSoftwareGl;
    pcbMesh.receiveShadow = true;
    pcbGroup.add(pcbMesh);

    // 2. Organic Interposer / CoWoS Silicon Bridge Bed
    const isHbm = vramSpec.kind === 'hbm' || vramSpec.kind === 'hbm_ultra';
    const interW = isHbm ? 1.54 : 1.08 + speedTier * 0.04;
    const interD = isHbm ? 1.18 : 0.96 + speedTier * 0.03;
    const interMat = new THREE.MeshPhysicalMaterial({
      color: isHbm ? 0x162436 : 0x1f2533,
      metalness: isHbm ? 0.65 : 0.36,
      roughness: isHbm ? 0.20 : 0.48,
      iridescence: isHbm ? 0.55 : 0.1
    });
    const interMesh = new THREE.Mesh(new THREE.BoxGeometry(interW, 0.026, interD), interMat);
    interMesh.receiveShadow = true;
    interposerGroup.add(interMesh);

    // 3. Monolithic GPU Silicon Die (Scales smoothly with Speed tier)
    const dieW = 0.64 + speedTier * 0.055;
    const dieD = 0.54 + speedTier * 0.042;
    const dieH = 0.038;

    const epoxyMesh = new THREE.Mesh(
      new THREE.BoxGeometry(dieW + 0.09, 0.016, dieD + 0.09),
      sharedMaterials.underfill
    );
    epoxyMesh.position.y = -0.008;
    dieGroup.add(epoxyMesh);

    const dieMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: getGpuDieFloorplanTexture(speedTier),
      metalness: 0.62,
      roughness: 0.075,
      clearcoat: 1.0,
      clearcoatRoughness: 0.04,
      iridescence: 0.96,
      iridescenceIOR: 1.48,
      iridescenceThicknessRange: [150, 520]
    });
    const dieMesh = new THREE.Mesh(
      createChamferedPcbGeometry(dieW, dieD, dieH, 0.006),
      dieMat
    );
    dieMesh.position.y = 0.012;
    dieMesh.castShadow = !isSoftwareGl;
    dieMesh.receiveShadow = true;
    dieGroup.add(dieMesh);

    // Micro die-side SMD MLCC decoupling caps around the exposed silicon
    const capGeo = new THREE.BoxGeometry(0.036, 0.016, 0.018);
    const dieCaps = [];
    const capStep = 0.095;
    for (let x = -dieW * 0.42; x <= dieW * 0.42; x += capStep) {
      dieCaps.push([x, 0.005, -(dieD / 2 + 0.055), 0]);
      dieCaps.push([x, 0.005, (dieD / 2 + 0.055), 0]);
    }
    const dieCapsMesh = new THREE.InstancedMesh(capGeo, sharedMaterials.ceramicCap, dieCaps.length);
    dieCaps.forEach(([px, py, pz, ry], i) => {
      _dummy.position.set(px, py, pz);
      _dummy.rotation.set(0, ry, 0);
      _dummy.scale.set(1, 1, 1);
      _dummy.updateMatrix();
      dieCapsMesh.setMatrixAt(i, _dummy.matrix);
    });
    dieCapsMesh.instanceMatrix.needsUpdate = true;
    dieCapsMesh.computeBoundingSphere();
    dieGroup.add(dieCapsMesh);

    // 4. V-RAM Memory Modules (GDDR IC Ring or Stacked HBM Towers)
    if (vramSpec.count > 0) {
      const vramTex = getVramChipTexture(vramSpec.label);
      const isAdv = vramSpec.kind.startsWith('adv');
      const vramBodyMat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        map: vramTex,
        metalness: isAdv ? 0.34 : 0.18,
        roughness: isAdv ? 0.28 : 0.42,
        clearcoat: isAdv ? 0.42 : 0.18
      });
      const vramTrimMat = new THREE.MeshPhysicalMaterial({
        color: isHbm ? 0x67e8f9 : isAdv ? 0xc0cad8 : 0x525b6d,
        metalness: 0.88,
        roughness: 0.24
      });

      if (isHbm) {
        // High-Bandwidth Stacked Silicon HBM towers directly adjacent to GPU die on interposer
        const hbmCount = vramSpec.count; // 4 or 6
        const perSide = hbmCount / 2;
        const hbmW = 0.21;
        const hbmD = 0.24;
        const stackLayers = vramSpec.kind === 'hbm_ultra' ? 4 : 3;
        const layerH = 0.014;
        for (let side of [-1, 1]) {
          for (let i = 0; i < perSide; i++) {
            const zOff = (i - (perSide - 1) / 2) * (hbmD + 0.055);
            const xOff = side * (dieW / 2 + 0.16);
            for (let l = 0; l < stackLayers; l++) {
              const slice = new THREE.Mesh(new THREE.BoxGeometry(hbmW, layerH * 0.82, hbmD), l === stackLayers - 1 ? vramBodyMat : vramTrimMat);
              slice.position.set(xOff, l * layerH, zOff);
              slice.castShadow = !isSoftwareGl;
              vramGroup.add(slice);
            }
            // Silicon bridge link glowing trace into GPU die
            const linkMat = new THREE.MeshStandardMaterial({
              color: 0x38bdf8,
              emissive: 0x0284c7,
              emissiveIntensity: 0.9,
              roughness: 0.2
            });
            powerRailMats.push(linkMat);
            const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.008, 0.12), linkMat);
            bridge.position.set(side * (dieW / 2 + 0.04), -0.004, zOff);
            vramGroup.add(bridge);
          }
        }
      } else {
        // GDDR IC Memory Array around the anti-crush perimeter
        const icSlots = [];
        const topRow = [[-0.58, -0.78, 0], [-0.20, -0.78, 0], [0.20, -0.78, 0], [0.58, -0.78, 0]];
        const leftCol = [[-0.98, -0.34, Math.PI / 2], [-0.98, 0.04, Math.PI / 2], [-0.98, 0.42, Math.PI / 2]];
        const rightCol = [[0.98, -0.34, -Math.PI / 2], [0.98, 0.04, -Math.PI / 2], [0.98, 0.42, -Math.PI / 2]];
        const botRow = [[-0.36, 0.78, Math.PI], [0.36, 0.78, Math.PI]];

        if (vramSpec.count === 2) {
          icSlots.push(leftCol[1], rightCol[1]);
        } else if (vramSpec.count === 4) {
          icSlots.push(leftCol[0], leftCol[2], rightCol[0], rightCol[2]);
        } else if (vramSpec.count === 6) {
          icSlots.push(leftCol[0], leftCol[1], leftCol[2], rightCol[0], rightCol[1], rightCol[2]);
        } else if (vramSpec.count === 8) {
          icSlots.push(topRow[0], topRow[3], leftCol[0], leftCol[1], leftCol[2], rightCol[0], rightCol[1], rightCol[2]);
        } else if (vramSpec.count === 10) {
          icSlots.push(...topRow, ...leftCol, ...rightCol);
        } else {
          icSlots.push(...topRow, ...leftCol, ...rightCol, ...botRow);
        }

        const icW = 0.29;
        const icD = 0.21;
        for (const [px, pz, ry] of icSlots) {
          const ic = new THREE.Group();
          ic.position.set(px, 0.018, pz);
          ic.rotation.y = ry;

          const base = new THREE.Mesh(new THREE.BoxGeometry(icW + 0.025, 0.012, icD + 0.025), vramTrimMat);
          base.position.y = -0.008;
          const pkg = new THREE.Mesh(new THREE.BoxGeometry(icW, 0.026, icD), vramBodyMat);
          pkg.position.y = 0.006;
          pkg.castShadow = !isSoftwareGl;
          pkg.receiveShadow = true;
          ic.add(base, pkg);
          vramGroup.add(ic);
        }
      }
    } else {
      // Subtle gold unpopulated GDDR pads on PCB so player sees open VRAM landing bays
      const padMat = new THREE.MeshStandardMaterial({ color: 0xb89644, metalness: 0.82, roughness: 0.34, transparent: true, opacity: 0.45 });
      for (const px of [-0.98, 0.98]) {
        for (const pz of [-0.25, 0.25]) {
          const pad = new THREE.Mesh(new THREE.PlaneGeometry(0.20, 0.26), padMat);
          pad.rotation.x = -Math.PI / 2;
          pad.position.set(px, -0.015, pz);
          vramGroup.add(pad);
        }
      }
    }

    // 5. Power Delivery Chokes & Bus Rails (Scales with Power tier)
    if (powerTier > 0) {
      const phasePairs = powerTier * 2;
      const accentCol = powerTier >= 4 ? 0xf59e0b : powerTier >= 3 ? 0xa855f7 : powerTier >= 2 ? 0x38bdf8 : 0x22c55e;
      const glowMat = new THREE.MeshStandardMaterial({
        color: accentCol,
        emissive: accentCol,
        emissiveIntensity: 0.72,
        roughness: 0.22,
        metalness: 0.45
      });
      powerRailMats.push(glowMat);

      for (let i = 0; i < phasePairs; i++) {
        const x = -((phasePairs - 1) * 0.14) / 2 + i * 0.14;
        const choke = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.036, 0.10), sharedMaterials.choke);
        choke.position.set(x, 0.018, 0.94);
        choke.castShadow = !isSoftwareGl;
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.038, 12), sharedMaterials.solderEnd);
        cap.position.set(x, 0.018, 0.80);
        const strip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.008, 0.014), glowMat);
        strip.position.set(x, 0.038, 0.94);
        powerGroup.add(choke, cap, strip);
      }

      // Twin copper/gold bus bars feeding the interposer
      const bar = new THREE.Mesh(new THREE.BoxGeometry(phasePairs * 0.15, 0.014, 0.024), sharedMaterials.gold);
      bar.position.set(0, 0.006, 0.67);
      powerGroup.add(bar);
    }

    // 6. Signature GPU Metallic Anti-Crush Perimeter Shim + Etched Identification Plate
    const shimColor = state.shimStyle === 'copper' ? 0xd67c49 : state.shimStyle === 'dark' ? 0x222734 : 0xc6cfdc;
    const shimMat = new THREE.MeshPhysicalMaterial({
      color: shimColor,
      metalness: 0.92,
      roughness: state.shimStyle === 'dark' ? 0.34 : 0.22,
      anisotropy: 0.76,
      clearcoat: 0.22
    });
    const outerShimW = isHbm ? 1.66 : 1.38;
    const outerShimD = isHbm ? 1.24 : 1.12;
    const winW = outerShimW - 0.22;
    const winD = outerShimD - 0.22;
    const shimMesh = new THREE.Mesh(
      createShimWindowGeometry(outerShimW, outerShimD, winW, winD, 0.024),
      shimMat
    );
    shimMesh.castShadow = !isSoftwareGl;
    shimMesh.receiveShadow = true;
    shimGroup.add(shimMesh);

    // Top-edge etched nameplate bar on shim frame
    const plateMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: getShimEtchTexture(state.name, state.companyName),
      metalness: 0.38,
      roughness: 0.28,
      clearcoat: 0.45
    });
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(outerShimW * 0.82, 0.18), plateMat);
    plate.rotation.x = -Math.PI / 2;
    plate.position.set(0, 0.023, -(outerShimD / 2 - 0.055));
    shimGroup.add(plate);
  }

  // ---------- Viewport UI Dock ----------
  function buildDock() {
    if (!stageEl || dockEl) return;
    dockEl = document.createElement('div');
    dockEl.className = 'gpu-3d-dock ea-chip-3d-dock';
    dockEl.innerHTML =
      '<div class="gpu-3d-pills">' +
        '<button type="button" data-chip-cam="hero" class="active">3/4 Hero</button>' +
        '<button type="button" data-chip-cam="top">Top</button>' +
        '<button type="button" data-chip-cam="side">Side</button>' +
        '<button type="button" data-chip-cam="bottom">BGA Pins</button>' +
      '</div>' +
      '<div class="gpu-3d-actions">' +
        '<button type="button" data-chip-act="spin">Spin</button>' +
        '<button type="button" data-chip-act="explode">Explode</button>' +
      '</div>';
    stageEl.appendChild(dockEl);

    dockEl.querySelectorAll('[data-chip-cam]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        dockEl.querySelectorAll('[data-chip-cam]').forEach(b => b.classList.toggle('active', b === btn));
        setCameraPreset(btn.dataset.chipCam);
      });
    });

    dockEl.querySelectorAll('[data-chip-act]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const act = btn.dataset.chipAct;
        if (act === 'spin') {
          autoSpin = !autoSpin;
          btn.classList.toggle('active', autoSpin);
        } else if (act === 'explode') {
          targetExplode = targetExplode > 0.5 ? 0 : 1;
          btn.classList.toggle('active', targetExplode > 0.5);
        }
      });
    });
  }

  function setCameraPreset(preset) {
    camAnimActive = true;
    camTargetLook.x = 0; camTargetLook.y = 0.08; camTargetLook.z = 0;
    if (preset === 'top') {
      camTargetPos.x = 0.01; camTargetPos.y = 4.05; camTargetPos.z = 0.36;
    } else if (preset === 'side') {
      camTargetPos.x = 0.02; camTargetPos.y = 0.65; camTargetPos.z = 3.85;
    } else if (preset === 'bottom') {
      camTargetPos.x = 0.35; camTargetPos.y = -2.75; camTargetPos.z = 2.65;
    } else {
      camTargetPos.x = 2.75; camTargetPos.y = 2.35; camTargetPos.z = 2.85;
    }
  }

  // ---------- Loop & Lifecycle ----------
  function stepAnimation(dt) {
    elapsedSec += dt;
    currentExplode = THREE.MathUtils.damp(currentExplode, targetExplode, 7.8, dt);
    popWeights.die = THREE.MathUtils.damp(popWeights.die, 1, 9.5, dt);
    popWeights.vram = THREE.MathUtils.damp(popWeights.vram, 1, 9.5, dt);
    popWeights.power = THREE.MathUtils.damp(popWeights.power, 1, 9.5, dt);

    const e = currentExplode;
    if (bgaGroup) bgaGroup.position.y = -e * 0.36;
    if (pcbGroup) pcbGroup.position.y = 0;
    if (interposerGroup) interposerGroup.position.y = 0.068 + e * 0.14;
    if (vramGroup) {
      vramGroup.position.y = 0.072 + e * 0.24;
      vramGroup.scale.setScalar(0.92 + 0.08 * popWeights.vram);
    }
    if (powerGroup) {
      powerGroup.position.y = 0.065 + e * 0.22;
      powerGroup.scale.setScalar(0.92 + 0.08 * popWeights.power);
    }
    if (dieGroup) {
      dieGroup.position.y = 0.088 + e * 0.36;
      dieGroup.scale.setScalar(0.90 + 0.10 * popWeights.die);
    }
    if (shimGroup) {
      shimGroup.position.y = 0.082 + e * 0.56;
    }

    if (chipRoot) {
      chipRoot.position.y = 0.05 + Math.sin(elapsedSec * 1.4) * 0.012;
      if (autoSpin) chipRoot.rotation.y += dt * 0.52;
      else chipRoot.rotation.y = THREE.MathUtils.damp(chipRoot.rotation.y, 0, 3.8, dt);
    }

    if (powerRailMats.length) {
      for (let i = 0; i < powerRailMats.length; i++) {
        powerRailMats[i].emissiveIntensity = 0.55 + 0.45 * Math.sin(elapsedSec * 3.2 + i * 0.7);
      }
    }

    if (camAnimActive && camera && controls) {
      camera.position.x = THREE.MathUtils.damp(camera.position.x, camTargetPos.x, 7.0, dt);
      camera.position.y = THREE.MathUtils.damp(camera.position.y, camTargetPos.y, 7.0, dt);
      camera.position.z = THREE.MathUtils.damp(camera.position.z, camTargetPos.z, 7.0, dt);
      controls.target.x = THREE.MathUtils.damp(controls.target.x, camTargetLook.x, 7.5, dt);
      controls.target.y = THREE.MathUtils.damp(controls.target.y, camTargetLook.y, 7.5, dt);
      controls.target.z = THREE.MathUtils.damp(controls.target.z, camTargetLook.z, 7.5, dt);
      if (Math.hypot(camera.position.x - camTargetPos.x, camera.position.y - camTargetPos.y, camera.position.z - camTargetPos.z) < 0.012) {
        camAnimActive = false;
      }
    }

    controls?.update();
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
        if (contextLost || !renderer) return;
        const st = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (st === gl.UNSIGNALED) timerId = window.setTimeout(poll, 5);
        else {
          if (sync) gl.deleteSync(sync);
          timerId = window.setTimeout(cb, 80);
        }
      };
      timerId = window.setTimeout(poll, 5);
    } catch (_) {
      timerId = window.setTimeout(cb, 80);
    }
  }

  function loop(nowMs) {
    rafId = 0;
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
    if (isSoftwareGl) {
      afterDraw(() => { if (!contextLost && renderer) rafId = requestAnimationFrame(loop); });
    } else {
      rafId = requestAnimationFrame(loop);
    }
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

  let mountPromise = null;

  async function mount(el) {
    if (!el) return;
    stageEl = el;
    if (mountPromise) return mountPromise;
    mountPromise = (async () => {
      try {
        const ok = await ensureThree();
        if (!ok) {
          el.innerHTML = '<div class="gpu-3d-error">3D Chip preview unavailable.</div>';
          return;
        }

        el.querySelectorAll('.gpu-3d-loading, .gpu-3d-error').forEach(n => n.remove());

        if (renderer) {
          if (mountEl && mountEl.parentNode !== el) el.prepend(mountEl);
          if (dockEl && dockEl.parentNode !== el) el.appendChild(dockEl);
          resizeObserver?.disconnect();
          resizeObserver = new ResizeObserver(resize);
          resizeObserver.observe(el);
          resize();
          rebuildChipModel();
          return;
        }

        isSoftwareGl = detectSoftwareWebGL();
        try {
          renderer = new THREE.WebGLRenderer({
            antialias: !isSoftwareGl,
            powerPreference: 'high-performance',
            preserveDrawingBuffer: true
          });
        } catch (err) {
          console.error('Chip WebGL init failed:', err);
          el.innerHTML = '<div class="gpu-3d-error">WebGL 3D preview is unavailable.</div>';
          return;
        }

        renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.16;
        renderer.shadowMap.enabled = !isSoftwareGl;
        if (!isSoftwareGl) renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        renderer.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); contextLost = true; stopLoop(); });
        renderer.domElement.addEventListener('webglcontextrestored', () => { contextLost = false; rebuildChipModel(); startLoop(); });

        el.innerHTML = '';
        mountEl = document.createElement('div');
        mountEl.className = 'ea-chip-canvas-mount';
        mountEl.appendChild(renderer.domElement);
        el.appendChild(mountEl);

        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0d0919);
        scene.fog = new THREE.FogExp2(0x0d0919, 0.054);

        camera = new THREE.PerspectiveCamera(35, 16 / 10, 0.1, 45);
        camera.position.set(2.75, 2.35, 2.85);

        const pmrem = new THREE.PMREMGenerator(renderer);
        const roomEnv = new RoomEnvironment();
        envTexture = pmrem.fromScene(roomEnv, 0.04).texture;
        scene.environment = envTexture;
        scene.environmentIntensity = 1.08;
        roomEnv.dispose();
        pmrem.dispose();

        scene.add(new THREE.HemisphereLight(0xaecbff, 0x1a112b, 0.78));

        const keyLight = new THREE.DirectionalLight(0xfff1dc, 2.45);
        keyLight.position.set(4.0, 5.8, 3.6);
        if (!isSoftwareGl) {
          keyLight.castShadow = true;
          keyLight.shadow.mapSize.set(1024, 1024);
          keyLight.shadow.camera.left = -2.8;
          keyLight.shadow.camera.right = 2.8;
          keyLight.shadow.camera.top = 2.8;
          keyLight.shadow.camera.bottom = -2.8;
          keyLight.shadow.camera.near = 1;
          keyLight.shadow.camera.far = 16;
          keyLight.shadow.bias = -0.0004;
          keyLight.shadow.normalBias = 0.02;
        }
        scene.add(keyLight);

        const rimLight = new THREE.DirectionalLight(0xb28dff, 1.85);
        rimLight.position.set(-4.4, 3.2, -3.8);
        scene.add(rimLight);

        const fillLight = new THREE.DirectionalLight(0xd4e8ff, 0.85);
        fillLight.position.set(-3.2, -1.6, 3.6);
        scene.add(fillLight);

        chipRoot = new THREE.Group();
        chipRoot.position.y = 0.05;
        bgaGroup = new THREE.Group();
        pcbGroup = new THREE.Group();
        interposerGroup = new THREE.Group();
        dieGroup = new THREE.Group();
        vramGroup = new THREE.Group();
        powerGroup = new THREE.Group();
        shimGroup = new THREE.Group();
        chipRoot.add(bgaGroup, pcbGroup, interposerGroup, vramGroup, powerGroup, dieGroup, shimGroup);
        scene.add(chipRoot);

        ensureSharedMaterials();
        buildStaticPlinthAndBga();
        rebuildChipModel();

        if (!isSoftwareGl && typeof renderer.compile === 'function') {
          renderer.compile(scene, camera);
        }

        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = !isSoftwareGl;
        controls.dampingFactor = 0.06;
        controls.enablePan = false;
        controls.minDistance = 2.0;
        controls.maxDistance = 7.0;
        controls.minPolarAngle = 0.08;
        controls.maxPolarAngle = Math.PI - 0.12;
        controls.target.set(0, 0.08, 0);
        controls.addEventListener('start', () => { camAnimActive = false; });

        buildDock();

        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(el);
        resize();
        startLoop();
      } finally {
        mountPromise = null;
      }
    })();
    return mountPromise;
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
      const prev = { ...state };
      state = { ...state, ...next };
      if (prev.speedLevel !== state.speedLevel) popWeights.die = 0.35;
      if (prev.vramLevel !== state.vramLevel) popWeights.vram = 0.35;
      if (prev.powerLevel !== state.powerLevel) popWeights.power = 0.35;
      ensureLogoImageLoaded(state.logoUrl);
    }
    if (!renderer) {
      if (stageEl) mount(stageEl);
      return;
    }
    rebuildChipModel();
  }

  function dispose() {
    stopLoop();
    resizeObserver?.disconnect();
    controls?.dispose?.();
    disposeGroupContents(bgaGroup);
    disposeGroupContents(pcbGroup);
    disposeGroupContents(interposerGroup);
    disposeGroupContents(dieGroup);
    disposeGroupContents(vramGroup);
    disposeGroupContents(powerGroup);
    disposeGroupContents(shimGroup);
    disposeGroupContents(plinthGroup);
    Object.values(sharedMaterials).forEach(m => m?.dispose?.());
    texCache.forEach(entry => {
      if (entry?.dispose) entry.dispose();
      else {
        entry?.map?.dispose?.();
        entry?.bump?.dispose?.();
      }
    });
    texCache.clear();
    envTexture?.dispose?.();
    renderer?.dispose?.();
    renderer = null;
    scene = null;
    camera = null;
    controls = null;
    chipRoot = null;
    dockEl = null;
    mountEl = null;
    lastBuildSig = '';
  }

  window.ChipDesigner3D = { mount, update, setCameraPreset, resize, dispose };
})();
