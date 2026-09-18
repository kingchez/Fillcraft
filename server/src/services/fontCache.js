import path from 'path';
import os from 'os';
import fs from 'fs';

// This is NOT persistent storage and holds no user data — it's a
// process-lifetime scratch cache for font files that the server-side
// canvas renderer (@napi-rs/canvas) needs as real files on disk to
// register a font, which the library doesn't support doing from an
// in-memory buffer. It lives under the OS temp dir specifically so it
// never touches the app's persistent volume and never survives a restart
// or redeploy — every asset a user actually owns (uploads, backgrounds,
// custom font files) lives only in Supabase Storage; see storage.js.
export function getFontCacheDir() {
  const dir = path.join(os.tmpdir(), 'fillcraft-font-cache');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}
