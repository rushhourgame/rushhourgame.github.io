/* RUSH HOUR (was Signal Lost) — character + vehicle models (v7). Layered outfits on a capsule-limbed body, each rider on a matching bike.
   Everything faces -z (the camera is behind, +z). Returns the same rig the animation code drives, plus a seated 'ride' pose. */
(function (global) {
  'use strict';
  const T = global.THREE; if (!T) return;
  const K = {};
  const PI = Math.PI;
  const std = (c, r, m, o) => new T.MeshStandardMaterial(Object.assign({ color: c, roughness: r == null ? .72 : r, metalness: m || 0 }, o || {}));
  const mesh = (g, m, x, y, z, o) => { const q = new T.Mesh(g, m); q.position.set(x || 0, y || 0, z || 0); q.castShadow = true; if (o) { if (o.s) q.scale.set(o.s[0], o.s[1], o.s[2]); if (o.r) q.rotation.set(o.r[0], o.r[1], o.r[2]); } return q; };
  const B = (w, h, d, m, x, y, z, o) => mesh(new T.BoxGeometry(w, h, d), m, x, y, z, o);
  const C = (rt, rb, h, m, x, y, z, o, seg) => mesh(new T.CylinderGeometry(rt, rb, h, seg || 16), m, x, y, z, o);
  const S = (r, m, x, y, z, o) => mesh(new T.SphereGeometry(r, 18, 14), m, x, y, z, o);
  const CP = (r, len, m, x, y, z, o) => mesh(new T.CapsuleGeometry(r, len, 5, 14), m, x, y, z, o);
  const TR = (R, r, m, x, y, z, o, arc) => mesh(new T.TorusGeometry(R, r, 8, 28, arc || PI * 2), m, x, y, z, o);
  const grp = (...ch) => { const g = new T.Group(); ch.forEach(c => c && g.add(c)); return g; };
  const ctex = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = 4; return t; };
  const hex = n => '#' + ('000000' + n.toString(16)).slice(-6);

  /* ------------------------------------------------------------ fabric textures */
  function ankaraTex(base, a, b, c) {
    return ctex(256, 256, (g, w, h) => {
      g.fillStyle = hex(base); g.fillRect(0, 0, w, h);
      const motif = (x, y, r) => { g.fillStyle = hex(a); g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.fillStyle = hex(base); g.beginPath(); g.arc(x, y, r * .72, 0, 7); g.fill(); g.fillStyle = hex(b); g.beginPath(); g.arc(x, y, r * .5, 0, 7); g.fill(); g.fillStyle = hex(c); g.beginPath(); g.arc(x, y, r * .2, 0, 7); g.fill(); for (let i = 0; i < 8; i++) { const an = i * PI / 4; g.fillStyle = hex(a); g.beginPath(); g.ellipse(x + Math.cos(an) * r * 1.25, y + Math.sin(an) * r * 1.25, r * .2, r * .09, an, 0, 7); g.fill(); } };
      for (const [x, y, r] of [[64, 64, 40], [192, 192, 40], [192, 64, 22], [64, 192, 22], [128, 128, 16]]) motif(x, y, r);
      g.strokeStyle = hex(c); g.lineWidth = 3; for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(0, 20 + i * 64); g.quadraticCurveTo(64, 0 + i * 64, 128, 20 + i * 64); g.quadraticCurveTo(192, 40 + i * 64, 256, 20 + i * 64); g.stroke(); }
    });
  }
  function plaidTex(a, b, c) { return ctex(128, 128, (g, w, h) => { g.fillStyle = hex(a); g.fillRect(0, 0, w, h); g.fillStyle = hex(b); for (let i = 0; i < 4; i++) { g.globalAlpha = .75; g.fillRect(i * 32 + 6, 0, 14, h); g.fillRect(0, i * 32 + 6, w, 14); } g.globalAlpha = 1; g.fillStyle = hex(c); for (let i = 0; i < 4; i++) { g.fillRect(i * 32 + 2, 0, 3, h); g.fillRect(0, i * 32 + 2, w, 3); } }); }
  function stripeTex(a, b, n) { return ctex(64, 64, (g, w, h) => { g.fillStyle = hex(a); g.fillRect(0, 0, w, h); g.fillStyle = hex(b); const s = h / n; for (let i = 0; i < n; i += 2) g.fillRect(0, i * s, w, s); }); }
  function emb(color, bg) { return ctex(128, 256, (g, w, h) => { g.fillStyle = hex(bg); g.fillRect(0, 0, w, h); g.strokeStyle = hex(color); g.lineWidth = 3; for (let y = 20; y < h; y += 44) { g.beginPath(); g.moveTo(14, y); g.bezierCurveTo(w * .3, y - 22, w * .7, y + 22, w - 14, y); g.stroke(); g.beginPath(); g.arc(w / 2, y + 12, 7, 0, 7); g.stroke(); } g.strokeRect(6, 6, w - 12, h - 12); }); }
  function plateTex(txt, bg, fg) { return ctex(128, 64, (g, w, h) => { g.fillStyle = hex(bg); g.fillRect(0, 0, w, h); g.fillStyle = hex(fg); g.font = '700 30px Oswald, Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, w / 2, h / 2 + 2); g.strokeStyle = hex(fg); g.lineWidth = 3; g.strokeRect(3, 3, w - 6, h - 6); }); }
  function logoTex(txt, bg, fg, stripe) { return ctex(256, 128, (g, w, h) => { g.fillStyle = hex(bg); g.fillRect(0, 0, w, h); if (stripe != null) { g.fillStyle = hex(stripe); g.fillRect(0, h * .78, w, h * .1); } g.fillStyle = hex(fg); g.font = '700 58px Oswald, Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, w / 2, h * .42); }); }

  /* ------------------------------------------------------------ two-bone IK in the side (y,z) plane. bend +1: joint forward (knee); -1: joint back (elbow) */
  function ik(L1, L2, hy, hz, ty, tz, bend) {
    const dx = hz - tz, dy = hy - ty; let d = Math.hypot(dx, dy); d = Math.min(d, L1 + L2 - .003); d = Math.max(d, Math.abs(L1 - L2) + .003);
    const A = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d)))), phi = Math.atan2(dx, dy), a = phi + bend * A;
    const sx = dx - L1 * Math.sin(a), sy = dy - L1 * Math.cos(a), s = Math.atan2(sx, sy);
    return { a, rel: s - a };
  }

  /* ------------------------------------------------------------ wheels & shared bike bits */
  function wheel(R, tr, o) {
    o = o || {};
    const rubber = std(o.tire || 0x1a1b1d, .92), alloy = std(o.rim || 0xb9bdc2, .35, .55), dark = std(0x2b2d31, .6, .3);
    const w = new T.Group(); w.userData.R = R;
    w.add(TR(R - tr, tr, rubber, 0, 0, 0, { r: [0, PI / 2, 0], s: [1, 1, o.wide || 1.3] }));
    w.add(C(R * .8, R * .8, .05, alloy, 0, 0, 0, { r: [0, 0, PI / 2] }, 28), C(R * .66, R * .66, .06, dark, 0, 0, 0, { r: [0, 0, PI / 2] }, 28));
    for (let i = 0; i < (o.spokes || 5); i++) { const sp = B(.055, R * 1.4, .03, alloy, 0, 0, 0); const holder = new T.Group(); holder.rotation.x = i * PI / (o.spokes || 5); holder.add(sp); w.add(holder); }
    w.add(C(.045, .045, .12, alloy, 0, 0, 0, { r: [0, 0, PI / 2] }, 12), B(.07, .05, .03, std(0xc9c4b0, .5), 0, R * .72, 0));
    if (o.knob) for (let i = 0; i < 18; i++) { const h = new T.Group(); h.rotation.x = i * PI * 2 / 18; h.add(B(.1, .04, .04, rubber, 0, R + .005, 0)); w.add(h); }
    return w;
  }
  const fender = (R, m, z, y, wd, arc) => TR(R + .035, .018, m, 0, y, z, { r: [0, PI / 2, 0], s: [1, 1, wd || 4] }, arc || PI * .95);
  const plate = (txt) => { const t = B(.26, .13, .012, new T.MeshStandardMaterial({ map: plateTex(txt || 'LAG 247', 0xe8e2c8, 0x1d1d1d), roughness: .6 }), 0, 0, 0); return t; };
  function lamp(r, x, y, z, rot) { const g = new T.Group(); g.add(S(r * 1.05, std(0x2b2d31, .5, .5), 0, 0, 0, { s: [1, 1, .8] })); g.add(S(r * .8, new T.MeshStandardMaterial({ color: 0xf2e6c0, emissive: 0xf2d9a0, emissiveIntensity: .55, roughness: .2 }), 0, 0, -r * .5, { s: [1, 1, .55] })); g.position.set(x, y, z); return g; }
  const tail = (x, y, z, w) => B(w || .14, .06, .04, new T.MeshStandardMaterial({ color: 0xa8302a, emissive: 0x4a0f0c, emissiveIntensity: .8, roughness: .35 }), x, y, z);
  function bars(width, m, grip) { return grp(C(.019, .019, width, m, 0, 0, 0, { r: [0, 0, PI / 2] }, 8), C(.027, .027, .12, grip, width / 2, 0, 0, { r: [0, 0, PI / 2] }, 8), C(.027, .027, .12, grip, -width / 2, 0, 0, { r: [0, 0, PI / 2] }, 8)); }
  function forkLegs(m, chrome, y0, y1, zOff, spread) { const g = new T.Group(); const L = Math.hypot(y1 - y0, zOff); for (const s of [-1, 1]) { const l = C(.02, .024, L, chrome, s * spread, (y0 + y1) / 2, zOff / 2, { r: [Math.atan2(zOff, y1 - y0) * -1 + 0, 0, 0] }, 8); g.add(l); } return g; }

  /* ------------------------------------------------------------ vehicles. Each returns { group, fork, front, rear, wheelsR, pose } where pose = seat/foot/hand targets for the rider IK */
  const V = {};
  function newVeh(R, wb) { return { group: new T.Group(), fork: new T.Group(), front: null, rear: null, R, wb, rearList: [], frontList: [] }; }
  function mountWheels(v, Rf, Rr, o) {
    const zf = -v.wb / 2, zr = v.wb / 2;
    v.front = wheel(Rf, o.tf || .06, o); v.front.position.set(0, Rf - v.fork.position.y, zf - v.fork.position.z); v.fork.add(v.front);
    v.rear = wheel(Rr, o.tr || .07, o); v.rear.position.set(0, Rr, zr); v.group.add(v.rear);
  }
  const rubberM = () => std(0x1c1d20, .9), blackM = () => std(0x1d1f23, .55, .2), chromeM = () => std(0xc5c9cc, .3, .65), seatM = () => std(0x1e1d1d, .8);

  V.cub = function (c) {
    const v = newVeh(.27, 1.16), paint = std(c.col, .38, .25), paint2 = std(c.col2, .5, .1), blk = blackM(), chrome = chromeM(), rub = rubberM();
    v.fork.position.set(0, .95, -.45); const g = v.group, fk = v.fork; g.add(fk);
    mountWheels(v, .27, .27, { rim: 0xc4c6c8 });
    fk.add(forkLegs(paint2, chrome, -.62, -.1, -.1, .09)); fk.add(fender(.27, paint, -.13 - .0 + .0, -.68, 3.4, PI * .9)); fk.children[fk.children.length - 1].position.set(0, -.68 + .0, -.13 - .0);
    const hb = bars(.56, blk, rub); hb.position.set(0, .06, .13); fk.add(hb); fk.add(lamp(.1, 0, -.03, -.1), C(.04, .04, .1, blk, 0, -.02, .04, null, 10));
    fk.add(B(.1, .07, .05, blk, 0, .1, .1), mesh(new T.SphereGeometry(.03, 10, 8), chrome, .26, .08, .0), mesh(new T.SphereGeometry(.03, 10, 8), chrome, -.26, .08, .0));
    // leg shield, floor, engine, seat, rear body
    g.add(B(.46, .56, .05, paint, 0, .66, -.38, { r: [-.22, 0, 0] }), B(.4, .035, .5, blk, 0, .23, -.1), B(.22, .26, .34, std(0x6f7378, .5, .5), 0, .31, .2));
    g.add(B(.31, .09, .66, seatM(), 0, .79, .16), B(.34, .26, .5, paint, 0, .66, .34), B(.3, .05, .4, paint2, 0, .76, .0));
    g.add(fender(.27, paint, .58, .27, 3.6, PI * .95)); const ex = C(.05, .045, .55, chrome, .22, .25, .38, { r: [PI / 2, 0, 0] }, 12); g.add(ex);
    g.add(B(.05, .18, .05, chrome, .2, .32, .1)); const pl = plate(c.plate); pl.position.set(0, .54, .79); pl.rotation.x = .12; g.add(pl); g.add(tail(0, .64, .78, .16));
    // rear rack + delivery top box (the courier look)
    g.add(B(.42, .03, .5, blk, 0, .94, .57), B(.04, .22, .04, blk, .16, .84, .4), B(.04, .22, .04, blk, -.16, .84, .4));
    const box = B(.54, .46, .5, new T.MeshStandardMaterial({ map: logoTex('RUSH', c.box, 0xf1ede2, c.accent), roughness: .55 }), 0, 1.2, .62); g.add(box);
    g.add(B(.56, .06, .52, std(c.box, .55), 0, 1.45, .62), B(.5, .03, .03, std(0xd9d4c0, .35, .4), 0, 1.0, .88));
    v.pose = { hip: [.88, .13], foot: [.24, -.32], hand: [1.1, -.3], lean: .14 }; v.suspend = .012; return v;
  };

  V.keke = function (c) {
    const v = newVeh(.26, 1.4), paint = std(c.col, .42, .2), blk = std(0x17181a, .6, .15), chrome = chromeM(), rub = rubberM(), steel = std(0x2d2f33, .55, .5);
    v.fork.position.set(0, .86, -.62); const g = v.group, fk = v.fork; g.add(fk);
    v.front = wheel(.25, .06, { rim: 0xc4c6c8 }); v.front.position.set(0, .25 - .86, -.08 + -.0); fk.add(v.front); v.wb = 1.36;
    const rearA = wheel(.27, .07, { rim: 0xc4c6c8 }), rearB = wheel(.27, .07, { rim: 0xc4c6c8 }); rearA.position.set(-.5, .27, .5); rearB.position.set(.5, .27, .5); g.add(rearA, rearB); v.rear = rearA; v.rear2 = rearB; v.rearList = [rearA, rearB];
    fk.add(forkLegs(paint, chrome, -.55, -.1, -.08, .0), fender(.25, paint, -.1 + 0, -.6, 3.2, PI * .9)); fk.children[fk.children.length - 1].position.set(0, -.6, -.1);
    const hb = bars(.7, blk, rub); hb.position.set(0, .08, .22); fk.add(hb); fk.add(lamp(.11, 0, -.2, -.14), B(.2, .12, .12, paint, 0, -.1, -.0));
    // body shell: nose, floor, rear tub, bench, open roll hoops (no roof, so the rider stays visible)
    g.add(B(.7, .12, 1.5, paint, 0, .38, .1), B(.8, .5, .12, paint, 0, .58, -.5, { r: [-.3, 0, 0] }), B(.3, .22, .36, paint, 0, .5, -.58));
    g.add(B(1.02, .08, .75, blk, 0, .48, .66), B(1.06, .34, .06, paint, 0, .62, 1.02), B(.06, .34, .75, paint, -.54, .62, .66), B(.06, .34, .75, paint, .54, .62, .66));
    g.add(B(.62, .1, .5, seatM(), 0, .76, .14), B(.62, .38, .1, seatM(), 0, .96, .42, { r: [.1, 0, 0] }), B(.9, .09, .5, std(0x2a2724, .85), 0, .6, .68), B(.9, .34, .09, std(0x2a2724, .85), 0, .8, .94));
    g.add(B(1.07, .045, .06, std(0x202226, .6), 0, .48, 1.05), B(1.1, .08, 1.52, blk, 0, .33, .1));
    g.add(C(.02, .02, .5, steel, -.5, .98, 1.0, null, 8), C(.02, .02, .5, steel, .5, .98, 1.0, null, 8), B(1.04, .04, .05, steel, 0, 1.24, 1.0));
    g.add(B(1.0, .1, .12, std(c.col2, .5), 0, .5, -.5)); g.add(B(1.07, .09, .01, std(c.col2, .5), 0, .55, 1.07));
    const pl = plate(c.plate); pl.position.set(0, .4, 1.09); g.add(pl); g.add(tail(-.4, .62, 1.07, .14), tail(.4, .62, 1.07, .14));
    g.add(B(.05, .5, .05, chrome, .5, .36, 1.0));
    v.pose = { hip: [.9, .1], foot: [.34, -.34], hand: [1.04, -.38], lean: .08 }; v.suspend = .01; v.keke = true; return v;
  };

  V.trail = function (c) {
    const v = newVeh(.33, 1.3), paint = std(c.col, .4, .2), blk = blackM(), chrome = chromeM(), rub = rubberM(), alu = std(0xaeb3b8, .4, .6), org = std(c.accent, .5);
    v.fork.position.set(0, 1.02, -.52); const g = v.group, fk = v.fork; g.add(fk);
    mountWheels(v, .34, .33, { rim: 0x2e3338, knob: true, wide: 1.1, tf: .055, tr: .065, spokes: 8 });
    fk.add(forkLegs(alu, chrome, -.7, -.12, -.2, .08), B(.36, .03, .1, alu, 0, -.1, .0));
    const hb = bars(.78, alu, rub); hb.position.set(0, .12, .2); hb.rotation.x = -.1; fk.add(hb, C(.012, .012, .28, alu, 0, .12, .19, { r: [0, 0, PI / 2] }, 6));
    fk.add(B(.34, .28, .06, paint, 0, .0, -.12, { r: [-.2, 0, 0] }), lamp(.07, 0, -.04, -.17), B(.32, .06, .3, paint, 0, -.5, -.1, { r: [.0, 0, 0] }));
    fk.children[fk.children.length - 1].position.set(0, -.5, -.18);
    // tank, seat, subframe, engine
    g.add(CP(.15, .3, paint, 0, .98, -.18, { s: [1.05, .95, 1], r: [PI / 2, 0, 0] }), B(.34, .09, .7, seatM(), 0, .92, .28), B(.2, .1, .5, paint, 0, .84, .55), B(.28, .34, .4, std(0x35383d, .55, .45), 0, .45, 0));
    g.add(B(.16, .24, .22, alu, 0, .6, -.2), C(.045, .045, .72, chrome, .23, .52, .32, { r: [PI / 2, 0, 0] }, 10), C(.06, .05, .22, alu, .23, .6, .72, { r: [PI / 2, 0, 0] }, 10), B(.04, .5, .04, alu, .22, .7, .22, { r: [.4, 0, 0] }));
    g.add(B(.05, .34, .05, alu, -.1, .72, .72, { r: [.5, 0, 0] }), B(.05, .34, .05, alu, .1, .72, .72, { r: [.5, 0, 0] }), B(.4, .03, .38, blk, 0, .98, .94));
    const sw = B(.04, .46, .04, std(0x232528, .5, .5), .1, .58, .76, { r: [.3, 0, 0] }); g.add(sw);
    g.add(B(.2, .015, .7, org, 0, .88, .5, { r: [0, 0, 0] }));
    const fb = B(.5, .16, .22, std(0x30343a, .6), 0, 1.1, .98); g.add(fb, B(.52, .03, .24, std(c.accent, .5), 0, 1.19, .98));    // tool box
    const pl = plate(c.plate); pl.position.set(0, .86, 1.1); pl.rotation.x = -.35; g.add(pl); g.add(tail(0, .93, 1.1, .12));
    fk.add(fender(.34, org, -.2, -.72, 3, PI * .8)); fk.children[fk.children.length - 1].position.set(0, -.72, -.2);
    v.pose = { hip: [.92, .26], foot: [.34, -.02], hand: [1.14, -.3], lean: .3 }; v.suspend = .016; return v;
  };

  V.vespa = function (c) {
    const v = newVeh(.25, 1.18), paint = std(c.col, .3, .3), paint2 = std(c.col2, .45, .15), blk = blackM(), chrome = chromeM(), rub = rubberM();
    v.fork.position.set(0, .86, -.46); const g = v.group, fk = v.fork; g.add(fk);
    mountWheels(v, .25, .25, { rim: 0xe8e4d6, spokes: 5 });
    fk.add(forkLegs(paint, chrome, -.58, -.1, -.0, .0), fender(.25, paint, -.07, -.6, 3.4, PI * .9)); fk.children[fk.children.length - 1].position.set(0, -.6, -.07);
    const hb = bars(.6, paint, rub); hb.position.set(0, .12, .16); fk.add(hb, mesh(new T.SphereGeometry(.12, 16, 12), paint, 0, .04, -.04, { s: [1.1, .8, 1] }), lamp(.065, 0, .06, -.14), C(.2, .2, .1, paint, 0, .0, .0, { s: [1, 1, 1] }, 20));
    // curved leg shield + floor + bulbous side cowls
    g.add(B(.5, .62, .06, paint, 0, .66, -.38, { r: [-.18, 0, 0] }), B(.44, .04, .56, blk, 0, .22, -.04), CP(.2, .22, paint, 0, .46, .5, { s: [1.2, 1, 1.5], r: [PI / 2, 0, 0] }));
    g.add(mesh(new T.SphereGeometry(.28, 18, 14), paint, .0, .5, .6, { s: [.95, .9, 1.35] }), B(.34, .09, .65, std(c.seat, .7), 0, .78, .2), B(.3, .12, .3, std(c.seat, .7), 0, .86, .5));
    g.add(B(.34, .06, .5, paint2, 0, .74, -.25), fender(.25, paint, .59, .25, 3.6, PI * .95), C(.045, .045, .42, chrome, .24, .22, .72, { r: [PI / 2, 0, 0] }, 10));
    // wicker basket on the front rack + seat back rest
    if (c.basket) { const bsk = B(.38, .22, .28, std(0xb48d58, .9), 0, .2, -.55, { }), br = B(.4, .03, .3, std(0x6e4f2c, .8), 0, .31, -.55); g.add(mesh(new T.BoxGeometry(.4, .22, .3), std(0xb48d58, .9), 0, .88, -.76)); g.add(B(.42, .035, .32, std(0x6b4e2c, .8), 0, .98, -.76)); }
    if (c.crate) { g.add(B(.5, .26, .36, std(c.crate, .75), 0, 1.0, .9), B(.52, .04, .38, std(0xd8cfb4, .6), 0, 1.14, .9), B(.4, .04, .4, blk, 0, .88, .9)); }
    const pl = plate(c.plate); pl.position.set(0, .5, 1.0); pl.rotation.x = .1; g.add(pl); g.add(tail(0, .62, .98, .14));
    v.pose = { hip: [.84, .14], foot: [.24, -.3], hand: [1.06, -.26], lean: .14 }; v.suspend = .01; return v;
  };

  V.sport = function (c) {
    const v = newVeh(.32, 1.34), paint = std(c.col, .25, .3), paint2 = std(c.col2, .35, .2), blk = blackM(), chrome = chromeM(), rub = rubberM(), alu = std(0x9aa1a8, .35, .6);
    v.fork.position.set(0, .98, -.5); const g = v.group, fk = v.fork; g.add(fk);
    mountWheels(v, .32, .335, { rim: 0x24272b, spokes: 5, wide: 1.5, tf: .055, tr: .075 });
    fk.add(forkLegs(alu, chrome, -.66, -.14, -.12, .1), fender(.32, paint2, -.08, -.66, 3.2, PI * .75)); fk.children[fk.children.length - 1].position.set(0, -.66, -.08);
    const hb = bars(.6, blk, rub); hb.position.set(0, .12, .12); hb.rotation.x = -.05; fk.add(hb);
    // fairing: nose, screen, side panels, tail
    fk.add(mesh(new T.SphereGeometry(.2, 18, 12), paint, 0, .02, -.18, { s: [1, 1.0, 1.35] }), B(.32, .18, .05, std(0x9fb3c0, .15, .2, { transparent: true, opacity: .55 }), 0, .2, -.08, { r: [-.9, 0, 0] }), lamp(.07, 0, -.04, -.35));
    g.add(CP(.17, .3, paint, 0, .98, -.12, { s: [1.0, .85, 1], r: [PI / 2, 0, 0] }), B(.3, .06, .6, paint2, 0, .88, .4), B(.28, .08, .5, seatM(), 0, .84, .28), mesh(new T.SphereGeometry(.17, 14, 10), paint, 0, .9, .78, { s: [.9, .7, 2.0] }));
    for (const s of [-1, 1]) g.add(B(.04, .46, .8, paint, s * .17, .6, -.12, { r: [0, 0, s * .1] }), B(.03, .2, .5, paint2, s * .19, .72, -.2));
    g.add(B(.26, .36, .46, std(0x3b4046, .5, .5), 0, .46, .02), B(.5, .03, .1, alu, 0, .34, .62), C(.05, .042, .62, chrome, .2, .4, .74, { r: [PI / 2 - .1, 0, 0] }, 12));
    g.add(B(.05, .5, .05, alu, -.12, .5, .66, { r: [.9, 0, 0] }), B(.05, .5, .05, alu, .12, .5, .66, { r: [.9, 0, 0] }));
    const pl = plate(c.plate); pl.position.set(0, .66, 1.07); pl.rotation.x = -.6; g.add(pl); g.add(tail(0, .82, 1.05, .16));
    v.pose = { hip: [.84, .22], foot: [.34, .02], hand: [.98, -.5], lean: .78 }; v.suspend = .008; v.sport = true; return v;
  };

  V.cruiser = function (c) {
    const v = newVeh(.34, 1.62), paint = std(c.col, .25, .35), paint2 = std(c.col2, .3, .5), blk = std(0x181a1d, .5, .25), chrome = std(0xdadde0, .22, .8), rub = rubberM();
    const chop = !!c.chop; v.fork.position.set(0, 1.04, -.74); const g = v.group, fk = v.fork; g.add(fk); v.wb = chop ? 1.9 : 1.6;
    mountWheels(v, .34, .35, { rim: 0xd8dbdd, spokes: 8, wide: 1.6, tf: .07, tr: .085 });
    fk.add(forkLegs(chrome, chrome, -.7, -.12, chop ? -.46 : -.26, .1)); fk.rotation.x = 0;
    const hb = bars(.66, chrome, rub); hb.position.set(0, chop ? .22 : .12, chop ? .12 : .22); if (chop) { hb.rotation.x = .2; } fk.add(hb);
    fk.add(lamp(.1, 0, -.1, -.14), B(.28, .04, .28, paint, 0, -.58, chop ? -.34 : -.2));
    fk.children[fk.children.length - 1].position.set(0, -.58, chop ? -.46 : -.26);
    fk.add(fender(.34, paint, chop ? -.46 : -.26, -.7, 3.0, PI * .8)); fk.children[fk.children.length - 1].position.set(0, -.7, chop ? -.46 : -.26);
    g.add(CP(.17, .26, paint, 0, .98, -.32, { s: [1.05, .9, 1], r: [PI / 2, 0, 0] }), B(.3, .1, .9, seatM(), 0, .78, .25), B(.3, .26, .1, seatM(), 0, .96, .8, { r: [.2, 0, 0] }), mesh(new T.SphereGeometry(.34, 18, 14), std(0x2b2e33, .5, .4), 0, .5, .02, { s: [.55, .8, 1.0] }));
    g.add(fender(.35, paint, .82, .35, 3.9, PI * .98), C(.06, .055, 1.0, chrome, .24, .35, .62, { r: [PI / 2, 0, 0] }, 14), C(.06, .055, 1.0, chrome, .3, .3, .62, { r: [PI / 2, 0, 0] }, 14), B(.1, .1, .1, chrome, .2, .5, .0));
    for (const s of [-1, 1]) g.add(B(.2, .3, .6, std(c.bags || 0x2a2724, .75), s * .38, .62, .76), B(.21, .04, .6, std(0xc8a24c, .35, .6), s * .38, .78, .76));
    if (chop) { g.add(B(.05, .84, .06, chrome, 0, 1.18, .9, { r: [-.1, 0, 0] }), B(.36, .36, .04, blk, 0, 1.4, .98)); g.add(B(.3, .1, .02, std(c.col2, .5), 0, 1.5, .96)); }
    g.add(B(.22, .22, .22, blk, 0, .36, .35, { }), TR(.25, .014, chrome, .0, .85, .8, { r: [0, PI / 2, 0] }, PI));
    const pl = plate(c.plate); pl.position.set(0, .56, 1.12); g.add(pl); g.add(tail(0, .7, 1.1, .16));
    v.pose = chop ? { hip: [.74, .3], foot: [.34, -.7], hand: [1.22, -.46], lean: .02 } : { hip: [.8, .22], foot: [.3, -.5], hand: [1.1, -.36], lean: .12 };
    v.suspend = .01; v.cruiser = true; return v;
  };

  V.naked = function (c) {
    const v = newVeh(.31, 1.3), paint = std(c.col, c.matte ? .8 : .3, c.matte ? 0 : .3), paint2 = std(c.col2, c.matte ? .8 : .4, .1), blk = blackM(), chrome = chromeM(), rub = rubberM(), alu = std(c.matte ? 0x22252a : 0x9ea4aa, .45, .55);
    v.fork.position.set(0, .98, -.5); const g = v.group, fk = v.fork; g.add(fk);
    mountWheels(v, .31, .32, { rim: c.matte ? 0x1c1e22 : 0xb7bbc0, spokes: 5, wide: 1.3 });
    fk.add(forkLegs(c.matte ? blk : chrome, chrome, -.66, -.12, -.12, .09), fender(.31, paint2, -.08, -.66, 3.2, PI * .8)); fk.children[fk.children.length - 1].position.set(0, -.66, -.08);
    const hb = bars(.7, blk, rub); hb.position.set(0, .1, .14); fk.add(hb, lamp(.085, 0, -.03, -.16), C(.04, .04, .22, blk, 0, 0, .0, null, 10));
    g.add(CP(.16, .28, paint, 0, .96, -.12, { s: [1.0, .9, 1], r: [PI / 2, 0, 0] }), B(.32, .09, .74, seatM(), 0, .84, .33), B(.2, .08, .52, paint2, 0, .88, .74, { r: [.1, 0, 0] }), B(.3, .4, .44, std(0x2e3238, .5, .5), 0, .45, .05));
    g.add(B(.2, .24, .2, alu, 0, .62, -.1), C(.05, .045, .74, c.matte ? blk : chrome, .21, .42, .38, { r: [PI / 2 - .12, 0, 0] }, 12), C(.065, .055, .24, c.matte ? std(0x55575c, .4, .7) : chrome, .22, .5, .8, { r: [PI / 2 - .12, 0, 0] }, 12));
    g.add(B(.05, .46, .05, alu, -.12, .55, .62, { r: [.7, 0, 0] }), B(.05, .46, .05, alu, .12, .55, .62, { r: [.7, 0, 0] }), fender(.32, paint2, .64, .32, 3.4, PI * .9));
    if (c.rack) g.add(B(.38, .03, .44, blk, 0, .98, .9), B(.04, .2, .04, blk, .15, .88, .78), B(.04, .2, .04, blk, -.15, .88, .78), B(.34, .2, .26, std(c.rack, .8), 0, 1.1, .92), B(.36, .03, .28, std(0xe2dcc4, .6), 0, 1.21, .92));
    const pl = plate(c.plate); pl.position.set(0, .64, 1.0); pl.rotation.x = -.25; g.add(pl); g.add(tail(0, .83, .98, .12));
    v.pose = { hip: [.86, .16], foot: [.32, -.1], hand: [1.1, -.36], lean: .34 }; v.suspend = .014; return v;
  };

  /* ------------------------------------------------------------ the rider body (capsule limbs, tapered torso) */
  function body(L) {
    const skinM = std(L.skin, .55), eyeM = std(0x16110e, .3), white = std(0xf1ece2, .4), lipM = std(L.lip || 0x5a2e24, .6);
    const root = new T.Group(), rig = new T.Group(); root.add(rig); rig.position.y = .88;
    const torso = new T.Group(); rig.add(torso);
    const pantsM = L.pantsTex ? new T.MeshStandardMaterial({ map: L.pantsTex, roughness: .8 }) : std(L.pants, .85);
    const shirtM = L.shirtTex ? new T.MeshStandardMaterial({ map: L.shirtTex, roughness: .8 }) : std(L.shirt, .78);
    const k = { root, rig, torso, skinM, pantsM, shirtM, L, eyeM, white, lipM, std, B, C, S, CP, TR, grp, mesh, hex, ctex };
    // chest/abdomen (inner shirt), neck, shoulder caps
    const bw = L.bulk || 1;
    torso.add(CP(.152, .27, shirtM, 0, .46, 0, { s: [1.45 * bw, 1, .92 * bw] }), CP(.138, .12, shirtM, 0, .06, 0, { s: [1.38 * bw, 1, .9 * bw] }));
    torso.add(C(.05, .058, .14, skinM, 0, .79, 0, null, 12));
    const head = new T.Group(); head.position.set(0, .93, 0); torso.add(head);
    head.add(S(.105, skinM, 0, 0, 0, { s: [.93, 1.07, 1.0] }), S(.082, skinM, 0, -.058, -.018, { s: [.98, .95, .95] }));
    for (const s of [-1, 1]) head.add(S(.022, skinM, s * .097, -.004, .005, { s: [.5, 1.1, .8] }), S(.012, eyeM, s * .042, .02, -.097, { s: [1.2, .8, .6] }), S(.0125, white, s * .042, .02, -.0935, { s: [1.6, .8, .4] }));
    for (const s of [-1, 1]) head.add(S(.0095, eyeM, s * .042, .02, -.1, { s: [1, 1, .6] }));
    head.add(S(.02, skinM, 0, -.014, -.102, { s: [.85, 1.3, 1] }), B(.04, .006, .008, lipM, 0, -.062, -.095));
    const hairM = std(L.hair != null ? L.hair : 0x15120f, .85); k.hairM = hairM; k.head = head;
    for (const s of [-1, 1]) head.add(B(.042, .008, .01, hairM, s * .044, .047, -.098, { r: [0, 0, s * -.12] }));
    const hs = L.hairStyle || 'short';
    if (hs === 'short') head.add(S(.109, hairM, 0, .02, .016, { s: [.96, .95, 1.0] }));
    else if (hs === 'afro') head.add(S(.15, hairM, 0, .045, .04, { s: [1.04, .98, 1.0] }));
    else if (hs === 'puff') { head.add(S(.108, hairM, 0, .018, .016, { s: [.96, .94, 1.0] }), S(.075, hairM, 0, .13, .075)); }
    else if (hs === 'wrap') head.add(S(.107, hairM, 0, .016, .014, { s: [.96, .92, 1.0] }));
    // arms
    const arm = s => {
      const sh = new T.Group(); sh.position.set(s * .255 * bw, .64, 0); torso.add(sh);
      sh.add(S(.068, L.sleeveShoulder ? L.sleeveShoulder : skinM, 0, 0, 0), CP(.052, .17, skinM, 0, -.15, 0));
      const el = new T.Group(); el.position.y = -.3; sh.add(el);
      el.add(S(.048, skinM, 0, 0, 0), CP(.045, .17, skinM, 0, -.14, 0));
      const hand = S(.052, L.glovesM || skinM, 0, -.295, 0, { s: [1, 1.05, 1.1] }); el.add(hand);
      return { sh, el, hand };
    };
    const aL = arm(-1), aR = arm(1);
    // legs
    const leg = s => {
      const th = new T.Group(); th.position.set(s * .105 * bw, 0, 0); rig.add(th);
      th.add(CP(.088, .3, L.shorts ? skinM : pantsM, 0, -.235, 0, { s: [1, 1, 1.0] }));
      const kn = new T.Group(); kn.position.y = -.47; th.add(kn);
      kn.add(S(.066, L.shorts ? skinM : pantsM, 0, 0, 0), CP(.064, .28, L.shorts ? skinM : pantsM, 0, -.22, 0, { s: [1, 1, 1.05] }));
      const foot = new T.Group(); foot.position.y = -.455; kn.add(foot);
      return { th, kn, foot };
    };
    const lL = leg(-1), lR = leg(1);
    Object.assign(k, { aL, aR, lL, lR });
    return k;
  }

  /* shoes: sneaker / boot / loafer / work */
  function shoes(k, kind, col, sole, accent) {
    const shoeM = std(col, kind === 'sneaker' ? .55 : .5, 0), soleM = std(sole != null ? sole : 0x23211f, .85), accM = std(accent != null ? accent : col, .5);
    for (const l of [k.lL, k.lR]) {
      const f = l.foot;
      f.add(CP(.062, .1, shoeM, 0, -.05, -.05, { s: [.92, .82, 1], r: [PI / 2, 0, 0] }), B(.118, .028, .31, soleM, 0, -.098, -.05));
      if (kind === 'sneaker') { f.add(B(.12, .02, .3, std(0xe9e6dc, .6), 0, -.082, -.05), B(.02, .045, .13, accM, .06, -.045, -.04), B(.02, .045, .13, accM, -.06, -.045, -.04), C(.058, .062, .04, shoeM, 0, .0, .0, null, 10)); }
      else if (kind === 'boot' || kind === 'work') { f.add(C(.066, .072, .2, shoeM, 0, .06, .0, null, 12), B(.12, .035, .1, soleM, 0, -.088, .02)); if (kind === 'work') f.add(C(.074, .074, .03, accM, 0, .1, 0, null, 12)); }
      else f.add(C(.058, .062, .05, shoeM, 0, .0, .0, null, 10), B(.06, .01, .1, accM, 0, -.012, -.1));
    }
  }
  const sleeves = (k, mat, o) => {
    o = o || {};
    for (const a of [k.aL, k.aR]) {
      a.sh.add(CP(.066, .17, mat, 0, -.15, 0), S(.075, mat, 0, 0, 0));
      if (!o.short) { a.el.add(CP(.056, .17, mat, 0, -.14, 0), S(.056, mat, 0, 0, 0)); if (o.cuff) a.el.add(C(.058, .058, .045, o.cuff, 0, -.255, 0, null, 12)); }
    }
  };
  /* torso shell: jacket / coat / vest body. grow = thickness, drop = how far below the waist it hangs */
  const shell = (k, mat, grow, drop, o) => {
    o = o || {}; const bw = k.L.bulk || 1; const g = new T.Group();
    g.add(CP(.152 + grow, .27, mat, 0, .46, 0, { s: [1.45 * bw, 1, .92 * bw] }), CP(.138 + grow, .12 + (drop || 0), mat, 0, .06 - (drop || 0) / 2, 0, { s: [1.38 * bw, 1, .9 * bw] }));
    k.torso.add(g); return g;
  };
  const collar = (k, mat, y) => { const t = TR(.085, .03, mat, 0, y || .78, .0, { r: [PI / 2, 0, 0], s: [1, 1, .8] }); k.torso.add(t); return t; };
  const bandT = (k, mat, y, w, grow) => k.torso.add(CP(.152 + (grow || .012), .015, mat, 0, y, 0, { s: [1.45 * (k.L.bulk || 1) * (w || 1), 1, .92 * (k.L.bulk || 1) * (w || 1)] }));
  const shades = (k, m, round) => { const h = k.head; const frame = m || std(0x111214, .3, .3), lens = std(0x15171a, .12, .4); for (const s of [-1, 1]) { h.add(B(.07, .04, .014, lens, s * .046, .02, -.104, { r: [0, s * .12, 0] })); } h.add(B(.02, .008, .012, frame, 0, .028, -.106), B(.2, .008, .01, frame, 0, .04, -.098)); for (const s of [-1, 1]) h.add(B(.008, .008, .09, frame, s * .102, .035, -.06)); };
  const watch = (k, m, face) => { const w = C(.05, .05, .025, m, 0, -.26, 0, null, 14); k.aL.el.add(w, C(.047, .047, .004, face || std(0x121214, .3), 0, -.26, 0, null, 14)); };
  const chain = (k, m, drop) => { const t = TR(.115, .01, m, 0, .66, -.04, { r: [PI / 2 - .5, 0, 0], s: [1.2, 1.1, 1] }); k.torso.add(t); k.torso.add(S(.025, m, 0, .5, -.145)); };
  const earring = (k, m, big) => { for (const s of [-1, 1]) { const e = TR(big ? .035 : .018, .005, m, s * .102, -.03, .005, { r: [0, PI / 2, 0] }); k.head.add(e); } };
  const cap = (k, m, brimM, back) => { const h = k.head; h.add(mesh(new T.SphereGeometry(.118, 18, 12, 0, PI * 2, 0, PI / 2), m, 0, .03, .014, { s: [1.02, 1.0, 1.06] }), C(.118, .118, .02, m, 0, .03, .015, { s: [1.02, 1, 1.06] }, 18)); const br = B(.16, .014, .12, brimM || m, 0, .03, -.15, { r: [-.06, 0, 0] }); if (back) { br.position.z = .15; } h.add(br); h.add(S(.012, brimM || m, 0, .13, .014)); };
  const helmetOpen = (k, shell_, visor) => { const h = k.head; h.add(mesh(new T.SphereGeometry(.14, 20, 14, 0, PI * 2, 0, PI * .62), shell_, 0, .022, .02, { s: [1.0, 1.05, 1.12] }), C(.14, .15, .035, std(0x1c1d20, .6), 0, -.026, .022, { s: [1, 1, 1.1] }, 18)); h.add(B(.2, .075, .09, visor, 0, .065, -.115, { r: [-.2, 0, 0] }), B(.012, .1, .09, std(0xc9573a, .5), 0, .15, .02)); };

  /* ------------------------------------------------------------ the ten characters */
  const D = {};
  D.courier = (k) => {
    const L = k.L; const grey = std(0x777b82, .9), greyD = std(0x5b5f66, .9), orange = std(0xd1692c, .7), refl = std(0xd9dcdc, .3, .5), cargo = std(0x23262b, .85);
    k.hairM.color.set(0x16120f);
    // grey hoodie (hood DOWN, bunched behind the neck), cuffs, kangaroo pocket
    shell(k, grey, .012, .05); sleeves(k, grey, { cuff: greyD });
    const hood = TR(.105, .045, greyD, 0, .76, .05, { r: [PI / 2 - .25, 0, 0], s: [1.2, 1, 1] }); k.torso.add(hood); k.torso.add(S(.07, greyD, 0, .76, .1, { s: [1.5, 1, 1.0] }));
    k.torso.add(B(.2, .08, .02, greyD, 0, .22, -.146), B(.008, .22, .01, std(0xe6e2d6, .6), -.03, .66, -.152), B(.008, .22, .01, std(0xe6e2d6, .6), .03, .66, -.152));
    // hi-vis safety vest with reflective bands (front and back)
    const vest = shell(k, orange, .03, -.02); bandT(k, refl, .5, 1, .045); bandT(k, refl, .28, 1, .042); for (const s of [-1, 1]) k.torso.add(B(.05, .5, .01, refl, s * .1, .46, .148, { }), B(.05, .3, .01, refl, s * .1, .5, -.148));
    k.torso.add(B(.14, .12, .02, std(0x1a1c1f, .8), -.1, .48, -.158)); // chest pocket
    // cargo trousers, knee pocket
    for (const l of [k.lL, k.lR]) l.th.add(B(.1, .12, .03, cargo, 0, -.2, -.088));
    shoes(k, 'sneaker', 0xf0eee6, 0xdcd8cc, 0xd1692c);
    cap(k, std(0x2c2f34, .8), std(0x2c2f34, .8)); k.head.add(B(.07, .035, .01, std(0xd1692c, .6), 0, .1, -.112, { r: [-.5, 0, 0] }));
    for (const s of [-1, 1]) k.head.add(S(.012, std(0xf4f2ec, .4), s * .1, -.018, .0));
    k.head.add(S(.109, k.hairM, 0, .0, .028, { s: [.96, .9, .98] }));
    watch(k, std(0x2c2e31, .4, .4));
    // rider's dispatch bag on the back (small crossbody)
    k.torso.add(B(.34, .26, .1, std(0x23262b, .85), 0, .3, .17), B(.3, .02, .11, orange, 0, .38, .17));
    k.glovesCol = null;
  };
  D.danfo = (k) => {
    const yel = std(0xc9a22c, .65), blk = std(0x1c1c1e, .75), khaki = std(0x8d7e5c, .85);
    shell(k, yel, .016, .08); sleeves(k, yel, { cuff: blk }); collar(k, blk, .79);
    // black danfo stripe bands across the jacket + number on the back
    bandT(k, blk, .44, 1, .028); bandT(k, blk, .36, 1, .028);
    k.torso.add(B(.2, .12, .01, std(0xe6d7a0, .6), 0, .56, .16), B(.14, .06, .012, blk, 0, .56, .165), B(.008, .5, .01, blk, 0, .4, -.15));
    // conductor's cash satchel and strap
    k.torso.add(B(.32, .22, .12, std(0x5b3a22, .6), .0, .12, .17), B(.06, .02, .12, std(0x3a2616, .6), 0, .26, .17), B(.05, .55, .012, std(0x3a2616, .6), .08, .5, .11, { r: [0, 0, .5] }), B(.05, .55, .012, std(0x3a2616, .6), .08, .5, -.11, { r: [0, 0, .5] }));
    for (const l of [k.lL, k.lR]) { l.th.add(B(.012, .38, .02, std(0xb8a77d, .7), .0, -.2, -.09)); }
    shoes(k, 'sneaker', 0x3a3a3c, 0xe2ded2, 0xc9a22c);
    // newsboy cap
    const h = k.head; h.add(mesh(new T.SphereGeometry(.125, 18, 12, 0, PI * 2, 0, PI * .52), blk, 0, .03, .014, { s: [1.04, .7, 1.12] }), B(.17, .016, .1, blk, 0, .042, -.14, { r: [-.08, 0, 0] }), C(.118, .118, .03, blk, 0, .02, .015, { s: [1.02, 1, 1.06] }, 16), S(.012, std(0xc9a22c, .5), 0, .105, .0));
    h.add(S(.108, k.hairM, 0, .0, .025, { s: [.95, .85, .98] }));
    watch(k, std(0xc9a22c, .3, .8)); k.head.add(B(.05, .012, .01, std(0x3a3a3c, .7), .0, -.08, -.095));
    D._beardLite(k, 1);
  };
  D._beardLite = (k, a) => { k.head.add(S(.08, k.hairM, 0, -.06, -.02, { s: [1.0, .62, .9] }), B(.06, .008, .01, k.lipM, 0, -.062, -.1)); };
  D.sparks = (k) => {
    const nav = std(0x28435f, .85), yel = std(0xd0a526, .5), refl = std(0xcdd1d3, .3, .5), tan = std(0x5b4630, .8), leather = std(0x6b4a2e, .7);
    k.glovesM = std(0x3b3f45, .7);
    shell(k, nav, .016, .03); sleeves(k, nav, { cuff: yel }); collar(k, nav, .79);
    bandT(k, yel, .5, 1, .028); bandT(k, refl, .46, 1, .029); bandT(k, yel, .26, 1, .028);
    k.aL.el.add(C(.058, .058, .035, refl, 0, -.1, 0, null, 12)); k.aR.el.add(C(.058, .058, .035, refl, 0, -.1, 0, null, 12));
    // tool belt with pouches and a spanner on the hip
    const belt = bandT(k, leather, .03, 1, .03); k.torso.add(B(.1, .12, .06, leather, .17, .0, -.1), B(.1, .12, .06, leather, -.17, .0, -.1), B(.03, .24, .02, std(0x9ca3a8, .35, .7), .22, -.1, -.02, { r: [0, 0, .1] }), B(.16, .13, .07, leather, 0, .0, .15));
    for (const l of [k.lL, k.lR]) { l.th.add(B(.11, .1, .035, nav, 0, -.2, -.095)); }
    shoes(k, 'work', 0x5a3f27, 0x24201c, 0xd0a526);
    cap(k, std(0x3a4047, .8), std(0x3a4047, .8)); // goggles resting on the cap
    const gg = k.head; gg.add(TR(.12, .014, std(0x23262a, .7), 0, .085, -.01, { r: [PI / 2 - .35, 0, 0], s: [1, 1, 1] }), S(.03, std(0x9fc2d6, .12, .4, { transparent: true, opacity: .7 }), .05, .11, -.1, { s: [1.2, 1, .5] }), S(.03, std(0x9fc2d6, .12, .4, { transparent: true, opacity: .7 }), -.05, .11, -.1, { s: [1.2, 1, .5] }));
    k.head.add(S(.108, k.hairM, 0, .0, .028, { s: [.96, .9, .98] }));
    k.torso.add(B(.12, .1, .01, std(0xe1ddcf, .6), .1, .58, -.152), B(.1, .02, .012, yel, .1, .58, -.158));
    // bolt patch on the back
    k.torso.add(B(.22, .24, .01, std(0x1e2f43, .7), 0, .46, .17), B(.12, .02, .012, yel, 0, .5, .176), B(.06, .12, .012, yel, 0, .44, .176, { r: [0, 0, .5] }));
  };
  D.ankara = (k) => {
    const ank = ankaraTex(0x1f6b66, 0xc9a24a, 0x8e2f4a, 0xf1e6c8);
    const printM = new T.MeshStandardMaterial({ map: ank, roughness: .75 }), gold = std(0xd0aa4d, .3, .8), tealD = std(0x174f4b, .8), gele = std(0x8e2f4a, .55), geleB = std(0xc9a24a, .5, .2);
    // fitted ankara blouse (print) with peplum, ankara wide trousers
    const blouse = shell(k, printM, .014, .05); sleeves(k, printM, { short: false, cuff: gold }); collar(k, tealD, .79);
    const tex2 = ankaraTex(0x8e2f4a, 0xc9a24a, 0x1f6b66, 0xf1e6c8); tex2.repeat.set(1.5, 1.5);
    for (const l of [k.lL, k.lR]) { l.th.add(CP(.115, .3, new T.MeshStandardMaterial({ map: tex2, roughness: .8 }), 0, -.235, 0)); l.kn.add(CP(.1, .27, new T.MeshStandardMaterial({ map: tex2, roughness: .8 }), 0, -.2, 0)); }
    k.torso.add(C(.158, .175, .08, gold, 0, .02, 0, { s: [1.38, 1, .92] }, 18));
    shoes(k, 'loafer', 0xc9a24a, 0x2b2118, 0x8e2f4a);
    // gele: a big folded head-tie with a flourish
    const h = k.head; h.add(S(.108, k.hairM, 0, .0, .02, { s: [.95, .88, 1] }));
    h.add(C(.125, .13, .07, gele, 0, .08, .01, null, 18), C(.1, .125, .09, geleB, 0, .15, .0, null, 18), C(.08, .1, .1, gele, 0, .23, -.01, { r: [0, 0, .2] }, 16), S(.075, gele, .15, .17, .0, { s: [1.0, 1.1, 1.0] }), S(.06, geleB, .17, .22, .02), S(.055, gele, -.11, .2, .02));
    earring(k, gold, true); k.head.add(B(.05, .01, .01, std(0x9a2a3e, .4), 0, -.062, -.097));
    // crossbody bag
    k.torso.add(B(.05, .56, .01, std(0x7a4b22, .7), .08, .42, -.146, { r: [0, 0, .75] }), B(.05, .56, .01, std(0x7a4b22, .7), .08, .42, .146, { r: [0, 0, .75] }), B(.24, .18, .1, std(0x7a4b22, .65), -.2, .06, .0));
    k.torso.add(B(.2, .2, .012, std(0x8e2f4a, .6), 0, .44, .164), S(.05, gold, 0, .44, .172, { s: [1, 1, .3] }));
    for (const a of [k.aL, k.aR]) a.el.add(TR(.05, .007, gold, 0, -.24, 0, { r: [PI / 2, 0, 0] }));
  };
  D.bolt = (k) => {
    const blk = std(0x1b1d21, .5), wht = std(0xeeebe2, .5), grn = std(0x2d8a5a, .55), lyc = std(0x15171a, .45);
    k.glovesM = std(0x1b1d21, .55);
    const shirtStripe = std(0x2a2d33, .6);
    shell(k, blk, .014, .06); sleeves(k, blk, { cuff: wht }); collar(k, wht, .79);
    // track jacket: side stripes in white + green, zip, chest panel
    for (const s of [-1, 1]) { k.torso.add(B(.022, .62, .27, wht, s * .222, .4, 0, { r: [0, 0, 0] })); k.torso.add(B(.012, .62, .27, grn, s * .244, .4, 0)); k.aL.sh.add(B(.012, .3, .05, wht, s * .0 - .068, -.15, 0), B(.012, .3, .02, grn, -.073, -.15, 0)); k.aR.sh.add(B(.012, .3, .05, wht, .068, -.15, 0), B(.012, .3, .02, grn, .073, -.15, 0)); }
    k.torso.add(B(.2, .014, .012, wht, 0, .78, -.146), B(.01, .6, .012, wht, 0, .42, -.15), B(.2, .1, .012, grn, 0, .6, .16), B(.2, .05, .012, wht, 0, .52, .16));
    for (const l of [k.lL, k.lR]) { l.th.add(CP(.09, .3, lyc, 0, -.235, 0), B(.012, .46, .04, grn, 0, -.23, -.09)); l.kn.add(CP(.066, .26, lyc, 0, -.2, 0)); }
    shoes(k, 'sneaker', 0xf3f1ea, 0xe9e5da, 0x2d8a5a);
    // headband + short fade + sport shades
    const h = k.head; h.add(S(.108, k.hairM, 0, .02, .016, { s: [.96, .92, 1.0] }), TR(.112, .018, wht, 0, .045, .0, { r: [PI / 2 - .05, 0, 0] }));
    shades(k, std(0xe8e5dc, .4)); k.head.add(B(.04, .006, .008, k.lipM, 0, -.062, -.095));
    watch(k, std(0x1b1d21, .4, .4), std(0x2d8a5a, .4));
    k.aL.el.add(TR(.05, .01, wht, 0, -.12, 0, { r: [PI / 2, 0, 0] }));
  };
  D.sultan = (k) => {
    const cream = std(0xefe8d4, .85), creamD = std(0xd9cfb2, .85), gold = std(0xc6a24b, .35, .75), red = std(0x7a2c25, .8), wineT = emb(0xc6a24b, 0xefe8d4);
    // babariga: long white tunic with gold embroidery, trousers, flared hem over the seat
    shell(k, cream, .018, .08); sleeves(k, cream, { cuff: gold });
    const panel = new T.MeshStandardMaterial({ map: wineT, roughness: .6 }); k.torso.add(B(.2, .56, .01, panel, 0, .3, -.168), B(.01, .9, .01, gold, 0, .22, -.17));
    k.torso.add(C(.22, .3, .55, cream, 0, -.2, .02, { s: [1.18, 1, .85] }, 24), TR(.27, .014, gold, 0, -.46, .02, { r: [PI / 2, 0, 0], s: [1.25, .9, 1] }), B(.34, .36, .01, new T.MeshStandardMaterial({ map: emb(0xc6a24b, 0xefe8d4), roughness: .6 }), 0, .46, .172));
    collar(k, gold, .78);
    for (const l of [k.lL, k.lR]) { l.th.add(CP(.1, .3, cream, 0, -.235, 0)); l.kn.add(CP(.074, .26, cream, 0, -.2, 0)); }
    shoes(k, 'loafer', 0x5a4028, 0x2b2118, 0xc6a24b);
    // red + gold fila cap, full beard, prayer beads, gold watch
    const h = k.head; h.add(S(.106, k.hairM, 0, .0, .02, { s: [.95, .9, 1] }));
    h.add(C(.14, .108, .15, red, 0, .11, 0, null, 20), C(.14, .14, .015, std(0xc6a24b, .4, .6), 0, .185, 0, null, 20), C(.109, .11, .035, std(0xc6a24b, .4, .6), 0, .045, 0, null, 20));
    h.add(S(.088, k.hairM, 0, -.07, -.03, { s: [1.0, .85, .9] }), B(.05, .006, .008, k.lipM, 0, -.068, -.105));
    k.hairM.color.set(0x2a2522);
    const bead = std(0x4a2f1c, .5); const beads = TR(.1, .012, bead, 0, .68, -.02, { r: [PI / 2 - .55, 0, 0], s: [1.25, 1.1, 1] }); k.torso.add(beads, S(.03, std(0xc6a24b, .3, .7), 0, .55, -.16));
    watch(k, gold, std(0xe8e5dc, .3));
    k.torso.add(B(.34, .4, .01, std(0xefe8d4, .85), 0, .1, .19), B(.3, .02, .012, gold, 0, -.08, .195));
  };
  D.agbero = (k) => {
    const leather = std(0x241f1c, .45, .15), plaidM = new T.MeshStandardMaterial({ map: plaidTex(0x7d2a2a, 0x1e1e22, 0xc9b27a), roughness: .85 }), denim = std(0x3a4a62, .85), gold = std(0xd0aa4d, .3, .85), bandana = std(0xa8302a, .7);
    k.hairM.color.set(0x15120f);
    // plaid shirt open under a heavy leather jacket
    const sh = shell(k, plaidM, .0, .06); const jk = shell(k, leather, .03, .08); sleeves(k, leather, { cuff: std(0x1c1816, .6) }); collar(k, leather, .79);
    k.torso.add(B(.1, .5, .012, plaidM, 0, .46, -.162), B(.012, .5, .012, std(0x15120f, .6), -.052, .46, -.168, { r: [0, 0, .06] }), B(.012, .5, .012, std(0x15120f, .6), .052, .46, -.168, { r: [0, 0, -.06] }));
    for (const s of [-1, 1]) k.torso.add(B(.16, .03, .06, leather, s * .09, .78, -.1, { r: [0, s * .4, 0] }), B(.06, .22, .012, std(0x1a1614, .6), s * .15, .5, -.168), B(.04, .02, .03, gold, s * .2, .6, -.155));
    // back: a big crest patch + studs
    k.torso.add(B(.32, .3, .012, std(0x15110f, .6), 0, .46, .178), B(.24, .03, .014, gold, 0, .55, .184), B(.16, .12, .014, std(0xa8302a, .6), 0, .43, .184), S(.04, gold, 0, .43, .188, { s: [1, 1, .3] }));
    for (let i = -2; i <= 2; i++) k.torso.add(S(.01, gold, i * .06, .6, .182));
    chain(k, gold); chain(k, gold);
    for (const l of [k.lL, k.lR]) { l.th.add(CP(.1, .3, denim, 0, -.235, 0)); l.kn.add(CP(.074, .27, denim, 0, -.2, 0)); l.th.add(B(.012, .12, .01, std(0x2a384b, .8), .0, -.15, -.098)); }
    shoes(k, 'boot', 0x241f1c, 0x15120f, 0xd0aa4d);
    const h = k.head; h.add(S(.108, k.hairM, 0, .02, .02, { s: [.96, .9, 1.0] }), TR(.112, .02, bandana, 0, .05, .0, { r: [PI / 2 - .12, 0, 0] }), B(.06, .06, .03, bandana, 0, .05, .115), B(.04, .1, .012, bandana, .03, .0, .12, { r: [0, 0, .2] }));
    shades(k); earring(k, gold, false);
    k.head.add(S(.09, k.hairM, 0, -.065, -.035, { s: [1, .72, .8] }));
    watch(k, gold, std(0x2a2a2c, .3)); for (const a of [k.aL, k.aR]) a.hand.scale.set(1.05, 1.05, 1.15);
  };
  D.okada = (k) => {
    const olive = std(0x57603f, .8), refl = std(0xd6d9d6, .3, .5), jeans = std(0x394b66, .85), glove = std(0x1c1c1e, .6), orange = std(0xc9573a, .6);
    k.glovesM = glove;
    shell(k, olive, .016, .06); sleeves(k, olive, { cuff: std(0x3f462d, .8) }); collar(k, olive, .79);
    bandT(k, refl, .46, 1, .03); bandT(k, refl, .26, 1, .03); for (const s of [-1, 1]) { k.torso.add(B(.05, .5, .012, refl, s * .09, .44, -.15), B(.05, .5, .012, refl, s * .09, .44, .15)); k.aL.el.add(B(.012, .05, .12, refl, 0, -.12, 0)); }
    k.aL.el.add(C(.058, .058, .03, refl, 0, -.12, 0, null, 12)); k.aR.el.add(C(.058, .058, .03, refl, 0, -.12, 0, null, 12));
    k.torso.add(B(.12, .1, .01, std(0x23282b, .8), .1, .5, -.15), B(.3, .05, .012, orange, 0, .36, .16), B(.2, .1, .012, std(0x23282b, .8), 0, .5, .16));
    for (const l of [k.lL, k.lR]) { l.th.add(CP(.09, .3, jeans, 0, -.235, 0)); l.kn.add(CP(.067, .27, jeans, 0, -.2, 0)); l.kn.add(B(.015, .1, .01, std(0x2d3b50, .8), .0, -.08, -.07)); }
    shoes(k, 'sneaker', 0x54504a, 0xcfc9b8, 0xc9573a);
    helmetOpen(k, std(0xe3e4e0, .22, .1), std(0x2a2d31, .1, .4, { transparent: true, opacity: .8 }));
    k.head.add(B(.2, .018, .02, std(0x1c1d20, .6), 0, -.03, -.13));
    watch(k, std(0x1c1d20, .5, .3));
  };
  D.shadow = (k) => {
    const coat = std(0x1f2126, .75), coatD = std(0x16171a, .8), scarf = std(0x6d727a, .9), steel = std(0x777c83, .35, .7), gold = std(0xd0aa4d, .3, .85);
    k.glovesM = std(0x121315, .5);
    shell(k, coat, .02, .1); sleeves(k, coat, { cuff: coatD }); collar(k, coatD, .8);
    // trench: long skirts that fall over the seat, belt, lapels, epaulettes, buttons
    k.torso.add(C(.17, .2, .34, coat, 0, -.15, .0, { s: [1.28, 1, .96] }, 22), B(.4, .5, .02, coatD, 0, -.3, .21, { r: [.06, 0, 0] }));
    bandT(k, coatD, .1, 1, .035); k.torso.add(B(.1, .035, .02, steel, 0, .1, -.178));
    for (const s of [-1, 1]) { k.torso.add(B(.1, .26, .014, coatD, s * .07, .6, -.16, { r: [0, 0, s * -.2] }), B(.1, .03, .1, coatD, s * .2, .7, 0), S(.012, steel, s * .04, .4, -.168), S(.012, steel, s * .04, .26, -.168)); }
    for (const l of [k.lL, k.lR]) { l.th.add(CP(.09, .3, std(0x15161a, .85), 0, -.235, 0)); l.kn.add(CP(.067, .27, std(0x15161a, .85), 0, -.2, 0)); }
    shoes(k, 'boot', 0x14100e, 0x0e0c0a, 0x777c83);
    const h = k.head; h.add(S(.106, k.hairM, 0, .012, .016, { s: [.95, .9, 1] }));
    h.add(C(.215, .22, .014, std(0x1b1c20, .8), 0, .07, -.0, null, 24), C(.112, .125, .13, std(0x1b1c20, .8), 0, .135, 0, null, 20), C(.126, .126, .03, std(0x6d727a, .7), 0, .1, 0, null, 20));
    shades(k, std(0x0d0d0f, .3, .4)); earring(k, gold, false);
    k.torso.add(TR(.09, .035, scarf, 0, .76, -.01, { r: [PI / 2, 0, 0], s: [1.2, 1, 1] }), B(.07, .3, .02, scarf, .06, .6, -.17, { r: [0, 0, .06] }), B(.06, .26, .02, scarf, .09, .42, .175));
    k.head.add(B(.07, .005, .008, std(0x4a2a22, .6), 0, -.063, -.098));
  };
  D.scholar = (k) => {
    const navy = std(0x1f3a5f, .8), cream = std(0xe9e1cc, .85), gold = std(0xc9a24a, .3, .8), brown = std(0x7a4b2a, .65), nvyP = std(0x1c2e4a, .85);
    k.hairM.color.set(0x15120f);
    // cream blouse under a tailored navy blazer, gold buttons, pocket square
    shell(k, cream, .0, .05); const bl = shell(k, navy, .02, .04); sleeves(k, navy, { cuff: cream }); collar(k, navy, .79);
    k.torso.add(B(.1, .56, .012, cream, 0, .46, -.162), B(.06, .22, .012, navy, -.07, .62, -.165, { r: [0, 0, -.35] }), B(.06, .22, .012, navy, .07, .62, -.165, { r: [0, 0, .35] }));
    for (const y of [.38, .26]) k.torso.add(S(.013, gold, 0, y, -.17));
    k.torso.add(B(.05, .03, .01, cream, -.14, .52, -.154), B(.14, .3, .01, std(0x16293f, .8), 0, .44, .168));
    for (const l of [k.lL, k.lR]) { l.th.add(CP(.09, .3, nvyP, 0, -.235, 0)); l.kn.add(CP(.066, .27, nvyP, 0, -.2, 0)); }
    shoes(k, 'loafer', 0x4a2d1a, 0x1c130d, 0xc9a24a);
    // afro puff and round glasses; satchel across the body
    const h = k.head; h.add(S(.108, k.hairM, 0, .016, .016, { s: [.96, .92, 1.0] }), S(.095, k.hairM, 0, .15, .06), S(.07, k.hairM, 0, .06, .115), TR(.112, .016, std(0xc9a24a, .5, .3), 0, .045, .0, { r: [PI / 2 - .15, 0, 0] }));
    for (const s of [-1, 1]) h.add(TR(.037, .006, gold, s * .046, .02, -.108, null), S(.036, std(0xcfe0e8, .1, .3, { transparent: true, opacity: .25 }), s * .046, .02, -.108, { s: [1, 1, .15] }));
    h.add(B(.02, .006, .008, gold, 0, .026, -.109)); for (const s of [-1, 1]) h.add(B(.006, .006, .09, gold, s * .1, .026, -.06));
    earring(k, gold, false);
    k.torso.add(B(.05, .6, .012, brown, -.04, .42, -.16, { r: [0, 0, -.7] }), B(.05, .6, .012, brown, -.04, .42, .16, { r: [0, 0, -.7] }), B(.3, .24, .1, brown, .18, .06, .08), B(.28, .08, .11, std(0x5a3720, .65), .18, .12, .08), S(.022, gold, .18, .1, .14));
    for (const a of [k.aL, k.aR]) a.el.add(TR(.05, .006, gold, 0, -.235, 0, { r: [PI / 2, 0, 0] }));
    // books under the arm
    k.aR.el.add(B(.1, .03, .15, std(0x7a2c25, .7), .06, -.28, -.04), B(.1, .03, .14, std(0x2a5a46, .7), .06, -.31, -.04));
  };

  /* ------------------------------------------------------------ v11: six international riders */
  D.kungfu = (k) => {
    const red = std(0xa8281f, .7), blk = std(0x17181c, .8), gold = std(0xd0aa4d, .3, .8), wht = std(0xeeeadc, .8);
    k.hairM.color.set(0x111112);
    // tangzhuang jacket: black silk, red mandarin collar, gold frog buttons, white sash, dragon crest on the back
    shell(k, blk, .018, .07); sleeves(k, blk, { cuff: red }); collar(k, red, .79);
    for (const y of [.66, .54, .42]) k.torso.add(B(.1, .016, .014, gold, 0, y, -.168), S(.018, gold, 0, y, -.172));
    k.torso.add(B(.012, .56, .012, red, 0, .46, -.166));
    bandT(k, wht, .13, 1, .03); k.torso.add(B(.05, .26, .014, wht, .1, -.02, -.17, { r: [0, 0, .12] }), B(.05, .22, .014, wht, .15, -.02, -.165, { r: [0, 0, .3] }));
    k.torso.add(B(.28, .28, .012, red, 0, .46, .18), S(.07, gold, 0, .46, .188, { s: [1, 1, .3] }), TR(.1, .012, gold, 0, .46, .19, null));
    for (const l of [k.lL, k.lR]) { l.th.add(CP(.1, .3, blk, 0, -.235, 0)); l.kn.add(CP(.074, .27, blk, 0, -.2, 0)); l.kn.add(B(.14, .02, .14, wht, 0, -.4, -.02)); }
    shoes(k, 'loafer', 0x15161a, 0xeeeadc, 0x15161a);
    const h = k.head; h.add(S(.108, k.hairM, 0, .02, .016, { s: [.96, .92, 1.0] }), S(.045, k.hairM, 0, .15, .03), C(.012, .012, .06, k.hairM, 0, .12, .03));
    h.add(TR(.112, .016, red, 0, .05, .0, { r: [PI / 2 - .08, 0, 0] }), B(.04, .2, .012, red, .035, -.03, .128, { r: [0, 0, .22] }), B(.04, .16, .012, red, -.03, -.03, .13, { r: [0, 0, -.2] }));
    for (const a of [k.aL, k.aR]) a.hand.scale.set(1.05, 1.05, 1.05);
  };
  D.snow = (k) => {
    const parka = std(0xd4542c, .75), fur = std(0xf1ece0, .95), grey = std(0x3a4350, .85), navy = std(0x1f3a5f, .6), cream = std(0xf1ece0, .8), lens = std(0xff9a3c, .1, .5);
    k.hairM.color.set(0xb8793a); k.glovesM = std(0x23262b, .7);
    // long insulated parka with fur hood ring, chest stripe, pockets
    shell(k, parka, .045, .15); sleeves(k, parka, { cuff: grey }); collar(k, fur, .8);
    bandT(k, cream, .5, 1, .05); bandT(k, navy, .43, 1, .05);
    for (const s of [-1, 1]) k.torso.add(B(.1, .12, .02, navy, s * .1, .1, -.18), B(.06, .3, .012, fur, s * .06, .64, -.2, { r: [0, 0, s * .15] }));
    k.torso.add(TR(.13, .05, fur, 0, .8, .06, { r: [PI / 2 - .35, 0, 0], s: [1.1, 1, 1] }), B(.34, .26, .12, parka, 0, .72, .15));
    // snowboard strapped to the back
    const bd = new T.Group(); bd.add(B(.3, 1.0, .028, navy, 0, 0, 0), B(.22, .5, .032, cream, 0, .08, 0), B(.12, .26, .036, parka, 0, .08, 0), B(.1, .04, .05, grey, 0, -.28, 0), B(.1, .04, .05, grey, 0, .22, 0)); bd.position.set(.0, .3, .26); bd.rotation.z = .16; k.torso.add(bd);
    for (const l of [k.lL, k.lR]) { l.th.add(CP(.105, .3, grey, 0, -.235, 0)); l.kn.add(CP(.08, .27, grey, 0, -.2, 0)); l.kn.add(C(.09, .09, .05, cream, 0, -.4, 0, null, 12)); }
    shoes(k, 'boot', 0xf1ece0, 0x23262b, 0xd4542c);
    // beanie with pom-pom, goggles pushed up
    const h = k.head; h.add(mesh(new T.SphereGeometry(.118, 18, 12, 0, PI * 2, 0, PI / 2), navy, 0, .035, .014, { s: [1.04, 1.05, 1.08] }), TR(.112, .02, cream, 0, .04, .014, { r: [PI / 2 - .05, 0, 0] }), S(.045, cream, 0, .16, .014));
    h.add(B(.2, .06, .04, std(0x23262b, .5), 0, .06, -.1, { r: [-.2, 0, 0] }), B(.17, .044, .02, lens, 0, .06, -.122, { r: [-.2, 0, 0] }), B(.22, .02, .1, std(0x23262b, .5), 0, .06, .0));
    h.add(S(.06, k.hairM, 0, -.04, .09, { s: [1.3, 1.2, .8] }));
  };
  D.sheikh = (k) => {
    const wht = std(0xf1eee4, .85), bisht = std(0x2c2118, .6), gold = std(0xd0aa4d, .3, .85), blk = std(0x15161a, .6);
    const gh = new T.MeshStandardMaterial({ map: plaidTex(0xf1eee4, 0xc0262b, 0xf1eee4), roughness: .85 });
    k.hairM.color.set(0x1a1512);
    // white kandura under a black bisht cloak with gold trim
    shell(k, wht, .0, .06); const cl = shell(k, bisht, .032, .1); sleeves(k, bisht, { cuff: gold }); collar(k, wht, .79);
    k.torso.add(C(.2, .27, .5, bisht, 0, -.2, .02, { s: [1.18, 1, .85] }, 24));
    for (const s of [-1, 1]) k.torso.add(B(.022, .62, .012, gold, s * .075, .46, -.17, { r: [0, 0, s * -.03] }), B(.1, .02, .1, gold, s * .2, .76, 0));
    k.torso.add(B(.34, .02, .012, gold, 0, -.34, -.18), B(.2, .2, .012, gold, 0, .5, .18), S(.05, bisht, 0, .5, .188, { s: [1, 1, .3] }));
    for (const l of [k.lL, k.lR]) { l.th.add(CP(.1, .3, wht, 0, -.235, 0)); l.kn.add(CP(.074, .26, wht, 0, -.2, 0)); }
    shoes(k, 'loafer', 0xd9cfb2, 0x2b2118, 0xd0aa4d);
    // ghutra drape + black agal ring, aviators, trimmed beard, gold watch
    const h = k.head; h.add(S(.106, k.hairM, 0, .0, .02, { s: [.95, .9, 1] }));
    h.add(S(.128, gh, 0, .045, .03, { s: [1.08, .92, 1.14] }), B(.06, .26, .12, gh, .115, -.08, .03, { r: [0, 0, -.06] }), B(.06, .26, .12, gh, -.115, -.08, .03, { r: [0, 0, .06] }), B(.26, .3, .04, gh, 0, -.06, .13, { r: [.18, 0, 0] }));
    h.add(TR(.118, .013, blk, 0, .09, .025, { r: [PI / 2 - .1, 0, 0], s: [1.04, 1, 1.08] }), TR(.118, .013, blk, 0, .065, .025, { r: [PI / 2 - .1, 0, 0], s: [1.04, 1, 1.08] }));
    shades(k, gold); h.add(S(.085, k.hairM, 0, -.07, -.03, { s: [1.0, .7, .9] }));
    watch(k, gold, std(0xf1eee4, .3));
  };
  D.tokyo = (k) => {
    const sat = std(0x1d3a33, .35, .1), red = std(0xb8262c, .5), gold = std(0xd0aa4d, .3, .8), blk = std(0x17181c, .75), refl = std(0xcfd2d4, .3, .5);
    k.glovesM = std(0x17181c, .5); k.hairM.color.set(0x111111);
    // sukajan souvenir jacket: satin green, red-striped rib cuffs, embroidered dragon panel
    shell(k, sat, .02, .06); sleeves(k, sat, { cuff: red }); collar(k, red, .79);
    k.torso.add(B(.012, .6, .012, red, 0, .44, -.17), B(.3, .34, .012, new T.MeshStandardMaterial({ map: emb(0xd0aa4d, 0x1d3a33), roughness: .5 }), 0, .46, .18));
    for (const a of [k.aL, k.aR]) a.sh.add(B(.07, .02, .07, gold, 0, -.2, 0));
    for (const l of [k.lL, k.lR]) { l.th.add(CP(.1, .3, blk, 0, -.235, 0)); l.kn.add(CP(.074, .27, blk, 0, -.2, 0)); l.kn.add(B(.016, .22, .01, refl, .0, -.12, -.075)); }
    shoes(k, 'sneaker', 0xf3f1ea, 0xe9e5da, 0xb8262c);
    // open-face helmet with a red sun roundel, tinted visor, face mask pulled down
    helmetOpen(k, std(0xf0eee8, .2, .1), std(0x2a2d31, .1, .4, { transparent: true, opacity: .75 }));
    k.head.add(C(.05, .05, .012, red, 0, .13, -.035, { r: [PI / 2 - .5, 0, 0] }, 20), B(.14, .05, .05, blk, 0, -.09, -.06));
    watch(k, std(0x1c1d20, .5, .4), red);
  };
  D.punk = (k) => {
    const lea = std(0x1a1819, .4, .2), tart = new T.MeshStandardMaterial({ map: plaidTex(0x8a1f24, 0x15151a, 0xe8d8a0), roughness: .85 }), tee = std(0xeeeadc, .85), metal = std(0xb9bdc2, .3, .8), pink = 0xe0307a;
    const jack = new T.MeshStandardMaterial({ map: ctex(128, 128, (g, w, h) => { g.fillStyle = '#1f3a7a'; g.fillRect(0, 0, w, h); g.strokeStyle = '#eeeadc'; g.lineWidth = 22; g.beginPath(); g.moveTo(0, 0); g.lineTo(w, h); g.moveTo(w, 0); g.lineTo(0, h); g.stroke(); g.strokeStyle = '#c0262b'; g.lineWidth = 8; g.beginPath(); g.moveTo(0, 0); g.lineTo(w, h); g.moveTo(w, 0); g.lineTo(0, h); g.stroke(); g.fillStyle = '#eeeadc'; g.fillRect(w / 2 - 20, 0, 40, h); g.fillRect(0, h / 2 - 20, w, 40); g.fillStyle = '#c0262b'; g.fillRect(w / 2 - 11, 0, 22, h); g.fillRect(0, h / 2 - 11, w, 22); }), roughness: .7 });
    k.hairM.color.set(pink);
    // torn tee under a studded leather biker jacket, union-jack back patch, safety-pin earring, tartan bondage trousers
    shell(k, tee, .0, .05); shell(k, lea, .03, .07); sleeves(k, lea, { cuff: std(0x131112, .6) }); collar(k, lea, .79);
    k.torso.add(B(.1, .5, .012, tee, 0, .46, -.164), B(.012, .54, .012, metal, -.08, .46, -.172, { r: [0, 0, .08] }), B(.012, .54, .012, metal, .08, .46, -.172, { r: [0, 0, -.08] }));
    for (const s of [-1, 1]) { k.torso.add(B(.16, .03, .06, lea, s * .09, .78, -.1, { r: [0, s * .4, 0] })); for (let i = 0; i < 4; i++) k.torso.add(S(.012, metal, s * (.1 + i * .035), .72 - i * .005, -.12)); }
    k.torso.add(B(.3, .3, .012, jack, 0, .46, .18));
    for (let i = -3; i <= 3; i++) k.torso.add(S(.011, metal, i * .045, .64, .184));
    for (const a of [k.aL, k.aR]) for (let i = 0; i < 3; i++) a.sh.add(S(.012, metal, 0, -.1 - i * .05, -.07));
    for (const l of [k.lL, k.lR]) { l.th.add(CP(.088, .3, tart, 0, -.235, 0)); l.kn.add(CP(.064, .27, tart, 0, -.2, 0)); }
    k.lL.th.add(B(.012, .3, .01, lea, .0, -.2, -.1)); k.lR.kn.add(TR(.07, .008, metal, 0, -.1, 0, { r: [PI / 2, 0, 0] }));
    shoes(k, 'boot', 0x7a1f1c, 0x15120f, 0xe8d8a0);
    // pink mohawk spikes + piercings + spiked collar
    const h = k.head; for (let i = 0; i < 7; i++) h.add(C(0, .028 - i * .0015, .15 - Math.abs(i - 3) * .014, k.hairM, 0, .16 - Math.abs(i - 3) * .006, .09 - i * .031, { r: [(i - 3) * -.08, 0, 0] }, 8));
    h.add(S(.08, std(pink, .8), 0, .075, .0, { s: [.4, .5, 1.4] }));
    earring(k, metal, false); h.add(S(.01, metal, .018, -.032, -.1), S(.01, metal, -.04, .045, -.098));
    k.torso.add(TR(.09, .016, std(0x15151a, .5), 0, .76, -.01, { r: [PI / 2, 0, 0], s: [1.15, 1, 1] }));
    for (let i = 0; i < 7; i++) { const a = i / 7 * PI * 2; k.torso.add(C(0, .012, .04, metal, Math.cos(a) * .105, .78, Math.sin(a) * .09, null, 6)); }
    for (const a of [k.aL, k.aR]) a.hand.scale.set(1.05, 1.05, 1.1);
  };
  D.samba = (k) => {
    const grn = std(0x1e9a4a, .7), yel = std(0xffd21f, .6), blu = std(0x1c4f9c, .7), cream = std(0xf4ecd0, .8), pand = std(0xc9a24a, .5, .3);
    const shirtT = new T.MeshStandardMaterial({ map: ctex(128, 128, (g, w, h) => { g.fillStyle = '#ffd21f'; g.fillRect(0, 0, w, h); const lf = (x, y, r, c) => { g.fillStyle = c; g.beginPath(); g.ellipse(x, y, r, r * .45, 0, 0, 7); g.fill(); }; for (const [x, y, r, c, a] of [[28, 30, 30, '#1e9a4a', .4], [96, 36, 26, '#1c4f9c', -.5], [60, 82, 32, '#1e9a4a', .9], [112, 100, 24, '#1c4f9c', .2], [14, 108, 22, '#e0507a', -.3]]) { g.save(); g.translate(x, y); g.rotate(a); lf(0, 0, r, c); g.restore(); } }), roughness: .7 });
    k.hairM.color.set(0x241a14); k.L.shorts = true;
    // open Hawaiian-print shirt, bright blue board shorts, beads, bucket hat, pandeiro on the hip
    shell(k, shirtT, .02, .03); sleeves(k, shirtT, { short: false, cuff: yel }); collar(k, grn, .79);
    k.torso.add(B(.1, .5, .012, cream, 0, .46, -.164), B(.012, .52, .012, grn, -.055, .46, -.17, { r: [0, 0, .06] }), B(.012, .52, .012, grn, .055, .46, -.17, { r: [0, 0, -.06] }));
    for (const l of [k.lL, k.lR]) { l.th.add(CP(.1, .2, blu, 0, -.2, 0)); l.kn.add(CP(.074, .09, blu, 0, -.08, 0)); }
    shoes(k, 'loafer', 0xffd21f, 0x1e9a4a, 0x1e9a4a);
    const h = k.head; h.add(S(.108, k.hairM, 0, .02, .016, { s: [.96, .92, 1.0] }));
    h.add(C(.115, .135, .09, grn, 0, .1, .015, null, 18), C(.19, .19, .016, grn, 0, .05, .0, null, 22), TR(.12, .014, yel, 0, .075, .012, { r: [PI / 2, 0, 0] }));
    shades(k, std(0xffd21f, .4), true);
    chain(k, std(0xffd21f, .5, .2)); chain(k, std(0x1e9a4a, .5, .2)); chain(k, std(0x1c4f9c, .5, .2));
    k.torso.add(C(.12, .12, .045, pand, -.2, .0, -.08, { r: [PI / 2, .3, .3] }, 18), C(.105, .105, .05, cream, -.2, .0, -.08, { r: [PI / 2, .3, .3] }, 18));
    for (let i = 0; i < 3; i++) k.torso.add(S(.02, pand, -.2 + Math.cos(i * 2.1) * .12, Math.sin(i * 2.1) * .12, -.08));
  };

  /* ------------------------------------------------------------ vehicle choice per character */
  const VEH = {
    courier: ['cub', { col: 0xa8372c, col2: 0xd8d2c0, box: 0x1d6f70, accent: 0xe8e2cf, plate: 'LAG 247' }],
    danfo: ['keke', { col: 0xd9b030, col2: 0x1b1b1d, plate: 'KJA 112' }],
    sparks: ['trail', { col: 0x2b5d92, col2: 0x2a2d31, accent: 0xd0a526, plate: 'EKY 058' }],
    ankara: ['vespa', { col: 0x2a8a84, col2: 0x8e2f4a, seat: 0x7a3e22, basket: true, plate: 'ABJ 330' }],
    bolt: ['sport', { col: 0xeeebe2, col2: 0x2d8a5a, plate: 'LND 009' }],
    sultan: ['cruiser', { col: 0xece6d4, col2: 0xc6a24b, bags: 0x3b2a1c, plate: 'KAN 001' }],
    agbero: ['cruiser', { col: 0x8f2a24, col2: 0xd0aa4d, bags: 0x201a17, chop: true, plate: 'AGB 666' }],
    okada: ['naked', { col: 0xb5392b, col2: 0x23262a, rack: 0x3b4a2c, plate: 'OKD 125' }],
    shadow: ['naked', { col: 0x16171a, col2: 0x1c1d20, matte: true, plate: 'SHD 000' }],
    scholar: ['vespa', { col: 0xe9e1cc, col2: 0x1f3a5f, seat: 0x1f3a5f, crate: 0x7a4b2a, plate: 'UNN 100' }],
    kungfu: ['vespa', { col: 0x1b1c20, col2: 0xa8281f, seat: 0x2a2118, crate: 0xa8281f, plate: 'SHA 888' }],
    snow: ['trail', { col: 0xeaf2f6, col2: 0xd4542c, accent: 0x2a2d31, plate: 'ZRH 305' }],
    sheikh: ['sport', { col: 0xf2efe6, col2: 0xd0aa4d, plate: 'DXB 001' }],
    tokyo: ['naked', { col: 0x14171c, col2: 0xb8262c, rack: 0x2a2d31, plate: 'SHN 086' }],
    punk: ['cruiser', { col: 0x1a1a1d, col2: 0xe0307a, bags: 0x201a17, chop: true, plate: 'LDN 077' }],
    samba: ['cub', { col: 0xffd21f, col2: 0x1e9a4a, box: 0x1c4f9c, accent: 0xf4ecd0, plate: 'RIO 013' }]
  };
  const LOOK = {   // skin tones, builds and hair per character
    courier: { skin: 0xb98059, hair: 0x16120f, shirt: 0x777b82, pants: 0x23262b, bulk: 1 },
    danfo: { skin: 0x8a5a3c, hair: 0x15120f, shirt: 0xc9a22c, pants: 0x8d7e5c, bulk: 1.0 },
    sparks: { skin: 0x7c5136, hair: 0x15120f, shirt: 0x28435f, pants: 0x28435f, bulk: 1.05 },
    ankara: { skin: 0x9a6742, hair: 0x15120f, shirt: 0x1f6b66, pants: 0x1f6b66, bulk: .86, hairStyle: 'wrap' },
    bolt: { skin: 0x6b4430, hair: 0x15120f, shirt: 0x1b1d21, pants: 0x15171a, bulk: .92 },
    sultan: { skin: 0x7c5136, hair: 0x2a2522, shirt: 0xefe8d4, pants: 0xefe8d4, bulk: 1.15 },
    agbero: { skin: 0x5f3b28, hair: 0x15120f, shirt: 0x7d2a2a, pants: 0x3a4a62, bulk: 1.18 },
    okada: { skin: 0x6b4430, hair: 0x15120f, shirt: 0x57603f, pants: 0x394b66, bulk: 1.0 },
    shadow: { skin: 0x5f3b28, hair: 0x15120f, shirt: 0x1f2126, pants: 0x15161a, bulk: 1.0 },
    scholar: { skin: 0x7c5136, hair: 0x15120f, shirt: 0xe9e1cc, pants: 0x1c2e4a, bulk: .88, hairStyle: 'puff' },
    kungfu: { skin: 0xdcae86, hair: 0x111112, shirt: 0x17181c, pants: 0x17181c, bulk: 1.0, hairStyle: 'none' },
    snow: { skin: 0xe6bd9c, hair: 0xb8793a, shirt: 0xd4542c, pants: 0x3a4350, bulk: .96, hairStyle: 'none' },
    sheikh: { skin: 0xa8764f, hair: 0x1a1512, shirt: 0xf1eee4, pants: 0xf1eee4, bulk: 1.1, hairStyle: 'none' },
    tokyo: { skin: 0xdcae86, hair: 0x111111, shirt: 0x1d3a33, pants: 0x17181c, bulk: .94, hairStyle: 'none' },
    punk: { skin: 0xe2b896, hair: 0xe0307a, shirt: 0xeeeadc, pants: 0x8a1f24, bulk: .92, hairStyle: 'none' },
    samba: { skin: 0x9a6742, hair: 0x241a14, shirt: 0xffd21f, pants: 0x1c4f9c, bulk: 1.0, hairStyle: 'none', shorts: true }
  };

  /* ------------------------------------------------------------ assemble: rider + bike + seated pose */
  K.build = function (L) {
    L = L || {}; const id = L.id && D[L.id] ? L.id : 'courier';
    const lk = Object.assign({}, LOOK[id]); const kk = body(lk);
    D[id](kk);
    const [vt, vc] = VEH[id]; const veh = V[vt](Object.assign({}, vc));
    kk.root.add(veh.group); veh.group.add(veh.fork === veh.group ? new T.Group() : new T.Group()); // (placeholder group keeps child order stable)
    // seated pose from IK
    const P = veh.pose, lean = P.lean; const hy = P.hip[0], hz = P.hip[1];
    const lg = ik(.47, .46, hy, hz, P.foot[0] + .1, P.foot[1], 1);
    const shY = hy + .64 * Math.cos(lean), shZ = hz - .64 * Math.sin(lean);
    const ar = ik(.3, .29, shY, shZ, P.hand[0], P.hand[1], -1);
    const pose = { rigY: hy, rigZ: hz, torso: -lean, thL: lg.a, knL: -lg.rel, thR: lg.a, knR: -lg.rel, arL: ar.a + lean, elL: ar.rel, arR: ar.a + lean, elR: ar.rel, head: lean * .8 };
    // keep the bike in the same node as the rider so bank/yaw move both; the bike group is added first (drawn under)
    const out = { root: kk.root, rig: kk.rig, torso: kk.torso, head: kk.head, aL: kk.aL, aR: kk.aR, lL: kk.lL, lR: kk.lR, veh, pose, id };
    kk.root.children.splice(kk.root.children.indexOf(veh.group), 1); kk.root.add(veh.group);
    kk.rig.position.set(0, hy, hz); kk.rig.scale.set(1, 1, 1);
    kk.root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
    return out;
  };
  K.dispose = function (c) { c.root.traverse(o => { if (o.isMesh) { o.geometry.dispose(); const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); } }); };
  K.ids = Object.keys(VEH);
  global.CharKit = K;
})(window);
