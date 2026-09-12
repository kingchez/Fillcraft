# Deploying Fillcraft on Dokploy

## 1. Prep — Supabase (do this first, takes 5 minutes)

1. Create a project at supabase.com if you haven't already.
2. Open the SQL editor, paste in the contents of `supabase/schema.sql`, run it.
3. Storage → create a new bucket named `fillcraft-assets`. Set it **public** (simplest for now — template images and fonts get served straight from Supabase's CDN).
4. Settings → API → copy your **Project URL** and **service_role key** (not the anon key — the server needs write access).

## 2. Create the application in Dokploy

1. In Dokploy, create a new **Application**.
2. Source: point it at `https://github.com/kingchez/Fillcraft`, branch `main`.
3. Build type: **Dockerfile** (the repo has one at the root — Dokploy should auto-detect it).
4. Port: **3000** (matches `EXPOSE 3000` in the Dockerfile).

## 3. Environment variables

In Dokploy's Environment tab for the app, set:

```
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<your service role key>
FILLCRAFT_API_KEY=<generate a long random string>
LOCAL_DATA_DIR=/app/data
```

Generate `FILLCRAFT_API_KEY` with something like:
```bash
openssl rand -hex 32
```
This is the value you'll put in n8n's HTTP Request node header (`x-api-key`) whenever it calls Fillcraft. Don't skip this — without it, the autofill and normalize endpoints are open to anyone who finds the URL.

Leave `CANVA_CLIENT_ID` / `CANVA_CLIENT_SECRET` / `CANVA_REDIRECT_URI` unset for now until you set up a Canva Developer app.

## 4. Persistent volume (important)

Add a **Volume Mount** in Dokploy:
- Host path (or Dokploy-managed volume): anything persistent, e.g. `fillcraft-data`
- Container path: `/app/data`

This is where the local SQLite backup and the local-mirrored template/font files live. Without this, a redeploy wipes your local failover copy (Supabase data would be untouched, but you'd lose the "survive a Supabase outage" safety net until it re-syncs).

## 5. Domain + deploy

1. Assign a domain (or subdomain) to the app in Dokploy, enable HTTPS (Dokploy handles Let's Encrypt automatically).
2. Hit Deploy. Dokploy will build the Docker image (installs both `server/` and `web/` dependencies, builds the React admin frontend, then starts the Fastify server) and bring it up on your domain.

## 6. Verify it's alive

```bash
curl https://your-fillcraft-domain.com/api/health
# => {"ok":true,"time":"..."}
```

Open `https://your-fillcraft-domain.com` in a browser — you should land on the admin frontend (empty template list, since nothing's uploaded yet).

## 7. Wire up n8n

In your n8n HTTP Request nodes:

- **Autofill**: `POST https://your-fillcraft-domain.com/api/templates/<template_id>/autofill`, header `x-api-key: <your FILLCRAFT_API_KEY>`, JSON body with your field values, response format set to **File/Binary** (so n8n treats the PNG response as binary data, not JSON).
- **Image normalize**: `POST https://your-fillcraft-domain.com/api/images/normalize`, same header, body `{ "image_url": "..." }`, response format **File/Binary**.

You get the `template_id` from the admin UI (or `GET /api/templates` to list all of them and their IDs).

## 8. Redeploys going forward

Any time you push to `main`, trigger a redeploy in Dokploy (or set up its auto-deploy-on-push webhook). Since template data lives in Supabase + the mounted volume — not in the git repo — redeploying never touches your templates. That's the whole point of the architecture we discussed: code ships via git, template content doesn't.

---

**If something doesn't come up:** check Dokploy's build logs first (most likely culprit is a missing env var causing a crash-on-boot — the server does start even without Supabase configured, so if it's failing to boot at all, check `PORT`/volume mount issues first).
