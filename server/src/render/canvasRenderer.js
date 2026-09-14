import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { resolveAssetSource } from '../services/storage.js';
import { getIconPng } from '../services/icons.js';

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

// Samples the background color right at a text region's top-left corner
// and paints over the whole box with it before new text is drawn — this is
// what actually makes text "replaceable" rather than "overlaid": without
// this, whatever was originally baked into the background image at that
// spot (old text, texture, etc.) would still show through around/behind
// the new text. Works cleanly for solid or simple-gradient backgrounds;
// heavily textured/patterned backgrounds may show a faint flat patch where
// the box was — an honest limitation of re-flattened source images rather
// than a true live document.
function eraseRegionBackground(ctx, region) {
  const { x, y, width, height } = region;
  try {
    const sampleX = Math.min(Math.max(0, Math.round(x)), ctx.canvas.width - 1);
    const sampleY = Math.min(Math.max(0, Math.round(y)), ctx.canvas.height - 1);
    const pixel = ctx.getImageData(sampleX, sampleY, 1, 1).data;
    ctx.save();
    ctx.fillStyle = `rgba(${pixel[0]}, ${pixel[1]}, ${pixel[2]}, ${pixel[3] / 255})`;
    ctx.fillRect(x, y, width, height);
    ctx.restore();
  } catch (err) {
    console.error('[render] failed to sample/erase background for region, drawing text over it as-is:', err.message);
  }
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

function regularPolygonPoints(cx, cy, radius, sides) {
  const points = [];
  const step = (2 * Math.PI) / sides;
  const start = -Math.PI / 2; // point facing up
  for (let i = 0; i < sides; i++) {
    const angle = start + i * step;
    points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
  }
  return points;
}

function drawShapeRegion(ctx, region) {
  const {
    x, y, width, height,
    shape_type = 'rectangle',
    fill_color, stroke_color, stroke_width = 0,
    corner_radius = 0, opacity = 1, rotation = 0, sides = 6,
  } = region;

  ctx.save();
  ctx.globalAlpha = opacity ?? 1;

  if (rotation) {
    ctx.translate(x + width / 2, y + height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.translate(-(x + width / 2), -(y + height / 2));
  }

  ctx.beginPath();
  if (shape_type === 'circle') {
    ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
  } else if (shape_type === 'line') {
    ctx.moveTo(x, y + height / 2);
    ctx.lineTo(x + width, y + height / 2);
  } else if (shape_type === 'arrow') {
    const midY = y + height / 2;
    const headSize = Math.min(height, width * 0.25);
    ctx.moveTo(x, midY);
    ctx.lineTo(x + width - headSize, midY);
  } else if (shape_type === 'polygon') {
    const cx = x + width / 2, cy = y + height / 2;
    const radius = Math.min(width, height) / 2;
    const points = regularPolygonPoints(cx, cy, radius, Math.max(3, sides));
    points.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
    ctx.closePath();
  } else {
    roundRectPath(ctx, x, y, width, height, corner_radius);
  }

  if (fill_color && shape_type !== 'line' && shape_type !== 'arrow') {
    ctx.fillStyle = fill_color;
    ctx.fill();
  }
  if (stroke_width > 0 && stroke_color) {
    ctx.lineWidth = stroke_width;
    ctx.strokeStyle = stroke_color;
    ctx.stroke();
  } else if (shape_type === 'line') {
    // A line has no fill — draw it as a stroke even if stroke props weren't set.
    ctx.lineWidth = stroke_width || Math.max(2, height * 0.1);
    ctx.strokeStyle = stroke_color || fill_color || '#000000';
    ctx.stroke();
  }

  if (shape_type === 'arrow') {
    const midY = y + height / 2;
    const headSize = Math.min(height, width * 0.25);
    ctx.lineWidth = stroke_width || Math.max(2, height * 0.1);
    ctx.strokeStyle = stroke_color || fill_color || '#000000';
    ctx.stroke(); // shaft, drawn above as a moveTo/lineTo path
    ctx.beginPath();
    ctx.moveTo(x + width, midY);
    ctx.lineTo(x + width - headSize, midY - headSize / 2);
    ctx.lineTo(x + width - headSize, midY + headSize / 2);
    ctx.closePath();
    ctx.fillStyle = stroke_color || fill_color || '#000000';
    ctx.fill();
  }

  ctx.restore();
}

async function drawIconRegion(ctx, region) {
  const { x, y, width, height, icon_name, icon_color = '#000000', opacity = 1, rotation = 0 } = region;
  if (!icon_name) return;

  let img;
  try {
    const pngBuffer = await getIconPng(icon_name, { color: icon_color, sizePx: Math.max(width, height) * 2 });
    img = await loadImage(pngBuffer);
  } catch (err) {
    console.error(`[render] failed to load icon "${icon_name}":`, err.message);
    return;
  }

  ctx.save();
  ctx.globalAlpha = opacity ?? 1;

  if (rotation) {
    ctx.translate(x + width / 2, y + height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.translate(-(x + width / 2), -(y + height / 2));
  }

  const s = Math.min(width / img.width, height / img.height);
  const dw = img.width * s, dh = img.height * s;
  ctx.drawImage(img, x + (width - dw) / 2, y + (height - dh) / 2, dw, dh);
  ctx.restore();
}

// Estimates how many characters a text box can hold at a given font/size,
// using the same wrapping math the real renderer uses — measures an average
// character width from a representative sample string, then works out how
// many characters fit per line and how many lines fit in the box height.
// This is an estimate, not exact: real text has uneven character widths and
// wraps at word boundaries, so actual capacity will vary a bit either way.
export function estimateTextCapacity({
  width,
  height,
  font_family = 'sans-serif',
  font_size = 24,
  font_weight = 'normal',
  italic = false,
  line_height = 1.3,
}) {
  const measureCanvas = createCanvas(10, 10);
  const ctx = measureCanvas.getContext('2d');
  ctx.font = `${italic ? 'italic ' : ''}${font_weight === 'bold' ? 'bold ' : ''}${font_size}px "${font_family}"`;

  const sample =
    'the quick brown fox jumps over the lazy dog THE QUICK BROWN FOX JUMPS 0123456789';
  const avgCharWidth = ctx.measureText(sample).width / sample.length;

  const linesThatFit = Math.max(1, Math.floor(height / (font_size * line_height)));
  const charsPerLine = Math.max(1, Math.floor(width / avgCharWidth));
  const estimatedMaxCharacters = linesThatFit * charsPerLine;

  return {
    estimated_max_characters: estimatedMaxCharacters,
    lines_that_fit: linesThatFit,
    chars_per_line: charsPerLine,
    avg_char_width: avgCharWidth,
  };
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
      // Explicit override wins; otherwise fall back to the region's own
      // original image (so an untouched decorative photo stays intact
      // instead of going blank). fit_mode 'cover' already fully opaquely
      // covers the box, so there's no separate erase step needed here.
      const value = values[region.label] ?? region.original_image_url;
      if (value) {
        await drawImageRegion(ctx, region, value);
      }
    } else if (region.type === 'text') {
      const text = values[region.label] !== undefined && values[region.label] !== null
        ? values[region.label]
        : region.original_text;
      if (text !== undefined && text !== null) {
        // Erase whatever's baked into the background at this exact spot
        // before drawing — otherwise the original text (which is still
        // physically part of the background image) can show through
        // around/behind the new text. Sampled from the box's own top-left
        // corner, which for typical text boxes (some internal padding, or
        // vertically-centered text) is usually background, not glyph pixels.
        eraseRegionBackground(ctx, region);
        drawTextRegion(ctx, region, text);
      }
    } else if (region.type === 'shape') {
      drawShapeRegion(ctx, region);
    } else if (region.type === 'icon') {
      await drawIconRegion(ctx, region);
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
