/* RUSH HOUR (was Signal Lost) — Characters screen (characters tab + upgrades tab + stats) + Settings modal. DOM only; state lives in Save. */
(function (global) {
  'use strict';
  const $ = id => document.getElementById(id);
  const S = global.Save;
  const money = n => '\u20A6' + global.Save.compact(n);
  const mmss = t => { t = Math.floor(t || 0); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
  const Shop = { hooks: {} };
  let shop, body, settings, openCount = 0;

  Shop.isOpen = () => !!(shop && (!shop.classList.contains('hidden') || !settings.classList.contains('hidden') || !$('howto').classList.contains('hidden')));

  function pips(id) { const u = S.UPGRADES[id], lv = S.data.up[id]; let h = ''; for (let i = 0; i < u.max; i++) h += '<i' + (i < lv ? ' class="on"' : '') + '></i>'; return '<span class="pips" aria-label="level ' + lv + ' of ' + u.max + '">' + h + '</span>'; }

  let tab = 'chars', heroId = null;
  const LOCK = '<svg class="lk" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2" fill="currentColor"/><path d="M8 10.5V8a4 4 0 018 0v2.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
  function charCard(id) {
    const d = S.data, c = S.CHARS[id], T = S.TIERS[c.tier], own = d.owned.indexOf(id) >= 0, on = d.outfit === id;
    const img = global.Render && Render.preview ? Render.preview(id, c) : null;
    const pv = img ? '<img src="' + img + '" alt="' + c.name + ' ' + c.nick + ' preview" width="116" height="116">' : '<span class="sw"><i style="background:' + c.swatch[0] + '"></i><i style="background:' + c.swatch[1] + '"></i></span>';
    let btn;
    if (on) btn = '<button class="buy eq" disabled>Equipped</button>';
    else if (own) btn = '<button class="buy own" data-buy="equip:' + id + '">Equip</button>';
    else if (d.wallet >= c.cost) btn = '<button class="buy" data-buy="outfit:' + id + '">Buy ' + money(c.cost) + '</button>';
    else btn = '<button class="buy" disabled>' + LOCK + money(c.cost) + '</button>';
    const note = !own && d.wallet < c.cost ? '<div class="need">Need ' + money(c.cost - d.wallet) + ' more</div>' : '';
    const st = on ? 'equipped' : own ? 'owned' : 'locked';
    return '<div class="char ' + st + ' t-' + c.tier + (heroId === id ? ' sel' : '') + '" data-cid="' + id + '" style="--tc:' + T.color + '"><div class="pv">' + pv + (own ? '' : '<span class="lock">' + LOCK + '</span>') + '</div>' +
      '<div class="ci"><div class="tier">' + T.label + '</div><div class="cn">' + c.name + ' <em>&ldquo;' + c.nick + '&rdquo;</em></div>' +
      '<div class="bio">' + c.bio + '</div><div class="perk"><b>' + c.perkName + '</b> ' + c.perkDesc + '</div>' +
      '<div class="cact">' + btn + note + '</div></div></div>';
  }

  /* ---- location thumbnails: painted from the stage's own colours (cheap, no extra 3D render) ---- */
  const thumbs = {};
  const hx = n => '#' + ('000000' + (n >>> 0).toString(16)).slice(-6);
  const mixc = (a, b, t) => { const r = (a >> 16 & 255) * (1 - t) + (b >> 16 & 255) * t, g = (a >> 8 & 255) * (1 - t) + (b >> 8 & 255) * t, bl = (a & 255) * (1 - t) + (b & 255) * t; return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (bl | 0) + ')'; };
  function thumb(i) {
    if (thumbs[i]) return thumbs[i];
    const st = global.STAGES && global.STAGES[i]; if (!st) return '';
    const W = 312, H = 156, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d');
    const hz = H * .5;
    let g = c.createLinearGradient(0, 0, 0, hz); g.addColorStop(0, hx(st.zen)); g.addColorStop(.55, hx(st.mid)); g.addColorStop(1, hx(st.hor)); c.fillStyle = g; c.fillRect(0, 0, W, hz + 1);
    if (st.stars > .1) { c.fillStyle = 'rgba(235,240,250,' + Math.min(.9, st.stars) + ')'; for (let k = 0; k < 38; k++) { const x = (k * 97 % W), y = (k * 53 % (hz - 20)); c.fillRect(x, y, 1.4, 1.4); } }
    if (st.disc > .1) { const sx = W * (.5 + (st.discPos ? st.discPos[0] / 260 : 0)), sy = hz - 14 - (st.discPos ? Math.max(0, st.discPos[1]) * .8 : 20); c.fillStyle = hx(st.discCol); c.globalAlpha = .9; c.beginPath(); c.arc(Math.max(26, Math.min(W - 26, sx)), Math.max(18, sy), 13, 0, 7); c.fill(); c.globalAlpha = 1; }
    // far skyline + near buildings
    const sk = mixc(st.skyTint || 0x888888, st.hor, .55), bt = mixc(st.bldTint || 0x999999, st.fog, .35);
    c.fillStyle = sk; let x = 0, k = 0; while (x < W) { const w = 12 + (k * 7 % 17), h = (8 + (k * 13 % 26)) * (st.sky || 0) * 1.1; c.fillRect(x, hz - h, w, h + 2); x += w + 1; k++; }
    if (st.bld > .1) {
      c.fillStyle = bt; for (const side of [0, 1]) { let y0 = 0; for (let j = 0; j < 4; j++) { const w = 26 + j * 10, h = (46 + (j * 29 % 30)) * st.bld; const bx = side ? W - w - j * 30 : j * 30; c.fillStyle = mixc(st.bldTint || 0x999999, 0x151515, .22 + j * .08); c.fillRect(bx, hz - h * (1 - j * .12), w, h * (1 - j * .12)); } }
    }
    c.fillStyle = mixc(st.ground, st.fog, .15); c.fillRect(0, hz, W, H - hz);
    // road in perspective
    c.fillStyle = 'rgb(' + (72 * st.road[0] | 0) + ',' + (74 * st.road[1] | 0) + ',' + (78 * st.road[2] | 0) + ')'; c.beginPath(); c.moveTo(W * .46, hz); c.lineTo(W * .54, hz); c.lineTo(W * .9, H); c.lineTo(W * .1, H); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(232,226,205,.55)'; c.lineWidth = 2; for (const f of [-.17, .17]) { c.beginPath(); c.moveTo(W * (.5 + f * .08), hz); c.lineTo(W * (.5 + f * 1.6), H); c.stroke(); }
    if (st.props && st.props.palm) { c.strokeStyle = '#3a2f22'; c.lineWidth = 3; c.fillStyle = '#35502f'; for (const px of [W * .18, W * .84]) { c.beginPath(); c.moveTo(px, H - 6); c.lineTo(px + 3, hz - 24); c.stroke(); c.beginPath(); c.ellipse(px + 3, hz - 26, 16, 5, 0, 0, 7); c.fill(); } }
    const pr = st.props || {};
    if (pr.lantern) { for (const px of [W * .2, W * .8]) { c.fillStyle = '#5a2a20'; c.fillRect(px - 1, hz - 22, 2, 28); c.fillStyle = '#d8282a'; c.beginPath(); c.ellipse(px, hz - 18, 5, 6.5, 0, 0, 7); c.fill(); c.fillStyle = '#e8b030'; c.fillRect(px - 3, hz - 25, 6, 2); } c.strokeStyle = '#2f6a52'; c.fillStyle = '#a8342a'; for (const px of [W * .08, W * .9]) { for (let t = 0; t < 3; t++) { c.fillRect(px - 8 + t * 2, hz - 12 - t * 14, 16 - t * 4, 8); c.fillStyle = '#2f6a52'; c.beginPath(); c.moveTo(px - 14 + t * 3, hz - 11 - t * 14); c.lineTo(px + 14 - t * 3, hz - 11 - t * 14); c.lineTo(px, hz - 20 - t * 14); c.fill(); c.fillStyle = '#a8342a'; } } }
    if (pr.snowpine) { for (const [px, sc] of [[W * .15, 1], [W * .86, 1.2], [W * .28, .7]]) { c.fillStyle = '#2c5a3c'; c.beginPath(); c.moveTo(px - 13 * sc, hz + 4); c.lineTo(px, hz - 38 * sc); c.lineTo(px + 13 * sc, hz + 4); c.fill(); c.fillStyle = '#f2f6fa'; c.beginPath(); c.moveTo(px - 7 * sc, hz - 20 * sc); c.lineTo(px, hz - 38 * sc); c.lineTo(px + 7 * sc, hz - 20 * sc); c.fill(); } c.fillStyle = 'rgba(255,255,255,.9)'; for (let n = 0; n < 40; n++) c.fillRect(n * 53 % W, n * 29 % H, 1.6, 1.6); }
    if (pr.dune) { c.fillStyle = '#d9b87c'; c.beginPath(); c.ellipse(W * .2, hz + 2, 70, 12, 0, 0, 7); c.fill(); c.fillStyle = '#e2c488'; c.beginPath(); c.ellipse(W * .85, hz + 2, 60, 9, 0, 0, 7); c.fill(); }
    if (pr.spire) { c.fillStyle = '#9ec4de'; c.fillRect(W * .74, hz - 56, 7, 58); c.fillRect(W * .745, hz - 74, 2, 20); c.fillStyle = '#cfe4f2'; c.fillRect(W * .74 + 7, hz - 40, 5, 42); }
    if (pr.tpole) { c.fillStyle = '#4a443e'; for (const px of [W * .16, W * .88]) { c.fillRect(px, hz - 40, 2.4, 46); c.fillRect(px - 8, hz - 36, 18, 2); } c.strokeStyle = '#25262a'; c.lineWidth = 1; c.beginPath(); c.moveTo(W * .16, hz - 35); c.quadraticCurveTo(W * .5, hz - 28, W * .88, hz - 35); c.stroke(); c.fillStyle = '#fffbe8'; c.fillRect(W * .3, hz - 2, 10, 16); c.fillRect(W * .72, hz - 2, 10, 16); }
    if (pr.phonebox) { c.fillStyle = '#c0262b'; for (const px of [W * .2, W * .8]) { c.fillRect(px - 6, hz - 12, 12, 22); c.fillStyle = '#efe3b0'; c.fillRect(px - 4, hz - 8, 8, 12); c.fillStyle = '#c0262b'; } c.fillStyle = '#b49a6a'; c.fillRect(W * .62, hz - 52, 9, 52); c.fillStyle = '#f3efdc'; c.fillRect(W * .62 + 2, hz - 48, 5, 5); }
    if (pr.favela) { const cols = ['#e8a33a', '#d8504a', '#4aa896', '#5a8ad0', '#ecd466', '#c870a8']; for (let n = 0; n < 9; n++) { const px = n < 5 ? 6 + n * 22 : W - 120 + (n - 5) * 26, hh = 14 + (n * 7 % 3) * 9; c.fillStyle = cols[n % 6]; c.fillRect(px, hz + 4 - hh, 20, hh); c.fillStyle = 'rgba(0,0,0,.55)'; c.fillRect(px + 4, hz + 6 - hh + 5, 4, 5); c.fillRect(px + 12, hz + 6 - hh + 5, 4, 5); } }
    if (pr.sakura) { c.fillStyle = '#f2b4c8'; for (const px of [W * .14, W * .86]) { c.fillStyle = '#4a3a30'; c.fillRect(px - 1, hz - 8, 3, 14); c.fillStyle = '#f2b4c8'; c.beginPath(); c.ellipse(px, hz - 14, 14, 10, 0, 0, 7); c.fill(); } }
    if (st.props && (st.props.rail || st.props.toll)) { c.fillStyle = 'rgba(40,44,50,.9)'; c.fillRect(0, hz + 10, W * .16, 3); c.fillRect(W * .84, hz + 10, W * .16, 3); }
    if (st.lampOn > .3) { c.fillStyle = hx(st.lampCol); for (const lx of [W * .3, W * .7]) { c.globalAlpha = .9; c.beginPath(); c.arc(lx, hz + 6, 2.4, 0, 7); c.fill(); c.globalAlpha = .18; c.beginPath(); c.arc(lx, hz + 6, 12, 0, 7); c.fill(); } c.globalAlpha = 1; }
    if (st.rain > .1) { c.strokeStyle = 'rgba(190,205,220,.5)'; c.lineWidth = 1; for (let n = 0; n < 60; n++) { const rx = n * 37 % W, ry = n * 61 % H; c.beginPath(); c.moveTo(rx, ry); c.lineTo(rx - 3, ry + 11); c.stroke(); } }
    g = c.createLinearGradient(0, H * .6, 0, H); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.35)'); c.fillStyle = g; c.fillRect(0, 0, W, H);
    return (thumbs[i] = cv.toDataURL('image/jpeg', .82));
  }
  Shop.thumb = thumb;
  function bar(p, n, label) { const pc = Math.round(100 * Math.min(1, p / n)); return '<div class="req' + (p >= n ? ' ok' : '') + '"><div class="rl"><span>' + label + '</span><b>' + (p >= n ? 'Done' : '') + '</b></div><div class="bar"><i style="width:' + pc + '%"></i></div></div>'; }
  function locCard(i) {
    const d = S.data, L = S.LOCS[i], open = S.locOpen(i), sel = d.loc === i, st = global.STAGES[i];
    const from = i > 0 ? S.LOCS[i - 1].name : '';
    let h = '<div class="loc ' + (sel ? 'sel' : open ? 'open' : 'shut') + '" data-i="' + i + '"><div class="lv"><img src="' + thumb(i) + '" alt="' + L.name + ' preview" width="156" height="78">' + (open ? '' : '<span class="lock">' + LOCK + '</span>') + '<span class="no">' + (i + 1) + '</span></div>' +
      '<div class="li"><div class="ln">' + L.name + '</div><div class="ls">' + (st ? st.sub : '') + '</div>';
    if (!open) {
      const t = L.task, tp = S.locProgress(i), tn = t.n;
      const tl = t.kind === 'stars' ? (Math.floor(tp / 60) + ':' + String(tp % 60).padStart(2, '0') + ' of ' + Math.floor(tn / 60) + ':00') : t.kind === 'set' ? tp + ' of 3 items' : t.kind === 'word' ? t.word.split('').map((c, k) => k < tp ? c : '\u00B7').join('') : tp + ' of ' + tn;
      h += '<div class="task"><div class="tt">Task \u00B7 ' + t.title + '</div><div class="th">' + t.how + '</div>' + bar(tp, tn, tl);
      if (t.kind === 'set') { const m = d.lp[i] || 0; h += '<div class="items">' + t.items.map((n_, k) => '<span class="' + (m & (1 << k) ? 'got' : '') + '">' + n_ + '</span>').join('') + '</div>'; }
      h += '</div>' + bar(Math.min(d.wallet, L.cost), L.cost, 'Cash ' + money(Math.min(d.wallet, L.cost)) + ' of ' + money(L.cost));
      const can = S.canUnlockLoc(i);
      const why = !S.taskDone(i) ? 'Finish the task first' : d.wallet < L.cost ? 'Need ' + money(L.cost - d.wallet) + ' more' : '';
      h += '<div class="cact">' + (can ? '<button class="buy" data-buy="loc:' + i + '">Unlock ' + money(L.cost) + '</button>' : '<button class="buy" disabled>' + LOCK + 'Locked</button>') + (why ? '<div class="need">' + why + '</div>' : '') + '</div>';
    } else {
      const nx = S.activeTask(i);
      h += '<div class="cact">' + (sel ? '<button class="buy eq" disabled>Riding here</button>' : '<button class="buy own" data-buy="selloc:' + i + '">Ride here</button>') + '</div>';
      if (nx) h += '<div class="hint">Next task (' + nx.task.title.toLowerCase() + ') is done here.</div>';
    }
    return h + '</div></div>';
  }
  function render() {
    const d = S.data; S.rollDay();
    $('shop-wallet').textContent = money(d.wallet); Shop.refreshLoc();
    document.querySelectorAll('#shop-tabs [data-tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === tab ? 'true' : 'false'));
    let h = '';
    if (tab === 'chars') {
      const ids = Object.keys(S.CHARS);
      h += '<p class="note top">' + d.owned.length + ' of ' + ids.length + ' unlocked. Every character has a perk. Legendary riders are a long grind.</p>';
      for (const id of ids) h += charCard(id);
    } else if (tab === 'loc') {
      h += '<p class="note top">' + d.locs.length + ' of ' + S.LOCS.length + ' locations unlocked. A run stays in the location you pick. Every new place needs cash and a task done while riding the one before it.</p>';
      for (let i = 0; i < S.LOCS.length; i++) h += locCard(i);
    } else {
      h += '<h3>Upgrades</h3>';
      for (const id of Object.keys(S.UPGRADES)) {
        const u = S.UPGRADES[id], c = S.cost(id);
        const btn = c === null ? '<button class="buy eq" disabled>' + (u.max === 1 ? 'Owned' : 'Maxed') + '</button>'
          : '<button class="buy" data-buy="up:' + id + '"' + (d.wallet < c ? ' disabled' : '') + '>' + money(c) + '</button>';
        h += '<div class="item"><div class="nm">' + u.name + (u.max > 1 ? pips(id) : '') + '</div><div class="ds">' + u.desc + '</div><div class="act">' + btn + '</div></div>';
      }
      const st = d.stats;
      h += '<h3>Your stats</h3><div class="stats">' +
        [['Best score', Math.max(st.bestPts || 0, global.Game ? Game.bestPts : 0).toLocaleString('en-US')], ['Best cash in a run', money(Math.max(st.best, global.Game ? Game.best : 0))], ['Best cash today', money(d.daily.best)], ['Runs today', d.daily.runs], ['Total runs', st.runs], ['Total cash earned', money(st.cash)],
         ['Longest run', mmss(st.longest)], ['Near misses', st.near], ['Cash grabbed', (st.coins || 0)], ['Words spelled', st.words || 0], ['Missions done', st.missions || 0], ['Jammers grabbed', st.jams], ['Bail-outs used', st.bails]].map(r => '<div class="k">' + r[0] + '</div><div class="v">' + r[1] + '</div>').join('') + '</div>';
      h += '<p class="note">Cash you earn at the end of every run is banked here. Upgrades are permanent.</p>';
    }
    body.innerHTML = h;
    heroSync();
  }
  function heroSync() {
    const hero = $('hero'), R_ = global.Render && Render.hero;
    const show = tab === 'chars' && R_ && !shop.classList.contains('hidden') || (tab === 'chars' && R_ && heroOpening);
    hero.classList.toggle('hidden', !(tab === 'chars' && R_));
    if (!(tab === 'chars' && R_)) { R_ && R_.stop(); return; }
    if (!heroId || !S.CHARS[heroId]) heroId = S.data.outfit;
    const c = S.CHARS[heroId], T = S.TIERS[c.tier];
    R_.show($('hero-cv'), c); R_.start();
    $('hero-name').textContent = c.name + ' \u201c' + c.nick + '\u201d'; const tr = $('hero-tier'); tr.textContent = T.label; tr.style.setProperty('--tc', T.color);
    body.querySelectorAll('.char').forEach(el => el.classList.toggle('sel', el.dataset.cid === heroId));
  }
  let heroOpening = false;
  Shop.render = render;
  Shop.refreshLoc = function () { const n = $('loc-name'); if (n) n.textContent = S.LOCS[S.data.loc].name; };

  function refreshSettings() {
    const set = S.data.set, M = { master: !global.Sfx.muted, music: set.music, sfx: set.sfx, haptics: set.haptics };
    settings.querySelectorAll('[data-set]').forEach(b => b.setAttribute('aria-checked', M[b.dataset.set] ? 'true' : 'false'));
  }
  Shop.refreshSettings = refreshSettings;

  Shop.openShop = function (t) { if (t) tab = t; heroId = S.data.outfit; heroOpening = true; render(); heroOpening = false; shop.classList.remove('hidden'); body.scrollTop = 0; $('shop-close').focus({ preventScroll: true }); };
  Shop.closeShop = function () { shop.classList.add('hidden'); global.Render && Render.hero && Render.hero.stop(); Shop.hooks.onClose && Shop.hooks.onClose(); };
  Shop.openSettings = function () { refreshSettings(); settings.classList.remove('hidden'); $('set-close').focus({ preventScroll: true }); };
  Shop.closeSettings = function () { settings.classList.add('hidden'); Shop.hooks.onClose && Shop.hooks.onClose(); };
  Shop.closeAll = function () { if (!shop.classList.contains('hidden')) Shop.closeShop(); else if (!settings.classList.contains('hidden')) Shop.closeSettings(); else if (!$('howto').classList.contains('hidden')) Shop.closeHow(); };
  Shop.openHow = function () { $('howto').classList.remove('hidden'); $('howto-close').focus({ preventScroll: true }); };
  Shop.closeHow = function () { $('howto').classList.add('hidden'); Shop.hooks.onClose && Shop.hooks.onClose(); };

  Shop.init = function (hooks) {
    Shop.hooks = hooks || {};
    setTimeout(() => Shop.refreshLoc(), 0);
    shop = $('shop'); body = $('shop-body'); settings = $('settings');
    $('shop-close').addEventListener('click', e => { e.stopPropagation(); Shop.closeShop(); });
    $('set-close').addEventListener('click', e => { e.stopPropagation(); Shop.closeSettings(); });
    for (const id of ['btn-chars', 'btn-chars-over']) $(id).addEventListener('click', e => { e.stopPropagation(); Shop.hooks.ui && Shop.hooks.ui(); Shop.openShop(); });
    for (const id of ['btn-settings', 'btn-gear']) $(id).addEventListener('click', e => { e.stopPropagation(); Shop.hooks.ui && Shop.hooks.ui(); Shop.openSettings(); });
    $('btn-help').addEventListener('click', e => { e.stopPropagation(); Shop.hooks.ui && Shop.hooks.ui(); Shop.openHow(); });
    $('howto-close').addEventListener('click', e => { e.stopPropagation(); Shop.closeHow(); });
    $('howto').addEventListener('click', e => { if (e.target === $('howto')) Shop.closeHow(); });
    $('btn-loc').addEventListener('click', e => { e.stopPropagation(); Shop.hooks.ui && Shop.hooks.ui(); Shop.openShop('loc'); });
    $('shop-tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (!b) return; e.stopPropagation(); tab = b.dataset.tab; render(); body.scrollTop = 0; });
    body.addEventListener('click', e => {
      const cd = e.target.closest('.char[data-cid]'); if (cd && !e.target.closest('[data-buy]') && cd.dataset.cid !== heroId) { heroId = cd.dataset.cid; heroSync(); }
      const b = e.target.closest('[data-buy]'); if (!b || b.disabled) return;
      const [kind, id] = b.dataset.buy.split(':'); let ok = false;
      if (kind === 'up') ok = S.buyUpgrade(id); else if (kind === 'outfit') ok = S.buyOutfit(id); else if (kind === 'equip') ok = S.equip(id); else if (kind === 'loc') ok = S.unlockLoc(+id); else if (kind === 'selloc') ok = S.selectLoc(+id);
      if (ok) { Shop.hooks.onChange && Shop.hooks.onChange(kind === 'equip' || kind === 'selloc' ? 'equip' : 'buy'); }
      const y = body.scrollTop; render(); body.scrollTop = y;
    });
    settings.addEventListener('click', e => {
      const b = e.target.closest('[data-set]'); if (!b) return;
      const k = b.dataset.set, set = S.data.set;
      if (k === 'master') global.Sfx.setMuted(!global.Sfx.muted); else { set[k] = !set[k]; S.save(); }
      if (k === 'music') global.Sfx.setMusicEnabled(set.music); if (k === 'sfx') global.Sfx.setSfxEnabled(set.sfx);
      Shop.hooks.onChange && Shop.hooks.onChange('settings'); refreshSettings();
    });
    [shop, settings].forEach(m => m.addEventListener('pointerdown', e => { if (e.target === m) { m === shop ? Shop.closeShop() : Shop.closeSettings(); } }));
    $('shop-wallet').textContent = money(S.data.wallet); Shop.refreshLoc();
  };
  Shop.money = money;
  global.Shop = Shop;
})(window);
