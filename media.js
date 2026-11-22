// MachGen client. Live mode needs MACHGEN_API_KEY in .env; without it every call returns null
// and the screen falls back to emoji stand-ins (the game stays fully playable).
//
// Video strategy (no streaming endpoint exists): ONE continuous fight made of chained clips.
//   intro  = R2V with both fighters' portraits (same scene)
//   beat k = I2V starting from the LAST FRAME of the previous clip.
// While clip k plays we pre-generate one continuation per possible outcome so the audience vote
// simply picks a branch that is already rendering -> no waiting after the vote.
// Every paid call goes through the ledger (costs, budget cap, kill switch).
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { L, EST, begin, guard, log } from './ledger.js';
import { STYLES, style, styleId, ROSTER, imgFile, imgFileFor, imgMissing, DIR as ROSTER_DIR } from './roster.js';

const run = promisify(execFile);
export const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'media');
const BASE = 'https://api.machgen.ai/api/v0';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = () => process.env.MACHGEN_API_KEY;
export const live = () => !!key() && !L.mock && process.env.MOCK !== '1' && !process.argv.includes('--mock');

const IMG_MODEL = process.env.IMG_MODEL || 'FLUX.2-dev';
const VID_MODEL = process.env.VID_MODEL || 'MiniMax-H3-Turbo';
const ADAPTER = process.env.ADAPTER ?? 'pika_h3_flex';
export const CLIP_SECS = Number(process.env.CLIP_SECS || 13);   // 12s intro + 6 x 13s = 90s of fight
export const INTRO_SECS = Number(process.env.INTRO_SECS || 12);

// ---------- raw API ----------
export async function api(p, opt2 = {}) {
  const r = await fetch(BASE + p, { ...opt2, headers: { Authorization: `Bearer ${key()}`, ...(opt2.headers || {}) } });
  if (!r.ok) throw new Error(`${p} -> ${r.status} ${(await r.text()).slice(0, 300)}`);
  return r;
}
// submit: guarded by the ledger. Returns {id, rec}.
export async function submit(body, kind, est, label = '') {
  guard();
  const rec = begin(kind, est, label);
  try {
    const j = await (await api('/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    rec.id = j.task_id; L.inflight.set(rec.id, rec); return { id: rec.id, rec };
  } catch (e) { rec.status = 'failed'; rec.actual = 0; throw e; }
}
let billingLogged = false;
async function billing(rec) {
  try {
    const j = await (await api(`/tasks/${rec.id}/billing`)).json();
    if (!billingLogged) { billingLogged = true; log('[billing sample]', JSON.stringify(j).slice(0, 200)); }
    for (const k of ['net_cost_micros', 'billed_micros', 'cost_micros']) if (typeof j[k] === 'number') return void (rec.actual = j[k] / 1e6);
    for (const k of ['cost_usd', 'cost', 'amount_usd']) if (typeof j[k] === 'number') return void (rec.actual = j[k]);
  } catch { /* keep the estimate */ }
}
export async function wait(id, rec, maxMs = 150000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    if (rec.status === 'canceled') throw new Error('canceled');
    const j = await (await api(`/tasks/${id}`)).json();
    if (j.status === 'COMPLETED') { rec.status = 'done'; L.inflight.delete(id); billing(rec); return j; }
    if (j.status === 'FAILED') { rec.status = 'failed'; L.inflight.delete(id); billing(rec); throw new Error(j.error_msg || 'task failed'); }
    await sleep(700);
  }
  rec.status = 'timeout'; throw new Error('timeout');
}
export async function save(id, ext, sub = '') {
  const r = await api(`/assets/${id}`);
  const dir = path.join(DIR, sub); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.${ext}`);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  return { url: `/media/${sub ? sub + '/' : ''}${id}.${ext}`, file };
}
export async function upload(file) {
  guard();
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(file)]), path.basename(file));
  const j = await (await api('/upload', { method: 'POST', body: fd })).json();
  return `@input/${j.artifact_path}`;
}
async function submitVideo(body, kind, est, label) { // adapter first, plain model if the adapter is rejected
  try { return await submit({ ...body, ...(ADAPTER ? { adapter: ADAPTER } : {}) }, kind, est, label); }
  catch (e) { if (/HALTED|budget/.test(e.message)) throw e; log('[video] adapter rejected, retry plain:', e.message.slice(0, 120)); return submit(body, kind, est, label); }
}
// ---------- cancel / halt ----------
export async function cancelRec(rec) {
  if (!rec?.id || rec.status !== 'pending') return;
  rec.status = 'canceled'; L.inflight.delete(rec.id);
  try { await api(`/tasks/${rec.id}/cancel`, { method: 'POST' }); billing(rec); } catch { /* already running: it will bill */ }
}
export async function cancelAll() { const n = L.inflight.size; await Promise.all([...L.inflight.values()].map(cancelRec)); if (n) log(`[cancel] asked to cancel ${n} in-flight tasks`); }
export async function haltAll() { L.halted = true; log('[STOP] halted: no more paid calls'); await cancelAll(); }
export const resume = () => { L.halted = false; log('[resume] paid calls allowed again'); };

// ---------- prompts ----------
// The video look avoids photographic words ("85mm", "shallow depth of field") that make the model drift into slow cinematic motion.
export const styleLine = () => `${style().videoLook || style().look}; ${style().arena}`;
const PACE = 'FAST-PACED real-time action at full speed, NOT slow motion, quick explosive movement, rapid camera moves (whip pan, fast push-in, low-angle tracking), both fighters always stay in frame.';
const WORLD = [ // the street itself takes part in the fight; one per round so every clip is different
  'a parked car is launched into the air and explodes in a fireball',
  'a giant neon sign rips loose, crashes down and bursts into a shower of sparks',
  'a shockwave cracks the asphalt and blows the rain sideways in a huge ring',
  'a shop window explodes as someone is thrown straight through it',
  'a steam pipe bursts and engulfs the street in white steam lit by neon',
  'gravity flickers: debris floats for a moment, then everything slams back down',
];
const soundLine = () => (L.audio ? ` Sound: ${style().sound}.` : '');

// ---------- roster portraits (generated once per style, kept on disk forever) ----------
export async function generateRoster(sid = styleId(), only, force = false) {
  if (!live() || !STYLES[sid]) return 0;
  const st = STYLES[sid], todo = (force ? ROSTER : imgMissing(sid)).filter((c) => !only || c.id === only);
  log(`[roster] ${st.name}: generating ${todo.length} portraits (~$${(todo.length * EST.image).toFixed(3)})`);
  fs.mkdirSync(path.join(ROSTER_DIR, sid), { recursive: true });
  let ok = 0;
  await Promise.all(todo.map(async (c) => {
    try {
      const prompt = `${c.look}${st.twist ? ', ' + st.twist : ''}. Full body, standing in a confident wrestling pose, centered, facing the camera. ${st.look}. ${st.backdrop}.`;
      const { id, rec } = await submit({ model: IMG_MODEL, task_type: 'T2I', prompt, image_config: { width: 1024, height: 1024 } }, 'image', EST.image, `${sid}/${c.id}`);
      await wait(id, rec, 90000);
      const s = await save(id, 'png', 'roster'); fs.renameSync(s.file, imgFileFor(sid, c)); ok++;
    } catch (e) { log(`[roster] ${c.name}:`, e.message.slice(0, 120)); }
  }));
  return ok;
}
const refs = new Map(); // character id -> uploaded @input ref (reused across matches)
const imgRef = (c) => { if (!refs.has(c.id)) { const p = upload(imgFile(c)); refs.set(c.id, p); p.catch(() => refs.delete(c.id)); } return refs.get(c.id); };
export const prewarmRefs = (cs) => { for (const c of cs) if (live() && fs.existsSync(imgFile(c))) imgRef(c).catch(() => {}); };

// ---------- intro: both fighters in the same scene (R2V) ----------
export async function introClip(a, b) {
  if (!live() || !fs.existsSync(imgFile(a)) || !fs.existsSync(imgFile(b))) return null;
  const t0 = Date.now();
  try {
    const [ra, rb] = await Promise.all([imgRef(a), imgRef(b)]);
    const { id, rec } = await submitVideo({
      model: VID_MODEL, task_type: 'R2V',
      prompt: `Reference image 1 is the LEFT fighter: ${a.name}. Reference image 2 is the RIGHT fighter: ${b.name}. Both stand in the same rain-soaked neon street for the face-off. Dramatic entrance at full speed, NOT slow motion: lightning flashes, steam bursts from the grates, the crowd roars, both fighters stride fast toward each other, flex, glare and throw a quick taunt, with a fast push-in camera. Wide shot, both fully visible, each keeps their exact look. ${styleLine()}.${soundLine()}`,
      src_image_urls: [ra, rb], subject_to_image_ids: { left: [0], right: [1] },
      reference_order: [{ type: 'image', index: 0 }, { type: 'image', index: 1 }],
      video_config: { duration_secs: INTRO_SECS, height: 480, aspect_ratio: '16:9', audio: L.audio },
    }, 'intro', EST.videoPerSec * INTRO_SECS, 'R2V intro');
    await wait(id, rec, 120000);
    const clip = await save(id, 'mp4');
    log(`[intro] ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    return clip;
  } catch (e) { log('[intro]', e.message); return null; }
}

// ---------- chained beats ----------
async function lastFrameRef(clip) {
  const png = clip.file.replace(/\.mp4$/, '-last.png');
  await run('ffmpeg', ['-y', '-v', 'error', '-sseof', '-0.1', '-i', clip.file, '-frames:v', '1', png]);
  return upload(png);
}
// Timeline prompts: the 13s are split into three fast stages so the model cannot stretch one punch over the whole clip.
export function outcomeText(cls, a, b, finale, beat = 0) {
  const L_ = `${a.name} (left)`, R_ = `${b.name} (right)`, world = WORLD[beat % WORLD.length];
  const hit = (W, Lz) => `0-3s: ${W.name} charges in with a lightning-fast sprint and a spinning leap. 3-8s: signature move "${W.special}": ${W.spectacle}. Meanwhile ${world}. 8-13s: ${Lz.name} is blasted backwards through the air, crashes through debris and slides to a stop, while ${W.name} lands in a power pose and the crowd explodes.`;
  if (finale) {
    const W = cls === 'A' ? a : b, Lz = cls === 'A' ? b : a;
    return `FINAL KNOCKOUT. 0-3s: ${W.name} unleashes everything in a furious sprint. 3-8s: the ultimate "${W.special}": ${W.spectacle}, bigger than ever, the whole street erupts in a huge explosion with a blinding white flash. 8-13s: ${Lz.name} lies defeated on the ground in the smoking wreckage while ${W.name} stands over them roaring in victory.`;
  }
  if (cls === 'A') return hit(a, b);
  if (cls === 'B') return hit(b, a);
  return `Both fighters collide. 0-3s: ${L_} and ${R_} sprint at each other and leap. 3-8s: they clash mid-air in a gigantic shockwave, blasting a ring through the rain, and each unleashes a flurry of fast blows, with ${world}. 8-13s: both skid backwards on the asphalt, still standing, breathing hard, as sparks and debris rain down.`;
}
// One I2V per outcome class from the clip's last frame. Returns {A:Promise,B:Promise,tie:Promise}; each resolves to
// {url,file} or null (never rejects). Task records are kept in ._recs so unchosen branches can be cancelled.
export const branchPrompt = (cls, a, b, finale, beat) => `${PACE} Left: ${a.look}. Right: ${b.look}. ${outcomeText(cls, a, b, finale, beat)} Same two characters, same street. ${styleLine()}.${soundLine()}`;
export function branchClips(clip, classes, a, b, finale = false, beat = 0) {
  const ref = lastFrameRef(clip); ref.catch(() => {});
  const out = {}; Object.defineProperty(out, '_recs', { value: {}, enumerable: false });
  for (const cls of classes) {
    out[cls] = (async () => {
      const t0 = Date.now();
      try {
        const { id, rec } = await submitVideo({
          model: VID_MODEL, task_type: 'I2V',
          prompt: branchPrompt(cls, a, b, finale, beat),
          src_image_urls: [await ref],
          video_config: { duration_secs: CLIP_SECS, height: 480, aspect_ratio: '16:9', audio: L.audio },
        }, 'branch', EST.videoPerSec * CLIP_SECS, `${finale ? 'finale ' : ''}${cls}`);
        out._recs[cls] = rec;
        const j = await wait(id, rec, 120000);
        const c = await save(id, 'mp4');
        const secs = (Date.now() - t0) / 1000; L.stats.branchSecs.push(secs); if (L.stats.branchSecs.length > 50) L.stats.branchSecs.shift();
        log(`[branch ${cls}${finale ? ' finale' : ''}] ${secs.toFixed(1)}s (queue ${j.queue_time_secs?.toFixed?.(1)} gen ${j.generation_time_secs?.toFixed?.(1)})`);
        return c;
      } catch (e) { if (e.message !== 'canceled') log(`[branch ${cls}]`, e.message); return null; }
    })();
  }
  return out;
}
// after a branch is chosen, ask the provider to drop the others (cancelling a still-queued task refunds it)
export function cancelBranches(branches, except) { if (!branches) return; for (const [cls, rec] of Object.entries(branches._recs)) if (cls !== except) cancelRec(rec); }
