import { Resvg } from '@resvg/resvg-js';

// Simple in-memory cache so repeated renders of the same icon/color/size
// don't refetch from Iconify every time.
const svgCache = new Map();

function parseIconRef(iconRef) {
  const sep = iconRef.includes(':') ? ':' : '/';
  const [prefix, name] = iconRef.split(sep);
  return { prefix, name };
}

// Fetches an icon as a standalone SVG string from Iconify's free public API
// (https://iconify.design — 200k+ open-source icons, no API key required).
async function fetchIconSvg(iconRef, { color, size = 512 } = {}) {
  const { prefix, name } = parseIconRef(iconRef);
  if (!prefix || !name) throw new Error(`Invalid icon reference "${iconRef}" — expected "prefix:name", e.g. "mdi:heart"`);

  const cacheKey = `${prefix}:${name}:${color || ''}:${size}`;
  if (svgCache.has(cacheKey)) return svgCache.get(cacheKey);

  const params = new URLSearchParams({ height: String(Math.round(size)) });
  if (color) params.set('color', color);
  const url = `https://api.iconify.design/${prefix}/${name}.svg?${params.toString()}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Icon "${iconRef}" not found on Iconify (HTTP ${res.status})`);
  const svgText = await res.text();
  svgCache.set(cacheKey, svgText);
  return svgText;
}

// Rasterizes an SVG string to a PNG buffer at the requested pixel width,
// so it can be composited with the rest of the canvas via loadImage().
function rasterizeSvg(svgText, widthPx) {
  const resvg = new Resvg(svgText, { fitTo: { mode: 'width', value: Math.max(1, Math.round(widthPx)) } });
  const rendered = resvg.render();
  return rendered.asPng();
}

// Fetch + rasterize in one call — what the renderer actually needs.
export async function getIconPng(iconRef, { color, sizePx = 512 } = {}) {
  const svgText = await fetchIconSvg(iconRef, { color, size: sizePx });
  return rasterizeSvg(svgText, sizePx);
}
