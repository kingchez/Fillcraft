import { getTemplate, logTemplateUsage } from '../services/templateStore.js';
import { renderTemplate } from '../render/canvasRenderer.js';
import { ensureFontsForTemplate } from '../services/fontRegistry.js';

export default async function autofillRoutes(app) {
  // POST /api/templates/:id/autofill
  // Body: { "<region_label>": "<text value or image url/data-uri>", ... }
  // Response: image/png, streamed directly back. Nothing is written to disk
  // at any point in this handler.
  //
  // This is the production endpoint — the one real integrations (n8n, etc.)
  // call. Usage is logged here, and only here.
  app.post('/:id/autofill', { preHandler: app.requireApiKey }, async (req, reply) => {
    const template = await getTemplate(req.params.id);
    if (!template) return reply.code(404).send({ error: 'template_not_found' });

    try {
      await ensureFontsForTemplate(template);
      const buffer = await renderTemplate(template, req.body || {});
      // Logged only on a successful render, so usage stats reflect real
      // output, not failed attempts.
      logTemplateUsage(template.id, 'autofill').catch((err) => req.log.warn(`usage log failed: ${err.message}`));
      reply.header('Content-Type', 'image/png');
      return reply.send(buffer);
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'render_failed', message: err.message });
    }
  });

  // POST /api/templates/:id/preview
  // Identical rendering behavior to /autofill, used by the editor's live
  // WYSIWYG canvas and its "Render preview" button. Deliberately does NOT
  // log usage — opening or editing a template in the editor isn't a real
  // autofill, and shouldn't inflate the usage count shown on the templates
  // list.
  app.post('/:id/preview', { preHandler: app.requireApiKey }, async (req, reply) => {
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
