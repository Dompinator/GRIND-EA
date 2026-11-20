/* ============================================================
 * GRIND-EA · Procedural 3D GPU CAD Designer (Three.js PBR)
 * Zero external textures · RoomEnvironment IBL · Smooth Damping
 * ============================================================ */
(function () {
  'use strict';

  const DEFAULT_CONFIG = {
    length: 300,      // 180..420 mm
    width: 125,       // 90..180 mm
    thickness: 52,    // 38..76 mm (2.0..3.8 slot)
    body: 'plastic',  // plastic | metallic | carbon
    shroud: 'rounded',// rounded | angular | compact
    accentColor: '#a855f7',
    rgb: false,
    rgbColor: '#a855f7',
    backplate: true,
    brand: 'GRIND',
    gpuName: 'New Graphics Card',
    chipName: '',
    logoUrl: '',
    fanScale: 1.0,    // 0.72..1.25
    fans: [
      { position: 0.28, type: 'basic' },
      { position: 0.72, type: 'basic' }
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
  let plinthGroup = null;

  let fanAssemblies = []; // [{ index, group, rotor, hitMesh, ringMesh, ringMat, yTop }]
  let rgbMaterials = [];
  let brandTexCache = { sig: '', tex: null };
  let hubTexCache = { sig: '', tex: null };
  let loadedLogoUrl = '';
  let loadedLogoImg = null;
  const proceduralTex = {};

  let config = { ...DEFAULT_CONFIG, fans: DEFAULT_CONFIG.fans.map(f => ({ ...f })) };
  let callbacks = {};

  // Animation & interaction state
  let rafId = 0;
  let timerId = 0;
  let lastMs = 0;
  let elapsedSec = 0;
  let autoSpin = false;
  let currentExplode = 0;
  let targetExplode = 0;
  let camAnimActive = false;
  const camTargetPos = { x: 2.95, y: 2.35, z: 3.15 };
  const camTargetLook = { x: 0, y: 0.05, z: 0 };

  // Fan 3D raycast drag state
  let raycaster = null;
  let pointerNdc = null;
  let dragPlane = null;
  let dragHitPoint = null;
  let activeFanDrag = null; // { index, offsetX }
  let hoveredFanIndex = -1;

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  function detectSoftwareWebGL() {
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const rendererName = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(rendererName);
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
      const n = 118 + Math.floor(Math.random() * 24);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = n;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(6, 3);
    proceduralTex.plasticBump = tex;
    return tex;
  }

  function getBrushedMetalTexture() {
    if (proceduralTex.brushedMetal) return proceduralTex.brushedMetal;
    const w = 512, h = 256;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#a3adb9';
    ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y++) {
      const v = 148 + Math.floor(Math.random() * 44);
      ctx.fillStyle = `rgb(${v},${v + 4},${v + 10})`;
      ctx.fillRect(0, y, w, 1);
    }
    for (let i = 0; i < 420; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const len = 30 + Math.random() * 140;
      ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.08)' : 'rgba(15,20,28,0.08)';
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
        const g1 = ctxC.createLinearGradient(x, y, x + cell, y + cell);
        if (shift) {
          g1.addColorStop(0, '#13161e');
          g1.addColorStop(0.5, '#2b3242');
          g1.addColorStop(1, '#151821');
        } else {
          g1.addColorStop(0, '#1c212c');
          g1.addColorStop(0.5, '#0e1118');
          g1.addColorStop(1, '#262c3a');
        }
        ctxC.fillStyle = g1;
        ctxC.fillRect(x, y, cell, cell);
        ctxB.fillStyle = shift ? '#b8b8b8' : '#646464';
        ctxB.fillRect(x + 1, y + 1, cell - 2, cell - 2);
      }
    }
    const color = new THREE.CanvasTexture(cc);
    color.colorSpace = THREE.SRGBColorSpace;
    color.wrapS = color.wrapT = THREE.RepeatWrapping;
    color.repeat.set(10, 5);
    color.anisotropy = 8;
    const bump = new THREE.CanvasTexture(cb);
    bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
    bump.repeat.set(10, 5);
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
    ctx.fillStyle = '#0e221b';
    ctx.fillRect(0, 0, w, h);
    // Subtle copper trace lines
    ctx.strokeStyle = 'rgba(42, 128, 92, 0.36)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 42; i++) {
      const y = 18 + (i * 220) / 42;
      ctx.beginPath();
      ctx.moveTo(12, y);
      ctx.lineTo(140 + (i % 5) * 35, y);
      ctx.lineTo(175 + (i % 5) * 35, y + (i % 2 === 0 ? 12 : -12));
      ctx.lineTo(w - 18, y + (i % 2 === 0 ? 12 : -12));
      ctx.stroke();
    }
    // Memory pad rings around center die area
    ctx.strokeStyle = 'rgba(202, 168, 92, 0.48)';
    ctx.strokeRect(195, 76, 110, 104);
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = '#181c24';
      const angle = (i / 8) * Math.PI * 2;
      const rx = 250 + Math.cos(angle) * 74;
      const ry = 128 + Math.sin(angle) * 62;
      ctx.fillRect(rx - 10, ry - 7, 20, 14);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    proceduralTex.pcb = tex;
    return tex;
  }

  function getContactShadowTexture() {
    if (proceduralTex.contactShadow) return proceduralTex.contactShadow;
    const size = 256;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 18, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.68)');
    g.addColorStop(0.55, 'rgba(6,4,14,0.32)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    proceduralTex.contactShadow = tex;
    return tex;
  }

  function ensureLogoImage(url) {
    const clean = String(url || '').trim();
    if (!clean) {
      loadedLogoUrl = '';
      loadedLogoImg = null;
      return;
    }
    if (clean === loadedLogoUrl) return;
    loadedLogoUrl = clean;
    loadedLogoImg = null;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (loadedLogoUrl === clean) {
        loadedLogoImg = img;
        brandTexCache.sig = '';
        hubTexCache.sig = '';
        if (renderer && gpuRoot) buildModel();
      }
    };
    img.src = clean;
  }

  function getBrandPlateTexture() {
    const brand = (config.brand || 'GRIND').trim().slice(0, 20) || 'GRIND';
    const gpuName = (config.gpuName || '').trim().slice(0, 26);
    const accent = config.accentColor || '#a855f7';
    const logoKey = loadedLogoImg ? loadedLogoUrl.slice(-32) : '';
    const sig = `${brand}|${gpuName}|${accent}|${config.body}|${logoKey}`;
    if (brandTexCache.sig === sig && brandTexCache.tex) return brandTexCache.tex;

    const c = document.createElement('canvas');
    c.width = 640; c.height = 140;
    const ctx = c.getContext('2d');

    ctx.fillStyle = config.body === 'metallic' ? '#1c212b' : '#10121a';
    ctx.fillRect(0, 0, 640, 140);

    // Subtle accent bar on left
    ctx.fillStyle = accent;
    ctx.fillRect(14, 22, 8, 96);

    let textStartX = 42;
    if (loadedLogoImg) {
      try {
        ctx.save();
        ctx.beginPath();
        ctx.roundRect?.(36, 22, 96, 96, 14);
        if (!ctx.roundRect) ctx.rect(36, 22, 96, 96);
        ctx.clip();
        ctx.drawImage(loadedLogoImg, 36, 22, 96, 96);
        ctx.restore();
        textStartX = 152;
      } catch (_) {}
    }

    ctx.fillStyle = '#f8fafc';
    ctx.font = '800 48px Inter, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(brand.toUpperCase(), textStartX, gpuName ? 54 : 70, 620 - textStartX);

    if (gpuName) {
      ctx.fillStyle = '#c4b5fd';
      ctx.font = '600 22px Inter, system-ui, sans-serif';
      ctx.fillText(gpuName, textStartX, 102, 620 - textStartX);
    }

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    brandTexCache.tex?.dispose?.();
    brandTexCache = { sig, tex };
    return tex;
  }

  function getHubTexture(fanType) {
    const brand = (config.brand || 'GRIND').trim().slice(0, 10) || 'GRIND';
    const accent = config.accentColor || '#a855f7';
    const logoKey = loadedLogoImg ? loadedLogoUrl.slice(-24) : '';
    const sig = `${brand}|${fanType}|${accent}|${logoKey}`;
    if (hubTexCache.sig === sig && hubTexCache.tex) return hubTexCache.tex;

    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(128, 128, 18, 128, 128, 124);
    g.addColorStop(0, fanType === 'gpu_smart_fans' ? '#2c3142' : '#1b1f29');
    g.addColorStop(1, '#0d1017');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(128, 128, 124, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = fanType === 'gpu_smart_fans' ? accent : '#94a3b8';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(128, 128, 110, 0, Math.PI * 2);
    ctx.stroke();

    if (loadedLogoImg) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(128, 128, 86, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(loadedLogoImg, 42, 42, 172, 172);
      ctx.restore();
    } else {
      ctx.fillStyle = '#f1f5f9';
      ctx.font = '800 36px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(brand.toUpperCase(), 128, 128, 175);
    }

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    hubTexCache.tex?.dispose?.();
    hubTexCache = { sig, tex };
    return tex;
  }

  // ---------- Shroud Silhouette Builder ----------
  function createShroudGeometry(w, h, d, shapeType) {
    const hw = w / 2;
    const hd = d / 2;
    const shape = new THREE.Shape();

    if (shapeType === 'angular') {
      const c1 = Math.min(0.18, w * 0.08, d * 0.16);
      const notch = Math.min(0.08, d * 0.08);
      shape.moveTo(-hw + c1, -hd);
      shape.lineTo(0 - w * 0.12, -hd);
      shape.lineTo(0, -hd + notch);
      shape.lineTo(0 + w * 0.12, -hd);
      shape.lineTo(hw - c1 * 1.4, -hd);
      shape.lineTo(hw, -hd + c1 * 1.3);
      shape.lineTo(hw, hd - c1 * 1.3);
      shape.lineTo(hw - c1 * 1.4, hd);
      shape.lineTo(0 + w * 0.12, hd);
      shape.lineTo(0, hd - notch);
      shape.lineTo(0 - w * 0.12, hd);
      shape.lineTo(-hw + c1, hd);
      shape.lineTo(-hw, hd - c1);
      shape.lineTo(-hw, -hd + c1);
      shape.closePath();
    } else if (shapeType === 'compact') {
      const r = Math.min(0.04, w * 0.02, d * 0.04);
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
      // 'rounded': sleek Founder-style curved aerodynamic edges
      const r = Math.min(0.24, w * 0.12, d * 0.28);
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

    const bevel = shapeType === 'compact' ? 0.015 : 0.032;
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(0.08, h - bevel * 2),
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: shapeType === 'angular' ? 1 : 4,
      curveSegments: 16
    });
    // Extrude runs along +Z; rotate -90 deg on X so depth becomes +Y height
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
      return new THREE.MeshStandardMaterial({
        color: 0xbec7d4,
        map: tex,
        bumpMap: tex,
        bumpScale: 0.008,
        metalness: 0.88,
        roughness: 0.24
      });
    }
    if (bodyType === 'carbon') {
      const { color, bump } = getCarbonTextures();
      return new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: color,
        bumpMap: bump,
        bumpScale: 0.014,
        metalness: 0.42,
        roughness: 0.28
      });
    }
    // Default unlocked 'plastic'
    return new THREE.MeshStandardMaterial({
      color: 0x2a2d3a,
      bumpMap: getPlasticBumpTexture(),
      bumpScale: 0.006,
      metalness: 0.14,
      roughness: 0.54
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

  function buildFanAssembly(fanSpec, index, x, yTop, radius, shroudMat, accentMat, rgbActive, rgbCol) {
    const fGroup = new THREE.Group();
    fGroup.position.set(x, yTop, 0);
    fGroup.userData.fanIndex = index;

    const type = fanSpec.type || 'basic';
    const isSmall = type === 'gpu_small_fans';
    const isMedium = type === 'gpu_medium_fans';
    const isSmart = type === 'gpu_smart_fans';

    // Outer recessed fan cowling ring
    const housingMat = new THREE.MeshStandardMaterial({
      color: isSmart ? 0x161a24 : 0x0f1219,
      metalness: isSmart ? 0.65 : 0.35,
      roughness: 0.36
    });
    const housing = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 1.03, radius * 1.06, 0.055, 40, 1, true),
      housingMat
    );
    housing.material.side = THREE.DoubleSide;
    housing.position.y = -0.012;
    fGroup.add(housing);

    // Highlight / RGB trim ring
    const ringMat = new THREE.MeshStandardMaterial({
      color: rgbActive ? rgbCol : isSmart ? accentMat.color : isMedium ? 0xaab4c2 : isSmall ? 0x7b8594 : 0x4b5263,
      metalness: rgbActive ? 0.3 : isSmart || isMedium ? 0.8 : 0.25,
      roughness: rgbActive ? 0.25 : 0.3,
      emissive: rgbActive ? rgbCol : (isSmart ? accentMat.color : 0x000000),
      emissiveIntensity: rgbActive ? 1.15 : isSmart ? 0.22 : 0
    });
    if (rgbActive) rgbMaterials.push(ringMat);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.99, Math.max(0.016, radius * 0.065), 14, 48), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.018;
    fGroup.add(ring);

    // Inner dark shroud floor underneath blades
    const well = new THREE.Mesh(
      new THREE.CircleGeometry(radius * 0.97, 36),
      new THREE.MeshStandardMaterial({ color: 0x090b10, roughness: 0.7, metalness: 0.2 })
    );
    well.rotation.x = -Math.PI / 2;
    well.position.y = -0.032;
    fGroup.add(well);

    // Rotor blades & center hub
    const rotor = new THREE.Group();
    rotor.position.y = 0.0;
    fGroup.add(rotor);

    const bladeCount = isSmart ? 13 : isMedium ? 11 : isSmall ? 9 : 7;
    const bladeLen = radius * 0.64;
    const bladeWid = radius * (isSmart ? 0.22 : isMedium ? 0.24 : 0.26);
    const bladePitch = isSmart ? 0.44 : isMedium ? 0.4 : 0.36;
    const bladeMat = new THREE.MeshStandardMaterial({
      color: isSmart ? 0x2c3345 : isMedium ? 0x252b38 : isSmall ? 0x1d222c : 0x1a1e26,
      metalness: isSmart ? 0.58 : isMedium ? 0.45 : 0.22,
      roughness: isSmart ? 0.26 : 0.38
    });

    // Extrude or sculpted curved blade geometry
    const bShape = new THREE.Shape();
    bShape.moveTo(0, -bladeWid * 0.36);
    bShape.quadraticCurveTo(bladeLen * 0.55, -bladeWid * (isMedium || isSmart ? 0.65 : 0.45), bladeLen, -bladeWid * 0.25);
    bShape.lineTo(bladeLen, bladeWid * 0.38);
    bShape.quadraticCurveTo(bladeLen * 0.45, bladeWid * 0.48, 0, bladeWid * 0.32);
    bShape.closePath();
    const bladeGeo = new THREE.ExtrudeGeometry(bShape, { depth: 0.014, bevelEnabled: false });
    bladeGeo.rotateX(Math.PI / 2);

    for (let i = 0; i < bladeCount; i++) {
      const a = (i / bladeCount) * Math.PI * 2;
      const pivot = new THREE.Group();
      pivot.rotation.y = a;
      const blade = new THREE.Mesh(bladeGeo, bladeMat);
      blade.position.set(radius * 0.22, 0.005, 0);
      blade.rotation.x = bladePitch;
      if (isMedium || isSmart) blade.rotation.z = 0.08;
      pivot.add(blade);
      rotor.add(pivot);
    }

    // Connected stabilizer barrier ring for Medium/Smart fans
    if (isSmart || isMedium) {
      const tipRing = new THREE.Mesh(
        new THREE.TorusGeometry(radius * 0.87, 0.012, 8, 44),
        bladeMat
      );
      tipRing.rotation.x = Math.PI / 2;
      tipRing.position.y = 0.004;
      rotor.add(tipRing);
    }

    // Center hub + branded medallion
    const hubMat = new THREE.MeshStandardMaterial({
      color: isSmart || isMedium ? 0xcbd5e1 : 0x2f3542,
      metalness: isSmart || isMedium ? 0.85 : 0.35,
      roughness: isSmart || isMedium ? 0.22 : 0.45
    });
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.26, radius * 0.28, 0.042, 32), hubMat);
    hub.position.y = 0.008;
    rotor.add(hub);

    const cap = new THREE.Mesh(
      new THREE.CircleGeometry(radius * 0.23, 32),
      new THREE.MeshStandardMaterial({
        map: getHubTexture(type),
        metalness: isSmart ? 0.55 : 0.3,
        roughness: 0.32
      })
    );
    cap.rotation.x = -Math.PI / 2;
    cap.position.y = 0.031;
    rotor.add(cap);

    // Invisible wide cylinder hit target for super-easy 3D fan dragging
    const hitMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 1.05, radius * 1.05, 0.14, 16),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hitMesh.position.y = 0.02;
    hitMesh.userData.fanIndex = index;
    fGroup.add(hitMesh);

    fansGroup.add(fGroup);
    fanAssemblies.push({
      index,
      group: fGroup,
      rotor,
      hitMesh,
      ringMesh: ring,
      ringMat,
      yTop,
      radius,
      speed: isSmart ? 3.2 : isMedium ? 2.5 : isSmall ? 2.8 : 2.0,
      baseEmissive: rgbActive ? 1.15 : isSmart ? 0.22 : 0
    });
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
    fanAssemblies = [];
    rgbMaterials = [];

    const lenScale = clamp(Number(config.length || 300) / 300, 0.6, 1.4);
    const widScale = clamp(Number(config.width || 125) / 125, 0.72, 1.44);
    const thickScale = clamp(Number(config.thickness || 52) / 52, 0.73, 1.46);

    const w = 2.85 * lenScale;
    const d = 1.18 * widScale;
    const h = 0.24 * thickScale;

    const bodyType = config.body || 'plastic';
    const shapeType = config.shroud || 'rounded';
    const rgbActive = !!config.rgb;
    const accentHex = new THREE.Color(config.accentColor || '#a855f7');
    const rgbHex = new THREE.Color(config.rgbColor || config.accentColor || '#a855f7');

    ensureLogoImage(config.logoUrl);

    const shroudMat = makeBodyMaterial(bodyType);
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x11141c, metalness: 0.42, roughness: 0.44 });
    const trimMetal = new THREE.MeshStandardMaterial({ color: 0x9aa5b5, metalness: 0.86, roughness: 0.24 });
    const accentMat = new THREE.MeshStandardMaterial({
      color: accentHex,
      metalness: bodyType === 'metallic' ? 0.72 : 0.38,
      roughness: 0.28,
      emissive: rgbActive ? rgbHex : accentHex,
      emissiveIntensity: rgbActive ? 0.55 : 0.06
    });
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xd9b15f, metalness: 0.9, roughness: 0.22 });
    const copperMat = new THREE.MeshStandardMaterial({ color: 0xc27a44, metalness: 0.88, roughness: 0.22 });
    const finMat = new THREE.MeshStandardMaterial({ color: 0xb6c0cc, metalness: 0.84, roughness: 0.28 });
    const pcbMat = new THREE.MeshStandardMaterial({
      map: getPcbTexture(),
      metalness: 0.25,
      roughness: 0.52
    });

    // ---- 1. Backplate Layer (bottom side, visible when orbiting underneath or exploded) ----
    if (config.backplate !== false) {
      const bpMat = bodyType === 'carbon'
        ? makeBodyMaterial('carbon')
        : bodyType === 'metallic'
          ? makeBodyMaterial('metallic')
          : new THREE.MeshStandardMaterial({ color: 0x1e222e, metalness: 0.52, roughness: 0.36 });
      const bpGeo = createShroudGeometry(w * 0.96, 0.04, d * 0.96, shapeType === 'angular' ? 'angular' : 'compact');
      const bp = new THREE.Mesh(bpGeo, bpMat);
      bp.position.y = -h * 0.62 - 0.065;
      bp.castShadow = !isSoftwareGl;
      bp.receiveShadow = !isSoftwareGl;
      backplateLayer.add(bp);

      // Machined backplate vents + screws
      for (let i = 0; i < 6; i++) {
        makeBox(backplateLayer, 0.022, 0.012, d * 0.52, darkMat, -w * 0.34 + i * w * 0.136, -h * 0.62 - 0.082, 0);
      }
      for (const sx of [-w * 0.41, w * 0.41]) {
        for (const sz of [-d * 0.38, d * 0.38]) {
          const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.016, 12), trimMetal);
          screw.position.set(sx, -h * 0.62 - 0.085, sz);
          backplateLayer.add(screw);
        }
      }
    }

    // ---- 2. PCB Layer + GPU Die + VRM + PCIe Gold Fingers + I/O Bracket ----
    makeBox(pcbLayer, w * 0.97, 0.036, d * 0.94, pcbMat, 0, -h * 0.42, 0);

    // Center GPU Silicon Die on PCB (visible when exploded!)
    makeBox(pcbLayer, 0.34, 0.022, 0.34, new THREE.MeshStandardMaterial({ color: 0x1d3b32, metalness: 0.3, roughness: 0.4 }), -0.06, -h * 0.42 + 0.026, 0);
    makeBox(pcbLayer, 0.19, 0.024, 0.19, new THREE.MeshStandardMaterial({ color: 0x2d3444, metalness: 0.92, roughness: 0.12 }), -0.06, -h * 0.42 + 0.038, 0);

    // Instanced VRM Chokes & Capacitors along PCB
    const chokeCount = Math.max(6, Math.round(lenScale * 10));
    const chokeMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.055, 0.036, 0.055), darkMat, chokeCount);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < chokeCount; i++) {
      dummy.position.set(-w * 0.36 + (i / (chokeCount - 1)) * w * 0.72, -h * 0.42 + 0.032, -d * 0.34);
      dummy.updateMatrix();
      chokeMesh.setMatrixAt(i, dummy.matrix);
    }
    pcbLayer.add(chokeMesh);

    // PCIe 5.0 x16 Gold Connector (front-bottom edge +z side)
    makeBox(pcbLayer, w * 0.44, 0.022, 0.11, new THREE.MeshStandardMaterial({ color: 0x162b22, roughness: 0.5 }), -w * 0.12, -h * 0.42, d * 0.49);
    makeBox(pcbLayer, w * 0.42, 0.026, 0.045, goldMat, -w * 0.12, -h * 0.42, d * 0.535);

    // 12VHPWR Power Header (back edge -z)
    makeBox(pcbLayer, 0.18, 0.068, 0.08, darkMat, w * 0.22, -h * 0.42 + 0.03, -d * 0.46);
    makeBox(pcbLayer, 0.14, 0.04, 0.02, goldMat, w * 0.22, -h * 0.42 + 0.03, -d * 0.49);

    // Dual-Slot Brushed Steel I/O Bracket (-x end)
    makeBox(pcbLayer, 0.045, h * 1.15, d * 0.96, trimMetal, -w * 0.5 - 0.02, 0, 0);
    makeBox(pcbLayer, 0.055, 0.035, d * 0.96, trimMetal, -w * 0.5 - 0.02, -h * 0.55, 0);
    for (let i = 0; i < 4; i++) {
      makeBox(pcbLayer, 0.025, 0.052, 0.11, darkMat, -w * 0.5 - 0.042, h * 0.08, -d * 0.3 + i * d * 0.2);
    }

    // ---- 3. Heatsink Layer (Instanced Aluminum Fins + Copper Heatpipes) ----
    const finCount = clamp(Math.round(w * 20), 26, 72);
    const finMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.012, h * 0.58, d * 0.84), finMat, finCount);
    for (let i = 0; i < finCount; i++) {
      const fx = -w * 0.44 + (i / (finCount - 1)) * w * 0.88;
      dummy.position.set(fx, -h * 0.05, 0);
      dummy.updateMatrix();
      finMesh.setMatrixAt(i, dummy.matrix);
    }
    finMesh.castShadow = !isSoftwareGl;
    heatsinkLayer.add(finMesh);

    // Copper cold-plate + 4 curved copper heatpipes spanning card length
    makeBox(heatsinkLayer, 0.42, 0.04, 0.42, copperMat, -0.06, -h * 0.32, 0);
    for (let i = 0; i < 4; i++) {
      const zOff = (-0.33 + i * 0.22) * d;
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-w * 0.42, -h * 0.06, zOff * 0.85),
        new THREE.Vector3(-w * 0.14, -h * 0.22, zOff * 0.45),
        new THREE.Vector3(w * 0.14, -h * 0.14, zOff * 0.9),
        new THREE.Vector3(w * 0.42, -h * 0.02, zOff * 0.85)
      ]);
      const pipe = new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 0.024, 10, false), copperMat);
      heatsinkLayer.add(pipe);
    }

    // ---- 4. Shroud Layer (Beveled ExtrudeGeometry + Side Rails + Branding Plate + RGB) ----
    const mainShroudGeo = createShroudGeometry(w, h * 0.62, d, shapeType);
    const mainShroud = new THREE.Mesh(mainShroudGeo, shroudMat);
    mainShroud.position.y = h * 0.22;
    mainShroud.castShadow = !isSoftwareGl;
    mainShroud.receiveShadow = !isSoftwareGl;
    shroudLayer.add(mainShroud);

    // Inner dark shroud deck & beveled accent trim lines
    const deckGeo = createShroudGeometry(w * 0.91, 0.055, d * 0.86, shapeType);
    const deck = new THREE.Mesh(deckGeo, darkMat);
    deck.position.y = h * 0.51;
    shroudLayer.add(deck);

    // Accent trim rails along long sides
    for (const side of [-1, 1]) {
      makeBox(shroudLayer, w * 0.78, 0.032, 0.028, accentMat, 0, h * 0.52, side * d * 0.465);
    }
    if (shapeType === 'angular') {
      // Aggressive corner winglets
      makeBox(shroudLayer, w * 0.14, 0.04, d * 0.92, accentMat, -w * 0.39, h * 0.54, 0);
      makeBox(shroudLayer, w * 0.14, 0.04, d * 0.92, accentMat, w * 0.39, h * 0.54, 0);
    }

    // Branding Nameplate on visible front side edge (+z side facing user)
    const plateW = Math.min(w * 0.54, 1.35);
    const plateH = Math.max(0.11, h * 0.48);
    makeBox(shroudLayer, plateW + 0.04, plateH + 0.025, 0.03, darkMat, 0, h * 0.26, d * 0.505);
    const brandSticker = new THREE.Mesh(
      new THREE.PlaneGeometry(plateW, plateH),
      new THREE.MeshStandardMaterial({
        map: getBrandPlateTexture(),
        roughness: 0.28,
        metalness: 0.2,
        emissive: rgbActive ? new THREE.Color(0x221038) : new THREE.Color(0x000000),
        emissiveIntensity: rgbActive ? 0.5 : 0
      })
    );
    brandSticker.position.set(0, h * 0.26, d * 0.522);
    shroudLayer.add(brandSticker);

    // Research-gated RGB Edge Glow Bars
    if (rgbActive) {
      const rgbMat = new THREE.MeshStandardMaterial({
        color: rgbHex,
        emissive: rgbHex,
        emissiveIntensity: 1.6,
        roughness: 0.2,
        metalness: 0.1
      });
      rgbMaterials.push(rgbMat);
      makeBox(shroudLayer, w * 0.86, 0.022, 0.022, rgbMat, 0, h * 0.43, d * 0.505);
      makeBox(shroudLayer, w * 0.86, 0.022, 0.022, rgbMat, 0, h * 0.43, -d * 0.505);
      makeBox(shroudLayer, w * 0.56, 0.016, 0.018, rgbMat, 0, h * 0.555, d * 0.41);
      makeBox(shroudLayer, w * 0.56, 0.016, 0.018, rgbMat, 0, h * 0.555, -d * 0.41);
    }

    // ---- 5. Customizable Fans (1..6 Interactive Raycastable Assemblies) ----
    const fans = Array.isArray(config.fans) && config.fans.length ? config.fans : [{ position: 0.28, type: 'basic' }, { position: 0.72, type: 'basic' }];
    const count = clamp(fans.length, 1, 6);
    const fanScale = clamp(Number(config.fanScale || 1), 0.7, 1.25);
    const maxSlotR = Math.min(d * 0.41, (w * 0.84) / (count * 2.02));
    const fanRadius = clamp(maxSlotR * fanScale, 0.14, d * 0.44);
    const fanYTop = h * 0.545;

    fans.slice(0, 6).forEach((f, idx) => {
      const posNorm = clamp(Number(f.position ?? ((idx + 0.5) / count)), 0.1, 0.9);
      const fx = -w / 2 + w * posNorm;
      buildFanAssembly(f, idx, fx, fanYTop, fanRadius, shroudMat, accentMat, rgbActive, rgbHex);
    });

    // Save dimensions for fan dragging bounds
    gpuRoot.userData.cardWidth = w;
    gpuRoot.userData.fanYTop = fanYTop;
  }

  // ---------- Stage UI Dock & Camera Presets ----------
  function createDock() {
    if (!stageEl || dockEl) return;
    dockEl = document.createElement('div');
    dockEl.className = 'gpu-3d-dock';
    dockEl.innerHTML =
      '<div class="gpu-3d-pills">' +
        '<button type="button" data-gpu-cam="hero" class="active">3/4 Hero</button>' +
        '<button type="button" data-gpu-cam="top">Top</button>' +
        '<button type="button" data-gpu-cam="side">Front</button>' +
        '<button type="button" data-gpu-cam="back">Backplate</button>' +
      '</div>' +
      '<div class="gpu-3d-actions">' +
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
        if (btn.dataset.gpuAct === 'spin') {
          autoSpin = !autoSpin;
          btn.classList.toggle('active', autoSpin);
        } else if (btn.dataset.gpuAct === 'explode') {
          targetExplode = targetExplode > 0.5 ? 0 : 1;
          btn.classList.toggle('active', targetExplode > 0.5);
        }
      });
    });
  }

  function setCameraPreset(preset) {
    camAnimActive = true;
    camTargetLook.x = 0; camTargetLook.y = 0.05; camTargetLook.z = 0;
    if (preset === 'top') {
      camTargetPos.x = 0.01; camTargetPos.y = 4.25; camTargetPos.z = 0.55;
    } else if (preset === 'side') {
      camTargetPos.x = 0.12; camTargetPos.y = 0.55; camTargetPos.z = 4.1;
    } else if (preset === 'back') {
      camTargetPos.x = 2.55; camTargetPos.y = -2.1; camTargetPos.z = -2.75;
    } else {
      camTargetPos.x = 2.85; camTargetPos.y = 2.35; camTargetPos.z = 3.15;
    }
  }

  // ---------- Pointer / Fan 3D Dragging ----------
  function updatePointerNdc(e) {
    if (!renderer || !pointerNdc) return;
    const rect = renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function pickFanHit(e) {
    if (!raycaster || !camera || !fanAssemblies.length) return null;
    updatePointerNdc(e);
    raycaster.setFromCamera(pointerNdc, camera);
    const hits = raycaster.intersectObjects(fanAssemblies.map(f => f.hitMesh), false);
    if (!hits.length) return null;
    const idx = hits[0].object.userData.fanIndex;
    return Number.isInteger(idx) ? { index: idx, point: hits[0].point } : null;
  }

  function setFanHighlight(activeIdx) {
    hoveredFanIndex = activeIdx;
    fanAssemblies.forEach(f => {
      const lit = f.index === activeIdx || (activeFanDrag && activeFanDrag.index === f.index);
      if (f.ringMat) {
        f.ringMat.emissiveIntensity = lit ? Math.max(1.3, f.baseEmissive) : f.baseEmissive;
      }
    });
    if (renderer?.domElement) {
      renderer.domElement.style.cursor = activeFanDrag ? 'grabbing' : activeIdx >= 0 ? 'ew-resize' : 'grab';
    }
  }

  function attachFanInteractions() {
    if (!renderer?.domElement) return;
    const dom = renderer.domElement;

    dom.addEventListener('pointerdown', e => {
      if (e.button !== 0 || contextLost) return;
      camAnimActive = false;
      const hit = pickFanHit(e);
      if (!hit) return;

      const fanAsm = fanAssemblies[hit.index];
      const w = gpuRoot?.userData?.cardWidth || 2.85;
      const worldY = (gpuRoot?.position.y || 0) + (fanAsm?.yTop || 0.14);
      dragPlane.set(new THREE.Vector3(0, 1, 0), -worldY);
      updatePointerNdc(e);
      raycaster.setFromCamera(pointerNdc, camera);
      if (raycaster.ray.intersectPlane(dragPlane, dragHitPoint)) {
        const localPoint = gpuRoot.worldToLocal(dragHitPoint.clone());
        activeFanDrag = {
          index: hit.index,
          offsetX: (fanAsm.group.position.x - localPoint.x),
          w
        };
        if (controls) controls.enabled = false;
        dom.setPointerCapture?.(e.pointerId);
        setFanHighlight(hit.index);
        e.stopPropagation();
      }
    }, true);

    dom.addEventListener('pointermove', e => {
      if (contextLost) return;
      if (activeFanDrag) {
        updatePointerNdc(e);
        raycaster.setFromCamera(pointerNdc, camera);
        if (raycaster.ray.intersectPlane(dragPlane, dragHitPoint)) {
          const localPoint = gpuRoot.worldToLocal(dragHitPoint.clone());
          const w = activeFanDrag.w || 2.85;
          const x = clamp(localPoint.x + activeFanDrag.offsetX, -w * 0.4, w * 0.4);
          const posNorm = clamp((x + w / 2) / w, 0.1, 0.9);
          const asm = fanAssemblies[activeFanDrag.index];
          if (asm) asm.group.position.x = -w / 2 + w * posNorm;
          if (Array.isArray(config.fans) && config.fans[activeFanDrag.index]) {
            config.fans[activeFanDrag.index].position = Number(posNorm.toFixed(3));
            callbacks.onFansChange?.(config.fans.map(f => ({ ...f })));
          }
        }
        return;
      }
      const hit = pickFanHit(e);
      setFanHighlight(hit ? hit.index : -1);
    });

    const releaseDrag = e => {
      if (!activeFanDrag) return;
      activeFanDrag = null;
      if (controls) controls.enabled = true;
      setFanHighlight(-1);
      try { dom.releasePointerCapture?.(e.pointerId); } catch (_) {}
    };
    dom.addEventListener('pointerup', releaseDrag);
    dom.addEventListener('pointercancel', releaseDrag);
  }

  // ---------- Frame Loop ----------
  function stepAnimation(dt) {
    elapsedSec += dt;

    // Smooth Explode transition
    currentExplode = THREE.MathUtils.damp(currentExplode, targetExplode, 7.5, dt);
    if (backplateLayer) backplateLayer.position.y = -0.34 * currentExplode;
    if (pcbLayer) pcbLayer.position.y = -0.11 * currentExplode;
    if (heatsinkLayer) heatsinkLayer.position.y = 0.08 * currentExplode;
    if (shroudLayer) shroudLayer.position.y = 0.28 * currentExplode;
    if (fansGroup) fansGroup.position.y = 0.42 * currentExplode;

    // Subtle idle float & optional Spin
    if (gpuRoot) {
      if (autoSpin) gpuRoot.rotation.y += dt * 0.48;
      else gpuRoot.rotation.y = THREE.MathUtils.damp(gpuRoot.rotation.y, 0, 3.5, dt);
    }

    // Fan blade airflow rotation
    for (const f of fanAssemblies) {
      f.rotor.rotation.y -= dt * f.speed;
    }

    // Smooth camera preset transition
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
      timerId = setTimeout(() => {
        rafId = requestAnimationFrame(loop);
      }, 40);
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
      // Auto-sync canvas size if container recently became visible
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

    // Remove initial loading placeholder immediately!
    el.querySelectorAll('.gpu-3d-loading, .gpu-3d-error').forEach(node => node.remove());

    if (renderer) {
      if (renderer.domElement.parentNode !== el) {
        el.prepend(renderer.domElement);
      }
      if (dockEl && dockEl.parentNode !== el) {
        el.appendChild(dockEl);
      }
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
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = !isSoftwareGl;
    if (!isSoftwareGl) renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    renderer.domElement.addEventListener('webglcontextlost', e => {
      e.preventDefault();
      contextLost = true;
      stopLoop();
    });
    renderer.domElement.addEventListener('webglcontextrestored', () => {
      contextLost = false;
      buildModel();
      startLoop();
    });

    el.innerHTML = '';
    el.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(34, 16 / 10, 0.1, 80);
    camera.position.set(2.85, 2.35, 3.15);

    pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();
    envTexture = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTexture;
    scene.environmentIntensity = 0.86;

    // 3-point studio lighting + grounded studio plinth
    scene.add(new THREE.HemisphereLight(0xdce6ff, 0x161224, 1.35));
    const keyLight = new THREE.DirectionalLight(0xfff6eb, 2.6);
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

    // Subtle grounded contact shadow & plinth disc
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

    // GPU root hierarchy
    gpuRoot = new THREE.Group();
    gpuRoot.position.y = 0.05;
    backplateLayer = new THREE.Group();
    pcbLayer = new THREE.Group();
    heatsinkLayer = new THREE.Group();
    shroudLayer = new THREE.Group();
    fansGroup = new THREE.Group();
    gpuRoot.add(backplateLayer, pcbLayer, heatsinkLayer, shroudLayer, fansGroup);
    scene.add(gpuRoot);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 1.9;
    controls.maxDistance = 7.8;
    controls.maxPolarAngle = Math.PI * 0.88;
    controls.target.set(0, 0.05, 0);
    controls.addEventListener('start', () => { camAnimActive = false; });

    attachFanInteractions();
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
        fans: Array.isArray(next.fans) ? next.fans.map(f => ({ ...f })) : config.fans
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

      if (gpuRoot) gpuRoot.rotation.y = 0;
      currentExplode = 0;
      camera.position.set(2.75, 2.15, 2.95);
      camera.lookAt(0, 0.05, 0);
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      const dataUrl = renderer.domElement.toDataURL('image/webp', 0.84);

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
    disposeGroupContents(plinthGroup);
    Object.values(proceduralTex).forEach(t => t?.dispose?.());
    brandTexCache.tex?.dispose?.();
    hubTexCache.tex?.dispose?.();
    envTexture?.dispose?.();
    pmremGenerator?.dispose?.();
    renderer?.dispose?.();
    renderer = null;
    scene = null;
    camera = null;
    controls = null;
    gpuRoot = null;
    dockEl = null;
  }

  window.GpuDesigner3D = { mount, update, captureSnapshot, resize, dispose };
})();