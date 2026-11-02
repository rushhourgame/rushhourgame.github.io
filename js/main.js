/* RUSH HOUR (was Signal Lost) — boot, input, loop, sound wiring */
(function () {
  'use strict';
  const G = Game, cv = document.getElementById('game');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  let lastStars = 0, W = 0, H = 0, audioOn = false, paused = false, frozen = false, lastBlind = false, startedAt = 0, glOK = true;
  G.hint = !(Save.data.tut && Save.data.tut.done);
  function syncUp() { G.up = Object.assign({ jam: 0, cash: 0, turbo: 0, bail: 0 }, Save.data.up); G.perk = Save.perk(); G.loc = Save.data.loc | 0; if (G.state === 'title' || G.attract) G.stage = G.loc; }
  function syncOutfit() { if (glOK) { try { Render.setOutfit(Save.OUTFITS[Save.data.outfit] || Save.OUTFITS.courier); } catch (e) { console.warn('outfit', e); } } }
  function syncAudioSettings() { const s = Save.data.set; Sfx.setMusicEnabled(s.music); Sfx.setSfxEnabled(s.sfx); }
  syncUp();

  /* ---------- sizing (full-resolution, devicePixelRatio aware; no low-res buffer) ---------- */
  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    if (glOK) Render.resize(W, H);
    HUD.resize();
  }
  try { Render.init(cv); } catch (err) { glOK = false; console.error('WebGL init failed', err); document.getElementById('nogl').classList.remove('hidden'); }
  HUD.init(G, { start: () => press(), retry: () => retry(), resume: () => setPaused(false), pause: () => setPaused(true), restart: () => restartRun(), quit: () => quitToMenu() });
  document.getElementById('btn-home').addEventListener('click', e => { e.stopPropagation(); goHome(); });
  for (const id of ['over', 'title', 'pause']) for (const ev of ['pointerdown', 'pointerup', 'mousedown']) document.getElementById(id).addEventListener(ev, e => e.stopPropagation());   // overlays swallow stray taps (buttons still get their own click)
  window.addEventListener('resize', resize); window.addEventListener('orientationchange', () => setTimeout(resize, 100));
  resize(); G.reset(true); syncOutfit();
  Shop.init({
    ui: () => { wake(); try { Sfx.uiBlip(); } catch (e) {} },
    onChange: kind => { syncUp(); syncOutfit(); syncAudioSettings(); syncMute(); try { if (kind === 'buy') Sfx.buy(); else if (kind === 'equip') Sfx.uiBlip(); } catch (e) {} },
    onClose: () => { try { Sfx.uiBlip(); } catch (e) {} }
  });

  /* ---------- audio ---------- */
  function wake() {
    if (!audioOn) { audioOn = true; try { Sfx.init(); syncAudioSettings(); Sfx.startMusic(); } catch (e) { console.warn('audio', e); } }
    else Sfx.resume();
  }
  function drain() {
    const ev = G.events; if (!ev.length) return;
    for (const e of ev) {
      if (e.type === 'crash' && !G.god && !G.attract && !G.runSaved) { // bank the run (always, even if audio is off)
        G.runSaved = true; G.bankedRun = G.finalScore || 0;
        Save.recordRun({ score: G.finalScore || 0, time: G.time, near: G.nearCount, jams: G.jams, bails: G.bails, pts: G.finalPts, coins: G.coins, words: G.wordsDone, missions: G.missionsDone, dist: G.dist });
      }
      if ((e.type === 'crash' || e.type === 'bail' || e.type === 'bikelost') && !G.god && Save.data.set.haptics && navigator.vibrate) { try { navigator.vibrate(e.type === 'crash' || e.type === 'bikelost' ? [60, 40, 140] : 45); } catch (_) {} }
      if (!G.attract && !G.god) { try { feel(e); } catch (_) {} }
      if (!G.attract) { try { if (e.type === 'bikelost') Render.gesture('lose'); else if (e.type === 'bikeback') Render.gesture('win'); else if (e.type === 'outplay') Render.gesture('flair'); } catch (_) {} }
      if (!audioOn) continue;
      try {
        switch (e.type) {
          case 'lane': Sfx.lane(e.dir); break;
          case 'jump': Sfx.jump(); break;
          case 'slide': Sfx.slide(); break;
          case 'land': Sfx.land(); break;
          case 'coin': Sfx.coin(G.combo); break;
          case 'near': Sfx.near(); break;
          case 'outplay': Sfx.outplay(); break;
          case 'bump': Sfx.bump(); break;
          case 'edge': Sfx.bump(); break;
          case 'crash': Sfx.crash(); break;
          case 'bail': Sfx.bail(); break;
          case 'bikelost': Sfx.bikeLost(); Sfx.duck(0.6, 0.8); break;
          case 'bikeback': Sfx.bikeBack(); break;
          case 'chip': Sfx.glitch(); Sfx.duck(); break;
          case 'blindEnd': Sfx.glitchEnd(); break;
          case 'speedup': Sfx.speedup(); break;
          case 'taunt': Sfx.taunt(); break;
          case 'predHit': Sfx.threat && Sfx.threat(); break;
          case 'stage': if (!G.attract) { Sfx.stage(); } break;
          case 'mission': Sfx.mission();  break;
          case 'letter': Sfx.letter(e.i); break;
          case 'word': Sfx.word();  break;
          case 'daily': Sfx.daily(); break;
          case 'rival': break;
          case 'ramp': Sfx.ramp(); break;
          case 'wheelie': Sfx.boost(); break;
          case 'cloak': Sfx.glitchEnd(); break;
          case 'boost': Sfx.boost(); break;
          case 'x2': Sfx.x2(); break;
          case 'shield': Sfx.shield(); break;
          case 'shieldhit': Sfx.shieldHit(); break;
          case 'magnet': Sfx.magnet(); break;
          case 'task': Sfx.letter(3); break;
          case 'taskdone': Sfx.mission(); break;
          case 'parcel': Sfx.x2(); break;
        }
      } catch (err) { /* never let audio kill the loop */ }
    }
    ev.length = 0;
  }

  /* ---------- state flow ---------- */
  let overAt = 0;                                      // real-time stamp of the moment the run ended (input lockout)
  const LOCK_MS = 800;
  const locked = () => performance.now() - overAt < LOCK_MS;
  function startGame() {
    if (performance.now() - startedAt < 500) return;       // double-start guard (double tap / click + key in the same moment)
    introEnd(); wake(); syncUp(); G.reset(false); G.runSaved = false; G.bankedRun = 0; lastStars = 0; paused = false; G.paused = false; startedAt = performance.now(); setTimeout(() => { try { if (G.state === 'play' && !G.attract) { Render.gesture('start', true); } } catch (e) {} }, 420);
    try { Sfx.start(); } catch (e) {}
    try { const nm = Sfx.nextTrack ? Sfx.nextTrack() : ''; if (nm) HUD.nowPlaying(nm); if (audioOn) { Sfx.startMusic(); } } catch (e) {}
  }
  function setPaused(p) {
    if (p === paused) return;
    if (p && !(G.state === 'play' && !G.attract)) return;
    paused = p; G.paused = p;
    try { if (audioOn) { Sfx.startMusic(); Sfx.pauseDuck(p); } } catch (e) {}
  }
  function retry() { if (G.state === 'over' && G.overT > 0.7 && !locked()) { G.hint = false; startGame(); } }
  function restartRun() { if (paused && G.state === 'play') { G.hint = false; startedAt = 0; startGame(); } }        // pause -> Restart: fresh run (this run's cash is not banked)
  function quitToMenu() {                              // pause -> Quit to menu: back to the title (attract) screen
    if (!paused || G.state !== 'play') return;
    paused = false; G.paused = false; G.hint = false; syncUp(); G.reset(true); startedAt = performance.now(); introBegin(true);
    try { Sfx.uiBlip(); } catch (e) {}
  }
  function goHome() {                                  // game over -> title (attract) screen
    if (G.state !== 'over' || locked()) return;
    paused = false; G.paused = false; G.hint = false; syncUp(); G.reset(true); startedAt = performance.now(); introBegin(true);
    try { Sfx.uiBlip(); } catch (e) {}
  }
  function press() { // START button only; resume from pause
    wake();
    if (paused) setPaused(false);
    else if (G.state === 'title') startGame();
  }

  /* ---------- keyboard ---------- */
  const KEYS = { ArrowLeft: 'L', KeyA: 'L', ArrowRight: 'R', KeyD: 'R', ArrowUp: 'J', KeyW: 'J', Space: 'J', ArrowDown: 'S', KeyS: 'S' };
  window.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.code;
    if (Shop.isOpen()) { if (k === 'Escape') { e.preventDefault(); Shop.closeAll(); } return; }       // modals own the keyboard
    if ((k === 'Enter' || k === 'Space') && e.target && e.target.closest && e.target.closest('button')) return; // let focused buttons click
    if (KEYS[k] || k === 'Enter' || k === 'Escape' || k === 'KeyP') e.preventDefault();
    if (e.repeat && (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'KeyA' || k === 'KeyD' || k === 'ArrowUp' || k === 'KeyW' || k === 'Space' || k === 'ArrowDown' || k === 'KeyS')) return;
    if (k === 'KeyM') { wake(); toggleMute(); return; }
    if (k === 'KeyF') { toggleFull(); return; }
    if (k === 'KeyP' || k === 'Escape') { setPaused(!paused); return; }
    wake();
    if (paused) return;                                 // pause: only P / Esc and the Resume / Restart / Quit buttons act
    if (G.state === 'title') return;                    // title: only the START button (click / Enter or Space on the focused button) starts a run
    if (G.state === 'over' || G.state === 'dead') return; // game over: keys do nothing; only the focused Restart / Menu button reacts (native click)
    if (k === 'KeyR') { startGame(); return; }
    const a = KEYS[k]; if (a) G.act(a);
  }, { passive: false });

  /* ---------- pointer / swipe ---------- */
  let ptr = null;
  const TH = 30;                      // ONE action per finger gesture: fires the first time the drag passes TH px, then the gesture is locked until pointerup / pointercancel
  const isBtn = e => !!(e.target.closest && e.target.closest('button, .modal'));
  document.addEventListener('pointerdown', e => {
    if (isBtn(e)) return;
    if ((G.state === 'title' || G.state === 'over' || G.state === 'dead') && !G.paused) { wake(); return; }   // title / game over: only the buttons act (taps and swipes are ignored)
    e.preventDefault(); wake();
    if (ptr && e.pointerId !== ptr.id && performance.now() - ptr.t < 4000) return;   // a second finger never starts another gesture
    try { document.body.setPointerCapture(e.pointerId); } catch (_) {}
    ptr = { id: e.pointerId, ox: e.clientX, oy: e.clientY, fired: false, t: performance.now() };
  });
  document.addEventListener('pointermove', e => {
    if (!ptr || e.pointerId !== ptr.id) return;
    e.preventDefault();
    if (ptr.fired) return;                                // gesture already used: ignore all further movement until the finger lifts
    const dx = e.clientX - ptr.ox, dy = e.clientY - ptr.oy, ax = Math.abs(dx), ay = Math.abs(dy);
    let a = null;
    if (ax > TH && ax > ay * 0.8) a = dx < 0 ? 'L' : 'R';
    else if (ay > TH && ay > ax) a = dy < 0 ? 'J' : 'S';
    if (!a) return;
    ptr.fired = true;
    if (G.state === 'play' && !paused) G.act(a);
  });
  const up = e => {
    if (!ptr || e.pointerId !== ptr.id) return;
    const tap = !ptr.fired && Math.hypot(e.clientX - ptr.ox, e.clientY - ptr.oy) < 12; ptr = null;
    void tap;                                            // pause overlay: a stray tap does nothing, only the buttons act
  };
  document.addEventListener('pointerup', up); document.addEventListener('pointercancel', e => { if (ptr && e.pointerId === ptr.id) ptr = null; });
  window.addEventListener('blur', () => { ptr = null; });
  document.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('touchmove', e => { if (!(e.target.closest && e.target.closest('.scroll'))) e.preventDefault(); }, { passive: false });

  /* ---------- buttons ---------- */
  function toggleMute() { try { Sfx.toggleMute(); } catch (e) {} syncMute(); }
  function syncMute() { const b = document.getElementById('btn-mute'); b.classList.toggle('off', !!(Sfx.muted)); }
  function toggleFull() {
    const d = document, el = document.documentElement;
    if (!d.fullscreenElement && !d.webkitFullscreenElement) (el.requestFullscreen || el.webkitRequestFullscreen || function () {}).call(el);
    else (d.exitFullscreen || d.webkitExitFullscreen || function () {}).call(d);
  }
  document.getElementById('btn-mute').addEventListener('click', e => { e.stopPropagation(); wake(); toggleMute(); e.currentTarget.blur(); });
  document.getElementById('btn-full').addEventListener('click', e => { e.stopPropagation(); toggleFull(); e.currentTarget.blur(); });
  document.addEventListener('fullscreenchange', () => setTimeout(resize, 60));
  document.addEventListener('touchend', () => wake(), { capture: true, passive: true });   // iOS only unlocks audio from touchend / click
  document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });
  window.addEventListener('blur', () => setPaused(true));
  syncMute();

  /* ---------- game feel: sparkle, haptics (no slow-mo, no camera/FOV punch) ---------- */
  const buzz = (pat) => { if (Save.data.set.haptics && navigator.vibrate) { try { navigator.vibrate(pat); } catch (_) {} } };
  function feel(e) {
    switch (e.type) {
      case 'near': buzz(14); break;
      case 'coin': Render.sparkle(5); break;
      case 'shield': Render.sparkle(18, [.6, .8, 1], 1.6); buzz(22); break;
      case 'shieldhit': Render.sparkle(26, [.7, .85, 1], 2.2); buzz([30, 30, 30]); break;
      case 'magnet': Render.sparkle(16, [1, .55, .4], 1.4); buzz(22); break;
      case 'x2': Render.sparkle(16, [.6, 1, .5], 1.4); buzz(20); break;
      case 'boost': buzz([18, 20, 18]); break;
      case 'ramp': break;
    }
  }
  /* speed lines: thin, calm white streaks at the screen edges, only at high speed / boost */
  const sl = document.createElement('canvas'); sl.id = 'fx-speed'; document.body.insertBefore(sl, document.getElementById('hud')); const slc = sl.getContext('2d'); let slOn = false, slR = 0;
  function speedLines(t) {
    const inten = (G.state === 'play' && !G.attract && !paused) ? clamp((G.speed - 31) / 12, 0, 1) * .55 + (G.boostK || 0) * .6 : 0;
    if (inten < .04) { if (slOn) { slc.clearRect(0, 0, sl.width, sl.height); slOn = false; } return; }
    slOn = true; const w0 = Math.round(innerWidth * .5), h0 = Math.round(innerHeight * .5); if (sl.width !== w0 || sl.height !== h0) { sl.width = w0; sl.height = h0; } const w = w0, h = h0, cx = w / 2, cy = h * .46, R = Math.hypot(w, h) / 2;
    slc.clearRect(0, 0, w, h); slc.lineCap = 'round';
    for (let i = 0; i < 22; i++) { const a = (i * 2.399 + Math.floor(t * 9 + i) * 1.7) % 6.283, ph = ((t * 2.6 + i * .37) % 1), r0 = R * (.5 + ph * .5), r1 = r0 + R * (.1 + .22 * inten);
      const ca = Math.cos(a), sa = Math.sin(a); slc.strokeStyle = 'rgba(255,255,255,' + (.2 * inten * Math.sin(ph * 3.14)).toFixed(3) + ')'; slc.lineWidth = 1.5; slc.beginPath(); slc.moveTo(cx + ca * r0, cy + sa * r0 * 1.15); slc.lineTo(cx + ca * r1, cy + sa * r1 * 1.15); slc.stroke(); }
  }
  /* headstart: one free burst of turbo in the first seconds of a run */
  { const bh = document.getElementById('btn-head'); if (bh) { for (const ev of ['pointerdown', 'pointerup', 'mousedown', 'touchstart', 'touchend']) bh.addEventListener(ev, e => e.stopPropagation());
    bh.addEventListener('click', e => { e.stopPropagation(); bh.blur(); if (G.state !== 'play' || G.attract || G.headUsed) return; G.headUsed = true; G.boostT = G.boostMax = 4.5; G.addCombo(1); G.emit('boost'); G.pop('BOOST START', G.W2 || 160, 78, '#f0b24a', 1.2, 1.4); }); } }
  /* ---------- title intro (full once per page load; short when returning to the menu) ---------- */
  const titleEl = document.getElementById('title'); let introPh = -1;
  const noIntro = /[?&]nointro/.test(location.search) || (matchMedia && matchMedia('(prefers-reduced-motion:reduce)').matches);
  function introBegin(short) {
    if (noIntro || !glOK) return;
    try { Render.introStart(!!short); } catch (_) { return; }
    if (!short) { introPh = 0; titleEl.dataset.intro = '0'; } else { introPh = -1; delete titleEl.dataset.intro; }
    introRev = short ? .25 : 1.25; introT0 = 0;
  }
  let introRev = -1, introT0 = 0;
  function introEnd() { introPh = -1; delete titleEl.dataset.intro; introRev = -1; try { Render.introSkip(); } catch (_) {} }
  function introTick() {
    if (G.state !== 'title') { if (introPh >= 0) introEnd(); introRev = -1; return; }
    const t = Render.introT(); if (t < 0) { if (introPh >= 0) introEnd(); return; }
    if (introRev >= 0 && t >= introRev - .35) { introRev = -1; try { if (audioOn) Sfx.rev(); } catch (_) {} }
    if (introPh < 0) return;
    const ph = t >= 3.3 ? 2 : t >= 2.3 ? 1 : 0;
    if (ph !== introPh) { introPh = ph; titleEl.dataset.intro = String(ph); if (ph === 1) { try { if (audioOn) Sfx.slam(); } catch (_) {} try { Render.sky(); } catch (_) {} } }
  }
  titleEl.addEventListener('pointerdown', () => { if (introPh >= 0 || Render.introT() >= 0) introEnd(); }, true);
  /* ---------- loop ---------- */
  const DT = 1 / 120; let acc = 0, last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = Math.max(0, Math.min(0.1, (now - last) / 1000)); last = now;
    if (!frozen) {
      if (!paused) {
        acc += dt;                                    // always real time: no slow motion
        // sim time == real time: split the frame into equal sub-steps (each <= 1/120 s) instead of leaving a fractional remainder (that remainder was a visible judder)
        if (acc >= DT * .5) { const n = Math.min(24, Math.ceil(acc / DT - 1e-6)), h = acc / n; for (let i = 0; i < n; i++) G.step(h); acc = 0; }
        drain();
        if (audioOn) {
          try {
            Sfx.setMode(G.state === 'play' && !G.attract ? 'play' : G.state === 'dead' || G.state === 'over' ? 'over' : 'menu');
            if (G.state === 'play' && !G.attract) {
              const stars = clamp(Math.ceil((G.threat || 1) / 2), 1, 5);
              if (lastStars && stars > lastStars) Sfx.siren(stars);
              lastStars = stars;
            }
            Sfx.setIntensity(G.state === 'play' || G.attract ? (G.threat || 1) : 1, clamp((G.speed - 20) / 22, 0, 1));
            const b = G.blindT > 0; if (b !== lastBlind) { lastBlind = b; Sfx.setBlind(b); }
          } catch (e) {}
        }
      }
      if (glOK) Render.frame(G, dt);
      speedLines(now / 1000); introTick();
    }
    if (G.state === 'over') { if (!overSeen) { overSeen = true; overAt = performance.now(); focusRestart(); } } else overSeen = false;
    HUD.update(dt, paused);
  }
  let overSeen = false;
  function focusRestart() { if (!document.documentElement.classList.contains('touch')) setTimeout(() => { const b = document.getElementById('btn-retry'); if (G.state === 'over' && b) b.focus({ preventScroll: true }); }, LOCK_MS + 50); }
  introBegin(false);
  requestAnimationFrame(frame);

  /* ---------- debug / test API ---------- */
  window.SL = {
    Save, Shop, syncUp, syncOutfit, G, Render, HUD, resize,
    freeze(v) { frozen = v !== false; },
    step(secs) { for (let i = 0; i < secs / DT; i++) G.step(DT); drain(); },
    draw(dt) { Render.frame(G, dt || 1 / 60); HUD.update(dt || 1 / 60, paused); },
    start(opts) { wake(); syncUp(); G.runSaved = false; G.reset(false, opts || {}); paused = false; G.paused = false; G.hint = false; },
    sim(secs, opts) { frozen = true; G.reset(false, Object.assign({ god: true, noflash: true }, opts)); G.hint = false; const n = Math.round(secs / DT); for (let i = 0; i < n; i++) { G.step(DT); G.events.length = 0; } frozen = false; return { time: G.time, score: Math.floor(G.score), pred: G.brain.predPct(), godHits: G.godHits || 0, waves: G.waveLog.length }; },
    state() { const p = G.p; return { state: G.state, lane: p.lane, y: p.y, slide: p.slide, grounded: p.grounded, score: Math.floor(G.score), time: G.time, coins: G.coins, threat: G.threat, foot: !!p.foot, footT: G.footT, bm: (window.__bm && window.__bm()) || null, inv: p.inv, items: (G.items||[]).map(i=>i.kind), pred: G.brain.predPct(), blind: G.blindT, mult: G.mult, combo: G.combo, paused, W, H, stats: glOK ? Render.stats() : null }; },
    pause: setPaused,
    loc(i) { Save.data.loc = i; if (Save.data.locs.indexOf(i) < 0) Save.data.locs.push(i); syncUp(); }
  };
})();
