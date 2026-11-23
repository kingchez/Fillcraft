import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import imagesRoutes from './routes/images.js';

const app = Fastify({
  logger: true,
  bodyLimit: 10 * 1024 * 1024,
});

app.decorate('requireApiKey', async (req, reply) => {
  if (!process.env.FILLCRAFT_API_KEY) return;
  const provided = req.headers['x-api-key'];
  if (provided !== process.env.FILLCRAFT_API_KEY) {
    reply.code(401).send({ error: 'unauthorized', message: 'Missing or invalid x-api-key header.' });
  }
});

await app.register(cors, { origin: true });

app.get('/api/health', async () => ({ ok: true, service: 'fillcraft-image-normalizer', time: new Date().toISOString() }));

await app.register(imagesRoutes, { prefix: '/api/images' });

app.setNotFoundHandler((req, reply) => {
  return reply.code(404).send({ error: 'not_found' });
});

const port = Number(process.env.PORT) || 3000;

app
  .listen({ port, host: '0.0.0.0' })
  .then(() => {
    app.log.info(`Fillcraft Image Normalizer listening on port ${port}`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
