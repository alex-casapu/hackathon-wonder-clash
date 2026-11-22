// Generates the host intro + each character's entrance line once (cached) and prints where they landed.
// Usage: node scripts/voices.mjs [HOST|characterId]   (stops at the first failure so credits are not burned)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(path.join(root, '.env')); } catch {}
const audio = await import('../audio.js');
const { ROSTER } = await import('../roster.js');
const { HOST } = await import('../lines.js');
const { spent, L } = await import('../ledger.js');
console.log('provider:', audio.provider());
const jobs = [{ id: 'HOST', voice: 'host', text: HOST.intro[0].t }, ...ROSTER.map((c) => ({ id: c.id, voice: c.voice, text: c.lines.entrance }))];
const only = process.argv[2];
for (const j of jobs.filter((x) => !only || x.id === only)) {
  const url = await audio.ensure(j.voice, j.text);
  console.log(`${j.id.padEnd(8)} ${j.voice}: ${url ? 'ok ' + url : 'FAILED'}`);
  if (!url) break;
}
await new Promise((r) => setTimeout(r, 1500));
console.log('log:\n' + L.logs.filter((l) => /audio/.test(l)).join('\n'));
console.log(`spend ~$${spent().toFixed(3)} (estimate)`);
process.exit(0);
