-- Fillcraft schema. Run once in the Supabase SQL editor.
create extension if not exists "pgcrypto";

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category_id uuid references categories(id) on delete set null,
  canva_design_id text,
  source_image_url text not null,
  thumbnail_url text,
  width int not null,
  height int not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists template_regions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references templates(id) on delete cascade,
  type text not null check (type in ('image','text')),
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

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists custom_fonts (
  id uuid primary key default gen_random_uuid(),
  family_name text not null unique,
  file_url text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_template_regions_template_id on template_regions(template_id);
create index if not exists idx_templates_category_id on templates(category_id);
