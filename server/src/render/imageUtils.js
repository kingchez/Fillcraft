import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';

export async function getImageDimensions(buffer) {
  const img = await loadImage(buffer);
  return { width: img.width, height: img.height };
}

export function registerFont(filePath, family) {
  GlobalFonts.registerFromPath(filePath, family);
}

/**
 * Normalizes an image onto a target canvas.
 * Supports:
 * - canvasWidth / canvasHeight (or square canvasSize fallback)
 * - fit: 'contain' (scales within maxContentRatio, centered on backgroundColor)
 *        or 'cover' (scales to fill canvas edge-to-edge with centered crop)
 */
export async function normalizeProductImage(
  buffer,
  {
    canvasSize = 1000,
    canvasWidth,
    canvasHeight,
    backgroundColor = '#FFFFFF',
    maxContentRatio = 0.98,
    fit = 'contain',
  } = {}
) {
  const width = Number(canvasWidth) || Number(canvasSize) || 1000;
  const height = Number(canvasHeight) || Number(canvasSize) || 1000;

  const img = await loadImage(buffer);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, width, height);

  if (fit === 'cover') {
    const scale = Math.max(width / img.width, height / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    const dx = (width - dw) / 2;
    const dy = (height - dh) / 2;
    ctx.drawImage(img, dx, dy, dw, dh);
  } else {
    const maxW = width * maxContentRatio;
    const maxH = height * maxContentRatio;
    const scale = Math.min(maxW / img.width, maxH / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    const dx = (width - dw) / 2;
    const dy = (height - dh) / 2;
    ctx.drawImage(img, dx, dy, dw, dh);
  }

  return canvas.encode('png');
}
