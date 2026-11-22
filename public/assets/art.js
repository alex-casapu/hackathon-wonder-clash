// Pixel sprites drawn in code (no generated images): flying saucer, martian, robot. Right-aligned half rows are mirrored.
(function(){
  const PAL={w:'#fff',c:'#00f0ff',m:'#ff3fa4',y:'#ffe600',g:'#00ff66',r:'#ff2a2a',b:'#2a3cff',k:'#000',x:'#7a7a7a'};
  const HALF=(rows,w)=>rows.map(r=>{const h=r.padStart(w,'.');return h+h.split('').reverse().join('')});
  function svg(rows,px,pal){
    const p=Object.assign({},PAL,pal||{});const W=rows[0].length,H=rows.length;let o='';
    rows.forEach((r,y)=>{let x=0;while(x<r.length){const ch=r[x];if(ch==='.'){x++;continue}let n=1;while(r[x+n]===ch)n++;o+=`<rect x="${x}" y="${y}" width="${n}" height="1" fill="${p[ch]||ch}"/>`;x+=n}});
    return `<svg viewBox="0 0 ${W} ${H}" width="${W*px}" height="${H*px}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">${o}</svg>`;
  }
  const saucer=HALF(['ccc','ccccc','ccwwccc','kkkkkkkkk','ggggggggggg','ggygygygygyg','wwwwwwwwwwwww','.kkkkkkkkkkk','....ggggggg'],13);
  const beam=HALF(['..y','..yy','.yyyy','.yyyyyy','yyyyyyyy','yyyyyyyyyy'],13);
  const alien=HALF(['mmmm','mmwmmm','mmmmwmmm','mmmmmmmmm','ggggggggg','ggkkkkggg','ggkkkkggg','ggggggggg','ggggkkkkg','.ggggggggg','..ggggggg','..cccccccc','.ccccccccc'],10);
  const robot=HALF(['w','m','kwwwwwww','wwwwwwwww','wkccwwwww','wkccwwwww','wwwwwwwww','wkwkwkwkw','kwwwwwwww','..gggggg','wwwwwwwwwwww','wcccccccccc','wcwwwcwwcwc','wcccccccccc','.wwwwwwwwww','.ww.....ww'],12);
  const sat=HALF(['y','x','xxx','.cxxxx','cckxxxx','.cxxxx','xxx'],8);
  window.ART={svg,PAL,saucer:(px,pal)=>svg(saucer,px,pal),beam:(px,pal)=>svg(beam,px,pal),alien:(px,pal)=>svg(alien,px,pal),robot:(px,pal)=>svg(robot,px,pal),sat:(px,pal)=>svg(sat,px,pal)};
})();
