import {
  listDesigns, getDesign, createDesign, updateDesign, deleteDesign,
} from '../services/designsStore.js';
import { renderDesign } from '../render/designRenderer.js';
import { ensureFontsForDesign } from '../services/fontRegistry.js';
import { getLocalUploadsDir } from '../services/localFiles.js';
import { storeAsset } from '../services/storage.js';
import { createCanvas } from '@napi-rs/canvas';

export default async function designsRoutes(app) {
  // POST /api/designs/upload-image — uploads a photo to be used as an
  // image object's src inside the editor (drag it in, then add to canvas).
  app.post('/upload-image', async (req, reply) => {
    if (!req.isMultipart()) {
      return reply.code(400).send({ error: 'expected multipart/form-data with an "image" file' });
    }
    let fileBuffer = null;
    let filename = null;
    let mimetype = null;
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        fileBuffer = await part.toBuffer();
        filename = part.filename;
        mimetype = part.mimetype;
      }
    }
    if (!fileBuffer) return reply.code(400).send({ error: 'image file is required' });
    const asset = await storeAsset(fileBuffer, filename, mimetype || 'image/png');
    reply.code(201).send({ url: asset.url });
  });

  app.get('/', async () => listDesigns());

  app.get('/:id', async (req, reply) => {
    const design = await getDesign(req.params.id);
    if (!design) return reply.code(404).send({ error: 'not_found' });
    return design;
  });

  // POST /api/designs/blank — the genuine from-scratch starting point.
  // No image upload, no import, no dependency on any external source.
  app.post('/blank', async (req, reply) => {
    const { name, width, height, background_color, category_ids } = req.body || {};
    const w = Math.round(Number(width)) || 1080;
    const h = Math.round(Number(height)) || 1080;
    if (w < 50 || w > 8000 || h < 50 || h > 8000) {
      return reply.code(400).send({ error: 'invalid_dimensions', message: 'width/height must be between 50 and 8000px' });
    }

    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = background_color || '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
    const thumbBuffer = await canvas.encode('png');
    const asset = await storeAsset(thumbBuffer, 'blank.png', 'image/png');

    const design = await createDesign({
      name: name || 'Untitled Design',
      width: w, height: h,
      canvas_json: {
        version: '6.0.0',
        objects: [
          // Background rect as an actual editable object, not a baked-in
          // image — so background color stays adjustable in the editor.
          { id: 'background', type: 'rect', left: 0, top: 0, width: w, height: h, fill: background_color || '#FFFFFF', selectable: false, evented: false },
        ],
      },
      thumbnail_url: asset.url,
      category_ids: category_ids || [],
    });
    reply.code(201).send(design);
  });

  // PATCH /api/designs/:id — full or partial update: name, dimensions,
  // canvas_json (saves the editor state; also re-syncs the fields index),
  // category_ids, thumbnail_url.
  app.patch('/:id', async (req, reply) => {
    const design = await updateDesign(req.params.id, req.body || {});
    reply.send(design);
  });

  app.delete('/:id', async (req, reply) => {
    await deleteDesign(req.params.id);
    reply.code(204).send();
  });

  // POST /api/designs/:id/thumbnail — regenerate and store a PNG snapshot
  // of the current canvas_json, used for the design grid's thumbnail.
  app.post('/:id/thumbnail', async (req, reply) => {
    const design = await getDesign(req.params.id);
    if (!design) return reply.code(404).send({ error: 'not_found' });
    await ensureFontsForDesign(design);
    const buffer = await renderDesign(design, {});
    const asset = await storeAsset(buffer, `${design.id}-thumb.png`, 'image/png');
    const updated = await updateDesign(design.id, { thumbnail_url: asset.url });
    reply.send(updated);
  });

  // ---- Autofill / preview ----
  // Same render path for both — the only difference is that /autofill logs
  // usage and /preview never does (see designsStore.logDesignUsage).
  async function handleRender(req, reply, { log }) {
    const design = await getDesign(req.params.id);
    if (!design) return reply.code(404).send({ error: 'design_not_found' });
    try {
      await ensureFontsForDesign(design);
      const buffer = await renderDesign(design, req.body || {});
      if (log) {
        const { logDesignUsage } = await import('../services/designsStore.js');
        logDesignUsage(design.id, 'autofill').catch((err) => req.log.warn(`usage log failed: ${err.message}`));
      }
      reply.header('Content-Type', 'image/png');
      return reply.send(buffer);
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'render_failed', message: err.message });
    }
  }

  // POST /api/designs/:id/autofill — the production endpoint (n8n calls this).
  app.post('/:id/autofill', { preHandler: app.requireApiKey }, (req, reply) => handleRender(req, reply, { log: true }));

  // POST /api/designs/:id/preview — used by the editor. Never logs usage.
  app.post('/:id/preview', { preHandler: app.requireApiKey }, (req, reply) => handleRender(req, reply, { log: false }));
}
