// Probe: 2-monster R2V intro, then 3 parallel 14s I2V branches from its last frame. Prints timings.
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
process.loadEnvFile(new URL('../.env', import.meta.url).pathname);
const { raw } = await import('../media.js');
const { submit, wait, save, upload, DIR, STYLE, ADAPTER } = raw;
const pngs = fs.readdirSync(DIR).filter(f => f.endsWith('.png') && !f.startsWith('frame')).map(f => ({ f, t: fs.statSync(path.join(DIR, f)).mtimeMs })).sort((a, b) => b.t - a.t).slice(0, 2);
const [a, b] = pngs.map(p => path.join(DIR, p.f));
const T = () => new Date().toISOString().slice(14, 23);
const t0 = Date.now(), el = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';
console.log(T(), 'images', pngs.map(p => p.f));
const [ra, rb] = await Promise.all([upload(a), upload(b)]); console.log(el(), 'uploaded refs');
const introId = await submit({ model: raw.VID_MODEL, task_type: 'R2V', adapter: ADAPTER,
  prompt: `Reference image 1 is the left monster (fire tiger knight), reference image 2 is the right monster (purple storm dragon). Both stand facing each other in the same dark stone arena, tense face-off, they growl and circle. Fixed camera wide shot. ${STYLE}`,
  src_image_urls: [ra, rb], subject_to_image_ids: { left: [0], right: [1] }, reference_order: [{ type: 'image', index: 0 }, { type: 'image', index: 1 }],
  video_config: { duration_secs: 6, height: 480, aspect_ratio: '16:9', audio: false } }).catch(e => { console.log('R2V with adapter failed:', e.message); return null; });
if (!introId) process.exit(1);
const j = await wait(introId, 200000); console.log(el(), 'intro R2V done', 'queue', j.queue_time_secs, 'gen', j.generation_time_secs);
const intro = await save(introId, 'mp4'); const frame = path.join(DIR, 'frame-probe.png');
execFileSync('ffmpeg', ['-y', '-v', 'error', '-sseof', '-0.1', '-i', intro.file, '-frames:v', '1', frame]); console.log(el(), 'last frame extracted');
const rf = await upload(frame); console.log(el(), 'frame uploaded');
const outcomes = { A: 'The left fire tiger knight overpowers the purple dragon, landing a heavy blow that sends it staggering back.', B: 'The right purple storm dragon overpowers the fire tiger, blasting it with lightning so it staggers back.', tie: 'Both monsters clash head on in the middle, shockwave, neither gives ground.' };
const D = Number(process.argv[2] || 14); const t1 = Date.now();
await Promise.all(Object.entries(outcomes).map(async ([k, txt]) => {
  const id = await submit({ model: raw.VID_MODEL, task_type: 'I2V', adapter: ADAPTER, prompt: `${txt} Same arena, same two monsters, fixed camera. ${STYLE}`, src_image_urls: [rf], video_config: { duration_secs: D, height: 480, aspect_ratio: '16:9', audio: false } });
  const r = await wait(id, 200000); const s = await save(id, 'mp4');
  console.log(`branch ${k} (${D}s): ${((Date.now() - t1) / 1000).toFixed(1)}s total | queue ${r.queue_time_secs?.toFixed(1)} gen ${r.generation_time_secs?.toFixed(1)} | ${s.url}`);
}));
console.log(el(), 'DONE');
