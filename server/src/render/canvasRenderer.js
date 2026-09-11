import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { resolveAssetSource } from '../services/storage.js';

export async function getImageDimensions(buffer) {
  const img = await loadImage(buffer);
  return { width: img.width, height: img.height };
}

// Registers a locally-stored font file under a family name so it can be
// referenced by text regions immediately after upload.
export function registerFont(filePath, family) {
  GlobalFonts.registerFromPath(filePath, family);
}

function roundRectPath(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function wrapText(ctx, text, maxWidth) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

async function drawImageRegion(ctx, region, srcUrlOrDataUri) {
  const img = await loadImage(resolveAssetSource(srcUrlOrDataUri));
  const { x, y, width, height, fit_mode = 'cover', corner_radius = 0, opacity = 1, rotation = 0 } = region;

  ctx.save();
  ctx.globalAlpha = opacity ?? 1;

  if (rotation) {
    ctx.translate(x + width / 2, y + height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.translate(-(x + width / 2), -(y + height / 2));
  }

  if (corner_radius) {
    roundRectPath(ctx, x, y, width, height, corner_radius);
  } else {
    ctx.beginPath();
    ctx.rect(x, y, width, height);
  }
  ctx.clip();

  if (region.filter === 'grayscale') {
    ctx.filter = 'grayscale(100%)';
  } else if (region.filter === 'duotone') {
    // Approximation — a true two-color duotone needs per-pixel remapping;
    // this gets a comparable stylized look cheaply via CSS filter compositing.
    ctx.filter = 'grayscale(100%) sepia(60%)';
  } else {
    ctx.filter = 'none';
  }

  const iw = img.width, ih = img.height;
  let dw = width, dh = height, dx = x, dy = y;

  if (fit_mode === 'contain') {
    const s = Math.min(width / iw, height / ih);
    dw = iw * s; dh = ih * s;
    dx = x + (width - dw) / 2; dy = y + (height - dh) / 2;
  } else if (fit_mode === 'fill') {
    // stretch to exactly fill — dw/dh already equal width/height
  } else {
    // cover (default): fill the box, crop overflow, never distort
    const s = Math.max(width / iw, height / ih);
    dw = iw * s; dh = ih * s;
    dx = x - (dw - width) / 2; dy = y - (dh - height) / 2;
  }

  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.filter = 'none';

  if (region.border_width) {
    ctx.lineWidth = region.border_width;
    ctx.strokeStyle = region.border_color || '#000000';
    ctx.stroke();
  }

  ctx.restore();
}

function drawTextRegion(ctx, region, rawText) {
  const style = region.current_style || region.original_style || {};
  const {
    font_family = 'sans-serif',
    font_size = 24,
    color = '#000000',
    font_weight = 'normal',
    italic = false,
    align = 'left',
    line_height = 1.3,
    text_transform = 'none',
    underline = false,
    strikethrough = false,
    opacity = 1,
    rotation = 0,
  } = style;

  let text = String(rawText ?? '');
  if (region.max_characters && text.length > region.max_characters) {
    text = text.slice(0, region.max_characters);
  }
  if (text_transform === 'uppercase') text = text.toUpperCase();
  else if (text_transform === 'lowercase') text = text.toLowerCase();
  else if (text_transform === 'capitalize') text = text.replace(/\b\w/g, (c) => c.toUpperCase());

  const { x, y, width, height, auto_shrink_to_fit = true } = region;

  ctx.save();
  ctx.globalAlpha = opacity ?? 1;

  if (rotation) {
    ctx.translate(x + width / 2, y + height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.translate(-(x + width / 2), -(y + height / 2));
  }

  let fontSize = font_size;
  let lines;
  // Shrink-to-fit: reduce font size until the wrapped text fits the box height,
  // or we hit a sane floor.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    ctx.font = `${italic ? 'italic ' : ''}${font_weight === 'bold' ? 'bold ' : ''}${fontSize}px "${font_family}"`;
    lines = wrapText(ctx, text, width);
    const totalHeight = lines.length * fontSize * line_height;
    if (!auto_shrink_to_fit || totalHeight <= height || fontSize <= 8) break;
    fontSize -= 1;
  }

  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  ctx.textAlign = align === 'center' ? 'center' : align === 'right' ? 'right' : 'left';

  let alignX = x;
  if (align === 'center') alignX = x + width / 2;
  if (align === 'right') alignX = x + width;

  lines.forEach((line, i) => {
    const ly = y + i * fontSize * line_height;
    ctx.fillText(line, alignX, ly);

    if (underline || strikethrough) {
      const w = ctx.measureText(line).width;
      let lx = alignX;
      if (align === 'center') lx = alignX - w / 2;
      if (align === 'right') lx = alignX - w;
      const uy = underline ? ly + fontSize * 0.95 : ly + fontSize * 0.5;
      ctx.beginPath();
      ctx.moveTo(lx, uy);
      ctx.lineTo(lx + w, uy);
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, fontSize * 0.05);
      ctx.stroke();
    }
  });

  ctx.restore();
}

// Renders a template with the given field values (keyed by region label) and
// returns a PNG buffer. Entirely in-memory — no disk writes.
export async function renderTemplate(template, values = {}) {
  const canvas = createCanvas(template.width, template.height);
  const ctx = canvas.getContext('2d');

  const baseImg = await loadImage(resolveAssetSource(template.source_image_url));
  ctx.drawImage(baseImg, 0, 0, template.width, template.height);

  const regions = [...(template.template_regions || [])].sort(
    (a, b) => (a.z_index || 0) - (b.z_index || 0)
  );

  for (const region of regions) {
    if (region.type === 'image') {
      const value = values[region.label];
      if (value) {
        await drawImageRegion(ctx, region, value);
      }
    } else if (region.type === 'text') {
      const text = values[region.label];
      if (text !== undefined && text !== null) {
        drawTextRegion(ctx, region, text);
      }
    }
  }

  return canvas.encode('png');
}

// Composites a product photo onto a square, colored canvas — scaled
// proportionally (never distorted or cropped) and centered.
export async function normalizeProductImage(
  buffer,
  { canvasSize = 1200, backgroundColor = '#FFFFFF', maxContentRatio = 0.83 } = {}
) {
  const img = await loadImage(buffer);
  const canvas = createCanvas(canvasSize, canvasSize);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, canvasSize, canvasSize);

  const maxDim = canvasSize * maxContentRatio;
  const scale = Math.min(maxDim / img.width, maxDim / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  const dx = (canvasSize - dw) / 2;
  const dy = (canvasSize - dh) / 2;

  ctx.drawImage(img, dx, dy, dw, dh);

  return canvas.encode('png');
}
