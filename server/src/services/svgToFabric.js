import { XMLParser } from 'fast-xml-parser';
import { randomUUID } from 'crypto';

// Converts a Canva SVG export directly into Fabric.js object JSON — the
// output of this file can be dropped straight into a design's canvas_json
// (design.canvas_json.objects.push(...result)), no intermediate schema.
// Same reasoning as before: SVG is Canva's own documented export format,
// not the robots.txt-blocked share-link scraping technique other tools use.

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: false,
  isArray: (name) => ['g', 'text', 'tspan', 'rect', 'image', 'ellipse', 'circle', 'polygon', 'path'].includes(name),
});

function num(v, fallback = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseTransform(str) {
  let m = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  if (!str) return m;
  const fnRe = /(\w+)\(([^)]*)\)/g;
  let match;
  while ((match = fnRe.exec(str))) {
    const [, fn, argsStr] = match;
    const args = argsStr.trim().split(/[\s,]+/).map(Number);
    let t = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    if (fn === 'translate') t = { a: 1, b: 0, c: 0, d: 1, e: args[0] || 0, f: args[1] || 0 };
    else if (fn === 'scale') { const sx = args[0] ?? 1; const sy = args[1] ?? sx; t = { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 }; }
    else if (fn === 'matrix' && args.length === 6) t = { a: args[0], b: args[1], c: args[2], d: args[3], e: args[4], f: args[5] };
    m = {
      a: m.a * t.a + m.c * t.b, b: m.b * t.a + m.d * t.b,
      c: m.a * t.c + m.c * t.d, d: m.b * t.c + m.d * t.d,
      e: m.a * t.e + m.c * t.f + m.e, f: m.b * t.e + m.d * t.f + m.f,
    };
  }
  return m;
}
function applyMatrix(m, x, y) { return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }; }
function composeMatrix(outer, inner) {
  return {
    a: outer.a * inner.a + outer.c * inner.b, b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d, d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e, f: outer.b * inner.e + outer.d * inner.f + outer.f,
  };
}
function styleFromAttrs(node) {
  const packed = {};
  if (node['@_style']) {
    for (const decl of node['@_style'].split(';')) {
      const [k, v] = decl.split(':').map((s) => s?.trim());
      if (k && v) packed[k] = v;
    }
  }
  return (attr) => packed[attr] ?? node[`@_${attr}`];
}
function collectText(node) {
  const parts = [];
  const tspans = Array.isArray(node.tspan) ? node.tspan : node.tspan ? [node.tspan] : [];
  if (tspans.length) for (const t of tspans) parts.push(typeof t === 'string' ? t : t['#text'] ?? '');
  else if (typeof node['#text'] === 'string') parts.push(node['#text']);
  else if (typeof node === 'string') parts.push(node);
  return parts.join('').trim();
}
function parseColor(v) { return (!v || v === 'none') ? null : v; }
function pxFromFontSize(v) { const n = parseFloat(v); return Number.isFinite(n) ? Math.round(n) : 24; }

// buffer: SVG file bytes. targetWidthPx/targetHeightPx: the design's actual
// canvas size, so imported elements land at the right scale even if the
// SVG's own viewBox differs slightly.
// Returns { naturalWidth, naturalHeight, objects, imageHrefs } where
// imageHrefs maps object.id -> raw href (data URI or URL) for the caller to
// resolve into stored assets before saving (Fabric objects need a real
// `src` URL, not embedded data, to keep canvas_json small).
export async function svgToFabricObjects(buffer, { targetWidthPx, targetHeightPx } = {}) {
  const xml = Buffer.isBuffer(buffer) ? buffer.toString('utf-8') : buffer;
  const doc = parser.parse(xml);
  const svgRoot = doc.svg;
  if (!svgRoot) throw new Error('Not a valid SVG (missing <svg> root)');

  const viewBox = (svgRoot['@_viewBox'] || '').trim().split(/\s+/).map(Number);
  const naturalWidth = viewBox.length === 4 ? viewBox[2] : num(svgRoot['@_width'], targetWidthPx || 1000);
  const naturalHeight = viewBox.length === 4 ? viewBox[3] : num(svgRoot['@_height'], targetHeightPx || 1000);
  const scaleX = targetWidthPx ? targetWidthPx / naturalWidth : 1;
  const scaleY = targetHeightPx ? targetHeightPx / naturalHeight : 1;
  const scale = (scaleX + scaleY) / 2;

  const objects = [];
  const imageHrefs = {};
  let zIndex = 0;

  function walk(node, parentMatrix) {
    if (!node || typeof node !== 'object') return;
    const matrix = composeMatrix(parentMatrix, parseTransform(node['@_transform']));

    for (const g of node.g || []) walk(g, matrix);

    for (const t of node.text || []) {
      try {
        const style = styleFromAttrs(t);
        const text = collectText(t);
        if (!text) continue;
        const p = applyMatrix(matrix, num(t['@_x']), num(t['@_y']));
        const fontSizePx = pxFromFontSize(style('font-size'));
        const fontWeight = (style('font-weight') === 'bold' || Number(style('font-weight')) >= 600) ? 'bold' : 'normal';
        objects.push({
          id: randomUUID(), type: 'textbox', text,
          left: Math.round(p.x * scale),
          top: Math.round((p.y - fontSizePx * 0.8) * scale),
          width: Math.round(Math.max(text.length * fontSizePx * 0.55, 40) * scale),
          fontFamily: (style('font-family') || 'Inter').split(',')[0].replace(/['"]/g, '').trim(),
          fontSize: Math.round(fontSizePx * scale),
          fontWeight,
          fontStyle: style('font-style') === 'italic' ? 'italic' : 'normal',
          fill: parseColor(style('fill')) || '#111111',
          zIndex: zIndex++,
        });
      } catch (err) { console.error('[svgToFabric] skipped a text element:', err.message); }
    }

    for (const img of node.image || []) {
      try {
        const href = img['@_href'] || img['@_xlink:href'];
        if (!href) continue;
        const p = applyMatrix(matrix, num(img['@_x']), num(img['@_y']));
        const id = randomUUID();
        imageHrefs[id] = href;
        objects.push({
          id, type: 'image', _pendingSrc: true,
          left: Math.round(p.x * scale), top: Math.round(p.y * scale),
          width: Math.round(num(img['@_width'])), height: Math.round(num(img['@_height'])),
          scaleX: scale, scaleY: scale,
          zIndex: zIndex++,
        });
      } catch (err) { console.error('[svgToFabric] skipped an image element:', err.message); }
    }

    for (const rect of node.rect || []) {
      try {
        const style = styleFromAttrs(rect);
        const w = num(rect['@_width']); const h = num(rect['@_height']);
        if (!w || !h) continue;
        const p = applyMatrix(matrix, num(rect['@_x']), num(rect['@_y']));
        objects.push({
          id: randomUUID(), type: 'rect',
          left: Math.round(p.x * scale), top: Math.round(p.y * scale),
          width: Math.round(w * scale), height: Math.round(h * scale),
          rx: Math.round(num(rect['@_rx']) * scale),
          fill: parseColor(style('fill')) || '#D9A441',
          stroke: parseColor(style('stroke')), strokeWidth: num(style('stroke-width'), 0),
          zIndex: zIndex++,
        });
      } catch (err) { console.error('[svgToFabric] skipped a rect:', err.message); }
    }

    for (const el of [...(node.ellipse || []), ...(node.circle || [])]) {
      try {
        const style = styleFromAttrs(el);
        const cx = num(el['@_cx']); const cy = num(el['@_cy']);
        const rx = num(el['@_rx'] ?? el['@_r']); const ry = num(el['@_ry'] ?? el['@_r']);
        if (!rx || !ry) continue;
        const p = applyMatrix(matrix, cx - rx, cy - ry);
        objects.push({
          id: randomUUID(), type: 'circle',
          left: Math.round(p.x * scale), top: Math.round(p.y * scale),
          radius: Math.round(rx * scale), scaleY: ry / rx,
          fill: parseColor(style('fill')) || '#D9A441',
          stroke: parseColor(style('stroke')), strokeWidth: num(style('stroke-width'), 0),
          zIndex: zIndex++,
        });
      } catch (err) { console.error('[svgToFabric] skipped an ellipse/circle:', err.message); }
    }
    // <path>/<polygon> (icons, complex shapes) intentionally not extracted
    // as individually editable objects in this first pass — same tradeoff
    // as before: text, images, and basic shapes are the highest-value
    // editable elements to recover automatically.
  }

  walk(svgRoot, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  return { naturalWidth, naturalHeight, objects, imageHrefs };
}

export async function resolveImageHref(href) {
  if (href.startsWith('data:')) {
    const match = href.match(/^data:([^;]+);base64,(.*)$/s);
    if (!match) throw new Error('Unsupported data URI encoding (expected base64)');
    const [, mime, b64] = match;
    return { buffer: Buffer.from(b64, 'base64'), mime };
  }
  const res = await fetch(href);
  if (!res.ok) throw new Error(`Failed to download SVG-embedded image (HTTP ${res.status})`);
  const mime = res.headers.get('content-type') || 'image/png';
  return { buffer: Buffer.from(await res.arrayBuffer()), mime };
}
