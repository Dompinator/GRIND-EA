/* ============================================================
 * GRIND-EA · Company Stock Market ("Companies" Feed + Dashboard Stocks)
 * - Sales/revenue drives share price up; investor trades use gentle curve (STOCK_K = 0.002)
 * - Customers can buy & sell shares anytime (just like Coins)
 * - At 00:00 UTC daily, company owner receives the stock's current worth (share price) for free
 * ============================================================ */
(function () {
  'use strict';

  const STOCK_K = 0.002; // 4x softer investor curve impact than Coins (0.008)
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let companyStocksList = [];
  let companyStockSort = 'top_price'; // 'top_price' | 'top_sales' | 'most_owned' | 'newest'
  let companyFeedSearchQuery = '';
  let selectedCompanyStockId = null;
  let selectedBuyAmount = 10;
  let stockChartZoom = 1.0;
  let stockTradeBusy = false;
  let countdownTimerId = 0;
  let lastAutoClaimKey = '';

  const fmtMoney = v => (typeof money === 'function' ? money(v) : '$' + Number(v || 0).toFixed(2));
  const fmtPrice = v => (typeof priceFmt === 'function' ? priceFmt(v) : '$' + Number(v || 0).toFixed(2));

  function utcDateKey(date = new Date()) {
    return date.toISOString().slice(0, 10);
  }

  function msUntilNextUtcMidnight() {
    const now = new Date();
    const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0);
    return Math.max(0, next - now.getTime());
  }

  function formatCountdown(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return [h, m, s].map(n => String(n).padStart(2, '0')).join(':');
  }

  function calcSalesMultiplier(revenue) {
    return 1.0 + Math.max(0, Number(revenue || 0)) * 0.0025;
  }

  function calcSharePrice(curvePrice, revenue) {
    const cp = Math.max(1.0, Number(curvePrice || 1.0));
    return Math.max(0.01, Math.round(cp * calcSalesMultiplier(revenue) * 10000) / 10000);
  }

  function calcTotalOwnedUsd(curvePrice, revenue) {
    const cp = Math.max(1.0, Number(curvePrice || 1.0));
    const mult = calcSalesMultiplier(revenue);
    return Math.round(Math.max(0, ((cp - 1.0) / STOCK_K) * mult) * 100) / 100;
  }

  function calcStockHoldingValue(curvePrice, revenue, shares) {
    const cp = Math.max(1.0, Number(curvePrice || 1.0));
    const mult = calcSalesMultiplier(revenue);
    const s = Math.max(0, Number(shares || 0));
    if (s <= 0) return 0;
    const newCp = Math.max(1.0, cp * Math.exp(-STOCK_K * s));
    const raw = Math.max(0, (cp - newCp) / STOCK_K) * mult;
    return Math.floor((raw + 1e-9) * 100) / 100;
  }

  function lineLabel(comp) {
    const lines = Array.isArray(comp?.product_lines) ? comp.product_lines : [];
    if (lines.includes('pc')) return 'PC CO.';
    if (lines.includes('motherboard')) return 'MOBO CO.';
    if (lines.includes('gpu')) return 'GPU CO.';
    return 'CPU CO.';
  }

  function startCountdownLoop() {
    if (countdownTimerId) return;
    countdownTimerId = setInterval(() => {
      const txt = formatCountdown(msUntilNextUtcMidnight());
      document.querySelectorAll('[data-stock-countdown]').forEach(el => {
        el.textContent = txt;
      });
    }, 1000);
  }

  function normalizeCompanyStockRow(comp, stockRow) {
    const revenue = Number(comp?.total_revenue || 0);
    const costs = Number(comp?.total_costs || 0);
    const curvePrice = Math.max(1.0, Number(stockRow?.curve_price || 1.0));
    const salesMult = calcSalesMultiplier(revenue);
    const sharePrice = calcSharePrice(curvePrice, revenue);
    const today = utcDateKey();
    const openToday = stockRow?.open_price_date === today
      ? Math.max(0.01, Number(stockRow.open_price_today || sharePrice))
      : sharePrice;
    const rawPct = openToday > 0 ? ((sharePrice - openToday) / openToday) * 100 : 0;
    const changePct = Math.abs(rawPct) < 0.005 ? 0 : rawPct;
    const ownedUsd = calcTotalOwnedUsd(curvePrice, revenue);

    return {
      ...comp,
      curve_price: curvePrice,
      sales_multiplier: salesMult,
      share_price: sharePrice,
      open_price_today: openToday,
      change_pct: changePct,
      owned_stock_usd: ownedUsd,
      last_payout_date: stockRow?.last_payout_date || today,
      last_payout_amount: Number(stockRow?.last_payout_amount || 0),
      total_stock_payouts: Number(stockRow?.total_stock_payouts || 0),
      total_revenue: revenue,
      total_costs: costs
    };
  }

  async function loadCompanyStocks(forceAutoClaim = true) {
    if (!sb) return [];
    const [{ data: comps, error: cErr }, { data: stocks, error: sErr }] = await Promise.all([
      sb.from('product_companies')
        .select('id,owner_id,company_name,logo_data_url,description,product_lines,total_revenue,total_costs,created_at')
        .order('created_at', { ascending: false })
        .limit(200),
      sb.from('company_stocks')
        .select('company_id,curve_price,open_price_today,open_price_date,last_payout_date,last_payout_amount,total_stock_payouts,updated_at')
        .limit(200)
    ]);

    if (cErr) {
      console.warn('Company stocks load error:', cErr);
      return companyStocksList;
    }

    const stockById = new Map((stocks || []).map(s => [String(s.company_id), s]));
    const ownerIds = [...new Set((comps || []).map(c => c.owner_id).filter(Boolean))];
    if (typeof ensureProfilesCached === 'function' && ownerIds.length) {
      await ensureProfilesCached(ownerIds);
    }

    companyStocksList = (comps || []).map(c => {
      const merged = normalizeCompanyStockRow(c, stockById.get(String(c.id)));
      const ownerProf = c.owner_id && typeof getCachedProfile === 'function' ? getCachedProfile(c.owner_id, null) : null;
      return { ...merged, owner_profile: ownerProf };
    });

    if (sErr) {
      // Table not yet created in Supabase -> still render preview cards cleanly
      console.warn('company_stocks table missing or unreachable:', sErr.message);
    }

    if (forceAutoClaim && currentUser) {
      checkAndClaimDailyPayouts(false).catch(() => {});
    }

    if (typeof feedType !== 'undefined' && feedType === 'company') {
      renderCompanyFeed();
    }
    if (currentCompany && $('#companyPanelStocks') && !$('#companyPanelStocks').classList.contains('hidden')) {
      renderDashboardStocksTab();
    }
    return companyStocksList;
  }

  function renderCompanyFeed() {
    const grid = $('#companyFeedGrid');
    const emptyEl = $('#emptyCompanyFeed');
    if (!grid) return;

    let list = [...companyStocksList];
    const q = (companyFeedSearchQuery || '').trim().toLowerCase();
    if (q) {
      list = list.filter(c => {
        const ownerName = c.owner_profile?.username || '';
        return (c.company_name || '').toLowerCase().includes(q) ||
          (c.description || '').toLowerCase().includes(q) ||
          lineLabel(c).toLowerCase().includes(q) ||
          ownerName.toLowerCase().includes(q);
      });
    }

    if (companyStockSort === 'top_price') {
      list.sort((a, b) => Number(b.share_price) - Number(a.share_price) || Number(b.total_revenue) - Number(a.total_revenue));
    } else if (companyStockSort === 'top_sales') {
      list.sort((a, b) => Number(b.total_revenue) - Number(a.total_revenue) || Number(b.share_price) - Number(a.share_price));
    } else if (companyStockSort === 'most_owned') {
      list.sort((a, b) => Number(b.owned_stock_usd) - Number(a.owned_stock_usd) || Number(b.share_price) - Number(a.share_price));
    } else {
      list.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    }

    if (!list.length) {
      grid.innerHTML = '';
      grid.classList.add('hidden');
      emptyEl?.classList.remove('hidden');
      return;
    }

    emptyEl?.classList.add('hidden');
    grid.classList.remove('hidden');

    grid.innerHTML = list.map(c => {
      const chg = typeof formatChangePct === 'function'
        ? formatChangePct(c.change_pct)
        : { cls: c.change_pct >= 0 ? 'up' : 'down', text: (c.change_pct >= 0 ? '+' : '') + c.change_pct.toFixed(2) + '%' };
      const ownerName = c.owner_profile?.username || 'Founder';
      const ownerObj = c.owner_profile ? { ...c.owner_profile, id: c.owner_id } : { id: c.owner_id };
      const badge = typeof tierBadgeHtml === 'function' ? tierBadgeHtml(ownerObj) : '';
      return `
        <article class="coin-card ea-stock-card" data-company-stock-id="${esc(c.id)}">
          <div class="coin-top">
            <div class="coin-logo">${c.logo_data_url ? `<img src="${esc(c.logo_data_url)}" alt="">` : esc((c.company_name || 'C')[0].toUpperCase())}</div>
            <div style="flex:1;min-width:0;">
              <div class="coin-name">${esc(c.company_name || 'Company')}</div>
              <div class="coin-ticker">${esc(lineLabel(c))} · ${c.sales_multiplier.toFixed(2)}× Sales</div>
            </div>
            <span class="ea-stock-owned-chip" title="Investor stock held">$${Number(c.owned_stock_usd || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} held</span>
          </div>
          <div class="coin-price">${fmtPrice(c.share_price)}</div>
          <div class="coin-change ${chg.cls}">${chg.text}</div>
          <p class="coin-desc">${esc(c.description || 'Manufacturing hardware on GRIND.')}</p>
          <div class="ea-stock-card-meta">
            <span>Sales: <b>${fmtMoney(c.total_revenue)}</b></span>
            <span>00:00 Payout: <b>${fmtPrice(c.share_price)}</b></span>
          </div>
          ${c.owner_id ? `
            <button type="button" class="creator-chip" data-profile="${esc(c.owner_id)}">
              <span class="creator-mini-av">${c.owner_profile?.avatar_url ? `<img src="${esc(c.owner_profile.avatar_url)}">` : esc(ownerName[0].toUpperCase())}</span>
              <span>${esc(ownerName)}${badge}</span>
            </button>
          ` : ''}
        </article>`;
    }).join('');

    grid.querySelectorAll('[data-company-stock-id]').forEach(card => {
      card.addEventListener('click', () => openCompanyStock(card.dataset.companyStockId));
    });
    grid.querySelectorAll('[data-profile]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        if (typeof openProfileModal === 'function') openProfileModal(btn.dataset.profile);
      });
    });
  }

  async function openCompanyStock(companyId) {
    selectedCompanyStockId = companyId;
    stockChartZoom = 1.0;
    if (!companyStocksList.some(c => String(c.id) === String(companyId))) {
      await loadCompanyStocks(false);
    }
    if (typeof showPage === 'function') showPage('company-stock');
    await renderCompanyStockDetail();
  }

  async function renderCompanyStockDetail() {
    const wrap = $('#companyStockDetail');
    if (!wrap || !selectedCompanyStockId || !sb || !currentUser) return;

    const [{ data: comp }, { data: stockRow }, { data: myHold }, { data: trades }, { data: allHolds }, { data: products, error: productsError }, { data: series, error: seriesError }] = await Promise.all([
      sb.from('product_companies').select('*').eq('id', selectedCompanyStockId).single(),
      sb.from('company_stocks').select('*').eq('company_id', selectedCompanyStockId).maybeSingle(),
      sb.from('company_stock_holdings').select('*').eq('user_id', currentUser.id).eq('company_id', selectedCompanyStockId).maybeSingle(),
      sb.from('company_stock_trades').select('*').eq('company_id', selectedCompanyStockId).order('created_at', { ascending: false }).limit(120),
      sb.from('company_stock_holdings').select('user_id,shares,total_spent_usd,total_returned_usd').eq('company_id', selectedCompanyStockId).gt('shares', 0),
      sb.from('product_company_products').select('id,company_id,owner_id,product_name,product_line,listed_price,stock,purchase_count,cpu_score,cpu_tier,core_count,thread_count,body_type,cooling_type,graphics_type,v_cache_type,carbon_fiber_body,silicon_body,product_value,production_cost,design_data,status,series_id').eq('company_id', selectedCompanyStockId).eq('status', 'published').order('created_at', { ascending: false }),
      sb.from('product_company_series').select('id,company_id,name,created_at').eq('company_id', selectedCompanyStockId).order('created_at', { ascending: true })
    ]);

    if (!comp) {
      wrap.innerHTML = '<div class="empty-state"><h3>Company not found</h3></div>';
      return;
    }
    if (seriesError) console.warn('Company Series could not be loaded:', seriesError);

    const userIds = [
      comp.owner_id,
      ...(trades || []).map(t => t.user_id),
      ...(allHolds || []).map(h => h.user_id)
    ].filter(Boolean);
    if (typeof ensureProfilesCached === 'function' && userIds.length) {
      await ensureProfilesCached([...new Set(userIds)]);
    }

    const c = normalizeCompanyStockRow(comp, stockRow);
    const ownerProf = comp.owner_id && typeof getCachedProfile === 'function' ? getCachedProfile(comp.owner_id, null) : null;
    const ownerName = ownerProf?.username || 'Founder';
    const ownerObj = ownerProf ? { ...ownerProf, id: comp.owner_id } : { id: comp.owner_id };
    const isOwner = String(comp.owner_id) === String(currentUser.id);
    const shares = Number(myHold?.shares || 0);
    const holdingVal = calcStockHoldingValue(c.curve_price, c.total_revenue, shares);
    const chg = typeof formatChangePct === 'function'
      ? formatChangePct(c.change_pct)
      : { cls: 'up', text: '0.00%' };

    let sellPreviewHtml = '';
    if (shares > 1e-8) {
      const netPutIn = Math.max(0, Number(myHold?.total_spent_usd || 0) - Number(myHold?.total_returned_usd || 0));
      const diff = holdingVal - netPutIn;
      const absDiff = Math.abs(diff);
      const cls = absDiff < 0.005 ? 'flat' : diff > 0 ? 'gain' : 'loss';
      const headline = absDiff < 0.005
        ? 'You will break even (<strong>$0.00</strong>) when selling 100%'
        : diff > 0
          ? `You will gain <strong>+${fmtMoney(absDiff)}</strong> when you sell 100%`
          : `You will lose <strong>−${fmtMoney(absDiff)}</strong> when you sell 100%`;
      sellPreviewHtml = `
        <div class="sell-all-preview ${cls}">
          <span class="sell-all-main">${headline}</span>
          <span class="sell-all-sub muted">Get ${fmtMoney(holdingVal)} vs ${fmtMoney(netPutIn)} net put in</span>
        </div>`;
    }

    const buyBtnLabel = selectedBuyAmount > 0 ? `Invest ${fmtMoney(selectedBuyAmount)}` : 'Enter amount';

    wrap.innerHTML = `
      <div class="coin-detail-hero">
        <div class="coin-logo">${c.logo_data_url ? `<img src="${esc(c.logo_data_url)}" alt="">` : esc((c.company_name || 'C')[0].toUpperCase())}</div>
        <div style="flex:1;">
          <h3>${esc(c.company_name)} <span class="muted">${esc(lineLabel(c))} STOCK</span></h3>
          <p>${esc(c.description || 'GRIND hardware company.')}</p>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px;">
            ${c.owner_id ? `
              <button type="button" class="creator-chip" style="margin-top:0;" data-profile="${esc(c.owner_id)}">
                <span class="creator-mini-av">${ownerProf?.avatar_url ? `<img src="${esc(ownerProf.avatar_url)}">` : esc(ownerName[0].toUpperCase())}</span>
                <span>Owned by ${esc(ownerName)}${typeof tierBadgeHtml === 'function' ? tierBadgeHtml(ownerObj) : ''}</span>
              </button>
            ` : ''}
            <span class="ea-stock-rule-pill">Sales Multiplier: ${c.sales_multiplier.toFixed(2)}× · Soft 0.25× Trade Swing</span>
          </div>
        </div>
      </div>

      <section class="detail-panel" style="margin:18px 0;">
        <h4>Series</h4>
        <div class="muted tiny" style="margin-bottom:12px;">Published products organized by ${esc(c.company_name)}</div>
        <div id="eaPublicCompanyProducts">
          ${productsError ? '<p class="muted">Could not load this company\'s products.</p>' : (products || []).length ? `
            ${(series || []).map(folder => {
              const members = seriesError ? [] : (products || []).filter(p => p.series_id === folder.id);
              if (!members.length) return '';
              return `
                <section class="company-series-block public-company-series">
                  <div class="company-series-heading"><div class="company-series-folder-title"><span class="company-series-folder-icon">📁</span><div><strong>${esc(folder.name)}</strong><small>${members.length} product${members.length === 1 ? '' : 's'}</small></div></div></div>
                  <div class="published-product-grid">${members.map(p => `
                    <article class="published-product-card">
                      <h4>${esc(p.product_name || 'Product')}</h4><p>${esc(String(p.product_line || '').toUpperCase())}</p>
                      <strong>${fmtMoney(p.listed_price || 0)}</strong><p>${Number(p.stock || 0) > 0 ? Number(p.stock) + ' in stock' : 'Out Of Stock'}</p>
                      <p class="muted tiny">${Number(p.purchase_count || 0)} sold</p>
                      <div class="ea-product-card-actions"><button type="button" class="zoom-btn ea-product-preview-btn" data-preview-stock-product="${esc(p.id)}">👁 Preview</button></div>
                    </article>`).join('')}</div>
                </section>`;
            }).join('')}
            ${(products || []).some(p => !p.series_id || seriesError) ? `
              <section class="company-series-block public-company-series">
                <div class="company-series-heading"><div class="company-series-folder-title"><span class="company-series-folder-icon">📦</span><div><strong>Other Products</strong><small>${(products || []).filter(p => !p.series_id || seriesError).length} unassigned products</small></div></div></div>
                <div class="published-product-grid">${(products || []).filter(p => !p.series_id || seriesError).map(p => `
                  <article class="published-product-card">
                    <h4>${esc(p.product_name || 'Product')}</h4><p>${esc(String(p.product_line || '').toUpperCase())}</p>
                    <strong>${fmtMoney(p.listed_price || 0)}</strong><p>${Number(p.stock || 0) > 0 ? Number(p.stock) + ' in stock' : 'Out Of Stock'}</p>
                    <p class="muted tiny">${Number(p.purchase_count || 0)} sold</p>
                    <div class="ea-product-card-actions"><button type="button" class="zoom-btn ea-product-preview-btn" data-preview-stock-product="${esc(p.id)}">👁 Preview</button></div>
                  </article>`).join('')}</div>
              </section>` : ''}
            ${!(products || []).length ? '<p class="muted">This company has not published any products yet.</p>' : ''}
          ` : '<p class="muted">This company has not published any products yet.</p>'}
        </div>
      </section>

      <div class="detail-price">${fmtPrice(c.share_price)}</div>
      <div class="coin-change ${chg.cls}">${chg.text}</div>

      <div class="ea-stock-metrics-row">
        <div class="ea-stock-metric"><span>Investor Pool</span><strong>${fmtMoney(c.owned_stock_usd)}</strong><small>Total capital invested in shares</small></div>
        <div class="ea-stock-metric"><span>Next 00:00 Payout</span><strong data-stock-countdown>${formatCountdown(msUntilNextUtcMidnight())}</strong><small>Est. ${fmtPrice(c.share_price)} stock worth</small></div>
        <div class="ea-stock-metric"><span>Company Total Sales</span><strong>${fmtMoney(c.total_revenue)}</strong><small>Sales lift stock price automatically</small></div>
        <div class="ea-stock-metric"><span>Lifetime 00:00 Payouts</span><strong>${fmtMoney(c.total_stock_payouts)}</strong><small>Earned from daily stock worth</small></div>
      </div>

      <div class="chart-wrap">
        <div class="chart-head">
          <div>
            <strong>Stock price history (Sales + Trades)</strong>
            <div class="muted tiny">Gold S markers = Company revenue boost · Bubbles = Investor buys/sells</div>
          </div>
          <div class="chart-controls">
            <div class="zoom-controls">
              <button type="button" class="zoom-btn" id="csZoomOut">−</button>
              <span class="zoom-level" id="csZoomLevel">Fit</span>
              <button type="button" class="zoom-btn" id="csZoomIn">+</button>
              <button type="button" class="zoom-btn" id="csZoomFit">Fit</button>
            </div>
          </div>
        </div>
        <div class="chart-scroll" id="csChartScroll">
          <div id="csChartInner"><canvas id="csPriceChart" height="300"></canvas></div>
        </div>
      </div>

      <div class="trade-box">
        ${isOwner ? `
          <div class="ea-stock-owner-note">
            <strong>Owner View</strong>
            <p class="muted tiny">Company owners cannot buy their own stock. Grow product sales and attract investors to raise the stock price — at <b>00:00 UTC</b> every day you receive <b>${fmtPrice(c.share_price)}</b> (your stock's current worth) for free!</p>
          </div>
        ` : `
          <div class="buy-row">
            <div class="buy-presets" id="csBuyPresets">
              ${[1, 5, 10, 25, 50, 100].map(a => `<button type="button" class="amount-btn ${selectedBuyAmount === a ? 'active' : ''}" data-cs-buy="${a}">$${a}</button>`).join('')}
            </div>
            <div class="custom-buy-box">
              <span>$</span>
              <input id="csCustomBuy" type="number" min="0.01" step="0.01" placeholder="Custom" value="${selectedBuyAmount || ''}">
            </div>
            <button type="button" class="primary-btn" id="csBuyBtn">${buyBtnLabel}</button>
          </div>
          <div class="sell-row">
            <div>
              <div class="muted tiny">Your shares</div>
              <strong>${shares.toFixed(4)} (${fmtMoney(holdingVal)})</strong>
            </div>
            <div class="sell-btns">
              <button type="button" class="sell-btn" data-cs-sell="0.25" ${shares <= 0 ? 'disabled' : ''}>Sell 25%</button>
              <button type="button" class="sell-btn" data-cs-sell="0.5" ${shares <= 0 ? 'disabled' : ''}>Sell 50%</button>
              <button type="button" class="sell-btn" data-cs-sell="1" ${shares <= 0 ? 'disabled' : ''}>Sell 100%</button>
            </div>
          </div>
          ${sellPreviewHtml}
          <p class="form-message" id="csTradeMsg"></p>
        `}
      </div>

      <div class="detail-panels">
        <div class="detail-panel">
          <h4>Top stockholders</h4>
          <div id="csHoldersList"></div>
        </div>
        <div class="detail-panel">
          <h4>Recent stock activity</h4>
          <div id="csActivityList"></div>
        </div>
      </div>
    `;

    startCountdownLoop();

    const prodMap = new Map((products || []).map(p => [String(p.id), { ...p, product_companies: { company_name: c.company_name, logo_data_url: c.logo_data_url } }]));
    wrap.querySelectorAll('[data-preview-stock-product]').forEach(btn => btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const prod = prodMap.get(String(btn.dataset.previewStockProduct));
      if (prod) window.openProductPreview?.(prod, c.company_name);
    }));

    wrap.querySelectorAll('[data-profile]').forEach(btn => btn.addEventListener('click', () => {
      if (typeof openProfileModal === 'function') openProfileModal(btn.dataset.profile);
    }));

    const holdersEl = $('#csHoldersList');
    if (holdersEl) {
      const sortedHolds = (allHolds || [])
        .map(h => {
          const val = calcStockHoldingValue(c.curve_price, c.total_revenue, h.shares);
          const prof = typeof getCachedProfile === 'function' ? getCachedProfile(h.user_id, null) : null;
          return { ...h, val, prof };
        })
        .sort((a, b) => b.val - a.val);

      holdersEl.innerHTML = sortedHolds.length
        ? sortedHolds.map((h, i) => {
            const uname = h.prof?.username || 'Investor';
            return `<div class="lb-row"><span><b>#${i + 1}</b> ${esc(uname)} (${Number(h.shares).toFixed(2)} sh)</span><strong>${fmtMoney(h.val)}</strong></div>`;
          }).join('')
        : '<p class="muted tiny">No external stockholders yet.</p>';
    }

    const actEl = $('#csActivityList');
    if (actEl) {
      const recent = (trades || []).slice(0, 20);
      actEl.innerHTML = recent.length
        ? recent.map(t => {
            const prof = typeof getCachedProfile === 'function' ? getCachedProfile(t.user_id, null) : null;
            const uname = prof?.username || 'Trader';
            const label = t.type === 'sales'
              ? `Company sale (+${fmtMoney(t.amount_usd)} rev)`
              : `${t.type === 'buy' ? 'Bought' : 'Sold'} ${fmtMoney(t.amount_usd)} · ${esc(uname)}`;
            return `<div class="lb-row"><span>${label}</span><strong>${fmtPrice(t.price_after)}</strong></div>`;
          }).join('')
        : '<p class="muted tiny">No stock trades or sales logged yet.</p>';
    }

    if (!isOwner) {
      const customInp = $('#csCustomBuy');
      const buyBtn = $('#csBuyBtn');
      const syncBuyBtn = () => {
        if (buyBtn) buyBtn.textContent = selectedBuyAmount > 0 ? `Invest ${fmtMoney(selectedBuyAmount)}` : 'Enter amount';
      };
      wrap.querySelectorAll('[data-cs-buy]').forEach(b => b.addEventListener('click', () => {
        selectedBuyAmount = Number(b.dataset.csBuy || 10);
        wrap.querySelectorAll('[data-cs-buy]').forEach(x => x.classList.toggle('active', x === b));
        if (customInp) customInp.value = String(selectedBuyAmount);
        syncBuyBtn();
      }));
      customInp?.addEventListener('input', () => {
        const v = Math.round(Number(customInp.value || 0) * 100) / 100;
        selectedBuyAmount = v > 0 ? v : 0;
        wrap.querySelectorAll('[data-cs-buy]').forEach(x => x.classList.remove('active'));
        syncBuyBtn();
      });
      buyBtn?.addEventListener('click', () => buyCompanyStock(c.id, selectedBuyAmount));
      wrap.querySelectorAll('[data-cs-sell]').forEach(b => b.addEventListener('click', () => {
        sellCompanyStock(c.id, shares * Number(b.dataset.csSell || 0));
      }));
    }

    const redraw = () => drawCompanyStockChart(c, (trades || []).slice().reverse());
    $('#csZoomOut')?.addEventListener('click', () => { stockChartZoom = Math.max(1.0, +(stockChartZoom - 0.35).toFixed(2)); redraw(); });
    $('#csZoomIn')?.addEventListener('click', () => { stockChartZoom = Math.min(4.0, +(stockChartZoom + 0.35).toFixed(2)); redraw(); });
    $('#csZoomFit')?.addEventListener('click', () => { stockChartZoom = 1.0; redraw(); });
    redraw();
  }

  function drawCompanyStockChart(c, chronoTrades) {
    const canvas = $('#csPriceChart');
    const inner = $('#csChartInner');
    const scroll = $('#csChartScroll');
    if (!canvas || !inner || !scroll) return;

    const zoomTxt = $('#csZoomLevel');
    if (zoomTxt) zoomTxt.textContent = stockChartZoom <= 1.0 ? 'Fit' : Math.round(stockChartZoom * 100) + '%';

    const baseW = Math.max(scroll.clientWidth || 600, 240);
    const H = baseW < 430 ? 240 : 290;
    const PAD_X = baseW < 430 ? 28 : 44;
    const PAD_TOP = 54;
    const PAD_BOT = 24;

    const points = [{ price: 1.0, trade: null }];
    (chronoTrades || []).forEach(t => {
      points.push({ price: Math.max(0.01, Number(t.price_after || c.share_price)), trade: t });
    });
    if (!chronoTrades?.length || Math.abs(points[points.length - 1].price - c.share_price) > 0.005) {
      points.push({ price: Math.max(0.01, Number(c.share_price || 1)), trade: null });
    }

    let W = baseW;
    if (stockChartZoom <= 1.0) {
      scroll.style.overflowX = 'hidden';
    } else {
      scroll.style.overflowX = 'auto';
      W = Math.max(baseW, Math.round(Math.max(baseW, (points.length - 1) * 44) * stockChartZoom));
    }

    inner.style.width = W + 'px';
    canvas.width = W;
    canvas.height = H;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);

    const prices = points.map(p => p.price);
    const minP = Math.min(...prices) * 0.96;
    const maxP = Math.max(...prices, minP + 0.05) * 1.04;
    const span = Math.max(0.05, maxP - minP);
    const plotW = Math.max(40, W - PAD_X * 2);
    const plotH = Math.max(40, H - PAD_TOP - PAD_BOT);

    const coords = points.map((p, i) => {
      const x = PAD_X + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
      const y = PAD_TOP + plotH - ((p.price - minP) / span) * plotH;
      return { x, y, ...p };
    });

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.font = '600 11px Inter, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(220,210,245,0.55)';
    for (let g = 0; g <= 3; g++) {
      const gy = PAD_TOP + (g / 3) * plotH;
      const gp = maxP - (g / 3) * span;
      ctx.beginPath();
      ctx.moveTo(PAD_X, gy);
      ctx.lineTo(W - PAD_X, gy);
      ctx.stroke();
      ctx.fillText(fmtPrice(gp), 6, gy - 4);
    }

    // Area + Line
    const grad = ctx.createLinearGradient(0, PAD_TOP, 0, H - PAD_BOT);
    grad.addColorStop(0, 'rgba(168, 85, 247, 0.34)');
    grad.addColorStop(1, 'rgba(168, 85, 247, 0.02)');
    ctx.beginPath();
    coords.forEach((pt, idx) => (idx === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
    ctx.lineTo(coords[coords.length - 1].x, H - PAD_BOT);
    ctx.lineTo(coords[0].x, H - PAD_BOT);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    coords.forEach((pt, idx) => (idx === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
    ctx.strokeStyle = '#c084fc';
    ctx.lineWidth = 2.6;
    ctx.stroke();

    // Plot bubbles on trades and sales milestones
    coords.forEach(pt => {
      if (!pt.trade) return;
      const isSales = pt.trade.type === 'sales';
      const isBuy = pt.trade.type === 'buy';
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, isSales ? 7 : 6, 0, Math.PI * 2);
      ctx.fillStyle = isSales ? '#f59e0b' : isBuy ? '#10b981' : '#ef4444';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#140f22';
      ctx.stroke();
      if (isSales) {
        ctx.fillStyle = '#fef3c7';
        ctx.font = '800 9px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('S', pt.x, pt.y - 11);
        ctx.textAlign = 'left';
      }
    });
  }

  async function buyCompanyStock(companyId, amount) {
    if (currentUser?.is_test_account) {
      const msgEl = $('#csTradeMsg');
      if (msgEl) msgEl.textContent = 'Test accounts cannot invest in company stocks.';
      return;
    }
    if (stockTradeBusy || !sb || !currentUser) return;
    const amt = Math.round(Number(amount || 0) * 100) / 100;
    const msgEl = $('#csTradeMsg');
    if (amt < 0.01) { if (msgEl) msgEl.textContent = 'Minimum investment is $0.01.'; return; }
    if (Number(currentUser.cash || 0) < amt) { if (msgEl) msgEl.textContent = 'Not enough cash.'; return; }

    stockTradeBusy = true;
    try {
      const { data, error } = await sb.rpc('buy_company_stock', { p_company_id: companyId, p_amount: amt });
      if (error) {
        if (msgEl) msgEl.textContent = error.message;
        toast(error.message);
        return;
      }
      if (data?.cash_remaining !== undefined) currentUser.cash = Number(data.cash_remaining);
      if (typeof updateUIProfile === 'function') updateUIProfile();
      if (typeof updateNetWorth === 'function') await updateNetWorth();
      if (typeof playSound === 'function') playSound('buy');
      toast(`Invested ${fmtMoney(amt)}! Share price: ${fmtPrice(data?.new_price || 1)}`);
      await loadCompanyStocks(false);
      await renderCompanyStockDetail();
    } finally {
      stockTradeBusy = false;
    }
  }

  async function sellCompanyStock(companyId, sharesToSell) {
    if (currentUser?.is_test_account) {
      const msgEl = $('#csTradeMsg');
      if (msgEl) msgEl.textContent = 'Test accounts cannot invest in company stocks.';
      return;
    }
    if (stockTradeBusy || !sb || !currentUser) return;
    const msgEl = $('#csTradeMsg');
    if (!sharesToSell || sharesToSell <= 0) { if (msgEl) msgEl.textContent = 'No shares to sell.'; return; }

    stockTradeBusy = true;
    try {
      const { data, error } = await sb.rpc('sell_company_stock', { p_company_id: companyId, p_shares: sharesToSell });
      if (error) {
        if (msgEl) msgEl.textContent = error.message;
        toast(error.message);
        return;
      }
      if (data?.cash_remaining !== undefined) currentUser.cash = Number(data.cash_remaining);
      if (typeof updateUIProfile === 'function') updateUIProfile();
      if (typeof updateNetWorth === 'function') await updateNetWorth();
      if (typeof playSound === 'function') playSound('sell');
      toast(`Sold shares for +${fmtMoney(data?.proceeds || 0)}!`);
      await loadCompanyStocks(false);
      await renderCompanyStockDetail();
    } finally {
      stockTradeBusy = false;
    }
  }

  async function checkAndClaimDailyPayouts(showNoPayoutToast = false) {
    if (!currentUser || !sb || !currentCompany) return;
    const today = utcDateKey();
    const claimKey = currentCompany.id + ':' + today;
    if (!showNoPayoutToast && lastAutoClaimKey === claimKey) return;

    const { data: st } = await sb.from('company_stocks')
      .select('last_payout_date')
      .eq('company_id', currentCompany.id)
      .maybeSingle();

    if (!st) return;
    if (st.last_payout_date >= today) {
      lastAutoClaimKey = claimKey;
      if (showNoPayoutToast) toast('Today\'s 00:00 stock payout has already settled!');
      return;
    }

    const { data, error } = await sb.rpc('claim_company_stock_payout', { p_company_id: currentCompany.id });
    if (error) {
      if (showNoPayoutToast) toast(error.message);
      return;
    }
    lastAutoClaimKey = claimKey;
    const amt = Number(data?.payout_amount || 0);
    if (data?.cash_remaining !== undefined) currentUser.cash = Number(data.cash_remaining);
    if (amt > 0) {
      if (typeof updateUIProfile === 'function') updateUIProfile();
      if (typeof playSound === 'function') playSound('buy');
      toast(`00:00 Stock Payout: +${fmtMoney(amt)} credited from stock worth!`);
    } else if (showNoPayoutToast) {
      toast('00:00 check complete ($0.00 payout).');
    }
  }

  async function renderDashboardStocksTab() {
    const panel = $('#companyPanelStocks');
    if (!panel || !currentCompany || !sb) return;
    panel.innerHTML = '<p class="muted tiny">Loading live company stock metrics…</p>';

    const [{ data: stockRow }, { data: holds }, { data: payouts }] = await Promise.all([
      sb.from('company_stocks').select('*').eq('company_id', currentCompany.id).maybeSingle(),
      sb.from('company_stock_holdings').select('user_id,shares').eq('company_id', currentCompany.id).gt('shares', 0),
      sb.from('company_stock_payouts').select('*').eq('company_id', currentCompany.id).order('payout_date', { ascending: false }).limit(14)
    ]);

    const uids = (holds || []).map(h => h.user_id).filter(Boolean);
    if (typeof ensureProfilesCached === 'function' && uids.length) await ensureProfilesCached(uids);

    const c = normalizeCompanyStockRow(currentCompany, stockRow);
    const chg = typeof formatChangePct === 'function' ? formatChangePct(c.change_pct) : { cls: 'up', text: '0.00%' };
    const today = utcDateKey();
    const dueNow = stockRow && stockRow.last_payout_date < today;

    const holdersRows = (holds || []).map(h => {
      const val = calcStockHoldingValue(c.curve_price, c.total_revenue, h.shares);
      const prof = typeof getCachedProfile === 'function' ? getCachedProfile(h.user_id, null) : null;
      return { name: prof?.username || 'Investor', shares: Number(h.shares), val };
    }).sort((a, b) => b.val - a.val);

    panel.innerHTML = `
      <div class="company-stat-grid">
        <article class="company-stat-card"><span>Share Price</span><strong>${fmtPrice(c.share_price)}</strong><small class="coin-change ${chg.cls}" style="display:inline-block;margin-top:4px;">${chg.text}</small></article>
        <article class="company-stat-card"><span>Investor Pool</span><strong>${fmtMoney(c.owned_stock_usd)}</strong><small>Total capital currently invested</small></article>
        <article class="company-stat-card"><span>Daily 00:00 Free Payout</span><strong>${fmtPrice(c.share_price)}</strong><small>Stock worth · Next in <b data-stock-countdown>${formatCountdown(msUntilNextUtcMidnight())}</b></small></article>
        <article class="company-stat-card"><span>Total Stock Payouts</span><strong>${fmtMoney(c.total_stock_payouts)}</strong><small>Last payout: ${fmtMoney(c.last_payout_amount)}</small></article>
      </div>

      <div class="company-dashboard-section">
        <div class="company-section-heading">
          <div>
            <div class="eyebrow purple-text">PUBLIC STOCK MARKET</div>
            <h4>How your company stock works</h4>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${dueNow ? '<button type="button" class="primary-btn" id="eaClaimStockPayoutBtn">Claim 00:00 Payout</button>' : ''}
            <button type="button" class="zoom-btn" id="eaOpenMyStockPage">Open in Companies Market →</button>
          </div>
        </div>
        <p class="muted tiny" style="margin-bottom:12px;">
          Product sales raise your stock's <b>Sales Multiplier (${c.sales_multiplier.toFixed(2)}×)</b> automatically, while investor buys/sells gently adjust share value.
          Every day at <b>00:00 UTC</b>, you earn your stock's current worth (currently <b>${fmtPrice(c.share_price)}</b>) for free without reducing investor shares!
        </p>

        <div class="detail-panels" style="margin-top:12px;">
          <div class="detail-panel">
            <h4>Current Stockholders (${holdersRows.length})</h4>
            ${holdersRows.length
              ? holdersRows.map((h, idx) => `<div class="lb-row"><span><b>#${idx + 1}</b> ${esc(h.name)} (${h.shares.toFixed(2)} sh)</span><strong>${fmtMoney(h.val)}</strong></div>`).join('')
              : '<p class="muted tiny">No investors own shares yet. Grow your sales to stand out on the Companies Feed!</p>'}
          </div>
          <div class="detail-panel">
            <h4>00:00 Payout History</h4>
            ${(payouts || []).length
              ? payouts.map(p => `<div class="lb-row"><span>${esc(p.payout_date)} (Pool: ${fmtMoney(p.owned_stock_usd)})</span><strong style="color:var(--green);">+${fmtMoney(p.payout_amount)}</strong></div>`).join('')
              : '<p class="muted tiny">Daily 00:00 UTC payouts will appear here once claimed.</p>'}
          </div>
        </div>
      </div>
    `;

    startCountdownLoop();
    $('#eaOpenMyStockPage')?.addEventListener('click', () => openCompanyStock(currentCompany.id));
    $('#eaClaimStockPayoutBtn')?.addEventListener('click', async () => {
      await checkAndClaimDailyPayouts(true);
      await renderDashboardStocksTab();
    });
  }

  async function getMyStockHoldingsSummary() {
    if (!currentUser || !sb) return { totalValue: 0, totalSpent: 0, totalReturned: 0, items: [] };
    const { data: holds } = await sb
      .from('company_stock_holdings')
      .select('company_id,shares,total_spent_usd,total_returned_usd,product_companies(id,company_name,logo_data_url,product_lines,total_revenue),company_stocks(curve_price)')
      .eq('user_id', currentUser.id)
      .gt('shares', 0);

    let rows = holds || [];
    if (!rows.length) {
      // Fallback separate query if PostgREST FK embed differs
      const { data: rawHolds } = await sb.from('company_stock_holdings').select('*').eq('user_id', currentUser.id).gt('shares', 0);
      if (!rawHolds?.length) return { totalValue: 0, totalSpent: 0, totalReturned: 0, items: [] };
      const ids = rawHolds.map(h => h.company_id);
      const [{ data: cs }, { data: sts }] = await Promise.all([
        sb.from('product_companies').select('id,company_name,logo_data_url,product_lines,total_revenue').in('id', ids),
        sb.from('company_stocks').select('company_id,curve_price').in('company_id', ids)
      ]);
      const cMap = new Map((cs || []).map(x => [x.id, x]));
      const sMap = new Map((sts || []).map(x => [x.company_id, x]));
      rows = rawHolds.map(h => ({
        ...h,
        product_companies: cMap.get(h.company_id),
        company_stocks: sMap.get(h.company_id)
      }));
    }

    let totalValue = 0;
    let totalSpent = 0;
    let totalReturned = 0;
    const items = rows.map(h => {
      const comp = h.product_companies || {};
      const st = Array.isArray(h.company_stocks) ? h.company_stocks[0] : h.company_stocks;
      const curve = Number(st?.curve_price || 1);
      const rev = Number(comp.total_revenue || 0);
      const val = calcStockHoldingValue(curve, rev, h.shares);
      const spent = Number(h.total_spent_usd || 0);
      const ret = Number(h.total_returned_usd || 0);
      totalValue += val;
      totalSpent += spent;
      totalReturned += ret;
      return {
        companyId: h.company_id,
        companyName: comp.company_name || 'Company',
        logoUrl: comp.logo_data_url || '',
        line: lineLabel(comp),
        shares: Number(h.shares || 0),
        val,
        spent,
        ret,
        sharePrice: calcSharePrice(curve, rev)
      };
    });

    return { totalValue, totalSpent, totalReturned, items };
  }

  function wireFeedControls() {
    document.querySelectorAll('[data-company-sort]').forEach(btn => {
      btn.addEventListener('click', () => {
        companyStockSort = btn.dataset.companySort || 'top_price';
        document.querySelectorAll('[data-company-sort]').forEach(x => x.classList.toggle('active', x === btn));
        renderCompanyFeed();
      });
    });
    $('#companyFeedSearch')?.addEventListener('input', e => {
      companyFeedSearchQuery = (e.target.value || '').trim().toLowerCase();
      renderCompanyFeed();
    });
    $('#backToCompaniesFeed')?.addEventListener('click', () => {
      if (typeof showPage === 'function') showPage('feed');
      const compBtn = document.querySelector('.feed-type-btn[data-feed-type="company"]');
      compBtn?.click();
    });
  }

  document.addEventListener('DOMContentLoaded', wireFeedControls);

  window.CompanyStocks = {
    loadCompanyStocks,
    renderCompanyFeed,
    openCompanyStock,
    renderCompanyStockDetail,
    renderDashboardStocksTab,
    checkAndClaimDailyPayouts,
    getMyStockHoldingsSummary,
    calcSharePrice,
    calcTotalOwnedUsd,
    calcStockHoldingValue
  };
})();
