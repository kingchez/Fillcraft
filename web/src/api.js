const BASE = '/api';

function authHeaders() {
  const key = localStorage.getItem('fillcraft_api_key');
  return key ? { 'x-api-key': key } : {};
}

async function handle(res) {
  if (!res.ok) {
    let body;
    try { body = await res.json(); } catch { body = { error: res.statusText }; }
    throw new Error(body.message || body.error || `Request failed (${res.status})`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  // Designs
  listDesigns: () => fetch(`${BASE}/designs`).then(handle),
  getDesign: (id) => fetch(`${BASE}/designs/${id}`).then(handle),
  createBlankDesign: (body) =>
    fetch(`${BASE}/designs/blank`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(handle),
  updateDesign: (id, patch) =>
    fetch(`${BASE}/designs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then(handle),
  deleteDesign: (id) => fetch(`${BASE}/designs/${id}`, { method: 'DELETE' }).then(handle),
  regenerateThumbnail: (id) => fetch(`${BASE}/designs/${id}/thumbnail`, { method: 'POST' }).then(handle),

  // Autofill / preview — same payload shape ({ label: value, ... }), preview never logs usage
  autofillPreview: (id, values) =>
    fetch(`${BASE}/designs/${id}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(values),
    }).then((res) => {
      if (!res.ok) return handle(res);
      return res.blob();
    }),
  autofillRun: (id, values) =>
    fetch(`${BASE}/designs/${id}/autofill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(values),
    }).then((res) => {
      if (!res.ok) return handle(res);
      return res.blob();
    }),

  // Canva import (OAuth-based — see server for why URL-scraping isn't used)
  canvaStatus: () => fetch(`${BASE}/canva/status`).then(handle),
  canvaDisconnect: () => fetch(`${BASE}/canva/disconnect`, { method: 'POST' }).then(handle),
  canvaListDesigns: (query) => fetch(`${BASE}/canva/designs${query ? `?query=${encodeURIComponent(query)}` : ''}`).then(handle),
  canvaImportDesign: (designId, name) =>
    fetch(`${BASE}/canva/import/${designId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).then(handle),

  // Categories
  listCategories: () => fetch(`${BASE}/categories`).then(handle),
  createCategory: (name) =>
    fetch(`${BASE}/categories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).then(handle),
  deleteCategory: (id) => fetch(`${BASE}/categories/${id}`, { method: 'DELETE' }).then(handle),

  // Fonts
  listGoogleFonts: () => fetch(`${BASE}/fonts/google`).then(handle),
  listCustomFonts: () => fetch(`${BASE}/fonts/custom`).then(handle),
  uploadCustomFont: (file, familyName) => {
    const fd = new FormData();
    fd.append('font', file);
    fd.append('family_name', familyName);
    return fetch(`${BASE}/fonts/custom`, { method: 'POST', body: fd }).then(handle);
  },

  // Utils
  estimateTextCapacity: (params) =>
    fetch(`${BASE}/utils/estimate-text-capacity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    }).then(handle),

  // Uploads panel — bucket assets, reusable across designs
  listAssets: () => fetch(`${BASE}/designs/assets`).then(handle),
  deleteAsset: (key) => fetch(`${BASE}/designs/assets/${encodeURIComponent(key)}`, { method: 'DELETE' }).then(handle),

  // Image upload (used when adding an image object to the canvas)
  uploadImage: (file) => {
    const fd = new FormData();
    fd.append('image', file);
    return fetch(`${BASE}/designs/upload-image`, { method: 'POST', body: fd }).then(handle);
  },

  // API key (stored client-side, sent as x-api-key on autofill/preview calls)
  getApiKey: () => localStorage.getItem('fillcraft_api_key') || '',
  setApiKey: (key) => localStorage.setItem('fillcraft_api_key', key || ''),
};
