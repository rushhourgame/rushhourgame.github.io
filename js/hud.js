/* RUSH HOUR (was Signal Lost) — GTA-style HUD (DOM + one 2D canvas for the minimap). Reads Game state; never changes the sim. */
(function (global) {
  'use strict';
  const $ = id => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const H = {};
  const el = {};
  const LW = 2.6;
  let G, last = {}, jamDesatUntil = 0;
  const STAR = 'M15 2.5l3.6 7.5 8.2 1.1-6 5.7 1.5 8.2L15 21.1l-7.3 3.9 1.5-8.2-6-5.7 8.2-1.1z';

  function sentence(s) {
    s = String(s || '').toLowerCase();
    s = s.replace(/(^|[.!?]\s+)([a-z])/g, (m, a, b) => a + b.toUpperCase());
    s = s.replace(/\bi\b/g, 'I');
    return s;
  }
  H.sentence = sentence;
  const money = n => '\u20A6' + global.Save.compact(n);
  const num = n => Math.floor(n).toLocaleString('en-US');
  const mmss = t => { t = Math.floor(t); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
  function setText(key, node, v) { if (last[key] !== v) { last[key] = v; node.textContent = v; } }
  function setCls(key, node, cls, on) { on = !!on; if (last[key] !== on) { last[key] = on; node.classList.toggle(cls, on); } }

  H.init = function (game, handlers) {
    G = game; H.h = handlers || {};
    ['hud', 'money', 'mult', 'stars', 'toasts', 'hint', 'title', 'pause', 'over', 'wtxt', 'csub', 'crows', 'lanes', 'verdict', 'tip', 'cscore', 'cnew', 'best', 'game', 'btn-retry', 'btn-start', 'btn-pause', 'cwallet', 'wallet', 'word', 'score', 'cstats', 'scorebox', 'itemrow', 'tkchip', 'chip', 'banner', 'bn-t', 'pinfo', 'oinfo'].forEach(k => el[k] = $(k));
    let s = '';
    for (let i = 0; i < 5; i++) s += `<path d="${STAR}" transform="translate(${i * 30} 0)"/>`;
    el.stars.innerHTML = s; el.starsP = Array.from(el.stars.querySelectorAll('path'));
    el['btn-retry'].addEventListener('click', e => { e.stopPropagation(); H.h.retry && H.h.retry(); });
    el['btn-chars-over'] = $('btn-chars-over');
    el['btn-start'].addEventListener('click', e => { e.stopPropagation(); H.h.start && H.h.start(); });
    el['btn-pause'].addEventListener('click', e => { e.stopPropagation(); e.currentTarget.blur(); H.h.pause && H.h.pause(); });
    [['btn-resume', 'resume'], ['btn-restart', 'restart'], ['btn-quit', 'quit']].forEach(([id, fn]) => { const b = $(id); if (!b) return;
      let lastT = -1e9;                                    // touchend OR click, whichever lands first, fires once (a phone can drop the synthetic click)
      const fire = e => { e.stopPropagation(); if (e.cancelable && e.type !== 'click') e.preventDefault(); const n = performance.now(); if (n - lastT < 450) return; lastT = n; try { b.blur(); } catch (_) {} H.h[fn] && H.h[fn](); };
      let tx = 0, ty = 0, moved = false;
      b.addEventListener('touchstart', e => { const t = e.touches[0]; tx = t.clientX; ty = t.clientY; moved = false; }, { passive: true });
      b.addEventListener('touchmove', e => { const t = e.touches[0]; if (Math.hypot(t.clientX - tx, t.clientY - ty) > 12) moved = true; }, { passive: true });
      b.addEventListener('click', fire); b.addEventListener('touchend', e => { if (!moved) fire(e); }, { passive: false });
      for (const ev of ['pointerdown', 'pointerup', 'mousedown']) b.addEventListener(ev, e => e.stopPropagation()); });
  };
  H.resize = function () {};

  /* ---------------- transient text: ONE banner at a time, queued, 1.2 s each ---------------- */
  const BANNER_MS = 1200, bq = []; let bnUntil = 0, bnCur = null;
  function banner(text, kind) {
    if (bq.length >= 3 || (bnCur && bnCur.text === text) || bq.some(q => q.text === text)) return;
    bq.push({ text, kind: kind || '' });
  }
  H.banner = banner;
  function runBanner(now) {
    if (bnCur && now >= bnUntil) { bnCur = null; el.banner.classList.remove('on'); bnUntil = now + 160; }   // short gap between two banners
    if (!bnCur && bq.length && now >= bnUntil) {
      bnCur = bq.shift(); bnUntil = now + BANNER_MS; el['bn-t'].textContent = bnCur.text;
      el.banner.className = 'on ' + bnCur.kind;
    }
  }
  const STAGE_SEEN = { b: null };
  /* Game pops are routed, never all shown: near misses / bumps / speed-ups / power-up starts are silent here (sound + a score flash tell the player). */
  const SILENT = /^(NEAR MISS|BUMP|SPEED UP|AIR TIME|TURBO|DOUBLE CASH|SIGNAL JAMMED|WHEELIE BOOST|COPS CAN)/;
  const PROGRESS = /\d+\/\d+\s*$/;
  function routePops() {
    for (const p of G.pops) {
      if (p._seen) continue; p._seen = true;
      const t = String(p.text || ''), T = t.replace(/\s+/g, ' ').trim();
      if (/^NEAR MISS/.test(T)) { el.scorebox.classList.remove('pulse'); void el.scorebox.offsetWidth; el.scorebox.classList.add('pulse'); continue; }
      if (SILENT.test(T)) continue;
      if (PROGRESS.test(T)) { relevant(); continue; }                    // task progress lives in the icon row
      if (/^MISSION COMPLETE/.test(T)) banner('Mission complete', 'good');
      else if (/^TASK DONE/.test(T)) banner('Task done', 'good');
      else if (/^OUTSMARTED/.test(T)) banner('Outsmarted', 'good');
      else if (/^DAILY/.test(T)) banner('Daily done', 'good');
      else if (/^OUTRAN/.test(T)) banner('Outran rival', 'good');
      else if (/^BIKE WRECKED/.test(T)) banner('On foot', 'bad');
      else if (/^BIKE BACK/.test(T)) banner('Bike back', 'good');
      else if (/^BAILED|^BAIL/.test(T)) banner('Bailed out', '');
      else if (/^PARCEL LOST/.test(T)) banner('Parcel lost', 'bad');
      else if (/^PARCEL/.test(T)) { banner('Parcel picked up', ''); relevant(); }
      else if (/!\s+\+/.test(T) || /!\s*$/.test(T)) { banner(T.replace(/\s+\+.*$/, '').replace(/!$/, ''), 'good'); relevant(); }   // a completed word
      else banner(T.replace(/\s+\+.*$/, ''), '');
    }
    G.pops.length = 0;   // pops are not drawn as floating text any more (the 3D scene shows cash pickups)
  }
  let relUntil = 0; function relevant() { relUntil = performance.now() + 4500; }
  H.nowPlaying = function () {};

  /* ---------------- per-frame ---------------- */
  H.update = function (dt, paused) {
    const st = G.state, playing = st === 'play' || st === 'dead';
    const inTitle = st === 'title' && G.attract;
    setCls('t_hud', el.hud, 'hidden', !playing || G.attract); // hud visible during play + dead
    setCls('t_title', el.title, 'hidden', !inTitle); setCls('t_bodytitle', document.body, 'intitle', inTitle);
    setCls('t_pause', el.pause, 'hidden', !paused); setCls('t_inrun', document.body, 'inrun', playing && !G.attract && !paused); setCls('t_end', document.body, 'ended', st === 'dead' || st === 'over');
    if (paused && playing && !G.attract) { const k = infoKey(); if (last.pinfo !== k) { last.pinfo = k; el.pinfo.innerHTML = infoHTML(); } } else last.pinfo = null;
    if (inTitle) {
      const sv = global.Save && Save.data;
      const b = G.bestPts ? num(G.bestPts) : '0';
      setText('best', el.best, b); if (sv) setText('wallet', el.wallet, money(sv.wallet));
    }

    // dead / over screens
    const overOn = (st === 'dead' && G.deadT > 0.25) || st === 'over';
    setCls('t_over', el.over, 'hidden', !overOn);
    if (overOn) {
      const kv = (G.killerObj && G.killerObj.vis) || G.killerVis || (G.killer && G.killer !== 'wall' ? 'barrier' : '');
      const busted = /police|gantry|jersey|saw|cones|barrier/.test(kv);
      setCls('t_busted', el.over, 'busted', busted); setText('wtxt', el.wtxt, busted ? 'Busted' : 'Wasted');
      setCls('t_in', el.over, 'in', true);
      const card = st === 'over' && G.overT > 0.35; setCls('t_card', el.over, 'card', card);
      if (card && !last.cardBuilt) buildCard(); if (!card) last.cardBuilt = false;
    } else { setCls('t_in', el.over, 'in', false); setCls('t_card', el.over, 'card', false); last.cardBuilt = false; }
    // canvas grading
    setCls('t_gray', el.game, 'gray', st === 'dead' || st === 'over');

    if (!playing || G.attract) { if (bnCur || bq.length) { bq.length = 0; bnCur = null; el.banner.classList.remove('on'); } G.pops.length = 0; return; }
    const blind = G.blindT > 0, now = performance.now();
    setText('money', el.money, money(st === 'dead' ? (G.finalScore || G.score) : G.score));
    setText('score', el.score, num(st === 'dead' ? (G.finalPts || G.pts) : G.pts));
    setText('mult', el.mult, G.mult >= 3 ? '\u00D7' + Math.floor(G.mult) : '');       // combo: a small number, only from x3
    // wanted stars
    const stars = clamp(Math.ceil((G.threat || 1) / 2), 1, 5);
    for (let i = 0; i < 5; i++) { const on = i < stars; if (last['s' + i] !== on) { last['s' + i] = on; el.starsP[i].classList.toggle('off', !on); } }
    setCls('t_jamstars', el.stars, 'jam', blind);
    // jammer desaturation dip (only on grab, ~0.8 s)
    if (blind && !last.wasBlind) jamDesatUntil = now + 800;
    last.wasBlind = blind;
    if (st === 'play') setCls('t_desat', el.game, 'desat', now < jamDesatUntil);

    // first-run tutorial: three short hints, then never again (persisted in Save)
    const tutOn = G.hint && st === 'play', tt = G.time;
    const stage = !tutOn ? -1 : tt < 4.5 ? 0 : tt < 8.5 ? 1 : tt < 14 ? 2 : -1;
    setCls('t_hint', el.hint, 'hidden', stage < 0);
    if (stage !== last.tutStage) {
      last.tutStage = stage; const touch = document.documentElement.classList.contains('touch');
      if (stage === 0) el.hint.innerHTML = touch ? '<b>Swipe</b> left / right to change lane' : '<b>← →</b> change lane';
      if (stage === 1) el.hint.innerHTML = touch ? '<b>Swipe up</b> to jump · <b>down</b> to slide' : '<b>↑</b> jump · <b>↓</b> slide';
      if (stage === 2) el.hint.innerHTML = 'Collect <b>cash</b> and <b>letters</b>';
    }
    if (tutOn && tt >= 14) { G.hint = false; global.Save && Save.tutDone('done'); }

    // location banner (once per run), then the queue runs
    const bb = G.banner, STG = global.STAGES;
    if (bb && bb !== STAGE_SEEN.b && st === 'play' && STG && bb.t > 0.4) { STAGE_SEEN.b = bb; banner(STG[bb.idx % STG.length].name, 'place'); }
    routePops(); runBanner(now);
    updateRow(now);
  };

  /* ---------------- compact icon row (letters / task) + ONE status chip ---------------- */
  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const PIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-6.1-6.5-11a6.5 6.5 0 0 1 13 0c0 4.9-6.5 11-6.5 11z" fill="currentColor"/></svg>';
  function updateRow(now) {
    const w = G.word || '', wi = G.wordIdx || 0, flash = G.wordFlash > 0;
    const wk = w + wi + flash;
    if (last.wk !== wk) {
      last.wk = wk; if (wi > 0 || flash) relevant();
      el.word.innerHTML = (flash && G.lastWord ? G.lastWord.split('') : w.split('')).map((ch, i) => `<i class="${flash || i < wi ? 'on' : ''}">${flash || i < wi ? ch : ''}</i>`).join('');
    }
    const ti = G.tkInfo && !G.attract ? G.tkInfo() : null;
    let tk = '';
    if (ti && !ti.done) {
      const pr = Math.floor(ti.p), val = ti.kind === 'stars' ? Math.floor(ti.p / 60) + '/' + Math.floor(ti.n / 60) + 'm' : ti.kind === 'word' ? ti.word.split('').map((c, i) => i < pr ? c : '\u00B7').join('') : pr + '/' + ti.n;
      tk = PIN + '<span>' + esc(ti.carry ? 'Drop' : val) + '</span>';
      const k = pr + '|' + ti.carry; if (last.tpk !== k) { last.tpk = k; if ((G.time || 0) > 1.5) relevant(); }
    }
    if (last.tk !== tk) { last.tk = tk; el.tkchip.innerHTML = tk; }
    const carry = !!(ti && ti.carry);
    const show = (now < relUntil || carry) && (wi > 0 || flash || tk);
    setCls('t_row', el.itemrow, 'hidden', !show);
    // one chip: the most important status only
    let c = '', cl = '';
    if (G.p && G.p.foot && G.state === 'play') { c = 'On foot \u00B7 find the bike key'; cl = 'foot'; }
    else if (G.blindT > 0) { c = 'Jammed ' + Math.ceil(G.blindT) + 's'; cl = 'jam'; }
    else if (G.boostT > 0) { c = 'Turbo ' + Math.ceil(G.boostT) + 's'; cl = 'turbo'; }
    else if (G.x2T > 0) { c = '2\u00D7 cash ' + Math.ceil(G.x2T) + 's'; cl = 'x2'; }
    else if (G.shieldT > 0) { c = 'Shield'; cl = 'shield'; }
    else if (G.magT > 0) { c = 'Magnet ' + Math.ceil(G.magT) + 's'; cl = 'magnet'; }
    else if (G.cloakT > 0) { c = 'Cloak ' + Math.ceil(G.cloakT) + 's'; cl = 'perk'; }
    else if (G.perk && G.perk.autododge && !G.autoUsed) { c = 'Auto-dodge'; cl = 'perk'; }
    if (G.state === 'dead') c = '';
    { const bh = document.getElementById('btn-head'); if (bh) { const sh = G.state === 'play' && !G.attract && !G.paused && !G.headUsed && G.time > .4 && G.time < 7; setCls('t_head', bh, 'hidden', !sh); } }
    setCls('t_chip', el.chip, 'hidden', !c); if (c) { setText('chiptxt', el.chip, c); if (last.chcl !== cl) { last.chcl = cl; el.chip.dataset.k = cl; } }
  }

  /* ---------------- missions / daily / location task: pause + game over only ---------------- */
  function infoKey() { const ms = G.missions || []; const ti = G.tkInfo && G.tkInfo(); return ms.map(m => m.text + Math.floor(m.p) + m.done).join('|') + '|' + (ti ? ti.title + Math.floor(ti.p) : '') + '|' + (G.dailyDone ? 1 : 0) + (G.daily ? G.dailyProgress() : ''); }
  function infoHTML() {
    const ms = G.missions || []; let h = '';
    h += ms.map(m => `<div class="m${m.done ? ' done' : ''}"><span class="t">${esc(m.text)}</span><em>${m.done ? '\u2713' : Math.floor(m.p) + '/' + m.n}</em><u style="width:${Math.round(100 * Math.min(1, m.p / m.n))}%"></u></div>`).join('');
    const ti = G.tkInfo && G.tkInfo();
    if (ti) h += `<div class="m task${ti.done ? ' done' : ''}"><span class="t">${esc(ti.done ? ti.loc + ' ready to unlock' : 'Unlock \u00B7 ' + ti.title)}</span><em>${ti.done ? '\u2713' : Math.floor(ti.p) + '/' + ti.n}</em><u style="width:${Math.round(100 * Math.min(1, ti.p / ti.n))}%"></u></div>`;
    if (G.daily) { const dp = G.dailyDone ? G.daily.n : G.dailyProgress(); h += `<div class="m daily${G.dailyDone ? ' done' : ''}"><span class="t">Daily \u00B7 ${esc(G.daily.text.replace(' in one run', ''))}</span><em>${G.dailyDone ? '\u2713' : dp + '/' + G.daily.n}</em><u style="width:${Math.round(100 * Math.min(1, dp / G.daily.n))}%"></u></div>`; }
    return h;
  }
  const coinSvg = '<svg class="coin" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.6" fill="#d9a93f" stroke="#7a5a14" stroke-width="1.4"/><circle cx="10" cy="10" r="5.6" fill="none" stroke="#8a6a1c" stroke-width="1.1"/></svg>';

  let cuId = 0;
  function countUp(rows) {                                         // run-end summary: numbers tick up (ease-out), staggered; the final value is always exact
    const id = ++cuId, t0 = performance.now(), reduce = global.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const r of rows) if (r[0]) r[0].textContent = r[2](reduce ? r[1] : (r[3] !== undefined ? r[1] - r[3] : 0));
    if (reduce) return;
    const tick = (now) => {
      if (id !== cuId) return; let busy = false;
      rows.forEach((r, i) => { if (!r[0]) return; const k = Math.min(1, Math.max(0, (now - t0 - 250 - i * 180) / 950)), e = 1 - Math.pow(1 - k, 3), from = r[3] !== undefined ? r[1] - r[3] : 0;
        r[0].textContent = r[2](k >= 1 ? r[1] : Math.round(from + (r[1] - from) * e)); if (k < 1) busy = true; r[0].parentNode.classList.toggle('ticking', k < 1); });
      if (busy) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  function buildCard() {
    last.cardBuilt = true;
    const sm = G.summary || { lines: [], verdict: '', tip: '', overall: 0, share: [.33, .33, .33] };
    const svv = global.Save && Save.data;
    el.cstats.innerHTML =
      `<div class="cs sc-score"><small>Score</small><b><span class="cv">${num(G.finalPts || 0)}</span></b></div>` +
      `<div class="cs sc-best"><small>Best score</small><b>${num(G.bestPts || 0)}</b>${G.newBestPts ? '<i>New best</i>' : ''}</div>` +
      `<div class="cs sc-cash"><small>Cash earned</small><b>${coinSvg}<span class="cv">${money(G.bankedRun || G.finalScore || 0)}</span></b></div>` +
      `<div class="cs sc-total"><small>Total cash</small><b>${coinSvg}<span class="cv">${money(svv ? svv.wallet : 0)}</span></b></div>`;
    countUp([[el.cstats.querySelector('.sc-score .cv'), G.finalPts || 0, num], [el.cstats.querySelector('.sc-cash .cv'), G.bankedRun || G.finalScore || 0, money], [el.cstats.querySelector('.sc-total .cv'), svv ? svv.wallet : 0, money, G.bankedRun || G.finalScore || 0]]);
    el.csub.textContent = 'Survived ' + mmss(G.time);
    el.crows.innerHTML = sm.lines.map(l => `<div class="k">${l.k}</div><div class="v${l.hot ? ' hot' : ''}">${l.v}</div>`).join('');
    const names = ['Left', 'Middle', 'Right'], mx = Math.max.apply(null, sm.share);
    el.lanes.innerHTML = sm.share.map((s, i) => `<div class="ln${s === mx && s >= .5 ? ' hot' : ''}"><div class="bar" style="height:${Math.max(4, Math.round(s * 100))}%"></div>${names[i]} ${Math.round(s * 100)}%</div>`).join('');
    el.cwallet.textContent = ''; el.oinfo.innerHTML = infoHTML();
    el.verdict.textContent = sentence(sm.verdict); el.tip.textContent = sentence(sm.tip);
  }
  global.HUD = H;
})(window);
