// Detects a trailing `-{width}x{height}` pattern immediately before the file
// extension (WordPress's resized-media naming convention) and strips it,
// e.g. "photo-600x422.jpg" -> "photo.jpg".
export function stripSizeSuffix(url) {
  return url.replace(/-\d+x\d+(?=\.[^.]+$)/, '');
}

// Tries the stripped (likely full-resolution) URL first, and falls back to
// the original URL exactly as given if the stripped guess 404s or errors —
// the suffix pattern isn't guaranteed to be WordPress's, and the original
// upload may no longer exist.
export async function resolveImageUrl(url, stripSuffix = true) {
  const candidates = [];
  if (stripSuffix) {
    const stripped = stripSizeSuffix(url);
    if (stripped !== url) candidates.push(stripped);
  }
  candidates.push(url);

  let lastErr;
  for (const candidate of candidates) {
    try {
      const res = await fetch(candidate);
      if (res.ok) {
        const arrayBuffer = await res.arrayBuffer();
        return Buffer.from(arrayBuffer);
      }
      lastErr = new Error(`HTTP ${res.status} fetching ${candidate}`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Failed to fetch image from any candidate URL');
}
