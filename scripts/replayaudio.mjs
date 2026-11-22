// Pre-generates (once) every voice line the recorded match can need, so the REPLAY demo has full audio and costs nothing.
// Usage: node scripts/replayaudio.mjs          -> dry run (counts the missing lines and the estimated cost)
//        node scripts/replayaudio.mjs --go     -> generates them
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(path.join(root, '.env')); } catch {}
const audio = await import('../audio.js');
const { byId } = await import('../roster.js');
const { HOST, TAUNTS, announce, replayReaction, finaleLines } = await import('../lines.js');
const { spent, EST } = await import('../ledger.js');
const man = JSON.parse(fs.readFileSync(path.join(root, 'media/replay/manifest.json'), 'utf8'));
const A = byId(man.fighters.A), B = byId(man.fighters.B);
const lines = [];
const add = (voice, text) => { if (!lines.some((l) => l.voice === voice && l.text === text)) lines.push({ voice, text }); };
for (const k of ['intro', 'call_tap', 'call_taunt', 'call_A', 'call_B', 'outro']) for (const l of HOST[k]) add('host', l.t);
add('host', announce('A', A)); add('host', announce('B', B));
for (const c of [A, B]) {
  for (const t of Object.values(c.lines)) add(c.voice, t);
  for (const ins of TAUNTS) add(c.voice, `[sneering, mocking] ${ins.text}`);
}
for (const [W, Lz] of [[A, B], [B, A]]) { for (const t of replayReaction(W, Lz)) add('host', t); for (const t of finaleLines(W)) add('host', t); }
const missing = lines.filter((l) => !audio.cachedUrl(l.voice, l.text));
console.log(`provider: ${audio.provider()} | lines needed: ${lines.length} | missing: ${missing.length} | estimated cost ~$${(missing.length * EST.tts).toFixed(2)}`);
if (!process.argv.includes('--go')) { console.log('dry run: nothing generated. Re-run with --go.'); process.exit(0); }
let ok = 0, i = 0;
const worker = async () => { while (i < missing.length) { const l = missing[i++]; if (await audio.ensure(l.voice, l.text)) ok++; else console.log('FAILED:', l.voice, l.text.slice(0, 50)); } };
await Promise.all([worker(), worker(), worker()]);
console.log(`generated ${ok}/${missing.length}; ledger estimate ~$${spent().toFixed(2)}`);
process.exit(0);
