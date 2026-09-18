import { randomUUID } from 'crypto';
import { supabase as sb, supabaseAvailable as sbAvailable } from '../db/supabase.js';

const BUCKET = 'fillcraft-assets';

// Supabase Storage is the ONLY place assets are ever written. No local-disk
// fallback or mirror of any kind — if Supabase isn't configured or the
// upload fails, this throws instead of silently degrading to disk. That's
// intentional: a fallback that quietly writes to the VPS disk is exactly
// the kind of "second storage option" that caused permanent accumulation
// before, and the whole point of this pass is that nothing lives on disk.
//
// `folder` separates what the "Uploads" panel shows (real user uploads)
// from what it never should (auto-generated design thumbnails, font
// files) — they used to all land in the same flat bucket root and get
// listed together, which is why old design thumbnails and font files
// were showing up mixed in with actual uploaded images.
export async function storeAsset(buffer, filename, contentType, folder = 'uploads') {
  if (!sbAvailable()) {
    throw new Error('Supabase Storage is not configured — set SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY. There is no local-disk fallback.');
  }
  const safeName = (filename || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `${folder}/${randomUUID()}-${safeName}`;

  const { error } = await sb.storage.from(BUCKET).upload(key, buffer, {
    contentType: contentType || 'application/octet-stream',
    upsert: true,
  });
  if (error) throw new Error(`Supabase upload failed: ${error.message}`);

  const { data } = sb.storage.from(BUCKET).getPublicUrl(key);
  return { url: data.publicUrl, local_path: key };
}

// Deletes an asset by its stored URL — Supabase Storage only.
export async function deleteAsset(url) {
  if (!url || !sbAvailable()) return;
  const key = keyFromUrl(url);
  if (!key) return;

  const { error } = await sb.storage.from(BUCKET).remove([key]);
  if (error) console.error('[storage] Supabase delete failed:', error.message);
}

// Public URLs look like ".../object/public/fillcraft-assets/uploads/<uuid>-name.png" —
// this recovers "uploads/<uuid>-name.png" (the folder-qualified key), not just the
// filename, since keys now live inside a folder and a bare filename isn't enough
// to address or delete the right object anymore.
function keyFromUrl(url) {
  const marker = `/${BUCKET}/`;
  const i = url.indexOf(marker);
  if (i === -1) return null;
  return decodeURIComponent(url.slice(i + marker.length).split('?')[0]);
}

// Lists real user-uploaded images for the editor's "Uploads" panel — scoped
// to the uploads/ folder only, so generated design thumbnails (thumbnails/)
// and font files (fonts/) never show up here. Assets live independent of
// any one design, same as Canva's own uploads library, so anything
// uploaded once can be reused later.
export async function listAssets({ limit = 200, folder = 'uploads' } = {}) {
  if (!sbAvailable()) return [];
  const { data, error } = await sb.storage.from(BUCKET).list(folder, { limit, sortBy: { column: 'created_at', order: 'desc' } });
  if (error) { console.error('[storage] list failed:', error.message); return []; }
  return (data || [])
    .filter((f) => f.name && !f.name.endsWith('/'))
    .map((f) => {
      const key = `${folder}/${f.name}`;
      const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(key);
      return {
        key,
        url: pub.publicUrl,
        // Stored names are "<uuid>-<original-filename>" — strip the uuid for display.
        name: f.name.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/, ''),
        created_at: f.created_at,
        size: f.metadata?.size,
      };
    });
}

export async function deleteAssetByKey(key) {
  if (!key || !sbAvailable()) return;
  const { error } = await sb.storage.from(BUCKET).remove([key]);
  if (error) console.error('[storage] delete by key failed:', error.message);
}

// Every stored asset is now a real Supabase public URL, so there is no
// "/uploads/<key>" local scheme left to resolve — sources pass through
// unchanged (the renderer fetches http(s) URLs directly).
export function resolveAssetSource(source) {
  return source;
}
