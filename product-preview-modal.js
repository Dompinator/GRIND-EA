/* ============================================================
 * GRIND-EA · Read-Only Interactive 3D Product Preview Modal
 * Supports CPU, GPU (including custom extruded shapes), & PC builds
 * Explode · Camera Views · Spin · Open Lid / Glass / Airflow · Zero Edit UI
 * ============================================================ */
(function () {
  'use strict';

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtMoney = v => (typeof money === 'function' ? money(v) : '$' + Number(v || 0).toLocaleString());
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  let THREE = null;
  let OrbitControls = null;
  let RoomEnvironment = null;
  let threePromise = null;

  let modalEl = null;
  let stageEl = null;
  let renderer = null;
  let scene = null;
  let camera = null;
  let controls = null;
  let envTex = null;
  let pmremGen = null;
  let resizeObs = null;
  let rafId = 0;
  let timerId = 0;
  let isSoftwareGl = false;
  let contextLost = false;
  let lastMs = 0;
  let elapsedSec = 0;

  let rootGroup = null;
  let currentExplode = 0;
  let targetExplode = 0;
  let currentLidOpen = 0;
  let targetLidOpen = 0;
  let autoSpin = false;
  let pcOpenGlass = true;
  let pcShowAirflow = false;
  let camAnimActive = false;
  const camTargetPos = { x: 2.8, y: 2.2, z: 2.9 };
  const camTargetLook = { x: 0, y: 0.05, z: 0 };

  // Active product & animated handles
  let activeProduct = null;
  let activeKind = 'cpu'; // 'cpu' | 'gpu' | 'pc'
  let explodeParts = []; // [{ obj, axis: 'x'|'y'|'z', base: number, delta: number }]
  let rotors = [];       // [{ obj, axis: 'y'|'z', speed: number }]
  let rainbowMats = [];  // [{ mat, offset }]
  let airflowArrows = []; // [{ mesh, basePos, mount }]
  let cpuLidMats = [];
  let pcGlassDoorObj = null;
  let pcAirflowObj = null;

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
        console.warn('Preview modal failed to load Three.js:', err);
        threePromise = null;
        return false;
      }
    })();
    return threePromise;
  }

  function detectKind(p) {
    if (!p || typeof p !== 'object') return 'cpu';
    if (typeof window.isPcProductRow === 'function' && window.isPcProductRow(p)) return 'pc';
    if (String(p.product_line || '').toLowerCase() === 'pc' || p.design_data?.pc_build) return 'pc';
    if (typeof window.isMoboProductRow === 'function' && window.isMoboProductRow(p)) return 'mobo';
    if (String(p.product_line || '').toLowerCase() === 'motherboard' || p.design_data?.mobo_build) return 'mobo';
    if (typeof window.isGpuProductRow === 'function' && window.isGpuProductRow(p)) return 'gpu';
    if (String(p.product_line || '').toLowerCase() === 'gpu') return 'gpu';
    return 'cpu';
  }

  function polySignedArea(pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % pts.length];
      a += x1 * y2 - x2 * y1;
    }
    return a * 0.5;
  }

  function pointInPolygon(px, py, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      const intersect = ((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / ((yj - yi) || 1e-9) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function distToEdges(px, py, pts) {
    let minD = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[(i + 1) % pts.length];
      const abx = bx - ax, aby = by - ay;
      const lenSq = abx * abx + aby * aby;
      const t = lenSq > 1e-8 ? clamp(((px - ax) * abx + (py - ay) * aby) / lenSq, 0, 1) : 0;
      const d = Math.hypot(px - (ax + t * abx), py - (ay + t * aby));
      if (d < minD) minD = d;
    }
    return minD;
  }

  function roundedRectGeo(w, d, depth, r, bevel = 0.01) {
    const hw = w / 2, hd = d / 2;
    const rad = Math.min(r, hw * 0.4, hd * 0.4);
    const s = new THREE.Shape();
    s.moveTo(-hw + rad, -hd);
    s.lineTo(hw - rad, -hd);
    s.quadraticCurveTo(hw, -hd, hw, -hd + rad);
    s.lineTo(hw, hd - rad);
    s.quadraticCurveTo(hw, hd, hw - rad, hd);
    s.lineTo(-hw + rad, hd);
    s.quadraticCurveTo(-hw, hd, -hw, hd - rad);
    s.lineTo(-hw, -hd + rad);
    s.quadraticCurveTo(-hw, -hd, -hw + rad, -hd);
    const g = new THREE.ExtrudeGeometry(s, {
      depth: Math.max(0.01, depth),
      bevelEnabled: bevel > 0,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 2,
      curveSegments: 12
    });
    g.rotateX(-Math.PI / 2);
    g.center();
    g.computeVertexNormals();
    return g;
  }

  function addBox(parent, w, h, d, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    if (rx || ry || rz) m.rotation.set(rx, ry, rz);
    parent.add(m);
    return m;
  }

  // ---------- CPU 3D Builder (Read-Only Preview) ----------
  function buildCpuPreview(p) {
    const spec = typeof window.resolveCpuProductSpec === 'function'
      ? window.resolveCpuProductSpec(p)
      : {
          body: p.body_type || 'gray',
          cores: Number(p.core_count || 0),
          threads: Number(p.thread_count || 0),
          cooling: p.cooling_type === 'ultra' ? 4 : p.cooling_type === 'vapor_chamber' ? 3 : p.cooling_type === 'great' ? 2 : p.cooling_type === 'built_in' ? 1 : 0,
          graphics: p.graphics_type || '',
          ai: p.design_data?.ai || '',
          vCache: p.v_cache_type || 'none',
          name: p.product_name || 'CPU',
          tier: p.cpu_tier || 'F',
          companyName: p.product_companies?.company_name || '',
          logoUrl: p.product_companies?.logo_data_url || ''
        };

    if (typeof window.CpuDesigner3D?.buildAssembly === 'function') {
      const asm = window.CpuDesigner3D.buildAssembly(THREE, spec, {
        isSoftwareGl,
        onLogoReady: () => {
          if (activeProduct === p && !modalEl?.classList.contains('hidden')) {
            clearRoot();
            buildCpuPreview(p);
          }
        }
      });
      if (asm && asm.root) {
        rootGroup.add(asm.root);
        if (asm.ihsMats?.length) cpuLidMats.push(...asm.ihsMats);
        if (asm.fanRotor) rotors.push({ obj: asm.fanRotor, axis: asm.fanAxis || 'z', speed: 6.5 });
        explodeParts.push(
          { obj: asm.pinsGroup, axis: 'y', base: asm.pinsGroup.position.y, delta: -0.52 },
          { obj: asm.pcbGroup, axis: 'y', base: asm.pcbGroup.position.y, delta: -0.22 },
          { obj: asm.interposerGroup, axis: 'y', base: asm.interposerGroup.position.y, delta: 0.04 },
          { obj: asm.diesGroup, axis: 'y', base: asm.diesGroup.position.y, delta: 0.22 },
          { obj: asm.threadsGroup, axis: 'y', base: asm.threadsGroup.position.y, delta: 0.42 },
          { obj: asm.ihsGroup, axis: 'y', base: asm.ihsGroup.position.y, delta: 0.72 },
          { obj: asm.coolingGroup, axis: 'y', base: asm.coolingGroup.position.y, delta: 1.18 }
        );
        return;
      }
    }

    const bodyCol = spec.body === 'titanium' ? 0x9aa4b5 : spec.body === 'carbon' ? 0x1b1e26 : spec.body === 'silicon' ? 0x133355 : 0x4b5260;
    const ihsCol = spec.body === 'carbon' ? 0x262a35 : spec.body === 'silicon' ? 0xc8dff2 : spec.body === 'titanium' ? 0xdde5ef : 0xc0c6d0;
    const copperMat = new THREE.MeshPhysicalMaterial({ color: 0xd67c49, metalness: 0.92, roughness: 0.20 });
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xe6be5a, metalness: 0.94, roughness: 0.18 });
    const pcbMat = new THREE.MeshPhysicalMaterial({ color: bodyCol, metalness: 0.28, roughness: 0.44, clearcoat: 0.2 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x181c26, metalness: 0.65, roughness: 0.36 });
    const alumMat = new THREE.MeshPhysicalMaterial({ color: 0xcbd5e1, metalness: 0.9, roughness: 0.24 });

    // Pins Group
    const pinsG = new THREE.Group();
    const pinGeo = new THREE.CylinderGeometry(0.019, 0.012, 0.095, 7);
    const pinPos = [];
    const gridN = 15, sp = 0.135;
    for (let ix = 0; ix < gridN; ix++) {
      for (let iz = 0; iz < gridN; iz++) {
        if (Math.abs(ix - 7) <= 2.4 && Math.abs(iz - 7) <= 2.4) continue;
        pinPos.push([(ix - 7) * sp, -0.09, (iz - 7) * sp]);
      }
    }
    const pinsMesh = new THREE.InstancedMesh(pinGeo, goldMat, pinPos.length);
    const dum = new THREE.Object3D();
    pinPos.forEach(([px, py, pz], idx) => {
      dum.position.set(px, py, pz);
      dum.updateMatrix();
      pinsMesh.setMatrixAt(idx, dum.matrix);
    });
    pinsG.add(pinsMesh);
    rootGroup.add(pinsG);
    explodeParts.push({ obj: pinsG, axis: 'y', base: 0, delta: -0.45 });

    // PCB Substrate + Interposer
    const pcbG = new THREE.Group();
    const pcbMesh = new THREE.Mesh(roundedRectGeo(2.2, 2.2, 0.07, 0.12, 0.015), pcbMat);
    pcbG.add(pcbMesh);
    const interp = new THREE.Mesh(roundedRectGeo(1.52, 1.52, 0.028, 0.06, 0.008), darkMat);
    interp.position.y = 0.05;
    pcbG.add(interp);
    rootGroup.add(pcbG);
    explodeParts.push({ obj: pcbG, axis: 'y', base: 0, delta: -0.18 });

    // Silicon Cores / Dies
    const diesG = new THREE.Group();
    const dieMat = new THREE.MeshPhysicalMaterial({ color: 0x1e4d73, metalness: 0.65, roughness: 0.12, clearcoat: 1.0, iridescence: 0.9 });
    const coreCnt = Math.max(1, Number(spec.cores || 0));
    const cols = coreCnt >= 64 ? 8 : coreCnt >= 16 ? 4 : coreCnt >= 4 ? 2 : 1;
    const rows = Math.ceil(coreCnt / cols);
    const dw = coreCnt >= 16 ? 0.17 : coreCnt >= 4 ? 0.36 : 0.56;
    const dh = coreCnt >= 16 ? 0.15 : coreCnt >= 4 ? 0.26 : 0.36;
    const chipG = roundedRectGeo(dw, dh, 0.036, 0.02, 0.005);
    for (let i = 0; i < Math.min(coreCnt, 64); i++) {
      const col = i % cols, row = Math.floor(i / cols);
      const cx = (col - (Math.min(cols, coreCnt) - 1) / 2) * (dw + 0.06);
      const cz = (row - (rows - 1) / 2) * (dh + 0.06);
      const die = new THREE.Mesh(chipG, dieMat);
      die.position.set(cx, 0.085, cz);
      diesG.add(die);
    }
    rootGroup.add(diesG);
    explodeParts.push({ obj: diesG, axis: 'y', base: 0, delta: 0.05 });

    // Thread Interconnects
    const threadsG = new THREE.Group();
    if (Number(spec.threads || 0) > 0) {
      const lanes = Math.min(14, Math.max(4, Number(spec.threads)));
      for (let i = 0; i < lanes; i++) {
        const t = (i / (lanes - 1)) * 2 - 1;
        const curve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(t * 0.18, 0.09, 0.36),
          new THREE.Vector3(t * 0.32, 0.16, 0),
          new THREE.Vector3(t * 0.42, 0.09, -0.36)
        ]);
        const pipeMat = new THREE.MeshPhysicalMaterial({
          color: i % 2 ? 0x38bdf8 : 0xf59e0b,
          emissive: i % 2 ? 0x0284c7 : 0xb45309,
          emissiveIntensity: 0.4,
          metalness: 0.85,
          roughness: 0.2
        });
        threadsG.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 14, 0.013, 8, false), pipeMat));
      }
    }
    rootGroup.add(threadsG);
    explodeParts.push({ obj: threadsG, axis: 'y', base: 0, delta: 0.20 });

    // Integrated Heat Spreader (IHS) with Laser-Etched Label Canvas
    const ihsG = new THREE.Group();
    const c = document.createElement('canvas');
    c.width = 512; c.height = 512;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#' + new THREE.Color(ihsCol).getHexString();
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = spec.body === 'carbon' ? '#eab308' : '#6366f1';
    ctx.lineWidth = 8;
    ctx.strokeRect(24, 24, 464, 464);
    ctx.fillStyle = spec.body === 'carbon' ? '#f8fafc' : '#111827';
    ctx.textAlign = 'center';
    ctx.font = '900 44px Inter, system-ui, sans-serif';
    ctx.fillText(String(spec.name || p.product_name || 'CPU').slice(0, 18), 256, 236);
    ctx.font = '700 26px Inter, system-ui, sans-serif';
    ctx.fillText(`${spec.cores || 0}C / ${spec.threads || 0}T · TIER ${spec.tier || 'F'}`, 256, 300);
    if (spec.vCache && spec.vCache !== 'none') {
      ctx.fillStyle = '#2563eb';
      ctx.fillRect(156, 340, 200, 44);
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 22px Inter, system-ui, sans-serif';
      ctx.fillText('V-CACHE', 256, 370);
    }
    const ihsTex = new THREE.CanvasTexture(c);
    ihsTex.colorSpace = THREE.SRGBColorSpace;
    const ihsTopMat = new THREE.MeshPhysicalMaterial({ map: ihsTex, metalness: 0.35, roughness: 0.38, clearcoat: 0.25, transparent: true, opacity: 1 });
    const ihsSideMat = new THREE.MeshPhysicalMaterial({ color: ihsCol, metalness: 0.65, roughness: 0.32, transparent: true, opacity: 1 });
    cpuLidMats.push(ihsTopMat, ihsSideMat);

    const ihsCrown = new THREE.Mesh(roundedRectGeo(1.68, 1.68, 0.085, 0.1, 0.02), [ihsTopMat, ihsSideMat]);
    ihsCrown.position.y = 0.12;
    ihsG.add(ihsCrown);
    rootGroup.add(ihsG);
    explodeParts.push({ obj: ihsG, axis: 'y', base: 0, delta: 0.48 });

    // Optional CPU Cooler
    const coolG = new THREE.Group();
    const coolLvl = Number(spec.cooling || 0);
    if (coolLvl > 0) {
      addBox(coolG, 1.76, 0.024, 1.76, darkMat, 0, 0.175, 0);
      addBox(coolG, 1.16, 0.06, 1.16, copperMat, 0, 0.21, 0);
      const finMat = coolLvl >= 4 ? copperMat : alumMat;
      const finCnt = coolLvl >= 2 && coolLvl < 4 ? 14 : 9;
      const topFinY = coolLvl >= 2 && coolLvl < 4 ? 0.64 : 0.42;
      for (let i = 0; i < finCnt; i++) {
        const fy = 0.25 + (i / (finCnt - 1)) * (topFinY - 0.25);
        addBox(coolG, 1.24, 0.014, 1.18, finMat, 0, fy, 0);
      }
      addBox(coolG, 1.28, 0.03, 1.22, darkMat, 0, topFinY + 0.03, 0);
      if (coolLvl >= 3) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.024, 10, 28), new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0284c7, emissiveIntensity: 1.4 }));
        ring.rotation.x = Math.PI / 2;
        ring.position.y = topFinY + 0.05;
        coolG.add(ring);
      }
    }
    rootGroup.add(coolG);
    explodeParts.push({ obj: coolG, axis: 'y', base: 0, delta: 0.88 });
  }

  // ---------- GPU 3D Builder (Supports Custom Extruded Shapes!) ----------
  function buildGpuPreview(p) {
    const cfg = typeof window.buildGpuConfigFromProduct === 'function'
      ? window.buildGpuConfigFromProduct(p)
      : {
          length: 300, width: 125, thickness: 52,
          body: p.body_type || 'plastic', finish: 'satin', shroud: 'rounded',
          primaryColor: '#222733', accentColor: '#a855f7',
          backplate: true, backplateStyle: 'solid',
          finStyle: 'silver', pipeStyle: 'copper', powerType: '12v2x6', ioStyle: 'steel',
          elements: []
        };

    if (typeof window.GpuDesigner3D?.buildAssembly === 'function') {
      const asm = window.GpuDesigner3D.buildAssembly(THREE, cfg, {
        isSoftwareGl,
        onAssetReady: () => {
          if (activeProduct === p && !modalEl?.classList.contains('hidden')) {
            clearRoot();
            buildGpuPreview(p);
          }
        }
      });
      if (asm && asm.root) {
        rootGroup.add(asm.root);
        (asm.fanRotors || []).forEach(fr => {
          if (fr?.rotor) rotors.push({ obj: fr.rotor, axis: 'y', speed: (fr.speed || 2.5) * 2.2 });
        });
        (asm.rainbowRgbMats || []).forEach(rm => {
          if (rm?.mat) rainbowMats.push({ mat: rm.mat, offset: rm.offset || 0 });
        });
        explodeParts.push(
          { obj: asm.backplateLayer, axis: 'y', base: asm.backplateLayer.position.y, delta: -0.44 },
          { obj: asm.pcbLayer, axis: 'y', base: asm.pcbLayer.position.y, delta: -0.15 },
          { obj: asm.heatsinkLayer, axis: 'y', base: asm.heatsinkLayer.position.y, delta: 0.12 },
          { obj: asm.shroudLayer, axis: 'y', base: asm.shroudLayer.position.y, delta: 0.42 },
          { obj: asm.fansGroup, axis: 'y', base: asm.fansGroup.position.y, delta: 0.42 },
          { obj: asm.elementsGroup, axis: 'y', base: asm.elementsGroup.position.y, delta: 0.42 }
        );
        return;
      }
    }

    const lenScale = clamp(Number(cfg.length || 300), 210, 360) / 300;
    const widScale = clamp(Number(cfg.width || 125), 105, 150) / 125;
    const thickScale = clamp(Number(cfg.thickness || 52) / 52, 0.72, 1.48);
    const w = 2.85 * lenScale;
    const d = 1.18 * widScale;
    const h = 0.25 * thickScale;

    const customShape = cfg.body === 'custom' ? cfg.customShape : null;
    const matBody = cfg.body === 'custom'
      ? (customShape?.material === 'metallic' || customShape?.material === 'carbon' ? customShape.material : 'plastic')
      : (cfg.body || 'plastic');
    const primCol = new THREE.Color(cfg.primaryColor || '#222733');
    const accCol = new THREE.Color(cfg.accentColor || '#a855f7');

    const bodyMat = new THREE.MeshPhysicalMaterial({
      color: primCol,
      metalness: matBody === 'metallic' ? 0.85 : matBody === 'carbon' ? 0.22 : 0.16,
      roughness: cfg.finish === 'matte' ? 0.56 : cfg.finish === 'gloss' ? 0.16 : 0.34,
      clearcoat: cfg.finish === 'gloss' ? 0.75 : 0.24
    });
    const deckMat = new THREE.MeshPhysicalMaterial({
      color: primCol.clone().multiplyScalar(0.8),
      metalness: bodyMat.metalness,
      roughness: bodyMat.roughness,
      clearcoat: bodyMat.clearcoat
    });
    const accentMat = new THREE.MeshPhysicalMaterial({ color: accCol, metalness: 0.65, roughness: 0.24, clearcoat: 0.4 });
    const trimMetal = new THREE.MeshPhysicalMaterial({ color: 0xc2cbd6, metalness: 0.92, roughness: 0.2 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x11151e, metalness: 0.55, roughness: 0.38 });
    const finMat = new THREE.MeshPhysicalMaterial({
      color: cfg.finStyle === 'black' ? 0x1e2430 : cfg.finStyle === 'copper' ? 0xd47a45 : 0xc8d2df,
      metalness: 0.9, roughness: 0.24
    });
    const pipeMat = new THREE.MeshPhysicalMaterial({
      color: cfg.pipeStyle === 'nickel' ? 0xcfd7e4 : cfg.pipeStyle === 'black' ? 0x1d222e : 0xd47a45,
      metalness: 0.92, roughness: 0.2
    });

    const buildShroudGeo = (sw, sh, sd, fanList, isDeck, flowCutout) => {
      const hw = sw / 2, hd = sd / 2;
      const shape = new THREE.Shape();
      let customPts = null;
      if (customShape && Array.isArray(customShape.points) && customShape.points.length >= 3) {
        let pts = customShape.points.map(([nx, nz]) => [clamp(Number(nx) || 0, -1, 1) * hw, clamp(Number(nz) || 0, -1, 1) * hd]);
        if (polySignedArea(pts) < 0) pts = pts.slice().reverse();
        customPts = pts;
        shape.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
        shape.closePath();
      } else if (cfg.shroud === 'angular' || cfg.shroud === 'founders' || cfg.shroud === 'triple') {
        const c1 = Math.min(0.16, sw * 0.075, sd * 0.15);
        shape.moveTo(-hw + c1, -hd); shape.lineTo(hw - c1 * 1.25, -hd);
        shape.lineTo(hw, -hd + c1 * 1.3); shape.lineTo(hw, hd - c1 * 1.3);
        shape.lineTo(hw - c1 * 1.25, hd); shape.lineTo(-hw + c1, hd);
        shape.lineTo(-hw, hd - c1); shape.lineTo(-hw, -hd + c1);
        shape.closePath();
      } else {
        const r = Math.min(0.18, sw * 0.08, sd * 0.2);
        shape.moveTo(-hw + r, -hd); shape.lineTo(hw - r, -hd);
        shape.quadraticCurveTo(hw, -hd, hw, -hd + r); shape.lineTo(hw, hd - r);
        shape.quadraticCurveTo(hw, hd, hw - r, hd); shape.lineTo(-hw + r, hd);
        shape.quadraticCurveTo(-hw, hd, -hw, hd - r); shape.lineTo(-hw, -hd + r);
        shape.quadraticCurveTo(-hw, -hd, -hw + r, -hd);
      }

      const bevel = customPts ? clamp(Number(customShape.bevel ?? 0.018), 0.002, 0.038) : 0.014;
      for (const fl of fanList) {
        let hr = fl.r * 1.03 + bevel;
        hr = Math.min(hr, hw - Math.abs(fl.fx) - 0.01, hd - 0.012);
        if (customPts) {
          if (!pointInPolygon(fl.fx, 0, customPts)) continue;
          hr = Math.min(hr, distToEdges(fl.fx, 0, customPts) - 0.018);
        }
        if (hr > 0.06) {
          const hPath = new THREE.Path();
          hPath.absarc(fl.fx, 0, hr, 0, Math.PI * 2, true);
          shape.holes.push(hPath);
        }
      }
      if (flowCutout) {
        const cx = sw * 0.26, rx = sw * 0.135, rz = sd * 0.31;
        if (cx + rx < hw - 0.04 && cx - rx > -hw + 0.04 && rz < hd - 0.04) {
          const win = new THREE.Path();
          win.moveTo(cx - rx, -rz); win.lineTo(cx - rx, rz); win.lineTo(cx + rx, rz); win.lineTo(cx + rx, -rz); win.closePath();
          shape.holes.push(win);
        }
      }

      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: Math.max(0.024, sh - bevel * 2),
        bevelEnabled: true,
        bevelThickness: isDeck ? Math.min(0.014, bevel * 0.65) : bevel,
        bevelSize: isDeck ? Math.min(0.014, bevel * 0.65) : bevel,
        bevelSegments: 2,
        curveSegments: 24
      });
      geo.rotateX(-Math.PI / 2);
      geo.computeBoundingBox();
      geo.translate(0, -(geo.boundingBox.min.y + geo.boundingBox.max.y) / 2, 0);
      geo.computeVertexNormals();
      return geo;
    };

    const fanElems = (cfg.elements || []).filter(e => e.kind === 'fan').slice(0, 6);
    const fanCount = fanElems.length;
    const fanLayouts = fanElems.map((f, idx) => {
      const pos = clamp(Number(f.position ?? ((idx + 0.5) / Math.max(1, fanCount))), 0.08, 0.92);
      const scale = clamp(Number(f.size ?? 1.0), 0.65, 1.25);
      const baseMax = Math.min(d * 0.38, (w * 0.85) / (Math.max(1, fanCount) * 2.05));
      return {
        ...f,
        fx: -w * 0.5 + w * pos,
        r: clamp(baseMax * scale, 0.11, d * 0.42)
      };
    });

    // 1. Backplate layer
    const bpGroup = new THREE.Group();
    const bpStyle = cfg.backplate === false ? 'off' : (cfg.backplateStyle || 'solid');
    if (bpStyle !== 'off') {
      const bp = new THREE.Mesh(buildShroudGeo(w * 0.96, 0.032, d * 0.95, [], false, bpStyle === 'flow_through'), bodyMat);
      bp.position.y = -h * 0.62 - 0.055;
      bpGroup.add(bp);
    }
    rootGroup.add(bpGroup);
    explodeParts.push({ obj: bpGroup, axis: 'y', base: 0, delta: -0.40 });

    // 2. PCB + Silicon Die + PCIe
    const pcbGroup = new THREE.Group();
    const pcbMesh = addBox(pcbGroup, w * 0.96, 0.032, d * 0.92, new THREE.MeshStandardMaterial({ color: 0x0f241c, metalness: 0.25, roughness: 0.45 }), 0, -h * 0.42, 0);
    pcbMesh.castShadow = false;
    addBox(pcbGroup, 0.22, 0.022, 0.22, new THREE.MeshPhysicalMaterial({ color: 0x1e4d73, metalness: 0.7, roughness: 0.12, iridescence: 0.9 }), -0.05, -h * 0.42 + 0.03, 0);
    addBox(pcbGroup, w * 0.44, 0.022, 0.085, new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.88, roughness: 0.2 }), -w * 0.13, -h * 0.42, d * 0.485);
    addBox(pcbGroup, 0.028, h * 1.12, d * 0.94, trimMetal, -w * 0.5 - 0.018, 0, 0);
    rootGroup.add(pcbGroup);
    explodeParts.push({ obj: pcbGroup, axis: 'y', base: 0, delta: -0.14 });

    // 3. Heatsink Fins & Heatpipes
    const hsGroup = new THREE.Group();
    const finCnt = clamp(Math.round(w * 28), 36, 84);
    const finGeo = new THREE.BoxGeometry(0.006, h * 0.58, d * 0.85);
    const finsMesh = new THREE.InstancedMesh(finGeo, finMat, finCnt);
    const dum = new THREE.Object3D();
    for (let i = 0; i < finCnt; i++) {
      dum.position.set(-w * 0.455 + (i / (finCnt - 1)) * w * 0.91, -h * 0.05, 0);
      dum.updateMatrix();
      finsMesh.setMatrixAt(i, dum.matrix);
    }
    hsGroup.add(finsMesh);
    for (let i = 0; i < 4; i++) {
      const zOff = (-0.30 + i * 0.20) * d;
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-w * 0.42, -h * 0.02, zOff),
        new THREE.Vector3(0, -h * 0.18, zOff * 0.6),
        new THREE.Vector3(w * 0.42, -h * 0.02, zOff)
      ]);
      hsGroup.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.018, 10, false), pipeMat));
    }
    rootGroup.add(hsGroup);
    explodeParts.push({ obj: hsGroup, axis: 'y', base: 0, delta: 0.10 });

    // 4. Shroud + Fans + RGB Strips
    const shroudG = new THREE.Group();
    const extrudeDepth = customShape ? clamp(Number(customShape.extrudeDepth ?? 1.0), 0.55, 1.75) : 1.0;
    const outerH = h * 0.62 * extrudeDepth;
    const mainY = h * 0.26 + (outerH - h * 0.62) * 0.35;
    const deckH = 0.032;
    const deckY = mainY + outerH * 0.44;

    const mainShroud = new THREE.Mesh(buildShroudGeo(w, outerH, d, fanLayouts, false, false), bodyMat);
    mainShroud.position.y = mainY;
    shroudG.add(mainShroud);

    const deck = new THREE.Mesh(buildShroudGeo(w * 0.96, deckH, d * 0.9, fanLayouts, true, false), deckMat);
    deck.position.y = deckY;
    shroudG.add(deck);

    // Side accent rails
    addBox(shroudG, w * 0.70, 0.014, 0.014, accentMat, 0, deckY + 0.012, d * 0.45);
    addBox(shroudG, w * 0.70, 0.014, 0.014, accentMat, 0, deckY + 0.012, -d * 0.45);

    // Fans inside cutouts
    fanLayouts.forEach((fl, idx) => {
      const fg = new THREE.Group();
      fg.position.set(fl.fx, mainY + 0.02, 0);
      const bladeCount = fl.fanType === 'gpu_smart_fans' ? 11 : fl.fanType === 'gpu_medium_fans' ? 9 : 7;
      const bladeHex = fl.bladeColor === 'white' ? 0xe2e8f0 : fl.bladeColor === 'silver' ? 0x9aa4b5 : 0x202532;
      const bladeMat = new THREE.MeshPhysicalMaterial({ color: bladeHex, metalness: 0.35, roughness: 0.3 });
      const rotor = new THREE.Group();
      rotor.add(new THREE.Mesh(new THREE.CylinderGeometry(fl.r * 0.24, fl.r * 0.24, outerH * 0.45, 18), darkMat));
      for (let b = 0; b < bladeCount; b++) {
        const ang = (b / bladeCount) * Math.PI * 2;
        const bp = new THREE.Group();
        bp.rotation.y = ang;
        const bm = new THREE.Mesh(new THREE.BoxGeometry(fl.r * 0.72, 0.012, fl.r * 0.20), bladeMat);
        bm.position.x = fl.r * 0.56;
        bm.rotation.x = 0.45;
        bp.add(bm);
        rotor.add(bp);
      }
      fg.add(rotor);
      rotors.push({ obj: rotor, axis: 'y', speed: 6.5 + idx * 0.6 });

      if (fl.rgbRing || fl.fanType === 'gpu_smart_fans') {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(fl.r * 0.99, 0.014, 8, 32),
          new THREE.MeshStandardMaterial({ color: accCol, emissive: accCol, emissiveIntensity: fl.rgbRing ? 1.2 : 0.3 })
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.y = outerH * 0.45;
        fg.add(ring);
      }
      shroudG.add(fg);
    });

    // RGB strips from placed elements
    (cfg.elements || []).filter(e => e.kind === 'rgb_strip').forEach(el => {
      const isRainbow = el.colorMode === 'rainbow' || el.color === 'rainbow' || !!el.rainbow;
      const cVal = new THREE.Color(isRainbow ? '#a855f7' : (el.color || cfg.accentColor || '#a855f7'));
      const rMat = new THREE.MeshStandardMaterial({ color: cVal, emissive: cVal.clone(), emissiveIntensity: 1.7 });
      if (isRainbow) rainbowMats.push({ mat: rMat, offset: 0 });
      addBox(shroudG, w * 0.84, 0.018, 0.018, rMat, 0, mainY + outerH * 0.3, -d * 0.505);
      addBox(shroudG, w * 0.84, 0.018, 0.018, rMat, 0, mainY + outerH * 0.3, d * 0.505);
    });

    rootGroup.add(shroudG);
    explodeParts.push({ obj: shroudG, axis: 'y', base: 0, delta: 0.36 });
  }

  // ---------- PC 3D Builder (Read-Only Real-Scale Preview with Explode) ----------
  function buildPcPreview(p) {
    const dData = p.design_data || {};
    const cfg = typeof window.buildPcConfigFromProduct === 'function'
      ? window.buildPcConfigFromProduct(p)
      : {
          caseSize: dData.case_size || dData.case_config?.caseSize || p.body_type || 'small',
          material: dData.case_material || dData.case_config?.material || 'steel',
          frontStyle: dData.front_style || dData.case_config?.frontStyle || 'mesh',
          primaryColor: dData.primary_color || dData.case_config?.primaryColor || '#1a1f2b',
          accentColor: dData.accent_color || dData.case_config?.accentColor || '#a855f7',
          rgbEnabled: !!(dData.rgb_enabled ?? dData.case_config?.rgbEnabled),
          rgbMode: dData.rgb_mode || dData.case_config?.rgbMode || 'solid',
          rgbColor: dData.rgb_color || dData.case_config?.rgbColor || '#a855f7',
          gpuMount: dData.gpu_mount || 'horizontal',
          openPanel: pcOpenGlass,
          showAirflow: true,
          fans: Array.isArray(dData.fans) ? dData.fans : (dData.case_config?.fans || []),
          cpu: dData.components?.cpu || null,
          gpu: dData.components?.gpu || null
        };
    cfg.openPanel = pcOpenGlass;
    cfg.showAirflow = true;

    if (typeof window.PcDesigner3D?.buildAssembly === 'function') {
      const asm = window.PcDesigner3D.buildAssembly(THREE, cfg, {
        isSoftwareGl,
        onAssetReady: () => {
          if (activeProduct === p && !modalEl?.classList.contains('hidden')) {
            clearRoot();
            buildPcPreview(p);
          }
        }
      });
      if (asm && asm.root) {
        rootGroup.add(asm.root);
        pcGlassDoorObj = asm.glassDoorGroup;
        pcAirflowObj = asm.airflowGroup;
        pcAirflowObj.visible = pcShowAirflow;
        const s = asm.dims?.camScale || 1;
        explodeParts.push(
          { obj: asm.topPanelGroup, axis: 'y', base: asm.topPanelGroup.position.y, delta: 0.95 * s },
          { obj: asm.frontGroup, axis: 'x', base: asm.frontGroup.position.x, delta: 1.05 * s },
          { obj: asm.glassDoorGroup, axis: 'z', base: asm.glassDoorGroup.position.z, delta: 1.35 * s },
          { obj: asm.motherboardGroup, axis: 'z', base: asm.motherboardGroup.position.z, delta: 0.42 * s },
          { obj: asm.cpuGroup, axis: 'z', base: asm.cpuGroup.position.z, delta: 0.85 * s },
          { obj: asm.gpuGroup, axis: 'z', base: asm.gpuGroup.position.z, delta: 1.12 * s },
          { obj: asm.cablesGroup, axis: 'z', base: asm.cablesGroup.position.z, delta: 0.52 * s }
        );
        (asm.fanRotors || []).forEach(fr => {
          if (fr?.rotor) rotors.push({ obj: fr.rotor, axis: 'z', speed: -(fr.speed || 7.0) });
        });
        (asm.cpuFanSpinners || []).forEach(fr => {
          if (fr?.rotor) rotors.push({ obj: fr.rotor, axis: fr.axis || 'y', speed: -(fr.speed || 5.0) });
        });
        (asm.rgbMats || []).forEach(mat => {
          if (mat?.userData?.rgbMode === 'rainbow') rainbowMats.push({ mat, offset: mat.userData.offset || 0 });
        });
        (asm.airflowArrows || []).forEach(a => airflowArrows.push(a));
        return;
      }
    }

    // Minimal fallback if PcDesigner3D isn't loaded
    const box = new THREE.Mesh(new THREE.BoxGeometry(3.7, 3.45, 2.08), new THREE.MeshStandardMaterial({ color: 0x1a1f2b }));
    rootGroup.add(box);
  }

  // ---------- Motherboard 3D Builder (Read-Only Preview with Layer Explode) ----------
  function buildMoboPreview(p) {
    const dData = p.design_data || {};
    const cfg = typeof window.buildMoboConfigFromProduct === 'function'
      ? window.buildMoboConfigFromProduct(p)
      : {
          boardSize: dData.board_size || p.body_type || 'small',
          ramSlots: Number(dData.ram_slots ?? 0),
          pcbColor: dData.pcb_color || '#121620',
          armorColor: dData.armor_color || '#1f2533',
          accentColor: dData.accent_color || '#a855f7',
          vrmStyle: dData.vrm_style || 'finned',
          ioShield: dData.io_shield !== false,
          m2Shield: dData.m2_shield !== false,
          rgbAccent: !!dData.rgb_accent,
          name: p.product_name || 'Motherboard',
          companyName: p.product_companies?.company_name || '',
          logoUrl: p.product_companies?.logo_data_url || ''
        };

    if (typeof window.MoboDesigner3D?.buildAssembly === 'function') {
      const asm = window.MoboDesigner3D.buildAssembly(THREE, cfg, {
        isSoftwareGl,
        onLogoReady: () => {
          if (activeProduct === p && !modalEl?.classList.contains('hidden')) {
            clearRoot();
            buildMoboPreview(p);
          }
        }
      });
      if (asm && asm.root) {
        rootGroup.add(asm.root);
        explodeParts.push(
          { obj: asm.pcbGroup, axis: 'y', base: asm.pcbGroup.position.y, delta: -0.18 },
          { obj: asm.socketGroup, axis: 'y', base: asm.socketGroup.position.y, delta: 0.28 },
          { obj: asm.ramGroup, axis: 'y', base: asm.ramGroup.position.y, delta: 0.42 },
          { obj: asm.vrmGroup, axis: 'y', base: asm.vrmGroup.position.y, delta: 0.54 },
          { obj: asm.ioGroup, axis: 'x', base: asm.ioGroup.position.x, delta: -0.40 },
          { obj: asm.pcieGroup, axis: 'y', base: asm.pcieGroup.position.y, delta: 0.34 },
          { obj: asm.heatsinksGroup, axis: 'y', base: asm.heatsinksGroup.position.y, delta: 0.64 }
        );
        return;
      }
    }

    const fallback = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 2.4), new THREE.MeshStandardMaterial({ color: 0x121620 }));
    rootGroup.add(fallback);
  }

  function applyExplodeAndStates(dt) {
    currentExplode += (targetExplode - currentExplode) * Math.min(1, dt * 8);
    for (const part of explodeParts) {
      part.obj.position[part.axis] = part.base + part.delta * currentExplode;
    }

    currentLidOpen += (targetLidOpen - currentLidOpen) * Math.min(1, dt * 8);
    if (cpuLidMats.length) {
      const op = 1 - currentLidOpen * 0.85;
      cpuLidMats.forEach(m => { m.opacity = op; });
    }
    if (pcGlassDoorObj && activeKind === 'pc') {
      const targetRot = pcOpenGlass ? -0.92 : 0;
      pcGlassDoorObj.rotation.y += (targetRot - pcGlassDoorObj.rotation.y) * Math.min(1, dt * 9);
    }
    if (pcAirflowObj) pcAirflowObj.visible = pcShowAirflow;
  }

  function setCameraPreset(preset) {
    camAnimActive = true;
    camTargetLook.x = 0; camTargetLook.y = 0.05; camTargetLook.z = 0;
    if (activeKind === 'gpu') {
      if (preset === 'top') Object.assign(camTargetPos, { x: 0.01, y: 4.3, z: 0.45 });
      else if (preset === 'side') Object.assign(camTargetPos, { x: -0.08, y: 0.35, z: -4.15 });
      else if (preset === 'end') Object.assign(camTargetPos, { x: 4.2, y: 0.5, z: -0.25 });
      else if (preset === 'back') Object.assign(camTargetPos, { x: 0.25, y: -2.35, z: 2.85 });
      else Object.assign(camTargetPos, { x: 2.9, y: 2.45, z: -3.15 });
    } else if (activeKind === 'pc') {
      const szKey = activeProduct?.design_data?.case_size || activeProduct?.design_data?.case_config?.caseSize || activeProduct?.body_type || 'small';
      const s = szKey === 'large' ? 1.44 : szKey === 'medium' ? 1.24 : 1.0;
      if (preset === 'interior') {
        Object.assign(camTargetPos, { x: 0.45 * s, y: 0.45 * s, z: 6.45 * s });
        Object.assign(camTargetLook, { x: -0.15 * s, y: 0.1 * s, z: 0 });
      } else if (preset === 'front') Object.assign(camTargetPos, { x: 6.4 * s, y: 0.6 * s, z: 1.85 * s });
      else if (preset === 'rear') Object.assign(camTargetPos, { x: -6.4 * s, y: 0.6 * s, z: 1.75 * s });
      else if (preset === 'top') Object.assign(camTargetPos, { x: 0.25 * s, y: 6.8 * s, z: 2.35 * s });
      else Object.assign(camTargetPos, { x: 4.95 * s, y: 2.95 * s, z: 5.55 * s });
    } else if (activeKind === 'mobo') {
      const szKey = activeProduct?.design_data?.board_size || activeProduct?.body_type || 'small';
      const s = szKey === 'large' ? 1.42 : szKey === 'medium' ? 1.24 : 0.96;
      if (preset === 'top') Object.assign(camTargetPos, { x: 0.01, y: 3.9 * s, z: 0.35 * s });
      else if (preset === 'io') Object.assign(camTargetPos, { x: -3.25 * s, y: 1.3 * s, z: 0.95 * s });
      else if (preset === 'ram') Object.assign(camTargetPos, { x: 2.95 * s, y: 1.65 * s, z: 1.65 * s });
      else if (preset === 'back') Object.assign(camTargetPos, { x: 0.3 * s, y: -2.5 * s, z: 2.25 * s });
      else Object.assign(camTargetPos, { x: 2.15 * s, y: 2.55 * s, z: 2.4 * s });
    } else {
      if (preset === 'top') Object.assign(camTargetPos, { x: 0, y: 3.7, z: 0.35 });
      else if (preset === 'side') Object.assign(camTargetPos, { x: 0.05, y: 0.45, z: 3.45 });
      else if (preset === 'pins') Object.assign(camTargetPos, { x: 0.3, y: -2.55, z: 2.55 });
      else Object.assign(camTargetPos, { x: 2.7, y: 2.2, z: 2.85 });
    }
  }

  function renderDockButtons() {
    const camWrap = modalEl?.querySelector('#eaPreviewCamPills');
    const actWrap = modalEl?.querySelector('#eaPreviewActBtns');
    if (!camWrap || !actWrap) return;

    const presets = activeKind === 'gpu'
      ? [['hero', '3/4 Hero'], ['top', 'Top'], ['side', 'Side'], ['end', 'End'], ['back', 'Backplate']]
      : activeKind === 'pc'
        ? [['iso', '3/4 View'], ['interior', 'Interior'], ['front', 'Front'], ['rear', 'Rear'], ['top', 'Top']]
        : activeKind === 'mobo'
          ? [['hero', '3/4 Hero'], ['top', 'Top'], ['io', 'Rear I/O'], ['ram', 'RAM / ATX'], ['back', 'Back PCB']]
          : [['hero', '3/4 View'], ['top', 'Top'], ['side', 'Side'], ['pins', 'Pins']];

    camWrap.innerHTML = presets.map(([k, lbl], idx) =>
      '<button type="button" data-prev-cam="' + k + '"' + (idx === 0 ? ' class="active"' : '') + '>' + lbl + '</button>'
    ).join('');

    camWrap.querySelectorAll('[data-prev-cam]').forEach(btn => {
      btn.addEventListener('click', () => {
        camWrap.querySelectorAll('[data-prev-cam]').forEach(x => x.classList.toggle('active', x === btn));
        setCameraPreset(btn.dataset.prevCam);
      });
    });

    const extraBtn = activeKind === 'cpu'
      ? '<button type="button" id="eaPrevLidBtn">Open Lid</button>'
      : activeKind === 'pc'
        ? '<button type="button" id="eaPrevGlassBtn" class="' + (pcOpenGlass ? 'active' : '') + '">Open Glass</button>' +
          '<button type="button" id="eaPrevAirflowBtn" class="' + (pcShowAirflow ? 'active' : '') + '">Airflow</button>'
        : '';

    actWrap.innerHTML =
      extraBtn +
      '<button type="button" id="eaPrevSpinBtn">Spin</button>' +
      '<button type="button" id="eaPrevExplodeBtn">Explode</button>' +
      '<label class="ea-preview-explode-slider"><span>Explode</span><input id="eaPrevExplodeRange" type="range" min="0" max="100" value="0"></label>';

    actWrap.querySelector('#eaPrevSpinBtn')?.addEventListener('click', e => {
      autoSpin = !autoSpin;
      e.currentTarget.classList.toggle('active', autoSpin);
    });
    const expBtn = actWrap.querySelector('#eaPrevExplodeBtn');
    const expRange = actWrap.querySelector('#eaPrevExplodeRange');
    expBtn?.addEventListener('click', () => {
      targetExplode = targetExplode > 0.5 ? 0 : 1;
      expBtn.classList.toggle('active', targetExplode > 0.5);
      if (expRange) expRange.value = String(Math.round(targetExplode * 100));
    });
    expRange?.addEventListener('input', () => {
      targetExplode = clamp(Number(expRange.value || 0) / 100, 0, 1);
      expBtn?.classList.toggle('active', targetExplode > 0.05);
    });
    actWrap.querySelector('#eaPrevLidBtn')?.addEventListener('click', e => {
      targetLidOpen = targetLidOpen > 0.5 ? 0 : 1;
      e.currentTarget.classList.toggle('active', targetLidOpen > 0.5);
    });
    actWrap.querySelector('#eaPrevGlassBtn')?.addEventListener('click', e => {
      pcOpenGlass = !pcOpenGlass;
      e.currentTarget.classList.toggle('active', pcOpenGlass);
    });
    actWrap.querySelector('#eaPrevAirflowBtn')?.addEventListener('click', e => {
      pcShowAirflow = !pcShowAirflow;
      e.currentTarget.classList.toggle('active', pcShowAirflow);
    });
  }

  function clearRoot() {
    if (!rootGroup) return;
    while (rootGroup.children.length) {
      const ch = rootGroup.children.pop();
      ch.traverse?.(obj => {
        if (obj.geometry && typeof obj.geometry.dispose === 'function') obj.geometry.dispose();
        if (obj.material) {
          const ms = Array.isArray(obj.material) ? obj.material : [obj.material];
          ms.forEach(m => m?.dispose?.());
        }
      });
    }
    explodeParts = [];
    rotors = [];
    rainbowMats = [];
    airflowArrows = [];
    cpuLidMats = [];
    pcGlassDoorObj = null;
    pcAirflowObj = null;
  }

  function stopLoop() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    if (timerId) { clearTimeout(timerId); timerId = 0; }
  }

  function disposeRenderer() {
    stopLoop();
    resizeObs?.disconnect();
    resizeObs = null;
    clearRoot();
    controls?.dispose?.();
    envTex?.dispose?.();
    pmremGen?.dispose?.();
    renderer?.dispose?.();
    renderer = null;
    scene = null;
    camera = null;
    controls = null;
    rootGroup = null;
    envTex = null;
    pmremGen = null;
  }

  function startLoop() {
    if (rafId || timerId) return;
    lastMs = performance.now();
    const tick = now => {
      rafId = 0;
      timerId = 0;
      if (!renderer || !scene || !camera || contextLost || modalEl?.classList.contains('hidden')) return;
      const dt = Math.min(0.05, Math.max(0.001, (now - lastMs) / 1000));
      lastMs = now;
      elapsedSec += dt;

      if (autoSpin && rootGroup) rootGroup.rotation.y += dt * 0.55;
      for (const r of rotors) {
        if (r.obj) r.obj.rotation[r.axis] += dt * r.speed;
      }
      for (const rm of rainbowMats) {
        const hue = (elapsedSec * 0.25 + (rm.offset || 0)) % 1;
        rm.mat.color.setHSL(hue, 0.95, 0.54);
        rm.mat.emissive.setHSL(hue, 0.95, 0.54);
      }
      airflowArrows.forEach((a, idx) => {
        const pulse = Math.sin(elapsedSec * 4.5 + idx * 0.9) * 0.07;
        a.mesh.position.copy(a.basePos);
        if (a.mount === 'front' || a.mount === 'rear') a.mesh.position.x -= pulse;
        else a.mesh.position.y += pulse;
      });

      applyExplodeAndStates(dt);

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

  function resizeStage() {
    if (!renderer || !camera || !stageEl) return;
    const w = Math.max(260, stageEl.clientWidth || 640);
    const h = Math.max(260, stageEl.clientHeight || 420);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }

  function ensureModal() {
    if (modalEl && document.body.contains(modalEl)) return modalEl;
    modalEl = document.createElement('div');
    modalEl.id = 'eaProductPreviewModal';
    modalEl.className = 'modal-backdrop hidden';
    modalEl.style.zIndex = '130';
    modalEl.setAttribute('role', 'dialog');
    modalEl.setAttribute('aria-modal', 'true');
    modalEl.innerHTML =
      '<div class="modal-card ea-preview-modal-card">' +
        '<div class="modal-head">' +
          '<div style="min-width:0;">' +
            '<div class="eyebrow purple-text" id="eaPreviewEyebrow">3D PRODUCT PREVIEW</div>' +
            '<h3 id="eaPreviewTitle" style="margin:2px 0 0;">Product</h3>' +
            '<p class="muted tiny" id="eaPreviewSubtitle" style="margin:4px 0 0;"></p>' +
          '</div>' +
          '<button type="button" class="zoom-btn" id="closeEaProductPreviewBtn" aria-label="Close">✕</button>' +
        '</div>' +
        '<div class="ea-preview-stage-wrap">' +
          '<div id="eaProductPreviewStage" class="ea-preview-stage"></div>' +
          '<div class="gpu-3d-dock ea-preview-dock">' +
            '<div class="gpu-3d-pills" id="eaPreviewCamPills"></div>' +
            '<div class="gpu-3d-actions" id="eaPreviewActBtns"></div>' +
          '</div>' +
        '</div>' +
        '<div class="ea-preview-footer" id="eaPreviewFooter"></div>' +
      '</div>';

    document.body.appendChild(modalEl);
    stageEl = modalEl.querySelector('#eaProductPreviewStage');

    const notifyPreviewClosed = () => {
      if (typeof window.onProductPreviewClosed === 'function') {
        try { window.onProductPreviewClosed(); } catch (err) { console.warn('Preview close callback failed:', err); }
      }
    };
    const closeModal = () => {
      modalEl.classList.add('hidden');
      disposeRenderer();
      notifyPreviewClosed();
    };
    modalEl.querySelector('#closeEaProductPreviewBtn')?.addEventListener('click', closeModal);
    modalEl.addEventListener('click', e => { if (e.target === modalEl) closeModal(); });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && modalEl && !modalEl.classList.contains('hidden')) closeModal();
    });
    return modalEl;
  }

  async function mountAndBuild(p) {
    const ok = await ensureThree();
    if (!ok || !stageEl) {
      if (stageEl) stageEl.innerHTML = '<div class="gpu-3d-error">3D preview unavailable on this browser.</div>';
      return;
    }

    disposeRenderer();
    isSoftwareGl = detectSoftwareWebGL();
    try {
      renderer = new THREE.WebGLRenderer({ antialias: !isSoftwareGl, alpha: true, powerPreference: 'high-performance' });
    } catch (e) {
      stageEl.innerHTML = '<div class="gpu-3d-error">WebGL 3D preview is unavailable.</div>';
      return;
    }
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    renderer.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); contextLost = true; stopLoop(); });
    renderer.domElement.addEventListener('webglcontextrestored', () => { contextLost = false; startLoop(); });

    stageEl.innerHTML = '';
    stageEl.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    pmremGen = new THREE.PMREMGenerator(renderer);
    envTex = pmremGen.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    scene.environmentIntensity = 1.05;

    scene.add(new THREE.HemisphereLight(0xe4ecff, 0x181426, 1.3));
    const key = new THREE.DirectionalLight(0xfff5e8, 2.3);
    key.position.set(activeKind === 'pc' ? 7.5 : 3.8, activeKind === 'pc' ? 10.5 : 5.5, activeKind === 'pc' ? 9.5 : 4.0);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xa78bfa, 1.4);
    rim.position.set(activeKind === 'pc' ? -8.5 : -4.0, activeKind === 'pc' ? 5.2 : 2.5, activeKind === 'pc' ? -6.5 : -3.5);
    scene.add(rim);

    camera = new THREE.PerspectiveCamera(38, 16 / 10, 0.1, 80);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = activeKind === 'pc' ? 2.4 : 1.3;
    controls.maxDistance = activeKind === 'pc' ? 18.0 : 8.5;
    controls.addEventListener('start', () => { camAnimActive = false; });

    rootGroup = new THREE.Group();
    scene.add(rootGroup);

    if (activeKind === 'gpu') buildGpuPreview(p);
    else if (activeKind === 'pc') buildPcPreview(p);
    else if (activeKind === 'mobo') buildMoboPreview(p);
    else buildCpuPreview(p);

    setCameraPreset('default');
    camera.position.set(camTargetPos.x, camTargetPos.y, camTargetPos.z);
    controls.target.set(camTargetLook.x, camTargetLook.y, camTargetLook.z);
    controls.update();
    camAnimActive = false;

    resizeObs = new ResizeObserver(() => resizeStage());
    resizeObs.observe(stageEl);
    resizeStage();
    startLoop();
  }

  async function openProductPreview(productOrId, companyNameHint = '') {
    ensureModal();
    let p = productOrId;
    if (typeof productOrId === 'string' && typeof sb !== 'undefined' && sb) {
      const { data } = await sb
        .from('product_company_products')
        .select('*,product_companies(company_name,logo_data_url)')
        .eq('id', productOrId)
        .maybeSingle();
      p = data;
    } else if (p && typeof p === 'object' && !p.design_data && p.id && typeof sb !== 'undefined' && sb) {
      const { data } = await sb
        .from('product_company_products')
        .select('*,product_companies(company_name,logo_data_url)')
        .eq('id', p.id)
        .maybeSingle();
      if (data) p = data;
    }

    if (!p) {
      if (typeof toast === 'function') toast('Could not load product preview.');
      return;
    }

    activeProduct = p;
    activeKind = detectKind(p);
    currentExplode = 0;
    targetExplode = 0;
    currentLidOpen = 0;
    targetLidOpen = 0;
    autoSpin = false;
    pcOpenGlass = true;
    pcShowAirflow = false;

    const compName = companyNameHint || p.product_companies?.company_name || 'GRIND Company';
    const specsLine = activeKind === 'pc'
      ? (window.formatPcHardwareBadges?.(p) || window.formatPcSpecLine?.(p) || 'Custom PC Build')
      : activeKind === 'mobo'
        ? (window.formatMoboHardwareBadges?.(p) || window.formatMoboSpecLine?.(p) || 'Motherboard')
        : activeKind === 'gpu'
          ? (window.formatGpuHardwareBadges?.(p) || window.formatGpuSpecLine?.(p) || 'GPU')
          : (typeof formatCpuHardwareBadges === 'function' && typeof resolveCpuProductSpec === 'function'
              ? formatCpuHardwareBadges(resolveCpuProductSpec(p))
              : `${p.core_count || 0} Cores · ${p.thread_count || 0} Threads`);

    const eyebrow = modalEl.querySelector('#eaPreviewEyebrow');
    const title = modalEl.querySelector('#eaPreviewTitle');
    const sub = modalEl.querySelector('#eaPreviewSubtitle');
    const footer = modalEl.querySelector('#eaPreviewFooter');
    if (eyebrow) eyebrow.textContent = `${activeKind === 'mobo' ? 'MOTHERBOARD' : activeKind.toUpperCase()} 3D PREVIEW · READ-ONLY`;
    if (title) title.textContent = p.product_name || 'Product';
    if (sub) sub.textContent = `by ${compName} · ${specsLine}`;
    if (footer) {
      const st = activeKind === 'gpu' && window.getGpuProductScoreTier
        ? window.getGpuProductScoreTier(p)
        : activeKind === 'mobo' && window.getMoboProductScoreTier
          ? window.getMoboProductScoreTier(p)
          : { score: Number(p.cpu_score || 0), tier: p.cpu_tier || 'F' };
      const stockTxt = Number(p.stock || 0) > 0 ? `${Number(p.stock)} in stock` : 'Out Of Stock';
      footer.innerHTML =
        `<span><b>Price:</b> ${esc(fmtMoney(p.listed_price || 0))}</span>` +
        `<span><b>Stock:</b> ${esc(stockTxt)}</span>` +
        (activeKind === 'pc' ? '<span><b>Type:</b> Custom PC Specs</span>' : `<span><b>Benchmark:</b> ${st.score} Score · ${esc(st.tier)} Tier</span>`) +
        '<span class="muted">Drag to orbit · Scroll to zoom · Explode & switch camera views</span>';
    }

    renderDockButtons();
    const captureBtn = document.createElement('button');
    captureBtn.type = 'button';
    captureBtn.className = 'primary-btn';
    captureBtn.id = 'eaPreviewUseViewBtn';
    captureBtn.textContent = 'Use this view for AD';
    captureBtn.style.marginLeft = '10px';
    captureBtn.addEventListener('click', () => {
      try {
        if (!renderer || !renderer.domElement) throw new Error('Preview is not ready');
        renderer.render(scene, camera);
        const imageData = renderer.domElement.toDataURL('image/png');
        if (typeof window.onProductPreviewCapture !== 'function') {
          if (typeof toast === 'function') toast('Open the Ad Designer first.');
          return;
        }
        window.onProductPreviewCapture(imageData);
        modalEl.classList.add('hidden');
        disposeRenderer();
        notifyPreviewClosed();
      } catch (err) {
        if (typeof toast === 'function') toast('Could not capture this preview view.');
      }
    });
    footer?.appendChild(captureBtn);
    modalEl.classList.remove('hidden');
    requestAnimationFrame(() => mountAndBuild(p));
  }

  window.openProductPreview = openProductPreview;
})();
