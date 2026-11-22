(() => {
  'use strict';

  const DAY_MS = 24 * 60 * 60 * 1000;
  const ACTIVE_MS = 2 * DAY_MS;
  const state = {
    nodes: [],
    edges: [],
    nodeById: new Map(),
    images: new Map(),
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
        if (currentPage === 'grindworld' && !document.hidden) load(true);
      }, 60000);
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
      const cutoff = new Date(Date.now() - ACTIVE_MS).toISOString();
      const [
        profiles, companies, products, coins, coinBuys,
        companyBuys, productPurchases, holdings
      ] = await Promise.all([
        safeRows(sb.from('profiles').select('id,username,avatar_url,is_test_account').limit(1000)),
        safeRows(sb.from('product_companies').select('id,owner_id,company_name,logo_data_url,description,product_lines,total_revenue,total_costs,created_at').order('created_at', { ascending: false }).limit(1000)),
        safeRows(sb.from('product_company_products').select('id,company_id,owner_id,product_name,product_line,listed_price,product_value,purchase_count,status,created_at').eq('status', 'published').order('created_at', { ascending: false }).limit(2000)),
        safeRows(sb.from('coins').select('id,name,ticker,image_url,creator_id,price,created_at').order('created_at', { ascending: false }).limit(1000)),
        safeRows(sb.from('trades').select('id,coin_id,user_id,type,amount_usd,created_at').eq('type', 'buy').gte('created_at', cutoff).order('created_at', { ascending: false }).limit(2000)),
        safeRows(sb.from('company_stock_trades').select('id,company_id,user_id,type,amount_usd,created_at').eq('type', 'buy').gte('created_at', cutoff).order('created_at', { ascending: false }).limit(1500)),
        safeRows(sb.rpc('get_grindworld_product_purchases')),
        safeRows(sb.from('holdings').select('user_id,coin_id,shares').gt('shares', 0).limit(5000))
      ]);

      const profileById = new Map(profiles.filter(p => p?.id && !p.is_test_account).map(p => [String(p.id), p]));
      if (currentUser?.is_test_account) {
        state.nodes = [];
        state.edges = [];
        state.nodeById.clear();
        $('grindWorldStats').textContent = 'Test accounts are not shown in GrindWorld.';
        $('grindWorldLoading')?.classList.add('hidden');
        state.loaded = true;
        state.lastLoadedAt = Date.now();
        draw();
        return;
      }
      const userExists = id => Boolean(id && profileById.has(String(id)));
      const companyRows = companies.filter(c => c?.id && userExists(c.owner_id));
      const companyById = new Map(companyRows.map(c => [String(c.id), c]));
      const productRows = products.filter(p => p?.id && p.status === 'published' && companyById.has(String(p.company_id)) && userExists(p.owner_id));
      const productById = new Map(productRows.map(p => [String(p.id), p]));
      const coinRows = coins.filter(c => c?.id && userExists(c.creator_id));
      const coinById = new Map(coinRows.map(c => [String(c.id), c]));
      const validCoinBuys = coinBuys.filter(t => t?.coin_id && coinById.has(String(t.coin_id)) && userExists(t.user_id) && isRecent(t.created_at));
      const validCompanyBuys = companyBuys.filter(t => t?.company_id && companyById.has(String(t.company_id)) && userExists(t.user_id) && isRecent(t.created_at));
      const validProductPurchases = productPurchases.filter(p => p?.product_id && productById.has(String(p.product_id)) && userExists(p.buyer_id) && isRecent(p.created_at));

      const activeUserIds = new Set();
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
      productRows.forEach(p => {
        const key = String(p.company_id);
        if (!productsByCompany.has(key)) productsByCompany.set(key, []);
        productsByCompany.get(key).push(p);
        addScore(p.owner_id, Math.max(0, Number(p.product_value || 0)) * 0.25);
      });
      companyRows.forEach(c => addScore(c.owner_id,
        Math.max(0, Number(c.total_revenue || 0)) +
        Math.max(0, Number(c.total_costs || 0)) * 0.15
      ));
      const coinTradeVolumeByCreator = new Map();
      validCoinBuys.forEach(t => {
        const creatorId = String(coinById.get(String(t.coin_id))?.creator_id || '');
        coinTradeVolumeByCreator.set(creatorId, (coinTradeVolumeByCreator.get(creatorId) || 0) + Number(t.amount_usd || 0));
      });
      coinTradeVolumeByCreator.forEach((volume, creatorId) => addScore(creatorId, volume * 0.2));
      const coinPriceById = new Map(coinRows.map(c => [String(c.id), Number(c.price || 1)]));
      holdings.forEach(h => {
        if (userExists(h.user_id) && coinPriceById.has(String(h.coin_id))) {
          addScore(h.user_id, Number(h.shares || 0) * coinPriceById.get(String(h.coin_id)));
        }
      });
      validCompanyBuys.forEach(t => addScore(t.user_id, Number(t.amount_usd || 0) * 0.35));
      validProductPurchases.forEach(p => addScore(p.buyer_id, 1));

      const nodes = [];
      const nodeById = new Map();
      const edges = [];
      const edgeByKey = new Map();
      const addNode = node => {
        node.id = String(node.id);
        nodes.push(node);
        nodeById.set(node.id, node);
      };
      const addEdge = (key, from, to, type, activityAt = null, activityCount = 0) => {
        if (!nodeById.has(String(from)) || !nodeById.has(String(to))) return;
        let edge = edgeByKey.get(key);
        if (!edge) {
          edge = { key, from: String(from), to: String(to), type, activityAt: null, activityCount: 0 };
          edgeByKey.set(key, edge);
          edges.push(edge);
        }
        if (activityAt && isRecent(activityAt)) {
          const ts = new Date(activityAt).getTime();
          if (!edge.activityAt || ts > edge.activityAt) edge.activityAt = ts;
          edge.activityCount += Math.max(1, Number(activityCount) || 1);
        }
      };

      const activeProfiles = [...activeUserIds]
        .map(id => profileById.get(id))
        .filter(Boolean)
        .sort((a, b) => (scoreByUser.get(String(b.id)) || 0) - (scoreByUser.get(String(a.id)) || 0));
      const columns = Math.max(1, Math.ceil(Math.sqrt(activeProfiles.length * 1.25)));
      const rows = Math.max(1, Math.ceil(activeProfiles.length / columns));
      const cellW = 510, cellH = 420;
      state.world = { width: columns * cellW + 120, height: rows * cellH + 120 };
      const userPosition = new Map();
      const maxScore = Math.max(1, ...[...scoreByUser.values()]);
      activeProfiles.forEach((profile, index) => {
        const col = index % columns;
        const row = Math.floor(index / columns);
        const seed = hash(profile.id);
        const x = 90 + col * cellW + 210 + ((seed % 61) - 30);
        const y = 90 + row * cellH + 175 + (((seed >>> 8) % 61) - 30);
        const score = scoreByUser.get(String(profile.id)) || 1;
        const userId = 'user:' + profile.id;
        userPosition.set(String(profile.id), { x, y });
        addNode({
          id: userId, kind: 'user', label: profile.username || 'Trader',
          meta: 'Market footprint ' + Math.round(score).toLocaleString(),
          image: profile.avatar_url || '', color: colorFor(profile.id), score,
          radius: 25, x, y, profileId: String(profile.id)
        });
      });

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
          const x = base.x + Math.cos(angle) * 92;
          const y = base.y + Math.sin(angle) * 72;
          const id = 'company:' + company.id;
          addNode({
            id, kind: 'company', label: company.company_name || 'Company',
            meta: (company.product_lines || []).join(' / ').toUpperCase() + ' · ' + productRows.filter(p => String(p.company_id) === String(company.id)).length + ' products',
            image: company.logo_data_url || '', color: colorFor(ownerId), radius: 20,
            x, y, companyId: String(company.id), ownerId
          });
          addEdge('owner:' + company.id, 'user:' + ownerId, id, 'owner', company.created_at, 1);
          const listProducts = productsByCompany.get(String(company.id)) || [];
          listProducts.forEach((product, productIndex) => {
            const pAngle = (Math.PI * 2 * productIndex / Math.max(1, listProducts.length)) - Math.PI / 2;
            const pX = x + Math.cos(pAngle) * 57;
            const pY = y + Math.sin(pAngle) * 49;
            const productId = 'product:' + product.id;
            addNode({
              id: productId, kind: 'product', label: product.product_name || 'Product',
              meta: String(product.product_line || 'product').toUpperCase() + ' · ' + Number(product.purchase_count || 0) + ' units sold',
              image: product.design_data?.thumbnail || '', color: colorFor(ownerId),
              radius: 14, x: pX, y: pY, productId: String(product.id), companyId: String(company.id),
              ownerId, line: product.product_line
            });
            addEdge('company-product:' + product.id, id, productId, 'product', product.created_at, 1);
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
          const x = base.x + Math.cos(angle) * 166;
          const y = base.y + Math.sin(angle) * 132;
          const id = 'coin:' + coin.id;
          addNode({
            id, kind: 'coin', label: coin.name || coin.ticker || 'Coin',
            meta: '$' + String(coin.ticker || '').toUpperCase() + ' · ' + Number(coin.price || 1).toFixed(2),
            image: coin.image_url || '', color: colorFor(creatorId), radius: 17,
            x, y, coinId: String(coin.id), ownerId: creatorId
          });
          addEdge('coin-creator:' + coin.id, 'user:' + creatorId, id, 'coin-owner', coin.created_at, 1);
        });
      });

      const coinBuyerEdges = new Map();
      validCoinBuys.forEach(t => {
        const key = String(t.user_id) + '|' + String(t.coin_id);
        const prev = coinBuyerEdges.get(key);
        if (!prev || new Date(t.created_at).getTime() > new Date(prev.created_at).getTime()) {
          coinBuyerEdges.set(key, t);
        }
      });
      coinBuyerEdges.forEach(t => {
        const coin = coinById.get(String(t.coin_id));
        if (!coin || String(coin.creator_id) === String(t.user_id)) return;
        addEdge('coin-buyer:' + t.user_id + ':' + t.coin_id, 'user:' + t.user_id, 'coin:' + t.coin_id, 'coin-buy', t.created_at, 1);
      });

      const companyBuyerEdges = new Map();
      validCompanyBuys.forEach(t => {
        const key = String(t.user_id) + '|' + String(t.company_id);
        const prev = companyBuyerEdges.get(key);
        if (!prev || new Date(t.created_at).getTime() > new Date(prev.created_at).getTime()) {
          companyBuyerEdges.set(key, t);
        }
      });
      companyBuyerEdges.forEach(t => {
        const company = companyById.get(String(t.company_id));
        if (!company || String(company.owner_id) === String(t.user_id)) return;
        addEdge('company-investor:' + t.user_id + ':' + t.company_id, 'user:' + t.user_id, 'company:' + t.company_id, 'company-buy', t.created_at, 1);
      });

      const productBuyerEdges = new Map();
      validProductPurchases.forEach(p => {
        const buyerCompanyId = p.buyer_company_id && companyById.has(String(p.buyer_company_id))
          ? String(p.buyer_company_id) : '';
        const buyerNodeId = buyerCompanyId ? 'company:' + buyerCompanyId : 'user:' + p.buyer_id;
        const key = buyerNodeId + '|' + String(p.product_id);
        const prev = productBuyerEdges.get(key);
        if (!prev || new Date(p.created_at).getTime() > new Date(prev.created_at).getTime()) {
          productBuyerEdges.set(key, p);
        }
      });
      productBuyerEdges.forEach(p => {
        const buyerCompanyId = p.buyer_company_id && companyById.has(String(p.buyer_company_id))
          ? String(p.buyer_company_id) : '';
        const buyerNodeId = buyerCompanyId ? 'company:' + buyerCompanyId : 'user:' + p.buyer_id;
        const sellerCompanyId = productById.get(String(p.product_id))?.company_id;
        if (buyerCompanyId && String(buyerCompanyId) === String(sellerCompanyId)) return;
        addEdge('product-buyer:' + buyerNodeId + ':' + p.product_id, buyerNodeId, 'product:' + p.product_id, 'product-buy', p.created_at, 1);
      });

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
      fitView();
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
    const fit = Math.min(state.width / state.world.width, state.height / state.world.height) * 0.92;
    state.camera.zoom = Math.max(0.08, Math.min(1.4, fit));
    draw();
  }

  function zoomAt(screenX, screenY, factor) {
    const old = state.camera.zoom;
    const next = Math.max(0.07, Math.min(2.5, old * factor));
    const worldX = (screenX - state.width / 2) / old + state.camera.x;
    const worldY = (screenY - state.height / 2) / old + state.camera.y;
    state.camera.zoom = next;
    state.camera.x = worldX - (screenX - state.width / 2) / next;
    state.camera.y = worldY - (screenY - state.height / 2) / next;
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

  function drawRegion(ctx, node, maxScore) {
    const ratio = Math.max(0.015, Number(node.score || 1) / maxScore);
    const radius = 58 + Math.sqrt(ratio) * 230;
    const seed = hash(node.profileId);
    const points = 13;
    const path = [];
    for (let i = 0; i < points; i++) {
      const angle = (Math.PI * 2 * i / points);
      const wobble = 0.78 + (((seed >>> (i % 24)) & 15) / 48);
      path.push({
        x: node.x + Math.cos(angle) * radius * wobble,
        y: node.y + Math.sin(angle) * radius * wobble * 0.82
      });
    }
    ctx.beginPath();
    path.forEach((p, i) => {
      const next = path[(i + 1) % path.length];
      const midX = (p.x + next.x) / 2;
      const midY = (p.y + next.y) / 2;
      if (i === 0) ctx.moveTo(midX, midY);
      ctx.quadraticCurveTo(p.x, p.y, midX, midY);
    });
    ctx.closePath();
    ctx.fillStyle = 'hsla(' + hueFor(node.profileId) + ', 78%, 54%, .13)';
    ctx.fill();
    ctx.strokeStyle = 'hsla(' + hueFor(node.profileId) + ', 82%, 65%, .12)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
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

    const users = state.nodes.filter(n => n.kind === 'user');
    const maxScore = Math.max(1, ...users.map(n => Number(n.score || 1)));
    users.forEach(user => drawRegion(ctx, user, maxScore));

    const now = performance.now();
    state.edges.forEach(edge => {
      const from = state.nodeById.get(edge.from);
      const to = state.nodeById.get(edge.to);
      if (!from || !to) return;
      const active = edge.activityAt && Date.now() - edge.activityAt <= ACTIVE_MS;
      const color = from.color || to.color || '#8b5cf6';
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.lineWidth = active ? 2.1 : 1.15;
      ctx.strokeStyle = active ? color.replace('hsl(', 'hsla(').replace(')', ' / .72)') : 'rgba(170,170,190,.17)';
      if (active) {
        ctx.shadowBlur = 10;
        ctx.shadowColor = color;
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      if (active) {
        const count = Math.min(3, Math.max(1, Math.ceil(Math.log2((edge.activityCount || 1) + 1))));
        for (let i = 0; i < count; i++) {
          const phase = ((now / (1550 + i * 230)) + (hash(edge.key) % 997) / 997 + i / count) % 1;
          const px = from.x + (to.x - from.x) * phase;
          const py = from.y + (to.y - from.y) * phase;
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
    if (state.raf || document.hidden) return;
    const tick = () => {
      state.raf = 0;
      if (document.hidden || currentPage !== 'grindworld') return;
      draw();
      state.raf = requestAnimationFrame(tick);
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