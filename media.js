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
export const live = () => !!key(); // there is no mock mode: video is always generated for real

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
const PACE = 'FAST-PACED real-time action at full speed, NOT slow motion, quick explosive movement, rapid camera moves (whip pan, fast push-in, low-angle tracking). Keep the camera wide: BOTH fighters stay visible in the frame for the whole clip, no long close-ups, and nobody leaves the scene.';
const shuffle = (arr) => { const x = [...arr]; for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };
const bag = (arr) => { let q = []; return () => { if (!q.length) q = shuffle(arr); return q.pop(); }; }; // draws without repeating until the pool is used up
const pickOne = (arr) => arr[Math.floor(Math.random() * arr.length)];
const WORLD = [ // the street itself takes part in the fight
  'a parked car is launched into the air and explodes in a fireball',
  'a giant neon sign rips loose, crashes down and bursts into a shower of sparks',
  'a shockwave cracks the asphalt and blows the rain sideways in a huge ring',
  'a shop window explodes and glass hangs in the air for an instant',
  'a steam pipe bursts and engulfs the street in white steam lit by neon',
  'gravity flickers: debris floats for a moment, then everything slams back down',
  'a transformer on a pole blows up and rains blue sparks over the fighters',
  'a delivery truck skids sideways and smashes through a row of market stalls',
  'the road splits open and a jet of steam and light shoots out of the crack',
  'a bus shelter folds in half and a hundred umbrellas whirl up into the storm',
  'a fire hydrant shoots a column of water that turns to neon mist',
  'an overhead billboard flickers, glitches and falls apart in pixels',
];
const CAMERAS = [
  'a fast whip-pan follows the action', 'a low-angle tracking shot races alongside the fighters', 'a fast push-in toward the impact that ends in a wide shot with both fighters visible',
  'an overhead drone dive that swoops down and stays wide so both fighters remain visible', 'a handheld camera that shakes with every impact and always keeps both fighters in frame',
  'a sweeping orbit around the two fighters', 'a ground-level wide shot where debris flies past the lens and both fighters stay visible',
];
const OPENERS = [
  'both fighters trade a burst of fast blows and shoves', 'they circle for a heartbeat, then one fighter explodes into motion',
  'the fighters clash and break apart, sliding back across the wet asphalt', 'one fighter feints and the other reads it, both reset in a blur',
  'a rapid exchange of strikes that neither can finish', 'one fighter backs away, baiting the other into a charge',
];
const ENDINGS = [ // the winner
  'stands tall and roars as the crowd erupts', 'flexes at the camera and wipes the rain from their face', 'points at the defeated opponent with a smirk as sparks rain down',
  'stands in the smoke and slowly cracks their neck', 'raises both arms to the cheering crowd', 'kicks a piece of debris away and stares down the camera',
];
const LOSERS = [ // the loser
  'is blasted backwards through a neon sign and slides to a stop', 'crashes into a bus shelter and shatters it', 'slams into the crowd barrier and drops to one knee',
  'flips over a car and crashes onto the asphalt', 'is thrown through a shop window in an explosion of glass', 'skids across the wet street and spins to a stop, still conscious',
  'is launched into a stack of crates that bursts apart',
];
const KO = [ // the final knockout
  'is blasted through the wall of a building and the whole facade collapses', 'is slammed into the asphalt, creating a crater, and lies still',
  'is thrown into the air and crashes through a giant neon billboard', 'is lifted off the ground by the explosion and slumps against a wrecked car',
];
// Set pieces: how the exchange is choreographed. `c` is the clause that says WHICH move lands (special, normal attack or counter).
const PIECES = [
  (W, L, c) => `${W.name} chases ${L.name} down the neon street at full sprint, vaults a parked car and finishes the exchange. ${c}`,
  (W, L, c) => `${W.name} launches off a parked van high into the air and comes down like a meteor on ${L.name}. ${c}`,
  (W, L, c) => `${W.name} rips a street lamp out of the ground and swings it; ${L.name} ducks, and ${W.name} follows through. ${c}`,
  (W, L, c) => `both fighters unleash everything and their attacks collide in the middle of the street in a blinding flash; ${W.name}'s attack overpowers ${L.name}'s. ${c}`,
  (W, L, c) => `${L.name} charges, ${W.name} slips aside at the last instant and strikes back. ${c}`,
  (W, L, c) => `the fight goes airborne: they leap between the buildings trading blows until ${W.name} breaks through. ${c}`,
  (W, L, c) => `${W.name} runs along a wall, flips off it and attacks from the side. ${c}`,
  (W, L, c) => `${W.name} grabs ${L.name} by surprise, spins and hurls them through the air. ${c}`,
  (W, L, c) => `${W.name} drops out of the rain from above, ambushing ${L.name}. ${c}`,
  (W, L, c) => `${W.name} bursts forward through a curtain of steam and the two collide. ${c}`,
];
const INTROS = [
  'both fighters stride out of opposite sides of the steam-filled street toward the center', 'a spotlight cuts through the rain and reveals both fighters standing face to face',
  'lightning flashes and both fighters drop down from the rooftops into the street', 'the crowd roars as both fighters rise slowly into a fighting stance and lock eyes',
  'they circle each other slowly, one flicks a taunt and the other answers with a grin',
];
const ARC = [ // the story of the match: every round has its own role
  'Round 1: the opening exchange, the two fighters test each other, tense and fast, first real contact.',
  'Round 2: escalation, both fighters go harder and the fight spills across the whole street.',
  'Round 3: chaos, the street itself becomes part of the fight.',
  'Round 4: desperation, whoever is behind fights wilder and dirtier.',
  'Round 5: the climax, everything is at stake, bigger, faster, more extreme.',
];
// One deck per match: every round draws its own set piece, camera, street event, ending... without repeats.
export function newDeck() {
  const piece = bag(PIECES.map((_, i) => i)), world = bag(WORLD), camera = bag(CAMERAS), opener = bag(OPENERS), ending = bag(ENDINGS), loser = bag(LOSERS), ko = bag(KO);
  return { plan: (beat) => ({ beat, piece: piece(), world: world(), camera: camera(), opener: opener(), ending: ending(), loser: loser(), ko: ko() }) };
}
// Which move the clip shows (the audience's vote only decides the winner): mostly specials, but also plain attacks and counters.
export const rollKind = (finale) => (finale ? 'special' : pickOne(['special', 'special', 'attack', 'attack', 'counter']));
const movePhrase = (W, kind) => (kind === 'special' ? `${W.name} unleashes the signature move "${W.special}": ${W.spectacle}.` : kind === 'attack' ? `${W.name} lands ${pickOne(W.attacks)}.` : `${W.name} ${pickOne(W.counters)}.`);
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
      prompt: `Reference image 1 is the LEFT fighter: ${a.name}. Reference image 2 is the RIGHT fighter: ${b.name}. Both are in the same rain-soaked neon street for the face-off. Dramatic entrance at full speed, NOT slow motion: ${pickOne(INTROS)}; ${pickOne(CAMERAS)}. They flex, glare and throw a quick taunt. Both fighters stay fully visible, each keeps their exact look. ${styleLine()}.${soundLine()}`,
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
// `plan` (from the deck) and `kind` make every clip tell a different story; the same plan is used for every possible outcome of a round.
export function outcomeText(cls, a, b, finale, beat = 0, plan = null, kind = 'special') {
  plan = plan || newDeck().plan(beat);
  const who = `${a.name} is ${a.short}; ${b.name} is ${b.short}.`; // said once, so the video model never mixes up who is who
  const arc = ARC[Math.min(beat, ARC.length - 1)];
  if (finale) {
    const W = cls === 'A' ? a : b, Lz = cls === 'A' ? b : a;
    return `FINAL KNOCKOUT. ${who} 0-3s: ${W.name} unleashes everything in a furious sprint while ${plan.camera}. 3-8s: the ultimate "${W.special}": ${W.spectacle}, bigger than ever, the whole street erupts in a huge explosion with a blinding white flash. 8-13s: ${Lz.name} ${plan.ko}, then lies defeated in the smoking wreckage while ${W.name} ${plan.ending}.`;
  }
  if (cls === 'A' || cls === 'B') {
    const W = cls === 'A' ? a : b, Lz = cls === 'A' ? b : a;
    return `${arc} ${who} Camera: ${plan.camera}. 0-3s: ${plan.opener}. 3-8s: ${PIECES[plan.piece](W, Lz, movePhrase(W, kind))} Meanwhile ${plan.world}. 8-13s: ${Lz.name} ${plan.loser}, while ${W.name} ${plan.ending}; both are visible in the final frames and ${W.name} is clearly the winner.`;
  }
  return `${arc} ${who} Camera: ${plan.camera}. 0-3s: ${plan.opener}. 3-8s: ${a.name} and ${b.name} collide head-on and clash in a gigantic shockwave that blasts a ring through the rain, each landing a flurry of fast blows, and ${plan.world}. 8-13s: both skid backwards on the asphalt, still standing, breathing hard, as sparks and debris rain down.`;
}
export const branchPrompt = (cls, a, b, finale, beat, plan, kind) => `${PACE} Left: ${a.look}. Right: ${b.look}. ${outcomeText(cls, a, b, finale, beat, plan, kind)} Same two characters, same street. ${styleLine()}.${soundLine()}`;
export function branchClips(clip, classes, a, b, finale = false, beat = 0, plan = null) {
  const ref = lastFrameRef(clip); ref.catch(() => {});
  const out = {}; Object.defineProperty(out, '_recs', { value: {}, enumerable: false });
  const kinds = {}; Object.defineProperty(out, '_meta', { value: kinds, enumerable: false });
  for (const cls of classes) kinds[cls] = { kind: rollKind(finale) };
  for (const cls of classes) {
    out[cls] = (async () => {
      const t0 = Date.now();
      try {
        const { id, rec } = await submitVideo({
          model: VID_MODEL, task_type: 'I2V',
          prompt: branchPrompt(cls, a, b, finale, beat, plan, kinds[cls].kind),
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
