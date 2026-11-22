#!/usr/bin/env python3
"""Turns a recorded match into ONE video file you can show when something goes wrong.

The server writes media/recordings/<id>/timeline.json at the end of every match (which clips played, which voice lines
were heard and when, the HP, the call-outs). This script puts them back together with ffmpeg: the real generated clips
in order, the commentator and fighter voices at the right moments (the clip sound ducks under them), the HP bars,
the call-out pills and the result card, after a title card with the crowd vote.

    python3 scripts/render_match.py media/recordings/<id>/timeline.json [out.mp4]

Needs ffmpeg and Pillow (pip3 install pillow). It spends nothing: everything it uses is already on disk.
"""
import json, os, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MEDIA = ROOT + '/media'
W, H, FPS = 1280, 720, 24
TITLE, TAIL = 5.0, 5.0
COL = {'A': (255, 63, 164), 'B': (0, 240, 255)}
IMPACT, ARIAL = '/System/Library/Fonts/Supplemental/Impact.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf'
font = lambda p, s: ImageFont.truetype(p, s)

def sh(args, capture=False):
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode != 0: raise SystemExit('command failed: ' + ' '.join(args[:6]) + '...\n' + r.stderr[-1500:])
    return r.stdout
def local(url): return MEDIA + url[len('/media'):]
def duration(path): return float(sh(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]).strip())
def has_audio(path): return 'audio' in sh(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', path])
def centered(d, text, f, y, fill, stroke=0):
    d.text(((W - d.textlength(text, font=f)) / 2, y), text, font=f, fill=fill, stroke_width=stroke, stroke_fill=(0, 0, 0, 255))

# ---------------- pictures drawn with Pillow ----------------
def title_card(path, cast, tl):
    im = Image.new('RGB', (W, H), (8, 6, 14)); d = ImageDraw.Draw(im)
    centered(d, 'GLITCHOUT FIGHTER', font(IMPACT, 92), 24, (255, 255, 255))
    centered(d, 'THE CROWD VOTES. THEN THE CROWD DECIDES WHO WINS.', font(ARIAL, 26), 132, (0, 240, 255))
    votes = (cast or {}).get('votes') or []
    if votes:
        top = sorted(votes, key=lambda v: -v['votes'])[:2]; winners = {v['id'] for v in top}
        tw, th, gx, gy, x0, y0 = 360, 203, 30, 46, 65, 190
        for i, v in enumerate(votes[:6]):
            x, y = x0 + (i % 3) * (tw + gx), y0 + (i // 3) * (th + gy + 20)
            p = f'{MEDIA}/roster/neon-disruptor/{v["id"]}.png'
            if os.path.exists(p): im.paste(Image.open(p).convert('RGB').resize((tw, th)), (x, y))
            if v['id'] in winners: d.rectangle([x - 4, y - 4, x + tw + 4, y + th + 4], outline=(255, 230, 0), width=5)
            d.text((x, y + th + 6), v['name'].upper(), font=font(IMPACT, 30), fill=(255, 255, 255))
            t = f'{v["votes"]} votes'; d.text((x + tw - d.textlength(t, font=font(ARIAL, 24)), y + th + 10), t, font=font(ARIAL, 24), fill=(255, 230, 0) if v['id'] in winners else (150, 150, 170))
    im.save(path)

def hud_png(path, hud, label):
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rectangle([0, 0, W, 112], fill=(0, 0, 0, 150))
    for side in 'AB':
        h = hud[side]; name = (h.get('name') or '').upper(); frac = max(0, min(1, h['hp'] / max(1, h['maxhp'])))
        x0, x1 = (24, 590) if side == 'A' else (690, 1256)
        d.rectangle([x0, 62, x1, 92], fill=(30, 30, 40, 235))
        fw = int((x1 - x0) * frac)
        d.rectangle([x0, 62, x0 + fw, 92] if side == 'A' else [x1 - fw, 62, x1, 92], fill=COL[side] + (255,))
        f = font(IMPACT, 40); tw = d.textlength(name, font=f)
        d.text((x0 if side == 'A' else x1 - tw, 12), name, font=f, fill=COL[side] + (255,))
        t = f'{h["hp"]} / {h["maxhp"]}'; f2 = font(ARIAL, 22); tw2 = d.textlength(t, font=f2)
        d.text((x0 + 8 if side == 'A' else x1 - tw2 - 8, 63), t, font=f2, fill=(255, 255, 255, 255), stroke_width=2, stroke_fill=(0, 0, 0, 255))
    centered(d, label, font(IMPACT, 34), 22, (255, 230, 0, 255))
    im.save(path)

def pill_png(path, text):
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(im); f = font(IMPACT, 38)
    tw = d.textlength(text, font=f); x0 = (W - tw) / 2 - 30
    d.rounded_rectangle([x0, 128, x0 + tw + 60, 184], radius=28, fill=(255, 210, 0, 245))
    d.text((x0 + 30, 132), text, font=f, fill=(20, 12, 0, 255)); im.save(path)

def result_png(path, name, side):
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rectangle([0, 230, W, 520], fill=(0, 0, 0, 175))
    centered(d, f'{name.upper()} WINS!', font(IMPACT, 118), 262, COL[side] + (255,), stroke=3)
    centered(d, 'GLITCHOUT FIGHTER', font(ARIAL, 30), 420, (255, 255, 255, 255)); im.save(path)

# ---------------- build ----------------
def main():
    tpath = sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__)
    tl = json.load(open(tpath)); out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(tpath), 'match.mp4')
    ev = sorted(tl['events'], key=lambda e: e['t'])
    clips = [e for e in ev if e['type'] == 'clip' and e.get('url')]
    res = next((e for e in reversed(ev) if e['type'] == 'result'), None)
    if not clips or not res: sys.exit('this timeline has no finished match')
    t0 = clips[0]['t']
    rel = lambda t: max(0.0, (t - t0) / 1000.0)           # seconds from the start of the fight
    segs = []
    for i, c in enumerate(clips):
        start = rel(c['t']); end = rel(clips[i + 1]['t']) if i + 1 < len(clips) else rel(res['t']) + TAIL
        segs.append({'file': local(c['url']), 'start': start, 'L': end - start, 'beat': c.get('beat', i)})
    total = TITLE + sum(s['L'] for s in segs)
    work = tempfile.mkdtemp(prefix='glitchout_')
    pngs = []                                              # (path, from, to) in video time
    title = f'{work}/title.png'; title_card(title, tl.get('cast'), tl)
    # HUD per segment: the last HP snapshot taken at or before the clip started
    huds = [e for e in ev if e['type'] == 'hud']
    for s in segs:
        h = [x for x in huds if rel(x['t']) <= s['start'] + 0.05][-1] if huds else None
        if not h: continue
        label = 'FACE-OFF' if s['beat'] == 0 else ('FINAL ROUND' if s['beat'] >= 6 else f'ROUND {s["beat"]}/6')
        p = f'{work}/hud{len(pngs)}.png'; hud_png(p, h, label); pngs.append((p, TITLE + s['start'], TITLE + s['start'] + s['L']))
    for e in ev:
        if e['type'] == 'call':
            p = f'{work}/call{len(pngs)}.png'; pill_png(p, e['text']); a = TITLE + rel(e['t']); pngs.append((p, a, min(a + 7, total)))
    win = res['winner']; wname = res[win]['name'] or 'Winner'
    rp = f'{work}/result.png'; result_png(rp, wname, win); pngs.append((rp, total - TAIL, total))

    # stage 1: title + the real clips, concatenated (frozen on the last frame if a clip was late)
    ins, flt = ['-loop', '1', '-framerate', str(FPS), '-t', str(TITLE), '-i', title, '-f', 'lavfi', '-t', str(TITLE), '-i', 'anullsrc=r=44100:cl=stereo'], []
    flt += [f'[0:v]scale={W}:{H},setsar=1,fps={FPS},format=yuv420p[v0]', '[1:a]aformat=sample_rates=44100:channel_layouts=stereo[a0]']
    for i, s in enumerate(segs):
        ins += ['-i', s['file']]; d = duration(s['file']); n = 2 + i; use = min(s['L'], d); pad = max(0.0, s['L'] - d)
        flt.append(f'[{n}:v]scale={W}:-2:flags=bicubic,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps={FPS},format=yuv420p,trim=duration={use:.3f},setpts=PTS-STARTPTS'
                   + (f',tpad=stop_mode=clone:stop_duration={pad:.3f}' if pad > 0 else '') + f'[v{i+1}]')
        if has_audio(s['file']): flt.append(f'[{n}:a]aformat=sample_rates=44100:channel_layouts=stereo,atrim=duration={use:.3f},asetpts=PTS-STARTPTS,apad=whole_dur={s["L"]:.3f},volume=0.6[a{i+1}]')
        else: flt.append(f'anullsrc=r=44100:cl=stereo,atrim=duration={s["L"]:.3f}[a{i+1}]')
    flt.append(''.join(f'[v{k}][a{k}]' for k in range(len(segs) + 1)) + f'concat=n={len(segs)+1}:v=1:a=1[v][a]')
    base = f'{work}/base.mp4'
    sh(['ffmpeg', '-y', '-v', 'error'] + ins + ['-filter_complex', ';'.join(flt), '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'aac', '-b:a', '192k', base])

    # voices, played one after the other like on the screen (the screen's queue), starting when they were spoken
    voices, prev_end = [], 0.0
    for e in [x for x in ev if x['type'] == 'say' and x.get('url')]:
        f = local(e['url'])
        if not os.path.exists(f): continue
        d = duration(f); start = max(TITLE + rel(e['t']), prev_end); voices.append((f, start, start + d)); prev_end = start + d + 0.15
    # stage 2: overlays + voices (loudest) over the ducked clip sound
    ins2, flt2, last = ['-i', base], [], '0:v'
    for k, (p, a, b) in enumerate(pngs):
        ins2 += ['-loop', '1', '-framerate', str(FPS), '-t', f'{total:.2f}', '-i', p]
        flt2.append(f'[{last}][{k+1}:v]overlay=0:0:enable=\'between(t,{a:.2f},{b:.2f})\'[o{k}]'); last = f'o{k}'
    duck = ''.join(f',volume=0.22:enable=\'between(t,{a:.2f},{b:.2f})\'' for _, a, b in voices)
    flt2.append(f'[0:a]anull{duck}[bg]')
    mix = '[bg]'
    for j, (f, a, b) in enumerate(voices):
        ins2 += ['-i', f]; n = len(pngs) + 1 + j; ms = int(a * 1000)
        flt2.append(f'[{n}:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=1.5,adelay={ms}|{ms}[w{j}]'); mix += f'[w{j}]'
    flt2.append(f'{mix}amix=inputs={len(voices)+1}:normalize=0:duration=first:dropout_transition=0[aout]')
    sh(['ffmpeg', '-y', '-v', 'error'] + ins2 + ['-filter_complex', ';'.join(flt2), '-map', f'[{last}]', '-map', '[aout]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-t', f'{total:.2f}', out])
    mb = os.path.getsize(out) / 1e6
    print(f'OK  {out}\n    {total:.0f}s, {mb:.0f} MB | {len(segs)} clips, {len(voices)} voice lines, {len(pngs)} overlays')

if __name__ == '__main__': main()
