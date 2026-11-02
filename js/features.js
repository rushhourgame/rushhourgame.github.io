/* RUSH HOUR (was Signal Lost) — road features layered on the core sim: collectible letters (spell a word), rotating missions,
   ramps / turbo pads / double-cash tokens, stage progression, daily challenge and a rival courier. */
(function (global) {
  'use strict';
  const G = global.Game, rnd = Math.random;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const fmt = n => Math.floor(n).toLocaleString('en-US');
  const CX = (global.Save && global.Save.CASH_X) || 12, cmp = n => global.Save ? global.Save.compact(n) : fmt(n);

  const WORDS = ['LAGOS', 'NAIJA', 'ABUJA', 'RUSH', 'DANFO', 'JOLLOF', 'HUSTLE', 'EKO'];
  const RIVALS = ['Chidi', 'Tunde', 'Amaka', 'Bayo', 'Zainab', 'Emeka', 'Kemi', 'Sule'];
  const POOL = [
    { k: 'coins',   text: n => 'Grab ' + n + ' cash',            n: [25, 38, 52],  r: 1200 },
    { k: 'cops',    text: n => 'Dodge ' + n + ' police cars',     n: [4, 7, 10],    r: 1500 },
    { k: 'near',    text: n => n + ' near misses',                n: [3, 5, 7],     r: 1800 },
    { k: 'dist',    text: n => 'Run ' + fmt(n) + ' m',            n: [450, 750, 1100], r: 1000 },
    { k: 'letters', text: n => 'Collect ' + n + ' letters',       n: [2, 3, 4],     r: 1400 },
    { k: 'ramp',    text: n => 'Launch off ' + n + ' ramp' + (n > 1 ? 's' : ''), n: [1, 2, 3], r: 1600 },
    { k: 'pad',     text: n => 'Hit ' + n + ' turbo pads',        n: [2, 3, 4],     r: 1300 },
    { k: 'jump',    text: n => 'Jump ' + n + ' barriers',         n: [4, 6, 9],     r: 1200 },
    { k: 'slide',   text: n => 'Slide under ' + n + ' gantries',  n: [3, 5, 7],     r: 1200 },
    { k: 'jam',     text: () => 'Grab a signal jammer',           n: [1, 1, 1],     r: 2000 }
  ];
  const DAILY = [
    { k: 'coins', n: 90,  text: 'Grab 90 cash in one run' },
    { k: 'near',  n: 12,  text: 'Pull 12 near misses in one run' },
    { k: 'dist',  n: 2600, text: 'Run 2,600 m in one run' },
    { k: 'words', n: 1,   text: 'Spell a full word in one run' },
    { k: 'ramp',  n: 4,   text: 'Launch off 4 ramps in one run' },
    { k: 'time',  n: 150, text: 'Survive 2:30 in one run' },
    { k: 'cops',  n: 18,  text: 'Dodge 18 police cars in one run' }
  ];
  const DAILY_REWARD = 3000 * ((global.Save && global.Save.CASH_X) || 12);
  G.POOL = POOL; G.DAILY_REWARD = DAILY_REWARD;

  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  // SCORE = distance-based points (separate from CASH, the money you pick up and bank)
  G.calcPts = function () { const g = this; return Math.floor(g.dist) + 25 * (g.nearCount | 0) + 10 * (g.copsDodged | 0) + 500 * (g.wordsDone | 0) + 250 * (g.missionsDone | 0); };
  G.dailyDef = function () {
    const day = global.Save ? global.Save.today() : new Date().toDateString();
    return DAILY[hashStr('signal-lost:' + day) % DAILY.length];
  };
  G.dailyProgress = function () {
    const g = this, d = g.daily; if (!d) return 0;
    const v = { coins: g.coins, near: g.nearCount, dist: g.dist, words: g.wordsDone, ramp: g.rampCount, time: g.time, cops: g.copsDodged }[d.k] || 0;
    return Math.min(d.n, Math.floor(v));
  };

  /* ---------------------------------------------------------------- missions */
  G.makeMission = function () {
    const g = this, active = g.missions.map(m => m.k);
    const opts = POOL.filter(d => active.indexOf(d.k) < 0 && !(d.k === 'jam' && g.blindT > 0));
    const d = pick(opts), tier = Math.min(2, Math.floor(g.missionsDone / 3));
    const n = d.n[tier];
    return { k: d.k, n, p: 0, r: Math.round(d.r * CX * (1 + 0.15 * tier) / 50) * 50, text: d.text(n), done: false, doneT: 0 };
  };
  G.mEvent = function (k, amt) {
    const g = this; if (g.attract || g.state !== 'play') return;
    for (const m of g.missions) {
      if (m.k !== k || m.done) continue;
      m.p = Math.min(m.n, m.p + (amt === undefined ? 1 : amt));
      if (m.p >= m.n) g.completeMission(m);
    }
  };
  G.completeMission = function (m) {
    const g = this; m.done = true; m.doneT = 0; g.missionsDone++;
    m.r = Math.round(m.r * (1 + (g.perk.mission || 0))); g.score += m.r; g.addCombo(2);
    g.pop('MISSION COMPLETE  +' + cmp(m.r), g.W2 || 160, 70, '#f0b24a', 1.1, 1.8);
    g.emit('mission', { n: g.missionsDone });
  };

  /* ---------------------------------------------------------------- letters / word */
  G.nextLetter = function () { return this.word[this.wordIdx]; };
  G.collectLetter = function (it) {
    const g = this; it.taken = true;
    g.wordIdx++; g.lettersGot++; g.addCombo(1); g.score += CX * 150 * g.mult * (1 + (g.perk.letters || 0)); g.mEvent('letters');
    if (g.perk.doubleLetters && g.wordIdx < g.word.length) { g.wordIdx++; g.lettersGot++; }
    g.emit('letter', { i: g.wordIdx - 1, ch: it.ch });
    if (g.wordIdx >= g.word.length) {
      g.wordsDone++; const bonus = CX * (3000 + 750 * (g.wordsDone - 1));
      g.score += bonus; g.addCombo(4);
      g.pop(g.word + '!  +' + cmp(bonus), g.W2 || 160, 60, '#f0b24a', 1.4, 2.2);
      g.emit('word', { word: g.word, n: g.wordsDone });
      g.wordFlash = 2.4; g.lastWord = g.word;
      let w = pick(WORDS); if (w === g.word) w = WORDS[(WORDS.indexOf(w) + 1) % WORDS.length];
      g.word = w; g.wordIdx = 0; g.nextLetterAt = g.time + 6;
    } else g.nextLetterAt = g.time + (6.5 + rnd() * 3.5) * (g.perk.doubleLetters ? 0.5 : 1);
  };

  /* ---------------------------------------------------------------- spawning (called from spawnWave) */
  G.spawnExtras = function (wave, z, free, fl) {
    const g = this, v = g.speed;
    if (g.attract && !g.featAttract) return;
    const others = free.filter(l => l !== fl);
    const alive = k => g.items.some(i => i.kind === k && !i.taken && i.z > 0);
    if (g.p && g.p.foot && g.time >= g.bikeAt && !alive('bike')) { g.bikeAt = g.time + 25 + rnd() * 10; g.items.push({ kind: 'bike', lane: others.length ? pick(others) : fl, z: z + (others.length ? 6 : 15), y: 0.95, taken: false }); }   // the BIKE KEY pickup: only while on foot; first one 30-45 s after the wreck, then every 25-35 s until collected
    if (g.tk && g.tkSpawn(wave, z, free, fl, others, alive)) return;
    // 1) the next letter of the word
    if (g.time >= g.nextLetterAt && !alive('letter')) {
      const lane = others.length ? pick(others) : fl;
      g.items.push({ kind: 'letter', lane, z: others.length ? z + 4 : z + 14, y: 0.95, ch: g.nextLetter(), taken: false });
      g.nextLetterAt = g.time + 5;           // pushed back properly when collected
    }
    // 2) a ramp: launch over traffic, with a cash arc in the air
    if (g.time >= g.nextRampAt && !wave.noCoins) {
      g.nextRampAt = g.time + 20 + rnd() * 14;
      g.items.push({ kind: 'ramp', lane: fl, z: z + 0.5, depth: 3.4, used: false, taken: false });
      const V = g.JUMP_V * 1.55;
      for (let i = 1; i <= 7; i++) { const t = i * 0.115; g.coinsL.push({ lane: fl, z: z + 0.9 + v * t, y: V * t - g.GRAV * t * t / 2 + 0.55, taken: false, kind: 'coin', ph: rnd() * 6 }); }
      wave.noCoins = true; wave.depth = (wave.depth || 1) + v * 0.55;
    } else if (g.time >= g.nextPadAt) {
      // 3) a turbo pad on the road
      const lane = others.length && rnd() < 0.6 ? pick(others) : fl;
      g.nextPadAt = g.time + 13 + rnd() * 10;
      g.items.push({ kind: 'pad', lane, z: z + (lane === fl ? 13 : 2), depth: 4.6, used: false, taken: false });
    } else if (g.time >= g.nextTokenAt) {
      // 4) double cash token
      const lane = others.length ? pick(others) : fl;
      g.nextTokenAt = g.time + 22 + rnd() * 14;
      const tk = ['x2', 'shield', 'magnet'][(g.tokSeq = ((g.tokSeq || 0) + 1) % 3)];      // power-up variety: double cash, shield (absorbs one hit), magnet (pulls cash in)
      g.items.push({ kind: tk, lane, z: z + (others.length ? 6 : 15), y: 0.95, taken: false });
    }
  };


  /* ---------------------------------------------------------------- location unlock task (belongs to the NEXT location; progress lives in Save) */
  G.tkInit = function (opts) {
    const g = this; g.tk = null;
    if (g.attract || !global.Save) return;
    const nt = global.Save.activeTask(g.loc); if (!nt) return;
    const k = nt.task.kind, r = rnd;
    g.tk = { id: nt.id, kind: k, nextAt: k === 'keys' ? 11 + r() * 8 : k === 'vault' ? 22 + r() * 8 : k === 'word' ? 10 + r() * 6 : k === 'set' ? 16 + r() * 8 : 9 + r() * 5,
      carry: false, dropAt: 0, dropOut: false, delivered: 0, acc: 0, bestCombo: 0, flash: 0, doneFlash: 0 };
    if (opts && opts.tkAt != null) g.tk.nextAt = opts.tkAt;
  };
  /* what the HUD shows: {title, p, n} */
  G.tkInfo = function () {
    const g = this, tk = g.tk; if (!tk) return null;
    const L = global.Save.LOCS[tk.id], t = L.task, S = global.Save;
    let p = S.locProgress(tk.id);
    if (t.kind === 'parcels1') p = Math.max(p, tk.delivered);
    if (t.kind === 'combo') p = Math.max(p, Math.min(t.n, g.combo));
    if (t.kind === 'stars') p = Math.min(t.n, p + tk.acc);
    const done = S.taskDone(tk.id) || p >= t.n;
    return { loc: L.name, title: t.title, p, n: t.n, kind: t.kind, done, carry: tk.carry, word: t.word, flash: tk.flash };
  };
  function tkProgressed(g, label, amt) {
    const S = global.Save, tk = g.tk, L = S.LOCS[tk.id], t = L.task; tk.flash = 1.6;
    const done = S.taskDone(tk.id);
    if (done) { tk.doneFlash = 3; g.pop('TASK DONE  ' + L.name.toUpperCase() + ' READY', g.W2 || 160, 60, '#f0b24a', 1.2, 2.4); g.addCombo(2); g.emit('taskdone', { id: tk.id }); }
    else { g.pop(label + '  ' + S.locProgress(tk.id) + '/' + t.n, g.W2 || 160, 66, '#f0b24a', 1.15, 1.6); g.emit('task', { id: tk.id }); }
  }
  G.tkPickup = function (it) {
    const g = this, tk = g.tk, S = global.Save; it.taken = true; if (!tk) return;
    if (it.kind === 'key') { S.taskAdd(tk.id, 1); g.score += CX * 250; g.addCombo(1); tkProgressed(g, 'KEY FOUND', 1); }
    else if (it.kind === 'lockbox') { S.taskAdd(tk.id, 1); g.score += CX * 800; g.addCombo(2); tkProgressed(g, 'LOCKBOX OPEN', 1); }
    else if (it.kind === 'tletter') { S.taskAdd(tk.id, 1); g.score += CX * 200; g.addCombo(1); tkProgressed(g, S.LOCS[tk.id].task.word.charAt(Math.max(0, S.locProgress(tk.id) - 1)), 1); }
    else if (it.kind === 'relic') { S.taskAdd(tk.id, it.v); g.score += CX * 600; g.addCombo(2); tkProgressed(g, S.LOCS[tk.id].task.items[it.v].toUpperCase(), 1); }
    else if (it.kind === 'parcel') { tk.carry = true; tk.dropAt = g.time + 5; tk.dropOut = false; g.addCombo(1); g.pop('PARCEL  RIDE TO THE DROP', g.W2 || 160, 66, '#e8d29a', 1.15, 1.8); g.emit('parcel'); }
  };
  G.tkDeliver = function () {
    const g = this, tk = g.tk, S = global.Save; if (!tk) return;
    tk.carry = false; tk.dropOut = false; tk.delivered++; tk.nextAt = g.time + 5 + rnd() * 3; g.score += CX * 500; g.addCombo(2);
    S.taskAdd(tk.id, S.LOCS[tk.id].task.kind === 'parcels1' ? tk.delivered : 1); tkProgressed(g, 'DELIVERED', 1);
  };
  G.tkSetback = function () {       // bail-out / auto-dodge / death while holding a parcel
    const g = this, tk = g.tk; if (!tk || !tk.carry) return;
    tk.carry = false; tk.dropOut = false; tk.nextAt = g.time + 6; g.items = g.items.filter(i => i.kind !== 'drop');
    if (global.Save.LOCS[tk.id].task.kind === 'parcels1') tk.delivered = 0;
    g.pop('PARCEL LOST', g.W2 || 160, 66, '#d7dbe0', 1.1, 1.6);
  };
  G.tkStep = function (dt) {
    const g = this, tk = g.tk, S = global.Save; if (!tk) return;
    if (tk.flash > 0) tk.flash -= dt;
    if (tk.doneFlash > 0) tk.doneFlash -= dt;
    const t = S.LOCS[tk.id].task;
    if (t.kind === 'stars' && !S.taskDone(tk.id) && g.state === 'play') {
      if (Math.min(5, Math.max(1, Math.ceil((g.threat || 1) / 2))) >= 5) { tk.acc += dt; if (tk.acc >= 1) { const w = Math.floor(tk.acc); tk.acc -= w; if (S.taskAdd(tk.id, w) && S.taskDone(tk.id)) tkProgressed(g, 'HEAT', 1); } }
    } else if (t.kind === 'combo' && !S.taskDone(tk.id)) {
      if (g.combo > tk.bestCombo) { tk.bestCombo = g.combo; if (g.combo >= t.n) { S.taskAdd(tk.id, g.combo); tkProgressed(g, 'COMBO', 1); } }
    }
  };
  G.tkRival = function () { const g = this, tk = g.tk, S = global.Save; if (tk && tk.kind === 'rival' && !S.taskDone(tk.id)) { S.taskAdd(tk.id, 1); tkProgressed(g, 'RIVAL BEATEN', 1); } };
  G.tkSpawn = function (wave, z, free, fl, others, alive) {
    const g = this, tk = g.tk, S = global.Save, v = g.speed; if (!tk || g.attract) return false;
    const lane = others.length ? pick(others) : fl, zz = others.length ? z + 4 : z + 14;
    if (tk.carry && tk.dropOut && !alive('drop')) { tk.dropOut = false; tk.dropAt = g.time + 0.5; }   // missed the ring: it comes round again, parcel is not lost
    if (tk.carry && !tk.dropOut && g.time >= tk.dropAt) {
      tk.dropOut = true; g.items.push({ kind: 'drop', lane: fl, z: z + 2, depth: 3.6, taken: false }); return false;
    }
    if (S.taskDone(tk.id) || g.time < tk.nextAt) return false;
    const k = tk.kind;
    if (k === 'keys') { if (alive('key')) return false; tk.nextAt = g.time + 28 + rnd() * 20; g.items.push({ kind: 'key', lane, z: zz, y: 0.95, taken: false }); }
    else if (k === 'word') { if (alive('tletter')) return false; tk.nextAt = g.time + 17 + rnd() * 9; g.items.push({ kind: 'tletter', lane, z: zz, y: 0.95, ch: S.LOCS[tk.id].task.word.charAt(Math.min(4, S.locProgress(tk.id))), taken: false }); }
    else if (k === 'set') {
      if (alive('relic')) return false; const mask = S.data.lp[tk.id] || 0, miss = [0, 1, 2].filter(i => !(mask & (1 << i))); if (!miss.length) return false;
      tk.nextAt = g.time + 24 + rnd() * 14; g.items.push({ kind: 'relic', lane, z: zz, y: 0.95, v: pick(miss), taken: false });
    } else if (k === 'parcels' || k === 'parcels1') {
      if (tk.carry || alive('parcel') || alive('drop')) return false; tk.nextAt = g.time + 4; g.items.push({ kind: 'parcel', lane, z: zz, y: 0.95, taken: false });
    } else if (k === 'vault') {
      if (alive('lockbox') || wave.noCoins) return false; tk.nextAt = g.time + 36 + rnd() * 16; g.nextRampAt = Math.max(g.nextRampAt, g.time + 18);
      g.items.push({ kind: 'ramp', lane: fl, z: z + 0.5, depth: 3.4, used: false, taken: false });
      const V = g.JUMP_V * 1.55;
      for (let i = 1; i <= 7; i++) { const t = i * 0.115, y = V * t - g.GRAV * t * t / 2 + 0.55, zc = z + 0.9 + v * t; if (i === 4) g.items.push({ kind: 'lockbox', lane: fl, z: zc, y, taken: false }); else g.coinsL.push({ lane: fl, z: zc, y, taken: false, kind: 'coin', ph: rnd() * 6 }); }
      wave.noCoins = true; wave.depth = (wave.depth || 1) + v * 0.55; return true;
    }
    return false;
  };

  /* ---------------------------------------------------------------- per-step logic */
  G.featReset = function (opts) {
    const g = this;
    g.items = []; g.word = opts && opts.word || (global.Save && global.Save.data.stats.runs === 0 ? 'LAGOS' : pick(WORDS)); g.wordIdx = 0; g.wordsDone = 0; g.lettersGot = 0; g.wordFlash = 0; g.lastWord = '';
    g.nextLetterAt = 5; g.nextPadAt = 12; g.nextRampAt = 22; g.nextTokenAt = 34;
    g.boostT = 0; g.boostK = 0; g.x2T = 0; g.shieldT = 0; g.magT = 0; g.headUsed = false; g.tokSeq = Math.floor(Math.random() * 3); g.copsDodged = 0; g.rampCount = 0; g.padCount = 0; g.coinMul = 1 + 0.25 * (g.up.cash || 0) + (g.perk.cash || 0); g.wheelNext = 12; g.wheelT = 0; g.cloakNext = 10; g.cloakT = 0; g.cloakMax = 6;
    g.nearStreak = 0; g.lastNearT = -99;
    g.missionsDone = 0; g.missions = [];
    for (let i = 0; i < 3; i++) g.missions.push(g.makeMission());
    g.daily = g.dailyDef(); g.dailyDone = !!(global.Save && global.Save.data.daily.done && global.Save.data.daily.d === global.Save.today());
    g.loc = opts && opts.loc != null ? opts.loc : (g.loc || 0); if (!global.STAGES[g.loc]) g.loc = 0;
    g.stage = g.loc; g.stageN = 0; g.banner = { idx: g.loc, t: 0 };       // a run never changes location
    g.tkInit(opts);
    if (!g.attract) g.emit('stage', { idx: g.loc, n: 0 });
    const best = global.Save ? (global.Save.data.stats.bestPts || 0) : 0;
    g.rivalN = 0; g.rivalRate = Math.max(22, Math.min(70, best / 105)); g.rivalBeaten = false; g.rivalName = RIVALS[Math.floor(rnd() * RIVALS.length)];
    g.rivalScore = 0;
  };
  G.featPre = function (dt) {   // before speed is computed
    const g = this;
    g.boostT = Math.max(0, g.boostT - dt); g.x2T = Math.max(0, g.x2T - dt); g.shieldT = Math.max(0, (g.shieldT || 0) - dt); g.magT = Math.max(0, (g.magT || 0) - dt);
    if (!g.attract && g.state === 'play') {      // legendary abilities fire on their own
      g.cloakT = Math.max(0, g.cloakT - dt);
      if (g.perk.wheelie && g.time >= g.wheelNext) { g.wheelNext = g.time + 40; g.boostT = g.boostMax = 4; g.wheelT = 4; g.mEvent('pad'); g.pop('WHEELIE BOOST', g.W2 || 160, 96, '#f0b24a', 1.2, 1.6); g.emit('wheelie'); }
      if (g.perk.cloak && g.time >= g.cloakNext) { g.cloakNext = g.time + 30; g.cloakT = g.cloakMax = 6; g.pop('COPS CAN\'T SEE YOU', g.W2 || 160, 96, '#d7dbe0', 1.2, 1.8); g.emit('cloak'); }
      g.wheelT = Math.max(0, g.wheelT - dt);
    }
    const tgt = g.boostT > 0 ? 1 : 0; g.boostK += (tgt - g.boostK) * (1 - Math.exp(-dt * (tgt ? 6 : 3.5)));
    if (g.boostK < 0.002 && !tgt) g.boostK = 0;
  };
  G.featStep = function (dt, dz) {
    const g = this, p = g.p, v = g.speed;
    for (const it of g.items) it.z -= dz;
    const real = !g.attract && g.state === 'play';
    if (real) g.pts = g.calcPts();
    if (g.wordFlash > 0) g.wordFlash -= dt;
    if (g.banner) g.banner.t += dt;
    if (!real) { for (const it of g.items) if (!it.taken && it.z > 0) { /* attract: items just scroll */ } g.items = g.items.filter(i => i.z + (i.depth || 0) > -8); return; }
    // ---- missions
    g.mEvent('dist', dz);
    for (let i = 0; i < g.missions.length; i++) {
      const m = g.missions[i];
      if (m.done) { m.doneT += dt; if (m.doneT > 2.2) g.missions[i] = g.makeMission(); }
    }
    // ---- daily challenge
    if (!g.dailyDone && g.dailyProgress() >= g.daily.n && !g.god) {
      g.dailyDone = true;
      if (global.Save.markDaily()) { g.score += DAILY_REWARD; g.pop('DAILY CHALLENGE  +' + cmp(DAILY_REWARD), g.W2 || 160, 92, '#f0b24a', 1.1, 2.2); g.emit('daily'); }
    }
    // ---- rival courier: a pace you have to beat on SCORE (points); beating them pays cash
    g.rivalScore = g.rivalRate * g.time * (1 + g.rivalN * 0.12);
    if (!g.rivalBeaten && g.time > 8 && g.pts > g.rivalScore) {
      g.rivalBeaten = true; g.score += CX * 1500; g.addCombo(2);
      g.pop('OUTRAN ' + g.rivalName.toUpperCase() + '  +' + cmp(CX * 1500), g.W2 || 160, 84, '#f0b24a', 1.1, 2);
      g.emit('rival', { name: g.rivalName }); g.tkRival();
      g.rivalN++; g.rivalResume = g.time + 18;
    }
    if (g.rivalBeaten && g.time > g.rivalResume) {          // a new, faster rival turns up
      g.rivalBeaten = false; g.rivalName = RIVALS[(RIVALS.indexOf(g.rivalName) + 1 + Math.floor(rnd() * 3)) % RIVALS.length];
      g.rivalRate *= 1.22;
      g.rivalScore = g.rivalRate * g.time * (1 + g.rivalN * 0.12);
    }
    g.tkStep(dt);
    // ---- item pickups
    for (const it of g.items) {
      if (it.taken) continue;
      const ax = Math.abs(p.x - it.lane);
      if (it.kind === 'bike') {
        if (Math.abs(it.z) < 1.2 && ax < 0.8 && Math.abs(it.y - (p.y + 0.55)) < 1.3 && !p.dead) { it.taken = true; g.regainBike('pickup'); }
      } else if (it.kind === 'letter' || it.kind === 'x2' || it.kind === 'shield' || it.kind === 'magnet') {
        if (Math.abs(it.z) < 1.1 && ax < 0.72 && Math.abs(it.y - (p.y + 0.55)) < 1.15 && !p.dead) {
          if (it.kind === 'letter') g.collectLetter(it);
          else if (it.kind === 'shield') { it.taken = true; g.shieldT = 25; g.addCombo(1); g.pop('SHIELD UP', g.W2 || 160, 66, '#8fc3e8', 1.2, 1.4); g.emit('shield'); }
          else if (it.kind === 'magnet') { it.taken = true; g.magT = 10 + (g.up.turbo || 0); g.magMax = g.magT; g.addCombo(1); g.pop('CASH MAGNET', g.W2 || 160, 66, '#e0644b', 1.2, 1.4); g.emit('magnet'); }
          else {
            it.taken = true; g.x2T = 9 + (g.up.turbo || 0) + (g.perk.turbo || 0); g.x2Max = g.x2T; g.addCombo(1);
            g.pop('DOUBLE CASH', g.W2 || 160, 66, '#79b95f', 1.2, 1.4); g.emit('x2');
          }
        }
      } else if (it.kind === 'key' || it.kind === 'tletter' || it.kind === 'relic' || it.kind === 'lockbox' || it.kind === 'parcel') {
        if (Math.abs(it.z) < 1.15 && ax < 0.75 && Math.abs(it.y - (p.y + 0.55)) < (it.kind === 'lockbox' ? 1.4 : 1.15) && !p.dead) g.tkPickup(it);
      } else if (it.kind === 'drop') {
        if (g.tk && g.tk.carry && it.z <= 0.9 && it.z + it.depth >= -0.2 && ax < 0.8 && p.y < 1.4 && !p.dead) { it.taken = true; g.tkDeliver(); }
      } else if (it.kind === 'pad') {
        if (!p.foot && !it.used && it.z <= 0.7 && it.z + it.depth >= -0.2 && ax < 0.62 && p.y < 0.5 && !p.dead) {
          it.used = true; g.boostT = g.boostMax = 3.0 + 1.0 * (g.up.turbo || 0) + (g.perk.turbo || 0); g.padCount++; g.mEvent('pad'); g.addCombo(1);
          g.pop('TURBO', g.W2 || 160, 66, '#f0b24a', 1.3, 1.2); g.fx.speedPulse = 1; g.fx.zoom = 0.8; g.emit('boost');
        }
      } else if (it.kind === 'ramp') {
        if (!p.foot && !it.used && it.z <= 0.45 && it.z + it.depth >= 0 && ax < 0.62 && p.y < 0.6 && !p.dead) {
          it.used = true; g.rampCount++; g.mEvent('ramp');
          p.vy = g.JUMP_V * 1.55; p.y = 0.02; p.grounded = false; p.fast = false; p.jumpStart = g.clock; p.slide = 0; p.slideBuf = 0; g.rampAir = true;
          g.shake(0.8); g.fx.zoom = 0.7; g.emit('ramp');
          g.pop('AIR TIME!', g.W2 || 160, 66, '#fff', 1.2, 1.1);
        }
      }
    }
    g.items = g.items.filter(i => !i.taken && i.z + (i.depth || 0) > -8);
  };
})(window);
