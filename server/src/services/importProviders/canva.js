// Import provider interface (kept intentionally small so a future source —
// Figma, Freepik, whatever — can implement the same shape):
//
//   listSources({ query, continuation }) -> { items: [{id,title,thumbnail_url}], continuation }
//   extractElements(sourceId, { targetWidthPx, targetHeightPx }) -> {
//     source: string,               // which extraction path was used, for logging
//     elements: [...],              // text/image/shape elements, pixel coords
//     resolveImage: async (el) => ({ buffer, mime }),  // fetch an image element's bytes
//   }
//
// Canva is the first (and so far only) provider. It prefers SVG export —
// real structured vector data — and falls back to PPTX only when Canva
// doesn't offer SVG for a given design type. It deliberately does NOT use
// Canva's public share-link "view" pages: that endpoint disallows automated
// access via robots.txt, so it's off the table regardless of what other
// tools in this space do.

import { listDesigns, getDesign, getExportFormats, createExportJob, waitForExport } from '../canvaApi.js';
import { parseSvg, resolveImageHref } from '../svgParser.js';
import { parsePptx, extractMedia } from '../pptxParser.js';

async function downloadExport(designId, format) {
  const job = await createExportJob(designId, format);
  const completed = await waitForExport(job.id);
  const downloadUrl = completed.urls?.[0];
  if (!downloadUrl) throw new Error(`Canva ${format} export succeeded but returned no download URL`);
  const res = await fetch(downloadUrl);
  if (!res.ok) throw new Error(`Failed to download ${format} export (HTTP ${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

export async function listSources({ query, continuation } = {}) {
  return listDesigns({ query, continuation });
}

export async function getSourceMeta(sourceId) {
  return getDesign(sourceId);
}

export async function extractElements(sourceId, { targetWidthPx, targetHeightPx } = {}) {
  let formats = [];
  try {
    formats = await getExportFormats(sourceId);
  } catch (err) {
    console.warn(`[canva provider] could not check export formats, assuming pptx-only: ${err.message}`);
  }

  if (formats.includes('svg')) {
    try {
      const svgBuffer = await downloadExport(sourceId, 'svg');
      const { elements } = await parseSvg(svgBuffer, { targetWidthPx, targetHeightPx });
      if (elements.length) {
        return {
          source: 'svg',
          elements,
          resolveImage: (el) => resolveImageHref(el.href),
        };
      }
      console.warn('[canva provider] SVG export parsed but yielded no elements, falling back to PPTX');
    } catch (err) {
      console.warn(`[canva provider] SVG extraction failed, falling back to PPTX: ${err.message}`);
    }
  }

  const pptxBuffer = await downloadExport(sourceId, 'pptx');
  const { elements, zip } = await parsePptx(pptxBuffer, { targetWidthPx, targetHeightPx });
  return {
    source: 'pptx',
    elements,
    resolveImage: async (el) => {
      const buffer = await extractMedia(zip, el.mediaPath);
      const ext = el.mediaPath.split('.').pop() || 'png';
      return { buffer, mime: `image/${ext}` };
    },
  };
}
