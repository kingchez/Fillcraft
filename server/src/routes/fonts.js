import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { listCustomFonts, createCustomFont } from '../services/designsStore.js';
import { storeAsset } from '../services/storage.js';
import { registerFont } from '../render/imageUtils.js';
import { markFontRegistered } from '../services/fontRegistry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const googleFontsList = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../data/google-fonts.json'), 'utf-8')
);

export default async function fontsRoutes(app) {
  // Curated list of free Google Font family names for the picker UI.
  // Actual font files are fetched/cached on demand at render time
  // (see services/fontRegistry.js) — nothing to download up front.
  app.get('/google', async () => googleFontsList);

  app.get('/custom', async () => listCustomFonts());

  // Upload a custom font file (multipart: file field "font", field "family_name").
  app.post('/custom', async (req, reply) => {
    if (!req.isMultipart()) {
      return reply.code(400).send({ error: 'expected multipart/form-data with a "font" file' });
    }

    let fileBuffer = null;
    let filename = null;
    let mimetype = null;
    let familyName = null;

    for await (const part of req.parts()) {
      if (part.type === 'file') {
        fileBuffer = await part.toBuffer();
        filename = part.filename;
        mimetype = part.mimetype;
      } else if (part.fieldname === 'family_name') {
        familyName = part.value;
      }
    }

    if (!fileBuffer || !familyName) {
      return reply.code(400).send({ error: 'family_name and a font file are both required' });
    }

    const asset = await storeAsset(fileBuffer, filename, mimetype || 'font/ttf');
    const font = await createCustomFont({ family_name: familyName, file_url: asset.url });

    // Register immediately so it's usable without a restart.
    try {
      const dir = process.env.LOCAL_UPLOADS_DIR || path.join(process.cwd(), 'data', 'uploads');
      registerFont(path.join(dir, asset.local_path), familyName);
      markFontRegistered(familyName);
    } catch (err) {
      req.log.warn(`font registration failed for ${familyName}: ${err.message}`);
    }

    reply.code(201).send(font);
  });
}
