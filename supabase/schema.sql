-- Fillcraft schema — rebuilt 2026-09-14, Canva-independent design platform.
-- canvas_json is Fabric.js's own serialization (the render/edit source of
-- truth). fillcraft_design_fields is a derived index of autofill-tagged
-- objects, auto-synced on every save — never edited directly.

CREATE TABLE public.fillcraft_designs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT 'Untitled Design',
  width int NOT NULL,
  height int NOT NULL,
  canvas_json jsonb NOT NULL DEFAULT '{"version":"6.0.0","objects":[]}'::jsonb,
  thumbnail_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.fillcraft_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.fillcraft_design_categories (
  design_id uuid NOT NULL REFERENCES public.fillcraft_designs(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.fillcraft_categories(id) ON DELETE CASCADE,
  PRIMARY KEY (design_id, category_id)
);

CREATE TABLE public.fillcraft_design_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  design_id uuid NOT NULL REFERENCES public.fillcraft_designs(id) ON DELETE CASCADE,
  object_id text NOT NULL,
  label text NOT NULL,
  field_type text NOT NULL CHECK (field_type IN ('text','image')),
  max_characters int,
  default_value text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (design_id, label)
);

CREATE TABLE public.fillcraft_usage_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  design_id uuid NOT NULL REFERENCES public.fillcraft_designs(id) ON DELETE CASCADE,
  used_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'autofill'
);

CREATE TABLE public.fillcraft_custom_fonts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_name text NOT NULL,
  file_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.fillcraft_designs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fillcraft_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fillcraft_design_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fillcraft_design_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fillcraft_usage_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fillcraft_custom_fonts ENABLE ROW LEVEL SECURITY;
-- No policies — the server uses the Supabase service-role key exclusively,
-- which bypasses RLS. This blocks anon-key access by default.
