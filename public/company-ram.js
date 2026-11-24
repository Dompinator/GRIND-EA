/* ============================================================
 * GRIND-EA · RAM Manufacturing Company Workspace
 * Research Tree (Capacity Line + RGB + Custom Colors)
 * 3D RAM Stick Designer (1 Stick per Product) · Add Element
 * Products Management · Reusable Helpers for Feed, Preview, & PC Builder
 * ============================================================ */
(function () {
  'use strict';

  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const RAM_RESEARCH = [
    { key: 'ram_1gb', name: '1GB RAM', cost: 175, value: 90, score: 4, line: 'capacity', capKey: '1gb', gb: 1, desc: '1GB Single Stick (+90 Value · +4 Score)' },
    { key: 'ram_2gb', name: '2GB RAM', cost: 250, value: 150, score: 8, line: 'capacity', capKey: '2gb', gb: 2, pre: 'ram_1gb', desc: '2GB Single Stick (+150 Value · +8 Score)' },
    { key: 'ram_4gb', name: '4GB RAM', cost: 480, value: 240, score: 12, line: 'capacity', capKey: '4gb', gb: 4, pre: 'ram_2gb', desc: '4GB Single Stick (+240 Value · +12 Score)' },
    { key: 'ram_6gb', name: '6GB RAM', cost: 600, value: 460, score: 16, line: 'capacity', capKey: '6gb', gb: 6, pre: 'ram_4gb', desc: '6GB Single Stick (+460 Value · +16 Score)' },
    { key: 'ram_8gb', name: '8GB RAM', cost: 900, value: 630, score: 20, line: 'capacity', capKey: '8gb', gb: 8, pre: 'ram_6gb', desc: '8GB Single Stick (+630 Value · +20 Score)' },
    { key: 'ram_12gb', name: '12GB RAM', cost: 1800, value: 900, score: 26, line: 'capacity', capKey: '12gb', gb: 12, pre: 'ram_8gb', desc: '12GB Single Stick (+900 Value · +26 Score)' },
    { key: 'ram_16gb', name: '16GB RAM', cost: 3600, value: 1900, score: 32, line: 'capacity', capKey: '16gb', gb: 16, pre: 'ram_12gb', desc: '16GB Single Stick (+1,900 Value · +32 Score)' },
    { key: 'ram_24gb', name: '24GB RAM', cost: 6400, value: 3600, score: 42, line: 'capacity', capKey: '24gb', gb: 24, pre: 'ram_16gb', desc: '24GB Single Stick (+3,600 Value · +42 Score)' },
    { key: 'ram_32gb', name: '32GB RAM', cost: 8200, value: 4800, score: 48, line: 'capacity', capKey: '32gb', gb: 32, pre: 'ram_24gb', desc: '32GB Single Stick (+4,800 Value · +48 Score)' },
    { key: 'ram_64gb', name: '64GB RAM', cost: 10800, value: 6800, score: 64, line: 'capacity', capKey: '64gb', gb: 64, pre: 'ram_32gb', desc: '64GB Single Stick (+6,800 Value · +64 Score)' },
    { key: 'ram_rgb', name: 'RGB', cost: 800, value: 260, score: 6, line: 'rgb', desc: 'Unlocks RGB Lightbar & LED Text Glow (+260 Value · +6 Score)' },
    { key: 'ram_custom_colors', name: 'Custom Colors', cost: 180, value: 0, score: 0, line: 'colors', desc: 'Unlocks full custom color pickers for Heatspreader, Accent & PCB' }
  ];

  const CAPACITY_TIERS = [
    { key: '512mb', label: '512MB RAM (Starter)', short: '512MB', gb: 0.5, value: 45, score: 2, researchKey: null },
    { key: '1gb', label: '1GB RAM', short: '1GB', gb: 1, value: 90, score: 4, researchKey: 'ram_1gb' },
    { key: '2gb', label: '2GB RAM', short: '2GB', gb: 2, value: 150, score: 8, researchKey: 'ram_2gb' },
    { key: '4gb', label: '4GB RAM', short: '4GB', gb: 4, value: 240, score: 12, researchKey: 'ram_4gb' },
    { key: '6gb', label: '6GB RAM', short: '6GB', gb: 6, value: 460, score: 16, researchKey: 'ram_6gb' },
    { key: '8gb', label: '8GB RAM', short: '8GB', gb: 8, value: 630, score: 20, researchKey: 'ram_8gb' },
    { key: '12gb', label: '12GB RAM', short: '12GB', gb: 12, value: 900, score: 26, researchKey: 'ram_12gb' },
    { key: '16gb', label: '16GB RAM', short: '16GB', gb: 16, value: 1900, score: 32, researchKey: 'ram_16gb' },
    { key: '24gb', label: '24GB RAM', short: '24GB', gb: 24, value: 3600, score: 42, researchKey: 'ram_24gb' },
    { key: '32gb', label: '32GB RAM', short: '32GB', gb: 32, value: 4800, score: 48, researchKey: 'ram_32gb' },
    { key: '64gb', label: '64GB RAM', short: '64GB', gb: 64, value: 6800, score: 64, researchKey: 'ram_64gb' }
  ];

  const STOCK_PRIMARY_PRESETS = ['#1a1f2b', '#cbd5e1'];
  const CUSTOM_PRIMARY_PRESETS = ['#1a1f2b', '#0d1017', '#cbd5e1', '#f8fafc', '#2d1c42', '#172d44', '#401822', '#1c3329'];
  const STOCK_ACCENT_PRESETS = ['#64748b'];
  const CUSTOM_ACCENT_PRESETS = ['#a855f7', '#38bdf8', '#10b981', '#f59e0b', '#ef4444', '#e2e8f0'];
  const STOCK_PCB_PRESETS = ['#121620', '#0f241c'];
  const CUSTOM_PCB_PRESETS = ['#121620', '#0f241c', '#142238', '#2b1620', '#e5e9f2'];

  const RAM_THUMBS_LS_KEY = 'grind_ram_thumbs_v1';

  let activeMenuTab = 'capacity'; // 'capacity' | 'style' | 'elements'
  let ramCapacityKey = '512mb';
  let ramHeatspreader = 'angular'; // 'angular' | 'minimal' | 'ridged'
  let ramFinish = 'satin';         // 'matte' | 'satin' | 'gloss'
  let ramPrimaryColor = '#1a1f2b';
  let ramAccentColor = '#64748b';
  let ramPcbColor = '#121620';
  let ramElements = [];
  let nextElemSeq = 1;

  let editingRamProductId = null;
  let editingRamOldName = '';
  let selectedRamPageProductId = null;
  let ramThumbsCache = null;

  const isRam = () => !!(currentCompany?.product_lines || []).includes('ram');
  const researched = k => !k || (companyResearchRows || []).some(x => x.research_key === k);
  const researchDef = k => RAM_RESEARCH.find(r => r.key === k);
  const tierForScore = s => (typeof window.scoreToTier === 'function' ? window.scoreToTier(s) : (s >= 64 ? 'A' : s >= 42 ? 'B' : s >= 26 ? 'C' : s >= 12 ? 'D' : 'F'));

  function isProductDraft(p) {
    const st = String(p?.status || '').trim().toLowerCase();
    return !st || st === 'draft';
  }

  function isRamProductRow(p) {
    if (!p || typeof p !== 'object') return false;
    if (String(p.product_line || '').toLowerCase() === 'ram') return true;
    const d = p.design_data;
    return !!(d && typeof d === 'object' && (d.ram_build === true || d.capacity_key || d.capacity_gb));
  }

  function resolveCapDef(keyOrGb) {
    const k = String(keyOrGb || '').toLowerCase();
    return CAPACITY_TIERS.find(t => t.key === k || t.gb === Number(keyOrGb)) || CAPACITY_TIERS[0];
  }

  function buildRamConfigFromProduct(p) {
    const d = p?.design_data || {};
    const capDef = resolveCapDef(d.capacity_key || p?.body_type || d.capacity_gb || '512mb');
    return {
      capacityKey: capDef.key,
      capacityLabel: capDef.short,
      capacityGb: Number(d.capacity_gb ?? capDef.gb),
      heatspreader: d.heatspreader || 'angular',
      finish: d.finish || 'satin',
      primaryColor: d.primary_color || '#1a1f2b',
      accentColor: d.accent_color || '#64748b',
      pcbColor: d.pcb_color || '#121620',
      elements: Array.isArray(d.elements) ? d.elements : [],
      name: p?.product_name || (capDef.short + ' Stick'),
      companyName: p?.product_companies?.company_name || p?.company_name || '',
      logoUrl: p?.product_companies?.logo_data_url || p?.company_logo || '',
      score: Number(p?.cpu_score ?? d.score ?? capDef.score)
    };
  }

  function hasRgbElement(elements) {
    return Array.isArray(elements) && elements.some(e => e.kind === 'rgb_strip' || (e.kind === 'text' && e.glow));
  }

  function getRamProductScoreTier(p) {
    const d = p?.design_data || {};
    const capDef = resolveCapDef(d.capacity_key || p?.body_type || d.capacity_gb || '512mb');
    const rgbBonus = hasRgbElement(d.elements) || !!d.has_rgb ? 6 : 0;
    const computedScore = capDef.score + rgbBonus;
    const score = Number(p?.cpu_score || d.score || computedScore);
    const tier = p?.cpu_tier || d.tier || tierForScore(score);
    return { score, tier };
  }

  function formatRamSpecLine(p) {
    const cfg = buildRamConfigFromProduct(p);
    const rgb = hasRgbElement(cfg.elements) || p?.design_data?.has_rgb ? ' · RGB' : '';
    return cfg.capacityLabel + ' DDR5 Stick' + rgb;
  }

  function formatRamHardwareBadges(p) {
    const cfg = buildRamConfigFromProduct(p);
    const rgb = hasRgbElement(cfg.elements) || p?.design_data?.has_rgb;
    const parts = [
      cfg.capacityLabel + ' DDR5 Single Stick',
      cfg.heatspreader === 'ridged' ? 'Ridged Fin Spreader' : cfg.heatspreader === 'minimal' ? 'Minimal Spreader' : 'Angular Spreader',
      (cfg.finish || 'satin').charAt(0).toUpperCase() + (cfg.finish || 'satin').slice(1) + ' Finish',
      rgb ? 'RGB Lighting' : null,
      Array.isArray(cfg.elements) && cfg.elements.length ? (cfg.elements.length + ' Custom Element' + (cfg.elements.length === 1 ? '' : 's')) : null
    ].filter(Boolean);
    return parts.join(' · ');
  }

  // ---------- Thumbnails ----------
  function getRamThumbsMap() {
    if (ramThumbsCache && typeof ramThumbsCache === 'object') return ramThumbsCache;
    try {
      const raw = localStorage.getItem(RAM_THUMBS_LS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      ramThumbsCache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) { ramThumbsCache = {}; }
    return ramThumbsCache;
  }

  function saveRamThumb(key, dataUrl) {
    if (!key || !dataUrl) return;
    const map = getRamThumbsMap();
    map[key] = { dataUrl, ts: Date.now() };
    const entries = Object.entries(map).sort((a, b) => Number(b[1]?.ts || 0) - Number(a[1]?.ts || 0));
    if (entries.length > 40) ramThumbsCache = Object.fromEntries(entries.slice(0, 40));
    try { localStorage.setItem(RAM_THUMBS_LS_KEY, JSON.stringify(ramThumbsCache)); } catch (_) {}
  }

  function getRamThumb(p) {
    if (p?.design_data?.thumbnail) return p.design_data.thumbnail;
    const map = getRamThumbsMap();
    return map[p?.id]?.dataUrl || map['name:' + (p?.product_name || '')]?.dataUrl || '';
  }

  function clearRamThumb(key) {
    if (!key) return;
    const map = getRamThumbsMap();
    if (map[key]) {
      delete map[key];
      try { localStorage.setItem(RAM_THUMBS_LS_KEY, JSON.stringify(ramThumbsCache)); } catch (_) {}
    }
  }

  function applyRamThumbToDom(id, name, dataUrl) {
    if (!id || !dataUrl) return;
    document.querySelectorAll('[data-ram-thumb-id]').forEach(el => {
      if (el.dataset.ramThumbId !== String(id)) return;
      const alt = esc((name || 'RAM') + ' 3D preview');
      el.innerHTML = '<img class="cpu-thumb-img gpu-thumb-img" src="' + esc(dataUrl) + '" alt="' + alt + '">';
    });
  }

  function renderRamThumbHtml(p) {
    const url = getRamThumb(p);
    const alt = esc((p?.product_name || 'RAM') + ' 3D preview');
    if (url) return '<img class="cpu-thumb-img gpu-thumb-img" src="' + esc(url) + '" alt="' + alt + '">';
    return '<div class="cpu-thumb-loading" aria-label="Rendering 3D RAM preview"></div>';
  }

  function hydrateRamThumbElements(rootEl, productsById, width = 360, height = 270) {
    if (!rootEl) return;
    rootEl.querySelectorAll('[data-ram-thumb-id]').forEach(el => {
      const id = el.dataset.ramThumbId;
      if (!id) return;
      const prod = productsById instanceof Map ? productsById.get(id) : productsById?.[id];
      if (!prod) return;
      const cached = getRamThumb(prod);
      if (cached) {
        if (!el.querySelector('img')) applyRamThumbToDom(id, prod.product_name, cached);
        return;
      }
      if (el.dataset.ramThumbQueued === '1') return;
      if (typeof window.RamDesigner3D?.enqueueThumbnail !== 'function') return;
      el.dataset.ramThumbQueued = '1';
      window.RamDesigner3D.enqueueThumbnail(buildRamConfigFromProduct(prod), dataUrl => {
        if (!dataUrl) return;
        saveRamThumb(id, dataUrl);
        if (prod.product_name) saveRamThumb('name:' + prod.product_name, dataUrl);
        applyRamThumbToDom(id, prod.product_name, dataUrl);
      }, width, height);
    });
  }

  window.isRamProductRow = isRamProductRow;
  window.buildRamConfigFromProduct = buildRamConfigFromProduct;
  window.getRamProductScoreTier = getRamProductScoreTier;
  window.getRamThumbUrl = getRamThumb;
  window.renderRamThumbHtml = renderRamThumbHtml;
  window.hydrateRamThumbElements = hydrateRamThumbElements;
  window.formatRamSpecLine = formatRamSpecLine;
  window.formatRamHardwareBadges = formatRamHardwareBadges;
  window.clearRamDraftArtifacts = function (id, name) {
    if (id) clearRamThumb(id);
    if (name) clearRamThumb('name:' + name);
    if (editingRamProductId === id) {
      editingRamProductId = null;
      editingRamOldName = '';
      syncRamSaveButtonUI();
    }
    if (selectedRamPageProductId === id) selectedRamPageProductId = null;
  };

  // ---------- Stats Calculation ----------
  function computeRamStats() {
    let capDef = resolveCapDef(ramCapacityKey);
    if (capDef.researchKey && !researched(capDef.researchKey)) {
      capDef = CAPACITY_TIERS[0];
      ramCapacityKey = capDef.key;
    }
    const rgbUnlocked = researched('ram_rgb');
    const customColorsUnlocked = researched('ram_custom_colors');

    if (!rgbUnlocked) {
      ramElements = ramElements.filter(el => {
        if (el.kind === 'rgb_strip') return false;
        if (el.kind === 'text' && el.glow) el.glow = false;
        return true;
      });
    }
    if (!customColorsUnlocked) {
      if (!STOCK_PRIMARY_PRESETS.includes(ramPrimaryColor.toLowerCase())) ramPrimaryColor = STOCK_PRIMARY_PRESETS[0];
      if (!STOCK_ACCENT_PRESETS.includes(ramAccentColor.toLowerCase())) ramAccentColor = STOCK_ACCENT_PRESETS[0];
      if (!STOCK_PCB_PRESETS.includes(ramPcbColor.toLowerCase())) ramPcbColor = STOCK_PCB_PRESETS[0];
    }

    const rgbActive = rgbUnlocked && hasRgbElement(ramElements);
    const value = capDef.value + (rgbActive ? 260 : 0);
    const score = capDef.score + (rgbActive ? 6 : 0);
    const tier = tierForScore(score);
    return { capDef, rgbActive, value, score, tier };
  }

  function currentRamConfig() {
    const st = computeRamStats();
    return {
      capacityKey: st.capDef.key,
      capacityLabel: st.capDef.short,
      capacityGb: st.capDef.gb,
      heatspreader: ramHeatspreader,
      finish: ramFinish,
      primaryColor: ramPrimaryColor,
      accentColor: ramAccentColor,
      pcbColor: ramPcbColor,
      elements: ramElements.map(e => ({ ...e })),
      name: ($('#eaRamName')?.value || 'VeloDDR5 Stick').trim() || 'VeloDDR5 Stick',
      companyName: currentCompany?.company_name || '',
      logoUrl: currentCompany?.logo_data_url || '',
      score: st.score
    };
  }

  function drawRamStage() {
    const st = computeRamStats();
    if ($('#eaRamValueStat')) $('#eaRamValueStat').textContent = '$' + st.value.toLocaleString();
    if ($('#eaRamScoreStat')) $('#eaRamScoreStat').textContent = st.score + ' · ' + st.tier + ' Tier';
    if ($('#eaRamCaption')) {
      $('#eaRamCaption').textContent = '1× ' + st.capDef.short + ' DDR5 Stick' + (st.rgbActive ? ' · RGB' : '') + ' · Value $' + st.value.toLocaleString() + ' · Score ' + st.score;
    }
    window.RamDesigner3D?.update?.(currentRamConfig());
  }

  // ---------- RAM Research Tree (Exact User Specs) ----------
  function goToRamResearch() {
    showPage('company');
    if (typeof switchCompanyDashboardTab === 'function') switchCompanyDashboardTab('research');
  }

  function renderRamResearchTree() {
    const world = $('#eaRamResearchWorld');
    if (!world) return;

    const LAYOUT = {
      __root: [560, 110, 'RAM', 'Base 512MB Stick', 'Free & Unlocked · Starter DDR5'],
      // Line 1: Capacity Chain (Left-Center)
      ram_1gb: [280, 340, '1G', '1GB RAM'],
      ram_2gb: [280, 560, '2G', '2GB RAM'],
      ram_4gb: [280, 780, '4G', '4GB RAM'],
      ram_6gb: [280, 1000, '6G', '6GB RAM'],
      ram_8gb: [280, 1220, '8G', '8GB RAM'],
      ram_12gb: [280, 1440, '12G', '12GB RAM'],
      ram_16gb: [280, 1660, '16G', '16GB RAM'],
      ram_24gb: [280, 1880, '24G', '24GB RAM'],
      ram_32gb: [280, 2100, '32G', '32GB RAM'],
      ram_64gb: [280, 2320, '64G', '64GB RAM'],
      // Line 2: RGB
      ram_rgb: [640, 340, '✦', 'RGB'],
      // Line 3: Custom Colors
      ram_custom_colors: [940, 340, '◈', 'Custom Colors']
    };

    const width = 1140;
    const height = 2500;
    const rootInfo = LAYOUT.__root;

    const paths = RAM_RESEARCH.map(r => {
      const A = r.pre && LAYOUT[r.pre] ? LAYOUT[r.pre] : rootInfo;
      const B = LAYOUT[r.key];
      if (!A || !B) return '';
      const mid = (A[1] + B[1]) / 2;
      return '<path d="M' + A[0] + ' ' + (A[1] + 65) + ' L' + A[0] + ' ' + mid + ' L' + B[0] + ' ' + mid + ' L' + B[0] + ' ' + (B[1] - 65) + '"/>';
    }).join('');

    const nodeHtml = (r, x, y, icon, yes, locked) => {
      const status = yes ? 'UNLOCKED' : locked ? 'LOCKED' : 'UNLOCK · $' + r.cost.toLocaleString();
      const subTxt = r.key === 'baseline_ram'
        ? r.desc
        : '$' + r.cost.toLocaleString() + ' · Value ' + r.value + ' · Score ' + r.score;
      return '<button type="button" class="research-node ' + (yes ? 'researched' : locked ? 'prerequisite-locked' : 'available') +
        '" data-ram-research-key="' + r.key + '" style="--node-x:' + x + 'px;--node-y:' + y + 'px" ' + (yes || locked ? 'disabled' : '') + '>' +
        '<span class="research-hex"><b>' + icon + '</b></span><strong>' + esc(r.name) + '</strong>' +
        '<small>' + esc(subTxt) + '</small>' +
        '<em class="research-node-status">' + status + '</em></button>';
    };

    world.style.width = width + 'px';
    world.style.height = height + 'px';
    world.innerHTML =
      '<svg class="research-tree-lines" viewBox="0 0 ' + width + ' ' + height + '">' + paths + '</svg>' +
      nodeHtml({ name: rootInfo[3], cost: 0, desc: rootInfo[4], key: 'baseline_ram' }, rootInfo[0], rootInfo[1], rootInfo[2], true, false) +
      RAM_RESEARCH.map(r => {
        const xy = LAYOUT[r.key] || rootInfo;
        const yes = researched(r.key);
        const locked = !!(r.pre && !researched(r.pre));
        return nodeHtml(r, xy[0], xy[1], xy[2] || 'RAM', yes, locked);
      }).join('');

    world.querySelectorAll('[data-ram-research-key]').forEach(b => b.addEventListener('click', () => unlockRamResearch(b.dataset.ramResearchKey)));
  }

  function setupRamResearchNav(tree) {
    if (!tree || tree.dataset.navigationReady) return;
    tree.dataset.navigationReady = '1';
    const world = tree.querySelector('.research-tree-world');
    if (!world) return;
    const centerX = 560;
    let zoom = 0.68, panX = (tree.clientWidth || 720) / 2 - centerX * zoom, panY = 14, dragging = false, sx = 0, sy = 0, bx = 0, by = 0;
    const paint = () => { world.style.transform = 'translate(' + panX + 'px,' + panY + 'px) scale(' + zoom + ')'; };
    tree.addEventListener('pointerdown', e => {
      if (e.target.closest('button[data-ram-research-key],.research-tree-controls')) return;
      dragging = true; sx = e.clientX; sy = e.clientY; bx = panX; by = panY;
      tree.classList.add('dragging'); tree.setPointerCapture(e.pointerId);
    });
    tree.addEventListener('pointermove', e => { if (!dragging) return; panX = bx + e.clientX - sx; panY = by + e.clientY - sy; paint(); });
    const stop = () => { dragging = false; tree.classList.remove('dragging'); };
    tree.addEventListener('pointerup', stop);
    tree.addEventListener('pointercancel', stop);
    tree.querySelectorAll('[data-ram-zoom]').forEach(b => b.addEventListener('click', () => {
      const a = b.dataset.ramZoom;
      if (a === 'reset') { zoom = 0.68; panX = (tree.clientWidth || 720) / 2 - centerX * zoom; panY = 14; }
      else {
        const next = Math.max(0.35, Math.min(1.35, zoom * (a === 'in' ? 1.15 : 0.87)));
        panX = panX * next / zoom; panY = panY * next / zoom; zoom = next;
      }
      paint();
    }));
    tree.addEventListener('wheel', e => {
      if (!e.ctrlKey && Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
      e.preventDefault();
      const next = Math.max(0.35, Math.min(1.35, zoom * (e.deltaY < 0 ? 1.08 : 0.92)));
      panX = panX * next / zoom; panY = panY * next / zoom; zoom = next; paint();
    }, { passive: false });
    paint();
  }

  async function unlockRamResearch(key) {
    if (!currentCompany || !currentUser || !sb || !key || key === 'baseline_ram') return;
    if (researched(key)) return;
    const def = researchDef(key);
    const msgEl = $('#eaRamResearchMessage');
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
    renderRamResearchTree();
    renderRamMenus();
    drawRamStage();
    updateUIProfile?.();
    if (msgEl) msgEl.textContent = def.name + ' unlocked!';
    if (typeof playSound === 'function') playSound('upload');
    toast(def.name + ' unlocked!');
  }

  function mountRamResearch() {
    const section = $('#companyPanelResearch .research-section');
    if (!section) return;
    let wrap = $('#eaRamResearchWrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'eaRamResearchWrap';
      wrap.className = 'ea-company-research hidden';
      wrap.innerHTML =
        '<div id="eaRamResearchTree" class="research-tree"><div id="eaRamResearchWorld" class="research-tree-world"></div><div class="research-tree-controls"><button type="button" data-ram-zoom="out">−</button><button type="button" data-ram-zoom="reset">Reset</button><button type="button" data-ram-zoom="in">+</button></div></div>' +
        '<p id="eaRamResearchMessage" class="form-message"></p>';
      section.insertBefore(wrap, $('#cpuResearchTree') || null);
      setupRamResearchNav($('#eaRamResearchTree'));
    }
    const active = isRam();
    wrap.classList.toggle('hidden', !active);
    if (active) {
      $('#cpuResearchTree')?.classList.add('hidden');
      $('#eaCompanyResearch')?.classList.add('hidden');
      $('#eaPcResearchWrap')?.classList.add('hidden');
      $('#eaMoboResearchWrap')?.classList.add('hidden');
      const eyebrow = section.querySelector('.company-section-heading .eyebrow');
      const heading = section.querySelector('.company-section-heading h4');
      const chip = section.querySelector('.company-count-chip');
      const description = section.querySelector('.company-section-heading p');
      if (eyebrow) eyebrow.textContent = 'MEMORY R&D';
      if (heading) heading.textContent = 'RAM Capacities, RGB & Custom Colors';
      if (description) description.textContent = 'Unlock higher single-stick RAM capacities (1GB–64GB), RGB lightbars, and custom anodized colorways.';
      if (chip) chip.textContent = 'RAM RESEARCH';
      renderRamResearchTree();
    }
  }

  // ---------- Designer Menus ----------
  function setRamMenuTab(tab) {
    activeMenuTab = ['capacity', 'style', 'elements'].includes(tab) ? tab : 'capacity';
    document.querySelectorAll('[data-ram-menu]').forEach(b => b.classList.toggle('active', b.dataset.ramMenu === activeMenuTab));
    ['capacity', 'style', 'elements'].forEach(t => {
      $('#eaRamMenu_' + t)?.classList.toggle('hidden', t !== activeMenuTab);
    });
  }

  function renderRamCapacityMenu() {
    const wrap = $('#eaRamMenu_capacity');
    if (!wrap) return;
    computeRamStats();
    const cards = CAPACITY_TIERS.map(ct => {
      const ok = researched(ct.researchKey);
      const sel = ramCapacityKey === ct.key;
      return '<div class="cpu-component-option ' + (ok ? '' : 'locked') + ' ' + (sel ? 'selected' : '') + '">' +
        '<span class="cpu-component-icon">▤</span>' +
        '<span><strong>' + esc(ct.label) + '</strong><small>' + (ok ? 'Value $' + ct.value.toLocaleString() + ' · Score ' + ct.score : 'Research required') + '</small></span>' +
        '<button type="button" class="zoom-btn" ' + (ok ? 'data-ram-cap="' + ct.key + '"' : 'data-ram-go-research="1"') + '>' + (ok ? (sel ? 'Selected' : 'Use') : 'Research') + '</button>' +
        '</div>';
    }).join('');
    wrap.innerHTML = '<h4>Single Stick Capacity</h4><p class="muted tiny" style="margin:0 0 8px;">Each product is 1 individual RAM stick. PC builders install sticks into Motherboard slots.</p>' + cards;
    wrap.querySelectorAll('[data-ram-cap]').forEach(b => b.addEventListener('click', () => {
      ramCapacityKey = b.dataset.ramCap;
      renderRamCapacityMenu();
      drawRamStage();
    }));
    wrap.querySelectorAll('[data-ram-go-research]').forEach(b => b.addEventListener('click', goToRamResearch));
  }

  function renderRamStyleMenu() {
    const wrap = $('#eaRamMenu_style');
    if (!wrap) return;
    const customColorsOk = researched('ram_custom_colors');

    const styles = [
      ['angular', 'Angular Wing'],
      ['minimal', 'Minimal Sleek'],
      ['ridged', 'Ridged Finned']
    ].map(([id, lbl]) =>
      '<button type="button" class="zoom-btn' + (ramHeatspreader === id ? ' active' : '') + '" data-ram-spreader="' + id + '">' + lbl + '</button>'
    ).join('');

    const finishes = [
      ['matte', 'Matte'],
      ['satin', 'Satin'],
      ['gloss', 'Gloss']
    ].map(([id, lbl]) =>
      '<button type="button" class="zoom-btn' + (ramFinish === id ? ' active' : '') + '" data-ram-finish="' + id + '">' + lbl + '</button>'
    ).join('');

    const primList = customColorsOk ? CUSTOM_PRIMARY_PRESETS : STOCK_PRIMARY_PRESETS;
    const accList = customColorsOk ? CUSTOM_ACCENT_PRESETS : STOCK_ACCENT_PRESETS;
    const pcbList = customColorsOk ? CUSTOM_PCB_PRESETS : STOCK_PCB_PRESETS;

    const swatchesHtml = (list, cur, attr) => list.map(hex =>
      '<button type="button" class="ea-swatch-btn' + (cur.toLowerCase() === hex.toLowerCase() ? ' active' : '') + '" ' + attr + '="' + hex + '" style="background:' + hex + '"></button>'
    ).join('');

    wrap.innerHTML =
      '<h4>Heatspreader &amp; Finish</h4>' +
      '<div class="ea-gpu-inline-box"><span>Heatspreader Silhouette</span><div class="ea-gpu-pill-row ea-gpu-pill-wrap">' + styles + '</div></div>' +
      '<div class="ea-gpu-inline-box"><span>Surface Finish</span><div class="ea-gpu-pill-row">' + finishes + '</div></div>' +
      '<h4 style="margin-top:12px">Colors ' + (customColorsOk ? '(Unlocked)' : '(Stock Only)') + '</h4>' +
      (!customColorsOk
        ? '<div class="cpu-component-option locked" style="margin-bottom:8px;"><span class="cpu-component-icon">◈</span><span><strong>Custom Colors</strong><small>Unlock custom color pickers for Heatspreader, Accent &amp; PCB ($180)</small></span><button type="button" class="zoom-btn" data-ram-go-research="1">Research $180</button></div>'
        : '') +
      '<div class="ea-gpu-inline-box"><span>Heatspreader Color</span><div class="ea-gpu-swatches">' +
        swatchesHtml(primList, ramPrimaryColor, 'data-ram-prim') +
        (customColorsOk ? '<input id="eaRamPrimaryColor" type="color" value="' + esc(ramPrimaryColor) + '">' : '') +
      '</div></div>' +
      '<div class="ea-gpu-inline-box"><span>Accent Trim Color</span><div class="ea-gpu-swatches">' +
        swatchesHtml(accList, ramAccentColor, 'data-ram-acc') +
        (customColorsOk ? '<input id="eaRamAccentColor" type="color" value="' + esc(ramAccentColor) + '">' : '') +
      '</div></div>' +
      '<div class="ea-gpu-inline-box"><span>PCB Solder Mask</span><div class="ea-gpu-swatches">' +
        swatchesHtml(pcbList, ramPcbColor, 'data-ram-pcb') +
        (customColorsOk ? '<input id="eaRamPcbColor" type="color" value="' + esc(ramPcbColor) + '">' : '') +
      '</div></div>';

    wrap.querySelectorAll('[data-ram-go-research]').forEach(b => b.addEventListener('click', goToRamResearch));
    wrap.querySelectorAll('[data-ram-spreader]').forEach(b => b.addEventListener('click', () => {
      ramHeatspreader = b.dataset.ramSpreader;
      renderRamStyleMenu();
      drawRamStage();
    }));
    wrap.querySelectorAll('[data-ram-finish]').forEach(b => b.addEventListener('click', () => {
      ramFinish = b.dataset.ramFinish;
      renderRamStyleMenu();
      drawRamStage();
    }));
    wrap.querySelectorAll('[data-ram-prim]').forEach(b => b.addEventListener('click', () => {
      ramPrimaryColor = b.dataset.ramPrim;
      renderRamStyleMenu();
      drawRamStage();
    }));
    wrap.querySelectorAll('[data-ram-acc]').forEach(b => b.addEventListener('click', () => {
      ramAccentColor = b.dataset.ramAcc;
      renderRamStyleMenu();
      drawRamStage();
    }));
    wrap.querySelectorAll('[data-ram-pcb]').forEach(b => b.addEventListener('click', () => {
      ramPcbColor = b.dataset.ramPcb;
      renderRamStyleMenu();
      drawRamStage();
    }));
    wrap.querySelector('#eaRamPrimaryColor')?.addEventListener('input', e => { ramPrimaryColor = e.target.value; drawRamStage(); });
    wrap.querySelector('#eaRamAccentColor')?.addEventListener('input', e => { ramAccentColor = e.target.value; drawRamStage(); });
    wrap.querySelector('#eaRamPcbColor')?.addEventListener('input', e => { ramPcbColor = e.target.value; drawRamStage(); });
  }

  function renderRamAddElementTab() {
    const wrap = $('#eaRamMenu_elements');
    if (!wrap) return;
    const rgbUnlocked = researched('ram_rgb');

    const defs = [
      { id: 'text', ok: true, icon: 'Aa', name: 'Text Label', desc: 'Custom printed or LED text on Front, Back, or Top' },
      { id: 'logo', ok: true, icon: '◆', name: 'Logo Badge', desc: 'Company logo or upload your own PNG/JPG/WEBP graphic' },
      { id: 'accent_bar', ok: true, icon: '▬', name: 'Accent Trim Bar', desc: 'Machined metallic trim stripe on any face' },
      { id: 'rgb_strip', ok: rgbUnlocked, icon: '✦', name: 'RGB Light Strip', desc: '+$260 Value · +6 Score · Top Lightbar & Side Diffuser Slits ($800 R&D)' }
    ];

    wrap.innerHTML = '<h4>Add Element</h4>' + defs.map(d =>
      '<div class="cpu-component-option ' + (d.ok ? '' : 'locked') + '">' +
        '<span class="cpu-component-icon">' + d.icon + '</span>' +
        '<span><strong>' + d.name + '</strong><small>' + (d.ok ? d.desc : 'Research RGB ($800) required · +260 Value · +6 Score') + '</small></span>' +
        '<button type="button" class="zoom-btn" ' + (d.ok ? 'data-ram-add-el="' + d.id + '"' : 'data-ram-go-research="1"') + '>' + (d.ok ? 'Add' : 'Research') + '</button>' +
      '</div>'
    ).join('');

    wrap.querySelectorAll('[data-ram-add-el]').forEach(btn => btn.addEventListener('click', () => {
      const kind = btn.dataset.ramAddEl;
      if (kind === 'text') {
        ramElements.push({
          id: 'ram_el_' + (++nextElemSeq),
          kind: 'text',
          text: (currentCompany?.company_name || 'DDR5').slice(0, 18),
          color: '#ffffff',
          placement: 'front',
          position: 0.5,
          size: 1.0,
          glow: false
        });
        window.RamDesigner3D?.focusPlacement?.('front');
      } else if (kind === 'logo') {
        ramElements.push({
          id: 'ram_el_' + (++nextElemSeq),
          kind: 'logo',
          logoUrl: currentCompany?.logo_data_url || '',
          placement: 'front',
          position: 0.24,
          size: 1.0
        });
        window.RamDesigner3D?.focusPlacement?.('front');
      } else if (kind === 'accent_bar') {
        ramElements.push({
          id: 'ram_el_' + (++nextElemSeq),
          kind: 'accent_bar',
          color: ramAccentColor || '#a855f7',
          placement: 'both_sides',
          position: 0.5,
          size: 1.0
        });
      } else if (kind === 'rgb_strip') {
        if (!rgbUnlocked) { toast('Research RGB ($800) first.'); return; }
        ramElements.push({
          id: 'ram_el_' + (++nextElemSeq),
          kind: 'rgb_strip',
          color: '#a855f7',
          colorMode: 'rainbow',
          rainbow: true,
          placement: 'full'
        });
        window.RamDesigner3D?.focusPlacement?.('top');
      }
      renderRamPlacedElementsManager();
      drawRamStage();
    }));
    wrap.querySelectorAll('[data-ram-go-research]').forEach(btn => btn.addEventListener('click', goToRamResearch));
  }

  function renderRamPlacedElementsManager() {
    const wrap = $('#eaRamPlacedList');
    if (!wrap) return;
    const rgbUnlocked = researched('ram_rgb');
    ramElements = ramElements.filter(el => {
      if (el.kind === 'rgb_strip' && !rgbUnlocked) return false;
      if (el.kind === 'text' && el.glow && !rgbUnlocked) el.glow = false;
      return true;
    });

    if (!ramElements.length) {
      wrap.innerHTML = '<p class="muted tiny">No elements on this RAM stick yet. Add Logos, Text, Trim Bars, or RGB from the <b>Add Element</b> tab above.</p>';
      return;
    }

    const placeOpts = (selected) => [
      ['front', 'Front Heatspreader'],
      ['back', 'Back Heatspreader'],
      ['both_sides', 'Both Sides'],
      ['top', 'Top Spine']
    ].map(([v, lbl]) => '<option value="' + v + '"' + ((selected || 'front') === v ? ' selected' : '') + '>' + lbl + '</option>').join('');

    wrap.innerHTML = ramElements.map(el => {
      if (el.kind === 'text') {
        return '<div class="ea-elem-card" data-elem-id="' + el.id + '">' +
          '<div class="ea-elem-head"><strong>Text Label</strong>' +
          '<button type="button" class="ea-elem-del" data-ram-rem="' + el.id + '" title="Remove">✕</button></div>' +
          '<div class="ea-elem-grid">' +
            '<input type="text" maxlength="24" value="' + esc(el.text || '') + '" placeholder="Label text" data-ram-el-text="' + el.id + '">' +
            '<input type="color" value="' + esc(el.color || '#ffffff') + '" data-ram-el-color="' + el.id + '" title="Text color">' +
            '<select data-ram-el-place="' + el.id + '">' + placeOpts(el.placement || 'front') + '</select>' +
          '</div>' +
          '<div class="ea-elem-row">' +
            '<label>Pos <b>' + Math.round((el.position ?? 0.5) * 100) + '%</b><input type="range" min="14" max="86" value="' + Math.round((el.position ?? 0.5) * 100) + '" data-ram-el-pos="' + el.id + '"></label>' +
            '<label>Scale <b>' + Math.round((el.size || 1) * 100) + '%</b><input type="range" min="55" max="150" value="' + Math.round((el.size || 1) * 100) + '" data-ram-el-size="' + el.id + '"></label>' +
          '</div>' +
          '<div class="ea-elem-subrow">' +
            '<span>LED Backlit Text</span>' +
            (rgbUnlocked
              ? '<button type="button" class="zoom-btn' + (el.glow ? ' active' : '') + '" data-ram-el-glow="' + el.id + '">' + (el.glow ? 'Glow On' : 'Glow Off') + '</button>'
              : '<button type="button" class="zoom-btn" data-ram-go-research="1">Research RGB</button>') +
          '</div></div>';
      }
      if (el.kind === 'logo') {
        return '<div class="ea-elem-card" data-elem-id="' + el.id + '">' +
          '<div class="ea-elem-head"><strong>Logo Badge</strong>' +
          '<button type="button" class="ea-elem-del" data-ram-rem="' + el.id + '" title="Remove">✕</button></div>' +
          '<div class="ea-elem-grid">' +
            '<select data-ram-el-place="' + el.id + '">' + placeOpts(el.placement || 'front') + '</select>' +
            '<label class="ea-file-mini">Upload Logo<input type="file" accept="image/png,image/jpeg,image/webp" data-ram-el-upload="' + el.id + '"></label>' +
          '</div>' +
          '<div class="ea-elem-row">' +
            '<label>Pos <b>' + Math.round((el.position ?? 0.5) * 100) + '%</b><input type="range" min="14" max="86" value="' + Math.round((el.position ?? 0.5) * 100) + '" data-ram-el-pos="' + el.id + '"></label>' +
            '<label>Scale <b>' + Math.round((el.size || 1) * 100) + '%</b><input type="range" min="50" max="150" value="' + Math.round((el.size || 1) * 100) + '" data-ram-el-size="' + el.id + '"></label>' +
          '</div></div>';
      }
      if (el.kind === 'accent_bar') {
        return '<div class="ea-elem-card" data-elem-id="' + el.id + '">' +
          '<div class="ea-elem-head"><strong>Accent Trim Bar</strong>' +
          '<button type="button" class="ea-elem-del" data-ram-rem="' + el.id + '" title="Remove">✕</button></div>' +
          '<div class="ea-elem-grid">' +
            '<input type="color" value="' + esc(el.color || ramAccentColor || '#a855f7') + '" data-ram-el-color="' + el.id + '" title="Bar color">' +
            '<select data-ram-el-place="' + el.id + '">' + placeOpts(el.placement || 'both_sides') + '</select>' +
          '</div>' +
          '<div class="ea-elem-row">' +
            '<label>Pos <b>' + Math.round((el.position ?? 0.5) * 100) + '%</b><input type="range" min="14" max="86" value="' + Math.round((el.position ?? 0.5) * 100) + '" data-ram-el-pos="' + el.id + '"></label>' +
            '<label>Length <b>' + Math.round((el.size || 1) * 100) + '%</b><input type="range" min="35" max="180" value="' + Math.round((el.size || 1) * 100) + '" data-ram-el-size="' + el.id + '"></label>' +
          '</div></div>';
      }
      if (el.kind === 'rgb_strip') {
        const isRainbow = el.colorMode === 'rainbow' || !!el.rainbow;
        return '<div class="ea-elem-card" data-elem-id="' + el.id + '">' +
          '<div class="ea-elem-head"><strong>RGB Light Strip</strong>' +
          '<button type="button" class="ea-elem-del" data-ram-rem="' + el.id + '" title="Remove">✕</button></div>' +
          '<div class="ea-elem-grid">' +
            '<input type="color" value="' + esc(el.color || '#a855f7') + '" data-ram-el-color="' + el.id + '" title="Solid glow color">' +
            '<button type="button" class="zoom-btn ea-rainbow-btn' + (isRainbow ? ' active' : '') + '" data-ram-el-rainbow="' + el.id + '">Rainbow</button>' +
            '<select data-ram-el-place="' + el.id + '">' +
              '<option value="top"' + (el.placement === 'top' ? ' selected' : '') + '>Top Lightbar</option>' +
              '<option value="full"' + (el.placement === 'full' ? ' selected' : '') + '>Top + Side Slits</option>' +
              '<option value="side_slit"' + (el.placement === 'side_slit' ? ' selected' : '') + '>Diffuser + Side Glow</option>' +
            '</select>' +
          '</div></div>';
      }
      return '';
    }).join('');

    wrap.querySelectorAll('[data-ram-go-research]').forEach(btn => btn.addEventListener('click', goToRamResearch));
    wrap.querySelectorAll('[data-ram-rem]').forEach(btn => btn.addEventListener('click', () => {
      ramElements = ramElements.filter(x => x.id !== btn.dataset.ramRem);
      renderRamPlacedElementsManager();
      drawRamStage();
    }));
    wrap.querySelectorAll('[data-ram-el-pos]').forEach(inp => inp.addEventListener('input', () => {
      const target = ramElements.find(x => x.id === inp.dataset.ramElPos);
      if (target) {
        target.position = Number(inp.value) / 100;
        const b = inp.parentElement?.querySelector('b');
        if (b) b.textContent = inp.value + '%';
        drawRamStage();
      }
    }));
    wrap.querySelectorAll('[data-ram-el-size]').forEach(inp => inp.addEventListener('input', () => {
      const target = ramElements.find(x => x.id === inp.dataset.ramElSize);
      if (target) {
        target.size = Number(inp.value) / 100;
        const b = inp.parentElement?.querySelector('b');
        if (b) b.textContent = inp.value + '%';
        drawRamStage();
      }
    }));
    wrap.querySelectorAll('[data-ram-el-text]').forEach(inp => inp.addEventListener('input', () => {
      const target = ramElements.find(x => x.id === inp.dataset.ramElText);
      if (target) { target.text = inp.value; drawRamStage(); }
    }));
    wrap.querySelectorAll('[data-ram-el-color]').forEach(inp => inp.addEventListener('input', () => {
      const target = ramElements.find(x => x.id === inp.dataset.ramElColor);
      if (target) {
        target.color = inp.value;
        if (target.kind === 'rgb_strip') {
          target.colorMode = 'solid';
          target.rainbow = false;
          wrap.querySelector('[data-ram-el-rainbow="' + target.id + '"]')?.classList.remove('active');
        }
        drawRamStage();
      }
    }));
    wrap.querySelectorAll('[data-ram-el-rainbow]').forEach(btn => btn.addEventListener('click', () => {
      const target = ramElements.find(x => x.id === btn.dataset.ramElRainbow);
      if (!target) return;
      const next = !(target.colorMode === 'rainbow' || !!target.rainbow);
      target.colorMode = next ? 'rainbow' : 'solid';
      target.rainbow = next;
      btn.classList.toggle('active', next);
      drawRamStage();
    }));
    wrap.querySelectorAll('[data-ram-el-glow]').forEach(btn => btn.addEventListener('click', () => {
      if (!rgbUnlocked) { toast('Research RGB first.'); return; }
      const target = ramElements.find(x => x.id === btn.dataset.ramElGlow);
      if (target) {
        target.glow = !target.glow;
        renderRamPlacedElementsManager();
        drawRamStage();
      }
    }));
    wrap.querySelectorAll('[data-ram-el-place]').forEach(sel => sel.addEventListener('change', () => {
      const target = ramElements.find(x => x.id === sel.dataset.ramElPlace);
      if (!target) return;
      target.placement = sel.value;
      window.RamDesigner3D?.focusPlacement?.(sel.value);
      drawRamStage();
    }));
    wrap.querySelectorAll('[data-ram-el-upload]').forEach(inp => inp.addEventListener('change', e => {
      const file = e.target.files?.[0];
      const target = ramElements.find(x => x.id === inp.dataset.ramElUpload);
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
          drawRamStage();
        };
        img.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    }));
  }

  function renderRamMenus() {
    renderRamCapacityMenu();
    renderRamStyleMenu();
    renderRamAddElementTab();
    renderRamPlacedElementsManager();
  }

  // ---------- Save / Edit Draft ----------
  function syncRamSaveButtonUI() {
    const saveBtn = $('#eaRamSaveBtn');
    const cancelBtn = $('#eaRamCancelEdit');
    if (saveBtn) saveBtn.textContent = editingRamProductId ? 'Save edits · Free' : 'Save as draft · Free';
    if (cancelBtn) cancelBtn.classList.toggle('hidden', !editingRamProductId);
  }

  function resetRamDraftState() {
    ramCapacityKey = '512mb';
    ramHeatspreader = 'angular';
    ramFinish = 'satin';
    ramPrimaryColor = '#1a1f2b';
    ramAccentColor = '#64748b';
    ramPcbColor = '#121620';
    ramElements = [];
    editingRamProductId = null;
    editingRamOldName = '';
    if ($('#eaRamName')) $('#eaRamName').value = 'VeloDDR5 Stick';
    if ($('#eaRamPrice')) $('#eaRamPrice').value = '95';
    if ($('#eaRamMessage')) $('#eaRamMessage').textContent = '';
    syncRamSaveButtonUI();
  }

  async function saveRamProduct() {
    if (!currentCompany || !currentUser || !sb) return;
    const name = ($('#eaRamName')?.value || '').trim();
    const msgEl = $('#eaRamMessage');
    if (name.length < 2) { if (msgEl) msgEl.textContent = 'Enter a RAM stick name (at least 2 characters).'; return; }

    const { capDef, rgbActive, value, score, tier } = computeRamStats();
    if (capDef.researchKey && !researched(capDef.researchKey)) { toast('Research ' + capDef.label + ' first.'); return; }
    if (hasRgbElement(ramElements) && !researched('ram_rgb')) { toast('Research RGB ($800) first.'); return; }

    const listedPrice = Math.max(1, Number($('#eaRamPrice')?.value) || 1);
    const cfg = currentRamConfig();

    let snapshot = window.RamDesigner3D?.captureSnapshot?.({ width: 360, height: 270 }) || '';
    if (!snapshot && typeof window.RamDesigner3D?.captureHeroSnapshot === 'function') {
      snapshot = await window.RamDesigner3D.captureHeroSnapshot(cfg, 360, 270);
    }

    const designData = {
      ram_build: true,
      capacity_key: capDef.key,
      capacity_gb: capDef.gb,
      heatspreader: ramHeatspreader,
      finish: ramFinish,
      primary_color: ramPrimaryColor,
      accent_color: ramAccentColor,
      pcb_color: ramPcbColor,
      has_rgb: rgbActive,
      elements: ramElements.map(e => ({ ...e })),
      score,
      tier,
      thumbnail: snapshot || ''
    };

    const wasEditingId = editingRamProductId;
    const oldName = editingRamOldName;
    const saveBtn = $('#eaRamSaveBtn');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = wasEditingId ? 'Saving edits…' : 'Saving…'; }

    let data = null;
    let error = null;

    const rpcRes = await sb.rpc('save_ram_product_draft', {
      p_product_id: wasEditingId || null,
      p_company_id: currentCompany.id,
      p_product_name: name,
      p_body_type: capDef.key,
      p_production_cost: value,
      p_product_value: value,
      p_listed_price: listedPrice,
      p_score: score,
      p_tier: tier,
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
            body_type: capDef.key,
            production_cost: value,
            product_value: value,
            listed_price: listedPrice,
            cpu_score: score,
            cpu_tier: tier,
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
          product_line: 'ram',
          product_name: name,
          body_type: capDef.key,
          production_cost: value,
          product_value: value,
          listed_price: listedPrice,
          cpu_score: score,
          cpu_tier: tier,
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
      if (msgEl) msgEl.textContent = 'Could not save RAM stick draft: ' + error.message;
      syncRamSaveButtonUI();
      return;
    }

    const savedId = data?.id || wasEditingId;
    if (oldName && oldName !== name) clearRamThumb('name:' + oldName);
    if (snapshot) {
      if (savedId) saveRamThumb(savedId, snapshot);
      saveRamThumb('name:' + name, snapshot);
      if (savedId) applyRamThumbToDom(savedId, name, snapshot);
    }

    editingRamProductId = null;
    editingRamOldName = '';
    if (savedId) {
      selectedCompanyProductId = savedId;
      selectedRamPageProductId = savedId;
    }
    syncRamSaveButtonUI();
    if (msgEl) msgEl.textContent = wasEditingId ? 'RAM stick updated!' : 'RAM stick saved as draft! Publish it from Products.';
    toast(wasEditingId ? 'RAM stick updated!' : 'RAM draft saved!');
    await loadCompanyResearchAndProducts();
    renderRamProducts();
    if (typeof renderCompanyProducts === 'function') renderCompanyProducts();
  }

  function loadRamDraftIntoEditor(p) {
    if (!p) { toast('RAM product not found.'); return; }
    const d = p.design_data || {};
    const capDef = resolveCapDef(d.capacity_key || p.body_type || d.capacity_gb || '512mb');
    ramCapacityKey = capDef.key;
    ramHeatspreader = d.heatspreader || 'angular';
    ramFinish = d.finish || 'satin';
    ramPrimaryColor = d.primary_color || '#1a1f2b';
    ramAccentColor = d.accent_color || '#64748b';
    ramPcbColor = d.pcb_color || '#121620';
    ramElements = Array.isArray(d.elements) ? d.elements.map((e, i) => ({ ...e, id: e.id || ('ram_el_restored_' + i) })) : [];
    nextElemSeq = Math.max(nextElemSeq, ramElements.length + 10);

    editingRamProductId = p.id;
    editingRamOldName = p.product_name || '';

    showPage('company-design');
    mountRamWorkspace();
    if ($('#eaRamName')) $('#eaRamName').value = p.product_name || 'VeloDDR5 Stick';
    if ($('#eaRamPrice')) $('#eaRamPrice').value = String(Math.max(1, Number(p.listed_price || 95)));
    if ($('#eaRamMessage')) $('#eaRamMessage').textContent = 'Editing RAM stick "' + (p.product_name || 'RAM') + '".';
    renderRamMenus();
    syncRamSaveButtonUI();
    drawRamStage();
    toast('Loaded RAM stick into designer.');
  }

  window.editRamDraftProduct = function (id) {
    const p = (companyProducts || []).find(x => x.id === id);
    if (p) loadRamDraftIntoEditor(p);
  };

  // ---------- RAM Products Page ----------
  function mountRamProductsPage() {
    const page = $('#page-company-products');
    if (!page) return;
    page.innerHTML =
      '<div class="section-head"><div><div class="eyebrow purple-text">RAM MANUFACTURING</div><h3>RAM Sticks</h3><p class="muted">Each product is 1 RAM stick. Publish sticks and produce stock so PC companies can install them into Motherboard DIMM slots.</p></div></div>' +
      '<div id="eaRamProductList" class="ea-gpu-product-grid"></div>' +
      '<div id="eaRamProductDetails" class="company-product-details hidden"></div>';
  }

  function renderRamProducts() {
    if (!isRam()) return;
    const el = $('#eaRamProductList');
    const detailEl = $('#eaRamProductDetails');
    if (!el) return;
    const rows = (companyProducts || []).filter(p => isRamProductRow(p));
    if (!rows.length) {
      el.innerHTML = '<div class="company-empty-products"><span>▤</span><strong>No RAM sticks yet</strong><p class="muted">Design your first RAM stick in Design.</p></div>';
      detailEl?.classList.add('hidden');
      return;
    }
    if (!selectedRamPageProductId || !rows.some(r => r.id === selectedRamPageProductId)) {
      selectedRamPageProductId = rows[0].id;
    }
    const byId = new Map();
    el.innerHTML = rows.map(p => {
      byId.set(p.id, p);
      const draft = isProductDraft(p);
      const active = p.id === selectedRamPageProductId;
      const st = getRamProductScoreTier(p);
      return (
        '<article class="ea-chip-card ea-gpu-product-card' + (active ? ' active' : '') + '" data-ea-ram-select="' + esc(p.id) + '" tabindex="0" role="button">' +
          '<div class="ea-gpu-product-thumb-wrap" data-ram-thumb-id="' + esc(p.id) + '">' + renderRamThumbHtml(p) + '</div>' +
          '<b>' + esc(p.product_name || 'RAM Stick') + '</b>' +
          '<small>' + esc(formatRamSpecLine(p)) + ' · ' + st.score + ' Score (' + esc(st.tier) + ')</small>' +
          '<small>$' + Number(p.listed_price || 0).toLocaleString() + ' · ' + (draft ? 'Draft' : 'Published · Stock: ' + Number(p.stock || 0)) + '</small>' +
        '</article>'
      );
    }).join('');
    hydrateRamThumbElements(el, byId, 360, 270);

    el.querySelectorAll('[data-ea-ram-select]').forEach(card => {
      card.addEventListener('click', () => {
        selectedRamPageProductId = card.dataset.eaRamSelect;
        renderRamProducts();
      });
    });

    const selected = rows.find(r => r.id === selectedRamPageProductId);
    if (!detailEl || !selected) { detailEl?.classList.add('hidden'); return; }
    const draft = isProductDraft(selected);
    const canEdit = selected.owner_id === currentUser?.id;
    const unitValue = Math.max(0, Number(selected.product_value ?? selected.production_cost ?? 0));
    const stockCount = Number(selected.stock || 0);
    const st = getRamProductScoreTier(selected);

    const produceBlock = draft
      ? '<p class="muted tiny" style="margin:4px 0 0;">Publish this draft before producing sticks.</p>'
      : '<label>Produce quantity (costs $' + unitValue.toLocaleString() + '/stick)<input id="eaRamProduceQty" type="number" min="1" max="100000" value="1"></label>' +
        '<div class="company-product-details-actions">' +
          '<button type="button" class="primary-btn" id="eaRamProduceBtn">Produce 1 · $' + unitValue.toLocaleString() + '</button>' +
          '<button type="button" class="danger-btn" id="eaRamLiquidateBtn" ' + (stockCount > 0 ? '' : 'disabled') + '>Delete stock · 50% refund</button>' +
        '</div>';

    detailEl.classList.remove('hidden');
    detailEl.innerHTML =
      '<div class="company-product-detail-hero">' +
        '<div class="company-product-detail-thumb company-product-detail-thumb-gpu" data-ram-thumb-id="' + esc(selected.id) + '">' + renderRamThumbHtml(selected) + '</div>' +
        '<div class="company-product-detail-title"><h4>' + esc(selected.product_name || 'RAM Stick') + '</h4>' +
        '<p class="muted tiny">' + (draft ? 'Draft (Not yet published)' : 'Published on Product Feed') + '</p>' +
        '<small class="company-product-detail-specs">' + esc(formatRamHardwareBadges(selected)) + '</small></div>' +
      '</div>' +
      '<div class="company-product-detail-grid">' +
        '<div class="company-product-detail-stat"><span>Build value / stick</span><strong>$' + unitValue.toLocaleString() + '</strong></div>' +
        '<div class="company-product-detail-stat"><span>Score / Tier</span><strong>' + st.score + ' · ' + esc(st.tier) + '</strong></div>' +
        '<div class="company-product-detail-stat"><span>Stock</span><strong>' + (stockCount > 0 ? stockCount : 'Out Of Stock') + '</strong></div>' +
        '<div class="company-product-detail-stat"><span>Sticks sold</span><strong>' + Number(selected.purchase_count || 0) + '</strong></div>' +
      '</div>' +
      '<label>Listing price ($)<input id="eaRamDetailPrice" type="number" min="1" value="' + Number(selected.listed_price || 1) + '"></label>' +
      produceBlock +
      '<div class="company-product-details-actions">' +
        '<button type="button" class="zoom-btn" id="eaRamDetailPreview">👁 Preview</button>' +
        (canEdit ? '<button type="button" class="primary-btn" id="eaRamDetailEdit">Edit</button>' : '') +
        '<button type="button" class="zoom-btn" id="eaRamDetailSavePrice">Save price</button>' +
        (draft ? '<button type="button" class="primary-btn" id="eaRamDetailPublish">Publish RAM</button><button type="button" class="danger-btn" id="eaRamDetailDeleteDraft">Delete draft</button>' : '') +
      '</div>' +
      '<p class="form-message" id="eaRamDetailMessage"></p>';

    hydrateRamThumbElements(detailEl, new Map([[selected.id, selected]]), 360, 270);
    const msgEl = $('#eaRamDetailMessage');
    if (!draft) {
      const qtyInput = $('#eaRamProduceQty');
      const prodBtn = $('#eaRamProduceBtn');
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
      $('#eaRamLiquidateBtn')?.addEventListener('click', () => window.liquidateProductStock?.(selected.id, msgEl));
    }
    $('#eaRamDetailPreview')?.addEventListener('click', () => window.openProductPreview?.(selected, currentCompany?.company_name));
    $('#eaRamDetailEdit')?.addEventListener('click', () => loadRamDraftIntoEditor(selected));
    $('#eaRamDetailDeleteDraft')?.addEventListener('click', () => window.deleteDraftProduct?.(selected.id, msgEl));
    const saveOrPublish = async publish => {
      const amount = Number($('#eaRamDetailPrice')?.value || 0);
      if (!Number.isFinite(amount) || amount <= 0) { if (msgEl) msgEl.textContent = 'Enter a valid price.'; return; }
      const result = await sb.rpc('update_cpu_product_listing', { p_product_id: selected.id, p_listed_price: amount, p_publish: publish });
      if (result.error) { if (msgEl) msgEl.textContent = result.error.message; return; }
      await loadCompanyResearchAndProducts();
      renderRamProducts();
      if (typeof renderCompanyProducts === 'function') renderCompanyProducts();
      toast(publish ? 'RAM stick published to Product Feed!' : 'RAM price updated.');
    };
    $('#eaRamDetailSavePrice')?.addEventListener('click', () => saveOrPublish(false));
    $('#eaRamDetailPublish')?.addEventListener('click', () => saveOrPublish(true));
  }
  window.renderEaRamProducts = renderRamProducts;

  // ---------- Mount / Hide Workspace ----------
  function mountRamWorkspace() {
    if (!isRam()) return;
    $('#page-company-design #cpuDesigner')?.classList.add('hidden');
    $('#page-company-design #eaGpuPanel')?.classList.add('hidden');
    $('#page-company-design #eaPcPanel')?.classList.add('hidden');
    $('#page-company-design #eaMoboPanel')?.classList.add('hidden');
    $('#page-company-design #companyDesignNoCompany')?.classList.add('hidden');

    const page = $('#page-company-design');
    if (!page) return;
    let panel = $('#eaRamPanel');
    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'eaRamPanel';
      panel.className = 'company-dashboard-section ea-gpu-panel';
      panel.innerHTML =
        '<div class="cpu-designer-layout ea-gpu-layout-match">' +
          '<div class="cpu-preview-panel">' +
            '<div class="cpu-preview-toolbar"><span>3D RAM STICK STUDIO</span><small>1 Stick per Product · Drag to orbit · Scroll to zoom</small></div>' +
            '<div id="eaRam3DStage" class="ea-pc-3d-stage"><div class="gpu-3d-loading">Loading 3D RAM CAD…</div></div>' +
            '<div id="eaRamCaption" class="cpu-preview-caption">1× 512MB DDR5 Stick · Value $45</div>' +
          '</div>' +
          '<div class="cpu-options-panel ea-gpu-sidebar">' +
            '<div class="cpu-menu-tabs ea-gpu-menu-tabs" role="tablist">' +
              '<button type="button" class="active" data-ram-menu="capacity">Capacity</button>' +
              '<button type="button" data-ram-menu="style">Body &amp; Colors</button>' +
              '<button type="button" data-ram-menu="elements">Add Element</button>' +
            '</div>' +
            '<div id="eaRamMenu_capacity" class="cpu-menu-content"></div>' +
            '<div id="eaRamMenu_style" class="cpu-menu-content hidden"></div>' +
            '<div id="eaRamMenu_elements" class="cpu-menu-content hidden"></div>' +
            '<div class="ea-placed-section">' +
              '<div class="ea-placed-head"><h4>Placed Elements</h4></div>' +
              '<div id="eaRamPlacedList" class="ea-placed-list"></div>' +
            '</div>' +
            '<div class="cpu-design-summary">' +
              '<div><span>Build Value</span><strong id="eaRamValueStat">$45</strong></div>' +
              '<div><span>Score / Tier</span><strong id="eaRamScoreStat">2 · F Tier</strong></div>' +
            '</div>' +
            '<label class="cpu-design-label">RAM stick name<input id="eaRamName" maxlength="48" value="VeloDDR5 Stick"></label>' +
            '<label class="cpu-design-label">Listing price ($)<input id="eaRamPrice" type="number" min="1" step="1" value="95"></label>' +
            '<div class="ea-gpu-save-row">' +
              '<button class="primary-btn full" id="eaRamSaveBtn" type="button">Save as draft · Free</button>' +
              '<button class="zoom-btn hidden" id="eaRamCancelEdit" type="button">Cancel edit</button>' +
            '</div>' +
            '<p id="eaRamMessage" class="form-message"></p>' +
          '</div>' +
        '</div>';
      page.appendChild(panel);

      panel.querySelectorAll('[data-ram-menu]').forEach(b => b.addEventListener('click', () => setRamMenuTab(b.dataset.ramMenu)));
      panel.querySelector('#eaRamName')?.addEventListener('input', () => drawRamStage());
      panel.querySelector('#eaRamSaveBtn')?.addEventListener('click', () => saveRamProduct());
      panel.querySelector('#eaRamCancelEdit')?.addEventListener('click', () => {
        resetRamDraftState();
        renderRamMenus();
        drawRamStage();
      });
    }

    panel.classList.remove('hidden');
    renderRamMenus();
    syncRamSaveButtonUI();
    const stage = $('#eaRam3DStage');
    if (stage && window.RamDesigner3D?.mount) {
      window.RamDesigner3D.mount(stage).then(() => {
        drawRamStage();
        requestAnimationFrame(() => window.RamDesigner3D?.resize?.());
      });
    } else {
      drawRamStage();
    }
  }

  function hideRamWorkspace() {
    $('#eaRamPanel')?.classList.add('hidden');
    $('#eaRamResearchWrap')?.classList.add('hidden');
  }

  window.RamWorkspace = {
    isRam,
    mountRamWorkspace,
    hideRamWorkspace,
    mountRamResearch,
    mountRamProductsPage,
    renderRamProducts,
    resetRamDraftState
  };
})();
