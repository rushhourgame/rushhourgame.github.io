/* RUSH HOUR (was Signal Lost) — procedural WebAudio: eight ORIGINAL Afrobeats / Amapiano / Afropop tracks (no samples, no copyrighted songs),
   and clean SFX. Mobile-safe: the context is created + resumed inside the tap, an iOS silent-switch unlock plays, and it re-resumes on visibility/gesture.
   v9 (anti-crackle): every track loop (menu + 4 intensity layers) is PRE-RENDERED once into AudioBuffers with an OfflineAudioContext (in small slices, off the
   critical path) and then played back as looping AudioBufferSourceNodes: zero oscillators / per-note nodes / scheduling at play time, so a busy 3D frame can't starve it.
   Only the short SFX are live (soft envelopes, capped polyphony). Output chain: music peak-normalised + soft-knee to -4 dBFS, master -> compressor -> limiter. `latencyHint: 'playback'`.
   Fallback (no OfflineAudioContext): the old live scheduler, 100 ms lookahead pumped every 25 ms.
   Menu = calm loop. In-game = full groove; layers rise with the city's threat level (1..5). A different track every restart. */
(function (global) {
  'use strict';
  // exponential ramps throw on a target of 0 (e.g. when a volume multiplier is 0): clamp to a tiny positive value
  try { const AP = global.AudioParam && global.AudioParam.prototype; if (AP && !AP.__slSafe) { const f = AP.exponentialRampToValueAtTime; AP.exponentialRampToValueAtTime = function (v, t) { return f.call(this, (v > 1e-4 ? v : 1e-4), t); }; AP.__slSafe = true; } } catch (e) {}
  const A = {
    ctx: null, enabled: true, muted: false, musicEnabled: true, sfxEnabled: true, volume: 0.7,
    mode: 'menu', stars: 1, speedR: 0, playing: false, blind: false, timer: null
  };
  try { A.muted = localStorage.getItem('sl_muted') === '1'; } catch (e) {}
  let E = null; // active engine (live, or an offline one while rendering)
  const MUSV = 0.28;   // music bus level inside the OFFLINE render (the buffers are normalised afterwards)
  const SR = 32000;    // loop buffer sample rate (browser resamples to the device rate)
  const mf = n => 440 * Math.pow(2, (n - 69) / 12);
  const now = () => (E.t0 !== undefined ? E.t0 : E.c.currentTime);

  /* ------------------------------------------------------------ engine graph */
  function makeEngine(c, off) {
    const e = { c, off: !!off, musV: off ? MUSV : 1, act: 0, step: 0, nextT: 0, tier: 1, pendTier: 1, mode: A.mode, tempo: (A.track ? A.track.bpm : 100), t0: undefined };
    const G = (v, to) => { const g = c.createGain(); g.gain.value = v; if (to) g.connect(to); return g; };
    const F = (type, f, q, to) => { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q) b.Q.value = q; if (to) b.connect(to); return b; };
    e.master = G(off ? 1 : (A.muted ? 0 : A.volume));
    const comp = c.createDynamicsCompressor();
    if (off) { comp.threshold.value = -20; comp.knee.value = 12; comp.ratio.value = 3.5; comp.attack.value = 0.01; comp.release.value = 0.2; e.master.connect(comp); comp.connect(c.destination); }   // loop render: glue only, then normalised in JS
    else {
      // live chain: master (0.8 = headroom) -> gentle compressor -> soft limiter (-6 dB, 3 ms) -> out. Music buffers peak at ~-6 dBFS so SFX ride on top without clipping.
      comp.threshold.value = -8; comp.knee.value = 8; comp.ratio.value = 2.5; comp.attack.value = 0.008; comp.release.value = 0.2;
      const lim = c.createDynamicsCompressor(); lim.threshold.value = -5; lim.knee.value = 1; lim.ratio.value = 20; lim.attack.value = 0.003; lim.release.value = 0.1;
      const fin = G(0.8);                     // final trim after the limiter: guarantees true peak < -3 dBFS even when SFX pile up
      e.master.connect(comp); comp.connect(lim); lim.connect(fin); fin.connect(c.destination);
      if (c.createAnalyser) { e.an = c.createAnalyser(); e.an.fftSize = 2048; fin.connect(e.an); }   // output-level tap (A.level)
    }
    e.sfxBus = G(A.sfxEnabled ? 0.8 : 0, e.master);
    // music chain: musBus -> (dry | radio-filter) -> lowpass -> musOut -> master
    e.musOut = G(A.musicEnabled ? 1 : 0, e.master);
    e.musLP = F('lowpass', 16000, 0.5, e.musOut);
    e.dry = G(1, e.musLP);
    e.radio = F('bandpass', 1400, 0.7); e.wet = G(0, e.musLP); e.radio.connect(e.wet);
    e.duckG = G(1); e.duckG.connect(e.dry); e.duckG.connect(e.radio);
    e.musBus = G(e.musV, e.duckG);
    e.drumBus = G(1, e.musBus); e.padBus = G(1, e.musBus); e.leadBus = G(1, e.musBus);
    // 808 bus: soft saturation adds harmonics so the sub is audible on phone speakers
    // (offline render only: a mild tanh warms the sub; the live fallback path has NO waveshaper)
    if (off) {
      const ws = c.createWaveShaper(), cur = new Float32Array(1025);
      for (let i = 0; i < 1025; i++) { const x = i / 512 - 1; cur[i] = Math.tanh(1.7 * x) / Math.tanh(1.7); }
      ws.curve = cur; ws.oversample = '2x';
      e.bassBus = G(0.36, ws); ws.connect(F('lowpass', 2400, 0.7, e.musBus));
    } else e.bassBus = G(0.36, F('lowpass', 2400, 0.7, e.musBus));
    // dotted-8th echo for pads / pluck / bells
    e.dly = c.createDelay(1.0); e.dly.delayTime.value = 0.33;
    const dlp = F('lowpass', 2300, 0.5), dfb = G(0.38, e.dly);
    e.send = G(1, e.dly); e.dly.connect(dlp); dlp.connect(dfb); dlp.connect(G(0.3, e.musBus));
    const len = Math.min(c.sampleRate, 32000); e.noise = c.createBuffer(1, len, c.sampleRate);
    const d = e.noise.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    e.noise.__loopS = len / c.sampleRate;
    return e;
  }

  /* ------------------------------------------------------------ primitives */
  function tone(freq, dur, type, vol, o) {
    o = o || {}; if (!E.off && E.act > 36 && !o.hi) return;            // polyphony cap: never let a burst of SFX pile up nodes
    const c = E.c, t = (o.t !== undefined ? o.t : now()) + (o.delay || 0);
    const osc = c.createOscillator(), g = c.createGain();
    if (!E.off) { const en = E; en.act++; osc.onended = () => { en.act--; }; }
    osc.type = type || 'sine'; osc.frequency.setValueAtTime(freq, t);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(o.slide, t + dur);
    if (o.detune) osc.detune.value = o.detune;
    const atk = Math.max(0.007, o.atk || 0.007);                  // >= 7 ms attack: no click
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    let out = g;
    if (o.pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = o.pan; g.connect(p); out = p; }
    out.connect(o.bus || E.sfxBus);
    if (o.send) { const s = c.createGain(); s.gain.value = o.send; out.connect(s); s.connect(E.send); }
    osc.start(t); osc.stop(t + dur + 0.03);
  }
  function noise(dur, vol, o) {
    o = o || {}; if (!E.off && E.act > 36 && !o.hi) return;
    const c = E.c, t = (o.t !== undefined ? o.t : now()) + (o.delay || 0);
    const s = c.createBufferSource(); s.buffer = E.noise; s.loop = true;
    if (!E.off) { const en = E; en.act++; s.onended = () => { en.act--; }; }
    const f = c.createBiquadFilter(); f.type = o.type || 'bandpass';
    f.frequency.setValueAtTime(o.f || 2000, t);
    if (o.fTo) f.frequency.exponentialRampToValueAtTime(o.fTo, t + dur);
    f.Q.value = o.q || 0.8;
    const g = c.createGain(), atk = Math.max(0.007, o.atk || 0.007);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g);
    let out = g;
    if (o.pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = o.pan; g.connect(p); out = p; }
    out.connect(o.bus || E.sfxBus);
    if (o.send) { const q = c.createGain(); q.gain.value = o.send; out.connect(q); q.connect(E.send); }
    s.start(t, Math.random() * 0.4 * (E.noise.__loopS || 1)); s.stop(t + dur + 0.03);
  }

  /* ------------------------------------------------------------ instruments */
  function kick(t, v) {
    const c = E.c, o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(165, t); o.frequency.exponentialRampToValueAtTime(46, t + 0.1);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.95 * v, t + 0.007); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    o.connect(g); g.connect(E.drumBus); o.start(t); o.stop(t + 0.36);
    noise(0.012, 0.16 * v, { t, f: 2600, type: 'highpass', bus: E.drumBus });
    // fake sidechain: pads/leads dip on every kick
    const pg = E.padBus.gain; pg.setTargetAtTime(0.55, t, 0.008); pg.setTargetAtTime(1, t + 0.05, 0.07);   // smooth (no hard gain step)
  }
  function clap(t, v) {
    for (let i = 0; i < 3; i++) noise(0.025, 0.34 * v, { t: t + i * 0.011, f: 1500, q: 1.3, bus: E.drumBus });
    noise(0.2, 0.3 * v, { t: t + 0.033, f: 1700, q: 0.9, bus: E.drumBus, send: 0.22 });
    tone(210, 0.09, 'triangle', 0.2 * v, { t, slide: 150, bus: E.drumBus });
  }
  function hat(t, v, open) { noise(open ? 0.16 : 0.03, 0.17 * v, { t, f: 8200, type: 'highpass', q: 0.7, bus: E.drumBus }); }
  function bass(t, midi, dur, v) {
    const c = E.c, o = c.createOscillator(), g = c.createGain(), f = mf(midi);
    o.type = 'sine'; o.frequency.setValueAtTime(f * 1.6, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.045);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.62 * v, t + 0.008);
    g.gain.setValueAtTime(0.62 * v, t + Math.max(0.01, dur - 0.09)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.04);
    o.connect(g); g.connect(E.bassBus); o.start(t); o.stop(t + dur + 0.06);
    tone(f * 2, Math.min(dur, 0.3), 'triangle', 0.3 * v, { t, bus: E.bassBus, atk: 0.006 });          // 2nd harmonic: small speakers can hear it
    tone(f * 3, 0.12, 'sine', 0.12 * v, { t, bus: E.bassBus });
  }
  function pad(t, notes, dur, cutoff, v) {
    const c = E.c, lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.6;
    lp.frequency.setValueAtTime(380, t); lp.frequency.exponentialRampToValueAtTime(cutoff, t + dur * 0.6);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.18); g.gain.setValueAtTime(v, t + dur - 0.25); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.25);
    lp.connect(g); g.connect(E.padBus);
    const s = c.createGain(); s.gain.value = 0.5; g.connect(s); s.connect(E.send);
    for (const n of notes) for (const dt of [-8, 8]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mf(n); o.detune.value = dt;
      o.connect(lp); o.start(t); o.stop(t + dur + 0.3);
    }
  }
  function pluck(t, midi, v) { tone(mf(midi), 0.2, 'triangle', 0.2 * v, { t, bus: E.leadBus, send: 0.35, atk: 0.003 }); tone(mf(midi + 12), 0.08, 'sine', 0.06 * v, { t, bus: E.leadBus }); }
  function bell(t, midi, dur, v) {
    tone(mf(midi), dur, 'sine', 0.2 * v, { t, bus: E.leadBus, send: 0.55, atk: 0.006 });
    tone(mf(midi) * 2.0, dur * 0.5, 'sine', 0.07 * v, { t, bus: E.leadBus, send: 0.4 });
    tone(mf(midi) * 3.01, 0.12, 'sine', 0.03 * v, { t, bus: E.leadBus });
  }
  function stab(t, notes, v) {
    const c = E.c, lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(3200, t); lp.frequency.exponentialRampToValueAtTime(700, t + 0.2);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.13 * v, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    lp.connect(g); g.connect(E.leadBus); const s = c.createGain(); s.gain.value = 0.3; g.connect(s); s.connect(E.send);
    for (const n of notes) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mf(n + 12); o.detune.value = n % 2 ? 6 : -6; o.connect(lp); o.start(t); o.stop(t + 0.27); }
  }

  /* ------------------------------------------------------------ more instruments (afrobeats / amapiano / afropop) */
  function logdrum(t, midi, dur, v) {            // the amapiano "log drum": a pitched, woody sine with a fast pitch dive
    const c = E.c, f = mf(midi), o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(f * 1.9, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9 * v, t + 0.007); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(E.bassBus); o.start(t); o.stop(t + dur + 0.04);
    tone(f * 2.01, 0.1, 'triangle', 0.16 * v, { t, bus: E.bassBus });
    noise(0.012, 0.1 * v, { t, f: 1800, q: 1.5, bus: E.drumBus });
  }
  function shaker(t, v) { noise(0.045, 0.13 * v, { t, f: 7200, type: 'highpass', q: 0.6, atk: 0.006, bus: E.drumBus, pan: 0.25 }); }
  function rim(t, v) { tone(1750, 0.03, 'triangle', 0.11 * v, { t, bus: E.drumBus }); noise(0.02, 0.1 * v, { t, f: 2800, q: 2, bus: E.drumBus }); }
  function conga(t, hi, v) { const f = hi ? 330 : 240; tone(f, 0.14, 'sine', 0.2 * v, { t, slide: f * 0.78, bus: E.drumBus, pan: hi ? -0.25 : 0.25 }); noise(0.015, 0.07 * v, { t, f: 3000, q: 1.2, bus: E.drumBus }); }
  function snare(t, v) { noise(0.12, 0.3 * v, { t, f: 2100, q: 0.7, bus: E.drumBus, send: 0.15 }); tone(200, 0.08, 'triangle', 0.2 * v, { t, slide: 150, bus: E.drumBus }); }
  function guitar(t, midi, v) {                  // highlife-style palm-muted plucked guitar
    const c = E.c, lp = c.createBiquadFilter(), g = c.createGain(); lp.type = 'lowpass'; lp.Q.value = 1.2;
    lp.frequency.setValueAtTime(3400, t); lp.frequency.exponentialRampToValueAtTime(600, t + 0.18);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2 * v, t + 0.007); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    lp.connect(g); g.connect(E.leadBus); const s = c.createGain(); s.gain.value = 0.3; g.connect(s); s.connect(E.send);
    for (const d of [-5, 5]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mf(midi); o.detune.value = d; o.connect(lp); o.start(t); o.stop(t + 0.26); }
  }
  function marimba(t, midi, dur, v) {
    tone(mf(midi), Math.min(0.5, dur), 'sine', 0.3 * v, { t, bus: E.leadBus, send: 0.35, atk: 0.003 });
    tone(mf(midi) * 4, 0.07, 'sine', 0.09 * v, { t, bus: E.leadBus }); tone(mf(midi) * 10, 0.025, 'sine', 0.025 * v, { t, bus: E.leadBus });
  }
  function whistle(t, midi, dur, v) {
    const c = E.c, o = c.createOscillator(), lfo = c.createOscillator(), lg = c.createGain(), g = c.createGain();
    o.type = 'sine'; o.frequency.value = mf(midi); lfo.frequency.value = 5.6; lg.gain.value = mf(midi) * 0.012; lfo.connect(lg); lg.connect(o.frequency);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.07 * v, t + 0.05); g.gain.setValueAtTime(0.07 * v, t + dur * 0.7); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(E.leadBus); const s = c.createGain(); s.gain.value = 0.5; g.connect(s); s.connect(E.send);
    o.start(t); lfo.start(t); o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
  }
  function keys(t, notes, dur, v) {              // soft electric-piano stab: sine + tine, decays naturally
    notes.forEach((n, i) => { const f = mf(n); tone(f, dur, 'sine', 0.13 * v, { t: t + i * 0.006, bus: E.padBus, send: 0.3, atk: 0.006 }); tone(f * 2, dur * 0.5, 'triangle', 0.05 * v, { t, bus: E.padBus }); });
  }

  function lead(t, midi, dur, v) {                // soft synth lead: detuned saw + triangle, vibrato, echo (the hook)
    const c = E.c, f = mf(midi), lp = c.createBiquadFilter(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
    lp.type = 'lowpass'; lp.Q.value = 1; lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(3200, t + 0.08); lp.frequency.exponentialRampToValueAtTime(1500, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.15 * v, t + 0.02); g.gain.setValueAtTime(0.12 * v, t + Math.max(0.03, dur * 0.7)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
    lfo.frequency.value = 5.2; lg.gain.value = f * 0.007; lfo.connect(lg);
    lp.connect(g); g.connect(E.leadBus); const s = c.createGain(); s.gain.value = 0.45; g.connect(s); s.connect(E.send);
    for (const [ty, d] of [['sawtooth', -7], ['sawtooth', 7], ['triangle', 0]]) { const o = c.createOscillator(); o.type = ty; o.frequency.value = f; o.detune.value = d; lg.connect(o.frequency); o.connect(lp); o.start(t); o.stop(t + dur + 0.08); }
    lfo.start(t); lfo.stop(t + dur + 0.08);
  }

  /* ------------------------------------------------------------ the tracks: all original, generated live, no samples */
  const CH = { m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], dom: [0, 4, 7, 10], add9: [0, 4, 7, 14] };
  const MIN = [0, 3, 5, 7, 10], MAJ = [0, 2, 4, 7, 9];
  const pent = (root, scale, d) => root + Math.floor(d / 5) * 12 + scale[((d % 5) + 5) % 5];
  // style patterns (16th-note steps). kick/clap lists are per intensity tier 1..5.
  const STYLES = {
    afrobeats: {
      swing: 0.07, kick: [[], [0, 10], [0, 7, 10], [0, 7, 10], [0, 7, 10, 13], [0, 3, 7, 10, 13]], clap: [4, 12], rim: [0, 3, 6, 10, 12], conga: [3, 6, 9, 11, 14],
      bass: [[[0, 0, 12]], [[0, 0, 6], [10, 0, 4]], [[0, 0, 3], [3, 0, 2], [6, 7, 2], [10, 0, 3], [13, 12, 2]], [[0, 0, 3], [3, 0, 2], [6, 7, 2], [10, 0, 3], [13, 12, 2]],
             [[0, 0, 2], [3, 0, 2], [6, 7, 2], [8, 0, 1], [10, 0, 2], [13, 12, 1], [14, 7, 1]], [[0, 0, 2], [3, 0, 2], [6, 7, 2], [8, 0, 1], [10, 0, 2], [13, 12, 1], [14, 7, 1]]],
      guitar: [0, 3, 6, 10, 12, 14]
    },
    amapiano: {
      swing: 0.12, kick: [[], [0, 8], [0, 4, 8, 12], [0, 4, 8, 12], [0, 4, 8, 12], [0, 4, 8, 12]], clap: [4, 12], rim: [], conga: [],
      log: [[[0, 0, 12]], [[0, 0, 4], [6, 7, 3]], [[0, 0, 3], [3, 7, 1], [6, 0, 2], [10, 0, 2], [14, 7, 2]], [[0, 0, 3], [3, 7, 1], [6, 0, 2], [10, 0, 2], [13, 12, 1], [14, 7, 2]],
            [[0, 0, 3], [3, 7, 1], [6, 0, 2], [8, 12, 1], [10, 0, 2], [13, 12, 1], [14, 7, 2]], [[0, 0, 3], [3, 7, 1], [6, 0, 2], [8, 12, 1], [10, 0, 2], [13, 12, 1], [14, 7, 2]]],
      keys: [0, 3, 6, 10, 14]
    },
    afropop: {
      swing: 0.04, kick: [[], [0, 8], [0, 8, 10], [0, 8, 10], [0, 3, 8, 10, 13], [0, 3, 8, 10, 13]], clap: [4, 12], rim: [], conga: [],
      bass: [[[0, 0, 12]], [[0, 0, 6], [8, 0, 4]], [[0, 0, 4], [4, 0, 2], [6, 7, 2], [8, 0, 4], [12, 12, 2], [14, 7, 2]], [[0, 0, 4], [4, 0, 2], [6, 7, 2], [8, 0, 4], [12, 12, 2], [14, 7, 2]],
             [[0, 0, 3], [4, 0, 2], [6, 7, 2], [8, 0, 3], [12, 12, 2], [14, 7, 2]], [[0, 0, 3], [4, 0, 2], [6, 7, 2], [8, 0, 3], [12, 12, 2], [14, 7, 2]]],
      guitar: [0, 2, 4, 6, 8, 10, 12, 14]
    }
  };
  // chords: [root midi (octave 3/4), quality]; mel: per bar [step, pentatonic degree, length in steps]
  const TRACKS = [
    { name: 'Eko Nights', style: 'afrobeats', bpm: 100, scale: MIN, mroot: 69, prog: [[57, 'm7'], [53, 'maj7'], [60, 'maj7'], [55, 'dom']],
      mel: [[[0, 4, 3], [4, 3, 2], [6, 2, 4], [12, 3, 3]], [[0, 2, 3], [4, 3, 3], [8, 4, 4], [14, 3, 2]], [[0, 4, 2], [3, 5, 3], [8, 4, 3], [12, 2, 4]], [[0, 3, 3], [4, 2, 2], [8, 0, 4], [12, 2, 3]]] },
    { name: 'Jollof Sunrise', style: 'afropop', bpm: 108, scale: MAJ, mroot: 72, prog: [[60, 'maj7'], [57, 'm7'], [53, 'maj7'], [55, 'dom']],
      mel: [[[0, 4, 4], [4, 3, 2], [6, 2, 4], [12, 4, 4]], [[0, 3, 3], [4, 2, 3], [8, 0, 4], [14, 2, 2]], [[0, 2, 4], [4, 3, 2], [8, 4, 6]], [[0, 5, 3], [4, 4, 2], [8, 3, 4], [12, 2, 4]]] },
    { name: 'Danfo Dreams', style: 'amapiano', bpm: 112, scale: MIN, mroot: 74, prog: [[62, 'm7'], [58, 'maj7'], [65, 'maj7'], [60, 'dom']],
      mel: [[[0, 3, 2], [3, 4, 3], [8, 3, 2], [12, 2, 4]], [[0, 4, 3], [4, 3, 2], [8, 2, 4], [14, 3, 2]], [[0, 5, 4], [6, 4, 2], [8, 3, 3], [12, 4, 4]], [[0, 3, 2], [4, 2, 2], [8, 0, 4], [12, 1, 4]]] },
    { name: 'Marina Lights', style: 'amapiano', bpm: 110, scale: MIN, mroot: 67, prog: [[55, 'm7'], [63, 'maj7'], [58, 'maj7'], [53, 'dom']],
      mel: [[[2, 4, 3], [6, 3, 2], [10, 2, 3], [14, 3, 2]], [[0, 4, 4], [6, 5, 2], [8, 4, 4], [14, 3, 2]], [[0, 3, 3], [4, 4, 3], [8, 5, 4], [14, 4, 2]], [[0, 3, 4], [6, 2, 2], [8, 1, 4], [12, 2, 4]]] },
    { name: 'Ajebo Anthem', style: 'afropop', bpm: 106, scale: MAJ, mroot: 67, prog: [[55, 'add9'], [64, 'm7'], [60, 'maj7'], [62, 'dom']],
      mel: [[[0, 5, 3], [4, 4, 3], [8, 3, 4], [12, 4, 4]], [[0, 3, 4], [4, 4, 2], [8, 3, 3], [12, 1, 4]], [[0, 2, 3], [4, 3, 3], [8, 4, 4], [12, 5, 3]], [[0, 4, 4], [6, 3, 2], [8, 2, 4], [12, 1, 4]]] },
    { name: 'Agbero Groove', style: 'afrobeats', bpm: 98, scale: MIN, mroot: 64, prog: [[64, 'm7'], [60, 'maj7'], [55, 'add9'], [62, 'dom']],
      mel: [[[0, 2, 3], [4, 3, 2], [8, 4, 3], [12, 3, 4]], [[0, 4, 4], [6, 3, 2], [8, 2, 4], [14, 1, 2]], [[0, 3, 3], [3, 4, 3], [8, 5, 4], [12, 4, 2]], [[0, 2, 4], [6, 1, 2], [8, 0, 4], [12, 1, 3]]] },
    { name: 'Lekki Heat', style: 'amapiano', bpm: 114, scale: MIN, mroot: 72, prog: [[60, 'm7'], [56, 'maj7'], [63, 'maj7'], [58, 'dom']],
      mel: [[[0, 4, 2], [3, 3, 3], [8, 4, 2], [12, 5, 4]], [[0, 3, 3], [4, 2, 3], [8, 3, 4], [14, 4, 2]], [[0, 5, 2], [3, 4, 3], [8, 3, 4], [12, 2, 4]], [[0, 4, 3], [4, 3, 2], [8, 2, 4], [14, 0, 2]]] },
    { name: 'Naija Pride', style: 'afropop', bpm: 110, scale: MAJ, mroot: 74, prog: [[62, 'add9'], [59, 'm7'], [55, 'maj7'], [57, 'dom']],
      mel: [[[0, 4, 3], [4, 5, 3], [8, 4, 4], [12, 3, 4]], [[0, 3, 4], [6, 4, 2], [8, 3, 4], [12, 2, 4]], [[0, 2, 3], [4, 3, 3], [8, 4, 4], [12, 3, 4]], [[0, 4, 4], [6, 3, 2], [8, 2, 4], [12, 0, 4]]] }
  ];
  A.TRACKS = TRACKS.map(t => ({ name: t.name, style: t.style, bpm: t.bpm }));
  let trackIdx = 0, lastTrack = -1;
  try { lastTrack = +localStorage.getItem('sl_lasttrack'); if (!(lastTrack >= 0)) lastTrack = -1; } catch (e) {}
  const pickIdx = avoid => { let i; do { i = Math.floor(Math.random() * TRACKS.length); } while (TRACKS.length > 1 && i === avoid); return i; };
  trackIdx = pickIdx(lastTrack);
  A.track = TRACKS[trackIdx]; A.trackName = A.track.name; A.trackIdx = trackIdx;
  A.setTrack = function (i) {
    trackIdx = ((i % TRACKS.length) + TRACKS.length) % TRACKS.length; A.track = TRACKS[trackIdx]; A.trackName = A.track.name; A.trackIdx = trackIdx;
    try { localStorage.setItem('sl_lasttrack', String(trackIdx)); } catch (e) {}
    if (E) { E.step = 0; E.tier = E.pendTier = 1; E.tempo = A.track.bpm; if (A.playing) E.nextT = Math.max(E.nextT, E.c.currentTime + 0.05); }
    if (upcoming === trackIdx) upcoming = pickIdx(trackIdx);
    kick0(); if (E && A.playing) sync();
    return A.trackName;
  };
  let upcoming = pickIdx(trackIdx);
  A.nextTrack = function () { const i = upcoming; const nm = A.setTrack(i); upcoming = pickIdx(i); kick0(); return nm; };       // a different song every restart (the next one is already pre-rendered)

  function scheduleStep(e) {
    const T = e.T || A.track, ST = STYLES[T.style], t0 = e.nextT, s = e.step, st = s & 15, bar = (s >> 4) & 3;
    if (st === 0) e.tier = e.pendTier;
    const menu = e.mode === 'menu', tier = menu ? 0 : Math.max(2, e.tier), last = bar === 3, ti = Math.max(1, tier);
    const base = e.fixedBpm || (menu ? T.bpm * 0.9 : T.bpm + A.speedR * 5 + (tier >= 5 ? 3 : 0));
    e.tempo += (base - e.tempo) * 0.25;
    const sp = 60 / e.tempo / 4, t = t0 + (st & 1 ? ST.swing * sp : 0);
    e.dly.delayTime.value = sp * 3;
    const ch = T.prog[bar], notes = CH[ch[1]].map(n => ch[0] + n), root = ch[0] - 24;
    // chords: warm pad that opens up with intensity
    if (st === 0) pad(t0, notes, sp * 16, menu ? 1100 : [1100, 1100, 1400, 1700, 2000, 2400][tier], menu ? 0.1 : 0.085);
    // drums
    const kp = ST.kick[ti]; if (!menu && kp.indexOf(st) >= 0) kick(t0, 0.82); else if (menu && st === 0) kick(t0, 0.5);
    if (last && tier >= 3 && st === 15) kick(t0, 0.6);
    if (tier >= 2 && ST.clap.indexOf(st) >= 0) (T.style === 'afrobeats' ? snare : clap)(t0, 0.72);
    if (tier >= 4 && last && st >= 12 && st % 2 === 0) snare(t0, 0.25 + (st - 12) * 0.08);
    // shakers & hats
    if (menu) { if (st % 4 === 2) shaker(t, 0.5); }
    else if (T.style === 'amapiano') { shaker(t, tier >= 2 ? (st % 4 === 2 ? 0.9 : 0.55) : st % 4 === 2 ? 0.6 : 0); if (tier >= 2 && st % 4 === 2) hat(t, 0.4, st === 6 || st === 14); }
    else { if (tier >= 3 || st % 2 === 0) shaker(t, (st % 4 === 2 ? 0.85 : 0.5)); if (tier >= 2 && st % 4 === 2) hat(t, 0.35, st === 14); }
    if (T.style === 'afrobeats' && tier >= 3) { if (ST.rim.indexOf(st) >= 0) rim(t0, 0.6); const ci = ST.conga.indexOf(st); if (ci >= 0) conga(t, ci % 2 === 0, 0.7); }
    // bass / log drum
    if (T.style === 'amapiano') {
      const lp = ST.log[menu ? 0 : tier];
      for (let i = 0; i < lp.length; i++) if (lp[i][0] === st) logdrum(t, root + 12 + lp[i][1], lp[i][2] * sp * 1.3, menu ? 0.6 : 1.35);
      if (tier >= 2 && st === 0) bass(t0, root, sp * 5, 0.8);
    } else {
      const bp = ST.bass[menu ? 0 : tier];
      for (let i = 0; i < bp.length; i++) if (bp[i][0] === st) bass(t, root + bp[i][1], bp[i][2] * sp, menu ? 0.5 : 1);
    }
    // rhythm instrument: keys stabs (amapiano) / guitar (afrobeats, afropop)
    if (T.style === 'amapiano') { if (tier >= 2 && ST.keys.indexOf(st) >= 0 && !(tier < 4 && st === 14)) keys(t, notes.slice(0, 4), sp * 3.2, 1.2); }
    else if (T.style === 'afrobeats' || T.style === 'afropop') {
      if (tier >= 2 && [3, 6, 10, 14].indexOf(st) >= 0 && !(tier < 4 && st === 14)) keys(t, notes.slice(0, 4), sp * 2.4, 1.0);   // offbeat chord skank
    }
    if ((T.style === 'afrobeats' && tier >= 2) || (T.style === 'afropop' && tier >= 2)) {
      const gi = ST.guitar.indexOf(st); if (gi >= 0) guitar(t, notes[[0, 2, 1, 3, 2, 1, 3, 2][gi % 8] % 4] + 12 + (gi % 3 === 2 ? 12 : 0), 0.8);
    }
    // melody (marimba, with a whistle on top for the amapiano tracks at full intensity)
    if (menu || tier >= 2) {
      const L = T.mel[bar];
      for (let i = 0; i < L.length; i++) if (L[i][0] === st && (!menu || i % 2 === 0)) {
        const m = pent(T.mroot, T.scale, L[i][1]);
        marimba(t, m, L[i][2] * sp, menu ? 0.7 : 0.95);
        if (!menu && tier >= 3) lead(t, m, Math.max(0.12, L[i][2] * sp * 0.95), 0.8 + (tier >= 4 ? 0.2 : 0));
        if (tier >= 5 && T.style === 'amapiano' && (bar & 1)) whistle(t, m + 12, L[i][2] * sp * 1.2, 0.8);
      }
    }
    e.step++; e.nextT += sp;
  }
  function pump() {
    if (!E || !A.playing || (A.bufOK && !A.bufFail)) return;
    const c = E.c, lim = c.currentTime + 0.1;                       // 100 ms lookahead (fallback scheduler only)
    if (E.nextT < c.currentTime) E.nextT = c.currentTime + 0.03; // we fell behind (tab throttled) — resync
    while (E.nextT < lim) scheduleStep(E);
  }

  /* ------------------------------------------------------------ pre-rendered loops (zero per-note work at play time) */
  const OAC = global.OfflineAudioContext || global.webkitOfflineAudioContext;
  A.bufOK = !!OAC; A.bufFail = false;
  const bufs = {}, key = (i, l) => i + ':' + l, tick = (ms) => new Promise(r => setTimeout(r, ms || 0));
  A.liveSrc = 0;                                  // looping music sources currently alive (test hook: must never stack across restarts)
  A.renderStats = { n: 0, buildMs: 0, renderMs: 0, maxSliceMs: 0, jobs: [] };
  /* render one loop of a track: 'menu' or tier layer 2..5. 64 steps = 4 bars; the reverb / echo tail is folded back onto the start so the loop is seamless. */
  async function renderLoop(idx, layer) {
    const T = TRACKS[idx], menu = layer === 'menu', bpm = menu ? T.bpm * 0.9 : T.bpm + 2, sp = 60 / bpm / 4, loopN = Math.round(64 * sp * SR), tail = 1.8;
    const oc = new OAC(2, loopN + Math.ceil(tail * SR), SR), eng = makeEngine(oc, true), st = A.renderStats; let t0 = performance.now(), tb = 0;
    eng.T = T; eng.fixedBpm = bpm; eng.tempo = bpm; eng.mode = menu ? 'menu' : 'play'; eng.tier = eng.pendTier = menu ? 0 : layer; eng.nextT = 0;
    while (eng.step < 64) {                     // build in small slices so the main thread never stalls (a slice is ~1-4 ms)
      const live = E, a = performance.now(); E = eng;
      try { scheduleStep(eng); } finally { E = live; }
      const d = performance.now() - a; tb += d; if (d > st.maxSliceMs) st.maxSliceMs = d;
      await tick(A.mode === 'play' ? 8 : 0);
    }
    const t1 = performance.now(), raw = await oc.startRendering(), t2 = performance.now();
    const out = oc.createBuffer(2, loopN, SR), n = raw.length, ch = [raw.getChannelData(0), raw.getChannelData(1)], hist = new Uint32Array(2048), SL = 16384, gap = A.mode === 'play' ? 6 : 0; let pk = 0;
    for (let c = 0; c < 2; c++) {               // fold the tail onto the start, then measure (in 16k-sample slices: never a long main-thread task)
      const o = out.getChannelData(c), x = ch[c];
      for (let a0 = 0; a0 < loopN; a0 += SL) {
        for (let i = a0, e1 = Math.min(loopN, a0 + SL); i < e1; i++) { const j = i + loopN, v = x[i] + (j < n ? x[j] : 0); o[i] = v; const a = v < 0 ? -v : v; if (a > pk) pk = a; }
        await tick(gap);
      }
    }
    for (let c = 0; c < 2; c++) { const o = out.getChannelData(c); for (let a0 = 0; a0 < loopN; a0 += SL) { for (let i = a0, e1 = Math.min(loopN, a0 + SL); i < e1; i++) hist[Math.min(2047, (Math.abs(o[i]) / (pk + 1e-9) * 2047) | 0)]++; await tick(gap); } }
    let acc = 0, p = 0; const lim = 0.998 * 2 * loopN; for (; p < 2048; p++) { acc += hist[p]; if (acc >= lim) break; }
    const ref = Math.max(1e-4, (p + 1) / 2048 * pk), g = 0.5 / ref, K = 0.5, W = 0.12;      // 99.8th percentile -> 0.5, then a soft knee tops out at ~0.62 (-4.1 dBFS)
    let peak = 0, clipN = 0, sq = 0;
    for (let c = 0; c < 2; c++) {
      const o = out.getChannelData(c);
      for (let a0 = 0; a0 < loopN; a0 += SL) {
        for (let i = a0, e1 = Math.min(loopN, a0 + SL); i < e1; i++) {
          let y = o[i] * g, a = Math.abs(y); if (a > K) { a = K + W * Math.tanh((a - K) / W); y = y < 0 ? -a : a; }
          o[i] = y; a = Math.abs(y); if (a > peak) peak = a; if (a >= 0.999) clipN++; sq += y * y;
        }
        await tick(gap);
      }
    }
    out.__stats = { peak, clip: clipN, rms: Math.sqrt(sq / (2 * loopN)), dur: loopN / SR, buildMs: tb, renderMs: t2 - t1 };
    st.n++; st.buildMs += tb; st.renderMs += t2 - t1; st.jobs.push([idx, layer, Math.round(tb), Math.round(t2 - t1)]);
    return out;
  }
  A.renderLoop = renderLoop;
  const wantJobs = () => {
    const cur = trackIdx, up = upcoming, L = [];
    if (A.mode === 'menu') { L.push([up, 'menu']); L.push([up, 2]); L.push([cur, 'menu']); for (const l of [3, 4, 5]) L.push([up, l]); for (const l of [2, 3, 4, 5]) L.push([cur, l]); }
    else { for (const l of [2, 3, 4, 5]) L.push([cur, l]); for (const l of [2, 3, 4, 5]) L.push([up, l]); L.push([cur, 'menu']); L.push([up, 'menu']); }
    return L.filter(j => !bufs[key(j[0], j[1])]);
  };
  let pumping = false;
  async function prefetch() {
    if (pumping || !A.bufOK || A.bufFail) return; pumping = true;
    try {
      for (let guard = 0; guard < 40; guard++) {
        const j = wantJobs()[0]; if (!j) break;
        const b = await renderLoop(j[0], j[1]);
        bufs[key(j[0], j[1])] = b;
        for (const k in bufs) { const i = +k.split(':')[0]; if (i !== trackIdx && i !== upcoming) delete bufs[k]; }
        sync();
        await tick(30);
      }
    } catch (err) { A.bufFail = true; A.bufErr = String(err && err.message || err); try { console.warn('audio pre-render failed, using live scheduler', err); } catch (e) {} if (E && A.playing) E.nextT = E.c.currentTime + 0.06; }
    finally { pumping = false; }
  }
  function kick0() { if (A.bufOK && !A.bufFail && !pumping) setTimeout(prefetch, 0); }
  A.ready = () => ({ cur: [2, 3, 4, 5, 'menu'].filter(l => bufs[key(trackIdx, l)]), up: [2, 3, 4, 5, 'menu'].filter(l => bufs[key(upcoming, l)]), track: trackIdx, upcoming, fail: A.bufFail });
  A._bufs = bufs;
  /* playback: one looping source per layer (all started on the same sample clock, so tiers stay phase-locked); the intensity tier just crossfades their gains on the next bar line */
  function addLayer(pb, l) {
    if (pb.L[l]) return; const b = bufs[key(pb.idx, l)]; if (!b) return;
    const c = E.c, g = c.createGain(), src = c.createBufferSource(); g.gain.value = 0; src.buffer = b; src.loop = true; src.connect(g); g.connect(pb.out);
    const t = Math.max(c.currentTime + 0.02, pb.startAt), off = ((t - pb.startAt) % b.duration + b.duration) % b.duration;
    src.onended = () => { A.liveSrc--; }; A.liveSrc++;
    src.start(t, off); pb.L[l] = { g, src }; pb.loopDur = b.duration;
  }
  function pickLayer(pb, tier) {
    tier = Math.max(2, Math.min(5, tier | 0));
    for (let l = tier; l >= 2; l--) if (pb.L[l]) return l;
    for (let l = tier + 1; l <= 5; l++) if (pb.L[l]) return l;
    return null;
  }
  function applyTier(pb, tier, now0) {
    if (pb.kind === 'menu') return; const sel = pickLayer(pb, tier); if (sel === null || sel === pb.sel) return;
    const c = E.c, t = c.currentTime; let at = t;
    if (!now0 && pb.sel != null && pb.loopDur) { const bd = pb.loopDur / 4, el = Math.max(0, t - pb.startAt); at = Math.max(t, pb.startAt + Math.ceil(el / bd + 1e-6) * bd - 0.12); }   // swap on the next bar line
    for (const l in pb.L) pb.L[l].g.gain.setTargetAtTime(+l === sel ? 1 : 0, at, 0.09);
    pb.sel = sel;
  }
  function startSet(idx, kind) {
    const c = E.c, t = c.currentTime + 0.04, old = E.pb, pb = { idx, kind, startAt: t, loopDur: 0, L: {}, sel: null, out: c.createGain() };
    pb.out.gain.value = 0; pb.out.gain.setTargetAtTime(1, t, 0.05); pb.out.connect(E.musBus);
    if (kind === 'menu') { addLayer(pb, 'menu'); if (pb.L.menu) pb.L.menu.g.gain.value = 1; }
    else { for (const l of [2, 3, 4, 5]) addLayer(pb, l); pb.sel = null; applyTier(pb, A.mode === 'over' ? 2 : A.stars, true); }
    if (old) {
      old.out.gain.setTargetAtTime(0, c.currentTime, 0.07);
      for (const l in old.L) { try { old.L[l].src.stop(c.currentTime + 0.7); } catch (e) {} }
      setTimeout(() => { try { old.out.disconnect(); } catch (e) {} }, 900);
    }
    E.pb = pb;
  }
  function sync() {
    if (!E || E.off || !A.playing || !A.bufOK || A.bufFail || !E.c) return;
    const kind = A.mode === 'menu' ? 'menu' : 'play', idx = trackIdx; let pb = E.pb;
    if (!pb || pb.idx !== idx || pb.kind !== kind) {
      if (!bufs[key(idx, kind === 'menu' ? 'menu' : 2)]) {                           // not rendered yet: keep what is playing, switch the moment it is ready
        if (!pb) { const si = bufs[key(idx, 'menu')] ? idx : bufs[key(upcoming, 'menu')] ? upcoming : -1; if (si >= 0) startSet(si, 'menu'); }                    // nothing playing yet (first START under load): calm stand-in loop instead of silence
        kick0(); return;
      }
      startSet(idx, kind); pb = E.pb;
    }
    if (kind === 'play') { for (const l of [2, 3, 4, 5]) if (!pb.L[l] && bufs[key(idx, l)]) addLayer(pb, l); applyTier(pb, A.mode === 'over' ? 2 : A.stars); }
  }
  A.sync = sync;
  setTimeout(kick0, 0);                       // start pre-rendering right after load (OfflineAudioContext needs no user gesture)

  /* ------------------------------------------------------------ public control */
  /* iOS keeps WebAudio silent while the ringer switch is on silent, unless a media (<audio>) element is playing: loop a silent clip, started inside a tap. */
  const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let silentEl = null;
  function silentWav() {
    const sr = 8000, n = 4000, b = new Uint8Array(44 + n), v = new DataView(b.buffer), w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, 'data'); v.setUint32(40, n, true);
    for (let i = 0; i < n; i++) b[44 + i] = 128;
    return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
  }
  function silentPlay() {
    try {
      if (!silentEl) { silentEl = new Audio(); silentEl.src = silentWav(); silentEl.loop = true; silentEl.preload = 'auto'; silentEl.setAttribute('playsinline', ''); silentEl.setAttribute('x-webkit-airplay', 'deny'); }
      if (silentEl.paused) { const p = silentEl.play(); if (p && p.catch) p.catch(() => {}); }
      A.silentPlaying = !silentEl.paused;
    } catch (e) {}
  }
  function audioSessionPlayback() { try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {} }
  A.resume = function () {                          // call from ANY user gesture (touchend / click / key): safe to spam
    audioSessionPlayback();
    if (!A.ctx) return;
    if (IOS || A.forceUnlockEl) silentPlay();
    if (A.ctx.state !== 'running') { try { const p = A.ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch (e) {} }
    try { const b = A.ctx.createBuffer(1, 1, 22050), s = A.ctx.createBufferSource(); s.buffer = b; s.connect(A.ctx.destination); s.start(0); } catch (e) {}   // tiny silent blip: fully unlocks iOS
  };
  A.init = function () {
    audioSessionPlayback();
    if (A.ctx) { A.resume(); return; }
    const AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) { A.enabled = false; return; }
    try { A.ctx = new AC({ latencyHint: 'playback' }); } catch (e) { try { A.ctx = new AC(); } catch (e2) { A.enabled = false; return; } }
    E = makeEngine(A.ctx);
    A.ctx.onstatechange = () => { A.state = A.ctx.state; };
    A.resume();                                     // resume + unlock synchronously, inside the tap that created us
  };
  // re-resume on every gesture until the context is genuinely running, and whenever the tab/app comes back
  ['touchend', 'pointerup', 'click', 'keydown', 'mousedown'].forEach(ev => document.addEventListener(ev, () => { if (A.ctx && (A.ctx.state !== 'running' || (IOS && silentEl && silentEl.paused))) A.resume(); }, { capture: true, passive: true }));
  document.addEventListener('visibilitychange', () => {
    if (!A.ctx) return;
    if (document.hidden) { try { A.ctx.suspend(); } catch (e) {} try { if (silentEl) silentEl.pause(); } catch (e) {} }
    else { A.resume(); if (A.playing && E) E.nextT = Math.max(E.nextT, A.ctx.currentTime + 0.05); }
  });
  global.addEventListener('pageshow', () => { if (A.ctx && !document.hidden) A.resume(); });
  global.addEventListener('focus', () => { if (A.ctx && !document.hidden) A.resume(); });
  /* output level (post-limiter): RMS + peak of the last ~46 ms, for tests and a debug meter */
  A.level = function () {
    if (!E || !E.an) return null; const d = new Float32Array(E.an.fftSize); E.an.getFloatTimeDomainData(d);
    let s = 0, pk = 0; for (let i = 0; i < d.length; i++) { s += d[i] * d[i]; const a = Math.abs(d[i]); if (a > pk) pk = a; }
    return { rms: Math.sqrt(s / d.length), peak: pk, state: A.ctx ? A.ctx.state : 'none', muted: A.muted, track: A.trackName, mode: A.mode, playing: A.playing };
  };
  A.startMusic = function () {
    if (!E || A.playing) return;
    A.playing = true; E.nextT = E.c.currentTime + 0.06;
    clearInterval(A.timer); A.timer = setInterval(() => { pump(); sync(); }, 25);       // 25 ms tick: (fallback scheduler, 100 ms lookahead) + cheap buffer-set reconcile
    sync(); kick0();
  };
  A.stopMusic = function () {
    A.playing = false; clearInterval(A.timer);
    if (E && E.pb) { const pb = E.pb; E.pb = null; pb.out.gain.setTargetAtTime(0, E.c.currentTime, 0.05); for (const l in pb.L) { try { pb.L[l].src.stop(E.c.currentTime + 0.4); } catch (e) {} } }
  };
  A.setMode = function (m) {
    if (A.mode === m) return;
    const prev = A.mode; A.mode = m;
    if (!E) return;
    const t = E.c.currentTime;
    if (m === 'over') { E.musLP.frequency.cancelScheduledValues(t); E.musLP.frequency.setTargetAtTime(520, t, 0.12); E.pendTier = 1; return; }
    E.musLP.frequency.cancelScheduledValues(t); E.musLP.frequency.setTargetAtTime(16000, t, 0.25);
    if ((prev === 'menu') !== (m === 'menu')) { E.mode = m; E.step = 0; E.tier = E.pendTier = 1; E.tempo = A.track.bpm; if (A.playing) E.nextT = Math.max(E.nextT, t + 0.05); }
    else E.mode = m;
    if (A.playing) sync(); kick0();
  };
  A.setIntensity = function (threat, speedRatio) {
    A.stars = Math.max(1, Math.min(5, Math.ceil((threat || 0) / 2)));
    A.speedR = speedRatio || 0;
    if (E && A.mode === 'play') { E.pendTier = A.stars; if (E.pb) applyTier(E.pb, A.stars); }
  };
  A.setBlind = function (b) {
    if (A.blind === b) return; A.blind = b;
    if (!E) return;
    const t = E.c.currentTime;
    E.dry.gain.cancelScheduledValues(t); E.wet.gain.cancelScheduledValues(t); E.radio.frequency.cancelScheduledValues(t);
    E.dry.gain.setTargetAtTime(b ? 0.15 : 1, t, 0.14); E.wet.gain.setTargetAtTime(b ? 1.7 : 0, t, 0.14);
    E.radio.frequency.setValueAtTime(b ? 400 : 1400, t);
    E.radio.frequency.exponentialRampToValueAtTime(b ? 1500 : 3500, t + 0.45);
    if (!b) E.radio.frequency.setValueAtTime(1400, t + 0.5);
  };
  A.duck = function (amt, secs) {
    if (!E) return; amt = amt === undefined ? 0.5 : amt; secs = secs === undefined ? 0.6 : secs; const t = E.c.currentTime, g = E.musBus.gain, V = E.musV;
    g.cancelScheduledValues(t); g.setTargetAtTime(V * (1 - amt), t, 0.03); g.setTargetAtTime(V, t + 0.12, Math.max(0.05, secs / 3));       // smooth dip + recovery, no steps
  };
  A.pauseDuck = function (on) { if (!E) return; E.duckG.gain.setTargetAtTime(on ? 0.4 : 1, E.c.currentTime, 0.08); };   // pause overlay: music keeps playing, quieter
  A.setMuted = function (m) {
    A.muted = !!m; try { localStorage.setItem('sl_muted', A.muted ? '1' : '0'); } catch (e) {}
    if (E) E.master.gain.setTargetAtTime(A.muted ? 0 : A.volume, E.c.currentTime, 0.04);
  };
  A.toggleMute = function () { A.setMuted(!A.muted); return A.muted; };
  A.setMusicEnabled = function (on) { A.musicEnabled = !!on; if (E) E.musOut.gain.setTargetAtTime(on ? 1 : 0, E.c.currentTime, 0.05); };
  A.setSfxEnabled = function (on) { A.sfxEnabled = !!on; if (E) E.sfxBus.gain.setTargetAtTime(on ? 0.8 : 0, E.c.currentTime, 0.05); };

  /* ------------------------------------------------------------ SFX (all soft, no square-wave buzz) */
  const S = (fn) => function () { if (!E || !A.enabled) return; fn.apply(null, arguments); };
  A.lane = S(function (dir) { noise(0.17, 0.2, { f: dir > 0 ? 600 : 2600, fTo: dir > 0 ? 2600 : 600, q: 1.1, atk: 0.04, pan: 0.5 * (dir || 0) }); });
  A.jump = S(function () { noise(0.24, 0.16, { f: 500, fTo: 2000, q: 1, atk: 0.05 }); tone(150, 0.14, 'sine', 0.2, { slide: 280 }); });
  A.slide = S(function () { noise(0.32, 0.17, { f: 2600, fTo: 380, q: 1, atk: 0.04 }); });
  A.land = S(function () { tone(95, 0.13, 'sine', 0.3, { slide: 46 }); noise(0.07, 0.12, { f: 700, type: 'lowpass' }); });
  A.coin = S(function (combo) {
    const f = 1318.5 * Math.pow(2, Math.min(10, combo || 0) / 24);
    tone(f, 0.32, 'sine', 0.14, { send: 0.18 }); tone(f * 2, 0.16, 'sine', 0.05);
    tone(f * 1.5, 0.4, 'sine', 0.12, { delay: 0.07, send: 0.18 }); tone(f * 3, 0.2, 'sine', 0.04, { delay: 0.07 });
  });
  A.thunder = S(function () { noise(2.2, 0.32, { f: 520, fTo: 70, type: 'lowpass', q: 0.5, atk: 0.35, delay: 0.45, send: 0.35 }); tone(52, 1.6, 'sine', 0.22, { slide: 34, delay: 0.5, atk: 0.2 }); A.duck(0.5, 1.8); });
  A.near = S(function () { noise(0.13, 0.12, { f: 2400, fTo: 6000, type: 'highpass', q: 0.7, atk: 0.02 }); tone(990, 0.1, 'triangle', 0.07, { slide: 1480 }); });
  A.outplay = S(function () { [660, 880, 1320].forEach((f, i) => tone(f, 0.4, 'sine', 0.1, { delay: i * 0.075, send: 0.3 })); });
  A.bump = S(function () { tone(125, 0.16, 'sine', 0.3, { slide: 55 }); noise(0.1, 0.16, { f: 600, type: 'lowpass' }); });
  A.crash = S(function () {
    tone(120, 0.7, 'sine', 0.42, { slide: 30 });
    noise(0.75, 0.3, { f: 3200, fTo: 220, type: 'lowpass', q: 0.6 });
    noise(0.18, 0.25, { f: 1900, q: 1.5, delay: 0.02, send: 0.3 }); noise(0.14, 0.18, { f: 2700, q: 1.8, delay: 0.09 });
    A.duck(0.7, 1.1);
  });
  A.glitch = S(function () { // jammer on: soft radio tuning sweep, no noise burst
    noise(0.65, 0.1, { f: 280, fTo: 3200, q: 2.2, atk: 0.15, send: 0.25 });
    tone(880, 0.18, 'sine', 0.08, { send: 0.3 }); tone(1320, 0.3, 'sine', 0.07, { delay: 0.1, send: 0.3 });
  });
  A.glitchEnd = S(function () { noise(0.5, 0.08, { f: 3200, fTo: 300, q: 2.2, atk: 0.08, send: 0.2 }); tone(660, 0.3, 'sine', 0.07, { slide: 440, send: 0.25 }); });
  A.taunt = S(function () { noise(0.05, 0.08, { f: 1900, q: 2.5 }); tone(1250, 0.04, 'sine', 0.04); });
  A.speedup = S(function () { tone(300, 0.3, 'sine', 0.07, { slide: 640, atk: 0.1 }); });
  A.threat = S(function () { tone(98, 0.3, 'sine', 0.1, { slide: 74 }); });
  A.uiBlip = S(function () { tone(720, 0.05, 'sine', 0.07, { slide: 900 }); });
  A.buy = S(function () { [1046.5, 1568].forEach((f, i) => tone(f, 0.4, 'sine', 0.11, { delay: i * 0.09, send: 0.25 })); noise(0.05, 0.06, { f: 6000, type: 'highpass', delay: 0.01 }); });
  A.deny = S(function () { tone(180, 0.12, 'sine', 0.14, { slide: 120 }); });
  A.bikeLost = S(function () { noise(0.7, 0.4, { f: 3500, fTo: 200, type: 'lowpass', q: 0.9 }); tone(130, 0.5, 'sawtooth', 0.28, { slide: 45 }); noise(0.5, 0.18, { f: 6000, fTo: 1800, type: 'highpass', q: 0.8, delay: 0.1 }); [0.2, 0.34, 0.46].forEach((d, i) => tone(900 - i * 150, 0.1, 'triangle', 0.08, { delay: d })); });
  A.bikeBack = S(function () { tone(110, 0.5, 'sawtooth', 0.2, { slide: 330 }); noise(0.4, 0.1, { f: 800, fTo: 3000, type: 'bandpass', q: 1.2 }); [523, 659, 784].forEach((f, i) => tone(f, 0.3, 'triangle', 0.1, { delay: 0.12 + i * 0.07, send: 0.3 })); });
  A.bail = S(function () { noise(0.55, 0.25, { f: 4000, fTo: 250, type: 'lowpass', q: 0.8 }); tone(180, 0.4, 'sine', 0.35, { slide: 60 }); [523, 784, 1047].forEach((f, i) => tone(f, 0.45, 'sine', 0.08, { delay: 0.25 + i * 0.08, send: 0.3 })); });
  A.start = S(function () {
    const t = now(); bass(t, 33, 0.7, 0.9); noise(0.38, 0.1, { f: 300, fTo: 4200, q: 1.1, atk: 0.2 });
    // route bass() through sfx: it writes to bassBus (music chain), fine — it is a stinger
  });
  A.siren = S(function (level) { // police siren swell when stars rise
    const c = E.c, t = now(), dur = 1.5 + level * 0.25, v = 0.035 + level * 0.012;
    const o = c.createOscillator(), lfo = c.createOscillator(), lg = c.createGain(), lp = c.createBiquadFilter(), g = c.createGain();
    o.type = 'sawtooth'; o.frequency.value = 880; lfo.type = 'triangle'; lfo.frequency.value = 0.85 + level * 0.12; lg.gain.value = 300;
    lfo.connect(lg); lg.connect(o.frequency); lp.type = 'lowpass'; lp.frequency.value = 1700; lp.Q.value = 0.6;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + dur * 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp); lp.connect(g); g.connect(E.sfxBus); const s = c.createGain(); s.gain.value = 0.5; g.connect(s); s.connect(E.send);
    o.start(t); lfo.start(t); o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
  });


  /* ------------------------------------------------------------ SFX for the new road features */
  A.stage = S(function () { // stage change: a rising sweep + warm chime, 
    noise(0.9, 0.1, { f: 400, fTo: 5000, q: 1, atk: 0.4, send: 0.3 });
    [523.3, 659.3, 784, 1046.5].forEach((f, i) => tone(f, 0.55, 'sine', 0.08, { delay: 0.1 + i * 0.09, send: 0.35 }));
  });
  A.letter = S(function (i) { const f = 880 * Math.pow(2, [0, 2, 4, 7, 9, 12][(i || 0) % 6] / 12); tone(f, 0.35, 'sine', 0.13, { send: 0.3 }); tone(f * 2, 0.2, 'triangle', 0.05); });
  A.word = S(function () { [523.3, 659.3, 784, 1046.5, 1318.5].forEach((f, i) => tone(f, 0.6, 'sine', 0.1, { delay: i * 0.08, send: 0.35 })); noise(0.3, 0.07, { f: 6000, type: 'highpass', delay: 0.3 }); });
  A.mission = S(function () { [659.3, 830.6, 987.8].forEach((f, i) => tone(f, 0.45, 'sine', 0.1, { delay: i * 0.1, send: 0.3 })); tone(165, 0.3, 'sine', 0.18, { slide: 110 }); });
  A.boost = S(function () { noise(0.7, 0.2, { f: 300, fTo: 5200, q: 0.9, atk: 0.12 }); tone(110, 0.6, 'sawtooth', 0.06, { slide: 330, atk: 0.1 }); });
  A.ramp = S(function () { tone(180, 0.35, 'sine', 0.2, { slide: 520, atk: 0.02 }); noise(0.4, 0.14, { f: 600, fTo: 3600, q: 1, atk: 0.1 }); });
  A.rev = S(function () { tone(62, 1.1, 'sawtooth', 0.09, { slide: 150, f: 520, atk: 0.1 }); tone(94, 0.9, 'sawtooth', 0.05, { slide: 210, f: 700, atk: 0.1, delay: 0.25 }); noise(0.9, 0.08, { f: 200, fTo: 900, type: 'lowpass', q: 0.6, atk: 0.2 }); });
  A.slam = S(function () { tone(70, 0.5, 'sine', 0.3, { slide: 38 }); noise(0.18, 0.2, { f: 1400, fTo: 200, type: 'lowpass', q: 0.8 }); tone(1568, 0.5, 'sine', 0.05, { delay: 0.28, send: 0.3 }); });
  A.shield = S(function () { [523, 784, 1047].forEach((f, i) => tone(f, 0.38, 'triangle', 0.09, { delay: i * 0.05, send: 0.3 })); tone(260, 0.35, 'sine', 0.1, { slide: 520 }); });
  A.shieldHit = S(function () { noise(0.28, 0.3, { f: 3200, fTo: 700, type: 'bandpass', q: 1.2, send: 0.3 }); tone(880, 0.35, 'triangle', 0.12, { slide: 330, send: 0.3 }); tone(110, 0.3, 'sine', 0.2, { slide: 60 }); A.duck(0.3, 0.5); });
  A.magnet = S(function () { tone(180, 0.5, 'sawtooth', 0.05, { slide: 420, f: 900 }); tone(420, 0.3, 'sine', 0.09, { delay: 0.18, send: 0.2 }); tone(630, 0.3, 'sine', 0.08, { delay: 0.26, send: 0.2 }); });
  A.x2 = S(function () { [784, 1175, 1568].forEach((f, i) => tone(f, 0.3, 'sine', 0.1, { delay: i * 0.06, send: 0.3 })); });
  A.daily = S(function () { [523.3, 659.3, 784, 1046.5, 1568].forEach((f, i) => tone(f, 0.7, 'sine', 0.09, { delay: i * 0.1, send: 0.4 })); });

  /* ------------------------------------------------------------ offline rendering (tests: level + tempo analysis) */
  A.renderOffline = async function (secs, o) {
    o = o || {}; const OAC = global.OfflineAudioContext || global.webkitOfflineAudioContext; if (!OAC) return null;
    const sr = 22050, oc = new OAC(1, Math.ceil(sr * secs), sr), live = E, liveMode = A.mode, liveSpeed = A.speedR;
    A.mode = o.mode || 'play'; A.speedR = 0;
    const liveTrack = A.track; if (o.track !== undefined) A.track = TRACKS[o.track]; E = makeEngine(oc); E.mode = A.mode; E.tier = E.pendTier = o.tier || 3; E.nextT = 0.02;
    try {
      if (o.sfx) { for (const [i, nm] of o.sfx.entries()) { E.t0 = 0.3 + i * 1.2; A[nm[0]].apply(null, nm.slice(1)); E.t0 = undefined; } }
      else while (E.nextT < secs) scheduleStep(E);
      const buf = await oc.startRendering(); return { sr, data: Array.from(buf.getChannelData(0)) };
    } finally { E = live; A.mode = liveMode; A.speedR = liveSpeed; A.track = liveTrack; }
  };

  /* test helper: the full LIVE output chain (music loops + SFX + compressor + limiter) rendered offline at the device-like 48 kHz; returns level stats (and optionally the samples) */
  A.renderMix = async function (secs, o) {
    if (typeof secs !== "number") return null;
    o = o || {}; if (!OAC) return null; const sr = 48000, oc = new OAC(2, Math.ceil(sr * secs), sr), idx = o.track === undefined ? trackIdx : o.track, layer = o.layer === undefined ? 5 : o.layer;
    const b = bufs[key(idx, layer)] || await renderLoop(idx, layer), live = E, en = A.enabled, dk = A.duck; let eng;
    try {
      A.enabled = true; A.duck = function () {};      // worst case: no crash ducking
      E = eng = makeEngine(oc, false); eng.musBus.gain.value = 1;
      if (!o.nomusic) { const src = oc.createBufferSource(); src.buffer = b; src.loop = true; src.connect(eng.musBus); src.start(0); }
      for (const [i, nm] of (o.sfx || []).entries()) { eng.t0 = nm[0]; A[nm[1]].apply(null, nm.slice(2)); eng.t0 = undefined; }
    } finally { E = live; A.enabled = en; A.duck = dk; }
    const buf = await oc.startRendering(), ch = [buf.getChannelData(0), buf.getChannelData(1)];
    let peak = 0, clip = 0, sq = 0, over3 = 0; const bins = Math.ceil(secs), pks = new Float32Array(bins);
    for (let c = 0; c < 2; c++) for (let i = 0; i < ch[c].length; i++) { const a = Math.abs(ch[c][i]); if (a > peak) peak = a; if (a >= 0.999) clip++; if (a > 0.708) over3++; sq += a * a; const k = (i / sr) | 0; if (a > pks[k]) pks[k] = a; }
    const out = { sr, peak, peakDb: 20 * Math.log10(peak + 1e-9), clip, over3dB: over3, rmsDb: 10 * Math.log10(sq / (2 * ch[0].length) + 1e-12), stats: b.__stats, perSecPeak: Array.from(pks) };
    if (o.data) out.data = Array.from(ch[0]);
    return out;
  };

  global.Sfx = A;
})(window);
