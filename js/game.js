/* RUSH HOUR (was Signal Lost) — simulation: player, obstacles, adaptive wave generator, scoring */
(function (global) {
  'use strict';
  const rnd = Math.random;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const K = 22;                       // perspective strength
  const ZSPAWN = 100, ZFAR = 150;
  const SAMPLE_Z = 55;                // the "decision line": where the city checks if it guessed your lane
  const JUMP_T = 0.62, JUMP_H = 1.7, SLIDE_T = 0.55;
  const GRAV = 8 * JUMP_H / (JUMP_T * JUMP_T), JUMP_V = GRAV * JUMP_T / 2;
  const proj = z => 1 / (1 + z / K);
  const WALL_H = { sedan: 1.7, taxi: 1.8, police: 1.8, van: 2.5, truck: 3.4, bus: 3.4 };
  WALL_H.undefined = 2.5;

  const Game = {
    K, ZSPAWN, ZFAR, SAMPLE_Z, JUMP_T, SLIDE_T, proj, GRAV, JUMP_V,
    brain: new Brain(),
    state: 'title', attract: true, god: true, bot: null,
    clock: 0, time: 0, dist: 0, speed: 20, score: 0, coins: 0, best: 0, bestPts: 0, bestPred: 0,
    q: [], obs: [], coinsL: [], chips: [], blds: [[], []], boards: [], waves: [],
    parts: [], pops: [], events: [],
    fx: { shake: 0, flash: 0, glitch: 0, chroma: 0, freeze: 0, zoom: 0, hurt: 0, eyeFlash: 0, eyeMiss: 0, speedPulse: 0 },
    taunt: { text: 'RUSH HOUR', t: 0, next: 0 }, ticker: { text: '', t: 0 },
    blindT: 0, combo: 0, comboT: 0, mult: 1,
    waveLog: [], nextChipAt: 9, lastGap: 0,
    p: null
  };
  const CX = (global.Save && global.Save.CASH_X) || 12, cmp = n => global.Save ? global.Save.compact(n) : String(Math.floor(n));
  Game.perk = {};   // equipped character's perk (set by main.js from Save before a run)
  Game.up = { jam: 0, cash: 0, turbo: 0, bail: 0 }; // upgrade levels, set by main.js from Save before a run
  try { Game.best = +localStorage.getItem('sl_best') || 0; /* sl_best is rescaled by Save when the save is migrated to v5 */ Game.bestPred = +localStorage.getItem('sl_bestpred') || 0; Game.bestPts = +localStorage.getItem('sl_bestpts') || 0; } catch (e) {}

  /* ------------------------------------------------------------ setup */
  Game.reset = function (attract, opts) {
    opts = opts || {};
    const g = this;
    g.attract = !!attract; g.god = !!attract || !!opts.god;
    g.brain = new Brain();
    g.state = attract ? 'title' : 'play';
    g.time = 0; g.dist = 0; g.speed = 20; g.speedS = 0; g.score = 0; g.coins = 0; g.q.length = 0;
    g.obs = []; g.coinsL = []; g.chips = []; g.blds = [[], []]; g.boards = []; g.waves = []; g.parts = []; g.pops = [];
    g.blindT = 0; g.combo = 0; g.comboP = 0; g.comboT = 0; g.mult = 1; g.waveLog = []; g.nextChipAt = 8.5; g.nextBoardZ = 70; g.boardSide = 0;
    g.bailUsed = false; g.autoUsed = false; g.bails = 0; g.jams = 0; g.jamTotal = 6.5; g.nextCoinGap = 0; g.deadT = 0; g.overT = 0; g.newBest = false; g.pts = 0; g.finalPts = 0; g.newBestPts = false; g.nearCount = 0; g.speedTier = 0;
    g.fx = { shake: 0, flash: opts.noflash ? 0 : 0.6, glitch: 0, chroma: 0, freeze: 0, zoom: 0, hurt: 0, eyeFlash: 0, eyeMiss: 0, speedPulse: 1 };
    g.p = { lane: 1, prevLane: 1, x: 1, vx: 0, y: 0, vy: 0, grounded: true, slide: 0, slideBuf: 0, jumpBuf: 0, fast: false, phase: 0,
            inv: 0, dead: false, foot: false, mvFrom: 1, mvT: 9, mvLane: 1, lean: 0, inLane: [-9, -9, -9], slideStart: -9, jumpStart: -9, landT: -9, switchT: -9 };
    g.camX = 0;
    g.heat = 0; g.stars = 0; g.threat = 1; g.riskT = -99; g.topT = 0; g.coolPopT = -99; g.footT = 0; g.footK = 0; g.bikeAnimT = 99; g.regainT = 99; g.bikeAt = 0; g.bikesLost = 0; g.footSecs = 0;
    g.taunt = { text: 'NEW RUNNER DETECTED', t: 0, next: 3.4 };
    g.ticker = { text: 'NEW RUNNER DETECTED', t: 0 };
    g.bz = [-10, 6];
    while (g.bz[0] < ZFAR) g.spawnBuilding(0);
    while (g.bz[1] < ZFAR) g.spawnBuilding(1);
    // pre-seeded first waves so something is incoming from second one
    g.rampAir = false; g.featAttract = !!opts.featAttract; g.featReset(opts);
    g.spawnWave(46); g.spawnWave(76);
    g.distToNext = 100 - 76 + g.waveGap();
    g.bot = opts.bot || (attract ? { restLane: 1, dodgeDir: rnd() < 0.5 ? -1 : 1, react: 0.7, jumpAt: 0.3, wander: true } : null);
    g.events.push({ type: 'reset' });
  };

  /* ------------------------------------------------------------ difficulty */
  Game.speedAt = t => 20 + 22 * (1 - Math.exp(-t / 75));
  Game.waveGap = function () {
    const T = 1.5 - 0.62 * (1 - Math.exp(-this.time / 60));
    return this.speed * T;
  };

  /* ------------------------------------------------------------ scenery */
  Game.spawnBuilding = function (side) {
    const depth = 12 + rnd() * 14, gap = rnd() < 0.18 ? 4 + rnd() * 6 : rnd() * 1.5;
    const b = { z: this.bz[side], depth, side, w: 5 + rnd() * 6, h: 6 + rnd() * 11, tone: Math.floor(rnd() * 3), seed: Math.floor(rnd() * 99999),
                neon: rnd() < 0.5 ? 0 : rnd() < 0.5 ? 1 : 2, sign: rnd() < 0.35, signCol: rnd() < 0.5 ? 0 : 1, kind: 'bld' };
    this.blds[side].push(b);
    this.bz[side] += depth + gap;
  };
  Game.spawnBoard = function () {
    const side = this.boardSide; this.boardSide ^= 1;
    this.boards.push({ z: ZFAR - 10, side, text: null, flick: 0, kind: 'board', seed: Math.floor(rnd() * 999) });
  };

  /* ------------------------------------------------------------ waves */
  function typeWeights(g) {
    const L = g.brain.log;
    let w = { wall: 0.34, barrier: 0.33, beam: 0.33 };
    if (L.jumps > L.slides * 1.6 + 2) { w.barrier *= 0.55; w.beam *= 1.4; w.wall *= 1.1; }
    else if (L.slides > L.jumps * 1.6 + 2) { w.barrier *= 1.4; w.beam *= 0.55; w.wall *= 1.1; }
    return w;
  }
  function pickType(g, banWall) {
    const w = typeWeights(g); if (banWall) w.wall = 0;
    const s = w.wall + w.barrier + w.beam; let r = rnd() * s;
    if ((r -= w.wall) < 0) return 'wall';
    if ((r -= w.barrier) < 0) return 'barrier';
    return 'beam';
  }
  Game.addObstacle = function (type, lane, z, wave, depthOverride, forceCop) {
    const o = { type, lane, z, kind: 'obs', wave, judgedF: false, judgedB: false, minClear: Infinity, slideTTI: null, seed: Math.floor(rnd() * 9999) };
    if (type === 'wall') { o.h = 2.3; o.depth = depthOverride || (this.time < 15 ? 2.5 + rnd() * 3 : 2.5 + rnd() * (this.time < 40 ? 7 : 11)); }
    else if (type === 'barrier') { o.h = 0.85; o.depth = 1.0; }
    else { o.h = 2.3; o.bottom = 0.64; o.depth = 0.9; }
    if (type === 'wall' && o.depth < 5.2) { o.cop = !!forceCop || rnd() < this.copChance(); if (o.cop) o.vis = 'police'; }   // car-sized walls are police roadblocks only when the heat says so
    this.obs.push(o);
    return o;
  };

  // The heart of the city: decide where to put things, using what it has learnt about you.
  Game.spawnWave = function (z) {
    const g = this, b = g.brain, c = g.p.lane, blind = g.blindT > 0;
    const act = blind ? 0 : b.actProb(g.time);
    const pr = b.predictRest(c);
    const wave = { z, bet: pr.bet, conf: pr.conf, c0: c, sampled: blind, cells: [null, null, null], mode: 'random', chain: 0, id: g.waveLog.length, blind, act, t: g.time };
    const cells = wave.cells;
    const bigDepth = g.time < 12 ? 3 : null;
    if (!blind && rnd() < act) {
      // targeted: block the lane we think you'll be sitting in
      wave.mode = 'target';
      cells[pr.bet] = pickType(g, g.time < 6);
      const fl = b.predictDir(pr.bet);
      let flee = pr.bet + fl.dir; if (flee < 0 || flee > 2) flee = pr.bet - fl.dir;
      wave.flee = flee;
      if (rnd() < 0.3 + 0.55 * act) {
        wave.mode = 'pincer';
        let t2 = pickType(g, true);
        if (act > 0.7 && cells[pr.bet] !== 'wall' && rnd() < 0.3) t2 = 'wall';
        cells[flee] = t2;
      }
      // timing trap: I know when you jump
      if (cells[pr.bet] === 'barrier' && rnd() < 0.5 * act) {
        const tj = b.jumpTTIm === null ? 0.3 : b.jumpTTIm;
        const tAfter = clamp((JUMP_T - tj) + 0.3, 0.55, 0.95);
        wave.chain = tAfter * g.speed + 1.0;
        wave.chainLane = pr.bet; wave.chainType = rnd() < 0.35 ? 'beam' : 'barrier'; wave.mode = 'trap';
      }
    } else {
      // generic: one or two random lanes
      const n = (g.time > 14 && rnd() < 0.45) ? 2 : 1;
      const lanes = [0, 1, 2].sort(() => rnd() - 0.5).slice(0, n);
      lanes.forEach((l, i) => { cells[l] = pickType(g, i === 1 && n === 2 && false); });
      if (n === 2 && cells[lanes[0]] === 'wall' && cells[lanes[1]] === 'wall') cells[lanes[1]] = 'barrier';
    }
    // heat: a police roadblock swaps in for one of the blockers (never adds a lane, never touches a timing trap)
    wave.copLane = -1;
    if (!wave.chain && rnd() < g.copWaveChance()) {
      const occ = [0, 1, 2].filter(l => cells[l]), hasWall = occ.some(l => cells[l] === 'wall');
      if (occ.length && !hasWall) { wave.copLane = occ[Math.floor(rnd() * occ.length)]; cells[wave.copLane] = 'wall'; }
    }
    // spawn the obstacles
    let free = [];
    for (let l = 0; l < 3; l++) {
      if (cells[l]) {
        const isCop = l === wave.copLane, o = isCop ? g.addObstacle('wall', l, z, wave, 3.4 + rnd() * 1.2, true) : g.addObstacle(cells[l], l, z, wave, cells[l] === 'wall' ? bigDepth : null);
        wave.depth = Math.max(wave.depth || 0, o.depth);
        if (cells[l] === 'barrier' && rnd() < 0.7) g.coinArc(l, z + 0.5);
      } else free.push(l);
    }
    if (wave.chain) {
      const o2 = g.addObstacle(wave.chainType, wave.chainLane, z + wave.chain, wave);
      wave.depth = Math.max(wave.depth || 0, wave.chain + o2.depth);
      if (rnd() < 0.8) g.coinArc(wave.chainLane, z + wave.chain + 0.5);
      g.pushTicker('I KNOW WHEN YOU JUMP');
    }
    wave.depth = wave.depth || 1;
    // coins on the free lane(s) — the escape path
    if (free.length) {
      const fl = wave.mode === 'pincer' || wave.mode === 'trap' ? free[0] : free[Math.floor(rnd() * free.length)];
      wave.freeLane = fl;
      g.spawnExtras(wave, z, free, fl);               // letters, ramps, turbo pads, cash tokens (features.js)
      if (rnd() < 0.85 && !wave.noCoins) g.coinRow(fl, z - 1, 6, 2.4);
    }
    // glitch chip, placed in the free lane
    if (g.time >= g.nextChipAt && !blind && free.length) {
      const fl = wave.freeLane !== undefined ? wave.freeLane : free[0];
      g.chips.push({ lane: fl, z: z + 1.5, y: 0.75, taken: false, kind: 'chip' });
      g.nextChipAt = g.time + 17 + rnd() * 9;
    }
    g.waves.push(wave);
    g.waveLog.push({ id: wave.id, t: +g.time.toFixed(2), mode: wave.mode, bet: wave.bet, conf: +wave.conf.toFixed(2), c0: c, cells: cells.slice(), act: +act.toFixed(2), blind });
    return wave;
  };

  /* ------------------------------------------------------------ heat (the wanted level): earned by risky riding, never by the clock
     heat 0..5 (float); stars = floor(heat). Near miss +0.25, bump +0.6, crash +0.9 (+0.3 into a roadblock), on foot after a crash +1 (once per wreck),
     sustained top speed / boost +0.06/s (capped so speed alone tops out at 2.5 stars, boost at 3). Clean for 6 s -> cools 0.1/s (0.04/s on foot). */
  const HEAT_CLEAN = 6, HEAT_COOL = 0.1, HEAT_COOL_FOOT = 0.04, HEAT_SPEED = 0.06, HEAT_TOP_SPEED = 37;
  const COP_CAR = [0.04, 0.18, 0.34, 0.52, 0.7, 0.88], COP_WAVE = [0, 0.10, 0.18, 0.28, 0.38, 0.50];
  Game.copChance = function () { return COP_CAR[Math.min(5, this.stars | 0)]; };       // chance a car-sized wall is a police car
  Game.copWaveChance = function () { return COP_WAVE[Math.min(5, this.stars | 0)]; };   // chance a wave gets an extra police roadblock
  Game.addHeat = function (n, cap) {
    const g = this; cap = cap === undefined ? 5 : cap;
    if (g.heat >= cap) return false;
    g.heat = Math.min(cap, g.heat + n); g.riskT = g.time;
    g.heatSync(true); return true;
  };
  Game.heatSync = function (rising) {
    const g = this, s = Math.min(5, Math.floor(g.heat + 1e-6));
    if (s !== g.stars) {
      const up = s > g.stars; g.stars = s;
      if (up && !g.attract) { g.pop('WANTED \u2191', g.W2 || 160, 60, '#ff3b4e', 1, 0.9); g.emit('wanted', { stars: s }); }
      else if (!up && !g.attract && g.time - g.coolPopT > 2) { g.coolPopT = g.time; g.pop('HEAT COOLING', g.W2 || 160, 60, '#8fc3e8', 1, 0.9); }
    }
    g.threat = s === 0 ? 1 : s * 2;                      // 1..10 scale used by audio layers / helicopter (stars = ceil(threat/2))
  };
  Game.heatStep = function (dt) {
    const g = this, p = g.p;
    const top = g.boostK > 0.5 || g.speedS >= HEAT_TOP_SPEED;
    g.topT = top && !p.foot && !p.dead ? g.topT + dt : 0;
    if (g.topT > 2.5) g.addHeat(HEAT_SPEED * dt, g.boostK > 0.5 ? 3 : 2.5);        // sustained top speed / boost
    if (g.heat > 0 && g.time - g.riskT > HEAT_CLEAN) { g.heat = Math.max(0, g.heat - (p.foot ? HEAT_COOL_FOOT : HEAT_COOL) * dt); g.heatSync(false); }
    else g.heatSync(false);
  };

  Game.coinRow = function (lane, z, n, step) {
    for (let i = 0; i < n; i++) this.coinsL.push({ lane, z: z + i * step, y: 0.5, taken: false, kind: 'coin', ph: rnd() * 6 });
  };
  Game.coinArc = function (lane, z) {
    const hs = [0.7, 1.25, 1.65, 1.25, 0.7];
    for (let i = 0; i < 5; i++) this.coinsL.push({ lane, z: z - 3.5 + i * 1.8, y: hs[i], taken: false, kind: 'coin', ph: rnd() * 6 });
  };

  /* ------------------------------------------------------------ feedback helpers */
  Game.pop = function (text, x, y, color, scale, life) {
    this.pops.push({ text, x, y, vy: -18, t: 0, life: life || 1.0, color: color || '#fff', scale: scale || 1 });
  };
  Game.burst = function (x, y, n, colors, spd, life, grav) {
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, s = (0.3 + rnd() * 0.7) * (spd || 60);
      this.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - (spd || 60) * 0.2, t: 0, life: (life || 0.5) * (0.6 + rnd() * 0.7), c: colors[Math.floor(rnd() * colors.length)], g: grav === undefined ? 120 : grav, s: rnd() < 0.2 ? 2 : 1 });
    }
  };
  Game.pushTicker = function (text) { this.ticker = { text, t: 0 }; };
  Game.shake = function (a) { this.fx.shake = Math.max(this.fx.shake, a); };
  Game.addCombo = function (n) {
    this.comboP = (this.comboP || 0) + n; this.combo = Math.floor(this.comboP); this.comboT = 3.2 * (1 + (this.perk.combo || 0));
  };
  Game.playerScreen = function () {
    const R = global.Render; return R ? R.playerPos(this) : { x: 160, y: 140 };
  };
  Game.emit = function (type, o) { this.events.push(Object.assign({ type }, o)); };

  /* ------------------------------------------------------------ input actions */
  Game.act = function (a) { if ((this.state === 'play' || this.attract) && this.q.length < 1) this.q.push(a); };   // at most 1 pending input
  Game.threatIn = function (lane, maxZ) {
    let best = null;
    for (const o of this.obs) {
      if (o.lane !== lane || o.z + o.depth < -0.3 || o.z > maxZ) continue;
      if (!best || o.z < best.z) best = o;
    }
    return best ? { o: best, tti: Math.max(0, best.z) / this.speed } : null;
  };
  Game.doAction = function (a) {
    const g = this, p = g.p;
    if (p.dead) return;
    if (a === 'L' || a === 'R') {
      const d = a === 'L' ? -1 : 1, nl = p.lane + d;
      if (nl < 0 || nl > 2) { g.shake(0.8); g.emit('edge'); p.lean = d * 0.5; return; }
      const th = g.threatIn(p.lane, 75);
      p.prevLane = p.lane; p.lane = nl; p.switchT = g.clock;
      const res = g.brain.recordSwitch(p.lane - d, d, !!th, th ? th.tti : null);
      p.lean = d;
      g.emit('lane', { dir: d, dodge: !!th, dirHit: res });
      if (res === false && !g.brain.blindOn) { g.fx.eyeMiss = 0.5; }
      if (res === true) g.fx.eyeFlash = 0.35;
    } else if (a === 'J') {
      if (p.slide > 0 && p.grounded) { p.slide = 0; }
      if (p.grounded) {
        const th = g.threatIn(p.lane, 40);
        const onB = th && th.o.type === 'barrier' && th.tti < 0.95;
        g.brain.recordJump(onB ? th.tti : 0, onB);
        p.vy = JUMP_V; p.y = 0.001; p.grounded = false; p.fast = false; p.jumpStart = g.clock; p.slide = 0;
        g.emit('jump');
      } else p.jumpBuf = 0.14;
    } else if (a === 'S') {
      if (p.grounded) {
        const th = g.threatIn(p.lane, 40);
        const onB = th && th.o.type === 'beam' && th.tti < 0.95;
        g.brain.recordSlide(onB ? th.tti : 0, onB);
        if (onB) th.o.slideTTI = th.tti;
        p.slide = SLIDE_T; p.slideStart = g.clock;
        g.emit('slide');
      } else { p.fast = true; p.slideBuf = 0.3; }
    }
  };

  /* ------------------------------------------------------------ the bot (attract mode + tests) */
  function laneBlocked(g, lane, z0, z1) {
    for (const o of g.obs) if (o.lane === lane && o.z <= z1 && o.z + o.depth >= z0) return o;
    return null;
  }
  Game.botStep = function () {
    const g = this, b = g.bot, p = g.p;
    if (!b || p.dead) return;
    const v = g.speed;
    if (b.random) { // chaotic bot: no habits
      if (rnd() < 0.012) g.doAction(['L', 'R', 'J', 'S'][Math.floor(rnd() * 4)]);
    }
    const th = g.threatIn(p.lane, 55);
    if (th) {
      const o = th.o, tti = th.tti;
      if (o.type === 'wall') {
        if (tti < (b.react || 0.7) || o.z < 22) {
          const z0 = Math.max(-1, o.z - 2), z1 = o.z + o.depth + 2;
          const opts = [];
          for (const d of [b.dodgeDir || -1, -(b.dodgeDir || -1)]) {
            const l1 = p.lane + d;
            if (l1 < 0 || l1 > 2) continue;
            if (!laneBlocked(g, l1, z0, z1)) opts.push(d);
            else {
              const l2 = l1 + d;
              if (l2 >= 0 && l2 <= 2 && !laneBlocked(g, l2, z0, z1) && !laneBlocked(g, l1, z0, z0 + 8)) opts.push(d);
            }
          }
          if (opts.length) g.doAction(opts[0] < 0 ? 'L' : 'R');
        }
      } else if (o.type === 'barrier') {
        if (tti < (b.jumpAt || 0.3) && p.grounded) g.doAction('J');
      } else if (o.type === 'beam') {
        if (tti < (b.jumpAt || 0.3) && p.grounded && p.slide <= 0) g.doAction('S');
      }
    } else if (b.restLane !== undefined && p.lane !== b.restLane && (!b.wander || rnd() < 0.5)) {
      const d = b.restLane > p.lane ? 1 : -1, nl = p.lane + d;
      if (!laneBlocked(g, nl, -1, 30)) g.doAction(d < 0 ? 'L' : 'R');
    } else if (b.wander && rnd() < 0.004) {
      g.doAction(rnd() < 0.5 ? 'L' : 'R');
    }
  };

  /* ------------------------------------------------------------ main step */
  Game.step = function (dt) {
    const g = this;
    g.clock += dt;
    const fx = g.fx;
    fx.shake = Math.max(0, fx.shake - dt * 5); fx.flash = Math.max(0, fx.flash - dt * 2.6);
    fx.chroma = Math.max(0, fx.chroma - dt * 3.2); fx.zoom = Math.max(0, fx.zoom - dt * 4);
    fx.eyeFlash = Math.max(0, fx.eyeFlash - dt); fx.eyeMiss = Math.max(0, fx.eyeMiss - dt);
    fx.speedPulse = Math.max(0, fx.speedPulse - dt * 1.4); fx.hurt = Math.max(0, fx.hurt - dt * 2);
    fx.freeze = 0;                                  // no hit-stop / slow motion of any kind

    if (g.state === 'dead') { g.deadT += dt; g.updateParticles(dt * 0.6); g.p.phase += dt * 4; if (g.deadT > 1.0 && !g.attract) g.toOver(); fx.glitch = Math.max(fx.glitch, 0.35 + 0.2 * Math.sin(g.clock * 40)); return; }
    if (g.state === 'over') { g.overT += dt; g.updateParticles(dt); fx.glitch = Math.max(0, fx.glitch - dt * 0.8); return; }
    if (g.state === 'paused') return;

    const p = g.p, br = g.brain;
    g.time += dt;
    g.featPre(dt);
    const baseV = g.speedAt(g.time);
    g.footK += ((p.foot ? 1 : 0) - g.footK) * (1 - Math.exp(-dt * 4));      // on foot: ~20% slower
    if (p.foot) {
      g.footT -= dt; g.bikeAnimT += dt; g.footSecs += dt;
      if (g.bikeAnimT < 0.8 && ((g.bikeAnimT * 30) | 0) !== (((g.bikeAnimT - dt) * 30) | 0)) { const sp = g.playerScreen(); g.burst(sp.x + (rnd() - .5) * 30, sp.y - 6, 3, ['#d9d2c0', '#b9b2a2', '#ffd27a'], 70, 0.6, 20); if (rnd() < .6) g.burst(sp.x, sp.y - 10, 2, ['#fff', '#ffd27a'], 150, 0.3, 200); }
      /* the bike never comes back by itself: only the BIKE KEY pickup restores it (features.js spawnExtras) */
    } else g.regainT += dt;
    { const tv = baseV * (1 - 0.2 * g.footK) * (1 + 0.32 * g.boostK);          // speed eases (no step on boost / hit / foot)
      g.speedS = g.speedS > 0 ? g.speedS + (tv - g.speedS) * (1 - Math.exp(-dt * 7)) : tv; g.speed = g.speedS; }           // turbo pads push the courier ~32% faster
    const v = g.speed, dz = v * dt;
    g.dist += dz;
    // speed tier juice
    const tier = Math.floor((baseV - 20) / 5);
    if (tier > g.speedTier) { g.speedTier = tier; fx.speedPulse = 1; g.emit('speedup'); if (!g.attract) g.pop('SPEED UP', g.W2 || 160, 62, '#e8e2d4', 1, 0.9); }

    if (g.bot) g.botStep();

    // ---- input
    while (g.q.length) g.doAction(g.q.shift());

    // ---- player physics
    if (!p.grounded) {
      p.vy -= GRAV * dt * (p.fast ? 2.6 : 1);
      p.y += p.vy * dt;
      if (p.y <= 0) {
        p.y = 0; p.vy = 0; p.grounded = true; p.fast = false; p.landT = g.clock; g.rampAir = false;
        g.emit('land');
        if (p.slideBuf > 0) { g.doAction('S'); }
        else if (p.jumpBuf > 0) { g.doAction('J'); }
      }
    }
    p.jumpBuf = Math.max(0, p.jumpBuf - dt); p.slideBuf = Math.max(0, p.slideBuf - dt);
    if (p.slide > 0) p.slide -= dt;
    p.inv = Math.max(0, p.inv - dt);
    // lane change: quick time-based ease-out (0.15 s, cubic) - snappy start, soft arrival, NO overshoot. Retargeting mid-move restarts from the current x.
    { const D = 0.15;
      if (p.mvLane !== p.lane) { p.mvFrom = p.x; p.mvLane = p.lane; p.mvT = 0; }
      if (p.mvT < D) { p.mvT = Math.min(D, p.mvT + dt); const u = p.mvT / D, e = 1 - (1 - u) * (1 - u) * (1 - u);
        p.x = p.mvFrom + (p.lane - p.mvFrom) * e; p.vx = (p.lane - p.mvFrom) * 3 * (1 - u) * (1 - u) / D; }
      else { p.x = p.lane; p.vx = 0; } }
    p.lean += (0 - p.lean) * (1 - Math.exp(-dt * 12));
    p.phase += dt * (v * 0.62);
    g.camX += ((p.x - 1) * 0.62 - g.camX) * (1 - Math.exp(-dt * 6));
    for (let l = 0; l < 3; l++) if (Math.abs(p.x - l) < 0.55) p.inLane[l] = g.clock;

    br.update(dt, p.lane);

    // ---- world scroll
    for (const o of g.obs) o.z -= dz;
    for (const c of g.coinsL) c.z -= dz;
    for (const c of g.chips) c.z -= dz;
    for (const w of g.waves) w.z -= dz;
    for (const s of [0, 1]) { for (const b of g.blds[s]) b.z -= dz; g.bz[s] -= dz; }
    for (const b of g.boards) b.z -= dz;
    g.nextBoardZ -= dz;

    // ---- spawning
    g.distToNext -= dz;
    if (g.distToNext <= 0) {
      const w = g.spawnWave(ZSPAWN);
      g.distToNext = (w.depth || 1) + g.waveGap();
    }
    for (const s of [0, 1]) while (g.bz[s] < ZFAR) g.spawnBuilding(s);
    if (g.nextBoardZ <= 0) { g.spawnBoard(); g.nextBoardZ = 62 + rnd() * 30; }

    // ---- blind timer
    fx.glitch = Math.max(0, fx.glitch - dt * 2.5);
    if (g.blindT > 0) {
      g.blindT -= dt;
      { const el = g.jamTotal - g.blindT; fx.glitch = Math.max(fx.glitch, el < 0.7 ? 0.7 - el * 0.6 : 0.1 + (Math.sin(g.clock * 5.3) > 0.9 ? 0.4 : 0) + (g.blindT < 1 ? 0.25 : 0)); }
      if (g.blindT <= 0) { g.blindT = 0; br.unblind(); g.emit('blindEnd'); g.taunt.next = 0; g.pushTicker('REBOOTING... I REMEMBER NOTHING'); fx.flash = 0.5; }
    }

    // ---- wave sampling (city checks its guess)
    for (const w of g.waves) {
      if (!w.sampled && w.z <= SAMPLE_Z) {
        w.sampled = true;
        const L = p.lane;
        const hit = br.recordSample(w.c0, L, w.bet, w.conf);
        w.hit = hit; w.at = L;
        const lw = g.waveLog[w.id]; if (lw) { lw.at = L; lw.hit = hit; }
        if (hit === true) { fx.eyeFlash = 0.4; g.emit('predHit'); }
        else if (hit === false) {
          fx.eyeMiss = 0.5;
          if (w.conf > 0.5 && !g.attract && w.mode !== 'random') {
            g.addCombo(2); g.score += CX * 200 * g.mult; g.pop('OUTSMARTED +' + cmp(CX * 200 * g.mult), g.W2 || 160, 78, '#ffe14d', 1, 1.1); g.emit('outplay');
          }
        }
      }
    }
    g.waves = g.waves.filter(w => w.z > -30);

    // ---- collisions & near misses
    g.collide(dt);

    // ---- letters, ramps, pads, tokens, missions, stages (features.js)
    g.featStep(dt, dz);

    // ---- pickups
    for (const c of g.coinsL) {
      if (c.taken) continue;
      if (g.magT > 0 && c.z < 16 && c.z > -1 && !g.attract) { const k = 1 - Math.exp(-dt * (5 + (16 - c.z) * .35)); c.lane += (p.x - c.lane) * k; c.y += ((p.y + .55) - c.y) * k * .7; }   // magnet pulls cash toward the rider
      if (Math.abs(c.z) < 0.9 && Math.abs(p.x - c.lane) < 0.62 && Math.abs(c.y - (p.y + 0.55)) < 0.85) {
        c.taken = true; g.coins++; g.addCombo(0.5);
        g.score += CX * 25 * g.mult * g.coinMul * (g.x2T > 0 ? 2 : 1); br.log.coins++; g.mEvent('coins');
        const sp = g.playerScreen();
        g.burst(sp.x, sp.y - 14, 6, ['#ffe14d', '#fff7c2', '#ffb347'], 70, 0.4, 100);
        g.emit('coin');
      }
    }
    for (const c of g.chips) {
      if (c.taken) continue;
      if (Math.abs(c.z) < 1.1 && Math.abs(p.x - c.lane) < 0.7 && Math.abs(c.y - (p.y + 0.55)) < 1.0) { c.taken = true; g.grabChip(); }
    }

    // ---- combo / score
    if (g.comboT > 0) { g.comboT -= dt; if (g.comboT <= 0) { g.combo = 0; g.comboP = 0; } }
    const pred = br.acc;
    const chaos = g.blindT > 0 ? 2 : (pred < 0.3 && br.accN >= 4) ? 2 : (pred < 0.45 && br.accN >= 4) ? 1.5 : 1;
    g.chaos = chaos;
    g.mult = Math.min(8, 1 + Math.floor(g.combo / 4)) * chaos * (g.boostT > 0 ? 2 : 1);
    // cash is earned only by what you pick up and pull off (no passive income); SCORE is distance-based, see G.calcPts

    // ---- taunts
    g.taunt.t += dt; g.ticker.t += dt;
    g.taunt.next -= dt;
    if (g.taunt.next <= 0) {
      g.taunt.text = br.taunt({ pred: br.predPct(), blind: g.blindT > 0, combo: g.combo });
      g.taunt.t = 0; g.taunt.next = 3.2 + rnd() * 1.4;
      g.ticker = { text: g.taunt.text, t: 0 };
      g.emit('taunt');
    }
    for (const b of g.boards) if (!b.text && b.z < 64) { b.text = g.taunt.text; b.flick = 0.4; }

    // ---- audio intensity
    g.heatStep(dt);    // wanted level (g.heat / g.stars / g.threat) comes from risky riding, not from time

    // ---- cull
    g.obs = g.obs.filter(o => o.z + o.depth > -14);
    g.coinsL = g.coinsL.filter(c => c.z > -8 && !c.taken);
    g.chips = g.chips.filter(c => c.z > -8 && !c.taken);
    for (const s of [0, 1]) g.blds[s] = g.blds[s].filter(b => b.z + b.depth > -16);
    g.boards = g.boards.filter(b => b.z > -14);
    g.updateParticles(dt);

    // dust
    if (p.grounded && !p.dead && rnd() < dt * 22) {
      const sp = g.playerScreen();
      g.parts.push({ x: sp.x + (rnd() - 0.5) * 8, y: sp.y - 1, vx: (rnd() - 0.5) * 20, vy: -rnd() * 14, t: 0, life: 0.3, c: p.slide > 0 ? '#ffe14d' : '#7d5cc8', g: 0, s: 1 });
    }
  };

  Game.updateParticles = function (dt) {
    for (const q of this.parts) { q.t += dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vy += q.g * dt; }
    this.parts = this.parts.filter(q => q.t < q.life);
    for (const q of this.pops) { q.t += dt; q.y += q.vy * dt; q.vy *= 0.92; }
    this.pops = this.pops.filter(q => q.t < q.life);
  };

  Game.grabChip = function () {
    const g = this, br = g.brain;
    br.blind();
    g.jamTotal = 6.5 + 1.5 * (g.up.jam || 0) + (g.perk.jam || 0); g.blindT = g.jamTotal; g.jams++; g.fx.glitch = 1; g.fx.flash = 1; g.fx.chroma = 1; g.fx.freeze = 0.07; g.shake(2.5);
    for (const w of g.waves) w.sampled = true; // wipe pending bets
    g.addCombo(3); g.score += CX * 1000 * Math.max(1, g.mult); g.mEvent('jam');
    g.pop('SIGNAL JAMMED', g.W2 || 160, 66, '#ff2fb3', 2, 1.4);
    g.pop('SIGNAL JAMMED · CASH x2', g.W2 || 160, 86, '#19f3ff', 1, 1.6);
    g.taunt.text = br.taunt({ pred: 0, blind: true, combo: g.combo }); g.taunt.t = 0; g.taunt.next = 1.6;
    g.ticker = { text: 'SIGNAL JAMMED - I CAN\'T SEE YOU', t: 0 };
    for (const b of g.boards) { b.text = g.taunt.text; b.flick = 0.6; }
    g.emit('chip');
  };

  Game.collide = function (dt) {
    const g = this, p = g.p;
    for (const o of g.obs) {
      const inLaneNow = Math.abs(p.x - o.lane) < 0.56;
      const zOverlap = o.z <= 0.55 && o.z + o.depth >= -0.55;
      // near-miss: left the lane at the last moment
      if (!o.judgedF && o.z <= 0.6) {
        o.judgedF = true;
        if (!inLaneNow && Math.abs(p.x - o.lane) < 1.9 && g.clock - p.inLane[o.lane] < 0.34 && p.lane !== o.lane) g.nearMiss(o, 'late dodge');
      }
      if (zOverlap && inLaneNow && !p.dead) {
        let hit = false;
        if (o.type === 'wall') hit = !(g.rampAir && p.y > WALL_H[o.vis] + 0.15);     // a ramp launch can fly over traffic
        else if (o.type === 'barrier') { o.minClear = Math.min(o.minClear, p.y - o.h); hit = p.y < o.h - 0.05; }
        else if (o.type === 'beam') { hit = !(p.slide > 0 && p.y < 0.12) && !(g.rampAir && p.y > 2.45); if (!hit && p.slide > 0) o.slid = true; }
        if (hit && g.cloakT > 0 && o.type === 'wall' && o.vis === 'police') hit = false;    // Shadow: police look straight through you
        if (hit && p.inv <= 0) { g.hit(o); if (p.dead) return; }
      }
      if (!o.judgedB && o.z + o.depth < -0.6) {
        o.judgedB = true;
        if (!p.dead && !g.attract) {
          if (o.type === 'wall' && o.vis === 'police') { g.copsDodged++; g.mEvent('cops'); }
          else if (o.type === 'barrier' && o.minClear !== Infinity) g.mEvent('jump');
          else if (o.type === 'beam' && o.slid) g.mEvent('slide');
        }
        if (o.type === 'barrier' && o.minClear !== Infinity && o.minClear < 0.3 && !p.dead) g.nearMiss(o, 'jump');
        else if (o.type === 'beam' && o.slid && o.slideTTI !== null && o.slideTTI < 0.2 && !p.dead) g.nearMiss(o, 'slide');
      }
    }
  };

  Game.nearMiss = function (o, how) {
    const g = this;
    g.brain.log.nearMiss++; g.nearCount++; g.addHeat(0.25);
    g.addCombo(2); g.mEvent('near');
    g.nearStreak = g.clock - g.lastNearT < 6 ? Math.min(8, g.nearStreak + 1) : 1; g.lastNearT = g.clock;
    const pts = CX * (250 + 125 * (g.nearStreak - 1)) * g.mult * (1 + (g.perk.near || 0)); g.score += pts;
    const sp = g.playerScreen();
    g.pop('NEAR MISS' + (g.nearStreak > 1 ? ' x' + g.nearStreak : '') + ' +' + cmp(pts), sp.x, sp.y - 44, '#ff2fb3', 1, 0.9);
    g.fx.chroma = 0.8; g.fx.freeze = 0.035; g.shake(1.2); g.fx.zoom = 0.6;
    g.burst(sp.x, sp.y - 12, 10, ['#ff2fb3', '#fff', '#19f3ff'], 90, 0.4, 0);
    g.emit('near', { how });
  };

  Game.hit = function (o) {
    const g = this, p = g.p;
    if (g.shieldT > 0 && !g.attract && p.inv <= 0) {                 // shield: absorbs exactly one hit, then a short grace window
      g.shieldT = 0; p.inv = 1.3; g.shake(2); g.fx.flash = 0.5; g.fx.freeze = 0.05; g.fx.zoom = 0.8;
      g.addHeat(0.4 + (o && o.vis === 'police' ? 0.3 : 0));
      const sp = g.playerScreen(); g.pop('SHIELD BROKE', sp.x, sp.y - 40, '#8fc3e8', 1, 0.9); g.emit('shieldhit'); return;
    }
    // side-swipe? bounce back to the lane we came from instead of dying
    const lateral = Math.abs(p.x - p.lane) > 0.1 || (g.clock - p.switchT < 0.12);
    if (lateral && p.prevLane !== p.lane && !laneBlocked(g, p.prevLane, -1.2, 1.2)) {
      p.lane = p.prevLane; p.inv = 0.7; g.brain.log.bumps++; g.addHeat(0.6 + (o && o.vis === 'police' ? 0.3 : 0));
      g.combo = 0; g.comboP = 0; g.comboT = 0;
      g.shake(3); g.fx.hurt = 1; g.fx.freeze = 0.06; g.fx.chroma = 0.7;
      const sp = g.playerScreen(); g.pop('BUMP!', sp.x, sp.y - 40, '#ff3b4e', 1, 0.8);
      g.burst(sp.x, sp.y - 12, 12, ['#ff3b4e', '#ffb347', '#fff'], 100, 0.4, 60);
      g.emit('bump');
      return;
    }
    g.addHeat(0.9 + (o && o.vis === 'police' ? 0.3 : 0));            // a real crash into traffic / a roadblock
    if (g.god) { p.inv = 0.5; g.emit('godhit'); g.godHits = (g.godHits || 0) + 1; return; }
    if (g.perk.autododge && !g.autoUsed) { g.autoUsed = true; g.bailOut(o, 'AUTO-DODGE'); return; }
    if (g.up.bail > 0 && !g.bailUsed) { g.bailOut(o); return; }
    if (!p.foot) { g.loseBike(o); return; }       // first hit: lose the ride, keep running
    g.die(o);                                     // second hit on foot: busted
  };

  /* Lose-the-ride: the first unavoided hit wrecks the bike; the rider keeps running on foot (slower, heat up). Only the BIKE KEY pickup (never a timer) gets it back. */
  Game.FOOT_MAX = 22;
  Game.loseBike = function (o) {
    const g = this, p = g.p;
    p.foot = true; g.addHeat(1); g.footT = g.FOOT_MAX; g.bikeAnimT = 0; g.regainT = 99; g.bikesLost++; g.bikeAt = g.time + 30 + rnd() * 15;   // first bike key no sooner than 30-45 s after the wreck
    p.inv = 1.5; g.combo = 0; g.comboP = 0; g.comboT = 0; p.slide = 0; p.slideBuf = 0;
    if (o) g.obs = g.obs.filter(ob => ob !== o);
    g.shake(4.5); g.fx.hurt = 1; g.fx.freeze = 0.1; g.fx.flash = 0.7; g.fx.chroma = 0.8;
    const sp = g.playerScreen();
    g.burst(sp.x, sp.y - 12, 34, ['#ffd27a', '#e8a24c', '#fff', '#b8503a'], 170, 0.8, 140);
    g.burst(sp.x, sp.y - 6, 18, ['#d9d2c0', '#b9b2a2', '#8c867a'], 80, 0.9, 10);
    g.pop('BIKE WRECKED!', g.W2 || 160, 60, '#ff6a4a', 2, 1.6);
    g.emit('bikelost');
  };
  Game.regainBike = function (how) {
    const g = this, p = g.p; if (!p.foot) return;
    p.foot = false; g.regainT = 0; g.footT = 0; p.inv = Math.max(p.inv, 1.0);
    for (const it of g.items) if (it.kind === 'bike') it.taken = true;
    g.fx.flash = 0.45; g.fx.zoom = 0.8; g.fx.speedPulse = 1;
    const sp = g.playerScreen(); g.burst(sp.x, sp.y - 14, 22, ['#79b95f', '#fff', '#f0b24a'], 120, 0.6, 40);
    g.pop(how === 'pickup' ? 'BIKE BACK! +' + cmp(CX * 40) : 'BIKE BACK!', g.W2 || 160, 60, '#79b95f', 2, 1.6);
    if (how === 'pickup') g.score += CX * 40;
    g.emit('bikeback', { how });
  };

  /* Bail-out upgrade: once per run the crash is cancelled, the whole obstacle wave ahead is cleared */
  Game.bailOut = function (o, label) {
    const g = this, p = g.p;
    if (!label) g.bailUsed = true; g.bails = (g.bails || 0) + 1;
    const zEnd = (o ? o.z + o.depth : 0) + 5;
    g.obs = g.obs.filter(ob => ob.z + ob.depth < -1.5 || ob.z > zEnd);
    p.inv = 2.2; g.combo = 0; g.comboP = 0; g.comboT = 0; if (g.tkSetback) g.tkSetback();
    g.shake(3.5); g.fx.hurt = 1; g.fx.freeze = 0.08; g.fx.flash = 0.6;
    g.pop(label || 'BAILED OUT', g.W2 || 160, 60, '#ffffff', 2, 1.6);
    g.emit('bail');
  };

  Game.die = function (o) {
    const g = this, p = g.p;
    p.dead = true; g.state = 'dead'; g.deadT = 0;
    g.fx.freeze = 0.14; g.shake(5); g.fx.flash = 1; g.fx.chroma = 1; g.fx.glitch = 0.8;
    const sp = g.playerScreen();
    g.burst(sp.x, sp.y - 14, 46, ['#ffd27a', '#e8a24c', '#fff', '#c9c4b5', '#b8503a'], 150, 0.9, 140);
    g.killer = o ? o.type : 'wall'; g.killerObj = o || null; g.killerVis = o && o.vis || null;
    g.emit('crash');
    g.finalScore = Math.floor(g.score);
    g.newBest = g.finalScore > g.best;
    if (g.newBest) { g.best = g.finalScore; try { localStorage.setItem('sl_best', String(g.best)); } catch (e) {} }
    const pk = g.brain.log.peakPred;
    if (pk > g.bestPred) { g.bestPred = pk; try { localStorage.setItem('sl_bestpred', String(pk)); } catch (e) {} }
    g.finalPts = g.calcPts ? g.calcPts() : Math.floor(g.dist);
    g.newBestPts = g.finalPts > g.bestPts;
    if (g.newBestPts) { g.bestPts = g.finalPts; try { localStorage.setItem('sl_bestpts', String(g.bestPts)); } catch (e) {} }
    g.summary = g.brain.summary();
  };
  Game.toOver = function () { this.state = 'over'; this.overT = 0; this.emit('over'); };

  global.Game = Game;
})(window);
