// Tries a voice id on MachGen with one short line (a rejected id costs nothing, an accepted one ~$0.06). Usage: node scripts/tryvoice.mjs <voiceId> "<text>" [stability]
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(path.join(root, '.env')); } catch {}
const m = await import('../media.js'); const { spent } = await import('../ledger.js');
const [voice, text, stab] = process.argv.slice(2);
try {
  const { id, rec } = await m.submit({ model: 'Eleven-v3', task_type: 'T2S', prompt: text, audio_config: { voice_id: voice, stability: stab === undefined ? undefined : Number(stab), output_format: 'mp3_44100_64' } }, 'tts', 0.065, 'try');
  await m.wait(id, rec, 60000); const s = await m.save(id, 'mp3', 'tries'); console.log('ACCEPTED', s.file);
} catch (e) { console.log('REJECTED', e.message.slice(0, 160)); }
await new Promise((r) => setTimeout(r, 2000)); console.log('spend $' + spent().toFixed(3)); process.exit(0);
