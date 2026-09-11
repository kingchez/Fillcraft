import { getTemplate } from '../services/templateStore.js';
import { renderTemplate } from '../render/canvasRenderer.js';
import { ensureFontsForTemplate } from '../services/fontRegistry.js';

export default async function autofillRoutes(app) {
  // POST /api/templates/:id/autofill
  // Body: { "<region_label>": "<text value or image url/data-uri>", ... }
  // Response: image/png, streamed directly back. Nothing is written to disk
  // at any point in this handler.
  app.post('/:id/autofill', { preHandler: app.requireApiKey }, async (req, reply) => {
    const template = await getTemplate(req.params.id);
    if (!template) return reply.code(404).send({ error: 'template_not_found' });

    try {
      await ensureFontsForTemplate(template);
      const buffer = await renderTemplate(template, req.body || {});
      reply.header('Content-Type', 'image/png');
      return reply.send(buffer);
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'render_failed', message: err.message });
    }
  });
}
