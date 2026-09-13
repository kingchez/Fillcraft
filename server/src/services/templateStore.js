import { randomUUID } from 'crypto';
import { supabase, supabaseAvailable } from '../db/supabase.js';
import { localDb } from '../db/sqlite.js';
import { deleteAsset } from './storage.js';

function nowIso() {
  return new Date().toISOString();
}

// ---------------- Categories ----------------

export async function listCategories() {
  if (supabaseAvailable()) {
    const { data, error } = await supabase.from('fillcraft_categories').select('*').order('name');
    if (!error) return data;
    console.error('[templateStore] listCategories supabase error, falling back:', error.message);
  }
  return localDb.prepare('SELECT * FROM fillcraft_categories ORDER BY name').all();
}

export async function createCategory(name) {
  const id = randomUUID();
  const created_at = nowIso();
  if (supabaseAvailable()) {
    const { error } = await supabase.from('fillcraft_categories').insert({ id, name, created_at });
    if (error) console.error('[templateStore] createCategory supabase error:', error.message);
  }
  localDb.prepare('INSERT INTO fillcraft_categories (id, name, created_at) VALUES (?, ?, ?)').run(id, name, created_at);
  return { id, name, created_at };
}

export async function deleteCategory(id) {
  if (supabaseAvailable()) {
    const { error } = await supabase.from('fillcraft_categories').delete().eq('id', id);
    if (error) console.error('[templateStore] deleteCategory supabase error:', error.message);
  }
  localDb.prepare('DELETE FROM fillcraft_template_categories WHERE category_id = ?').run(id);
  localDb.prepare('DELETE FROM fillcraft_categories WHERE id = ?').run(id);
}

// ---------------- Template <-> Category (many-to-many) ----------------

export async function getTemplateCategoryIds(templateId) {
  if (supabaseAvailable()) {
    const { data, error } = await supabase.from('fillcraft_template_categories').select('category_id').eq('template_id', templateId);
    if (!error) return data.map((r) => r.category_id);
    console.error('[templateStore] getTemplateCategoryIds supabase error, falling back:', error.message);
  }
  return localDb
    .prepare('SELECT category_id FROM fillcraft_template_categories WHERE template_id = ?')
    .all(templateId)
    .map((r) => r.category_id);
}

export async function setTemplateCategories(templateId, categoryIds = []) {
  if (supabaseAvailable()) {
    await supabase.from('fillcraft_template_categories').delete().eq('template_id', templateId);
    if (categoryIds.length) {
      const rows = categoryIds.map((category_id) => ({ template_id: templateId, category_id }));
      const { error } = await supabase.from('fillcraft_template_categories').insert(rows);
      if (error) console.error('[templateStore] setTemplateCategories supabase error:', error.message);
    }
  }
  localDb.prepare('DELETE FROM fillcraft_template_categories WHERE template_id = ?').run(templateId);
  const insert = localDb.prepare('INSERT INTO fillcraft_template_categories (template_id, category_id) VALUES (?, ?)');
  for (const categoryId of categoryIds) insert.run(templateId, categoryId);
  return categoryIds;
}

// ---------------- Templates ----------------

function deserializeRegion(r) {
  return {
    ...r,
    original_style: r.original_style ? safeParse(r.original_style) : null,
    current_style: r.current_style ? safeParse(r.current_style) : null,
    original_properties: r.original_properties ? safeParse(r.original_properties) : null,
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

async function attachExtras(template) {
  if (!template) return null;
  const [categoryIds, regions, lastUsedAt, usageCount] = await Promise.all([
    getTemplateCategoryIds(template.id),
    getRegionsForTemplate(template.id),
    getTemplateLastUsed(template.id),
    getTemplateUsageCount(template.id),
  ]);
  return { ...template, category_ids: categoryIds, template_regions: regions, last_used_at: lastUsedAt, usage_count: usageCount };
}

async function getRegionsForTemplate(templateId) {
  if (supabaseAvailable()) {
    const { data, error } = await supabase.from('fillcraft_template_regions').select('*').eq('template_id', templateId).order('z_index');
    if (!error) return data;
    console.error('[templateStore] getRegionsForTemplate supabase error, falling back:', error.message);
  }
  return localDb
    .prepare('SELECT * FROM fillcraft_template_regions WHERE template_id = ? ORDER BY z_index ASC')
    .all(templateId)
    .map(deserializeRegion);
}

export async function listTemplates() {
  let templates;
  if (supabaseAvailable()) {
    const { data, error } = await supabase.from('fillcraft_templates').select('*').order('created_at', { ascending: false });
    if (!error) templates = data;
    else console.error('[templateStore] listTemplates supabase error, falling back:', error.message);
  }
  if (!templates) {
    templates = localDb.prepare('SELECT * FROM fillcraft_templates ORDER BY created_at DESC').all();
  }
  return Promise.all(templates.map(attachExtras));
}

export async function getTemplate(id) {
  let template = null;
  if (supabaseAvailable()) {
    const { data, error } = await supabase.from('fillcraft_templates').select('*').eq('id', id).maybeSingle();
    if (!error) template = data;
    else console.error('[templateStore] getTemplate supabase error, falling back:', error.message);
  }
  if (!template) {
    template = localDb.prepare('SELECT * FROM fillcraft_templates WHERE id = ?').get(id) || null;
  }
  return attachExtras(template);
}

export async function createTemplate({ name, canva_design_id, source_image_url, thumbnail_url, width, height, category_ids = [] }) {
  const id = randomUUID();
  const created_at = nowIso();
  const row = {
    id,
    name,
    canva_design_id: canva_design_id || null,
    source_image_url,
    thumbnail_url: thumbnail_url || source_image_url,
    width,
    height,
    total_max_characters: 0,
    extra_character_allowance: 0,
    created_at,
    updated_at: created_at,
  };

  if (supabaseAvailable()) {
    const { error } = await supabase.from('fillcraft_templates').insert(row);
    if (error) console.error('[templateStore] createTemplate supabase error:', error.message);
  }
  localDb
    .prepare(
      `INSERT INTO fillcraft_templates (id, name, canva_design_id, source_image_url, thumbnail_url, width, height, total_max_characters, extra_character_allowance, created_at, updated_at)
       VALUES (@id, @name, @canva_design_id, @source_image_url, @thumbnail_url, @width, @height, @total_max_characters, @extra_character_allowance, @created_at, @updated_at)`
    )
    .run(row);

  if (category_ids.length) await setTemplateCategories(id, category_ids);

  return attachExtras(row);
}

export async function updateTemplate(id, patch) {
  const { category_ids, ...fields } = patch;
  const updated_at = nowIso();

  if (Object.keys(fields).length) {
    if (supabaseAvailable()) {
      const { error } = await supabase.from('fillcraft_templates').update({ ...fields, updated_at }).eq('id', id);
      if (error) console.error('[templateStore] updateTemplate supabase error:', error.message);
    }
    const existing = localDb.prepare('SELECT * FROM fillcraft_templates WHERE id = ?').get(id) || { id };
    const merged = { ...existing, ...fields, id, updated_at };
    localDb
      .prepare(
        `INSERT OR REPLACE INTO fillcraft_templates (id, name, canva_design_id, source_image_url, thumbnail_url, width, height, total_max_characters, extra_character_allowance, created_at, updated_at)
         VALUES (@id, @name, @canva_design_id, @source_image_url, @thumbnail_url, @width, @height, @total_max_characters, @extra_character_allowance, @created_at, @updated_at)`
      )
      .run(merged);
  }

  if (category_ids !== undefined) await setTemplateCategories(id, category_ids);

  return getTemplate(id);
}

export async function deleteTemplate(id) {
  const existing = await getTemplate(id);

  if (supabaseAvailable()) {
    await supabase.from('fillcraft_template_regions').delete().eq('template_id', id);
    await supabase.from('fillcraft_template_categories').delete().eq('template_id', id);
    await supabase.from('fillcraft_template_usage_log').delete().eq('template_id', id);
    await supabase.from('fillcraft_templates').delete().eq('id', id);
  }
  localDb.prepare('DELETE FROM fillcraft_template_regions WHERE template_id = ?').run(id);
  localDb.prepare('DELETE FROM fillcraft_template_categories WHERE template_id = ?').run(id);
  localDb.prepare('DELETE FROM fillcraft_template_usage_log WHERE template_id = ?').run(id);
  localDb.prepare('DELETE FROM fillcraft_templates WHERE id = ?').run(id);

  if (existing) {
    await deleteAsset(existing.source_image_url);
    if (existing.thumbnail_url && existing.thumbnail_url !== existing.source_image_url) {
      await deleteAsset(existing.thumbnail_url);
    }
  }
}

async function recomputeTotalMaxCharacters(templateId) {
  const regions = await getRegionsForTemplate(templateId);
  const total = regions
    .filter((r) => r.type === 'text' && r.max_characters != null)
    .reduce((sum, r) => sum + r.max_characters, 0);

  if (supabaseAvailable()) {
    const { error } = await supabase.from('fillcraft_templates').update({ total_max_characters: total }).eq('id', templateId);
    if (error) console.error('[templateStore] recomputeTotalMaxCharacters supabase error:', error.message);
  }
  localDb.prepare('UPDATE fillcraft_templates SET total_max_characters = ? WHERE id = ?').run(total, templateId);
  return total;
}

// ---------------- Regions ----------------

function serializeRegion(r) {
  return {
    ...r,
    original_style: r.original_style ? JSON.stringify(r.original_style) : null,
    current_style: r.current_style ? JSON.stringify(r.current_style) : null,
    original_properties: r.original_properties ? JSON.stringify(r.original_properties) : null,
    auto_shrink_to_fit: r.auto_shrink_to_fit ? 1 : 0,
  };
}

const LABEL_PREFIX = { image: 'image', text: 'sentence', shape: 'shape', icon: 'icon' };

export async function nextRegionLabel(template_id, type) {
  const regions = await getRegionsForTemplate(template_id);
  const count = regions.filter((r) => r.type === type).length;
  const prefix = LABEL_PREFIX[type] || type;
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
  shape_type: null,
  fill_color: null,
  stroke_color: null,
  stroke_width: 0,
  sides: null,
  icon_name: null,
  icon_color: null,
  original_properties: null,
};

export async function createRegion(template_id, region) {
  const id = randomUUID();
  const created_at = nowIso();
  const row = { ...REGION_DEFAULTS, ...region, id, template_id, created_at, updated_at: created_at };

  if (supabaseAvailable()) {
    const { error } = await supabase.from('fillcraft_template_regions').insert(row);
    if (error) console.error('[templateStore] createRegion supabase error:', error.message);
  }

  const local = serializeRegion(row);
  localDb
    .prepare(
      `INSERT INTO fillcraft_template_regions
        (id, template_id, type, label, x, y, width, height, z_index, max_characters, original_style, current_style, auto_shrink_to_fit, fit_mode, corner_radius, opacity, rotation, border_width, border_color, filter, shape_type, fill_color, stroke_color, stroke_width, sides, icon_name, icon_color, original_properties, created_at, updated_at)
       VALUES
        (@id, @template_id, @type, @label, @x, @y, @width, @height, @z_index, @max_characters, @original_style, @current_style, @auto_shrink_to_fit, @fit_mode, @corner_radius, @opacity, @rotation, @border_width, @border_color, @filter, @shape_type, @fill_color, @stroke_color, @stroke_width, @sides, @icon_name, @icon_color, @original_properties, @created_at, @updated_at)`
    )
    .run(local);

  if (row.type === 'text') await recomputeTotalMaxCharacters(template_id);

  return row;
}

export async function updateRegion(id, patch) {
  const updated_at = nowIso();

  if (supabaseAvailable()) {
    const { error } = await supabase.from('fillcraft_template_regions').update({ ...patch, updated_at }).eq('id', id);
    if (error) console.error('[templateStore] updateRegion supabase error:', error.message);
  }

  const existingRaw = localDb.prepare('SELECT * FROM fillcraft_template_regions WHERE id = ?').get(id);
  const existing = existingRaw ? deserializeRegion(existingRaw) : { id };
  const merged = { ...existing, ...patch, id, updated_at };
  const local = serializeRegion(merged);

  localDb
    .prepare(
      `INSERT OR REPLACE INTO fillcraft_template_regions
        (id, template_id, type, label, x, y, width, height, z_index, max_characters, original_style, current_style, auto_shrink_to_fit, fit_mode, corner_radius, opacity, rotation, border_width, border_color, filter, shape_type, fill_color, stroke_color, stroke_width, sides, icon_name, icon_color, original_properties, created_at, updated_at)
       VALUES
        (@id, @template_id, @type, @label, @x, @y, @width, @height, @z_index, @max_characters, @original_style, @current_style, @auto_shrink_to_fit, @fit_mode, @corner_radius, @opacity, @rotation, @border_width, @border_color, @filter, @shape_type, @fill_color, @stroke_color, @stroke_width, @sides, @icon_name, @icon_color, @original_properties, @created_at, @updated_at)`
    )
    .run(local);

  if (merged.type === 'text' && merged.template_id) await recomputeTotalMaxCharacters(merged.template_id);

  return merged;
}

export async function deleteRegion(id) {
  const existingRaw = localDb.prepare('SELECT template_id, type FROM fillcraft_template_regions WHERE id = ?').get(id);

  if (supabaseAvailable()) {
    await supabase.from('fillcraft_template_regions').delete().eq('id', id);
  }
  localDb.prepare('DELETE FROM fillcraft_template_regions WHERE id = ?').run(id);

  if (existingRaw?.type === 'text' && existingRaw.template_id) await recomputeTotalMaxCharacters(existingRaw.template_id);
}

// ---------------- Usage log ----------------

export async function logTemplateUsage(templateId, source = 'autofill') {
  const id = randomUUID();
  const used_at = nowIso();
  if (supabaseAvailable()) {
    const { error } = await supabase.from('fillcraft_template_usage_log').insert({ id, template_id: templateId, used_at, source });
    if (error) console.error('[templateStore] logTemplateUsage supabase error:', error.message);
  }
  localDb
    .prepare('INSERT INTO fillcraft_template_usage_log (id, template_id, used_at, source) VALUES (?, ?, ?, ?)')
    .run(id, templateId, used_at, source);
}

export async function getTemplateLastUsed(templateId) {
  if (supabaseAvailable()) {
    const { data, error } = await supabase
      .from('fillcraft_template_usage_log')
      .select('used_at')
      .eq('template_id', templateId)
      .order('used_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!error) return data?.used_at || null;
    console.error('[templateStore] getTemplateLastUsed supabase error, falling back:', error.message);
  }
  const row = localDb
    .prepare('SELECT used_at FROM fillcraft_template_usage_log WHERE template_id = ? ORDER BY used_at DESC LIMIT 1')
    .get(templateId);
  return row?.used_at || null;
}

export async function getTemplateUsageCount(templateId) {
  if (supabaseAvailable()) {
    const { count, error } = await supabase
      .from('fillcraft_template_usage_log')
      .select('id', { count: 'exact', head: true })
      .eq('template_id', templateId);
    if (!error) return count || 0;
    console.error('[templateStore] getTemplateUsageCount supabase error, falling back:', error.message);
  }
  const row = localDb
    .prepare('SELECT COUNT(*) as c FROM fillcraft_template_usage_log WHERE template_id = ?')
    .get(templateId);
  return row?.c || 0;
}

// ---------------- Matching ----------------

export async function matchTemplates({ content_length, category_id } = {}) {
  const all = await listTemplates();
  return all
    .filter((t) => (category_id ? t.category_ids.includes(category_id) : true))
    .filter((t) => {
      if (content_length == null) return true;
      const capacity = (t.total_max_characters || 0) + (t.extra_character_allowance || 0);
      return content_length <= capacity;
    })
    .sort((a, b) => {
      if (!a.last_used_at && !b.last_used_at) return 0;
      if (!a.last_used_at) return -1;
      if (!b.last_used_at) return 1;
      return new Date(a.last_used_at) - new Date(b.last_used_at);
    });
}

// ---------------- Custom fonts ----------------

export async function listCustomFonts() {
  if (supabaseAvailable()) {
    const { data, error } = await supabase.from('fillcraft_custom_fonts').select('*').order('family_name');
    if (!error) return data;
    console.error('[templateStore] listCustomFonts supabase error, falling back:', error.message);
  }
  return localDb.prepare('SELECT * FROM fillcraft_custom_fonts ORDER BY family_name').all();
}

export async function createCustomFont({ family_name, file_url }) {
  const id = randomUUID();
  const created_at = nowIso();
  if (supabaseAvailable()) {
    const { error } = await supabase.from('fillcraft_custom_fonts').insert({ id, family_name, file_url, created_at });
    if (error) console.error('[templateStore] createCustomFont supabase error:', error.message);
  }
  localDb
    .prepare('INSERT INTO fillcraft_custom_fonts (id, family_name, file_url, created_at) VALUES (?, ?, ?, ?)')
    .run(id, family_name, file_url, created_at);
  return { id, family_name, file_url, created_at };
}

// ---------------- Canva connection ----------------

export async function getCanvaConnection() {
  if (supabaseAvailable()) {
    const { data, error } = await supabase.from('fillcraft_canva_connection').select('*').eq('id', 'default').maybeSingle();
    if (!error) return data;
    console.error('[templateStore] getCanvaConnection supabase error, falling back:', error.message);
  }
  return localDb.prepare('SELECT * FROM fillcraft_canva_connection WHERE id = ?').get('default') || null;
}

export async function saveCanvaConnection({ access_token, refresh_token, scope, expires_at }) {
  const updated_at = nowIso();
  const row = { id: 'default', access_token, refresh_token, scope: scope || null, expires_at, updated_at };

  if (supabaseAvailable()) {
    const { error } = await supabase.from('fillcraft_canva_connection').upsert({ ...row, created_at: updated_at });
    if (error) console.error('[templateStore] saveCanvaConnection supabase error:', error.message);
  }

  const existing = localDb.prepare('SELECT created_at FROM fillcraft_canva_connection WHERE id = ?').get('default');
  const created_at = existing?.created_at || updated_at;
  localDb
    .prepare(
      `INSERT OR REPLACE INTO fillcraft_canva_connection (id, access_token, refresh_token, scope, expires_at, created_at, updated_at)
       VALUES (@id, @access_token, @refresh_token, @scope, @expires_at, @created_at, @updated_at)`
    )
    .run({ ...row, created_at });

  return row;
}

export async function clearCanvaConnection() {
  if (supabaseAvailable()) {
    await supabase.from('fillcraft_canva_connection').delete().eq('id', 'default');
  }
  localDb.prepare('DELETE FROM fillcraft_canva_connection WHERE id = ?').run('default');
}
