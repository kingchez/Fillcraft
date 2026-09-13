# Fillcraft API Reference

All endpoints are prefixed with your deployed base URL, e.g. `https://fillcraft.yourdomain.com`.

If `FILLCRAFT_API_KEY` is set in the environment, the two endpoints n8n calls require:
```
x-api-key: <your key>
```

## For n8n

### `POST /api/templates/:id/autofill`
Renders a template with the given field values and returns the image directly. Nothing is persisted to disk — the render happens in memory and the buffer is discarded once the response is sent. Every successful render is logged (see `GET /api/templates/match` below) so you can track/rotate usage.

**Body** — keys are region labels (`sentence_1`, `image_1`, etc., as shown in the admin UI):
```json
{
  "sentence_1": "50% off everything this weekend!",
  "image_1": "https://example.com/product-photo.jpg"
}
```
Image values can be a URL or a base64 data URI. Text longer than a region's configured max character count is truncated.

**Response**: `Content-Type: image/png`, binary body.

---

### `GET /api/templates/match`
Finds templates that can fit a given amount of text, optionally scoped to a category, sorted **least-recently-used first** (never-used templates first) — call this before `autofill` to automatically rotate across your template library instead of always picking the same one.

**Query params** (all optional):
- `content_length` — total characters your content needs to fit. A template qualifies if `total_max_characters + extra_character_allowance >= content_length`.
- `category_id` — restrict to templates in one category.

**Response**: array of templates (same shape as `GET /api/templates`), pre-sorted so `[0]` is the best pick — least recently used (or never used) among the ones that fit.

Example n8n pattern: call `GET /api/templates/match?content_length={{$json.text.length}}&category_id=...`, take the first result's `id`, then `POST` to its `autofill` endpoint.

---

### `POST /api/images/normalize`
Takes a scraped product image URL, resolves the full-resolution version (stripping a WordPress-style `-WIDTHxHEIGHT` suffix if present, falling back to the original URL if that guess doesn't exist), and composites it onto a square canvas without distortion or cropping.

**Body**:
```json
{
  "image_url": "https://shop.example.com/wp-content/uploads/2026/01/photo-600x422.jpg",
  "canvas_size": 1200,
  "background_color": "#FFFFFF",
  "max_content_ratio": 0.83,
  "strip_size_suffix": true
}
```
Only `image_url` is required; the rest default as shown.

**Response**: `Content-Type: image/png`, binary body.

---

## For the admin frontend (or your own tooling)

- `GET /api/categories` / `POST /api/categories` — list/create categories.
- `DELETE /api/categories/:id` — deletes the category only; any templates in it become uncategorized (or keep their other categories), never deleted.
- `GET /api/templates` — list all templates with their regions, `category_ids` (array), `total_max_characters`, `extra_character_allowance`, `last_used_at`, `usage_count`.
- `GET /api/templates/:id` — one template, same shape.
- `POST /api/templates` — multipart: `image` file + `name` + optional `category_ids` (a **JSON-stringified array**, e.g. `'["id1","id2"]'`, or omit/`'[]'` for none) → creates a template.
- `PATCH /api/templates/:id` — update fields; pass `category_ids` (array) to replace its full category set, or any of `name`/`extra_character_allowance`/etc.
- `DELETE /api/templates/:id`
- `POST /api/templates/:id/regions` — create a region (`type: "image"|"text"|"shape"|"icon"`, `x`, `y`, `width`, `height`, plus type-specific fields — see `supabase/schema.sql`). Adding/editing/removing a `text` region automatically recomputes the template's `total_max_characters`.
- `PATCH /api/templates/:id/regions/:regionId` — update a region.
- `DELETE /api/templates/:id/regions/:regionId`
- `POST /api/templates/:id/regions/:regionId/reset-style` — reverts a region's editable properties back to what they were when first created.
- `GET /api/fonts/google` — curated list of free Google Font family names.
- `GET /api/fonts/custom` / `POST /api/fonts/custom` — list/upload custom font files (multipart: `font` file + `family_name`).
- `GET /api/canva/status` — whether Canva credentials are configured and a connection is active.
- `GET /api/canva/connect` / `GET /api/canva/callback` — OAuth handshake (PKCE). Visit `/connect` in a browser to start it.
- `POST /api/canva/disconnect` — revokes and clears the stored Canva connection.
- `GET /api/canva/designs?query=...&continuation=...` — list/search your Canva designs.
- `POST /api/canva/import/:designId` — exports a Canva design as a flattened PNG and creates a template from it (body: optional `name`, `category_ids` array).
