// Brand runtime: duotone SVG filters, starburst clip-path, character -> duotone mapping, pixel sprites (art.js must load first).
(function () {
  const f = (id, r, g, b) => `<filter id="${id}" color-interpolation-filters="sRGB"><feColorMatrix values=".33 .59 .11 0 0 .33 .59 .11 0 0 .33 .59 .11 0 0 0 0 0 1 0"/><feComponentTransfer><feFuncR type="linear" slope="${r}"/><feFuncG type="linear" slope="${g}"/><feFuncB type="linear" slope="${b}"/></feComponentTransfer></filter>`;
  const svg = document.createElement('div');
  svg.innerHTML = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${f('dG', .4, 1.7, .95)}${f('dA', 1.7, .5, 1.2)}${f('dB', .4, 1.5, 1.7)}${f('dY', 1.7, 1.2, .05)}</defs></svg>`;
  document.body.prepend(svg.firstChild);
  const burst = (n, k) => { const p = []; for (let i = 0; i < n * 2; i++) { const a = Math.PI * i / n, r = i % 2 ? k : 1; p.push((50 + 50 * r * Math.cos(a)).toFixed(1) + '% ' + (50 + 50 * r * Math.sin(a)).toFixed(1) + '%'); } return 'polygon(' + p.join(',') + ')'; };
  document.documentElement.style.setProperty('--burst', burst(16, .8));
  const DUO = { seraph: 'dA', moth: 'dB', widow: 'dG', mercury: 'dB', null: 'dG', orchid: 'dA' }; // fixed look per character in casting
  window.BR = {
    duo: (id) => DUO[id] || 'dG',
    corner: (k) => (k === 'A' ? 'dA' : 'dB'),      // once chosen, a fighter wears its corner colour
    gl: (t) => `<span class="gl" data-t="${t}">${t}</span>`,
    ART: window.ART,
  };
})();
