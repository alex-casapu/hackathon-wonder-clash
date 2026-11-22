// Spend ledger + kill switch. Every paid MachGen call goes through begin()/guard().
export const L = {
  items: [], inflight: new Map(), logs: [], halted: false,
  cap: Number(process.env.MAX_SPEND || 10),       // hard budget cap (USD) for this server session
  economy: process.env.ECONOMY !== '0',           // 2 branches per round instead of 3
  audio: process.env.VIDEO_AUDIO !== '0',         // sound inside the generated clips (same price)
  voice: process.env.AUTO_VOICE !== '0',          // generate a voice line on demand the first time it is needed (then cached)
  mock: false,                                    // runtime switch from the control page: no paid MachGen calls while true
  stats: { holds: 0, fallbacks: 0, branchSecs: [] },
};
export const EST = { image: 0.005, videoPerSec: 0.015, tts: 0.065 }; // estimates until the real billing arrives
export const begin = (kind, est, label = '') => { const r = { n: L.items.length + 1, kind, label, est, actual: null, status: 'pending', t0: Date.now(), id: null }; L.items.push(r); return r; };
export const cost = (r) => (r.actual != null ? r.actual : (r.status === 'failed' || r.status === 'canceled' ? 0 : r.est));
export const spent = () => L.items.reduce((s, r) => s + cost(r), 0);
export const byKind = () => { const o = {}; for (const r of L.items) { const k = (o[r.kind] ||= { n: 0, usd: 0 }); k.n++; k.usd += cost(r); } return o; };
export function guard() {
  if (L.halted) throw new Error('HALTED (stop button): no paid calls allowed');
  if (spent() >= L.cap) { L.halted = true; log(`BUDGET CAP $${L.cap} reached, halting paid calls`); throw new Error('budget cap reached'); }
}
export function log(...a) { const line = `${new Date().toLocaleTimeString('en-GB')} ${a.join(' ')}`; L.logs.push(line); if (L.logs.length > 120) L.logs.shift(); console.log(line); }
