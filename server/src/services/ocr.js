import { createWorker } from 'tesseract.js';
import { getLocalUploadsDir } from '../db/sqlite.js';

// A single shared worker, created lazily on first use and reused after —
// spinning one up is relatively expensive (loads the OCR engine + language
// data), so we don't want to do that per-request.
let workerPromise = null;

function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('eng', 1, {
      // Persists the downloaded language data here so it survives restarts
      // (this is the same directory mounted as a Dokploy volume) instead of
      // re-downloading it on every deploy.
      cachePath: getLocalUploadsDir(),
      // Tesseract.js's default behavior for a rejected job, when no
      // errorHandler is supplied, is to ALSO throw at the process level —
      // on top of properly rejecting the recognize() promise. That second,
      // redundant throw is an unhandled exception that crashes the entire
      // Node process, not just this request. Supplying a no-op here
      // prevents that; the real error still reaches our try/catch below via
      // the normal promise rejection.
      errorHandler: () => {},
    });
  }
  return workerPromise;
}

// Runs OCR on an image buffer and returns candidate text regions with
// bounding boxes, one per detected paragraph (grouping nearby lines rather
// than returning every individual word). This is a starting point for the
// user to review, not something that gets saved automatically — OCR can
// misread stylized/curved/decorative fonts, so false positives and slightly
// off bounding boxes are expected, especially on typical Canva designs.
export async function detectTextBlocks(imageBuffer) {
  const worker = await getWorker();
  const { data } = await worker.recognize(imageBuffer, {}, { text: true, blocks: true, hocr: false, tsv: false });

  const candidates = [];
  for (const block of data.blocks || []) {
    for (const paragraph of block.paragraphs || []) {
      const text = paragraph.text?.trim();
      if (!text) continue;
      const { x0, y0, x1, y1 } = paragraph.bbox;
      candidates.push({
        text,
        x: x0,
        y: y0,
        width: x1 - x0,
        height: y1 - y0,
        confidence: paragraph.confidence,
      });
    }
  }
  return candidates;
}
