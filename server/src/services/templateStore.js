import { randomUUID } from 'crypto';
import { supabase, supabaseAvailable } from '../db/supabase.js';
import { localDb } from '../db/sqlite.js';

function nowIso() {
  return new Date().toISOString();
}

// ---------------- Categories ----------------

export async function listCategories() {
  if (supabaseAvailable()) {
    const { data, error } = await supabase.from('categories').select('*').order('name');
    if (!error) return data;
    console.error('[templateStore] listCategories supabase error, falling back:', error.message);
  }
  return localDb.prepare('SELECT * FROM categories ORDER BY name').all();
}

export async function createCategory(name) {
  const id = randomUUID();
  const created_at = nowIso();
  if (supabaseAvailable()) {
    const { error } = await supabase.from('categories').insert({ id, name, created_at });
    if (error) console.error('[templateStore] createCategory supabase error:', error.message);
  }
  localDb.prepare('INSERT INTO categories (id, name, created_at) VALUES (?, ?, ?)').run(id, name, created_at);
  return { id, name, created_at };
}

// ---------------- Templates ----------------

function localTemplateWithRegions(id) {
  const t = localDb.prepare('SELECT * FROM templates WHERE id = ?').get(id);
  if (!t) return null;
  const regions = localDb
    .prepare('SELECT * FROM template_regions WHERE template_id = ? ORDER BY z_index ASC')
    .all(id)
    .map(deserializeRegion);
  return { ...t, template_regions: regions };
}

export async function listTemplates() {
  if (supabaseAvailable()) {
    const { data, error } = await supabase
      .from('templates')
      .select('*, template_regions(*)')
      .order('created_at', { ascending: false });
    if (!error) return data;
    console.error('[templateStore] listTemplates supabase error, falling back:', error.message);
  }
  const templates = localDb.prepare('SELECT * FROM templates ORDER BY created_at DESC').all();
  return templates.map((t) => localTemplateWithRegions(t.id));
}

export async function getTemplate(id) {
  if (supabaseAvailable()) {
    const { data, error } = await supabase
      .from('templates')
      .select('*, template_regions(*)')
      .eq('id', id)
      .maybeSingle();
    if (!error) return data;
    console.error('[templateStore] getTemplate supabase error, falling back:', error.message);
  }
  return localTemplateWithRegions(id);
}

export async function createTemplate({ name, category_id, canva_design_id, source_image_url, thumbnail_url, width, height }) {
  const id = randomUUID();
  const created_at = nowIso();
  const row = {
    id,
    name,
    category_id: category_id || null,
    canva_design_id: canva_design_id || null,
    source_image_url,
    thumbnail_url: thumbnail_url || source_image_url,
    width,
    height,
    created_at,
    updated_at: created_at,
  };

  if (supabaseAvailable()) {
    const { error } = await supabase.from('templates').insert(row);
    if (error) console.error('[templateStore] createTemplate supabase error:', error.message);
  }

  localDb
    .prepare(
      `INSERT INTO templates (id, name, category_id, canva_design_id, source_image_url, thumbnail_url, width, height, created_at, updated_at)
       VALUES (@id, @name, @category_id, @canva_design_id, @source_image_url, @thumbnail_url, @width, @height, @created_at, @updated_at)`
    )
    .run(row);

  return { ...row, template_regions: [] };
}

export async function updateTemplate(id, patch) {
  const updated_at = nowIso();
  const fields = { ...patch, updated_at };

  if (supabaseAvailable()) {
    const { error } = await supabase.from('templates').update(fields).eq('id', id);
    if (error) console.error('[templateStore] updateTemplate supabase error:', error.message);
  }

  const existing = localDb.prepare('SELECT * FROM templates WHERE id = ?').get(id) || { id };
  const merged = { ...existing, ...fields, id };
  localDb
    .prepare(
      `INSERT OR REPLACE INTO templates (id, name, category_id, canva_design_id, source_image_url, thumbnail_url, width, height, created_at, updated_at)
       VALUES (@id, @name, @category_id, @canva_design_id, @source_image_url, @thumbnail_url, @width, @height, @created_at, @updated_at)`
    )
    .run(merged);

  return merged;
}

export async function deleteTemplate(id) {
  if (supabaseAvailable()) {
    await supabase.from('template_regions').delete().eq('template_id', id);
    await supabase.from('templates').delete().eq('id', id);
  }
  localDb.prepare('DELETE FROM template_regions WHERE template_id = ?').run(id);
  localDb.prepare('DELETE FROM templates WHERE id = ?').run(id);
}

// ---------------- Regions ----------------

function serializeRegion(r) {
  return {
    ...r,
    original_style: r.original_style ? JSON.stringify(r.original_style) : null,
    current_style: r.current_style ? JSON.stringify(r.current_style) : null,
    auto_shrink_to_fit: r.auto_shrink_to_fit ? 1 : 0,
  };
}

function deserializeRegion(r) {
  return {
    ...r,
    original_style: r.original_style ? safeParse(r.original_style) : null,
    current_style: r.current_style ? safeParse(r.current_style) : null,
    auto_shrink_to_fit: !!r.auto_shrink_to_fit,
  };
}

function safeParse(v) {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

export async function nextRegionLabel(template_id, type) {
  const existing = await getTemplate(template_id);
  const count = (existing?.template_regions || []).filter((r) => r.type === type).length;
  const prefix = type === 'image' ? 'image' : 'sentence';
  return `${prefix}_${count + 1}`;
}

const REGION_DEFAULTS = {
  z_index: 0,
  max_characters: null,
  original_style: null,
  current_style: null,
  auto_shrink_to_fit: true,
  fit_mode: 'cover',
  corner_radius: 0,
  opacity: 1,
  rotation: 0,
  border_width: 0,
  border_color: null,
  filter: null,
};

export async function createRegion(template_id, region) {
  const id = randomUUID();
  const created_at = nowIso();
  const row = { ...REGION_DEFAULTS, ...region, id, template_id, created_at, updated_at: created_at };

  if (supabaseAvailable()) {
    const { error } = await supabase.from('template_regions').insert(row);
    if (error) console.error('[templateStore] createRegion supabase error:', error.message);
  }

  const local = serializeRegion(row);
  localDb
    .prepare(
      `INSERT INTO template_regions
        (id, template_id, type, label, x, y, width, height, z_index, max_characters, original_style, current_style, auto_shrink_to_fit, fit_mode, corner_radius, opacity, rotation, border_width, border_color, filter, created_at, updated_at)
       VALUES
        (@id, @template_id, @type, @label, @x, @y, @width, @height, @z_index, @max_characters, @original_style, @current_style, @auto_shrink_to_fit, @fit_mode, @corner_radius, @opacity, @rotation, @border_width, @border_color, @filter, @created_at, @updated_at)`
    )
    .run(local);

  return row;
}

export async function updateRegion(id, patch) {
  const updated_at = nowIso();

  if (supabaseAvailable()) {
    const { error } = await supabase.from('template_regions').update({ ...patch, updated_at }).eq('id', id);
    if (error) console.error('[templateStore] updateRegion supabase error:', error.message);
  }

  const existingRaw = localDb.prepare('SELECT * FROM template_regions WHERE id = ?').get(id);
  const existing = existingRaw ? deserializeRegion(existingRaw) : { id };
  const merged = { ...existing, ...patch, id, updated_at };
  const local = serializeRegion(merged);

  localDb
    .prepare(
      `INSERT OR REPLACE INTO template_regions
        (id, template_id, type, label, x, y, width, height, z_index, max_characters, original_style, current_style, auto_shrink_to_fit, fit_mode, corner_radius, opacity, rotation, border_width, border_color, filter, created_at, updated_at)
       VALUES
        (@id, @template_id, @type, @label, @x, @y, @width, @height, @z_index, @max_characters, @original_style, @current_style, @auto_shrink_to_fit, @fit_mode, @corner_radius, @opacity, @rotation, @border_width, @border_color, @filter, @created_at, @updated_at)`
    )
    .run(local);

  return merged;
}

export async function deleteRegion(id) {
  if (supabaseAvailable()) {
    await supabase.from('template_regions').delete().eq('id', id);
  }
  localDb.prepare('DELETE FROM template_regions WHERE id = ?').run(id);
}

// ---------------- Custom fonts ----------------

export async function listCustomFonts() {
  if (supabaseAvailable()) {
    const { data, error } = await supabase.from('custom_fonts').select('*').order('family_name');
    if (!error) return data;
    console.error('[templateStore] listCustomFonts supabase error, falling back:', error.message);
  }
  return localDb.prepare('SELECT * FROM custom_fonts ORDER BY family_name').all();
}

export async function createCustomFont({ family_name, file_url }) {
  const id = randomUUID();
  const created_at = nowIso();
  if (supabaseAvailable()) {
    const { error } = await supabase.from('custom_fonts').insert({ id, family_name, file_url, created_at });
    if (error) console.error('[templateStore] createCustomFont supabase error:', error.message);
  }
  localDb
    .prepare('INSERT INTO custom_fonts (id, family_name, file_url, created_at) VALUES (?, ?, ?, ?)')
    .run(id, family_name, file_url, created_at);
  return { id, family_name, file_url, created_at };
}
