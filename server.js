import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { exec, execFile } from 'node:child_process';
import QRCode from 'qrcode';
import * as media from './media.js';
import * as audio from './audio.js';
import { HOST, TAUNTS, announce, replayReaction, finaleLines } from './lines.js';
import { ROSTER, byId, pub, imgMissing, STYLES, styleId, setStyle, styleGallery } from './roster.js';
import { L, EST, spent, byKind, log } from './ledger.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(path.join(ROOT, '.env')); } catch {}
let PORT = Number(process.env.PORT || 3000);
const FAST = process.env.FAST === '1' || process.argv.includes('--fast');
const T = { cast: FAST ? 12e3 : 25e3, introMax: 45e3, mockBeat: FAST ? 8e3 : 15e3 };
const BEATS = 6, TAP_REF = 20, TAP_CAP = 60, LOCK_MS = 1500, HOLD_MAX_MS = 4000, CALL_MS = 7000, TAUNT_CD = 3000, SIDE_CD = 3000;
const CLIP_MS = media.CLIP_SECS * 1000, INTRO_MS = media.INTRO_SECS * 1000;
let server; // beat length without generated video = T.mockBeat
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sleepUntil = (t) => sleep(Math.max(0, t - Date.now()));
const rnd = (a) => a[Math.floor(Math.random() * a.length)];
const MOVES = ['attacco', 'guardia', 'speciale'];   // internal ids: attack / guard / special
const MOVE_BEATS = { attacco: 'speciale', speciale: 'guardia', guardia: 'attacco' };
const CORNER = { A: 'Pink', B: 'Cyan' };

// ---------- recorded match (replay): real clips from a LIVE run, played free of charge when we are not LIVE ----------
const REPLAY_DIR = path.join(ROOT, 'media', 'replay');
let REPLAY = null; try { REPLAY = JSON.parse(fs.readFileSync(path.join(REPLAY_DIR, 'manifest.json'), 'utf8')); } catch {}
const replayOn = () => !!REPLAY && !media.live();
const replayClip = (i) => { const c = REPLAY && REPLAY.clips[i]; return c ? { url: `/media/replay/${c.file}`, file: null } : null; };
function replayBranches(k) { // same shape as media.branchClips; whatever outcome is asked for, the recorded next clip comes back (the outcome is forced to match it)
  const out = {}; Object.defineProperty(out, '_recs', { value: {}, enumerable: false });
  const clip = replayClip(k + 1); for (const c of ['A', 'B', 'tie']) out[c] = Promise.resolve(clip);
  return out;
}
function applyReplayFighters() { // the recorded video shows these two, so these two fight
  const a = byId(REPLAY.fighters.A), b = byId(REPLAY.fighters.B);
  [[S.teams.A, a], [S.teams.B, b]].forEach(([x, c]) => { x.char = c; x.hp = x.maxhp = c.stats.hp; x.stats = { atk: c.stats.atk, spec: c.stats.spec }; });
}

// ---------- state ----------
let S, players = new Map(), clients = new Set(), timer = null, runId = 0, videoSeq = 0, sayN = 0, fxN = 0, sayAt = 0, retortAt = 0;
const newSide = () => ({ char: null, hp: 100, maxhp: 100, stats: null, tapsBeat: 0, charge: 0, tilt: 0 });
function fresh() {
  runId++; media.cancelAll(); // a reset also drops any task that is still queued
  S = { phase: 'lobby', ends: 0, beat: 0, beatPhase: null, last: null, winner: null, mvp: null, teams: { A: newSide(), B: newSide() }, gen: 'idle', replay: false, liveError: null, forceWin: null, video: { seq: 0, url: null }, next: null, intro: null, live: false, says: [], call: null, fx: null };
  for (const p of players.values()) { p.vote = null; p.team = null; p.taps = 0; p.tapsBeat = 0; p.move = null; p.tauntAt = 0; }
}
fresh();

const members = (t) => [...players.values()].filter((p) => p.team === t);
const smallerSide = () => { const a = members('A').length, b = members('B').length; return a === b ? rnd(['A', 'B']) : a < b ? 'A' : 'B'; };
function join(id) {
  if (id && players.has(id)) return players.get(id);
  const p = { id: id && /^[\w-]{6,40}$/.test(id) ? id : Math.random().toString(36).slice(2, 10), vote: null, team: null, taps: 0, tapsBeat: 0, move: null, bot: false, tauntAt: 0, sideAt: 0 };
  players.set(p.id, p);
  if (S.phase === 'generating' || S.phase === 'fight') p.team = smallerSide(); // late joiners get a side
  return p;
}
const voteCounts = () => { const o = {}; for (const p of players.values()) if (p.vote) o[p.vote] = (o[p.vote] || 0) + 1; return o; };

// ---------- snapshot / push ----------
const callActive = (type, team) => S.call && S.call.type === type && Date.now() < S.call.until && (S.call.team === 'both' || S.call.team === team);
function movesTally(k) { const o = { attacco: 0, guardia: 0, speciale: 0 }; for (const p of members(k)) if (p.move) o[p.move] += p.w || 1; return o; }
const callView = () => (S.call && Date.now() < S.call.until ? { type: S.call.type, team: S.call.team, text: S.call.text, rem: S.call.until - Date.now(), seq: S.call.seq } : null);
const rosterView = () => { const v = voteCounts(); return ROSTER.map((c) => ({ ...pub(c), votes: v[c.id] || 0 })); };
function snap(p) {
  const t = S.teams;
  const view = (x, k) => ({ n: members(k).length, corner: CORNER[k], name: x.char ? x.char.name : CORNER[k], char: x.char ? pub(x.char) : null, special: x.char?.special || 'Special', hp: Math.round(x.hp), maxhp: x.maxhp, charge: +x.charge.toFixed(2), tilt: +x.tilt.toFixed(2), moveVotes: movesTally(k) });
  return {
    phase: S.phase, rem: Math.max(0, S.ends - Date.now()), beat: S.beat, beats: BEATS, beatPhase: S.beatPhase, last: S.last, winner: S.winner, mvp: S.mvp, gen: S.gen, live: S.live,
    video: S.video, next: S.next, says: S.says, call: callView(), fx: S.fx, roster: rosterView(), taunts: TAUNTS.map(({ id, short }) => ({ id, short })), A: view(t.A, 'A'), B: view(t.B, 'B'), players: players.size,
    you: p ? { id: p.id, team: p.team, vote: p.vote, move: p.move, taps: p.taps } : null,
  };
}
// local-only streams: the simulator wall and the debug panel
const simClients = new Set(), dbgClients = new Set();
function simSnap() {
  const t = S.teams, v = (x, k) => ({ n: members(k).length, name: x.char ? x.char.name : CORNER[k], hp: Math.round(x.hp), maxhp: x.maxhp, charge: +x.charge.toFixed(2) });
  return { phase: S.phase, beat: S.beat, beatPhase: S.beatPhase, rem: Math.max(0, S.ends - Date.now()), winner: S.winner, call: callView(), roster: rosterView(), A: v(t.A, 'A'), B: v(t.B, 'B'),
    players: [...players.values()].filter((p) => p.sim).map((p) => ({ id: p.id, team: p.team, vote: p.vote, move: p.move, taps: p.taps })) };
}
function dbgSnap() {
  const miss = audio.missing(), br = L.stats.branchSecs, branchN = (BEATS - 1) * (L.economy ? 2 : 3) + 2, rm = imgMissing();
  const projected = EST.videoPerSec * media.INTRO_SECS + branchN * EST.videoPerSec * media.CLIP_SECS;
  return {
    phase: S.phase, beat: S.beat, beatPhase: S.beatPhase, players: players.size, sim: [...players.values()].filter((p) => p.sim).length, live: media.live(),
    halted: L.halted, voice: L.voice, voiceProvider: audio.provider(), cap: L.cap, spent: +spent().toFixed(3), byKind: byKind(), economy: L.economy, audio: L.audio,
    inflight: L.inflight.size, projected: +projected.toFixed(2), branchN, stats: { holds: L.stats.holds, fallbacks: L.stats.fallbacks, avgBranch: br.length ? +(br.reduce((a, b) => a + b, 0) / br.length).toFixed(1) : null, maxBranch: br.length ? +Math.max(...br).toFixed(1) : null },
    audioMissing: { n: miss.length, est: +(miss.length * EST.tts).toFixed(2) }, roster: { have: ROSTER.length - rm.length, total: ROSTER.length, est: +(rm.length * EST.image).toFixed(3) },
    style: styleId(), styles: Object.entries(STYLES).map(([id, s]) => [id, s.name]),
    replay: replayOn(), replayAvail: !!REPLAY, replayFighters: REPLAY ? REPLAY.fighters : null, liveError: S.liveError, notLive: media.live() ? null : (!process.env.MACHGEN_API_KEY ? 'There is no MACHGEN_API_KEY in .env, so no video can be generated.' : (L.mock ? 'You switched to REPLAY (recorded video). Press LIVE to go back.' : 'Mock flag set at startup (--mock or MOCK=1).')),
    crowd: crowd.size, fast: T.cast <= 12e3, mock: L.mock, forceWin: S.forceWin, castSecs: T.cast / 1000, bots: [...players.values()].filter((x) => x.bot).length, adminPin: !!process.env.ADMIN_PIN,
    rosterList: ROSTER.map((c) => ({ id: c.id, name: c.name })), taunts: TAUNTS.map((t) => t.id),
    fighters: { A: fighterDbg('A'), B: fighterDbg('B') }, hostEvents: Object.keys(HOST),
    items: L.items.slice(-30).reverse().map((r) => ({ n: r.n, kind: r.kind, label: r.label, usd: +(r.actual ?? r.est).toFixed(3), real: r.actual != null, status: r.status, age: Math.round((Date.now() - r.t0) / 1000) })),
    logs: L.logs.slice(-40),
  };
}
const fighterDbg = (k) => { const x = S.teams[k]; return { id: x.char?.id || null, name: x.char?.name || null, hp: Math.round(x.hp), maxhp: x.maxhp, charge: +x.charge.toFixed(2), tilt: +x.tilt.toFixed(2), n: members(k).length }; };
async function preflight() { // is everything in place for a LIVE demo? (never reveals the keys)
  const ck = (name, ok, detail) => ({ name, ok, detail });
  const ffmpeg = await new Promise((r) => execFile('ffmpeg', ['-version'], (e) => r(!e)));
  const rm = imgMissing();
  return [
    ck('Mode is LIVE', media.live(), media.live() ? 'real video, real voices' : 'NOT LIVE: ' + (!process.env.MACHGEN_API_KEY ? 'no MACHGEN_API_KEY in .env' : L.mock ? 'switched to replay' : 'mock flag at startup')),
    ck('MachGen key (video)', !!process.env.MACHGEN_API_KEY, process.env.MACHGEN_API_KEY ? 'present' : 'missing in .env'),
    ck('ElevenLabs key (voices)', audio.provider() === 'elevenlabs', audio.provider() === 'elevenlabs' ? 'present: character voices' : 'missing: flat fallback voices'),
    ck('ffmpeg (chains the clips)', ffmpeg, ffmpeg ? 'installed' : 'NOT FOUND: install it with: brew install ffmpeg'),
    ck('Portraits', rm.length === 0, `${ROSTER.length - rm.length}/${ROSTER.length} in media/roster`),
    ck('Spend cap', !L.halted && spent() < L.cap, L.halted ? 'HALTED: press Resume' : `$${spent().toFixed(2)} of $${L.cap}`),
    ck('Phones can join at', true, `${publicUrl()}/  (same Wi-Fi or a hotspot)`),
    ck('Server port', true, String(PORT)),
  ];
}
function push() {
  for (const c of clients) { try { c.res.write(`data: ${JSON.stringify(snap(c.pid && players.get(c.pid)))}\n\n`); } catch {} }
  if (simClients.size) { const d = `data: ${JSON.stringify(simSnap())}\n\n`; for (const r of simClients) { try { r.write(d); } catch {} } }
}
setInterval(() => { if (clients.size || simClients.size) push(); }, 500);
setInterval(() => { if (dbgClients.size) { const d = `data: ${JSON.stringify(dbgSnap())}\n\n`; for (const r of dbgClients) { try { r.write(d); } catch {} } } }, 1000);

// ---------- commentator + character voices ----------
const lastLine = {};
function say(event, force = false) {
  const now = Date.now(); if (!force && now - sayAt < 6500) return;
  const arr = HOST[event]; if (!arr) return;
  let l = rnd(arr); if (arr.length > 1 && l.t === lastLine[event]) l = arr.find((x) => x.t !== lastLine[event]);
  lastLine[event] = l.t; sayAt = now;
  if (l.action) S.call = { type: l.action, team: l.team, text: l.call, until: now + CALL_MS, seq: sayN + 1 }; // the call-out starts at once
  speak('host', 'host', l.t);
}
const charSay = (team, key) => { const c = S.teams[team].char; if (c) { sayAt = Date.now(); speak(c.voice, team, c.lines[key]); } };
// Speech is AUDIO ONLY (no subtitles anywhere). who = 'host' | 'A' | 'B'. Cached audio plays at once; otherwise the line is
// generated now (once, ~2-3s, then cached forever). `prep` is an already-running ensure() started earlier (live commentary).
function speak(voiceKey, who, text, prep) {
  const show = (url) => { S.says.push({ seq: ++sayN, who, url }); if (S.says.length > 8) S.says.shift(); push(); };
  const url = audio.cachedUrl(voiceKey, text);
  if (url || !L.voice || !media.live()) return show(url);
  Promise.race([prep || audio.ensure(voiceKey, text), sleep(4500).then(() => null)]).then(show);
}
// ---- live commentary: the host's lines are composed from what is actually happening, then voiced ----
const pickOne = (a) => a[Math.floor(Math.random() * a.length)];
function planReplayReaction(r) {
  const ca = S.teams.A.char, cb = S.teams.B.char;
  if (r.beat === BEATS) return pickOne(finaleLines(r.cls === 'A' ? ca : cb));
  return pickOne(replayReaction(r.cls === 'A' ? ca : cb, r.cls === 'A' ? cb : ca));
}
function planReaction(r) {
  const a = S.teams.A, b = S.teams.B, ca = a.char, cb = b.char;
  const ha = Math.max(0, a.hp - r.dB), hb = Math.max(0, b.hp - r.dA);
  if (r.beat === BEATS) { const w = r.cls === 'A' ? ca : cb; return pickOne([`[shouting, ecstatic] IT IS OVER! [gasps] ${w.name} takes the match! WHAT a fight!`, `[shouting] AND THAT IS THE KNOCKOUT! [laughs] ${w.name} wins it ALL!`]); }
  if (r.win === 'tie') return pickOne([`[gasps] They COLLIDE in the middle! [shouting] ${ca.name} against ${cb.name}, and nobody gives an inch!`, `[excited] WOW, a perfect clash! ${ca.name} and ${cb.name} are trading blows!`]);
  const W = r.win === 'A' ? ca : cb, Lc = r.win === 'A' ? cb : ca, dmg = r.win === 'A' ? r.dA : r.dB, lhp = r.win === 'A' ? hb : ha, mv = r.win === 'A' ? r.ma : r.mb;
  const what = mv === 'speciale' ? W.special : mv === 'attacco' ? 'a brutal strike' : 'a perfect counter';
  let t = pickOne([`[shouting] OH! [gasps] ${W.name} lands ${what}! ${dmg} damage! ${Lc.name} is down to ${lhp}!`, `[shouting, amazed] OH MY! ${what} from ${W.name}! [laughs] ${Lc.name} has only ${lhp} left!`, `[excited] WHAT a hit! ${W.name} uses ${what} for ${dmg}! [gasps] ${Lc.name} drops to ${lhp}!`]);
  if (lhp / (r.win === 'A' ? b.maxhp : a.maxhp) < 0.3) t += ` [worried, breathless] ${Lc.name} is in SERIOUS trouble!`;
  return t;
}
function callout(k) { // the host talks to the crowd and asks them to do something
  const a = S.teams.A, b = S.teams.B;
  const ev = { 2: 'call_taunt', 3: 'call_tap', 4: a.hp < b.hp ? 'call_A' : 'call_B', 5: 'call_taunt', 6: 'call_tap' }[k];
  if (ev) say(ev, true);
}

// ---------- phases ----------
function setPhase(phase, ms = 0) { clearTimeout(timer); S.phase = phase; S.ends = ms ? Date.now() + ms : 0; push(); }
const after = (ms, fn) => { clearTimeout(timer); S.ends = Date.now() + ms; timer = setTimeout(fn, ms); };

function startCasting() { // everyone votes for the character they like most
  for (const p of players.values()) { p.vote = null; p.team = null; }
  S.teams.A = newSide(); S.teams.B = newSide();
  setPhase('casting', T.cast); after(T.cast, endCasting);
}
function endCasting() { // the two most voted characters fight; everyone then backs one of them
  const v = voteCounts(), order = [...ROSTER].sort(() => Math.random() - 0.5).sort((a, b) => (v[b.id] || 0) - (v[a.id] || 0));
  [S.teams.A, S.teams.B].forEach((x, i) => { const c = order[i]; x.char = c; x.hp = x.maxhp = c.stats.hp; x.stats = { atk: c.stats.atk, spec: c.stats.spec }; });
  if (replayOn()) { const was = `${S.teams.A.char.name} vs ${S.teams.B.char.name}`; applyReplayFighters(); if (was !== `${S.teams.A.char.name} vs ${S.teams.B.char.name}`) log(`[replay] the recorded fight is ${S.teams.A.char.name} vs ${S.teams.B.char.name} (the vote picked ${was})`); }
  const A = S.teams.A.char, B = S.teams.B.char;
  for (const p of players.values()) p.team = p.kbd ? p.id.slice(-1) : p.vote === A.id ? 'A' : p.vote === B.id ? 'B' : null;
  for (const p of players.values()) if (!p.team) p.team = smallerSide(); // everyone else: the side with fewer fans
  log(`[cast] ${A.name} vs ${B.name} (votes ${v[A.id] || 0} / ${v[B.id] || 0})`);
  startGenerating();
}
async function startGenerating() {
  const id = runId, A = S.teams.A.char, B = S.teams.B.char;
  setPhase('generating'); S.gen = 'working';
  const t0 = Date.now(); media.prewarmRefs([A, B]);
  if (media.live()) {
    S.intro = await Promise.race([media.introClip(A, B), sleep(T.introMax).then(() => null)]);
    if (!S.intro) { S.liveError = 'The intro video could not be generated, so this match has no video. Check the log, then Reset and run it again.'; log('[LIVE] intro video failed: ' + S.liveError); }
  } else if (REPLAY) { await sleep(2500); S.intro = replayClip(0); S.replay = true; }
  else await sleep(3500);
  if (id !== runId) return;
  S.gen = 'done'; S.live = !!S.intro;
  log(`[gen] ready in ${((Date.now() - t0) / 1000).toFixed(1)}s | video ${S.live ? 'LIVE chain' : 'mock'}`);
  runFight();
}

// ---------- the fight: one continuous video made of chained clips ----------
const pickMove = (k) => { const v = movesTally(k); const best = Math.max(...MOVES.map((m) => v[m])); return rnd(MOVES.filter((m) => v[m] === best)); };
function gatherVotes() { // read votes + taps of the closing window
  const a = S.teams.A, b = S.teams.B;
  const na = Math.max(1, members('A').length), nb = Math.max(1, members('B').length);
  a.charge = Math.min(1, a.tapsBeat / (na * TAP_REF)); b.charge = Math.min(1, b.tapsBeat / (nb * TAP_REF));
  a.tapsBeat = b.tapsBeat = 0; for (const p of players.values()) p.tapsBeat = 0;
  const ma = pickMove('A'), mb = pickMove('B');
  return { ma, mb, win: ma === mb ? 'tie' : MOVE_BEATS[ma] === mb ? 'A' : 'B', tiltA: a.tilt, tiltB: b.tilt };
}
function computeBeat(k, g, forceWin) { // outcome of beat k (nothing applied yet); forceWin = branch actually available
  const a = S.teams.A, b = S.teams.B;
  const { ma, mb } = g, win = forceWin || g.win;
  const rubber = (x, y) => (x.hp < y.hp ? 1.25 : 1);
  const dmg = (x, y, mv, kk, tilt) => {
    const mult = win === 'tie' ? 0.6 : win === kk ? 1.4 : 0.15, st = mv === 'speciale' ? x.stats.spec : x.stats.atk;
    return Math.round(11 * st * (1 + 0.8 * x.charge) * rubber(x, y) * mult * (1 - 0.8 * tilt) * (k === BEATS ? 2 : 1));
  };
  const dA = dmg(a, b, ma, 'A', g.tiltA), dB = dmg(b, a, mb, 'B', g.tiltB); // dA = damage A deals to B
  let cls = win;
  if (k === BEATS) { // finale: the video must show whoever ends with more HP winning
    const ha = a.hp - dB, hb = b.hp - dA;
    cls = ha === hb ? (a.charge >= b.charge ? 'A' : 'B') : ha > hb ? 'A' : 'B';
  }
  return { beat: k, ma, mb, win, dA, dB, ca: a.charge, cb: b.charge, cls };
}
function applyBeat(r) {
  const a = S.teams.A, b = S.teams.B;
  b.hp = Math.max(0, b.hp - r.dA); a.hp = Math.max(0, a.hp - r.dB);
  a.charge = r.ca; b.charge = r.cb; a.tilt *= 0.5; b.tilt *= 0.5; // taunts wear off
  S.last = { beat: r.beat, ma: r.ma, mb: r.mb, win: r.win, dA: r.dA, dB: r.dB, ca: r.ca, cb: r.cb };
}
function playClip(c) { S.video = { seq: ++videoSeq, url: c ? c.url : null }; S.next = null; push(); }

async function runFight() {
  const id = runId, alive = () => id === runId && S.phase === 'fight';
  const A = S.teams.A.char, B = S.teams.B.char;
  setPhase('fight'); S.beat = 0; S.last = null; S.winner = null;
  let useVideo = !!S.intro, len = useVideo ? INTRO_MS : T.mockBeat, P = Date.now(); // P = start of the clip now on screen
  playClip(S.intro);
  const classes = () => (L.economy ? ['A', 'B'] : ['A', 'B', 'tie']);
  let branches = useVideo ? (S.replay ? replayBranches(0) : media.branchClips(S.intro, classes(), A, B, false, 0)) : null;
  // the host introduces the fighters, then each says their catchphrase
  [[800, () => { sayAt = Date.now(); speak('host', 'host', announce('A', A)); }], [4200, () => { sayAt = Date.now(); speak('host', 'host', announce('B', B)); }],
    [7600, () => charSay('A', 'entrance')], [10600, () => charSay('B', 'entrance')]].forEach(([ms, fn]) => setTimeout(() => alive() && S.beat === 1 && fn(), ms));
  for (let k = 1; k <= BEATS; k++) {
    // the audience votes while the previous clip is playing...
    S.beat = k; S.beatPhase = 'vote'; for (const p of players.values()) p.move = null;
    const close = P + len - LOCK_MS; S.ends = close; push();
    if (k >= 2) setTimeout(() => alive() && S.beatPhase === 'vote' && S.beat === k && callout(k), 4500);
    await sleepUntil(close); if (!alive()) return;
    // ...votes lock just before it ends; pick the branch that was already rendering
    S.beatPhase = 'lock'; push();
    const g = gatherVotes();
    let r = computeBeat(k, g), clip = null;
    if (S.replay && REPLAY.clips[k]) { r = computeBeat(k, g, REPLAY.clips[k].cls); r.cls = REPLAY.clips[k].cls; } // the outcome follows the recorded clip
    else if (S.forceWin) { r = computeBeat(k, g, S.forceWin); log(`[control] outcome of round ${k} forced to ${S.forceWin}`); S.forceWin = null; }
    if (r.cls === 'tie' && branches && !branches.tie) r = computeBeat(k, g, g.ca >= g.cb ? 'A' : 'B'); // economy mode: no tie branch
    if (branches) {
      const want = branches[r.cls], deadline = P + len + HOLD_MAX_MS;
      clip = await Promise.race([want, sleepUntil(deadline).then(() => 'late')]);
      if (clip === 'late' && k < BEATS) { // chosen branch is late: play the first branch that is ready, outcome follows the video
        const others = Object.entries(branches).filter(([c]) => c !== r.cls);
        const ready = await Promise.race([...others.map(([c, p]) => p.then((x) => (x ? { c, x } : new Promise(() => {})))), want.then((x) => ({ c: r.cls, x }))]);
        if (ready.c !== r.cls) { L.stats.fallbacks++; log(`[fallback] beat ${k}: wanted ${r.cls}, branch ${ready.c} was ready first`); r = computeBeat(k, g, ready.c); }
        clip = ready.x;
      } else if (clip === 'late') clip = await want; // finale: never swap the winner
      if (!alive()) return;
      if (Date.now() > P + len) { L.stats.holds++; log(`[hold] beat ${k}: video held ${((Date.now() - P - len) / 1000).toFixed(1)}s on the last frame`); }
      if (!clip) useVideo = false; // chain broken: finish the fight on the HUD only
      if (clip) { S.next = { seq: videoSeq + 1, url: clip.url }; push(); }
      media.cancelBranches(branches, r.cls); // unchosen branches: cancel if still queued (refunded)
    }
    // chain on immediately: next branches start from this clip's last frame, while it is still waiting to play
    branches = clip && k < BEATS ? (S.replay ? replayBranches(k) : media.branchClips(clip, k + 1 === BEATS ? ['A', 'B'] : classes(), A, B, k + 1 === BEATS, k)) : null;
    // live commentary: compose the line now and start voicing it, so the audio is ready when the clip starts
    const plan = S.replay ? planReplayReaction(r) : planReaction(r), prep = L.voice && media.live() && !audio.cachedUrl('host', plan) ? audio.ensure('host', plan) : null;
    await sleepUntil(P + len); if (!alive()) return;
    applyBeat(r); if (k === BEATS) { S.winner = r.cls; if (S.replay) S.teams[r.cls === 'A' ? 'B' : 'A'].hp = 0; }
    P = Date.now(); len = clip ? CLIP_MS : (S.live ? CLIP_MS : T.mockBeat);
    playClip(clip);
    sayAt = Date.now(); speak('host', 'host', plan, prep);
    if (k === BEATS) setTimeout(() => alive() && charSay(S.winner, 'win'), 5500);
  }
  S.beatPhase = 'finale'; S.ends = P + len; push();
  await sleepUntil(P + len); if (!alive()) return;
  finish();
}
function finish() {
  const a = S.teams.A, b = S.teams.B;
  if (!S.winner) S.winner = a.hp === b.hp ? (a.charge >= b.charge ? 'A' : 'B') : a.hp > b.hp ? 'A' : 'B';
  const top = [...players.values()].sort((x, y) => y.taps - x.taps)[0];
  S.mvp = top ? { team: top.team, taps: top.taps, bot: top.bot } : null;
  S.beatPhase = null; setPhase('result'); media.cancelAll(); say('outro', true);
}

// ---------- actions ----------
function castVote(p, cid) { if (S.phase === 'casting' && byId(cid)) p.vote = cid; }
function setSide(p, side) { // switch whom you push for (3s cooldown)
  const now = Date.now();
  if (!['A', 'B'].includes(side) || !['generating', 'fight'].includes(S.phase) || now - p.sideAt < SIDE_CD) return;
  p.sideAt = now; p.team = side;
}
function setMove(p, m) { if (S.phase === 'fight' && S.beatPhase === 'vote' && p.team && MOVES.includes(m)) p.move = m; }
function tap(p, n) {
  n = Math.max(0, Math.min(n | 0, 12)); if (!n || !p.team || S.phase !== 'fight' || S.beatPhase !== 'vote' || p.tapsBeat >= TAP_CAP) return;
  if (callActive('tap', p.team)) n *= 2; // the host called a tap storm
  const w = p.w || 1; n = Math.min(n, TAP_CAP - p.tapsBeat); p.tapsBeat += n; p.taps += n; S.teams[p.team].tapsBeat += n * w;
  const x = S.teams[p.team], na = Math.max(1, members(p.team).length); x.charge = Math.min(1, x.tapsBeat / (na * TAP_REF)); // live meter
}
function doTaunt(p, tid) { // insult the other fighter: it gets flustered (tilt) and shouts back
  const ins = TAUNTS.find((t) => t.id === tid), now = Date.now();
  if (!ins || !p.team || S.phase !== 'fight' || now - p.tauntAt < TAUNT_CD) return false;
  p.tauntAt = now;
  const target = p.team === 'A' ? 'B' : 'A', mult = callActive('taunt', p.team) ? 2 : 1;
  S.teams[target].tilt = Math.min(0.3, S.teams[target].tilt + 0.02 * mult);
  S.fx = { seq: ++fxN, type: 'taunt', from: p.team }; // on screen: just an icon, no text
  if (now - retortAt >= 9000) { // the fighter you back shouts the insult in their own voice, then the other one answers
    retortAt = now; sayAt = now;
    const me = S.teams[p.team].char; speak(me.voice, p.team, `[sneering, mocking] ${ins.text}`);
    setTimeout(() => S.phase === 'fight' && charSay(target, 'reply'), 3400);
  }
  push(); return true;
}

// ---------- keyboard / control players (weight 10) and forced matchup ----------
function kbd(team) {
  if (!['A', 'B'].includes(team) || !['generating', 'fight'].includes(S.phase)) return null;
  let p = players.get('kbd-' + team);
  if (!p) { p = { id: 'kbd-' + team, vote: null, team, taps: 0, tapsBeat: 0, move: null, bot: false, kbd: true, w: 10, tauntAt: 0, sideAt: 0 }; players.set(p.id, p); }
  p.team = team; return p;
}
function forceMatch(aId, bId) { // skip casting: these two fight
  const A = byId(aId), B = byId(bId); if (!A || !B || A === B || S.phase !== 'lobby') return false;
  S.teams.A = newSide(); S.teams.B = newSide();
  [[S.teams.A, A], [S.teams.B, B]].forEach(([x, c]) => { x.char = c; x.hp = x.maxhp = c.stats.hp; x.stats = { atk: c.stats.atk, spec: c.stats.spec }; });
  if (replayOn()) applyReplayFighters();
  for (const p of players.values()) p.team = p.kbd ? p.id.slice(-1) : null;
  for (const p of players.values()) if (!p.team) p.team = smallerSide();
  log(`[control] forced matchup ${A.name} vs ${B.name}`); startGenerating(); return true;
}
// ---------- crowd simulator (server side) ----------
// N virtual phones with their own personality. They act ONLY through the same functions real phones use and are flagged `sim`
// so the wall page can draw them. Nothing has to stay open in a browser for them to play.
const crowd = new Map(); let crowdHype = { A: 1, B: 1 }, crowdEpoch = 0, crowdPhase = '';
const frand = (a, b) => a + Math.random() * (b - a);
function crowdSpawn(n) {
  const now = Date.now();
  for (let i = 0; i < n; i++) {
    const id = 'sim-' + String(crowd.size).padStart(3, '0');
    crowd.set(id, { id, slow: frand(.5, 1.6), energy: frand(.15, 1), favIdx: Math.floor(Math.random() * ROSTER.length), favMove: rnd(MOVES), rude: Math.random() < .45, joinAt: now + frand(0, 8000), joined: false, tauntAt: 0 });
  }
}
function crowdStop() { for (const id of crowd.keys()) players.delete(id); crowd.clear(); push(); }
setInterval(() => { crowdHype = { A: frand(.6, 1.3), B: frand(.6, 1.3) }; }, 4000); // each side's mood swings
setInterval(() => {
  if (!crowd.size) return;
  if (S.phase === 'casting' && crowdPhase !== 'casting') crowdEpoch++;
  crowdPhase = S.phase;
  const now = Date.now(), tapCall = S.call && S.call.type === 'tap' && now < S.call.until, tauntCall = S.call && S.call.type === 'taunt' && now < S.call.until;
  const rv = S.phase === 'casting' ? rosterView() : null; let changed = false;
  for (const c of crowd.values()) {
    if (!c.joined) { if (now >= c.joinAt) { const p = join(c.id); p.sim = true; c.joined = true; changed = true; } continue; }
    const p = players.get(c.id); if (!p) continue;
    if (S.phase === 'casting') {
      if (c.epoch !== crowdEpoch) { c.epoch = crowdEpoch; c.voteAt = now + frand(800, 9000) * c.slow; c.voted = false; }
      if (!c.voted && now >= c.voteAt) { c.voted = true; const sorted = [...rv].sort((a, b) => b.votes - a.votes); castVote(p, replayOn() && Math.random() < .85 ? rnd([REPLAY.fighters.A, REPLAY.fighters.B]) : (sorted[0].votes && Math.random() < .45 ? rnd(sorted.slice(0, 2)).id : ROSTER[c.favIdx].id)); }
    }
    if (S.phase === 'fight' && S.beatPhase === 'vote' && p.team) {
      if (c.beat !== S.beat) { c.beat = S.beat; c.moveAt = now + frand(600, 5500) * c.slow; }
      if (!p.move && now >= c.moveAt) setMove(p, Math.random() < .4 ? c.favMove : rnd(MOVES));
      const boost = tapCall && (S.call.team === 'both' || S.call.team === p.team) ? 1.6 : 1;
      if (Math.random() < Math.min(.95, c.energy * crowdHype[p.team] * .5 * boost)) tap(p, 1 + Math.floor(Math.random() * 3));
    }
    if (S.phase === 'fight' && p.team) {
      if (c.rude && now - c.tauntAt > 3200 && Math.random() < (tauntCall ? .05 : .004)) { c.tauntAt = now; doTaunt(p, rnd(TAUNTS).id); }
      if (Math.random() < .0008) setSide(p, p.team === 'A' ? 'B' : 'A'); // a few fickle fans switch sides
    }
  }
  if (changed) push();
}, 300);
// One click: clean slate, spawn the crowd, start the vote once they have joined, and let the whole match play out.
function runDemo(n, mock, fast) {
  clearTimeout(timer); fresh(); setPhase('lobby');
  L.mock = !!mock; T.cast = fast ? 12e3 : 25e3; T.mockBeat = fast ? 8e3 : 15e3;
  crowdStop(); crowdSpawn(Math.max(2, Math.min(200, n || 40)));
  log(`[demo] simulated run: ${crowd.size} virtual phones, ${mock ? 'MOCK' : 'LIVE'}${fast ? ', fast' : ''}`);
  setTimeout(() => { if (S.phase === 'lobby' && !L.halted) startCasting(); }, 9500);
}
// ---------- bots (solo testing, server side) ----------
function addBots(n) { for (let i = 0; i < n; i++) { const p = join(); p.bot = true; } push(); }
setInterval(() => {
  for (const p of players.values()) {
    if (!p.bot) continue;
    if (S.phase === 'casting' && !p.vote && Math.random() < 0.3) castVote(p, rnd(ROSTER).id);
    if (S.phase === 'fight' && S.beatPhase === 'vote') {
      if (!p.move && Math.random() < 0.3) setMove(p, rnd(MOVES));
      tap(p, Math.floor(Math.random() * 3));
      if (Math.random() < 0.02) doTaunt(p, rnd(TAUNTS).id);
    }
  }
}, 500);

// ---------- http ----------
const isLocal = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && !req.headers['cf-connecting-ip'] && !req.headers['x-forwarded-for'];
const isAdmin = (req, u) => isLocal(req) || (!!process.env.ADMIN_PIN && u.searchParams.get('pin') === process.env.ADMIN_PIN && !req.headers['cf-connecting-ip'] && !req.headers['x-forwarded-for']);
const lan = () => { for (const l of Object.values(os.networkInterfaces())) for (const i of l) if (i.family === 'IPv4' && !i.internal) return i.address; return 'localhost'; };
const publicUrl = () => (process.env.PUBLIC_URL || `http://${lan()}:${PORT}`).replace(/\/$/, '');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' };
const body = (req) => new Promise((res) => { let d = ''; req.on('data', (c) => { d += c; if (d.length > 1e5) req.destroy(); }); req.on('end', () => { try { res(JSON.parse(d || '{}')); } catch { res({}); } }); });
const json = (res, o, c = 200) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
function serve(req, res, file) {
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  const type = MIME[path.extname(file)] || 'application/octet-stream', size = fs.statSync(file).size, range = req.headers.range;
  if (range) { // video/audio need range requests
    const [s, e] = range.replace('bytes=', '').split('-'); const start = Number(s) || 0, end = e ? Number(e) : size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' }); fs.createReadStream(file).pipe(res);
}
const sse = (res) => res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });

server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname;
  if (p === '/events') {
    sse(res);
    const c = { res, pid: u.searchParams.get('pid') }; clients.add(c); req.on('close', () => clients.delete(c));
    return res.write(`data: ${JSON.stringify(snap(c.pid && players.get(c.pid)))}\n\n`);
  }
  if (p === '/sim-events' || p === '/debug-events') { // localhost only (debug stream also with the admin PIN)
    if (!(p === '/sim-events' ? isLocal(req) : isAdmin(req, u))) { res.writeHead(403); return res.end('local only'); }
    sse(res); const set = p === '/sim-events' ? simClients : dbgClients; set.add(res); req.on('close', () => set.delete(res));
    return res.write(`data: ${JSON.stringify(p === '/sim-events' ? simSnap() : dbgSnap())}\n\n`);
  }
  if (req.method === 'POST' && p === '/api/sim/act') { // batched actions from simulated phones: same functions as the real endpoints
    if (!isLocal(req)) { res.writeHead(403); return res.end('local only'); }
    const { acts = [] } = await body(req);
    for (const x of acts) {
      if (x.a === 'join') { const q = join(x.id); q.sim = true; continue; }
      const pl = players.get(x.id); if (!pl) continue;
      if (x.a === 'vote') castVote(pl, x.char); else if (x.a === 'side') setSide(pl, x.side); else if (x.a === 'move') setMove(pl, x.move); else if (x.a === 'tap') tap(pl, x.n); else if (x.a === 'taunt') doTaunt(pl, x.tid);
    }
    push(); return json(res, { ok: 1, players: players.size });
  }
  if (req.method === 'POST' && p.startsWith('/api/')) {
    const b = await body(req); const pl = players.get(b.id);
    if (p === '/api/join') { const q = join(b.id); push(); return json(res, { id: q.id }); }
    if (!pl) return json(res, { error: 'unknown player' }, 404);
    if (p === '/api/vote') { castVote(pl, b.char); push(); return json(res, { ok: 1 }); }
    if (p === '/api/side') { setSide(pl, b.side); push(); return json(res, { ok: 1 }); }
    if (p === '/api/move') { setMove(pl, b.move); return json(res, { ok: 1 }); }
    if (p === '/api/tap') { tap(pl, b.n); return json(res, { ok: 1 }); }
    if (p === '/api/taunt') return json(res, { ok: doTaunt(pl, b.tid) });
  }
  if (p.startsWith('/admin/')) {
    if (!isAdmin(req, u)) { res.writeHead(403); return res.end('admin only'); }
    const cmd = p.slice(7), q = u.searchParams; let json_ok = 1;
    if (cmd === 'preflight') return json(res, { checks: await preflight() });
    if (cmd === 'start' && S.phase === 'lobby') startCasting();
    else if (cmd === 'skip') {
      if (S.phase === 'casting') { clearTimeout(timer); endCasting(); }
      else if (S.phase === 'fight') { runId++; finish(); }
      else if (S.phase === 'result') { fresh(); setPhase('lobby'); }
    }
    else if (cmd === 'reset') { clearTimeout(timer); fresh(); setPhase('lobby'); }
    else if (cmd === 'wipe') { clearTimeout(timer); crowd.clear(); players = new Map(); fresh(); setPhase('lobby'); }
    else if (cmd === 'bots') addBots(Number(q.get('n') || 20));
    else if (cmd === 'halt') { clearTimeout(timer); await media.haltAll(); fresh(); setPhase('lobby'); } // STOP ALL
    else if (cmd === 'resume') media.resume();
    else if (cmd === 'cap') L.cap = Math.max(0, Number(q.get('usd')) || L.cap);
    else if (cmd === 'economy') L.economy = q.get('on') === '1';
    else if (cmd === 'audio') L.audio = q.get('on') === '1';
    else if (cmd === 'voice') L.voice = q.get('on') === '1';
    else if (cmd === 'warm') audio.warm();
    else if (cmd === 'crowd') crowdSpawn(Math.max(1, Math.min(200, Number(q.get('n')) || 40)));
    else if (cmd === 'crowdstop') crowdStop();
    else if (cmd === 'rundemo') { if (L.halted) json_ok = 0; else runDemo(Number(q.get('n')) || 40, q.get('mode') === 'replay', q.get('fast') === '1'); }
    else if (cmd === 'fast') { T.cast = q.get('on') === '1' ? 12e3 : 25e3; T.mockBeat = q.get('on') === '1' ? 8e3 : 15e3; }
    else if (cmd === 'match') json_ok = forceMatch(q.get('a'), q.get('b'));
    else if (cmd === 'force') S.forceWin = ['A', 'B', 'tie'].includes(q.get('win')) ? q.get('win') : null;
    else if (cmd === 'call') { const t = q.get('type'), tm = q.get('team') || 'both'; say(t === 'taunt' ? 'call_taunt' : tm === 'A' ? 'call_A' : tm === 'B' ? 'call_B' : 'call_tap', true); }
    else if (cmd === 'hostsay') say(q.get('event'), true);
    else if (cmd === 'charsay') charSay(q.get('team'), q.get('key') || 'entrance');
    else if (cmd === 'speak') { const t = (q.get('text') || '').slice(0, 220), vk = q.get('voice') || 'host'; if (t) { sayAt = Date.now(); speak(vk, vk === 'host' ? 'host' : (q.get('who') || 'A'), t); } }
    else if (cmd === 'push') { const k = kbd(q.get('team')); if (k) tap(k, Number(q.get('n') || 3)); }
    else if (cmd === 'move') { const k = kbd(q.get('team')); if (k) { setMove(k, q.get('m')); push(); } }
    else if (cmd === 'taunt') { const k = kbd(q.get('team')); if (k) doTaunt(k, q.get('id') || TAUNTS[0].id); }
    else if (cmd === 'botsclear') { for (const [id, pl] of players) if (pl.bot) players.delete(id); push(); }
    else if (cmd === 'mock') { L.mock = q.get('on') === '1'; log(`[control] mode: ${L.mock ? 'MOCK' : 'LIVE'}`); }
    else if (cmd === 'cast') T.cast = Math.max(5, Math.min(120, Number(q.get('secs')) || 25)) * 1000;
    else if (cmd === 'roster') media.generateRoster(styleId(), q.get('id') || undefined).then(() => push());
    else if (cmd === 'style' && S.phase === 'lobby') { setStyle(q.get('name')); log(`[style] ${STYLES[styleId()].name}`); push(); }
    return json(res, { ok: json_ok, phase: S.phase, players: players.size, halted: L.halted });
  }
  if (p === '/styles.json') return json(res, { current: styleId(), local: isLocal(req), styles: styleGallery() });
  if (p === '/styles') return serve(req, res, path.join(ROOT, 'public/styles.html'));
  if (p === '/qr.svg') { res.writeHead(200, { 'Content-Type': 'image/svg+xml' }); return res.end(await QRCode.toString(publicUrl() + '/', { type: 'svg', margin: 1, color: { dark: '#0b0d17', light: '#ffffff' } })); }
  if (p === '/info') return json(res, { url: publicUrl(), live: media.live(), fast: FAST });
  if (p.startsWith('/media/')) return serve(req, res, path.join(ROOT, 'media', ...p.slice(7).split('/').filter((s) => s && s !== '..')));
  if (p === '/' || p === '/phone') return serve(req, res, path.join(ROOT, 'public/phone.html'));
  if (p === '/screen') return serve(req, res, path.join(ROOT, 'public/screen.html'));
  if (p === '/sim') return serve(req, res, path.join(ROOT, 'public/sim.html'));
  if (p === '/demo') return serve(req, res, path.join(ROOT, 'public/demo.html'));
  if (p === '/control') return serve(req, res, path.join(ROOT, 'public/control.html'));
  if (p === '/debug-panel.js') return serve(req, res, path.join(ROOT, 'public/debug-panel.js'));
  if (p.startsWith('/assets/')) return serve(req, res, path.join(ROOT, 'public/assets', ...p.slice(8).split('/').filter((s) => s && s !== '..')));
  if (p === '/host.png') return serve(req, res, path.join(ROOT, 'public/host.png'));
  res.writeHead(404); res.end('not found');
});
function listen(port, tries = 0) { // if the port is taken by another app, use the next free one
  const onError = (e) => {
    server.removeListener('listening', onListening);
    if (e.code === 'EADDRINUSE' && tries < 20) { console.log(`  port ${port} is busy (another app?), trying ${port + 1}`); listen(port + 1, tries + 1); } else throw e;
  };
  const onListening = () => {
    server.removeListener('error', onError); PORT = port;
    console.log(`\n  GlitchOut Fighter`);
    console.log(`  control : http://localhost:${PORT}/control   <- open this one to run and present the demo`);
    console.log(`  screen  : http://localhost:${PORT}/screen    (projector, with the debug dock)`);
    console.log(`  demo    : http://localhost:${PORT}/demo?n=40&auto=1`);
    console.log(`  phones  : ${publicUrl()}/`);
    if (!media.live()) console.log('  !!! NOT LIVE: ' + (process.env.MACHGEN_API_KEY ? 'mock flag set' : 'no MACHGEN_API_KEY found in .env next to server.js') + ' -> no video will be generated !!!');
    console.log(`  MachGen: ${media.live() ? 'LIVE' : 'NOT LIVE'} | voices: ${audio.provider()} | budget cap $${L.cap} ${FAST ? '[FAST]' : ''}\n`);
    if (process.argv.includes('--open') && process.platform === 'darwin') exec(`open http://localhost:${PORT}/control`);
  };
  server.once('error', onError); server.once('listening', onListening); server.listen(port);
}
listen(PORT);
