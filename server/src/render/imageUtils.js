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
 * - fit:
 *   - 'contain': scales within maxContentRatio, centered on backgroundColor
 *   - 'cover': scales to fill canvas edge-to-edge with centered crop
 *   - 'full_width': preserves 100% of horizontal image width (top-aligned, zero left/right cut-off)
 *                   with a blurred dark backdrop filling the bottom area where template gradients sit
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

  if (fit === 'full_width') {
    // 1. Solid dark base
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    // 2. Smooth blurred + darkened background fill (downscale then upscale for fast Gaussian-like blur)
    const blurW = 48;
    const blurH = Math.max(24, Math.round((height / width) * blurW));
    const smallCanvas = createCanvas(blurW, blurH);
    const smallCtx = smallCanvas.getContext('2d');
    const coverScale = Math.max(blurW / img.width, blurH / img.height);
    const sdw = img.width * coverScale;
    const sdh = img.height * coverScale;
    smallCtx.drawImage(img, (blurW - sdw) / 2, (blurH - sdh) / 2, sdw, sdh);

    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(smallCanvas, 0, 0, width, height);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(0, 0, width, height);

    // 3. Draw sharp foreground image preserving full width (never cropping left/right)
    const imgRatio = img.width / img.height;
    const canvasRatio = width / height;

    if (imgRatio >= canvasRatio) {
      // Horizontal / wide image: fit 100% of width at the top of the frame
      const dw = width;
      const dh = Math.round(img.height * (width / img.width));
      ctx.drawImage(img, 0, 0, dw, dh);

      // Soft dark gradient transition from the bottom of the photo into the black lower area
      if (dh < height) {
        const fadeStart = Math.max(0, dh - Math.min(80, Math.round(dh * 0.18)));
        const grad = ctx.createLinearGradient(0, fadeStart, 0, height);
        grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
        grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.65)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0.95)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, fadeStart, width, height - fadeStart);
      }
    } else {
      // Square or vertical image: fit full height, centered horizontally over blurred dark backdrop
      const dh = height;
      const dw = Math.round(img.width * (height / img.height));
      const dx = Math.round((width - dw) / 2);
      ctx.drawImage(img, dx, 0, dw, dh);
    }

    return canvas.encode('png');
  }

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
