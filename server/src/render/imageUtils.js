// Image utilities unrelated to the template/design renderer — kept exactly
// as they were. normalizeProductImage in particular backs the /api/images/
// normalize endpoint, which is explicitly out of scope for the design-
// platform rebuild and must keep working unchanged throughout.
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';

export async function getImageDimensions(buffer) {
  const img = await loadImage(buffer);
  return { width: img.width, height: img.height };
}

// Registers a locally-stored font file under a family name so it can be
// referenced by design text objects immediately after upload.
export function registerFont(filePath, family) {
  GlobalFonts.registerFromPath(filePath, family);
}

export async function normalizeProductImage(
  buffer,
  { canvasSize = 1000, backgroundColor = '#FFFFFF', maxContentRatio = 0.85 } = {}
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
