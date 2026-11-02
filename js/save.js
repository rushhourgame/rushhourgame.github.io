/* RUSH HOUR (was Signal Lost) — persistent save (localStorage): wallet, upgrades, outfits, run stats, daily best, settings. */
(function (global) {
  'use strict';
  const KEY = 'sl_save_v1';
  const CASH_X = 12;   // v5 economy: every cash earning is worth 12x (prices are ~1000x higher than v4)
  /* compact money text for tight spots: 950 / 12,400 / 450K / 1.26M / 12.5M / 250M */
  const compact = n => { n = Math.max(0, Math.floor(n)); if (n < 10000) return n.toLocaleString('en-US'); const t = (v, d) => String(+v.toFixed(d)); if (n < 1e6) return t(n / 1e3, n < 1e5 ? 1 : 0) + 'K'; if (n < 1e9) return t(n / 1e6, n < 1e7 ? 2 : n < 1e8 ? 1 : 0) + 'M'; return t(n / 1e9, 2) + 'B'; };
  const UPGRADES = {
    jam:    { name: 'Jammer battery', desc: 'Signal jammer lasts longer (+1.5 s per level).', max: 3, cost: [5000000, 10000000, 20000000] },
    cash:   { name: 'Cash multiplier', desc: 'Every bill you grab is worth more (+25% per level). You still have to steer into it.', max: 3, cost: [6000000, 12000000, 25000000] },
    turbo:  { name: 'Turbo tank', desc: 'Turbo pads and Double Cash pick-ups last longer (+1 s per level).', max: 3, cost: [5000000, 10000000, 20000000] },
    bail:   { name: 'Bail-out', desc: 'Survive one crash per run: the street clears and you keep going.', max: 1, cost: [15000000] }
  };
  /* ---- playable characters. tier -> price band. look = 3D build spec read by render3d.buildChar. perk = what the sim reads. ---- */
  const TIERS = { common: { label: 'Common', color: '#d9b97a' }, rare: { label: 'Rare', color: '#6fa0cf' }, epic: { label: 'Epic', color: '#b08ad6' }, legendary: { label: 'Legendary', color: '#e0b04c' } };
  const OUTFITS = {
    courier: { name: 'Tunde', nick: 'Dispatch', tier: 'common', cost: 0,
      bio: 'Lagos dispatch rider. Knows every shortcut and owes nobody a favour.', perkName: 'Standard issue', perkDesc: 'No perk. Pure skill.', perk: {},
      look: { id: 'courier' }, swatch: ['#c65a3e', '#1d8081'] },
    danfo: { name: 'Bisi', nick: 'Danfo', tier: 'common', cost: 5000000,
      bio: 'Ex-conductor from Oshodi. Collects change faster than the bus can stop.', perkName: 'Conductor hands', perkDesc: 'Cash pick-ups pay +10%.', perk: { cash: 0.10 },
      look: { id: 'danfo' }, swatch: ['#d0a02a', '#1c1c1e'] },
    sparks: { name: 'Chidi', nick: 'Sparks', tier: 'common', cost: 8000000,
      bio: 'Mechanic from Ladipo. Fixes anything that glitches, including the signal.', perkName: 'Signal fixer', perkDesc: 'Signal jammer lasts 1.5 s longer.', perk: { jam: 1.5 },
      look: { id: 'sparks' }, swatch: ['#2f4f78', '#c9a227'] },
    ankara: { name: 'Amaka', nick: 'Ankara', tier: 'rare', cost: 15000000,
      bio: 'Fabric trader from Balogun. Reads a street like a price tag.', perkName: 'Eye for letters', perkDesc: 'Letters pay +60% cash. Mission rewards +25%.', perk: { letters: 0.6, mission: 0.25 },
      look: { id: 'ankara' }, swatch: ['#8e2f4a', '#1f6b66'] },
    bolt: { name: 'Yinka', nick: 'Lagos Bolt', tier: 'rare', cost: 25000000,
      bio: 'Track star from Surulere. Trains on Third Mainland at 5 a.m.', perkName: 'Second wind', perkDesc: 'Turbo and Double Cash last 1.5 s longer.', perk: { turbo: 1.5 },
      look: { id: 'bolt' }, swatch: ['#33383f', '#e8e6df'] },
    sultan: { name: 'Alhaji Musa', nick: 'Sultan', tier: 'epic', cost: 40000000,
      bio: 'Kano trader in a spotless babariga. Never rushes, never loses.', perkName: 'Cool head', perkDesc: 'Combo lasts 60% longer. Near-miss bonus x1.5.', perk: { combo: 0.6, near: 0.5 },
      look: { id: 'sultan' }, swatch: ['#e6dcc2', '#7a2c25'] },
    agbero: { name: 'Kelechi', nick: 'Agbero Boss', tier: 'epic', cost: 60000000,
      bio: 'Motor-park boss. Collects what he is owed and dodges what he is not.', perkName: 'Auto-dodge', perkDesc: 'The first crash every run is cancelled for free. Stacks with Bail-out.', perk: { autododge: 1 },
      look: { id: 'agbero' }, swatch: ['#c4a02c', '#2d2f33'] },
    okada: { name: 'Ayo', nick: 'Okada', tier: 'legendary', cost: 100000000,
      bio: 'Fastest okada rider on Ikorodu Road. Treats traffic as a suggestion.', perkName: 'Wheelie boost', perkDesc: 'A free 4 s turbo wheelie at 12 s, then every 40 s.', perk: { wheelie: 1 },
      look: { id: 'okada' }, swatch: ['#4b5a3a', '#c9cbc8'] },
    shadow: { name: 'Dayo', nick: 'Shadow', tier: 'legendary', cost: 150000000,
      bio: 'Nobody has a photo of him. The police have stopped asking.', perkName: 'Cop cloak', perkDesc: 'Invisible to police for 6 s at 10 s, then every 30 s.', perk: { cloak: 1 },
      look: { id: 'shadow' }, swatch: ['#23262b', '#6b6f76'] },
    scholar: { name: 'Adaeze', nick: 'Professor', tier: 'legendary', cost: 250000000,
      bio: 'Professor from Nsukka. Spells every word on the road before it ends.', perkName: 'Double letters', perkDesc: 'Letters appear twice as often. Every letter fills two slots.', perk: { doubleLetters: 1 },
      look: { id: 'scholar' }, swatch: ['#1f3a5f', '#c9a24a'] },
    kungfu: { name: 'Li Wei', nick: 'Iron Palm', tier: 'epic', cost: 300000000,
      bio: 'Shanghai courier trained on the Bund at dawn. Greets every near miss with a fist and a palm.', perkName: 'Iron focus', perkDesc: 'Near-miss points +100% and combos last 50% longer.', perk: { near: 1, combo: 0.5 },
      look: { id: 'kungfu' }, swatch: ['#a8281f', '#17181c'] },
    snow: { name: 'Freja', nick: 'Powder', tier: 'epic', cost: 400000000,
      bio: 'Snowboarder from the Alps who swapped the mountain for a motorbike. Never takes the parka off.', perkName: 'Powder rush', perkDesc: 'Boosts and 2x last 3 s longer. Signal jammer lasts 1 s longer.', perk: { turbo: 3, jam: 1 },
      look: { id: 'snow' }, swatch: ['#d4542c', '#eaf2f6'] },
    sheikh: { name: 'Khalid', nick: 'Gold Card', tier: 'epic', cost: 500000000,
      bio: 'Dubai rider in a black bisht and a pearl-white sports bike. Tips in gold.', perkName: 'Gold card', perkDesc: 'Cash pick-ups pay +60%.', perk: { cash: 0.6 },
      look: { id: 'sheikh' }, swatch: ['#f1eee4', '#d0aa4d'] },
    tokyo: { name: 'Ren', nick: 'Drift King', tier: 'legendary', cost: 600000000,
      bio: 'Tokyo touge racer in a sukajan jacket. Wheelie boost every 40 s and missions pay 50% more.', perkName: 'Touge line', perkDesc: 'Free wheelie boost every 40 s. Mission rewards +50%.', perk: { wheelie: 1, mission: 0.5 },
      look: { id: 'tokyo' }, swatch: ['#1d3a33', '#b8262c'] },
    punk: { name: 'Mo', nick: 'Anarchy', tier: 'legendary', cost: 700000000,
      bio: 'London punk with a pink mohawk and a union-jack back patch. Walks away from the first crash.', perkName: 'Anarchy', perkDesc: 'Auto-dodge the first crash. Near-miss points +50%.', perk: { autododge: 1, near: 0.5 },
      look: { id: 'punk' }, swatch: ['#e0307a', '#8a1f24'] },
    samba: { name: 'Camila', nick: 'Carnival', tier: 'legendary', cost: 800000000,
      bio: 'Rio samba rider. Pandeiro on the hip, letters on the beat.', perkName: 'Carnival', perkDesc: 'Letters appear twice as often and pay +100%. Cash +30%.', perk: { doubleLetters: 1, letters: 1, cash: 0.3 },
      look: { id: 'samba' }, swatch: ['#ffd21f', '#1e9a4a'] }
  };

  /* ---- locations (sixteen stages). A run stays in ONE location. Each one past Lagos Island needs cash AND a task, done while riding the previous location. ---- */
  const LOCS = [
    { id: 0, name: 'Lagos Island', cost: 0, tag: 'Where every courier starts. Free.' },
    { id: 1, name: 'Third Mainland Bridge', cost: 5000000, tag: 'Eleven kilometres of bridge over the lagoon.', task: { kind: 'keys', n: 3, title: 'Find 3 hidden keys', how: 'Keys turn up now and then on the road in Lagos Island. Ride through them.', unit: 'keys' } },
    { id: 2, name: 'Lekki Toll Gate', cost: 8000000, tag: 'Toll plaza, express lanes, cold rain coming.', task: { kind: 'vault', n: 2, title: 'Crack 2 lockboxes', how: 'A lockbox hangs over a ramp in Third Mainland Bridge. Hit the ramp and grab it in the air.', unit: 'lockboxes' } },
    { id: 3, name: 'Ikeja Market', cost: 12000000, tag: 'Crowded stalls and loud horns.', task: { kind: 'parcels', n: 5, title: 'Deliver 5 parcels', how: 'In Lekki Toll Gate, pick up a parcel, then ride through the green drop ring. A crash loses it.', unit: 'parcels' } },
    { id: 4, name: 'Abuja Boulevard', cost: 18000000, tag: 'Wide clean avenues, no mercy on mistakes.', task: { kind: 'word', n: 5, word: 'ABUJA', title: 'Spell ABUJA', how: 'In Ikeja Market, gold-ringed letters A, B, U, J, A appear in order. Progress is kept between runs.', unit: 'letters' } },
    { id: 5, name: 'Harbour Docks', cost: 25000000, tag: 'Cranes, containers and floodlights.', task: { kind: 'set', n: 3, title: 'Collect the port pass set', how: 'In Abuja Boulevard, find a Customs Seal, a Manifest and a Container Key. One of each.', unit: 'of 3 items', items: ['Customs Seal', 'Manifest', 'Container Key'] } },
    { id: 6, name: 'Desert Highway', cost: 35000000, tag: 'Heat haze and a very long road.', task: { kind: 'stars', n: 150, title: 'Survive 2.5 minutes at 5 stars', how: 'In Harbour Docks, stay alive while the city has you at full heat. Time adds up across runs.', unit: 's' } },
    { id: 7, name: 'Rainy Industrial Zone', cost: 50000000, tag: 'Wet concrete, trucks, long shadows.', task: { kind: 'combo', n: 20, title: 'Chain a 20 combo in one run', how: 'In Desert Highway, keep cash, near misses and letters rolling without a break.', unit: 'combo' } },
    { id: 8, name: 'Savanna Sunset', cost: 70000000, tag: 'Gold light, open country, fast traffic.', task: { kind: 'rival', n: 3, title: 'Outrun the rival 3 times', how: 'In Rainy Industrial Zone, beat the rival courier\u2019s score pace.', unit: 'rivals' } },
    { id: 9, name: 'Victoria Island', cost: 100000000, tag: 'Glass towers and the fastest streets in Lagos.', task: { kind: 'parcels1', n: 3, title: 'Deliver 3 parcels in one run', how: 'In Savanna Sunset, drop three parcels in a single run without losing one.', unit: 'parcels' } },
    { id: 10, name: 'Shanghai Old Street', cost: 120000000, tag: 'Red lanterns, tiled pagodas and a river of scooters.', task: { kind: 'keys', n: 5, title: 'Find 5 hidden keys', how: 'Keys turn up now and then on the road in Victoria Island. Ride through them.', unit: 'keys' } },
    { id: 11, name: 'Frostbite Town', cost: 150000000, tag: 'Snow banks, pine trees and a road under fresh powder.', task: { kind: 'vault', n: 4, title: 'Crack 4 lockboxes', how: 'A lockbox hangs over a ramp in Shanghai Old Street. Hit the ramp and grab it in the air.', unit: 'lockboxes' } },
    { id: 12, name: 'Dubai Marina', cost: 185000000, tag: 'Sun-baked glass towers, palms and dunes on the horizon.', task: { kind: 'parcels', n: 8, title: 'Deliver 8 parcels', how: 'In Frostbite Town, pick up a parcel, then ride through the green drop ring. A crash loses it.', unit: 'parcels' } },
    { id: 13, name: 'Tokyo Night', cost: 220000000, tag: 'Wet back streets, vending machines and warm sodium lamps.', task: { kind: 'word', n: 5, word: 'TOKYO', title: 'Spell TOKYO', how: 'In Dubai Marina, gold-ringed letters T, O, K, Y, O appear in order. Progress is kept between runs.', unit: 'letters' } },
    { id: 14, name: 'London Rain', cost: 260000000, tag: 'Grey skies, red phone boxes and brick terraces.', task: { kind: 'set', n: 3, title: 'Collect the city pass set', how: 'In Tokyo Night, find an Oyster Card, a Tube Map and an Umbrella. One of each.', unit: 'of 3 items', items: ['Oyster Card', 'Tube Map', 'Umbrella'] } },
    { id: 15, name: 'Rio Favela', cost: 300000000, tag: 'Stacked hillside houses, palms and golden afternoon light.', task: { kind: 'combo', n: 30, title: 'Chain a 30 combo in one run', how: 'In London Rain, keep cash, near misses and letters rolling without a break.', unit: 'combo' } }
  ];
  const lcount = m => { let c = 0; for (let i = 0; i < 8; i++) if (m & (1 << i)) c++; return c; };
  const REFUND_OLD = { night: 1500, hiviz: 2500, ghost: 4000 };   // v2 outfits that no longer exist
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const fresh = () => ({
    v: 5, wallet: 0, loc: 0, locs: [0], lp: {}, up: { jam: 0, cash: 0, turbo: 0, bail: 0 }, owned: ['courier'], outfit: 'courier',
    stats: { runs: 0, time: 0, cash: 0, longest: 0, near: 0, jams: 0, bails: 0, best: 0, bestPred: 0, coins: 0, words: 0, missions: 0, dailies: 0, far: 0, bestPts: 0 },
    daily: { d: today(), best: 0, runs: 0, done: false }, set: { music: true, sfx: true, haptics: true }, tut: {}
  });
  const S = { UPGRADES, OUTFITS, CHARS: OUTFITS, TIERS, LOCS, data: fresh(), today, CASH_X, compact };
  function load() {
    let d = null, migrated = false;
    try { d = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
    const f = fresh();
    if (d && typeof d === 'object') {
      f.wallet = Math.max(0, +d.wallet || 0);
      Object.keys(f.up).forEach(k => { f.up[k] = Math.max(0, Math.min(UPGRADES[k].max, +(d.up && d.up[k]) || 0)); });
      if (Array.isArray(d.owned)) for (const id of d.owned) if (REFUND_OLD[id]) { f.wallet += REFUND_OLD[id]; migrated = true; }
      f.owned = Array.isArray(d.owned) ? d.owned.filter(id => OUTFITS[id]) : f.owned; if (f.owned.indexOf('courier') < 0) f.owned.unshift('courier');
      f.outfit = OUTFITS[d.outfit] && f.owned.indexOf(d.outfit) >= 0 ? d.outfit : 'courier';
      if (Array.isArray(d.locs)) f.locs = d.locs.filter(i => LOCS[i]); if (f.locs.indexOf(0) < 0) f.locs.unshift(0);
      f.loc = LOCS[d.loc] && f.locs.indexOf(d.loc) >= 0 ? d.loc : 0;
      if (d.lp && typeof d.lp === 'object') Object.keys(d.lp).forEach(k => { f.lp[k] = Math.max(0, +d.lp[k] || 0); });
      if (!d.v || d.v < 4) migrated = true;
      if (!d.v || d.v < 5) { f.wallet = Math.floor(f.wallet * CASH_X); ['cash', 'best', 'bestToday'].forEach(k => { if (d.stats && d.stats[k]) d.stats[k] = Math.floor(d.stats[k] * CASH_X); }); if (d.daily && d.daily.best) d.daily.best = Math.floor(d.daily.best * CASH_X); try { const b = +localStorage.getItem('sl_best') || 0; if (b) localStorage.setItem('sl_best', String(b * CASH_X)); } catch (e) {} migrated = true; }
      Object.assign(f.stats, d.stats || {}); Object.assign(f.set, d.set || {}); f.tut = d.tut || {};
      if (d.daily && d.daily.d === today()) f.daily = Object.assign(f.daily, d.daily);
      /* v1 -> v2: the old Cash magnet was removed; refund whatever was spent on it */
      if (d.up && d.up.magnet > 0) { const c = [600, 1400, 3000]; for (let i = 0; i < Math.min(3, d.up.magnet); i++) f.wallet += c[i]; migrated = true; }
      f.wallet = Math.floor(f.wallet);
    }
    S.data = f; if (migrated) S.save();
  }
  S.save = function () { try { localStorage.setItem(KEY, JSON.stringify(S.data)); } catch (e) {} };
  S.rollDay = function () { if (S.data.daily.d !== today()) S.data.daily = { d: today(), best: 0, runs: 0, done: false }; };
  S.cost = function (id) { const u = UPGRADES[id], lv = S.data.up[id]; return lv >= u.max ? null : u.cost[lv]; };
  S.buyUpgrade = function (id) {
    const c = S.cost(id); if (c === null || S.data.wallet < c) return false;
    S.data.wallet -= c; S.data.up[id]++; S.save(); return true;
  };
  S.buyOutfit = function (id) {
    const o = OUTFITS[id]; if (!o || S.data.owned.indexOf(id) >= 0 || S.data.wallet < o.cost) return false;
    S.data.wallet -= o.cost; S.data.owned.push(id); S.data.outfit = id; S.save(); return true;
  };
  /* ---- locations ---- */
  S.locOpen = i => S.data.locs.indexOf(i) >= 0;
  S.locProgress = function (i) {       // 0..n
    const L = LOCS[i]; if (!L || !L.task) return 0; const t = L.task, v = S.data.lp[i] || 0;
    if (t.kind === 'set') return lcount(v); if (t.kind === 'stars') return Math.min(t.n, Math.floor(v)); return Math.min(t.n, Math.floor(v));
  };
  S.taskDone = i => { const L = LOCS[i]; return !L || !L.task || S.locProgress(i) >= L.task.n; };
  /* amt for counters; for 'set' amt is the item index; for 'combo'/'parcels1' amt is the run's value (keeps the best) */
  S.taskAdd = function (i, amt) {
    const L = LOCS[i]; if (!L || !L.task || S.taskDone(i)) return false; const t = L.task, lp = S.data.lp, before = S.locProgress(i);
    if (t.kind === 'set') lp[i] = (lp[i] || 0) | (1 << amt);
    else if (t.kind === 'combo' || t.kind === 'parcels1') lp[i] = Math.max(lp[i] || 0, amt);
    else lp[i] = (lp[i] || 0) + amt;
    S.save(); return S.locProgress(i) !== before;
  };
  S.canUnlockLoc = i => { const L = LOCS[i]; return !!L && !S.locOpen(i) && S.taskDone(i) && S.data.wallet >= L.cost; };
  S.unlockLoc = function (i) { if (!S.canUnlockLoc(i)) return false; S.data.wallet -= LOCS[i].cost; S.data.locs.push(i); S.data.loc = i; S.save(); return true; };
  S.selectLoc = function (i) { if (!S.locOpen(i)) return false; S.data.loc = i; S.save(); return true; };
  /* the task a run in location `i` can advance: it belongs to the NEXT location, if that one is still locked */
  S.activeTask = function (i) { const n = LOCS[i + 1]; if (!n || S.locOpen(n.id) || S.taskDone(n.id)) return null; return n; };
  S.perk = function () { const o = OUTFITS[S.data.outfit]; return (o && o.perk) || {}; };
  S.equip = function (id) { if (S.data.owned.indexOf(id) >= 0) { S.data.outfit = id; S.save(); return true; } return false; };
  /* called once per finished (non-god) run */
  S.recordRun = function (r) {
    S.rollDay(); const d = S.data, st = d.stats;
    d.wallet += Math.max(0, r.score | 0); st.runs++; st.time += r.time || 0; st.cash += r.score | 0; st.longest = Math.max(st.longest, r.time || 0);
    st.near += r.near | 0; st.jams += r.jams | 0; st.bails += r.bails | 0; st.best = Math.max(st.best, r.score | 0); st.bestPred = Math.max(st.bestPred, r.pred | 0);
    st.coins += r.coins | 0; st.words += r.words | 0; st.missions += r.missions | 0; st.far = Math.max(st.far || 0, r.dist | 0); st.bestPts = Math.max(st.bestPts || 0, r.pts | 0);
    d.daily.runs++; d.daily.best = Math.max(d.daily.best, r.score | 0);
    S.save();
  };
  S.markDaily = function () { S.rollDay(); if (S.data.daily.done) return false; S.data.daily.done = true; S.data.stats.dailies++; S.save(); return true; };
  S.tutDone = function (k) { S.data.tut[k] = 1; S.save(); };
  load();
  global.Save = S;
})(window);
