// SNAKE'D rules engine + computer players. No DOM access here.
(function (root) {
  const SUITS = ["red", "blue", "green", "pink", "black"];
  const RANGE = { 2: [2, 6], 3: [1, 7], 4: [0, 8], 5: [0, 10], 6: [0, 10] };
  const HAND = 9, TRICKS = 8, ROUNDS = 3;

  function buildDeck(n) {
    const [lo, hi] = RANGE[n], d = [];
    for (const s of SUITS) for (let v = lo; v <= hi; v++) d.push({ id: s + v, s, n: v, up: false });
    return d;
  }
  function shuffle(a, rng) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function legalCards(hand, trick) {
    if (!trick.length) return hand.slice();
    const led = trick[0].card.s, f = hand.filter(c => c.s === led);
    return f.length ? f : hand.slice();
  }
  // index (within trick) of the winning play
  function trickWinnerIdx(trick, trump) {
    const led = trick[0].card.s;
    let pool = trump ? trick.filter(t => t.card.s === trump) : [];
    if (!pool.length) pool = trick.filter(t => t.card.s === led);
    const best = pool.reduce((a, b) => (b.card.n > a.card.n ? b : a));
    return trick.indexOf(best);
  }
  // who leads next: highest black played, else the trick winner
  function nextLeader(trick, trump) {
    const blacks = trick.filter(t => t.card.s === "black");
    if (blacks.length) return blacks.reduce((a, b) => (b.card.n > a.card.n ? b : a)).p;
    return trick[trickWinnerIdx(trick, trump)].p;
  }
  // most common non-black colour among face-up cards; tie -> highest single card; still tied -> none
  function pickTrump(players) {
    const count = {}, high = {};
    for (const p of players) for (const c of p.hand) if (c.up && c.s !== "black") {
      count[c.s] = (count[c.s] || 0) + 1; high[c.s] = Math.max(high[c.s] ?? -1, c.n);
    }
    const suits = Object.keys(count);
    if (!suits.length) return { trump: null, why: "No coloured cards are showing, so there is no trump." };
    const max = Math.max(...suits.map(s => count[s]));
    let tied = suits.filter(s => count[s] === max);
    if (tied.length === 1) return { trump: tied[0], why: `${cap(tied[0])} has the most cards showing (${max}).` };
    const top = Math.max(...tied.map(s => high[s]));
    const t2 = tied.filter(s => high[s] === top);
    if (t2.length === 1) return { trump: t2[0], why: `${tied.map(cap).join(" and ")} tie with ${max} each. ${cap(t2[0])} has the highest card (${top}).` };
    return { trump: null, why: `${t2.map(cap).join(" and ")} tie on count and highest card, so there is no trump this round.` };
  }
  // highest black face-up; else highest face-up of any colour; ties random
  function firstLeader(players, rng) {
    const ups = [];
    players.forEach((p, i) => p.hand.forEach(c => c.up && ups.push({ i, c })));
    let pool = ups.filter(u => u.c.s === "black"), why = "highest snake showing";
    if (!pool.length) { pool = ups; why = "highest card showing (no snakes showing)"; }
    const top = Math.max(...pool.map(u => u.c.n));
    const t = pool.filter(u => u.c.n === top);
    const pick = t[Math.floor(rng() * t.length)];
    return { p: pick.i, card: pick.c, why: t.length > 1 ? why + ", tie broken at random" : why };
  }
  const cap = s => s[0].toUpperCase() + s.slice(1);
  const name = c => `${cap(c.s)} ${c.n}`;

  // ---------------- computer player ----------------
  // chance a card wins a trick, judged from the cards still out there
  function winProb(g, p, c, trump) {
    const hi = RANGE[g.n][1], played = new Set((g.played || []).map(x => x.id));
    const mine = new Set(g.players[p].hand.map(x => x.id));
    let higher = 0;
    for (let v = c.n + 1; v <= hi; v++) { const id = c.s + v; if (!played.has(id) && !mine.has(id)) higher++; }
    const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
    if (trump && c.s === trump) return clamp(1 - 0.3 * higher, 0.03, 0.97);
    let w = clamp(1 - 0.32 * higher, 0.02, 0.95);
    if (trump) w *= Math.max(0.35, 1 - 0.07 * (g.n - 1));
    return w;
  }
  const tricksLeft = g => (g.phase === "play" || g.phase === "flip") ? 9 - g.trickNo : 8;
  const Bot = {
    scale: { 2: 1, 3: 0.8, 4: 0.65, 5: 0.6, 6: 0.5 }, // how confident bots are, tuned by simulation
    estimate(g, p, except, trump = g.trump) {
      const pl = g.players[p];
      const raw = pl.hand.filter(c => c !== except).reduce((a, c) => a + winProb(g, p, c, trump), 0);
      return pl.tricks + Math.min(raw * (Bot.scale[g.n] || 1), tricksLeft(g));
    },
    // which showing card to aim for
    goal(g, p) {
      const pl = g.players[p], ups = pl.hand.filter(c => c.up), left = tricksLeft(g);
      let best = null, bs = 1e9;
      for (const c of ups) {
        const est = this.estimate(g, p, c);
        let sc = Math.abs(c.n - est) - (c.s === "black" ? 0.4 : 0);
        if (c.n < pl.tricks || c.n > pl.tricks + left) sc += 50; // already impossible
        if (sc < bs) { bs = sc; best = c; }
      }
      return best;
    },
    // reveal: push a colour we are long in towards trump, and make sure we show a good prediction card
    reveal(g, p) {
      const pl = g.players[p], hidden = pl.hand.filter(c => !c.up), pass = g.revealPass || 0;
      const strength = {};
      for (const c of pl.hand) if (c.s !== "black") strength[c.s] = (strength[c.s] || 0) + 1 + c.n / 10;
      const fav = Object.keys(strength).sort((a, b) => strength[b] - strength[a])[0];
      const table = {};
      g.players.forEach(q => q.hand.forEach(c => { if (c.up && c.s !== "black") table[c.s] = (table[c.s] || 0) + 1; }));
      const favCount = table[fav] || 0, maxOther = Math.max(0, ...Object.keys(table).filter(s => s !== fav).map(s => table[s]));
      const favAlive = pass < 2 || favCount + 1 >= maxOther;
      const est = Math.min(8, pl.hand.reduce((a, c) => a + winProb(g, p, c, fav), 0) * (this.scale[g.n] || 1));
      const havePred = pl.hand.some(c => c.up && Math.abs(c.n - est) <= 1);
      const score = c => {
        const d = Math.abs(c.n - est);
        let sc = (c.s === fav && favAlive ? 3 : 0) + (havePred ? 0.6 : 1.6) * Math.max(0, 3 - d);
        if (c.s === "black" && d <= 1) sc += 1;
        if (c.s !== fav && c.s !== "black") sc -= 0.8; // showing other colours helps rivals' trump
        return sc - c.n * 0.01;
      };
      return hidden.reduce((a, b) => (score(b) > score(a) ? b : a));
    },
    flip(g, p) {
      const pl = g.players[p], hidden = pl.hand.filter(c => !c.up);
      const sc = c => Math.abs(c.n - this.estimate(g, p, c)) - (c.s === "black" ? 0.4 : 0) + (c.n < pl.tricks ? 50 : 0);
      return hidden.reduce((a, b) => (sc(b) < sc(a) ? b : a));
    },
    play(g, p, legal) {
      const pl = g.players[p], goal = this.goal(g, p);
      let pool = legal.filter(c => c !== goal);
      if (!pool.length) pool = legal;
      const need = (goal ? goal.n : 0) - pl.tricks;
      const want = need > 0;
      const wp = c => winProb(g, p, c, g.trump);
      if (!g.trick.length) {
        return want ? pool.reduce((a, b) => (wp(b) > wp(a) ? b : a)) : pool.reduce((a, b) => (wp(b) < wp(a) || (wp(b) === wp(a) && b.n < a.n) ? b : a));
      }
      const wins = c => { const t = g.trick.concat([{ p, card: c }]); return t[trickWinnerIdx(t, g.trump)].p === p; };
      const winners = pool.filter(wins), losers = pool.filter(c => !wins(c));
      const last = g.trick.length === g.n - 1;
      if (want) {
        if (winners.length) return last ? winners.reduce((a, b) => (b.n < a.n ? b : a)) : winners.reduce((a, b) => (wp(b) > wp(a) ? b : a));
        return losers.reduce((a, b) => (wp(b) < wp(a) ? b : a));
      }
      // on target or over: dump the most dangerous card that still loses this trick
      if (losers.length) return losers.reduce((a, b) => (wp(b) > wp(a) || (wp(b) === wp(a) && b.n > a.n) ? b : a));
      return winners.reduce((a, b) => (b.n < a.n ? b : a));
    },
    steal(g, p, targets) {
      const pts = i => g.players[i].dfly + 3 * g.players[i].frogs;
      return targets.reduce((a, b) => (pts(b) > pts(a) ? b : a));
    },
  };

  // ---------------- game ----------------
  class Game {
    constructor(names, agents, hooks = {}, rng = Math.random) {
      this.n = names.length; this.rng = rng; this.agents = agents; this.hooks = hooks;
      this.players = names.map(nm => ({ name: nm, hand: [], tricks: 0, frogs: 1, dfly: 0, history: [] }));
      this.dealer = Math.floor(rng() * this.n); this.round = 0; this.trump = null;
      this.trick = []; this.trickNo = 0; this.phase = "setup"; this.turn = null; this.leader = null;
      this.buried = 0; this.lastTrick = null;
    }
    async ev(type, data) { if (this.hooks.event) await this.hooks.event(type, data || {}); }
    points(i) { const p = this.players[i]; return p.dfly + 3 * p.frogs; }
    async run() {
      for (this.round = 1; this.round <= ROUNDS; this.round++) {
        await this.playRound();
        this.dealer = (this.dealer + 1) % this.n;
      }
      this.phase = "over";
      const order = this.players.map((_, i) => i).sort((a, b) => this.points(b) - this.points(a) || this.players[b].frogs - this.players[a].frogs);
      const top = order[0];
      const winners = order.filter(i => this.points(i) === this.points(top) && this.players[i].frogs === this.players[top].frogs);
      await this.ev("gameover", { order, winners });
      return { order, winners };
    }
    async playRound() {
      const n = this.n;
      const deck = shuffle(buildDeck(n), this.rng);
      this.players.forEach(p => { p.hand = deck.splice(0, HAND); p.tricks = 0; });
      this.buried = deck.length; this.played = []; this.trump = null; this.trick = []; this.trickNo = 0; this.lastTrick = null;
      this.phase = "reveal";
      await this.ev("deal", { buried: this.buried });
      // simultaneous reveal: everyone picks secretly, then all flip together. Three times.
      for (let pass = 0; pass < 3; pass++) {
        this.revealPass = pass; this.turn = null;
        await this.ev("revealstart", { pass });
        const picks = await Promise.all(this.players.map((_, p) => this.agents[p].reveal(this, p)));
        picks.forEach(c => { c.up = true; });
        await this.ev("revealall", { pass, picks });
      }
      const t = pickTrump(this.players); this.trump = t.trump;
      await this.ev("trump", t);
      const fl = firstLeader(this.players, this.rng); this.leader = fl.p;
      await this.ev("firstlead", fl);
      this.phase = "play";
      for (this.trickNo = 1; this.trickNo <= TRICKS; this.trickNo++) {
        this.trick = [];
        for (let k = 0; k < n; k++) {
          const p = (this.leader + k) % n; this.turn = p;
          const pl = this.players[p], legal = legalCards(pl.hand, this.trick);
          await this.ev("turn", { p, kind: "play", legal });
          const c = await this.agents[p].play(this, p, legal);
          if (!legal.includes(c)) throw new Error("illegal play " + name(c));
          pl.hand.splice(pl.hand.indexOf(c), 1);
          this.trick.push({ p, card: c }); this.played.push(c);
          await this.ev("play", { p, card: c });
          if (pl.hand.length && !pl.hand.some(x => x.up)) {
            this.phase = "flip";
            await this.ev("turn", { p, kind: "flip" });
            const f = pl.hand.length === 1 ? pl.hand[0] : await this.agents[p].flip(this, p);
            f.up = true; this.phase = "play";
            await this.ev("flip", { p, card: f });
          }
        }
        const w = this.trick[trickWinnerIdx(this.trick, this.trump)];
        const nl = nextLeader(this.trick, this.trump);
        this.players[w.p].tricks++;
        this.turn = null;
        await this.ev("trickwon", { p: w.p, card: w.card, next: nl, stolen: nl !== w.p });
        this.lastTrick = this.trick; this.leader = nl;
      }
      this.trick = []; this.phase = "score";
      const results = this.players.map((pl, i) => {
        const last = pl.hand[0], hit = pl.tricks === last.n;
        pl.dfly += pl.tricks;
        // hit with a coloured card: take a new frog. Hit with a snake: steal a frog instead (no new frog).
        if (hit && last.s !== "black") pl.frogs++;
        return { i, last, tricks: pl.tricks, hit, steal: hit && last.s === "black", stoleFrom: null };
      });
      for (const r of results) if (r.steal) {
        const targets = this.players.map((_, i) => i).filter(i => i !== r.i && this.players[i].frogs > 0);
        if (!targets.length) { this.players[r.i].frogs++; r.fromSupply = true; await this.ev("steal", { p: r.i, from: null }); continue; } // nobody has a frog: take one from the supply
        const v = targets.length === 1 ? targets[0] : await this.agents[r.i].steal(this, r.i, targets);
        this.players[v].frogs--; this.players[r.i].frogs++; r.stoleFrom = v;
        await this.ev("steal", { p: r.i, from: v });
      }
      results.forEach(r => this.players[r.i].history.push(r));
      await this.ev("roundover", { results });
    }
  }
  root.Snaked = { Game, Bot, legalCards, trickWinnerIdx, nextLeader, pickTrump, firstLeader, buildDeck, RANGE, SUITS, name, cap };
})(typeof window !== "undefined" ? window : globalThis);
