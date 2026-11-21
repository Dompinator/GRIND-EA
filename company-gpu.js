/* GRIND-EA multi-company + GPU / CHIP workspace */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let companies = [];
  let companiesLoadedForUserId = null;
  let loadedResearchCompanyId = null;
  let activeGpuView = 'design';
  let activeMenuTab = 'body'; // 'body' | 'cooling' | 'chip' | 'elements'
  let chips = [];
  let selectedChipId = '';
  let nextElemSeq = 3;
  let editingGpuProductId = null;
  let editingGpuOldName = '';
  let selectedGpuPageProductId = null;

  // Modular GPU build state (no forced company name/logo; added via Add Element)
  let gpuLength = 300;
  let gpuWidth = 125;
  let gpuThickness = 52;
  let gpuBody = 'plastic';
  let gpuFinish = 'satin';
  let gpuShroud = 'rounded';
  let gpuPrimary = '#222733';
  let gpuAccent = '#a855f7';
  let gpuBackplateStyle = 'flow_through';
  let gpuFinStyle = 'silver';
  let gpuPipeStyle = 'copper';
  let gpuPowerType = '12v2x6';
  let gpuIoStyle = 'steel';
  let gpuElements = [
    { id: 'el_fan_1', kind: 'fan', fanType: 'basic', position: 0.28, size: 1.0, bladeColor: 'dark', hubStyle: 'auto', rgbRing: false },
    { id: 'el_fan_2', kind: 'fan', fanType: 'basic', position: 0.72, size: 1.0, bladeColor: 'dark', hubStyle: 'auto', rgbRing: false }
  ];

  // Draft CHIP build state (matches CPU designer UX with GPU-specific architecture)
  let activeChipMenuTab = 'package'; // 'package' | 'speed' | 'power' | 'vram'
  let chipSubstrate = 'green';       // 'green' | 'obsidian' | 'blue'
  let chipShimStyle = 'steel';       // 'steel' | 'copper' | 'dark'
  let selectedChipSpeed = 'none';
  let selectedChipPower = 'none';
  let selectedChipVram = 'none';

  let gpuThumbsCache = null;
  let restoringActiveCompany = false;
  const GPU_THUMBS_LS_KEY = 'grind_gpu_thumbs_v1';

  const GPU_RESEARCH = [
    { key: 'gpu_metallic_body', name: 'Metallic Body', cost: 3500, value: 1200, score: 18, group: 'GPU' },
    { key: 'gpu_carbon_body', name: 'Carbon Body', cost: 7800, value: 4000, score: 29, group: 'GPU', pre: 'gpu_metallic_body' },
    { key: 'gpu_rgb', name: 'RGB', cost: 4800, value: 480, score: 12, group: 'GPU' },
    { key: 'gpu_small_fans', name: 'Small Fans', cost: 125, value: 80, score: 8, group: 'GPU' },
    { key: 'gpu_medium_fans', name: 'Medium Fans', cost: 800, value: 200, score: 14, group: 'GPU', pre: 'gpu_small_fans' },
    { key: 'gpu_smart_fans', name: 'Smart Fans', cost: 2800, value: 1400, score: 22, group: 'GPU', pre: 'gpu_medium_fans' },
    { key: 'chip_ok_speed', name: 'OK Speed', cost: 75, value: 30, score: 4, group: 'CHIP' },
    { key: 'chip_decent_speed', name: 'Decent Speed', cost: 150, value: 70, score: 8, group: 'CHIP', pre: 'chip_ok_speed' },
    { key: 'chip_good_speed', name: 'Good Speed', cost: 300, value: 180, score: 13, group: 'CHIP', pre: 'chip_decent_speed' },
    { key: 'chip_fast_speed', name: 'Fast Speed', cost: 650, value: 360, score: 18, group: 'CHIP', pre: 'chip_good_speed' },
    { key: 'chip_insane_speed', name: 'Insane Speed', cost: 1500, value: 800, score: 26, group: 'CHIP', pre: 'chip_fast_speed' },
    { key: 'chip_super_speed', name: 'Super Speed', cost: 4500, value: 1800, score: 36, group: 'CHIP', pre: 'chip_insane_speed' },
    { key: 'chip_decent_power', name: 'Decent Power', cost: 250, value: 80, score: 6, group: 'CHIP' },
    { key: 'chip_good_power', name: 'Good Power', cost: 800, value: 120, score: 14, group: 'CHIP', pre: 'chip_decent_power' },
    { key: 'chip_strong_power', name: 'Strong Power', cost: 2600, value: 900, score: 26, group: 'CHIP', pre: 'chip_good_power' },
    { key: 'chip_super_powerful', name: 'Super Powerful', cost: 6800, value: 2800, score: 48, group: 'CHIP', pre: 'chip_strong_power' },
    { key: 'chip_vram_1gb_simple', name: '1GB simple V-RAM', cost: 80, value: 40, score: 2, group: 'CHIP' },
    { key: 'chip_vram_2gb_simple', name: '2GB simple V-RAM', cost: 190, value: 90, score: 4, group: 'CHIP', pre: 'chip_vram_1gb_simple' },
    { key: 'chip_vram_4gb_simple', name: '4GB simple V-RAM', cost: 450, value: 120, score: 8, group: 'CHIP', pre: 'chip_vram_2gb_simple' },
    { key: 'chip_vram_6gb_simple', name: '6GB simple V-RAM', cost: 1800, value: 480, score: 14, group: 'CHIP', pre: 'chip_vram_4gb_simple' },
    { key: 'chip_vram_4gb_advanced', name: '4GB advanced V-RAM', cost: 2600, value: 800, score: 16, group: 'CHIP', pre: 'chip_vram_6gb_simple' },
    { key: 'chip_vram_6gb_advanced', name: '6GB advanced V-RAM', cost: 3600, value: 1000, score: 20, group: 'CHIP', pre: 'chip_vram_4gb_advanced' },
    { key: 'chip_vram_8gb_advanced', name: '8GB advanced V-RAM', cost: 5400, value: 1800, score: 26, group: 'CHIP', pre: 'chip_vram_6gb_advanced' },
    { key: 'chip_vram_12gb_advanced', name: '12GB advanced V-RAM', cost: 8600, value: 3800, score: 32, group: 'CHIP', pre: 'chip_vram_8gb_advanced' },
    { key: 'chip_vram_16gb_advanced', name: '16GB advanced V-RAM', cost: 9800, value: 4190, score: 34, group: 'CHIP', pre: 'chip_vram_12gb_advanced' },
    { key: 'chip_vram_32gb_advanced', name: '32GB advanced V-RAM', cost: 12800, value: 6800, score: 48, group: 'CHIP', pre: 'chip_vram_16gb_advanced' }
  ];

  const CHIP_SPEED_KEYS = ['chip_ok_speed', 'chip_decent_speed', 'chip_good_speed', 'chip_fast_speed', 'chip_insane_speed', 'chip_super_speed'];
  const CHIP_POWER_KEYS = ['chip_decent_power', 'chip_good_power', 'chip_strong_power', 'chip_super_powerful'];
  const CHIP_VRAM_KEYS = [
    'chip_vram_1gb_simple', 'chip_vram_2gb_simple', 'chip_vram_4gb_simple', 'chip_vram_6gb_simple',
    'chip_vram_4gb_advanced', 'chip_vram_6gb_advanced', 'chip_vram_8gb_advanced',
    'chip_vram_12gb_advanced', 'chip_vram_16gb_advanced', 'chip_vram_32gb_advanced'
  ];

  const PRIMARY_PRESETS = ['#222733', '#8c96a6', '#e6eaf2', '#12141b', '#7f1d1d', '#1e3a8a'];
  const ACCENT_PRESETS = ['#a855f7', '#38bdf8', '#ef4444', '#10b981', '#f59e0b', '#cbd5e1'];

  const isGpu = () => !!(currentCompany?.product_lines || []).includes('gpu');
  const researched = k => k === 'basic' || k === 'plastic' || (companyResearchRows || []).some(x => x.research_key === k);
  const researchName = k => GPU_RESEARCH.find(r => r.key === k)?.name || (k === 'none' ? 'Base' : k === 'basic' ? 'Basic Fan' : k);
  const chipVramLabel = k => (!k || k === 'none') ? 'No V-RAM' : researchName(k);

  const isProductDraft = p => {
    const st = String(p?.status || '').trim().toLowerCase();
    return !st || st === 'draft';
  };

  function isGpuProductRow(p) {
    if (!p || typeof p !== 'object') return false;
    if (String(p.product_line || '').toLowerCase() === 'gpu') return true;
    const d = p.design_data;
    return !!(d && typeof d === 'object' && (d.chip_id || d.chip_name || d.shroud || d.fan_count !== undefined));
  }

  function buildGpuConfigFromProduct(p) {
    const d = (p && p.design_data && typeof p.design_data === 'object') ? p.design_data : {};
    return {
      length: Math.max(210, Math.min(360, Number(d.length || 300))),
      width: Math.max(105, Math.min(150, Number(d.width || 125))),
      thickness: Math.max(38, Math.min(76, Number(d.thickness || 52))),
      body: d.body || p?.body_type || 'plastic',
      finish: d.finish || 'satin',
      shroud: d.shroud || 'rounded',
      primaryColor: d.primary_color || '#222733',
      accentColor: d.accent_color || '#a855f7',
      backplate: d.backplate !== false && d.backplate_style !== 'off',
      backplateStyle: d.backplate_style || (d.backplate === false ? 'off' : 'flow_through'),
      finStyle: d.fin_style || 'silver',
      pipeStyle: d.pipe_style || 'copper',
      powerType: d.power_type || '12v2x6',
      ioStyle: d.io_style || 'steel',
      elements: Array.isArray(d.elements)
        ? d.elements.map(e => ({ ...e }))
        : [
            { id: 'el_fan_1', kind: 'fan', fanType: 'basic', position: 0.28, size: 1.0, bladeColor: 'dark', hubStyle: 'auto', rgbRing: false },
            { id: 'el_fan_2', kind: 'fan', fanType: 'basic', position: 0.72, size: 1.0, bladeColor: 'dark', hubStyle: 'auto', rgbRing: false }
          ]
    };
  }

  function formatGpuSpecLine(p) {
    const d = p?.design_data || {};
    const chipLabel = d.chip_name || 'GPU Chip';
    const bodyLabel = String(d.body || p?.body_type || 'plastic').toUpperCase();
    const fanCount = Number(d.fan_count ?? (Array.isArray(d.elements) ? d.elements.filter(e => e.kind === 'fan').length : 0));
    return chipLabel + ' · ' + bodyLabel + ' · ' + fanCount + ' Fan' + (fanCount === 1 ? '' : 's');
  }

  function formatGpuHardwareBadges(p) {
    const d = p?.design_data || {};
    const vram = d.chip_vram && d.chip_vram !== 'none' ? chipVramLabel(d.chip_vram) : '';
    const dims = (d.length && d.width && d.thickness) ? `${Math.round(d.length)}×${Math.round(d.width)}×${Math.round(d.thickness)} mm` : '';
    const parts = [d.chip_name || 'GPU Chip', vram, dims, String(d.body || p?.body_type || 'plastic').toUpperCase(), `${Number(d.fan_count ?? 0)} Fans`].filter(Boolean);
    return parts.join(' · ');
  }

  function getGpuThumbsMap() {
    if (gpuThumbsCache && typeof gpuThumbsCache === 'object') return gpuThumbsCache;
    try {
      const raw = localStorage.getItem(GPU_THUMBS_LS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      gpuThumbsCache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) { gpuThumbsCache = {}; }
    return gpuThumbsCache;
  }

  function saveGpuThumb(key, dataUrl) {
    if (!key || !dataUrl) return;
    const map = getGpuThumbsMap();
    map[key] = { dataUrl, ts: Date.now() };
    const entries = Object.entries(map).sort((a, b) => Number(b[1]?.ts || 0) - Number(a[1]?.ts || 0));
    if (entries.length > 40) gpuThumbsCache = Object.fromEntries(entries.slice(0, 40));
    try { localStorage.setItem(GPU_THUMBS_LS_KEY, JSON.stringify(gpuThumbsCache)); } catch (_) {}
  }

  function getGpuThumb(p) {
    if (p?.design_data?.thumbnail) return p.design_data.thumbnail;
    const map = getGpuThumbsMap();
    return map[p?.id]?.dataUrl || map['name:' + (p?.product_name || '')]?.dataUrl || '';
  }

  function clearGpuThumb(key) {
    if (!key) return;
    const map = getGpuThumbsMap();
    if (map[key]) {
      delete map[key];
      try { localStorage.setItem(GPU_THUMBS_LS_KEY, JSON.stringify(gpuThumbsCache)); } catch (_) {}
    }
  }

  function applyGpuThumbToDom(id, name, dataUrl) {
    if (!id || !dataUrl) return;
    document.querySelectorAll('[data-gpu-thumb-id]').forEach(el => {
      if (el.dataset.gpuThumbId !== String(id)) return;
      const alt = esc((name || 'GPU') + ' 3D preview');
      el.innerHTML = '<img class="cpu-thumb-img gpu-thumb-img" src="' + esc(dataUrl) + '" alt="' + alt + '">';
    });
  }

  function renderGpuThumbHtml(p) {
    const url = getGpuThumb(p);
    const alt = esc((p?.product_name || 'GPU') + ' 3D preview');
    if (url) {
      return '<img class="cpu-thumb-img gpu-thumb-img" src="' + esc(url) + '" alt="' + alt + '">';
    }
    return '<div class="cpu-thumb-loading" aria-label="Rendering 3D GPU preview"></div>';
  }

  function hydrateGpuThumbElements(rootEl, productsById, width = 360, height = 270) {
    if (!rootEl) return;
    rootEl.querySelectorAll('[data-gpu-thumb-id]').forEach(el => {
      const id = el.dataset.gpuThumbId;
      if (!id) return;
      const prod = productsById instanceof Map ? productsById.get(id) : productsById?.[id];
      if (!prod) return;
      const cached = getGpuThumb(prod);
      if (cached) {
        if (!el.querySelector('img')) {
          applyGpuThumbToDom(id, prod.product_name, cached);
        }
        return;
      }
      if (el.dataset.gpuThumbQueued === '1') return;
      if (typeof window.GpuDesigner3D?.enqueueThumbnail !== 'function') return;
      el.dataset.gpuThumbQueued = '1';
      window.GpuDesigner3D.enqueueThumbnail(buildGpuConfigFromProduct(prod), dataUrl => {
        if (!dataUrl) return;
        saveGpuThumb(id, dataUrl);
        if (prod.product_name) saveGpuThumb('name:' + prod.product_name, dataUrl);
        applyGpuThumbToDom(id, prod.product_name, dataUrl);
      }, width, height);
    });
  }

  window.isGpuProductRow = isGpuProductRow;
  window.getGpuThumbUrl = getGpuThumb;
  window.renderGpuThumbHtml = renderGpuThumbHtml;
  window.hydrateGpuThumbElements = hydrateGpuThumbElements;
  window.applyGpuThumbToDom = applyGpuThumbToDom;
  window.formatGpuSpecLine = formatGpuSpecLine;
  window.formatGpuHardwareBadges = formatGpuHardwareBadges;

  // ---------- Company Chooser & Persistence ----------
  function companyShell() {
    let root = $('#eaCompanyShell');
    if (root) return root;
    const page = $('#page-company');
    if (!page) return null;
    root = document.createElement('div');
    root.id = 'eaCompanyShell';
    root.className = 'ea-company-shell';
    page.prepend(root);
    return root;
  }

  function renderChooser() {
    const root = companyShell();
    if (!root) return;
    if (currentCompany) {
      root.innerHTML = '';
      root.classList.add('hidden');
      $('#companyOnboarding')?.classList.add('hidden');
      $('#companyDashboard')?.classList.remove('hidden');
      return;
    }
    root.classList.remove('hidden');
    $('#companyOnboarding')?.classList.add('hidden');
    $('#companyDashboard')?.classList.add('hidden');
    root.innerHTML =
      '<div class="ea-company-heading"><div class="eyebrow purple-text">COMPANY WORKSPACE</div><h3>Select a company</h3><p class="muted">Open a company dashboard, or create another company. Maximum 3 companies.</p></div>' +
      '<div class="ea-company-grid">' +
      companies.map(c =>
        '<button class="ea-company-card" data-company-open="' + esc(c.id) + '">' +
        '<span class="ea-company-logo">' + (c.logo_data_url ? '<img src="' + esc(c.logo_data_url) + '" alt="">' : '▣') + '</span>' +
        '<span><b>' + esc(c.company_name) + '</b><small>' + ((c.product_lines || []).includes('gpu') ? 'GPU Manufacturing' : 'CPU Manufacturing') + '</small></span>' +
        '<strong>Open →</strong></button>'
      ).join('') +
      '</div>' +
      '<button class="primary-btn" id="eaCreateCompany" ' + (companies.length >= 3 ? 'disabled' : '') + '>' +
      (companies.length >= 3 ? 'Company limit reached (3/3)' : '＋ Create company') +
      '</button>' +
      '<div id="eaCompanyCreateWrap" class="ea-company-create hidden"><h4>Create a company</h4><form id="eaCompanyCreateForm">' +
      '<label>Company name<input id="eaCompanyName" maxlength="40" minlength="2" required placeholder="e.g. Nova Graphics"></label>' +
      '<label>Description<textarea id="eaCompanyDescription" maxlength="500" rows="2" placeholder="What does your company make?"></textarea></label>' +
      '<label>Product line<select id="eaCompanyLine"><option value="cpu">CPU Manufacturing</option><option value="gpu">GPU Manufacturing</option></select></label>' +
      '<button class="primary-btn" type="submit">Create company</button><p id="eaCompanyCreateMessage" class="form-message"></p></form></div>';
    root.querySelectorAll('[data-company-open]').forEach(b => b.addEventListener('click', () => selectCompany(b.dataset.companyOpen)));
    $('#eaCreateCompany')?.addEventListener('click', () => $('#eaCompanyCreateWrap')?.classList.toggle('hidden'));
    $('#eaCompanyCreateForm')?.addEventListener('submit', createCompany);
  }

  async function refreshCompanies() {
    if (!currentUser || !sb) return;
    const { data, error } = await sb
      .from('product_companies')
      .select('id,owner_id,company_name,logo_data_url,description,product_lines,total_revenue,total_costs,change_pct,created_at')
      .eq('owner_id', currentUser.id)
      .order('created_at', { ascending: true })
      .limit(3);
    if (error) { console.error('Company list:', error); return; }
    companies = data || [];
    companiesLoadedForUserId = currentUser.id;
    companyLoaded = true;

    const targetId = currentCompany?.id || localStorage.getItem('grind_active_company_id');
    const matched = targetId ? companies.find(c => c.id === targetId) || null : null;
    const changed = matched?.id !== currentCompany?.id;
    currentCompany = matched;

    if (currentCompany && (changed || loadedResearchCompanyId !== currentCompany.id)) {
      await loadCompanyResearchAndProducts();
      loadedResearchCompanyId = currentCompany.id;
    }
    renderChooser();
  }

  function resetDraftGpuState() {
    gpuLength = 300;
    gpuWidth = 125;
    gpuThickness = 52;
    gpuBody = 'plastic';
    gpuFinish = 'satin';
    gpuShroud = 'rounded';
    gpuPrimary = '#222733';
    gpuAccent = '#a855f7';
    gpuBackplateStyle = 'flow_through';
    gpuFinStyle = 'silver';
    gpuPipeStyle = 'copper';
    gpuPowerType = '12v2x6';
    gpuIoStyle = 'steel';
    gpuElements = [
      { id: 'el_fan_1', kind: 'fan', fanType: 'basic', position: 0.28, size: 1.0, bladeColor: 'dark', hubStyle: 'auto', rgbRing: false },
      { id: 'el_fan_2', kind: 'fan', fanType: 'basic', position: 0.72, size: 1.0, bladeColor: 'dark', hubStyle: 'auto', rgbRing: false }
    ];
    selectedChipId = '';
    editingGpuProductId = null;
    editingGpuOldName = '';
    activeChipMenuTab = 'package';
    chipSubstrate = 'green';
    chipShimStyle = 'steel';
    selectedChipSpeed = 'none';
    selectedChipPower = 'none';
    selectedChipVram = 'none';
    if ($('#eaGpuName')) $('#eaGpuName').value = 'New Graphics Card';
    if ($('#eaGpuPrice')) $('#eaGpuPrice').value = '1200';
    syncGpuSaveButtonUI();
    const msgEl = $('#eaGpuMessage');
    if (msgEl) msgEl.textContent = '';
    const chipMsgEl = $('#eaChipMessage');
    if (chipMsgEl) chipMsgEl.textContent = '';
  }

  function syncGpuSaveButtonUI() {
    const saveBtn = $('#eaGpuSave');
    const cancelBtn = $('#eaGpuCancelEdit');
    if (saveBtn) saveBtn.textContent = editingGpuProductId ? 'Save edits · Free' : 'Save as draft · Free';
    if (cancelBtn) cancelBtn.classList.toggle('hidden', !editingGpuProductId);
  }

  async function selectCompany(id) {
    const c = companies.find(x => x.id === id);
    if (!c) return;
    currentCompany = c;
    localStorage.setItem('grind_active_company_id', id);
    companyResearchRows = [];
    companyProducts = [];
    selectedCompanyProductId = null;
    loadedResearchCompanyId = null;
    await loadCompanyResearchAndProducts();
    loadedResearchCompanyId = id;
    resetDraftGpuState();
    window.cancelCpuDraftEdit?.();
    if (typeof renderCompanyDashboard === 'function') renderCompanyDashboard();
    renderChooser();
    if (isGpu()) {
      mountGpuWorkspace();
      mountGpuResearch();
      mountGpuProductsPage();
      renderGpuProducts();
    } else {
      hideGpuWorkspace();
    }
    syncCompanyDesignMode();
  }

  async function createCompany(e) {
    e.preventDefault();
    const msg = $('#eaCompanyCreateMessage');
    if (companies.length >= 3) { msg.textContent = 'You can own a maximum of 3 companies.'; return; }
    const name = $('#eaCompanyName').value.trim();
    const line = $('#eaCompanyLine').value;
    const desc = $('#eaCompanyDescription').value.trim();
    if (name.length < 2) { msg.textContent = 'Company name must be at least 2 characters.'; return; }
    const { data, error } = await sb
      .from('product_companies')
      .insert({ owner_id: currentUser.id, company_name: name, description: desc, product_lines: [line] })
      .select('id,owner_id,company_name,logo_data_url,description,product_lines,total_revenue,total_costs,change_pct,created_at')
      .single();
    if (error) { msg.textContent = error.message; return; }
    companies.push(data);
    renderChooser();
    toast('Company created. Select it to open the dashboard.');
  }

  function addBackButton() {
    const dash = $('#companyDashboard');
    if (!dash || $('#eaBackCompanies')) return;
    const b = document.createElement('button');
    b.id = 'eaBackCompanies';
    b.className = 'zoom-btn';
    b.type = 'button';
    b.textContent = '← All companies';
    b.addEventListener('click', () => {
      currentCompany = null;
      loadedResearchCompanyId = null;
      localStorage.removeItem('grind_active_company_id');
      hideGpuWorkspace();
      renderChooser();
    });
    dash.prepend(b);
  }

  // ---------- CPU-Style Sidebar Rendering & Element Manager ----------
  function setMenuTab(tab) {
    activeMenuTab = tab;
    document.querySelectorAll('[data-gpu-menu]').forEach(b => b.classList.toggle('active', b.dataset.gpuMenu === tab));
    ['body', 'cooling', 'chip', 'elements'].forEach(t => {
      const el = $('#eaGpuMenu_' + t);
      if (el) el.classList.toggle('hidden', t !== tab);
    });
  }

  function goToGpuResearch(group) {
    showPage('company');
    if (typeof switchCompanyDashboardTab === 'function') switchCompanyDashboardTab('research');
    if (group === 'GPU' || group === 'CHIP') setResearchGroup(group);
  }

  function renderBodyTab() {
    const wrap = $('#eaGpuMenu_body');
    if (!wrap) return;
    if ((gpuBody === 'metallic' && !researched('gpu_metallic_body')) || (gpuBody === 'carbon' && !researched('gpu_carbon_body'))) {
      gpuBody = 'plastic';
    }

    const bodyDefs = [
      { id: 'plastic', key: 'plastic', name: 'Plastic Body', desc: 'Free · Standard molded shell' },
      { id: 'metallic', key: 'gpu_metallic_body', name: 'Metallic Body', desc: '18 Score · $1,200/unit' },
      { id: 'carbon', key: 'gpu_carbon_body', name: 'Carbon Body', desc: '29 Score · $4,000/unit' }
    ];

    const bodyCards = bodyDefs.map(b => {
      const ok = researched(b.key);
      const selected = gpuBody === b.id;
      return '<div class="cpu-component-option ' + (ok ? '' : 'locked') + ' ' + (selected ? 'selected' : '') + '">' +
        '<span class="cpu-component-icon">◈</span>' +
        '<span><strong>' + b.name + '</strong><small>' + (ok ? b.desc : 'Research required') + '</small></span>' +
        '<button type="button" class="zoom-btn" ' + (ok ? 'data-gpu-body="' + b.id + '"' : 'data-gpu-go-research="1"') + '>' + (ok ? (selected ? 'Selected' : 'Use') : 'Research') + '</button>' +
        '</div>';
    }).join('');

    const finishPills = [
      ['satin', 'Satin'],
      ['matte', 'Matte'],
      ['gloss', 'Gloss']
    ].map(([id, label]) =>
      '<button type="button" class="zoom-btn' + (gpuFinish === id ? ' active' : '') + '" data-gpu-finish="' + id + '">' + label + '</button>'
    ).join('');

    const shroudPills = [
      ['rounded', 'Rounded'],
      ['angular', 'Angular'],
      ['compact', 'Compact'],
      ['founders', 'Founders'],
      ['stealth', 'Stealth'],
      ['triple', 'Triple']
    ].map(([id, label]) =>
      '<button type="button" class="zoom-btn' + (gpuShroud === id ? ' active' : '') + '" data-gpu-shroud="' + id + '">' + label + '</button>'
    ).join('');

    const primarySwatches = PRIMARY_PRESETS.map(hex =>
      '<button type="button" class="ea-swatch-btn' + (gpuPrimary.toLowerCase() === hex ? ' active' : '') + '" data-primary-hex="' + hex + '" style="background:' + hex + '"></button>'
    ).join('');

    const swatches = ACCENT_PRESETS.map(hex =>
      '<button type="button" class="ea-swatch-btn' + (gpuAccent.toLowerCase() === hex ? ' active' : '') + '" data-accent-hex="' + hex + '" style="background:' + hex + '"></button>'
    ).join('');

    wrap.innerHTML =
      '<h4>Body Material</h4>' + bodyCards +
      '<h4 style="margin-top:12px">Shroud Style &amp; Finish</h4>' +
      '<div class="ea-gpu-inline-box"><span>Surface finish</span><div class="ea-gpu-pill-row">' + finishPills + '</div></div>' +
      '<div class="ea-gpu-inline-box"><span>Shroud silhouette</span><div class="ea-gpu-pill-row ea-gpu-pill-wrap">' + shroudPills + '</div></div>' +
      '<div class="ea-gpu-inline-box"><span>Primary color</span><div class="ea-gpu-swatches">' + primarySwatches + '<input id="eaGpuPrimary" type="color" value="' + esc(gpuPrimary) + '"></div></div>' +
      '<div class="ea-gpu-inline-box"><span>Secondary color (Accent)</span><div class="ea-gpu-swatches">' + swatches + '<input id="eaGpuAccent" type="color" value="' + esc(gpuAccent) + '"></div></div>';

    wrap.querySelectorAll('[data-gpu-body]').forEach(btn => btn.addEventListener('click', () => {
      gpuBody = btn.dataset.gpuBody;
      renderBodyTab();
      drawGpu();
    }));
    wrap.querySelectorAll('[data-gpu-go-research]').forEach(btn => btn.addEventListener('click', goToGpuResearch));
    wrap.querySelectorAll('[data-gpu-finish]').forEach(btn => btn.addEventListener('click', () => {
      gpuFinish = btn.dataset.gpuFinish;
      renderBodyTab();
      drawGpu();
    }));
    wrap.querySelectorAll('[data-gpu-shroud]').forEach(btn => btn.addEventListener('click', () => {
      gpuShroud = btn.dataset.gpuShroud;
      renderBodyTab();
      drawGpu();
    }));
    wrap.querySelectorAll('[data-primary-hex]').forEach(btn => btn.addEventListener('click', () => {
      gpuPrimary = btn.dataset.primaryHex;
      renderBodyTab();
      drawGpu();
    }));
    wrap.querySelector('#eaGpuPrimary')?.addEventListener('input', e => {
      gpuPrimary = e.target.value;
      drawGpu(true);
    });
    wrap.querySelector('#eaGpuPrimary')?.addEventListener('change', () => drawGpu(false));
    wrap.querySelectorAll('[data-accent-hex]').forEach(btn => btn.addEventListener('click', () => {
      gpuAccent = btn.dataset.accentHex;
      renderBodyTab();
      drawGpu();
    }));
    wrap.querySelector('#eaGpuAccent')?.addEventListener('input', e => {
      gpuAccent = e.target.value;
      drawGpu(true);
    });
    wrap.querySelector('#eaGpuAccent')?.addEventListener('change', () => drawGpu(false));
  }

  function renderCoolingTab() {
    const wrap = $('#eaGpuMenu_cooling');
    if (!wrap) return;

    const pillGroup = (title, attr, currentVal, items) =>
      '<div class="ea-gpu-inline-box"><span>' + title + '</span><div class="ea-gpu-pill-row ea-gpu-pill-wrap">' +
      items.map(([id, label]) =>
        '<button type="button" class="zoom-btn' + (currentVal === id ? ' active' : '') + '" data-' + attr + '="' + id + '">' + label + '</button>'
      ).join('') +
      '</div></div>';

    const slotPresets = [
      [38, '2-Slot · 38mm'],
      [52, '2.5-Slot · 52mm'],
      [64, '3-Slot · 64mm'],
      [76, '3.5-Slot · 76mm']
    ].map(([mm, label]) =>
      '<button type="button" class="zoom-btn' + (Math.abs(gpuThickness - mm) <= 2 ? ' active' : '') + '" data-slot-mm="' + mm + '">' + label + '</button>'
    ).join('');

    wrap.innerHTML =
      '<h4>Heatsink &amp; Slot Thickness</h4>' +
      '<div class="ea-gpu-inline-box">' +
        '<div class="ea-gpu-thick-head"><span>Card thickness</span><strong id="eaGpuThickVal">' + gpuThickness + ' mm</strong></div>' +
        '<input id="eaGpuThicknessSlider" type="range" min="38" max="76" step="2" value="' + gpuThickness + '">' +
        '<div class="ea-gpu-pill-row ea-gpu-pill-wrap">' + slotPresets + '</div>' +
      '</div>' +
      '<h4 style="margin-top:12px">Thermal &amp; PCB Hardware</h4>' +
      pillGroup('Backplate Shield', 'bp-style', gpuBackplateStyle, [
        ['flow_through', 'Flow-Through'],
        ['solid', 'Solid'],
        ['louvered', 'Louvered'],
        ['off', 'Off']
      ]) +
      pillGroup('Heatsink Fin Stack', 'fin-style', gpuFinStyle, [
        ['silver', 'Silver'],
        ['black', 'Blackout'],
        ['copper', 'Copper']
      ]) +
      pillGroup('Heatpipes', 'pipe-style', gpuPipeStyle, [
        ['copper', 'Copper'],
        ['nickel', 'Nickel'],
        ['black', 'Black']
      ]) +
      pillGroup('Power Connector', 'power-type', gpuPowerType, [
        ['12v2x6', '12V-2x6'],
        ['3x8pin', '3× 8-Pin'],
        ['2x8pin', '2× 8-Pin'],
        ['1x8pin', '1× 8-Pin']
      ]) +
      pillGroup('I/O Bracket Finish', 'io-style', gpuIoStyle, [
        ['steel', 'Brushed Steel'],
        ['black', 'Blackout']
      ]);

    const thickSlider = wrap.querySelector('#eaGpuThicknessSlider');
    const thickVal = wrap.querySelector('#eaGpuThickVal');
    thickSlider?.addEventListener('input', () => {
      gpuThickness = Number(thickSlider.value);
      if (thickVal) thickVal.textContent = gpuThickness + ' mm';
      drawGpu(true);
    });
    thickSlider?.addEventListener('change', () => {
      renderCoolingTab();
      drawGpu(false);
    });
    wrap.querySelectorAll('[data-slot-mm]').forEach(btn => btn.addEventListener('click', () => {
      gpuThickness = Number(btn.dataset.slotMm);
      renderCoolingTab();
      drawGpu();
    }));

    const bindPills = (attr, setter) => {
      wrap.querySelectorAll('[data-' + attr + ']').forEach(btn => btn.addEventListener('click', () => {
        setter(btn.getAttribute('data-' + attr));
        renderCoolingTab();
        drawGpu();
      }));
    };
    bindPills('bp-style', v => { gpuBackplateStyle = v; });
    bindPills('fin-style', v => { gpuFinStyle = v; });
    bindPills('pipe-style', v => { gpuPipeStyle = v; });
    bindPills('power-type', v => { gpuPowerType = v; });
    bindPills('io-style', v => { gpuIoStyle = v; });
  }

  function renderChipTab() {
    const wrap = $('#eaGpuMenu_chip');
    if (!wrap) return;
    if (selectedChipId && !chips.some(c => c.id === selectedChipId)) selectedChipId = '';
    if (!selectedChipId && chips.length === 1) selectedChipId = chips[0].id;

    const listHtml = chips.length
      ? chips.map(c => {
          const sel = c.id === selectedChipId;
          return '<div class="cpu-component-option ' + (sel ? 'selected' : '') + '">' +
            '<span class="cpu-component-icon">▦</span>' +
            '<span><strong>' + esc(c.chip_name) + '</strong><small>' + esc(researchName(c.speed_level)) + ' · ' + esc(researchName(c.power_level)) + ' · ' + esc(chipVramLabel(c.vram_level)) + '</small></span>' +
            '<button type="button" class="zoom-btn" data-pick-chip="' + esc(c.id) + '">' + (sel ? 'Selected' : 'Use') + '</button>' +
            '</div>';
        }).join('')
      : '<div class="ea-gpu-empty-note"><p class="muted tiny">No GPU chips saved yet. Design a GPU Chip first, then select it here.</p><button type="button" class="primary-btn" id="eaJumpChipTab">Design a Chip →</button></div>';

    wrap.innerHTML = '<h4>GPU Silicon Chip</h4>' + listHtml + (chips.length ? '<button type="button" class="zoom-btn" id="eaJumpChipTab" style="margin-top:6px">＋ Create another chip</button>' : '');
    wrap.querySelectorAll('[data-pick-chip]').forEach(btn => btn.addEventListener('click', () => {
      selectedChipId = btn.dataset.pickChip;
      renderChipTab();
      drawGpu();
    }));
    wrap.querySelector('#eaJumpChipTab')?.addEventListener('click', () => setGpuTab('chips'));
  }

  function renderAddElementTab() {
    const wrap = $('#eaGpuMenu_elements');
    if (!wrap) return;

    const fanCount = gpuElements.filter(e => e.kind === 'fan').length;
    const defs = [
      { id: 'fan:basic', key: 'basic', icon: '❄', name: 'Basic Fan', desc: 'Free · Subtracts smooth fan cutout' },
      { id: 'fan:gpu_small_fans', key: 'gpu_small_fans', icon: '❄', name: 'Small Fan', desc: '8 Score · $80/fan' },
      { id: 'fan:gpu_medium_fans', key: 'gpu_medium_fans', icon: '❄', name: 'Medium Fan', desc: '14 Score · $200/fan' },
      { id: 'fan:gpu_smart_fans', key: 'gpu_smart_fans', icon: '❄', name: 'Smart Fan', desc: '22 Score · $1,400/fan' },
      { id: 'text', key: 'basic', icon: 'Aa', name: 'Text Label', desc: 'Custom printed or LED text on any face' },
      { id: 'logo', key: 'basic', icon: '◆', name: 'Logo Badge', desc: 'Company logo or uploaded badge graphic' },
      { id: 'accent_bar', key: 'basic', icon: '▬', name: 'Accent Trim Bar', desc: 'Machined metallic trim stripe (drag to place)' },
      { id: 'vent_grille', key: 'basic', icon: '▤', name: 'Vent Grille', desc: 'Slatted exhaust louver vent (drag to place)' },
      { id: 'rgb_strip', key: 'gpu_rgb', icon: '✦', name: 'RGB Light Strip', desc: '12 Score · $480 · Rails, Top, Halo & Slash' }
    ];

    wrap.innerHTML = '<h4>Add Element</h4>' + defs.map(d => {
      const ok = researched(d.key);
      const isFan = d.id.startsWith('fan:');
      const atMaxFans = isFan && fanCount >= 6;
      return '<div class="cpu-component-option ' + (ok ? '' : 'locked') + '">' +
        '<span class="cpu-component-icon">' + d.icon + '</span>' +
        '<span><strong>' + d.name + '</strong><small>' + (ok ? (atMaxFans ? 'Max 6 fans reached' : d.desc) : 'Research required') + '</small></span>' +
        '<button type="button" class="zoom-btn" ' + (ok ? 'data-add-element="' + d.id + '"' + (atMaxFans ? ' disabled' : '') : 'data-gpu-go-research="1"') + '>' + (ok ? 'Add' : 'Research') + '</button>' +
        '</div>';
    }).join('');

    wrap.querySelectorAll('[data-add-element]').forEach(btn => btn.addEventListener('click', () => {
      const kindSpec = btn.dataset.addElement;
      if (kindSpec.startsWith('fan:')) {
        const fanType = kindSpec.split(':')[1];
        if (!researched(fanType)) { toast('Research this fan type first.'); return; }
        if (gpuElements.filter(e => e.kind === 'fan').length >= 6) { toast('Maximum 6 fans on one GPU.'); return; }
        gpuElements.push({
          id: 'el_' + (++nextElemSeq),
          kind: 'fan',
          fanType,
          position: 0.5,
          size: 1.0,
          bladeColor: 'dark',
          hubStyle: 'auto',
          rgbRing: false
        });
        spaceFansEvenly();
      } else if (kindSpec === 'text') {
        gpuElements.push({
          id: 'el_' + (++nextElemSeq),
          kind: 'text',
          text: (currentCompany?.company_name || 'CUSTOM').slice(0, 18),
          color: '#ffffff',
          placement: 'side',
          position: 0.5,
          zPosition: 0.88,
          size: 1.1,
          glow: false
        });
        window.GpuDesigner3D?.focusPlacement?.('side');
      } else if (kindSpec === 'logo') {
        gpuElements.push({
          id: 'el_' + (++nextElemSeq),
          kind: 'logo',
          logoUrl: currentCompany?.logo_data_url || '',
          placement: 'back',
          position: 0.5,
          zPosition: 0.5,
          size: 1.0
        });
        window.GpuDesigner3D?.focusPlacement?.('back');
      } else if (kindSpec === 'accent_bar') {
        gpuElements.push({
          id: 'el_' + (++nextElemSeq),
          kind: 'accent_bar',
          color: gpuAccent || '#a855f7',
          placement: 'top',
          position: 0.5,
          zPosition: 0.86,
          size: 1.0
        });
        window.GpuDesigner3D?.focusPlacement?.('top');
      } else if (kindSpec === 'vent_grille') {
        gpuElements.push({
          id: 'el_' + (++nextElemSeq),
          kind: 'vent_grille',
          placement: 'top',
          position: 0.82,
          zPosition: 0.5,
          size: 1.0
        });
        window.GpuDesigner3D?.focusPlacement?.('top');
      } else if (kindSpec === 'rgb_strip') {
        if (!researched('gpu_rgb')) { toast('Research RGB first.'); return; }
        gpuElements.push({
          id: 'el_' + (++nextElemSeq),
          kind: 'rgb_strip',
          color: gpuAccent || '#a855f7',
          colorMode: 'solid',
          placement: 'side'
        });
      }
      renderAddElementTab();
      renderPlacedElementsManager();
      drawGpu();
    }));
    wrap.querySelectorAll('[data-gpu-go-research]').forEach(btn => btn.addEventListener('click', goToGpuResearch));
  }

  function spaceFansEvenly() {
    const fans = gpuElements.filter(e => e.kind === 'fan');
    if (!fans.length) return;
    if (fans.length === 1) { fans[0].position = 0.5; return; }
    const start = 0.2;
    const span = 0.6;
    fans.forEach((f, i) => { f.position = Number((start + (i / (fans.length - 1)) * span).toFixed(3)); });
  }

  function renderPlacedElementsManager() {
    const wrap = $('#eaGpuPlacedList');
    if (!wrap) return;
    const hasRgbResearch = researched('gpu_rgb');
    gpuElements = gpuElements.filter(el => {
      if (el.kind === 'fan' && !researched(el.fanType)) el.fanType = 'basic';
      if (el.kind === 'rgb_strip' && !hasRgbResearch) return false;
      if (el.kind === 'fan' && el.rgbRing && !hasRgbResearch) el.rgbRing = false;
      if (el.kind === 'text' && el.glow && !hasRgbResearch) el.glow = false;
      return true;
    });

    if (!gpuElements.length) {
      wrap.innerHTML = '<p class="muted tiny">No elements on the GPU yet. Add fans, text labels, trim bars, or logos from the <b>Add Element</b> tab above.</p>';
      return;
    }

    const placementOptionsHtml = selected => {
      const norm = selected === 'rear' ? 'side' : selected;
      const opts = [
        ['side', 'Side View (Power Side)'],
        ['top', 'Top (Fan Side)'],
        ['back', 'Backplate (Bottom)'],
        ['right', 'End Cap (Right)'],
        ['left', 'I/O Side (Left)'],
        ['both_sides', 'Both Long Sides']
      ];
      return opts.map(([val, label]) =>
        '<option value="' + val + '"' + (norm === val ? ' selected' : '') + '>' + label + '</option>'
      ).join('');
    };

    const trimPlacementOptions = (selected, includeBoth) => {
      const opts = [
        ['top', 'Top (Fan Side)'],
        ['side', 'Side View (Power Side)'],
        ['back', 'Backplate']
      ];
      return opts.map(([val, label]) =>
        '<option value="' + val + '"' + (selected === val ? ' selected' : '') + '>' + label + '</option>'
      ).join('');
    };

    const selectOpts = (opts, cur) => opts.map(([v, label]) =>
      '<option value="' + v + '"' + ((cur || opts[0][0]) === v ? ' selected' : '') + '>' + label + '</option>'
    ).join('');

    let fanNum = 0;
    wrap.innerHTML = gpuElements.map(el => {
      if (el.kind === 'fan') {
        fanNum++;
        return '<div class="ea-elem-card" data-elem-id="' + el.id + '">' +
          '<div class="ea-elem-head"><strong>Fan ' + fanNum + ' · ' + esc(researchName(el.fanType)) + '</strong>' +
          '<button type="button" class="ea-elem-del" data-remove-elem="' + el.id + '" title="Remove">✕</button></div>' +
          '<div class="ea-elem-row">' +
            '<label>Position <b>' + Math.round((el.position || 0.5) * 100) + '%</b><input type="range" min="6" max="94" value="' + Math.round((el.position || 0.5) * 100) + '" data-elem-pos="' + el.id + '"></label>' +
            '<label>Diameter <b>' + Math.round((el.size || 1) * 100) + '%</b><input type="range" min="68" max="122" value="' + Math.round((el.size || 1) * 100) + '" data-elem-size="' + el.id + '"></label>' +
          '</div>' +
          '<div class="ea-elem-row">' +
            '<label>Blades<select data-fan-blade="' + el.id + '">' + selectOpts([['dark', 'Carbon Black'], ['graphite', 'Graphite'], ['white', 'Frost White'], ['silver', 'Brushed Silver'], ['accent', 'Accent Match']], el.bladeColor) + '</select></label>' +
            '<label>Hub Cap<select data-fan-hub="' + el.id + '">' + selectOpts([['auto', 'Auto Metallic'], ['chrome', 'Chrome'], ['dark', 'Matte Black'], ['gold', 'Brushed Gold'], ['accent', 'Accent Match']], el.hubStyle) + '</select></label>' +
          '</div>' +
          '<div class="ea-elem-subrow">' +
            '<span>Fan Halo RGB</span>' +
            (hasRgbResearch
              ? '<button type="button" class="zoom-btn' + (el.rgbRing ? ' active' : '') + '" data-fan-rgb="' + el.id + '">' + (el.rgbRing ? 'RGB On' : 'RGB Off') + '</button>'
              : '<button type="button" class="zoom-btn" data-gpu-go-research="1">Research RGB</button>') +
          '</div>' +
        '</div>';
      }
      if (el.kind === 'text') {
        const showZ = el.placement === 'top' || el.placement === 'back';
        const zPct = Math.round((el.zPosition ?? (el.placement === 'top' ? 0.88 : 0.5)) * 100);
        return '<div class="ea-elem-card" data-elem-id="' + el.id + '">' +
          '<div class="ea-elem-head"><strong>Text Label</strong>' +
          '<button type="button" class="ea-elem-del" data-remove-elem="' + el.id + '" title="Remove">✕</button></div>' +
          '<div class="ea-elem-grid">' +
            '<input type="text" maxlength="24" value="' + esc(el.text || '') + '" placeholder="Label text" data-elem-text="' + el.id + '">' +
            '<input type="color" value="' + esc(el.color || '#ffffff') + '" data-elem-color="' + el.id + '" title="Text color">' +
            '<select data-elem-place="' + el.id + '">' + placementOptionsHtml(el.placement || 'side') + '</select>' +
          '</div>' +
          '<div class="ea-elem-row">' +
            '<label>Pos <b>' + Math.round((el.position ?? 0.5) * 100) + '%</b><input type="range" min="12" max="88" value="' + Math.round((el.position ?? 0.5) * 100) + '" data-elem-pos="' + el.id + '"></label>' +
            (showZ ? '<label>Row (Z) <b>' + zPct + '%</b><input type="range" min="8" max="92" value="' + zPct + '" data-elem-zpos="' + el.id + '"></label>' : '') +
            '<label>Scale <b>' + Math.round((el.size || 1) * 100) + '%</b><input type="range" min="55" max="150" value="' + Math.round((el.size || 1) * 100) + '" data-elem-size="' + el.id + '"></label>' +
          '</div>' +
          '<div class="ea-elem-subrow">' +
            '<span>LED Backlit Text</span>' +
            (hasRgbResearch
              ? '<button type="button" class="zoom-btn' + (el.glow ? ' active' : '') + '" data-text-glow="' + el.id + '">' + (el.glow ? 'Glow On' : 'Glow Off') + '</button>'
              : '<button type="button" class="zoom-btn" data-gpu-go-research="1">Research RGB</button>') +
          '</div>' +
        '</div>';
      }
      if (el.kind === 'logo') {
        const showZ = el.placement === 'top' || el.placement === 'back';
        const zPct = Math.round((el.zPosition ?? (el.placement === 'top' ? 0.88 : 0.5)) * 100);
        return '<div class="ea-elem-card" data-elem-id="' + el.id + '">' +
          '<div class="ea-elem-head"><strong>Logo Badge</strong>' +
          '<button type="button" class="ea-elem-del" data-remove-elem="' + el.id + '" title="Remove">✕</button></div>' +
          '<div class="ea-elem-grid">' +
            '<select data-elem-place="' + el.id + '">' + placementOptionsHtml(el.placement || 'back') + '</select>' +
            '<label class="ea-file-mini">Upload Logo<input type="file" accept="image/png,image/jpeg,image/webp" data-elem-upload="' + el.id + '"></label>' +
          '</div>' +
          '<div class="ea-elem-row">' +
            '<label>Pos <b>' + Math.round((el.position ?? 0.5) * 100) + '%</b><input type="range" min="12" max="88" value="' + Math.round((el.position ?? 0.5) * 100) + '" data-elem-pos="' + el.id + '"></label>' +
            (showZ ? '<label>Row (Z) <b>' + zPct + '%</b><input type="range" min="8" max="92" value="' + zPct + '" data-elem-zpos="' + el.id + '"></label>' : '') +
            '<label>Scale <b>' + Math.round((el.size || 1) * 100) + '%</b><input type="range" min="50" max="150" value="' + Math.round((el.size || 1) * 100) + '" data-elem-size="' + el.id + '"></label>' +
          '</div></div>';
      }
      if (el.kind === 'accent_bar') {
        const showZ = el.placement === 'top' || el.placement === 'back';
        const zPct = Math.round((el.zPosition ?? 0.86) * 100);
        return '<div class="ea-elem-card" data-elem-id="' + el.id + '">' +
          '<div class="ea-elem-head"><strong>Accent Trim Bar</strong>' +
          '<button type="button" class="ea-elem-del" data-remove-elem="' + el.id + '" title="Remove">✕</button></div>' +
          '<div class="ea-elem-grid">' +
            '<input type="color" value="' + esc(el.color || gpuAccent || '#a855f7') + '" data-elem-color="' + el.id + '" title="Bar color">' +
            '<select data-elem-place="' + el.id + '">' + trimPlacementOptions(el.placement || 'top') + '</select>' +
          '</div>' +
          '<div class="ea-elem-row">' +
            '<label>Pos <b>' + Math.round((el.position ?? 0.5) * 100) + '%</b><input type="range" min="12" max="88" value="' + Math.round((el.position ?? 0.5) * 100) + '" data-elem-pos="' + el.id + '"></label>' +
            (showZ ? '<label>Row (Z) <b>' + zPct + '%</b><input type="range" min="8" max="92" value="' + zPct + '" data-elem-zpos="' + el.id + '"></label>' : '') +
            '<label>Length <b>' + Math.round((el.size || 1) * 100) + '%</b><input type="range" min="40" max="180" value="' + Math.round((el.size || 1) * 100) + '" data-elem-size="' + el.id + '"></label>' +
          '</div></div>';
      }
      if (el.kind === 'vent_grille') {
        const showZ = el.placement === 'top' || el.placement === 'back';
        const zPct = Math.round((el.zPosition ?? 0.5) * 100);
        return '<div class="ea-elem-card" data-elem-id="' + el.id + '">' +
          '<div class="ea-elem-head"><strong>Vent Grille</strong>' +
          '<button type="button" class="ea-elem-del" data-remove-elem="' + el.id + '" title="Remove">✕</button></div>' +
          '<div class="ea-elem-grid">' +
            '<select data-elem-place="' + el.id + '">' + trimPlacementOptions(el.placement || 'top') + '</select>' +
          '</div>' +
          '<div class="ea-elem-row">' +
            '<label>Pos <b>' + Math.round((el.position ?? 0.82) * 100) + '%</b><input type="range" min="12" max="88" value="' + Math.round((el.position ?? 0.82) * 100) + '" data-elem-pos="' + el.id + '"></label>' +
            (showZ ? '<label>Row (Z) <b>' + zPct + '%</b><input type="range" min="8" max="92" value="' + zPct + '" data-elem-zpos="' + el.id + '"></label>' : '') +
            '<label>Size <b>' + Math.round((el.size || 1) * 100) + '%</b><input type="range" min="50" max="160" value="' + Math.round((el.size || 1) * 100) + '" data-elem-size="' + el.id + '"></label>' +
          '</div></div>';
      }
      if (el.kind === 'rgb_strip') {
        const isRainbow = el.colorMode === 'rainbow' || !!el.rainbow;
        return '<div class="ea-elem-card" data-elem-id="' + el.id + '">' +
          '<div class="ea-elem-head"><strong>RGB Light Strip</strong>' +
          '<button type="button" class="ea-elem-del" data-remove-elem="' + el.id + '" title="Remove">✕</button></div>' +
          '<div class="ea-elem-grid">' +
            '<input type="color" value="' + esc(el.color || '#a855f7') + '" data-elem-color="' + el.id + '" title="Solid glow color">' +
            '<button type="button" class="zoom-btn ea-rainbow-btn' + (isRainbow ? ' active' : '') + '" data-rgb-rainbow="' + el.id + '">Rainbow</button>' +
            '<select data-elem-place="' + el.id + '">' +
              '<option value="side"' + (el.placement === 'side' ? ' selected' : '') + '>Side Rails</option>' +
              '<option value="top"' + (el.placement === 'top' ? ' selected' : '') + '>Top Trim</option>' +
              '<option value="halo"' + (el.placement === 'halo' ? ' selected' : '') + '>Full Halo</option>' +
              '<option value="slash"' + (el.placement === 'slash' ? ' selected' : '') + '>Triple Slash</option>' +
            '</select>' +
          '</div></div>';
      }
      return '';
    }).join('');

    wrap.querySelectorAll('[data-gpu-go-research]').forEach(btn => btn.addEventListener('click', goToGpuResearch));
    wrap.querySelectorAll('[data-remove-elem]').forEach(btn => btn.addEventListener('click', () => {
      gpuElements = gpuElements.filter(x => x.id !== btn.dataset.removeElem);
      renderAddElementTab();
      renderPlacedElementsManager();
      drawGpu();
    }));

    wrap.querySelectorAll('[data-elem-pos]').forEach(inp => {
      inp.addEventListener('input', () => {
        const target = gpuElements.find(x => x.id === inp.dataset.elemPos);
        if (target) {
          target.position = Number(inp.value) / 100;
          const b = inp.parentElement?.querySelector('b');
          if (b) b.textContent = inp.value + '%';
          drawGpu(true);
        }
      });
      inp.addEventListener('change', () => drawGpu(false));
    });

    wrap.querySelectorAll('[data-elem-zpos]').forEach(inp => {
      inp.addEventListener('input', () => {
        const target = gpuElements.find(x => x.id === inp.dataset.elemZpos);
        if (target) {
          target.zPosition = Number(inp.value) / 100;
          const b = inp.parentElement?.querySelector('b');
          if (b) b.textContent = inp.value + '%';
          drawGpu(true);
        }
      });
      inp.addEventListener('change', () => drawGpu(false));
    });

    wrap.querySelectorAll('[data-elem-size]').forEach(inp => {
      inp.addEventListener('input', () => {
        const target = gpuElements.find(x => x.id === inp.dataset.elemSize);
        if (target) {
          target.size = Number(inp.value) / 100;
          const b = inp.parentElement?.querySelector('b');
          if (b) b.textContent = inp.value + '%';
          drawGpu(true);
        }
      });
      inp.addEventListener('change', () => drawGpu(false));
    });

    wrap.querySelectorAll('[data-fan-blade]').forEach(sel => sel.addEventListener('change', () => {
      const target = gpuElements.find(x => x.id === sel.dataset.fanBlade);
      if (target) { target.bladeColor = sel.value; drawGpu(); }
    }));
    wrap.querySelectorAll('[data-fan-hub]').forEach(sel => sel.addEventListener('change', () => {
      const target = gpuElements.find(x => x.id === sel.dataset.fanHub);
      if (target) { target.hubStyle = sel.value; drawGpu(); }
    }));
    wrap.querySelectorAll('[data-fan-rgb]').forEach(btn => btn.addEventListener('click', () => {
      if (!hasRgbResearch) { toast('Research RGB first.'); return; }
      const target = gpuElements.find(x => x.id === btn.dataset.fanRgb);
      if (target) {
        target.rgbRing = !target.rgbRing;
        renderPlacedElementsManager();
        drawGpu();
      }
    }));
    wrap.querySelectorAll('[data-text-glow]').forEach(btn => btn.addEventListener('click', () => {
      if (!hasRgbResearch) { toast('Research RGB first.'); return; }
      const target = gpuElements.find(x => x.id === btn.dataset.textGlow);
      if (target) {
        target.glow = !target.glow;
        renderPlacedElementsManager();
        drawGpu();
      }
    }));

    wrap.querySelectorAll('[data-elem-text]').forEach(inp => inp.addEventListener('input', () => {
      const target = gpuElements.find(x => x.id === inp.dataset.elemText);
      if (target) { target.text = inp.value; drawGpu(true); }
    }));

    wrap.querySelectorAll('[data-elem-color]').forEach(inp => {
      inp.addEventListener('input', () => {
        const target = gpuElements.find(x => x.id === inp.dataset.elemColor);
        if (target) {
          target.color = inp.value;
          if (target.kind === 'rgb_strip' && target.colorMode === 'rainbow') {
            target.colorMode = 'solid';
            target.rainbow = false;
            wrap.querySelector('[data-rgb-rainbow="' + target.id + '"]')?.classList.remove('active');
          }
          drawGpu(true);
        }
      });
      inp.addEventListener('change', () => drawGpu(false));
    });

    wrap.querySelectorAll('[data-rgb-rainbow]').forEach(btn => btn.addEventListener('click', () => {
      const target = gpuElements.find(x => x.id === btn.dataset.rgbRainbow);
      if (!target) return;
      const next = !(target.colorMode === 'rainbow' || !!target.rainbow);
      target.colorMode = next ? 'rainbow' : 'solid';
      target.rainbow = next;
      btn.classList.toggle('active', next);
      drawGpu();
    }));

    wrap.querySelectorAll('[data-elem-place]').forEach(sel => sel.addEventListener('change', () => {
      const target = gpuElements.find(x => x.id === sel.dataset.elemPlace);
      if (!target) return;
      target.placement = sel.value;
      if (target.kind === 'text' || target.kind === 'logo' || target.kind === 'accent_bar' || target.kind === 'vent_grille') {
        if (sel.value === 'top' && target.zPosition == null) target.zPosition = 0.88;
        if (sel.value === 'back' && target.zPosition == null) target.zPosition = 0.5;
        renderPlacedElementsManager();
        window.GpuDesigner3D?.focusPlacement?.(sel.value);
      }
      drawGpu();
    }));

    wrap.querySelectorAll('[data-elem-upload]').forEach(inp => inp.addEventListener('change', e => {
      const file = e.target.files?.[0];
      const target = gpuElements.find(x => x.id === inp.dataset.elemUpload);
      if (!file || !target) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = 256; c.height = 256;
          const ctx = c.getContext('2d');
          const s = Math.min(256 / img.width, 256 / img.height);
          ctx.drawImage(img, (256 - img.width * s) / 2, (256 - img.height * s) / 2, img.width * s, img.height * s);
          target.logoUrl = c.toDataURL('image/webp', 0.82);
          drawGpu();
        };
        img.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    }));
  }

  // ---------- Workspace Mount & Navigation ----------
  function mountGpuWorkspace() {
    if (!isGpu()) return;
    $('#page-company-design #cpuDesigner')?.classList.add('hidden');
    $('#page-company-design #companyDesignNoCompany')?.classList.add('hidden');
    const dash = $('#page-company-design');
    if (!dash) return;
    let panel = $('#eaGpuPanel');
    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'eaGpuPanel';
      panel.className = 'company-dashboard-section ea-gpu-panel';
      panel.innerHTML =
        '<div class="ea-gpu-tabs">' +
          '<button type="button" data-gpu-tab="design" class="active">GPU</button>' +
          '<button type="button" data-gpu-tab="chips">CHIP</button>' +
        '</div>' +
        '<div id="eaGpuDesign" class="ea-gpu-view">' +
          '<div class="cpu-designer-layout ea-gpu-layout-match">' +
            '<div class="cpu-preview-panel">' +
              '<div class="cpu-preview-toolbar">' +
                '<span>3D GPU PREVIEW</span>' +
                '<div class="ea-gpu-toolbar-right">' +
                  '<button type="button" id="eaGpuSizeBtn" class="zoom-btn">Change Size</button>' +
                '</div>' +
              '</div>' +
              '<div id="eaGpu3DStage" class="ea-gpu-3d-stage"><div class="gpu-3d-loading">Loading realistic 3D GPU editor…</div></div>' +
              '<div id="eaGpuCost" class="cpu-preview-caption">Drag to orbit · Scroll to zoom · Drag fans or elements directly</div>' +
            '</div>' +
            '<div class="cpu-options-panel ea-gpu-sidebar">' +
              '<div class="cpu-menu-tabs ea-gpu-menu-tabs" role="tablist">' +
                '<button type="button" class="active" data-gpu-menu="body">Body</button>' +
                '<button type="button" data-gpu-menu="cooling">Cooling</button>' +
                '<button type="button" data-gpu-menu="chip">Chip</button>' +
                '<button type="button" data-gpu-menu="elements">Add Element</button>' +
              '</div>' +
              '<div id="eaGpuMenu_body" class="cpu-menu-content"></div>' +
              '<div id="eaGpuMenu_cooling" class="cpu-menu-content hidden"></div>' +
              '<div id="eaGpuMenu_chip" class="cpu-menu-content hidden"></div>' +
              '<div id="eaGpuMenu_elements" class="cpu-menu-content hidden"></div>' +
              '<div class="ea-placed-section">' +
                '<div class="ea-placed-head"><h4>Placed Elements</h4><button type="button" id="eaGpuSpaceFans" class="zoom-btn">Space Fans</button></div>' +
                '<div id="eaGpuPlacedList" class="ea-placed-list"></div>' +
              '</div>' +
              '<div class="cpu-design-summary">' +
                '<div><span>Estimated Value</span><strong id="eaGpuEstValue">$0</strong></div>' +
                '<div><span>Card Size</span><strong id="eaGpuSizeReadout">300 × 125 × 52 mm</strong></div>' +
              '</div>' +
              '<label class="cpu-design-label">GPU name<input id="eaGpuName" maxlength="48" value="New Graphics Card"></label>' +
              '<label class="cpu-design-label">Starting price ($)<input id="eaGpuPrice" type="number" min="1" step="1" value="1200"></label>' +
              '<div class="ea-gpu-save-row">' +
                '<button class="primary-btn full" id="eaGpuSave" type="button">Save as draft</button>' +
                '<button class="zoom-btn hidden" id="eaGpuCancelEdit" type="button">Cancel edit</button>' +
              '</div>' +
              '<p id="eaGpuMessage" class="form-message"></p>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div id="eaGpuChips" class="ea-gpu-view hidden">' +
          '<div class="cpu-designer-layout ea-chip-layout-match">' +
            '<div class="cpu-preview-panel">' +
              '<div class="cpu-preview-toolbar">' +
                '<span>3D GPU CHIP PREVIEW</span>' +
                '<small>Drag to orbit · Scroll to zoom</small>' +
              '</div>' +
              '<div id="eaChip3DStage" class="ea-chip-3d-stage"><div class="gpu-3d-loading">Loading realistic 3D GPU Chip editor…</div></div>' +
              '<div id="eaChipCostCaption" class="cpu-preview-caption">Exposed Silicon Die · Drag to orbit · Scroll to zoom</div>' +
            '</div>' +
            '<div class="cpu-options-panel ea-chip-sidebar">' +
              '<div class="cpu-menu-tabs ea-chip-menu-tabs" role="tablist">' +
                '<button type="button" class="active" data-chip-menu="package">Package</button>' +
                '<button type="button" data-chip-menu="speed">Speed</button>' +
                '<button type="button" data-chip-menu="power">Power</button>' +
                '<button type="button" data-chip-menu="vram">V-RAM</button>' +
              '</div>' +
              '<div id="eaChipMenu_package" class="cpu-menu-content"></div>' +
              '<div id="eaChipMenu_speed" class="cpu-menu-content hidden"></div>' +
              '<div id="eaChipMenu_power" class="cpu-menu-content hidden"></div>' +
              '<div id="eaChipMenu_vram" class="cpu-menu-content hidden"></div>' +
              '<div class="cpu-design-summary">' +
                '<div><span>Chip Value</span><strong id="eaChipEstValue">$0</strong></div>' +
                '<div><span>Score / V-RAM</span><strong id="eaChipScoreReadout">0 Score · No V-RAM</strong></div>' +
              '</div>' +
              '<label class="cpu-design-label">Chip name<input id="eaChipName" maxlength="40" value="Nova GPU Chip"></label>' +
              '<button class="primary-btn full" id="eaSaveChip" type="button">Save chip</button>' +
              '<p id="eaChipMessage" class="form-message"></p>' +
            '</div>' +
          '</div>' +
          '<div id="eaSavedChips" class="ea-saved-chips"></div>' +
        '</div>';
      dash.appendChild(panel);

      panel.querySelectorAll('[data-gpu-tab]').forEach(b => b.addEventListener('click', () => setGpuTab(b.dataset.gpuTab)));
      panel.querySelectorAll('[data-gpu-menu]').forEach(b => b.addEventListener('click', () => setMenuTab(b.dataset.gpuMenu)));
      panel.querySelectorAll('[data-chip-menu]').forEach(b => b.addEventListener('click', () => setChipMenuTab(b.dataset.chipMenu)));
      $('#eaGpuSpaceFans')?.addEventListener('click', () => {
        spaceFansEvenly();
        renderPlacedElementsManager();
        drawGpu();
      });
      $('#eaGpuSizeBtn')?.addEventListener('click', () => {
        const active = !$('#eaGpuSizeBtn').classList.contains('active');
        window.GpuDesigner3D?.setSizeMode?.(active);
      });
      $('#eaChipName')?.addEventListener('input', () => drawChip());
      $('#eaSaveChip')?.addEventListener('click', saveChip);
      $('#eaGpuSave')?.addEventListener('click', saveGpu);
      $('#eaGpuCancelEdit')?.addEventListener('click', () => {
        resetDraftGpuState();
        renderBodyTab();
        renderCoolingTab();
        renderChipTab();
        renderAddElementTab();
        renderPlacedElementsManager();
        drawGpu();
        toast('Cancelled draft edit.');
      });
    }

    setMenuTab(activeMenuTab);
    setChipMenuTab(activeChipMenuTab);
    renderBodyTab();
    renderCoolingTab();
    renderChipTab();
    renderAddElementTab();
    renderPlacedElementsManager();
    renderAllChipMenus();
    syncGpuSaveButtonUI();
    addBackButton();
    renderResearchLists();
  }

  function mountGpuResearch() {
    const section = $('#companyPanelResearch .research-section');
    if (!section) return;
    $('#cpuResearchTree')?.classList.toggle('hidden', isGpu());
    let wrap = $('#eaCompanyResearch');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'eaCompanyResearch';
      wrap.className = 'ea-company-research';
      wrap.innerHTML =
        '<div class="ea-research-subtabs"><button type="button" data-ea-research="GPU" class="active">GPU</button><button type="button" data-ea-research="CHIP">CHIP</button></div>' +
        '<div id="eaGpuResearchTree" class="research-tree" data-world-center="560"><div id="eaGpuResearchWorld" class="research-tree-world"></div><div class="research-tree-controls"><button type="button" data-ea-zoom="out">−</button><button type="button" data-ea-zoom="reset">Reset</button><button type="button" data-ea-zoom="in">+</button></div></div>' +
        '<div id="eaChipResearchTree" class="research-tree hidden" data-world-center="610"><div id="eaChipResearchWorld" class="research-tree-world"></div><div class="research-tree-controls"><button type="button" data-ea-zoom="out">−</button><button type="button" data-ea-zoom="reset">Reset</button><button type="button" data-ea-zoom="in">+</button></div></div>' +
        '<p id="eaResearchMessage" class="form-message"></p>';
      const tree = $('#cpuResearchTree');
      section.insertBefore(wrap, tree || null);
      wrap.querySelectorAll('[data-ea-research]').forEach(b => b.addEventListener('click', () => setResearchGroup(b.dataset.eaResearch)));
      setupResearchTreeNavigation($('#eaGpuResearchTree'));
      setupResearchTreeNavigation($('#eaChipResearchTree'));
    }
    wrap.classList.toggle('hidden', !isGpu());
    if (isGpu()) {
      const eyebrow = section.querySelector('.company-section-heading .eyebrow');
      const heading = section.querySelector('.company-section-heading h4');
      const chip = section.querySelector('.company-count-chip');
      const description = section.querySelector('.company-section-heading p');
      if (eyebrow) eyebrow.textContent = 'GPU DEVELOPMENT';
      if (heading) heading.textContent = 'Research';
      if (description) description.textContent = 'Choose GPU or CHIP research, just like the CPU research section.';
      if (chip) chip.textContent = 'GPU / CHIP';
      renderResearchLists();
    }
  }

  function setResearchGroup(group) {
    $('#eaGpuResearchTree')?.classList.toggle('hidden', group !== 'GPU');
    $('#eaChipResearchTree')?.classList.toggle('hidden', group !== 'CHIP');
    document.querySelectorAll('[data-ea-research]').forEach(b => b.classList.toggle('active', b.dataset.eaResearch === group));
    renderResearchLists();
  }

  function mountGpuProductsPage() {
    const page = $('#page-company-products');
    if (!page) return;
    page.innerHTML =
      '<div class="section-head"><div><div class="eyebrow purple-text">GPU MANUFACTURING</div><h3>Products</h3><p class="muted">Select a GPU to inspect details, edit drafts, or publish to the Product Feed.</p></div></div>' +
      '<div id="eaGpuProductList" class="ea-gpu-product-grid"></div>' +
      '<div id="eaGpuProductDetails" class="company-product-details hidden"></div>';
  }

  function restoreCpuProductsPage() {
    if (typeof window.renderSidebarCpuProductsPage === 'function') {
      window.renderSidebarCpuProductsPage();
      return;
    }
    const page = $('#page-company-products');
    if (!page) return;
    page.innerHTML =
      '<div class="company-empty-page"><div class="eyebrow purple-text">COMPANY WORKSPACE</div><div class="company-empty-icon">▦</div><h3>Products</h3><p class="muted">Your manufactured products will appear here.</p></div>';
  }

  function hideGpuWorkspace() {
    $('#eaGpuPanel')?.classList.add('hidden');
    $('#eaCompanyResearch')?.classList.add('hidden');
    $('#cpuResearchTree')?.classList.remove('hidden');
    const section = $('#companyPanelResearch .research-section');
    if (section) {
      const eyebrow = section.querySelector('.company-section-heading .eyebrow');
      const heading = section.querySelector('.company-section-heading h4');
      const chip = section.querySelector('.company-count-chip');
      const description = section.querySelector('.company-section-heading p');
      if (eyebrow) eyebrow.textContent = 'CPU DEVELOPMENT';
      if (heading) heading.textContent = 'Research tree';
      if (description) description.textContent = 'Unlock components before using them in your designs.';
      if (chip) chip.textContent = 'CPU RESEARCH';
    }
    const showCpu = !!(currentCompany && !isGpu());
    $('#page-company-design #cpuDesigner')?.classList.toggle('hidden', !showCpu);
    $('#page-company-design #companyDesignNoCompany')?.classList.toggle('hidden', !!currentCompany);
    restoreCpuProductsPage();
  }

  function showGpuMain() {
    if (!isGpu()) return;
    $('#page-company-design #companyDesignNoCompany')?.classList.add('hidden');
    $('#page-company-design #cpuDesigner')?.classList.add('hidden');
    $('#eaGpuPanel')?.classList.remove('hidden');
    setGpuTab(activeGpuView);
    renderBodyTab();
    renderCoolingTab();
    renderChipTab();
    renderAddElementTab();
    renderPlacedElementsManager();

    const stage = $('#eaGpu3DStage');
    if (stage && window.GpuDesigner3D?.mount) {
      window.GpuDesigner3D.mount(stage, {
        onSizeModeChange(active) {
          const btn = $('#eaGpuSizeBtn');
          if (btn) {
            btn.classList.toggle('active', !!active);
            btn.textContent = active ? 'Done Resizing' : 'Change Size';
          }
        },
        onSizeChange(sz) {
          if (!sz) return;
          gpuLength = Math.max(210, Math.min(360, Math.round(sz.length || 300)));
          gpuWidth = Math.max(105, Math.min(150, Math.round(sz.width || 125)));
          updateCostAndReadouts();
        },
        onElementsChange(updated) {
          if (!Array.isArray(updated)) return;
          gpuElements = updated;
          gpuElements.forEach(el => {
            const slider = document.querySelector('[data-elem-pos="' + el.id + '"]');
            if (slider) {
              const pct = String(Math.round((el.position ?? 0.5) * 100));
              slider.value = pct;
              const b = slider.parentElement?.querySelector('b');
              if (b) b.textContent = pct + '%';
            }
            const zSlider = document.querySelector('[data-elem-zpos="' + el.id + '"]');
            if (zSlider && el.zPosition != null) {
              const zPct = String(Math.round(el.zPosition * 100));
              zSlider.value = zPct;
              const zb = zSlider.parentElement?.querySelector('b');
              if (zb) zb.textContent = zPct + '%';
            }
          });
        }
      });
    }
    loadChips();
    drawGpu();
    mountChipStageIfNeeded();
    requestAnimationFrame(() => {
      window.GpuDesigner3D?.resize?.();
      window.ChipDesigner3D?.resize?.();
    });
  }

  function mountChipStageIfNeeded() {
    const chipStage = $('#eaChip3DStage');
    if (chipStage && window.ChipDesigner3D?.mount) {
      window.ChipDesigner3D.mount(chipStage);
    }
    renderAllChipMenus();
    drawChip();
    requestAnimationFrame(() => window.ChipDesigner3D?.resize?.());
  }

  function syncCompanyDesignMode() {
    const visible = !$('#page-company-design')?.classList.contains('hidden');
    if (!currentCompany) {
      $('#eaGpuPanel')?.classList.add('hidden');
      $('#page-company-design #cpuDesigner')?.classList.add('hidden');
      $('#page-company-design #companyDesignNoCompany')?.classList.remove('hidden');
      return;
    }
    if (isGpu()) {
      $('#page-company-design #cpuDesigner')?.classList.add('hidden');
      $('#page-company-design #companyDesignNoCompany')?.classList.add('hidden');
      if (visible) {
        mountGpuWorkspace();
        showGpuMain();
      } else {
        $('#eaGpuPanel')?.classList.add('hidden');
      }
    } else {
      $('#eaGpuPanel')?.classList.add('hidden');
      $('#page-company-design #companyDesignNoCompany')?.classList.add('hidden');
      $('#page-company-design #cpuDesigner')?.classList.remove('hidden');
    }
  }

  function setGpuTab(tab) {
    document.querySelectorAll('[data-gpu-tab]').forEach(b => b.classList.toggle('active', b.dataset.gpuTab === tab));
    activeGpuView = tab === 'chips' ? 'chips' : 'design';
    const views = { design: '#eaGpuDesign', chips: '#eaGpuChips' };
    Object.entries(views).forEach(([key, selector]) => $(selector)?.classList.toggle('hidden', key !== activeGpuView));
    if (activeGpuView === 'chips') {
      loadChips();
      mountChipStageIfNeeded();
    } else {
      requestAnimationFrame(() => window.GpuDesigner3D?.resize?.());
    }
  }

  // ---------- GPU & CHIP Research Trees ----------
  function researchNodeMarkup(r, x, y, icon, yes, locked) {
    const status = yes ? 'UNLOCKED' : locked ? 'LOCKED' : 'UNLOCK · $' + r.cost.toLocaleString();
    return '<button type="button" class="research-node ' + (yes ? 'researched' : locked ? 'prerequisite-locked' : 'available') +
      '" data-research-key="' + r.key + '" style="--node-x:' + x + 'px;--node-y:' + y + 'px" ' + (yes || locked ? 'disabled' : '') + '>' +
      '<span class="research-hex"><b>' + icon + '</b></span><strong>' + r.name + '</strong>' +
      '<small>$' + r.cost.toLocaleString() + ' research · ' + r.score + ' Score</small>' +
      '<em class="research-node-status">' + status + '</em></button>';
  }

  function renderResearchLists() {
    const GPU_LAYOUT = {
      __root: [560, 130, 'GPU', 'Baseline GPU'],
      gpu_metallic_body: [280, 410, 'MB'],
      gpu_carbon_body: [280, 700, 'CF'],
      gpu_rgb: [560, 410, 'RGB'],
      gpu_small_fans: [840, 410, 'SF'],
      gpu_medium_fans: [840, 700, 'MF'],
      gpu_smart_fans: [840, 990, 'AF']
    };
    const VRAM_ICONS = ['1G', '2G', '4G', '6G', '4A', '6A', '8A', '12A', '16A', '32A'];
    const CHIP_LAYOUT = {
      __root: [610, 130, 'CHIP', 'Baseline CHIP'],
      chip_ok_speed: [230, 390, '1×'],
      chip_decent_speed: [230, 630, '2×'],
      chip_good_speed: [230, 870, '3×'],
      chip_fast_speed: [230, 1110, '4×'],
      chip_insane_speed: [230, 1350, '6×'],
      chip_super_speed: [230, 1590, '8×'],
      chip_decent_power: [610, 390, 'P1'],
      chip_good_power: [610, 630, 'P2'],
      chip_strong_power: [610, 870, 'P3'],
      chip_super_powerful: [610, 1110, 'P4']
    };
    CHIP_VRAM_KEYS.forEach((k, idx) => {
      CHIP_LAYOUT[k] = [990, 390 + idx * 240, VRAM_ICONS[idx] || 'VR'];
    });

    const build = (group, worldId) => {
      const world = $('#' + worldId);
      if (!world) return;
      const defs = GPU_RESEARCH.filter(r => r.group === group);
      const layout = group === 'GPU' ? GPU_LAYOUT : CHIP_LAYOUT;
      const rootInfo = layout.__root;
      const width = group === 'GPU' ? 1120 : 1220;
      const height = group === 'GPU' ? 1250 : 2780;

      const paths = defs.map(r => {
        const A = r.pre && layout[r.pre] ? layout[r.pre] : rootInfo;
        const B = layout[r.key];
        if (!A || !B) return '';
        const mid = (A[1] + B[1]) / 2;
        return '<path d="M' + A[0] + ' ' + (A[1] + 65) + ' L' + A[0] + ' ' + mid + ' L' + B[0] + ' ' + mid + ' L' + B[0] + ' ' + (B[1] - 65) + '"/>';
      }).join('');

      world.style.width = width + 'px';
      world.style.height = height + 'px';
      world.innerHTML =
        '<svg class="research-tree-lines" viewBox="0 0 ' + width + ' ' + height + '">' + paths + '</svg>' +
        researchNodeMarkup({ name: rootInfo[3], cost: 0, score: 0, key: 'baseline_' + group.toLowerCase() }, rootInfo[0], rootInfo[1], rootInfo[2], true, false) +
        defs.map(r => {
          const xy = layout[r.key] || [rootInfo[0], rootInfo[1]];
          const yes = researched(r.key);
          const locked = !!(r.pre && !researched(r.pre));
          return researchNodeMarkup(r, xy[0], xy[1], xy[2] || 'UP', yes, locked);
        }).join('');
      world.querySelectorAll('[data-research-key]').forEach(b => b.addEventListener('click', () => unlockResearch(b.dataset.researchKey, group)));
    };
    build('GPU', 'eaGpuResearchWorld');
    build('CHIP', 'eaChipResearchWorld');
  }

  function setupResearchTreeNavigation(tree) {
    if (!tree || tree.dataset.navigationReady) return;
    tree.dataset.navigationReady = '1';
    const world = tree.querySelector('.research-tree-world');
    if (!world) return;
    const centerX = Number(tree.dataset.worldCenter || 560);
    let zoom = 0.72, panX = (tree.clientWidth || 720) / 2 - centerX * zoom, panY = 12, dragging = false, sx = 0, sy = 0, bx = 0, by = 0;
    const paint = () => { world.style.transform = 'translate(' + panX + 'px,' + panY + 'px) scale(' + zoom + ')'; };
    tree.addEventListener('pointerdown', e => {
      if (e.target.closest('button[data-research-key],.research-tree-controls')) return;
      dragging = true; sx = e.clientX; sy = e.clientY; bx = panX; by = panY;
      tree.classList.add('dragging'); tree.setPointerCapture(e.pointerId);
    });
    tree.addEventListener('pointermove', e => { if (!dragging) return; panX = bx + e.clientX - sx; panY = by + e.clientY - sy; paint(); });
    const stop = () => { dragging = false; tree.classList.remove('dragging'); };
    tree.addEventListener('pointerup', stop);
    tree.addEventListener('pointercancel', stop);
    tree.querySelectorAll('[data-ea-zoom]').forEach(b => b.addEventListener('click', () => {
      const a = b.dataset.eaZoom;
      if (a === 'reset') { zoom = 0.72; panX = (tree.clientWidth || 720) / 2 - centerX * zoom; panY = 12; }
      else {
        const next = Math.max(0.42, Math.min(1.35, zoom * (a === 'in' ? 1.15 : 0.87)));
        panX = panX * next / zoom; panY = panY * next / zoom; zoom = next;
      }
      paint();
    }));
    tree.addEventListener('wheel', e => {
      if (!e.ctrlKey && Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
      e.preventDefault();
      const next = Math.max(0.42, Math.min(1.35, zoom * (e.deltaY < 0 ? 1.08 : 0.92)));
      panX = panX * next / zoom; panY = panY * next / zoom; zoom = next; paint();
    }, { passive: false });
    paint();
  }

  async function unlockResearch(key) {
    const { data, error } = await sb.rpc('unlock_company_research', { p_company_id: currentCompany.id, p_research_key: key });
    if (error) { toast(error.message); return; }
    if (data?.cash_remaining !== undefined) currentUser.cash = data.cash_remaining;
    await loadCompanyResearchAndProducts();
    renderResearchLists();
    renderBodyTab();
    renderCoolingTab();
    renderAddElementTab();
    renderPlacedElementsManager();
    renderAllChipMenus();
    drawGpu();
    drawChip();
    updateUIProfile?.();
    toast('Research unlocked!');
  }

  // ---------- 3D GPU CHIP Designer & V-RAM Menus ----------
  function setChipMenuTab(tab) {
    activeChipMenuTab = ['package', 'speed', 'power', 'vram'].includes(tab) ? tab : 'package';
    document.querySelectorAll('[data-chip-menu]').forEach(b => b.classList.toggle('active', b.dataset.chipMenu === activeChipMenuTab));
    ['package', 'speed', 'power', 'vram'].forEach(t => {
      const el = $('#eaChipMenu_' + t);
      if (el) el.classList.toggle('hidden', t !== activeChipMenuTab);
    });
  }

  function renderChipPackageMenu() {
    const wrap = $('#eaChipMenu_package');
    if (!wrap) return;
    const subPills = [
      ['green', 'Emerald Green'],
      ['obsidian', 'Matte Obsidian'],
      ['blue', 'Cobalt Blue']
    ].map(([id, label]) =>
      '<button type="button" class="zoom-btn' + (chipSubstrate === id ? ' active' : '') + '" data-chip-substrate="' + id + '">' + label + '</button>'
    ).join('');

    const shimPills = [
      ['steel', 'Brushed Steel'],
      ['copper', 'Pure Copper'],
      ['dark', 'Anodized Dark']
    ].map(([id, label]) =>
      '<button type="button" class="zoom-btn' + (chipShimStyle === id ? ' active' : '') + '" data-chip-shim="' + id + '">' + label + '</button>'
    ).join('');

    wrap.innerHTML =
      '<h4>GPU Interposer Package</h4>' +
      '<div class="ea-gpu-inline-box"><span>PCB Substrate Color</span><div class="ea-gpu-pill-row">' + subPills + '</div></div>' +
      '<div class="ea-gpu-inline-box"><span>Anti-Crush Metal Shim Frame</span><div class="ea-gpu-pill-row">' + shimPills + '</div></div>' +
      '<p class="muted tiny" style="margin:4px 2px 0">Select Speed, Power Delivery, and V-RAM modules from the tabs above to update the live 3D GPU die, VRMs, and memory array.</p>';

    wrap.querySelectorAll('[data-chip-substrate]').forEach(btn => btn.addEventListener('click', () => {
      chipSubstrate = btn.dataset.chipSubstrate;
      renderChipPackageMenu();
      drawChip();
    }));
    wrap.querySelectorAll('[data-chip-shim]').forEach(btn => btn.addEventListener('click', () => {
      chipShimStyle = btn.dataset.chipShim;
      renderChipPackageMenu();
      drawChip();
    }));
  }

  function renderChipSpecMenu(elId, title, icon, baseName, baseDesc, keys, getCurrent, setCurrent) {
    const wrap = $(elId);
    if (!wrap) return;
    let current = getCurrent();
    if (current !== 'none' && !researched(current)) {
      current = 'none';
      setCurrent('none');
    }

    const baseSelected = current === 'none';
    const baseHtml =
      '<div class="cpu-component-option ' + (baseSelected ? 'selected' : '') + '">' +
        '<span class="cpu-component-icon">' + icon + '</span>' +
        '<span><strong>' + baseName + '</strong><small>' + baseDesc + '</small></span>' +
        '<button type="button" class="zoom-btn" data-chip-pick="none">' + (baseSelected ? 'Selected' : 'Use') + '</button>' +
      '</div>';

    const itemsHtml = GPU_RESEARCH.filter(r => keys.includes(r.key)).map(r => {
      const ok = researched(r.key);
      const selected = current === r.key;
      return '<div class="cpu-component-option ' + (ok ? '' : 'locked') + ' ' + (selected ? 'selected' : '') + '">' +
        '<span class="cpu-component-icon">' + icon + '</span>' +
        '<span><strong>' + esc(r.name) + '</strong><small>' + (ok ? r.score + ' Score · $' + r.value.toLocaleString() + ' value' : 'Research required · ' + r.score + ' Score') + '</small></span>' +
        '<button type="button" class="zoom-btn" ' + (ok ? 'data-chip-pick="' + esc(r.key) + '"' : 'data-chip-go-research="CHIP"') + '>' + (ok ? (selected ? 'Selected' : 'Use') : 'Research') + '</button>' +
        '</div>';
    }).join('');

    wrap.innerHTML = '<h4>' + title + '</h4>' + baseHtml + itemsHtml;
    wrap.querySelectorAll('[data-chip-pick]').forEach(btn => btn.addEventListener('click', () => {
      setCurrent(btn.dataset.chipPick);
      renderChipSpecMenu(elId, title, icon, baseName, baseDesc, keys, getCurrent, setCurrent);
      drawChip();
    }));
    wrap.querySelectorAll('[data-chip-go-research]').forEach(btn => btn.addEventListener('click', () => goToGpuResearch('CHIP')));
  }

  function renderAllChipMenus() {
    renderChipPackageMenu();
    renderChipSpecMenu(
      '#eaChipMenu_speed', 'Silicon Clock & Shader Speed', '⚡', 'Base Speed', 'Free · Entry reference clock',
      CHIP_SPEED_KEYS, () => selectedChipSpeed, v => { selectedChipSpeed = v; }
    );
    renderChipSpecMenu(
      '#eaChipMenu_power', 'Power Delivery & VRM Phases', '◈', 'Base Power', 'Free · Standard reference phases',
      CHIP_POWER_KEYS, () => selectedChipPower, v => { selectedChipPower = v; }
    );
    renderChipSpecMenu(
      '#eaChipMenu_vram', 'Video Memory (V-RAM)', '▦', 'No V-RAM', 'Free · External board memory only',
      CHIP_VRAM_KEYS, () => selectedChipVram, v => { selectedChipVram = v; }
    );
    updateChipReadouts();
  }

  function computeChipValues() {
    const sDef = GPU_RESEARCH.find(r => r.key === selectedChipSpeed);
    const pDef = GPU_RESEARCH.find(r => r.key === selectedChipPower);
    const vDef = GPU_RESEARCH.find(r => r.key === selectedChipVram);
    const value = (sDef?.value || 0) + (pDef?.value || 0) + (vDef?.value || 0);
    const score = (sDef?.score || 0) + (pDef?.score || 0) + (vDef?.score || 0);
    return { value, score, sDef, pDef, vDef };
  }

  function updateChipReadouts() {
    const { value, score } = computeChipValues();
    if ($('#eaChipEstValue')) $('#eaChipEstValue').textContent = '$' + value.toLocaleString();
    if ($('#eaChipScoreReadout')) $('#eaChipScoreReadout').textContent = score + ' Score · ' + chipVramLabel(selectedChipVram);
    const cap = $('#eaChipCostCaption');
    if (cap) {
      const subLabel = chipSubstrate === 'obsidian' ? 'Obsidian' : chipSubstrate === 'blue' ? 'Cobalt Blue' : 'Emerald Green';
      const shimLabel = chipShimStyle === 'copper' ? 'Copper Shim' : chipShimStyle === 'dark' ? 'Dark Shim' : 'Steel Shim';
      cap.textContent = subLabel + ' · ' + shimLabel + ' · ' + researchName(selectedChipSpeed) + ' · ' + researchName(selectedChipPower) + ' · ' + chipVramLabel(selectedChipVram);
    }
  }

  function drawChip() {
    updateChipReadouts();
    const chipName = ($('#eaChipName')?.value || 'Nova GPU Chip').trim();
    window.ChipDesigner3D?.update?.({
      name: chipName,
      companyName: currentCompany?.company_name || '',
      logoUrl: currentCompany?.logo_data_url || '',
      substrate: chipSubstrate,
      shimStyle: chipShimStyle,
      speedLevel: selectedChipSpeed,
      powerLevel: selectedChipPower,
      vramLevel: selectedChipVram
    });
  }

  async function saveChip() {
    const name = ($('#eaChipName')?.value || '').trim();
    const speed = selectedChipSpeed || 'none';
    const power = selectedChipPower || 'none';
    const vram = selectedChipVram || 'none';
    if (name.length < 2) { $('#eaChipMessage').textContent = 'Chip name must be at least 2 characters.'; return; }
    if ((speed !== 'none' && !researched(speed)) || (power !== 'none' && !researched(power)) || (vram !== 'none' && !researched(vram))) {
      toast('Research the selected chip component first.');
      return;
    }
    const { error } = await sb.from('product_company_gpu_chips').insert({
      company_id: currentCompany.id,
      owner_id: currentUser.id,
      chip_name: name,
      speed_level: speed,
      power_level: power,
      vram_level: vram
    });
    $('#eaChipMessage').textContent = error ? 'Could not save chip: ' + error.message : 'Chip saved! Pick it under the Chip tab in GPU Design.';
    if (!error) {
      toast('Chip saved.');
      await loadChips();
    }
  }

  async function loadChips() {
    if (!currentCompany) return;
    renderAllChipMenus();

    const { data, error } = await sb
      .from('product_company_gpu_chips')
      .select('*')
      .eq('company_id', currentCompany.id)
      .order('created_at', { ascending: false });
    const wrap = $('#eaSavedChips');
    if (error) { if (wrap) wrap.textContent = error.message; return; }
    chips = data || [];
    if (selectedChipId && !chips.some(c => c.id === selectedChipId)) selectedChipId = '';
    if (!selectedChipId && chips.length === 1) selectedChipId = chips[0].id;
    renderChipTab();

    if (wrap) {
      wrap.innerHTML = chips.map(c =>
        '<button type="button" class="ea-chip-card" data-chip-select="' + esc(c.id) + '"><span>▦</span><b>' + esc(c.chip_name) + '</b><small>' + esc(researchName(c.speed_level)) + ' · ' + esc(researchName(c.power_level)) + ' · ' + esc(chipVramLabel(c.vram_level)) + '</small></button>'
      ).join('') || '<p class="muted">No chips saved yet.</p>';
      wrap.querySelectorAll('[data-chip-select]').forEach(b => b.addEventListener('click', () => {
        selectedChipId = b.dataset.chipSelect;
        setGpuTab('design');
        setMenuTab('chip');
        renderChipTab();
        drawGpu();
      }));
    }
  }

  // ---------- Live Update, Cost & Save ----------
  function computeGpuValues() {
    const bodyValue = gpuBody === 'carbon' ? 4000 : gpuBody === 'metallic' ? 1200 : 0;
    const fans = gpuElements.filter(e => e.kind === 'fan');
    const fanValue = fans.reduce((sum, f) => sum + (f.fanType === 'gpu_smart_fans' ? 1400 : f.fanType === 'gpu_medium_fans' ? 200 : f.fanType === 'gpu_small_fans' ? 80 : 0), 0);
    const hasRgb = gpuElements.some(e => e.kind === 'rgb_strip' || (e.kind === 'fan' && e.rgbRing) || (e.kind === 'text' && e.glow));
    const rgbValue = hasRgb ? 480 : 0;
    return { bodyValue, fanValue, rgbValue, total: bodyValue + fanValue + rgbValue, fanCount: fans.length, hasRgb };
  }

  function updateCostAndReadouts() {
    const { bodyValue, fanValue, rgbValue, total, fanCount } = computeGpuValues();
    if ($('#eaGpuEstValue')) $('#eaGpuEstValue').textContent = '$' + total.toLocaleString();
    if ($('#eaGpuSizeReadout')) $('#eaGpuSizeReadout').textContent = gpuLength + ' × ' + gpuWidth + ' × ' + gpuThickness + ' mm';
    if ($('#eaGpuCost')) {
      $('#eaGpuCost').textContent =
        (gpuBody === 'carbon' ? 'Carbon' : gpuBody === 'metallic' ? 'Metallic' : 'Plastic') +
        ' (' + gpuFinish + ')' +
        ' · ' + fanCount + ' Fan' + (fanCount === 1 ? '' : 's') +
        ' · Value $' + total.toLocaleString() +
        ' (Body $' + bodyValue.toLocaleString() + ' + Fans $' + fanValue.toLocaleString() + ' + RGB $' + rgbValue.toLocaleString() + ')';
    }
  }

  function drawGpu(fast = false) {
    window.GpuDesigner3D?.update({
      length: gpuLength,
      width: gpuWidth,
      thickness: gpuThickness,
      body: gpuBody,
      finish: gpuFinish,
      shroud: gpuShroud,
      primaryColor: gpuPrimary,
      accentColor: gpuAccent,
      backplate: gpuBackplateStyle !== 'off',
      backplateStyle: gpuBackplateStyle,
      finStyle: gpuFinStyle,
      pipeStyle: gpuPipeStyle,
      powerType: gpuPowerType,
      ioStyle: gpuIoStyle,
      elements: gpuElements.map(e => ({ ...e }))
    }, { fast: !!fast });
    updateCostAndReadouts();
  }

  function renderGpuProducts() {
    const el = $('#eaGpuProductList');
    const detailEl = $('#eaGpuProductDetails');
    if (!el) return;
    const rows = (companyProducts || []).filter(p => isGpuProductRow(p));
    if (!rows.length) {
      el.innerHTML = '<div class="company-empty-products"><span>▦</span><strong>No GPU products yet</strong><p class="muted">Create your first GPU in Design.</p></div>';
      if (detailEl) detailEl.classList.add('hidden');
      return;
    }
    if (!selectedGpuPageProductId || !rows.some(r => r.id === selectedGpuPageProductId)) {
      selectedGpuPageProductId = rows[0].id;
    }
    const byId = new Map();
    el.innerHTML = rows.map(p => {
      byId.set(p.id, p);
      const draft = isProductDraft(p);
      const active = p.id === selectedGpuPageProductId;
      return (
        '<article class="ea-chip-card ea-gpu-product-card' + (active ? ' active' : '') + '" data-ea-gpu-select="' + esc(p.id) + '" tabindex="0" role="button">' +
        '<div class="ea-gpu-product-thumb-wrap" data-gpu-thumb-id="' + esc(p.id) + '">' + renderGpuThumbHtml(p) + '</div>' +
        '<b>' + esc(p.product_name || 'GPU') + '</b>' +
        '<small>' + esc(formatGpuSpecLine(p)) + '</small>' +
        '<small>' + (draft ? 'Draft · Editable' : 'Published') + ' · Value $' + Number(p.product_value || 0).toLocaleString() + '</small>' +
        '</article>'
      );
    }).join('');
    hydrateGpuThumbElements(el, byId, 360, 270);

    el.querySelectorAll('[data-ea-gpu-select]').forEach(card => {
      const selectIt = () => {
        selectedGpuPageProductId = card.dataset.eaGpuSelect;
        renderGpuProducts();
      };
      card.addEventListener('click', selectIt);
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectIt(); }
      });
    });

    const selected = rows.find(r => r.id === selectedGpuPageProductId);
    if (!detailEl || !selected) {
      detailEl?.classList.add('hidden');
      return;
    }
    const draft = isProductDraft(selected);
    const unitValue = Math.max(0, Number(selected.product_value ?? selected.production_cost ?? 0));
    const stockCount = Number(selected.stock || 0);
    const gpuProduceBlock = draft
      ? '<p class="muted tiny" style="margin:4px 0 0;">Publish this draft before producing units.</p>'
      : '<label>Produce quantity (costs $' + unitValue.toLocaleString() + ' each)<input id="eaGpuProduceQty" type="number" min="1" max="100000" value="1"></label>' +
        '<div class="company-product-details-actions">' +
        '<button type="button" class="primary-btn" id="eaGpuProduceBtn">Produce 1 · $' + unitValue.toLocaleString() + '</button>' +
        '<button type="button" class="danger-btn" id="eaGpuLiquidateBtn" ' + (stockCount > 0 ? '' : 'disabled') + '>Delete stock · 50% refund</button>' +
        '</div>';
    detailEl.classList.remove('hidden');
    detailEl.innerHTML =
      '<div class="company-product-detail-hero">' +
      '<div class="company-product-detail-thumb company-product-detail-thumb-gpu" data-gpu-thumb-id="' + esc(selected.id) + '">' + renderGpuThumbHtml(selected) + '</div>' +
      '<div class="company-product-detail-title"><h4>' + esc(selected.product_name || 'GPU') + '</h4>' +
      '<p class="muted tiny">' + (draft ? 'Draft (Not yet published)' : 'Published on Product Feed') + '</p>' +
      '<small class="company-product-detail-specs">' + esc(formatGpuHardwareBadges(selected)) + '</small></div>' +
      '</div>' +
      '<div class="company-product-detail-grid">' +
      '<div class="company-product-detail-stat"><span>Product value / unit</span><strong>$' + unitValue.toLocaleString() + '</strong></div>' +
      '<div class="company-product-detail-stat"><span>Listed price</span><strong>$' + Number(selected.listed_price || 0).toLocaleString() + '</strong></div>' +
      '<div class="company-product-detail-stat"><span>Stock</span><strong>' + (stockCount > 0 ? stockCount : 'Out Of Stock') + '</strong></div>' +
      '<div class="company-product-detail-stat"><span>Units sold</span><strong>' + Number(selected.purchase_count || 0) + '</strong></div>' +
      '</div>' +
      '<label>Listing price ($)<input id="eaGpuDetailPrice" type="number" min="1" value="' + Number(selected.listed_price || 1) + '"></label>' +
      gpuProduceBlock +
      '<div class="company-product-details-actions">' +
      (draft ? '<button type="button" class="primary-btn" id="eaGpuDetailEdit">Edit</button>' : '') +
      '<button type="button" class="zoom-btn" id="eaGpuDetailSavePrice">Save price</button>' +
      (draft ? '<button type="button" class="primary-btn" id="eaGpuDetailPublish">Publish product</button><button type="button" class="danger-btn" id="eaGpuDetailDeleteDraft">Delete draft</button>' : '') +
      '</div>' +
      '<p class="form-message" id="eaGpuDetailMessage"></p>';

    hydrateGpuThumbElements(detailEl, new Map([[selected.id, selected]]), 360, 270);
    const msgEl = $('#eaGpuDetailMessage');
    if (!draft) {
      const qtyInput = $('#eaGpuProduceQty');
      const prodBtn = $('#eaGpuProduceBtn');
      const syncGpuProdBtn = () => {
        const q = Math.max(1, Math.min(100000, Math.floor(Number(qtyInput?.value || 1))));
        const totalCost = unitValue * q;
        if (prodBtn) prodBtn.textContent = 'Produce ' + q + ' · ' + (totalCost > 0 ? '$' + totalCost.toLocaleString() : 'Free');
      };
      syncGpuProdBtn();
      qtyInput?.addEventListener('input', syncGpuProdBtn);
      prodBtn?.addEventListener('click', () => {
        const q = Math.max(1, Math.min(100000, Math.floor(Number(qtyInput?.value || 1))));
        window.produceMoreProduct?.(selected.id, q, msgEl);
      });
      $('#eaGpuLiquidateBtn')?.addEventListener('click', () => window.liquidateProductStock?.(selected.id, msgEl));
    }
    $('#eaGpuDetailEdit')?.addEventListener('click', () => loadGpuDraftIntoEditor(selected));
    $('#eaGpuDetailDeleteDraft')?.addEventListener('click', () => window.deleteDraftProduct?.(selected.id, msgEl));
    const saveOrPublish = async publish => {
      const amount = Number($('#eaGpuDetailPrice')?.value || 0);
      if (!Number.isFinite(amount) || amount <= 0) {
        if (msgEl) msgEl.textContent = 'Enter a valid listing price.';
        return;
      }
      const result = await sb.rpc('update_cpu_product_listing', {
        p_product_id: selected.id,
        p_listed_price: amount,
        p_publish: publish
      });
      if (result.error) {
        if (msgEl) msgEl.textContent = result.error.message;
        return;
      }
      await loadCompanyResearchAndProducts();
      renderGpuProducts();
      if (typeof renderCompanyProducts === 'function') renderCompanyProducts();
      toast(publish ? 'GPU published to Product Feed!' : 'GPU price updated.');
    };
    $('#eaGpuDetailSavePrice')?.addEventListener('click', () => saveOrPublish(false));
    $('#eaGpuDetailPublish')?.addEventListener('click', () => saveOrPublish(true));
  }

  window.clearGpuDraftArtifacts = function (id, name) {
    if (id) clearGpuThumb(id);
    if (name) clearGpuThumb('name:' + name);
    if (editingGpuProductId === id) {
      editingGpuProductId = null;
      editingGpuOldName = '';
      syncGpuSaveButtonUI();
    }
    if (selectedGpuPageProductId === id) {
      selectedGpuPageProductId = null;
    }
  };

  function loadGpuDraftIntoEditor(p) {
    if (!p || !isProductDraft(p)) {
      toast('Only Draft GPUs can be edited.');
      return;
    }
    const d = p.design_data || {};
    gpuLength = Math.max(210, Math.min(360, Number(d.length || 300)));
    gpuWidth = Math.max(105, Math.min(150, Number(d.width || 125)));
    gpuThickness = Math.max(38, Math.min(76, Number(d.thickness || 52)));
    gpuBody = d.body || p.body_type || 'plastic';
    gpuFinish = d.finish || 'satin';
    gpuShroud = d.shroud || 'rounded';
    gpuPrimary = d.primary_color || '#222733';
    gpuAccent = d.accent_color || '#a855f7';
    gpuBackplateStyle = d.backplate_style || (d.backplate === false ? 'off' : 'flow_through');
    gpuFinStyle = d.fin_style || 'silver';
    gpuPipeStyle = d.pipe_style || 'copper';
    gpuPowerType = d.power_type || '12v2x6';
    gpuIoStyle = d.io_style || 'steel';
    selectedChipId = d.chip_id || '';
    gpuElements = Array.isArray(d.elements)
      ? d.elements.map((el, idx) => ({ ...el, id: el.id || ('el_restored_' + idx) }))
      : [];
    nextElemSeq = Math.max(nextElemSeq, gpuElements.length + 10);

    editingGpuProductId = p.id;
    editingGpuOldName = p.product_name || '';

    showPage('company-design');
    mountGpuWorkspace();
    setGpuTab('design');

    if ($('#eaGpuName')) $('#eaGpuName').value = p.product_name || 'New Graphics Card';
    if ($('#eaGpuPrice')) $('#eaGpuPrice').value = String(Math.max(1, Number(p.listed_price || 1200)));
    if ($('#eaGpuMessage')) $('#eaGpuMessage').textContent = 'Editing draft "' + (p.product_name || 'GPU') + '". Make changes and click Save edits.';

    renderBodyTab();
    renderCoolingTab();
    renderChipTab();
    renderAddElementTab();
    renderPlacedElementsManager();
    syncGpuSaveButtonUI();
    drawGpu();
    requestAnimationFrame(() => window.GpuDesigner3D?.resize?.());
    toast('Loaded GPU draft into editor.');
  }

  window.editGpuDraftProduct = function (id) {
    const p = (companyProducts || []).find(x => x.id === id);
    if (p) loadGpuDraftIntoEditor(p);
  };

  async function saveGpu() {
    const name = $('#eaGpuName').value.trim();
    if (name.length < 2 || !selectedChipId) {
      $('#eaGpuMessage').textContent = !selectedChipId ? 'Select a saved chip in the Chip tab first.' : 'Enter a GPU name (at least 2 characters).';
      if (!selectedChipId) setMenuTab('chip');
      return;
    }
    const fans = gpuElements.filter(e => e.kind === 'fan');
    const hasRgb = gpuElements.some(e => e.kind === 'rgb_strip' || (e.kind === 'fan' && e.rgbRing) || (e.kind === 'text' && e.glow));
    if ((gpuBody === 'metallic' && !researched('gpu_metallic_body')) ||
        (gpuBody === 'carbon' && !researched('gpu_carbon_body')) ||
        (hasRgb && !researched('gpu_rgb')) ||
        fans.some(f => !researched(f.fanType))) {
      toast('Research the selected GPU component first.');
      return;
    }
    const chip = chips.find(x => x.id === selectedChipId);
    if (!chip) { await loadChips(); $('#eaGpuMessage').textContent = 'Selected chip not found. Choose it again.'; return; }

    const { total, fanCount } = computeGpuValues();
    const listedPrice = Math.max(1, Number($('#eaGpuPrice').value) || 1);
    const gpuConfig = {
      length: gpuLength,
      width: gpuWidth,
      thickness: gpuThickness,
      body: gpuBody,
      finish: gpuFinish,
      shroud: gpuShroud,
      primaryColor: gpuPrimary,
      accentColor: gpuAccent,
      backplate: gpuBackplateStyle !== 'off',
      backplateStyle: gpuBackplateStyle,
      finStyle: gpuFinStyle,
      pipeStyle: gpuPipeStyle,
      powerType: gpuPowerType,
      ioStyle: gpuIoStyle,
      elements: gpuElements
    };
    let snapshot = window.GpuDesigner3D?.captureSnapshot?.({ width: 360, height: 270 }) || '';
    if (!snapshot && typeof window.GpuDesigner3D?.captureHeroSnapshot === 'function') {
      snapshot = await window.GpuDesigner3D.captureHeroSnapshot(gpuConfig, 360, 270);
    }
    const wasEditingId = editingGpuProductId;
    const oldName = editingGpuOldName;

    const designData = {
      chip_id: chip.id,
      chip_name: chip.chip_name,
      chip_vram: chip.vram_level || 'none',
      length: gpuLength,
      width: gpuWidth,
      thickness: gpuThickness,
      body: gpuBody,
      finish: gpuFinish,
      shroud: gpuShroud,
      primary_color: gpuPrimary,
      accent_color: gpuAccent,
      backplate: gpuBackplateStyle !== 'off',
      backplate_style: gpuBackplateStyle,
      fin_style: gpuFinStyle,
      pipe_style: gpuPipeStyle,
      power_type: gpuPowerType,
      io_style: gpuIoStyle,
      rgb: hasRgb,
      fan_count: fanCount,
      fan_positions: fans.map(f => ({ position: f.position, type: f.fanType })),
      elements: gpuElements,
      thumbnail: snapshot || ''
    };

    const saveBtn = $('#eaGpuSave');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = wasEditingId ? 'Saving edits…' : 'Saving…'; }

    let data = null;
    let error = null;

    // 1) Try SECURITY DEFINER RPC first (matches finish_cpu_product security model)
    const rpcRes = await sb.rpc('save_gpu_product_draft', {
      p_product_id: wasEditingId || null,
      p_company_id: currentCompany.id,
      p_product_name: name,
      p_body_type: gpuBody,
      p_production_cost: total,
      p_product_value: total,
      p_listed_price: listedPrice,
      p_design_data: designData
    });

    if (!rpcRes.error) {
      data = rpcRes.data;
    } else if (rpcRes.error.code === 'PGRST202' || /could not find the function/i.test(rpcRes.error.message || '')) {
      // 2) Fallback to direct table insert/update when direct RLS grants are enabled
      if (wasEditingId) {
        const res = await sb
          .from('product_company_products')
          .update({
            product_name: name,
            body_type: gpuBody,
            production_cost: total,
            product_value: total,
            listed_price: listedPrice,
            design_data: designData
          })
          .eq('id', wasEditingId)
          .eq('owner_id', currentUser.id)
          .eq('status', 'draft')
          .select('id,product_name')
          .single();
        data = res.data;
        error = res.error;
      } else {
        const res = await sb.from('product_company_products').insert({
          company_id: currentCompany.id,
          owner_id: currentUser.id,
          product_line: 'gpu',
          product_name: name,
          body_type: gpuBody,
          production_cost: total,
          product_value: total,
          listed_price: listedPrice,
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
      const msg = /permission denied/i.test(error.message || '')
        ? 'Could not save GPU draft: missing Supabase write permission/RPC on product_company_products. Run the SQL migration to enable GPU saves.'
        : 'Could not save GPU draft: ' + error.message;
      $('#eaGpuMessage').textContent = msg;
      syncGpuSaveButtonUI();
      return;
    }

    const savedId = data?.id || wasEditingId;
    if (oldName && oldName !== name) clearGpuThumb('name:' + oldName);
    if (snapshot) {
      if (savedId) saveGpuThumb(savedId, snapshot);
      saveGpuThumb('name:' + name, snapshot);
      if (savedId) applyGpuThumbToDom(savedId, name, snapshot);
    } else if (savedId) {
      clearGpuThumb(savedId);
    }

    editingGpuProductId = null;
    editingGpuOldName = '';
    if (savedId) {
      selectedCompanyProductId = savedId;
      selectedGpuPageProductId = savedId;
    }
    syncGpuSaveButtonUI();
    $('#eaGpuMessage').textContent = wasEditingId
      ? 'GPU draft updated with a new snapshot!'
      : 'GPU saved as a draft! Publish it from Products.';
    toast(wasEditingId ? 'GPU draft updated with a new picture!' : 'GPU draft saved.');
    await loadCompanyResearchAndProducts();
    renderGpuProducts();
    if (typeof renderCompanyProducts === 'function') renderCompanyProducts();
    const detailBox = $('#companyProductDetails');
    if (detailBox && savedId && typeof loadCompanyProductDetails === 'function') {
      delete detailBox.dataset.productId;
      loadCompanyProductDetails(savedId);
    }
  }

  // ---------- Product Feed Hook ----------
  const originalPublishedFeed = window.loadPublishedProductFeed;
  window.loadPublishedProductFeed = async function () {
    await originalPublishedFeed?.();
    const grid = $('#publishedProductFeed');
    if (!grid) return;
    if (!sb) return;
    const { data, error } = await sb
      .from('product_company_products')
      .select('id,product_name,product_line,body_type,design_data,listed_price,product_value')
      .eq('status', 'published')
      .eq('product_line', 'gpu')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error || !data?.length) return;
    const byId = new Map();
    data.forEach(p => {
      byId.set(p.id, p);
      const gpuNode = grid.querySelector('[data-gpu-thumb-id="' + CSS.escape(p.id) + '"]');
      const cpuNode = grid.querySelector('[data-cpu-thumb-id="' + CSS.escape(p.id) + '"]');
      const card = (gpuNode || cpuNode)?.closest('.published-product-card')
        || [...grid.querySelectorAll('.published-product-card')].find(x => x.querySelector('h4')?.textContent === p.product_name);
      if (!card) return;
      const visual = gpuNode || cpuNode || card.querySelector('.product-feed-gpu, .product-feed-cpu');
      if (visual && !visual.querySelector('img')) {
        visual.removeAttribute('data-cpu-thumb-id');
        visual.setAttribute('data-gpu-thumb-id', p.id);
        visual.className = 'product-feed-gpu';
        visual.innerHTML = renderGpuThumbHtml(p);
      }
      const pTags = card.querySelectorAll('p');
      if (pTags[1]) pTags[1].textContent = formatGpuSpecLine(p);
    });
    hydrateGpuThumbElements(grid, byId, 360, 270);
  };

  // ---------- App Integration Hooks ----------
  const originalLoad = window.loadCompanyDashboard;
  window.loadCompanyDashboard = async function () {
    if (!currentUser || !sb) return;
    await refreshCompanies();
    const { data: invites } = await sb
      .from('product_company_transfers')
      .select('id,company_id,sender_id,created_at,product_companies(company_name,logo_data_url)')
      .eq('recipient_id', currentUser.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(10);
    incomingCompanyTransfers = invites || [];
    renderCompanyIncomingTransfers?.();
    renderChooser();
    if (currentCompany) {
      if (loadedResearchCompanyId !== currentCompany.id) {
        await loadCompanyResearchAndProducts();
        loadedResearchCompanyId = currentCompany.id;
      }
      if (typeof renderCompanyDashboard === 'function') renderCompanyDashboard();
      if (isGpu()) {
        mountGpuWorkspace();
        mountGpuResearch();
        mountGpuProductsPage();
        renderGpuProducts();
      }
    }
  };

  const oldRender = window.renderCompanyDashboard;
  window.renderCompanyDashboard = function () {
    oldRender?.();
    renderChooser();
    if (!currentCompany) return;
    const badge = $('.company-cpu-chip');
    if (badge) badge.textContent = isGpu() ? 'GPU MANUFACTURER' : 'CPU MANUFACTURER';
    addBackButton();
    if (isGpu()) {
      mountGpuWorkspace();
      mountGpuResearch();
      mountGpuProductsPage();
      renderGpuProducts();
      $('#eaCompanyResearch')?.classList.remove('hidden');
      $('#cpuResearchTree')?.classList.add('hidden');
    } else {
      hideGpuWorkspace();
    }
    syncCompanyDesignMode();
  };

  const oldShow = window.showPage;
  window.showPage = function (page) {
    if ((page === 'company-design' || page === 'company-products') && !currentCompany) {
      const savedId = localStorage.getItem('grind_active_company_id');
      if (savedId && currentUser && sb && !restoringActiveCompany) {
        restoringActiveCompany = true;
        refreshCompanies().finally(() => {
          restoringActiveCompany = false;
          if (currentCompany) window.showPage(page);
          else oldShow?.('company');
        });
        return;
      }
      oldShow?.('company');
      return;
    }
    oldShow?.(page);
    if (page === 'company') renderChooser();
    if (page === 'company-design') {
      if (isGpu()) {
        mountGpuWorkspace();
        showGpuMain();
      } else {
        hideGpuWorkspace();
        $('#page-company-design #companyDesignNoCompany')?.classList.toggle('hidden', !!currentCompany);
        $('#page-company-design #cpuDesigner')?.classList.toggle('hidden', !currentCompany);
      }
    }
    if (page === 'company-products' && isGpu()) {
      mountGpuProductsPage();
      renderGpuProducts();
    }
  };

  function startAuthReadySync() {
    let attempts = 0;
    const poll = setInterval(() => {
      attempts++;
      if (currentUser && sb) {
        clearInterval(poll);
        if (companiesLoadedForUserId !== currentUser.id) {
          refreshCompanies().then(() => {
            if (currentCompany && currentPage === 'company') renderCompanyDashboard();
            else if (currentCompany && currentPage === 'company-design') syncCompanyDesignMode();
            else if (currentCompany && currentPage === 'company-products' && isGpu()) { mountGpuProductsPage(); renderGpuProducts(); }
          });
        }
      } else if (attempts >= 60) {
        clearInterval(poll);
      }
    }, 250);
  }

  document.addEventListener('DOMContentLoaded', () => {
    refreshCompanies();
    startAuthReadySync();
  });

  if (sb?.auth?.onAuthStateChange) {
    sb.auth.onAuthStateChange(() => {
      setTimeout(() => {
        refreshCompanies();
        startAuthReadySync();
      }, 100);
    });
  }
})();