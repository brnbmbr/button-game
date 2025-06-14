// ================================
// BACKEND: Button Game (Express + Socket.IO)
// ================================
// Features:
// - Game state management, prize assignment, player pick tracking
// - Real-time updates via Socket.IO
// - Tracks picks remaining per player, unique prize keys

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const lobbies = {};

io.on("connection", (socket) => {
  console.log(`Connected: ${socket.id}`);

  socket.on("createLobby", ({ keyphrase, nickname }) => {
    lobbies[keyphrase] = {
      host: socket.id,
      hostNickname: nickname,
      config: null,
      players: {},
      buttons: {},
      remainingPicks: {},
      leaderboard: {},
    };
    lobbies[keyphrase].players[socket.id] = { id: socket.id, nickname };
    socket.join(keyphrase);
    io.to(keyphrase).emit("joined", { players: Object.values(lobbies[keyphrase].players) });
  });

  socket.on("joinLobby", ({ keyphrase, nickname }) => {
    const lobby = lobbies[keyphrase];
    if (!lobby || lobby.config?.started) return;
    lobby.players[socket.id] = { id: socket.id, nickname };
    socket.join(keyphrase);
    io.to(keyphrase).emit("joined", { players: Object.values(lobby.players) });
  });

  socket.on("startGame", ({ keyphrase, config }) => {
    const lobby = lobbies[keyphrase];
    if (!lobby || lobby.host !== socket.id) return;
    config.started = true;
    lobby.config = config;

    const totalButtons = 99;
    const allButtons = Array.from({ length: totalButtons }, (_, i) => i + 1);
    const shuffle = (arr) => arr.sort(() => 0.5 - Math.random());
    const randomized = shuffle([...allButtons]);

    lobby.grandPrizeMap = {};
    lobby.consolationMap = {};

    config.grandPrizes.forEach((prize) => {
      const btn = randomized.pop();
      const code = uuidv4();
      lobby.grandPrizeMap[btn] = { prize, code };
    });

    config.consolationPrizes.forEach((prize) => {
      const btn = randomized.pop();
      const code = uuidv4();
      lobby.consolationMap[btn] = { prize, code };
    });

    Object.entries(lobby.players).forEach(([id, player]) => {
      const isHost = id === lobby.host;
      lobby.remainingPicks[id] = (isHost && !config.hostIsPlayer) ? 0 : config.picks;
    });

    io.to(keyphrase).emit("updateRemainingPicks", formatRemainingPicks(lobby));
    io.to(keyphrase).emit("startCountdown");
  });

  socket.on("pickButton", ({ keyphrase, button }) => {
    const lobby = lobbies[keyphrase];
    if (!lobby || !lobby.config) return;

    const playerId = socket.id;
    if (lobby.remainingPicks[playerId] <= 0) return;
    if (!lobby.config.allowDuplicates && lobby.buttons[button]) return;

    lobby.remainingPicks[playerId] -= 1;
    lobby.buttons[button] = true;

    const nickname = lobby.players[playerId]?.nickname || "Unknown Player";
    const send = (msg, code = null) => io.to(playerId).emit("prizeWon", { message: msg, code });

    let resultMsg = "Sorry, Better Luck Next Time!";

    if (lobby.grandPrizeMap[button]) {
      const { prize, code } = lobby.grandPrizeMap[button];
      resultMsg = `🎉 GRAND PRIZE! You've Won ${prize}!`;
      lobby.leaderboard[nickname] = prize;
      delete lobby.grandPrizeMap[button];
      send(resultMsg, code);
    } else if (lobby.consolationMap[button]) {
      const { prize, code } = lobby.consolationMap[button];
      resultMsg = `You won a booby prize! Please enjoy ${prize}!`;
      lobby.leaderboard[nickname] = prize;
      delete lobby.consolationMap[button];
      send(resultMsg, code);
    } else {
      send(`${resultMsg} You still have ${lobby.remainingPicks[playerId]} more tries!`);
    }

    io.to(keyphrase).emit("boardUpdate", { buttonNumber: button });
    io.to(keyphrase).emit("updateRemainingPicks", formatRemainingPicks(lobby));
    io.to(keyphrase).emit("leaderboardUpdate", lobby.leaderboard);
  });

  socket.on("disconnect", () => {
    for (const key in lobbies) {
      const lobby = lobbies[key];
      if (lobby.players[socket.id]) {
        delete lobby.players[socket.id];
        io.to(key).emit("joined", { players: Object.values(lobby.players) });
        if (Object.keys(lobby.players).length === 0) delete lobbies[key];
        break;
      }
    }
  });
});

function formatRemainingPicks(lobby) {
  const out = {};
  for (const id in lobby.players) {
    const nickname = lobby.players[id].nickname;
    out[nickname] = lobby.remainingPicks[id] ?? 0;
  }
  return out;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server on ${PORT}`));
