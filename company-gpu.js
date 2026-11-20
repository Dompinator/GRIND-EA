/* GRIND-EA multi-company + GPU / CHIP workspace */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let companies = [];
  let companiesLoadedForUserId = null;
  let loadedResearchCompanyId = null;
  let activeGpuView = 'design';
  let activeMenuTab = 'body'; // 'body' | 'chip' | 'elements'
  let chips = [];
  let selectedChipId = '';
  let nextElemSeq = 3;

  // Modular GPU build state (no forced company name/logo; added via Add Element)
  let gpuLength = 300;
  let gpuWidth = 125;
  let gpuBody = 'plastic';
  let gpuShroud = 'rounded';
  let gpuAccent = '#a855f7';
  let gpuBackplate = true;
  let gpuElements = [
    { id: 'el_fan_1', kind: 'fan', fanType: 'basic', position: 0.28, size: 1.0 },
    { id: 'el_fan_2', kind: 'fan', fanType: 'basic', position: 0.72, size: 1.0 }
  ];

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
    { key: 'chip_super_powerful', name: 'Super Powerful', cost: 6800, value: 2800, score: 48, group: 'CHIP', pre: 'chip_strong_power' }
  ];

  const ACCENT_PRESETS = ['#a855f7', '#38bdf8', '#ef4444', '#10b981', '#f59e0b', '#cbd5e1'];

  const isGpu = () => !!(currentCompany?.product_lines || []).includes('gpu');
  const researched = k => k === 'basic' || k === 'plastic' || (companyResearchRows || []).some(x => x.research_key === k);
  const researchName = k => GPU_RESEARCH.find(r => r.key === k)?.name || (k === 'none' ? 'Base' : k === 'basic' ? 'Basic Fan' : k);

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
    const map = getGpuThumbsMap();
    return map[p?.id]?.dataUrl || map['name:' + (p?.product_name || '')]?.dataUrl || '';
  }

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
    gpuBody = 'plastic';
    gpuShroud = 'rounded';
    gpuAccent = '#a855f7';
    gpuBackplate = true;
    gpuElements = [
      { id: 'el_fan_1', kind: 'fan', fanType: 'basic', position: 0.28, size: 1.0 },
      { id: 'el_fan_2', kind: 'fan', fanType: 'basic', position: 0.72, size: 1.0 }
    ];
    selectedChipId = '';
    const msgEl = $('#eaGpuMessage');
    if (msgEl) msgEl.textContent = '';
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
    ['body', 'chip', 'elements'].forEach(t => {
      const el = $('#eaGpuMenu_' + t);
      if (el) el.classList.toggle('hidden', t !== tab);
    });
  }

  function goToGpuResearch() {
    showPage('company');
    if (typeof switchCompanyDashboardTab === 'function') switchCompanyDashboardTab('research');
  }

  function renderBodyTab() {
    const wrap = $('#eaGpuMenu_body');
    if (!wrap) return;
    if ((gpuBody === 'metallic' && !researched('gpu_metallic_body')) || (gpuBody === 'carbon' && !researched('gpu_carbon_body'))) {
      gpuBody = 'plastic';
    }

    const bodyDefs = [
      { id: 'plastic', key: 'plastic', name: 'Plastic Body', desc: 'Free · Standard matte shell' },
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

    const shroudPills = ['rounded', 'angular', 'compact'].map(s =>
      '<button type="button" class="zoom-btn' + (gpuShroud === s ? ' active' : '') + '" data-gpu-shroud="' + s + '">' + s[0].toUpperCase() + s.slice(1) + '</button>'
    ).join('');

    const swatches = ACCENT_PRESETS.map(hex =>
      '<button type="button" class="ea-swatch-btn' + (gpuAccent.toLowerCase() === hex ? ' active' : '') + '" data-accent-hex="' + hex + '" style="background:' + hex + '"></button>'
    ).join('');

    wrap.innerHTML =
      '<h4>Body Material</h4>' + bodyCards +
      '<h4 style="margin-top:12px">Shroud Style &amp; Finish</h4>' +
      '<div class="ea-gpu-inline-box"><span>Shroud shape</span><div class="ea-gpu-pill-row">' + shroudPills + '</div></div>' +
      '<div class="ea-gpu-inline-box"><span>Accent color</span><div class="ea-gpu-swatches">' + swatches + '<input id="eaGpuAccent" type="color" value="' + esc(gpuAccent) + '"></div></div>' +
      '<div class="cpu-component-option ' + (gpuBackplate ? 'selected' : '') + '">' +
        '<span class="cpu-component-icon">▤</span>' +
        '<span><strong>Ventilated Backplate</strong><small>Flow-through backplate shield</small></span>' +
        '<button type="button" class="zoom-btn" data-gpu-toggle-backplate="1">' + (gpuBackplate ? 'On' : 'Off') + '</button>' +
      '</div>';

    wrap.querySelectorAll('[data-gpu-body]').forEach(btn => btn.addEventListener('click', () => {
      gpuBody = btn.dataset.gpuBody;
      renderBodyTab();
      drawGpu();
    }));
    wrap.querySelectorAll('[data-gpu-go-research]').forEach(btn => btn.addEventListener('click', goToGpuResearch));
    wrap.querySelectorAll('[data-gpu-shroud]').forEach(btn => btn.addEventListener('click', () => {
      gpuShroud = btn.dataset.gpuShroud;
      renderBodyTab();
      drawGpu();
    }));
    wrap.querySelectorAll('[data-accent-hex]').forEach(btn => btn.addEventListener('click', () => {
      gpuAccent = btn.dataset.accentHex;
      renderBodyTab();
      drawGpu();
    }));
    wrap.querySelector('#eaGpuAccent')?.addEventListener('input', e => {
      gpuAccent = e.target.value;
      drawGpu();
    });
    wrap.querySelector('[data-gpu-toggle-backplate]')?.addEventListener('click', () => {
      gpuBackplate = !gpuBackplate;
      renderBodyTab();
      drawGpu();
    });
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
            '<span><strong>' + esc(c.chip_name) + '</strong><small>' + esc(researchName(c.speed_level)) + ' · ' + esc(researchName(c.power_level)) + '</small></span>' +
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
      { id: 'text', key: 'basic', icon: 'Aa', name: 'Text Label', desc: 'Custom printed label on shroud or backplate' },
      { id: 'logo', key: 'basic', icon: '◆', name: 'Logo Badge', desc: 'Company logo or uploaded badge graphic' },
      { id: 'rgb_strip', key: 'gpu_rgb', icon: '✦', name: 'RGB Light Strip', desc: '12 Score · $480 · Illuminated LED rails' }
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
        gpuElements.push({ id: 'el_' + (++nextElemSeq), kind: 'fan', fanType, position: 0.5, size: 1.0 });
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
          size: 1.1
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
      } else if (kindSpec === 'rgb_strip') {
        if (!researched('gpu_rgb')) { toast('Research RGB first.'); return; }
        gpuElements.push({
          id: 'el_' + (++nextElemSeq),
          kind: 'rgb_strip',
          color: gpuAccent || '#a855f7',
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
    // Remove unresearched items safely if switched company
    gpuElements = gpuElements.filter(el => {
      if (el.kind === 'fan' && !researched(el.fanType)) el.fanType = 'basic';
      if (el.kind === 'rgb_strip' && !researched('gpu_rgb')) return false;
      return true;
    });

    if (!gpuElements.length) {
      wrap.innerHTML = '<p class="muted tiny">No elements on the GPU yet. Add fans, text labels, or logos from the <b>Add Element</b> tab above.</p>';
      return;
    }

    const placementOptionsHtml = selected => {
      const opts = [
        ['side', 'Side View (Front · NVIDIA)'],
        ['rear', 'Side View (Power Edge)'],
        ['both_sides', 'Both Sides'],
        ['top', 'Top (Fan Side)'],
        ['back', 'Backplate (Bottom)'],
        ['right', 'End Cap (Right)'],
        ['left', 'I/O Side (Left)']
      ];
      return opts.map(([val, label]) =>
        '<option value="' + val + '"' + (selected === val ? ' selected' : '') + '>' + label + '</option>'
      ).join('');
    };

    let fanNum = 0;
    wrap.innerHTML = gpuElements.map(el => {
      if (el.kind === 'fan') {
        fanNum++;
        return '<div class="ea-elem-card" data-elem-id="' + el.id + '">' +
          '<div class="ea-elem-head"><strong>Fan ' + fanNum + ' · ' + esc(researchName(el.fanType)) + '</strong>' +
          '<button type="button" class="ea-elem-del" data-remove-elem="' + el.id + '" title="Remove">✕</button></div>' +
          '<div class="ea-elem-row">' +
            '<label>Position <b>' + Math.round((el.position || 0.5) * 100) + '%</b><input type="range" min="10" max="90" value="' + Math.round((el.position || 0.5) * 100) + '" data-elem-pos="' + el.id + '"></label>' +
            '<label>Diameter <b>' + Math.round((el.size || 1) * 100) + '%</b><input type="range" min="68" max="122" value="' + Math.round((el.size || 1) * 100) + '" data-elem-size="' + el.id + '"></label>' +
          '</div></div>';
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
          '</div></div>';
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
      if (el.kind === 'rgb_strip') {
        return '<div class="ea-elem-card" data-elem-id="' + el.id + '">' +
          '<div class="ea-elem-head"><strong>RGB Light Strip</strong>' +
          '<button type="button" class="ea-elem-del" data-remove-elem="' + el.id + '" title="Remove">✕</button></div>' +
          '<div class="ea-elem-grid">' +
            '<input type="color" value="' + esc(el.color || '#a855f7') + '" data-elem-color="' + el.id + '" title="Glow color">' +
            '<select data-elem-place="' + el.id + '">' +
              '<option value="side"' + (el.placement === 'side' ? ' selected' : '') + '>Side Rails</option>' +
              '<option value="top"' + (el.placement === 'top' ? ' selected' : '') + '>Top Trim</option>' +
              '<option value="halo"' + (el.placement === 'halo' ? ' selected' : '') + '>Full Halo</option>' +
            '</select>' +
          '</div></div>';
      }
      return '';
    }).join('');

    wrap.querySelectorAll('[data-remove-elem]').forEach(btn => btn.addEventListener('click', () => {
      gpuElements = gpuElements.filter(x => x.id !== btn.dataset.removeElem);
      renderAddElementTab();
      renderPlacedElementsManager();
      drawGpu();
    }));

    wrap.querySelectorAll('[data-elem-pos]').forEach(inp => inp.addEventListener('input', () => {
      const target = gpuElements.find(x => x.id === inp.dataset.elemPos);
      if (target) {
        target.position = Number(inp.value) / 100;
        const b = inp.parentElement?.querySelector('b');
        if (b) b.textContent = inp.value + '%';
        drawGpu();
      }
    }));

    wrap.querySelectorAll('[data-elem-zpos]').forEach(inp => inp.addEventListener('input', () => {
      const target = gpuElements.find(x => x.id === inp.dataset.elemZpos);
      if (target) {
        target.zPosition = Number(inp.value) / 100;
        const b = inp.parentElement?.querySelector('b');
        if (b) b.textContent = inp.value + '%';
        drawGpu();
      }
    }));

    wrap.querySelectorAll('[data-elem-size]').forEach(inp => inp.addEventListener('input', () => {
      const target = gpuElements.find(x => x.id === inp.dataset.elemSize);
      if (target) {
        target.size = Number(inp.value) / 100;
        const b = inp.parentElement?.querySelector('b');
        if (b) b.textContent = inp.value + '%';
        drawGpu();
      }
    }));

    wrap.querySelectorAll('[data-elem-text]').forEach(inp => inp.addEventListener('input', () => {
      const target = gpuElements.find(x => x.id === inp.dataset.elemText);
      if (target) { target.text = inp.value; drawGpu(); }
    }));

    wrap.querySelectorAll('[data-elem-color]').forEach(inp => inp.addEventListener('input', () => {
      const target = gpuElements.find(x => x.id === inp.dataset.elemColor);
      if (target) { target.color = inp.value; drawGpu(); }
    }));

    wrap.querySelectorAll('[data-elem-place]').forEach(sel => sel.addEventListener('change', () => {
      const target = gpuElements.find(x => x.id === sel.dataset.elemPlace);
      if (!target) return;
      target.placement = sel.value;
      if (target.kind === 'text' || target.kind === 'logo') {
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
                '<button type="button" data-gpu-menu="chip">Chip</button>' +
                '<button type="button" data-gpu-menu="elements">Add Element</button>' +
              '</div>' +
              '<div id="eaGpuMenu_body" class="cpu-menu-content"></div>' +
              '<div id="eaGpuMenu_chip" class="cpu-menu-content hidden"></div>' +
              '<div id="eaGpuMenu_elements" class="cpu-menu-content hidden"></div>' +
              '<div class="ea-placed-section">' +
                '<div class="ea-placed-head"><h4>Placed Elements</h4><button type="button" id="eaGpuSpaceFans" class="zoom-btn">Space Fans</button></div>' +
                '<div id="eaGpuPlacedList" class="ea-placed-list"></div>' +
              '</div>' +
              '<div class="cpu-design-summary">' +
                '<div><span>Estimated Value</span><strong id="eaGpuEstValue">$0</strong></div>' +
                '<div><span>Card Size</span><strong id="eaGpuSizeReadout">300 × 125 mm</strong></div>' +
              '</div>' +
              '<label class="cpu-design-label">GPU name<input id="eaGpuName" maxlength="48" value="New Graphics Card"></label>' +
              '<label class="cpu-design-label">Starting price ($)<input id="eaGpuPrice" type="number" min="1" step="1" value="1200"></label>' +
              '<button class="primary-btn full" id="eaGpuSave" type="button">Save as draft</button>' +
              '<p id="eaGpuMessage" class="form-message"></p>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div id="eaGpuChips" class="ea-gpu-view hidden">' +
          '<div class="ea-chip-layout">' +
            '<div><h4>GPU Chip Designer</h4><p class="muted">First create your GPU silicon chip, then select it inside the GPU Designer.</p><div class="ea-chip-preview"><span id="eaChipPreviewName">NOVA</span></div></div>' +
            '<div class="ea-gpu-controls">' +
              '<label>Chip name<input id="eaChipName" maxlength="40" value="Nova GPU Chip"></label>' +
              '<label>Speed<select id="eaChipSpeed"></select></label>' +
              '<label>Power<select id="eaChipPower"></select></label>' +
              '<div class="ea-vram"><b>VRAM</b><small>Reserved section. Research upgrades will be added later.</small></div>' +
              '<button class="primary-btn" id="eaSaveChip" type="button">Save chip</button>' +
              '<p id="eaChipMessage" class="form-message"></p>' +
            '</div>' +
          '</div>' +
          '<div id="eaSavedChips" class="ea-saved-chips"></div>' +
        '</div>';
      dash.appendChild(panel);

      panel.querySelectorAll('[data-gpu-tab]').forEach(b => b.addEventListener('click', () => setGpuTab(b.dataset.gpuTab)));
      panel.querySelectorAll('[data-gpu-menu]').forEach(b => b.addEventListener('click', () => setMenuTab(b.dataset.gpuMenu)));
      $('#eaGpuSpaceFans')?.addEventListener('click', () => {
        spaceFansEvenly();
        renderPlacedElementsManager();
        drawGpu();
      });
      $('#eaGpuSizeBtn')?.addEventListener('click', () => {
        const active = !$('#eaGpuSizeBtn').classList.contains('active');
        window.GpuDesigner3D?.setSizeMode?.(active);
      });
      $('#eaChipName')?.addEventListener('input', () => {
        const prev = $('#eaChipPreviewName');
        if (prev) prev.textContent = ($('#eaChipName').value || 'CHIP').slice(0, 14).toUpperCase();
      });
      $('#eaSaveChip')?.addEventListener('click', saveChip);
      $('#eaGpuSave')?.addEventListener('click', saveGpu);
    }

    setMenuTab(activeMenuTab);
    renderBodyTab();
    renderChipTab();
    renderAddElementTab();
    renderPlacedElementsManager();
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
        '<div id="eaGpuResearchTree" class="research-tree"><div id="eaGpuResearchWorld" class="research-tree-world"></div><div class="research-tree-controls"><button type="button" data-ea-zoom="out">−</button><button type="button" data-ea-zoom="reset">Reset</button><button type="button" data-ea-zoom="in">+</button></div></div>' +
        '<div id="eaChipResearchTree" class="research-tree hidden"><div id="eaChipResearchWorld" class="research-tree-world"></div><div class="research-tree-controls"><button type="button" data-ea-zoom="out">−</button><button type="button" data-ea-zoom="reset">Reset</button><button type="button" data-ea-zoom="in">+</button></div></div>' +
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
      '<div class="section-head"><div><div class="eyebrow purple-text">GPU MANUFACTURING</div><h3>Products</h3><p class="muted">Your GPU designs, drafts and published products.</p></div></div>' +
      '<div id="eaGpuProductList" class="ea-saved-chips"></div>';
  }

  function restoreCpuProductsPage() {
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
          gpuLength = Math.round(sz.length || 300);
          gpuWidth = Math.round(sz.width || 125);
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
    requestAnimationFrame(() => window.GpuDesigner3D?.resize?.());
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
    if (activeGpuView === 'chips') loadChips();
    else requestAnimationFrame(() => window.GpuDesigner3D?.resize?.());
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
    const build = (group, worldId) => {
      const world = $('#' + worldId);
      if (!world) return;
      const defs = GPU_RESEARCH.filter(r => r.group === group);
      const coords = group === 'GPU'
        ? [[560, 130], [280, 410], [280, 700], [560, 410], [840, 410], [840, 700], [840, 990]]
        : [[560, 130], [300, 390], [300, 650], [300, 910], [300, 1170], [300, 1430], [300, 1690], [820, 390], [820, 650], [820, 910], [820, 1170]];
      const icons = group === 'GPU' ? ['GPU', 'MB', 'CF', 'RGB', 'SF', 'MF', 'AF'] : ['CHIP', '1×', '2×', '3×', '4×', '6×', '8×', 'P1', 'P2', 'P3', 'P4'];
      const width = 1120, height = group === 'GPU' ? 1250 : 1900;
      const edges = group === 'GPU' ? [[0, 1], [1, 2], [0, 3], [0, 4], [4, 5], [5, 6]] : [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [0, 7], [7, 8], [8, 9], [9, 10]];
      const paths = edges.map(([a, b]) => {
        const A = coords[a], B = coords[b], mid = (A[1] + B[1]) / 2;
        return '<path d="M' + A[0] + ' ' + (A[1] + 65) + ' L' + A[0] + ' ' + mid + ' L' + B[0] + ' ' + mid + ' L' + B[0] + ' ' + (B[1] - 65) + '"/>';
      }).join('');
      world.style.width = width + 'px';
      world.style.height = height + 'px';
      world.innerHTML =
        '<svg class="research-tree-lines" viewBox="0 0 ' + width + ' ' + height + '">' + paths + '</svg>' +
        researchNodeMarkup({ name: group === 'GPU' ? 'Baseline GPU' : 'Baseline CHIP', cost: 0, score: 0, key: 'baseline_' + group.toLowerCase() }, 560, 130, group === 'GPU' ? 'GPU' : 'CHIP', true, false) +
        defs.map((r, i) => {
          const xy = coords[i + 1], yes = researched(r.key), locked = !!(r.pre && !researched(r.pre));
          return researchNodeMarkup(r, xy[0], xy[1], icons[i + 1] || 'UP', yes, locked);
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
    let zoom = 0.72, panX = (tree.clientWidth || 720) / 2 - 560 * zoom, panY = 12, dragging = false, sx = 0, sy = 0, bx = 0, by = 0;
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
      if (a === 'reset') { zoom = 0.72; panX = (tree.clientWidth || 720) / 2 - 560 * zoom; panY = 12; }
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
    renderAddElementTab();
    renderPlacedElementsManager();
    drawGpu();
    updateUIProfile?.();
    toast('Research unlocked!');
  }

  // ---------- CHIP Tab ----------
  function optionsFor(kind, keys) {
    const el = $(kind);
    if (!el) return;
    const defs = GPU_RESEARCH.filter(x => keys.includes(x.key));
    el.innerHTML = '<option value="none">Base ' + (kind === '#eaChipSpeed' ? 'speed' : 'power') + '</option>' +
      defs.map(r => '<option value="' + r.key + '" ' + (!researched(r.key) ? 'disabled' : '') + '>' + r.name + (researched(r.key) ? '' : ' · Research locked') + '</option>').join('');
  }

  async function saveChip() {
    const name = $('#eaChipName').value.trim();
    const speed = $('#eaChipSpeed').value;
    const power = $('#eaChipPower').value;
    if (name.length < 2) { $('#eaChipMessage').textContent = 'Chip name must be at least 2 characters.'; return; }
    const { error } = await sb.from('product_company_gpu_chips').insert({
      company_id: currentCompany.id,
      owner_id: currentUser.id,
      chip_name: name,
      speed_level: speed,
      power_level: power,
      vram_level: 'none'
    });
    $('#eaChipMessage').textContent = error ? 'Could not save chip: ' + error.message : 'Chip saved! Pick it under the Chip tab in GPU Design.';
    if (!error) {
      toast('Chip saved.');
      await loadChips();
    }
  }

  async function loadChips() {
    if (!currentCompany) return;
    optionsFor('#eaChipSpeed', ['chip_ok_speed', 'chip_decent_speed', 'chip_good_speed', 'chip_fast_speed', 'chip_insane_speed', 'chip_super_speed']);
    optionsFor('#eaChipPower', ['chip_decent_power', 'chip_good_power', 'chip_strong_power', 'chip_super_powerful']);

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
        '<button type="button" class="ea-chip-card" data-chip-select="' + esc(c.id) + '"><span>▦</span><b>' + esc(c.chip_name) + '</b><small>' + esc(researchName(c.speed_level)) + ' · ' + esc(researchName(c.power_level)) + '</small></button>'
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
    const hasRgb = gpuElements.some(e => e.kind === 'rgb_strip');
    const rgbValue = hasRgb ? 480 : 0;
    return { bodyValue, fanValue, rgbValue, total: bodyValue + fanValue + rgbValue, fanCount: fans.length, hasRgb };
  }

  function updateCostAndReadouts() {
    const { bodyValue, fanValue, rgbValue, total, fanCount } = computeGpuValues();
    if ($('#eaGpuEstValue')) $('#eaGpuEstValue').textContent = '$' + total.toLocaleString();
    if ($('#eaGpuSizeReadout')) $('#eaGpuSizeReadout').textContent = gpuLength + ' × ' + gpuWidth + ' mm';
    if ($('#eaGpuCost')) {
      $('#eaGpuCost').textContent =
        (gpuBody === 'carbon' ? 'Carbon' : gpuBody === 'metallic' ? 'Metallic' : 'Plastic') +
        ' · ' + fanCount + ' Fan' + (fanCount === 1 ? '' : 's') +
        ' · Value $' + total.toLocaleString() +
        ' (Body $' + bodyValue.toLocaleString() + ' + Fans $' + fanValue.toLocaleString() + ' + RGB $' + rgbValue.toLocaleString() + ')';
    }
  }

  function drawGpu() {
    window.GpuDesigner3D?.update({
      length: gpuLength,
      width: gpuWidth,
      thickness: 52,
      body: gpuBody,
      shroud: gpuShroud,
      accentColor: gpuAccent,
      backplate: gpuBackplate,
      elements: gpuElements.map(e => ({ ...e }))
    });
    updateCostAndReadouts();
  }

  function renderGpuProducts() {
    const el = $('#eaGpuProductList');
    if (!el) return;
    const rows = (companyProducts || []).filter(p => p.product_line === 'gpu');
    if (!rows.length) { el.textContent = 'No GPU products yet. Create one in GPU Design.'; return; }
    el.innerHTML = '';
    rows.forEach(p => {
      const card = document.createElement('article');
      card.className = 'ea-chip-card ea-gpu-product-card';
      const thumbUrl = getGpuThumb(p);
      if (thumbUrl) {
        const img = document.createElement('img');
        img.src = thumbUrl;
        img.alt = p.product_name || 'GPU';
        img.className = 'ea-gpu-product-thumb';
        card.appendChild(img);
      }
      const title = document.createElement('b');
      title.textContent = p.product_name;
      const spec = document.createElement('small');
      const d = p.design_data || {};
      spec.textContent = (d.chip_name || 'Chip') + ' · ' + (d.body || 'plastic').toUpperCase() + ' · ' + Number(d.fan_count || 0) + ' Fans';
      const status = document.createElement('small');
      status.textContent = (p.status === 'published' ? 'Published' : 'Draft') + ' · Value $' + Number(p.product_value || 0).toLocaleString();
      const price = document.createElement('input');
      price.type = 'number';
      price.min = '1';
      price.value = String(p.listed_price || 1);
      const label = document.createElement('label');
      label.textContent = 'Listing price ($)';
      label.appendChild(price);
      card.append(title, spec, status, label);
      if (p.status === 'draft') {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'primary-btn';
        button.textContent = 'Publish product';
        button.addEventListener('click', async () => {
          const amount = Number(price.value);
          if (amount <= 0) { toast('Enter a valid listing price.'); return; }
          const result = await sb.rpc('update_cpu_product_listing', { p_product_id: p.id, p_listed_price: amount, p_publish: true });
          if (result.error) { toast(result.error.message); return; }
          await loadCompanyResearchAndProducts();
          renderGpuProducts();
          toast('GPU published to Product Feed!');
        });
        card.appendChild(button);
      }
      el.appendChild(card);
    });
  }

  async function saveGpu() {
    const name = $('#eaGpuName').value.trim();
    if (name.length < 2 || !selectedChipId) {
      $('#eaGpuMessage').textContent = !selectedChipId ? 'Select a saved chip in the Chip tab first.' : 'Enter a GPU name (at least 2 characters).';
      if (!selectedChipId) setMenuTab('chip');
      return;
    }
    const fans = gpuElements.filter(e => e.kind === 'fan');
    const hasRgb = gpuElements.some(e => e.kind === 'rgb_strip');
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
    const snapshot = window.GpuDesigner3D?.captureSnapshot?.() || '';

    const { data, error } = await sb.from('product_company_products').insert({
      company_id: currentCompany.id,
      owner_id: currentUser.id,
      product_line: 'gpu',
      product_name: name,
      body_type: gpuBody,
      production_cost: total,
      product_value: total,
      listed_price: Math.max(1, Number($('#eaGpuPrice').value) || 1),
      status: 'draft',
      design_data: {
        chip_id: chip.id,
        chip_name: chip.chip_name,
        length: gpuLength,
        width: gpuWidth,
        body: gpuBody,
        shroud: gpuShroud,
        accent_color: gpuAccent,
        backplate: gpuBackplate,
        rgb: hasRgb,
        fan_count: fanCount,
        fan_positions: fans.map(f => ({ position: f.position, type: f.fanType })),
        elements: gpuElements
      }
    }).select('id,product_name').single();

    $('#eaGpuMessage').textContent = error ? 'Could not save GPU draft: ' + error.message : 'GPU saved as a draft! Publish it from Products.';
    if (!error) {
      if (snapshot) {
        if (data?.id) saveGpuThumb(data.id, snapshot);
        saveGpuThumb('name:' + name, snapshot);
      }
      toast('GPU draft saved.');
      await loadCompanyResearchAndProducts();
      renderGpuProducts();
    }
  }

  // ---------- Product Feed Hook ----------
  const originalPublishedFeed = window.loadPublishedProductFeed;
  window.loadPublishedProductFeed = async function () {
    await originalPublishedFeed?.();
    if (!sb) return;
    const { data, error } = await sb
      .from('product_company_products')
      .select('id,product_name,design_data,listed_price,product_value')
      .eq('status', 'published')
      .eq('product_line', 'gpu')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error || !data?.length) return;
    const grid = $('#publishedProductFeed');
    if (!grid) return;
    data.forEach(p => {
      const thumbNode = grid.querySelector('[data-cpu-thumb-id="' + CSS.escape(p.id) + '"]');
      const card = thumbNode?.closest('.published-product-card') || [...grid.querySelectorAll('.published-product-card')].find(x => x.querySelector('h4')?.textContent === p.product_name);
      if (!card) return;
      const visual = thumbNode || card.querySelector('.product-feed-cpu');
      const thumb = getGpuThumb(p);
      if (visual) {
        visual.removeAttribute('data-cpu-thumb-id');
        visual.className = 'product-feed-gpu';
        visual.innerHTML = thumb
          ? '<img src="' + esc(thumb) + '" alt="' + esc(p.product_name || 'GPU') + '" class="product-feed-gpu-thumb">'
          : '<span>▰</span><b>' + esc(p.product_name || 'GPU') + '</b><small>' + Number(p.design_data?.fan_count || 0) + ' FANS</small>';
      }
      const specs = card.querySelector('p');
      if (specs) specs.textContent = (p.design_data?.chip_name || 'GPU Chip') + ' · ' + Number(p.design_data?.length || 0) + ' mm · ' + Number(p.design_data?.width || 0) + ' mm';
    });
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