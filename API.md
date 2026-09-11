# Fillcraft API Reference

All endpoints are prefixed with your deployed base URL, e.g. `https://fillcraft.yourdomain.com`.

If `FILLCRAFT_API_KEY` is set in the environment, the two endpoints n8n calls require:
```
x-api-key: <your key>
```

## For n8n

### `POST /api/templates/:id/autofill`
Renders a template with the given field values and returns the image directly. Nothing is persisted to disk — the render happens in memory and the buffer is discarded once the response is sent.

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
- `GET /api/templates` — list all templates with their regions.
- `GET /api/templates/:id` — one template with regions.
- `POST /api/templates` — multipart: `image` file + `name` + optional `category_id` → creates a template.
- `PATCH /api/templates/:id` — update template fields (e.g. rename).
- `DELETE /api/templates/:id`
- `POST /api/templates/:id/regions` — create a region (`type: "image"|"text"`, `x`, `y`, `width`, `height`, plus type-specific fields — see `supabase/schema.sql` for the full field list).
- `PATCH /api/templates/:id/regions/:regionId` — update a region (position, size, style, etc.)
- `DELETE /api/templates/:id/regions/:regionId`
- `POST /api/templates/:id/regions/:regionId/reset-style` — copies `original_style` back onto `current_style`.
- `GET /api/fonts/google` — curated list of free Google Font family names.
- `GET /api/fonts/custom` / `POST /api/fonts/custom` — list/upload custom font files (multipart: `font` file + `family_name`).
- `GET /api/canva/status` — whether Canva credentials are configured.
- `GET /api/canva/connect` / `GET /api/canva/callback` — OAuth handshake (works once credentials are set; token isn't persisted yet — see README).
- `GET /api/canva/designs`, `POST /api/canva/import/:designId` — return `501 not_implemented` until the above is finished.
