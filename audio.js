// Speech. Two providers, same cache:
//  - ElevenLabs DIRECT (set ELEVENLABS_API_KEY in .env): library voices with real character, Eleven v3, stability 0 ("Creative" = most expressive).
//  - MachGen's Eleven v3 (default without a key): only a small set of premade voices is allowed there, so it sounds flatter.
// Every line is cached on disk by (provider, voice, text): a line is paid once. Lines are generated the first time they are used.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { EST, L, begin, guard, log } from './ledger.js';
import { submit, wait, save, DIR, live } from './media.js';
import { HOST, announce } from './lines.js';
import { ROSTER } from './roster.js';

const EL_KEY = () => process.env.ELEVENLABS_API_KEY;
export const provider = () => (EL_KEY() ? 'elevenlabs' : 'machgen');
const STABILITY = Number(process.env.VOICE_STABILITY ?? 0); // v3: 0 = Creative (most emotion), 0.5 = Natural, 1 = Robust

// ---- ElevenLabs library voices (cast by personality) ----
export const DIRECT = {
  host: { id: '9rR45HW0vcBmpCbkc4m9', name: 'Nathaniel - Live Football Commentator' }, // energetic live commentator
  M1: { id: '7fBwqIVI6wI1B4MuKqQi', name: 'The BadBoy Austin' },                         // Mercury: street-tough, cold
  M2: { id: 'NoiYxL9g25M4orC8Q0ls', name: 'Vector - Tec Voice' },                        // Null: robotic, faceless
  M3: { id: 'WzVKtqQpTUUQ2JNx8YxI', name: 'Silas - Weathered Villain' },                 // Doctor Moth: quietly threatening
  F1: { id: 'mJiaxdei54CMciYXeCtS', name: 'Seraphina - Regal Villainess' },              // Seraph: commanding, dramatic
  F2: { id: 'jUPSOpRcPt8GMPsWx5fy', name: 'Ruby B - London, Playful, Warm' },            // Orchid: playful, flirtatious, husky
  F3: { id: 'dmWfLQZJq7wNPv9WmtiM', name: 'Emma - Wry, Gritty Hero' },                   // Widow: wry, gritty
};
// ---- MachGen fallback voices (first accepted id is remembered) ----
export const HOST_VOICE = 'pNInz6obpgDQGcFmaJgB'; // verified
const CANDIDATES = {
  M1: ['JBFqnCBsd6RMkjVDRZzb'], M2: ['cjVigY5qzO86Huf0OWal'], M3: ['onwK4e9ZLuTAKqWW03F9'],
  F1: ['EXAVITQu4vr4xnSDxMaL'], F2: ['cgSgspJ2msm6clMCkdW9'], F3: ['Xb7hH8MSUJpSbSDYk0k2'],
};
const FEMALE_FALLBACK = 'EXAVITQu4vr4xnSDxMaL';
const voiceList = (k) => (k === 'host' ? [HOST_VOICE] : [...(CANDIDATES[k] || [])].concat(k.startsWith('F') ? [FEMALE_FALLBACK] : [HOST_VOICE]));

const hash = (voiceKey, text) => crypto.createHash('sha1').update(`${provider()}|v2|${voiceKey}|${text}`).digest('hex').slice(0, 16);
const file = (voiceKey, text) => path.join(DIR, 'audio', `${hash(voiceKey, text)}.mp3`);
export const cachedUrl = (voiceKey, text) => (fs.existsSync(file(voiceKey, text)) ? `/media/audio/${hash(voiceKey, text)}.mp3` : null);

export function allLines() {
  const out = [];
  for (const arr of Object.values(HOST)) for (const l of arr) out.push({ voice: 'host', text: l.t });
  for (const c of ROSTER) {
    for (const t of Object.values(c.lines)) out.push({ voice: c.voice, text: t });
    for (const k of ['A', 'B']) out.push({ voice: 'host', text: announce(k, c) });
  }
  return out;
}
export const missing = () => allLines().filter((l) => !fs.existsSync(file(l.voice, l.text)));

// ---- providers ----
async function synthMachgen(voiceKey, text, voiceId) {
  const cfg = { voice_id: voiceId, output_format: 'mp3_44100_64' };
  for (const withStability of [true, false]) { // creative stability first; if MachGen refuses the field, plain
    try {
      const { id, rec } = await submit({ model: 'Eleven-v3', task_type: 'T2S', prompt: text, audio_config: withStability ? { ...cfg, stability: STABILITY } : cfg }, 'tts', EST.tts, text.slice(0, 40));
      await wait(id, rec, 60000);
      const saved = await save(id, 'mp3', 'audio'); fs.renameSync(saved.file, file(voiceKey, text)); return;
    } catch (e) { if (!withStability || !/stability|audio_config|invalid/i.test(e.message)) throw e; }
  }
}
async function elFetch(p, opt = {}) { return fetch('https://api.elevenlabs.io' + p, { ...opt, headers: { 'xi-api-key': EL_KEY(), 'Content-Type': 'application/json', ...(opt.headers || {}) } }); }
const added = new Set();
async function addSharedVoice(v) { // library voices must be in "My voices" before the API can speak with them
  if (added.has(v.id)) return; added.add(v.id);
  try {
    const r = await (await elFetch(`/v1/shared-voices?page_size=10&search=${encodeURIComponent(v.name.split(' - ')[0])}`)).json();
    const hit = (r.voices || []).find((x) => x.voice_id === v.id); if (!hit) return log(`[audio] ${v.name}: not found in the shared library`);
    const a = await elFetch(`/v1/voices/add/${hit.public_owner_id}/${v.id}`, { method: 'POST', body: JSON.stringify({ new_name: v.name }) });
    log(`[audio] added voice "${v.name}" to your library (${a.status})`);
  } catch (e) { log('[audio] add voice failed:', e.message.slice(0, 80)); }
}
async function synthElevenLabs(voiceKey, text) {
  guard(); const v = DIRECT[voiceKey]; const rec = begin('tts', 0.03, text.slice(0, 40));
  const call = () => elFetch(`/v1/text-to-speech/${v.id}?output_format=mp3_44100_64`, { method: 'POST', body: JSON.stringify({ text, model_id: 'eleven_v3', voice_settings: { stability: STABILITY, similarity_boost: 0.85, use_speaker_boost: true } }) });
  try {
    let r = await call();
    if (r.status === 404 || r.status === 400) { await addSharedVoice(v); r = await call(); }
    if (!r.ok) throw new Error(`ElevenLabs ${r.status} ${(await r.text()).slice(0, 120)}`);
    fs.mkdirSync(path.dirname(file(voiceKey, text)), { recursive: true });
    fs.writeFileSync(file(voiceKey, text), Buffer.from(await r.arrayBuffer())); rec.status = 'done';
  } catch (e) { rec.status = 'failed'; rec.actual = 0; throw e; }
}

// On-demand: returns the cached url, or generates the line now (once, deduplicated) and caches it. null on failure/mock/halt.
const pending = new Map();
export function ensure(voiceKey, text) {
  const c = cachedUrl(voiceKey, text); if (c) return Promise.resolve(c);
  if (!live() && !EL_KEY()) return Promise.resolve(null);
  const k = hash(voiceKey, text);
  if (!pending.has(k)) pending.set(k, (async () => {
    if (EL_KEY() && DIRECT[voiceKey]) {
      try { await synthElevenLabs(voiceKey, text); return cachedUrl(voiceKey, text); }
      catch (e) { if (/HALTED|budget/.test(e.message)) return null; log(`[audio] ElevenLabs failed for ${voiceKey}: ${e.message.slice(0, 100)}`); if (!live()) return null; }
    }
    for (const vid of voiceList(voiceKey)) {
      try { await synthMachgen(voiceKey, text, vid); return cachedUrl(voiceKey, text); }
      catch (e) { if (/HALTED|budget/.test(e.message)) return null; log(`[audio] ${voiceKey}: voice ${vid} not usable (${e.message.slice(0, 60)})`); }
    }
    return null;
  })().finally(() => pending.delete(k)));
  return pending.get(k);
}
export async function warm() {
  if (!live() && !EL_KEY()) return { done: 0, failed: 0 };
  const todo = missing(); let done = 0, failed = 0, i = 0;
  log(`[audio] warming ${todo.length} lines via ${provider()}`);
  const worker = async () => { while (i < todo.length) { const l = todo[i++]; if (await ensure(l.voice, l.text)) done++; else failed++; } };
  await Promise.all([worker(), worker()]);
  log(`[audio] warm done: ${done} ok, ${failed} failed`);
  return { done, failed };
}
