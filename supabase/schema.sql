-- Fillcraft schema. Run once in the Supabase SQL editor (or via the
-- Supabase MCP apply_migration tool, which is how this was actually applied).
--
-- Every table is prefixed fillcraft_ deliberately — this project may share a
-- Supabase instance with other, unrelated projects, and a generic name like
-- "categories" or "templates" can silently collide with a pre-existing table
-- from something else entirely. Don't drop this prefix.

create extension if not exists "pgcrypto";

create table if not exists fillcraft_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists fillcraft_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  canva_design_id text,
  source_image_url text not null,
  thumbnail_url text,
  width int not null,
  height int not null,
  -- Sum of all its text regions' max_characters, recomputed automatically
  -- whenever a text region is added/edited/removed. Lets you query/filter
  -- templates by how much text they can hold without joining+summing by hand.
  total_max_characters int not null default 0,
  -- How many characters OVER total_max_characters this template can still
  -- reasonably accommodate before the design looks wrong.
  extra_character_allowance int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Many-to-many: a template can belong to zero, one, or several categories.
create table if not exists fillcraft_template_categories (
  template_id uuid not null references fillcraft_templates(id) on delete cascade,
  category_id uuid not null references fillcraft_categories(id) on delete cascade,
  primary key (template_id, category_id)
);

create table if not exists fillcraft_template_regions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references fillcraft_templates(id) on delete cascade,
  type text not null check (type in ('image','text','shape','icon')),
  label text not null,
  x numeric not null,
  y numeric not null,
  width numeric not null,
  height numeric not null,
  z_index int not null default 0,

  -- text-only
  max_characters int,
  original_style jsonb,
  current_style jsonb,
  auto_shrink_to_fit boolean default true,

  -- image-only
  fit_mode text,
  corner_radius numeric default 0,
  opacity numeric default 1,
  rotation numeric default 0,
  border_width numeric default 0,
  border_color text,
  filter text,

  -- shape-only
  shape_type text,        -- rectangle | circle | line | arrow | polygon
  fill_color text,
  stroke_color text,
  stroke_width numeric default 0,
  sides int,               -- for polygon

  -- icon-only
  icon_name text,           -- Iconify identifier, e.g. "mdi:heart"
  icon_color text,

  -- generic "original" snapshot for anything that isn't text (image/shape/icon
  -- share this one JSON column for their own type-specific properties)
  original_properties jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists fillcraft_custom_fonts (
  id uuid primary key default gen_random_uuid(),
  family_name text not null unique,
  file_url text not null,
  created_at timestamptz not null default now()
);

-- Single-row table holding the connected Canva account's OAuth tokens.
-- Fillcraft is a personal, single-user tool, so one row is sufficient —
-- id is always 'default'.
create table if not exists fillcraft_canva_connection (
  id text primary key default 'default',
  access_token text not null,
  refresh_token text not null,
  scope text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Logs every successful autofill render, so usage can be queried/rotated:
-- "which templates haven't been used recently", "when was X last used", etc.
create table if not exists fillcraft_template_usage_log (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references fillcraft_templates(id) on delete cascade,
  used_at timestamptz not null default now(),
  source text
);

create index if not exists idx_fillcraft_regions_template_id on fillcraft_template_regions(template_id);
create index if not exists idx_fillcraft_tpl_categories_category on fillcraft_template_categories(category_id);
create index if not exists idx_fillcraft_usage_log_template_id on fillcraft_template_usage_log(template_id);
create index if not exists idx_fillcraft_usage_log_used_at on fillcraft_template_usage_log(used_at);

-- Convenience view for direct SQL browsing/searching (Supabase SQL editor,
-- an n8n Supabase node, etc.) without joining regions/categories by hand.
create or replace view fillcraft_template_search as
select
  t.id,
  t.name,
  t.canva_design_id,
  t.width,
  t.height,
  t.total_max_characters,
  t.extra_character_allowance,
  (t.total_max_characters + t.extra_character_allowance) as max_acceptable_characters,
  coalesce(array_agg(distinct c.name) filter (where c.name is not null), '{}') as category_names,
  coalesce(array_agg(distinct tc.category_id) filter (where tc.category_id is not null), '{}') as category_ids,
  (select max(u.used_at) from fillcraft_template_usage_log u where u.template_id = t.id) as last_used_at,
  (select count(*) from fillcraft_template_usage_log u where u.template_id = t.id) as usage_count
from fillcraft_templates t
left join fillcraft_template_categories tc on tc.template_id = t.id
left join fillcraft_categories c on c.id = tc.category_id
group by t.id;
