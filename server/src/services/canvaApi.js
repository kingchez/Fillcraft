import { getValidAccessToken } from './canvaAuth.js';

const BASE = 'https://api.canva.com/rest/v1';

async function canvaFetch(path, options = {}) {
  const token = await getValidAccessToken();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Canva API error (${res.status}) on ${path}: ${JSON.stringify(data)}`);
  }
  return data;
}

export async function listDesigns({ continuation, query } = {}) {
  const params = new URLSearchParams();
  if (continuation) params.set('continuation', continuation);
  if (query) params.set('query', query);
  // "relevance" (Canva's default) only makes sense with a search term. With
  // no query, sort by most-recently-modified so browsing without searching
  // still shows something sensible instead of an arbitrary/sparse-looking order.
  params.set('sort_by', query ? 'relevance' : 'modified_descending');
  const qs = params.toString();
  const data = await canvaFetch(`/designs?${qs}`);
  return {
    items: (data.items || []).map((d) => ({
      id: d.id,
      title: d.title || 'Untitled design',
      thumbnail_url: d.thumbnail?.url || null,
      updated_at: d.updated_at,
    })),
    continuation: data.continuation || null,
  };
}

export async function getDesign(designId) {
  const data = await canvaFetch(`/designs/${designId}`);
  return data.design;
}

// as_single_image flattens a multi-page Canva design into one PNG, matching
// Fillcraft's template model (one base image + regions drawn on top of it).
export async function createExportJob(designId) {
  const data = await canvaFetch('/exports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      design_id: designId,
      format: { type: 'png', as_single_image: true, lossless: true },
    }),
  });
  return data.job;
}

export async function getExportJob(jobId) {
  const data = await canvaFetch(`/exports/${jobId}`);
  return data.job;
}

// Polls until the export job succeeds or fails, or the attempt budget runs out.
export async function waitForExport(jobId, { intervalMs = 1500, maxAttempts = 20 } = {}) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const job = await getExportJob(jobId);
    if (job.status === 'success') return job;
    if (job.status === 'failed') throw new Error(`Canva export job failed: ${JSON.stringify(job)}`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Canva export job timed out waiting for completion');
}
