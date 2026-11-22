// The six contenders: cool, strange, cyber-surreal fighters (not fantasy, not gags). 3 men + 3 women.
// stats: hp (base health), atk (normal attack), spec (special move). All sums are ~3.3 so nobody is a free win.
// voice: key into audio.VOICES. lines: entrance / reply (when insulted) / win.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'media', 'roster');

// One visual style. Portraits live in media/roster/<style>/<id>.png (made with Krea 3 through the creative MCP);
// the same look/arena/sound text drives the fight video prompts.
export const STYLES = {
  'neon-disruptor': {
    name: 'Neon Disruptor',
    blurb: 'Hyperreal cyberpunk fashion campaign: liquid chrome, holographic glints, teal and magenta neon. Strange and unsettling.',
    look: 'ultra-detailed hyperreal fashion campaign photograph in a futuristic cyberpunk setting, strange and unsettling, liquid chrome and holographic glints, teal and magenta neon rim lighting, shallow depth of field, 85mm lens, cinematic, high-end editorial',
    videoLook: 'hyperreal cyberpunk action movie, teal and magenta neon, rain-slick night street, gritty and explosive, handheld action camera',
    twist: '',
    backdrop: 'rain-slick futuristic night street with blurred neon signs and steam',
    arena: 'a rain-soaked underground neon fight cage in a futuristic megacity, holographic signs, steam vents and silhouetted crowd',
    sound: 'electric hums, heavy bass thuds, falling rain, a distant crowd roar, synthetic whooshes, no music, no speech',
  },
};
let cur = process.env.STYLE in STYLES ? process.env.STYLE : 'neon-disruptor';
export const style = () => STYLES[cur];
export const styleId = () => cur;
export const setStyle = (n) => { if (STYLES[n]) cur = n; return cur; };

export const ROSTER = [
  {
    id: 'mercury', short: 'the chrome-skinned man', spectacle: "his fist stretches and liquefies into a giant mercury wrecking ball that smashes through a parked car and sends it flipping through the air", gender: 'M', name: 'Mercury', icon: '🪞', voice: 'M1',
    tagline: 'Hit him and watch the shape change.',
    bio: 'A fighter whose skin is liquid mercury. Every punch rings back like a mirror. Nobody has ever landed the same hit twice.',
    look: 'a tall muscular man whose entire skin is liquid mercury chrome, mirror-polished with rippling reflections, shaved head, gold teeth, wearing an asymmetric black techwear tank top and tactical trousers',
    special: 'Mercury Hook', attacks: ["a liquid-metal jab whose fist stretches across the whole street and slams into the target", "a spinning whip of mercury that cracks like thunder", "a hammer fist that splashes into a hundred chrome spikes"], counters: ["lets the blow sink into his chrome skin and fires it back as a reflected shockwave", "turns his body into a mirror that bounces the attack straight back"], stats: { hp: 110, atk: 1.15, spec: 1.05 },
    lines: { entrance: '[low menacing laugh] Hit me. Go ahead. [whispers] See what happens.', reply: '[growling, angry] Careful, little man. I... REFLECT.', win: '[triumphant roar] That is the SHAPE of things to come!' },
  },
  {
    id: 'null', short: 'the man with the black mirror face', spectacle: "he flickers through glitching teleports, the whole street distorts into digital artifacts, razor shards of black glass explode outward and slice a neon sign in half", gender: 'M', name: 'Null', icon: '⬛', voice: 'M2',
    tagline: 'Nobody knows what he looks like.',
    bio: 'A tall figure with a perfectly smooth black mirror where a face should be. He moves in glitches and speaks only in error messages.',
    look: 'a lean tall figure in a long matte-black techwear trench coat with a perfectly smooth glossy black mirror-like featureless face reflecting neon lights, razor shards of black glass floating around his hands',
    special: 'Glitch Step', attacks: ["vanishes in a glitch and reappears behind the target with a razor-glass slash", "hurls a storm of floating black glass shards", "drives a punch through a glitching portal that opens right inside the target's guard"], counters: ["glitches out of the way so the blow passes through him, then answers with a pixelated kick", "freezes the incoming attack in a stuttering loop and shoves it back"], stats: { hp: 100, atk: 1.0, spec: 1.3 },
    lines: { entrance: '[whispering, eerie] You cannot hit what is not there... [glitchy] ...e-e-error.', reply: '[robotic, cold] Insult... not found. [glitchy] Deleting... YOU.', win: '[flat, chilling] Connection... terminated.' },
  },
  {
    id: 'moth', short: 'the pale winged man in the white coat', spectacle: "his glass wings flare open in a blinding white burst, a shockwave shatters every window on the street and blows cars sideways in a storm of glowing dust", gender: 'M', name: 'Doctor Moth', icon: '🦋', voice: 'M3',
    tagline: 'Turn off the lights. He is the only glow.',
    bio: 'A pale, elegant man in an ice-white coat with enormous wings of glowing cracked glass. He is drawn to light, and he leaves nothing but dust behind.',
    look: 'a pale elegant man in a tailored ice-white coat with enormous luminous moth wings made of glowing cracked glass, large dark compound eyes, fine feathered antennae, a cold gaze, powder dust trailing in the air',
    special: 'Lamp Burst', attacks: ["a dive from above on blazing glass wings that scatters glowing dust", "a spinning wing-slash that cuts the air into shards of light", "a flurry of luminous powder that burns where it lands"], counters: ["folds his wings into a shield of glowing glass that shatters the blow", "lures the target toward a lamp-bright flare and strikes out of the glare"], stats: { hp: 120, atk: 1.0, spec: 1.15 },
    lines: { entrance: '[soft, chilling whisper] Turn off the lights. [sighs] I like to be... the only glow.', reply: '[icy, furious] Moths... remember... EVERYTHING you say.', win: '[serene, cruel laugh] You flew... too close to the light.' },
  },
  {
    id: 'seraph', short: 'the silver-haired woman in white with the halo', spectacle: "she hurls her spinning holographic halo rings that slice through a truck and a neon billboard in a shower of sparks, then dashes through the wreckage", gender: 'F', name: 'Seraph', icon: '👼', voice: 'F1',
    tagline: 'Kneel. Or do not. She wins either way.',
    bio: 'A radiant fighter crowned with rotating holographic rings and wings of glitching light. She cuts through anything with a halo she can throw.',
    look: 'a striking woman with sleek silver hair and a crown of rotating holographic halo rings, translucent wings of glitching white light, a glossy white latex bodysuit with chrome plating, calm piercing eyes',
    special: 'Halo Cutter', attacks: ["a flying halo-ring kick that leaves a trail of light", "a throw of two spinning halo rings that curve around the target", "a glowing wing-sweep that knocks the target off its feet"], counters: ["spins the incoming blow into a ring of light and throws it back", "blinks aside in a flash of white and counters with a rising halo strike"], stats: { hp: 105, atk: 1.1, spec: 1.15 },
    lines: { entrance: '[radiant, commanding] Kneel! [laughs] Or do not. Either way... I WIN.', reply: '[outraged gasp] BLASPHEMY! [scoffs] But make it a good one.', win: '[serene, triumphant] Amen. [breathes] Next.' },
  },
  {
    id: 'orchid', short: 'the woman in black with the glowing orchids', spectacle: "giant bioluminescent orchids erupt from the asphalt in a chain explosion of glowing spores while whipping vines wrap around her opponent", gender: 'F', name: 'Orchid', icon: '🌺', voice: 'F2',
    tagline: 'Pretty things have thorns.',
    bio: 'A woman in a glossy black bodysuit with bioluminescent orchids growing from her shoulders and spine. Her pollen glows. Her bite is worse.',
    look: 'a striking woman in a glossy black bodysuit with large bioluminescent orchid blossoms growing from her shoulders and spine, glowing pollen dripping from the petals, venom-green lipstick, sleek dark hair, sharp confident gaze',
    special: 'Spore Bloom', attacks: ["whipping vines of glowing orchids that lash and wrap around the target", "a burst of bioluminescent pollen that blinds and stings", "a thorn-spike kick as petals explode off her shoulders"], counters: ["lets the target grab her, then blooms spikes through the hold", "sidesteps like a dancer and drags the target into a thorny vine trap"], stats: { hp: 115, atk: 1.0, spec: 1.15 },
    lines: { entrance: '[sultry whisper] Pretty things have thorns... [laughs] and I have THOUSANDS.', reply: '[sweet, dangerous] Oh, darling. [hissing] That was your mistake.', win: '[purring, delighted] Beautiful. [giggles] Pretty. Over.' },
  },
  {
    id: 'widow', short: 'the woman with the chrome spider legs and red visor', spectacle: "she leaps up, spears her four chrome spider legs into the buildings, swings across the street and crashes down with all legs, cratering the road", gender: 'F', name: 'Widow', icon: '🕷️', voice: 'F3',
    tagline: 'Eight limbs. Zero mercy.',
    bio: 'A precision fighter with four chrome spider legs folded behind her back. She never needs to dodge: she is always somewhere else.',
    look: 'a fierce woman in a black leather and mesh bodysuit with four sleek chrome mechanical spider legs extending from her back, a red neon visor over her eyes, a sharp black bob haircut',
    special: 'Eight Arms', attacks: ["four chrome spider legs stabbing in rapid sequence", "a leaping slam where all four legs plant and crush", "a web-line grapple that yanks the target off the ground"], counters: ["catches the blow between two chrome legs and flips the target over", "leaps up out of reach and drops back with a leg-spike strike"], stats: { hp: 100, atk: 1.2, spec: 1.1 },
    lines: { entrance: '[amused, smirking] Eight limbs. [laughs] ZERO mercy.', reply: '[smirking, mocking] Cute. [laughs] Try again... with ALL your arms.', win: '[satisfied, breathless laugh] Stuck on me. [sighs] Always.' },
  },
];
export const byId = (id) => ROSTER.find((c) => c.id === id);
export const imgFileFor = (sid, c) => path.join(DIR, sid, `${c.id}.png`);
export const imgFile = (c) => imgFileFor(cur, c);
export const imgUrl = (c) => (fs.existsSync(imgFile(c)) ? `/media/roster/${cur}/${c.id}.png` : null);
export const thumbUrl = (c) => (fs.existsSync(path.join(DIR, cur, 'thumb', `${c.id}.jpg`)) ? `/media/roster/${cur}/thumb/${c.id}.jpg` : imgUrl(c)); // small JPEG for phones
export const imgMissing = (sid = cur) => ROSTER.filter((c) => !fs.existsSync(imgFileFor(sid, c)));
export const styleGallery = () => Object.entries(STYLES).map(([id, s]) => ({ id, name: s.name, blurb: s.blurb, images: Object.fromEntries(ROSTER.map((c) => [c.id, fs.existsSync(imgFileFor(id, c)) ? `/media/roster/${id}/${c.id}.png` : null])) }));
// public view sent to the browsers
export const pub = (c) => ({ id: c.id, gender: c.gender, name: c.name, icon: c.icon, tagline: c.tagline, bio: c.bio, special: c.special, img: imgUrl(c), thumb: thumbUrl(c) });
