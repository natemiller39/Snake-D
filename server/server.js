// SNAKE'D online game server.
// Holds rooms, runs the shared rules engine, and sends each player only what they are allowed to see.
const http = require("http");
const path = require("path");
const { WebSocketServer } = require("ws");
require(path.join(__dirname, "..", "engine.js"));
const { Game, Bot } = globalThis.Snaked;

const PORT = process.env.PORT || 8787;
const BOT_NAMES = ["Moss", "Tadpole", "Fern", "Lily", "Croak", "Reed"];
const ASK_TIMEOUT_MS = 75000;     // a player who doesn't move in time gets a computer move
const READY_TIMEOUT_MS = 30000;   // round summary wait
const ROOM_IDLE_MS = 2 * 60 * 60 * 1000;
// pause after each event so everyone's animations keep up (kept a little shorter than the page's own timings)
const PACE = { deal: 1100, revealstart: 450, revealall: 2200, trump: 4000, firstlead: 1800, play: 350, flip: 850, steal: 1000 };

const rooms = new Map();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const code4 = () => { const A = "ABCDEFGHJKLMNPQRSTUVWXYZ"; let c; do { c = [...Array(4)].map(() => A[Math.floor(Math.random() * A.length)]).join(""); } while (rooms.has(c)); return c; };
const token = () => Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
const clean = s => String(s || "").replace(/[<>&"]/g, "").trim().slice(0, 14) || "Player";

function send(ws, msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }

// ---------- what each seat may see ----------
function rot(i, seat, n) { return i == null ? i : (i - seat + n) % n; }
function viewState(g, seat) {
  const n = g.n;
  const players = [];
  for (let k = 0; k < n; k++) {
    const j = (k + seat) % n, p = g.players[j];
    const hand = p.hand.map((c, x) => (j === seat || c.up) ? { id: c.id, s: c.s, n: c.n, up: c.up } : { id: `h${k}_${x}`, s: null, n: null, up: false });
    players.push({ name: p.name, tricks: p.tricks, frogs: p.frogs, dfly: p.dfly, hand });
  }
  return {
    n, players, round: g.round, dealer: rot(g.dealer, seat, n), trump: g.trump, trickNo: g.trickNo, phase: g.phase,
    turn: rot(g.turn, seat, n), leader: rot(g.leader, seat, n), buried: g.buried, revealPass: g.revealPass,
    trick: g.trick.map(t => ({ p: rot(t.p, seat, n), card: t.card })),
  };
}
function viewEvent(type, d, seat, n) {
  const R = i => rot(i, seat, n);
  switch (type) {
    case "revealall": { const picks = []; d.picks.forEach((c, i) => { picks[R(i)] = c; }); return { pass: d.pass, picks }; }
    case "firstlead": return { ...d, p: R(d.p) };
    case "turn": return { p: R(d.p), kind: d.kind, pass: d.pass };
    case "play": case "flip": return { p: R(d.p), card: d.card };
    case "trickwon": return { p: R(d.p), card: d.card, next: R(d.next), stolen: d.stolen };
    case "steal": return { p: R(d.p), from: d.from == null ? null : R(d.from) };
    case "roundover": return { results: d.results.map(r => ({ ...r, i: R(r.i), stoleFrom: r.stoleFrom == null ? null : R(r.stoleFrom) })) };
    case "gameover": return { order: d.order.map(R), winners: d.winners.map(R) };
    default: return d;
  }
}

// ---------- rooms ----------
function lobbyMsg(room, seat) {
  return {
    t: "lobby", code: room.code, size: room.size, state: room.state, you: seat, host: room.host,
    players: room.seats.map((s, i) => ({ name: s.name, connected: !!s.ws, host: i === room.host, bot: !!s.bot })),
  };
}
function broadcastLobby(room) { room.seats.forEach((s, i) => send(s.ws, lobbyMsg(room, i))); }
function touch(room) { room.lastActive = Date.now(); }

function remoteAgent(room, seat) {
  const ask = (kind, extra, fallback) => new Promise(resolve => {
    const s = room.seats[seat];
    const done = v => { const p = room.pending.get(seat); if (!p || p.done) return; p.done = true; clearTimeout(p.timer); room.pending.delete(seat); resolve(v); };
    const p = { kind, extra, fallback, done: false, resolve: done };
    room.pending.set(seat, p);
    p.timer = setTimeout(() => done(fallback()), s.ws ? ASK_TIMEOUT_MS : 1500);
    sendAsk(room, seat);
  });
  return {
    reveal: (g, p) => ask("reveal", { ids: g.players[p].hand.filter(c => !c.up).map(c => c.id), pass: g.revealPass }, () => Bot.reveal(g, p)),
    play: (g, p, legal) => ask("play", { ids: legal.map(c => c.id) }, () => Bot.play(g, p, legal)),
    flip: (g, p) => ask("flip", { ids: g.players[p].hand.filter(c => !c.up).map(c => c.id) }, () => Bot.flip(g, p)),
    steal: (g, p, targets) => ask("steal", { targets }, () => Bot.steal(g, p, targets)),
  };
}
function sendAsk(room, seat) {
  const p = room.pending.get(seat); if (!p) return;
  const n = room.game.n, e = p.extra;
  send(room.seats[seat].ws, { t: "ask", kind: p.kind, ids: e.ids, pass: e.pass, targets: e.targets && e.targets.map(i => rot(i, seat, n)) });
}
function answer(room, seat, msg) {
  const p = room.pending.get(seat); if (!p || !room.game) return;
  const g = room.game, hand = g.players[seat].hand;
  if (p.kind === "steal") {
    const target = (Number(msg.target) + seat) % g.n;
    if (p.extra.targets.includes(target)) p.resolve(target);
    return;
  }
  if (!p.extra.ids.includes(msg.id)) return;
  const c = hand.find(x => x.id === msg.id);
  if (c) p.resolve(c);
}

async function runGame(room) {
  room.state = "playing"; room.pending = new Map(); room.ready = null;
  const n = room.size;
  // fill empty seats with computer players
  const used = new Set(room.seats.map(s => s.name));
  const names = BOT_NAMES.filter(b => !used.has(b));
  while (room.seats.length < n) room.seats.push({ name: names.shift() || "Bot", bot: true, ws: null, token: null });
  broadcastLobby(room);
  const agents = room.seats.map((s, i) => s.bot ? Bot : remoteAgent(room, i));
  const gameId = (room.gameId = (room.gameId || 0) + 1);
  const humans = () => room.seats.map((s, i) => [s, i]).filter(([s]) => !s.bot);
  const g = new Game(room.seats.map(s => s.name), agents, {
    event: async (type, d) => {
      if (room.gameId !== gameId) throw new Error("stale");
      touch(room);
      for (const [s, i] of humans()) send(s.ws, { t: "ev", ev: type, data: viewEvent(type, d, i, g.n), state: viewState(g, i) });
      if (type === "turn") { if (room.seats[d.p].bot) await sleep(650); return; }
      if (type === "trickwon") { await sleep(d.stolen ? 3300 : 2600); return; }
      if (type === "roundover") {
        // wait until every connected player closes the round summary (or time runs out)
        room.ready = new Set();
        const start = Date.now();
        while (Date.now() - start < READY_TIMEOUT_MS && humans().some(([s, i]) => s.ws && !room.ready.has(i))) await sleep(250);
        room.ready = null; return;
      }
      if (PACE[type]) await sleep(PACE[type]);
    },
  });
  room.game = g;
  try { await g.run(); } catch (e) { if (e.message !== "stale") console.error(e); return; }
  if (room.gameId === gameId) { room.state = "over"; broadcastLobby(room); }
}

function resetToLobby(room) {
  room.gameId = (room.gameId || 0) + 1; // stops any running game
  for (const p of (room.pending || new Map()).values()) clearTimeout(p.timer);
  room.pending = new Map(); room.game = null; room.state = "lobby";
  room.seats = room.seats.filter(s => !s.bot && (s.ws || s.token));
}

// ---------- connections ----------
const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/plain", "access-control-allow-origin": "*" });
  res.end(`Snake'd server is running. ${rooms.size} room(s) open.`);
});
const wss = new WebSocketServer({ server });

wss.on("connection", ws => {
  let room = null, seat = -1;
  ws.on("message", raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === "ping") return send(ws, { t: "pong" });
    if (m.t === "create") {
      const code = code4();
      room = { code, size: Math.min(6, Math.max(2, Number(m.size) || 4)), seats: [], host: 0, state: "lobby", pending: new Map() };
      rooms.set(code, room);
      const tk = token(); room.seats.push({ name: clean(m.name), token: tk, ws });
      seat = 0; touch(room);
      send(ws, { t: "joined", code, seat, token: tk });
      return broadcastLobby(room);
    }
    if (m.t === "join") {
      const r = rooms.get(String(m.code || "").toUpperCase().trim());
      if (!r) return send(ws, { t: "error", msg: "No game with that code. Check the code and try again." });
      // rejoining an existing seat
      const old = m.token ? r.seats.findIndex(s => s.token && s.token === m.token) : -1;
      if (old >= 0) {
        room = r; seat = old; const s = r.seats[old];
        if (s.ws && s.ws !== ws) try { s.ws.close(); } catch { }
        s.ws = ws; touch(r);
        send(ws, { t: "joined", code: r.code, seat, token: s.token });
        broadcastLobby(r);
        if (r.game && r.state === "playing") { send(ws, { t: "sync", state: viewState(r.game, seat) }); sendAsk(r, seat); }
        return;
      }
      if (r.state !== "lobby") return send(ws, { t: "error", msg: "That game has already started." });
      if (r.seats.length >= r.size) return send(ws, { t: "error", msg: "That table is full." });
      room = r; const tk = token(); r.seats.push({ name: clean(m.name), token: tk, ws }); seat = r.seats.length - 1; touch(r);
      send(ws, { t: "joined", code: r.code, seat, token: tk });
      return broadcastLobby(r);
    }
    if (!room) return;
    touch(room);
    const isHost = seat === room.host;
    if (m.t === "size" && isHost && room.state === "lobby") { room.size = Math.min(6, Math.max(room.seats.length, 2, Number(m.size) || 2)); return broadcastLobby(room); }
    if (m.t === "start" && isHost && room.state === "lobby") { runGame(room); return; }
    if (m.t === "again" && isHost && room.state !== "lobby") { resetToLobby(room); broadcastLobby(room); runGame(room); return; }
    if (m.t === "lobby" && isHost) { resetToLobby(room); return broadcastLobby(room); }
    if (m.t === "answer") return answer(room, seat, m);
    if (m.t === "ready" && room.ready) { room.ready.add(seat); return; }
    if (m.t === "leave") {
      const s = room.seats[seat];
      if (room.state === "lobby") { room.seats.splice(seat, 1); if (room.host >= room.seats.length) room.host = 0; }
      else if (s) { s.ws = null; s.token = null; s.bot = true; const p = room.pending.get(seat); if (p) p.resolve(p.fallback()); }
      room.seats.forEach((x, i) => { if (x.ws === ws) x.ws = null; });
      broadcastLobby(room); room = null; seat = -1;
    }
  });
  ws.on("close", () => {
    if (!room) return;
    const s = room.seats[seat];
    if (s && s.ws === ws) {
      s.ws = null;
      // a disconnected player's pending move is made by the computer shortly after
      const p = room.pending.get(seat);
      if (p) { clearTimeout(p.timer); p.timer = setTimeout(() => p.resolve(p.fallback()), 20000); }
      if (room.state === "lobby" && !room.seats.some(x => x.ws)) rooms.delete(room.code);
      else broadcastLobby(room);
    }
  });
});

// keep idle connections alive and clear out abandoned rooms
setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) if (now - (r.lastActive || 0) > ROOM_IDLE_MS && !r.seats.some(s => s.ws)) { resetToLobby(r); rooms.delete(code); }
}, 60000);

server.listen(PORT, () => console.log(`Snake'd server listening on ${PORT}`));
