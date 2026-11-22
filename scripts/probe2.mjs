// One 13s test clip with the NEW fast/spectacular prompt, from the last frame of a previous clip. Costs ~$0.20.
import path from 'node:path'; import fs from 'node:fs'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(path.join(root, '.env')); } catch {}
const m = await import('../media.js'); const { byId } = await import('../roster.js'); const { spent, EST } = await import('../ledger.js');
const dir = path.join(root, 'media');
const last = fs.readdirSync(dir).filter((f) => f.endsWith('-last.png')).map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0].f;
const cls = process.argv[2] || 'A', beat = Number(process.argv[3] || 1);
const A = byId('moth'), B = byId('mercury'); const prompt = m.branchPrompt(cls, A, B, false, beat);
console.log('frame:', last, '\nprompt:', prompt);
const ref = await m.upload(path.join(dir, last));
const t0 = Date.now();
const { id, rec } = await m.submit({ model: 'MiniMax-H3-Turbo', task_type: 'I2V', adapter: 'pika_h3_flex', prompt, src_image_urls: [ref], video_config: { duration_secs: m.CLIP_SECS, height: 480, aspect_ratio: '16:9', audio: true } }, 'branch', EST.videoPerSec * m.CLIP_SECS, 'probe2');
await m.wait(id, rec, 150000); const s = await m.save(id, 'mp4', 'tries');
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${s.file}`); await new Promise((r) => setTimeout(r, 2500)); console.log('spend $' + spent().toFixed(3)); process.exit(0);
