import {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  disconnectCanva,
  isConnected,
} from '../services/canvaAuth.js';
import { listDesigns, getDesign, createExportJob, waitForExport } from '../services/canvaApi.js';
import { getImageDimensions } from '../render/canvasRenderer.js';
import { storeAsset } from '../services/storage.js';
import { createTemplate, createRegion, getTemplate } from '../services/templateStore.js';
import { parsePptx } from '../services/pptxParser.js';

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
  app.get('/status', async () => ({
    configured: canvaConfigured(),
    connected: canvaConfigured() ? await isConnected() : false,
  }));

  // Visiting this in a browser kicks off the OAuth flow — there's no API
  // response here, it's a redirect straight to Canva's consent screen.
  app.get('/connect', async (req, reply) => {
    if (!canvaConfigured()) {
      return reply.code(501).send({
        error: 'canva_not_configured',
        message: 'Set CANVA_CLIENT_ID, CANVA_CLIENT_SECRET, and CANVA_REDIRECT_URI in your environment first.',
      });
    }
    reply.redirect(buildAuthorizeUrl());
  });

  // Canva redirects back here after the user approves (or denies) access.
  app.get('/callback', async (req, reply) => {
    const { code, state, error } = req.query || {};
    if (error) {
      return reply.redirect(`/?canva=error&message=${encodeURIComponent(error)}`);
    }
    if (!code || !state) {
      return reply.code(400).send({ error: 'missing_code_or_state' });
    }
    try {
      await exchangeCodeForToken(code, state);
      // Send the user back into the admin app rather than showing raw JSON —
      // this was reached via a real browser navigation, not a fetch() call.
      reply.redirect('/?canva=connected');
    } catch (err) {
      app.log.error(err);
      reply.redirect(`/?canva=error&message=${encodeURIComponent(err.message)}`);
    }
  });

  app.post('/disconnect', async (req, reply) => {
    await disconnectCanva();
    reply.send({ ok: true });
  });

  // List the connected account's designs. Query params: ?query=... (search),
  // ?continuation=... (pagination token from a previous response).
  app.get('/designs', async (req, reply) => {
    if (!canvaConfigured()) {
      return reply.code(501).send({ error: 'canva_not_configured' });
    }
    try {
      const { query, continuation } = req.query || {};
      const result = await listDesigns({ query, continuation });
      reply.send(result);
    } catch (err) {
      if (err.message === 'not_connected') {
        return reply.code(409).send({ error: 'not_connected', message: 'Connect Canva first via /api/canva/connect.' });
      }
      app.log.error(err);
      reply.code(502).send({ error: 'canva_designs_failed', message: err.message });
    }
  });

  // Pulls a Canva design in as a new Fillcraft template. Two things happen
  // in parallel: a flattened PNG export (used as the visual background,
  // same as before) and a PPTX export (structured XML — real text runs with
  // font/size/color, real image positions) which we parse to auto-create
  // regions matching the design's actual elements, instead of requiring
  // manual box-drawing. If PPTX parsing fails or finds nothing usable, the
  // import still succeeds as a plain flattened template (old behavior) —
  // this is a strict enhancement, never a new way to fail.
  app.post('/import/:designId', async (req, reply) => {
    if (!canvaConfigured()) {
      return reply.code(501).send({ error: 'canva_not_configured' });
    }
    const { designId } = req.params;
    const { category_ids, name } = req.body || {};

    try {
      const design = await getDesign(designId).catch(() => null);
      const pngBuffer = await downloadExport(designId, 'png');
      const { width, height } = await getImageDimensions(pngBuffer);
      const asset = await storeAsset(pngBuffer, `${designId}.png`, 'image/png');

      const template = await createTemplate({
        name: name || design?.title || 'Canva Import',
        category_ids: category_ids || [],
        canva_design_id: designId,
        source_image_url: asset.url,
        thumbnail_url: asset.url,
        width,
        height,
      });

      let elementsCreated = 0;
      try {
        const pptxBuffer = await downloadExport(designId, 'pptx');
        const { elements } = await parsePptx(pptxBuffer, { targetWidthPx: width, targetHeightPx: height });

        for (const el of elements) {
          if (el.type === 'text') {
            const style = {
              font_family: el.font_family,
              font_size: el.font_size,
              font_weight: el.font_weight,
              italic: el.italic,
              color: el.color,
              align: 'left',
              line_height: 1.3,
            };
            await createRegion(template.id, {
              type: 'text',
              x: el.x, y: el.y, width: el.width, height: el.height,
              // Defaults to the real original text's exact length, per how
              // this design was actually built — not an estimate.
              max_characters: el.text.length,
              original_style: style,
              current_style: style,
            });
            elementsCreated++;
          } else if (el.type === 'image') {
            await createRegion(template.id, {
              type: 'image',
              x: el.x, y: el.y, width: el.width, height: el.height,
              fit_mode: 'cover',
            });
            elementsCreated++;
          }
        }
      } catch (pptxErr) {
        // Non-fatal — the template above was already created successfully
        // with just the flattened background, same as the old behavior.
        req.log.warn(`PPTX structural parse failed, falling back to flatten-only import: ${pptxErr.message}`);
      }

      const finalTemplate = elementsCreated > 0 ? await getTemplate(template.id) : template;
      reply.code(201).send({ ...finalTemplate, elements_auto_detected: elementsCreated });
    } catch (err) {
      if (err.message === 'not_connected') {
        return reply.code(409).send({ error: 'not_connected', message: 'Connect Canva first via /api/canva/connect.' });
      }
      app.log.error(err);
      reply.code(502).send({ error: 'canva_import_failed', message: err.message });
    }
  });
}
