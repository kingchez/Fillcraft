import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';

// EMU = English Metric Units, PowerPoint's internal unit (914400 per inch).
const EMU_PER_INCH = 914400;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // These elements can legitimately repeat as siblings; force them to always
  // parse as arrays so downstream code doesn't have to handle "one object vs
  // array of objects" ambiguity depending on how many happened to be present.
  isArray: (name) =>
    ['p:sp', 'p:pic', 'p:grpSp', 'a:p', 'a:r', 'a:solidFill'].includes(name),
});

function asArray(v) {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

// Converts EMU to pixels given the slide's known pixel dimensions (derived
// from the background PNG export we generate alongside this).
function emuToPx(emu, pxPerEmu) {
  return Math.round(Number(emu) * pxPerEmu);
}

function extractRuns(txBody) {
  const runs = [];
  for (const para of asArray(txBody?.['a:p'])) {
    for (const r of asArray(para['a:r'])) {
      const text = r['a:t'];
      if (text === undefined || text === null) continue;
      const rPr = r['a:rPr'] || {};
      const sizeHundredthsPt = rPr['@_sz'];
      const color = rPr['a:solidFill']?.[0]?.['a:srgbClr']?.['@_val'];
      runs.push({
        text: String(text),
        bold: rPr['@_b'] === '1',
        italic: rPr['@_i'] === '1',
        font_size_pt: sizeHundredthsPt ? Number(sizeHundredthsPt) / 100 : null,
        color: color ? `#${color}` : null,
        font_family: rPr['a:latin']?.['@_typeface'] || null,
      });
    }
  }
  return runs;
}

function shapeBoundsPx(spPr, pxPerEmu) {
  const xfrm = spPr?.['a:xfrm'];
  const off = xfrm?.['a:off'];
  const ext = xfrm?.['a:ext'];
  if (!off || !ext) return null;
  return {
    x: emuToPx(off['@_x'], pxPerEmu),
    y: emuToPx(off['@_y'], pxPerEmu),
    width: emuToPx(ext['@_cx'], pxPerEmu),
    height: emuToPx(ext['@_cy'], pxPerEmu),
  };
}

// Parses a Canva-exported PPTX buffer into a flat list of text/image
// elements with pixel positions matching `targetWidthPx`/`targetHeightPx`
// (pass the dimensions of the PNG export of the same design, so the two
// line up exactly). Elements that fail to parse cleanly are skipped rather
// than aborting the whole import — a partial result is far more useful than
// none.
export async function parsePptx(buffer, { targetWidthPx, targetHeightPx } = {}) {
  const zip = await JSZip.loadAsync(buffer);

  const presentationXml = await zip.file('ppt/presentation.xml')?.async('text');
  if (!presentationXml) throw new Error('Not a valid PPTX (missing ppt/presentation.xml)');
  const presentation = parser.parse(presentationXml);
  const sldSz = presentation['p:presentation']?.['p:sldSz'];
  const slideWidthEmu = Number(sldSz?.['@_cx']);
  const slideHeightEmu = Number(sldSz?.['@_cy']);

  const pxPerEmuX = targetWidthPx ? targetWidthPx / slideWidthEmu : 1 / (EMU_PER_INCH / 96);
  const pxPerEmuY = targetHeightPx ? targetHeightPx / slideHeightEmu : 1 / (EMU_PER_INCH / 96);
  // Use a single uniform scale (x and y should match for an unstretched
  // design, but average them defensively in case of minor rounding skew).
  const pxPerEmu = (pxPerEmuX + pxPerEmuY) / 2;

  // Only the first slide — Fillcraft templates are single-page.
  const slideFile = zip.file('ppt/slides/slide1.xml');
  if (!slideFile) throw new Error('No slides found in PPTX');
  const slideXml = await slideFile.async('text');
  const slide = parser.parse(slideXml);

  const relsFile = zip.file('ppt/slides/_rels/slide1.xml.rels');
  const relsXml = relsFile ? await relsFile.async('text') : null;
  const relsMap = {};
  if (relsXml) {
    const rels = parser.parse(relsXml);
    for (const rel of asArray(rels?.['Relationships']?.['Relationship'])) {
      relsMap[rel['@_Id']] = rel['@_Target'];
    }
  }

  const spTree = slide['p:sld']?.['p:cSld']?.['p:spTree'];
  const elements = [];

  for (const sp of asArray(spTree?.['p:sp'])) {
    try {
      const bounds = shapeBoundsPx(sp['p:spPr'], pxPerEmu);
      const runs = extractRuns(sp['p:txBody']);
      const text = runs.map((r) => r.text).join('');
      if (!bounds || !text.trim()) continue;

      const primary = runs.find((r) => r.text.trim()) || runs[0] || {};
      elements.push({
        type: 'text',
        text,
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        font_family: primary.font_family || 'Inter',
        font_size: primary.font_size_pt ? Math.round(primary.font_size_pt * (96 / 72)) : 24,
        font_weight: primary.bold ? 'bold' : 'normal',
        italic: !!primary.italic,
        color: primary.color || '#111111',
      });
    } catch (err) {
      console.error('[pptxParser] skipped a text shape that failed to parse:', err.message);
    }
  }

  for (const pic of asArray(spTree?.['p:pic'])) {
    try {
      const bounds = shapeBoundsPx(pic['p:spPr'], pxPerEmu);
      const relId = pic['p:blipFill']?.['a:blip']?.['@_r:embed'];
      if (!bounds || !relId) continue;
      const target = relsMap[relId];
      if (!target) continue;
      const mediaPath = 'ppt/' + target.replace(/^\.\.\//, '');
      elements.push({
        type: 'image',
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        mediaPath,
      });
    } catch (err) {
      console.error('[pptxParser] skipped an image shape that failed to parse:', err.message);
    }
  }

  return { slideWidthEmu, slideHeightEmu, elements, zip };
}

// Extracts an embedded image's raw bytes from the already-loaded pptx zip.
export async function extractMedia(zip, mediaPath) {
  const file = zip.file(mediaPath);
  if (!file) throw new Error(`Media not found in PPTX: ${mediaPath}`);
  return file.async('nodebuffer');
}
