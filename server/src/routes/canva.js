import {
  buildAuthorizeUrl, exchangeCodeForToken, disconnectCanva, isConnected,
} from '../services/canvaAuth.js';
import {
  listDesigns, getDesign, getExportFormats, createExportJob, waitForExport,
} from '../services/canvaApi.js';
import { svgToFabricObjects, resolveImageHref } from '../services/svgToFabric.js';
import { pptxToFabricObjects, extractMedia } from '../services/pptxToFabric.js';
import { storeAsset } from '../services/storage.js';
import { createDesign } from '../services/designsStore.js';

function canvaConfigured() {
  return !!(process.env.CANVA_CLIENT_ID && process.env.CANVA_CLIENT_SECRET && process.env.CANVA_REDIRECT_URI);
}

async function downloadExport(designId, format) {
  const job = await createExportJob(designId, format);
  const completed = await waitForExport(job.id);
  const downloadUrl = completed.urls?.[0];
  if (!downloadUrl) throw new Error(`Canva ${format} export succeeded but returned no download URL`);
  const res = await fetch(downloadUrl);
  if (!res.ok) throw new Error(`Failed to download ${format} export (HTTP ${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

export default async function canvaRoutes(app) {
  app.get('/status', async () => ({ configured: canvaConfigured(), connected: canvaConfigured() ? await isConnected() : false }));

  app.get('/connect', async (req, reply) => {
    if (!canvaConfigured()) return reply.code(501).send({ error: 'canva_not_configured' });
    reply.redirect(buildAuthorizeUrl());
  });

  app.get('/callback', async (req, reply) => {
    const { code, state, error } = req.query;
    if (error) return reply.code(400).send({ error });
    try {
      await exchangeCodeForToken(code, state);
      reply.redirect('/?canva=connected');
    } catch (err) {
      app.log.error(err);
      reply.code(500).send({ error: 'oauth_exchange_failed', message: err.message });
    }
  });

  app.post('/disconnect', async (req, reply) => {
    await disconnectCanva();
    reply.code(204).send();
  });

  app.get('/designs', async (req, reply) => {
    try {
      const data = await listDesigns({ query: req.query.query, continuation: req.query.continuation });
      reply.send(data);
    } catch (err) {
      if (err.message === 'not_connected') return reply.code(409).send({ error: 'not_connected' });
      app.log.error(err);
      reply.code(502).send({ error: 'canva_list_failed', message: err.message });
    }
  });

  // POST /api/canva/import/:designId — pulls a Canva design's elements
  // straight into a NEW Fillcraft design's canvas_json as real, individually
  // editable objects (text/rect/circle so far; images resolved and stored
  // as Fillcraft assets, not left pointing at Canva's URLs). Nothing comes
  // in pre-marked as an autofill field — you mark what you need afterward,
  // same as anything built from scratch. Falls back to a flattened PNG
  // background (still editable-on-top, just with a static base image) if
  // SVG export isn't available for this design type, or extraction finds
  // nothing — an import should never fail outright just because structural
  // extraction came up empty.
  app.post('/import/:designId', async (req, reply) => {
    if (!canvaConfigured()) return reply.code(501).send({ error: 'canva_not_configured' });
    const { designId } = req.params;
    const { name } = req.body || {};

    try {
      const design = await getDesign(designId).catch(() => null);
      const pngBuffer = await downloadExport(designId, 'png');
      const { getImageDimensions } = await import('../render/imageUtils.js');
      const { width, height } = await getImageDimensions(pngBuffer);

      let objects = [];
      let extractionSource = 'none';

      let formats = [];
      try { formats = await getExportFormats(designId); } catch { /* assume unavailable */ }

      if (formats.includes('svg')) {
        try {
          const svgBuffer = await downloadExport(designId, 'svg');
          const result = await svgToFabricObjects(svgBuffer, { targetWidthPx: width, targetHeightPx: height });
          extractionSource = 'svg';

          for (const obj of result.objects) {
            if (obj._pendingSrc) {
              try {
                const { buffer, mime } = await resolveImageHref(result.imageHrefs[obj.id]);
                const ext = mime.split('/')[1] || 'png';
                const asset = await storeAsset(buffer, `${designId}-${obj.id}.${ext}`, mime, 'imported');
                obj.src = asset.url;
              } catch (imgErr) {
                req.log.warn(`Could not resolve embedded image: ${imgErr.message}`);
                continue; // skip this object rather than leave a broken image src
              }
              delete obj._pendingSrc;
            }
            objects.push(obj);
          }
        } catch (svgErr) {
          req.log.warn(`SVG extraction failed: ${svgErr.message}`);
        }
      }

      // PPTX fallback — tried whenever SVG didn't produce anything, not just
      // when it's outright unavailable. Canva offers PPTX export far more
      // consistently across design types than SVG.
      if (objects.length === 0) {
        try {
          const pptxBuffer = await downloadExport(designId, 'pptx');
          const result = await pptxToFabricObjects(pptxBuffer, { targetWidthPx: width, targetHeightPx: height });
          extractionSource = extractionSource === 'svg' ? 'svg+pptx' : 'pptx';

          for (const obj of result.objects) {
            if (obj._pendingSrc) {
              try {
                const buffer = await extractMedia(result.zip, result.imageMediaPaths[obj.id]);
                const ext = result.imageMediaPaths[obj.id].split('.').pop() || 'png';
                const asset = await storeAsset(buffer, `${designId}-${obj.id}.${ext}`, `image/${ext}`, 'imported');
                obj.src = asset.url;
              } catch (imgErr) {
                req.log.warn(`Could not extract PPTX embedded image: ${imgErr.message}`);
                continue;
              }
              delete obj._pendingSrc;
            }
            objects.push(obj);
          }
        } catch (pptxErr) {
          req.log.warn(`PPTX extraction also failed, importing as flattened background only: ${pptxErr.message}`);
        }
      }

      // Flattened PNG as the base layer — either the sole content (SVG
      // unavailable/failed) or sitting behind the extracted objects so
      // nothing visually goes missing even where extraction didn't reach.
      const bgAsset = await storeAsset(pngBuffer, `${designId}-bg.png`, 'image/png', 'imported');
      const bgObject = {
        id: 'canva-flattened-bg', type: 'image', src: bgAsset.url,
        left: 0, top: 0, width, height, scaleX: 1, scaleY: 1,
        selectable: false, evented: false, zIndex: -1,
      };

      const created = await createDesign({
        name: name || design?.title || 'Canva Import',
        width, height,
        canvas_json: { version: '6.0.0', objects: [bgObject, ...objects] },
        thumbnail_url: bgAsset.url,
      });

      reply.code(201).send({ ...created, elements_extracted: objects.length, extraction_source: extractionSource });
    } catch (err) {
      if (err.message === 'not_connected') return reply.code(409).send({ error: 'not_connected', message: 'Connect Canva first via /api/canva/connect.' });
      app.log.error(err);
      reply.code(502).send({ error: 'canva_import_failed', message: err.message });
    }
  });
}
