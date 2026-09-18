import { randomUUID } from 'crypto';
import { supabase as sb, supabaseAvailable as sbAvailable } from '../db/supabase.js';

const BUCKET = 'fillcraft-assets';

// Supabase Storage is the ONLY place assets are ever written. No local-disk
// fallback or mirror of any kind — if Supabase isn't configured or the
// upload fails, this throws instead of silently degrading to disk. That's
// intentional: a fallback that quietly writes to the VPS disk is exactly
// the kind of "second storage option" that caused permanent accumulation
// before, and the whole point of this pass is that nothing lives on disk.
export async function storeAsset(buffer, filename, contentType) {
  if (!sbAvailable()) {
    throw new Error('Supabase Storage is not configured — set SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY. There is no local-disk fallback.');
  }
  const safeName = (filename || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `${randomUUID()}-${safeName}`;

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
  if (!url || !url.includes('/')) return;
  const key = url.split('/').pop().split('?')[0];
  if (!key || !sbAvailable()) return;

  const { error } = await sb.storage.from(BUCKET).remove([key]);
  if (error) console.error('[storage] Supabase delete failed:', error.message);
}

// Lists everything in the bucket for the editor's "Uploads" panel — assets
// live in the bucket independent of any one design, same as Canva's own
// uploads library, so anything uploaded once can be reused later.
export async function listAssets({ limit = 200 } = {}) {
  if (!sbAvailable()) return [];
  const { data, error } = await sb.storage.from(BUCKET).list('', { limit, sortBy: { column: 'created_at', order: 'desc' } });
  if (error) { console.error('[storage] list failed:', error.message); return []; }
  return (data || [])
    .filter((f) => f.name && !f.name.endsWith('/'))
    .map((f) => {
      const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(f.name);
      return {
        key: f.name,
        url: pub.publicUrl,
        // Stored keys are "<uuid>-<original-filename>" — strip the uuid for display.
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
