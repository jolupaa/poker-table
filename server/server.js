import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Serve the client as static files (so you can open from any phone via http://SERVER_IP:3000)
const clientDir = path.join(__dirname, "..", "client");
app.use(express.static(clientDir));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

const ADMIN_NAME = "jolupa";

// Table state (in-memory)
const state = {
  config: {
    betLimit: 50,      // cap per bet/raise action (increment cap)
    initialStack: 500, // initial stack for each player at join (and on reset)
    smallBlind: 5,     // big blind = 2 * smallBlind
  },
  hand: {
    inProgress: false,
    dealerIndex: -1,
    smallBlindIndex: -1,
    bigBlindIndex: -1,
    turnIndex: -1,

    pot: 0,
    currentBet: 0,
    lastAggressorIndex: -1,
    roundClosed: false,
  },
  players: [], // { id, name, stack, inHand, betThisRound, hasActed }
};

// Helpers
function sanitizeName(name) {
  return String(name || "")
    .trim()
    .slice(0, 16)
    .replace(/\s+/g, " ");
}

function playerPublic(p) {
  return {
    id: p.id,
    name: p.name,
    stack: p.stack,
    inHand: p.inHand,
    betThisRound: p.betThisRound,
    hasActed: p.hasActed,
  };
}

function broadcast() {
  io.emit("state", {
    config: state.config,
    hand: state.hand,
    players: state.players.map(playerPublic),
  });
}

function getPlayerIndexById(id) {
  return state.players.findIndex((p) => p.id === id);
}

function isAdminSocket(socket) {
  const idx = getPlayerIndexById(socket.id);
  if (idx < 0) return false;
  return state.players[idx].name.toLowerCase() === ADMIN_NAME;
}

function nextInHandIndex(fromIdx) {
  const n = state.players.length;
  if (n === 0) return -1;
  for (let step = 1; step <= n; step++) {
    const j = (fromIdx + step) % n;
    if (state.players[j].inHand) return j;
  }
  return -1;
}

function countInHand() {
  return state.players.filter((p) => p.inHand).length;
}

function resetRoundFlags() {
  for (const p of state.players) {
    p.betThisRound = 0;
    p.hasActed = false;
  }
}

function resetHandState() {
  state.hand.inProgress = false;
  state.hand.smallBlindIndex = -1;
  state.hand.bigBlindIndex = -1;
  state.hand.turnIndex = -1;
  state.hand.pot = 0;
  state.hand.currentBet = 0;
  state.hand.lastAggressorIndex = -1;
  state.hand.roundClosed = false;
  resetRoundFlags();
}

function canStartHand() {
  return state.players.length >= 2;
}

function postBlind(playerIndex, amount) {
  const p = state.players[playerIndex];
  const pay = Math.min(p.stack, amount);
  p.stack -= pay;
  p.betThisRound += pay;
  state.hand.pot += pay;
}

function startHand() {
  if (!canStartHand()) return { ok: false, error: "Necesitas al menos 2 jugadores." };

  // Everyone is in the hand (you can adapt if you want to sit-out players)
  for (const p of state.players) {
    p.inHand = true;
  }

  // Rotate dealer
  state.hand.dealerIndex = (state.hand.dealerIndex + 1) % state.players.length;

  // Determine blinds
  const sb = nextInHandIndex(state.hand.dealerIndex);
  const bb = sb >= 0 ? nextInHandIndex(sb) : -1;

  state.hand.smallBlindIndex = sb;
  state.hand.bigBlindIndex = bb;

  // Reset betting round
  state.hand.inProgress = true;
  state.hand.pot = 0;
  state.hand.currentBet = 0;
  state.hand.lastAggressorIndex = -1;
  state.hand.roundClosed = false;
  resetRoundFlags();

  // Post blinds
  if (sb >= 0) postBlind(sb, state.config.smallBlind);
  if (bb >= 0) postBlind(bb, state.config.smallBlind * 2);

  // Current bet equals BB
  state.hand.currentBet = Math.max(
    state.players[sb]?.betThisRound || 0,
    state.players[bb]?.betThisRound || 0
  );

  // First turn: left of BB
  state.hand.turnIndex = bb >= 0 ? nextInHandIndex(bb) : -1;

  return { ok: true };
}

function endHand(winnerIndex) {
  if (winnerIndex < 0 || winnerIndex >= state.players.length) return { ok: false, error: "Ganador inválido." };
  const w = state.players[winnerIndex];
  w.stack += state.hand.pot;
  resetHandState();
  return { ok: true };
}

function closeBettingRoundIfNeeded() {
  // Betting round is closed if everyone still in hand has matched currentBet (or is all-in with stack 0)
  // and has acted since last aggression.
  const inHandIdx = state.players
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.inHand)
    .map(({ i }) => i);

  if (inHandIdx.length <= 1) return;

  for (const i of inHandIdx) {
    const p = state.players[i];
    const matched = p.betThisRound === state.hand.currentBet || p.stack === 0;
    if (!matched) return;

    // Everyone must act, except the last aggressor (they already acted by raising)
    if (!p.hasActed && i !== state.hand.lastAggressorIndex) return;
  }
  state.hand.roundClosed = true;
}

function advanceTurn() {
  if (!state.hand.inProgress) return;

  if (countInHand() <= 1) {
    state.hand.turnIndex = -1;
    return;
  }

  closeBettingRoundIfNeeded();
  if (state.hand.roundClosed) {
    state.hand.turnIndex = -1; // waiting for admin to end hand or continue outside system
    return;
  }

  state.hand.turnIndex = nextInHandIndex(state.hand.turnIndex);
}

function assertTurn(socket) {
  const idx = getPlayerIndexById(socket.id);
  if (idx < 0) return { ok: false, error: "No estás en la mesa." };
  if (!state.hand.inProgress) return { ok: false, error: "No hay mano en progreso." };
  if (state.hand.turnIndex !== idx) return { ok: false, error: "No es tu turno." };
  const p = state.players[idx];
  if (!p.inHand) return { ok: false, error: "Estás foldeado." };
  return { ok: true, idx, player: p };
}

function fold(idx) {
  state.players[idx].inHand = false;
  state.players[idx].hasActed = true;

  if (countInHand() <= 1) state.hand.turnIndex = -1;
}

function checkOrCall(idx) {
  const p = state.players[idx];
  const needed = Math.max(0, state.hand.currentBet - p.betThisRound);
  const pay = Math.min(p.stack, needed);
  p.stack -= pay;
  p.betThisRound += pay;
  state.hand.pot += pay;
  p.hasActed = true;
}

function betOrRaise(idx, targetTotalBetThisRound) {
  const p = state.players[idx];

  const minTarget = state.hand.currentBet === 0 ? 1 : state.hand.currentBet + 1;
  if (targetTotalBetThisRound < minTarget) {
    return { ok: false, error: `La apuesta/raise debe ser al menos ${minTarget}.` };
  }

  const increment = state.hand.currentBet === 0
    ? targetTotalBetThisRound
    : (targetTotalBetThisRound - state.hand.currentBet);

  if (increment > state.config.betLimit) {
    return { ok: false, error: `Supera el límite por acción (${state.config.betLimit}).` };
  }

  const needed = Math.max(0, targetTotalBetThisRound - p.betThisRound);
  const pay = Math.min(p.stack, needed);
  p.stack -= pay;
  p.betThisRound += pay;
  state.hand.pot += pay;

  state.hand.currentBet = Math.max(state.hand.currentBet, p.betThisRound);

  if (p.betThisRound === state.hand.currentBet) {
    state.hand.lastAggressorIndex = idx;
    for (let i = 0; i < state.players.length; i++) {
      if (i !== idx && state.players[i].inHand) state.players[i].hasActed = false;
    }
    p.hasActed = true;
    state.hand.roundClosed = false;
  } else {
    p.hasActed = true;
  }

  return { ok: true };
}

// Routes
app.get("/health", (_req, res) => res.json({ ok: true }));

// Socket logic
io.on("connection", (socket) => {
  socket.emit("state", {
    config: state.config,
    hand: state.hand,
    players: state.players.map(playerPublic),
  });

  socket.on("join", ({ name }) => {
    const clean = sanitizeName(name);
    if (!clean) return socket.emit("error_msg", "Nombre inválido.");

    if (state.players.some((p) => p.name.toLowerCase() === clean.toLowerCase())) {
      return socket.emit("error_msg", "Ese nombre ya existe en la mesa.");
    }

    state.players.push({
      id: socket.id,
      name: clean,
      stack: state.config.initialStack,
      inHand: false,
      betThisRound: 0,
      hasActed: false,
    });

    broadcast();
  });

  socket.on("leave", () => {
    const idx = getPlayerIndexById(socket.id);
    if (idx >= 0) {
      if (state.hand.inProgress && state.players[idx].inHand) {
        fold(idx);
      }
      state.players.splice(idx, 1);

      // Simplest safe approach: reset hand if it was running
      if (state.hand.inProgress) resetHandState();
      if (state.players.length === 0) state.hand.dealerIndex = -1;

      broadcast();
    }
  });

  socket.on("admin_set_config", (cfg) => {
    if (!isAdminSocket(socket)) return socket.emit("error_msg", "Solo jolupa puede configurar.");

    const betLimit = Number(cfg?.betLimit);
    const initialStack = Number(cfg?.initialStack);
    const smallBlind = Number(cfg?.smallBlind);

    if (![betLimit, initialStack, smallBlind].every((v) => Number.isFinite(v) && v > 0)) {
      return socket.emit("error_msg", "Config inválida (valores > 0).");
    }

    state.config.betLimit = Math.floor(betLimit);
    state.config.initialStack = Math.floor(initialStack);
    state.config.smallBlind = Math.floor(smallBlind);

    broadcast();
  });

  socket.on("admin_reset_table", () => {
    if (!isAdminSocket(socket)) return socket.emit("error_msg", "Solo jolupa puede resetear.");
    resetHandState();
    for (const p of state.players) {
      p.stack = state.config.initialStack;
      p.inHand = false;
      p.betThisRound = 0;
      p.hasActed = false;
    }
    state.hand.dealerIndex = -1;
    broadcast();
  });

  socket.on("admin_start_hand", () => {
    if (!isAdminSocket(socket)) return socket.emit("error_msg", "Solo jolupa puede iniciar mano.");
    if (state.hand.inProgress) return socket.emit("error_msg", "Ya hay una mano en progreso.");

    const r = startHand();
    if (!r.ok) return socket.emit("error_msg", r.error);
    broadcast();
  });

  socket.on("admin_end_hand_award", ({ winnerId }) => {
    if (!isAdminSocket(socket)) return socket.emit("error_msg", "Solo jolupa puede asignar ganador.");
    if (!state.hand.inProgress) return socket.emit("error_msg", "No hay mano en progreso.");
    const wIdx = state.players.findIndex((p) => p.id === winnerId);
    const r = endHand(wIdx);
    if (!r.ok) return socket.emit("error_msg", r.error);
    broadcast();
  });

  socket.on("action_fold", () => {
    const a = assertTurn(socket);
    if (!a.ok) return socket.emit("error_msg", a.error);
    fold(a.idx);
    advanceTurn();
    broadcast();
  });

  socket.on("action_check_call", () => {
    const a = assertTurn(socket);
    if (!a.ok) return socket.emit("error_msg", a.error);
    checkOrCall(a.idx);
    advanceTurn();
    broadcast();
  });

  socket.on("action_bet_raise", ({ targetTotal }) => {
    const a = assertTurn(socket);
    if (!a.ok) return socket.emit("error_msg", a.error);

    const target = Number(targetTotal);
    if (!Number.isFinite(target) || target <= 0) return socket.emit("error_msg", "Cantidad inválida.");

    const r = betOrRaise(a.idx, Math.floor(target));
    if (!r.ok) return socket.emit("error_msg", r.error);

    advanceTurn();
    broadcast();
  });

  socket.on("disconnect", () => {
    const idx = getPlayerIndexById(socket.id);
    if (idx >= 0) {
      if (state.hand.inProgress && state.players[idx].inHand) {
        fold(idx);
      }
      state.players.splice(idx, 1);
      if (state.hand.inProgress) resetHandState();
      if (state.players.length === 0) state.hand.dealerIndex = -1;
      broadcast();
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Poker-table server running:`);
  console.log(`- Local:   http://localhost:${PORT}`);
  console.log(`- Network: http://<TU_IP_LOCAL>:${PORT}`);
});
