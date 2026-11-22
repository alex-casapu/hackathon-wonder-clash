// Downloads already-generated clips by task id into media/ (downloading an existing asset is free). Usage: node scripts/fetchclip.mjs <taskId> [...]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(path.join(root, '.env')); } catch {}
const m = await import('../media.js');
for (const id of process.argv.slice(2)) {
  try { const s = await m.save(id, 'mp4'); console.log('saved', s.file); } catch (e) { console.log('FAILED', id, e.message.slice(0, 100)); }
}
process.exit(0);
