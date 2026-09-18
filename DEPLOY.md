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
```

Generate `FILLCRAFT_API_KEY` with something like:
```bash
openssl rand -hex 32
```
This is the value you'll put in n8n's HTTP Request node header (`x-api-key`) whenever it calls Fillcraft. Don't skip this — without it, the autofill and normalize endpoints are open to anyone who finds the URL.

Leave `CANVA_CLIENT_ID` / `CANVA_CLIENT_SECRET` / `CANVA_REDIRECT_URI` unset for now until you set up a Canva Developer app.

## 4. No volume mount needed

Fillcraft has no persistent local disk at all — don't add a Volume Mount in Dokploy for this app. Every design, upload, and custom font lives only in Supabase (database + the `fillcraft-assets` bucket). The only thing the container ever writes to disk is a small ephemeral font-rendering cache under the OS temp dir, which is fine to lose on every restart or redeploy by design. If you previously had a `fillcraft-data` volume attached from an earlier version of this app, it's safe to remove it in Dokploy — nothing reads from or writes to it anymore.

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

Any time you push to `main`, trigger a redeploy in Dokploy (or set up its auto-deploy-on-push webhook). Since all design/template data lives in Supabase only — not in the git repo and not on any mounted volume — redeploying never touches your content at all. Code ships via git, content doesn't.

---

**If something doesn't come up:** check Dokploy's build logs first. A missing `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` won't crash the server at boot, but any upload or design-render call will fail immediately with a clear "Supabase Storage is not configured" error — check the app logs for that if uploads are failing.
