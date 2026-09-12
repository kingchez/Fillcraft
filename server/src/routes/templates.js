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
} from '../services/templateStore.js';
import { storeAsset } from '../services/storage.js';
import { getImageDimensions } from '../render/canvasRenderer.js';

export default async function templatesRoutes(app) {
  app.get('/', async () => listTemplates());

  app.get('/:id', async (req, reply) => {
    const template = await getTemplate(req.params.id);
    if (!template) return reply.code(404).send({ error: 'not_found' });
    return template;
  });

  // Create a template from an uploaded image (multipart: file field "image",
  // plus optional fields "name" and "category_id").
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

    const { width, height } = await getImageDimensions(fileBuffer);
    const asset = await storeAsset(fileBuffer, filename || 'template.png', mimetype || 'image/png');

    const template = await createTemplate({
      name: fields.name || 'Untitled Template',
      category_id: fields.category_id || null,
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
      const style = body.original_style || {};
      payload = {
        type: 'text',
        label,
        x: body.x, y: body.y, width: body.width, height: body.height,
        z_index: body.z_index ?? 0,
        max_characters: body.max_characters ?? null,
        original_style: style,
        current_style: style,
        auto_shrink_to_fit: body.auto_shrink_to_fit ?? true,
      };
    } else if (body.type === 'image') {
      const props = {
        fit_mode: body.fit_mode ?? 'cover',
        corner_radius: body.corner_radius ?? 0,
        opacity: body.opacity ?? 1,
        rotation: body.rotation ?? 0,
        border_width: body.border_width ?? 0,
        border_color: body.border_color ?? null,
        filter: body.filter ?? null,
      };
      payload = {
        type: 'image', label,
        x: body.x, y: body.y, width: body.width, height: body.height,
        z_index: body.z_index ?? 0,
        ...props,
        original_properties: props,
      };
    } else if (body.type === 'shape') {
      const props = {
        shape_type: body.shape_type ?? 'rectangle',
        fill_color: body.fill_color ?? '#D9A441',
        stroke_color: body.stroke_color ?? null,
        stroke_width: body.stroke_width ?? 0,
        corner_radius: body.corner_radius ?? 0,
        opacity: body.opacity ?? 1,
        rotation: body.rotation ?? 0,
        sides: body.sides ?? 6,
      };
      payload = {
        type: 'shape', label,
        x: body.x, y: body.y, width: body.width, height: body.height,
        z_index: body.z_index ?? 0,
        ...props,
        original_properties: props,
      };
    } else {
      // icon
      const props = {
        icon_name: body.icon_name ?? 'mdi:star',
        icon_color: body.icon_color ?? '#D9A441',
        opacity: body.opacity ?? 1,
        rotation: body.rotation ?? 0,
      };
      payload = {
        type: 'icon', label,
        x: body.x, y: body.y, width: body.width, height: body.height,
        z_index: body.z_index ?? 0,
        ...props,
        original_properties: props,
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

  // Whole-style reset (text: current_style <- original_style;
  // image/shape/icon: their flat properties <- original_properties).
  app.post('/:id/regions/:regionId/reset-style', async (req, reply) => {
    const template = await getTemplate(req.params.id);
    const region = (template?.template_regions || []).find((r) => r.id === req.params.regionId);
    if (!region) return reply.code(404).send({ error: 'not_found' });

    const patch = region.type === 'text'
      ? { current_style: region.original_style }
      : { ...region.original_properties };

    const updated = await updateRegion(region.id, patch);
    reply.send(updated);
  });
}
