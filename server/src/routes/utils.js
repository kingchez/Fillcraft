import { estimateTextCapacity } from '../render/canvasRenderer.js';
import { ensureGoogleFontRegistered } from '../services/fontRegistry.js';

export default async function utilsRoutes(app) {
  // POST /api/utils/estimate-text-capacity
  // Body: { width, height, font_family, font_size, font_weight, italic, line_height }
  // Returns an ESTIMATE of how many characters fit in a box at that font/size —
  // useful for suggesting a sensible max_characters value while annotating a
  // region, before any real content exists yet.
  app.post('/estimate-text-capacity', async (req, reply) => {
    const { width, height, font_family, font_size, font_weight, italic, line_height } = req.body || {};
    if (!width || !height) {
      return reply.code(400).send({ error: 'width and height are required' });
    }
    if (font_family) await ensureGoogleFontRegistered(font_family);
    const result = estimateTextCapacity({ width, height, font_family, font_size, font_weight, italic, line_height });
    reply.send(result);
  });
}
