# Fillcraft

A self-built design + autofill platform — draw designs from scratch on a
real Fabric.js canvas, mark objects as autofill fields, then hit an API
endpoint from n8n to get a filled render back. No dependency on Canva or
any external design tool.

1. **Design + autofill** — build a design in the browser editor (text,
   rectangles, circles, images), mark any object as an autofill field with
   a label, then call `/api/designs/:id/autofill` from n8n with
   `{ "<label>": "<value>", ... }` to get a rendered PNG back. Nothing is
   written to disk during a render.
2. **Product image normalization** — take a scraped product image URL,
   resolve its original/full-size version, and composite it onto a clean
   square canvas (default 1200×1200, white background) without distortion
   or cropping — for consistent e-commerce listing images. Independent of
   the design/autofill feature above; untouched by the rebuild.

Supabase is the sole source of truth — no local SQLite fallback (removed
in the 2026-09-14 rebuild to reduce complexity).

## How designs are stored

Each design's `canvas_json` column is Fabric.js's own serialization
(`canvas.toJSON()`) — the actual render/edit source of truth, not a custom
format. A separate `fillcraft_design_fields` table indexes just the objects
tagged as autofill targets (object id + label + type), auto-synced on every
save purely so the autofill API can look up fields by label quickly. It's
derived, never edited directly, so it can't drift out of sync with the
canvas itself.

## Project layout

```
server/   Fastify API + admin frontend host
  src/render/designRenderer.js   reads canvas_json, draws it via @napi-rs/canvas, applies autofill overrides
  src/render/imageUtils.js       unrelated to designs — backs /api/images/normalize only
  src/services/designsStore.js   Supabase CRUD + the fields-sync logic
web/      React (Vite) admin UI — Fabric.js-based editor, design grid
supabase/ schema.sql — run this once against your Supabase project
```

## Environment variables

Copy `.env.example` to `.env` and fill in:

| Variable | Required | Notes |
|---|---|---|
| `PORT` | no | default 3000 |
| `SUPABASE_URL` | **yes** | your Supabase project URL — there is no fallback if this is missing |
| `SUPABASE_SERVICE_ROLE_KEY` | **yes** | service role key (server-side only, never expose to the browser) |
| `FILLCRAFT_API_KEY` | recommended | if set, `/api/designs/:id/autofill`, `/api/designs/:id/preview`, and `/api/images/normalize` require header `x-api-key: <value>`. If unset, those endpoints are open — fine for local testing, not for a public VPS. |
| `LOCAL_DATA_DIR` | no | where uploaded custom-font files are cached locally, default `./data` — mount a persistent volume here in Dokploy |

## Supabase setup

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the SQL editor.
3. Create a storage bucket named `fillcraft-assets`, set it to public read (or wire up signed URLs later).
4. Put the project URL + service role key into `.env`.

## Running locally

```bash
# Backend
cd server && npm install && npm run dev

# Frontend (separate terminal, dev mode only — production build is served by the backend)
cd web && npm install && npm run dev
```

## Deploying

See `DEPLOY.md` for the Dokploy walkthrough — **push to `main` does not
auto-deploy unless you've configured that webhook; check your Dokploy
project settings.**
