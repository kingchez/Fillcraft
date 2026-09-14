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
import * as canvaProvider from '../services/importProviders/canva.js';

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

  // Pulls a Canva design in as a new Fillcraft template. A flattened PNG
  // export is always stored as the visual background (so imports never
  // fail outright even if structural extraction finds nothing). In
  // parallel, the Canva import provider extracts real elements — SVG when
  // Canva offers it for this design type (best fidelity: exact shapes,
  // fonts, colors, positions), PPTX otherwise — and turns each into a
  // matching, autofill-ready region instead of requiring manual box-drawing.
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
      let extractionSource = null;
      try {
        const { source, elements, resolveImage } = await canvaProvider.extractElements(designId, {
          targetWidthPx: width,
          targetHeightPx: height,
        });
        extractionSource = source;

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
              // The actual original text — rendered as the default when
              // autofill doesn't override this field, instead of going blank.
              original_text: el.text,
              current_style: style,
            });
            elementsCreated++;
          } else if (el.type === 'image') {
            // Extract the real embedded photo and store it as this region's
            // default image — so an unedited photo placeholder renders the
            // original design's actual image, not a blank box.
            let originalImageUrl = null;
            try {
              const { buffer, mime } = await resolveImage(el);
              const ext = mime.split('/')[1] || 'png';
              const asset = await storeAsset(buffer, `${designId}-${elementsCreated}.${ext}`, mime);
              originalImageUrl = asset.url;
            } catch (mediaErr) {
              req.log.warn(`Could not resolve embedded image: ${mediaErr.message}`);
            }
            await createRegion(template.id, {
              type: 'image',
              x: el.x, y: el.y, width: el.width, height: el.height,
              fit_mode: 'cover',
              original_image_url: originalImageUrl,
            });
            elementsCreated++;
          } else if (el.type === 'shape') {
            // Only the SVG path produces real shape elements (rect/ellipse)
            // — PPTX parsing doesn't attempt shape geometry.
            await createRegion(template.id, {
              type: 'shape',
              x: el.x, y: el.y, width: el.width, height: el.height,
              shape_type: el.shape_type,
              corner_radius: el.corner_radius || 0,
              fill_color: el.fill_color,
              stroke_color: el.stroke_color,
              stroke_width: el.stroke_width || 0,
            });
            elementsCreated++;
          }
        }
      } catch (extractErr) {
        // Non-fatal — the template above was already created successfully
        // with just the flattened background.
        req.log.warn(`Structural extraction failed, falling back to flatten-only import: ${extractErr.message}`);
      }

      const finalTemplate = elementsCreated > 0 ? await getTemplate(template.id) : template;
      reply.code(201).send({ ...finalTemplate, elements_auto_detected: elementsCreated, extraction_source: extractionSource });
    } catch (err) {
      if (err.message === 'not_connected') {
        return reply.code(409).send({ error: 'not_connected', message: 'Connect Canva first via /api/canva/connect.' });
      }
      app.log.error(err);
      reply.code(502).send({ error: 'canva_import_failed', message: err.message });
    }
  });
}
