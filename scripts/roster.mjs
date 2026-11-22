// Generates missing roster portraits (they stay in media/roster/<style>/). Usage:
//   node scripts/roster.mjs <style|all> [characterId] [--force]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(path.join(root, '.env')); } catch {}
const media = await import('../media.js');
const { spent } = await import('../ledger.js');
const { STYLES, imgMissing } = await import('../roster.js');
const arg = process.argv[2] || 'all', only = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : undefined, force = process.argv.includes('--force');
const ids = arg === 'all' ? Object.keys(STYLES).filter((s) => s !== 'surreal-pop') : [arg];
for (const sid of ids) {
  console.log(`${sid}: missing ${imgMissing(sid).map((c) => c.id).join(', ') || 'none'}`);
  await media.generateRoster(sid, only, force);
}
await new Promise((r) => setTimeout(r, 3000)); // let billing settle
console.log(`done; ledger spend ~$${spent().toFixed(3)}`);
process.exit(0);
