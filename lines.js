// Host (the frog) lines. Audio is generated the first time a line is used and cached on disk, so each line costs once.
// Lines without audio still show as subtitles.  action: 'tap' (double taps) | 'taunt' (double taunt power)  team: 'A' | 'B' | 'both'
// Corners: pink = left fighter (A), cyan = right fighter (B).
export const HOST = {
  intro: [{ t: '[shouting, excited] WELCOME to the weirdest fight night on Earth! [laughs] Tonight... YOU decide who wins!' }],
  call_tap: [
    { t: '[shouting] EVERYBODY! Smash that button! [laughs] Hit it like it owes you MONEY!', action: 'tap', team: 'both', call: 'TAP STORM! Double taps!' },
    { t: '[shouting] Tap tap tap TAP! Faster! [shouting] FASTER!', action: 'tap', team: 'both', call: 'TAP STORM! Double taps!' },
  ],
  call_taunt: [
    { t: '[mischievous laugh] Now be RUDE! Hit the taunt button and insult the other fighter!', action: 'taunt', team: 'both', call: 'TAUNT WAVE! Insult them, double power!' },
    { t: '[laughing] Go on, insult them! [gasps] They can totally hear you!', action: 'taunt', team: 'both', call: 'TAUNT WAVE! Insult them, double power!' },
  ],
  call_A: [{ t: '[shouting] PINK corner, I cannot HEAR you! Louder! Tap like your life depends on it!', action: 'tap', team: 'A', call: 'PINK CORNER: TAP STORM!' }],
  call_B: [{ t: '[shouting] CYAN corner, show me what you have GOT! Tap tap TAP!', action: 'tap', team: 'B', call: 'CYAN CORNER: TAP STORM!' }],
  hit_A: [{ t: '[excited] Oh! The pink corner lands a monster hit!' }, { t: '[excited] That one is going to leave a mark! Point to pink!' }],
  hit_B: [{ t: '[excited] Oh! The cyan corner lands a monster hit!' }, { t: '[excited] That one is going to leave a mark! Point to cyan!' }],
  clash: [{ t: '[excited] They collide! Nobody gives an inch!' }, { t: '[amazed] What a clash! Neither one is backing down!' }],
  low_A: [{ t: '[worried] Pink is hanging by a thread!' }],
  low_B: [{ t: '[worried] Cyan is hanging by a thread!' }],
  finale_A: [{ t: '[shouting] And the pink corner takes it! What a fight!' }],
  finale_B: [{ t: '[shouting] And the cyan corner takes it! What a fight!' }],
  outro: [{ t: '[laughing, breathless] And THAT is all, folks! [excited] Who wants a REMATCH?' }],
};
// Short, silly, harmless insults the audience can throw (no free text).
export const TAUNTS = [
  { id: 't1', short: 'Soggy noodle!', text: 'You fight like a soggy noodle!' },
  { id: 't2', short: 'Wet sock!', text: 'You smell like a wet sock!' },
  { id: 't3', short: 'Houseplant!', text: 'Nice moves... for a houseplant!' },
  { id: 't4', short: 'Hamster!', text: 'Your mother was a hamster!' },
  { id: 't5', short: 'Toaster scarier!', text: 'My toaster is scarier than you!' },
  { id: 't6', short: 'Shadow left you!', text: 'Even your own shadow left you!' },
  { id: 't7', short: 'Grandma hits harder!', text: 'My grandma hits harder!' },
  { id: 't8', short: 'Sleepy kitten!', text: 'You could not scare a sleepy kitten!' },
];
// Announcements are built from the roster (so each fighter is introduced by name).
export const announce = (corner, c) => `[shouting, excited] ${corner === 'A' ? 'In the PINK corner' : 'And in the CYAN corner'}... [dramatic pause] ${c.name}! [excited] ${c.tagline}`;
