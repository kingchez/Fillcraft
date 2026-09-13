const BASE = '/api';
const API_KEY_STORAGE = 'fillcraft_api_key';

export function getStoredApiKey() {
  try { return localStorage.getItem(API_KEY_STORAGE) || ''; } catch { return ''; }
}
export function setStoredApiKey(key) {
  try {
    if (key) localStorage.setItem(API_KEY_STORAGE, key);
    else localStorage.removeItem(API_KEY_STORAGE);
  } catch { /* localStorage unavailable, ignore */ }
}
function authHeaders() {
  const key = getStoredApiKey();
  return key ? { 'x-api-key': key } : {};
}

async function handle(res) {
  if (!res.ok) {
    let body;
    try { body = await res.json(); } catch { body = { error: res.statusText }; }
    throw new Error(body.message || body.error || 'Request failed');
  }
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return res.json();
  return res;
}

export const api = {
  // Categories
  listCategories: () => fetch(`${BASE}/categories`).then(handle),
  createCategory: (name) =>
    fetch(`${BASE}/categories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).then(handle),
  deleteCategory: (id) => fetch(`${BASE}/categories/${id}`, { method: 'DELETE' }).then(handle),

  estimateTextCapacity: (params) =>
    fetch(`${BASE}/utils/estimate-text-capacity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    }).then(handle),

  // Canva
  canvaStatus: () => fetch(`${BASE}/canva/status`).then(handle),
  canvaDisconnect: () => fetch(`${BASE}/canva/disconnect`, { method: 'POST' }).then(handle),
  canvaListDesigns: (params = {}) => {
    // Strip undefined/null/empty values before building the query string —
    // URLSearchParams otherwise stringifies `undefined` itself as the text
    // "undefined", turning "no search term" into a literal search for the
    // word "undefined" and silently returning zero results.
    const clean = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
    );
    const qs = new URLSearchParams(clean).toString();
    return fetch(`${BASE}/canva/designs${qs ? `?${qs}` : ''}`).then(handle);
  },
  canvaImportDesign: (designId, opts = {}) =>
    fetch(`${BASE}/canva/import/${designId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    }).then(handle),

  // Templates
  listTemplates: () => fetch(`${BASE}/templates`).then(handle),
  getTemplate: (id) => fetch(`${BASE}/templates/${id}`).then(handle),
  createTemplate: (formData) =>
    fetch(`${BASE}/templates`, { method: 'POST', body: formData }).then(handle),
  updateTemplate: (id, patch) =>
    fetch(`${BASE}/templates/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then(handle),
  deleteTemplate: (id) => fetch(`${BASE}/templates/${id}`, { method: 'DELETE' }).then(handle),

  // Regions
  createRegion: (templateId, region) =>
    fetch(`${BASE}/templates/${templateId}/regions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(region),
    }).then(handle),
  updateRegion: (templateId, regionId, patch) =>
    fetch(`${BASE}/templates/${templateId}/regions/${regionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then(handle),
  deleteRegion: (templateId, regionId) =>
    fetch(`${BASE}/templates/${templateId}/regions/${regionId}`, { method: 'DELETE' }).then(handle),
  resetRegionStyle: (templateId, regionId) =>
    fetch(`${BASE}/templates/${templateId}/regions/${regionId}/reset-style`, { method: 'POST' }).then(handle),

  // Autofill preview
  autofillPreview: (templateId, values) =>
    fetch(`${BASE}/templates/${templateId}/autofill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(values),
    }).then((res) => {
      if (!res.ok) return handle(res);
      return res.blob();
    }),

  // Fonts
  listGoogleFonts: () => fetch(`${BASE}/fonts/google`).then(handle),
  listCustomFonts: () => fetch(`${BASE}/fonts/custom`).then(handle),
  uploadCustomFont: (formData) =>
    fetch(`${BASE}/fonts/custom`, { method: 'POST', body: formData }).then(handle),
};
