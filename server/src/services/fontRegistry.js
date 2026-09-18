import fs from 'fs';
import path from 'path';
import { getFontCacheDir } from './fontCache.js';
import { registerFont } from '../render/imageUtils.js';
import { listCustomFonts } from './designsStore.js';

const registered = new Set();

export function markFontRegistered(family) {
  registered.add(family);
}

// Fetches a Google Font's woff2/ttf files via the public CSS2 endpoint and
// registers it with the canvas engine, caching the file locally so repeat
// renders don't re-fetch. Safe to call repeatedly — a family is only
// attempted once per process lifetime (failures aren't retried every render).
const GENERIC_FONT_KEYWORDS = new Set(['sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'system-ui']);

export async function ensureGoogleFontRegistered(family) {
  if (!family || registered.has(family) || GENERIC_FONT_KEYWORDS.has(family.toLowerCase())) return;
  registered.add(family);

  try {
    const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@400;700&display=swap`;
    const cssRes = await fetch(cssUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Fillcraft/1.0)' },
    });
    if (!cssRes.ok) {
      console.warn(`[fontRegistry] Google Fonts CSS fetch failed for "${family}" (${cssRes.status})`);
      return;
    }
    const css = await cssRes.text();
    const urls = [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com[^)]+)\)/g)].map((m) => m[1]);
    if (!urls.length) return;

    const dir = getFontCacheDir();
    for (let i = 0; i < urls.length; i++) {
      const fontRes = await fetch(urls[i]);
      if (!fontRes.ok) continue;
      const buffer = Buffer.from(await fontRes.arrayBuffer());
      const filePath = path.join(dir, `googlefont_${family.replace(/\s+/g, '_')}_${i}.ttf`);
      fs.writeFileSync(filePath, buffer);
      registerFont(filePath, family);
    }
  } catch (err) {
    console.error(`[fontRegistry] failed to register Google Font "${family}":`, err.message);
  }
}

// Scans a design's text objects for font families in use and makes sure
// each is registered before rendering (covers Google Fonts on demand;
// custom fonts are already registered at startup / at upload time).
export async function ensureFontsForDesign(design) {
  const families = new Set();
  for (const obj of design.canvas_json?.objects || []) {
    if ((obj.type === 'textbox' || obj.type === 'text' || obj.type === 'i-text') && obj.fontFamily) {
      families.add(obj.fontFamily);
    }
  }
  await Promise.all([...families].map(ensureGoogleFontRegistered));
}

// Re-registers previously-uploaded custom fonts with the canvas engine on
// process startup (the in-memory font registry doesn't survive a restart).
// Custom font files live only in Supabase now, so this fetches each one
// fresh into the ephemeral tmp cache rather than assuming a local mirror.
export async function registerAllCustomFonts() {
  const fonts = await listCustomFonts();
  const dir = getFontCacheDir();
  for (const font of fonts) {
    try {
      const key = font.file_url.split('/').pop().split('?')[0];
      const cachePath = path.join(dir, key);
      const res = await fetch(font.file_url);
      if (!res.ok) throw new Error(`fetch failed (${res.status})`);
      fs.writeFileSync(cachePath, Buffer.from(await res.arrayBuffer()));
      registerFont(cachePath, font.family_name);
      markFontRegistered(font.family_name);
    } catch (err) {
      console.error(`[fontRegistry] failed to register custom font "${font.family_name}":`, err.message);
    }
  }
}
