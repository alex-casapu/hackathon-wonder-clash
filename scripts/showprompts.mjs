// Prints the fight prompts of an imaginary match (no API calls, no cost) to see how varied the stories are.
// Usage: node scripts/showprompts.mjs [fighterA] [fighterB]
import { byId } from '../roster.js';
import * as media from '../media.js';
const A = byId(process.argv[2] || 'seraph'), B = byId(process.argv[3] || 'mercury');
const deck = media.newDeck();
const winners = ['A', 'B', 'B', 'A', 'B', 'A'];
for (let k = 0; k < 6; k++) {
  const finale = k === 5, cls = winners[k], plan = deck.plan(k), kind = media.rollKind(finale);
  const full = media.branchPrompt(cls, A, B, finale, k, plan, kind);
  const story = full.slice(full.indexOf(finale ? 'FINAL' : 'Round') >= 0 ? full.indexOf(finale ? 'FINAL' : 'Round') : 0, full.indexOf('Same two characters'));
  console.log(`\n--- round ${k + 1} | winner ${cls === 'A' ? A.name : B.name} | shows: ${kind}\n${story}`);
}
