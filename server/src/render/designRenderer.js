import { createCanvas, loadImage } from '@napi-rs/canvas';
import { resolveAssetSource } from '../services/storage.js';

// Fabric.js's own JSON serialization is the canvas format here — this
// renderer interprets that shape directly rather than inventing a parallel
// schema, so what you see in the browser editor (Fabric) and what the
// autofill API produces come from the same source of truth. Supported
// object types: textbox/text, rect, circle, image. Anything else is
// skipped with a warning rather than crashing the whole render.

async function drawText(ctx, obj, overrideText) {
  const text = overrideText !== undefined ? overrideText : (obj.text || '');
  const fontSize = obj.fontSize || 24;
  const fontWeight = obj.fontWeight === 'bold' || Number(obj.fontWeight) >= 600 ? 'bold' : 'normal';
  const fontStyle = obj.fontStyle === 'italic' ? 'italic' : 'normal';
  const fontFamily = obj.fontFamily || 'Inter';
  const lineHeight = obj.lineHeight || 1.16;
  const align = obj.textAlign || 'left';

  ctx.save();
  ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px "${fontFamily}"`;
  ctx.fillStyle = obj.fill || '#111111';
  ctx.textBaseline = 'top';
  ctx.globalAlpha = obj.opacity ?? 1;

  const boxWidth = (obj.width || 200) * (obj.scaleX || 1);
  const boxHeight = (obj.height || 100) * (obj.scaleY || 1);

  // Simple greedy word-wrap within the object's box, shrinking font size
  // if the text still overflows vertically (mirrors "auto shrink to fit").
  let size = fontSize;
  let lines;
  for (let attempt = 0; attempt < 6; attempt++) {
    ctx.font = `${fontStyle} ${fontWeight} ${size}px "${fontFamily}"`;
    lines = wrapText(ctx, text, boxWidth);
    const totalHeight = lines.length * size * lineHeight;
    if (totalHeight <= boxHeight || size <= 8) break;
    size = Math.max(8, size - 2);
  }

  let y = obj.top || 0;
  const x = obj.left || 0;
  for (const line of lines) {
    let lineX = x;
    if (align === 'center') lineX = x + (boxWidth - ctx.measureText(line).width) / 2;
    else if (align === 'right') lineX = x + boxWidth - ctx.measureText(line).width;
    ctx.fillText(line, lineX, y);
    y += size * lineHeight;
  }
  ctx.restore();
}

function wrapText(ctx, text, maxWidth) {
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    const words = paragraph.split(' ');
    let current = '';
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    lines.push(current);
  }
  return lines;
}

async function drawShape(ctx, obj) {
  ctx.save();
  ctx.globalAlpha = obj.opacity ?? 1;
  const x = obj.left || 0;
  const y = obj.top || 0;
  const w = (obj.width || 0) * (obj.scaleX || 1);
  const h = (obj.height || 0) * (obj.scaleY || 1);

  ctx.beginPath();
  if (obj.type === 'circle') {
    const r = (obj.radius || w / 2) * (obj.scaleX || 1);
    ctx.arc(x + r, y + r, r, 0, Math.PI * 2);
  } else if (obj.type === 'triangle') {
    ctx.moveTo(x + w / 2, y);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
  } else if (obj.type === 'line') {
    ctx.moveTo((obj.x1 || 0) * (obj.scaleX || 1) + x, (obj.y1 || 0) * (obj.scaleY || 1) + y);
    ctx.lineTo((obj.x2 || 0) * (obj.scaleX || 1) + x, (obj.y2 || 0) * (obj.scaleY || 1) + y);
  } else if (obj.type === 'polygon' || obj.type === 'polyline') {
    const pts = obj.points || [];
    pts.forEach((p, i) => {
      const px = x + p.x * (obj.scaleX || 1);
      const py = y + p.y * (obj.scaleY || 1);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    if (obj.type === 'polygon') ctx.closePath();
  } else if (obj.rx || obj.ry) {
    const r = Math.min(obj.rx || 0, w / 2, h / 2);
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  } else {
    ctx.rect(x, y, w, h);
  }

  if (obj.fill && obj.fill !== 'transparent') {
    ctx.fillStyle = obj.fill;
    ctx.fill();
  }
  if (obj.stroke && obj.strokeWidth) {
    ctx.strokeStyle = obj.stroke;
    ctx.lineWidth = obj.strokeWidth;
    ctx.stroke();
  }
  ctx.restore();
}

// Icons and imported SVG shapes serialize as Fabric Path objects — obj.path
// is an array of command arrays, e.g. ['M', x, y], ['C', x1,y1,x2,y2,x,y].
// Interpreted directly rather than via Path2D for broader canvas-backend
// compatibility.
async function drawPath(ctx, obj) {
  ctx.save();
  ctx.globalAlpha = obj.opacity ?? 1;
  const ox = obj.left || 0;
  const oy = obj.top || 0;
  const sx = obj.scaleX || 1;
  const sy = obj.scaleY || 1;
  // Path coordinates are relative to the path's own bounding box origin
  // (pathOffset) in Fabric's serialization.
  const offX = obj.pathOffset?.x || 0;
  const offY = obj.pathOffset?.y || 0;

  ctx.beginPath();
  for (const cmd of obj.path || []) {
    const [op, ...args] = cmd;
    const tx = (n) => ox + (n - offX) * sx;
    const ty = (n) => oy + (n - offY) * sy;
    if (op === 'M') ctx.moveTo(tx(args[0]), ty(args[1]));
    else if (op === 'L') ctx.lineTo(tx(args[0]), ty(args[1]));
    else if (op === 'C') ctx.bezierCurveTo(tx(args[0]), ty(args[1]), tx(args[2]), ty(args[3]), tx(args[4]), ty(args[5]));
    else if (op === 'Q') ctx.quadraticCurveTo(tx(args[0]), ty(args[1]), tx(args[2]), ty(args[3]));
    else if (op === 'Z' || op === 'z') ctx.closePath();
  }

  if (obj.fill && obj.fill !== 'transparent') { ctx.fillStyle = obj.fill; ctx.fill(); }
  if (obj.stroke && obj.strokeWidth) { ctx.strokeStyle = obj.stroke; ctx.lineWidth = obj.strokeWidth; ctx.stroke(); }
  ctx.restore();
}

// Groups (multi-select "Group" action, or the result of an SVG import) nest
// child objects with coordinates relative to the group's own center.
// renderObject is passed in to avoid a circular reference at module scope.
async function drawGroup(ctx, obj, values, fieldsByObjectId, renderObject) {
  ctx.save();
  ctx.translate(obj.left || 0, obj.top || 0);
  ctx.rotate(((obj.angle || 0) * Math.PI) / 180);
  ctx.scale(obj.scaleX || 1, obj.scaleY || 1);
  // Fabric centers a group's own origin at its bounding-box center, so
  // children (already relative to that center) render correctly with no
  // further offset once we've translated/rotated/scaled into the group's
  // local space.
  for (const child of obj.objects || []) {
    await renderObject(ctx, child, values, fieldsByObjectId);
  }
  ctx.restore();
}

async function drawImage(ctx, obj, overrideSrc) {
  const src = overrideSrc || obj.src;
  if (!src) return;
  const source = resolveAssetSource(src);
  const buffer = source.startsWith('http')
    ? Buffer.from(await (await fetch(source)).arrayBuffer())
    : (await import('fs')).readFileSync(source);
  const img = await loadImage(buffer);

  const x = obj.left || 0;
  const y = obj.top || 0;
  const w = (obj.width || img.width) * (obj.scaleX || 1);
  const h = (obj.height || img.height) * (obj.scaleY || 1);

  // 'cover' fit — matches how the editor's default image objects behave.
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;

  ctx.save();
  ctx.globalAlpha = obj.opacity ?? 1;
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
}

async function renderObject(ctx, obj, values, fieldsByObjectId) {
  if (obj.visible === false) return;
  try {
    const field = fieldsByObjectId.get(obj.id);
    const overrideValue = field ? values[field.label] : undefined;

    if (obj.type === 'textbox' || obj.type === 'text' || obj.type === 'i-text') {
      await drawText(ctx, obj, overrideValue);
    } else if (obj.type === 'rect' || obj.type === 'circle' || obj.type === 'triangle' || obj.type === 'line' || obj.type === 'polygon' || obj.type === 'polyline') {
      await drawShape(ctx, obj);
    } else if (obj.type === 'path') {
      await drawPath(ctx, obj);
    } else if (obj.type === 'group' || obj.type === 'activeSelection') {
      await drawGroup(ctx, obj, values, fieldsByObjectId, renderObject);
    } else if (obj.type === 'image') {
      await drawImage(ctx, obj, overrideValue);
    } else {
      console.warn(`[designRenderer] skipping unsupported object type: ${obj.type}`);
    }
  } catch (err) {
    console.error(`[designRenderer] failed to render object ${obj.id} (${obj.type}): ${err.message}`);
  }
}

// values: plain object keyed by field label (matching fillcraft_design_fields.label)
export async function renderDesign(design, values = {}) {
  const canvas = createCanvas(design.width, design.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, design.width, design.height);

  const objects = design.canvas_json?.objects || [];
  const fieldsByObjectId = new Map((design.fields || []).map((f) => [f.object_id, f]));

  for (const obj of objects) {
    await renderObject(ctx, obj, values, fieldsByObjectId);
  }

  return canvas.encode('png');
}

export function estimateTextCapacity({ width, height, font_family = 'Inter', font_size = 24, font_weight = 'normal', italic = false, line_height = 1.16 }) {
  const measureCanvas = createCanvas(10, 10);
  const ctx = measureCanvas.getContext('2d');
  ctx.font = `${italic ? 'italic ' : ''}${font_weight === 'bold' ? 'bold ' : ''}${font_size}px "${font_family}"`;

  const sample = 'the quick brown fox jumps over the lazy dog THE QUICK BROWN FOX JUMPS 0123456789';
  const avgCharWidth = ctx.measureText(sample).width / sample.length;

  const linesThatFit = Math.max(1, Math.floor(height / (font_size * line_height)));
  const charsPerLine = Math.max(1, Math.floor(width / avgCharWidth));

  return {
    estimated_max_characters: linesThatFit * charsPerLine,
    lines_that_fit: linesThatFit,
    chars_per_line: charsPerLine,
    avg_char_width: avgCharWidth,
  };
}
