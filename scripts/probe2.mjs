// Two test clips with the NEW varied prompts, from the same starting frame, to compare stories. Costs ~$0.20 each.
// Usage: node scripts/probe2.mjs <frame.png> <A|B|tie> <special|attack|counter> <beat> [more "cls kind beat" triples as quoted args]
import path from 'node:path'; import fs from 'node:fs'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(path.join(root, '.env')); } catch {}
const m = await import('../media.js'); const { byId } = await import('../roster.js'); const { spent, EST } = await import('../ledger.js');
const dir = path.join(root, 'media');
const frame = path.join(dir, process.argv[2]);
const A = byId(process.env.FA || 'seraph'), B = byId(process.env.FB || 'mercury');
const jobs = process.argv.slice(3).map((s) => s.split(' ')); // each arg: "cls kind beat"
const deck = m.newDeck();
const ref = await m.upload(frame);
await Promise.all(jobs.map(async ([cls, kind, beat]) => {
  const prompt = m.branchPrompt(cls, A, B, false, Number(beat), deck.plan(Number(beat)), kind);
  console.log(`\n[${cls} ${kind} beat ${beat}]\n${prompt.slice(prompt.indexOf('Round'), prompt.indexOf('Same two characters'))}`);
  const { id, rec } = await m.submit({ model: 'MiniMax-H3-Turbo', task_type: 'I2V', adapter: 'pika_h3_flex', prompt, src_image_urls: [ref], video_config: { duration_secs: m.CLIP_SECS, height: 480, aspect_ratio: '16:9', audio: true } }, 'branch', EST.videoPerSec * m.CLIP_SECS, `probe ${cls} ${kind}`);
  await m.wait(id, rec, 150000); const s = await m.save(id, 'mp4', 'tries'); console.log(`saved ${s.file}`);
}));
await new Promise((r) => setTimeout(r, 2500)); console.log('spend $' + spent().toFixed(3)); process.exit(0);
