(() => {
  'use strict';

  const DAY_MS = 24 * 60 * 60 * 1000;
  const ACTIVE_MS = DAY_MS;
  const state = {
    nodes: [],
    edges: [],
    nodeById: new Map(),
    images: new Map(),
    minZoom: 0.1,
    camera: { x: 0, y: 0, zoom: 1 },
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
    lastLoadedAt: 0
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

  function activate() {
    const page = $('page-grindworld');
    if (!page) return;
    $('pageTitle').textContent = 'GrindWorld';
    if (!state.canvas) initCanvas();
    if (!state.loaded || Date.now() - state.lastLoadedAt > 60000) load(true);
    startRealtime();
    if (!state.pollTimer) {
      state.pollTimer = setInterval(() => {
        // Realtime is primary; this is a safety refresh if a subscription event is missed.
        if (currentPage === 'grindworld' && !document.hidden) load(true);
      }, 30000);
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
    state.canvas.addEventListener('wheel', onWheel, { passive: false });
    $('grindWorldRefresh')?.addEventListener('click', () => load(true));
    $('grindWorldZoomIn')?.addEventListener('click', () => zoomAt(state.width / 2, state.height / 2, 1.25));
    $('grindWorldZoomOut')?.addEventListener('click', () => zoomAt(state.width / 2, state.height / 2, 0.8));
    $('grindWorldFit')?.addEventListener('click', fitView);
    $('grindWorldSelectionClose')?.addEventListener('click', () => selectNode(null));
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
    if (!force && state.loaded && Date.now() - state.lastLoadedAt < 30000) return;
    state.loading = true;
    $('grindWorldLoading')?.classList.remove('hidden');
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
        safeRows(sb.from('trades').select('id,coin_id,user_id,type,amount_usd,created_at').eq('type', 'buy').gte('created_at', cutoff).order('created_at', { ascending: false }).limit(2000)),
        safeRows(sb.from('company_stock_trades').select('id,company_id,user_id,type,amount_usd,created_at').eq('type', 'buy').gte('created_at', cutoff).order('created_at', { ascending: false }).limit(1500)),
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
      const productDemand24h = new Map();
      const companyComponentDemand24h = new Map();
      validProductPurchases.forEach(purchase => {
        const key = String(purchase.product_id);
        const demand = productDemand24h.get(key) || { events: 0, value: 0, quantity: 0, latestAt: null };
        const value = Math.max(0, Number(purchase.purchase_price || 0));
        const unitPrice = Math.max(0, Number(productById.get(key)?.listed_price || 0));
        demand.events += 1;
        demand.value += value;
        const purchasedQuantity = Number(purchase.purchase_quantity);
        demand.quantity += Number.isFinite(purchasedQuantity) && purchasedQuantity > 0
          ? purchasedQuantity : (unitPrice > 0 ? value / unitPrice : 1);
        if (!demand.latestAt || new Date(purchase.created_at).getTime() > new Date(demand.latestAt).getTime()) demand.latestAt = purchase.created_at;
        productDemand24h.set(key, demand);
        if (purchase.buyer_company_id) {
          const pairKey = String(purchase.buyer_company_id) + '|' + key;
          const pair = companyComponentDemand24h.get(pairKey) || { value: 0, quantity: 0, latestAt: null };
          pair.value += value;
          pair.quantity += Number.isFinite(purchasedQuantity) && purchasedQuantity > 0
            ? purchasedQuantity : (unitPrice > 0 ? value / unitPrice : 1);
          if (!pair.latestAt || new Date(purchase.created_at).getTime() > new Date(pair.latestAt).getTime()) pair.latestAt = purchase.created_at;
          companyComponentDemand24h.set(pairKey, pair);
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
      // Market power reflects assets actually owned, not lifetime activity.
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
      const maxScore = Math.max(1, ...marketProfiles.map(
        profile => scoreByUser.get(String(profile.id)) || 1
      ));
      const totalMarketPower = Math.max(1, marketProfiles.reduce(
        (sum, profile) => sum + (scoreByUser.get(String(profile.id)) || 1), 0
      ));
      const userPosition = new Map();
      activeProfiles.forEach(profile => {
        const score = scoreByUser.get(String(profile.id)) || 1;
        const isTestAccount = Boolean(profile.is_test_account);
        const share = isTestAccount ? 0 : score / totalMarketPower;
        const x = 0;
        const y = 0;
        const userId = 'user:' + profile.id;
        // User bubble size follows estimated net worth, with a capped logarithmic scale.
        const radius = 17 + Math.min(31, Math.log10(Math.max(1, score) + 1) * 5.2);
        userPosition.set(String(profile.id), { x, y, share, radius });
        addNode({
          id: userId, kind: 'user', label: profile.username || 'Trader',
          meta: (share * 100).toFixed(2) + '% of tracked market · ' + Math.round(score).toLocaleString(),
          image: profile.avatar_url || '', color: userColorById.get(String(profile.id)), score,
          marketShare: share, backgroundShare: share, testAccount: isTestAccount,
          radius, x, y, profileId: String(profile.id)
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
          const companyRadius = 16 + Math.min(24, Math.sqrt(companyValue / maxCompanyValue) * 24);
          const companySpread = base.radius + companyRadius + 72 + Math.min(90, Math.log10(companyValue + 1) * 7);
          const x = base.x + Math.cos(angle) * companySpread;
          const y = base.y + Math.sin(angle) * companySpread * 0.78;
          const id = 'company:' + company.id;
          addNode({
            id, kind: 'company', label: company.company_name || 'Company',
            meta: (company.product_lines || []).join(' / ').toUpperCase() + ' · ' + productRows.filter(p => String(p.company_id) === String(company.id)).length + ' products',
            image: company.logo_data_url || '', color: userColorById.get(ownerId) || colorFor(ownerId), radius: companyRadius,
            x, y, companyId: String(company.id), ownerId
          });
          addEdge('owner:' + company.id, 'user:' + ownerId, id, 'owner', company.created_at, 1, ownerId === String(currentUser.id));
          const listProducts = productsByCompany.get(String(company.id)) || [];
          listProducts.forEach((product, productIndex) => {
            const pAngle = (Math.PI * 2 * productIndex / Math.max(1, listProducts.length)) - Math.PI / 2;
            const productId = 'product:' + product.id;
            const recentDemand = productDemand24h.get(String(product.id)) || { events: 0, value: 0, quantity: 0, latestAt: null };
            const recentDemandScore = recentDemand.value + recentDemand.quantity * Math.max(1, Number(product.listed_price || 0));
            const productRadius = 13 + Math.min(25, Math.log10(recentDemandScore + 1) * 5.2);
            const productOrbit = companyRadius + productRadius + 42;
            const pX = x + Math.cos(pAngle) * productOrbit;
            const pY = y + Math.sin(pAngle) * productOrbit * 0.86;
            addNode({
              id: productId, kind: 'product', label: product.product_name || 'Product',
              meta: String(product.product_line || 'product').toUpperCase() + ' · last 24h: ' + Math.round(recentDemand.quantity).toLocaleString() + ' bought · $' + Math.round(recentDemand.value).toLocaleString(),
              image: product.design_data?.thumbnail || product.design_data?.image_url || product.design_data?.image ||
                (typeof getCpuThumbsMap === 'function' ? (getCpuThumbsMap()?.[String(product.id)]?.dataUrl || '') : ''),
              color: userColorById.get(ownerId) || colorFor(ownerId),
              radius: productRadius, x: pX, y: pY, productId: String(product.id), companyId: String(company.id),
              ownerId, line: product.product_line
            });
            addEdge('company-product:' + product.id, id, productId, 'product', product.created_at, 1, ownerId === String(currentUser.id));
          });
        });
      });

      const coinPopularity = new Map();
      validCoinBuys.forEach(trade => {
        const key = String(trade.coin_id);
        coinPopularity.set(key, (coinPopularity.get(key) || 0) + 1);
      });
      const coinHolderCounts = new Map();
      holdings.forEach(holding => {
        if (Number(holding.shares || 0) > 0 && coinById.has(String(holding.coin_id))) {
          const key = String(holding.coin_id);
          coinHolderCounts.set(key, (coinHolderCounts.get(key) || 0) + 1);
        }
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
          const coinRadius = 14 + Math.min(24, Math.log10(recentCoinValue + 1) * 5);
          const x = base.x + Math.cos(angle) * (base.radius + coinRadius + 72);
          const y = base.y + Math.sin(angle) * (base.radius + coinRadius + 72) * 0.84;
          const id = 'coin:' + coin.id;
          const popularity = (coinPopularity.get(String(coin.id)) || 0) + (coinHolderCounts.get(String(coin.id)) || 0);
          addNode({
            id, kind: 'coin', label: coin.name || coin.ticker || 'Coin',
            meta: '$' + String(coin.ticker || '').toUpperCase() + ' · ' + Number(coin.price || 1).toFixed(2),
            image: coin.image_url || '', color: userColorById.get(creatorId) || colorFor(creatorId), radius: coinRadius,
            x, y, coinId: String(coin.id), ownerId: creatorId
          });
          addEdge('coin-creator:' + coin.id, 'user:' + creatorId, id, 'coin-owner', coin.created_at, 1, creatorId === String(currentUser.id));
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
        if (!prev || new Date(t.created_at).getTime() > new Date(prev.created_at).getTime()) {
          coinBuyerEdges.set(key, { ...t, activityCount: count });
        } else {
          prev.activityCount = count;
        }
      });
      coinBuyerEdges.forEach(t => {
        const coin = coinById.get(String(t.coin_id));
        if (!coin || String(coin.creator_id) === String(t.user_id)) return;
        addEdge('coin-buyer:' + t.user_id + ':' + t.coin_id, 'user:' + t.user_id, 'coin:' + t.coin_id, 'coin-buy', t.created_at, t.activityCount || 1);
      });

      const companyBuyerEdges = new Map();
      validCompanyBuys.forEach(t => {
        const key = String(t.user_id) + '|' + String(t.company_id);
        const prev = companyBuyerEdges.get(key);
        const count = (prev?.activityCount || 0) + 1;
        if (!prev || new Date(t.created_at).getTime() > new Date(prev.created_at).getTime()) {
          companyBuyerEdges.set(key, { ...t, activityCount: count });
        } else {
          prev.activityCount = count;
        }
      });
      companyBuyerEdges.forEach(t => {
        const company = companyById.get(String(t.company_id));
        if (!company || String(company.owner_id) === String(t.user_id)) return;
        addEdge('company-investor:' + t.user_id + ':' + t.company_id, 'user:' + t.user_id, 'company:' + t.company_id, 'company-buy', t.created_at, t.activityCount || 1);
      });

      // Persistent real PC bill-of-material links: finished PC -> component products.
      productRows.forEach(pcProduct => {
        const design = pcProduct.design_data && typeof pcProduct.design_data === 'object' ? pcProduct.design_data : {};
        if (!design.pc_build && String(pcProduct.product_line || '').toLowerCase() !== 'pc') return;
        const componentIds = Array.isArray(design.component_ids) ? design.component_ids : [];
        componentIds.forEach(componentId => {
          const componentKey = String(componentId || '');
          if (!productById.has(componentKey) || componentKey === String(pcProduct.id)) return;
          const componentDemand = companyComponentDemand24h.get(String(pcProduct.company_id) + '|' + componentKey);
          addEdge('pc-component:' + pcProduct.id + ':' + componentKey,
            'product:' + pcProduct.id, 'product:' + componentKey, 'component-use',
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
        if (!prev || new Date(p.created_at).getTime() > new Date(prev.created_at).getTime()) {
          productBuyerEdges.set(key, { ...p, activityCount: count });
        } else {
          prev.activityCount = count;
        }
      });
      productBuyerEdges.forEach(p => {
        const buyerCompanyId = p.buyer_company_id && companyById.has(String(p.buyer_company_id))
          ? String(p.buyer_company_id) : '';
        const buyerNodeId = buyerCompanyId ? 'company:' + buyerCompanyId : 'user:' + p.buyer_id;
        const sellerCompanyId = productById.get(String(p.product_id))?.company_id;
        if (buyerCompanyId && String(buyerCompanyId) === String(sellerCompanyId)) return;
        addEdge('product-buyer:' + buyerNodeId + ':' + p.product_id, buyerNodeId, 'product:' + p.product_id, 'product-buy', p.created_at, p.activityCount || 1, false, productDemand24h.get(String(p.product_id))?.value || Number(p.purchase_price || 0));
      });

      const keepCurrentView = state.loaded;
      const previousCamera = { ...state.camera };
      layoutNodesInOpenSpace(nodes);
      state.nodes = nodes;
      state.edges = edges;
      state.nodeById = nodeById;
      state.loaded = true;
      state.lastLoadedAt = Date.now();
      $('grindWorldStats').textContent =
        nodes.filter(n => n.kind === 'user').length + ' users · ' +
        nodes.filter(n => n.kind === 'company').length + ' companies · ' +
        nodes.filter(n => n.kind === 'product').length + ' products · ' +
        nodes.filter(n => n.kind === 'coin').length + ' coins · ' +
        edges.filter(e => e.activityAt && Date.now() - e.activityAt <= ACTIVE_MS).length + ' active connections';
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
      $('grindWorldLoading').textContent = 'Could not load the network. Try Refresh.';
      $('grindWorldStats').textContent = 'Network data could not be loaded.';
    } finally {
      state.loading = false;
    }
  }

  function fitView() {
    if (!state.width || !state.height) return;
    state.camera.x = state.world.width / 2;
    state.camera.y = state.world.height / 2;
    const fit = Math.min(state.width / state.world.width, state.height / state.world.height) * 0.94;
    state.minZoom = Math.max(0.005, Math.min(1.4, fit));
    state.camera.zoom = state.minZoom;
    clampCamera();
    draw();
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
    const old = state.camera.zoom;
    const next = Math.max(state.minZoom, Math.min(2.5, old * factor));
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
    zoomAt(event.clientX - rect.left, event.clientY - rect.top, event.deltaY < 0 ? 1.12 : 0.89);
  }

  function onPointerDown(event) {
    if (!state.canvas) return;
    state.canvas.setPointerCapture?.(event.pointerId);
    state.pointer = {
      id: event.pointerId, x: event.clientX, y: event.clientY,
      startX: event.clientX, startY: event.clientY, moved: false
    };
  }

  function onPointerMove(event) {
    if (!state.pointer || state.pointer.id !== event.pointerId) return;
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
      const rect = state.canvas.getBoundingClientRect();
      const wx = (event.clientX - rect.left - state.width / 2) / state.camera.zoom + state.camera.x;
      const wy = (event.clientY - rect.top - state.height / 2) / state.camera.zoom + state.camera.y;
      const hit = [...state.nodes].reverse().find(node =>
        Math.hypot(node.x - wx, node.y - wy) <= Math.max(18, node.radius + 7)
      );
      selectNode(hit?.id || null);
    }
  }

  function selectNode(id) {
    state.selectedId = id;
    const node = id ? state.nodeById.get(id) : null;
    const panel = $('grindWorldSelection');
    if (!node) {
      panel?.classList.add('hidden');
      draw();
      return;
    }
    const typeNames = { user: 'USER', company: 'COMPANY', product: 'PRODUCT', coin: 'COIN' };
    $('grindWorldSelectionType').textContent = typeNames[node.kind] || 'NETWORK NODE';
    $('grindWorldSelectionName').textContent = node.label;
    $('grindWorldSelectionMeta').textContent = node.meta || '';
    panel?.classList.remove('hidden');
    draw();
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

  function separateNodeCollisions(nodes) {
    if (nodes.length < 2) return;
    const cellSize = 100;
    const gap = 12;
    const iterations = 65;

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
              const push = (required - distance) * 0.52;
              const nx = dx / distance, ny = dy / distance;
              node.x -= nx * push;
              node.y -= ny * push;
              other.x += nx * push;
              other.y += ny * push;
            }
          }
        }
      }

    }
  }

  function layoutNodesInOpenSpace(nodes) {
    const users = nodes.filter(node => node.kind === 'user');
    const count = Math.max(1, users.length);
    const side = Math.max(6400, Math.sqrt(count) * 1200);
    const width = side * 1.18;
    const height = side;
    const padding = 520;
    const minUserGap = 640;
    const orderedUsers = [...users].sort((a, b) => hash(a.id) - hash(b.id));
    const placedUsers = [];

    // Place accounts first, with generous space between each account.
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
        // A deterministic expanding spiral is a fallback for unusually dense worlds.
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

    // Preserve ownership proximity: companies orbit their owner, products their company,
    // and coins their creator. The offsets were assigned when the nodes were built.
    nodes.forEach(node => {
      if (node.kind === 'company') {
        const owner = usersByProfile.get(String(node.ownerId));
        if (owner) {
          const ownerOrigin = { x: 0, y: 0 };
          node.x = owner.x + (node.x - ownerOrigin.x);
          node.y = owner.y + (node.y - ownerOrigin.y);
        }
      } else if (node.kind === 'coin') {
        const owner = usersByProfile.get(String(node.ownerId));
        if (owner) {
          node.x += owner.x;
          node.y += owner.y;
        }
      }
    });

    // Product offsets were originally relative to their company's local position.
    nodes.filter(node => node.kind === 'product').forEach(node => {
      const company = companiesById.get(String(node.companyId));
      if (company) {
        // Their original coordinates were based on a company centered around (roughly) zero.
        // Recover the offset from the original company placement encoded by the product node.
        const productsForCompany = nodes.filter(candidate =>
          candidate.kind === 'product' && candidate.companyId === node.companyId
        );
        const index = productsForCompany.indexOf(node);
        const angle = (Math.PI * 2 * index / Math.max(1, productsForCompany.length)) - Math.PI / 2;
        node.x = company.x + Math.cos(angle) * (company.radius + node.radius + 42);
        node.y = company.y + Math.sin(angle) * (company.radius + node.radius + 42) * 0.86;
      }
    });

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

    function draw() {
    const ctx = state.ctx;
    if (!ctx || !state.width || !state.height) return;
    const dpr = state.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#030305';
    ctx.fillRect(0, 0, state.canvas.width, state.canvas.height);
    ctx.setTransform(
      dpr * state.camera.zoom, 0, 0, dpr * state.camera.zoom,
      dpr * (state.width / 2 - state.camera.x * state.camera.zoom),
      dpr * (state.height / 2 - state.camera.y * state.camera.zoom)
    );

    const now = Date.now();
    state.edges.forEach(edge => {
      const from = state.nodeById.get(edge.from);
      const to = state.nodeById.get(edge.to);
      if (!from || !to) return;
      const active = edge.activityAt && Date.now() - edge.activityAt <= ACTIVE_MS;
      if (!active && !edge.persistent) return;
      const color = from.color || to.color || '#7c8798';
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const distance = Math.hypot(dx, dy);
      const arcHeight = Math.min(190, Math.max(24, distance * 0.13));
      const controlX = (from.x + to.x) / 2;
      const controlY = (from.y + to.y) / 2 - arcHeight;
      const activity = Math.max(1, Number(edge.activityCount) || 1);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.quadraticCurveTo(controlX, controlY, to.x, to.y);
      const valueWeight = Math.log10(Math.max(0, Number(edge.activityValue) || 0) + 1);
      ctx.lineWidth = active
        ? Math.min(12, 1.2 + Math.log2(activity + 1) * 1.45 + valueWeight * 0.8)
        : 1.0;
      ctx.strokeStyle = validHex(color)
        ? rgba(color, active ? .62 : .28)
        : (active ? 'rgba(148,163,184,.55)' : 'rgba(148,163,184,.22)');
      ctx.stroke();

      if (active && now - edge.activityAt <= 9000) {
        const count = Math.min(3, Math.max(1, Math.ceil(Math.log2((edge.activityCount || 1) + 1))));
        for (let i = 0; i < count; i++) {
          const phase = ((now / (1550 + i * 230)) + (hash(edge.key) % 997) / 997 + i / count) % 1;
          const inverse = 1 - phase;
          const px = inverse * inverse * from.x + 2 * inverse * phase * controlX + phase * phase * to.x;
          const py = inverse * inverse * from.y + 2 * inverse * phase * controlY + phase * phase * to.y;
          ctx.beginPath();
          ctx.arc(px, py, 3.1 + (i % 2) * 1.1, 0, Math.PI * 2);
          ctx.fillStyle = '#f5d0fe';
          ctx.shadowBlur = 13;
          ctx.shadowColor = color;
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }
    });

    state.nodes.forEach(node => {
      const isSelected = state.selectedId === node.id;
      const color = node.color || '#a78bfa';
      const radius = node.radius;
      const ring = node.kind === 'user' ? '#f5f3ff' :
        node.kind === 'company' ? '#38bdf8' :
        node.kind === 'product' ? '#fbbf24' : '#34d399';
      ctx.save();
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + 8, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.shadowBlur = 16;
        ctx.shadowColor = '#ffffff';
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
      if (state.camera.zoom > 0.24) {
        ctx.font = '600 ' + Math.max(9, Math.min(13, 11 / state.camera.zoom * 0.55)) + 'px Inter,Arial,sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,.9)';
        ctx.strokeText(node.label.slice(0, 23), node.x, node.y + radius + 5);
        ctx.fillStyle = '#e5e7eb';
        ctx.fillText(node.label.slice(0, 23), node.x, node.y + radius + 5);
      }
      ctx.restore();
    });
  }

  function startAnimation() {
    if (state.raf || document.hidden || currentPage !== 'grindworld') return;
    const tick = () => {
      state.raf = 0;
      if (document.hidden || currentPage !== 'grindworld') return;
      const moving = state.edges.some(edge => edge.activityAt && Date.now() - edge.activityAt <= 9000);
      draw();
      if (moving) state.raf = requestAnimationFrame(tick);
    };
    state.raf = requestAnimationFrame(tick);
  }

  function stopAnimation() {
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;
  }

  function startRealtime() {
    if (state.realtime || !sb) return;
    try {
      state.realtime = sb.channel('grindworld-network')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, queueRefresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'holdings' }, queueRefresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'company_stock_holdings' }, queueRefresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'coins' }, queueRefresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'trades' }, queueRefresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'product_companies' }, queueRefresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'product_company_products' }, queueRefresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'product_company_product_purchases' }, queueRefresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'company_stock_trades' }, queueRefresh)
        .subscribe();
    } catch (error) {
      console.warn('GrindWorld realtime subscription unavailable:', error);
    }
  }

  function queueRefresh() {
    if (state.refreshTimer) clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(() => {
      state.refreshTimer = null;
      if (currentPage === 'grindworld' && !document.hidden) load(true);
    }, 1200);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopAnimation();
    else if (currentPage === 'grindworld') {
      if (Date.now() - state.lastLoadedAt > 30000) load(true);
      startAnimation();
    }
  });

  document.querySelector('[data-page="grindworld"]')?.addEventListener('click', activate);
  window.GrindWorld = { activate, load, fitView };
})();