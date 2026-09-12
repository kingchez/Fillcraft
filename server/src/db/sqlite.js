import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dataDir = process.env.LOCAL_DATA_DIR || path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'fillcraft-backup.sqlite');
export const localDb = new Database(dbPath);
localDb.pragma('journal_mode = WAL');

export function ensureLocalSchema() {
  localDb.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category_id TEXT,
      canva_design_id TEXT,
      source_image_url TEXT,
      thumbnail_url TEXT,
      width INTEGER,
      height INTEGER,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS template_regions (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL,
      type TEXT NOT NULL,
      label TEXT NOT NULL,
      x REAL, y REAL, width REAL, height REAL, z_index INTEGER,
      max_characters INTEGER,
      original_style TEXT,
      current_style TEXT,
      auto_shrink_to_fit INTEGER,
      fit_mode TEXT,
      corner_radius REAL,
      opacity REAL,
      rotation REAL,
      border_width REAL,
      border_color TEXT,
      filter TEXT,
      shape_type TEXT,
      fill_color TEXT,
      stroke_color TEXT,
      stroke_width REAL,
      sides INTEGER,
      icon_name TEXT,
      icon_color TEXT,
      original_properties TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS custom_fonts (
      id TEXT PRIMARY KEY,
      family_name TEXT NOT NULL,
      file_url TEXT,
      created_at TEXT
    );
  `);
}

export function getLocalUploadsDir() {
  const dir = process.env.LOCAL_UPLOADS_DIR || path.join(dataDir, 'uploads');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}
