import {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  createRegion,
  updateRegion,
  deleteRegion,
  nextRegionLabel,
  matchTemplates,
} from '../services/templateStore.js';
import { storeAsset, resolveAssetSource } from '../services/storage.js';
import { getImageDimensions } from '../render/canvasRenderer.js';
import { detectTextBlocks } from '../services/ocr.js';
import { createCanvas } from '@napi-rs/canvas';
import fs from 'fs';

export default async function templatesRoutes(app) {
  app.get('/', async () => listTemplates());

  // Finds templates that can fit a given amount of text, optionally scoped
  // to a category, sorted least-recently-used first (never-used templates
  // first) — for picking a template that spreads usage across your library
  // rather than always returning the same one.
  // GET /api/templates/match?content_length=180&category_id=...
  app.get('/match', async (req) => {
    const { content_length, category_id } = req.query || {};
    return matchTemplates({
      content_length: content_length !== undefined ? Number(content_length) : undefined,
      category_id: category_id || undefined,
    });
  });

  app.get('/:id', async (req, reply) => {
    const template = await getTemplate(req.params.id);
    if (!template) return reply.code(404).send({ error: 'not_found' });
    return template;
  });

  // Runs OCR on the template's source image and returns candidate text
  // regions (NOT saved) for the admin UI to show as a review overlay — the
  // user picks which ones to actually keep as real regions. This is an
  // assist, not magic: works well on clean printed text, less reliably on
  // stylized/curved/decorative fonts common in Canva designs.
  app.post('/:id/detect-text-regions', async (req, reply) => {
    const template = await getTemplate(req.params.id);
    if (!template) return reply.code(404).send({ error: 'not_found' });

    try {
      const source = resolveAssetSource(template.source_image_url);
      const buffer = fs.existsSync(source) ? fs.readFileSync(source) : Buffer.from(await (await fetch(source)).arrayBuffer());

      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('OCR timed out after 45s (first-time language data download may be slow — try again)')), 45000)
      );
      const candidates = await Promise.race([detectTextBlocks(buffer), timeout]);
      reply.send({ candidates });
    } catch (err) {
      req.log.error(err);
      reply.code(500).send({ error: 'detect_failed', message: err.message });
    }
  });

  // Create a template from an uploaded image (multipart: file field "image",
  // plus optional fields "name" and "category_ids" — a JSON-stringified
  // array, e.g. '["id1","id2"]'; omit or send '[]' for no category).
  // POST /api/templates/blank
  // Body (JSON, not multipart): { name, width, height, background_color, category_ids }
  // Creates a template with a solid-color generated background and zero
  // regions — a genuine from-scratch starting point. No image upload, no
  // Canva design required. You land straight in the editor and draw.
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
    const fileBuffer = await canvas.encode('png');

    const asset = await storeAsset(fileBuffer, 'blank.png', 'image/png');
    const template = await createTemplate({
      name: name || 'Untitled Template',
      category_ids: category_ids || [],
      canva_design_id: null,
      source_image_url: asset.url,
      thumbnail_url: asset.url,
      width: w,
      height: h,
    });
    reply.code(201).send(template);
  });

  app.post('/', async (req, reply) => {
    if (!req.isMultipart()) {
      return reply.code(400).send({ error: 'expected multipart/form-data with an "image" file' });
    }

    let fileBuffer = null;
    let filename = null;
    let mimetype = null;
    const fields = {};

    for await (const part of req.parts()) {
      if (part.type === 'file') {
        fileBuffer = await part.toBuffer();
        filename = part.filename;
        mimetype = part.mimetype;
      } else {
        fields[part.fieldname] = part.value;
      }
    }

    if (!fileBuffer) {
      return reply.code(400).send({ error: 'image file is required' });
    }

    let category_ids = [];
    if (fields.category_ids) {
      try { category_ids = JSON.parse(fields.category_ids); } catch { category_ids = []; }
    }

    const { width, height } = await getImageDimensions(fileBuffer);
    const asset = await storeAsset(fileBuffer, filename || 'template.png', mimetype || 'image/png');

    const template = await createTemplate({
      name: fields.name || 'Untitled Template',
      category_ids,
      canva_design_id: fields.canva_design_id || null,
      source_image_url: asset.url,
      thumbnail_url: asset.url,
      width,
      height,
    });

    reply.code(201).send(template);
  });

  app.patch('/:id', async (req, reply) => {
    const updated = await updateTemplate(req.params.id, req.body || {});
    reply.send(updated);
  });

  app.delete('/:id', async (req, reply) => {
    await deleteTemplate(req.params.id);
    reply.code(204).send();
  });

  // ---- Regions ----

  app.post('/:id/regions', async (req, reply) => {
    const body = req.body || {};
    if (!['image', 'text', 'shape', 'icon'].includes(body.type)) {
      return reply.code(400).send({ error: 'type must be "image", "text", "shape", or "icon"' });
    }

    const label = body.label || (await nextRegionLabel(req.params.id, body.type));
    let payload;

    if (body.type === 'text') {
      payload = {
        type: 'text',
        label,
        x: body.x, y: body.y, width: body.width, height: body.height,
        z_index: body.z_index ?? 0,
        max_characters: body.max_characters ?? null,
        current_style: body.current_style || {},
        original_text: body.original_text ?? null,
        auto_shrink_to_fit: body.auto_shrink_to_fit ?? true,
      };
    } else if (body.type === 'image') {
      payload = {
        type: 'image', label,
        x: body.x, y: body.y, width: body.width, height: body.height,
        z_index: body.z_index ?? 0,
        fit_mode: body.fit_mode ?? 'cover',
        corner_radius: body.corner_radius ?? 0,
        opacity: body.opacity ?? 1,
        rotation: body.rotation ?? 0,
        border_width: body.border_width ?? 0,
        border_color: body.border_color ?? null,
        filter: body.filter ?? null,
        original_image_url: body.original_image_url ?? null,
      };
    } else if (body.type === 'shape') {
      payload = {
        type: 'shape', label,
        x: body.x, y: body.y, width: body.width, height: body.height,
        z_index: body.z_index ?? 0,
        shape_type: body.shape_type ?? 'rectangle',
        fill_color: body.fill_color ?? '#D9A441',
        stroke_color: body.stroke_color ?? null,
        stroke_width: body.stroke_width ?? 0,
        corner_radius: body.corner_radius ?? 0,
        opacity: body.opacity ?? 1,
        rotation: body.rotation ?? 0,
        sides: body.sides ?? 6,
      };
    } else {
      // icon
      payload = {
        type: 'icon', label,
        x: body.x, y: body.y, width: body.width, height: body.height,
        z_index: body.z_index ?? 0,
        icon_name: body.icon_name ?? 'mdi:star',
        icon_color: body.icon_color ?? '#D9A441',
        opacity: body.opacity ?? 1,
        rotation: body.rotation ?? 0,
      };
    }

    const region = await createRegion(req.params.id, payload);
    reply.code(201).send(region);
  });

  app.patch('/:id/regions/:regionId', async (req, reply) => {
    const updated = await updateRegion(req.params.regionId, req.body || {});
    reply.send(updated);
  });

  app.delete('/:id/regions/:regionId', async (req, reply) => {
    await deleteRegion(req.params.regionId);
    reply.code(204).send();
  });

  // Sets the "default image" for an image region — what renders when
  // autofill doesn't override this field. Multipart: file field "image".
  app.post('/:id/regions/:regionId/default-image', async (req, reply) => {
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

    const asset = await storeAsset(fileBuffer, filename || 'default-image.png', mimetype || 'image/png');
    const updated = await updateRegion(req.params.regionId, { original_image_url: asset.url });
    reply.send(updated);
  });
}
