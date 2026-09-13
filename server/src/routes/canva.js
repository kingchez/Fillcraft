import {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  disconnectCanva,
  isConnected,
} from '../services/canvaAuth.js';
import { listDesigns, getDesign, createExportJob, waitForExport } from '../services/canvaApi.js';
import { getImageDimensions } from '../render/canvasRenderer.js';
import { storeAsset } from '../services/storage.js';
import { createTemplate } from '../services/templateStore.js';

function canvaConfigured() {
  return !!(process.env.CANVA_CLIENT_ID && process.env.CANVA_CLIENT_SECRET && process.env.CANVA_REDIRECT_URI);
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

  // Pulls a Canva design in as a new Fillcraft template: exports it as a
  // flattened PNG, downloads it, and runs it through the same
  // createTemplate() path a manual upload uses.
  app.post('/import/:designId', async (req, reply) => {
    if (!canvaConfigured()) {
      return reply.code(501).send({ error: 'canva_not_configured' });
    }
    const { designId } = req.params;
    const { category_ids, name } = req.body || {};

    try {
      const design = await getDesign(designId).catch(() => null);
      const job = await createExportJob(designId);
      const completed = await waitForExport(job.id);

      const downloadUrl = completed.urls?.[0];
      if (!downloadUrl) throw new Error('Canva export succeeded but returned no download URL');

      const imgRes = await fetch(downloadUrl);
      if (!imgRes.ok) throw new Error(`Failed to download exported design (HTTP ${imgRes.status})`);
      const buffer = Buffer.from(await imgRes.arrayBuffer());

      const { width, height } = await getImageDimensions(buffer);
      const asset = await storeAsset(buffer, `${designId}.png`, 'image/png');

      const template = await createTemplate({
        name: name || design?.title || 'Canva Import',
        category_ids: category_ids || [],
        canva_design_id: designId,
        source_image_url: asset.url,
        thumbnail_url: asset.url,
        width,
        height,
      });

      reply.code(201).send(template);
    } catch (err) {
      if (err.message === 'not_connected') {
        return reply.code(409).send({ error: 'not_connected', message: 'Connect Canva first via /api/canva/connect.' });
      }
      app.log.error(err);
      reply.code(502).send({ error: 'canva_import_failed', message: err.message });
    }
  });
}
