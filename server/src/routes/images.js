import { resolveImageUrl } from '../services/imageFetch.js';
import { normalizeProductImage } from '../render/imageUtils.js';

export default async function imagesRoutes(app) {
  // POST /api/images/normalize
  // Body: { image_url, canvas_size?, background_color?, max_content_ratio?, strip_size_suffix? }
  // Response: image/png, streamed directly back. Nothing is written to disk.
  app.post('/normalize', { preHandler: app.requireApiKey }, async (req, reply) => {
    const {
      image_url,
      canvas_size = 1200,
      background_color = '#FFFFFF',
      max_content_ratio = 0.83,
      strip_size_suffix = true,
    } = req.body || {};

    if (!image_url) {
      return reply.code(400).send({ error: 'image_url is required' });
    }

    try {
      const sourceBuffer = await resolveImageUrl(image_url, strip_size_suffix);
      const output = await normalizeProductImage(sourceBuffer, {
        canvasSize: canvas_size,
        backgroundColor: background_color,
        maxContentRatio: max_content_ratio,
      });
      reply.header('Content-Type', 'image/png');
      return reply.send(output);
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'normalize_failed', message: err.message });
    }
  });
}
