import { listCategories, createCategory } from '../services/templateStore.js';

export default async function categoriesRoutes(app) {
  app.get('/', async () => listCategories());

  app.post('/', async (req, reply) => {
    const { name } = req.body || {};
    if (!name || !name.trim()) {
      return reply.code(400).send({ error: 'name is required' });
    }
    const category = await createCategory(name.trim());
    reply.code(201).send(category);
  });
}
