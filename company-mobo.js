/* ============================================================
 * GRIND-EA · Motherboard Company Workspace
 * Research Tree (Board Sizes + RAM Slots) · 3D Motherboard Designer
 * Products Management · Reusable Helpers for Feed, Preview, & PC Builder
 * ============================================================ */
(function () {
  'use strict';

  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const MOBO_RESEARCH = [
    { key: 'mobo_medium_board', name: 'Medium Motherboard', cost: 75, value: 50, score: 8, line: 'board', size: 'medium', desc: 'ATX Form Factor (244×305mm) · Fits Medium & Large PCs' },
    { key: 'mobo_large_board', name: 'Large Motherboard', cost: 150, value: 80, score: 10, line: 'board', size: 'large', pre: 'mobo_medium_board', desc: 'E-ATX Form Factor (285×330mm) · Fits Large PCs' },
    { key: 'mobo_ram_1', name: '1 RAM Slot', cost: 200, value: 80, score: 8, line: 'ram', slots: 1, desc: 'Single-Channel DDR5 Slot (+80 Value · +8 Score)' },
    { key: 'mobo_ram_2', name: '2 RAM Slots', cost: 280, value: 100, score: 11, line: 'ram', slots: 2, pre: 'mobo_ram_1', desc: 'Dual-Channel DDR5 Slots (+100 Value · +11 Score)' },
    { key: 'mobo_ram_4', name: '4 RAM Slots', cost: 680, value: 280, score: 16, line: 'ram', slots: 4, pre: 'mobo_ram_2', desc: 'Quad-Slot DDR5 Array (+280 Value · +16 Score)' },
    { key: 'mobo_ram_6', name: '6 RAM Slots', cost: 1200, value: 640, score: 24, line: 'ram', slots: 6, pre: 'mobo_ram_4', desc: 'Workstation 6-Slot DDR5 (+640 Value · +24 Score)' }
  ];

  const BOARD_TIERS = {
    small: { label: 'Small (Mini-ITX · 170×170mm)', short: 'Small Mini-ITX', value: 25, score: 4, researchKey: null },
    medium: { label: 'Medium (ATX · 244×305mm)', short: 'Medium ATX', value: 50, score: 8, researchKey: 'mobo_medium_board' },
    large: { label: 'Large (E-ATX · 285×330mm)', short: 'Large E-ATX', value: 80, score: 10, researchKey: 'mobo_large_board' }
  };

  const RAM_TIERS = [
    { slots: 0, label: '0 RAM Slots (Base)', value: 0, score: 0, researchKey: null },
    { slots: 1, label: '1 RAM Slot (DDR5)', value: 80, score: 8, researchKey: 'mobo_ram_1' },
    { slots: 2, label: '2 RAM Slots (Dual DDR5)', value: 100, score: 11, researchKey: 'mobo_ram_2' },
    { slots: 4, label: '4 RAM Slots (4× DDR5)', value: 280, score: 16, researchKey: 'mobo_ram_4' },
    { slots: 6, label: '6 RAM Slots (6× DDR5)', value: 640, score: 24, researchKey: 'mobo_ram_6' }
  ];

  const PCB_PRESETS = [
    { hex: '#121620', label: 'Obsidian Black' },
    { hex: '#0f241c', label: 'Emerald Tech' },
    { hex: '#142238', label: 'Cobalt Blue' },
    { hex: '#2b1620', label: 'Crimson PCB' },
    { hex: '#e5e9f2', label: 'Arctic White' }
  ];
  const ARMOR_PRESETS = ['#1f2533', '#0d1017', '#cbd5e1', '#2c2238', '#332018'];
  const ACCENT_PRESETS = ['#a855f7', '#38bdf8', '#10b981', '#f59e0b', '#ef4444', '#e2e8f0'];

  const MOBO_THUMBS_LS_KEY = 'grind_mobo_thumbs_v1';

  let activeMenuTab = 'board'; // 'board' | 'ram' | 'vrm' | 'brand'
  let moboSize = 'small';
  let moboRamSlots = 0;
  let moboPcbColor = '#121620';
  let moboArmorColor = '#1f2533';
  let moboAccentColor = '#a855f7';
  let moboVrmStyle = 'finned'; // 'minimal' | 'finned' | 'armored'
  let moboIoShield = true;
  let moboM2Shield = true;
  let moboRgbAccent = false;

  let editingMoboProductId = null;
  let editingMoboOldName = '';
  let selectedMoboPageProductId = null;
  let moboThumbsCache = null;

  const isMobo = () => !!(currentCompany?.product_lines || []).includes('motherboard');
  const researched = k => !k || (companyResearchRows || []).some(x => x.research_key === k);
  const researchDef = k => MOBO_RESEARCH.find(r => r.key === k);
  const tierForScore = s => (typeof window.scoreToTier === 'function' ? window.scoreToTier(s) : (s >= 32 ? 'C' : s >= 16 ? 'D' : s >= 8 ? 'E' : 'F'));

  function isProductDraft(p) {
    const st = String(p?.status || '').trim().toLowerCase();
    return !st || st === 'draft';
  }

  function isMoboProductRow(p) {
    if (!p || typeof p !== 'object') return false;
    if (String(p.product_line || '').toLowerCase() === 'motherboard') return true;
    const d = p.design_data;
    return !!(d && typeof d === 'object' && (d.mobo_build === true || d.board_size));
  }

  function buildMoboConfigFromProduct(p) {
    const d = p?.design_data || {};
    const bSize = d.board_size || p?.body_type || 'small';
    const safeSize = BOARD_TIERS[bSize] ? bSize : 'small';
    return {
      boardSize: safeSize,
      ramSlots: Number(d.ram_slots ?? 0),
      pcbColor: d.pcb_color || '#121620',
      armorColor: d.armor_color || '#1f2533',
      accentColor: d.accent_color || '#a855f7',
      vrmStyle: d.vrm_style || 'finned',
      ioShield: d.io_shield !== false,
      m2Shield: d.m2_shield !== false,
      rgbAccent: !!d.rgb_accent,
      name: p?.product_name || 'Motherboard',
      companyName: p?.product_companies?.company_name || p?.company_name || '',
      logoUrl: p?.product_companies?.logo_data_url || p?.company_logo || '',
      score: Number(p?.cpu_score ?? d.score ?? 4)
    };
  }

  function getMoboProductScoreTier(p) {
    const d = p?.design_data || {};
    const bSize = BOARD_TIERS[d.board_size || p?.body_type] ? (d.board_size || p?.body_type) : 'small';
    const ramSlots = Number(d.ram_slots ?? 0);
    const bDef = BOARD_TIERS[bSize] || BOARD_TIERS.small;
    const rDef = RAM_TIERS.find(r => r.slots === ramSlots) || RAM_TIERS[0];
    const computedScore = bDef.score + rDef.score;
    const score = Number(p?.cpu_score || d.score || computedScore);
    const tier = p?.cpu_tier || d.tier || tierForScore(score);
    return { score, tier };
  }

  function formatMoboSpecLine(p) {
    const cfg = buildMoboConfigFromProduct(p);
    const bDef = BOARD_TIERS[cfg.boardSize] || BOARD_TIERS.small;
    const ramTxt = cfg.ramSlots > 0 ? (cfg.ramSlots + ' RAM Slot' + (cfg.ramSlots === 1 ? '' : 's')) : '0 RAM Slots';
    return bDef.short + ' · ' + ramTxt;
  }

  function formatMoboHardwareBadges(p) {
    const cfg = buildMoboConfigFromProduct(p);
    const bDef = BOARD_TIERS[cfg.boardSize] || BOARD_TIERS.small;
    const parts = [
      bDef.label,
      cfg.ramSlots + ' DDR5 Slot' + (cfg.ramSlots === 1 ? '' : 's'),
      cfg.vrmStyle === 'armored' ? 'Armored VRM Heatpipe' : cfg.vrmStyle === 'finned' ? 'Finned VRM Heatsink' : 'Minimal VRM',
      cfg.ioShield ? 'I/O Armor' : null,
      cfg.m2Shield ? 'M.2 Shield' : null,
      cfg.rgbAccent ? 'RGB Underglow' : null
    ].filter(Boolean);
    return parts.join(' · ');
  }

  // ---------- Thumbnails ----------
  function getMoboThumbsMap() {
    if (moboThumbsCache && typeof moboThumbsCache === 'object') return moboThumbsCache;
    try {
      const raw = localStorage.getItem(MOBO_THUMBS_LS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      moboThumbsCache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) { moboThumbsCache = {}; }
    return moboThumbsCache;
  }

  function saveMoboThumb(key, dataUrl) {
    if (!key || !dataUrl) return;
    const map = getMoboThumbsMap();
    map[key] = { dataUrl, ts: Date.now() };
    const entries = Object.entries(map).sort((a, b) => Number(b[1]?.ts || 0) - Number(a[1]?.ts || 0));
    if (entries.length > 40) moboThumbsCache = Object.fromEntries(entries.slice(0, 40));
    try { localStorage.setItem(MOBO_THUMBS_LS_KEY, JSON.stringify(moboThumbsCache)); } catch (_) {}
  }

  function getMoboThumb(p) {
    if (p?.design_data?.thumbnail) return p.design_data.thumbnail;
    const map = getMoboThumbsMap();
    return map[p?.id]?.dataUrl || map['name:' + (p?.product_name || '')]?.dataUrl || '';
  }

  function clearMoboThumb(key) {
    if (!key) return;
    const map = getMoboThumbsMap();
    if (map[key]) {
      delete map[key];
      try { localStorage.setItem(MOBO_THUMBS_LS_KEY, JSON.stringify(moboThumbsCache)); } catch (_) {}
    }
  }

  function applyMoboThumbToDom(id, name, dataUrl) {
    if (!id || !dataUrl) return;
    document.querySelectorAll('[data-mobo-thumb-id]').forEach(el => {
      if (el.dataset.moboThumbId !== String(id)) return;
      const alt = esc((name || 'Motherboard') + ' 3D preview');
      el.innerHTML = '<img class="cpu-thumb-img gpu-thumb-img" src="' + esc(dataUrl) + '" alt="' + alt + '">';
    });
  }

  function renderMoboThumbHtml(p) {
    const url = getMoboThumb(p);
    const alt = esc((p?.product_name || 'Motherboard') + ' 3D preview');
    if (url) return '<img class="cpu-thumb-img gpu-thumb-img" src="' + esc(url) + '" alt="' + alt + '">';
    return '<div class="cpu-thumb-loading" aria-label="Rendering 3D Motherboard preview"></div>';
  }

  function hydrateMoboThumbElements(rootEl, productsById, width = 360, height = 270) {
    if (!rootEl) return;
    rootEl.querySelectorAll('[data-mobo-thumb-id]').forEach(el => {
      const id = el.dataset.moboThumbId;
      if (!id) return;
      const prod = productsById instanceof Map ? productsById.get(id) : productsById?.[id];
      if (!prod) return;
      const cached = getMoboThumb(prod);
      if (cached) {
        if (!el.querySelector('img')) applyMoboThumbToDom(id, prod.product_name, cached);
        return;
      }
      if (el.dataset.moboThumbQueued === '1') return;
      if (typeof window.MoboDesigner3D?.enqueueThumbnail !== 'function') return;
      el.dataset.moboThumbQueued = '1';
      window.MoboDesigner3D.enqueueThumbnail(buildMoboConfigFromProduct(prod), dataUrl => {
        if (!dataUrl) return;
        saveMoboThumb(id, dataUrl);
        if (prod.product_name) saveMoboThumb('name:' + prod.product_name, dataUrl);
        applyMoboThumbToDom(id, prod.product_name, dataUrl);
      }, width, height);
    });
  }

  window.isMoboProductRow = isMoboProductRow;
  window.buildMoboConfigFromProduct = buildMoboConfigFromProduct;
  window.getMoboProductScoreTier = getMoboProductScoreTier;
  window.getMoboThumbUrl = getMoboThumb;
  window.renderMoboThumbHtml = renderMoboThumbHtml;
  window.hydrateMoboThumbElements = hydrateMoboThumbElements;
  window.formatMoboSpecLine = formatMoboSpecLine;
  window.formatMoboHardwareBadges = formatMoboHardwareBadges;
  window.clearMoboDraftArtifacts = function (id, name) {
    if (id) clearMoboThumb(id);
    if (name) clearMoboThumb('name:' + name);
    if (editingMoboProductId === id) {
      editingMoboProductId = null;
      editingMoboOldName = '';
      syncMoboSaveButtonUI();
    }
    if (selectedMoboPageProductId === id) selectedMoboPageProductId = null;
  };

  // ---------- Stats Calculation ----------
  function computeMoboStats() {
    if (BOARD_TIERS[moboSize]?.researchKey && !researched(BOARD_TIERS[moboSize].researchKey)) {
      moboSize = 'small';
    }
    const rTierCur = RAM_TIERS.find(r => r.slots === moboRamSlots);
    if (!rTierCur || (rTierCur.researchKey && !researched(rTierCur.researchKey))) {
      moboRamSlots = 0;
    }
    const bDef = BOARD_TIERS[moboSize] || BOARD_TIERS.small;
    const rDef = RAM_TIERS.find(r => r.slots === moboRamSlots) || RAM_TIERS[0];
    const value = bDef.value + rDef.value;
    const score = bDef.score + rDef.score;
    const tier = tierForScore(score);
    return { bDef, rDef, value, score, tier };
  }

  function currentMoboConfig() {
    const st = computeMoboStats();
    return {
      boardSize: moboSize,
      ramSlots: moboRamSlots,
      pcbColor: moboPcbColor,
      armorColor: moboArmorColor,
      accentColor: moboAccentColor,
      vrmStyle: moboVrmStyle,
      ioShield: moboIoShield,
      m2Shield: moboM2Shield,
      rgbAccent: moboRgbAccent,
      name: ($('#eaMoboName')?.value || 'CoreBoard M1').trim() || 'CoreBoard M1',
      companyName: currentCompany?.company_name || '',
      logoUrl: currentCompany?.logo_data_url || '',
      score: st.score
    };
  }

  function drawMoboStage() {
    const st = computeMoboStats();
    if ($('#eaMoboValueStat')) $('#eaMoboValueStat').textContent = '$' + st.value.toLocaleString();
    if ($('#eaMoboScoreStat')) $('#eaMoboScoreStat').textContent = st.score + ' · ' + st.tier + ' Tier';
    if ($('#eaMoboCaption')) {
      $('#eaMoboCaption').textContent = st.bDef.short + ' · ' + st.rDef.label + ' · Value $' + st.value.toLocaleString() + ' · Score ' + st.score;
    }
    window.MoboDesigner3D?.update?.(currentMoboConfig());
  }

  // ---------- Motherboard Research Tree (Exact User Specs) ----------
  function goToMoboResearch() {
    showPage('company');
    if (typeof switchCompanyDashboardTab === 'function') switchCompanyDashboardTab('research');
  }

  function renderMoboResearchTree() {
    const world = $('#eaMoboResearchWorld');
    if (!world) return;
    const LAYOUT = {
      __root: [480, 120, 'PCB', 'Base Small Motherboard', 'Free & Unlocked · Mini-ITX'],
      mobo_medium_board: [260, 380, 'ATX', 'Medium Motherboard'],
      mobo_large_board: [260, 660, 'EATX', 'Large Motherboard'],
      mobo_ram_1: [700, 380, '1×', '1 RAM Slot'],
      mobo_ram_2: [700, 620, '2×', '2 RAM Slots'],
      mobo_ram_4: [700, 860, '4×', '4 RAM Slots'],
      mobo_ram_6: [700, 1100, '6×', '6 RAM Slots']
    };
    const width = 960;
    const height = 1280;
    const rootInfo = LAYOUT.__root;

    const paths = MOBO_RESEARCH.map(r => {
      const A = r.pre && LAYOUT[r.pre] ? LAYOUT[r.pre] : rootInfo;
      const B = LAYOUT[r.key];
      if (!A || !B) return '';
      const mid = (A[1] + B[1]) / 2;
      return '<path d="M' + A[0] + ' ' + (A[1] + 65) + ' L' + A[0] + ' ' + mid + ' L' + B[0] + ' ' + mid + ' L' + B[0] + ' ' + (B[1] - 65) + '"/>';
    }).join('');

    const nodeHtml = (r, x, y, icon, yes, locked) => {
      const status = yes ? 'UNLOCKED' : locked ? 'LOCKED' : 'UNLOCK · $' + r.cost.toLocaleString();
      const subTxt = r.key === 'baseline_mobo'
        ? r.desc
        : '$' + r.cost.toLocaleString() + ' · Value ' + r.value + ' · Score ' + r.score;
      return '<button type="button" class="research-node ' + (yes ? 'researched' : locked ? 'prerequisite-locked' : 'available') +
        '" data-mobo-research-key="' + r.key + '" style="--node-x:' + x + 'px;--node-y:' + y + 'px" ' + (yes || locked ? 'disabled' : '') + '>' +
        '<span class="research-hex"><b>' + icon + '</b></span><strong>' + esc(r.name) + '</strong>' +
        '<small>' + esc(subTxt) + '</small>' +
        '<em class="research-node-status">' + status + '</em></button>';
    };

    world.style.width = width + 'px';
    world.style.height = height + 'px';
    world.innerHTML =
      '<svg class="research-tree-lines" viewBox="0 0 ' + width + ' ' + height + '">' + paths + '</svg>' +
      nodeHtml({ name: rootInfo[3], cost: 0, desc: rootInfo[4], key: 'baseline_mobo' }, rootInfo[0], rootInfo[1], rootInfo[2], true, false) +
      MOBO_RESEARCH.map(r => {
        const xy = LAYOUT[r.key] || rootInfo;
        const yes = researched(r.key);
        const locked = !!(r.pre && !researched(r.pre));
        return nodeHtml(r, xy[0], xy[1], xy[2] || 'MB', yes, locked);
      }).join('');

    world.querySelectorAll('[data-mobo-research-key]').forEach(b => b.addEventListener('click', () => unlockMoboResearch(b.dataset.moboResearchKey)));
  }

  function setupMoboResearchNav(tree) {
    if (!tree || tree.dataset.navigationReady) return;
    tree.dataset.navigationReady = '1';
    const world = tree.querySelector('.research-tree-world');
    if (!world) return;
    const centerX = 480;
    let zoom = 0.72, panX = (tree.clientWidth || 720) / 2 - centerX * zoom, panY = 14, dragging = false, sx = 0, sy = 0, bx = 0, by = 0;
    const paint = () => { world.style.transform = 'translate(' + panX + 'px,' + panY + 'px) scale(' + zoom + ')'; };
    tree.addEventListener('pointerdown', e => {
      if (e.target.closest('button[data-mobo-research-key],.research-tree-controls')) return;
      dragging = true; sx = e.clientX; sy = e.clientY; bx = panX; by = panY;
      tree.classList.add('dragging'); tree.setPointerCapture(e.pointerId);
    });
    tree.addEventListener('pointermove', e => { if (!dragging) return; panX = bx + e.clientX - sx; panY = by + e.clientY - sy; paint(); });
    const stop = () => { dragging = false; tree.classList.remove('dragging'); };
    tree.addEventListener('pointerup', stop);
    tree.addEventListener('pointercancel', stop);
    tree.querySelectorAll('[data-mobo-zoom]').forEach(b => b.addEventListener('click', () => {
      const a = b.dataset.moboZoom;
      if (a === 'reset') { zoom = 0.72; panX = (tree.clientWidth || 720) / 2 - centerX * zoom; panY = 14; }
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

  async function unlockMoboResearch(key) {
    if (!currentCompany || !currentUser || !sb || !key || key === 'baseline_mobo') return;
    if (researched(key)) return;
    const def = researchDef(key);
    const msgEl = $('#eaMoboResearchMessage');
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
    renderMoboResearchTree();
    renderMoboMenus();
    drawMoboStage();
    updateUIProfile?.();
    if (msgEl) msgEl.textContent = def.name + ' unlocked!';
    if (typeof playSound === 'function') playSound('upload');
    toast(def.name + ' unlocked!');
  }

  function mountMoboResearch() {
    const section = $('#companyPanelResearch .research-section');
    if (!section) return;
    let wrap = $('#eaMoboResearchWrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'eaMoboResearchWrap';
      wrap.className = 'ea-company-research hidden';
      wrap.innerHTML =
        '<div id="eaMoboResearchTree" class="research-tree"><div id="eaMoboResearchWorld" class="research-tree-world"></div><div class="research-tree-controls"><button type="button" data-mobo-zoom="out">−</button><button type="button" data-mobo-zoom="reset">Reset</button><button type="button" data-mobo-zoom="in">+</button></div></div>' +
        '<p id="eaMoboResearchMessage" class="form-message"></p>';
      section.insertBefore(wrap, $('#cpuResearchTree') || null);
      setupMoboResearchNav($('#eaMoboResearchTree'));
    }
    const active = isMobo();
    wrap.classList.toggle('hidden', !active);
    if (active) {
      $('#cpuResearchTree')?.classList.add('hidden');
      $('#eaCompanyResearch')?.classList.add('hidden');
      $('#eaPcResearchWrap')?.classList.add('hidden');
      const eyebrow = section.querySelector('.company-section-heading .eyebrow');
      const heading = section.querySelector('.company-section-heading h4');
      const chip = section.querySelector('.company-count-chip');
      const description = section.querySelector('.company-section-heading p');
      if (eyebrow) eyebrow.textContent = 'MOTHERBOARD R&D';
      if (heading) heading.textContent = 'Motherboard Form Factors & RAM Slots';
      if (description) description.textContent = 'Unlock ATX & E-ATX motherboard form factors and DDR5 memory slot configurations.';
      if (chip) chip.textContent = 'MOBO RESEARCH';
      renderMoboResearchTree();
    }
  }

  // ---------- Designer Menus ----------
  function setMoboMenuTab(tab) {
    activeMenuTab = ['board', 'ram', 'vrm', 'brand'].includes(tab) ? tab : 'board';
    document.querySelectorAll('[data-mobo-menu]').forEach(b => b.classList.toggle('active', b.dataset.moboMenu === activeMenuTab));
    ['board', 'ram', 'vrm', 'brand'].forEach(t => {
      $('#eaMoboMenu_' + t)?.classList.toggle('hidden', t !== activeMenuTab);
    });
  }

  function renderMoboBoardMenu() {
    const wrap = $('#eaMoboMenu_board');
    if (!wrap) return;
    computeMoboStats();
    const sizeCards = Object.entries(BOARD_TIERS).map(([id, meta]) => {
      const ok = researched(meta.researchKey);
      const sel = moboSize === id;
      return '<div class="cpu-component-option ' + (ok ? '' : 'locked') + ' ' + (sel ? 'selected' : '') + '">' +
        '<span class="cpu-component-icon">▦</span>' +
        '<span><strong>' + esc(meta.label) + '</strong><small>' + (ok ? 'Board Value $' + meta.value + ' · +' + meta.score + ' Score' : 'Research required') + '</small></span>' +
        '<button type="button" class="zoom-btn" ' + (ok ? 'data-mobo-size="' + id + '"' : 'data-mobo-go-research="1"') + '>' + (ok ? (sel ? 'Selected' : 'Use') : 'Research') + '</button>' +
        '</div>';
    }).join('');

    const pcbSwatches = PCB_PRESETS.map(p =>
      '<button type="button" class="ea-swatch-btn' + (moboPcbColor.toLowerCase() === p.hex.toLowerCase() ? ' active' : '') + '" data-mobo-pcb="' + p.hex + '" title="' + esc(p.label) + '" style="background:' + p.hex + '"></button>'
    ).join('');

    wrap.innerHTML =
      '<h4>Board Size</h4>' + sizeCards +
      '<h4 style="margin-top:12px">PCB Substrate Finish</h4>' +
      '<div class="ea-gpu-inline-box"><span>Solder Mask Color</span><div class="ea-gpu-swatches">' + pcbSwatches + '<input id="eaMoboPcbColor" type="color" value="' + esc(moboPcbColor) + '"></div></div>';

    wrap.querySelectorAll('[data-mobo-size]').forEach(b => b.addEventListener('click', () => {
      moboSize = b.dataset.moboSize;
      renderMoboBoardMenu();
      drawMoboStage();
    }));
    wrap.querySelectorAll('[data-mobo-go-research]').forEach(b => b.addEventListener('click', goToMoboResearch));
    wrap.querySelectorAll('[data-mobo-pcb]').forEach(b => b.addEventListener('click', () => {
      moboPcbColor = b.dataset.moboPcb;
      renderMoboBoardMenu();
      drawMoboStage();
    }));
    wrap.querySelector('#eaMoboPcbColor')?.addEventListener('input', e => { moboPcbColor = e.target.value; drawMoboStage(); });
  }

  function renderMoboRamMenu() {
    const wrap = $('#eaMoboMenu_ram');
    if (!wrap) return;
    computeMoboStats();
    const cards = RAM_TIERS.map(rt => {
      const ok = researched(rt.researchKey);
      const sel = moboRamSlots === rt.slots;
      return '<div class="cpu-component-option ' + (ok ? '' : 'locked') + ' ' + (sel ? 'selected' : '') + '">' +
        '<span class="cpu-component-icon">▤</span>' +
        '<span><strong>' + esc(rt.label) + '</strong><small>' + (ok ? (rt.slots ? '+$' + rt.value + ' Value · +' + rt.score + ' Score' : 'Baseline Starter · Free') : 'Research required') + '</small></span>' +
        '<button type="button" class="zoom-btn" ' + (ok ? 'data-mobo-ram="' + rt.slots + '"' : 'data-mobo-go-research="1"') + '>' + (ok ? (sel ? 'Selected' : 'Use') : 'Research') + '</button>' +
        '</div>';
    }).join('');
    wrap.innerHTML = '<h4>DDR5 Memory Slots</h4>' + cards;
    wrap.querySelectorAll('[data-mobo-ram]').forEach(b => b.addEventListener('click', () => {
      moboRamSlots = Number(b.dataset.moboRam || 0);
      renderMoboRamMenu();
      drawMoboStage();
    }));
    wrap.querySelectorAll('[data-mobo-go-research]').forEach(b => b.addEventListener('click', goToMoboResearch));
  }

  function renderMoboVrmMenu() {
    const wrap = $('#eaMoboMenu_vrm');
    if (!wrap) return;
    const styles = [
      ['minimal', 'Minimal Aluminum'],
      ['finned', 'Finned Heatsinks'],
      ['armored', 'Armored Heatpipe']
    ].map(([id, lbl]) =>
      '<button type="button" class="zoom-btn' + (moboVrmStyle === id ? ' active' : '') + '" data-mobo-vrm="' + id + '">' + lbl + '</button>'
    ).join('');

    const armorSwatches = ARMOR_PRESETS.map(hex =>
      '<button type="button" class="ea-swatch-btn' + (moboArmorColor.toLowerCase() === hex ? ' active' : '') + '" data-mobo-armor="' + hex + '" style="background:' + hex + '"></button>'
    ).join('');

    wrap.innerHTML =
      '<h4>VRM &amp; Heatsink Architecture</h4>' +
      '<div class="ea-gpu-inline-box"><span>VRM Cooling Design</span><div class="ea-gpu-pill-row ea-gpu-pill-wrap">' + styles + '</div></div>' +
      '<div class="ea-gpu-inline-box"><span>Armor &amp; Heatsink Metal</span><div class="ea-gpu-swatches">' + armorSwatches + '<input id="eaMoboArmorColor" type="color" value="' + esc(moboArmorColor) + '"></div></div>' +
      '<div class="cpu-component-option ' + (moboIoShield ? 'selected' : '') + '" style="margin-top:8px;">' +
        '<span class="cpu-component-icon">▣</span>' +
        '<span><strong>Integrated Rear I/O Armor</strong><small>Brushed metal port shroud over USB/LAN/Audio stack</small></span>' +
        '<button type="button" class="zoom-btn" id="eaMoboToggleIo">' + (moboIoShield ? 'Included' : 'Minimal') + '</button>' +
      '</div>' +
      '<div class="cpu-component-option ' + (moboM2Shield ? 'selected' : '') + '">' +
        '<span class="cpu-component-icon">▭</span>' +
        '<span><strong>M.2 NVMe Thermal Shield</strong><small>Machined heatsink plate above PCIe x16</small></span>' +
        '<button type="button" class="zoom-btn" id="eaMoboToggleM2">' + (moboM2Shield ? 'Included' : 'Exposed') + '</button>' +
      '</div>';

    wrap.querySelectorAll('[data-mobo-vrm]').forEach(b => b.addEventListener('click', () => {
      moboVrmStyle = b.dataset.moboVrm;
      renderMoboVrmMenu();
      drawMoboStage();
    }));
    wrap.querySelectorAll('[data-mobo-armor]').forEach(b => b.addEventListener('click', () => {
      moboArmorColor = b.dataset.moboArmor;
      renderMoboVrmMenu();
      drawMoboStage();
    }));
    wrap.querySelector('#eaMoboArmorColor')?.addEventListener('input', e => { moboArmorColor = e.target.value; drawMoboStage(); });
    wrap.querySelector('#eaMoboToggleIo')?.addEventListener('click', () => { moboIoShield = !moboIoShield; renderMoboVrmMenu(); drawMoboStage(); });
    wrap.querySelector('#eaMoboToggleM2')?.addEventListener('click', () => { moboM2Shield = !moboM2Shield; renderMoboVrmMenu(); drawMoboStage(); });
  }

  function renderMoboBrandMenu() {
    const wrap = $('#eaMoboMenu_brand');
    if (!wrap) return;
    const accSwatches = ACCENT_PRESETS.map(hex =>
      '<button type="button" class="ea-swatch-btn' + (moboAccentColor.toLowerCase() === hex ? ' active' : '') + '" data-mobo-acc="' + hex + '" style="background:' + hex + '"></button>'
    ).join('');

    wrap.innerHTML =
      '<h4>Accents &amp; Silkscreen Branding</h4>' +
      '<div class="ea-gpu-inline-box"><span>Silkscreen &amp; Latch Accent Color</span><div class="ea-gpu-swatches">' + accSwatches + '<input id="eaMoboAccentColor" type="color" value="' + esc(moboAccentColor) + '"></div></div>' +
      '<div class="cpu-component-option ' + (moboRgbAccent ? 'selected' : '') + '" style="margin-top:8px;">' +
        '<span class="cpu-component-icon">✦</span>' +
        '<span><strong>PCB Accent Underglow</strong><small>Illuminates VRM trim, M.2 badge, and right-edge LED strip</small></span>' +
        '<button type="button" class="zoom-btn" id="eaMoboToggleRgb">' + (moboRgbAccent ? 'On' : 'Off') + '</button>' +
      '</div>';

    wrap.querySelectorAll('[data-mobo-acc]').forEach(b => b.addEventListener('click', () => {
      moboAccentColor = b.dataset.moboAcc;
      renderMoboBrandMenu();
      drawMoboStage();
    }));
    wrap.querySelector('#eaMoboAccentColor')?.addEventListener('input', e => { moboAccentColor = e.target.value; drawMoboStage(); });
    wrap.querySelector('#eaMoboToggleRgb')?.addEventListener('click', () => { moboRgbAccent = !moboRgbAccent; renderMoboBrandMenu(); drawMoboStage(); });
  }

  function renderMoboMenus() {
    renderMoboBoardMenu();
    renderMoboRamMenu();
    renderMoboVrmMenu();
    renderMoboBrandMenu();
  }

  // ---------- Save / Edit Draft ----------
  function syncMoboSaveButtonUI() {
    const saveBtn = $('#eaMoboSaveBtn');
    const cancelBtn = $('#eaMoboCancelEdit');
    if (saveBtn) saveBtn.textContent = editingMoboProductId ? 'Save edits · Free' : 'Save as draft · Free';
    if (cancelBtn) cancelBtn.classList.toggle('hidden', !editingMoboProductId);
  }

  function resetMoboDraftState() {
    moboSize = 'small';
    moboRamSlots = 0;
    moboPcbColor = '#121620';
    moboArmorColor = '#1f2533';
    moboAccentColor = '#a855f7';
    moboVrmStyle = 'finned';
    moboIoShield = true;
    moboM2Shield = true;
    moboRgbAccent = false;
    editingMoboProductId = null;
    editingMoboOldName = '';
    if ($('#eaMoboName')) $('#eaMoboName').value = 'CoreBoard M1';
    if ($('#eaMoboPrice')) $('#eaMoboPrice').value = '160';
    if ($('#eaMoboMessage')) $('#eaMoboMessage').textContent = '';
    syncMoboSaveButtonUI();
  }

  async function saveMoboProduct() {
    if (!currentCompany || !currentUser || !sb) return;
    const name = ($('#eaMoboName')?.value || '').trim();
    const msgEl = $('#eaMoboMessage');
    if (name.length < 2) { if (msgEl) msgEl.textContent = 'Enter a motherboard name (at least 2 characters).'; return; }

    const { bDef, rDef, value, score, tier } = computeMoboStats();
    if (bDef.researchKey && !researched(bDef.researchKey)) { toast('Research ' + bDef.label + ' first.'); return; }
    if (rDef.researchKey && !researched(rDef.researchKey)) { toast('Research ' + rDef.label + ' first.'); return; }

    const listedPrice = Math.max(1, Number($('#eaMoboPrice')?.value) || 1);
    const cfg = currentMoboConfig();

    let snapshot = window.MoboDesigner3D?.captureSnapshot?.({ width: 360, height: 270 }) || '';
    if (!snapshot && typeof window.MoboDesigner3D?.captureHeroSnapshot === 'function') {
      snapshot = await window.MoboDesigner3D.captureHeroSnapshot(cfg, 360, 270);
    }

    const designData = {
      mobo_build: true,
      board_size: moboSize,
      ram_slots: moboRamSlots,
      pcb_color: moboPcbColor,
      armor_color: moboArmorColor,
      accent_color: moboAccentColor,
      vrm_style: moboVrmStyle,
      io_shield: moboIoShield,
      m2_shield: moboM2Shield,
      rgb_accent: moboRgbAccent,
      score,
      tier,
      thumbnail: snapshot || ''
    };

    const wasEditingId = editingMoboProductId;
    const oldName = editingMoboOldName;
    const saveBtn = $('#eaMoboSaveBtn');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = wasEditingId ? 'Saving edits…' : 'Saving…'; }

    let data = null;
    let error = null;

    const rpcRes = await sb.rpc('save_mobo_product_draft', {
      p_product_id: wasEditingId || null,
      p_company_id: currentCompany.id,
      p_product_name: name,
      p_body_type: moboSize,
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
            body_type: moboSize,
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
          product_line: 'motherboard',
          product_name: name,
          body_type: moboSize,
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
      if (msgEl) msgEl.textContent = 'Could not save motherboard draft: ' + error.message;
      syncMoboSaveButtonUI();
      return;
    }

    const savedId = data?.id || wasEditingId;
    if (oldName && oldName !== name) clearMoboThumb('name:' + oldName);
    if (snapshot) {
      if (savedId) saveMoboThumb(savedId, snapshot);
      saveMoboThumb('name:' + name, snapshot);
      if (savedId) applyMoboThumbToDom(savedId, name, snapshot);
    }

    editingMoboProductId = null;
    editingMoboOldName = '';
    if (savedId) {
      selectedCompanyProductId = savedId;
      selectedMoboPageProductId = savedId;
    }
    syncMoboSaveButtonUI();
    if (msgEl) msgEl.textContent = wasEditingId ? 'Motherboard updated!' : 'Motherboard saved as draft! Publish it from Products.';
    toast(wasEditingId ? 'Motherboard updated!' : 'Motherboard draft saved!');
    await loadCompanyResearchAndProducts();
    renderMoboProducts();
    if (typeof renderCompanyProducts === 'function') renderCompanyProducts();
  }

  function loadMoboDraftIntoEditor(p) {
    if (!p) { toast('Motherboard not found.'); return; }
    const d = p.design_data || {};
    moboSize = BOARD_TIERS[d.board_size || p.body_type] ? (d.board_size || p.body_type) : 'small';
    moboRamSlots = Number(d.ram_slots ?? 0);
    moboPcbColor = d.pcb_color || '#121620';
    moboArmorColor = d.armor_color || '#1f2533';
    moboAccentColor = d.accent_color || '#a855f7';
    moboVrmStyle = d.vrm_style || 'finned';
    moboIoShield = d.io_shield !== false;
    moboM2Shield = d.m2_shield !== false;
    moboRgbAccent = !!d.rgb_accent;
    editingMoboProductId = p.id;
    editingMoboOldName = p.product_name || '';

    showPage('company-design');
    mountMoboWorkspace();
    if ($('#eaMoboName')) $('#eaMoboName').value = p.product_name || 'CoreBoard M1';
    if ($('#eaMoboPrice')) $('#eaMoboPrice').value = String(Math.max(1, Number(p.listed_price || 160)));
    if ($('#eaMoboMessage')) $('#eaMoboMessage').textContent = 'Editing motherboard "' + (p.product_name || 'Motherboard') + '".';
    renderMoboMenus();
    syncMoboSaveButtonUI();
    drawMoboStage();
    toast('Loaded motherboard into designer.');
  }

  window.editMoboDraftProduct = function (id) {
    const p = (companyProducts || []).find(x => x.id === id);
    if (p) loadMoboDraftIntoEditor(p);
  };

  // ---------- Motherboard Products Page ----------
  function mountMoboProductsPage() {
    const page = $('#page-company-products');
    if (!page) return;
    page.innerHTML =
      '<div class="section-head"><div><div class="eyebrow purple-text">MOTHERBOARD MANUFACTURING</div><h3>Motherboards</h3><p class="muted">Select a motherboard to inspect specs, edit drafts, publish to the marketplace, or produce stock for PC builders.</p></div></div>' +
      '<div id="eaMoboProductList" class="ea-gpu-product-grid"></div>' +
      '<div id="eaMoboProductDetails" class="company-product-details hidden"></div>';
  }

  function renderMoboProducts() {
    if (!isMobo()) return;
    const el = $('#eaMoboProductList');
    const detailEl = $('#eaMoboProductDetails');
    if (!el) return;
    const rows = (companyProducts || []).filter(p => isMoboProductRow(p));
    if (!rows.length) {
      el.innerHTML = '<div class="company-empty-products"><span>▦</span><strong>No motherboards yet</strong><p class="muted">Design your first motherboard in Design.</p></div>';
      detailEl?.classList.add('hidden');
      return;
    }
    if (!selectedMoboPageProductId || !rows.some(r => r.id === selectedMoboPageProductId)) {
      selectedMoboPageProductId = rows[0].id;
    }
    const byId = new Map();
    el.innerHTML = rows.map(p => {
      byId.set(p.id, p);
      const draft = isProductDraft(p);
      const active = p.id === selectedMoboPageProductId;
      const st = getMoboProductScoreTier(p);
      return (
        '<article class="ea-chip-card ea-gpu-product-card' + (active ? ' active' : '') + '" data-ea-mobo-select="' + esc(p.id) + '" tabindex="0" role="button">' +
          '<div class="ea-gpu-product-thumb-wrap" data-mobo-thumb-id="' + esc(p.id) + '">' + renderMoboThumbHtml(p) + '</div>' +
          '<b>' + esc(p.product_name || 'Motherboard') + '</b>' +
          '<small>' + esc(formatMoboSpecLine(p)) + ' · ' + st.score + ' Score (' + esc(st.tier) + ')</small>' +
          '<small>$' + Number(p.listed_price || 0).toLocaleString() + ' · ' + (draft ? 'Draft' : 'Published · Stock: ' + Number(p.stock || 0)) + '</small>' +
        '</article>'
      );
    }).join('');
    hydrateMoboThumbElements(el, byId, 360, 270);

    el.querySelectorAll('[data-ea-mobo-select]').forEach(card => {
      card.addEventListener('click', () => {
        selectedMoboPageProductId = card.dataset.eaMoboSelect;
        renderMoboProducts();
      });
    });

    const selected = rows.find(r => r.id === selectedMoboPageProductId);
    if (!detailEl || !selected) { detailEl?.classList.add('hidden'); return; }
    const draft = isProductDraft(selected);
    const canEdit = selected.owner_id === currentUser?.id;
    const unitValue = Math.max(0, Number(selected.product_value ?? selected.production_cost ?? 0));
    const stockCount = Number(selected.stock || 0);
    const st = getMoboProductScoreTier(selected);

    const produceBlock = draft
      ? '<p class="muted tiny" style="margin:4px 0 0;">Publish this draft before producing units.</p>'
      : '<label>Produce quantity (costs $' + unitValue.toLocaleString() + '/unit)<input id="eaMoboProduceQty" type="number" min="1" max="100000" value="1"></label>' +
        '<div class="company-product-details-actions">' +
          '<button type="button" class="primary-btn" id="eaMoboProduceBtn">Produce 1 · $' + unitValue.toLocaleString() + '</button>' +
          '<button type="button" class="danger-btn" id="eaMoboLiquidateBtn" ' + (stockCount > 0 ? '' : 'disabled') + '>Delete stock · 50% refund</button>' +
        '</div>';

    detailEl.classList.remove('hidden');
    detailEl.innerHTML =
      '<div class="company-product-detail-hero">' +
        '<div class="company-product-detail-thumb company-product-detail-thumb-gpu" data-mobo-thumb-id="' + esc(selected.id) + '">' + renderMoboThumbHtml(selected) + '</div>' +
        '<div class="company-product-detail-title"><h4>' + esc(selected.product_name || 'Motherboard') + '</h4>' +
        '<p class="muted tiny">' + (draft ? 'Draft (Not yet published)' : 'Published on Product Feed') + '</p>' +
        '<small class="company-product-detail-specs">' + esc(formatMoboHardwareBadges(selected)) + '</small></div>' +
      '</div>' +
      '<div class="company-product-detail-grid">' +
        '<div class="company-product-detail-stat"><span>Build value / unit</span><strong>$' + unitValue.toLocaleString() + '</strong></div>' +
        '<div class="company-product-detail-stat"><span>Score / Tier</span><strong>' + st.score + ' · ' + esc(st.tier) + '</strong></div>' +
        '<div class="company-product-detail-stat"><span>Stock</span><strong>' + (stockCount > 0 ? stockCount : 'Out Of Stock') + '</strong></div>' +
        '<div class="company-product-detail-stat"><span>Units sold</span><strong>' + Number(selected.purchase_count || 0) + '</strong></div>' +
      '</div>' +
      '<label>Listing price ($)<input id="eaMoboDetailPrice" type="number" min="1" value="' + Number(selected.listed_price || 1) + '"></label>' +
      produceBlock +
      '<div class="company-product-details-actions">' +
        '<button type="button" class="zoom-btn" id="eaMoboDetailPreview">👁 Preview</button>' +
        (canEdit ? '<button type="button" class="primary-btn" id="eaMoboDetailEdit">Edit</button>' : '') +
        '<button type="button" class="zoom-btn" id="eaMoboDetailSavePrice">Save price</button>' +
        (draft ? '<button type="button" class="primary-btn" id="eaMoboDetailPublish">Publish Motherboard</button><button type="button" class="danger-btn" id="eaMoboDetailDeleteDraft">Delete draft</button>' : '') +
      '</div>' +
      '<p class="form-message" id="eaMoboDetailMessage"></p>';

    hydrateMoboThumbElements(detailEl, new Map([[selected.id, selected]]), 360, 270);
    const msgEl = $('#eaMoboDetailMessage');
    if (!draft) {
      const qtyInput = $('#eaMoboProduceQty');
      const prodBtn = $('#eaMoboProduceBtn');
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
      $('#eaMoboLiquidateBtn')?.addEventListener('click', () => window.liquidateProductStock?.(selected.id, msgEl));
    }
    $('#eaMoboDetailPreview')?.addEventListener('click', () => window.openProductPreview?.(selected, currentCompany?.company_name));
    $('#eaMoboDetailEdit')?.addEventListener('click', () => loadMoboDraftIntoEditor(selected));
    $('#eaMoboDetailDeleteDraft')?.addEventListener('click', () => window.deleteDraftProduct?.(selected.id, msgEl));
    const saveOrPublish = async publish => {
      const amount = Number($('#eaMoboDetailPrice')?.value || 0);
      if (!Number.isFinite(amount) || amount <= 0) { if (msgEl) msgEl.textContent = 'Enter a valid price.'; return; }
      const result = await sb.rpc('update_cpu_product_listing', { p_product_id: selected.id, p_listed_price: amount, p_publish: publish });
      if (result.error) { if (msgEl) msgEl.textContent = result.error.message; return; }
      await loadCompanyResearchAndProducts();
      renderMoboProducts();
      if (typeof renderCompanyProducts === 'function') renderCompanyProducts();
      toast(publish ? 'Motherboard published to Product Feed!' : 'Motherboard price updated.');
    };
    $('#eaMoboDetailSavePrice')?.addEventListener('click', () => saveOrPublish(false));
    $('#eaMoboDetailPublish')?.addEventListener('click', () => saveOrPublish(true));
  }
  window.renderEaMoboProducts = renderMoboProducts;

  // ---------- Mount / Hide Workspace ----------
  function mountMoboWorkspace() {
    if (!isMobo()) return;
    $('#page-company-design #cpuDesigner')?.classList.add('hidden');
    $('#page-company-design #eaGpuPanel')?.classList.add('hidden');
    $('#page-company-design #eaPcPanel')?.classList.add('hidden');
    $('#page-company-design #companyDesignNoCompany')?.classList.add('hidden');

    const page = $('#page-company-design');
    if (!page) return;
    let panel = $('#eaMoboPanel');
    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'eaMoboPanel';
      panel.className = 'company-dashboard-section ea-gpu-panel';
      panel.innerHTML =
        '<div class="cpu-designer-layout ea-gpu-layout-match">' +
          '<div class="cpu-preview-panel">' +
            '<div class="cpu-preview-toolbar"><span>3D MOTHERBOARD STUDIO</span><small>Drag to orbit · Scroll to zoom · Explode layers</small></div>' +
            '<div id="eaMobo3DStage" class="ea-pc-3d-stage"><div class="gpu-3d-loading">Loading 3D Motherboard CAD…</div></div>' +
            '<div id="eaMoboCaption" class="cpu-preview-caption">Small Mini-ITX · 0 RAM Slots · Value $25</div>' +
          '</div>' +
          '<div class="cpu-options-panel ea-gpu-sidebar">' +
            '<div class="cpu-menu-tabs ea-gpu-menu-tabs" role="tablist">' +
              '<button type="button" class="active" data-mobo-menu="board">Board</button>' +
              '<button type="button" data-mobo-menu="ram">RAM Slots</button>' +
              '<button type="button" data-mobo-menu="vrm">VRM/I/O</button>' +
              '<button type="button" data-mobo-menu="brand">Branding</button>' +
            '</div>' +
            '<div id="eaMoboMenu_board" class="cpu-menu-content"></div>' +
            '<div id="eaMoboMenu_ram" class="cpu-menu-content hidden"></div>' +
            '<div id="eaMoboMenu_vrm" class="cpu-menu-content hidden"></div>' +
            '<div id="eaMoboMenu_brand" class="cpu-menu-content hidden"></div>' +
            '<div class="cpu-design-summary">' +
              '<div><span>Build Value</span><strong id="eaMoboValueStat">$25</strong></div>' +
              '<div><span>Score / Tier</span><strong id="eaMoboScoreStat">4 · F Tier</strong></div>' +
            '</div>' +
            '<label class="cpu-design-label">Motherboard name<input id="eaMoboName" maxlength="48" value="CoreBoard M1"></label>' +
            '<label class="cpu-design-label">Listing price ($)<input id="eaMoboPrice" type="number" min="1" step="1" value="160"></label>' +
            '<div class="ea-gpu-save-row">' +
              '<button class="primary-btn full" id="eaMoboSaveBtn" type="button">Save as draft · Free</button>' +
              '<button class="zoom-btn hidden" id="eaMoboCancelEdit" type="button">Cancel edit</button>' +
            '</div>' +
            '<p id="eaMoboMessage" class="form-message"></p>' +
          '</div>' +
        '</div>';
      page.appendChild(panel);

      panel.querySelectorAll('[data-mobo-menu]').forEach(b => b.addEventListener('click', () => setMoboMenuTab(b.dataset.moboMenu)));
      panel.querySelector('#eaMoboName')?.addEventListener('input', () => drawMoboStage());
      panel.querySelector('#eaMoboSaveBtn')?.addEventListener('click', () => saveMoboProduct());
      panel.querySelector('#eaMoboCancelEdit')?.addEventListener('click', () => {
        resetMoboDraftState();
        renderMoboMenus();
        drawMoboStage();
      });
    }

    panel.classList.remove('hidden');
    renderMoboMenus();
    syncMoboSaveButtonUI();
    const stage = $('#eaMobo3DStage');
    if (stage && window.MoboDesigner3D?.mount) {
      window.MoboDesigner3D.mount(stage).then(() => {
        drawMoboStage();
        requestAnimationFrame(() => window.MoboDesigner3D?.resize?.());
      });
    } else {
      drawMoboStage();
    }
  }

  function hideMoboWorkspace() {
    $('#eaMoboPanel')?.classList.add('hidden');
    $('#eaMoboResearchWrap')?.classList.add('hidden');
  }

  window.MoboWorkspace = {
    mountMoboWorkspace,
    hideMoboWorkspace,
    mountMoboResearch,
    mountMoboProductsPage,
    renderMoboProducts,
    resetMoboDraftState
  };
})();
