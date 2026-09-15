import path from 'path';
import fs from 'fs';

const dataDir = process.env.LOCAL_DATA_DIR || path.join(process.cwd(), 'data');

export function getLocalUploadsDir() {
  const dir = process.env.LOCAL_UPLOADS_DIR || path.join(dataDir, 'uploads');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}
