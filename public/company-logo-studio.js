/* ============================================================
 * GRIND-EA · Company Logo Shape Studio
 * Easy multi-layer vector shape compositor with Cutout (subtract) mode
 * Exports crisp 512x512 transparent PNG printed directly onto 3D CPUs
 * ============================================================ */
(function () {
  'use strict';

  const ART_SIZE = 512;
  const STORAGE_PREFIX = 'grind_company_logo_layers_';

  const SHAPE_LIBRARY = [
    { id: 'circle', label: 'Circle', icon: '●' },
    { id: 'ring', label: 'Ring', icon: '◯' },
    { id: 'half_circle', label: 'Half', icon: '◐' },
    { id: 'crescent', label: 'Crescent', icon: '☾' },
    { id: 'square', label: 'Square', icon: '■' },
    { id: 'rounded_box', label: 'Rounded', icon: '▢' },
    { id: 'pill', label: 'Pill', icon: '▬' },
    { id: 'triangle', label: 'Triangle', icon: '▲' },
    { id: 'right_tri', label: 'Corner', icon: '◢' },
    { id: 'diamond', label: 'Diamond', icon: '◆' },
    { id: 'pentagon', label: 'Pentagon', icon: '⬟' },
    { id: 'hexagon', label: 'Hexagon', icon: '⬢' },
    { id: 'hex_ring', label: 'Hex Frame', icon: '⬡' },
    { id: 'octagon', label: 'Octagon', icon: '⯄' },
    { id: 'star5', label: 'Star', icon: '★' },
    { id: 'spark4', label: 'Spark', icon: '✦' },
    { id: 'burst8', label: 'Burst', icon: '✸' },
    { id: 'leaf', label: 'Leaf', icon: '❦' },
    { id: 'drop', label: 'Teardrop', icon: '💧' },
    { id: 'shield', label: 'Shield', icon: '🛡' },
    { id: 'crown', label: 'Crown', icon: '♔' },
    { id: 'bolt', label: 'Bolt', icon: '⚡' },
    { id: 'chevron', label: 'Chevron', icon: '⌃' },
    { id: 'cross', label: 'Plus', icon: '✚' },
    { id: 'wave', label: 'Swoosh', icon: '〰' },
    { id: 'chip', label: 'Chip Frame', icon: '⊞' },
    { id: 'text', label: 'Letter / Text', icon: 'Aa' }
  ];

  const SWATCHES = [
    '#f8fafc', '#cbd5e1', '#94a3b8', '#1e293b', '#090d16',
    '#facc15', '#fb923c', '#f43f5e', '#a855f7', '#6366f1',
    '#38bdf8', '#22d3ee', '#34d399'
  ];

  const PRESETS = {
    bitten: [
      { type: 'circle', x: 256, y: 276, scaleX: 1.05, scaleY: 1.12, size: 225, rot: 0, color: '#f8fafc', mode: 'solid', opacity: 1 },
      { type: 'circle', x: 368, y: 254, scaleX: 1, scaleY: 1, size: 120, rot: 0, color: '#ffffff', mode: 'cutout', opacity: 1 },
      { type: 'leaf', x: 282, y: 126, scaleX: 1, scaleY: 1, size: 84, rot: 28, color: '#f8fafc', mode: 'solid', opacity: 1 }
    ],
    silicon_crest: [
      { type: 'hexagon', x: 256, y: 256, scaleX: 1, scaleY: 1, size: 320, rot: 0, color: '#38bdf8', mode: 'solid', opacity: 1 },
      { type: 'hexagon', x: 256, y: 256, scaleX: 1, scaleY: 1, size: 235, rot: 0, color: '#ffffff', mode: 'cutout', opacity: 1 },
      { type: 'diamond', x: 256, y: 256, scaleX: 1, scaleY: 1, size: 140, rot: 0, color: '#f8fafc', mode: 'solid', opacity: 1 },
      { type: 'spark4', x: 256, y: 256, scaleX: 1, scaleY: 1, size: 78, rot: 0, color: '#ffffff', mode: 'cutout', opacity: 1 }
    ],
    apex_mono: [
      { type: 'shield', x: 256, y: 258, scaleX: 1, scaleY: 1, size: 310, rot: 0, color: '#e2e8f0', mode: 'solid', opacity: 1 },
      { type: 'shield', x: 256, y: 258, scaleX: 1, scaleY: 1, size: 255, rot: 0, color: '#ffffff', mode: 'cutout', opacity: 1 },
      { type: 'text', text: 'G', x: 256, y: 266, scaleX: 1, scaleY: 1, size: 185, rot: 0, color: '#facc15', mode: 'solid', opacity: 1 }
    ],
    orbital: [
      { type: 'ring', x: 256, y: 256, scaleX: 1.38, scaleY: 0.54, size: 255, rot: -26, color: '#a855f7', mode: 'solid', opacity: 1 },
      { type: 'circle', x: 256, y: 256, scaleX: 1, scaleY: 1, size: 145, rot: 0, color: '#f8fafc', mode: 'solid', opacity: 1 },
      { type: 'circle', x: 356, y: 176, scaleX: 1, scaleY: 1, size: 44, rot: 0, color: '#38bdf8', mode: 'solid', opacity: 1 }
    ]
  };

  let layers = [];
  let selectedIdx = -1;
  let historyStack = [];
  let previewCpuTone = 'gray'; // 'gray' | 'silicon' | 'carbon'
  let activeCompanyId = null;
  let mounted = false;

  // Pointer interaction state on interactive artboard
  let dragMode = null; // 'move' | 'scale' | 'rotate'
  let dragStart = { x: 0, y: 0, layerX: 256, layerY: 256, size: 140, rot: 0, angle0: 0, dist0: 1 };
  let showSnapX = false;
  let showSnapY = false;

  const offscreen = document.createElement('canvas');
  offscreen.width = ART_SIZE;
  offscreen.height = ART_SIZE;
  const offCtx = offscreen.getContext('2d');

  function cloneLayers(arr) {
    return arr.map((l) => ({ ...l }));
  }

  function pushHistory() {
    historyStack.push(cloneLayers(layers));
    if (historyStack.length > 25) historyStack.shift();
  }

  function defaultLayer(type) {
    const base = {
      type,
      x: 256,
      y: 256,
      size: 160,
      scaleX: 1,
      scaleY: 1,
      rot: 0,
      color: '#f8fafc',
      mode: 'solid', // 'solid' | 'cutout'
      opacity: 1,
      text: type === 'text' ? 'G' : ''
    };
    if (type === 'pill' || type === 'wave') base.scaleX = 1.45;
    if (type === 'leaf') base.rot = 25;
    return base;
  }

  function drawRegularPolygon(ctx, sides, r, cornerR = 0) {
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2 - Math.PI / 2;
      const px = Math.cos(a) * r;
      const py = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    if (cornerR > 0) ctx.lineJoin = 'round';
  }

  function drawStar(ctx, points, outerR, innerR) {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 === 0 ? outerR : innerR;
      const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
      const px = Math.cos(a) * r;
      const py = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  function drawShapePath(ctx, layer) {
    const r = (layer.size || 160) * 0.5;
    const t = layer.type;

    if (t === 'circle') {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.closePath();
      ctx.fill();
      return;
    }

    if (t === 'ring') {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2, false);
      ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2, true);
      ctx.fill('evenodd');
      return;
    }

    if (t === 'half_circle') {
      ctx.beginPath();
      ctx.arc(0, 0, r, Math.PI, 0, false);
      ctx.closePath();
      ctx.fill();
      return;
    }

    if (t === 'crescent') {
      ctx.beginPath();
      ctx.arc(0, 0, r, -Math.PI * 0.72, Math.PI * 0.72, false);
      ctx.arc(r * 0.42, 0, r * 0.78, Math.PI * 0.65, -Math.PI * 0.65, true);
      ctx.closePath();
      ctx.fill();
      return;
    }

    if (t === 'square') {
      ctx.fillRect(-r, -r, r * 2, r * 2);
      return;
    }

    if (t === 'rounded_box') {
      const cr = r * 0.36;
      ctx.beginPath();
      ctx.roundRect(-r, -r, r * 2, r * 2, cr);
      ctx.fill();
      return;
    }

    if (t === 'pill') {
      const w = r * 2;
      const h = r * 0.92;
      ctx.beginPath();
      ctx.roundRect(-w / 2, -h / 2, w, h, h / 2);
      ctx.fill();
      return;
    }

    if (t === 'triangle') {
      drawRegularPolygon(ctx, 3, r, 4);
      ctx.fill();
      return;
    }

    if (t === 'right_tri') {
      ctx.beginPath();
      ctx.moveTo(-r, r);
      ctx.lineTo(r, r);
      ctx.lineTo(r, -r);
      ctx.closePath();
      ctx.fill();
      return;
    }

    if (t === 'diamond') {
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.12);
      ctx.lineTo(r * 0.86, 0);
      ctx.lineTo(0, r * 1.12);
      ctx.lineTo(-r * 0.86, 0);
      ctx.closePath();
      ctx.fill();
      return;
    }

    if (t === 'pentagon') {
      drawRegularPolygon(ctx, 5, r);
      ctx.fill();
      return;
    }

    if (t === 'hexagon') {
      drawRegularPolygon(ctx, 6, r);
      ctx.fill();
      return;
    }

    if (t === 'hex_ring') {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      const ir = r * 0.64;
      for (let i = 5; i >= 0; i--) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
        const px = Math.cos(a) * ir;
        const py = Math.sin(a) * ir;
        if (i === 5) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill('evenodd');
      return;
    }

    if (t === 'octagon') {
      drawRegularPolygon(ctx, 8, r);
      ctx.fill();
      return;
    }

    if (t === 'star5') {
      drawStar(ctx, 5, r, r * 0.44);
      ctx.fill();
      return;
    }

    if (t === 'spark4') {
      drawStar(ctx, 4, r * 1.05, r * 0.28);
      ctx.fill();
      return;
    }

    if (t === 'burst8') {
      drawStar(ctx, 8, r, r * 0.56);
      ctx.fill();
      return;
    }

    if (t === 'leaf') {
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.bezierCurveTo(r * 0.92, -r * 0.65, r * 0.92, r * 0.55, 0, r);
      ctx.bezierCurveTo(-r * 0.92, r * 0.55, -r * 0.92, -r * 0.65, 0, -r);
      ctx.closePath();
      ctx.fill();
      return;
    }

    if (t === 'drop') {
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.08);
      ctx.bezierCurveTo(r * 0.65, -r * 0.15, r * 0.95, r * 0.35, 0, r);
      ctx.bezierCurveTo(-r * 0.95, r * 0.35, -r * 0.65, -r * 0.15, 0, -r * 1.08);
      ctx.closePath();
      ctx.fill();
      return;
    }

    if (t === 'shield') {
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(r * 0.86, -r * 0.72);
      ctx.bezierCurveTo(r * 0.86, r * 0.25, r * 0.45, r * 0.75, 0, r);
      ctx.bezierCurveTo(-r * 0.45, r * 0.75, -r * 0.86, r * 0.25, -r * 0.86, -r * 0.72);
      ctx.closePath();
      ctx.fill();
      return;
    }

    if (t === 'crown') {
      ctx.beginPath();
      ctx.moveTo(-r * 0.92, r * 0.58);
      ctx.lineTo(-r * 0.92, -r * 0.45);
      ctx.lineTo(-r * 0.40, r * 0.08);
      ctx.lineTo(0, -r * 0.68);
      ctx.lineTo(r * 0.40, r * 0.08);
      ctx.lineTo(r * 0.92, -r * 0.45);
      ctx.lineTo(r * 0.92, r * 0.58);
      ctx.closePath();
      ctx.fill();
      return;
    }

    if (t === 'bolt') {
      ctx.beginPath();
      ctx.moveTo(r * 0.18, -r);
      ctx.lineTo(-r * 0.58, r * 0.08);
      ctx.lineTo(-r * 0.04, r * 0.08);
      ctx.lineTo(-r * 0.22, r);
      ctx.lineTo(r * 0.58, -r * 0.08);
      ctx.lineTo(r * 0.04, -r * 0.08);
      ctx.closePath();
      ctx.fill();
      return;
    }

    if (t === 'chevron') {
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.85);
      ctx.lineTo(r * 0.95, r * 0.35);
      ctx.lineTo(r * 0.62, r * 0.68);
      ctx.lineTo(0, -r * 0.15);
      ctx.lineTo(-r * 0.62, r * 0.68);
      ctx.lineTo(-r * 0.95, r * 0.35);
      ctx.closePath();
      ctx.fill();
      return;
    }

    if (t === 'cross') {
      const arm = r * 0.38;
      ctx.beginPath();
      ctx.rect(-arm, -r, arm * 2, r * 2);
      ctx.rect(-r, -arm, r * 2, arm * 2);
      ctx.fill();
      return;
    }

    if (t === 'wave') {
      ctx.beginPath();
      ctx.moveTo(-r, r * 0.25);
      ctx.bezierCurveTo(-r * 0.35, -r * 0.95, r * 0.35, r * 0.72, r, -r * 0.32);
      ctx.bezierCurveTo(r * 0.42, r * 0.95, -r * 0.35, -r * 0.22, -r, r * 0.52);
      ctx.closePath();
      ctx.fill();
      return;
    }

    if (t === 'chip') {
      const bw = r * 0.72;
      ctx.beginPath();
      ctx.roundRect(-bw, -bw, bw * 2, bw * 2, r * 0.14);
      ctx.fill();
      const pinW = r * 0.16;
      const pinL = r * 0.26;
      [-0.45, 0, 0.45].forEach((f) => {
        const p = f * r;
        ctx.fillRect(p - pinW / 2, -bw - pinL, pinW, pinL + 2);
        ctx.fillRect(p - pinW / 2, bw - 2, pinW, pinL + 2);
        ctx.fillRect(-bw - pinL, p - pinW / 2, pinL + 2, pinW);
        ctx.fillRect(bw - 2, p - pinW / 2, pinL + 2, pinW);
      });
      return;
    }

    if (t === 'text') {
      const label = (String(layer.text || 'G').trim() || 'G').slice(0, 12);
      const fs = Math.max(24, r * 1.45);
      ctx.font = `900 ${fs}px "Plus Jakarta Sans", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, 0, 0);
    }
  }

  function renderCompositeTo(ctx, targetSize) {
    ctx.clearRect(0, 0, targetSize, targetSize);
    const ratio = targetSize / ART_SIZE;
    for (let i = 0; i < layers.length; i++) {
      const l = layers[i];
      ctx.save();
      ctx.translate(l.x * ratio, l.y * ratio);
      ctx.rotate(((l.rot || 0) * Math.PI) / 180);
      ctx.scale((l.scaleX || 1) * ratio, (l.scaleY || 1) * ratio);
      if (l.mode === 'cutout') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#000000';
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = Math.max(0.1, Math.min(1, Number(l.opacity ?? 1)));
        ctx.fillStyle = l.color || '#f8fafc';
      }
      drawShapePath(ctx, l);
      ctx.restore();
    }
  }

  function exportLogoDataUrl() {
    renderCompositeTo(offCtx, ART_SIZE);
    return offscreen.toDataURL('image/png');
  }

  function saveLayersLocally(companyId) {
    if (!companyId) return;
    try {
      localStorage.setItem(STORAGE_PREFIX + companyId, JSON.stringify(layers));
    } catch {}
  }

  function loadLayersLocally(companyId) {
    if (!companyId) return null;
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + companyId);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) && parsed.length ? parsed : null;
    } catch {
      return null;
    }
  }

  function renderEditorCanvas() {
    const canvas = document.getElementById('logoStudioCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const S = canvas.width;

    // 1. Subtle transparency checkerboard studio field
    ctx.clearRect(0, 0, S, S);
    const tile = 24;
    for (let y = 0; y < S; y += tile) {
      for (let x = 0; x < S; x += tile) {
        ctx.fillStyle = ((x / tile + y / tile) % 2 === 0) ? '#151023' : '#1b142d';
        ctx.fillRect(x, y, tile, tile);
      }
    }

    // 2. Render composite shapes on offscreen canvas first so destination-out doesn't punch the checkerboard!
    renderCompositeTo(offCtx, ART_SIZE);
    ctx.drawImage(offscreen, 0, 0, S, S);

    // 3. Snap center alignment guides while dragging near center
    if (showSnapX || showSnapY) {
      ctx.save();
      ctx.strokeStyle = 'rgba(192, 132, 252, 0.72)';
      ctx.lineWidth = 1.25;
      ctx.setLineDash([5, 5]);
      if (showSnapX) {
        ctx.beginPath(); ctx.moveTo(S / 2, 0); ctx.lineTo(S / 2, S); ctx.stroke();
      }
      if (showSnapY) {
        ctx.beginPath(); ctx.moveTo(0, S / 2); ctx.lineTo(S, S / 2); ctx.stroke();
      }
      ctx.restore();
    }

    // 4. Active layer selection bounding box + resize & rotate handles
    const sel = layers[selectedIdx];
    if (sel) {
      const ratio = S / ART_SIZE;
      const hw = (sel.size * 0.5 * (sel.scaleX || 1)) * ratio;
      const hh = (sel.size * 0.5 * (sel.scaleY || 1)) * ratio;
      ctx.save();
      ctx.translate(sel.x * ratio, sel.y * ratio);
      ctx.rotate(((sel.rot || 0) * Math.PI) / 180);

      ctx.strokeStyle = sel.mode === 'cutout' ? '#f43f5e' : '#c084fc';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(-hw - 6, -hh - 6, (hw + 6) * 2, (hh + 6) * 2);
      ctx.setLineDash([]);

      // Rotation stem + top handle
      ctx.beginPath();
      ctx.moveTo(0, -hh - 6);
      ctx.lineTo(0, -hh - 30);
      ctx.stroke();

      ctx.fillStyle = '#c084fc';
      ctx.beginPath();
      ctx.arc(0, -hh - 30, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#120d1f';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Bottom-right scale handle
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(hw + 1, hh + 1, 11, 11);
      ctx.strokeRect(hw + 1, hh + 1, 11, 11);
      ctx.restore();
    }

    renderCpuStampPreview();
  }

  function renderCpuStampPreview() {
    const c = document.getElementById('logoCpuStampPreview');
    if (!c) return;
    const ctx = c.getContext('2d');
    const S = c.width;
    ctx.clearRect(0, 0, S, S);

    // Draw realistic miniature CPU IHS surface matching selected preview tone
    const bgGrad = ctx.createLinearGradient(0, 0, S, S);
    if (previewCpuTone === 'silicon') {
      bgGrad.addColorStop(0, '#c2dff5');
      bgGrad.addColorStop(0.55, '#6c91af');
      bgGrad.addColorStop(1, '#315472');
    } else if (previewCpuTone === 'carbon') {
      bgGrad.addColorStop(0, '#2a2f3c');
      bgGrad.addColorStop(0.55, '#13161e');
      bgGrad.addColorStop(1, '#090b10');
    } else {
      bgGrad.addColorStop(0, '#c6cbd4');
      bgGrad.addColorStop(0.55, '#8c93a0');
      bgGrad.addColorStop(1, '#686e7a');
    }
    ctx.fillStyle = bgGrad;
    ctx.beginPath();
    ctx.roundRect(8, 8, S - 16, S - 16, 22);
    ctx.fill();

    // Inner chamfer ring
    ctx.strokeStyle = previewCpuTone === 'carbon' ? 'rgba(242,200,100,0.55)' : 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(18, 18, S - 36, S - 36, 14);
    ctx.stroke();

    // Draw the custom logo stamped Apple-style center & biggest on the CPU
    renderCompositeTo(offCtx, ART_SIZE);
    const logoSize = S * 0.56;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.38)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    ctx.drawImage(offscreen, (S - logoSize) / 2, S * 0.14, logoSize, logoSize);
    ctx.restore();

    // Crisp CPU etching underneath logo
    ctx.fillStyle = previewCpuTone === 'carbon' ? 'rgba(248,250,252,0.88)' : 'rgba(18,24,38,0.84)';
    ctx.font = '800 12px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText((currentCompanyMeta?.company_name || 'YOUR CPU NAME').slice(0, 18), S / 2, S * 0.80);
  }

  function syncInspectorControls() {
    const sel = layers[selectedIdx];
    const panel = document.getElementById('logoLayerInspector');
    const emptyMsg = document.getElementById('logoNoSelectionMsg');
    if (panel) panel.classList.toggle('hidden', !sel);
    if (emptyMsg) emptyMsg.classList.toggle('hidden', Boolean(sel));

    const layerList = document.getElementById('logoLayerStack');
    if (layerList) {
      if (!layers.length) {
        layerList.innerHTML = '<div class="muted tiny" style="padding:8px 0;">Add any shape below or pick a starter emblem.</div>';
      } else {
        layerList.innerHTML = [...layers].map((l, idx) => {
          const meta = SHAPE_LIBRARY.find((s) => s.id === l.type);
          const name = l.type === 'text' ? `Text "${(l.text || 'G').slice(0, 6)}"` : (meta?.label || l.type);
          return `<button type="button" class="logo-layer-row ${idx === selectedIdx ? 'active' : ''}" data-logo-select="${idx}">
            <span class="logo-layer-dot" style="background:${l.mode === 'cutout' ? 'transparent;border:2px dashed #f43f5e' : l.color}"></span>
            <span>${meta?.icon || '◆'} ${name}</span>
            <small>${l.mode === 'cutout' ? 'Cutout' : 'Solid'}</small>
          </button>`;
        }).reverse().join('');
        layerList.querySelectorAll('[data-logo-select]').forEach((b) => {
          b.addEventListener('click', () => {
            selectedIdx = Number(b.dataset.logoSelect);
            syncInspectorControls();
            renderEditorCanvas();
          });
        });
      }
    }

    if (!sel) return;

    const textRow = document.getElementById('logoTextRow');
    const textInput = document.getElementById('logoLayerText');
    if (textRow) textRow.classList.toggle('hidden', sel.type !== 'text');
    if (textInput && textInput.value !== (sel.text || '')) textInput.value = sel.text || 'G';

    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = String(val);
    };
    setVal('logoLayerSize', Math.round(sel.size));
    setVal('logoLayerScaleX', Math.round((sel.scaleX || 1) * 100));
    setVal('logoLayerScaleY', Math.round((sel.scaleY || 1) * 100));
    setVal('logoLayerRot', Math.round(sel.rot || 0));
    setVal('logoLayerOpacity', Math.round((sel.opacity ?? 1) * 100));
    setVal('logoLayerColor', sel.color || '#f8fafc');

    const sizeOut = document.getElementById('logoLayerSizeOut');
    if (sizeOut) sizeOut.textContent = `${Math.round(sel.size)}px`;
    const rotOut = document.getElementById('logoLayerRotOut');
    if (rotOut) rotOut.textContent = `${Math.round(sel.rot || 0)}°`;

    document.querySelectorAll('[data-logo-mode]').forEach((b) => {
      b.classList.toggle('active', b.dataset.logoMode === sel.mode);
    });
    document.querySelectorAll('[data-logo-swatch]').forEach((b) => {
      b.classList.toggle('active', b.dataset.logoSwatch.toLowerCase() === (sel.color || '').toLowerCase());
    });
  }

  function addShapeLayer(type) {
    pushHistory();
    const layer = defaultLayer(type);
    if (layers.length > 0) {
      const n = layers.length % 5;
      layer.x += (n - 2) * 10;
      layer.y += (n - 2) * 10;
    }
    layers.push(layer);
    selectedIdx = layers.length - 1;
    syncInspectorControls();
    renderEditorCanvas();
  }

  function applyPreset(key) {
    pushHistory();
    if (key === 'blank') {
      layers = [];
      selectedIdx = -1;
    } else if (PRESETS[key]) {
      layers = cloneLayers(PRESETS[key]);
      selectedIdx = 0;
    }
    syncInspectorControls();
    renderEditorCanvas();
  }

  function bindCanvasPointerEvents() {
    const canvas = document.getElementById('logoStudioCanvas');
    if (!canvas || canvas.dataset.studioBound) return;
    canvas.dataset.studioBound = '1';

    const toArtCoords = (clientX, clientY) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((clientX - rect.left) / rect.width) * ART_SIZE,
        y: ((clientY - rect.top) / rect.height) * ART_SIZE
      };
    };

    canvas.addEventListener('pointerdown', (e) => {
      const p = toArtCoords(e.clientX, e.clientY);
      const sel = layers[selectedIdx];

      // Check active layer transform handles first
      if (sel) {
        const rad = ((sel.rot || 0) * Math.PI) / 180;
        const cos = Math.cos(-rad);
        const sin = Math.sin(-rad);
        const dx = p.x - sel.x;
        const dy = p.y - sel.y;
        const lx = dx * cos - dy * sin;
        const ly = dx * sin + dy * cos;
        const hw = sel.size * 0.5 * (sel.scaleX || 1);
        const hh = sel.size * 0.5 * (sel.scaleY || 1);

        // Top rotation handle
        if (Math.hypot(lx, ly - (-hh - 46)) < 26) {
          pushHistory();
          dragMode = 'rotate';
          dragStart = {
            x: p.x,
            y: p.y,
            rot: sel.rot || 0,
            angle0: Math.atan2(p.y - sel.y, p.x - sel.x)
          };
          canvas.setPointerCapture(e.pointerId);
          return;
        }

        // Bottom-right scale handle
        if (Math.hypot(lx - (hw + 10), ly - (hh + 10)) < 26) {
          pushHistory();
          dragMode = 'scale';
          dragStart = {
            size: sel.size,
            dist0: Math.max(12, Math.hypot(p.x - sel.x, p.y - sel.y))
          };
          canvas.setPointerCapture(e.pointerId);
          return;
        }
      }

      // Hit test topmost layer under pointer
      let hit = -1;
      for (let i = layers.length - 1; i >= 0; i--) {
        const l = layers[i];
        const hw = Math.max(24, l.size * 0.55 * (l.scaleX || 1));
        const hh = Math.max(24, l.size * 0.55 * (l.scaleY || 1));
        if (Math.abs(p.x - l.x) <= hw && Math.abs(p.y - l.y) <= hh) {
          hit = i;
          break;
        }
      }

      if (hit >= 0) {
        selectedIdx = hit;
        pushHistory();
        dragMode = 'move';
        const l = layers[hit];
        dragStart = { x: p.x, y: p.y, layerX: l.x, layerY: l.y };
        canvas.setPointerCapture(e.pointerId);
        syncInspectorControls();
        renderEditorCanvas();
      } else {
        selectedIdx = -1;
        syncInspectorControls();
        renderEditorCanvas();
      }
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!dragMode || selectedIdx < 0 || !layers[selectedIdx]) return;
      const p = toArtCoords(e.clientX, e.clientY);
      const l = layers[selectedIdx];

      if (dragMode === 'move') {
        let nx = dragStart.layerX + (p.x - dragStart.x);
        let ny = dragStart.layerY + (p.y - dragStart.y);
        showSnapX = Math.abs(nx - 256) < 10;
        showSnapY = Math.abs(ny - 256) < 10;
        if (showSnapX) nx = 256;
        if (showSnapY) ny = 256;
        l.x = Math.max(24, Math.min(488, nx));
        l.y = Math.max(24, Math.min(488, ny));
      } else if (dragMode === 'rotate') {
        const a1 = Math.atan2(p.y - l.y, p.x - l.x);
        let deg = dragStart.rot + ((a1 - dragStart.angle0) * 180) / Math.PI;
        if (Math.abs(deg % 45) < 4) deg = Math.round(deg / 45) * 45;
        l.rot = Math.round(((deg % 360) + 360) % 360);
        syncInspectorControls();
      } else if (dragMode === 'scale') {
        const dist = Math.max(12, Math.hypot(p.x - l.x, p.y - l.y));
        const factor = dist / dragStart.dist0;
        l.size = Math.max(26, Math.min(460, Math.round(dragStart.size * factor)));
        syncInspectorControls();
      }
      renderEditorCanvas();
    });

    const endDrag = () => {
      dragMode = null;
      showSnapX = false;
      showSnapY = false;
      renderEditorCanvas();
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
  }

  function buildStudioUi() {
    if (mounted) return;
    const shapeGrid = document.getElementById('logoShapePalette');
    const swatchRow = document.getElementById('logoColorSwatches');
    if (!shapeGrid || !swatchRow) return;

    shapeGrid.innerHTML = SHAPE_LIBRARY.map(
      (s) => `<button type="button" class="logo-shape-btn" data-add-shape="${s.id}" title="Add ${s.label}">
        <span>${s.icon}</span>
        <small>${s.label}</small>
      </button>`
    ).join('');

    shapeGrid.querySelectorAll('[data-add-shape]').forEach((b) => {
      b.addEventListener('click', () => addShapeLayer(b.dataset.addShape));
    });

    swatchRow.innerHTML = SWATCHES.map(
      (c) => `<button type="button" class="logo-swatch-btn" data-logo-swatch="${c}" style="background:${c}" aria-label="Color ${c}"></button>`
    ).join('');

    swatchRow.querySelectorAll('[data-logo-swatch]').forEach((b) => {
      b.addEventListener('click', () => {
        const sel = layers[selectedIdx];
        if (!sel) return;
        pushHistory();
        sel.color = b.dataset.logoSwatch;
        sel.mode = 'solid';
        syncInspectorControls();
        renderEditorCanvas();
      });
    });

    document.querySelectorAll('[data-logo-preset]').forEach((b) => {
      b.addEventListener('click', () => applyPreset(b.dataset.logoPreset));
    });

    document.querySelectorAll('[data-logo-cpu-tone]').forEach((b) => {
      b.addEventListener('click', () => {
        previewCpuTone = b.dataset.logoCpuTone;
        document.querySelectorAll('[data-logo-cpu-tone]').forEach((x) => x.classList.toggle('active', x === b));
        renderCpuStampPreview();
      });
    });

    document.querySelectorAll('[data-logo-mode]').forEach((b) => {
      b.addEventListener('click', () => {
        const sel = layers[selectedIdx];
        if (!sel) return;
        pushHistory();
        sel.mode = b.dataset.logoMode;
        syncInspectorControls();
        renderEditorCanvas();
      });
    });

    const bindInput = (id, fn) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', () => {
        const sel = layers[selectedIdx];
        if (!sel) return;
        fn(sel, el.value);
        renderEditorCanvas();
      });
    };

    bindInput('logoLayerSize', (s, v) => {
      s.size = Number(v);
      const out = document.getElementById('logoLayerSizeOut');
      if (out) out.textContent = `${Math.round(s.size)}px`;
    });
    bindInput('logoLayerScaleX', (s, v) => { s.scaleX = Number(v) / 100; });
    bindInput('logoLayerScaleY', (s, v) => { s.scaleY = Number(v) / 100; });
    bindInput('logoLayerRot', (s, v) => {
      s.rot = Number(v);
      const out = document.getElementById('logoLayerRotOut');
      if (out) out.textContent = `${Math.round(s.rot)}°`;
    });
    bindInput('logoLayerOpacity', (s, v) => { s.opacity = Number(v) / 100; });
    bindInput('logoLayerColor', (s, v) => { s.color = v; s.mode = 'solid'; });
    bindInput('logoLayerText', (s, v) => { s.text = v.slice(0, 12); });

    document.getElementById('logoLayerCenterBtn')?.addEventListener('click', () => {
      const sel = layers[selectedIdx];
      if (!sel) return;
      pushHistory();
      sel.x = 256;
      sel.y = 256;
      renderEditorCanvas();
    });

    document.getElementById('logoLayerDupBtn')?.addEventListener('click', () => {
      const sel = layers[selectedIdx];
      if (!sel) return;
      pushHistory();
      const copy = { ...sel, x: Math.min(470, sel.x + 18), y: Math.min(470, sel.y + 18) };
      layers.push(copy);
      selectedIdx = layers.length - 1;
      syncInspectorControls();
      renderEditorCanvas();
    });

    document.getElementById('logoLayerUpBtn')?.addEventListener('click', () => {
      if (selectedIdx < 0 || selectedIdx >= layers.length - 1) return;
      pushHistory();
      const tmp = layers[selectedIdx + 1];
      layers[selectedIdx + 1] = layers[selectedIdx];
      layers[selectedIdx] = tmp;
      selectedIdx++;
      syncInspectorControls();
      renderEditorCanvas();
    });

    document.getElementById('logoLayerDownBtn')?.addEventListener('click', () => {
      if (selectedIdx <= 0) return;
      pushHistory();
      const tmp = layers[selectedIdx - 1];
      layers[selectedIdx - 1] = layers[selectedIdx];
      layers[selectedIdx] = tmp;
      selectedIdx--;
      syncInspectorControls();
      renderEditorCanvas();
    });

    document.getElementById('logoLayerDeleteBtn')?.addEventListener('click', () => {
      if (selectedIdx < 0) return;
      pushHistory();
      layers.splice(selectedIdx, 1);
      selectedIdx = Math.min(selectedIdx, layers.length - 1);
      syncInspectorControls();
      renderEditorCanvas();
    });

    document.getElementById('logoUndoBtn')?.addEventListener('click', () => {
      if (!historyStack.length) return;
      layers = historyStack.pop();
      selectedIdx = layers.length ? Math.min(selectedIdx, layers.length - 1) : -1;
      syncInspectorControls();
      renderEditorCanvas();
    });

    document.getElementById('logoSavePrintBtn')?.addEventListener('click', async () => {
      const btn = document.getElementById('logoSavePrintBtn');
      const msg = document.getElementById('logoStudioMessage');
      if (!layers.length) {
        if (msg) msg.textContent = 'Add at least one shape before saving your logo.';
        return;
      }
      const dataUrl = exportLogoDataUrl();
      if (activeCompanyId) saveLayersLocally(activeCompanyId);
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Printing onto CPUs...';
      }
      if (msg) msg.textContent = '';
      try {
        if (typeof window.saveCompanyDesignedLogo === 'function') {
          await window.saveCompanyDesignedLogo(dataUrl);
        }
        if (msg) msg.textContent = 'Logo saved and printed on the top of your CPUs!';
      } catch (err) {
        if (msg) msg.textContent = err?.message || 'Could not save logo.';
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Save & Print on CPUs';
        }
      }
    });

    bindCanvasPointerEvents();
    mounted = true;
  }

  function open(company) {
    buildStudioUi();
    const cid = company?.id || null;
    if (cid !== activeCompanyId) {
      activeCompanyId = cid;
      const saved = loadLayersLocally(cid);
      if (saved) {
        layers = cloneLayers(saved);
      } else {
        layers = cloneLayers(PRESETS.bitten);
      }
      selectedIdx = layers.length ? 0 : -1;
      historyStack = [];
    }
    syncInspectorControls();
    renderEditorCanvas();
  }

  window.CompanyLogoStudio = {
    open,
    exportLogoDataUrl
  };
})();
