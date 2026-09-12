import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { supabase as sb, supabaseAvailable as sbAvailable } from '../db/supabase.js';
import { getLocalUploadsDir } from '../db/sqlite.js';

const BUCKET = 'fillcraft-assets';

// Stores an asset (template image or font file) in Supabase Storage (if configured)
// AND mirrors it to local disk, so template assets survive a Supabase outage the
// same way template metadata does.
export async function storeAsset(buffer, filename, contentType) {
  const safeName = (filename || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `${randomUUID()}-${safeName}`;
  const localDir = getLocalUploadsDir();
  const localPath = path.join(localDir, key);

  // Always write local mirror first — cheap, and guarantees we have a copy
  // even if the Supabase upload fails partway through.
  fs.writeFileSync(localPath, buffer);

  if (sbAvailable()) {
    try {
      const { error } = await sb.storage.from(BUCKET).upload(key, buffer, {
        contentType: contentType || 'application/octet-stream',
        upsert: true,
      });
      if (!error) {
        const { data } = sb.storage.from(BUCKET).getPublicUrl(key);
        return { url: data.publicUrl, local_path: key, local_url: `/uploads/${key}` };
      }
      console.error('[storage] Supabase upload failed, using local URL:', error.message);
    } catch (err) {
      console.error('[storage] Supabase upload threw, using local URL:', err.message);
    }
  }

  return { url: `/uploads/${key}`, local_path: key, local_url: `/uploads/${key}` };
}

// Deletes an asset by its stored URL — from Supabase Storage (if configured)
// and from the local disk mirror. Used when a template (or anything
// referencing a stored file) is deleted, so files don't accumulate as
// orphans once their owning record is gone.
export async function deleteAsset(url) {
  if (!url || !url.includes('/')) return;
  const key = url.split('/').pop().split('?')[0];
  if (!key) return;

  if (sbAvailable()) {
    try {
      const { error } = await sb.storage.from(BUCKET).remove([key]);
      if (error) console.error('[storage] Supabase delete failed:', error.message);
    } catch (err) {
      console.error('[storage] Supabase delete threw:', err.message);
    }
  }

  try {
    const localPath = path.join(getLocalUploadsDir(), key);
    if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
  } catch (err) {
    console.error('[storage] local delete failed:', err.message);
  }
}

// Converts a "/uploads/<key>" web path (our own local-mirror URL scheme)
// back into a real filesystem path so the canvas renderer can load it
// directly. Absolute http(s) URLs and data URIs pass through unchanged.
export function resolveAssetSource(source) {
  if (!source) return source;
  if (source.startsWith('/uploads/')) {
    const key = source.slice('/uploads/'.length);
    return path.join(getLocalUploadsDir(), key);
  }
  return source;
}
