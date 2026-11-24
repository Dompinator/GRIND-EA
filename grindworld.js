(() => {
  'use strict';

  const DAY_MS = 24 * 60 * 60 * 1000;
  const ACTIVE_MS = 2 * DAY_MS; // 48 hours (2 days) before inactive purchase/investment cables expire
  const BURST_LIFETIME_MS = 6500;
  const FRESH_LIVE_MS = 60 * 1000;

  const state = {
    nodes: [],
    edges: [],
    nodeById: new Map(),
    edgesByNode: new Map(),
    feedItems: [],
    bursts: [],
    ripples: [],
    images: new Map(),
    minZoom: 0.08,
    camera: { x: 0, y: 0, zoom: 1 },
    cameraAnim: null,
    world: { width: 1200, height: 800 },
    canvas: null,
    ctx: null,
    width: 0,
    height: 0,
    dpr: 1,
    raf: 0,
    loading: false,
    loaded: false,
    realtime: null,
    refreshTimer: null,
    pollTimer: null,
    resizeObserver: null,
    pointer: null,
    selectedId: null,
    hoveredId: null,
    filter: 'all',
    lastLoadedAt: 0,
    seenRealtimeKeys: new Set()
  };

  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));

  const safeRows = async query => {
    try {
      const result = await query;
      if (result?.error) {
        console.warn('GrindWorld data source:', result.error.message || result.error);
        return [];
      }
      return result?.data || [];
    } catch (error) {
      console.warn('GrindWorld data source:', error);
      return [];
    }
  };

  const hash = value => {
    let h = 2166136261;
    for (const ch of String(value || '')) {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };

  const hueFor = id => hash(id) % 360;
  const colorFor = id => 'hsl(' + hueFor(id) + ' 78% 63%)';
  const validHex = value => /^#[0-9a-fA-F]{6}$/.test(String(value || ''));
  const rgba = (hex, alpha) => {
    const value = validHex(hex) ? hex.slice(1) : 'a78bfa';
    const n = parseInt(value, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
  };

  const isRecent = ts => {
    const t = ts ? new Date(ts).getTime() : 0;
    return t > 0 && Date.now() - t <= ACTIVE_MS;
  };

  const formatAge = ts => {
    const sec = Math.max(1, Math.floor((Date.now() - ts) / 1000));
    if (sec < 60) return sec + 's';
    const min = Math.floor(sec / 60);
    if (min < 60) return min + 'm';
    const hr = Math.floor(min / 60);
    if (hr < 48) return hr + 'h';
    return Math.floor(hr / 24) + 'd';
  };

  const formatMoney = n => {
    const val = Number(n || 0);
    if (!Number.isFinite(val) || val <= 0) return '';
    if (val >= 1e6) return '$' + (val / 1e6).toFixed(2) + 'M';
    if (val >= 1e3) return '$' + (val / 1e3).toFixed(1) + 'k';
    return '$' + Math.round(val).toLocaleString();
  };

  function edgeVisualMeta(edge) {
    switch (edge.type) {
      case 'product-buy':
        return { stroke: '#fbbf24', pulse: '#fef08a', glow: '#f59e0b', label: 'Bought' };
      case 'company-buy':
        return { stroke: '#38bdf8', pulse: '#bae6fd', glow: '#0ea5e9', label: 'Invested' };
      case 'coin-buy':
        return { stroke: '#34d399', pulse: '#a7f3d0', glow: '#10b981', label: 'Traded' };
      case 'component-use':
        return { stroke: '#c4b5fd', pulse: '#f3e8ff', glow: '#a855f7', label: 'Uses Part' };
      case 'my-holding':
        return { stroke: '#a78bfa', pulse: '#e9d5ff', glow: '#8b5cf6', label: 'Holding' };
      case 'product':
        return { stroke: null, pulse: '#fde68a', glow: '#f59e0b', label: 'Product' };
      case 'coin-owner':
        return { stroke: null, pulse: '#a7f3d0', glow: '#10b981', label: 'Created Coin' };
      default:
        return { stroke: null, pulse: '#f5d0fe', glow: '#a78bfa', label: 'Owns' };
    }
  }

  function isTradeEdge(edge) {
    return edge.type === 'product-buy' || edge.type === 'company-buy' || edge.type === 'coin-buy';
  }

  function shouldShowEdge(edge, now) {
    const hasRecentActivity = Boolean(edge.activityAt && now - edge.activityAt <= ACTIVE_MS);
    if (isTradeEdge(edge) && !hasRecentActivity) return false;
    if (!hasRecentActivity && !edge.persistent) return false;
    if (state.filter === 'active') return hasRecentActivity;
    if (state.filter === 'trades') return isTradeEdge(edge) && hasRecentActivity;
    if (state.filter === 'supply') return edge.type === 'component-use' || edge.type === 'product' || edge.type === 'owner';
    return true;
  }

  function activate() {
    const page = $('page-grindworld');
    if (!page) return;
    const titleEl = $('pageTitle');
    if (titleEl) titleEl.textContent = 'GrindWorld';
    if (!state.canvas) initCanvas();
    if (!state.loaded || Date.now() - state.lastLoadedAt > 45000) load(true);
    startRealtime();
    if (!state.pollTimer) {
      state.pollTimer = setInterval(() => {
        if (typeof currentPage !== 'undefined' && currentPage === 'grindworld' && !document.hidden) {
          load(true);
        }
      }, 25000);
    }
    startAnimation();
    requestAnimationFrame(() => resizeCanvas());
  }

  function initCanvas() {
    state.canvas = $('grindWorldCanvas');
    if (!state.canvas) return;
    state.ctx = state.canvas.getContext('2d', { alpha: false });
    state.canvas.addEventListener('pointerdown', onPointerDown);
    state.canvas.addEventListener('pointermove', onPointerMove);
    state.canvas.addEventListener('pointerup', onPointerUp);
    state.canvas.addEventListener('pointercancel', onPointerUp);
    state.canvas.addEventListener('pointerleave', () => {
      if (state.hoveredId) {
        state.hoveredId = null;
        if (state.canvas) state.canvas.style.cursor = 'grab';
        draw();
      }
    });
    state.canvas.addEventListener('wheel', onWheel, { passive: false });

    $('grindWorldRefresh')?.addEventListener('click', () => load(true));
    $('grindWorldZoomIn')?.addEventListener('click', () => zoomAt(state.width / 2, state.height / 2, 1.28));
    $('grindWorldZoomOut')?.addEventListener('click', () => zoomAt(state.width / 2, state.height / 2, 0.78));
    $('grindWorldFit')?.addEventListener('click', fitView);
    $('grindWorldSelectionClose')?.addEventListener('click', () => selectNode(null));

    $('grindWorldFeedToggle')?.addEventListener('click', () => {
      $('grindWorldFeed')?.classList.toggle('collapsed');
    });

    $('grindWorldFilters')?.addEventListener('click', event => {
      const btn = event.target.closest('[data-gw-filter]');
      if (!btn) return;
      state.filter = btn.dataset.gwFilter || 'all';
      $('grindWorldFilters').querySelectorAll('[data-gw-filter]').forEach(el => {
        el.classList.toggle('active', el === btn);
      });
      draw();
      startAnimation();
    });

    const searchInput = $('grindWorldSearch');
    const searchResults = $('grindWorldSearchResults');
    if (searchInput && searchResults) {
      const renderSearch = () => {
        const q = searchInput.value.trim().toLowerCase();
        if (!q) {
          searchResults.classList.add('hidden');
          searchResults.innerHTML = '';
          return;
        }
        const matches = state.nodes
          .filter(n => (n.label || '').toLowerCase().includes(q) || (n.meta || '').toLowerCase().includes(q))
          .slice(0, 8);
        if (!matches.length) {
          searchResults.innerHTML = '<div class="gw-feed-empty">No matching nodes found</div>';
          searchResults.classList.remove('hidden');
          return;
        }
        searchResults.innerHTML = matches.map(n =>
          '<button type="button" class="gw-search-item" data-gw-node="' + esc(n.id) + '">' +
          '<span>' + esc(n.label) + '</span><em>' + esc(n.kind) + '</em></button>'
        ).join('');
        searchResults.classList.remove('hidden');
      };
      searchInput.addEventListener('input', renderSearch);
      searchInput.addEventListener('focus', renderSearch);
      searchInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
          const first = searchResults.querySelector('[data-gw-node]');
          if (first) {
            event.preventDefault();
            focusNode(first.dataset.gwNode);
            searchResults.classList.add('hidden');
          }
        } else if (event.key === 'Escape') {
          searchResults.classList.add('hidden');
        }
      });
      searchResults.addEventListener('click', event => {
        const btn = event.target.closest('[data-gw-node]');
        if (!btn) return;
        focusNode(btn.dataset.gwNode);
        searchResults.classList.add('hidden');
      });
      document.addEventListener('click', event => {
        if (!event.target.closest('.grindworld-search-wrap')) searchResults.classList.add('hidden');
      });
    }

    if (typeof ResizeObserver !== 'undefined') {
      state.resizeObserver = new ResizeObserver(() => resizeCanvas());
      state.resizeObserver.observe(state.canvas.parentElement);
    } else {
      window.addEventListener('resize', resizeCanvas);
    }
  }

  function resizeCanvas() {
    if (!state.canvas) return;
    const rect = state.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    state.width = rect.width;
    state.height = rect.height;
    state.dpr = Math.min(2, window.devicePixelRatio || 1);
    state.canvas.width = Math.round(rect.width * state.dpr);
    state.canvas.height = Math.round(rect.height * state.dpr);
    draw();
  }

  async function load(force = false) {
    if (state.loading || !sb || !currentUser) return;
    if (!force && state.loaded && Date.now() - state.lastLoadedAt < 25000) return;
    state.loading = true;
    if (!state.loaded) $('grindWorldLoading')?.classList.remove('hidden');

    try {
      let moderationState = null;
      try {
        if (typeof fetchAdminModerationState === 'function') {
          moderationState = await fetchAdminModerationState(true);
        } else if (typeof adminModStateCache !== 'undefined') {
          moderationState = adminModStateCache;
        }
      } catch (moderationError) {
        console.warn('GrindWorld moderation state unavailable:', moderationError);
      }

      const deletedUserIds = moderationState?.deletedUserIds instanceof Set
        ? moderationState.deletedUserIds : new Set();
      const deletedCoinIds = moderationState?.deletedCoinIds instanceof Set
        ? moderationState.deletedCoinIds : new Set();

      const cutoff = new Date(Date.now() - ACTIVE_MS).toISOString();
      const [
        profiles, companies, products, coins, coinBuys,
        companyBuys, productPurchases, holdings, companyHoldings, companyPriceRows
      ] = await Promise.all([
        safeRows(sb.from('profiles').select('id,username,avatar_url,is_test_account,user_color').limit(1000)),
        safeRows(sb.from('product_companies').select('id,owner_id,company_name,logo_data_url,description,product_lines,total_revenue,total_costs,created_at').order('created_at', { ascending: false }).limit(1000)),
        safeRows(sb.from('product_company_products').select('id,company_id,owner_id,product_name,product_line,listed_price,product_value,purchase_count,stock,design_data,status,created_at').eq('status', 'published').order('created_at', { ascending: false }).limit(2000)),
        safeRows(sb.from('coins').select('id,name,ticker,image_url,creator_id,price,created_at').order('created_at', { ascending: false }).limit(1000)),
        safeRows(sb.from('trades').select('id,coin_id,user_id,type,amount_usd,created_at').eq('type', 'buy').gte('created_at', cutoff).order('created_at', { ascending: false }).limit(2500)),
        safeRows(sb.from('company_stock_trades').select('id,company_id,user_id,type,amount_usd,created_at').eq('type', 'buy').gte('created_at', cutoff).order('created_at', { ascending: false }).limit(2000)),
        safeRows(sb.rpc('get_grindworld_product_purchases')),
        safeRows(sb.from('holdings').select('user_id,coin_id,shares').gt('shares', 0).limit(5000)),
        safeRows(sb.from('company_stock_holdings').select('user_id,company_id,shares').gt('shares', 0).limit(5000)),
        safeRows(sb.from('company_stock_trades').select('company_id,price_after,created_at').order('created_at', { ascending: false }).limit(10000))
      ]);

      const profileById = new Map(profiles
        .filter(p => p?.id && !deletedUserIds.has(String(p.id)))
        .map(p => [String(p.id), p]));
      const userExists = id => Boolean(id && profileById.has(String(id)));
      const companyRows = companies.filter(c => c?.id && userExists(c.owner_id));
      const companyById = new Map(companyRows.map(c => [String(c.id), c]));
      const productRows = products.filter(p =>
        p?.id && p.status === 'published' &&
        companyById.has(String(p.company_id)) && userExists(p.owner_id)
      );
      const productById = new Map(productRows.map(p => [String(p.id), p]));
      const coinRows = coins.filter(c =>
        c?.id && !deletedCoinIds.has(String(c.id)) && userExists(c.creator_id)
      );
      const coinById = new Map(coinRows.map(c => [String(c.id), c]));

      const validCoinBuys = coinBuys.filter(t => t?.coin_id && coinById.has(String(t.coin_id)) && userExists(t.user_id) && isRecent(t.created_at));
      const validCompanyBuys = companyBuys.filter(t => t?.company_id && companyById.has(String(t.company_id)) && userExists(t.user_id) && isRecent(t.created_at));
      const validProductPurchases = productPurchases.filter(p => p?.product_id && productById.has(String(p.product_id)) && userExists(p.buyer_id) && isRecent(p.created_at));

      const productDemand48h = new Map();
      const companyComponentDemand48h = new Map();
      validProductPurchases.forEach(purchase => {
        const key = String(purchase.product_id);
        const demand = productDemand48h.get(key) || { events: 0, value: 0, quantity: 0, latestAt: null };
        const value = Math.max(0, Number(purchase.purchase_price || 0));
        const unitPrice = Math.max(0, Number(productById.get(key)?.listed_price || 0));
        demand.events += 1;
        demand.value += value;
        const purchasedQuantity = Number(purchase.purchase_quantity);
        demand.quantity += Number.isFinite(purchasedQuantity) && purchasedQuantity > 0
          ? purchasedQuantity : (unitPrice > 0 ? value / unitPrice : 1);
        if (!demand.latestAt || new Date(purchase.created_at).getTime() > new Date(demand.latestAt).getTime()) demand.latestAt = purchase.created_at;
        productDemand48h.set(key, demand);
        if (purchase.buyer_company_id) {
          const pairKey = String(purchase.buyer_company_id) + '|' + key;
          const pair = companyComponentDemand48h.get(pairKey) || { value: 0, quantity: 0, latestAt: null };
          pair.value += value;
          pair.quantity += Number.isFinite(purchasedQuantity) && purchasedQuantity > 0
            ? purchasedQuantity : (unitPrice > 0 ? value / unitPrice : 1);
          if (!pair.latestAt || new Date(purchase.created_at).getTime() > new Date(pair.latestAt).getTime()) pair.latestAt = purchase.created_at;
          companyComponentDemand48h.set(pairKey, pair);
        }
      });

      const activeUserIds = new Set(profileById.keys());
      companyRows.forEach(c => activeUserIds.add(String(c.owner_id)));
      coinRows.forEach(c => activeUserIds.add(String(c.creator_id)));
      validCoinBuys.forEach(t => activeUserIds.add(String(t.user_id)));
      validCompanyBuys.forEach(t => activeUserIds.add(String(t.user_id)));
      validProductPurchases.forEach(p => activeUserIds.add(String(p.buyer_id)));
      holdings.forEach(h => {
        if (userExists(h.user_id) && coinById.has(String(h.coin_id))) activeUserIds.add(String(h.user_id));
      });
      if (userExists(currentUser.id)) activeUserIds.add(String(currentUser.id));

      const scoreByUser = new Map([...activeUserIds].map(id => [id, 1]));
      const addScore = (id, amount) => {
        const key = String(id || '');
        if (!key || !scoreByUser.has(key)) return;
        scoreByUser.set(key, scoreByUser.get(key) + Math.max(0, Number(amount) || 0));
      };

      const productsByCompany = new Map();
      const companyInventoryValue = new Map();
      productRows.forEach(product => {
        const companyId = String(product.company_id);
        if (!productsByCompany.has(companyId)) productsByCompany.set(companyId, []);
        productsByCompany.get(companyId).push(product);
        const inventory = Math.max(0, Number(product.product_value || 0)) * Math.max(0, Number(product.stock || 0));
        companyInventoryValue.set(companyId, (companyInventoryValue.get(companyId) || 0) + inventory);
      });

      const latestCompanyPrice = new Map();
      companyPriceRows.forEach(row => {
        const key = String(row.company_id);
        if (!latestCompanyPrice.has(key) && Number(row.price_after) > 0) latestCompanyPrice.set(key, Number(row.price_after));
      });
      holdings.forEach(holding => {
        const coin = coinById.get(String(holding.coin_id));
        if (coin && userExists(holding.user_id)) addScore(holding.user_id, Number(holding.shares || 0) * Math.max(0, Number(coin.price || 0)));
      });
      companyHoldings.forEach(holding => {
        if (!userExists(holding.user_id) || !companyById.has(String(holding.company_id))) return;
        addScore(holding.user_id, Number(holding.shares || 0) * (latestCompanyPrice.get(String(holding.company_id)) || 1));
      });
      companyRows.forEach(company => {
        const inventory = companyInventoryValue.get(String(company.id)) || 0;
        addScore(company.owner_id, Math.max(0, Number(company.total_revenue || 0)) + inventory);
      });

      const nodes = [];
      const nodeById = new Map();
      const edges = [];
      const edgeByKey = new Map();
      const addNode = node => {
        node.id = String(node.id);
        nodes.push(node);
        nodeById.set(node.id, node);
      };
      const addEdge = (key, from, to, type, activityAt = null, activityCount = 0, persistent = false, activityValue = 0) => {
        if (!nodeById.has(String(from)) || !nodeById.has(String(to))) return;
        let edge = edgeByKey.get(key);
        if (!edge) {
          edge = { key, from: String(from), to: String(to), type, activityAt: null, activityCount: 0, activityValue: 0, persistent: false };
          edgeByKey.set(key, edge);
          edges.push(edge);
        }
        edge.persistent = edge.persistent || persistent;
        if (activityAt && isRecent(activityAt)) {
          const ts = new Date(activityAt).getTime();
          if (!edge.activityAt || ts > edge.activityAt) edge.activityAt = ts;
          edge.activityCount += Math.max(1, Number(activityCount) || 1);
          edge.activityValue += Math.max(0, Number(activityValue) || 0);
        }
      };

      const activeProfiles = [...activeUserIds]
        .map(id => profileById.get(id))
        .filter(Boolean)
        .sort((a, b) => (scoreByUser.get(String(b.id)) || 0) - (scoreByUser.get(String(a.id)) || 0));
      const userColorById = new Map(activeProfiles.map(profile => [
        String(profile.id), validHex(profile.user_color) ? profile.user_color.toLowerCase() : colorFor(profile.id)
      ]));
      const marketProfiles = activeProfiles.filter(profile => !profile.is_test_account);
      const totalMarketPower = Math.max(1, marketProfiles.reduce(
        (sum, profile) => sum + (scoreByUser.get(String(profile.id)) || 1), 0
      ));
      const userPosition = new Map();

      activeProfiles.forEach(profile => {
        const score = scoreByUser.get(String(profile.id)) || 1;
        const isTestAccount = Boolean(profile.is_test_account);
        const share = isTestAccount ? 0 : score / totalMarketPower;
        const userId = 'user:' + profile.id;
        const radius = 19 + Math.min(32, Math.log10(Math.max(1, score) + 1) * 5.2);
        userPosition.set(String(profile.id), { x: 0, y: 0, share, radius });
        addNode({
          id: userId, kind: 'user', label: profile.username || 'Trader',
          meta: (share * 100).toFixed(2) + '% of tracked market · ' + Math.round(score).toLocaleString(),
          image: profile.avatar_url || '', color: userColorById.get(String(profile.id)), score,
          marketShare: share, testAccount: isTestAccount,
          radius, x: 0, y: 0, profileId: String(profile.id)
        });
      });

      const companyValueOf = company => Math.max(1,
        Number(company.total_revenue || 0) + (companyInventoryValue.get(String(company.id)) || 0));
      const maxCompanyValue = Math.max(1, ...companyRows.map(companyValueOf));
      const companiesByOwner = new Map();
      companyRows.forEach(c => {
        const ownerId = String(c.owner_id);
        if (!companiesByOwner.has(ownerId)) companiesByOwner.set(ownerId, []);
        companiesByOwner.get(ownerId).push(c);
      });

      companiesByOwner.forEach((list, ownerId) => {
        const base = userPosition.get(ownerId);
        if (!base) return;
        list.forEach((company, index) => {
          const angle = -Math.PI / 2 + (Math.PI * 2 * index / Math.max(1, list.length));
          const companyValue = companyValueOf(company);
          const companyRadius = 17 + Math.min(24, Math.sqrt(companyValue / maxCompanyValue) * 24);
          const listProducts = productsByCompany.get(String(company.id)) || [];
          const productAllowance = Math.min(130, listProducts.length * 14);
          const companySpread = base.radius + companyRadius + 92 + productAllowance + Math.min(75, Math.log10(companyValue + 1) * 7);
          const x = Math.cos(angle) * companySpread;
          const y = Math.sin(angle) * companySpread * 0.82;
          const id = 'company:' + company.id;
          addNode({
            id, kind: 'company', label: company.company_name || 'Company',
            meta: (company.product_lines || []).join(' / ').toUpperCase() + ' · ' + listProducts.length + ' products',
            image: company.logo_data_url || '', color: userColorById.get(ownerId) || colorFor(ownerId), radius: companyRadius,
            x, y, companyId: String(company.id), ownerId
          });
          addEdge('owner:' + company.id, 'user:' + ownerId, id, 'owner', company.created_at, 1, true);

          listProducts.forEach((product, productIndex) => {
            const pAngle = (Math.PI * 2 * productIndex / Math.max(1, listProducts.length)) - Math.PI / 2;
            const productId = 'product:' + product.id;
            const recentDemand = productDemand48h.get(String(product.id)) || { events: 0, value: 0, quantity: 0, latestAt: null };
            const recentDemandScore = recentDemand.value + recentDemand.quantity * Math.max(1, Number(product.listed_price || 0));
            const productRadius = 13 + Math.min(24, Math.log10(recentDemandScore + 1) * 4.8);
            const productOrbit = companyRadius + productRadius + 46 + Math.min(80, Math.max(0, listProducts.length - 5) * 8);
            const pX = x + Math.cos(pAngle) * productOrbit;
            const pY = y + Math.sin(pAngle) * productOrbit * 0.88;
            addNode({
              id: productId, kind: 'product', label: product.product_name || 'Product',
              meta: String(product.product_line || 'product').toUpperCase() + ' · 48h: ' + Math.round(recentDemand.quantity).toLocaleString() + ' bought · $' + Math.round(recentDemand.value).toLocaleString(),
              image: product.design_data?.thumbnail || product.design_data?.image_url || product.design_data?.image ||
                (typeof getCpuThumbsMap === 'function' ? (getCpuThumbsMap()?.[String(product.id)]?.dataUrl || '') : ''),
              color: userColorById.get(ownerId) || colorFor(ownerId),
              radius: productRadius, x: pX, y: pY, productId: String(product.id), companyId: String(company.id),
              ownerId, line: product.product_line
            });
            addEdge('company-product:' + product.id, id, productId, 'product', recentDemand.latestAt || product.created_at, Math.max(1, recentDemand.events), true, recentDemand.value);
          });
        });
      });

      const coinsByCreator = new Map();
      coinRows.forEach(c => {
        const creatorId = String(c.creator_id);
        if (!coinsByCreator.has(creatorId)) coinsByCreator.set(creatorId, []);
        coinsByCreator.get(creatorId).push(c);
      });
      coinsByCreator.forEach((list, creatorId) => {
        const base = userPosition.get(creatorId);
        if (!base) return;
        list.forEach((coin, index) => {
          const angle = Math.PI * 2 * index / Math.max(1, list.length) + Math.PI / 5;
          const recentCoinValue = validCoinBuys.filter(trade => String(trade.coin_id) === String(coin.id))
            .reduce((sum, trade) => sum + Math.max(0, Number(trade.amount_usd || 0)), 0);
          const coinRadius = 14 + Math.min(23, Math.log10(recentCoinValue + 1) * 4.8);
          const orbit = base.radius + coinRadius + 78 + Math.min(60, Math.max(0, list.length - 4) * 9);
          const x = Math.cos(angle) * orbit;
          const y = Math.sin(angle) * orbit * 0.85;
          const id = 'coin:' + coin.id;
          addNode({
            id, kind: 'coin', label: coin.name || coin.ticker || 'Coin',
            meta: '$' + String(coin.ticker || '').toUpperCase() + ' · $' + Number(coin.price || 1).toFixed(2),
            image: coin.image_url || '', color: userColorById.get(creatorId) || colorFor(creatorId), radius: coinRadius,
            x, y, coinId: String(coin.id), ownerId: creatorId
          });
          addEdge('coin-creator:' + coin.id, 'user:' + creatorId, id, 'coin-owner', coin.created_at, 1, true);
        });
      });

      // Keep durable links to assets the signed-in user currently owns.
      holdings.forEach(holding => {
        if (String(holding.user_id) !== String(currentUser.id) || Number(holding.shares || 0) <= 0) return;
        if (coinById.has(String(holding.coin_id))) {
          addEdge('my-coin-holding:' + holding.coin_id, 'user:' + currentUser.id,
            'coin:' + holding.coin_id, 'my-holding', null, 0, true);
        }
      });
      companyHoldings.forEach(holding => {
        if (String(holding.user_id) !== String(currentUser.id) || Number(holding.shares || 0) <= 0) return;
        if (companyById.has(String(holding.company_id))) {
          addEdge('my-company-holding:' + holding.company_id, 'user:' + currentUser.id,
            'company:' + holding.company_id, 'my-holding', null, 0, true);
        }
      });

      const coinBuyerEdges = new Map();
      validCoinBuys.forEach(t => {
        const key = String(t.user_id) + '|' + String(t.coin_id);
        const prev = coinBuyerEdges.get(key);
        const count = (prev?.activityCount || 0) + 1;
        const val = (prev?.totalValue || 0) + Math.max(0, Number(t.amount_usd || 0));
        if (!prev || new Date(t.created_at).getTime() > new Date(prev.created_at).getTime()) {
          coinBuyerEdges.set(key, { ...t, activityCount: count, totalValue: val });
        } else {
          prev.activityCount = count;
          prev.totalValue = val;
        }
      });
      coinBuyerEdges.forEach(t => {
        const coin = coinById.get(String(t.coin_id));
        if (!coin || String(coin.creator_id) === String(t.user_id)) return;
        addEdge('coin-buyer:' + t.user_id + ':' + t.coin_id, 'user:' + t.user_id, 'coin:' + t.coin_id, 'coin-buy', t.created_at, t.activityCount || 1, false, t.totalValue || Number(t.amount_usd || 0));
      });

      const companyBuyerEdges = new Map();
      validCompanyBuys.forEach(t => {
        const key = String(t.user_id) + '|' + String(t.company_id);
        const prev = companyBuyerEdges.get(key);
        const count = (prev?.activityCount || 0) + 1;
        const val = (prev?.totalValue || 0) + Math.max(0, Number(t.amount_usd || 0));
        if (!prev || new Date(t.created_at).getTime() > new Date(prev.created_at).getTime()) {
          companyBuyerEdges.set(key, { ...t, activityCount: count, totalValue: val });
        } else {
          prev.activityCount = count;
          prev.totalValue = val;
        }
      });
      companyBuyerEdges.forEach(t => {
        const company = companyById.get(String(t.company_id));
        if (!company || String(company.owner_id) === String(t.user_id)) return;
        addEdge('company-investor:' + t.user_id + ':' + t.company_id, 'user:' + t.user_id, 'company:' + t.company_id, 'company-buy', t.created_at, t.activityCount || 1, false, t.totalValue || Number(t.amount_usd || 0));
      });

      // Persistent real PC bill-of-material links: finished PC <-> component products.
      productRows.forEach(pcProduct => {
        const design = pcProduct.design_data && typeof pcProduct.design_data === 'object' ? pcProduct.design_data : {};
        if (!design.pc_build && String(pcProduct.product_line || '').toLowerCase() !== 'pc') return;
        const componentIds = Array.isArray(design.component_ids) ? design.component_ids : [];
        componentIds.forEach(componentId => {
          const componentKey = String(componentId || '');
          if (!productById.has(componentKey) || componentKey === String(pcProduct.id)) return;
          const componentDemand = companyComponentDemand48h.get(String(pcProduct.company_id) + '|' + componentKey);
          addEdge('pc-component:' + pcProduct.id + ':' + componentKey,
            'product:' + componentKey, 'product:' + pcProduct.id, 'component-use',
            componentDemand?.latestAt || null, Math.max(1, Math.round(componentDemand?.quantity || 1)), true,
            componentDemand?.value || 0);
        });
      });

      const productBuyerEdges = new Map();
      validProductPurchases.forEach(p => {
        const buyerCompanyId = p.buyer_company_id && companyById.has(String(p.buyer_company_id))
          ? String(p.buyer_company_id) : '';
        const buyerNodeId = buyerCompanyId ? 'company:' + buyerCompanyId : 'user:' + p.buyer_id;
        const key = buyerNodeId + '|' + String(p.product_id);
        const prev = productBuyerEdges.get(key);
        const count = (prev?.activityCount || 0) + 1;
        const val = (prev?.totalValue || 0) + Math.max(0, Number(p.purchase_price || 0));
        if (!prev || new Date(p.created_at).getTime() > new Date(prev.created_at).getTime()) {
          productBuyerEdges.set(key, { ...p, activityCount: count, totalValue: val });
        } else {
          prev.activityCount = count;
          prev.totalValue = val;
        }
      });
      productBuyerEdges.forEach(p => {
        const buyerCompanyId = p.buyer_company_id && companyById.has(String(p.buyer_company_id))
          ? String(p.buyer_company_id) : '';
        const buyerNodeId = buyerCompanyId ? 'company:' + buyerCompanyId : 'user:' + p.buyer_id;
        const sellerCompanyId = productById.get(String(p.product_id))?.company_id;
        if (buyerCompanyId && String(buyerCompanyId) === String(sellerCompanyId)) return;
        addEdge('product-buyer:' + buyerNodeId + ':' + p.product_id, buyerNodeId, 'product:' + p.product_id, 'product-buy', p.created_at, p.activityCount || 1, false, p.totalValue || Number(p.purchase_price || 0));
      });

      // Build live feed items (newest 48h buys & investments)
      const feedItems = [];
      validProductPurchases.slice(0, 20).forEach(p => {
        const buyerNodeId = p.buyer_company_id && companyById.has(String(p.buyer_company_id))
          ? 'company:' + p.buyer_company_id : 'user:' + p.buyer_id;
        const buyer = nodeById.get(buyerNodeId);
        const prod = nodeById.get('product:' + p.product_id);
        if (!buyer || !prod) return;
        const ts = new Date(p.created_at).getTime();
        feedItems.push({
          ts, kind: 'product-buy', fromId: buyer.id, toId: prod.id,
          text: '<b>' + esc(buyer.label) + '</b> bought <b>' + esc(prod.label) + '</b>',
          amount: formatMoney(p.purchase_price)
        });
      });
      validCompanyBuys.slice(0, 20).forEach(t => {
        const buyer = nodeById.get('user:' + t.user_id);
        const comp = nodeById.get('company:' + t.company_id);
        if (!buyer || !comp) return;
        const ts = new Date(t.created_at).getTime();
        feedItems.push({
          ts, kind: 'company-buy', fromId: buyer.id, toId: comp.id,
          text: '<b>' + esc(buyer.label) + '</b> invested in <b>' + esc(comp.label) + '</b>',
          amount: formatMoney(t.amount_usd)
        });
      });
      validCoinBuys.slice(0, 20).forEach(t => {
        const buyer = nodeById.get('user:' + t.user_id);
        const coin = nodeById.get('coin:' + t.coin_id);
        if (!buyer || !coin) return;
        const ts = new Date(t.created_at).getTime();
        feedItems.push({
          ts, kind: 'coin-buy', fromId: buyer.id, toId: coin.id,
          text: '<b>' + esc(buyer.label) + '</b> traded <b>' + esc(coin.label) + '</b>',
          amount: formatMoney(t.amount_usd)
        });
      });
      feedItems.sort((a, b) => b.ts - a.ts);

      // Build quick edge lookup per node
      const edgesByNode = new Map();
      edges.forEach(edge => {
        if (!edgesByNode.has(edge.from)) edgesByNode.set(edge.from, []);
        if (!edgesByNode.has(edge.to)) edgesByNode.set(edge.to, []);
        edgesByNode.get(edge.from).push(edge);
        edgesByNode.get(edge.to).push(edge);
      });

      const keepCurrentView = state.loaded;
      const previousCamera = { ...state.camera };
      layoutNodesInOpenSpace(nodes);
      state.nodes = nodes;
      state.edges = edges;
      state.nodeById = nodeById;
      state.edgesByNode = edgesByNode;
      state.feedItems = feedItems.slice(0, 14);
      state.loaded = true;
      state.lastLoadedAt = Date.now();

      // Spawn burst animations for brand-new activity (< 60s)
      const now = Date.now();
      edges.forEach(edge => {
        if (edge.activityAt && now - edge.activityAt <= FRESH_LIVE_MS && isTradeEdge(edge)) {
          const burstKey = edge.key + '@' + edge.activityAt;
          if (!state.seenRealtimeKeys.has(burstKey)) {
            state.seenRealtimeKeys.add(burstKey);
            spawnBurst(edge);
          }
        }
      });
      if (state.seenRealtimeKeys.size > 400) state.seenRealtimeKeys.clear();

      const activeCount = edges.filter(e => e.activityAt && now - e.activityAt <= ACTIVE_MS).length;
      const statsEl = $('grindWorldStats');
      if (statsEl) {
        statsEl.textContent =
          nodes.filter(n => n.kind === 'user').length + ' users · ' +
          nodes.filter(n => n.kind === 'company').length + ' companies · ' +
          nodes.filter(n => n.kind === 'product').length + ' products · ' +
          nodes.filter(n => n.kind === 'coin').length + ' coins · ' +
          activeCount + ' active 48h cables';
      }
      renderLiveFeed();
      if (state.selectedId) {
        if (state.nodeById.has(state.selectedId)) selectNode(state.selectedId, true);
        else selectNode(null);
      }
      $('grindWorldLoading')?.classList.add('hidden');

      if (keepCurrentView) {
        state.camera = previousCamera;
        clampCamera();
        draw();
      } else {
        fitView();
      }
      startAnimation();
    } catch (error) {
      console.error('GrindWorld load failed:', error);
      const loadEl = $('grindWorldLoading');
      if (loadEl) loadEl.textContent = 'Could not load the network. Try Refresh.';
      const statsEl = $('grindWorldStats');
      if (statsEl) statsEl.textContent = 'Network data could not be loaded.';
    } finally {
      state.loading = false;
    }
  }

  function spawnBurst(edge) {
    if (!edge) return;
    const now = Date.now();
    const meta = edgeVisualMeta(edge);
    state.bursts.push({
      from: edge.from,
      to: edge.to,
      startedAt: now,
      duration: 1350,
      color: meta.pulse,
      glow: meta.glow
    });
    state.ripples.push({ nodeId: edge.from, startedAt: now, color: meta.glow });
    state.ripples.push({ nodeId: edge.to, startedAt: now + 350, color: meta.pulse });
    if (state.bursts.length > 60) state.bursts.splice(0, state.bursts.length - 60);
    if (state.ripples.length > 80) state.ripples.splice(0, state.ripples.length - 80);
  }

  function renderLiveFeed() {
    const countEl = $('grindWorldFeedCount');
    const listEl = $('grindWorldFeedList');
    if (countEl) countEl.textContent = String(state.feedItems.length);
    if (!listEl) return;
    if (!state.feedItems.length) {
      listEl.innerHTML = '<div class="gw-feed-empty">No purchases or investments in the last 48h.</div>';
      return;
    }
    listEl.innerHTML = state.feedItems.map(item =>
      '<button type="button" class="gw-feed-item" data-gw-focus="' + esc(item.toId) + '">' +
      '<span>' + item.text + '</span>' +
      '<small>' + esc(item.amount ? item.amount + ' · ' : '') + formatAge(item.ts) + '</small></button>'
    ).join('');
    listEl.querySelectorAll('[data-gw-focus]').forEach(btn => {
      btn.addEventListener('click', () => focusNode(btn.dataset.gwFocus));
    });
  }

  function fitView() {
    if (!state.width || !state.height) return;
    state.cameraAnim = null;
    state.camera.x = state.world.width / 2;
    state.camera.y = state.world.height / 2;
    const fit = Math.min(state.width / state.world.width, state.height / state.world.height) * 0.94;
    state.minZoom = Math.max(0.005, Math.min(1.4, fit));
    state.camera.zoom = state.minZoom;
    clampCamera();
    draw();
  }

  function focusNode(nodeId) {
    const node = state.nodeById.get(String(nodeId || ''));
    if (!node) return;
    selectNode(node.id);
    const targetZoom = Math.max(state.camera.zoom, Math.min(1.15, Math.max(0.45, state.minZoom * 3.2)));
    state.cameraAnim = {
      startX: state.camera.x,
      startY: state.camera.y,
      startZoom: state.camera.zoom,
      endX: node.x,
      endY: node.y,
      endZoom: targetZoom,
      startedAt: Date.now(),
      duration: 420
    };
    startAnimation();
  }

  function clampCamera() {
    const halfWidth = state.width / (2 * state.camera.zoom);
    const halfHeight = state.height / (2 * state.camera.zoom);
    state.camera.x = state.world.width <= halfWidth * 2
      ? state.world.width / 2
      : Math.max(halfWidth, Math.min(state.world.width - halfWidth, state.camera.x));
    state.camera.y = state.world.height <= halfHeight * 2
      ? state.world.height / 2
      : Math.max(halfHeight, Math.min(state.world.height - halfHeight, state.camera.y));
  }

  function zoomAt(screenX, screenY, factor) {
    state.cameraAnim = null;
    const old = state.camera.zoom;
    const next = Math.max(state.minZoom, Math.min(2.6, old * factor));
    const worldX = (screenX - state.width / 2) / old + state.camera.x;
    const worldY = (screenY - state.height / 2) / old + state.camera.y;
    state.camera.zoom = next;
    state.camera.x = worldX - (screenX - state.width / 2) / next;
    state.camera.y = worldY - (screenY - state.height / 2) / next;
    clampCamera();
    draw();
  }

  function onWheel(event) {
    event.preventDefault();
    const rect = state.canvas.getBoundingClientRect();
    zoomAt(event.clientX - rect.left, event.clientY - rect.top, event.deltaY < 0 ? 1.13 : 0.88);
  }

  function hitTestScreen(clientX, clientY) {
    if (!state.canvas) return null;
    const rect = state.canvas.getBoundingClientRect();
    const wx = (clientX - rect.left - state.width / 2) / state.camera.zoom + state.camera.x;
    const wy = (clientY - rect.top - state.height / 2) / state.camera.zoom + state.camera.y;
    for (let i = state.nodes.length - 1; i >= 0; i--) {
      const node = state.nodes[i];
      if (Math.hypot(node.x - wx, node.y - wy) <= Math.max(16 / state.camera.zoom, node.radius + 7)) {
        return node;
      }
    }
    return null;
  }

  function onPointerDown(event) {
    if (!state.canvas) return;
    state.cameraAnim = null;
    state.canvas.setPointerCapture?.(event.pointerId);
    state.pointer = {
      id: event.pointerId, x: event.clientX, y: event.clientY,
      startX: event.clientX, startY: event.clientY, moved: false
    };
  }

  function onPointerMove(event) {
    if (!state.pointer || state.pointer.id !== event.pointerId) {
      const hovered = hitTestScreen(event.clientX, event.clientY);
      const nextHovered = hovered?.id || null;
      if (nextHovered !== state.hoveredId) {
        state.hoveredId = nextHovered;
        if (state.canvas) state.canvas.style.cursor = nextHovered ? 'pointer' : 'grab';
        draw();
      }
      return;
    }
    const dx = event.clientX - state.pointer.x;
    const dy = event.clientY - state.pointer.y;
    if (Math.abs(event.clientX - state.pointer.startX) + Math.abs(event.clientY - state.pointer.startY) > 5) {
      state.pointer.moved = true;
    }
    state.pointer.x = event.clientX;
    state.pointer.y = event.clientY;
    if (state.pointer.moved) {
      state.camera.x -= dx / state.camera.zoom;
      state.camera.y -= dy / state.camera.zoom;
      clampCamera();
      draw();
    }
  }

  function onPointerUp(event) {
    if (!state.pointer || state.pointer.id !== event.pointerId) return;
    const pointer = state.pointer;
    state.pointer = null;
    if (!pointer.moved) {
      const hit = hitTestScreen(event.clientX, event.clientY);
      selectNode(hit?.id || null);
    }
  }

  function selectNode(id, silentDraw = false) {
    state.selectedId = id;
    const node = id ? state.nodeById.get(id) : null;
    const panel = $('grindWorldSelection');
    const linksBox = $('grindWorldSelectionLinks');
    if (!node) {
      panel?.classList.add('hidden');
      if (linksBox) {
        linksBox.classList.add('hidden');
        linksBox.innerHTML = '';
      }
      if (!silentDraw) draw();
      return;
    }

    const typeNames = { user: 'USER', company: 'COMPANY', product: 'PRODUCT', coin: 'COIN' };
    $('grindWorldSelectionType').textContent = typeNames[node.kind] || 'NETWORK NODE';
    $('grindWorldSelectionName').textContent = node.label;
    $('grindWorldSelectionMeta').textContent = node.meta || '';

    if (linksBox) {
      const now = Date.now();
      const connected = (state.edgesByNode.get(node.id) || [])
        .filter(e => shouldShowEdge(e, now))
        .map(e => {
          const otherId = e.from === node.id ? e.to : e.from;
          const other = state.nodeById.get(otherId);
          if (!other) return null;
          const meta = edgeVisualMeta(e);
          const fresh = e.activityAt && now - e.activityAt <= ACTIVE_MS;
          const badge = isTradeEdge(e)
            ? meta.label + (e.activityValue > 0 ? ' ' + formatMoney(e.activityValue) : '') + (fresh ? ' · ' + formatAge(e.activityAt) : '')
            : meta.label;
          return { other, badge, weight: (fresh ? 1e12 : 0) + (e.activityAt || 0) };
        })
        .filter(Boolean)
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 10);

      if (connected.length) {
        linksBox.innerHTML = '<div class="gw-conn-title">Connections (' + connected.length + ')</div>' +
          connected.map(item =>
            '<button type="button" class="gw-conn-btn" data-gw-jump="' + esc(item.other.id) + '">' +
            '<span>' + esc(item.other.label) + '</span><em>' + esc(item.badge) + '</em></button>'
          ).join('');
        linksBox.querySelectorAll('[data-gw-jump]').forEach(btn => {
          btn.addEventListener('click', () => focusNode(btn.dataset.gwJump));
        });
        linksBox.classList.remove('hidden');
      } else {
        linksBox.innerHTML = '';
        linksBox.classList.add('hidden');
      }
    }

    panel?.classList.remove('hidden');
    if (!silentDraw) draw();
  }

  function imageFor(url) {
    if (!url || typeof url !== 'string') return null;
    if (state.images.has(url)) return state.images.get(url);
    const img = new Image();
    state.images.set(url, img);
    img.onload = () => draw();
    img.onerror = () => state.images.set(url, null);
    img.src = url;
    return img;
  }

  function roundedCircle(ctx, x, y, radius, fill, stroke, lineWidth = 2) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
  }

  function separateSatelliteCollisions(nodes) {
    if (nodes.length < 2) return;
    const cellSize = 110;
    const gap = 14;
    const iterations = 48;

    for (let iteration = 0; iteration < iterations; iteration++) {
      const buckets = new Map();
      nodes.forEach((node, index) => {
        const key = Math.floor(node.x / cellSize) + ':' + Math.floor(node.y / cellSize);
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(index);
      });

      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const cx = Math.floor(node.x / cellSize);
        const cy = Math.floor(node.y / cellSize);
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const bucket = buckets.get((cx + ox) + ':' + (cy + oy));
            if (!bucket) continue;
            for (const j of bucket) {
              if (j <= i) continue;
              const other = nodes[j];
              let dx = other.x - node.x;
              let dy = other.y - node.y;
              let distance = Math.hypot(dx, dy);
              const required = node.radius + other.radius + gap;
              if (distance >= required) continue;
              if (distance < 0.001) {
                const angle = (hash(node.id + '|' + other.id) % 6283) / 1000;
                dx = Math.cos(angle);
                dy = Math.sin(angle);
                distance = 1;
              }
              const overlap = required - distance;
              const nx = dx / distance, ny = dy / distance;
              const lockA = node.kind === 'user';
              const lockB = other.kind === 'user';
              if (lockA && lockB) continue;
              if (lockA) {
                other.x += nx * overlap * 0.85;
                other.y += ny * overlap * 0.85;
              } else if (lockB) {
                node.x -= nx * overlap * 0.85;
                node.y -= ny * overlap * 0.85;
              } else {
                node.x -= nx * overlap * 0.48;
                node.y -= ny * overlap * 0.48;
                other.x += nx * overlap * 0.48;
                other.y += ny * overlap * 0.48;
              }
            }
          }
        }
      }
    }
  }

  function layoutNodesInOpenSpace(nodes) {
    const users = nodes.filter(node => node.kind === 'user');
    const count = Math.max(1, users.length);
    const side = Math.max(6600, Math.sqrt(count) * 1260);
    const width = side * 1.18;
    const height = side;
    const padding = 560;
    const minUserGap = 690;
    const orderedUsers = [...users].sort((a, b) => hash(a.id) - hash(b.id));
    const placedUsers = [];

    orderedUsers.forEach((user, index) => {
      let placed = false;
      for (let attempt = 0; attempt < 1200; attempt++) {
        const sx = hash(user.id + ':account-x:' + attempt);
        const sy = hash(user.id + ':account-y:' + attempt);
        const x = padding + (sx / 4294967295) * (width - padding * 2);
        const y = padding + (sy / 4294967295) * (height - padding * 2);
        if (placedUsers.every(other =>
          Math.hypot(other.x - x, other.y - y) >= minUserGap + user.radius + other.radius
        )) {
          user.x = x;
          user.y = y;
          placed = true;
          break;
        }
      }
      if (!placed) {
        const angle = index * 2.399963229728653;
        const distance = minUserGap * Math.sqrt(index + 1);
        user.x = width / 2 + Math.cos(angle) * distance;
        user.y = height / 2 + Math.sin(angle) * distance;
      }
      placedUsers.push(user);
    });

    const usersByProfile = new Map(users.map(user => [String(user.profileId), user]));
    const companiesById = new Map(nodes.filter(node => node.kind === 'company')
      .map(node => [String(node.companyId), node]));

    nodes.forEach(node => {
      if (node.kind === 'company' || node.kind === 'coin') {
        const owner = usersByProfile.get(String(node.ownerId));
        if (owner) {
          node.x += owner.x;
          node.y += owner.y;
        }
      }
    });

    nodes.filter(node => node.kind === 'product').forEach(node => {
      const company = companiesById.get(String(node.companyId));
      if (company) {
        const productsForCompany = nodes.filter(candidate =>
          candidate.kind === 'product' && candidate.companyId === node.companyId
        );
        const index = productsForCompany.indexOf(node);
        const angle = (Math.PI * 2 * index / Math.max(1, productsForCompany.length)) - Math.PI / 2;
        const orbit = company.radius + node.radius + 46 + Math.min(80, Math.max(0, productsForCompany.length - 5) * 8);
        node.x = company.x + Math.cos(angle) * orbit;
        node.y = company.y + Math.sin(angle) * orbit * 0.88;
      }
    });

    separateSatelliteCollisions(nodes);

    const bounds = nodes.reduce((b, node) => ({
      minX: Math.min(b.minX, node.x - node.radius),
      minY: Math.min(b.minY, node.y - node.radius),
      maxX: Math.max(b.maxX, node.x + node.radius),
      maxY: Math.max(b.maxY, node.y + node.radius)
    }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });

    const shiftX = padding - bounds.minX;
    const shiftY = padding - bounds.minY;
    nodes.forEach(node => { node.x += shiftX; node.y += shiftY; });
    state.world = {
      width: Math.max(width, bounds.maxX - bounds.minX + padding * 2),
      height: Math.max(height, bounds.maxY - bounds.minY + padding * 2)
    };
  }

  function edgeCurve(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.hypot(dx, dy);
    const arcHeight = Math.min(200, Math.max(26, distance * 0.14));
    return {
      cx: (from.x + to.x) / 2,
      cy: (from.y + to.y) / 2 - arcHeight,
      distance
    };
  }

  function quadPoint(from, cx, cy, to, t) {
    const inv = 1 - t;
    return {
      x: inv * inv * from.x + 2 * inv * t * cx + t * t * to.x,
      y: inv * inv * from.y + 2 * inv * t * cy + t * t * to.y
    };
  }

  function draw() {
    const ctx = state.ctx;
    if (!ctx || !state.width || !state.height) return;
    const dpr = state.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#04050a';
    ctx.fillRect(0, 0, state.canvas.width, state.canvas.height);

    ctx.setTransform(
      dpr * state.camera.zoom, 0, 0, dpr * state.camera.zoom,
      dpr * (state.width / 2 - state.camera.x * state.camera.zoom),
      dpr * (state.height / 2 - state.camera.y * state.camera.zoom)
    );

    const now = Date.now();
    const focusId = state.hoveredId || state.selectedId || null;
    const connectedSet = new Set();
    if (focusId) connectedSet.add(focusId);

    // Subtle spatial territory glow under user hubs
    state.nodes.forEach(node => {
      if (node.kind !== 'user') return;
      const haloR = node.radius * 4.5 + Math.min(240, (node.marketShare || 0) * 600);
      const grad = ctx.createRadialGradient(node.x, node.y, node.radius * 0.4, node.x, node.y, haloR);
      const col = validHex(node.color) ? node.color : '#a78bfa';
      grad.addColorStop(0, rgba(col, 0.11));
      grad.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(node.x, node.y, haloR, 0, Math.PI * 2);
      ctx.fill();
    });

    const visibleEdges = [];
    state.edges.forEach(edge => {
      const from = state.nodeById.get(edge.from);
      const to = state.nodeById.get(edge.to);
      if (!from || !to) return;
      if (!shouldShowEdge(edge, now)) return;
      visibleEdges.push({ edge, from, to });
      if (focusId && (edge.from === focusId || edge.to === focusId)) {
        connectedSet.add(edge.from);
        connectedSet.add(edge.to);
      }
    });

    // Draw cables & continuously flowing circles on active 48h connections
    visibleEdges.forEach(({ edge, from, to }) => {
      const age = edge.activityAt ? now - edge.activityAt : Infinity;
      const active48h = age <= ACTIVE_MS;
      const isFocused = !focusId || edge.from === focusId || edge.to === focusId;
      const dimFactor = focusId ? (isFocused ? 1 : 0.14) : 1;

      const meta = edgeVisualMeta(edge);
      const baseColor = meta.stroke || from.color || to.color || '#7c8798';
      const { cx, cy } = edgeCurve(from, to);
      const activity = Math.max(1, Number(edge.activityCount) || 1);
      const valueWeight = Math.log10(Math.max(0, Number(edge.activityValue) || 0) + 1);

      // Freshness fade across 48h (1.0 when brand new -> ~0.28 right before 48h expiry)
      const freshness = active48h ? Math.max(0.28, 1 - (age / ACTIVE_MS) * 0.72) : 0.24;

      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.quadraticCurveTo(cx, cy, to.x, to.y);
      ctx.lineWidth = active48h
        ? Math.min(10, (1.35 + Math.log2(activity + 1) * 1.15 + valueWeight * 0.65) * (isFocused && focusId ? 1.2 : 1))
        : (isFocused && focusId ? 2.0 : 1.05);

      const alpha = (active48h ? (0.28 + freshness * 0.44) : 0.24) * dimFactor;
      ctx.strokeStyle = validHex(baseColor)
        ? rgba(baseColor, Math.min(0.92, alpha))
        : ('rgba(148,163,184,' + Math.min(0.85, alpha).toFixed(2) + ')');
      ctx.stroke();

      // Animate traveling circles along active 48h cables (faster/brighter for newer activity)
      if (active48h && (isTradeEdge(edge) || edge.type === 'component-use' || age <= 6 * 60 * 60 * 1000)) {
        const packetCount = age <= 10 * 60 * 1000
          ? Math.min(4, Math.max(2, Math.ceil(Math.log2(activity + 1))))
          : age <= 6 * 60 * 60 * 1000
            ? Math.min(3, Math.max(1, Math.ceil(Math.log2(activity + 1) * 0.7)))
            : 1;
        const speedMs = age <= 5 * 60 * 1000 ? 1550 : age <= 2 * 60 * 60 * 1000 ? 2400 : 3800;
        const seedOffset = (hash(edge.key) % 997) / 997;

        for (let i = 0; i < packetCount; i++) {
          const phase = ((now / (speedMs + i * 180)) + seedOffset + i / packetCount) % 1;
          const pt = quadPoint(from, cx, cy, to, phase);
          const trailPt = quadPoint(from, cx, cy, to, Math.max(0, phase - 0.045));
          const dotRadius = (age <= 10 * 60 * 1000 ? 3.8 : 2.9) + (i % 2) * 0.8;

          ctx.save();
          ctx.globalAlpha = Math.min(1, (0.45 + freshness * 0.55) * dimFactor);
          ctx.beginPath();
          ctx.moveTo(trailPt.x, trailPt.y);
          ctx.lineTo(pt.x, pt.y);
          ctx.strokeStyle = meta.pulse;
          ctx.lineWidth = dotRadius * 0.9;
          ctx.lineCap = 'round';
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(pt.x, pt.y, dotRadius, 0, Math.PI * 2);
          ctx.fillStyle = meta.pulse;
          ctx.shadowBlur = 12;
          ctx.shadowColor = meta.glow;
          ctx.fill();
          ctx.restore();
        }
      }
    });

    // Draw live realtime burst packets
    state.bursts = state.bursts.filter(b => now - b.startedAt <= b.duration);
    state.bursts.forEach(burst => {
      const from = state.nodeById.get(burst.from);
      const to = state.nodeById.get(burst.to);
      if (!from || !to) return;
      const t = Math.min(1, (now - burst.startedAt) / burst.duration);
      const { cx, cy } = edgeCurve(from, to);
      const pt = quadPoint(from, cx, cy, to, t);
      const tail = quadPoint(from, cx, cy, to, Math.max(0, t - 0.1));
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(tail.x, tail.y);
      ctx.lineTo(pt.x, pt.y);
      ctx.strokeStyle = burst.color;
      ctx.lineWidth = 4.5;
      ctx.lineCap = 'round';
      ctx.shadowBlur = 18;
      ctx.shadowColor = burst.glow;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 5.8, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.restore();
    });

    // Draw endpoint ripples
    state.ripples = state.ripples.filter(r => now - r.startedAt <= 1800);
    state.ripples.forEach(ripple => {
      const node = state.nodeById.get(ripple.nodeId);
      if (!node) return;
      const age = now - ripple.startedAt;
      if (age < 0) return;
      const p = age / 1800;
      ctx.save();
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius + 4 + p * 34, 0, Math.PI * 2);
      ctx.strokeStyle = ripple.color;
      ctx.globalAlpha = (1 - p) * 0.75;
      ctx.lineWidth = 2.4;
      ctx.stroke();
      ctx.restore();
    });

    // Draw bubbles
    state.nodes.forEach(node => {
      const isSelected = state.selectedId === node.id;
      const isHovered = state.hoveredId === node.id;
      const isNeighbor = !focusId || connectedSet.has(node.id);
      const color = node.color || '#a78bfa';
      const radius = node.radius;
      const ring = node.kind === 'user' ? '#f5f3ff' :
        node.kind === 'company' ? '#38bdf8' :
        node.kind === 'product' ? '#fbbf24' : '#34d399';

      ctx.save();
      if (focusId && !isNeighbor) ctx.globalAlpha = 0.25;

      if (isSelected || isHovered) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + (isSelected ? 8 : 6), 0, Math.PI * 2);
        ctx.strokeStyle = isSelected ? '#ffffff' : ring;
        ctx.lineWidth = isSelected ? 2.4 : 1.8;
        ctx.shadowBlur = 16;
        ctx.shadowColor = isSelected ? '#ffffff' : ring;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      roundedCircle(ctx, node.x, node.y, radius + 3, 'rgba(5,5,10,.96)', ring, 1.8);
      const img = imageFor(node.image);
      if (img && img.complete && img.naturalWidth > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(img, node.x - radius, node.y - radius, radius * 2, radius * 2);
        ctx.restore();
      } else {
        roundedCircle(ctx, node.x, node.y, radius, color, null);
        ctx.fillStyle = '#09090d';
        ctx.font = '800 ' + Math.max(9, radius * 0.72) + 'px Inter,Arial,sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const letter = node.kind === 'product'
          ? String(node.line || 'P').slice(0, 2).toUpperCase()
          : node.kind === 'coin' ? '$' : String(node.label || '?').trim().slice(0, 1).toUpperCase();
        ctx.fillText(letter, node.x, node.y + 0.5);
      }

      if (state.camera.zoom > 0.22 || isSelected || isHovered || (focusId && isNeighbor)) {
        const fontSize = Math.max(9, Math.min(13, 11 / Math.max(0.28, state.camera.zoom) * 0.55));
        ctx.font = '600 ' + fontSize + 'px Inter,Arial,sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,.92)';
        const text = node.label.slice(0, 24);
        ctx.strokeText(text, node.x, node.y + radius + 5);
        ctx.fillStyle = isSelected || isHovered ? '#ffffff' : '#e5e7eb';
        ctx.fillText(text, node.x, node.y + radius + 5);
      }
      ctx.restore();
    });
  }

  function startAnimation() {
    if (state.raf || document.hidden || (typeof currentPage !== 'undefined' && currentPage !== 'grindworld')) return;
    const tick = () => {
      state.raf = 0;
      if (document.hidden || (typeof currentPage !== 'undefined' && currentPage !== 'grindworld')) return;

      const now = Date.now();
      if (state.cameraAnim) {
        const p = Math.min(1, (now - state.cameraAnim.startedAt) / state.cameraAnim.duration);
        const ease = 1 - Math.pow(1 - p, 3);
        state.camera.x = state.cameraAnim.startX + (state.cameraAnim.endX - state.cameraAnim.startX) * ease;
        state.camera.y = state.cameraAnim.startY + (state.cameraAnim.endY - state.cameraAnim.startY) * ease;
        state.camera.zoom = state.cameraAnim.startZoom + (state.cameraAnim.endZoom - state.cameraAnim.startZoom) * ease;
        clampCamera();
        if (p >= 1) state.cameraAnim = null;
      }

      const hasFlow = state.edges.some(edge =>
        shouldShowEdge(edge, now) &&
        edge.activityAt &&
        now - edge.activityAt <= ACTIVE_MS &&
        (isTradeEdge(edge) || edge.type === 'component-use' || now - edge.activityAt <= 6 * 60 * 60 * 1000)
      );
      const hasEffect = state.bursts.length > 0 || state.ripples.length > 0 || Boolean(state.cameraAnim);
      draw();
      if (hasFlow || hasEffect) state.raf = requestAnimationFrame(tick);
    };
    state.raf = requestAnimationFrame(tick);
  }

  function stopAnimation() {
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;
  }

  function handleRealtimeEvent(table, payload) {
    const row = payload?.new || null;
    if (row && payload?.eventType === 'INSERT') {
      let fromId = null;
      let toId = null;
      let type = null;
      if (table === 'trades' && row.type === 'buy') {
        fromId = 'user:' + row.user_id;
        toId = 'coin:' + row.coin_id;
        type = 'coin-buy';
      } else if (table === 'company_stock_trades' && row.type === 'buy') {
        fromId = 'user:' + row.user_id;
        toId = 'company:' + row.company_id;
        type = 'company-buy';
      } else if (table === 'product_company_product_purchases') {
        fromId = row.buyer_company_id ? 'company:' + row.buyer_company_id : 'user:' + row.buyer_id;
        toId = 'product:' + row.product_id;
        type = 'product-buy';
      }
      if (fromId && toId && state.nodeById.has(fromId) && state.nodeById.has(toId)) {
        spawnBurst({ from: fromId, to: toId, type });
        startAnimation();
      }
    }
    queueRefresh();
  }

  function startRealtime() {
    if (state.realtime || !sb) return;
    try {
      state.realtime = sb.channel('grindworld-network')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, p => handleRealtimeEvent('profiles', p))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'holdings' }, p => handleRealtimeEvent('holdings', p))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'company_stock_holdings' }, p => handleRealtimeEvent('company_stock_holdings', p))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'coins' }, p => handleRealtimeEvent('coins', p))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'trades' }, p => handleRealtimeEvent('trades', p))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'product_companies' }, p => handleRealtimeEvent('product_companies', p))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'product_company_products' }, p => handleRealtimeEvent('product_company_products', p))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'product_company_product_purchases' }, p => handleRealtimeEvent('product_company_product_purchases', p))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'company_stock_trades' }, p => handleRealtimeEvent('company_stock_trades', p))
        .subscribe();
    } catch (error) {
      console.warn('GrindWorld realtime subscription unavailable:', error);
    }
  }

  function queueRefresh() {
    if (state.refreshTimer) clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(() => {
      state.refreshTimer = null;
      if (typeof currentPage !== 'undefined' && currentPage === 'grindworld' && !document.hidden) load(true);
    }, 900);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopAnimation();
    else if (typeof currentPage !== 'undefined' && currentPage === 'grindworld') {
      if (Date.now() - state.lastLoadedAt > 25000) load(true);
      startAnimation();
    }
  });

  document.querySelector('[data-page="grindworld"]')?.addEventListener('click', activate);
  window.GrindWorld = { activate, load, fitView, focusNode };
})();