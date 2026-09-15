import { randomUUID } from 'crypto';
import { supabase } from '../db/supabase.js';
import { deleteAsset } from './storage.js';

function nowIso() { return new Date().toISOString(); }

function assertSupabase() {
  if (!supabase) throw new Error('Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing) — this rebuild has no local fallback.');
}

// ---------------- Categories ----------------

export async function listCategories() {
  assertSupabase();
  const { data, error } = await supabase.from('fillcraft_categories').select('*').order('name');
  if (error) throw error;
  return data;
}

export async function createCategory(name) {
  assertSupabase();
  const { data, error } = await supabase
    .from('fillcraft_categories')
    .insert({ id: randomUUID(), name, created_at: nowIso() })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteCategory(id) {
  assertSupabase();
  const { error } = await supabase.from('fillcraft_categories').delete().eq('id', id);
  if (error) throw error;
}

// ---------------- Custom fonts ----------------

export async function listCustomFonts() {
  assertSupabase();
  const { data, error } = await supabase.from('fillcraft_custom_fonts').select('*').order('family_name');
  if (error) throw error;
  return data;
}

export async function createCustomFont({ family_name, file_url }) {
  assertSupabase();
  const { data, error } = await supabase
    .from('fillcraft_custom_fonts')
    .insert({ id: randomUUID(), family_name, file_url, created_at: nowIso() })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ---------------- Designs ----------------

async function attachCategoriesAndFields(design) {
  const [{ data: catRows }, { data: fields }, { count: usageCount }] = await Promise.all([
    supabase.from('fillcraft_design_categories').select('category_id').eq('design_id', design.id),
    supabase.from('fillcraft_design_fields').select('*').eq('design_id', design.id).order('created_at'),
    supabase.from('fillcraft_usage_log').select('id', { count: 'exact', head: true }).eq('design_id', design.id),
  ]);
  return {
    ...design,
    category_ids: (catRows || []).map((r) => r.category_id),
    fields: fields || [],
    usage_count: usageCount || 0,
  };
}

export async function listDesigns() {
  assertSupabase();
  const { data, error } = await supabase.from('fillcraft_designs').select('*').order('updated_at', { ascending: false });
  if (error) throw error;
  return Promise.all(data.map(attachCategoriesAndFields));
}

export async function getDesign(id) {
  assertSupabase();
  const { data, error } = await supabase.from('fillcraft_designs').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return attachCategoriesAndFields(data);
}

export async function createDesign({ name, width, height, canvas_json, thumbnail_url, category_ids = [] }) {
  assertSupabase();
  const id = randomUUID();
  const { data, error } = await supabase
    .from('fillcraft_designs')
    .insert({
      id, name: name || 'Untitled Design', width, height,
      canvas_json: canvas_json || { version: '6.0.0', objects: [] },
      thumbnail_url: thumbnail_url || null,
      created_at: nowIso(), updated_at: nowIso(),
    })
    .select()
    .single();
  if (error) throw error;

  if (category_ids.length) {
    await supabase.from('fillcraft_design_categories').insert(category_ids.map((category_id) => ({ design_id: id, category_id })));
  }
  return attachCategoriesAndFields(data);
}

// Saving a design does two things atomically-ish: stores the raw canvas_json
// (the actual rendering/editing source of truth) AND re-syncs the
// fillcraft_design_fields index from whatever objects in it are tagged as
// autofill fields. The index is fully derived — never edited directly — so
// it can never drift out of sync with the canvas itself.
export async function updateDesign(id, patch) {
  assertSupabase();
  const fields = {};
  if (patch.name !== undefined) fields.name = patch.name;
  if (patch.width !== undefined) fields.width = patch.width;
  if (patch.height !== undefined) fields.height = patch.height;
  if (patch.thumbnail_url !== undefined) fields.thumbnail_url = patch.thumbnail_url;
  if (patch.canvas_json !== undefined) fields.canvas_json = patch.canvas_json;
  fields.updated_at = nowIso();

  const { data, error } = await supabase.from('fillcraft_designs').update(fields).eq('id', id).select().single();
  if (error) throw error;

  if (patch.canvas_json !== undefined) {
    await syncDesignFields(id, patch.canvas_json);
  }
  if (patch.category_ids !== undefined) {
    await supabase.from('fillcraft_design_categories').delete().eq('design_id', id);
    if (patch.category_ids.length) {
      await supabase.from('fillcraft_design_categories').insert(patch.category_ids.map((category_id) => ({ design_id: id, category_id })));
    }
  }
  return attachCategoriesAndFields(data);
}

export async function deleteDesign(id) {
  assertSupabase();
  const existing = await getDesign(id);
  const { error } = await supabase.from('fillcraft_designs').delete().eq('id', id);
  if (error) throw error;
  if (existing?.thumbnail_url) await deleteAsset(existing.thumbnail_url);
}

// Walks canvas_json.objects (one level — Fabric groups aren't recursed into
// for field purposes in this version) looking for objects with a
// `fillcraftField` property: { label, field_type: 'text'|'image', max_characters? }.
// Upserts a row per tagged object, keyed by (design_id, object's own `id`),
// and removes any field row whose object no longer exists in the canvas.
export async function syncDesignFields(designId, canvasJson) {
  const objects = Array.isArray(canvasJson?.objects) ? canvasJson.objects : [];
  const tagged = objects.filter((o) => o.fillcraftField && o.id);

  const { data: existingFields } = await supabase
    .from('fillcraft_design_fields')
    .select('id, object_id')
    .eq('design_id', designId);

  const stillPresentObjectIds = new Set(tagged.map((o) => o.id));
  const toDelete = (existingFields || []).filter((f) => !stillPresentObjectIds.has(f.object_id)).map((f) => f.id);
  if (toDelete.length) {
    await supabase.from('fillcraft_design_fields').delete().in('id', toDelete);
  }

  for (const obj of tagged) {
    const meta = obj.fillcraftField;
    const existing = (existingFields || []).find((f) => f.object_id === obj.id);
    const row = {
      design_id: designId,
      object_id: obj.id,
      label: meta.label || obj.id,
      field_type: meta.field_type === 'image' ? 'image' : 'text',
      max_characters: meta.max_characters ?? null,
      default_value: meta.field_type === 'image' ? (obj.src || null) : (obj.text || null),
    };
    if (existing) {
      await supabase.from('fillcraft_design_fields').update(row).eq('id', existing.id);
    } else {
      await supabase.from('fillcraft_design_fields').insert({ id: randomUUID(), created_at: nowIso(), ...row });
    }
  }
}

// ---------------- Usage log ----------------

export async function logDesignUsage(designId, source = 'autofill') {
  const { error } = await supabase.from('fillcraft_usage_log').insert({ id: randomUUID(), design_id: designId, used_at: nowIso(), source });
  if (error) console.error('[designsStore] logDesignUsage error:', error.message);
}
