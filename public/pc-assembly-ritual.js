/* ============================================================
 * GRIND-EA · Interactive 3D PC Assembly Ritual
 * Triggered when finishing a PC Build:
 *   1. Seat 1:1 3D Motherboard onto brass chassis standoffs
 *   2. Drive 4 mounting screws into the Motherboard with screwdriver
 *   3. Seat 1:1 3D CPU, clamp metal retention arm & apply thermal paste
 *   4. Slide 1:1 3D GPU into PCIe slot & drive 4 GPU bracket screws
 *   5. Swing tempered glass door shut -> auto-save PC draft!
 * ============================================================ */
(function () {
  'use strict';

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  let THREE = null;
  let OrbitControls = null;
  let RoomEnvironment = null;
  let threePromise = null;

  async function ensureThree() {
    if (THREE && OrbitControls && RoomEnvironment) return true;
    if (threePromise) return threePromise;
    threePromise = (async () => {
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
        console.warn('Assembly Ritual Three.js load error:', err);
        threePromise = null;
        return false;
      }
    })();
    return threePromise;
  }

  // ---------- Tactile Procedural Web Audio Engine ----------
  let audioCtx = null;
  let muted = false;

  function getAudio() {
    if (muted) return null;
    try {
      if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        audioCtx = new AC();
      }
      if (audioCtx.state === 'suspended') audioCtx.resume();
      return audioCtx;
    } catch (_) {
      return null;
    }
  }

  function playTone(freqStart, freqEnd, dur, type = 'sine', gainPeak = 0.14, delay = 0) {
    const ctx = getAudio();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, t0);
    if (freqEnd !== freqStart) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(25, freqEnd), t0 + dur);
    }
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gainPeak, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function playSocketDrop() {
    playTone(170, 58, 0.14, 'triangle', 0.20, 0);
    playTone(1250, 680, 0.04, 'square', 0.06, 0.02);
  }

  function playMetalLatchSnap() {
    playTone(980, 1680, 0.055, 'triangle', 0.14, 0);
    playTone(2400, 1100, 0.07, 'sine', 0.12, 0.035);
    playTone(140, 48, 0.11, 'sine', 0.16, 0.04);
  }

  let lastPasteSfx = 0;
  function playPasteSquirt() {
    const now = performance.now();
    if (now - lastPasteSfx < 75) return;
    lastPasteSfx = now;
    playTone(320 + Math.random() * 90, 220, 0.045, 'sine', 0.05, 0);
  }

  function playPasteComplete() {
    playTone(523.25, 659.25, 0.12, 'sine', 0.10, 0);
    playTone(783.99, 783.99, 0.18, 'triangle', 0.09, 0.08);
  }

  function playGpuClick() {
    playTone(145, 52, 0.16, 'triangle', 0.22, 0);
    playTone(1480, 2100, 0.065, 'square', 0.07, 0.03);
    playTone(220, 440, 0.22, 'sine', 0.06, 0.08);
  }

  let lastScrewTick = 0;
  function playScrewTick(progress) {
    const now = performance.now();
    if (now - lastScrewTick < 58) return;
    lastScrewTick = now;
    const f = 540 + progress * 460;
    playTone(f, f * 0.72, 0.028, 'triangle', 0.065, 0);
  }

  function playScrewLock(idx) {
    const base = 1150 + idx * 180;
    playTone(base, base * 1.45, 0.08, 'sine', 0.14, 0);
    playTone(210, 80, 0.07, 'triangle', 0.12, 0.01);
  }

  function playDoorSlam() {
    playTone(130, 38, 0.20, 'sine', 0.26, 0);
    playTone(620, 240, 0.06, 'triangle', 0.10, 0.025);
  }

  function playBuildDone() {
    playTone(523.25, 523.25, 0.18, 'triangle', 0.11, 0);
    playTone(659.25, 659.25, 0.18, 'triangle', 0.11, 0.09);
    playTone(783.99, 783.99, 0.24, 'triangle', 0.12, 0.18);
    playTone(1046.5, 1046.5, 0.34, 'sine', 0.13, 0.27);
  }

  // ---------- 3D Tool Models (Thermal Paste Syringe & Screwdriver) ----------
  function buildSyringeMesh(T) {
    const g = new T.Group();
    const barrelMat = new T.MeshPhysicalMaterial({ color: 0xe2e8f0, metalness: 0.15, roughness: 0.22, transparent: true, opacity: 0.78 });
    const pasteCoreMat = new T.MeshStandardMaterial({ color: 0x7a8596, metalness: 0.55, roughness: 0.35 });
    const accentMat = new T.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.4, roughness: 0.28 });
    const tipMat = new T.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.9, roughness: 0.2 });

    // Tip points along -Z or -Y -> orient so tip is at (0,0,0) pointing into surface (-Z local)
    const nozzle = new T.Mesh(new T.CylinderGeometry(0.010, 0.022, 0.12, 12), tipMat);
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.z = 0.06;
    g.add(nozzle);

    const core = new T.Mesh(new T.CylinderGeometry(0.036, 0.036, 0.34, 14), pasteCoreMat);
    core.rotation.x = Math.PI / 2;
    core.position.z = 0.30;
    g.add(core);

    const barrel = new T.Mesh(new T.CylinderGeometry(0.048, 0.046, 0.38, 16), barrelMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = 0.31;
    g.add(barrel);

    const collar = new T.Mesh(new T.CylinderGeometry(0.068, 0.068, 0.025, 16), accentMat);
    collar.rotation.x = Math.PI / 2;
    collar.position.z = 0.50;
    g.add(collar);

    const plunger = new T.Mesh(new T.CylinderGeometry(0.022, 0.022, 0.26, 12), accentMat);
    plunger.rotation.x = Math.PI / 2;
    plunger.position.z = 0.63;
    g.add(plunger);

    // Slight ergonomic tilt so syringe silhouette reads clearly from camera
    g.rotation.set(0.28, -0.22, 0);
    return g;
  }

  function buildScrewdriverMesh(T) {
    const g = new T.Group();
    const shaftMat = new T.MeshPhysicalMaterial({ color: 0xdbe4f0, metalness: 0.94, roughness: 0.18 });
    const gripMat = new T.MeshStandardMaterial({ color: 0x161a24, metalness: 0.25, roughness: 0.55 });
    const accentMat = new T.MeshStandardMaterial({ color: 0xa855f7, metalness: 0.55, roughness: 0.28 });

    // Tip at (0,0,0), extends outward along +Z
    const tip = new T.Mesh(new T.ConeGeometry(0.016, 0.045, 4), shaftMat);
    tip.rotation.x = -Math.PI / 2;
    tip.position.z = 0.022;
    g.add(tip);

    const shaft = new T.Mesh(new T.CylinderGeometry(0.016, 0.016, 0.52, 12), shaftMat);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.z = 0.30;
    g.add(shaft);

    const ferrule = new T.Mesh(new T.CylinderGeometry(0.044, 0.024, 0.08, 16), accentMat);
    ferrule.rotation.x = Math.PI / 2;
    ferrule.position.z = 0.59;
    g.add(ferrule);

    const handle = new T.Mesh(new T.CylinderGeometry(0.056, 0.052, 0.42, 16), gripMat);
    handle.rotation.x = Math.PI / 2;
    handle.position.z = 0.84;
    g.add(handle);

    const cap = new T.Mesh(new T.CylinderGeometry(0.050, 0.056, 0.04, 16), accentMat);
    cap.rotation.x = Math.PI / 2;
    cap.position.z = 1.07;
    g.add(cap);

    return g;
  }

  // ---------- Modal Manager ----------
  let activeSession = null;

  function buildModalDom() {
    let modal = document.getElementById('eaPcAssemblyModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'eaPcAssemblyModal';
    modal.className = 'modal-backdrop hidden ea-asm-backdrop';
    modal.innerHTML =
      '<div class="modal-card ea-asm-card">' +
        '<div class="modal-head ea-asm-head">' +
          '<div class="ea-asm-title-wrap">' +
            '<span class="ea-asm-kicker">HARDWARE ASSEMBLY BENCH</span>' +
            '<h3 id="eaAsmTitle">Assemble PC</h3>' +
          '</div>' +
          '<div class="ea-asm-head-actions">' +
            '<button type="button" class="zoom-btn" id="eaAsmSoundBtn" title="Toggle Mechanical Sound">🔊 Sound On</button>' +
            '<button type="button" class="zoom-btn" id="eaAsmSkipBtn">Quick Save</button>' +
            '<button type="button" class="icon-btn" id="eaAsmCloseBtn" title="Cancel">✕</button>' +
          '</div>' +
        '</div>' +
        '<div id="eaAsmStepper" class="ea-asm-stepper"></div>' +
        '<div class="ea-asm-stage-wrap">' +
          '<div id="eaAsmStage" class="ea-asm-stage"></div>' +
          '<div id="eaAsmOverlayHint" class="ea-asm-overlay-hint">Right-drag to orbit · Left-drag on part to assemble</div>' +
          '<div id="eaAsmCenterToast" class="ea-asm-center-toast hidden"></div>' +
        '</div>' +
        '<div class="ea-asm-hud">' +
          '<div class="ea-asm-hud-info">' +
            '<strong id="eaAsmStepTitle">Step 1</strong>' +
            '<p id="eaAsmStepDesc">Follow the visual guide.</p>' +
          '</div>' +
          '<div class="ea-asm-progress-wrap">' +
            '<div class="ea-asm-progress-track"><div id="eaAsmProgressFill" class="ea-asm-progress-fill"></div></div>' +
            '<span id="eaAsmProgressLabel" class="ea-asm-progress-label">0%</span>' +
          '</div>' +
          '<button type="button" class="primary-btn ea-asm-act-btn" id="eaAsmHoldBtn">Hold to Install</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
    return modal;
  }

  function closeSession(invokeSkipCallback) {
    if (!activeSession) return;
    const s = activeSession;
    activeSession = null;
    s.destroyed = true;
    s.abortCtrl?.abort();
    if (s.rafId) cancelAnimationFrame(s.rafId);
    s.resizeObserver?.disconnect();
    s.controls?.dispose();
    if (s.renderer) {
      s.renderer.domElement?.remove();
      s.renderer.dispose();
    }
    s.modal.classList.add('hidden');
    if (invokeSkipCallback && typeof s.onComplete === 'function') {
      s.onComplete();
    }
  }

  async function open(pcCfg, meta, onComplete) {
    const ok = await ensureThree();
    if (!ok || typeof window.PcDesigner3D?.buildAssembly !== 'function') {
      onComplete?.();
      return;
    }

    if (activeSession) closeSession(false);

    const modal = buildModalDom();
    const stage = modal.querySelector('#eaAsmStage');
    const stepperEl = modal.querySelector('#eaAsmStepper');
    const titleEl = modal.querySelector('#eaAsmTitle');
    const stepTitleEl = modal.querySelector('#eaAsmStepTitle');
    const stepDescEl = modal.querySelector('#eaAsmStepDesc');
    const progFillEl = modal.querySelector('#eaAsmProgressFill');
    const progLblEl = modal.querySelector('#eaAsmProgressLabel');
    const holdBtn = modal.querySelector('#eaAsmHoldBtn');
    const centerToast = modal.querySelector('#eaAsmCenterToast');
    const soundBtn = modal.querySelector('#eaAsmSoundBtn');

    if (titleEl) titleEl.textContent = 'Assemble "' + (meta?.name || 'Custom PC') + '"';
    if (soundBtn) soundBtn.textContent = muted ? '🔇 Muted' : '🔊 Sound On';
    modal.classList.remove('hidden');

    const hasMobo = !!pcCfg?.motherboard;
    const hasCpu = !!pcCfg?.cpu;
    const hasGpu = !!pcCfg?.gpu;

    const steps = [];
    if (hasMobo) {
      steps.push({ id: 'seat_mobo', short: 'Motherboard', title: (steps.length + 1) + ' · Seat Motherboard onto Standoffs', desc: 'Drag inward on the 1:1 3D Motherboard (or hold button) to align & seat it onto the brass standoffs.', btn: 'Hold to Seat Motherboard' });
      steps.push({ id: 'screw_mobo', short: '4 Mobo Screws', title: (steps.length + 1) + ' · Screw Motherboard into Standoffs', desc: 'Click & hold each of the 4 corner screws with the 3D screwdriver until driven flush (0/4).', btn: 'Drive Next Screw' });
    }
    if (hasCpu) {
      steps.push({ id: 'seat_cpu', short: 'Seat CPU', title: (steps.length + 1) + ' · Seat CPU into Socket', desc: 'Drag straight inward on the CPU (or hold button) to align & seat gold pins into the motherboard socket.', btn: 'Hold to Seat CPU' });
      steps.push({ id: 'close_latch', short: 'Metal Latch', title: (steps.length + 1) + ' · Shut Metal Retention Arm', desc: 'Drag downward on the brushed steel bracket & lever arm until it snaps locked over the CPU.', btn: 'Hold to Clamp Shut' });
      steps.push({ id: 'thermal_paste', short: 'Thermal Paste', title: (steps.length + 1) + ' · Apply Thermal Paste', desc: 'Drag back & forth across the exposed CPU IHS with the 3D syringe to coat thermal compound.', btn: 'Hold to Squeeze Paste' });
    }
    if (hasGpu) {
      steps.push({ id: 'seat_gpu', short: 'Install GPU', title: (steps.length + 1) + ' · Seat GPU in PCIe Slot', desc: 'Slide your 1:1 3D GPU cleanly into the reinforced PCIe x16 slot until it locks.', btn: 'Hold to Seat GPU' });
      steps.push({ id: 'screw_gpu', short: '4 GPU Screws', title: (steps.length + 1) + ' · Tighten 4 Bracket Screws', desc: 'Click & hold each of the 4 chrome screws with the 3D screwdriver until driven flush (0/4).', btn: 'Drive Next Screw' });
    }
    steps.push({ id: 'close_panel', short: 'Shut Glass', title: (steps.length + 1) + ' · Shut Tempered Glass Panel', desc: 'Swing the hinged tempered glass door shut to seal the build & save your draft!', btn: 'Hold to Close Door' });

    // Setup Three.js Scene
    stage.innerHTML = '';
    const w0 = Math.max(460, stage.clientWidth || 760);
    const h0 = Math.max(360, stage.clientHeight || 460);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w0, h0, false);
    stage.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 1.1;
    pmrem.dispose();

    scene.add(new THREE.HemisphereLight(0xe6eeff, 0x161224, 1.25));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.55);
    keyLight.position.set(6.5, 9.5, 9.5);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0xa855f7, 0.9);
    rimLight.position.set(-7.5, 5.0, -6.5);
    scene.add(rimLight);
    const benchLight = new THREE.PointLight(0x38bdf8, 0.65, 14);
    benchLight.position.set(1.5, 1.8, 3.8);
    scene.add(benchLight);

    const camera = new THREE.PerspectiveCamera(38, w0 / h0, 0.05, 80);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.minDistance = 0.85;
    controls.maxDistance = 16.0;
    // Left-click is reserved for direct assembly gestures; Right-click / Wheel orbits & zooms!
    controls.mouseButtons = {
      LEFT: null,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE
    };

    const asmState = {
      latchOpen: hasCpu,
      hideCpuCooler: hasCpu && Number(pcCfg?.cpu?.cooling || 0) > 0,
      unscrewedMobo: hasMobo,
      unscrewedGpu: hasGpu
    };

    const buildCfg = { ...pcCfg, openPanel: true };
    const pcAsm = window.PcDesigner3D.buildAssembly(THREE, buildCfg, {
      assembly: asmState
    });
    scene.add(pcAsm.root);

    // 3D Tools (Syringe & Screwdriver)
    const syringeTool = buildSyringeMesh(THREE);
    syringeTool.visible = false;
    scene.add(syringeTool);

    const screwdriverTool = buildScrewdriverMesh(THREE);
    screwdriverTool.visible = false;
    scene.add(screwdriverTool);

    // Thermal Paste Material & Droplets container on pasteAnchor
    const pasteMat = new THREE.MeshPhysicalMaterial({
      color: 0x7b8696,
      metalness: 0.42,
      roughness: 0.28,
      clearcoat: 0.88,
      clearcoatRoughness: 0.12
    });
    const pasteDrops = [];

    // Highlight rings for CPU socket & GPU slot
    const socketGlowMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.0, side: THREE.DoubleSide });
    const socketGlowRing = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.38, 28), socketGlowMat);
    socketGlowRing.position.set(pcAsm.sockPos.x, pcAsm.sockPos.y, pcAsm.sockPos.z + 0.08);
    pcAsm.motherboardGroup.add(socketGlowRing);

    const abortCtrl = new AbortController();
    const moboScrewsList = pcAsm.moboScrews || [];
    const gpuScrewsList = pcAsm.gpuScrews || [];
    const session = {
      modal,
      renderer,
      controls,
      destroyed: false,
      abortCtrl,
      rafId: 0,
      resizeObserver: null,
      onComplete,
      stepIdx: 0,
      moboProgress: hasMobo ? 0 : 1,
      moboScrewProgress: moboScrewsList.map(() => 0),
      activeMoboScrewIdx: 0,
      hoveredMoboScrewIdx: -1,
      cpuProgress: 0,      // 0..1
      latchProgress: 0,    // 0..1
      pasteProgress: 0,    // 0..1
      coolerDropT: hasCpu && asmState.hideCpuCooler ? 0 : 1,
      coolerDropping: false,
      gpuProgress: 0,      // 0..1
      screwProgress: gpuScrewsList.length ? gpuScrewsList.map(() => 0) : [0, 0, 0, 0], // each 0..1
      activeScrewIdx: 0,
      doorProgress: 0,     // 0..1
      finished: false,
      holdDown: false,
      pointerDragActive: false,
      lastPointer: { x: 0, y: 0 },
      hoveredScrewIdx: -1
    };
    activeSession = session;

    // Initial pre-assembled mechanical offsets (strictly staged: Mobo -> Screws -> CPU -> GPU -> Door)
    const MOBO_HOVER_Z = 0.88;
    const CPU_HOVER_Z = 0.65;
    const GPU_HOVER_DIST = 0.92;

    if (hasMobo && pcAsm.motherboardGroup) {
      pcAsm.motherboardGroup.position.z = MOBO_HOVER_Z;
      if (pcAsm.cablesGroup) pcAsm.cablesGroup.visible = false;
      moboScrewsList.forEach(sc => {
        sc.wrap.visible = false;
        sc.pivot.position.z = 0.135;
      });
    }
    if (hasCpu && pcAsm.cpuHolder) {
      pcAsm.cpuHolder.position.z = pcAsm.cpuDockedPos.z + CPU_HOVER_Z;
      if (hasMobo) pcAsm.cpuHolder.visible = false;
    }
    if (hasGpu && pcAsm.gpuHolder) {
      if (pcAsm.isVerticalGpu) {
        pcAsm.gpuHolder.position.y = pcAsm.gpuDockedPos.y + GPU_HOVER_DIST * 0.72;
        pcAsm.gpuHolder.position.z = pcAsm.gpuDockedPos.z + GPU_HOVER_DIST * 0.55;
      } else {
        pcAsm.gpuHolder.position.z = pcAsm.gpuDockedPos.z + GPU_HOVER_DIST;
      }
      if (hasMobo || hasCpu) {
        if (pcAsm.gpuGroup) pcAsm.gpuGroup.visible = false;
        if (pcAsm.cablesGroup) pcAsm.cablesGroup.visible = false;
      }
      // Dim RGB & freeze GPU fans until seated & screwed!
      (pcAsm.gpuAsm?.fanRotors || []).forEach(fr => { fr._paused = true; });
    }
    if (pcAsm.glassDoorGroup) {
      pcAsm.glassDoorGroup.rotation.y = -1.02;
    }

    // GPU Screw initial protrusion (+0.115 outward along local Z)
    gpuScrewsList.forEach(sc => {
      sc.pivot.position.z = 0.115;
      sc.wrap.visible = false;
    });

    // Camera transition state
    const camGoalPos = new THREE.Vector3();
    const camGoalLook = new THREE.Vector3();
    let camTransitioning = false;

    function focusCameraForStep(stepId) {
      const s = pcAsm.dims.camScale || 1.0;
      if (stepId === 'seat_mobo') {
        camGoalPos.set(1.25 * s, 1.35 * s, 4.45 * s);
        camGoalLook.set(-0.25 * s, 0.1 * s, 0.1);
      } else if (stepId === 'screw_mobo') {
        if (moboScrewsList.length) {
          const avg = new THREE.Vector3();
          moboScrewsList.forEach(sc => avg.add(sc.wrap.position));
          avg.divideScalar(moboScrewsList.length);
          camGoalPos.set(avg.x + 0.95 * s, avg.y + 0.45 * s, avg.z + 2.85 * s);
          camGoalLook.copy(avg);
        } else {
          camGoalPos.set(0.95 * s, 0.55 * s, 3.25 * s);
          camGoalLook.set(-0.2 * s, 0.1 * s, 0);
        }
      } else if (stepId === 'seat_cpu' || stepId === 'close_latch') {
        const sp = pcAsm.sockPos;
        camGoalPos.set(sp.x + 1.05 * s, sp.y + 0.62 * s, sp.z + 2.35 * s);
        camGoalLook.set(sp.x + 0.08, sp.y, sp.z + 0.08);
      } else if (stepId === 'thermal_paste') {
        const sp = pcAsm.sockPos;
        camGoalPos.set(sp.x + 0.45 * s, sp.y + 0.25 * s, sp.z + 1.65 * s);
        camGoalLook.set(sp.x, sp.y, sp.z + 0.08);
      } else if (stepId === 'seat_gpu') {
        const gp = pcAsm.gpuDockedPos;
        camGoalPos.set(gp.x + 1.4 * s, gp.y + 0.85 * s, gp.z + 2.85 * s);
        camGoalLook.set(gp.x - 0.2, gp.y, gp.z - 0.1);
      } else if (stepId === 'screw_gpu') {
        if (gpuScrewsList.length) {
          const avg = new THREE.Vector3();
          gpuScrewsList.forEach(sc => avg.add(sc.wrap.position));
          avg.divideScalar(gpuScrewsList.length);
          camGoalPos.set(avg.x + 1.35, avg.y + 0.42, avg.z + 1.45);
          camGoalLook.copy(avg);
        }
      } else {
        camGoalPos.set(4.8 * s, 2.55 * s, 5.45 * s);
        camGoalLook.set(0, 0.05, 0);
      }
      camTransitioning = true;
    }

    let flashTimer = 0;
    function flashBanner(msg) {
      if (!centerToast) return;
      centerToast.textContent = msg;
      centerToast.classList.remove('hidden');
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => centerToast.classList.add('hidden'), 1100);
    }

    function syncStepperUi() {
      const cur = steps[session.stepIdx];
      if (!cur) return;
      if (stepperEl) {
        stepperEl.innerHTML = steps.map((st, i) => {
          const cls = i < session.stepIdx ? 'done' : i === session.stepIdx ? 'active' : '';
          return '<div class="ea-asm-step-item ' + cls + '"><b>' + (i < session.stepIdx ? '✓' : (i + 1)) + '</b><span>' + st.short + '</span></div>';
        }).join('');
      }
      if (stepTitleEl) stepTitleEl.textContent = cur.title;
      if (stepDescEl) stepDescEl.textContent = cur.desc;
      if (holdBtn) {
        holdBtn.textContent = cur.btn;
        holdBtn.disabled = false;
      }

      if (cur.id === 'screw_mobo') {
        moboScrewsList.forEach(sc => { sc.wrap.visible = true; });
      }
      if (cur.id === 'seat_gpu') {
        if (pcAsm.gpuGroup) pcAsm.gpuGroup.visible = true;
        if (pcAsm.gpuHolder) pcAsm.gpuHolder.visible = true;
      }
      if (cur.id === 'screw_gpu') {
        gpuScrewsList.forEach(sc => { sc.wrap.visible = true; });
      }

      syringeTool.visible = (cur.id === 'thermal_paste');
      screwdriverTool.visible = (cur.id === 'screw_mobo' || cur.id === 'screw_gpu');
      if (cur.id === 'screw_mobo' && moboScrewsList[0]) {
        const sc = moboScrewsList[session.activeMoboScrewIdx] || moboScrewsList[0];
        const hoverTip = new THREE.Vector3(0, 0, 0.09 + 0.135);
        sc.wrap.localToWorld(hoverTip);
        screwdriverTool.position.copy(hoverTip);
        screwdriverTool.quaternion.copy(sc.wrap.getWorldQuaternion(new THREE.Quaternion()));
      } else if (cur.id === 'screw_gpu' && gpuScrewsList[0]) {
        const sc = gpuScrewsList[session.activeScrewIdx] || gpuScrewsList[0];
        const hoverTip = new THREE.Vector3(0, 0, 0.09 + 0.115);
        sc.wrap.localToWorld(hoverTip);
        screwdriverTool.position.copy(hoverTip);
        screwdriverTool.quaternion.copy(sc.wrap.getWorldQuaternion(new THREE.Quaternion()));
      }

      focusCameraForStep(cur.id);
    }

    function updateProgressBar(pct, label) {
      const p = clamp(Math.round(pct * 100), 0, 100);
      if (progFillEl) progFillEl.style.width = p + '%';
      if (progLblEl) progLblEl.textContent = label || (p + '%');
    }

    function advanceStep() {
      session.holdDown = false;
      session.pointerDragActive = false;
      if (session.stepIdx + 1 < steps.length) {
        session.stepIdx += 1;
        syncStepperUi();
      } else if (!session.finished) {
        session.finished = true;
        playBuildDone();
        flashBanner('Build Complete & Sealed!');
        if (holdBtn) {
          holdBtn.disabled = true;
          holdBtn.textContent = 'Saving PC…';
        }
        setTimeout(() => {
          closeSession(true);
        }, 720);
      }
    }

    // Raycaster helpers for thermal paste + 4 screws + drag gestures
    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();

    // Invisible generous hit spheres for the 4 Motherboard screws + 4 GPU screws
    const moboScrewHitMeshes = moboScrewsList.map((sc, idx) => {
      const hm = new THREE.Mesh(
        new THREE.SphereGeometry(0.18, 10, 10),
        new THREE.MeshBasicMaterial({ visible: false })
      );
      hm.userData.moboScrewIdx = idx;
      sc.wrap.add(hm);
      return hm;
    });

    const screwHitMeshes = gpuScrewsList.map((sc, idx) => {
      const hm = new THREE.Mesh(
        new THREE.SphereGeometry(0.15, 10, 10),
        new THREE.MeshBasicMaterial({ visible: false })
      );
      hm.userData.screwIdx = idx;
      sc.wrap.add(hm);
      return hm;
    });

    // Thermal paste target plane over CPU IHS
    const pasteHitPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.55, 0.55),
      new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
    );
    pasteHitPlane.position.z = 0.03;
    pcAsm.pasteAnchor.add(pasteHitPlane);

    function setNdcFromEvent(e) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    }

    function depositThermalPasteAt(worldPt) {
      if (pasteDrops.length > 90 || session.pasteProgress >= 1) return;
      const localPt = pcAsm.pasteAnchor.worldToLocal(worldPt.clone());
      // Keep paste neatly inside the IHS square bounds
      localPt.x = clamp(localPt.x, -0.145, 0.145);
      localPt.y = clamp(localPt.y, -0.145, 0.145);
      localPt.z = 0.012;

      const lastDrop = pasteDrops[pasteDrops.length - 1];
      if (lastDrop && lastDrop.position.distanceTo(localPt) < 0.022) {
        return;
      }
      const r = 0.026 + Math.random() * 0.008;
      const blob = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), pasteMat);
      blob.scale.set(1.05, 1.05, 0.45);
      blob.position.copy(localPt);
      pcAsm.pasteAnchor.add(blob);
      pasteDrops.push(blob);
      playPasteSquirt();

      session.pasteProgress = clamp(session.pasteProgress + 0.072, 0, 1);
      if (session.pasteProgress >= 1) {
        playPasteComplete();
        if (asmState.hideCpuCooler && pcAsm.cpuAsm?.coolingGroup) {
          pcAsm.cpuAsm.coolingGroup.visible = true;
          pcAsm.cpuAsm.coolingGroup.position.y = 0.85;
          session.coolerDropping = true;
          flashBanner('Thermal Paste Applied · Mounting Cooler!');
        } else {
          flashBanner('Thermal Paste Applied!');
        }
        setTimeout(() => {
          if (!session.destroyed && steps[session.stepIdx]?.id === 'thermal_paste') advanceStep();
        }, asmState.hideCpuCooler ? 550 : 280);
      }
    }

    function applyStepDelta(stepId, delta) {
      if (delta <= 0 || session.finished) return;
      if (stepId === 'seat_mobo') {
        session.moboProgress = clamp(session.moboProgress + delta, 0, 1);
        const eased = 1 - Math.pow(1 - session.moboProgress, 2.1);
        pcAsm.motherboardGroup.position.z = MOBO_HOVER_Z * (1 - eased);
        if (session.moboProgress >= 1) {
          pcAsm.motherboardGroup.position.z = 0;
          playSocketDrop();
          flashBanner('Motherboard Seated on Standoffs!');
          advanceStep();
        }
      } else if (stepId === 'screw_mobo') {
        const screws = moboScrewsList;
        if (!screws.length) { advanceStep(); return; }
        let sIdx = session.activeMoboScrewIdx;
        if (sIdx < 0 || sIdx >= screws.length || session.moboScrewProgress[sIdx] >= 1) {
          sIdx = session.moboScrewProgress.findIndex(v => v < 1);
          session.activeMoboScrewIdx = sIdx;
        }
        if (sIdx === -1) return;

        const prev = session.moboScrewProgress[sIdx];
        const next = clamp(prev + delta * 1.45, 0, 1);
        session.moboScrewProgress[sIdx] = next;
        const sc = screws[sIdx];
        sc.pivot.position.z = 0.135 * (1 - next);
        sc.pivot.rotation.z = -next * Math.PI * 7.5;
        playScrewTick(next);

        const tipWorld = new THREE.Vector3(0, 0, 0.045 + 0.135 * (1 - next));
        sc.wrap.localToWorld(tipWorld);
        screwdriverTool.visible = true;
        screwdriverTool.position.copy(tipWorld);
        screwdriverTool.quaternion.copy(sc.wrap.getWorldQuaternion(new THREE.Quaternion()));
        screwdriverTool.rotateZ(-next * Math.PI * 7.5);

        if (next >= 1 && prev < 1) {
          sc.seated = true;
          playScrewLock(sIdx);
          const doneCount = session.moboScrewProgress.filter(v => v >= 1).length;
          if (stepDescEl) {
            stepDescEl.textContent = 'Click & hold each of the 4 corner screws with the 3D screwdriver until driven flush (' + doneCount + '/4).';
          }
          if (doneCount >= screws.length) {
            if (pcAsm.cpuHolder) pcAsm.cpuHolder.visible = true;
            if (!hasGpu && pcAsm.cablesGroup) pcAsm.cablesGroup.visible = true;
            flashBanner('Motherboard Secured to Standoffs!');
            setTimeout(() => {
              if (!session.destroyed && steps[session.stepIdx]?.id === 'screw_mobo') advanceStep();
            }, 320);
          } else {
            const nxt = session.moboScrewProgress.findIndex(v => v < 1);
            if (nxt !== -1) session.activeMoboScrewIdx = nxt;
          }
        }
      } else if (stepId === 'seat_cpu') {
        session.cpuProgress = clamp(session.cpuProgress + delta, 0, 1);
        const eased = 1 - Math.pow(1 - session.cpuProgress, 2.2);
        pcAsm.cpuHolder.position.z = pcAsm.cpuDockedPos.z + CPU_HOVER_Z * (1 - eased);
        if (session.cpuProgress >= 1) {
          pcAsm.cpuHolder.position.z = pcAsm.cpuDockedPos.z;
          playSocketDrop();
          flashBanner('CPU Seated in Socket!');
          advanceStep();
        }
      } else if (stepId === 'close_latch') {
        session.latchProgress = clamp(session.latchProgress + delta, 0, 1);
        const p = session.latchProgress;
        const hoodT = clamp(p / 0.68, 0, 1);
        const leverT = clamp((p - 0.35) / 0.65, 0, 1);
        pcAsm.ilmHoodPivot.rotation.x = -1.18 * (1 - hoodT * hoodT);
        pcAsm.ilmLeverPivot.rotation.x = 1.28 * (1 - Math.pow(leverT, 1.8));
        if (p >= 1) {
          pcAsm.ilmHoodPivot.rotation.x = 0;
          pcAsm.ilmLeverPivot.rotation.x = 0;
          playMetalLatchSnap();
          flashBanner('Retention Bracket Locked!');
          advanceStep();
        }
      } else if (stepId === 'thermal_paste') {
        // Fallback hold-button spiral paste application
        const idx = pasteDrops.length;
        const t = idx * 0.42;
        const rad = 0.11 * Math.sin(t * 0.45);
        const localPt = new THREE.Vector3(Math.cos(t) * rad, Math.sin(t) * rad, 0.012);
        const worldPt = pcAsm.pasteAnchor.localToWorld(localPt);
        syringeTool.position.copy(worldPt).add(new THREE.Vector3(0.02, 0.02, 0.05));
        depositThermalPasteAt(worldPt);
      } else if (stepId === 'seat_gpu') {
        session.gpuProgress = clamp(session.gpuProgress + delta, 0, 1);
        const eased = 1 - Math.pow(1 - session.gpuProgress, 2);
        if (pcAsm.isVerticalGpu) {
          pcAsm.gpuHolder.position.y = pcAsm.gpuDockedPos.y + GPU_HOVER_DIST * 0.72 * (1 - eased);
          pcAsm.gpuHolder.position.z = pcAsm.gpuDockedPos.z + GPU_HOVER_DIST * 0.55 * (1 - eased);
        } else {
          pcAsm.gpuHolder.position.z = pcAsm.gpuDockedPos.z + GPU_HOVER_DIST * (1 - eased);
        }
        if (session.gpuProgress >= 1) {
          pcAsm.gpuHolder.position.set(pcAsm.gpuDockedPos.x, pcAsm.gpuDockedPos.y, pcAsm.gpuDockedPos.z);
          if (pcAsm.cablesGroup) pcAsm.cablesGroup.visible = true;
          playGpuClick();
          flashBanner('GPU Click-Locked in PCIe Slot!');
          advanceStep();
        }
      } else if (stepId === 'screw_gpu') {
        const screws = gpuScrewsList;
        if (!screws.length) { advanceStep(); return; }
        let sIdx = session.activeScrewIdx;
        if (sIdx < 0 || sIdx >= screws.length || session.screwProgress[sIdx] >= 1) {
          sIdx = session.screwProgress.findIndex(v => v < 1);
          session.activeScrewIdx = sIdx;
        }
        if (sIdx === -1) return;

        const prev = session.screwProgress[sIdx];
        const next = clamp(prev + delta * 1.45, 0, 1);
        session.screwProgress[sIdx] = next;
        const sc = screws[sIdx];
        sc.pivot.position.z = 0.115 * (1 - next);
        sc.pivot.rotation.z = -next * Math.PI * 7.5; // 3.75 full turns!
        playScrewTick(next);

        // Snap screwdriver smoothly onto the active screw head
        const tipWorld = new THREE.Vector3(0, 0, 0.045 + 0.115 * (1 - next));
        sc.wrap.localToWorld(tipWorld);
        screwdriverTool.visible = true;
        screwdriverTool.position.copy(tipWorld);
        screwdriverTool.quaternion.copy(sc.wrap.getWorldQuaternion(new THREE.Quaternion()));
        screwdriverTool.rotateZ(-next * Math.PI * 7.5);

        if (next >= 1 && prev < 1) {
          sc.seated = true;
          playScrewLock(sIdx);
          const doneCount = session.screwProgress.filter(v => v >= 1).length;
          if (stepDescEl) {
            stepDescEl.textContent = 'Click & hold each of the 4 chrome screws with the 3D screwdriver until driven flush (' + doneCount + '/4).';
          }
          if (doneCount >= screws.length) {
            // Spin up GPU fans & illuminate RGB!
            flashBanner('All 4 GPU Screws Torqued!');
            setTimeout(() => {
              if (!session.destroyed && steps[session.stepIdx]?.id === 'screw_gpu') advanceStep();
            }, 320);
          } else {
            const nxt = session.screwProgress.findIndex(v => v < 1);
            if (nxt !== -1) session.activeScrewIdx = nxt;
          }
        }
      } else if (stepId === 'close_panel') {
        session.doorProgress = clamp(session.doorProgress + delta, 0, 1);
        const eased = 1 - Math.pow(1 - session.doorProgress, 2.1);
        pcAsm.glassDoorGroup.rotation.y = -1.02 * (1 - eased);
        if (session.doorProgress >= 1) {
          pcAsm.glassDoorGroup.rotation.y = 0;
          playDoorSlam();
          advanceStep();
        }
      }
    }

    // Pointer Event Wiring on 3D Canvas
    const domEl = renderer.domElement;
    domEl.addEventListener('contextmenu', e => e.preventDefault());

    domEl.addEventListener('pointerdown', e => {
      if (e.button !== 0 || session.finished) return;
      camTransitioning = false;
      setNdcFromEvent(e);
      session.pointerDragActive = true;
      session.lastPointer = { x: e.clientX, y: e.clientY };

      const cur = steps[session.stepIdx];
      if (!cur) return;

      if (cur.id === 'screw_mobo') {
        raycaster.setFromCamera(pointerNdc, camera);
        const hits = raycaster.intersectObjects(moboScrewHitMeshes, false);
        if (hits.length) {
          const hitIdx = hits[0].object.userData.moboScrewIdx;
          if (session.moboScrewProgress[hitIdx] < 1) {
            session.activeMoboScrewIdx = hitIdx;
          }
        }
      } else if (cur.id === 'screw_gpu') {
        raycaster.setFromCamera(pointerNdc, camera);
        const hits = raycaster.intersectObjects(screwHitMeshes, false);
        if (hits.length) {
          const hitIdx = hits[0].object.userData.screwIdx;
          if (session.screwProgress[hitIdx] < 1) {
            session.activeScrewIdx = hitIdx;
          }
        }
      } else if (cur.id === 'thermal_paste') {
        raycaster.setFromCamera(pointerNdc, camera);
        const hits = raycaster.intersectObject(pasteHitPlane, false);
        if (hits.length) {
          depositThermalPasteAt(hits[0].point);
        }
      }
    });

    window.addEventListener('pointermove', e => {
      if (session.destroyed) return;
      const cur = steps[session.stepIdx];
      if (!cur) return;

      setNdcFromEvent(e);

      // Update hovered tool position even before clicking!
      if (cur.id === 'thermal_paste') {
        raycaster.setFromCamera(pointerNdc, camera);
        const hits = raycaster.intersectObject(pasteHitPlane, false);
        if (hits.length) {
          syringeTool.visible = true;
          syringeTool.position.copy(hits[0].point).add(new THREE.Vector3(0.015, 0.015, 0.032));
          if (session.pointerDragActive) depositThermalPasteAt(hits[0].point);
        }
      } else if (cur.id === 'screw_mobo') {
        raycaster.setFromCamera(pointerNdc, camera);
        const hits = raycaster.intersectObjects(moboScrewHitMeshes, false);
        session.hoveredMoboScrewIdx = hits.length ? hits[0].object.userData.moboScrewIdx : -1;
        if (!session.pointerDragActive && !session.holdDown) {
          const targetIdx = (session.hoveredMoboScrewIdx !== -1 && session.moboScrewProgress[session.hoveredMoboScrewIdx] < 1)
            ? session.hoveredMoboScrewIdx
            : session.activeMoboScrewIdx;
          const sc = moboScrewsList[targetIdx];
          if (sc) {
            const p = session.moboScrewProgress[targetIdx] || 0;
            const hoverTip = new THREE.Vector3(0, 0, 0.09 + 0.135 * (1 - p));
            sc.wrap.localToWorld(hoverTip);
            screwdriverTool.visible = true;
            screwdriverTool.position.copy(hoverTip);
            screwdriverTool.quaternion.copy(sc.wrap.getWorldQuaternion(new THREE.Quaternion()));
          }
        }
      } else if (cur.id === 'screw_gpu') {
        raycaster.setFromCamera(pointerNdc, camera);
        const hits = raycaster.intersectObjects(screwHitMeshes, false);
        session.hoveredScrewIdx = hits.length ? hits[0].object.userData.screwIdx : -1;
        if (!session.pointerDragActive && !session.holdDown) {
          const targetIdx = (session.hoveredScrewIdx !== -1 && session.screwProgress[session.hoveredScrewIdx] < 1)
            ? session.hoveredScrewIdx
            : session.activeScrewIdx;
          const sc = gpuScrewsList[targetIdx];
          if (sc) {
            const p = session.screwProgress[targetIdx] || 0;
            const hoverTip = new THREE.Vector3(0, 0, 0.09 + 0.115 * (1 - p));
            sc.wrap.localToWorld(hoverTip);
            screwdriverTool.visible = true;
            screwdriverTool.position.copy(hoverTip);
            screwdriverTool.quaternion.copy(sc.wrap.getWorldQuaternion(new THREE.Quaternion()));
          }
        }
      }

      if (!session.pointerDragActive) return;
      const dx = e.clientX - session.lastPointer.x;
      const dy = e.clientY - session.lastPointer.y;
      session.lastPointer = { x: e.clientX, y: e.clientY };

      if (cur.id === 'seat_mobo') {
        const push = Math.max(0, dy - dx * 0.45);
        applyStepDelta('seat_mobo', Math.max(0.008, push * 0.0075));
      } else if (cur.id === 'seat_cpu') {
        const push = Math.max(0, dy - dx * 0.45);
        applyStepDelta('seat_cpu', Math.max(0.008, push * 0.0075));
      } else if (cur.id === 'close_latch') {
        const pull = Math.max(0, dy * 0.8 + Math.abs(dx) * 0.25);
        applyStepDelta('close_latch', Math.max(0.008, pull * 0.0075));
      } else if (cur.id === 'seat_gpu') {
        const push = Math.max(0, dy - dx * 0.5);
        applyStepDelta('seat_gpu', Math.max(0.008, push * 0.0075));
      } else if (cur.id === 'close_panel') {
        const swipe = Math.max(0, dx * 0.9 + Math.abs(dy) * 0.25);
        applyStepDelta('close_panel', Math.max(0.009, swipe * 0.007));
      }
    }, { signal: abortCtrl.signal });

    window.addEventListener('pointerup', () => {
      session.pointerDragActive = false;
      session.holdDown = false;
    }, { signal: abortCtrl.signal });

    // Hold Button & Modal Chrome Wiring
    if (holdBtn) {
      holdBtn.onpointerdown = e => {
        e.preventDefault();
        session.holdDown = true;
      };
      holdBtn.onpointerup = () => { session.holdDown = false; };
      holdBtn.onpointerleave = () => { session.holdDown = false; };
    }
    if (soundBtn) {
      soundBtn.onclick = () => {
        muted = !muted;
        soundBtn.textContent = muted ? '🔇 Muted' : '🔊 Sound On';
      };
    }
    modal.querySelector('#eaAsmCloseBtn').onclick = () => closeSession(false);
    modal.querySelector('#eaAsmSkipBtn').onclick = () => closeSession(true);

    // Resize Observer
    const resizeBench = () => {
      if (session.destroyed) return;
      const w = Math.max(320, stage.clientWidth || 720);
      const h = Math.max(280, stage.clientHeight || 440);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    };
    session.resizeObserver = new ResizeObserver(resizeBench);
    session.resizeObserver.observe(stage);

    syncStepperUi();
    // Snap initial camera directly
    camera.position.copy(camGoalPos);
    controls.target.copy(camGoalLook);
    controls.update();
    camTransitioning = false;

    // Main 60fps Bench Loop
    let lastMs = performance.now();
    let totalSec = 0;

    function tick(now) {
      if (session.destroyed) return;
      const dt = Math.min(0.05, Math.max(0.001, (now - lastMs) / 1000));
      lastMs = now;
      totalSec += dt;

      const cur = steps[session.stepIdx];

      // Camera smooth glide between assembly zones
      if (camTransitioning) {
        camera.position.lerp(camGoalPos, Math.min(1, dt * 6.5));
        controls.target.lerp(camGoalLook, Math.min(1, dt * 6.5));
        if (camera.position.distanceTo(camGoalPos) < 0.025 && controls.target.distanceTo(camGoalLook) < 0.025) {
          camTransitioning = false;
        }
      }

      // Hold-to-install or driving active screw
      if (cur && (session.holdDown || ((cur.id === 'screw_mobo' || cur.id === 'screw_gpu') && session.pointerDragActive))) {
        applyStepDelta(cur.id, dt * (cur.id === 'thermal_paste' ? 3.2 : 1.05));
      }

      // Drop CPU cooler smoothly onto freshly applied paste
      if (session.coolerDropping && pcAsm.cpuAsm?.coolingGroup) {
        session.coolerDropT = clamp(session.coolerDropT + dt * 2.4, 0, 1);
        const eased = 1 - Math.pow(1 - session.coolerDropT, 3);
        pcAsm.cpuAsm.coolingGroup.position.y = lerp(0.85, 0.255, eased);
        if (session.coolerDropT >= 1) {
          pcAsm.cpuAsm.coolingGroup.position.y = 0.255;
          session.coolerDropping = false;
          playSocketDrop();
        }
      }

      // Socket pulsing guide & screw highlight rings
      socketGlowMat.opacity = (cur?.id === 'seat_cpu') ? (0.45 + Math.sin(totalSec * 5) * 0.3) : 0;

      moboScrewsList.forEach((sc, idx) => {
        const done = session.moboScrewProgress[idx] >= 1;
        if (cur?.id === 'screw_mobo') {
          if (done) {
            sc.ringMat.color.setHex(0x22c55e);
            sc.ringMat.opacity = 0.35;
          } else if (idx === session.activeMoboScrewIdx || idx === session.hoveredMoboScrewIdx) {
            sc.ringMat.color.setHex(0x38bdf8);
            sc.ringMat.opacity = 0.7 + Math.sin(totalSec * 7) * 0.25;
          } else {
            sc.ringMat.color.setHex(0xfbbf24);
            sc.ringMat.opacity = 0.45 + Math.sin(totalSec * 4 + idx) * 0.2;
          }
        } else {
          sc.ringMat.opacity = 0;
        }
      });

      gpuScrewsList.forEach((sc, idx) => {
        const done = session.screwProgress[idx] >= 1;
        if (cur?.id === 'screw_gpu') {
          if (done) {
            sc.ringMat.color.setHex(0x22c55e);
            sc.ringMat.opacity = 0.35;
          } else if (idx === session.activeScrewIdx || idx === session.hoveredScrewIdx) {
            sc.ringMat.color.setHex(0x38bdf8);
            sc.ringMat.opacity = 0.7 + Math.sin(totalSec * 7) * 0.25;
          } else {
            sc.ringMat.color.setHex(0xfbbf24);
            sc.ringMat.opacity = 0.45 + Math.sin(totalSec * 4 + idx) * 0.2;
          }
        } else {
          sc.ringMat.opacity = 0;
        }
      });

      // Spin case fans & installed active fans
      (pcAsm.fanRotors || []).forEach(fr => {
        if (fr.rotor) fr.rotor.rotation.z -= dt * fr.speed;
      });
      const gpuPowered = !hasGpu || (session.gpuProgress >= 1 && (session.screwProgress.every(v => v >= 1) || cur?.id === 'close_panel'));
      (pcAsm.cpuFanSpinners || []).forEach(sp => {
        if (!sp.rotor) return;
        const isGpuSpinner = pcAsm.gpuAsm?.fanRotors?.some(fr => fr.rotor === sp.rotor);
        if (isGpuSpinner && !gpuPowered) return;
        if (!isGpuSpinner && (!session.coolerDropping && session.coolerDropT < 1)) return;
        sp.rotor.rotation[sp.axis || 'y'] -= dt * sp.speed;
      });
      (pcAsm.rgbMats || []).forEach(mat => {
        if (mat.userData?.rgbMode === 'rainbow') {
          const hue = (totalSec * 0.22 + (mat.userData.offset || 0)) % 1;
          mat.color.setHSL(hue, 0.95, 0.58);
          mat.emissive.setHSL(hue, 0.95, 0.52);
        }
      });

      // Update live progress HUD
      if (cur) {
        if (cur.id === 'seat_mobo') updateProgressBar(session.moboProgress);
        else if (cur.id === 'screw_mobo') {
          const tot = Math.max(1, moboScrewsList.length || 4);
          const avg = session.moboScrewProgress.reduce((a, b) => a + b, 0) / tot;
          const done = session.moboScrewProgress.filter(v => v >= 1).length;
          updateProgressBar(avg, done + ' / ' + tot + ' screws');
        } else if (cur.id === 'seat_cpu') updateProgressBar(session.cpuProgress);
        else if (cur.id === 'close_latch') updateProgressBar(session.latchProgress);
        else if (cur.id === 'thermal_paste') updateProgressBar(session.pasteProgress);
        else if (cur.id === 'seat_gpu') updateProgressBar(session.gpuProgress);
        else if (cur.id === 'screw_gpu') {
          const tot = Math.max(1, gpuScrewsList.length || 4);
          const avg = session.screwProgress.reduce((a, b) => a + b, 0) / tot;
          const done = session.screwProgress.filter(v => v >= 1).length;
          updateProgressBar(avg, done + ' / ' + tot + ' screws');
        } else if (cur.id === 'close_panel') updateProgressBar(session.doorProgress);
      }

      controls.update();
      renderer.render(scene, camera);
      session.rafId = requestAnimationFrame(tick);
    }

    session.rafId = requestAnimationFrame(tick);
  }

  window.PcAssemblyRitual = {
    open,
    close: () => closeSession(false)
  };
})();
