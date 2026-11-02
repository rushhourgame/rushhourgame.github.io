/* RUSH HOUR (was Signal Lost) — 3D renderer (three.js, vendored in js/vendor/three.min.js).
   Gritty low-poly city street at dusk, chase camera. Reads simulation state from Game; owns no gameplay. */
(function (global) {
  'use strict';
  const T = global.THREE;
  const LW = 2.6;                 // lane width (m); sim lane index 0..2 -> world x = (lane-1)*LW, forward = -Z
  const ROAD_HALF = 5.9, CURB_X = 6.1, WALK_OUT = 9.6;
  const FONT = '"Oswald","Bebas Neue",Impact,"Arial Narrow",sans-serif';
  const R = { LW, noGov: /nogov/.test(location.search), ready: false };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const rnd = Math.random;
  function srand(seed) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

  let renderer, scene, camera, canvas, ANISO = 4, mobile = false;
  let W = 1280, H = 720, dpr = 1, ratio = 1, maxRatio = 1;
  let MAXA = 4, clouds = [], sunGlow, sky, skyCol, sunDisc, sun, hemi, fill, lampPoles, lampHeads, lampPools, roadTex, walkTexL, walkTexR, ground;
  const texJobs = [];
  const fogCol = new T.Color();
  const tmpC = new T.Color(), tmpC2 = new T.Color();

  /* ---------------------------------------------------------------- textures */
  function ctex(w, h, draw, repeat, opt) {
    opt = opt || {};
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); draw(g, w, h);
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = opt.maxAniso ? MAXA : ANISO;
    t.generateMipmaps = true; t.minFilter = T.LinearMipmapLinearFilter; t.magFilter = T.LinearFilter;
    if (repeat) t.wrapS = t.wrapT = T.RepeatWrapping;
    if (opt.clampX) t.wrapS = T.ClampToEdgeWrapping;
    if (!opt.noRedraw) { t.userData.redraw = () => { g.clearRect(0, 0, w, h); draw(g, w, h); t.needsUpdate = true; }; texJobs.push(t); }
    return t;
  }
  const hexs = (h) => '#' + h.toString(16).padStart(6, '0');

  /* v11 road: crisp, high-res, fully procedural. Tile = 11.8 m wide x 12 m long. Everything is painted in metres so the markings stay the same
     physical size at any texture size. Layers: periodic multi-octave asphalt grain -> lane tints -> patches/seams/cracks -> manholes + drain grates
     -> sharp paint with worn edges -> gutter + curb lip. The tile wraps vertically (all long features are periodic) and clamps horizontally. */
  function periodicNoise(w, h, cx, cy, seed) {            // bilinear value noise on a wrapping lattice, returns Float32Array w*h in 0..1
    const rr = srand(seed), lat = new Float32Array(cx * cy); for (let i = 0; i < lat.length; i++) lat[i] = rr();
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const fy = y / h * cy, y0 = fy | 0, ty = fy - y0, sy = ty * ty * (3 - 2 * ty), y1 = (y0 + 1) % cy;
      for (let x = 0; x < w; x++) {
        const fx = x / w * cx, x0 = fx | 0, tx = fx - x0, sx = tx * tx * (3 - 2 * tx), x1 = (x0 + 1) % cx;
        const a = lat[y0 * cx + x0], b = lat[y0 * cx + x1], c = lat[y1 * cx + x0], d = lat[y1 * cx + x1];
        out[y * w + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
      }
    }
    return out;
  }
  function drawRoad(g, w, h) {
    const RW = ROAD_HALF * 2, pxm = w / RW, pym = h / 12, X = x => (x + ROAD_HALF) * pxm, Y = y => y * pym, rr = srand(11);
    /* --- asphalt: low-freq mottling + mid blotches + aggregate + fine grain, written per pixel --- */
    const img = g.createImageData(w, h), d = img.data;
    const n1 = periodicNoise(w, h, 5, 10, 3), n2 = periodicNoise(w, h, 18, 36, 5), n3 = periodicNoise(w, h, 64, 128, 7);
    const parkL = X(-1.5 * LW), parkR = X(1.5 * LW);
    for (let y = 0, i = 0, k = 0; y < h; y++) for (let x = 0; x < w; x++, k++, i += 4) {
      let v = 84 + (n1[k] - .5) * 16 + (n2[k] - .5) * 14 + (n3[k] - .5) * 10;
      const r = rr(); v += (r - .5) * 24;                                    // fine grain
      if (r > .972) v += 16 + rr() * 22; else if (r < .03) v -= 16 + rr() * 12;    // bright stones / dark pits
      if (x < parkL || x > parkR) v += 5 + (n2[k] - .5) * 8;                       // parking lanes: older, slightly paler asphalt
      d[i] = v * 1.02; d[i + 1] = v * 1.0; d[i + 2] = v * 1.045 + 1; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    /* --- tyre wear + oil drips in every lane --- */
    for (let l = -1; l <= 1; l++) for (const o of [-0.78, 0.78]) {
      const cx = X(l * LW + o), gr = g.createLinearGradient(cx - .42 * pxm, 0, cx + .42 * pxm, 0);
      gr.addColorStop(0, 'rgba(8,8,10,0)'); gr.addColorStop(.5, 'rgba(10,10,13,.26)'); gr.addColorStop(1, 'rgba(8,8,10,0)');
      g.fillStyle = gr; g.fillRect(cx - .42 * pxm, 0, .84 * pxm, h);
    }
    for (let i = 0; i < 7; i++) { const cx = X((rr() * 2 - 1) * 1.5 * LW), cy = rr() * h, r = (.12 + rr() * .2) * pxm; const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r); gr.addColorStop(0, 'rgba(6,6,9,.5)'); gr.addColorStop(1, 'rgba(6,6,9,0)'); g.fillStyle = gr; g.fillRect(cx - r, cy - r, r * 2, r * 2); }
    /* --- repair patches: sharp-edged rectangles of different tone with a tar seal line --- */
    for (let i = 0; i < 5; i++) {
      const pw = (.7 + rr() * 1.3) * pxm, ph = (.8 + rr() * 1.6) * pym, px = X((rr() * 2 - 1) * 4.4) - pw / 2, py = 30 + rr() * (h - ph - 60), dark = rr() < .6;
      g.fillStyle = dark ? 'rgba(18,19,23,.3)' : 'rgba(120,122,128,.14)'; g.fillRect(px, py, pw, ph);
      for (let q = 0; q < pw * ph / 180; q++) { const v = dark ? 40 + rr() * 30 : 100 + rr() * 40; g.fillStyle = `rgba(${v},${v},${v + 3},.55)`; g.fillRect(px + rr() * pw, py + rr() * ph, 1 + rr() * 1.4, 1 + rr() * 1.4); }
      g.strokeStyle = 'rgba(6,6,8,.78)'; g.lineWidth = Math.max(1.5, pxm * .018); g.strokeRect(px + .5, py + .5, pw, ph);
      g.strokeStyle = 'rgba(150,152,158,.22)'; g.lineWidth = 1; g.strokeRect(px + 2.5, py + 2.5, pw - 4, ph - 4);
    }
    /* --- expansion joint across the road (wraps on the tile edge) --- */
    for (const y of [0, h * .5, h]) { g.fillStyle = 'rgba(5,5,7,.55)'; g.fillRect(0, y - 1.5, w, 3); g.fillStyle = 'rgba(140,142,148,.18)'; g.fillRect(0, y + 1.5, w, 1.5); }
    /* --- cracks: jittered polylines with side branches, dark core + pale lip so they read as depth --- */
    const crack = (x, y, ang, len, wd) => {
      g.beginPath(); g.moveTo(x, y); const pts = [[x, y]];
      for (let k = 0; k < len; k++) { ang += (rr() - .5) * .9; x += Math.cos(ang) * (5 + rr() * 8); y += Math.sin(ang) * (5 + rr() * 8); pts.push([x, y]); g.lineTo(x, y); if (rr() < .12 && wd > .8) crack(x, y, ang + (rr() < .5 ? 1 : -1) * (.6 + rr() * .7), (len - k) * .5 | 0, wd * .6); }
      g.strokeStyle = 'rgba(150,152,160,.2)'; g.lineWidth = wd + 1.6; g.lineJoin = 'round'; g.stroke();
      g.strokeStyle = 'rgba(4,4,6,.82)'; g.lineWidth = wd; g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let k = 1; k < pts.length; k++) g.lineTo(pts[k][0], pts[k][1]); g.stroke();
    };
    for (let i = 0; i < 9; i++) crack(X((rr() * 2 - 1) * 4.6), 20 + rr() * (h - 120), 1.2 + (rr() - .5) * 1.2, 10 + rr() * 16, 1.1 + rr() * 1.3);
    /* --- manholes + drain grates (ring, bevel, cross-hatch, dark gap) --- */
    const manhole = (mx, my, r) => {
      g.fillStyle = 'rgba(6,6,8,.9)'; g.beginPath(); g.arc(mx, my, r * 1.1, 0, 7); g.fill();                                  // road cut-out gap
      const gr = g.createRadialGradient(mx - r * .3, my - r * .3, r * .1, mx, my, r); gr.addColorStop(0, '#6d6e72'); gr.addColorStop(1, '#3b3c40');
      g.fillStyle = gr; g.beginPath(); g.arc(mx, my, r, 0, 7); g.fill();
      g.strokeStyle = 'rgba(20,20,22,.85)'; g.lineWidth = Math.max(1.5, r * .08); for (const f of [.86, .58, .3]) { g.beginPath(); g.arc(mx, my, r * f, 0, 7); g.stroke(); }
      g.save(); g.beginPath(); g.arc(mx, my, r * .84, 0, 7); g.clip(); g.strokeStyle = 'rgba(26,26,28,.7)'; g.lineWidth = Math.max(1, r * .05);
      for (let q = -r * 2; q < r * 2; q += r * .2) { g.beginPath(); g.moveTo(mx + q - r, my - r); g.lineTo(mx + q + r, my + r); g.stroke(); }
      g.strokeStyle = 'rgba(150,152,158,.26)'; for (let q = -r * 2; q < r * 2; q += r * .2) { g.beginPath(); g.moveTo(mx + q - r + 1.2, my + r); g.lineTo(mx + q + r + 1.2, my - r); g.stroke(); } g.restore();
      g.strokeStyle = 'rgba(165,167,172,.45)'; g.lineWidth = 1.4; g.beginPath(); g.arc(mx, my, r * 1.03, Math.PI * .95, Math.PI * 1.7); g.stroke();   // lit rim
    };
    manhole(X(-1.55), Y(2.6), .36 * pxm); manhole(X(1.3), Y(8.4), .36 * pxm); manhole(X(-LW * 1.0 + .3), Y(11.1), .3 * pxm);
    const grate = (gx, gy) => {
      const gw = .62 * pxm, gh = 1.15 * pym; g.fillStyle = 'rgba(5,5,7,.95)'; g.fillRect(gx - gw / 2 - 3, gy - gh / 2 - 3, gw + 6, gh + 6);
      g.fillStyle = '#4a4b4f'; g.fillRect(gx - gw / 2, gy - gh / 2, gw, gh); g.fillStyle = '#0a0a0c';
      for (let q = 0; q < 7; q++) g.fillRect(gx - gw / 2 + gw * .08, gy - gh / 2 + gh * (.06 + q * .135), gw * .84, gh * .07);
      g.strokeStyle = 'rgba(160,162,168,.35)'; g.lineWidth = 1.2; g.strokeRect(gx - gw / 2, gy - gh / 2, gw, gh);
    };
    grate(X(-ROAD_HALF + .55), Y(5.3)); grate(X(ROAD_HALF - .55), Y(10.2)); grate(X(ROAD_HALF - .55), Y(3.2));
    /* --- gutter strip along both kerbs: pale concrete with joints, then a lit curb lip --- */
    for (const s of [-1, 1]) {
      const gx = s < 0 ? 0 : X(ROAD_HALF - .38), gw = .38 * pxm;
      for (let y = 0; y < h; y += 3 * pym) { const v = 104 + (rr() * 22 | 0); g.fillStyle = `rgb(${v},${v - 2},${v - 6})`; g.fillRect(gx, y, gw, 3 * pym); g.fillStyle = 'rgba(15,15,16,.8)'; g.fillRect(gx, y - 1, gw, 2); }
      for (let q = 0; q < gw * h / 40; q++) { const v = 80 + rr() * 80; g.fillStyle = `rgba(${v},${v},${v - 4},.35)`; g.fillRect(gx + rr() * gw, rr() * h, 1.2, 1.2); }
      const lip = s < 0 ? 0 : w - .09 * pxm; g.fillStyle = 'rgba(205,203,196,.8)'; g.fillRect(lip, 0, .09 * pxm, h);
      g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(s < 0 ? gw : X(ROAD_HALF - .38) - 2.5, 0, 2.5, h);      // shadow line where gutter meets asphalt
    }
    /* --- paint: crisp edges, thin dark undercut, then worn flecks inside the paint only --- */
    const rects = [];
    const paint = (x0, y0, wd, ht, col) => { rects.push([x0, y0, wd, ht]); g.fillStyle = 'rgba(8,8,10,.35)'; g.fillRect(x0 - 1.2, y0 - 1.2, wd + 2.4, ht + 2.4); g.fillStyle = col; g.fillRect(x0, y0, wd, ht); };
    const lineW = .17 * pxm;
    paint(X(-1.5 * LW) - lineW / 2, 0, lineW, h, '#f2b01a');                                   // yellow kerb line (left)
    paint(X(1.5 * LW) - lineW / 2, 0, lineW, h, '#f6f5ef');                                    // white edge line (right)
    for (const x of [-LW / 2, LW / 2]) for (let k = 0; k < 2; k++) paint(X(x) - lineW / 2, (k * 6 + .5) * pym, lineW, 3 * pym, '#f8f8f2');   // lane dashes: 3 m paint, 3 m gap
    g.save(); g.beginPath(); for (const r of rects) g.rect(r[0], r[1], r[2], r[3]); g.clip();
    for (let i = 0; i < w * h / 700; i++) { const v = 70 + rr() * 30; g.fillStyle = `rgba(${v},${v},${v + 3},${.4 + rr() * .35})`; g.fillRect(rr() * w, rr() * h, 1 + rr() * 2.4, 1 + rr() * 3.4); }
    for (let i = 0; i < 90; i++) { g.fillStyle = 'rgba(70,70,74,.5)'; g.fillRect(rr() * w, rr() * h, lineW * (.3 + rr() * .5), (.1 + rr() * .35) * pym); }       // scuffs / chipped patches
    g.restore();
    /* --- raised reflective studs in the dash gaps --- */
    for (const x of [-LW / 2, LW / 2]) for (let k = 0; k < 2; k++) { const cy = (k * 6 + 5) * pym; g.fillStyle = 'rgba(0,0,0,.5)'; g.beginPath(); g.arc(X(x) + 1, cy + 1.5, .07 * pxm, 0, 7); g.fill(); g.fillStyle = '#e9e6d6'; g.beginPath(); g.arc(X(x), cy, .06 * pxm, 0, 7); g.fill(); }
  }
  function drawWalk(g, w, h) {
    g.fillStyle = '#84837e'; g.fillRect(0, 0, w, h);
    const rr = srand(23), sw = w / 2, sh = h / 4;
    for (let i = 0; i < 2; i++) for (let j = 0; j < 4; j++) {
      const v = 120 + (rr() * 22 | 0); g.fillStyle = `rgb(${v},${v - 1},${v - 5})`; g.fillRect(i * sw, j * sh, sw, sh);
    }
    for (let i = 0; i < 5000 * (w / 256) * (h / 512); i++) { const v = 100 + (rr() * 50 | 0); g.fillStyle = `rgba(${v},${v},${v - 4},.4)`; g.fillRect(rr() * w, rr() * h, 1 + rr() * 2.4, 1 + rr() * 2.4); }
    g.fillStyle = 'rgba(40,38,34,.55)';
    for (let i = 0; i <= 2; i++) g.fillRect(i * sw - 2.5, 0, 5, h);
    for (let j = 0; j <= 4; j++) g.fillRect(0, j * sh - 2.5, w, 5);
    for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(30,28,26,.18)'; g.beginPath(); g.ellipse(rr() * w, rr() * h, 16 + rr() * 32, 10 + rr() * 18, 0, 0, 7); g.fill(); }
  }
  // facade tile: 6 x 4 windows (18 m x 12.8 m)
  const FAC = [
    { wall: '#b0634a', frame: '#efe6d2', glass: ['#3a5670', '#8fb4d0'], brick: true },
    { wall: '#d9c79f', frame: '#f4eee0', glass: ['#35546e', '#86aac6'] },
    { wall: '#4e86ab', frame: '#26323c', glass: ['#3f6f96', '#a6cce6'], curtain: true },
    { wall: '#c99a56', frame: '#f1e4c8', glass: ['#35516a', '#8aaecb'], cornice: true }
  ];
  function drawFacade(st, lit) {
    return (g, w, h) => {
      const cw = w / 6, ch = h / 4, rr = srand(st === FAC[0] ? 5 : st === FAC[1] ? 6 : st === FAC[2] ? 7 : 8);
      if (lit) { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); } else {
        g.fillStyle = st.wall; g.fillRect(0, 0, w, h);
        for (let i = 0; i < 9000; i++) { const a = rr() * .16; g.fillStyle = rr() < .5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a * .6})`; g.fillRect(rr() * w, rr() * h, 1 + rr() * 2, 1 + rr() * 2); }
        if (st.brick) { g.fillStyle = 'rgba(0,0,0,.16)'; for (let y = 0; y < h; y += 6) g.fillRect(0, y, w, 1); }
        g.fillStyle = 'rgba(0,0,0,.18)'; for (let j = 0; j < 4; j++) g.fillRect(0, j * ch + ch - 3, w, 3);
      }
      for (let j = 0; j < 4; j++) for (let i = 0; i < 6; i++) {
        const x0 = i * cw, y0 = j * ch;
        const wx = st.curtain ? x0 + 4 : x0 + cw * .24, wy = st.curtain ? y0 + 6 : y0 + ch * .2, ww = st.curtain ? cw - 8 : cw * .52, wh = st.curtain ? ch - 14 : ch * .56;
        const on = rr() < .3, warm = rr() < .82, cool = '#cfe3ff';
        if (lit) {
          if (on) { g.fillStyle = warm ? (rr() < .5 ? '#ffd58a' : '#ffe6b0') : cool; g.fillRect(wx, wy, ww, wh); }
        } else {
          const gr = g.createLinearGradient(0, wy, 0, wy + wh); gr.addColorStop(0, st.glass[1]); gr.addColorStop(.55, st.glass[0]); gr.addColorStop(1, st.glass[0]);
          g.fillStyle = st.frame; g.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);
          g.fillStyle = gr; g.fillRect(wx, wy, ww, wh);
          if (on) { g.fillStyle = warm ? 'rgba(235,196,120,.78)' : 'rgba(190,215,245,.7)'; g.fillRect(wx, wy, ww, wh); }
          g.fillStyle = st.frame; g.fillRect(wx + ww / 2 - 1, wy, 2, wh); g.fillRect(wx, wy + wh * .45, ww, 2);
          g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(wx - 3, wy + wh + 3, ww + 6, 3);
          if (!st.curtain && rr() < .12) { g.fillStyle = '#9ea1a3'; g.fillRect(wx + ww * .1, wy + wh + 6, ww * .6, ch * .13); }
        }
      }
    };
  }
  const SHOPS = [
    ['LUCKY SLICE', '#8a2f2b', 'PIZZA'], ['CORNER LIQUOR', '#2c4570', 'BEER · WINE'], ['24H MART', '#2f6b4a', 'OPEN 24 HOURS'], ['CITY PHARMACY', '#2a7070', 'RX'],
    ['GOLD PAWN', '#b08a2e', 'CASH FOR GOLD'], ['TACO LOCO', '#7a3a22', 'TACOS'], ['SUNNY CAFE', '#5d3560', 'COFFEE'], ['BAIL BONDS', '#3b3f46', 'FAST · 24/7']
  ];
  function drawShop(si, lit) {
    return (g, w, h) => {
      const S = SHOPS[si], rr = srand(40 + si);
      if (lit) g.fillStyle = '#000'; else { g.fillStyle = '#4a4742'; }
      g.fillRect(0, 0, w, h);
      if (!lit) { for (let i = 0; i < 4000; i++) { const a = rr() * .16; g.fillStyle = `rgba(0,0,0,${a})`; g.fillRect(rr() * w, rr() * h, 2, 2); } }
      const aw = h * .22;
      // sign board
      g.fillStyle = lit ? '#fff' : S[1]; g.fillRect(w * .08, h * .02, w * .84, h * .24);
      g.fillStyle = lit ? '#000' : 'rgba(255,255,255,.95)'; g.font = `700 ${h * .17}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(S[0], w * .5, h * .15);
      if (lit) { g.globalCompositeOperation = 'destination-over'; g.fillStyle = '#000'; g.fillRect(0, 0, w, h); g.globalCompositeOperation = 'source-over'; }
      // awning
      for (let i = 0; i < 16; i++) { g.fillStyle = lit ? (i % 2 ? '#000' : '#222') : (i % 2 ? S[1] : '#e8e2d2'); g.fillRect(i * w / 16, h * .3, w / 16, aw * .5); }
      // windows and door
      const wy = h * .5, wh = h * .42;
      const wins = [[.04, .36], [.46, .24], [.74, .22]];
      wins.forEach((v, k) => {
        const x = w * v[0], ww = w * v[1];
        if (k === 1) { g.fillStyle = lit ? '#2a2018' : '#2a2c2e'; g.fillRect(x, wy, ww, wh); g.fillStyle = lit ? '#ffe2a8' : '#c9a86a'; g.fillRect(x + ww * .12, wy + wh * .1, ww * .76, wh * .9); return; }
        const gr = g.createLinearGradient(0, wy, 0, wy + wh);
        if (lit) { gr.addColorStop(0, '#ffeab8'); gr.addColorStop(1, '#e8a95a'); } else { gr.addColorStop(0, '#e6c88c'); gr.addColorStop(1, '#a8743a'); }
        g.fillStyle = lit ? '#000' : '#202224'; g.fillRect(x - 4, wy - 4, ww + 8, wh + 8);
        g.fillStyle = gr; g.fillRect(x, wy, ww, wh);
        if (!lit) { g.fillStyle = 'rgba(20,20,20,.5)'; for (let s = 0; s < 3; s++) g.fillRect(x + ww * (.15 + s * .27), wy + wh * .55, ww * .16, wh * .45); }
      });
      if (!lit) { g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, h - 10, w, 10); }
    };
  }
  function drawBoard(text) {
    return (g, w, h) => {
      g.fillStyle = '#1b2430'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#2f6fb3'; g.fillRect(0, 0, w, h * .2);
      g.fillStyle = '#fff'; g.font = `600 ${h * .13}px ${FONT}`; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText('CITY WATCH  ·  SURVEILLANCE UNIT', w * .04, h * .1);
      g.fillStyle = '#f2f2f0'; g.textAlign = 'center';
      const words = (text || '').split(' '); const lines = []; let cur = '';
      g.font = `700 ${h * .27}px ${FONT}`;
      for (const wd of words) { const t = cur ? cur + ' ' + wd : wd; if (g.measureText(t).width > w * .9 && cur) { lines.push(cur); cur = wd; } else cur = t; }
      if (cur) lines.push(cur);
      const lh = h * .3, y0 = h * .6 - (lines.length - 1) * lh / 2;
      lines.forEach((l, i) => g.fillText(l, w / 2, y0 + i * lh));
      g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(0, h * .2, w, 3);
    };
  }

  /* ---------------------------------------------------------------- geometry helpers */
  const _c = new T.Color();
  function paint(geo, hex) {
    const n = geo.attributes.position.count, a = new Float32Array(n * 3); _c.set(hex);
    for (let i = 0; i < n; i++) { a[i * 3] = _c.r; a[i * 3 + 1] = _c.g; a[i * 3 + 2] = _c.b; }
    geo.setAttribute('color', new T.BufferAttribute(a, 3)); return geo;
  }
  function bx(w, h, d, x, y, z, hex, tp) {
    const g = new T.BoxGeometry(w, h, d);
    if (tp) { const p = g.attributes.position; for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, p.getX(i) * (tp.tx === undefined ? 1 : tp.tx)); p.setZ(i, p.getZ(i) * (p.getZ(i) < 0 ? (tp.tf === undefined ? 1 : tp.tf) : (tp.tb === undefined ? 1 : tp.tb))); } g.computeVertexNormals(); }
    g.translate(x, y, z); return paint(g, hex);
  }
  function cyl(r, len, x, y, z, hex, seg) { const g = new T.CylinderGeometry(r, r, len, seg || 10); g.rotateZ(Math.PI / 2); g.translate(x, y, z); return paint(g, hex); }
  function cylV(r0, r1, h, x, y, z, hex, seg) { const g = new T.CylinderGeometry(r1, r0, h, seg || 8); g.translate(x, y, z); return paint(g, hex); }
  const merge = (list) => { const mixed = list.some(g => !g.index) && list.some(g => g.index); if (mixed) list = list.map(g => g.index ? g.toNonIndexed() : g); const m = T.mergeGeometries(list, false); if (!m) console.warn('merge failed'); return m; };
  function wheels(list, xs, zs, r, w) { for (const z of zs) for (const x of xs) { list.push(cyl(r, w, x, r, z, '#121214', 12)); list.push(cyl(r * .55, w + .02, x + Math.sign(x) * .005, r, z, '#7d8186', 10)); } }
  function lightsAt(L, tx, ty, tw, th, zr, zf, extra) {
    const l = [];
    for (const s of [-1, 1]) { l.push(bx(tw, th, .06, s * tx, ty, L / 2 + zr, '#ff3a2a')); l.push(bx(tw, th * .9, .06, s * tx, ty, -L / 2 - zf, '#fff3cf')); }
    return merge(l);
  }
  const VEH = {};
  function vehGeo(kind, hex) {
    const key = kind + hex; if (VEH[key]) return VEH[key];
    const P = [], dark = '#1b232b', bump = '#232427';
    let L, rf = 1.5, rest = {};
    if (kind === 'sedan' || kind === 'taxi' || kind === 'police') {
      L = 4.4; const col = kind === 'police' ? '#15171b' : hex;
      P.push(bx(1.85, .62, 4.4, 0, .58, 0, col));
      P.push(bx(1.62, .5, 2.2, 0, 1.15, .15, dark, { tx: .86, tf: .76, tb: .9 }));
      P.push(bx(1.5, .05, 1.5, 0, 1.43, .2, col));
      P.push(bx(1.8, .2, .18, 0, .42, 2.22, bump)); P.push(bx(1.8, .2, .18, 0, .42, -2.22, bump));
      wheels(P, [-.92, .92], [-1.4, 1.4], .34, .22);
      if (kind === 'taxi') { P.push(bx(.7, .2, .32, 0, 1.58, .2, '#f4f1e4')); P.push(bx(1.86, .06, 4.2, 0, .72, 0, '#1a1a1a')); }
      if (kind === 'police') { P.push(bx(1.87, .34, 2.0, 0, .64, .2, '#ececea')); P.push(bx(1.1, .09, .3, 0, 1.5, .2, '#1a1a1a')); P.push(bx(1.7, .04, .5, 0, .91, -1.45, '#ececea')); }
      rest.lights = lightsAt(4.4, .66, .78, .42, .13, .01, .01); rest.roof = kind === 'police' ? 1.55 : 1.45;
    } else if (kind === 'van') {
      L = 5.6;
      P.push(bx(2.0, .7, 5.6, 0, .65, 0, hex));
      P.push(bx(2.0, 1.45, 3.7, 0, 1.72, 1.0, hex));
      P.push(bx(1.9, .9, 1.9, 0, 1.45, -1.85, dark, { tf: .72 }));
      P.push(bx(1.9, .08, 1.7, 0, 1.92, -1.85, hex, { tf: .75 }));
      P.push(bx(2.02, .12, 5.6, 0, 1.0, 0, '#ceccc4'));
      P.push(bx(2.0, .2, .18, 0, .42, 2.8, bump)); P.push(bx(2.0, .2, .18, 0, .42, -2.8, bump));
      P.push(bx(.04, 1.35, .04, 0, 1.7, 2.86, '#222'));
      wheels(P, [-1.0, 1.0], [-1.9, 1.7], .4, .24);
      rest.lights = lightsAt(5.6, .92, .95, .16, .5, .01, .01); rest.roof = 2.5;
    } else if (kind === 'truck') {
      L = 8.5;
      P.push(bx(2.0, .4, 8.5, 0, .64, 0, '#262628'));
      P.push(bx(2.1, 1.5, 2.0, 0, 1.4, -3.2, hex, { tf: .86 }));
      P.push(bx(2.12, .55, 1.7, 0, 1.78, -3.25, dark, { tf: .8 }));
      P.push(bx(2.4, 2.5, 6.0, 0, 2.15, 1.2, '#d9d7cf'));
      P.push(bx(2.42, .22, 6.0, 0, 1.0, 1.2, hex));
      P.push(bx(2.2, 1.7, .05, 0, 2.2, 4.23, '#bdbbb3'));
      P.push(bx(2.2, .2, .2, 0, .55, 4.35, bump));
      wheels(P, [-1.0, 1.0], [-3.2, 1.9, 3.3], .46, .26);
      rest.lights = lightsAt(8.5, .9, .75, .16, .3, .01, .01); rest.roof = 3.4;
    } else { // bus
      L = 11;
      P.push(bx(2.5, 2.3, 11, 0, 1.65, 0, hex));
      P.push(bx(2.52, .85, 10.4, 0, 2.15, .1, dark));
      P.push(bx(2.4, .3, 10.8, 0, 2.95, 0, '#cfd0cc'));
      P.push(bx(2.52, .3, 11, 0, .62, 0, '#2d3a63'));
      P.push(bx(2.0, .85, .05, 0, 2.15, 5.52, dark));
      P.push(bx(2.5, .2, .2, 0, .5, 5.55, bump));
      wheels(P, [-1.14, 1.14], [-3.6, 3.5], .52, .3);
      rest.lights = lightsAt(11, 1.0, 1.15, .2, .3, .01, .01); rest.roof = 3.1;
    }
    return (VEH[key] = { body: merge(P), lights: rest.lights, L, roof: rest.roof });
  }
  const PAINTS = ['#2c5fa3', '#c9ced3', '#202226', '#b3262c', '#f2f0e8', '#2f8057', '#e08a1e', '#5d7186', '#7b3f8c', '#d4b02a'];
  const VAN_PAINTS = ['#efede5', '#86a6bd', '#2f5aa8', '#c0392b', '#e0a021'];

  const matVeh = new T.MeshLambertMaterial({ vertexColors: true });
  const matLight = new T.MeshBasicMaterial({ vertexColors: true });
  const matPoliceR = new T.MeshBasicMaterial({ color: 0xff3030 }), matPoliceB = new T.MeshBasicMaterial({ color: 0x3a6bff });
  const barGeoR = new T.BoxGeometry(.38, .12, .2), barGeoB = new T.BoxGeometry(.38, .12, .2);
  function makeVeh() {
    const g = new T.Group(), body = new T.Mesh(undefined, matVeh), lights = new T.Mesh(undefined, matLight);
    body.castShadow = true; body.receiveShadow = true;
    const bar = new T.Group(), r = new T.Mesh(barGeoR, matPoliceR), b = new T.Mesh(barGeoB, matPoliceB);
    r.position.set(-.25, 0, 0); b.position.set(.25, 0, 0); bar.add(r, b); bar.visible = false;
    g.add(body, lights, bar); g.visible = false; scene.add(g);
    return { root: g, body, lights, bar };
  }
  function setVeh(v, kind, hex, Lw, sx, sy) {
    const d = vehGeo(kind, hex); v.body.geometry = d.body; v.lights.geometry = d.lights;
    v.root.scale.set(sx, sy, Lw / d.L);
    v.bar.visible = kind === 'police'; v.bar.position.set(0, d.roof + .02, .2); v.kind = kind;
  }

  /* ---------------------------------------------------------------- obstacles (barrier / beam props) */
  function geoJersey() {
    return merge([bx(2.3, .3, .7, 0, .15, 0, '#a4a49e'), bx(2.3, .55, .7, 0, .575, 0, '#adada7', { tf: .38, tb: .38 }), bx(2.31, .09, .3, 0, .62, 0, '#d9772b'), bx(2.31, .09, .3, 0, .4, 0, '#e9e6dc')]);
  }
  function geoSaw() {
    const P = [];
    for (const x of [-1.0, 1.0]) for (const z of [-.26, .26]) P.push(bx(.07, .92, .07, x, .46, z, '#c9c6bc'));
    for (let k = 0; k < 6; k++) for (const y of [.82, .55]) P.push(bx(.4, .2, .05, -1.0 + k * .4 + .2, y, 0, (k + (y > .7 ? 0 : 1)) % 2 ? '#d94b2b' : '#ece9df'));
    P.push(bx(2.2, .06, .5, 0, .03, 0, '#444'));
    return merge(P);
  }
  function geoCones() {
    const P = [];
    for (let i = 0; i < 5; i++) { const x = -1.0 + i * .5; P.push(bx(.46, .04, .46, x, .02, 0, '#2c2c2e')); P.push(cylV(.2, .045, .82, x, .45, 0, '#e2602a', 10)); P.push(cylV(.135, .105, .17, x, .5, 0, '#efece4', 10)); }
    return merge(P);
  }
  function geoGantryPosts() {
    return merge([bx(.14, 2.45, .14, -1.3, 1.22, 0, '#b9b8b0'), bx(.14, 2.45, .14, 1.3, 1.22, 0, '#b9b8b0'), bx(.5, .08, .5, -1.3, .04, 0, '#3a3a3c'), bx(.5, .08, .5, 1.3, .04, 0, '#3a3a3c'), bx(.2, .1, .2, -1.3, 1.9, 0, '#d9772b'), bx(.2, .1, .2, 1.3, 1.9, 0, '#d9772b')]);
  }
  function geoGantryLamps() { return merge([bx(.2, .14, .2, -1.3, 2.52, 0, '#ffb02e'), bx(.2, .14, .2, 1.3, 2.52, 0, '#ffb02e')]); }
  let matGantry;
  function drawGantry(g, w, h) {
    g.fillStyle = '#e8e6de'; g.fillRect(0, 0, w, h * .58);
    g.fillStyle = '#b8352a'; let fs = h * .3; g.font = `700 ${fs}px ${FONT}`; const mw = g.measureText('ROAD CLOSED').width; if (mw > w * .86) { fs *= w * .86 / mw; g.font = `700 ${fs}px ${FONT}`; } g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('ROAD CLOSED', w / 2, h * .3);
    g.fillStyle = '#e8e6de'; g.fillRect(0, h * .58, w, h * .42);
    g.save(); g.beginPath(); g.rect(0, h * .58, w, h * .42); g.clip(); g.fillStyle = '#e07a26';
    for (let x = -h; x < w + h; x += h * .36) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + h * .18, h); g.lineTo(x + h * .18 + h * .42, h * .58); g.lineTo(x + h * .42, h * .58); g.closePath(); g.fill(); }
    g.restore(); g.strokeStyle = '#222'; g.lineWidth = 4; g.strokeRect(2, 2, w - 4, h - 4);
  }

  /* ---------------------------------------------------------------- pools */
  const pools = {};
  function pool(kind, make) { return pools[kind] || (pools[kind] = { free: [], active: [], make }); }
  let frameId = 0;
  function acquire(kind) {
    const p = pools[kind]; const e = p.free.pop() || p.make();
    e.root.visible = true; p.active.push(e); e.stamp = frameId; return e;
  }
  function sweep() {
    for (const k in pools) { const p = pools[k]; let w = 0; for (let i = 0; i < p.active.length; i++) { const e = p.active[i]; if (e.stamp === frameId) p.active[w++] = e; else { e.root.visible = false; if (e.owner) { e.owner._v = null; e.owner = null; } p.free.push(e); } } p.active.length = w; }
  }

  /* ---------------------------------------------------------------- player */
  let P = null;
  const pc = { twist: 0, sway: 0, x: 0, rigX: 0, rigY: .88, rigZ: 0, head: 0, bob: 0, torso: 0, thL: 0, knL: 0, thR: 0, knR: 0, arL: 0, elL: 0, arR: 0, elR: 0, bank: 0, yaw: 0, fall: 0 };
  const vis = { g: null, flairT: 14, gx: { hx: 0, hy: 0, hz: 0, ry: 0, pitch: 0, lift: 0, tw: 0 }, x: 1, camX: 0, cv: 0, lean: 0, sy: 0, sv: 0, vy: 0, air: false, tr: 0, mode: 0, roll: 0 };
  const TG = {};
  /* ---- character gestures: short, personality-driven overlays on the rider pose (wave / point / pump / shake / nod / thump / twirl / salute / wheelie) ---- */
  const GD = { wave: 1.5, point: 1.1, pump: 1.25, shake: 1.2, nod: 1.4, thump: 1.4, twirl: 1.6, salute: 1.3, wheelie: 1.25, fist: 1.5, shaka: 1.5, adjust: 1.5, rev: 1.3, horns: 1.5, sway: 1.8 };
  const G_START = { courier: 'wave', danfo: 'point', sparks: 'point', ankara: 'twirl', bolt: 'pump', sultan: 'nod', agbero: 'thump', okada: 'wheelie', shadow: 'salute', scholar: 'point', kungfu: 'fist', snow: 'shaka', sheikh: 'adjust', tokyo: 'rev', punk: 'horns', samba: 'sway' };
  const G_FLAIR = { courier: 'wave', danfo: 'wave', sparks: 'pump', ankara: 'twirl', bolt: 'pump', sultan: 'nod', agbero: 'thump', okada: 'wheelie', shadow: 'salute', scholar: 'nod', kungfu: 'fist', snow: 'shaka', sheikh: 'adjust', tokyo: 'rev', punk: 'horns', samba: 'sway' };
  let curLookId = 'courier';
  vis_gx_init();
  function vis_gx_init() { /* placeholder replaced below */ }                        // reused pose-target object (no per-frame allocation)
  const CFG_P = { h: 4.2, z: 8.3, fov: 78, ly: 1.2, lz: -15 }, CFG_L = { h: 2.55, z: 5.1, fov: 62, ly: 1.5, lz: -12 };
  /* Characters + bikes come from chars3d.js (CharKit): capsule-limbed riders in layered outfits on a matching vehicle. */
  function buildPlayer(look) { const p = global.CharKit.build(look || (global.Save && global.Save.OUTFITS.courier.look)); scene.add(p.root); return p; }
  function spinWheels(v, dt, sp) { const list = [v.front, v.rear].concat(v.rearList || []); for (const w of list) if (w) w.rotation.x -= sp * dt / (w.userData.R || .3); }
  /* the wrecked bike: detaches from the rider, tumbles and skids backward into the dust, then shrinks away; it drops back in when regained */
  function bikeLife(G, dt, p, dead, vx, veh) {
    const g = veh.group;
    if (p.foot) {
      if (!P.bm || P.bm === 'on' || P.bm === 'ret') {
        scene.add(g); P.bm = 'tumble'; P.bx0 = P.root.position.x; P.bside = P.bx0 > .5 ? -1 : P.bx0 < -.5 ? 1 : (Math.random() < .5 ? -1 : 1);
        g.visible = true; g.scale.setScalar(1); g.rotation.set(0, 0, 0); g.position.set(P.bx0, 0, 0);
      }
      if (P.bm === 'tumble') {
        const b = G.bikeAnimT, sd = P.bside, e = 1 - Math.exp(-b * 2.3);
        if (b > 1.55) { P.root.add(g); g.position.set(0, 0, 0); g.rotation.set(0, 0, 0); g.scale.setScalar(1); g.visible = false; P.bm = 'gone'; return; }
        g.position.set(P.bx0 + sd * 1.7 * e, Math.abs(Math.sin(b * 10)) * .55 * Math.exp(-b * 2.1) + (b < .12 ? b * 3 : 0), 3.4 * e * clamp((G.speed || 18) / 18, .7, 1.3));
        g.rotation.set(-b * 5.5 * Math.exp(-b * .8), sd * b * 2.4, sd * Math.min(1.45, b * 7));
        g.scale.setScalar(b > 1.2 ? Math.max(.01, 1 - (b - 1.2) / .35) : 1);
        spinWheels(veh, dt, 16 * Math.exp(-b * 1.5));
      }
    } else if (P.bm === 'tumble' || P.bm === 'gone') {
      if (P.bm === 'tumble') P.root.add(g);
      g.position.set(0, 0, 0); g.rotation.set(0, 0, 0); g.visible = true; g.scale.setScalar(G.regainT < .4 ? .01 : 1);
      P.bm = G.regainT < .4 ? 'ret' : 'on';
    }
  }
  function dead0(G, p) { return G.state === 'dead' || G.state === 'over' || p.dead; }
  function updatePlayer(G, dt) {
    const p = G.p; dt = Math.min(dt, .05);
    vis.x = p.x;                                                   // p.x is already a critically damped spring (game.js): no second smoothing lag
    vis.lean += (clamp(p.vx / 16, -1, 1) - vis.lean) * (1 - Math.exp(-dt * 16));     // lean follows the lateral velocity, eased
    const vx = vis.lean;
    // bike suspension: underdamped spring kicked by landings (and a small dip on take-off)
    const airNow = !p.grounded;
    if (airNow) vis.vy = p.vy; else if (vis.air) vis.sv += clamp(vis.vy, -16, 0) * .045;
    if (airNow && !vis.air) vis.sv -= .35;
    vis.air = airNow;
    { const w = 17, z = .3; vis.sv += (-w * w * vis.sy - 2 * z * w * vis.sv) * dt; vis.sy = clamp(vis.sy + vis.sv * dt, -.3, .2); }
    P.root.position.set((vis.x - 1) * LW, p.y, 0);
    const wantCl = G.cloakT > 0 && G.state !== 'dead' && G.state !== 'over';   // cops-can't-see-you: ghosted model
    if (wantCl !== !!P.cloaked) { P.cloaked = wantCl; P.root.traverse(m => { if (m.isMesh && m.material) { const ms = Array.isArray(m.material) ? m.material : [m.material]; for (const q of ms) { if (q.userData.t0 === undefined) { q.userData.t0 = q.transparent; q.userData.o0 = q.opacity; } q.transparent = wantCl || q.userData.t0; q.opacity = wantCl ? 0.38 : q.userData.o0; q.depthWrite = !wantCl; q.needsUpdate = true; } } }); }
    const dead = G.state === 'dead' || G.state === 'over' || p.dead;
    const ph = p.phase, RP = P.pose, veh = P.veh;
    const t = TG;
    const sl = p.slide > 0 && p.grounded, air = !p.grounded;
    const cr = clamp(1 - (G.clock - p.landT) / 0.2, 0, 1) * (p.grounded ? 1 : 0);
    const jt = G.clock - p.jumpStart, cw = air && !dead0(G, p) ? clamp(1 - jt / .11, 0, 1) : 0, tk = air ? clamp(1 - Math.abs(p.vy) / 8.4, 0, 1) : 0;   // anticipation crouch / apex tuck / landing squash
    const bob = dead || air ? 0 : Math.sin(ph * 2) * (veh.suspend || .01) - cr * .05;
    let tipZ = 0, tipX = 0, pitch = 0;
    Object.assign(t, { rigX: 0, rigY: RP.rigY, rigZ: RP.rigZ, torso: RP.torso, thL: RP.thL, knL: RP.knL, thR: RP.thR, knR: RP.knR, arL: RP.arL, elL: RP.elL, arR: RP.arR, elR: RP.elR, head: RP.head, bob, twist: 0, sway: 0 });
    const foot = !!p.foot, tb = G.bikeAnimT;
    if (dead && foot) {
      const d = clamp(G.deadT * 2.6, 0, 1);       // busted on foot: thrown onto their back, arms up, skids a little
      Object.assign(t, { rigX: 1.45 * d, rigY: 1.0 - .72 * d, rigZ: 0, torso: -.1, thL: .5 - .3 * d, knL: .3 + .6 * d, thR: -.1, knR: .9, arL: 2.5, elL: .4, arR: 1.8, elR: .6, head: .2, bob: 0 });
      P.root.position.z = Math.min(1.4, G.deadT * 2.2);
    } else if (dead) {
      const d = clamp(G.deadT * 3.2, 0, 1);
      Object.assign(t, { rigX: 1.5 * d, rigY: RP.rigY - .5 * d, rigZ: RP.rigZ + .3 * d, torso: -.1, thL: .5, knL: .4, thR: -.2, knR: .7, arL: 1.6, elL: .5, arR: .6, elR: .9, head: 0, bob: 0 });
      tipZ = 1.38 * d; tipX = .45 * d;
      P.root.position.z = Math.min(1.1, G.deadT * 1.6);
    } else if (foot) {
      // on foot: stumble out of the wreck, then a proper run cycle (thighs, knees, counter-swinging arms, forward lean, hip bounce)
      P.rph = (P.rph || 0) + dt * (9 + (G.speed || 14) * .22); const f = P.rph, s = Math.sin(f), c = Math.cos(f);
      const w = clamp(1 - tb / .55, 0, 1), W = w * w * (3 - 2 * w), ls = Math.max(0, c), rs = Math.max(0, -c);
      const run = { rigX: 0, rigY: .98 + Math.abs(c) * .07, rigZ: 0, torso: -.4, thL: s * 1.1, knL: .3 + .95 * ls, thR: -s * 1.1, knR: .3 + .95 * rs, arL: -s * 1.05, elL: 1.5 - .15 * c * s, arR: s * 1.05, elR: 1.5 + .15 * c * s, head: .3, bob: 0, twist: s * .16, sway: 0 };   // legs & arms in opposite phase, hip bob at 2x stride, forward torso lean, counter-twist
      const stm = { rigX: -.22 + Math.sin(tb * 16) * .06, rigY: .86, rigZ: 0, torso: -.72, thL: 1.0, knL: .55, thR: -.55, knR: 1.15, arL: 2.4, elL: .35, arR: 1.9, elR: .45, head: .1, bob: 0 };
      for (const kk in run) t[kk] = run[kk] * (1 - W) + stm[kk] * W;
      if (sl) { Object.assign(t, { rigY: .62, torso: -1.0, thL: 1.5, knL: 1.5, thR: .9, knR: 1.5, arL: 1.1, arR: 1.1, elL: 1.3, elR: 1.3, head: .6 }); }
      else if (air) { Object.assign(t, { rigY: 1.05, torso: -.2, thL: 1.35, knL: 1.3, thR: -.45, knR: 1.0, arL: 2.5, elL: .3, arR: 2.1, elR: .3 }); }
      P.root.position.z = 0; pitch = air ? .06 : 0;
    } else if (sl) {
      Object.assign(t, { rigY: RP.rigY - .27, rigZ: RP.rigZ + .06, torso: RP.torso - .9, arL: RP.arL + .62, arR: RP.arR + .62, elL: RP.elL + .35, elR: RP.elR + .35, head: RP.head + .5 });
      P.root.position.z = 0; tipZ = -vx * .1 + .12;
    } else if (air) {
      const up = p.vy > 0; pitch = up ? .13 : -.1;
      Object.assign(t, { torso: RP.torso - (up ? .1 : .02), thL: RP.thL + (up ? .1 : -.05), thR: RP.thR + (up ? .1 : -.05), head: RP.head + (up ? .08 : .0) });
      P.root.position.z = 0;
    } else { P.root.position.z = 0; t.torso -= cr * .12; t.sway = Math.sin(G.clock * 3.1) * .035 + vx * .04; t.twist = Math.sin(G.clock * 2.3 + 1) * .04; }   // subtle rider sway
    t.bank = dead ? 0 : -vx * .26; t.yaw = dead ? 0 : -vx * .14;
    if (!dead && G.state === 'play' && !G.attract && !G.paused) { vis.flairT -= dt; if (vis.flairT <= 0) { vis.flairT = 18 + Math.random() * 10; if (!air && !sl && !foot && G.speed > 12) R.gesture('flair'); } }
    if (dead) vis.g = null;
    gestureStep(t, dt, !air && !sl && !foot && !dead);
    // pose blending: whenever the action state changes (run / jump / slide / land) the pose crossfades over ~0.3 s, never snaps
    const mode = (sl ? 1 : 0) + (air ? 2 : 0) + (foot ? 4 : 0) + (dead ? 8 : 0);
    if (mode !== vis.mode) { vis.mode = mode; vis.tr = .3; }
    vis.tr = Math.max(0, vis.tr - dt);
    const k = dead ? 1 - Math.exp(-dt * 12) : foot ? 1 - Math.exp(-dt * (tb < .55 ? 20 : vis.tr > 0 ? 15 : 34)) : G.regainT < .35 ? 1 - Math.exp(-dt * 14) : 1 - Math.exp(-dt * (vis.tr > 0 ? 15 : 22));
    const kb = 1 - Math.exp(-dt * 9);          // bank / yaw have their own slower ease (weight of the bike)
    for (const key in t) pc[key] += ((t[key]) - (pc[key] || 0)) * (key === 'bank' || key === 'yaw' ? kb : k);
    const spN = clamp(((G.speed || 0) - 20) / 22, 0, 1), hb = dead ? 0 : Math.sin((foot ? (P.rph || 0) * 2 : ph * 2)) * (.012 + .03 * spN) * (air ? .3 : 1);
    const { rig, torso, aL, aR, lL, lR, root } = P;
    rig.rotation.x = pc.rigX; rig.position.y = pc.rigY; rig.position.z = pc.rigZ; torso.rotation.x = pc.torso + hb * .8; rig.position.y = pc.rigY + (dead ? 0 : vis.sy * .75 + hb * .6); torso.rotation.z = dead ? 0 : -pc.bank * .55;
    lL.th.rotation.x = pc.thL; lL.kn.rotation.x = -pc.knL; lR.th.rotation.x = pc.thR; lR.kn.rotation.x = -pc.knR;
    aL.sh.rotation.x = pc.arL; aL.el.rotation.x = pc.elL; aR.sh.rotation.x = pc.arR; aR.el.rotation.x = pc.elR;
    root.rotation.z = pc.bank; root.rotation.y = pc.yaw; root.rotation.x = pitch + vis.gx.pitch; root.position.y += vis.gx.lift; rig.rotation.y = vis.gx.ry; torso.rotation.y = vis.gx.tw + (dead ? 0 : pc.twist); torso.rotation.z += dead ? 0 : (pc.sway || 0);
    if (!dead && (air || cr > 0)) {   // additive jump poses applied after smoothing so the crouch / tuck / squash stay crisp
      const lg = foot ? 1 : .35, dn = cw * (foot ? .2 : .1) + cr * (foot ? .2 : .1), th = (cw * .5 + cr * .5 + tk * .5) * lg, kn = (cw * .7 + cr * .6 + tk * .55) * lg;
      rig.position.y -= dn; torso.rotation.x -= cw * .25 + cr * .2 + tk * .15;
      lL.th.rotation.x += th; lR.th.rotation.x += th; lL.kn.rotation.x -= kn; lR.kn.rotation.x -= kn;
      aL.sh.rotation.x += tk * .3 - cw * .5; aR.sh.rotation.x += tk * .3 - cw * .5;
      root.scale.set(1 + cr * .05 + cw * .03, 1 - cr * .07 - cw * .05 + tk * .02, 1);
    } else root.scale.set(1, 1, 1);
    if (vis.intro && G.state === 'title') { const I = vis.intro, u = clamp((I.t - I.r0) / 1.0, 0, 1), e = 1 - Math.pow(1 - u, 3), k = 1 - e; root.position.z = I.t < I.r0 ? 60 : 15 * k; root.rotation.y += .9 * k * k * I.dir; root.rotation.z += -.22 * k * I.dir; root.rotation.x += .1 * k; if (I.t >= I.r0 && u < .92) dustEmit(root.position.x, root.position.z, k); }
    P.head.rotation.x = pc.head + hb * 1.6 + vis.gx.hx; P.head.rotation.y = (dead ? 0 : -vx * .32) + vis.gx.hy; P.head.rotation.z = (dead ? 0 : pc.bank * .6 + vx * .1) + vis.gx.hz;
    bikeLife(G, dt, p, dead, vx, veh);
    if (!P.bm || P.bm === 'on' || P.bm === 'ret') {
      const rs = P.bm === 'ret' ? clamp(G.regainT / .4, 0, 1) : 1, e1 = rs - 1, eb = 1 + 2.7 * e1 * e1 * e1 + 1.7 * e1 * e1;   // ease-out-back pop
      veh.group.position.y = pc.bob + vis.sy + (1 - rs) * 2.4; veh.group.rotation.z = tipZ; veh.group.position.x = tipX; veh.group.scale.setScalar(Math.max(.01, eb)); veh.fork.rotation.y = dead ? 0 : -vx * .3;
      spinWheels(veh, dt, dead ? Math.max(0, 14 - G.deadT * 14) : (G.speed || 0));
      if (P.bm === 'ret' && rs >= 1) { P.bm = 'on'; veh.group.scale.setScalar(1); }
    }
  }

  /* ---------------------------------------------------------------- scenery */
  const SLOTS = { lamps: [], parked: [] };
  const lampCount = 12, lampSp = 26, parkedN = 12, parkedSp = 15;
  let facMat = [], facLit = [], shopMats = [], boardTex = [];
  const BU = [];      // building pool entries
  let skyline = [];
  const dummy = new T.Object3D();
  const NIGHT = { n: 0 }; let frameDt = .016;

  function setBoxUV(geo, w, h, d, tw, th, ou, ov) {
    const uv = geo.attributes.uv, base = geo.userData.baseUV || (geo.userData.baseUV = Float32Array.from(uv.array));
    const sc = [[d / tw, h / th], [d / tw, h / th], [w / tw, d / th], [w / tw, d / th], [w / tw, h / th], [w / tw, h / th]];
    for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) { const i = f * 4 + v; uv.setXY(i, base[i * 2] * sc[f][0] + ou, base[i * 2 + 1] * sc[f][1] + ov); }
    uv.needsUpdate = true;
  }
  function makeBuilding() {
    const geo = new T.BoxGeometry(1, 1, 1), body = new T.Mesh(geo, facMat[0]);
    body.receiveShadow = true;
    const sgeo = new T.PlaneGeometry(1, 1), shop = new T.Mesh(sgeo, shopMats[0]); shop.receiveShadow = false;
    const g = new T.Group(); g.add(body, shop); g.visible = false; scene.add(g);
    return { root: g, body, shop, geo, sgeo };
  }
  function placeBuilding(e, b) {
    const rr = srand(b.seed + 7), side = b.side === 0 ? -1 : 1;
    const wd = Math.max(9, Math.round((9 + b.w * 2.4) / 3) * 3), dp = Math.max(9, Math.round(b.depth / 3) * 3);
    const hh = Math.max(3.2, Math.round((8 + (b.h - 6) * 2.0) * BF / 3.2) * 3.2);
    const st = b.tone + (b.seed % 2 ? 1 : 0); e.body.material = facMat[st % 4];
    e.body.scale.set(wd, hh, dp);
    setBoxUV(e.geo, wd, hh, dp, 18, 12.8, Math.floor(rr() * 6) / 6, Math.floor(rr() * 4) / 4);
    e.body.position.set(side * (WALK_OUT + wd / 2), hh / 2, 0);
    const hasShop = (b.seed % 7) !== 0 && cur.shops > .5;
    e.shop.visible = hasShop;
    if (hasShop) {
      e.shop.material = shopMats[b.seed % SHOPS.length];
      e.shop.scale.set(dp * .96, 3.6, 1); e.shop.position.set(side * (WALK_OUT - .04), 1.8, 0); e.shop.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      const uv = e.sgeo.attributes.uv, u = dp * .96 / 12, o = Math.floor(rr() * 4) / 4; // plane uv: (0,1)(1,1)(0,0)(1,0)
      uv.setXY(0, o, 1); uv.setXY(1, o + u, 1); uv.setXY(2, o, 0); uv.setXY(3, o + u, 0); uv.needsUpdate = true;
    }
    e.sig = b; e.bk = BKEY; e.root.visible = BF > .05;
  }
  function makeBoard() {
    const g = new T.Group(), tex = ctex(512, 256, drawBoard(''), false);
    const mat = new T.MeshBasicMaterial({ map: tex });
    const panel = new T.Mesh(new T.PlaneGeometry(7.2, 3.6), mat); panel.position.set(0, 8.2, .08);
    const back = new T.Mesh(new T.BoxGeometry(7.5, 3.9, .2), new T.MeshLambertMaterial({ color: 0x23272d })); back.position.set(0, 8.2, 0);
    const posts = new T.Mesh(merge([bx(.25, 6.4, .25, -2.2, 3.2, -.1, '#3a3d42'), bx(.25, 6.4, .25, 2.2, 3.2, -.1, '#3a3d42')]), matVeh);
    g.add(back, panel, posts); g.visible = false; scene.add(g);
    return { root: g, tex, text: '', panel };
  }

  function buildScene() {
    // sky dome
    const sg = new T.SphereGeometry(300, 24, 16); skyCol = new Float32Array(sg.attributes.position.count * 3);
    sg.setAttribute('color', new T.BufferAttribute(skyCol, 3));
    sky = new T.Mesh(sg, new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide, fog: false, depthWrite: false }));
    sky.renderOrder = -10; scene.add(sky);
    sunDisc = new T.Mesh(new T.CircleGeometry(11, 24), new T.MeshBasicMaterial({ color: 0xffe2b0, fog: false, transparent: true, opacity: .9, depthWrite: false }));
    sunDisc.position.set(-105, 28, -270); sunDisc.lookAt(0, 0, 0); sunDisc.renderOrder = -9; scene.add(sunDisc);
    // soft sun glow + drifting clouds (cheap: one glow quad, 7 textured quads on the sky dome)
    { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, 'rgba(255,236,190,.95)'); gr.addColorStop(.18, 'rgba(255,214,150,.5)'); gr.addColorStop(.5, 'rgba(255,196,120,.14)'); gr.addColorStop(1, 'rgba(255,190,110,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
      const gt = new T.CanvasTexture(c); gt.colorSpace = T.SRGBColorSpace;
      sunGlow = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: gt, fog: false, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending }));
      sunGlow.scale.set(95, 95, 1); sunGlow.renderOrder = -9; scene.add(sunGlow);
      const cc = document.createElement('canvas'); cc.width = 256; cc.height = 96; const k = cc.getContext('2d'), rr = srand(77);
      for (let i = 0; i < 9; i++) { const x = 40 + rr() * 176, y = 52 + (rr() - .5) * 16, r = 20 + rr() * 22; const q = k.createRadialGradient(x, y - r * .2, 0, x, y, r);
        q.addColorStop(0, 'rgba(255,255,255,.95)'); q.addColorStop(.6, 'rgba(246,248,252,.6)'); q.addColorStop(1, 'rgba(235,240,248,0)'); k.fillStyle = q; k.fillRect(x - r, y - r, r * 2, r * 2); }
      const bl = k.createLinearGradient(0, 40, 0, 96); bl.addColorStop(0, 'rgba(150,165,190,0)'); bl.addColorStop(1, 'rgba(150,165,190,.4)'); k.globalCompositeOperation = 'source-atop'; k.fillStyle = bl; k.fillRect(0, 0, 256, 96);
      const ct = new T.CanvasTexture(cc); ct.colorSpace = T.SRGBColorSpace;
      for (let i = 0; i < 7; i++) { const m = new T.Mesh(new T.PlaneGeometry(1, .375), new T.MeshBasicMaterial({ map: ct, fog: false, transparent: true, opacity: .8, depthWrite: false }));
        const sc = 110 + (i * 37 % 60); m.scale.set(sc, sc, 1); m.userData = { a: -1.05 + i * .34 + (i % 2) * .05, h: 62 + (i * 29 % 70), sp: .004 + (i % 3) * .002 }; m.renderOrder = -8; clouds.push(m); scene.add(m); } }
    // lights
    hemi = new T.HemisphereLight(0x8e9bb5, 0x4a3f3a, .9); scene.add(hemi);
    sun = new T.DirectionalLight(0xffb070, 2.2); sun.position.set(-22, 24, 24); sun.target.position.set(0, 0, -16);
    sun.castShadow = true; const ss = mobile ? 512 : 1024; sun.shadow.mapSize.set(ss, ss);
    const sh = mobile ? 24 : 30, sc = sun.shadow.camera; sc.left = -sh; sc.right = sh; sc.top = sh; sc.bottom = -sh; sc.near = 1; sc.far = 110; sun.shadow.bias = -.0006; sun.shadow.normalBias = .04;
    scene.add(sun, sun.target);
    fill = new T.DirectionalLight(0x8fa3d0, .7); fill.position.set(18, 10, 20); scene.add(fill);
    // ground: road + sidewalks + curbs
    roadTex = ctex(1024, mobile ? 1024 : 2048, drawRoad, true, { maxAniso: true, noRedraw: true, clampX: true }); roadTex.repeat.set(1, 300 / 12);       // 12 m tile repeated 25x, exact multiple so markings never drift
    roadMat = new T.MeshLambertMaterial({ map: roadTex });
    roadMat.onBeforeCompile = (sh) => { sh.uniforms.uSnow = roadSnow; sh.fragmentShader = 'uniform float uSnow;\n' + sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n { float l = clamp(dot(diffuseColor.rgb, vec3(.333)) * 1.6, 0., 1.); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.78,.83,.92) * (.7 + .75 * l), uSnow * .74); }').replace('#include <fog_fragment>', '#ifdef USE_FOG\n float fogF = smoothstep( fogNear, fogFar, vFogDepth ) * 0.66;\n gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogF );\n #endif'); };   // road gets ~1/3 less fog than the rest of the scene
    roadMat.customProgramCacheKey = () => 'road-fog66'; const road = new T.Mesh(new T.PlaneGeometry(ROAD_HALF * 2, 300), roadMat);
    road.rotation.x = -Math.PI / 2; road.position.set(0, 0, -140); road.receiveShadow = true; scene.add(road);
    walkTexL = ctex(512, 1024, drawWalk, true, { maxAniso: true }); walkTexL.repeat.set(1, 300 / 7);
    const wmat = new T.MeshLambertMaterial({ map: walkTexL }); walkMat = wmat;
    for (const s of [-1, 1]) {
      const wk = new T.Mesh(new T.PlaneGeometry(WALK_OUT - CURB_X, 300), wmat); wk.rotation.x = -Math.PI / 2; wk.position.set(s * (CURB_X + WALK_OUT) / 2, .16, -140); wk.receiveShadow = true; scene.add(wk);
      const cb = new T.Mesh(new T.BoxGeometry(.24, .17, 300), new T.MeshLambertMaterial({ color: 0x9a9893 })); cb.position.set(s * (CURB_X - .02), .085, -140); cb.receiveShadow = true; scene.add(cb);
    }
    // outer ground (under far skyline)
    const gnd = new T.Mesh(new T.PlaneGeometry(400, 400), new T.MeshLambertMaterial({ color: 0x35343a })); gnd.rotation.x = -Math.PI / 2; gnd.position.set(0, -.05, -140); scene.add(gnd); ground = gnd;
    // facades & shops
    FAC.forEach((st, i) => {
      const map = ctex(480, 320, drawFacade(st, false), true), em = ctex(480, 320, drawFacade(st, true), true);
      facMat.push(new T.MeshLambertMaterial({ map, emissiveMap: em, emissive: 0xffffff, emissiveIntensity: .2 }));
    });
    SHOPS.forEach((s, i) => {
      const map = ctex(1024, 300, drawShop(i, false), true), em = ctex(1024, 300, drawShop(i, true), true);
      shopMats.push(new T.MeshLambertMaterial({ map, emissiveMap: em, emissive: 0xffffff, emissiveIntensity: .55, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    });
    pool('bld', makeBuilding); pool('board', makeBoard); buildSky2(); buildProps(); buildItems(); buildItemsTask();
    // far skyline
    const classes = [[26, 7], [44, 7], [70, 6]];
    classes.forEach((c, ci) => {
      const geo = new T.BoxGeometry(1, 1, 1); setBoxUV(geo, 18, c[0], 18, 18, 12.8, 0, 0);
      const im = new T.InstancedMesh(geo, facMat[ci % 3 + 1 > 3 ? 1 : (ci + 1) % 4], c[1] * 2); im.frustumCulled = false; scene.add(im);
      skyline.push({ im, h: c[0], n: c[1] });
    });
    // lamps
    const poleG = merge([cylV(.1, .07, 8.2, 0, 4.1, 0, '#2e3236', 7), bx(1.9, .09, .09, -.95, 8.15, 0, '#2e3236'), bx(.6, .12, .95, -1.75, 8.05, 0, '#3a3e42'), bx(.4, .3, .4, 0, .15, 0, '#2a2d30')]);
    lampPoles = new T.InstancedMesh(poleG, matVeh, lampCount * 2); lampPoles.castShadow = true; lampPoles.frustumCulled = false; scene.add(lampPoles);
    lampHeads = new T.InstancedMesh(new T.BoxGeometry(.5, .06, .8), new T.MeshBasicMaterial({ color: 0xffe0a8 }), lampCount * 2); lampHeads.frustumCulled = false; scene.add(lampHeads);
    const poolTex = ctex(128, 128, (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); gr.addColorStop(0, 'rgba(255,214,150,.85)'); gr.addColorStop(.5, 'rgba(255,200,130,.28)'); gr.addColorStop(1, 'rgba(255,190,110,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }, false);
    lampPools = new T.InstancedMesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0 }), lampCount * 2);
    lampPools.frustumCulled = false; lampPools.renderOrder = 1; scene.add(lampPools);
    for (let i = 0; i < lampCount; i++) for (const s of [0, 1]) SLOTS.lamps.push({ base: i * lampSp + (s ? lampSp / 2 : 0), side: s ? 1 : -1 });
    // parked cars
    pool('parked', () => { const v = makeVeh(); v.body.castShadow = true; return v; });
    for (let i = 0; i < parkedN; i++) for (const s of [-1, 1]) SLOTS.parked.push({ base: i * parkedSp + (s > 0 ? 7 : 0), side: s, prev: 1e9, e: null, present: false, seed: 0 });
    // obstacles
    pool('veh', makeVeh);
    const mk = (geo, lightsGeo) => () => { const g = new T.Group(), m = new T.Mesh(geo, matVeh); m.castShadow = true; m.receiveShadow = true; g.add(m); if (lightsGeo) g.add(new T.Mesh(lightsGeo, matLight)); g.visible = false; scene.add(g); return { root: g }; };
    pool('jersey', mk(geoJersey())); pool('saw', mk(geoSaw())); pool('cones', mk(geoCones()));
    const gtex = ctex(512, 340, drawGantry, false); matGantry = new T.MeshLambertMaterial({ map: gtex });
    pool('gantry', () => {
      const g = new T.Group(), posts = new T.Mesh(geoGantryPosts(), matVeh); posts.castShadow = true;
      const panel = new T.Mesh(new T.BoxGeometry(2.7, 1.66, .1), matGantry); panel.position.set(0, 1.47, 0); panel.castShadow = true;
      g.add(posts, panel, new T.Mesh(geoGantryLamps(), matLight)); g.visible = false; scene.add(g); return { root: g };
    });
    // cash + jammer
    const cashG = merge([bx(.5, .13, .26, 0, 0, 0, '#5f9e5a'), bx(.11, .135, .265, 0, 0, 0, '#d9d6b8')]);
    R.cash = new T.InstancedMesh(cashG, new T.MeshLambertMaterial({ vertexColors: true, emissive: 0x1d4a1d, emissiveIntensity: .8 }), 200); R.cash.frustumCulled = false; R.cash.castShadow = true; scene.add(R.cash);
    pool('jammer', () => {
      const g = new T.Group();
      const body = new T.Mesh(merge([bx(.36, .24, .2, 0, 0, 0, '#2b3036'), cylV(.015, .015, .4, .12, .3, 0, '#8a9097', 5), cylV(.015, .015, .3, -.12, .27, 0, '#8a9097', 5), bx(.24, .07, .02, 0, .02, .105, '#5c6770')]), matVeh);
      const led = new T.Mesh(new T.BoxGeometry(.07, .05, .05), new T.MeshBasicMaterial({ color: 0x7fd4ff })); led.position.set(.12, .52, 0);
      const ring = new T.Mesh(new T.RingGeometry(.42, .52, 32), new T.MeshBasicMaterial({ color: 0x8fd8ff, transparent: true, opacity: .55, side: T.DoubleSide, depthWrite: false })); ring.rotation.x = -Math.PI / 2;
      const beam = new T.Mesh(new T.CylinderGeometry(.46, .46, 2.4, 20, 1, true), new T.MeshBasicMaterial({ color: 0x9fdcff, transparent: true, opacity: .13, side: T.DoubleSide, depthWrite: false })); beam.position.y = 1.2;
      const hover = new T.Group(); hover.add(body, led); hover.scale.setScalar(1.7);
      g.add(hover, ring, beam); g.visible = false; scene.add(g); return { root: g, hover, ring };
    });
  }

  /* ---------------------------------------------------------------- stage props (instanced, per-stage weights fade them in/out) */
  const PROPS = [];
  function ico(r, sx, sy, sz, x, y, z, hex, det) { const g = new T.IcosahedronGeometry(r, det === undefined ? 1 : det); g.scale(sx, sy, sz); g.translate(x, y, z); return paint(g, hex); }
  function bxr(w, h, d, x, y, z, hex, rx, ry, rz) { const g = new T.BoxGeometry(w, h, d); g.rotateX(rx || 0); g.rotateY(ry || 0); g.rotateZ(rz || 0); g.translate(x, y, z); return paint(g, hex); }
  function cone(r0, r1, h, x, y, z, hex, seg) { const g = new T.CylinderGeometry(r1, r0, h, seg || 8); g.translate(x, y, z); return paint(g, hex); }
  const PROP_GEO = {
    palm() {
      const L = [cylV(.26, .22, 2.6, 0, 1.3, 0, '#7a6048', 7), cylV(.22, .18, 2.6, .12, 3.8, 0, '#85694f', 7), cylV(.18, .15, 2.4, .32, 6.2, 0, '#8d7155', 7)];
      for (let i = 0; i < 9; i++) { const g = new T.BoxGeometry(.55, .05, 3.3); g.translate(0, 0, 1.65); g.rotateX(.42 + (i % 3) * .12); g.rotateY(i * Math.PI * 2 / 9); g.translate(.4, 7.4, 0); L.push(paint(g, i % 2 ? '#3f6b34' : '#4b7a3b')); }
      L.push(ico(.22, 1, 1, 1, .5, 7.1, .2, '#5a4328', 0), ico(.22, 1, 1, 1, .3, 7.1, -.25, '#5a4328', 0)); return merge(L);
    },
    rail() { return merge([bx(.5, 1.0, 4, 0, .5, 0, '#8d8b86'), bx(.14, .14, 4, 0, 1.12, 0, '#a7aaad'), bx(.6, .12, .6, 0, 1.0, -1.9, '#7c7a76'), bx(.6, .12, .6, 0, 1.0, 1.9, '#7c7a76')]); },
    pylon() {
      const L = []; for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const g = new T.CylinderGeometry(.14, .38, 22, 5); g.translate(0, 11, 0); g.rotateZ(-sx * .06); g.rotateX(sz * .06); g.translate(sx * 1.6, 0, sz * 1.6); L.push(paint(g, '#aab0b6')); }
      for (const y of [6, 12, 17]) L.push(bx(4.2, .18, .18, 0, y, 1.1, '#aab0b6'), bx(4.2, .18, .18, 0, y, -1.1, '#aab0b6'), bx(.18, .18, 4.2, 1.0, y, 0, '#aab0b6'), bx(.18, .18, 4.2, -1.0, y, 0, '#aab0b6'));
      L.push(bx(12, .22, .22, 0, 19.5, 0, '#aab0b6'), bx(8, .22, .22, 0, 21.2, 0, '#aab0b6')); return merge(L);
    },
    toll() {
      const L = [bx(16, .7, 5.4, 0, 7.2, 0, '#cfcdc6'), bx(16.2, .22, 5.5, 0, 6.78, 0, '#3a5b7e'), bx(14, .08, .5, 0, 6.66, 0, '#fff0cc'), bx(.9, 7, .9, -7.2, 3.5, 0, '#c4c1b9'), bx(.9, 7, .9, 7.2, 3.5, 0, '#c4c1b9')];
      for (const s of [-1, 1]) { L.push(bx(1.9, 2.5, 3.4, s * 7.7, 1.25, 0, '#e4e0d6'), bx(.06, .9, 2.2, s * 6.74, 1.6, 0, '#33414f'), bx(2.1, .15, 3.6, s * 7.7, 2.55, 0, '#3a5b7e')); }
      return merge(L);
    },
    stallA() { return merge([bx(2.3, .9, 1.3, 0, .45, 0, '#7c5b3b'), bx(2.1, .22, 1.1, 0, 1.0, 0, '#d4a23f'), bx(.8, .4, .6, -.5, 1.3, 0, '#c8553d'), bx(.06, 2.7, .06, -1, 1.35, -.55, '#cfcfcf'), bx(.06, 2.7, .06, 1, 1.35, -.55, '#cfcfcf'), cone(2.1, 0.1, .7, 0, 2.95, 0, '#b8402f', 8)]); },
    stallB() { return merge([bx(2.4, .8, 1.2, 0, .4, .1, '#6d5136'), bx(.65, .6, .65, -.9, 1.1, .1, '#a07a4b'), bx(.65, .6, .65, -.2, 1.1, .1, '#b48a55'), bx(.5, .5, .5, .6, 1.05, .1, '#8f6a3f'), bxr(2.8, .08, 2.2, 0, 2.55, .15, '#2f6f8f', .12, 0, 0), bx(.06, 2.5, .06, -1.3, 1.25, -.7, '#cfcfcf'), bx(.06, 2.2, .06, 1.3, 1.1, -.7, '#cfcfcf')]); },
    tree() { return merge([cylV(.28, .2, 3.2, 0, 1.6, 0, '#5a4631', 7), ico(1.7, 1, .9, 1, 0, 4.2, 0, '#3f6e3a'), ico(1.25, 1, 1, 1, .9, 4.8, .4, '#4a7d42'), ico(1.2, 1, 1, 1, -.9, 4.5, -.4, '#477840')]); },
    flag() { return merge([cylV(.07, .05, 8.4, 0, 4.2, 0, '#c9ccd0', 6), bx(.04, 1.1, .6, 0, 7.5, .35, '#1f7a46'), bx(.045, 1.1, .6, 0, 7.5, .95, '#f2f2ef'), bx(.04, 1.1, .6, 0, 7.5, 1.55, '#1f7a46')]); },
    container() {
      const L = [bx(2.44, 2.6, 6.1, 0, 1.3, 0, '#ffffff')];
      for (let i = 0; i < 9; i++) for (const s of [-1, 1]) L.push(bx(.07, 2.4, .16, s * 1.22, 1.3, -2.7 + i * .67, '#b8b8b8'));
      L.push(bx(2.5, .12, 6.15, 0, 2.6, 0, '#9a9a9a')); return merge(L);
    },
    crane() {
      const L = []; for (const x of [-6, 6]) for (const z of [-3.5, 3.5]) L.push(bx(.7, 20, .7, x, 10, z, '#c9a13a'));
      L.push(bx(14, 1.2, 8.4, 0, 20.4, 0, '#c9a13a'), bx(.5, .5, 8, -6, 8, 0, '#b88f2e'), bx(.5, .5, 8, 6, 8, 0, '#b88f2e'), bx(34, 1.0, 1.2, 14, 21.6, 0, '#d2aa40'), bx(.35, 4, .35, 30, 19.5, 0, '#8a8a8a'), bx(1.6, 1.0, 1.6, 30, 17.2, 0, '#6a6e72')); return merge(L);
    },
    pole() { return merge([cylV(.15, .12, 9, 0, 4.5, 0, '#6b5a48', 6), bx(2.8, .13, .13, 0, 8.4, 0, '#574838'), bx(2.0, .13, .13, 0, 7.6, 0, '#574838'), bx(.1, .22, .1, -1.3, 8.6, 0, '#cfd3d6'), bx(.1, .22, .1, 1.3, 8.6, 0, '#cfd3d6'), bx(.1, .22, .1, 0, 8.6, 0, '#cfd3d6')]); },
    rock() { return merge([ico(1, 1.3, .8, 1, 0, .45, 0, '#9d8b6a', 1), ico(.6, 1, .8, 1, 1.1, .25, .4, '#8e7d5e', 0)]); },
    scrub() { return merge([ico(.5, 1.2, .7, 1, 0, .3, 0, '#8a7f4a', 0), ico(.35, 1, .8, 1, .5, .22, .25, '#9a8d52', 0), ico(.3, 1, .8, 1, -.4, .2, -.2, '#7d7442', 0)]); },
    tank() { return merge([cylV(4, 4, 8.5, 0, 4.25, 0, '#b4b8ba', 14), cone(4.1, 3.2, 1.2, 0, 9.1, 0, '#9ea3a6', 14), bx(.5, 9, .5, 4.3, 4.5, 0, '#6e7478'), bx(1.1, .25, 5, 3.6, 8, 0, '#6e7478'), bx(8.2, .3, .3, 0, 3, 0, '#8a9094')]); },
    chimney() { return merge([cylV(1.9, 1.35, 26, 0, 13, 0, '#8e6a5c', 10), cylV(1.45, 1.38, 3, 0, 22.5, 0, '#d8d8d4', 10), cylV(1.41, 1.36, 3, 0, 17, 0, '#d8d8d4', 10), cylV(1.5, 1.5, .5, 0, 26.2, 0, '#444', 10), bx(6, 4, 6, 0, 2, 5, '#6c7074')]); },
    acacia() { return merge([cylV(.5, .32, 4.8, 0, 2.4, 0, '#5b4631', 6), bxr(.25, 2.4, .25, .9, 5.2, 0, '#5b4631', 0, 0, -.7), bxr(.25, 2.2, .25, -.9, 5.1, 0, '#5b4631', 0, 0, .7), ico(1, 4.8, .85, 4.2, 0, 6.5, 0, '#6c7c3a'), ico(1, 3, .6, 2.8, 1.8, 7.3, 1, '#78883f')]); },
    baobab() { return merge([cylV(1.5, 2.2, 6.5, 0, 3.25, 0, '#8a6f55', 10), cylV(1.3, 1.5, 2.5, 0, 7.5, 0, '#8a6f55', 8), bxr(.4, 3.2, .4, 1.6, 9.6, 0, '#7d6249', 0, 0, -.9), bxr(.4, 3.2, .4, -1.6, 9.6, 0, '#7d6249', 0, 0, .9), bxr(.4, 3.2, .4, 0, 9.6, 1.5, '#7d6249', .9, 0, 0), ico(1, 3.2, 1.3, 3.2, 0, 11.7, 0, '#5f7a35', 1)]); },
    grass() { const L = []; for (let i = 0; i < 6; i++) { const a = i * 1.05; L.push(cone(.2, 0, .9 + (i % 3) * .3, Math.cos(a) * .35, .5, Math.sin(a) * .35, i % 2 ? '#b09f50' : '#9f8f45', 4)); } return merge(L); },
    /* ---- v11 international props ---- */
    lantern() {
      const L = [cylV(.12, .14, 5.6, 0, 2.8, 0, '#5a2a20', 6), bx(2.8, .14, .14, 0, 5.5, 0, '#5a2a20'), bx(.1, .5, .1, 0, 5.2, 0, '#d0a83a')];
      for (const s of [-1, 1]) L.push(ico(.46, 1, 1.25, 1, s * 1.2, 4.75, 0, '#d8282a', 1), cylV(.24, .24, .1, s * 1.2, 5.3, 0, '#d0a83a', 8), cylV(.2, .2, .08, s * 1.2, 4.14, 0, '#d0a83a', 8), bx(.05, .4, .05, s * 1.2, 3.85, 0, '#e8c050'), bx(.5, .06, .5, s * 1.2, 4.75, 0, '#e8b030'));
      return merge(L);
    },
    pagoda() {
      const L = [bx(6.4, .7, 6.4, 0, .35, 0, '#8a8478')];
      const roof = (y, w, hex) => { const g = new T.CylinderGeometry(.35, w * .86, 1.5, 4); g.rotateY(Math.PI / 4); g.translate(0, y, 0); return paint(g, hex); };
      for (let t = 0; t < 4; t++) { const w = 5.2 - t * .85, y = .7 + t * 3.1; L.push(bx(w, 2.0, w, 0, y + 1.0, 0, '#a8342a'), bx(w * .5, 1.1, .08, 0, y + 1.0, -w / 2 - .02, '#2a1a14'), bx(w * 1.38, .22, w * 1.38, 0, y + 2.1, 0, '#2f4a3c'), roof(y + 2.85, w * 1.3, '#2f6a52'), bx(w * 1.12, .2, w * 1.12, 0, y + 2.0, 0, '#d0a83a')); }
      L.push(cylV(.08, .16, 3.6, 0, 16.3, 0, '#d0a83a', 6), ico(.32, 1, 1, 1, 0, 15.3, 0, '#d0a83a', 1)); return merge(L);
    },
    snowpine() {
      const L = [cylV(.3, .4, 2.0, 0, 1.0, 0, '#5a4631', 6)];
      [[2.4, 2.8, 2.6], [1.9, 2.6, 4.6], [1.35, 2.4, 6.4]].forEach(([r, h, y]) => { L.push(cone(r, .1, h, 0, y, 0, '#2c5a3c', 8), cone(r * .84, .08, h * .62, 0, y + h * .2, 0, '#f2f6fa', 8)); });
      L.push(ico(.28, 1, 1, 1, 0, 8.0, 0, '#f2f6fa', 0)); return merge(L);
    },
    snowbank() { return merge([ico(1.4, 1.9, .5, 1.1, 0, .18, 0, '#f4f8fb', 1), ico(1, 1.4, .5, 1, 1.6, .12, .5, '#e8eff5', 1), ico(.8, 1.2, .45, 1, -1.5, .1, -.3, '#f4f8fb', 1)]); },
    cabin() {
      const g = new T.CylinderGeometry(.4, 3.5, 1.7, 4); g.rotateY(Math.PI / 4); g.translate(0, 3.1, 0); const gs = new T.CylinderGeometry(.3, 3.6, .7, 4); gs.rotateY(Math.PI / 4); gs.translate(0, 3.55, 0);
      return merge([bx(4.4, 2.3, 3.8, 0, 1.15, 0, '#7a5236'), paint(g, '#5a3a2a'), paint(gs, '#f4f8fb'), bx(.9, .9, .06, -1, 1.3, -1.93, '#ffd58a'), bx(.9, .9, .06, 1, 1.3, -1.93, '#ffd58a'), bx(.7, 1.6, .06, 0, .8, -1.93, '#4a2e1e'), bx(.7, 1.6, .7, 1.4, 4.0, .6, '#6a6560'), bx(.8, .2, .8, 1.4, 4.9, .6, '#f4f8fb')]);
    },
    spire() {
      const L = [bx(8, 1.5, 8, 0, .75, 0, '#c9c4b8')]; const tiers = [[3.3, 2.6, 18], [2.5, 1.8, 18], [1.9, 1.2, 16]]; let y = 1.5;
      tiers.forEach(([r0, r1, h], i) => { L.push(cylV(r1, r0, h, 0, y + h / 2, 0, i % 2 ? '#cfe4f2' : '#9ec4de', 6)); for (let b = 0; b < 4; b++) L.push(bx(.16, h, .16, Math.cos(b * 1.57) * (r0 + r1) / 2, y + h / 2, Math.sin(b * 1.57) * (r0 + r1) / 2, '#e8f0f6')); y += h; });
      L.push(cylV(.06, .9, 20, 0, y + 10, 0, '#dfe6ea', 6), cylV(1.0, 1.0, .4, 0, y - .4, 0, '#d0aa4d', 6)); return merge(L);
    },
    dune() { return merge([ico(1, 9, 2.4, 6, 0, -.2, 0, '#d9b87c', 1), ico(1, 6, 1.9, 4, 5, -.1, 3, '#e2c488', 1), ico(1, 4, 1.4, 3, -5, -.1, -2, '#cfae72', 1)]); },
    tpole() {
      const L = [cylV(.15, .18, 9.2, 0, 4.6, 0, '#6b6560', 6), bx(2.8, .13, .13, 0, 8.6, 0, '#4a443e'), bx(2.0, .13, .13, 0, 7.8, 0, '#4a443e'), cylV(.42, .42, .95, .65, 6.9, 0, '#8a8f94', 8), bx(.4, .4, .3, -.5, 6.6, .22, '#7a7f84')];
      for (const x of [-1.2, 0, 1.2]) L.push(bx(.035, .035, 18, x, 8.7, 0, '#25262a')); L.push(bx(.035, .035, 18, -.9, 7.9, 0, '#25262a'), bx(.035, .035, 18, .9, 7.9, 0, '#25262a'));
      for (const x of [-1.2, 0, 1.2]) L.push(cylV(.07, .07, .22, x, 8.78, 0, '#cfd3d6', 5)); return merge(L);
    },
    vending() {
      const L = []; [[-.62, '#e6ebef', '#e04a3a'], [.62, '#dfe6ec', '#2f6fb0']].forEach(([x, c, a]) => { L.push(bx(1.08, 1.95, .8, x, .98, 0, c), bx(.86, 1.1, .05, x, 1.25, -.42, '#fffbe8'), bx(.86, .16, .06, x, 1.88, -.42, a), bx(.5, .3, .06, x + .06, .48, -.42, '#3a3d42'), bx(.12, .3, .06, x - .34, .55, -.42, '#9aa0a6')); for (let r = 0; r < 3; r++) for (let q = 0; q < 4; q++) L.push(bx(.14, .24, .06, x - .3 + q * .2, .95 + r * .3 + .12, -.44, (q + r) % 2 ? '#d8402f' : '#3f8ad8'));
      }); return merge(L);
    },
    sakura() {
      const L = [cylV(.3, .22, 3.0, 0, 1.5, 0, '#4a3a30', 6), bxr(.18, 1.8, .18, .8, 3.2, 0, '#4a3a30', 0, 0, -.7), bxr(.18, 1.6, .18, -.8, 3.1, 0, '#4a3a30', 0, 0, .7)];
      L.push(ico(1.7, 1.15, .85, 1.1, 0, 4.4, 0, '#f2b4c8', 1), ico(1.2, 1.1, .9, 1, 1.4, 3.9, .4, '#e8a0b8', 1), ico(1.2, 1.1, .9, 1, -1.4, 3.8, -.3, '#f6c8d4', 1), ico(.9, 1, .9, 1, .2, 5.4, .1, '#f6c8d4', 1)); return merge(L);
    },
    phonebox() {
      const L = [bx(1.05, 2.4, 1.05, 0, 1.2, 0, '#c0262b'), bx(1.2, .16, 1.2, 0, 2.48, 0, '#c0262b'), cylV(.42, .55, .22, 0, 2.66, 0, '#c0262b', 8), bx(.5, .2, .06, 0, 2.2, -.54, '#f3efdc')];
      for (const z of [-1, 1]) L.push(bx(.74, 1.5, .06, 0, 1.15, z * .53, '#efe3b0'), bx(.76, .05, .07, 0, 1.15, z * .53, '#c0262b'), bx(.76, .05, .07, 0, 1.6, z * .53, '#c0262b'), bx(.76, .05, .07, 0, .7, z * .53, '#c0262b'));
      for (const x of [-1, 1]) L.push(bx(.06, 1.5, .74, x * .53, 1.15, 0, '#efe3b0'));
      L.push(cylV(.3, .3, 1.15, 2.0, .58, 0, '#c0262b', 10), cylV(.3, .1, .2, 2.0, 1.2, 0, '#a01e22', 10), bx(.34, .06, .02, 2.0, .95, -.29, '#111')); return merge(L);
    },
    clocktower() {
      const L = [bx(4.6, 4, 4.6, 0, 2, 0, '#b8a070'), bx(3.8, 17, 3.8, 0, 12.5, 0, '#b49a6a'), bx(4.6, 1.2, 4.6, 0, 21.4, 0, '#8a7448'), bx(5.2, 5.4, 5.2, 0, 24.7, 0, '#c8ad78')];
      for (const z of [-1, 1]) L.push(bx(3.6, 3.6, .14, 0, 24.7, z * 2.66, '#f3efdc'), bx(.14, 1.6, .16, 0, 25.2, z * 2.74, '#222'), bx(1.1, .14, .16, .3, 24.7, z * 2.74, '#222'));
      for (const x of [-1, 1]) L.push(bx(.14, 3.6, 3.6, x * 2.66, 24.7, 0, '#f3efdc'), bx(.16, .14, 1.4, x * 2.74, 24.7, 0, '#222'));
      for (let b = 0; b < 4; b++) L.push(bx(.4, 4, .4, Math.cos(b * 1.57 + .78) * 2.7, 12, Math.sin(b * 1.57 + .78) * 2.7, '#a88e5e'));
      const g = new T.CylinderGeometry(.3, 4.1, 6.5, 4); g.rotateY(Math.PI / 4); g.translate(0, 30.8, 0); L.push(paint(g, '#3c5a4a'), cylV(.06, .14, 4, 0, 36.5, 0, '#d0aa4d', 5)); return merge(L);
    },
    favela() {
      const L = [bx(3.4, 2.5, 3.2, 0, 1.25, 0, '#ffffff'), bx(3.7, .22, 3.5, 0, 2.6, 0, '#d8d4cc'), bx(.7, .8, .06, -.9, 1.5, -1.62, '#2e2e34'), bx(.7, .8, .06, .9, 1.5, -1.62, '#2e2e34'), bx(.7, 1.5, .06, 0, .78, -1.62, '#4a3a30'), bx(.05, .8, .5, -1.72, 1.4, 0, '#2e2e34')];
      L.push(cylV(.5, .5, .9, 1.0, 3.2, .6, '#c8ccd0', 8), bx(1.0, .14, 1.0, -.9, 2.75, .6, '#b4a89a'), bx(.08, 1.1, .08, -1.4, 3.1, .2, '#7a6a5a')); return merge(L);
    },
    hill() { return merge([ico(1, 24, 13, 20, 0, -2, 0, '#5f8c4c', 1), ico(1, 13, 9, 11, 10, 1, -6, '#6a9a56', 1), ico(1, 9, 5, 8, -14, -.5, 4, '#557f44', 1)]); }
  };
  // sp: metres between slots (per side), n: slots per side, x: [min,max] distance from road centre, sc: scale range, both: mirrored sides
  const PROP_DEF = {
    palm: { sp: 24, n: 8, x: [7.0, 8.9], sc: [.85, 1.25] }, rail: { sp: 4, n: 42, x: [9.35, 9.35], sc: [1, 1], yaw: 'road', solid: true }, pylon: { sp: 42, n: 4, x: [19, 30], sc: [.9, 1.3] },
    toll: { sp: 72, n: 3, x: [0, 0], sc: [1, 1], single: true }, stallA: { sp: 12, n: 14, x: [7.4, 8.7], sc: [.95, 1.1] }, stallB: { sp: 12, n: 14, x: [7.4, 8.7], sc: [.95, 1.1], off: 6 },
    tree: { sp: 15, n: 11, x: [7.2, 8.4], sc: [.85, 1.2] }, flag: { sp: 32, n: 5, x: [6.7, 6.9], sc: [1, 1], yaw: 'road' },
    container: { sp: 15, n: 11, x: [7.9, 8.2], sc: [1, 1], stack: 3, colors: ['#9b3b2f', '#2f5d8c', '#3f7a4f', '#c58a2a', '#6b6f73', '#7a4a7e', '#d0d0cc'], yaw: 'axis' },
    crane: { sp: 75, n: 3, x: [22, 26], sc: [1, 1], yaw: 'road' }, pole: { sp: 30, n: 6, x: [7.9, 8.4], sc: [1, 1] }, rock: { sp: 17, n: 10, x: [10, 34], sc: [.8, 2.6], yaw: 'rand' },
    scrub: { sp: 7, n: 24, x: [7, 17], sc: [.8, 1.6], yaw: 'rand' }, tank: { sp: 38, n: 4, x: [24, 32], sc: [.9, 1.3] }, chimney: { sp: 56, n: 3, x: [22, 34], sc: [.9, 1.2] },
    acacia: { sp: 22, n: 8, x: [10, 32], sc: [.85, 1.4], yaw: 'rand' }, baobab: { sp: 62, n: 3, x: [14, 36], sc: [.9, 1.3], yaw: 'rand' }, grass: { sp: 5, n: 34, x: [6.6, 15], sc: [.8, 1.6], yaw: 'rand' },
    lantern: { sp: 10, n: 14, x: [6.7, 7.3], sc: [1, 1.05], yaw: 'road' }, pagoda: { sp: 58, n: 4, x: [14, 20], sc: [.95, 1.25], yaw: 'road' },
    snowpine: { sp: 11, n: 18, x: [7.4, 14], sc: [.8, 1.5], yaw: 'rand' }, snowbank: { sp: 9, n: 24, x: [6.9, 9], sc: [.8, 1.5], yaw: 'rand' }, cabin: { sp: 38, n: 5, x: [12, 20], sc: [.95, 1.25], yaw: 'road' },
    spire: { sp: 70, n: 3, x: [32, 54], sc: [.9, 1.4], yaw: 'rand' }, dune: { sp: 30, n: 8, x: [22, 60], sc: [.8, 1.7], yaw: 'rand' },
    tpole: { sp: 18, n: 12, x: [7.5, 7.9], sc: [1, 1], yaw: 'road' }, vending: { sp: 21, n: 10, x: [6.9, 7.3], sc: [1, 1], yaw: 'road' }, sakura: { sp: 25, n: 9, x: [8.2, 10.5], sc: [.9, 1.3], yaw: 'rand' },
    phonebox: { sp: 27, n: 8, x: [6.9, 7.3], sc: [1, 1], yaw: 'road' }, clocktower: { sp: 95, n: 3, x: [16, 26], sc: [.9, 1.15], yaw: 'rand' },
    favela: { sp: 11, n: 14, x: [8.6, 14], sc: [.95, 1.2], stack: 4, colors: ['#e8a33a', '#d8504a', '#4aa896', '#5a8ad0', '#ecd466', '#c870a8', '#8fc460', '#f0f0e8'], yaw: 'axis' }, hill: { sp: 90, n: 3, x: [48, 80], sc: [.9, 1.4], yaw: 'rand' }
  };
  function buildProps() {
    for (const kind in PROP_DEF) {
      const D = PROP_DEF[kind], geo = PROP_GEO[kind](), rr = srand(kind.length * 977 + kind.charCodeAt(0) * 31);
      const slots = [], sides = D.single ? [0] : [-1, 1];
      for (const side of sides) for (let i = 0; i < D.n; i++) {
        const r1 = rr() * .72, r2 = rr(), r3 = rr(), r4 = rr();
        slots.push({ base: i * D.sp + (side > 0 ? D.sp / 2 : 0) + (D.off || 0) + (D.sp > 8 ? (r4 - .5) * D.sp * .3 : 0), side, r1, x: side * (D.x[0] + (D.x[1] - D.x[0]) * r2), sc: D.sc[0] + (D.sc[1] - D.sc[0]) * r3,
          yaw: D.yaw === 'rand' ? r3 * 6.28 : D.yaw === 'road' ? (side > 0 ? Math.PI : 0) : D.yaw === 'axis' ? (r4 < .5 ? 0 : Math.PI) : 0, col: D.colors ? D.colors[(r4 * D.colors.length) | 0] : null, stk: D.stack ? 1 + ((r3 * D.stack) | 0) : 1 });
      }
      const im = new T.InstancedMesh(geo, matVeh, slots.length * (D.stack || 1)); im.frustumCulled = false; im.visible = false;
      if (D.colors) { im.setColorAt(0, _c.set(D.colors[0])); }
      scene.add(im); PROPS.push({ kind, D, im, slots, tot: D.n * D.sp, colored: !!D.colors });
    }
  }
  function syncProps(G) {
    const d = G.dist;
    for (const P of PROPS) {
      const w = cur.props[P.kind] || 0;
      if (w <= .01) { P.im.visible = false; continue; }
      P.im.visible = true; let k = 0;
      for (const s of P.slots) {
        const f = clamp((w - s.r1) * 4, 0, 1); if (f <= 0) continue;
        const z = mod(s.base - d, P.tot) - 24;
        for (let lv = 0; lv < s.stk; lv++) {
          dummy.position.set(s.x, lv * 2.6 * (P.D.stack ? 1 : 0), -z); dummy.rotation.set(0, s.yaw, 0); dummy.scale.setScalar(s.sc * f); dummy.updateMatrix();
          P.im.setMatrixAt(k, dummy.matrix); if (P.colored) P.im.setColorAt(k, _c.set(s.col)); k++;
        }
      }
      P.im.count = k; P.im.instanceMatrix.needsUpdate = true; if (P.colored && P.im.instanceColor) P.im.instanceColor.needsUpdate = true;
    }
    // rain streaks fall in world space and rush toward the camera with the road
    if (rain) {
      rain.visible = cur.rain > .02;
      if (rain.visible) {
        const pa = rain.geometry.attributes.position, a = pa.array, sp = G.speed || 0, dt = G.attract ? .016 : frameDt;
        for (let i = 0; i < rainN; i++) {
          let x = rainP[i * 3], y = rainP[i * 3 + 1], z = rainP[i * 3 + 2];
          y -= 26 * dt; z += sp * dt; if (y < 0 || z > 12) { x = (Math.random() - .5) * 36; y = 10 + Math.random() * 8; z = -70 + Math.random() * 80; }
          rainP[i * 3] = x; rainP[i * 3 + 1] = y; rainP[i * 3 + 2] = z;
          a[i * 6] = x; a[i * 6 + 1] = y; a[i * 6 + 2] = z; a[i * 6 + 3] = x; a[i * 6 + 4] = y + .7; a[i * 6 + 5] = z - sp * dt * 1.4 - .12;
        }
        pa.needsUpdate = true; rain.material.opacity = .32 * cur.rain;
      }
    }
    // falling snow: slow flakes that drift and rush toward the camera with the road
    if (snow) {
      snow.visible = cur.snow > .02;
      if (snow.visible) {
        const pa = snow.geometry.attributes.position, a = pa.array, sp = G.speed || 0, dt = G.attract ? .016 : frameDt, tt = (G.attract ? 0 : G.time || 0) + performance.now() * .001;
        for (let i = 0; i < snowN; i++) {
          let x = snowP[i * 3], y = snowP[i * 3 + 1], z = snowP[i * 3 + 2];
          y -= (2.1 + (i % 5) * .25) * dt; z += sp * dt; x += Math.sin(tt * .9 + i) * .6 * dt;
          if (y < 0 || z > 10) { x = (Math.random() - .5) * 34; y = 7 + Math.random() * 7; z = -60 + Math.random() * 68; }
          snowP[i * 3] = x; snowP[i * 3 + 1] = y; snowP[i * 3 + 2] = z; a[i * 3] = x; a[i * 3 + 1] = y; a[i * 3 + 2] = z;
        }
        pa.needsUpdate = true; snow.material.opacity = .9 * Math.min(1, cur.snow);
      }
    }
  }
  let rain = null, stars = null, snow = null; const rainN = 260, rainP = new Float32Array(rainN * 3), snowN = 300, snowP = new Float32Array(snowN * 3);
  function buildSky2() {
    const sp = []; const rr = srand(4242);
    for (let i = 0; i < 380; i++) { const a = rr() * Math.PI * 2, e = .12 + rr() * .88, r = 285; sp.push(Math.cos(a) * Math.cos(e * 1.3) * r, Math.sin(e * 1.3) * r, Math.sin(a) * Math.cos(e * 1.3) * r); }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(sp, 3));
    stars = new T.Points(g, new T.PointsMaterial({ color: 0xe6ebf5, size: 1.7, sizeAttenuation: false, fog: false, transparent: true, opacity: 0, depthWrite: false })); stars.renderOrder = -9.5; stars.frustumCulled = false; scene.add(stars);
    for (let i = 0; i < rainN; i++) { rainP[i * 3] = (Math.random() - .5) * 36; rainP[i * 3 + 1] = Math.random() * 16; rainP[i * 3 + 2] = -70 + Math.random() * 80; }
    const rg = new T.BufferGeometry(); rg.setAttribute('position', new T.BufferAttribute(new Float32Array(rainN * 6), 3));
    rain = new T.LineSegments(rg, new T.LineBasicMaterial({ color: 0xb4c2d0, transparent: true, opacity: .3, depthWrite: false })); rain.frustumCulled = false; rain.visible = false; scene.add(rain);
    for (let i = 0; i < snowN; i++) { snowP[i * 3] = (Math.random() - .5) * 34; snowP[i * 3 + 1] = Math.random() * 12; snowP[i * 3 + 2] = -60 + Math.random() * 68; }
    const sg = new T.BufferGeometry(); sg.setAttribute('position', new T.BufferAttribute(new Float32Array(snowN * 3), 3));
    const sc = document.createElement('canvas'); sc.width = sc.height = 32; { const g = sc.getContext('2d'), gr = g.createRadialGradient(16, 16, 0, 16, 16, 15); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.5, 'rgba(255,255,255,.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32); }
    snow = new T.Points(sg, new T.PointsMaterial({ map: new T.CanvasTexture(sc), color: 0xffffff, size: .2, sizeAttenuation: true, transparent: true, opacity: .9, depthWrite: false, fog: false })); snow.frustumCulled = false; snow.visible = false; scene.add(snow);
  }

  /* ---------------------------------------------------------------- road items: letters, turbo pads, ramps, x2 tokens */
  const letterMats = {}, itemRes = {};
  function glyphMat(ch) {
    if (letterMats[ch]) return letterMats[ch];
    const tex = ctex(128, 128, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = '#f6f0e0'; g.font = '700 ' + (ch.length > 2 ? 40 : ch.length > 1 ? 66 : 92) + 'px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(ch, w / 2, h / 2 + 5); }, false);
    return (letterMats[ch] = new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  }
  function buildItems() {
    const R_ = itemRes;
    R_.ring = { letter: new T.MeshLambertMaterial({ color: 0xd2a63c, emissive: 0x3a2a08, emissiveIntensity: .8 }), x2: new T.MeshLambertMaterial({ color: 0x5f9f74, emissive: 0x0c2a16, emissiveIntensity: .8 }) };
    R_.disc = new T.MeshLambertMaterial({ color: 0x20262f });
    const ringG = new T.CylinderGeometry(.66, .66, .14, 22); ringG.rotateX(Math.PI / 2);
    const discG = new T.CylinderGeometry(.55, .55, .18, 22); discG.rotateX(Math.PI / 2);
    const plane = new T.PlaneGeometry(.82, .82);
    pool('letter', () => {
      const g = new T.Group(), hub = new T.Group(), ring = new T.Mesh(ringG, R_.ring.letter), disc = new T.Mesh(discG, R_.disc);
      const f = new T.Mesh(plane, glyphMat('A')), b = new T.Mesh(plane, glyphMat('A')); f.position.z = .1; b.position.z = -.1; b.rotation.y = Math.PI;
      ring.castShadow = true; hub.add(ring, disc, f, b); g.add(hub); g.visible = false; scene.add(g); return { root: g, hub, ring, f, b, ch: '' };
    });
    // turbo pad: dark plate with scrolling amber chevrons
    R_.padTex = ctex(256, 512, (g, w, h) => {
      g.fillStyle = '#2a2d31'; g.fillRect(0, 0, w, h); g.strokeStyle = '#6b6f73'; g.lineWidth = 6; g.strokeRect(5, 5, w - 10, h - 10);
      g.fillStyle = '#e0ac45'; for (let i = 0; i < 4; i++) { const y = h - 70 - i * 120; g.beginPath(); g.moveTo(40, y); g.lineTo(w / 2, y - 70); g.lineTo(w - 40, y); g.lineTo(w - 40, y + 38); g.lineTo(w / 2, y - 32); g.lineTo(40, y + 38); g.closePath(); g.fill(); }
    }, true);
    R_.padTex.repeat.set(1, 1);
    pool('pad', () => { const g = new T.Group(), m = new T.Mesh(new T.PlaneGeometry(2.1, 4.6), new T.MeshLambertMaterial({ map: R_.padTex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, emissive: 0x4a3410, emissiveIntensity: .5 })); m.rotation.x = -Math.PI / 2; m.position.y = .035; m.receiveShadow = true; g.add(m); g.visible = false; scene.add(g); return { root: g }; });
    // ramp: grey wedge + hazard-striped slope
    const W = 2.3, L = 3.4, H = 1.25, sh = new T.Shape(); sh.moveTo(0, 0); sh.lineTo(L, 0); sh.lineTo(L, H); sh.lineTo(0, 0);
    const wg = new T.ExtrudeGeometry(sh, { depth: W, bevelEnabled: false }); wg.rotateY(Math.PI / 2); wg.translate(-W / 2, 0, L / 2);
    R_.stripeTex = ctex(256, 256, (g, w, h) => { g.fillStyle = '#2b2d30'; g.fillRect(0, 0, w, h); g.fillStyle = '#d99a3a'; for (let x = -h; x < w + h; x += 64) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 32, h); g.lineTo(x + 32 + h, 0); g.lineTo(x + h, 0); g.closePath(); g.fill(); } }, true);
    R_.stripeTex.repeat.set(2, 3);
    const hyp = Math.hypot(L, H);
    pool('ramp', () => {
      const g = new T.Group(), body = new T.Mesh(wg, new T.MeshLambertMaterial({ color: 0x6f7378 })); body.castShadow = true; body.receiveShadow = true;
      const sl = new T.Mesh(new T.PlaneGeometry(W - .1, hyp), new T.MeshLambertMaterial({ map: R_.stripeTex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      sl.rotation.x = -Math.PI / 2 + Math.atan2(H, L); sl.position.set(0, H / 2 + .01, 0); sl.rotation.order = 'XYZ';
      g.add(body, sl); g.visible = false; scene.add(g); return { root: g };
    });
  }
  function buildItemsTask() {
    const R_ = itemRes;
    /* ---- location task items: brass key, lockbox, parcel, drop ring, port-pass relics. Each wears a slow teal halo so it reads as 'the special thing'. */
    const brass = new T.MeshStandardMaterial({ color: 0xd2a63c, roughness: .35, metalness: .8 }), steel = new T.MeshStandardMaterial({ color: 0x77808a, roughness: .45, metalness: .75 }),
      steelD = new T.MeshStandardMaterial({ color: 0x3b4149, roughness: .5, metalness: .6 }), card = new T.MeshStandardMaterial({ color: 0xb98d58, roughness: .85 }), cardD = new T.MeshStandardMaterial({ color: 0x8e6a3e, roughness: .9 }),
      tape = new T.MeshStandardMaterial({ color: 0xe0d2a8, roughness: .6 }), halo = new T.MeshBasicMaterial({ color: 0x7fc4c8, transparent: true, opacity: .55, depthWrite: false });
    const haloG = new T.TorusGeometry(.7, .028, 8, 36);
    const beamG = new T.CylinderGeometry(.16, .3, 7, 10, 1, true), beamM = new T.MeshBasicMaterial({ color: 0xbfe0de, transparent: true, opacity: .2, depthWrite: false, side: T.DoubleSide });
    const mkHalo = () => { const g = new T.Group(), h = new T.Mesh(haloG, halo), bm = new T.Mesh(beamG, beamM); bm.position.y = 3.2; g.add(h, bm); return g; };
    const bxm = (w, h, d, m, x, y, z) => { const o = new T.Mesh(new T.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; return o; };
    pool('key', () => {
      const g = new T.Group(), hub = new T.Group(), k = new T.Group();
      const bow = new T.Mesh(new T.TorusGeometry(.17, .055, 10, 22), brass); bow.position.y = .3; bow.castShadow = true;
      k.add(bow, bxm(.08, .56, .06, brass, 0, -.02, 0), bxm(.2, .07, .06, brass, .1, -.2, 0), bxm(.15, .07, .06, brass, .075, -.06, 0)); k.scale.setScalar(1.6); k.rotation.z = .5; hub.add(k, mkHalo()); g.add(hub); g.visible = false; scene.add(g); return { root: g, hub };
    });
    pool('lockbox', () => {
      const g = new T.Group(), hub = new T.Group();
      const sh = new T.Mesh(new T.TorusGeometry(.07, .022, 8, 14, Math.PI), brass); sh.position.set(0, .27, .28);
      hub.add(bxm(.78, .5, .5, steel, 0, 0, 0), bxm(.8, .14, .52, steelD, 0, .3, 0), bxm(.1, .52, .54, steelD, -.24, 0, 0), bxm(.1, .52, .54, steelD, .24, 0, 0), bxm(.14, .18, .06, brass, 0, .1, .27), sh, mkHalo()); g.add(hub); g.scale.setScalar(1.1); g.visible = false; scene.add(g); return { root: g, hub };
    });
    pool('parcel', () => {
      const g = new T.Group(), hub = new T.Group();
      hub.add(bxm(.66, .46, .5, card, 0, 0, 0), bxm(.68, .04, .52, cardD, 0, .235, 0), bxm(.1, .47, .52, tape, 0, 0, 0), bxm(.24, .16, .02, new T.MeshStandardMaterial({ color: 0xf0ece0, roughness: .8 }), .16, .02, .26), mkHalo()); g.add(hub); g.visible = false; scene.add(g); return { root: g, hub };
    });
    pool('drop', () => {
      const g = new T.Group(), ring = new T.Mesh(new T.RingGeometry(1.0, 1.25, 40), new T.MeshBasicMaterial({ color: 0x7fc4c8, transparent: true, opacity: .8, side: T.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
      const inner = new T.Mesh(new T.CircleGeometry(.95, 36), new T.MeshBasicMaterial({ color: 0x2c6e72, transparent: true, opacity: .45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      const wm = new T.MeshBasicMaterial({ color: 0xe8e4d6 }), c1 = bxm(.12, .02, 1.3, wm, 0, .02, 0), c2 = bxm(1.3, .02, .12, wm, 0, .02, 0);
      ring.rotation.x = inner.rotation.x = -Math.PI / 2; ring.position.y = .05; inner.position.y = .045; g.add(inner, ring, c1, c2); g.scale.set(1.05, 1, 1.35); g.visible = false; scene.add(g); return { root: g, ring };
    });
    pool('relic', () => {
      const g = new T.Group(), hub = new T.Group(), v = [];
      const seal = new T.Group(); seal.add(new T.Mesh(new T.CylinderGeometry(.22, .26, .1, 20), new T.MeshStandardMaterial({ color: 0x8e2f2f, roughness: .5, metalness: .3 })), new T.Mesh(new T.CylinderGeometry(.1, .12, .3, 14), brass)); seal.children[1].position.y = .2; seal.rotation.x = .25;
      const man = new T.Group(); man.add(bxm(.5, .66, .05, new T.MeshStandardMaterial({ color: 0xe6e2d4, roughness: .8 }), 0, 0, 0), bxm(.5, .08, .06, new T.MeshStandardMaterial({ color: 0x2f4f78, roughness: .6 }), 0, .3, 0), bxm(.34, .03, .06, steelD, 0, .1, 0), bxm(.34, .03, .06, steelD, 0, 0, 0), bxm(.34, .03, .06, steelD, 0, -.1, 0));
      const ck = new T.Group(), rg = new T.Mesh(new T.TorusGeometry(.14, .04, 8, 18), steel); rg.position.y = .3; ck.add(rg, bxm(.07, .5, .05, steel, 0, .02, 0), bxm(.16, .06, .05, steel, .08, -.14, 0), bxm(.12, .06, .05, steel, .06, -.02, 0), bxm(.5, .1, .06, brass, 0, -.3, 0));
      for (const o of [seal, man, ck]) { o.scale.setScalar(1.3); o.visible = false; hub.add(o); v.push(o); }
      hub.add(mkHalo()); g.add(hub); g.visible = false; scene.add(g); return { root: g, hub, v };
    });
    pool('shield', () => {
      const g = new T.Group(), hub = new T.Group(), sh = new T.Shape(); sh.moveTo(-.36, .42); sh.lineTo(.36, .42); sh.lineTo(.36, .02); sh.quadraticCurveTo(.34, -.3, 0, -.5); sh.quadraticCurveTo(-.34, -.3, -.36, .02); sh.closePath();
      const body = new T.Mesh(new T.ExtrudeGeometry(sh, { depth: .1, bevelEnabled: true, bevelSize: .03, bevelThickness: .03, bevelSegments: 1, steps: 1 }), new T.MeshStandardMaterial({ color: 0x4d83b4, roughness: .35, metalness: .55, emissive: 0x16304a, emissiveIntensity: .8 }));
      const rim = new T.Mesh(new T.ExtrudeGeometry(sh, { depth: .04, bevelEnabled: false }), steel); rim.scale.set(1.18, 1.14, 1); rim.position.set(0, -.02, -.05); body.position.z = 0; body.castShadow = true;
      const st = new T.Mesh(new T.BoxGeometry(.12, .5, .14), new T.MeshStandardMaterial({ color: 0xe8edf2, roughness: .4 })); st.position.set(0, .0, .06); const st2 = new T.Mesh(new T.BoxGeometry(.5, .12, .14), st.material); st2.position.set(0, .12, .06);
      body.add(st, st2); const inner = new T.Group(); inner.add(rim, body); inner.scale.setScalar(1.7); hub.add(inner, mkHalo()); g.add(hub); g.visible = false; scene.add(g); return { root: g, hub };
    });
    pool('magnet', () => {
      const g = new T.Group(), hub = new T.Group(), red = new T.MeshStandardMaterial({ color: 0xc8402f, roughness: .4, metalness: .45, emissive: 0x3a0e08, emissiveIntensity: .8 }), wh = new T.MeshStandardMaterial({ color: 0xdfe3e8, roughness: .35, metalness: .8 });
      const arc = new T.Mesh(new T.TorusGeometry(.3, .11, 12, 24, Math.PI), red); arc.castShadow = true;
      const l = new T.Mesh(new T.CylinderGeometry(.11, .11, .26, 14), red), r = l.clone(), tl = new T.Mesh(new T.CylinderGeometry(.112, .112, .12, 14), wh), tr = tl.clone();
      l.position.set(-.3, -.13, 0); r.position.set(.3, -.13, 0); tl.position.set(-.3, -.32, 0); tr.position.set(.3, -.32, 0);
      const m = new T.Group(); m.add(arc, l, r, tl, tr); m.scale.setScalar(1.6); m.position.y = .15; hub.add(m, mkHalo()); g.add(hub); g.visible = false; scene.add(g); return { root: g, hub };
    });
    R_.ring.bike = new T.MeshLambertMaterial({ color: 0xe08a3c, emissive: 0x4a2208, emissiveIntensity: .9 });
    R_.ring.tletter = new T.MeshLambertMaterial({ color: 0x4f9ea3, emissive: 0x0d2a2c, emissiveIntensity: .8 });
  }
  function syncItems(G) {
    if (!G.items) return;
    for (const it of G.items) {
      if (it.taken || it.z > 135 || it.z + (it.depth || 0) < -6) continue;
      let e = it._v;
      if (!e) { e = it._v = acquire(it.kind === 'x2' || it.kind === 'tletter' || it.kind === 'bike' ? 'letter' : it.kind); e.owner = it; if (it.kind === 'relic') { e.v.forEach((o, i) => { o.visible = i === it.v; }); } if (it.kind === 'letter' || it.kind === 'x2' || it.kind === 'tletter' || it.kind === 'bike') { const ch = it.kind === 'x2' ? '×2' : it.kind === 'bike' ? 'KEY' : it.ch; if (e.ch !== ch) { e.ch = ch; e.f.material = e.b.material = glyphMat(ch); } e.ring.material = itemRes.ring[it.kind]; } }
      e.stamp = frameId; const x = (it.lane - 1) * LW;
      if (it.kind === 'key' || it.kind === 'lockbox' || it.kind === 'parcel' || it.kind === 'relic' || it.kind === 'shield' || it.kind === 'magnet') { e.root.position.set(x, (it.y || .95) + Math.sin(G.clock * 2.4 + it.lane) * .06, -it.z); e.hub.rotation.y = G.clock * 1.5; }
      else if (it.kind === 'drop') { e.root.position.set(x, 0, -(it.z + it.depth / 2)); e.ring.rotation.z = G.clock * .6; }
      else if (it.kind === 'letter' || it.kind === 'x2' || it.kind === 'tletter' || it.kind === 'bike') { e.root.position.set(x, (it.y || .95) + Math.sin(G.clock * 2.4 + it.lane) * .08, -it.z); if (it.kind === 'bike') e.root.scale.setScalar(1.45 + Math.sin(G.clock * 5) * .08); e.hub.rotation.y = Math.sin(G.clock * 1.8 + it.lane) * .5; }
      else e.root.position.set(x, 0, -(it.z + (it.depth || 0) / 2));
      if (it.kind !== 'bike') e.root.scale.setScalar(1);
    }
    itemRes.padTex.offset.y = -((G.clock * 1.6) % 1);
  }

  /* ---------------------------------------------------------------- environment: per-stage look, cross-faded over a few seconds */
  const ENV_COLS = ['zen', 'mid', 'hor', 'fog', 'sunCol', 'discCol', 'hemiSky', 'hemiGnd', 'lampCol', 'ground', 'bldTint'];
  const ENV_NUMS = ['fogNear', 'fogFar', 'glow', 'sunInt', 'disc', 'hemiInt', 'fill', 'facEm', 'shopEm', 'lampOn', 'groundY', 'bld', 'sky', 'shops', 'lamps', 'park', 'stars', 'rain', 'snow'];
  const ENV_VECS = ['sun', 'discPos', 'road', 'walk'];
  const PROP_KINDS = Object.keys(PROP_DEF);
  function mkEnv(s) {
    const e = { props: {} };
    for (const k of ENV_COLS) e[k] = new T.Color(s[k]); for (const k of ENV_NUMS) e[k] = s[k] || 0; for (const k of ENV_VECS) e[k] = (s[k] || [0, 0, 0]).slice();
    for (const k of PROP_KINDS) e.props[k] = (s.props && s.props[k]) || 0; return e;
  }
  function lerpEnv(o, a, b, t) {
    for (const k of ENV_COLS) o[k].copy(a[k]).lerp(b[k], t); for (const k of ENV_NUMS) o[k] = lerp(a[k], b[k], t);
    for (const k of ENV_VECS) for (let i = 0; i < b[k].length; i++) o[k][i] = lerp(a[k][i], b[k][i], t);
    for (const k of PROP_KINDS) o.props[k] = lerp(a.props[k], b.props[k], t);
  }
  const cur = mkEnv(global.STAGES[0]), envA = mkEnv(global.STAGES[0]); let envB = null, envK = 1, envIdx = -1, envDirty = true;
  const ENV_TRANS = 4.5;
  const WHITE = new T.Color(1, 1, 1), cz = new T.Color(), cm = new T.Color(), ch = new T.Color(), cg = new T.Color(), sunDir = new T.Vector3(-.38, .1, -1).normalize(), vtmp = new T.Vector3();
  let roadMat, walkMat, BF = 1, BKEY = 0; const roadSnow = { value: 0 };
  function applyEnv() {
    cz.copy(cur.zen); cm.copy(cur.mid); ch.copy(cur.hor); cg.copy(cur.hor).multiplyScalar(.75);
    sunDir.set(cur.discPos[0], cur.discPos[1], -270).normalize();
    const pos = sky.geometry.attributes.position, glow = cur.glow;
    for (let i = 0; i < pos.count; i++) {
      vtmp.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
      const h = vtmp.y; let c;
      if (h <= 0) c = tmpC.copy(ch); else if (h < .28) c = tmpC.copy(ch).lerp(cm, sstep(0, .28, h)); else c = tmpC.copy(cm).lerp(cz, sstep(.28, .9, h));
      const gl = Math.pow(Math.max(0, vtmp.dot(sunDir)), 6) * glow * .9; c.r += cg.r * gl * 1.1; c.g += cg.g * gl; c.b += cg.b * gl * .8;
      skyCol[i * 3] = c.r; skyCol[i * 3 + 1] = c.g; skyCol[i * 3 + 2] = c.b;
    }
    sky.geometry.attributes.color.needsUpdate = true;
    const dayK = 1 - clamp(cur.lampOn * 1.2, 0, 1);       // 1 in daylight, 0 at night
    scene.fog.color.copy(cur.fog).lerp(ch, .38 * dayK).lerp(WHITE, .1 * dayK); scene.fog.near = cur.fogNear * (1 + .22 * dayK); scene.fog.far = cur.fogFar * (1 + .12 * dayK);
    sun.color.copy(cur.sunCol); sun.intensity = cur.sunInt * (1 + .2 * dayK); sun.position.set(cur.sun[0], cur.sun[1], cur.sun[2]);
    hemi.color.copy(cur.hemiSky); hemi.groundColor.copy(cur.hemiGnd); hemi.intensity = cur.hemiInt * (1 + .14 * dayK); fill.intensity = cur.fill;
    sunDisc.material.opacity = cur.disc; sunDisc.material.color.copy(cur.discCol); sunDisc.position.set(cur.discPos[0], cur.discPos[1], -270); sunDisc.lookAt(0, 0, 0);
    sunGlow.material.opacity = cur.disc * .55 * dayK; sunGlow.position.set(cur.discPos[0] * .97, cur.discPos[1], -268); sunGlow.lookAt(0, 0, 0);
    { const co = clamp(1 - cur.stars * 1.1 - cur.lampOn * .35, 0, 1) * (.55 + .25 * (1 - cur.rain)); for (const m of clouds) { m.material.opacity = co; m.material.color.copy(cur.hor).lerp(WHITE, .72 - .35 * cur.rain).multiplyScalar(1 - cur.rain * .45 - (1 - dayK) * .5); m.visible = co > .02; } }
    for (const m of facMat) { m.emissiveIntensity = cur.facEm; m.color.copy(cur.bldTint); }
    for (const m of shopMats) m.emissiveIntensity = cur.shopEm;
    const lo = .45 + .55 * cur.lampOn; lampHeads.material.color.copy(cur.lampCol).multiplyScalar(lo); lampPools.material.opacity = cur.lampOn * .75;
    roadSnow.value = clamp(cur.snow, 0, 1); roadMat.color.setRGB(cur.road[0], cur.road[1], cur.road[2]); walkMat.color.setRGB(cur.walk[0], cur.walk[1], cur.walk[2]);
    ground.material.color.copy(cur.ground); ground.position.y = cur.groundY;
    stars.material.opacity = cur.stars * .9; stars.visible = cur.stars > .02;
    BF = Math.round(cur.bld * 8) / 8; BKEY = Math.round(cur.bld * 8) * 10 + (cur.shops > .5 ? 1 : 0); NIGHT.n = clamp(cur.lampOn, 0, 1);
  }
  /* ---------------------------------------------------------------- sky events
     One event at a time, every ~25-45 s. Each is a few textured billboards (canvas art drawn once, lazily) on the sky
     dome, so the cost is a handful of quads for ~10 s. Day: plane+contrail, birds, delivery drone, blimp/balloon ad.
     Night: fireworks, shooting star, plane, drone. Rain: lightning. High police stars: helicopter with searchlight. */
  const SKY = { g: null, ev: null, next: 12, last: '', heliCd: 0, tex: {}, ad: 0, fw: null, flash: 0, wasFlash: false, bolt: null };
  const ADS = ['EKO RIDES', 'MAMA PUT', 'SUYA SPOT', 'NAIJA FRESH', 'ISALE BREAD', 'LAGOS LIVE'];
  function cvs(w, h, f) { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); f(g, w, h); const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t; }
  function skyTex(k) {
    if (SKY.tex[k]) return SKY.tex[k]; let t;
    if (k === 'plane') t = cvs(128, 64, (g) => { g.fillStyle = '#eef1f6'; g.beginPath(); g.ellipse(64, 32, 54, 5, 0, 0, 7); g.fill(); g.fillStyle = '#b9c3d1';
      g.beginPath(); g.moveTo(50, 32); g.lineTo(70, 6); g.lineTo(80, 6); g.lineTo(72, 32); g.lineTo(80, 58); g.lineTo(70, 58); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(14, 32); g.lineTo(8, 16); g.lineTo(18, 16); g.lineTo(26, 32); g.lineTo(18, 48); g.lineTo(8, 48); g.closePath(); g.fill();
      g.fillStyle = 'rgba(120,135,160,.55)'; g.fillRect(40, 30, 50, 4); });
    else if (k === 'trail') t = cvs(256, 16, (g, w, h) => { const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(.7, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,.85)'); g.fillStyle = gr;
      g.beginPath(); g.ellipse(w / 2, h / 2, w / 2, h * .42, 0, 0, 7); g.fill(); });
    else if (k === 'dot') t = cvs(32, 32, (g) => { const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.35, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32); });
    else if (k === 'bird') t = cvs(64, 32, (g) => { g.strokeStyle = '#2a2f38'; g.lineWidth = 5; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); g.moveTo(6, 10); g.quadraticCurveTo(22, 8, 32, 22); g.quadraticCurveTo(42, 8, 58, 10); g.stroke(); });
    else if (k === 'drone') t = cvs(128, 96, (g) => { g.fillStyle = '#e9edf2'; g.beginPath(); g.roundRect(46, 30, 36, 14, 5); g.fill(); g.fillStyle = '#3a4250'; g.fillRect(22, 24, 84, 3); g.fillRect(22, 20, 3, 8); g.fillRect(103, 20, 3, 8);
      g.fillStyle = 'rgba(60,70,85,.35)'; g.beginPath(); g.ellipse(24, 20, 17, 3, 0, 0, 7); g.fill(); g.beginPath(); g.ellipse(104, 20, 17, 3, 0, 0, 7); g.fill();
      g.strokeStyle = '#3a4250'; g.lineWidth = 2; g.beginPath(); g.moveTo(58, 44); g.lineTo(58, 56); g.moveTo(70, 44); g.lineTo(70, 56); g.stroke();
      g.fillStyle = '#c98a4b'; g.fillRect(50, 56, 28, 22); g.fillStyle = '#e1b27c'; g.fillRect(50, 56, 28, 5); g.fillStyle = '#7a4f28'; g.fillRect(62, 56, 4, 22); });
    else if (k === 'heli') t = cvs(192, 96, (g) => { g.fillStyle = '#2b3038'; g.beginPath(); g.ellipse(70, 56, 34, 17, 0, 0, 7); g.fill(); g.fillRect(96, 50, 70, 6); g.beginPath(); g.moveTo(160, 52); g.lineTo(172, 30); g.lineTo(178, 32); g.lineTo(168, 56); g.fill();
      g.fillStyle = 'rgba(150,185,215,.85)'; g.beginPath(); g.ellipse(50, 52, 15, 10, -.1, 0, 7); g.fill(); g.fillStyle = '#2b3038'; g.fillRect(66, 34, 6, 8);
      g.fillStyle = 'rgba(40,46,56,.55)'; g.beginPath(); g.ellipse(69, 32, 62, 3, 0, 0, 7); g.fill(); g.strokeStyle = '#2b3038'; g.lineWidth = 3; g.beginPath(); g.moveTo(40, 80); g.lineTo(100, 80); g.moveTo(54, 72); g.lineTo(52, 80); g.moveTo(86, 72); g.lineTo(88, 80); g.stroke(); });
    else if (k === 'beam') t = cvs(128, 128, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,248,220,.9)'); gr.addColorStop(1, 'rgba(255,248,220,.08)'); g.fillStyle = gr; g.beginPath(); g.moveTo(w / 2 - 3, 0); g.lineTo(w / 2 + 3, 0); g.lineTo(w - 4, h); g.lineTo(4, h); g.closePath(); g.fill(); });
    else if (k === 'blimp') t = cvs(256, 96, (g) => { g.fillStyle = '#d7dce3'; g.beginPath(); g.ellipse(128, 44, 104, 34, 0, 0, 7); g.fill(); g.fillStyle = '#b6bec9'; g.beginPath(); g.ellipse(128, 58, 98, 18, 0, 0, 3.14); g.fill();
      g.fillStyle = '#c0c7d1'; g.beginPath(); g.moveTo(26, 44); g.lineTo(6, 14); g.lineTo(24, 20); g.lineTo(40, 36); g.fill(); g.beginPath(); g.moveTo(26, 48); g.lineTo(6, 78); g.lineTo(24, 70); g.lineTo(40, 54); g.fill();
      g.fillStyle = '#3a4250'; g.beginPath(); g.roundRect(108, 74, 40, 12, 4); g.fill(); });
    else if (k === 'balloon') t = cvs(96, 128, (g) => { const cols = ['#c8553d', '#f2e3c6', '#2f7f86', '#f2e3c6', '#c8553d']; g.save(); g.beginPath(); g.ellipse(48, 48, 38, 46, 0, 0, 7); g.clip();
      for (let i = 0; i < 5; i++) { g.fillStyle = cols[i]; g.fillRect(10 + i * 15.4, 0, 16, 100); } const sh = g.createRadialGradient(36, 34, 4, 48, 50, 52); sh.addColorStop(0, 'rgba(255,255,255,.22)'); sh.addColorStop(1, 'rgba(0,0,40,.22)'); g.fillStyle = sh; g.fillRect(0, 0, 96, 100); g.restore();
      g.strokeStyle = '#6b4a2f'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(32, 88); g.lineTo(42, 104); g.moveTo(64, 88); g.lineTo(54, 104); g.stroke(); g.fillStyle = '#8a5a30'; g.fillRect(40, 104, 16, 12); });
    else if (k === 'streak') t = cvs(128, 8, (g, w, h) => { const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(255,255,255,1)'); g.fillStyle = gr; g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, 0); g.lineTo(w, h); g.fill(); });
    SKY.tex[k] = t; return t;
  }
  function bb(k, w, h, blend) { const m = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: skyTex(k), fog: false, transparent: true, depthWrite: false, opacity: 0, side: T.DoubleSide, blending: blend || T.NormalBlending })); m.scale.set(w, h, 1); m.renderOrder = -7; m.frustumCulled = false; return m; }
  function polar(v, az, el, r) { const ce = Math.cos(el); v.set(Math.sin(az) * ce * r, Math.sin(el) * r, -Math.cos(az) * ce * r); }
  const D2R = Math.PI / 180;
  function skyMood() { const dayK = 1 - clamp(cur.lampOn * 1.2, 0, 1); return { dayK, night: cur.stars > .5 || cur.lampOn > .75, rain: cur.rain > .9 }; }
  function skyTint(col, dayK) { col.copy(WHITE).lerp(cur.hor, .3 * dayK).multiplyScalar(.4 + .47 * dayK); return col; }
  const tcol = new T.Color();
  // each maker returns {g: Group, upd(ev, u, dt, mood)} ; u = progress 0..1
  const SKYK = {
    plane() { const g = new T.Group(), body = bb('plane', 34, 17), trail = bb('trail', 150, 3.6); trail.position.x = -88; const l1 = bb('dot', 6, 6, T.AdditiveBlending), l2 = bb('dot', 6, 6, T.AdditiveBlending); l1.position.x = -15; l2.position.set(5, 0, 0); g.add(trail, body, l1, l2);
      return { g, dur: 14, upd(ev, u, dt, M, fade) { const col = skyTint(tcol, M.dayK); body.material.color.copy(col); body.material.opacity = fade; trail.material.opacity = fade * (.1 + .6 * M.dayK); trail.material.color.copy(col);
        const b = M.night ? (Math.sin(ev.t * 6) > 0 ? 1 : .15) : 0; l1.material.opacity = fade * b; l1.material.color.setRGB(1, .25, .2); l2.material.opacity = fade * (M.night ? .9 : 0); l2.material.color.setRGB(1, 1, 1); } }; },
    birds() { const g = new T.Group(), bs = []; for (let i = 0; i < 9; i++) { const b = bb('bird', 8, 4); const row = i === 0 ? 0 : (i + 1) >> 1, side = i % 2 ? 1 : -1; b.position.set(-row * 7, side * row * 4 + (row ? 0 : 0), 0); b.userData.ph = i * .7; bs.push(b); g.add(b); }
      return { g, dur: 13, upd(ev, u, dt, M, fade) { for (const b of bs) { b.material.opacity = fade * .85; b.scale.y = 4 * (.35 + .65 * Math.abs(Math.sin(ev.t * 7 + b.userData.ph))); b.material.color.setScalar(.35 + .65 * (1 - M.dayK) * 0 + .2 * (1 - M.dayK)); } } }; },
    drone() { const g = new T.Group(), body = bb('drone', 18, 13.5), l = bb('dot', 4, 4, T.AdditiveBlending); l.position.set(0, 1.4, 0); g.add(body, l);
      return { g, dur: 14, r: 150, upd(ev, u, dt, M, fade) { skyTint(tcol, M.dayK); body.material.color.copy(tcol).lerp(WHITE, .35); body.material.opacity = fade; body.position.y = Math.sin(ev.t * 2.3) * .5; body.rotation.z = Math.sin(ev.t * 1.7) * .05;
        l.material.opacity = fade * (Math.sin(ev.t * 5) > 0 ? .9 : .2); l.material.color.setRGB(.3, 1, .5); } }; },
    heli() { const g = new T.Group(), body = bb('heli', 34, 17), beam = bb('beam', 20, 60, T.AdditiveBlending), l = bb('dot', 5, 5, T.AdditiveBlending); beam.position.set(-6, -34, 0); beam.rotation.z = .35; l.position.set(30, 6, 0); g.add(beam, body, l);
      return { g, dur: 16, face: -1, upd(ev, u, dt, M, fade) { skyTint(tcol, M.dayK); body.material.color.copy(tcol); body.material.opacity = fade; beam.material.opacity = fade * (M.night ? .5 : .14); beam.rotation.z = .3 + Math.sin(ev.t * .9) * .25; beam.position.x = -6 - Math.sin(ev.t * .9) * 7;
        l.material.opacity = fade * (Math.sin(ev.t * 6) > .3 ? 1 : .1); l.material.color.setRGB(1, .2, .15); body.position.y = Math.sin(ev.t * 3) * .35; } }; },
    blimp() { const g = new T.Group(), body = bb('blimp', 70, 26); g.add(body); const ad = ADS[(SKY.ad++) % ADS.length];
      const ad2 = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: cvs(256, 48, (c, w, h) => { c.font = '700 30px Oswald, Impact, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#c8553d'; c.fillText(ad, w / 2, h / 2 + 1); }), fog: false, transparent: true, depthWrite: false, opacity: 0 }));
      ad2.scale.set(46, 8.6, 1); ad2.position.set(2, 2.5, .01); ad2.renderOrder = -6.9; g.add(ad2);
      return { g, dur: 22, noflip: true, upd(ev, u, dt, M, fade) { skyTint(tcol, M.dayK); body.material.color.copy(tcol); body.material.opacity = fade; ad2.material.opacity = fade; ad2.material.color.copy(tcol); body.position.y = Math.sin(ev.t * .8) * .8; } }; },
    balloon() { const g = new T.Group(), b = bb('balloon', 30, 40); g.add(b);
      return { g, dur: 22, noflip: true, upd(ev, u, dt, M, fade) { skyTint(tcol, M.dayK); b.material.color.copy(tcol).lerp(WHITE, .25); b.material.opacity = fade; b.position.y = Math.sin(ev.t * .9) * 1.2; b.rotation.z = Math.sin(ev.t * .6) * .04; } }; },
    star() { const g = new T.Group(), s = bb('streak', 60, 2.4, T.AdditiveBlending); s.position.x = -30; g.add(s);
      return { g, dur: 1.1, upd(ev, u, dt, M, fade) { s.material.opacity = Math.sin(clamp(u, 0, 1) * 3.14159) * .95; } }; },
    lightning() { const g = new T.Group(), b = bb('dot', 1, 1); b.visible = false; g.add(b); return { g, dur: 3.2, upd() { } }; },
    fireworks() { if (!SKY.fw) { const N = 3 * 56, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(pos, 3)); geo.setAttribute('color', new T.BufferAttribute(col, 3));
        const pts = new T.Points(geo, new T.PointsMaterial({ size: 7, sizeAttenuation: false, vertexColors: true, fog: false, transparent: true, opacity: 1, depthWrite: false, blending: T.AdditiveBlending, map: skyTex('dot') })); pts.frustumCulled = false; pts.renderOrder = -7;
        SKY.fw = { pts, pos, col, bursts: [{ t: 9, o: new T.Vector3(), c: [1, .8, .4], v: new Float32Array(56 * 3) }, { t: 9, o: new T.Vector3(), c: [1, .8, .4], v: new Float32Array(56 * 3) }, { t: 9, o: new T.Vector3(), c: [1, .8, .4], v: new Float32Array(56 * 3) }], n: 0 }; }
      const g = new T.Group(), F = SKY.fw; g.add(F.pts); const PAL = [[1, .78, .38], [1, .6, .62], [.62, .85, 1], [.95, .95, .85], [.75, 1, .7]];
      return { g, dur: 11, billboard: false, upd(ev, u, dt, M, fade) { ev.nb = (ev.nb || 0) - dt; if (ev.nb <= 0 && u < .85) { ev.nb = .7 + rnd() * .8; const b = F.bursts[F.n++ % 3]; b.t = 0; b.c = PAL[(rnd() * PAL.length) | 0];
          polar(b.o, (rnd() - .5) * .44, (24 + rnd() * 6) * D2R, 190); for (let i = 0; i < 56; i++) { const a = Math.random() * 6.283, e = Math.acos(2 * Math.random() - 1), s = 18 + Math.random() * 26; b.v[i * 3] = Math.sin(e) * Math.cos(a) * s; b.v[i * 3 + 1] = Math.cos(e) * s * .9; b.v[i * 3 + 2] = Math.sin(e) * Math.sin(a) * s * .3; } }
        for (let k = 0; k < 3; k++) { const b = F.bursts[k]; b.t += dt; const a = b.t < 2.6 ? clamp(1 - b.t / 2.6, 0, 1) : 0, d = 1 - Math.exp(-b.t * 1.6); for (let i = 0; i < 56; i++) { const j = (k * 56 + i) * 3; F.pos[j] = b.o.x + b.v[i * 3] * d * 1.3; F.pos[j + 1] = b.o.y + b.v[i * 3 + 1] * d * 1.3 - b.t * b.t * 3.2; F.pos[j + 2] = b.o.z + b.v[i * 3 + 2] * d; const cA = a * a * (a > .02 ? 1 : 0) * (b.t < .12 ? 1.6 : 1); F.col[j] = b.c[0] * cA; F.col[j + 1] = b.c[1] * cA; F.col[j + 2] = b.c[2] * cA; } }
        F.pts.geometry.attributes.position.needsUpdate = true; F.pts.geometry.attributes.color.needsUpdate = true; F.pts.material.opacity = 1; },
        fixed: true }; },
  };
  function skyStart(kind) {
    if (!camera) return false; if (!SKY.g) { SKY.g = new T.Group(); scene.add(SKY.g); }
    SKY.built = SKY.built || {}; const mk = SKYK[kind]; if (!mk) return false;
    const e = SKY.built[kind] || (SKY.built[kind] = mk());
    const ev = { kind, e, t: 0, dur: e.dur, az0: 0, az1: 0, el: 0, r: e.r || 230, nb: 0 };
    const dir = rnd() < .5 ? -1 : 1, W2 = kind === 'blimp' || kind === 'balloon' ? .5 : .62;
    ev.az0 = -dir * W2; ev.az1 = dir * W2; ev.dir = dir; ev.el = (21 + rnd() * 7) * D2R;
    if (kind === 'star') { ev.az0 = -dir * .3; ev.az1 = dir * .12; ev.el = (24 + rnd() * 6) * D2R; ev.el1 = ev.el - .12; }
    if (kind === 'drone') ev.el = (18 + rnd() * 5) * D2R;
    if (kind === 'balloon') { ev.az0 = -dir * .5; ev.az1 = dir * .5; ev.el = (22 + rnd() * 4) * D2R; }
    if (kind === 'lightning') { ev.fl = [.35, .62, 1.1]; ev.bz = (rnd() - .5) * .5; }
    e.g.visible = true; if (e.g.parent !== SKY.g) SKY.g.add(e.g); if (!e.g.children.length) return false;
    e.g.scale.x = (e.fixed || e.noflip) ? 1 : ev.dir * (e.face || 1); // sprites face travel direction
    SKY.ev = ev; return true;
  }
  function skyStop() { const ev = SKY.ev; if (!ev) return; ev.e.g.visible = false; if (SKY.bolt) SKY.bolt.visible = false; SKY.ev = null; SKY.flash = 0; if (SKY.wasFlash) { envDirty = true; SKY.wasFlash = false; } }
  const tmpv = new T.Vector3();
  function skyUpdate(G, dt) {
    if (!camera || !cur) return; const live = G.state === 'play' || (G.attract && G.state === 'title');
    if (G.time < .3 && G.state === 'play' && !SKY._rs) { SKY._rs = 1; SKY.next = 11 + rnd() * 8; skyStop(); } else if (G.time > 1) SKY._rs = 0;
    dt = Math.min(dt, .05); if (G.paused) return;
    SKY.heliCd -= dt;
    if (!SKY.ev) {
      if (!live) return; SKY.next -= dt; const M = skyMood();
      const hot = G.state === 'play' && (G.threat | 0) >= 7 && SKY.heliCd <= 0 && SKY.next < 14;
      if (hot || SKY.next <= 0) {
        let kind;
        if (hot) { kind = 'heli'; SKY.heliCd = 55; }
        else { const pool = M.rain ? ['lightning', 'lightning', 'plane'] : M.night ? ['fireworks', 'star', 'plane', 'drone', 'fireworks', 'star'] : ['plane', 'birds', 'drone', 'blimp', 'balloon', 'birds'];
          const p2 = pool.filter((k) => k !== SKY.last); kind = p2[(rnd() * p2.length) | 0]; if (M.rain && kind === 'plane') kind = 'lightning'; }
        if (skyStart(kind)) { SKY.last = kind; SKY.next = 25 + rnd() * 20; } else SKY.next = 5;
      }
      if (!SKY.ev) return;
    }
    const ev = SKY.ev, e = ev.e, M = skyMood(); ev.t += dt; const u = ev.t / ev.dur;
    if (u >= 1) { skyStop(); return; }
    const fade = Math.min(1, u / .08, (1 - u) / .08), az = ev.az0 + (ev.az1 - ev.az0) * u, el = ev.el + (ev.el1 !== undefined ? (ev.el1 - ev.el) * u : 0);
    if (!e.fixed) { polar(e.g.position, az, el, ev.r); e.g.quaternion.copy(camera.quaternion); } else e.g.position.set(0, 0, 0);
    if (ev.kind === 'plane' || ev.kind === 'heli' || ev.kind === 'star') e.g.rotateZ(ev.dir * .04 * (ev.kind === 'star' ? -2.5 : 1)); else if (ev.kind === 'birds') e.g.rotateZ(ev.dir * -.05);
    e.upd(ev, u, dt, M, fade);
    if (ev.kind === 'lightning') skyLightning(ev, M);
  }
  function skyLightning(ev, M) {
    if (!SKY.bolt) { SKY.bolt = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ fog: false, transparent: true, depthWrite: false, opacity: 0, color: 0xeaf0ff, blending: T.AdditiveBlending })); SKY.bolt.renderOrder = -7; SKY.bolt.frustumCulled = false; SKY.g.add(SKY.bolt); }
    let f = 0; for (let i = 0; i < ev.fl.length; i++) { const d = ev.t - ev.fl[i]; if (d > 0 && d < .22) f = Math.max(f, (1 - d / .22) * (i === 1 ? .7 : 1)); }
    if (f > 0 && !ev.bolted) { ev.bolted = 1; SKY.bolt.material.map = cvs(64, 128, (g, w, h) => { let x = 36 + (rnd() - .5) * 10; g.strokeStyle = '#fff'; g.shadowColor = '#bcd0ff'; g.shadowBlur = 8; g.lineWidth = 2.4; g.lineJoin = 'round'; g.beginPath(); g.moveTo(x, 0);
        for (let y = 12; y < h; y += 12) { x += (rnd() - .5) * 18; g.lineTo(x, y); } g.stroke(); });
      polar(SKY.bolt.position, ev.bz, 24 * D2R, 220); SKY.bolt.quaternion.copy(camera.quaternion); SKY.bolt.scale.set(40, 80, 1); SKY.bolt.position.y -= 14; SKY.bolt.material.needsUpdate = true; if (Sfx && Sfx.thunder) Sfx.thunder(); if (global.navigator && navigator.vibrate && Save.data.set && Save.data.set.haptics) { try { navigator.vibrate(0); } catch (_) { } } }
    SKY.bolt.visible = f > 0 && !!SKY.bolt.material.map; SKY.bolt.material.opacity = f; SKY.flash = f;
    if (f > 0) { const dk = 1 - clamp(cur.lampOn * 1.2, 0, 1); hemi.intensity = cur.hemiInt * (1 + .14 * dk) + f * 2.2; scene.fog.color.lerp(WHITE, f * .22); SKY.wasFlash = true; }
    else if (SKY.wasFlash) { SKY.wasFlash = false; envDirty = true; }
  }
  R.skySeek = function (t) { if (SKY.ev) SKY.ev.t = t; };
  R.skyInfo = function () { return SKY.ev ? { k: SKY.ev.kind, t: SKY.ev.t, next: SKY.next } : { next: SKY.next }; };
  R.sky = function (kind) { skyStop(); return skyStart(kind); };

  function updateEnv(G, dt) {
    const idx = R._forceStage !== undefined ? R._forceStage : ((G.stage | 0) % global.STAGES.length);
    const snap = G.attract || G.time < .25 || envIdx < 0;
    if (idx !== envIdx) {
      envIdx = idx; envB = mkEnv(global.STAGES[idx]);
      if (snap) { lerpEnv(cur, envB, envB, 0); envK = 1; } else { lerpEnv(envA, cur, cur, 0); envK = 0; }
      envDirty = true;
    }
    if (envK < 1) { envK = Math.min(1, envK + dt / ENV_TRANS); lerpEnv(cur, envA, envB, sstep(0, 1, envK)); envDirty = true; }
    for (const m of clouds) { if (!m.visible) continue; const u = m.userData; u.a += u.sp * dt; if (u.a > 1.15) u.a = -1.15; m.position.set(Math.sin(u.a) * 255, u.h, -Math.cos(u.a) * 255); m.lookAt(0, u.h * .6, 0); }
    if (!envDirty) return; envDirty = false; applyEnv();
  }
  R.setStage = function (i, snap) { R._forceStage = i; if (snap) envIdx = -1; };

  /* ---------------------------------------------------------------- scroll + sync */
  const mod = (a, m) => ((a % m) + m) % m;
  function syncScenery(G) {
    const d = G.dist;
    roadTex.offset.y = mod(d / 12, 1); walkTexL.offset.y = mod(d / 7, 1); syncProps(G);
    // lamps
    const tot = lampCount * lampSp;
    SLOTS.lamps.forEach((s, i) => {
      const z = mod(s.base - d, tot) - 24;
      dummy.position.set(s.side * (CURB_X + .55), 0, -z); dummy.rotation.set(0, s.side < 0 ? Math.PI : 0, 0); const ls = Math.max(.001, cur.lamps); dummy.scale.set(ls, ls, ls); dummy.updateMatrix(); lampPoles.setMatrixAt(i, dummy.matrix);
      dummy.position.set(s.side * (CURB_X + .55) - s.side * 1.75 * ls, 8.0 * ls, -z); dummy.rotation.set(0, 0, 0); dummy.scale.set(ls, ls, ls); dummy.updateMatrix(); lampHeads.setMatrixAt(i, dummy.matrix);
      dummy.position.set(s.side * (CURB_X - 2.2), .05, -z); dummy.rotation.set(-Math.PI / 2, 0, 0); dummy.scale.set(9 * ls, 9 * ls, 1); dummy.updateMatrix(); lampPools.setMatrixAt(i, dummy.matrix);
    });
    lampPoles.instanceMatrix.needsUpdate = lampHeads.instanceMatrix.needsUpdate = lampPools.instanceMatrix.needsUpdate = true;
    // parked cars
    const ptot = parkedN * parkedSp;
    for (const s of SLOTS.parked) {
      const z = mod(s.base - d, ptot) - 20;
      if (z > s.prev + 1) { s.seed = (Math.random() * 1e6) | 0; const rr = srand(s.seed); s.present = rr() < .62 * cur.park; s.pi = (rr() * PAINTS.length) | 0; s.flip = rr() < .12; s.kind = rr() < .12 ? 'taxi' : 'sedan'; s.jit = (rr() - .5) * 1.2; if (s.e) { s.e.root.visible = false; pools.parked.active.splice(pools.parked.active.indexOf(s.e), 1); pools.parked.free.push(s.e); s.e = null; } }
      s.prev = z;
      if (!s.present || cur.park < .05) continue;
      if (!s.e && mobile && z > 120) continue;      // LOD: don't spawn far parked cars on phones (they are fogged out anyway)
      if (!s.e) { s.e = acquire('parked'); setVeh(s.e, s.kind, PAINTS[s.pi], 4.4, 1, 1); }
      s.e.stamp = frameId; s.e.root.position.set(s.side * (ROAD_HALF - 1.0), 0, -z + s.jit); s.e.root.rotation.y = s.flip ? Math.PI : 0;
    }
    // far skyline
    for (const sk of skyline) {
      const tot2 = sk.n * 62; let k = 0; const skH = sk.h * cur.sky; if (cur.sky < .03) { sk.im.count = 0; continue; } sk.im.count = sk.n * 2;
      for (let i = 0; i < sk.n; i++) for (const sd of [-1, 1]) {
        const z = mod(i * 62 + (sk.h * 3.7 % 31) + (sd > 0 ? 29 : 0) - d * .96, tot2) - 30;
        dummy.position.set(sd * (24 + ((i * 7 + sk.h) % 5) * 5), skH / 2, -z - 20); dummy.rotation.set(0, 0, 0); dummy.scale.set(18, skH, 18); dummy.updateMatrix(); sk.im.setMatrixAt(k++, dummy.matrix);
      }
      sk.im.instanceMatrix.needsUpdate = true;
    }
  }
  function syncSim(G) {
    for (const side of [0, 1]) for (const b of G.blds[side]) {
      if (b.z > 175 || b.z + b.depth < -22) continue;
      let e = b._v; if (!e) { e = b._v = acquire('bld'); e.owner = b; placeBuilding(e, b); } if (BF <= .05) e.root.visible = false;
      e.stamp = frameId; e.root.position.z = -(b.z + b.depth / 2);
      if (e.sig !== b || e.bk !== BKEY) placeBuilding(e, b);
    }
    for (const b of G.boards) {
      if (b.z > 175 || b.z < -16) continue;
      let e = b._v; if (!e) { e = b._v = acquire('board'); e.owner = b; }
      e.stamp = frameId;
      const side = b.side === 0 ? -1 : 1;
      e.root.position.set(side * (CURB_X + 1.6), 0, -b.z); e.root.rotation.y = side < 0 ? .5 : -.5;
      const tx = b.text || 'WATCHING'; if (e.text !== tx) { e.text = tx; e.tex.userData.draw = drawBoard(tx); redrawBoard(e, tx); }
    }
    for (const o of G.obs) {
      if (o.z > 175 || o.z + o.depth < -16) continue;
      let e = o._v;
      if (!e) {
        const r = srand(o.seed + 3); let kind;
        if (o.type === 'wall') {
          kind = 'veh'; e = acquire('veh');
          const d = o.depth;
          if (d < 5.2) { const q = r(); const k = q < .34 ? 'taxi' : q < .62 ? 'police' : 'sedan'; setVeh(e, k, k === 'sedan' ? PAINTS[(r() * PAINTS.length) | 0] : '#ffffff', clamp(d + .2, 3.2, 5.4), 1.18, 1.3); }
          else if (d < 7.2) setVeh(e, 'van', VAN_PAINTS[(r() * VAN_PAINTS.length) | 0], d + .1, 1, 1);
          else if (d < 11.5) setVeh(e, 'truck', ['#2d4166', '#7b2b27', '#d9d7cf', '#3d5648'][(r() * 4) | 0], d + .1, 1, 1);
          else setVeh(e, 'bus', '#e6e4dc', d + .1, 1, 1);
          e.vk = e.kind;
        } else if (o.type === 'barrier') { const q = r(); kind = q < .38 ? 'jersey' : q < .72 ? 'saw' : 'cones'; e = acquire(kind); e.vk = kind; }
        else { e = acquire('gantry'); e.vk = 'gantry'; }
        o._v = e; e.owner = o; o.vis = e.vk;
      }
      e.stamp = frameId;
      const x = (o.lane - 1) * LW;
      if (o.type === 'wall') e.root.position.set(x, 0, -(o.z + o.depth / 2)); else e.root.position.set(x, 0, -(o.z + o.depth / 2));
      if (e.bar && e.bar.visible) { const f = Math.floor(G.clock * 3.2) % 2; matPoliceR.color.setScalar(1).multiply(tmpC.set(f ? 0xff3030 : 0x501010)); matPoliceB.color.copy(tmpC.set(f ? 0x142a66 : 0x4f7dff)); }
    }
    syncItems(G);
    // cash
    let n = 0;
    for (const c of G.coinsL) {
      if (c.taken || c.z > 130 || c.z < -6 || n >= 200) continue;
      dummy.position.set((c.lane - 1) * LW, c.y + .3 + Math.sin(G.clock * 3 + c.ph) * .05, -c.z);
      dummy.rotation.set(.35, G.clock * 2.2 + c.ph, 0); dummy.scale.setScalar(1.15); dummy.updateMatrix(); R.cash.setMatrixAt(n++, dummy.matrix);
    }
    R.cash.count = n; R.cash.instanceMatrix.needsUpdate = true;
    for (const c of G.chips) {
      if (c.taken || c.z > 130 || c.z < -6) continue;
      let e = c._v; if (!e) { e = c._v = acquire('jammer'); e.owner = c; }
      e.stamp = frameId; e.root.position.set((c.lane - 1) * LW, 0, -c.z);
      e.hover.position.y = .9 + Math.sin(G.clock * 2.6) * .08; e.hover.rotation.y = G.clock * 1.6;
      e.ring.material.opacity = .4 + .15 * Math.sin(G.clock * 4);
    }
  }
  function redrawBoard(e, tx) {
    const t = e.tex, cv = t.image, g = cv.getContext('2d'); drawBoard(tx)(g, cv.width, cv.height); t.needsUpdate = true;
  }

  /* ---------------------------------------------------------------- camera */
  function updateCamera(G, dt) {
    const p = G.p, portrait = W / H < 1.0; dt = Math.min(dt, .05);
    const cfg = portrait ? CFG_P : CFG_L;
    { const w = 5.2, tg = ((vis.x - 1) * LW) * .55, ex = Math.exp(-w * dt), dx = vis.camX - tg, tv = vis.cv + w * dx;      // critically damped follow: trails the rider, then settles
      vis.camX = tg + (dx + tv * dt) * ex; vis.cv = (vis.cv - w * tv * dt) * ex; }
    vis.roll += (clamp(-vis.cv * .018, -.07, .07) - vis.roll) * (1 - Math.exp(-dt * 8));
    const sp = clamp((G.speed - 20) / 22, 0, 1);
    const dead = G.state === 'dead' || G.state === 'over';
    const dd = dead ? clamp(G.deadT / 1.4, 0, 1) : 0;
    const fov = cfg.fov + sp * 5 + (G.boostK || 0) * 7 - dd * 6;
    if (Math.abs(camera.fov - fov) > .01 || camera.aspect !== W / H) { camera.fov = fov; camera.aspect = W / H; camera.updateProjectionMatrix(); }
    if (R.dbgCam) { const d = R.dbgCam; camera.position.set(d[0], d[1], d[2]); camera.lookAt(d[3], d[4], d[5]); return; }   // test hook (screenshots)
    if (G.attract && G.state === 'title') {                // title: slow cinematic flyover (clock-driven, frame-rate independent)
      const t = G.clock; let cx = vis.camX * .35 + Math.sin(t * .11) * 4.6, cy = 5.6 + Math.sin(t * .17) * .8, cz = 10.5 + Math.cos(t * .09) * 1.8, lx = Math.sin(t * .07) * 1.4, ly = 1.5, lz = -20, rz = Math.sin(t * .13) * .02;
      const I = vis.intro; if (I) {                         // intro: aerial sweep over the avenue settling into the normal title flyover
        I.t += Math.max(0, dt); const u = clamp(I.t / I.sweep, 0, 1), e = 1 - Math.pow(1 - u, 3), k = 1 - e;
        cx += (-6 - cx) * k; cy += (19 - cy) * k; cz += (34 - cz) * k; lx += (0 - lx) * k; ly += (4 - ly) * k; lz += (-40 - lz) * k; rz += k * .06;
        if (I.t >= I.dur) vis.intro = null;
      }
      camera.position.set(cx, cy, cz); camera.lookAt(lx, ly, lz); camera.rotateZ(rz); return;
    }
    const sk = G.fx.shake * .012;
    let sway = 0; if (G.attract || G.state === 'title') sway = Math.sin(G.clock * .35) * .55;
    camera.position.set(vis.camX + sway + (rnd() - .5) * sk, cfg.h + p.y * .22 - (p.slide > 0 ? .15 : 0) - dd * .55 + (rnd() - .5) * sk, cfg.z - dd * 1.7);
    camera.lookAt(vis.camX * .5 + (vis.x - 1) * LW * .25, cfg.ly - dd * .25, cfg.lz);
    if (!dead) { camera.rotateZ(vis.roll); camera.position.y += Math.sin(p.phase * 2) * .012 * (.4 + sp) - vis.sy * .25; }
  }

  /* ---------------------------------------------------------------- governor + API */
  let ema = 1 / 60, slow = 0, fast = 0;
  function applyRatio() { renderer.setPixelRatio(dpr * ratio); renderer.setSize(W, H, false); }
  function governor(dt) {
    if (R.noGov || dt <= 0 || dt > .25) return;
    ema += (dt - ema) * .05;
    if (ema > (mobile ? .0205 : .022)) { slow++; fast = 0; } else if (ema < .0125) { fast++; slow = 0; } else { slow = fast = 0; }
    if (slow > (mobile ? 30 : 50) && ratio > .55) { ratio = Math.max(.55, ratio - .12); slow = 0; applyRatio(); if (ratio < .75 && sun.castShadow) { sun.castShadow = false; } }
    else if (fast > 400 && ratio < maxRatio) { ratio = Math.min(maxRatio, ratio + .06); fast = 0; applyRatio(); }
  }

  R.init = function (cv) {
    canvas = cv; mobile = /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent) || (matchMedia && matchMedia('(pointer:coarse)').matches);
    renderer = new T.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance', alpha: false, preserveDrawingBuffer: /keepbuffer/.test(location.search) });
    MAXA = renderer.capabilities.getMaxAnisotropy() || 1; ANISO = Math.min(mobile ? 4 : 8, MAXA);   // ANISO for props; road + pavement use the renderer max (MAXA)
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFShadowMap;
    renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.18; renderer.outputColorSpace = T.SRGBColorSpace;
    dpr = Math.min(global.devicePixelRatio || 1, 1.5); maxRatio = 1; ratio = maxRatio;
    scene = new T.Scene(); scene.fog = new T.Fog(0xb98c6c, 40, mobile ? 160 : 190);
    camera = new T.PerspectiveCamera(60, 16 / 9, .3, 420);
    buildScene(); P = buildPlayer(wantOutfit && wantOutfit.look); curCharKey = wantOutfit ? wantOutfit.name + '|' + wantOutfit.nick : null; updateEnv({ attract: true, time: 0 }, 0);
    R.ready = true; R.resize(global.innerWidth, global.innerHeight);
    if (document.fonts && document.fonts.load) document.fonts.load('700 40px Oswald').then(() => { texJobs.forEach(t => t.userData.redraw && t.userData.redraw()); for (const e of (pools.board ? pools.board.active.concat(pools.board.free) : [])) if (e.text) redrawBoard(e, e.text); }).catch(() => {});
  };
  R.resize = function (w, h) { W = Math.max(2, w | 0); H = Math.max(2, h | 0); if (renderer) { applyRatio(); camera.aspect = W / H; camera.updateProjectionMatrix(); } };
  /* playable characters: rebuild the model when the equipped character changes */
  let wantOutfit = null, curCharKey = null;
  R.setOutfit = function (o) {
    wantOutfit = o; if (o && o.look) curLookId = o.look.id; if (!P || !o) return;
    const key = o.name + '|' + o.nick; if (key === curCharKey) return; curCharKey = key;
    scene.remove(P.root); global.CharKit.dispose(P);
    P = buildPlayer(o.look); P.mats = null;
  };
  R.gesture = function (ev, force) {
    const id = curLookId; let k;
    if (ev === 'lose') k = 'shake'; else if (ev === 'win') k = id === 'okada' ? 'wheelie' : 'pump'; else if (ev === 'start') k = G_START[id] || 'wave'; else k = G_FLAIR[id] || 'wave';
    if (!force && vis.g && vis.g.k !== 'shake' && ev === 'flair') return;
    vis.g = { k, t: 0, d: GD[k] || 1.2 }; vis.flairT = 16 + Math.random() * 10; return k;
  };
  // pure: writes joint targets into `t` (blended by e) and the direct extras into x, for gesture `k` at progress u (0..1), time T
  function gestureAt(k, u, T, t, x) {
    const ss = (a, b, v) => { v = clamp((v - a) / (b - a), 0, 1); return v * v * (3 - 2 * v); };
    const e = ss(0, .16, u) * (1 - ss(.8, 1, u)), bl = (n, v) => { t[n] = t[n] * (1 - e) + v * e; };
    switch (k) {
      case 'wave': bl('arR', 2.65); bl('elR', .75 + Math.sin(T * 13) * .45); x.hz = .12 * e; x.hy = .1 * e; break;
      case 'point': bl('arR', 1.75); bl('elR', .12); x.hy = -.12 * e; x.hx = -.05 * e; break;
      case 'pump': bl('arR', 2.9); bl('elR', .55 + Math.abs(Math.sin(T * 8.5)) * .9); x.hx = -.1 * e; bl('torso', t.torso - .08); x.lift = Math.abs(Math.sin(T * 8.5)) * .02 * e; break;
      case 'shake': x.hy = Math.sin(T * 17) * .5 * e; x.hx = .12 * e; break;
      case 'nod': x.hx = (Math.sin(u * Math.PI * 2) * .3 + .12) * e; bl('arR', t.arR + .15); x.hy = Math.sin(u * Math.PI) * .12; break;
      case 'thump': { const th = Math.abs(Math.sin(T * 9.5)); bl('arL', .55); bl('elL', 2.15 - th * .35); x.tw = -th * .2 * e; x.hx = -.08 * e; x.lift = th * .03 * e; x.ry = Math.sin(T * 9.5) * .08 * e; break; }
      case 'twirl': bl('arR', 2.9); bl('elR', .4 + Math.sin(T * 9) * .35); x.ry = Math.sin(u * Math.PI * 2) * .75 * e; x.hz = Math.sin(T * 9) * .12 * e; x.hy = Math.sin(u * Math.PI * 2) * -.4 * e; break;
      case 'salute': bl('arR', 2.45); bl('elR', 2.35); x.hx = .04 * e; x.hy = .08 * e; break;
      case 'fist': bl('arR', 1.9); bl('elR', 2.3); bl('arL', 1.9); bl('elL', 2.3); x.hx = Math.sin(u * Math.PI) * .22 * e; x.lift = -Math.sin(u * Math.PI) * .03; break;
      case 'shaka': bl('arR', 2.75); bl('elR', .6 + Math.sin(T * 16) * .55); x.hz = .1 * e; x.ry = Math.sin(T * 5) * .12 * e; x.hy = Math.sin(T * 5) * .12 * e; break;
      case 'adjust': bl('arR', 2.5); bl('elR', 2.2 + Math.sin(T * 8) * .1); x.hx = .1 * e; x.hy = .15 * e; x.hz = .05 * e; break;
      case 'rev': { const rv = Math.abs(Math.sin(T * 10)); bl('arR', t.arR + .25); bl('elR', t.elR - .5 * rv); x.pitch = rv * .06 * e; x.lift = rv * .02 * e; bl('torso', t.torso - .1); x.hx = -.06 * e; break; }
      case 'horns': bl('arR', 2.95); bl('elR', .4 + Math.abs(Math.sin(T * 9)) * .5); bl('arL', 2.95); bl('elL', .4 + Math.abs(Math.cos(T * 9)) * .5); x.hx = -.14 * e; bl('torso', t.torso - .1); x.hy = Math.sin(T * 9) * .12 * e; break;
      case 'sway': bl('arR', 2.8); bl('elR', .7 + Math.sin(T * 7) * .4); bl('arL', 2.6); bl('elL', .7 - Math.sin(T * 7) * .4); x.tw = Math.sin(T * 6) * .22 * e; x.ry = Math.sin(T * 6) * .3 * e; x.hy = Math.sin(T * 6) * .2 * e; x.lift = Math.abs(Math.sin(T * 6)) * .02 * e; break;
      case 'wheelie': x.pitch = Math.pow(Math.sin(u * Math.PI), .7) * .34; x.lift = x.pitch * 0.62; bl('torso', t.torso - .18); bl('arL', t.arL + .2); bl('arR', t.arR + .2); break;
    }
  }
  function gestureStep(t, dt, ok) {
    const x = vis.gx; x.hx = x.hy = x.hz = x.ry = x.pitch = x.lift = x.tw = 0;
    const g = vis.g; if (!g) return null;
    if (!ok && g.k !== 'shake') { vis.g = null; return null; }
    g.t += dt; const u = g.t / g.d; if (u >= 1) { vis.g = null; return null; }
    gestureAt(g.k, u, g.t, t, x); return g.k;
  }
  R.outfitHex = () => curCharKey;
  global.__bm = () => P && P.bm;
  /* characters preview: a small studio (key + warm/cool rim lights, soft ground shadow) used for cached PNG cards and a live idle-animated hero */
  const pvCache = {};
  function shadowTex() { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 4, 64, 64, 62); gr.addColorStop(0, 'rgba(0,0,0,.62)'); gr.addColorStop(.6, 'rgba(0,0,0,.28)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); const t = new T.CanvasTexture(c); return t; }
  function makePV(cv, w, h, ratio) {
    const r = new T.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setPixelRatio(ratio || 1); r.setSize(w, h, false); r.toneMapping = T.ACESFilmicToneMapping; r.toneMappingExposure = 1.05; r.setClearColor(0x000000, 0);
    const sc = new T.Scene(), cam = new T.PerspectiveCamera(27, w / h, .5, 40);
    sc.add(new T.HemisphereLight(0xdfe6f0, 0x4b4741, 1.5));
    const key = new T.DirectionalLight(0xfff1dc, 2.6); key.position.set(-3.5, 4.5, 5); sc.add(key);
    const rimC = new T.DirectionalLight(0x8fb2e6, 3.2); rimC.position.set(4.5, 3, -4.5); sc.add(rimC);   // cool rim from behind-right
    const rimW = new T.DirectionalLight(0xffb87a, 2.4); rimW.position.set(-4.5, 2.4, -4); sc.add(rimW);  // warm rim from behind-left
    const fill = new T.DirectionalLight(0xbfd0e6, .5); fill.position.set(4, 1.5, 4); sc.add(fill);
    const pv = { r, sc, cam, cur: null, t: 0, shadow: shadowTex() };
    pv.show = function (ch) {
      if (pv.cur) { sc.remove(pv.cur.root); global.CharKit.dispose(pv.cur); }
      const c = global.CharKit.build(ch.look); pv.cur = c; pv.id = ch.look.id;
      const sh = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: pv.shadow, transparent: true, depthWrite: false }));
      sh.rotation.x = -Math.PI / 2; sh.position.set(0, .01, (c.veh.keke ? .1 : .05)); sh.scale.set(c.veh.keke ? 2.1 : 1.1, c.veh.wb * 1.45 + .6, 1); sh.rotation.z = 0; c.root.add(sh); sh.castShadow = false;
      sc.add(c.root); pv.t = 0; pv.pose(0);
    };
    pv.pose = function (t) {
      const c = pv.cur; if (!c) return; const P_ = c.pose, br = Math.sin(t * 1.7);
      // idle flair: this character's signature gesture every ~6 s (live hero only; cached card PNGs are rendered at t = 0)
      const q = { arL: P_.arL, elL: P_.elL, arR: P_.arR, elR: P_.elR, torso: P_.torso }, gx = { hx: 0, hy: 0, hz: 0, ry: 0, pitch: 0, lift: 0, tw: 0 };
      if (t > 1.2) { const kd = G_FLAIR[pv.id] || 'wave', cyc = (t - 1.2) % 6.2, dd = GD[kd] || 1.4; if (cyc < dd) gestureAt(kd, cyc / dd, cyc, q, gx); }
      c.rig.position.set(0, P_.rigY + br * .004, P_.rigZ); c.torso.rotation.x = q.torso + br * .012; c.rig.rotation.y = gx.ry; c.torso.rotation.y = gx.tw;
      c.lL.th.rotation.x = P_.thL; c.lL.kn.rotation.x = -P_.knL; c.lR.th.rotation.x = P_.thR; c.lR.kn.rotation.x = -P_.knR;
      c.aL.sh.rotation.x = q.arL + br * .01; c.aL.el.rotation.x = q.elL; c.aR.sh.rotation.x = q.arR + br * .01; c.aR.el.rotation.x = q.elR;
      c.head.rotation.x = P_.head + Math.sin(t * .6) * .03 + gx.hx; c.head.rotation.y = Math.sin(t * .45) * .22 + gx.hy; c.head.rotation.z = gx.hz;
      c.veh.group.position.y = Math.sin(t * 41) * .0015; c.veh.fork.rotation.y = Math.sin(t * .45) * .12;
      c.root.rotation.y = Math.PI - .78 + Math.sin(t * .4) * .42; c.root.rotation.x = gx.pitch; c.root.position.y = gx.lift;
    };
    pv.frame = function (t) { pv.t = t; pv.pose(t); const d = (pv.cur ? (pv.cur.veh.keke ? 6.3 : 5.5) : 5.5) * (pv.zoom || 1); const ox = (pv.ox || 0); cam.position.set(-ox, 1.18 * (pv.zoom || 1) + .05, d); cam.lookAt(-ox, .86, 0); r.render(sc, cam); };
    return pv;
  }
  let stillPV = null;
  R.preview = function (id, ch) {
    if (pvCache[id]) return pvCache[id];
    try {
      if (!stillPV) { const cv = document.createElement('canvas'); stillPV = makePV(cv, 300, 300, 1); }
      stillPV.show(ch); stillPV.pose(.9); stillPV.cur.root.rotation.y = Math.PI - .8; stillPV.t = 0;
      const d = stillPV.cur.veh.keke ? 6.1 : 5.3; stillPV.cam.position.set(0, 1.2, d); stillPV.cam.lookAt(0, .8, 0); stillPV.r.render(stillPV.sc, stillPV.cam);
      const url = stillPV.r.domElement.toDataURL('image/png'); pvCache[id] = url; return url;
    } catch (e) { console.warn('preview', e); return null; }
  };
  /* live hero: idle-animated, rim lit. canvas lives in the Characters screen. */
  let heroPV = null, heroRAF = 0, heroOn = false;
  R.hero = {
    show(cv, ch) { try { if (!heroPV) { const rect = cv.getBoundingClientRect(); heroPV = makePV(cv, cv.width, cv.height, 1); heroPV.zoom = .88; heroPV.ox = .8; } if (!heroPV.id || heroPV.id !== ch.look.id) heroPV.show(ch); } catch (e) { console.warn('hero', e); } },
    start() { if (heroOn || !heroPV) return; heroOn = true; const t0 = performance.now(); const loop = () => { if (!heroOn) return; heroPV.frame((performance.now() - t0) / 1000); heroRAF = requestAnimationFrame(loop); }; loop(); },
    stop() { heroOn = false; cancelAnimationFrame(heroRAF); },
    on() { return heroOn; }
  };
  R.playerPos = () => ({ x: 0, y: 0 });
  R.layout = () => {};
  R.stats = () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles, ratio, dpr, textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries });
  /* ---------------------------------------------------------------- feel: camera punch, coin sparkle, shield bubble */
  const SPN = 36, sp = { pts: null, pos: new Float32Array(SPN * 3), col: new Float32Array(SPN * 3), v: new Float32Array(SPN * 3), life: new Float32Array(SPN), age: new Float32Array(SPN).fill(9), n: 0, tint: new Float32Array(SPN * 3) };
  let shieldFx = null;
  R.punch = function () {};   // removed: no FOV / camera punch
  R.sparkle = function (n, rgb, spread) {
    if (!sp.pts || !P) return; const x = (vis.x - 1) * LW, y = (G_ref && G_ref.p ? G_ref.p.y : 0) + .95, c = rgb || [1, .86, .35];
    for (let i = 0; i < (n || 6); i++) { const j = sp.n++ % SPN; sp.age[j] = 0; sp.life[j] = .45 + rnd() * .3; const a = rnd() * 6.283, s2 = (spread || 1) * (1.2 + rnd() * 2.2);
      sp.pos[j * 3] = x + (rnd() - .5) * .3; sp.pos[j * 3 + 1] = y + (rnd() - .5) * .3; sp.pos[j * 3 + 2] = -.5 + (rnd() - .5) * .3;
      sp.v[j * 3] = Math.cos(a) * s2; sp.v[j * 3 + 1] = 1.2 + rnd() * 2.2; sp.v[j * 3 + 2] = Math.sin(a) * s2 * .6 + 1.5; sp.tint[j * 3] = c[0]; sp.tint[j * 3 + 1] = c[1]; sp.tint[j * 3 + 2] = c[2]; }
  };
  const DUST = []; let dustN = 0, dustAcc = 0;
  function dustEmit(x, z, k) {
    dustAcc += 1; if (dustAcc % 2) return;
    if (!DUST.length) for (let i = 0; i < 16; i++) { const m = new T.SpriteMaterial({ map: skyTex('dot'), color: 0xd6c8ac, transparent: true, opacity: 0, depthWrite: false, fog: false }), sp2 = new T.Sprite(m); sp2.visible = false; sp2.renderOrder = 12; scene.add(sp2); DUST.push({ s: sp2, t: 9, life: 1, vx: 0, vy: 0, vz: 0 }); }
    const d = DUST[dustN++ % 16]; d.t = 0; d.life = .8 + rnd() * .5; d.vx = (rnd() - .5) * 3.2; d.vy = .5 + rnd() * .9; d.vz = 1 + rnd() * 2.5; d.s.position.set(x + (rnd() - .5) * .6, .25, z + .3); d.s.scale.setScalar(1.2); d.s.visible = true; d.k = .3 + .5 * k;
  }
  function dustUpdate(dt) { for (const d of DUST) { if (!d.s.visible) continue; d.t += dt; const u = d.t / d.life; if (u >= 1) { d.s.visible = false; continue; } d.s.position.x += d.vx * dt; d.s.position.y += d.vy * dt; d.s.position.z += d.vz * dt; d.vx *= .97; d.s.scale.setScalar(1.2 + u * 3.6); d.s.material.opacity = d.k * (1 - u) * (1 - u); } }
  R.introStart = function (short) { vis.intro = { t: 0, dur: short ? 2.2 : 4.4, sweep: short ? 1.7 : 3.0, r0: short ? .25 : 1.25, dir: rnd() < .5 ? -1 : 1 }; };
  R.introSkip = function () { vis.intro = null; };
  R.introT = function () { return vis.intro ? vis.intro.t : -1; };
  let G_ref = null;
  function fxUpdate(G, dt) {
    G_ref = G; dt = Math.min(dt, .05); dustUpdate(dt); if (vis.intro && !(G.state === 'title' && G.attract)) vis.intro = null;
    vis.punch = (vis.punch || 0) * Math.exp(-dt * 6.5); if (vis.punch < .004) vis.punch = 0;
    if (!sp.pts) { const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(sp.pos, 3)); geo.setAttribute('color', new T.BufferAttribute(sp.col, 3));
      sp.pts = new T.Points(geo, new T.PointsMaterial({ size: 9, sizeAttenuation: false, vertexColors: true, fog: false, transparent: true, depthWrite: false, blending: T.AdditiveBlending, map: skyTex('dot') })); sp.pts.frustumCulled = false; sp.pts.renderOrder = 20; scene.add(sp.pts); }
    let live = 0;
    for (let i = 0; i < SPN; i++) { if (sp.age[i] >= sp.life[i]) { sp.col[i * 3] = sp.col[i * 3 + 1] = sp.col[i * 3 + 2] = 0; continue; } live++; sp.age[i] += dt; const k = 1 - sp.age[i] / sp.life[i];
      sp.v[i * 3 + 1] -= 6 * dt; sp.pos[i * 3] += sp.v[i * 3] * dt; sp.pos[i * 3 + 1] += sp.v[i * 3 + 1] * dt; sp.pos[i * 3 + 2] += sp.v[i * 3 + 2] * dt;
      sp.col[i * 3] = sp.tint[i * 3] * k; sp.col[i * 3 + 1] = sp.tint[i * 3 + 1] * k; sp.col[i * 3 + 2] = sp.tint[i * 3 + 2] * k; }
    sp.pts.visible = live > 0 || sp._wasLive; sp._wasLive = live > 0; if (sp.pts.visible) { sp.pts.geometry.attributes.position.needsUpdate = true; sp.pts.geometry.attributes.color.needsUpdate = true; }
    // shield bubble around the rider (soft, calm blue-white; flickers when about to expire)
    const on = G.shieldT > 0 && !G.attract && P && G.state === 'play';
    if (on && !shieldFx) { shieldFx = new T.Mesh(new T.SphereGeometry(1.25, 18, 12), new T.MeshBasicMaterial({ color: 0x9cc9ef, transparent: true, opacity: .16, depthWrite: false, side: T.DoubleSide, fog: false })); shieldFx.renderOrder = 15; shieldFx.scale.y = 1.15; scene.add(shieldFx); }
    if (shieldFx) { shieldFx.visible = !!on; if (on) { shieldFx.position.set(P.root.position.x, P.root.position.y + .95, P.root.position.z - .1); const lowT = G.shieldT < 3 ? (Math.sin(G.clock * 18) > 0 ? 1 : .35) : 1;
      shieldFx.material.opacity = (.13 + .05 * Math.sin(G.clock * 5)) * lowT; shieldFx.rotation.y = G.clock * .8; } }
  }
  R.frame = function (G, dt) {
    if (!R.ready) return;
    frameId++;
    frameDt = dt; updateEnv(G, dt); updatePlayer(G, dt); updateCamera(G, dt); fxUpdate(G, dt); skyUpdate(G, dt); syncScenery(G); syncSim(G); sweep();
    renderer.render(scene, camera);
    governor(dt);
  };
  global.Render = R;
})(window);
