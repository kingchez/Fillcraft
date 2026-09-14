import { XMLParser } from 'fast-xml-parser';

// SVG is a real, documented vector format — every element carries its own
// exact position/size/style as plain attributes. This gives far better
// fidelity than the PPTX parser for anything beyond simple text/photo boxes,
// because it can recover real shapes (rects, ellipses) directly instead of
// only text runs and picture placeholders. Canva's SVG export isn't
// guaranteed available for every design type (see getExportFormats in
// canvaApi.js) — callers should fall back to parsePptx when it isn't.

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

// Parses the handful of SVG transform functions Canva is likely to emit
// (translate, scale, matrix) into a simple affine {a,b,c,d,e,f} matrix.
// Rotation/skew inside a matrix() is preserved numerically but position is
// what we actually use downstream — rotation isn't currently modeled on
// Fillcraft regions.
function parseTransform(str) {
  let m = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  if (!str) return m;
  const fnRe = /(\w+)\(([^)]*)\)/g;
  let match;
  while ((match = fnRe.exec(str))) {
    const [, fn, argsStr] = match;
    const args = argsStr.trim().split(/[\s,]+/).map(Number);
    let t = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    if (fn === 'translate') {
      t = { a: 1, b: 0, c: 0, d: 1, e: args[0] || 0, f: args[1] || 0 };
    } else if (fn === 'scale') {
      const sx = args[0] ?? 1;
      const sy = args[1] ?? sx;
      t = { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
    } else if (fn === 'matrix' && args.length === 6) {
      t = { a: args[0], b: args[1], c: args[2], d: args[3], e: args[4], f: args[5] };
    }
    // Compose: m = m * t
    m = {
      a: m.a * t.a + m.c * t.b,
      b: m.b * t.a + m.d * t.b,
      c: m.a * t.c + m.c * t.d,
      d: m.b * t.c + m.d * t.d,
      e: m.a * t.e + m.c * t.f + m.e,
      f: m.b * t.e + m.d * t.f + m.f,
    };
  }
  return m;
}

function applyMatrix(m, x, y) {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

function composeMatrix(outer, inner) {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f,
  };
}

function styleFromAttrs(node) {
  // Canva may emit style as presentation attributes (fill="#fff") or a
  // packed style="fill:#fff;font-family:..." string — check both.
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
  if (tspans.length) {
    for (const t of tspans) parts.push(typeof t === 'string' ? t : t['#text'] ?? '');
  } else if (typeof node['#text'] === 'string') {
    parts.push(node['#text']);
  } else if (typeof node === 'string') {
    parts.push(node);
  }
  return parts.join('').trim();
}

function parseColor(v) {
  if (!v || v === 'none') return null;
  return v;
}

function pxFromFontSize(v) {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return 24;
  // SVG font-size is unitless-or-px by default; Canva exports in user units
  // that already match the document's px space, so no conversion needed.
  return Math.round(n);
}

// Walks the SVG tree collecting text/image/shape elements with absolute
// pixel positions (after resolving all ancestor transforms), scaled to
// targetWidthPx/targetHeightPx so they line up with the PNG export of the
// same design.
export async function parseSvg(buffer, { targetWidthPx, targetHeightPx } = {}) {
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

  const elements = [];

  function walk(node, parentMatrix) {
    if (!node || typeof node !== 'object') return;
    const localMatrix = parseTransform(node['@_transform']);
    const matrix = composeMatrix(parentMatrix, localMatrix);

    for (const g of node.g || []) walk(g, matrix);

    for (const t of node.text || []) {
      try {
        const style = styleFromAttrs(t);
        const text = collectText(t);
        if (!text) continue;
        const rawX = num(t['@_x']);
        const rawY = num(t['@_y']);
        const p = applyMatrix(matrix, rawX, rawY);
        const fontSizePx = pxFromFontSize(style('font-size'));
        elements.push({
          type: 'text',
          text,
          // SVG text y is the baseline, not the top — shift up by ~0.8em so
          // the box's top-left roughly matches where the glyphs start,
          // consistent with how the editor positions text regions.
          x: Math.round((p.x) * scale),
          y: Math.round((p.y - fontSizePx * 0.8) * scale),
          width: Math.round(Math.max(text.length * fontSizePx * 0.55, 40) * scale),
          height: Math.round(fontSizePx * 1.3 * scale),
          font_family: (style('font-family') || 'Inter').split(',')[0].replace(/['"]/g, '').trim(),
          font_size: Math.round(fontSizePx * scale),
          font_weight: (style('font-weight') === 'bold' || Number(style('font-weight')) >= 600) ? 'bold' : 'normal',
          italic: style('font-style') === 'italic',
          color: parseColor(style('fill')) || '#111111',
        });
      } catch (err) {
        console.error('[svgParser] skipped a text element that failed to parse:', err.message);
      }
    }

    for (const img of node.image || []) {
      try {
        const href = img['@_href'] || img['@_xlink:href'];
        if (!href) continue;
        const x = num(img['@_x']);
        const y = num(img['@_y']);
        const w = num(img['@_width']);
        const h = num(img['@_height']);
        const topLeft = applyMatrix(matrix, x, y);
        elements.push({
          type: 'image',
          x: Math.round(topLeft.x * scale),
          y: Math.round(topLeft.y * scale),
          width: Math.round(w * scale),
          height: Math.round(h * scale),
          href, // data: URI or external URL — caller resolves to bytes
        });
      } catch (err) {
        console.error('[svgParser] skipped an image element that failed to parse:', err.message);
      }
    }

    for (const rect of node.rect || []) {
      try {
        const style = styleFromAttrs(rect);
        const x = num(rect['@_x']);
        const y = num(rect['@_y']);
        const w = num(rect['@_width']);
        const h = num(rect['@_height']);
        if (!w || !h) continue;
        const topLeft = applyMatrix(matrix, x, y);
        elements.push({
          type: 'shape',
          shape_type: 'rectangle',
          x: Math.round(topLeft.x * scale),
          y: Math.round(topLeft.y * scale),
          width: Math.round(w * scale),
          height: Math.round(h * scale),
          corner_radius: Math.round(num(rect['@_rx']) * scale),
          fill_color: parseColor(style('fill')) || '#D9A441',
          stroke_color: parseColor(style('stroke')),
          stroke_width: num(style('stroke-width'), 0),
        });
      } catch (err) {
        console.error('[svgParser] skipped a rect element that failed to parse:', err.message);
      }
    }

    for (const el of [...(node.ellipse || []), ...(node.circle || [])]) {
      try {
        const style = styleFromAttrs(el);
        const cx = num(el['@_cx']);
        const cy = num(el['@_cy']);
        const rx = num(el['@_rx'] ?? el['@_r']);
        const ry = num(el['@_ry'] ?? el['@_r']);
        if (!rx || !ry) continue;
        const topLeft = applyMatrix(matrix, cx - rx, cy - ry);
        elements.push({
          type: 'shape',
          shape_type: 'ellipse',
          x: Math.round(topLeft.x * scale),
          y: Math.round(topLeft.y * scale),
          width: Math.round(rx * 2 * scale),
          height: Math.round(ry * 2 * scale),
          fill_color: parseColor(style('fill')) || '#D9A441',
          stroke_color: parseColor(style('stroke')),
          stroke_width: num(style('stroke-width'), 0),
        });
      } catch (err) {
        console.error('[svgParser] skipped an ellipse/circle that failed to parse:', err.message);
      }
    }
    // <polygon>/<path> (icons, custom shapes) are common in Canva exports
    // but don't reduce to a simple box — intentionally not extracted as
    // individual regions here. They still render correctly as part of the
    // flattened PNG background; only the elements above become editable.
  }

  walk(svgRoot, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

  return {
    naturalWidth,
    naturalHeight,
    elements,
  };
}

// Resolves an SVG <image> href to raw bytes — either a base64 data URI
// (embedded images, the common case in Canva's export) or an external URL.
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
