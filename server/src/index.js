import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';

import categoriesRoutes from './routes/categories.js';
import designsRoutes from './routes/designs.js';
import imagesRoutes from './routes/images.js';
import fontsRoutes from './routes/fonts.js';
import utilsRoutes from './routes/utils.js';
import canvaRoutes from './routes/canva.js';

import { registerAllCustomFonts } from './services/fontRegistry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = Fastify({
  logger: true,
  bodyLimit: 25 * 1024 * 1024, // 25MB, generous enough for template/font uploads
});

// Simple shared-secret auth for the endpoints n8n calls. If FILLCRAFT_API_KEY
// isn't set, these are left open — fine for local dev, NOT recommended once
// this is reachable from the public internet.
app.decorate('requireApiKey', async (req, reply) => {
  if (!process.env.FILLCRAFT_API_KEY) return;
  const provided = req.headers['x-api-key'];
  if (provided !== process.env.FILLCRAFT_API_KEY) {
    reply.code(401).send({ error: 'unauthorized', message: 'Missing or invalid x-api-key header.' });
  }
});

await app.register(cors, { origin: true });
await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } });

// Registering custom fonts touches Supabase at startup. If Supabase is slow
// or briefly unreachable, this must never block the server from listening —
// worst case, custom fonts fall back to a default font until the next
// render succeeds in fetching them. Bounded with a timeout and never fatal.
async function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

try {
  await withTimeout(registerAllCustomFonts(), 8000, 'registerAllCustomFonts');
} catch (err) {
  app.log.warn(`Custom font registration skipped at startup (will retry per-render as needed): ${err.message}`);
}

app.get('/api/health', async () => ({ ok: true, time: new Date().toISOString() }));

await app.register(categoriesRoutes, { prefix: '/api/categories' });
await app.register(designsRoutes, { prefix: '/api/designs' });
await app.register(imagesRoutes, { prefix: '/api/images' });
await app.register(fontsRoutes, { prefix: '/api/fonts' });
await app.register(utilsRoutes, { prefix: '/api/utils' });
await app.register(canvaRoutes, { prefix: '/api/canva' });

// Serve the built admin frontend (web/dist) for everything else. This one
// registers first so it owns the `reply.sendFile` decorator (only one
// registration is allowed to decorate it).
const webDist = path.join(__dirname, '../../web/dist');
await app.register(fastifyStatic, {
  root: webDist,
  prefix: '/',
  wildcard: false,
});

// There is no /uploads static mount anymore — every asset is a real
// Supabase Storage public URL now, so there's nothing local left to serve.

app.setNotFoundHandler((req, reply) => {
  if (req.raw.url?.startsWith('/api/')) {
    return reply.code(404).send({ error: 'not_found' });
  }
  return reply.sendFile('index.html', webDist);
});

const port = Number(process.env.PORT) || 3000;

app
  .listen({ port, host: '0.0.0.0' })
  .then(() => {
    app.log.info(`Fillcraft listening on port ${port}`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
