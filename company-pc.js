/* ============================================================
 * GRIND-EA · PC Company Workspace
 * Two-Window Flow (1: CASE Designer -> 2: PC BUILD Component Assembler)
 * Public CPU / GPU Search Picker · Real PC Specs (No Tiers)
 * Research Tree · Per-Unit Part Creator Payouts on Production
 * ============================================================ */
(function () {
  'use strict';

  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const PC_RESEARCH = [
    { key: 'pc_rgb_case', name: 'RGB Case', cost: 500, unitCost: 65, desc: 'Unlocks RGB LED Strips & ARGB Fan Rings' },
    { key: 'pc_medium_case', name: 'Medium Case', cost: 600, unitCost: 200, desc: 'ATX Mid-Tower · Up to 5 fans' },
    { key: 'pc_large_case', name: 'Large Case', cost: 2800, unitCost: 380, pre: 'pc_medium_case', desc: 'Full-Tower E-ATX · Up to 8 fans' },
    { key: 'pc_small_fans', name: 'Small Fans', cost: 225, unitCost: 20, desc: 'Unlocks Case Fans & 92mm Small Fans' },
    { key: 'pc_medium_fans', name: 'Medium Fans', cost: 600, unitCost: 45, pre: 'pc_small_fans', desc: 'Unlocks 120mm Balanced Airflow Fans' },
    { key: 'pc_smart_fans', name: 'Smart Fans', cost: 1800, unitCost: 95, pre: 'pc_medium_fans', desc: 'Unlocks 140mm PWM Smart Fans' }
  ];

  const CASE_SIZES = {
    small: { label: 'Small (Mini-ITX · 370×345mm)', maxFans: 3, baseCost: 60, maxGpuMm: 280, researchKey: null },
    medium: { label: 'Medium (ATX · 465×460mm)', maxFans: 5, baseCost: 200, maxGpuMm: 340, researchKey: 'pc_medium_case' },
    large: { label: 'Large (E-ATX · 545×540mm)', maxFans: 8, baseCost: 380, maxGpuMm: 390, researchKey: 'pc_large_case' }
  };

  const CASE_MATERIALS = {
    steel: { label: 'Matte Steel', addCost: 0 },
    aluminum: { label: 'Brushed Aluminum', addCost: 45 },
    glass_showcase: { label: 'Tempered Showcase', addCost: 90 }
  };

  const PRIMARY_PRESETS = ['#1a1f2b', '#0d0f15', '#e5e9f2', '#262b38', '#3a1d2e', '#172a4a'];
  const ACCENT_PRESETS = ['#a855f7', '#38bdf8', '#10b981', '#f59e0b', '#ef4444', '#e2e8f0'];

  const PC_THUMBS_LS_KEY = 'grind_pc_thumbs_v2';
  const PC_CASES_LS_PREFIX = 'grind_pc_cases_v1_';

  let activePcView = 'case';      // 'case' | 'build'
  let activeCaseMenu = 'chassis'; // 'chassis' | 'fans' | 'lighting'

  // Case draft state
  let caseSize = 'small';
  let caseMaterial = 'steel';
  let caseFrontStyle = 'mesh';
  let casePrimary = '#1a1f2b';
  let caseAccent = '#a855f7';
  let caseRgbEnabled = false;
  let caseRgbMode = 'solid';
  let caseRgbColor = '#a855f7';
  let caseFans = [];
  let nextFanSeq = 1;

  // Saved cases & PC build state
  let savedCases = [];
  let selectedCaseId = '';
  let selectedMoboPart = null;
  let selectedCpuPart = null;
  let selectedGpuPart = null;
  let pcGpuMount = 'horizontal'; // 'horizontal' | 'vertical'
  let editingPcProductId = null;
  let editingPcOldName = '';
  let selectedPcPageProductId = null;

  // Public component browser modal cache
  let pickerKind = 'cpu'; // 'cpu' | 'gpu' | 'mobo'
  let publicComponentsCache = [];

  let pcThumbsCache = null;

  const isPc = () => !!(currentCompany?.product_lines || []).includes('pc');
  const researched = k => !k || (companyResearchRows || []).some(x => x.research_key === k);
  const hasAnyFanResearch = () => researched('pc_small_fans');
  const researchDef = k => PC_RESEARCH.find(r => r.key === k);
  const fanCost = t => t === 'pc_smart_fans' ? 95 : t === 'pc_medium_fans' ? 45 : 20;
  const fanLabel = t => t === 'pc_smart_fans' ? 'Smart Fan (140mm)' : t === 'pc_medium_fans' ? 'Medium Fan (120mm)' : 'Small Fan (92mm)';

  function isProductDraft(p) {
    const st = String(p?.status || '').trim().toLowerCase();
    return !st || st === 'draft';
  }

  function isPcProductRow(p) {
    if (!p || typeof p !== 'object') return false;
    if (String(p.product_line || '').toLowerCase() === 'pc') return true;
    const d = p.design_data;
    return !!(d && typeof d === 'object' && (d.pc_build === true || d.case_config || d.case_size));
  }

  function getCaseStats(cObj) {
    const sz = CASE_SIZES[cObj.caseSize] || CASE_SIZES.small;
    const mat = CASE_MATERIALS[cObj.material] || CASE_MATERIALS.steel;
    const fans = Array.isArray(cObj.fans) ? cObj.fans : [];
    const fansCost = fans.reduce((s, f) => s + fanCost(f.fanType), 0);
    const rgbCost = cObj.rgbEnabled ? 65 : 0;
    const buildCost = sz.baseCost + mat.addCost + fansCost + rgbCost;
    const airflow = !fans.length
      ? 'Passive (No Fans)'
      : fans.some(f => f.fanType === 'pc_smart_fans')
        ? 'Smart PWM High-Airflow'
        : fans.length >= 3
          ? 'Balanced Airflow'
          : 'Entry Airflow';
    return { sizeMeta: sz, matMeta: mat, fansCost, rgbCost, buildCost, fanCount: fans.length, airflow };
  }

  const moboFitsCase = (moboSize, cSize) => {
    const rank = { small: 1, medium: 2, large: 3 };
    return (rank[moboSize] || 1) <= (rank[cSize] || 1);
  };

  function buildPcConfigFromCaseAndParts(cObj, cpuPart, gpuPart, extraOpts = {}) {
    const caseCfg = cObj || {
      caseSize,
      material: caseMaterial,
      frontStyle: caseFrontStyle,
      primaryColor: casePrimary,
      accentColor: caseAccent,
      rgbEnabled: caseRgbEnabled,
      rgbMode: caseRgbMode,
      rgbColor: caseRgbColor,
      fans: caseFans
    };

    const moboPart = extraOpts.moboPart !== undefined ? extraOpts.moboPart : selectedMoboPart;
    let moboObj = null;
    if (moboPart) {
      if (typeof window.buildMoboConfigFromProduct === 'function') {
        moboObj = window.buildMoboConfigFromProduct(moboPart);
      } else {
        const md = moboPart.design_data || {};
        moboObj = {
          boardSize: md.board_size || moboPart.body_type || 'small',
          ramSlots: Number(md.ram_slots ?? 0),
          pcbColor: md.pcb_color || '#121620',
          armorColor: md.armor_color || '#1f2533',
          accentColor: md.accent_color || '#a855f7',
          vrmStyle: md.vrm_style || 'finned',
          ioShield: md.io_shield !== false,
          m2Shield: md.m2_shield !== false,
          rgbAccent: !!md.rgb_accent,
          name: moboPart.product_name || 'Motherboard',
          companyName: moboPart.product_companies?.company_name || moboPart.company_name || '',
          logoUrl: moboPart.product_companies?.logo_data_url || moboPart.company_logo || ''
        };
      }
      moboObj.name = moboPart.product_name || 'Motherboard';
      moboObj.companyName = moboPart.product_companies?.company_name || moboPart.company_name || '';
    }

    let cpuObj = null;
    if (cpuPart) {
      if (typeof window.resolveCpuProductSpec === 'function') {
        cpuObj = window.resolveCpuProductSpec(cpuPart);
      } else {
        const cd = cpuPart.design_data || {};
        cpuObj = {
          name: cpuPart.product_name || 'CPU',
          companyName: cpuPart.product_companies?.company_name || cpuPart.company_name || '',
          cores: Number(cpuPart.core_count ?? cpuPart.cores ?? 0),
          threads: Number(cpuPart.thread_count ?? cpuPart.threads ?? 0),
          cooling: cpuPart.cooling_type === 'ultra' ? 4 : cpuPart.cooling_type === 'vapor_chamber' ? 3 : cpuPart.cooling_type === 'great' ? 2 : cpuPart.cooling_type === 'built_in' ? 1 : 0,
          body: cpuPart.carbon_fiber_body ? 'carbon' : cpuPart.silicon_body ? 'silicon' : (cpuPart.body_type || 'gray'),
          graphics: cpuPart.graphics_type || '',
          ai: cd.ai || cpuPart.ai_type || '',
          vCache: cpuPart.v_cache_type || 'none',
          score: Number(cpuPart.cpu_score || 0),
          tier: String(cpuPart.cpu_tier || 'F'),
          logoUrl: cpuPart.product_companies?.logo_data_url || cpuPart.company_logo || ''
        };
      }
      if (!cpuObj.companyName) cpuObj.companyName = cpuPart.product_companies?.company_name || cpuPart.company_name || '';
      if (!cpuObj.logoUrl) cpuObj.logoUrl = cpuPart.product_companies?.logo_data_url || cpuPart.company_logo || '';
    }

    let gpuObj = null;
    if (gpuPart) {
      if (typeof window.buildGpuConfigFromProduct === 'function') {
        gpuObj = window.buildGpuConfigFromProduct(gpuPart);
      } else {
        const gd = gpuPart.design_data || {};
        gpuObj = {
          length: Number(gd.length || gpuPart.length || 280),
          width: Number(gd.width || gpuPart.width || 125),
          thickness: Number(gd.thickness || gpuPart.thickness || 50),
          primaryColor: gd.primary_color || gpuPart.primary_color || '#222733',
          accentColor: gd.accent_color || gpuPart.accent_color || '#a855f7',
          body: gd.body || gpuPart.body_type || 'plastic',
          finish: gd.finish || 'satin',
          shroud: gd.shroud || 'rounded',
          backplate: gd.backplate !== false,
          backplateStyle: gd.backplate_style || 'flow_through',
          finStyle: gd.fin_style || 'silver',
          pipeStyle: gd.pipe_style || 'copper',
          powerType: gd.power_type || '12v2x6',
          ioStyle: gd.io_style || 'steel',
          customShape: gd.custom_shape || null,
          elements: Array.isArray(gd.elements) ? gd.elements : []
        };
      }
      gpuObj.name = gpuPart.product_name || 'GPU';
      gpuObj.companyName = gpuPart.product_companies?.company_name || gpuPart.company_name || '';
    }

    return {
      mode: moboObj || cpuObj || gpuObj ? 'pc' : 'case',
      caseSize: caseCfg.caseSize || 'small',
      material: caseCfg.material || 'steel',
      frontStyle: caseCfg.frontStyle || 'mesh',
      primaryColor: caseCfg.primaryColor || '#1a1f2b',
      accentColor: caseCfg.accentColor || '#a855f7',
      rgbEnabled: !!caseCfg.rgbEnabled,
      rgbMode: caseCfg.rgbMode || 'solid',
      rgbColor: caseCfg.rgbColor || caseCfg.accentColor || '#a855f7',
      gpuMount: extraOpts.gpuMount || 'horizontal',
      openPanel: true,
      fans: Array.isArray(caseCfg.fans) ? caseCfg.fans : [],
      motherboard: moboObj,
      cpu: cpuObj,
      gpu: gpuObj
    };
  }

  function buildPcConfigFromProduct(p) {
    const d = p?.design_data || {};
    const cObj = d.case_config || {
      caseSize: d.case_size || p?.body_type || 'small',
      material: d.case_material || 'steel',
      frontStyle: d.front_style || 'mesh',
      primaryColor: d.primary_color || '#1a1f2b',
      accentColor: d.accent_color || '#a855f7',
      rgbEnabled: !!d.rgb_enabled,
      rgbMode: d.rgb_mode || 'solid',
      rgbColor: d.rgb_color || '#a855f7',
      fans: Array.isArray(d.fans) ? d.fans : []
    };
    const comps = d.components || {};
    return buildPcConfigFromCaseAndParts(cObj, comps.cpu || null, comps.gpu || null, {
      gpuMount: d.gpu_mount || 'horizontal',
      moboPart: comps.motherboard || null
    });
  }
  window.buildPcConfigFromProduct = buildPcConfigFromProduct;

  function formatPcSpecLine(p) {
    const d = p?.design_data || {};
    const sizeTxt = (d.case_size || d.case_config?.caseSize || 'small').toUpperCase() + ' Case';
    const fanCount = Number(d.fan_count ?? d.case_config?.fans?.length ?? 0);
    const comps = d.components || {};
    const moboTxt = comps.motherboard?.product_name ? comps.motherboard.product_name : null;
    const cpuTxt = comps.cpu?.product_name ? comps.cpu.product_name : 'No CPU';
    const gpuTxt = comps.gpu?.product_name ? comps.gpu.product_name : 'No GPU';
    return sizeTxt + ' · ' + fanCount + ' Fan' + (fanCount === 1 ? '' : 's') + (moboTxt ? ' · ' + moboTxt : '') + ' · ' + cpuTxt + ' · ' + gpuTxt;
  }

  function formatPcHardwareBadges(p) {
    const d = p?.design_data || {};
    const comps = d.components || {};
    const sizeKey = d.case_size || d.case_config?.caseSize || 'small';
    const sizeLabel = CASE_SIZES[sizeKey]?.label || 'Small Case';
    const fanCount = Number(d.fan_count ?? d.case_config?.fans?.length ?? 0);
    const moboDesc = comps.motherboard
      ? ('Motherboard: ' + comps.motherboard.product_name + ' (' + ((comps.motherboard.design_data?.board_size || comps.motherboard.body_type || 'small').toUpperCase()) + ', ' + Number(comps.motherboard.design_data?.ram_slots || 0) + ' RAM)')
      : 'Motherboard: Tray Included';
    const parts = [
      sizeLabel,
      fanCount + ' Case Fan' + (fanCount === 1 ? '' : 's'),
      d.rgb_enabled ? 'RGB' : null,
      moboDesc,
      comps.cpu ? ('CPU: ' + comps.cpu.product_name + (comps.cpu.core_count ? ' (' + comps.cpu.core_count + 'C/' + (comps.cpu.thread_count || 0) + 'T)' : '')) : 'CPU: None',
      comps.gpu ? ('GPU: ' + comps.gpu.product_name) : 'GPU: None',
      'RAM/PSU: Soon'
    ].filter(Boolean);
    return parts.join(' · ');
  }

  // ---------- Thumbnails ----------
  function getPcThumbsMap() {
    if (pcThumbsCache && typeof pcThumbsCache === 'object') return pcThumbsCache;
    try {
      const raw = localStorage.getItem(PC_THUMBS_LS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      pcThumbsCache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) { pcThumbsCache = {}; }
    return pcThumbsCache;
  }

  function savePcThumb(key, dataUrl) {
    if (!key || !dataUrl) return;
    const map = getPcThumbsMap();
    map[key] = { dataUrl, ts: Date.now() };
    const entries = Object.entries(map).sort((a, b) => Number(b[1]?.ts || 0) - Number(a[1]?.ts || 0));
    if (entries.length > 40) pcThumbsCache = Object.fromEntries(entries.slice(0, 40));
    try { localStorage.setItem(PC_THUMBS_LS_KEY, JSON.stringify(pcThumbsCache)); } catch (_) {}
  }

  function getPcThumb(p) {
    if (p?.design_data?.thumbnail) return p.design_data.thumbnail;
    const map = getPcThumbsMap();
    return map[p?.id]?.dataUrl || map['name:' + (p?.product_name || '')]?.dataUrl || '';
  }

  function clearPcThumb(key) {
    if (!key) return;
    const map = getPcThumbsMap();
    if (map[key]) {
      delete map[key];
      try { localStorage.setItem(PC_THUMBS_LS_KEY, JSON.stringify(pcThumbsCache)); } catch (_) {}
    }
  }

  function applyPcThumbToDom(id, name, dataUrl) {
    if (!id || !dataUrl) return;
    document.querySelectorAll('[data-pc-thumb-id]').forEach(el => {
      if (el.dataset.pcThumbId !== String(id)) return;
      const alt = esc((name || 'PC') + ' 3D preview');
      el.innerHTML = '<img class="cpu-thumb-img gpu-thumb-img" src="' + esc(dataUrl) + '" alt="' + alt + '">';
    });
  }

  function renderPcThumbHtml(p) {
    const url = getPcThumb(p);
    const alt = esc((p?.product_name || 'PC') + ' 3D preview');
    if (url) return '<img class="cpu-thumb-img gpu-thumb-img" src="' + esc(url) + '" alt="' + alt + '">';
    return '<div class="cpu-thumb-loading" aria-label="Rendering 3D PC preview"></div>';
  }

  function hydratePcThumbElements(rootEl, productsById, width = 360, height = 270) {
    if (!rootEl) return;
    rootEl.querySelectorAll('[data-pc-thumb-id]').forEach(el => {
      const id = el.dataset.pcThumbId;
      if (!id) return;
      const prod = productsById instanceof Map ? productsById.get(id) : productsById?.[id];
      if (!prod) return;
      const cached = getPcThumb(prod);
      if (cached) {
        if (!el.querySelector('img')) applyPcThumbToDom(id, prod.product_name, cached);
        return;
      }
      if (el.dataset.pcThumbQueued === '1') return;
      if (typeof window.PcDesigner3D?.enqueueThumbnail !== 'function') return;
      el.dataset.pcThumbQueued = '1';
      window.PcDesigner3D.enqueueThumbnail(buildPcConfigFromProduct(prod), dataUrl => {
        if (!dataUrl) return;
        savePcThumb(id, dataUrl);
        if (prod.product_name) savePcThumb('name:' + prod.product_name, dataUrl);
        applyPcThumbToDom(id, prod.product_name, dataUrl);
      }, width, height);
    });
  }

  window.isPcProductRow = isPcProductRow;
  window.getPcThumbUrl = getPcThumb;
  window.renderPcThumbHtml = renderPcThumbHtml;
  window.hydratePcThumbElements = hydratePcThumbElements;
  window.formatPcSpecLine = formatPcSpecLine;
  window.formatPcHardwareBadges = formatPcHardwareBadges;
  window.clearPcDraftArtifacts = function (id, name) {
    if (id) clearPcThumb(id);
    if (name) clearPcThumb('name:' + name);
    if (editingPcProductId === id) {
      editingPcProductId = null;
      editingPcOldName = '';
      syncPcSaveButtonUI();
    }
    if (selectedPcPageProductId === id) selectedPcPageProductId = null;
  };

  // ---------- Saved Cases Persistence ----------
  function lsCasesKey(companyId) {
    return PC_CASES_LS_PREFIX + (companyId || 'default');
  }

  function readLocalCases(companyId) {
    try {
      const raw = localStorage.getItem(lsCasesKey(companyId));
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (_) {
      return [];
    }
  }

  function writeLocalCases(companyId, arr) {
    try {
      localStorage.setItem(lsCasesKey(companyId), JSON.stringify(arr || []));
    } catch (_) {}
  }

  function normalizeCaseRow(row) {
    const cfg = row.case_data || row;
    return {
      id: row.id,
      case_name: row.case_name || cfg.case_name || 'Custom Case',
      caseSize: cfg.caseSize || row.case_size || 'small',
      material: cfg.material || 'steel',
      frontStyle: cfg.frontStyle || 'mesh',
      primaryColor: cfg.primaryColor || '#1a1f2b',
      accentColor: cfg.accentColor || '#a855f7',
      rgbEnabled: !!cfg.rgbEnabled,
      rgbMode: cfg.rgbMode || 'solid',
      rgbColor: cfg.rgbColor || '#a855f7',
      fans: Array.isArray(cfg.fans) ? cfg.fans.map(f => ({ ...f })) : []
    };
  }

  async function loadSavedCases() {
    if (!currentCompany) return;
    let rows = readLocalCases(currentCompany.id).map(normalizeCaseRow);
    if (sb) {
      const { data, error } = await sb
        .from('product_company_pc_cases')
        .select('*')
        .eq('company_id', currentCompany.id)
        .order('created_at', { ascending: false });
      if (!error && Array.isArray(data)) {
        rows = data.map(normalizeCaseRow);
        writeLocalCases(currentCompany.id, rows);
      }
    }
    savedCases = rows;
    if (selectedCaseId && !savedCases.some(c => c.id === selectedCaseId)) selectedCaseId = '';
    if (!selectedCaseId && savedCases.length) selectedCaseId = savedCases[0].id;
    renderSavedCasesGrid();
    renderBuildCaseSelector();
    updateBuildSpecsReadout();
    drawBuildStage();
  }

  async function saveCaseDesign() {
    if (!currentCompany || !currentUser) return;
    const name = ($('#eaPcCaseName')?.value || '').trim();
    const msgEl = $('#eaPcCaseMessage');
    if (name.length < 2) {
      if (msgEl) msgEl.textContent = 'Case name must be at least 2 characters.';
      return;
    }
    const szMeta = CASE_SIZES[caseSize] || CASE_SIZES.small;
    if (szMeta.researchKey && !researched(szMeta.researchKey)) {
      toast('Research ' + szMeta.label + ' first.');
      return;
    }
    if (caseRgbEnabled && !researched('pc_rgb_case')) {
      toast('Research RGB Case ($500) first.');
      return;
    }
    if (caseFans.length > 0 && !hasAnyFanResearch()) {
      toast('Research Small Fans ($225) first.');
      return;
    }
    if (caseFans.some(f => !researched(f.fanType))) {
      toast('Research the selected fan tier first.');
      return;
    }

    const casePayload = {
      caseSize,
      material: caseMaterial,
      frontStyle: caseFrontStyle,
      primaryColor: casePrimary,
      accentColor: caseAccent,
      rgbEnabled: caseRgbEnabled,
      rgbMode: caseRgbMode,
      rgbColor: caseRgbColor,
      fans: caseFans.map(f => ({ ...f }))
    };

    let created = null;
    if (sb) {
      const { data, error } = await sb
        .from('product_company_pc_cases')
        .insert({
          company_id: currentCompany.id,
          owner_id: currentUser.id,
          case_name: name,
          case_size: caseSize,
          case_data: casePayload
        })
        .select('*')
        .single();
      if (!error && data) created = normalizeCaseRow(data);
    }
    if (!created) {
      created = normalizeCaseRow({
        id: 'local_case_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
        case_name: name,
        ...casePayload
      });
      const prev = readLocalCases(currentCompany.id);
      prev.unshift(created);
      writeLocalCases(currentCompany.id, prev);
    }

    selectedCaseId = created.id;
    if (msgEl) msgEl.textContent = 'Case saved! Switch to the PC BUILD window to assemble a PC with it.';
    toast('Case saved!');
    await loadSavedCases();
  }

  // ---------- PC Research Tree ----------
  function goToPcResearch() {
    showPage('company');
    if (typeof switchCompanyDashboardTab === 'function') switchCompanyDashboardTab('research');
  }

  function renderPcResearchTree() {
    const world = $('#eaPcResearchWorld');
    if (!world) return;
    const LAYOUT = {
      __root: [540, 120, 'PC', 'Small Case (Base)'],
      pc_rgb_case: [220, 390, 'RGB'],
      pc_medium_case: [540, 390, 'MED'],
      pc_large_case: [540, 670, 'LRG'],
      pc_small_fans: [860, 390, 'FAN-S'],
      pc_medium_fans: [860, 670, 'FAN-M'],
      pc_smart_fans: [860, 950, 'FAN+']
    };
    const width = 1080;
    const height = 1140;
    const rootInfo = LAYOUT.__root;

    const paths = PC_RESEARCH.map(r => {
      const A = r.pre && LAYOUT[r.pre] ? LAYOUT[r.pre] : rootInfo;
      const B = LAYOUT[r.key];
      if (!A || !B) return '';
      const mid = (A[1] + B[1]) / 2;
      return '<path d="M' + A[0] + ' ' + (A[1] + 65) + ' L' + A[0] + ' ' + mid + ' L' + B[0] + ' ' + mid + ' L' + B[0] + ' ' + (B[1] - 65) + '"/>';
    }).join('');

    const nodeHtml = (r, x, y, icon, yes, locked) => {
      const status = yes ? 'UNLOCKED' : locked ? 'LOCKED' : 'UNLOCK · $' + r.cost.toLocaleString();
      return '<button type="button" class="research-node ' + (yes ? 'researched' : locked ? 'prerequisite-locked' : 'available') +
        '" data-pc-research-key="' + r.key + '" style="--node-x:' + x + 'px;--node-y:' + y + 'px" ' + (yes || locked ? 'disabled' : '') + '>' +
        '<span class="research-hex"><b>' + icon + '</b></span><strong>' + esc(r.name) + '</strong>' +
        '<small>$' + r.cost.toLocaleString() + ' · ' + esc(r.desc || '') + '</small>' +
        '<em class="research-node-status">' + status + '</em></button>';
    };

    world.style.width = width + 'px';
    world.style.height = height + 'px';
    world.innerHTML =
      '<svg class="research-tree-lines" viewBox="0 0 ' + width + ' ' + height + '">' + paths + '</svg>' +
      nodeHtml({ name: rootInfo[3], cost: 0, desc: 'Starter chassis · 0 Fans', key: 'baseline_pc' }, rootInfo[0], rootInfo[1], rootInfo[2], true, false) +
      PC_RESEARCH.map(r => {
        const xy = LAYOUT[r.key] || rootInfo;
        const yes = researched(r.key);
        const locked = !!(r.pre && !researched(r.pre));
        return nodeHtml(r, xy[0], xy[1], xy[2] || 'PC', yes, locked);
      }).join('');

    world.querySelectorAll('[data-pc-research-key]').forEach(b => b.addEventListener('click', () => unlockPcResearch(b.dataset.pcResearchKey)));
  }

  function setupPcResearchNav(tree) {
    if (!tree || tree.dataset.navigationReady) return;
    tree.dataset.navigationReady = '1';
    const world = tree.querySelector('.research-tree-world');
    if (!world) return;
    const centerX = 540;
    let zoom = 0.74, panX = (tree.clientWidth || 720) / 2 - centerX * zoom, panY = 14, dragging = false, sx = 0, sy = 0, bx = 0, by = 0;
    const paint = () => { world.style.transform = 'translate(' + panX + 'px,' + panY + 'px) scale(' + zoom + ')'; };
    tree.addEventListener('pointerdown', e => {
      if (e.target.closest('button[data-pc-research-key],.research-tree-controls')) return;
      dragging = true; sx = e.clientX; sy = e.clientY; bx = panX; by = panY;
      tree.classList.add('dragging'); tree.setPointerCapture(e.pointerId);
    });
    tree.addEventListener('pointermove', e => { if (!dragging) return; panX = bx + e.clientX - sx; panY = by + e.clientY - sy; paint(); });
    const stop = () => { dragging = false; tree.classList.remove('dragging'); };
    tree.addEventListener('pointerup', stop);
    tree.addEventListener('pointercancel', stop);
    tree.querySelectorAll('[data-pc-zoom]').forEach(b => b.addEventListener('click', () => {
      const a = b.dataset.pcZoom;
      if (a === 'reset') { zoom = 0.74; panX = (tree.clientWidth || 720) / 2 - centerX * zoom; panY = 14; }
      else {
        const next = Math.max(0.45, Math.min(1.35, zoom * (a === 'in' ? 1.15 : 0.87)));
        panX = panX * next / zoom; panY = panY * next / zoom; zoom = next;
      }
      paint();
    }));
    tree.addEventListener('wheel', e => {
      if (!e.ctrlKey && Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
      e.preventDefault();
      const next = Math.max(0.45, Math.min(1.35, zoom * (e.deltaY < 0 ? 1.08 : 0.92)));
      panX = panX * next / zoom; panY = panY * next / zoom; zoom = next; paint();
    }, { passive: false });
    paint();
  }

  async function unlockPcResearch(key) {
    if (!currentCompany || !currentUser || !sb || !key || key === 'baseline_pc') return;
    if (researched(key)) return;
    const def = researchDef(key);
    const msgEl = $('#eaPcResearchMessage');
    if (!def) return;
    if (def.pre && !researched(def.pre)) {
      const err = 'Research ' + (researchDef(def.pre)?.name || def.pre) + ' first.';
      if (msgEl) msgEl.textContent = err;
      toast(err);
      return;
    }
    if (msgEl) msgEl.textContent = 'Researching ' + def.name + '…';

    let { data, error } = await sb.rpc('unlock_company_research', { p_company_id: currentCompany.id, p_research_key: key });
    if (error && (/unknown\s+research|owner_id/i.test(error.message || '') || error.code === 'PGRST202' || /could not find the function/i.test(error.message || ''))) {
      const curCash = Number(currentUser.cash ?? 0);
      if (curCash < def.cost) {
        const err = 'Not enough cash. ' + def.name + ' costs $' + def.cost.toLocaleString() + '.';
        if (msgEl) msgEl.textContent = err;
        toast(err);
        return;
      }
      const nextCash = Math.round((curCash - def.cost) * 100) / 100;
      let insRes = await sb.from('product_company_research').insert({
        company_id: currentCompany.id,
        research_key: key
      });
      if (insRes.error && /owner_id/i.test(insRes.error.message || '')) {
        insRes = await sb.from('product_company_research').insert({
          company_id: currentCompany.id,
          owner_id: currentUser.id,
          research_key: key
        });
      }
      if (!insRes.error) {
        const cashRes = await sb.from('profiles').update({ cash: nextCash }).eq('id', currentUser.id);
        if (cashRes.error) {
          await sb.from('product_company_research').delete().eq('company_id', currentCompany.id).eq('research_key', key);
          error = cashRes.error;
        } else {
          const nextCosts = Number(currentCompany.total_costs || 0) + def.cost;
          await sb.from('product_companies').update({ total_costs: nextCosts }).eq('id', currentCompany.id);
          currentCompany.total_costs = nextCosts;
          data = { cash_remaining: nextCash, cost: def.cost };
          error = null;
        }
      } else {
        error = new Error(insRes.error.message || ('Add "' + key + '" to Supabase research SQL.'));
      }
    }

    if (error) {
      if (msgEl) msgEl.textContent = error.message;
      toast(error.message);
      return;
    }

    const spent = Number(data?.cost ?? def.cost ?? 0);
    if (data?.cash_remaining !== undefined) currentUser.cash = Number(data.cash_remaining);
    else if (spent > 0) currentUser.cash = Math.max(0, Math.round((Number(currentUser.cash || 0) - spent) * 100) / 100);
    if (spent > 0 && data?.cost !== undefined) currentCompany.total_costs = Number(currentCompany.total_costs || 0) + spent;

    await loadCompanyResearchAndProducts();
    renderPcResearchTree();
    renderCaseMenus();
    drawCaseStage();
    updateUIProfile?.();
    if (msgEl) msgEl.textContent = def.name + ' unlocked!';
    if (typeof playSound === 'function') playSound('upload');
    toast(def.name + ' unlocked!');
  }

  function mountPcResearch() {
    const section = $('#companyPanelResearch .research-section');
    if (!section) return;
    let wrap = $('#eaPcResearchWrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'eaPcResearchWrap';
      wrap.className = 'ea-company-research hidden';
      wrap.innerHTML =
        '<div id="eaPcResearchTree" class="research-tree"><div id="eaPcResearchWorld" class="research-tree-world"></div><div class="research-tree-controls"><button type="button" data-pc-zoom="out">−</button><button type="button" data-pc-zoom="reset">Reset</button><button type="button" data-pc-zoom="in">+</button></div></div>' +
        '<p id="eaPcResearchMessage" class="form-message"></p>';
      section.insertBefore(wrap, $('#cpuResearchTree') || null);
      setupPcResearchNav($('#eaPcResearchTree'));
    }
    const active = isPc();
    wrap.classList.toggle('hidden', !active);
    if (active) {
      $('#cpuResearchTree')?.classList.add('hidden');
      $('#eaCompanyResearch')?.classList.add('hidden');
      const eyebrow = section.querySelector('.company-section-heading .eyebrow');
      const heading = section.querySelector('.company-section-heading h4');
      const chip = section.querySelector('.company-count-chip');
      const description = section.querySelector('.company-section-heading p');
      if (eyebrow) eyebrow.textContent = 'PC DEVELOPMENT';
      if (heading) heading.textContent = 'PC Case & Cooling Research';
      if (description) description.textContent = 'Unlock larger chassis sizes, RGB case lighting, and case fan options before designing Cases.';
      if (chip) chip.textContent = 'PC RESEARCH';
      renderPcResearchTree();
    }
  }

  // ---------- Case Designer Menus ----------
  function setCaseMenuTab(tab) {
    activeCaseMenu = ['chassis', 'fans', 'lighting'].includes(tab) ? tab : 'chassis';
    document.querySelectorAll('[data-pc-case-menu]').forEach(b => b.classList.toggle('active', b.dataset.pcCaseMenu === activeCaseMenu));
    ['chassis', 'fans', 'lighting'].forEach(t => {
      $('#eaPcCaseMenu_' + t)?.classList.toggle('hidden', t !== activeCaseMenu);
    });
  }

  function renderCaseChassisMenu() {
    const wrap = $('#eaPcCaseMenu_chassis');
    if (!wrap) return;
    if (CASE_SIZES[caseSize]?.researchKey && !researched(CASE_SIZES[caseSize].researchKey)) {
      caseSize = 'small';
    }
    const sizeCards = Object.entries(CASE_SIZES).map(([id, meta]) => {
      const ok = researched(meta.researchKey);
      const selected = caseSize === id;
      return '<div class="cpu-component-option ' + (ok ? '' : 'locked') + ' ' + (selected ? 'selected' : '') + '">' +
        '<span class="cpu-component-icon">▣</span>' +
        '<span><strong>' + esc(meta.label) + '</strong><small>' + (ok ? '$' + meta.baseCost + ' build cost · Max ' + meta.maxFans + ' fans · Up to ' + meta.maxGpuMm + 'mm GPU' : 'Research required') + '</small></span>' +
        '<button type="button" class="zoom-btn" ' + (ok ? 'data-pc-size="' + id + '"' : 'data-pc-go-research="1"') + '>' + (ok ? (selected ? 'Selected' : 'Use') : 'Research') + '</button>' +
        '</div>';
    }).join('');

    const matPills = Object.entries(CASE_MATERIALS).map(([id, m]) =>
      '<button type="button" class="zoom-btn' + (caseMaterial === id ? ' active' : '') + '" data-pc-mat="' + id + '">' + esc(m.label) + '</button>'
    ).join('');

    const frontPills = [
      ['mesh', 'Mesh Airflow'],
      ['solid', 'Minimal Solid'],
      ['glass', 'Tempered Glass']
    ].map(([id, label]) =>
      '<button type="button" class="zoom-btn' + (caseFrontStyle === id ? ' active' : '') + '" data-pc-front="' + id + '">' + label + '</button>'
    ).join('');

    const primSwatches = PRIMARY_PRESETS.map(hex =>
      '<button type="button" class="ea-swatch-btn' + (casePrimary.toLowerCase() === hex ? ' active' : '') + '" data-pc-prim="' + hex + '" style="background:' + hex + '"></button>'
    ).join('');
    const accSwatches = ACCENT_PRESETS.map(hex =>
      '<button type="button" class="ea-swatch-btn' + (caseAccent.toLowerCase() === hex ? ' active' : '') + '" data-pc-acc="' + hex + '" style="background:' + hex + '"></button>'
    ).join('');

    wrap.innerHTML =
      '<h4>Case Size</h4>' + sizeCards +
      '<h4 style="margin-top:12px">Exterior &amp; Finish</h4>' +
      '<div class="ea-gpu-inline-box"><span>Chassis Material</span><div class="ea-gpu-pill-row ea-gpu-pill-wrap">' + matPills + '</div></div>' +
      '<div class="ea-gpu-inline-box"><span>Front Panel</span><div class="ea-gpu-pill-row ea-gpu-pill-wrap">' + frontPills + '</div></div>' +
      '<div class="ea-gpu-inline-box"><span>Primary Color</span><div class="ea-gpu-swatches">' + primSwatches + '<input id="eaPcPrimaryColor" type="color" value="' + esc(casePrimary) + '"></div></div>' +
      '<div class="ea-gpu-inline-box"><span>Accent Color</span><div class="ea-gpu-swatches">' + accSwatches + '<input id="eaPcAccentColor" type="color" value="' + esc(caseAccent) + '"></div></div>';

    wrap.querySelectorAll('[data-pc-size]').forEach(btn => btn.addEventListener('click', () => {
      caseSize = btn.dataset.pcSize;
      const cap = CASE_SIZES[caseSize]?.maxFans || 3;
      if (caseFans.length > cap) caseFans = caseFans.slice(0, cap);
      renderCaseMenus();
      drawCaseStage();
    }));
    wrap.querySelectorAll('[data-pc-go-research]').forEach(btn => btn.addEventListener('click', goToPcResearch));
    wrap.querySelectorAll('[data-pc-mat]').forEach(btn => btn.addEventListener('click', () => {
      caseMaterial = btn.dataset.pcMat;
      renderCaseChassisMenu();
      drawCaseStage();
    }));
    wrap.querySelectorAll('[data-pc-front]').forEach(btn => btn.addEventListener('click', () => {
      caseFrontStyle = btn.dataset.pcFront;
      renderCaseChassisMenu();
      drawCaseStage();
    }));
    wrap.querySelectorAll('[data-pc-prim]').forEach(btn => btn.addEventListener('click', () => {
      casePrimary = btn.dataset.pcPrim;
      renderCaseChassisMenu();
      drawCaseStage();
    }));
    wrap.querySelectorAll('[data-pc-acc]').forEach(btn => btn.addEventListener('click', () => {
      caseAccent = btn.dataset.pcAcc;
      renderCaseChassisMenu();
      drawCaseStage();
    }));
    wrap.querySelector('#eaPcPrimaryColor')?.addEventListener('input', e => { casePrimary = e.target.value; drawCaseStage(); });
    wrap.querySelector('#eaPcAccentColor')?.addEventListener('input', e => { caseAccent = e.target.value; drawCaseStage(); });
  }

  function renderCaseFansMenu() {
    const wrap = $('#eaPcCaseMenu_fans');
    if (!wrap) return;
    if (!hasAnyFanResearch()) {
      caseFans = [];
      wrap.innerHTML =
        '<h4>Case Fans (Locked)</h4>' +
        '<div class="cpu-component-option locked">' +
          '<span class="cpu-component-icon">❄</span>' +
          '<span><strong>Case Fans Locked</strong><small>You must research Small Fans ($225) to unlock placing fans inside PC Cases.</small></span>' +
          '<button type="button" class="zoom-btn" id="eaPcUnlockFansJump">Research</button>' +
        '</div>';
      wrap.querySelector('#eaPcUnlockFansJump')?.addEventListener('click', goToPcResearch);
      return;
    }

    const maxFans = CASE_SIZES[caseSize]?.maxFans || 3;
    const atCap = caseFans.length >= maxFans;
    const fanDefs = [
      { key: 'pc_small_fans', name: 'Small Fan (92mm)', desc: '$20/unit · Compact intake/exhaust' },
      { key: 'pc_medium_fans', name: 'Medium Fan (120mm)', desc: '$45/unit · High static pressure' },
      { key: 'pc_smart_fans', name: 'Smart Fan (140mm PWM)', desc: '$95/unit · Intelligent high-airflow' }
    ];
    const hasRgb = researched('pc_rgb_case') && caseRgbEnabled;

    const addCards = fanDefs.map(fd => {
      const ok = researched(fd.key);
      return '<div class="cpu-component-option ' + (ok ? '' : 'locked') + '">' +
        '<span class="cpu-component-icon">❄</span>' +
        '<span><strong>' + fd.name + '</strong><small>' + (ok ? (atCap ? 'Max ' + maxFans + ' fans for ' + caseSize + ' case' : fd.desc) : 'Research required') + '</small></span>' +
        '<button type="button" class="zoom-btn" ' + (ok ? 'data-pc-add-fan="' + fd.key + '"' + (atCap ? ' disabled' : '') : 'data-pc-go-research="1"') + '>' + (ok ? 'Place Fan' : 'Research') + '</button>' +
        '</div>';
    }).join('');

    const placedHtml = caseFans.length
      ? caseFans.map((f, idx) =>
          '<div class="ea-elem-card">' +
            '<div class="ea-elem-head"><strong>Fan ' + (idx + 1) + ' · ' + esc(fanLabel(f.fanType)) + '</strong>' +
            '<button type="button" class="ea-elem-del" data-pc-del-fan="' + esc(f.id) + '">✕</button></div>' +
            '<div class="ea-elem-row">' +
              '<label>Mount<select data-pc-fan-mount="' + esc(f.id) + '">' +
                '<option value="front"' + (f.mount === 'front' ? ' selected' : '') + '>Front Intake</option>' +
                '<option value="top"' + (f.mount === 'top' ? ' selected' : '') + '>Top Exhaust</option>' +
                '<option value="rear"' + (f.mount === 'rear' ? ' selected' : '') + '>Rear Exhaust</option>' +
                '<option value="bottom"' + (f.mount === 'bottom' ? ' selected' : '') + '>Bottom Intake</option>' +
              '</select></label>' +
              '<label>Blades<select data-pc-fan-blade="' + esc(f.id) + '">' +
                '<option value="dark"' + (f.bladeColor === 'dark' ? ' selected' : '') + '>Carbon Dark</option>' +
                '<option value="white"' + (f.bladeColor === 'white' ? ' selected' : '') + '>Frost White</option>' +
                '<option value="accent"' + (f.bladeColor === 'accent' ? ' selected' : '') + '>Accent Color</option>' +
              '</select></label>' +
            '</div>' +
            '<div class="ea-elem-subrow">' +
              '<label style="flex:1;display:grid;gap:3px;font-size:10px;">Slot Position <b>' + Math.round((f.position ?? 0.5) * 100) + '%</b><input type="range" min="15" max="85" value="' + Math.round((f.position ?? 0.5) * 100) + '" data-pc-fan-pos="' + esc(f.id) + '"></label>' +
              (hasRgb ? '<button type="button" class="zoom-btn' + (f.rgbRing ? ' active' : '') + '" data-pc-fan-rgb="' + esc(f.id) + '">RGB Ring</button>' : '') +
            '</div>' +
          '</div>'
        ).join('')
      : '<p class="muted tiny">No fans placed yet. Click <b>Place Fan</b> above to mount intake &amp; exhaust fans.</p>';

    wrap.innerHTML =
      '<h4>Add Case Fans (' + caseFans.length + '/' + maxFans + ')</h4>' + addCards +
      '<div class="ea-placed-head" style="margin-top:12px"><h4>Placed Fans</h4>' +
      (caseFans.length > 1 ? '<button type="button" class="zoom-btn" id="eaPcAutoSpaceFans">Auto-Space</button>' : '') +
      '</div>' +
      '<div class="ea-placed-list">' + placedHtml + '</div>';

    wrap.querySelectorAll('[data-pc-go-research]').forEach(btn => btn.addEventListener('click', goToPcResearch));
    wrap.querySelectorAll('[data-pc-add-fan]').forEach(btn => btn.addEventListener('click', () => {
      if (caseFans.length >= maxFans) { toast('Max ' + maxFans + ' fans for this case size.'); return; }
      const t = btn.dataset.pcAddFan;
      if (!researched(t)) { goToPcResearch(); return; }
      const defaultMount = caseFans.length === 0 ? 'front' : caseFans.length === 1 ? 'rear' : caseFans.length === 2 ? 'front' : 'top';
      const sameMountCount = caseFans.filter(x => x.mount === defaultMount).length;
      caseFans.push({
        id: 'pc_fan_' + (++nextFanSeq),
        fanType: t,
        mount: defaultMount,
        position: Math.min(0.82, Math.max(0.2, 0.25 + sameMountCount * 0.28)),
        bladeColor: 'dark',
        rgbRing: !!(researched('pc_rgb_case') && caseRgbEnabled)
      });
      renderCaseFansMenu();
      drawCaseStage();
    }));
    wrap.querySelector('#eaPcAutoSpaceFans')?.addEventListener('click', () => {
      const byMount = {};
      caseFans.forEach(f => {
        byMount[f.mount] = byMount[f.mount] || [];
        byMount[f.mount].push(f);
      });
      Object.values(byMount).forEach(arr => {
        if (arr.length === 1) arr[0].position = 0.5;
        else arr.forEach((f, i) => { f.position = 0.22 + (i / (arr.length - 1)) * 0.56; });
      });
      renderCaseFansMenu();
      drawCaseStage();
    });
    wrap.querySelectorAll('[data-pc-del-fan]').forEach(btn => btn.addEventListener('click', () => {
      caseFans = caseFans.filter(x => x.id !== btn.dataset.pcDelFan);
      renderCaseFansMenu();
      drawCaseStage();
    }));
    wrap.querySelectorAll('[data-pc-fan-mount]').forEach(sel => sel.addEventListener('change', () => {
      const f = caseFans.find(x => x.id === sel.dataset.pcFanMount);
      if (f) { f.mount = sel.value; drawCaseStage(); }
    }));
    wrap.querySelectorAll('[data-pc-fan-blade]').forEach(sel => sel.addEventListener('change', () => {
      const f = caseFans.find(x => x.id === sel.dataset.pcFanBlade);
      if (f) { f.bladeColor = sel.value; drawCaseStage(); }
    }));
    wrap.querySelectorAll('[data-pc-fan-pos]').forEach(inp => inp.addEventListener('input', () => {
      const f = caseFans.find(x => x.id === inp.dataset.pcFanPos);
      if (f) {
        f.position = Number(inp.value) / 100;
        const b = inp.parentElement?.querySelector('b');
        if (b) b.textContent = inp.value + '%';
        drawCaseStage();
      }
    }));
    wrap.querySelectorAll('[data-pc-fan-rgb]').forEach(btn => btn.addEventListener('click', () => {
      const f = caseFans.find(x => x.id === btn.dataset.pcFanRgb);
      if (f) { f.rgbRing = !f.rgbRing; renderCaseFansMenu(); drawCaseStage(); }
    }));
  }

  function renderCaseLightingMenu() {
    const wrap = $('#eaPcCaseMenu_lighting');
    if (!wrap) return;
    const ok = researched('pc_rgb_case');
    if (!ok) {
      caseRgbEnabled = false;
      wrap.innerHTML =
        '<h4>RGB Case Lighting (Locked)</h4>' +
        '<div class="cpu-component-option locked">' +
          '<span class="cpu-component-icon">✦</span>' +
          '<span><strong>RGB Case</strong><small>Research RGB Case ($500) to unlock chassis lightbars &amp; ARGB fan rings.</small></span>' +
          '<button type="button" class="zoom-btn" id="eaPcUnlockRgbJump">Research</button>' +
        '</div>';
      wrap.querySelector('#eaPcUnlockRgbJump')?.addEventListener('click', goToPcResearch);
      return;
    }

    wrap.innerHTML =
      '<h4>Case RGB Lighting</h4>' +
      '<div class="cpu-component-option ' + (caseRgbEnabled ? 'selected' : '') + '">' +
        '<span class="cpu-component-icon">✦</span>' +
        '<span><strong>Addressable RGB Strips</strong><small>$65/unit · Front bar, top rim &amp; PSU shroud LED</small></span>' +
        '<button type="button" class="zoom-btn" id="eaPcToggleRgb">' + (caseRgbEnabled ? 'Enabled' : 'Enable') + '</button>' +
      '</div>' +
      (caseRgbEnabled
        ? '<div class="ea-gpu-inline-box" style="margin-top:8px"><span>RGB Color &amp; Mode</span>' +
            '<div class="ea-elem-grid">' +
              '<input type="color" id="eaPcRgbColorInput" value="' + esc(caseRgbColor) + '">' +
              '<button type="button" class="zoom-btn ea-rainbow-btn' + (caseRgbMode === 'rainbow' ? ' active' : '') + '" id="eaPcRgbRainbowBtn">Rainbow Cycle</button>' +
            '</div>' +
          '</div>'
        : '');

    wrap.querySelector('#eaPcToggleRgb')?.addEventListener('click', () => {
      caseRgbEnabled = !caseRgbEnabled;
      renderCaseLightingMenu();
      renderCaseFansMenu();
      drawCaseStage();
    });
    wrap.querySelector('#eaPcRgbColorInput')?.addEventListener('input', e => {
      caseRgbColor = e.target.value;
      caseRgbMode = 'solid';
      wrap.querySelector('#eaPcRgbRainbowBtn')?.classList.remove('active');
      drawCaseStage();
    });
    wrap.querySelector('#eaPcRgbRainbowBtn')?.addEventListener('click', () => {
      caseRgbMode = caseRgbMode === 'rainbow' ? 'solid' : 'rainbow';
      renderCaseLightingMenu();
      drawCaseStage();
    });
  }

  function renderCaseMenus() {
    renderCaseChassisMenu();
    renderCaseFansMenu();
    renderCaseLightingMenu();
    updateCaseReadouts();
  }

  function updateCaseReadouts() {
    const stats = getCaseStats({ caseSize, material: caseMaterial, fans: caseFans, rgbEnabled: caseRgbEnabled });
    if ($('#eaPcCaseBuildCost')) $('#eaPcCaseBuildCost').textContent = '$' + stats.buildCost.toLocaleString();
    if ($('#eaPcCaseAirflow')) $('#eaPcCaseAirflow').textContent = stats.airflow;
    if ($('#eaPcCaseCaption')) {
      $('#eaPcCaseCaption').textContent = stats.sizeMeta.label + ' · ' + stats.matMeta.label + ' · ' + stats.fanCount + ' Fan' + (stats.fanCount === 1 ? '' : 's') + (caseRgbEnabled ? ' · RGB' : '');
    }
  }

  function drawCaseStage() {
    updateCaseReadouts();
    window.PcDesigner3D?.update?.(buildPcConfigFromCaseAndParts(null, null, null));
  }

  function renderSavedCasesGrid() {
    const wrap = $('#eaSavedPcCases');
    if (!wrap) return;
    if (!savedCases.length) {
      wrap.innerHTML = '<p class="muted">No cases saved yet. Design and save a Case above first.</p>';
      return;
    }
    wrap.innerHTML = savedCases.map(c => {
      const st = getCaseStats(c);
      return '<button type="button" class="ea-chip-card" data-pc-case-pick="' + esc(c.id) + '">' +
        '<span>▣</span>' +
        '<b>' + esc(c.case_name) + '</b>' +
        '<small>' + esc(st.sizeMeta.label) + ' · ' + st.fanCount + ' Fan' + (st.fanCount === 1 ? '' : 's') + (c.rgbEnabled ? ' · RGB' : '') + ' · $' + st.buildCost.toLocaleString() + '</small>' +
      '</button>';
    }).join('');
    wrap.querySelectorAll('[data-pc-case-pick]').forEach(btn => btn.addEventListener('click', () => {
      selectedCaseId = btn.dataset.pcCasePick;
      setPcView('build');
      renderBuildCaseSelector();
      updateBuildSpecsReadout();
      drawBuildStage();
    }));
  }

  // ---------- Window 2: PC BUILD Designer & Public Component Browser ----------
  function renderBuildCaseSelector() {
    const wrap = $('#eaPcBuildCaseList');
    if (!wrap) return;
    if (!savedCases.length) {
      wrap.innerHTML =
        '<div class="ea-gpu-empty-note">' +
          '<p class="muted tiny">No saved Cases yet. Design a Case in the <b>CASE</b> tab first.</p>' +
          '<button type="button" class="primary-btn" id="eaPcGoCaseTab">Design a Case →</button>' +
        '</div>';
      wrap.querySelector('#eaPcGoCaseTab')?.addEventListener('click', () => setPcView('case'));
      return;
    }
    wrap.innerHTML = savedCases.map(c => {
      const sel = c.id === selectedCaseId;
      const st = getCaseStats(c);
      return '<div class="cpu-component-option ' + (sel ? 'selected' : '') + '">' +
        '<span class="cpu-component-icon">▣</span>' +
        '<span><strong>' + esc(c.case_name) + '</strong><small>' + esc(st.sizeMeta.label) + ' · ' + st.fanCount + ' Fans · $' + st.buildCost.toLocaleString() + '</small></span>' +
        '<button type="button" class="zoom-btn" data-pc-pick-case="' + esc(c.id) + '">' + (sel ? 'Selected' : 'Use') + '</button>' +
      '</div>';
    }).join('');
    wrap.querySelectorAll('[data-pc-pick-case]').forEach(btn => btn.addEventListener('click', () => {
      selectedCaseId = btn.dataset.pcPickCase;
      renderBuildCaseSelector();
      updateBuildSpecsReadout();
      drawBuildStage();
    }));
  }

  function computePcBuildValues() {
    const cObj = savedCases.find(c => c.id === selectedCaseId) || null;
    const cStats = cObj ? getCaseStats(cObj) : { buildCost: 0, fanCount: 0, airflow: 'No Case', sizeMeta: CASE_SIZES.small };
    const moboPrice = selectedMoboPart ? Math.max(0, Number(selectedMoboPart.listed_price || 0)) : 0;
    const cpuPrice = selectedCpuPart ? Math.max(0, Number(selectedCpuPart.listed_price || 0)) : 0;
    const gpuPrice = selectedGpuPart ? Math.max(0, Number(selectedGpuPart.listed_price || 0)) : 0;
    const totalUnitCost = cStats.buildCost + moboPrice + cpuPrice + gpuPrice;
    return { cObj, cStats, moboPrice, cpuPrice, gpuPrice, totalUnitCost };
  }

  function updateBuildSpecsReadout() {
    const { cObj, cStats, moboPrice, cpuPrice, gpuPrice, totalUnitCost } = computePcBuildValues();
    if ($('#eaPcTotalCost')) $('#eaPcTotalCost').textContent = '$' + totalUnitCost.toLocaleString();
    if ($('#eaPcPartsSummary')) {
      $('#eaPcPartsSummary').textContent =
        (selectedMoboPart ? 'Mobo ✓' : 'No Mobo') + ' · ' +
        (selectedCpuPart ? 'CPU ✓' : 'No CPU') + ' · ' +
        (selectedGpuPart ? 'GPU ✓' : 'No GPU');
    }

    const moboSlot = $('#eaPcSelectedMoboCard');
    if (moboSlot) {
      if (selectedMoboPart) {
        const compName = selectedMoboPart.product_companies?.company_name || selectedMoboPart.company_name || 'Mobo Company';
        const md = selectedMoboPart.design_data || {};
        const bSize = (md.board_size || selectedMoboPart.body_type || 'small').toUpperCase();
        const ramCt = Number(md.ram_slots || 0);
        moboSlot.innerHTML =
          '<div class="ea-pc-picked-row"><div><strong>' + esc(selectedMoboPart.product_name) + '</strong>' +
          '<small>' + esc(compName) + ' · ' + esc(bSize) + ' · ' + ramCt + ' RAM Slots · $' + moboPrice.toLocaleString() + '/unit</small></div>' +
          '<button type="button" class="ea-elem-del" id="eaPcClearMobo">✕</button></div>';
        moboSlot.querySelector('#eaPcClearMobo')?.addEventListener('click', () => {
          selectedMoboPart = null;
          updateBuildSpecsReadout();
          drawBuildStage();
        });
      } else {
        moboSlot.innerHTML = '<small class="muted">No Motherboard selected — click ＋ Motherboard above (or use base tray).</small>';
      }
    }

    const cpuSlot = $('#eaPcSelectedCpuCard');
    if (cpuSlot) {
      if (selectedCpuPart) {
        const compName = selectedCpuPart.product_companies?.company_name || selectedCpuPart.company_name || 'CPU Company';
        cpuSlot.innerHTML =
          '<div class="ea-pc-picked-row"><div><strong>' + esc(selectedCpuPart.product_name) + '</strong>' +
          '<small>' + esc(compName) + ' · ' + Number(selectedCpuPart.core_count || 0) + 'C/' + Number(selectedCpuPart.thread_count || 0) + 'T · $' + cpuPrice.toLocaleString() + '/unit</small></div>' +
          '<button type="button" class="ea-elem-del" id="eaPcClearCpu">✕</button></div>';
        cpuSlot.querySelector('#eaPcClearCpu')?.addEventListener('click', () => {
          selectedCpuPart = null;
          updateBuildSpecsReadout();
          drawBuildStage();
        });
      } else {
        cpuSlot.innerHTML = '<small class="muted">No CPU selected — click CPU above to search public CPUs.</small>';
      }
    }

    const gpuSlot = $('#eaPcSelectedGpuCard');
    if (gpuSlot) {
      if (selectedGpuPart) {
        const compName = selectedGpuPart.product_companies?.company_name || selectedGpuPart.company_name || 'GPU Company';
        const gd = selectedGpuPart.design_data || {};
        gpuSlot.innerHTML =
          '<div class="ea-pc-picked-row"><div><strong>' + esc(selectedGpuPart.product_name) + '</strong>' +
          '<small>' + esc(compName) + ' · ' + esc(gd.chip_name || 'GPU Chip') + ' · $' + gpuPrice.toLocaleString() + '/unit</small></div>' +
          '<button type="button" class="ea-elem-del" id="eaPcClearGpu">✕</button></div>';
        gpuSlot.querySelector('#eaPcClearGpu')?.addEventListener('click', () => {
          selectedGpuPart = null;
          updateBuildSpecsReadout();
          drawBuildStage();
        });
      } else {
        gpuSlot.innerHTML = '<small class="muted">No GPU selected — click GPU above to search public GPUs.</small>';
      }
    }

    const specBox = $('#eaPcSpecsPanel');
    if (specBox) {
      const gpuCfg = selectedGpuPart && typeof window.buildGpuConfigFromProduct === 'function'
        ? window.buildGpuConfigFromProduct(selectedGpuPart)
        : null;
      const gpuLen = Number(gpuCfg?.length || selectedGpuPart?.design_data?.length || 0);
      const gpuWid = Number(gpuCfg?.width || selectedGpuPart?.design_data?.width || 0);
      const gpuThick = Number(gpuCfg?.thickness || selectedGpuPart?.design_data?.thickness || 0);
      const tooLong = cObj && selectedGpuPart && gpuLen > cStats.sizeMeta.maxGpuMm;

      const moboSizeKey = selectedMoboPart?.design_data?.board_size || selectedMoboPart?.body_type || 'small';
      const moboTooBig = cObj && selectedMoboPart && !moboFitsCase(moboSizeKey, cObj.caseSize);

      const stockWarns = [];
      if (selectedMoboPart && selectedMoboPart.stock !== undefined && Number(selectedMoboPart.stock) <= 0) {
        stockWarns.push(selectedMoboPart.product_name + ' currently has 0 stock (maker must restock before you can produce PCs)');
      }
      if (selectedCpuPart && selectedCpuPart.stock !== undefined && Number(selectedCpuPart.stock) <= 0) {
        stockWarns.push(selectedCpuPart.product_name + ' currently has 0 stock (maker must restock before you can produce PCs)');
      }
      if (selectedGpuPart && selectedGpuPart.stock !== undefined && Number(selectedGpuPart.stock) <= 0) {
        stockWarns.push(selectedGpuPart.product_name + ' currently has 0 stock (maker must restock before you can produce PCs)');
      }
      specBox.innerHTML =
        '<div><b>Case:</b> ' + (cObj ? esc(cObj.case_name + ' (' + cStats.sizeMeta.label + ')') : 'Select a Case') + '</div>' +
        '<div><b>Cooling:</b> ' + (cObj ? esc(cStats.fanCount + ' Fans · ' + cStats.airflow) : '—') + '</div>' +
        '<div><b>Motherboard:</b> ' + (selectedMoboPart ? esc(selectedMoboPart.product_name + ' (' + moboSizeKey.toUpperCase() + ' · ' + Number(selectedMoboPart.design_data?.ram_slots || 0) + ' RAM · Stock: ' + (selectedMoboPart.stock ?? '?') + ')') : 'Base Tray (No Custom Mobo)') + '</div>' +
        '<div><b>CPU:</b> ' + (selectedCpuPart ? esc(selectedCpuPart.product_name + ' (' + (selectedCpuPart.core_count || 0) + 'C/' + (selectedCpuPart.thread_count || 0) + 'T · Stock: ' + (selectedCpuPart.stock ?? '?') + ')') : 'None selected') + '</div>' +
        '<div><b>GPU:</b> ' + (selectedGpuPart ? esc(selectedGpuPart.product_name + ' (' + gpuLen + '×' + gpuWid + '×' + gpuThick + 'mm · ' + (pcGpuMount === 'vertical' ? 'Vertical' : 'Horizontal') + ' · Stock: ' + (selectedGpuPart.stock ?? '?') + ')') : 'None selected') + '</div>' +
        '<div><b>RAM / PSU:</b> 850W PSU Included (Custom RAM &amp; PSU Soon)</div>' +
        (moboTooBig ? '<div class="ea-pc-fit-warn">Motherboard (' + esc(moboSizeKey.toUpperCase()) + ') is too big for ' + esc(cStats.sizeMeta.label) + '! Pick a larger Case or smaller Motherboard.</div>' : '') +
        (tooLong ? '<div class="ea-pc-fit-warn">Does not fit! GPU is ' + gpuLen + 'mm long, max for ' + esc(cStats.sizeMeta.label) + ' is ' + cStats.sizeMeta.maxGpuMm + 'mm.</div>' : '') +
        (stockWarns.length ? '<div class="ea-pc-fit-warn">' + esc(stockWarns.join(' · ')) + '</div>' : '');
    }

    const cap = $('#eaPcBuildCaption');
    if (cap) {
      cap.textContent = (cObj ? cObj.case_name : 'No Case') +
        (selectedMoboPart ? ' · ' + selectedMoboPart.product_name : '') +
        ' · ' + (selectedCpuPart ? selectedCpuPart.product_name : 'No CPU') +
        ' · ' + (selectedGpuPart ? selectedGpuPart.product_name : 'No GPU') +
        ' · Unit Cost $' + totalUnitCost.toLocaleString();
    }
  }

  function drawBuildStage() {
    const cObj = savedCases.find(c => c.id === selectedCaseId) || null;
    if (activePcView === 'build') {
      window.PcDesigner3D?.update?.(buildPcConfigFromCaseAndParts(cObj, selectedCpuPart, selectedGpuPart, { gpuMount: pcGpuMount, moboPart: selectedMoboPart }));
    }
  }

  // ---------- Public Component Search Modal ----------
  function ensureComponentModal() {
    let modal = $('#eaPcComponentModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'eaPcComponentModal';
    modal.className = 'modal-backdrop hidden';
    modal.style.zIndex = '130';
    modal.innerHTML =
      '<div class="modal-card ea-pc-comp-modal">' +
        '<div class="modal-head">' +
          '<div><div class="eyebrow purple-text">PUBLIC MARKETPLACE PARTS</div><h3 id="eaPcCompModalTitle">Select Component</h3></div>' +
          '<button type="button" class="zoom-btn" id="eaPcCompModalClose">✕</button>' +
        '</div>' +
        '<div class="ea-pc-comp-filters">' +
          '<input id="eaPcCompSearch" type="search" placeholder="Search part name, company, or specs…">' +
          '<select id="eaPcCompSort"><option value="newest">Newest</option><option value="price_asc">Price: Low → High</option><option value="price_desc">Price: High → Low</option><option value="popular">Most Popular</option></select>' +
        '</div>' +
        '<div id="eaPcCompGrid" class="ea-pc-comp-grid"></div>' +
      '</div>';
    document.body.appendChild(modal);
    modal.querySelector('#eaPcCompModalClose')?.addEventListener('click', () => modal.classList.add('hidden'));
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });
    modal.querySelector('#eaPcCompSearch')?.addEventListener('input', renderComponentModalGrid);
    modal.querySelector('#eaPcCompSort')?.addEventListener('change', renderComponentModalGrid);
    return modal;
  }

  async function openComponentBrowser(kind) {
    pickerKind = kind;
    const modal = ensureComponentModal();
    const title = $('#eaPcCompModalTitle');
    const grid = $('#eaPcCompGrid');
    const kindTitle = kind === 'gpu' ? 'Search Public GPUs' : kind === 'mobo' ? 'Search Public Motherboards' : 'Search Public CPUs';
    const kindPlural = kind === 'gpu' ? 'GPUs' : kind === 'mobo' ? 'Motherboards' : 'CPUs';
    if (title) title.textContent = kindTitle;
    if ($('#eaPcCompSearch')) $('#eaPcCompSearch').value = '';
    if (grid) grid.innerHTML = '<div class="muted">Loading public ' + kindPlural + '…</div>';
    modal.classList.remove('hidden');

    if (!sb) return;
    const { data, error } = await sb
      .from('product_company_products')
      .select('id,company_id,owner_id,product_name,product_line,listed_price,stock,purchase_count,cpu_score,cpu_tier,core_count,thread_count,body_type,cooling_type,graphics_type,carbon_fiber_body,silicon_body,v_cache_type,design_data,product_companies(id,company_name,owner_id,logo_data_url)')
      .eq('status', 'published')
      .order('created_at', { ascending: false })
      .limit(150);

    if (error) {
      if (grid) grid.innerHTML = '<p class="form-message">' + esc(error.message) + '</p>';
      return;
    }

    const rows = (data || []).filter(p => {
      if (isPcProductRow(p)) return false;
      const isGpuRow = typeof window.isGpuProductRow === 'function' ? window.isGpuProductRow(p) : (p.product_line === 'gpu');
      const isMoboRow = typeof window.isMoboProductRow === 'function' ? window.isMoboProductRow(p) : (p.product_line === 'motherboard');
      if (kind === 'gpu') return isGpuRow;
      if (kind === 'mobo') return isMoboRow;
      return !isGpuRow && !isMoboRow;
    });
    publicComponentsCache = rows;
    renderComponentModalGrid();
  }

  function renderComponentModalGrid() {
    const grid = $('#eaPcCompGrid');
    const modal = $('#eaPcComponentModal');
    if (!grid || !modal) return;

    const q = ($('#eaPcCompSearch')?.value || '').trim().toLowerCase();
    const sort = $('#eaPcCompSort')?.value || 'newest';
    const cObj = savedCases.find(c => c.id === selectedCaseId) || null;
    const maxGpuMm = cObj ? (CASE_SIZES[cObj.caseSize]?.maxGpuMm || 280) : 999;

    let rows = publicComponentsCache.filter(p => {
      if (!q) return true;
      const comp = p.product_companies?.company_name || '';
      const specTxt = pickerKind === 'gpu'
        ? (window.formatGpuHardwareBadges?.(p) || '')
        : pickerKind === 'mobo'
          ? (window.formatMoboHardwareBadges?.(p) || '')
          : `${p.core_count || 0} cores ${p.thread_count || 0} threads ${p.cooling_type || ''} ${p.v_cache_type || ''}`;
      return (p.product_name || '').toLowerCase().includes(q) ||
        comp.toLowerCase().includes(q) ||
        specTxt.toLowerCase().includes(q);
    });

    if (sort === 'price_asc') rows.sort((a, b) => Number(a.listed_price || 0) - Number(b.listed_price || 0));
    else if (sort === 'price_desc') rows.sort((a, b) => Number(b.listed_price || 0) - Number(a.listed_price || 0));
    else if (sort === 'popular') rows.sort((a, b) => Number(b.purchase_count || 0) - Number(a.purchase_count || 0));

    if (!rows.length) {
      const lbl = pickerKind === 'mobo' ? 'Motherboards' : pickerKind === 'gpu' ? 'GPUs' : 'CPUs';
      grid.innerHTML = '<p class="muted">No matching published ' + lbl + ' found.</p>';
      return;
    }

    const byId = new Map();
    const cpuSpecsById = new Map();
    grid.innerHTML = rows.map(p => {
      byId.set(p.id, p);
      const compName = p.product_companies?.company_name || 'GRIND Company';
      const price = Number(p.listed_price || 0);
      const stock = Number(p.stock || 0);
      const gpuCfg = pickerKind === 'gpu' && typeof window.buildGpuConfigFromProduct === 'function'
        ? window.buildGpuConfigFromProduct(p)
        : null;
      const gpuLen = Number(gpuCfg?.length || p.design_data?.length || 280);
      const tooLong = pickerKind === 'gpu' && gpuLen > maxGpuMm;
      const moboSizeKey = p.design_data?.board_size || p.body_type || 'small';
      const tooBigMobo = pickerKind === 'mobo' && cObj && !moboFitsCase(moboSizeKey, cObj.caseSize);
      const specLine = pickerKind === 'gpu'
        ? ((window.formatGpuSpecLine?.(p) || 'GPU') + ' · ' + gpuLen + 'mm' + (tooLong ? ' (Max ' + maxGpuMm + 'mm)' : ''))
        : pickerKind === 'mobo'
          ? ((window.formatMoboSpecLine?.(p) || 'Motherboard') + (tooBigMobo ? ' (Needs larger case)' : ''))
          : (Number(p.core_count || 0) + ' Cores · ' + Number(p.thread_count || 0) + ' Threads');
      let thumbHtml = '';
      if (pickerKind === 'gpu') {
        thumbHtml = '<div class="ea-gpu-product-thumb-wrap" data-gpu-thumb-id="' + esc(p.id) + '">' + (window.renderGpuThumbHtml?.(p) || '') + '</div>';
      } else if (pickerKind === 'mobo') {
        thumbHtml = '<div class="ea-gpu-product-thumb-wrap" data-mobo-thumb-id="' + esc(p.id) + '">' + (window.renderMoboThumbHtml?.(p) || '') + '</div>';
      } else if (typeof window.resolveCpuProductSpec === 'function' && typeof window.renderCpuThumbHtml === 'function') {
        const cpuSpec = window.resolveCpuProductSpec(p);
        cpuSpecsById.set(p.id, cpuSpec);
        thumbHtml = '<div class="ea-gpu-product-thumb-wrap" data-cpu-thumb-id="' + esc(p.id) + '">' + window.renderCpuThumbHtml(p, cpuSpec) + '</div>';
      } else {
        thumbHtml = '<div class="ea-pc-cpu-thumb-box"><span class="ea-pc-cpu-pill">CPU · ' + esc(p.cpu_tier || 'F') + '</span><strong>' + esc(p.product_name) + '</strong></div>';
      }

      const pickLbl = tooLong ? 'Too Long' : tooBigMobo ? 'Too Big' : 'Add to PC';
      return '<article class="ea-pc-comp-card">' +
        thumbHtml +
        '<div class="ea-pc-comp-meta"><strong>' + esc(p.product_name) + '</strong><small>by ' + esc(compName) + '</small><small>' + esc(specLine) + '</small></div>' +
        '<div class="ea-pc-comp-foot"><span>$' + price.toLocaleString() + '/unit · ' + (stock > 0 ? stock + ' in stock' : 'Out of stock (0)') + '</span>' +
        '<div style="display:flex;gap:6px;align-items:center;">' +
        '<button type="button" class="zoom-btn" data-pc-preview-part="' + esc(p.id) + '" title="Preview 3D">👁 Preview</button>' +
        '<button type="button" class="primary-btn" data-pc-pick-part="' + esc(p.id) + '">' + pickLbl + '</button></div></div>' +
      '</article>';
    }).join('');

    if (pickerKind === 'gpu') window.hydrateGpuThumbElements?.(grid, byId, 320, 240);
    else if (pickerKind === 'mobo') window.hydrateMoboThumbElements?.(grid, byId, 320, 240);
    else if (cpuSpecsById.size && typeof window.hydrateCpuThumbElements === 'function') window.hydrateCpuThumbElements(grid, cpuSpecsById, 280);

    grid.querySelectorAll('[data-pc-preview-part]').forEach(btn => btn.addEventListener('click', e => {
      e.stopPropagation();
      const part = byId.get(btn.dataset.pcPreviewPart);
      if (part) window.openProductPreview?.(part, part.product_companies?.company_name);
    }));

    grid.querySelectorAll('[data-pc-pick-part]').forEach(btn => btn.addEventListener('click', () => {
      const part = byId.get(btn.dataset.pcPickPart);
      if (!part) return;
      if (pickerKind === 'gpu') selectedGpuPart = part;
      else if (pickerKind === 'mobo') selectedMoboPart = part;
      else selectedCpuPart = part;
      modal.classList.add('hidden');
      updateBuildSpecsReadout();
      drawBuildStage();
      toast('Added ' + part.product_name + ' to PC build!');
    }));
  }

  // ---------- Save PC Draft / Edit / Produce ----------
  function syncPcSaveButtonUI() {
    const saveBtn = $('#eaPcSaveBuild');
    const cancelBtn = $('#eaPcCancelEdit');
    if (saveBtn) saveBtn.textContent = editingPcProductId ? 'Save edits · Free' : 'Save as draft · Free';
    if (cancelBtn) cancelBtn.classList.toggle('hidden', !editingPcProductId);
  }

  function resetPcDraftState() {
    editingPcProductId = null;
    editingPcOldName = '';
    selectedMoboPart = null;
    selectedCpuPart = null;
    selectedGpuPart = null;
    pcGpuMount = 'horizontal';
    document.querySelectorAll('[data-pc-gpu-mount]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.pcGpuMount === 'horizontal');
    });
    if ($('#eaPcName')) $('#eaPcName').value = 'Nova Gaming PC';
    if ($('#eaPcPrice')) $('#eaPcPrice').value = '1800';
    if ($('#eaPcBuildMessage')) $('#eaPcBuildMessage').textContent = '';
    syncPcSaveButtonUI();
  }

  async function savePcProduct(skipRitual) {
    if (!currentCompany || !currentUser || !sb) return;
    const name = ($('#eaPcName')?.value || '').trim();
    const msgEl = $('#eaPcBuildMessage');
    if (name.length < 2) { if (msgEl) msgEl.textContent = 'Enter a PC name (at least 2 characters).'; return; }
    const cObj = savedCases.find(c => c.id === selectedCaseId);
    if (!cObj) { if (msgEl) msgEl.textContent = 'Select a saved Case first (design one in the CASE tab).'; return; }
    if (!selectedMoboPart && !selectedCpuPart && !selectedGpuPart) {
      if (msgEl) msgEl.textContent = 'Add at least a Motherboard, CPU, or GPU to your PC before saving.';
      return;
    }

    const { cStats, totalUnitCost } = computePcBuildValues();
    if (selectedMoboPart) {
      const mSize = selectedMoboPart.design_data?.board_size || selectedMoboPart.body_type || 'small';
      if (!moboFitsCase(mSize, cObj.caseSize)) {
        const err = 'Motherboard (' + mSize.toUpperCase() + ') does not fit inside ' + cStats.sizeMeta.label + '. Pick a larger Case or smaller Motherboard.';
        if (msgEl) msgEl.textContent = err;
        toast(err);
        return;
      }
    }
    if (selectedGpuPart) {
      const gpuCfg = typeof window.buildGpuConfigFromProduct === 'function' ? window.buildGpuConfigFromProduct(selectedGpuPart) : null;
      const gLen = Number(gpuCfg?.length || selectedGpuPart.design_data?.length || 280);
      if (gLen > cStats.sizeMeta.maxGpuMm) {
        const err = 'GPU (' + gLen + 'mm) is too long for ' + cStats.sizeMeta.label + ' (max ' + cStats.sizeMeta.maxGpuMm + 'mm). Pick a larger Case or shorter GPU.';
        if (msgEl) msgEl.textContent = err;
        toast(err);
        return;
      }
    }

    const listedPrice = Math.max(1, Number($('#eaPcPrice')?.value) || 1);
    const pcCfg = buildPcConfigFromCaseAndParts(cObj, selectedCpuPart, selectedGpuPart, { gpuMount: pcGpuMount, moboPart: selectedMoboPart });

    if (skipRitual !== true && typeof window.PcAssemblyRitual?.open === 'function') {
      window.PcAssemblyRitual.open(pcCfg, { name }, () => savePcProduct(true));
      return;
    }

    let snapshot = '';
    if (activePcView === 'build') {
      snapshot = window.PcDesigner3D?.captureSnapshot?.({ width: 360, height: 270 }) || '';
    }
    if (!snapshot && typeof window.PcDesigner3D?.captureHeroSnapshot === 'function') {
      snapshot = await window.PcDesigner3D.captureHeroSnapshot(pcCfg, 360, 270);
    }

    const moboBuilt = selectedMoboPart && typeof window.buildMoboConfigFromProduct === 'function'
      ? window.buildMoboConfigFromProduct(selectedMoboPart)
      : null;
    const slimMobo = selectedMoboPart ? {
      id: selectedMoboPart.id,
      company_id: selectedMoboPart.company_id || selectedMoboPart.product_companies?.id,
      company_name: selectedMoboPart.product_companies?.company_name || selectedMoboPart.company_name || '',
      company_logo: moboBuilt?.logoUrl || selectedMoboPart.product_companies?.logo_data_url || selectedMoboPart.company_logo || '',
      product_name: selectedMoboPart.product_name,
      listed_price: Number(selectedMoboPart.listed_price || 0),
      body_type: selectedMoboPart.body_type || moboBuilt?.boardSize || 'small',
      cpu_score: Number(selectedMoboPart.cpu_score || 0),
      cpu_tier: String(selectedMoboPart.cpu_tier || 'F'),
      design_data: {
        mobo_build: true,
        board_size: moboBuilt?.boardSize || selectedMoboPart.design_data?.board_size || selectedMoboPart.body_type || 'small',
        ram_slots: Number(moboBuilt?.ramSlots ?? selectedMoboPart.design_data?.ram_slots ?? 0),
        pcb_color: moboBuilt?.pcbColor || selectedMoboPart.design_data?.pcb_color || '#121620',
        armor_color: moboBuilt?.armorColor || selectedMoboPart.design_data?.armor_color || '#1f2533',
        accent_color: moboBuilt?.accentColor || selectedMoboPart.design_data?.accent_color || '#a855f7',
        vrm_style: moboBuilt?.vrmStyle || selectedMoboPart.design_data?.vrm_style || 'finned',
        io_shield: moboBuilt ? !!moboBuilt.ioShield : (selectedMoboPart.design_data?.io_shield !== false),
        m2_shield: moboBuilt ? !!moboBuilt.m2Shield : (selectedMoboPart.design_data?.m2_shield !== false),
        rgb_accent: !!(moboBuilt?.rgbAccent ?? selectedMoboPart.design_data?.rgb_accent)
      }
    } : null;

    const resolvedCpu = selectedCpuPart && typeof window.resolveCpuProductSpec === 'function'
      ? window.resolveCpuProductSpec(selectedCpuPart)
      : null;
    const slimCpu = selectedCpuPart ? {
      id: selectedCpuPart.id,
      company_id: selectedCpuPart.company_id || selectedCpuPart.product_companies?.id,
      company_name: selectedCpuPart.product_companies?.company_name || selectedCpuPart.company_name || '',
      company_logo: resolvedCpu?.logoUrl || selectedCpuPart.product_companies?.logo_data_url || selectedCpuPart.company_logo || '',
      product_name: selectedCpuPart.product_name,
      listed_price: Number(selectedCpuPart.listed_price || 0),
      core_count: Number(selectedCpuPart.core_count ?? resolvedCpu?.cores ?? 0),
      thread_count: Number(selectedCpuPart.thread_count ?? resolvedCpu?.threads ?? 0),
      cpu_score: Number(selectedCpuPart.cpu_score ?? resolvedCpu?.score ?? 0),
      cpu_tier: String(selectedCpuPart.cpu_tier || resolvedCpu?.tier || 'F'),
      cooling_type: selectedCpuPart.cooling_type || 'none',
      body_type: selectedCpuPart.body_type || 'gray',
      graphics_type: selectedCpuPart.graphics_type || resolvedCpu?.graphics || '',
      v_cache_type: selectedCpuPart.v_cache_type || resolvedCpu?.vCache || 'none',
      carbon_fiber_body: !!selectedCpuPart.carbon_fiber_body,
      silicon_body: !!selectedCpuPart.silicon_body,
      design_data: {
        ai: resolvedCpu?.ai || selectedCpuPart.design_data?.ai || ''
      }
    } : null;

    let slimGpuDesign = {};
    if (selectedGpuPart) {
      const rawGd = selectedGpuPart.design_data && typeof selectedGpuPart.design_data === 'object' ? { ...selectedGpuPart.design_data } : {};
      delete rawGd.thumbnail;
      const builtG = typeof window.buildGpuConfigFromProduct === 'function' ? window.buildGpuConfigFromProduct(selectedGpuPart) : null;
      slimGpuDesign = {
        ...rawGd,
        chip_name: rawGd.chip_name || '',
        length: Number(builtG?.length ?? rawGd.length ?? 280),
        width: Number(builtG?.width ?? rawGd.width ?? 125),
        thickness: Number(builtG?.thickness ?? rawGd.thickness ?? 52),
        primary_color: builtG?.primaryColor || rawGd.primary_color || '#222733',
        accent_color: builtG?.accentColor || rawGd.accent_color || '#a855f7',
        body: builtG?.body || rawGd.body || selectedGpuPart.body_type || 'plastic',
        finish: builtG?.finish || rawGd.finish || 'satin',
        shroud: builtG?.shroud || rawGd.shroud || 'rounded',
        backplate: builtG ? !!builtG.backplate : (rawGd.backplate !== false),
        backplate_style: builtG?.backplateStyle || rawGd.backplate_style || 'flow_through',
        fin_style: builtG?.finStyle || rawGd.fin_style || 'silver',
        pipe_style: builtG?.pipeStyle || rawGd.pipe_style || 'copper',
        power_type: builtG?.powerType || rawGd.power_type || '12v2x6',
        io_style: builtG?.ioStyle || rawGd.io_style || 'steel',
        custom_shape: builtG?.customShape || rawGd.custom_shape || null,
        elements: Array.isArray(builtG?.elements) ? builtG.elements : (Array.isArray(rawGd.elements) ? rawGd.elements : [])
      };
    }

    const slimGpu = selectedGpuPart ? {
      id: selectedGpuPart.id,
      company_id: selectedGpuPart.company_id || selectedGpuPart.product_companies?.id,
      company_name: selectedGpuPart.product_companies?.company_name || selectedGpuPart.company_name || '',
      product_name: selectedGpuPart.product_name,
      listed_price: Number(selectedGpuPart.listed_price || 0),
      body_type: selectedGpuPart.body_type || 'plastic',
      design_data: slimGpuDesign
    } : null;

    const designData = {
      pc_build: true,
      case_id: cObj.id,
      case_name: cObj.case_name,
      case_size: cObj.caseSize,
      case_material: cObj.material,
      front_style: cObj.frontStyle,
      primary_color: cObj.primaryColor,
      accent_color: cObj.accentColor,
      rgb_enabled: !!cObj.rgbEnabled,
      rgb_mode: cObj.rgbMode,
      rgb_color: cObj.rgbColor,
      gpu_mount: pcGpuMount,
      fans: cObj.fans,
      fan_count: cStats.fanCount,
      case_build_cost: cStats.buildCost,
      airflow: cStats.airflow,
      case_config: cObj,
      component_ids: [slimMobo?.id, slimCpu?.id, slimGpu?.id].filter(Boolean),
      components: { motherboard: slimMobo, cpu: slimCpu, gpu: slimGpu },
      thumbnail: snapshot || ''
    };

    const wasEditingId = editingPcProductId;
    const oldName = editingPcOldName;
    const saveBtn = $('#eaPcSaveBuild');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = wasEditingId ? 'Saving edits…' : 'Saving…'; }

    let data = null;
    let error = null;

    const rpcRes = await sb.rpc('save_pc_product_draft', {
      p_product_id: wasEditingId || null,
      p_company_id: currentCompany.id,
      p_product_name: name,
      p_body_type: cObj.caseSize || 'small',
      p_production_cost: totalUnitCost,
      p_product_value: totalUnitCost,
      p_listed_price: listedPrice,
      p_design_data: designData
    });

    if (!rpcRes.error) {
      data = rpcRes.data;
    } else if (rpcRes.error.code === 'PGRST202' || /could not find the function/i.test(rpcRes.error.message || '')) {
      if (wasEditingId) {
        const res = await sb
          .from('product_company_products')
          .update({
            product_name: name,
            body_type: cObj.caseSize || 'small',
            production_cost: totalUnitCost,
            product_value: totalUnitCost,
            listed_price: listedPrice,
            design_data: designData
          })
          .eq('id', wasEditingId)
          .eq('owner_id', currentUser.id)
          .in('status', ['draft', 'published'])
          .select('id,product_name')
          .single();
        data = res.data;
        error = res.error;
      } else {
        const res = await sb.from('product_company_products').insert({
          company_id: currentCompany.id,
          owner_id: currentUser.id,
          product_line: 'pc',
          product_name: name,
          body_type: cObj.caseSize || 'small',
          production_cost: totalUnitCost,
          product_value: totalUnitCost,
          listed_price: listedPrice,
          cpu_score: 0,
          cpu_tier: 'F',
          stock: 0,
          status: 'draft',
          design_data: designData
        }).select('id,product_name').single();
        data = res.data;
        error = res.error;
      }
    } else {
      error = rpcRes.error;
    }

    if (saveBtn) saveBtn.disabled = false;

    if (error) {
      if (msgEl) msgEl.textContent = 'Could not save PC draft: ' + error.message;
      syncPcSaveButtonUI();
      return;
    }

    const savedId = data?.id || wasEditingId;
    if (oldName && oldName !== name) clearPcThumb('name:' + oldName);
    if (snapshot) {
      if (savedId) savePcThumb(savedId, snapshot);
      savePcThumb('name:' + name, snapshot);
      if (savedId) applyPcThumbToDom(savedId, name, snapshot);
    }

    editingPcProductId = null;
    editingPcOldName = '';
    if (savedId) {
      selectedCompanyProductId = savedId;
      selectedPcPageProductId = savedId;
    }
    syncPcSaveButtonUI();
    if (msgEl) msgEl.textContent = wasEditingId ? 'PC product updated!' : 'PC saved as draft! Publish it from Products.';
    toast(wasEditingId ? 'PC product updated!' : 'PC draft saved!');
    await loadCompanyResearchAndProducts();
    renderPcProducts();
    if (typeof renderCompanyProducts === 'function') renderCompanyProducts();
  }

  function loadPcDraftIntoEditor(p) {
    if (!p) { toast('PC product not found.'); return; }
    const d = p.design_data || {};
    if (d.case_id && savedCases.some(c => c.id === d.case_id)) {
      selectedCaseId = d.case_id;
    } else if (d.case_config) {
      const tempCase = normalizeCaseRow({ id: d.case_id || ('temp_' + p.id), case_name: d.case_name || 'Saved Case', ...d.case_config });
      if (!savedCases.some(c => c.id === tempCase.id)) savedCases.unshift(tempCase);
      selectedCaseId = tempCase.id;
    }
    selectedMoboPart = d.components?.motherboard ? { ...d.components.motherboard, product_companies: { company_name: d.components.motherboard.company_name, logo_data_url: d.components.motherboard.company_logo || '' } } : null;
    selectedCpuPart = d.components?.cpu ? { ...d.components.cpu, product_companies: { company_name: d.components.cpu.company_name, logo_data_url: d.components.cpu.company_logo || '' } } : null;
    selectedGpuPart = d.components?.gpu ? { ...d.components.gpu, product_companies: { company_name: d.components.gpu.company_name } } : null;
    pcGpuMount = d.gpu_mount === 'vertical' ? 'vertical' : 'horizontal';
    editingPcProductId = p.id;
    editingPcOldName = p.product_name || '';

    showPage('company-design');
    mountPcWorkspace();
    setPcView('build');
    if ($('#eaPcName')) $('#eaPcName').value = p.product_name || 'Nova Gaming PC';
    if ($('#eaPcPrice')) $('#eaPcPrice').value = String(Math.max(1, Number(p.listed_price || 1800)));
    if ($('#eaPcBuildMessage')) $('#eaPcBuildMessage').textContent = 'Editing product "' + (p.product_name || 'PC') + '".';
    document.querySelectorAll('[data-pc-gpu-mount]').forEach(b => b.classList.toggle('active', b.dataset.pcGpuMount === pcGpuMount));
    renderBuildCaseSelector();
    updateBuildSpecsReadout();
    syncPcSaveButtonUI();
    drawBuildStage();
    toast('Loaded PC product into builder.');
  }

  window.editPcDraftProduct = function (id) {
    const p = (companyProducts || []).find(x => x.id === id);
    if (p) loadPcDraftIntoEditor(p);
  };

  // ---------- PC Products Page ----------
  function mountPcProductsPage() {
    const page = $('#page-company-products');
    if (!page) return;
    page.innerHTML =
      '<div class="section-head"><div><div class="eyebrow purple-text">PC MANUFACTURING</div><h3>PC Products</h3><p class="muted">Select a PC to inspect Specs, edit drafts, publish, or produce units (part prices are paid directly to each part\'s company).</p></div></div>' +
      '<div id="eaPcProductList" class="ea-gpu-product-grid"></div>' +
      '<div id="eaPcProductDetails" class="company-product-details hidden"></div>';
  }

  function renderPcProducts() {
    if (!isPc()) return;
    const el = $('#eaPcProductList');
    const detailEl = $('#eaPcProductDetails');
    if (!el) return;
    const rows = (companyProducts || []).filter(p => isPcProductRow(p));
    if (!rows.length) {
      el.innerHTML = '<div class="company-empty-products"><span>▣</span><strong>No PC builds yet</strong><p class="muted">Create a Case and assemble your first PC in Design.</p></div>';
      detailEl?.classList.add('hidden');
      return;
    }
    if (!selectedPcPageProductId || !rows.some(r => r.id === selectedPcPageProductId)) {
      selectedPcPageProductId = rows[0].id;
    }
    const byId = new Map();
    el.innerHTML = rows.map(p => {
      byId.set(p.id, p);
      const draft = isProductDraft(p);
      const active = p.id === selectedPcPageProductId;
      return (
        '<article class="ea-chip-card ea-gpu-product-card' + (active ? ' active' : '') + '" data-ea-pc-select="' + esc(p.id) + '" tabindex="0" role="button">' +
          '<div class="ea-gpu-product-thumb-wrap" data-pc-thumb-id="' + esc(p.id) + '">' + renderPcThumbHtml(p) + '</div>' +
          '<b>' + esc(p.product_name || 'PC') + '</b>' +
          '<small>' + esc(formatPcSpecLine(p)) + '</small>' +
          '<small>$' + Number(p.listed_price || 0).toLocaleString() + ' · ' + (draft ? 'Draft' : 'Published') + '</small>' +
        '</article>'
      );
    }).join('');
    hydratePcThumbElements(el, byId, 360, 270);

    el.querySelectorAll('[data-ea-pc-select]').forEach(card => {
      card.addEventListener('click', () => {
        selectedPcPageProductId = card.dataset.eaPcSelect;
        renderPcProducts();
      });
    });

    const selected = rows.find(r => r.id === selectedPcPageProductId);
    if (!detailEl || !selected) { detailEl?.classList.add('hidden'); return; }
    const draft = isProductDraft(selected);
    const canEdit = selected.owner_id === currentUser?.id;
    const unitValue = Math.max(0, Number(selected.product_value ?? selected.production_cost ?? 0));
    const stockCount = Number(selected.stock || 0);
    const d = selected.design_data || {};
    const comps = d.components || {};
    const payoutNote = [
      comps.motherboard ? (comps.motherboard.product_name + ' ($' + Number(comps.motherboard.listed_price || 0).toLocaleString() + ' → ' + (comps.motherboard.company_name || 'Mobo Co.') + ')') : null,
      comps.cpu ? (comps.cpu.product_name + ' ($' + Number(comps.cpu.listed_price || 0).toLocaleString() + ' → ' + (comps.cpu.company_name || 'CPU Co.') + ')') : null,
      comps.gpu ? (comps.gpu.product_name + ' ($' + Number(comps.gpu.listed_price || 0).toLocaleString() + ' → ' + (comps.gpu.company_name || 'GPU Co.') + ')') : null
    ].filter(Boolean).join(' + ');

    const produceBlock = draft
      ? '<p class="muted tiny" style="margin:4px 0 0;">Publish this draft before producing PCs.</p>'
      : '<label>Produce quantity (costs $' + unitValue.toLocaleString() + '/PC · pays makers &amp; uses 1 part stock each)<input id="eaPcProduceQty" type="number" min="1" max="100000" value="1"></label>' +
        (payoutNote ? '<p class="muted tiny" style="margin:2px 0 8px;">Per-unit creator payouts &amp; stock deduction: ' + esc(payoutNote) + '</p>' : '') +
        '<div class="company-product-details-actions">' +
          '<button type="button" class="primary-btn" id="eaPcProduceBtn">Produce 1 · $' + unitValue.toLocaleString() + '</button>' +
          '<button type="button" class="danger-btn" id="eaPcLiquidateBtn" ' + (stockCount > 0 ? '' : 'disabled') + '>Delete stock · 50% refund</button>' +
        '</div>';

    detailEl.classList.remove('hidden');
    detailEl.innerHTML =
      '<div class="company-product-detail-hero">' +
        '<div class="company-product-detail-thumb company-product-detail-thumb-gpu" data-pc-thumb-id="' + esc(selected.id) + '">' + renderPcThumbHtml(selected) + '</div>' +
        '<div class="company-product-detail-title"><h4>' + esc(selected.product_name || 'PC') + '</h4>' +
        '<p class="muted tiny">' + (draft ? 'Draft (Not yet published)' : 'Published on Product Feed') + '</p>' +
        '<small class="company-product-detail-specs">' + esc(formatPcHardwareBadges(selected)) + '</small></div>' +
      '</div>' +
      '<div class="company-product-detail-grid">' +
        '<div class="company-product-detail-stat"><span>Build cost / unit</span><strong>$' + unitValue.toLocaleString() + '</strong></div>' +
        '<div class="company-product-detail-stat"><span>Listed price</span><strong>$' + Number(selected.listed_price || 0).toLocaleString() + '</strong></div>' +
        '<div class="company-product-detail-stat"><span>Stock</span><strong>' + (stockCount > 0 ? stockCount : 'Out Of Stock') + '</strong></div>' +
        '<div class="company-product-detail-stat"><span>Units sold</span><strong>' + Number(selected.purchase_count || 0) + '</strong></div>' +
      '</div>' +
      '<label>Listing price ($)<input id="eaPcDetailPrice" type="number" min="1" value="' + Number(selected.listed_price || 1) + '"></label>' +
      produceBlock +
      '<div class="company-product-details-actions">' +
        '<button type="button" class="zoom-btn" id="eaPcDetailPreview">👁 Preview</button>' +
        (canEdit ? '<button type="button" class="primary-btn" id="eaPcDetailEdit">Edit</button>' : '') +
        '<button type="button" class="zoom-btn" id="eaPcDetailSavePrice">Save price</button>' +
        (draft ? '<button type="button" class="primary-btn" id="eaPcDetailPublish">Publish PC</button><button type="button" class="danger-btn" id="eaPcDetailDeleteDraft">Delete draft</button>' : '') +
      '</div>' +
      '<p class="form-message" id="eaPcDetailMessage"></p>';

    hydratePcThumbElements(detailEl, new Map([[selected.id, selected]]), 360, 270);
    const msgEl = $('#eaPcDetailMessage');
    if (!draft) {
      const qtyInput = $('#eaPcProduceQty');
      const prodBtn = $('#eaPcProduceBtn');
      const syncBtn = () => {
        const q = Math.max(1, Math.min(100000, Math.floor(Number(qtyInput?.value || 1))));
        const total = unitValue * q;
        if (prodBtn) prodBtn.textContent = 'Produce ' + q + ' · $' + total.toLocaleString();
      };
      syncBtn();
      qtyInput?.addEventListener('input', syncBtn);
      prodBtn?.addEventListener('click', () => {
        const q = Math.max(1, Math.min(100000, Math.floor(Number(qtyInput?.value || 1))));
        window.produceMoreProduct?.(selected.id, q, msgEl);
      });
      $('#eaPcLiquidateBtn')?.addEventListener('click', () => window.liquidateProductStock?.(selected.id, msgEl));
    }
    $('#eaPcDetailPreview')?.addEventListener('click', () => window.openProductPreview?.(selected, currentCompany?.company_name));
    $('#eaPcDetailEdit')?.addEventListener('click', () => loadPcDraftIntoEditor(selected));
    $('#eaPcDetailDeleteDraft')?.addEventListener('click', () => window.deleteDraftProduct?.(selected.id, msgEl));
    const saveOrPublish = async publish => {
      const amount = Number($('#eaPcDetailPrice')?.value || 0);
      if (!Number.isFinite(amount) || amount <= 0) { if (msgEl) msgEl.textContent = 'Enter a valid price.'; return; }
      const result = await sb.rpc('update_cpu_product_listing', { p_product_id: selected.id, p_listed_price: amount, p_publish: publish });
      if (result.error) { if (msgEl) msgEl.textContent = result.error.message; return; }
      await loadCompanyResearchAndProducts();
      renderPcProducts();
      if (typeof renderCompanyProducts === 'function') renderCompanyProducts();
      toast(publish ? 'PC published to Product Feed!' : 'PC price updated.');
    };
    $('#eaPcDetailSavePrice')?.addEventListener('click', () => saveOrPublish(false));
    $('#eaPcDetailPublish')?.addEventListener('click', () => saveOrPublish(true));
  }
  window.renderEaPcProducts = renderPcProducts;

  // ---------- Mount / Show / Hide Workspace ----------
  function setPcView(view) {
    activePcView = view === 'build' ? 'build' : 'case';
    document.querySelectorAll('[data-pc-tab]').forEach(b => b.classList.toggle('active', b.dataset.pcTab === activePcView));
    $('#eaPcCaseView')?.classList.toggle('hidden', activePcView !== 'case');
    $('#eaPcBuildView')?.classList.toggle('hidden', activePcView !== 'build');
    const stageId = activePcView === 'case' ? '#eaPcCase3DStage' : '#eaPcBuild3DStage';
    const stage = $(stageId);
    if (stage && window.PcDesigner3D?.mount) {
      window.PcDesigner3D.mount(stage).then(() => {
        if (activePcView === 'case') drawCaseStage();
        else { renderBuildCaseSelector(); updateBuildSpecsReadout(); drawBuildStage(); }
        requestAnimationFrame(() => window.PcDesigner3D?.resize?.());
      });
    }
  }

  function mountPcWorkspace() {
    if (!isPc()) return;
    $('#page-company-design #cpuDesigner')?.classList.add('hidden');
    $('#page-company-design #eaGpuPanel')?.classList.add('hidden');
    $('#page-company-design #eaMoboPanel')?.classList.add('hidden');
    $('#page-company-design #companyDesignNoCompany')?.classList.add('hidden');

    const page = $('#page-company-design');
    if (!page) return;
    let panel = $('#eaPcPanel');
    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'eaPcPanel';
      panel.className = 'company-dashboard-section ea-gpu-panel';
      panel.innerHTML =
        '<div class="ea-gpu-tabs">' +
          '<button type="button" data-pc-tab="case" class="active">1 · CASE</button>' +
          '<button type="button" data-pc-tab="build">2 · PC BUILD</button>' +
        '</div>' +
        '<div id="eaPcCaseView" class="ea-gpu-view">' +
          '<div class="cpu-designer-layout ea-gpu-layout-match">' +
            '<div class="cpu-preview-panel">' +
              '<div class="cpu-preview-toolbar"><span>3D PC CASE PREVIEW</span><small>Drag to orbit · Scroll to zoom</small></div>' +
              '<div id="eaPcCase3DStage" class="ea-pc-3d-stage"><div class="gpu-3d-loading">Loading 3D PC Case designer…</div></div>' +
              '<div id="eaPcCaseCaption" class="cpu-preview-caption">Small Case · Matte Steel · 0 Fans</div>' +
            '</div>' +
            '<div class="cpu-options-panel ea-gpu-sidebar">' +
              '<div class="cpu-menu-tabs ea-pc-case-menu-tabs" role="tablist">' +
                '<button type="button" class="active" data-pc-case-menu="chassis">Chassis</button>' +
                '<button type="button" data-pc-case-menu="fans">Fans</button>' +
                '<button type="button" data-pc-case-menu="lighting">Lighting</button>' +
              '</div>' +
              '<div id="eaPcCaseMenu_chassis" class="cpu-menu-content"></div>' +
              '<div id="eaPcCaseMenu_fans" class="cpu-menu-content hidden"></div>' +
              '<div id="eaPcCaseMenu_lighting" class="cpu-menu-content hidden"></div>' +
              '<div class="cpu-design-summary">' +
                '<div><span>Case Build Cost</span><strong id="eaPcCaseBuildCost">$60</strong></div>' +
                '<div><span>Airflow Spec</span><strong id="eaPcCaseAirflow">Passive</strong></div>' +
              '</div>' +
              '<label class="cpu-design-label">Case name<input id="eaPcCaseName" maxlength="40" value="Starter Case"></label>' +
              '<button class="primary-btn full" id="eaPcSaveCaseBtn" type="button">Save Case</button>' +
              '<p id="eaPcCaseMessage" class="form-message"></p>' +
            '</div>' +
          '</div>' +
          '<div id="eaSavedPcCases" class="ea-saved-chips"></div>' +
        '</div>' +
        '<div id="eaPcBuildView" class="ea-gpu-view hidden">' +
          '<div class="cpu-designer-layout ea-gpu-layout-match">' +
            '<div class="cpu-preview-panel">' +
              '<div class="cpu-preview-toolbar"><span>3D PC SYSTEM ASSEMBLY</span><small>Real Specs · No Tiers</small></div>' +
              '<div id="eaPcBuild3DStage" class="ea-pc-3d-stage"><div class="gpu-3d-loading">Loading 3D PC Builder…</div></div>' +
              '<div id="eaPcBuildCaption" class="cpu-preview-caption">Select a Case, Motherboard, CPU &amp; GPU</div>' +
            '</div>' +
            '<div class="cpu-options-panel ea-gpu-sidebar">' +
              '<h4>1. Choose Saved Case</h4>' +
              '<div id="eaPcBuildCaseList" class="ea-pc-case-pick-list"></div>' +
              '<h4 style="margin-top:12px">2. Add Public Components</h4>' +
              '<div class="ea-pc-part-buttons">' +
                '<button type="button" class="primary-btn" id="eaPcPickMoboBtn">＋ Motherboard</button>' +
                '<button type="button" class="primary-btn" id="eaPcPickCpuBtn">＋ CPU</button>' +
                '<button type="button" class="primary-btn" id="eaPcPickGpuBtn">＋ GPU</button>' +
                '<button type="button" class="zoom-btn" id="eaPcPickRamBtn">RAM · Soon</button>' +
                '<button type="button" class="zoom-btn" id="eaPcPickPsuBtn">Power Supply · Soon</button>' +
              '</div>' +
              '<div id="eaPcSelectedMoboCard" class="ea-pc-picked-slot"></div>' +
              '<div id="eaPcSelectedCpuCard" class="ea-pc-picked-slot"></div>' +
              '<div id="eaPcSelectedGpuCard" class="ea-pc-picked-slot"></div>' +
              '<div class="ea-gpu-inline-box" style="margin-top:8px;"><span>GPU Mount Orientation</span>' +
                '<div class="ea-gpu-pill-row">' +
                  '<button type="button" class="zoom-btn active" data-pc-gpu-mount="horizontal">Horizontal Slot</button>' +
                  '<button type="button" class="zoom-btn" data-pc-gpu-mount="vertical">Vertical Riser</button>' +
                '</div>' +
              '</div>' +
              '<h4 style="margin-top:12px">3. PC Specs</h4>' +
              '<div id="eaPcSpecsPanel" class="ea-pc-specs-panel"></div>' +
              '<div class="cpu-design-summary">' +
                '<div><span>Build Cost / Unit</span><strong id="eaPcTotalCost">$0</strong></div>' +
                '<div><span>Parts Installed</span><strong id="eaPcPartsSummary">No CPU · No GPU</strong></div>' +
              '</div>' +
              '<label class="cpu-design-label">PC name<input id="eaPcName" maxlength="48" value="Nova Gaming PC"></label>' +
              '<label class="cpu-design-label">Listing price ($)<input id="eaPcPrice" type="number" min="1" step="1" value="1800"></label>' +
              '<div class="ea-gpu-save-row">' +
                '<button class="primary-btn full" id="eaPcSaveBuild" type="button">Save as draft · Free</button>' +
                '<button class="zoom-btn hidden" id="eaPcCancelEdit" type="button">Cancel edit</button>' +
              '</div>' +
              '<p id="eaPcBuildMessage" class="form-message"></p>' +
            '</div>' +
          '</div>' +
        '</div>';
      page.appendChild(panel);

      panel.querySelectorAll('[data-pc-tab]').forEach(b => b.addEventListener('click', () => setPcView(b.dataset.pcTab)));
      panel.querySelectorAll('[data-pc-case-menu]').forEach(b => b.addEventListener('click', () => setCaseMenuTab(b.dataset.pcCaseMenu)));
      panel.querySelectorAll('[data-pc-gpu-mount]').forEach(b => b.addEventListener('click', () => {
        pcGpuMount = b.dataset.pcGpuMount === 'vertical' ? 'vertical' : 'horizontal';
        panel.querySelectorAll('[data-pc-gpu-mount]').forEach(x => x.classList.toggle('active', x === b));
        updateBuildSpecsReadout();
        drawBuildStage();
      }));
      panel.querySelector('#eaPcSaveCaseBtn')?.addEventListener('click', saveCaseDesign);
      panel.querySelector('#eaPcPickMoboBtn')?.addEventListener('click', () => openComponentBrowser('mobo'));
      panel.querySelector('#eaPcPickCpuBtn')?.addEventListener('click', () => openComponentBrowser('cpu'));
      panel.querySelector('#eaPcPickGpuBtn')?.addEventListener('click', () => openComponentBrowser('gpu'));
      panel.querySelector('#eaPcPickRamBtn')?.addEventListener('click', () => toast('RAM companies will be added in a future update!'));
      panel.querySelector('#eaPcPickPsuBtn')?.addEventListener('click', () => toast('Power Supply companies are coming soon!'));
      panel.querySelector('#eaPcSaveBuild')?.addEventListener('click', () => savePcProduct(false));
      panel.querySelector('#eaPcCancelEdit')?.addEventListener('click', () => {
        resetPcDraftState();
        updateBuildSpecsReadout();
        toast('Cancelled PC draft edit.');
      });
    }

    panel.classList.remove('hidden');
    setCaseMenuTab(activeCaseMenu);
    renderCaseMenus();
    syncPcSaveButtonUI();
    loadSavedCases();
    setPcView(activePcView);
  }

  function hidePcWorkspace() {
    $('#eaPcPanel')?.classList.add('hidden');
    $('#eaPcResearchWrap')?.classList.add('hidden');
  }

  window.PcWorkspace = {
    isPc,
    mountPcWorkspace,
    hidePcWorkspace,
    mountPcResearch,
    renderPcResearchTree,
    mountPcProductsPage,
    renderPcProducts,
    resetPcDraftState
  };
})();
