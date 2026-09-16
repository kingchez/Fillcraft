import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { randomUUID } from 'crypto';

const EMU_PER_INCH = 914400;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => ['p:sp', 'p:pic', 'p:grpSp', 'a:p', 'a:r', 'a:solidFill'].includes(name),
});

function asArray(v) {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}
function emuToPx(emu, pxPerEmu) { return Math.round(Number(emu) * pxPerEmu); }

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
    x: emuToPx(off['@_x'], pxPerEmu), y: emuToPx(off['@_y'], pxPerEmu),
    width: emuToPx(ext['@_cx'], pxPerEmu), height: emuToPx(ext['@_cy'], pxPerEmu),
  };
}

// Returns { objects, imageMediaPaths, zip } where objects are Fabric-shaped
// and imageMediaPaths maps object.id -> path inside the pptx zip, for the
// caller to extract bytes via extractMedia() and resolve into a real src.
export async function pptxToFabricObjects(buffer, { targetWidthPx, targetHeightPx } = {}) {
  const zip = await JSZip.loadAsync(buffer);

  const presentationXml = await zip.file('ppt/presentation.xml')?.async('text');
  if (!presentationXml) throw new Error('Not a valid PPTX (missing ppt/presentation.xml)');
  const presentation = parser.parse(presentationXml);
  const sldSz = presentation['p:presentation']?.['p:sldSz'];
  const slideWidthEmu = Number(sldSz?.['@_cx']);
  const slideHeightEmu = Number(sldSz?.['@_cy']);

  const pxPerEmuX = targetWidthPx ? targetWidthPx / slideWidthEmu : 1 / (EMU_PER_INCH / 96);
  const pxPerEmuY = targetHeightPx ? targetHeightPx / slideHeightEmu : 1 / (EMU_PER_INCH / 96);
  const pxPerEmu = (pxPerEmuX + pxPerEmuY) / 2;

  const slideFile = zip.file('ppt/slides/slide1.xml');
  if (!slideFile) throw new Error('No slides found in PPTX');
  const slide = parser.parse(await slideFile.async('text'));

  const relsFile = zip.file('ppt/slides/_rels/slide1.xml.rels');
  const relsMap = {};
  if (relsFile) {
    const rels = parser.parse(await relsFile.async('text'));
    for (const rel of asArray(rels?.['Relationships']?.['Relationship'])) relsMap[rel['@_Id']] = rel['@_Target'];
  }

  const spTree = slide['p:sld']?.['p:cSld']?.['p:spTree'];
  const objects = [];
  const imageMediaPaths = {};
  let zIndex = 0;

  for (const sp of asArray(spTree?.['p:sp'])) {
    try {
      const bounds = shapeBoundsPx(sp['p:spPr'], pxPerEmu);
      const runs = extractRuns(sp['p:txBody']);
      const text = runs.map((r) => r.text).join('');
      if (!bounds || !text.trim()) continue;
      const primary = runs.find((r) => r.text.trim()) || runs[0] || {};
      objects.push({
        id: randomUUID(), type: 'textbox', text,
        left: bounds.x, top: bounds.y, width: bounds.width,
        fontFamily: primary.font_family || 'Inter',
        fontSize: primary.font_size_pt ? Math.round(primary.font_size_pt * (96 / 72)) : 24,
        fontWeight: primary.bold ? 'bold' : 'normal',
        fontStyle: primary.italic ? 'italic' : 'normal',
        fill: primary.color || '#111111',
        zIndex: zIndex++,
      });
    } catch (err) { console.error('[pptxToFabric] skipped a text shape:', err.message); }
  }

  for (const pic of asArray(spTree?.['p:pic'])) {
    try {
      const bounds = shapeBoundsPx(pic['p:spPr'], pxPerEmu);
      const relId = pic['p:blipFill']?.['a:blip']?.['@_r:embed'];
      if (!bounds || !relId) continue;
      const target = relsMap[relId];
      if (!target) continue;
      const id = randomUUID();
      imageMediaPaths[id] = 'ppt/' + target.replace(/^\.\.\//, '');
      objects.push({
        id, type: 'image', _pendingSrc: true,
        left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height,
        scaleX: 1, scaleY: 1, zIndex: zIndex++,
      });
    } catch (err) { console.error('[pptxToFabric] skipped an image shape:', err.message); }
  }

  return { objects, imageMediaPaths, zip };
}

export async function extractMedia(zip, mediaPath) {
  const file = zip.file(mediaPath);
  if (!file) throw new Error(`Media not found in PPTX: ${mediaPath}`);
  return file.async('nodebuffer');
}
