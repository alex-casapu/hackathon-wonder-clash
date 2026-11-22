// Debug dock for the main screen: a thin bar at the bottom (spend, cap, STOP) + an expandable drawer with everything else.
// Local only: if the debug stream is refused (page opened from another machine) the dock removes itself. Press "d" to toggle the drawer.
(() => {
  const css = `
  #dbg{position:fixed;left:0;right:0;bottom:0;z-index:50;font:12px/1.35 -apple-system,system-ui,sans-serif;color:#ece8ff}
  #dbg *{box-sizing:border-box}
  #dbg:not(.open) .bar{display:none}
  #dbg-mini{position:fixed;right:1vw;bottom:1vh;z-index:50;display:flex;gap:6px;align-items:center;background:#000a;border-radius:99px;padding:3px 4px 3px 10px;font:600 12px system-ui;color:#cfc8ee;opacity:.55;transition:opacity .2s}
  #dbg-mini:hover{opacity:1}
  #dbg-mini button{border:0;border-radius:99px;background:#e11d2e;color:#fff;font-weight:900;padding:2px 9px;cursor:pointer}
  #dbg.open #dbg-mini{display:none}
  #dbg .bar{display:flex;align-items:center;gap:12px;background:#0c0916f2;border-top:1px solid #ffffff22;padding:5px 12px;height:40px}
  #dbg button,#dbg input{font:inherit;border:0;border-radius:7px;padding:5px 10px;background:#2a2342;color:#ece8ff;cursor:pointer}
  #dbg button:hover{filter:brightness(1.25)}
  #dbg #d-stop{background:#e11d2e;color:#fff;font-weight:900;letter-spacing:.04em}
  #dbg #d-stop.halted{background:#7a1a22}
  #dbg .sp{font-weight:900;font-size:15px;font-variant-numeric:tabular-nums}
  #dbg .mut{color:#8f88ad}.ok{color:#3ddc84}.warn{color:#ffb020}.bad{color:#ff4d4d}
  #dbg .meter{width:110px;height:7px;border-radius:5px;background:#2a2342;overflow:hidden}#dbg .meter i{display:block;height:100%;background:#3ddc84}
  #dbg .drawer{display:none;background:#0c0916f7;border-top:1px solid #ffffff22;max-height:62vh;overflow:auto;padding:10px 12px}
  #dbg.open .drawer{display:block}
  #dbg .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px}
  #dbg .card{background:#171327;border-radius:10px;padding:10px}
  #dbg h4{margin:0 0 6px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#8f88ad}
  #dbg .row{display:flex;flex-wrap:wrap;gap:6px;margin:5px 0;align-items:center}
  #dbg table{width:100%;border-collapse:collapse;font-size:11px}#dbg td,#dbg th{padding:2px 5px;text-align:left;border-bottom:1px solid #ffffff10}#dbg th{color:#8f88ad;font-weight:600}
  #dbg pre{margin:0;max-height:200px;overflow:auto;font:10.5px/1.35 ui-monospace,Menlo,monospace;color:#cfc8ee;white-space:pre-wrap}
  #dbg .go{background:#2b8a57}#dbg .wn{background:#9a6a10}
  #dbg-banner{position:fixed;left:0;right:0;bottom:40px;z-index:49;text-align:center;font:700 13px system-ui;color:#fff;background:#b3121f;padding:4px;display:none}`;
  const html = `
  <div class="drawer"><div class="grid">
    <div class="card"><h4>Spend (this session)</h4><div class="row"><span class="sp" id="d-sp2">$0.00</span><span class="mut" id="d-capl"></span></div><div id="d-kinds"></div><div class="row mut" id="d-proj"></div>
      <div class="row">cap $ <input id="d-cap" type="number" min="0" step="1" style="width:64px"> <button id="d-capset">Set</button> <button class="go" id="d-resume">Resume paid calls</button></div></div>
    <div class="card"><h4>Match</h4><div class="row" id="d-match"></div>
      <div class="row"><button class="go" data-a="start">Start</button><button data-a="skip">Skip phase</button><button data-a="reset">Reset</button><button data-a="wipe">Clear players</button><button data-a="bots?n=20">+20 bots</button></div></div>
    <div class="card"><h4>Cost controls</h4>
      <div class="row"><label><input type="checkbox" id="d-eco"> Economy (2 branches/round)</label></div>
      <div class="row"><label><input type="checkbox" id="d-aud"> Sound inside video clips</label></div>
      <div class="row"><label><input type="checkbox" id="d-voi"> Auto-generate voice lines when needed</label></div>
      <div class="mut">Unchosen branches are cancelled while queued (refunded). Reset/STOP cancels everything in flight.</div></div>
    <div class="card"><h4>Style</h4><div class="row"><select id="d-style" style="background:#2a2342;color:#ece8ff;border:0;border-radius:7px;padding:5px"></select> <a href="/styles" target="_blank" style="color:#9ad">compare all styles</a></div><div class="mut">Switch in the lobby only.</div></div>
    <div class="card"><h4>Characters & voices</h4><div id="d-ros"></div><div class="row"><button class="wn" id="d-genros">Generate missing portraits</button><button class="wn" id="d-warm">Pre-generate voice lines</button></div>
      <div class="mut">Portraits and voice lines are cached on disk: each is paid once.</div></div>
    <div class="card"><h4>Performance</h4><div id="d-perf"></div></div>
    <div class="card" style="grid-column:1/-1"><h4>Paid calls (latest)</h4><table><thead><tr><th>#</th><th>kind</th><th>label</th><th>USD</th><th>status</th><th>age</th></tr></thead><tbody id="d-items"></tbody></table></div>
    <div class="card" style="grid-column:1/-1"><h4>Server log</h4><pre id="d-logs"></pre></div>
  </div></div>
  <div class="bar"><button id="d-stop">⛔ STOP ALL</button><span class="sp" id="d-sp">$0.00</span><div class="meter"><i id="d-bar" style="width:0"></i></div><span class="mut" id="d-cap2"></span>
    <span class="mut" id="d-state"></span><span style="flex:1"></span><span id="d-mode" class="mut"></span><button id="d-toggle">▲ Debug</button></div>`;
  const root = document.createElement('div'); root.id = 'dbg'; root.innerHTML = html;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  const banner = document.createElement('div'); banner.id = 'dbg-banner'; document.body.append(banner, root);
  const mini = document.createElement('div'); mini.id = 'dbg-mini'; mini.innerHTML = '<span id="m-mode"></span><span id="m-sp">$0.00</span><button id="m-stop" title="STOP ALL (cancels everything, blocks paid calls)">STOP</button>'; document.body.appendChild(mini);
  mini.querySelector('#m-stop').onclick = () => adm('halt');
  const $ = (id) => document.getElementById(id), adm = (c) => fetch('/admin/' + c).catch(() => {});
  let D = null;
  const toggle = () => { root.classList.toggle('open'); $('d-toggle').textContent = root.classList.contains('open') ? '▼ Debug' : '▲ Debug'; };
  $('d-toggle').onclick = toggle;
  addEventListener('keydown', (e) => { if (e.key === 'd' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) toggle(); });
  $('d-stop').onclick = () => adm('halt'); $('d-resume').onclick = () => adm('resume');
  $('d-capset').onclick = () => adm('cap?usd=' + $('d-cap').value);
  root.querySelectorAll('[data-a]').forEach((b) => (b.onclick = () => adm(b.dataset.a)));
  $('d-eco').onchange = (e) => adm('economy?on=' + (e.target.checked ? 1 : 0));
  $('d-aud').onchange = (e) => adm('audio?on=' + (e.target.checked ? 1 : 0));
  $('d-voi').onchange = (e) => adm('voice?on=' + (e.target.checked ? 1 : 0));
  $('d-genros').onclick = () => { if (D && D.roster.total - D.roster.have && confirm(`Generate ${D.roster.total - D.roster.have} portraits (~$${D.roster.est})?`)) adm('roster'); else if (D && D.roster.have === D.roster.total) alert('All 6 portraits already exist.'); };
  $('d-warm').onclick = () => { if (!D || !D.audioMissing.n) return alert('All voice lines are already cached.'); if (confirm(`Generate ${D.audioMissing.n} voice lines (~$${D.audioMissing.est}, one time)?`)) adm('warm'); };
  const es = new EventSource('/debug-events');
  es.onmessage = (e) => { D = JSON.parse(e.data); draw(); };
  es.onerror = () => { if (!D) { es.close(); root.remove(); banner.remove(); document.body.style.paddingBottom = ''; mini.remove(); } }; // not local: no dock
  function draw() {
    const pct = D.cap ? Math.min(100, 100 * D.spent / D.cap) : 0, left = (D.cap - D.spent).toFixed(2);
    $('d-sp').textContent = $('d-sp2').textContent = '$' + D.spent.toFixed(2);
    $('d-cap2').textContent = `of $${D.cap} · ${D.inflight} in flight`; $('d-capl').textContent = `cap $${D.cap}, $${left} left`;
    $('d-bar').style.width = pct + '%'; $('d-bar').style.background = pct > 80 ? '#ff4d4d' : pct > 50 ? '#ffb020' : '#3ddc84';
    $('d-state').textContent = `${D.phase}${D.phase === 'fight' ? ' r' + D.beat : ''} · ${D.players} players`;
    $('m-sp').textContent = '$' + D.spent.toFixed(2); $('m-mode').textContent = D.halted ? 'STOPPED' : (D.live ? 'LIVE' : 'NOT LIVE'); $('m-mode').style.color = D.live ? '' : '#ff9a3c'; $('m-stop').textContent = D.halted ? 'STOPPED' : 'STOP';
    $('d-mode').innerHTML = D.live ? '<span class="ok">LIVE</span>' : (D.replay ? '<span class="warn">REPLAY</span>' : '<span class="warn">MOCK</span>');
    $('d-stop').className = D.halted ? 'halted' : ''; $('d-stop').textContent = D.halted ? '⛔ STOPPED' : '⛔ STOP ALL';
    banner.style.display = D.halted ? 'block' : 'none'; banner.textContent = 'HALTED: match stopped, queued tasks cancelled, no paid call can start until you press "Resume paid calls" (debug drawer).';
    if (document.activeElement !== $('d-cap')) $('d-cap').value = D.cap;
    $('d-kinds').innerHTML = '<table>' + Object.entries(D.byKind).map(([k, v]) => `<tr><td>${k}</td><td>${v.n}</td><td>$${v.usd.toFixed(3)}</td></tr>`).join('') + '</table>';
    $('d-proj').textContent = `Projected per match: ~$${D.projected} (intro + ${D.branchN} branch clips; portraits and cached voices are free)`;
    $('d-match').innerHTML = `<span class="mut">${D.phase}${D.phase === 'fight' ? ' · round ' + D.beat + ' · ' + D.beatPhase : ''} · ${D.players} players (${D.sim} simulated)</span>`;
    if (document.activeElement !== $('d-style')) { $('d-style').innerHTML = D.styles.map(([k, n]) => `<option value="${k}" ${k === D.style ? 'selected' : ''}>${n}</option>`).join(''); $('d-style').onchange = (e) => adm('style?name=' + e.target.value); }
    $('d-eco').checked = D.economy; $('d-aud').checked = D.audio; $('d-voi').checked = D.voice;
    $('d-ros').innerHTML = `Voices: <b class="${D.voiceProvider === 'elevenlabs' ? 'ok' : 'warn'}">${D.voiceProvider === 'elevenlabs' ? 'ElevenLabs direct' : 'MachGen premade (flat) — add ELEVENLABS_API_KEY'}</b><br>Portraits: <b class="${D.roster.have === D.roster.total ? 'ok' : 'warn'}">${D.roster.have}/${D.roster.total}</b> · voice lines missing: <b class="${D.audioMissing.n ? 'warn' : 'ok'}">${D.audioMissing.n}</b> (~$${D.audioMissing.est})`;
    const s = D.stats; $('d-perf').innerHTML = `Branch latency: avg ${s.avgBranch ?? '–'}s · max ${s.maxBranch ?? '–'}s<br>Video holds: ${s.holds} · branch fallbacks: ${s.fallbacks}`;
    $('d-items').innerHTML = D.items.map((i) => `<tr><td>${i.n}</td><td>${i.kind}</td><td>${i.label}</td><td class="${i.real ? '' : 'mut'}">$${i.usd.toFixed(3)}${i.real ? '' : '~'}</td><td class="${i.status === 'failed' ? 'bad' : i.status === 'done' ? 'ok' : 'mut'}">${i.status}</td><td class="mut">${i.age}s</td></tr>`).join('');
    const lg = $('d-logs'), end = lg.scrollTop + lg.clientHeight >= lg.scrollHeight - 10; lg.textContent = D.logs.join('\n'); if (end) lg.scrollTop = lg.scrollHeight;
  }
})();
