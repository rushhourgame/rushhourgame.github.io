/* RUSH HOUR (was Signal Lost) — the city's brain.
   Two layers:
     LOG   : permanent record of how you played (used for taunts + the game-over read-out)
     MODEL : decaying predictive model (wiped when you grab a glitch chip → the city goes blind)
   The model predicts (a) which lane you'll be sitting in when a wave reaches the "decision line",
   (b) which way you dodge when blocked, (c) when you jump relative to impact. The wave generator
   in game.js uses those predictions to put obstacles exactly where you'd go.            */
(function (global) {
  'use strict';
  const NAMES = ['LEFT', 'MIDDLE', 'RIGHT'];
  const HALF_LIFE = 28; // seconds — habits older than this fade
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  class Brain {
    constructor() { this.reset(); }

    reset() {
      this.blindOn = false;
      this.log = {
        t: 0, laneTime: [0, 0, 0], samples: [0, 0, 0],
        dodgeL: 0, dodgeR: 0, midL: 0, midR: 0, dodges: 0,
        jumps: 0, jumpsBarrier: 0, jumpTTI: 0, jumpEarly: 0, jumpLate: 0, jumpGood: 0, spamJumps: 0,
        slides: 0, slidesBeam: 0, slideTTI: 0, spamSlides: 0,
        reactSum: 0, reactN: 0, switches: 0,
        bets: 0, hits: 0, dirBets: 0, dirHits: 0, peakPred: 0,
        outplayed: 0, nearMiss: 0, glitches: 0, coins: 0, bumps: 0, history: []
      };
      this.resetModel(0.33);
    }

    resetModel(acc) {
      this.laneM = [0.4, 0.4, 0.4];
      this.trans = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      this.midLm = 0.2; this.midRm = 0.2;
      this.acc = acc === undefined ? 0.33 : acc;
      this.accN = 0;
      this.jumpTTIm = null; // EMA of "seconds before impact you press jump"
      this.slideTTIm = null;
    }

    blind() { this.log.glitches++; this.resetModel(0.04); this.blindOn = true; }
    unblind() { this.blindOn = false; }

    decay(dt) {
      const f = Math.pow(0.5, dt / HALF_LIFE);
      for (let i = 0; i < 3; i++) { this.laneM[i] *= f; for (let j = 0; j < 3; j++) this.trans[i][j] *= f; }
      this.midLm *= f; this.midRm *= f;
    }

    update(dt, lane) {
      this.log.t += dt;
      this.log.laneTime[lane] += dt;
      if (!this.blindOn) this.laneM[lane] += dt;
      this.decay(dt);
    }

    // --- prediction -------------------------------------------------------
    pref() {
      const s = this.laneM[0] + this.laneM[1] + this.laneM[2];
      return this.laneM.map(v => v / s);
    }
    // Probability of each lane being "where you are at the decision line", given the lane you're in now.
    predictRest(c) {
      const pref = this.pref(), row = this.trans[c];
      const rs = row[0] + row[1] + row[2], K = 1.5;
      const P = [0, 1, 2].map(l => (row[l] + K * pref[l]) / (rs + K));
      let bet = 0; for (let i = 1; i < 3; i++) if (P[i] > P[bet]) bet = i;
      return { P, bet, conf: P[bet] };
    }
    // Which way do you dodge when blocked in lane `lane`? (+1 right, -1 left)
    predictDir(lane) {
      if (lane === 0) return { dir: 1, conf: 1, forced: true };
      if (lane === 2) return { dir: -1, conf: 1, forced: true };
      const l = this.midLm, r = this.midRm;
      const dir = l === r ? (Math.random() < 0.5 ? -1 : 1) : (l > r ? -1 : 1);
      return { dir, conf: Math.max(l, r) / (l + r), forced: false };
    }
    // How hard the city leans on its predictions (0..0.92)
    actProb(t) {
      const accN = clamp((this.acc - 0.25) / 0.6, 0, 1);
      return clamp(0.14 + 0.5 * (1 - Math.exp(-t / 32)) + 0.3 * accN, 0, 0.92);
    }
    predPct() { return Math.round(this.acc * 100); }
    threat(t) {
      const accN = clamp((this.acc - 0.2) / 0.7, 0, 1);
      return clamp(Math.round(1 + 9 * (0.62 * accN + 0.38 * (this.actProb(t) - 0.14) / 0.78)), 1, 10);
    }

    bumpAcc(hit) {
      const a = 0.2;
      this.acc = this.acc * (1 - a) + (hit ? 1 : 0) * a;
      this.accN++;
      const p = this.predPct();
      if (this.accN >= 5 && p > this.log.peakPred) this.log.peakPred = p;
    }

    // --- learning events ---------------------------------------------------
    // Wave reached the decision line: where were you, vs where did we bet?
    recordSample(c0, L, bet, conf) {
      this.log.samples[L]++;
      if (this.blindOn) return null; // the city can't see
      this.trans[c0][L] += 1;
      const hit = L === bet;
      this.log.bets++; if (hit) this.log.hits++;
      this.bumpAcc(hit);
      if (!hit && conf > 0.5) this.log.outplayed++;
      return hit;
    }
    // You switched lanes. If something was in your way it's a dodge — learn the direction.
    recordSwitch(from, dir, threat, tti) {
      this.log.switches++;
      if (!threat) return null;
      this.log.dodges++;
      if (dir < 0) this.log.dodgeL++; else this.log.dodgeR++;
      let res = null;
      if (from === 1 && !this.blindOn) {
        const pred = this.predictDir(1).dir;
        res = pred === dir;
        this.log.dirBets++; if (res) this.log.dirHits++;
        this.bumpAcc(res);
        if (dir < 0) { this.log.midL++; this.midLm += 1; } else { this.log.midR++; this.midRm += 1; }
      }
      if (tti !== null && tti !== undefined) { this.log.reactSum += tti; this.log.reactN++; }
      return res;
    }
    recordJump(tti, onBarrier) {
      this.log.jumps++;
      if (onBarrier) {
        this.log.jumpsBarrier++; this.log.jumpTTI += tti;
        if (!this.blindOn) this.jumpTTIm = this.jumpTTIm === null ? tti : this.jumpTTIm * 0.6 + tti * 0.4;
        if (tti >= 0.44) this.log.jumpEarly++; else if (tti <= 0.2) this.log.jumpLate++; else this.log.jumpGood++;
        this.log.reactSum += tti; this.log.reactN++;
      } else this.log.spamJumps++;
    }
    recordSlide(tti, onBeam) {
      this.log.slides++;
      if (onBeam) {
        this.log.slidesBeam++; this.log.slideTTI += tti;
        if (!this.blindOn) this.slideTTIm = this.slideTTIm === null ? tti : this.slideTTIm * 0.6 + tti * 0.4;
        this.log.reactSum += tti; this.log.reactN++;
      } else this.log.spamSlides++;
    }

    // --- stats helpers ------------------------------------------------------
    laneShare() {
      const L = this.log, s = L.laneTime[0] + L.laneTime[1] + L.laneTime[2] || 1;
      return L.laneTime.map(v => v / s);
    }
    dodgeBias() {
      const L = this.log;
      let l = L.midL, r = L.midR;
      if (l + r < 3) { l = L.dodgeL; r = L.dodgeR; }
      const n = l + r;
      if (!n) return null;
      const dir = l >= r ? -1 : 1, k = Math.max(l, r);
      return { dir, name: dir < 0 ? 'LEFT' : 'RIGHT', k, n, frac: k / n };
    }
    avgJump() { const L = this.log; return L.jumpsBarrier ? L.jumpTTI / L.jumpsBarrier : null; }
    avgReact() { const L = this.log; return L.reactN ? L.reactSum / L.reactN : null; }
    overall() { const L = this.log; return L.bets + L.dirBets ? Math.round(100 * (L.hits + L.dirHits) / (L.bets + L.dirBets)) : 0; }

    // --- taunts (computed from REAL stats) -----------------------------------
    taunt(ctx) {
      const L = this.log, c = [];
      const add = (w, t) => c.push({ w: w * (0.85 + Math.random() * 0.3), t });
      const pct = Math.round(ctx.pred);
      if (ctx.blind) {
        return ['RUSH HOUR', 'ERROR: NO SIGNAL', 'WHERE DID YOU GO?', 'I CAN\'T SEE YOU', 'SIGNAL JAMMED', 'REBOOTING...'][Math.floor(Math.random() * 6)];
      }
      if (L.t < 7) add(2, ['NEW RUNNER DETECTED', 'LEARNING YOU...', 'I SEE YOU.', 'RUN. I\'M WATCHING.'][Math.floor(Math.random() * 4)]);
      const tot = L.laneTime[0] + L.laneTime[1] + L.laneTime[2];
      if (tot > 5) {
        const sh = this.laneShare(); let b = 0; for (let i = 1; i < 3; i++) if (sh[i] > sh[b]) b = i;
        const p = Math.round(sh[b] * 100);
        if (sh[b] >= 0.45) {
          add(sh[b] * 2.2, 'YOU LIVE IN THE ' + NAMES[b] + ' LANE');
          add(sh[b] * 2.0, NAMES[b] + ' LANE ' + p + '% OF THE TIME');
        }
        if (sh[1] < 0.15) add(1.1, 'THE MIDDLE? NEVER');
      }
      const db = this.dodgeBias();
      if (db && db.n >= 3 && db.frac >= 0.66) {
        add(db.frac * 2.4, 'YOU ALWAYS DODGE ' + db.name);
        add(db.frac * 2.0, 'DODGED ' + db.name + ' ' + db.k + ' OF ' + db.n + ' TIMES');
      }
      const aj = this.avgJump();
      if (aj !== null && L.jumpsBarrier >= 3) {
        if (aj >= 0.4) add(1.9, 'JUMPING EARLY AGAIN?');
        else if (aj <= 0.2) add(1.8, 'JUMPING LATE. NERVOUS?');
        else add(1.2, 'JUMP TIMING ' + aj.toFixed(2) + 'S. I HAVE IT');
      }
      const ar = this.avgReact();
      if (ar !== null && L.reactN >= 4) {
        if (ar < 0.45) add(1.7, 'LAST SECOND DODGER');
        else add(1.2, 'REACTION ' + ar.toFixed(2) + 'S. NOTED');
        if (ar > 1.0) add(1.5, 'YOU SEE ME COMING. SLOW?');
      }
      if (L.spamJumps >= 3) add(1.3, 'JUMPING AT NOTHING?');
      if (L.spamSlides >= 3) add(1.3, 'SLIDING AT SHADOWS?');
      if (L.nearMiss >= 3) add(1.3, L.nearMiss + ' NEAR MISSES. RECKLESS');
      if (this.accN >= 4) {
        if (pct >= 60) { add(2.1, 'I CALLED ' + pct + '% OF YOUR MOVES'); add(1.9, 'I KNOW YOUR NEXT MOVE'); }
        else if (pct <= 32) { add(2.0, 'ERROR: YOU MAKE NO SENSE'); add(1.6, 'WHY CAN\'T I READ YOU?'); }
        else add(1.0, 'PREDICTION ' + pct + '%. LEARNING');
      }
      if (ctx.combo >= 8) add(1.3, 'COMBO ' + ctx.combo + '. I\'LL END IT');
      if (!c.length) add(1, 'I SEE YOU.');
      // avoid repeats
      for (const x of c) if (this._recent && this._recent.includes(x.t)) x.w *= 0.15;
      c.sort((a, b) => b.w - a.w);
      const t = c[0].t;
      this._recent = (this._recent || []).concat(t).slice(-4);
      return t;
    }

    // --- game-over read-out --------------------------------------------------
    summary() {
      const L = this.log, lines = [];
      const sh = this.laneShare();
      let b = 0; for (let i = 1; i < 3; i++) if (sh[i] > sh[b]) b = i;
      const db = this.dodgeBias();
      const aj = this.avgJump(), ar = this.avgReact();
      const overall = this.overall();
      if (L.t > 3) lines.push({ k: 'HOME LANE', v: NAMES[b] + ' ' + Math.round(sh[b] * 100) + '%', hot: sh[b] >= 0.5 });
      if (db && db.n >= 2) lines.push({ k: 'DODGES', v: db.name + ' ' + db.k + '/' + db.n, hot: db.frac >= 0.7 && db.n >= 3 });
      if (aj !== null) lines.push({ k: 'JUMP TIMING', v: (aj >= 0.4 ? 'EARLY ' : aj <= 0.2 ? 'LATE ' : 'CLEAN ') + aj.toFixed(2) + 'S', hot: aj >= 0.4 || aj <= 0.2 });
      if (ar !== null) lines.push({ k: 'REACTION', v: ar.toFixed(2) + 'S AVG', hot: ar < 0.45 });
      lines.push({ k: 'I PREDICTED', v: overall + '% OF MOVES', hot: overall >= 55 });
      if (L.glitches) lines.push({ k: 'BLINDED ME', v: L.glitches + 'X', hot: false });
      // verdict
      let verdict, tip;
      if (overall >= 65) { verdict = 'READ LIKE A BOOK.'; }
      else if (overall >= 48) { verdict = 'MOSTLY PREDICTABLE.'; }
      else if (overall >= 33) { verdict = 'A LITTLE UNPREDICTABLE.'; }
      else { verdict = 'I COULDN\'T READ YOU.'; }
      if (sh[b] >= 0.5) tip = 'TRY LIVING IN THE ' + NAMES[(b + 1 + (Math.random() < 0.5 ? 0 : 1)) % 3] + ' LANE.';
      else if (db && db.frac >= 0.7 && db.n >= 3) tip = 'DODGE ' + (db.dir < 0 ? 'RIGHT' : 'LEFT') + ' ONCE. SEE WHAT HAPPENS.';
      else if (aj !== null && aj >= 0.4) tip = 'JUMP LATER. I EXPECT EARLY.';
      else if (aj !== null && aj <= 0.2) tip = 'JUMP EARLIER. I EXPECT LATE.';
      else if (!L.glitches) tip = 'GRAB A SIGNAL JAMMER TO BLIND ME.';
      else tip = 'KEEP CHANGING IT UP.';
      return { lines, verdict, tip, overall, share: sh };
    }
  }

  global.Brain = Brain;
  global.LANE_NAMES = NAMES;
})(window);
