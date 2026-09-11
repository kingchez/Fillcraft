# Fillcraft

A self-hosted Canva-autofill replacement. Two capabilities, one service:

1. **Template autofill** — annotate a design (from Canva or any image) with text/image regions, then hit an API endpoint from n8n to get a filled render back, ephemerally (nothing is written to disk during a render).
2. **Product image normalization** — take a scraped product image URL, resolve its original/full-size version, and composite it onto a clean square canvas (default 1200×1200, white background) without distortion or cropping — for consistent e-commerce listing images.

Template metadata (categories, templates, regions/styles) is written to **Supabase** as the source of truth, and mirrored into a local SQLite file inside the container as a standby copy — if Supabase is unreachable, reads fall back to the local copy automatically.

## Project layout

```
server/   Fastify API + admin frontend host
web/      React (Vite) admin UI — template upload, region annotation, style editor
supabase/ schema.sql — run this once against your Supabase project
```

## Environment variables

Copy `.env.example` to `.env` and fill in:

| Variable | Required | Notes |
|---|---|---|
| `PORT` | no | default 3000 |
| `SUPABASE_URL` | recommended | your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | recommended | service role key (server-side only, never expose to the browser) |
| `FILLCRAFT_API_KEY` | recommended | if set, `/api/templates/:id/autofill` and `/api/images/normalize` require header `x-api-key: <value>`. If unset, those endpoints are open — fine for local testing, not for a public VPS. |
| `LOCAL_DATA_DIR` | no | where the SQLite backup + local asset mirror live, default `./data` — mount a persistent volume here in Dokploy |
| `CANVA_CLIENT_ID` / `CANVA_CLIENT_SECRET` / `CANVA_REDIRECT_URI` | optional | only needed for automatic Canva import (see below) |

## Supabase setup

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the SQL editor.
3. Create a storage bucket named `fillcraft-assets`, set it to public read (or wire up signed URLs later).
4. Put the project URL + service role key into `.env`.

If you skip Supabase entirely, Fillcraft still works — everything just lives in the local SQLite/disk mirror only. You can add Supabase later; existing local data isn't automatically backfilled, but new writes will start going to both.

## Canva import — what's built vs. what's pending

The OAuth flow (`/api/canva/connect` → `/api/canva/callback`) and the route structure for listing/importing a design are implemented. What's **not** wired up yet: persisting the access/refresh token against an account, and the actual "export design → download → create template" pipeline — because that needs a real Canva Developer app (Client ID/Secret), which only you can create at canva.com/developers, and testing against your actual Canva designs. Once you have those credentials, drop them in `.env` and this is the next thing to finish.

Manual upload (drag an exported PNG/PDF into the admin UI) works fully today and doesn't depend on any of this.

## Running locally

```bash
# Backend
cd server && npm install && npm run dev

# Frontend (separate terminal, dev mode only — production build is served by the backend)
cd web && npm install && npm run dev
```

## Deploying

See `DEPLOY.md` for the Dokploy walkthrough (added once the build is finalized).
