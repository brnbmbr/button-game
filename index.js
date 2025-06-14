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

// In-memory store for active lobbies
const lobbies = {};

io.on("connection", (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Create lobby
  socket.on("createLobby", ({ keyphrase, nickname }) => {
    lobbies[keyphrase] = {
      host: socket.id,
      players: [{ id: socket.id, nickname }],
      config: null,
      picks: {},
      prizeMap: {},
      leaderboard: {},
      clicked: new Set()
    };
    socket.join(keyphrase);
    io.to(keyphrase).emit("joined", { players: lobbies[keyphrase].players });
  });

  // Join lobby
  socket.on("joinLobby", ({ keyphrase, nickname, entryKey }) => {
    const lobby = lobbies[keyphrase];
    if (!lobby) return;
    lobby.players.push({ id: socket.id, nickname, entryKey });
    socket.join(keyphrase);
    io.to(keyphrase).emit("joined", { players: lobby.players });
  });

  // Start game
  socket.on("startGame", ({ keyphrase, config }) => {
    const lobby = lobbies[keyphrase];
    if (!lobby || socket.id !== lobby.host) return;

    lobby.config = config;

    // Randomly assign prize buttons
    const totalButtons = 99;
    const buttons = [...Array(totalButtons).keys()].map((i) => i + 1);
    buttons.sort(() => Math.random() - 0.5);

    const prizeMap = {};
    let i = 0;

    for (const prize of config.grandPrizes) {
      prizeMap[buttons[i++]] = { type: "grand", value: prize, code: uuidv4() };
    }

    for (const prize of config.consolationPrizes) {
      prizeMap[buttons[i++]] = { type: "consolation", value: prize, code: uuidv4() };
    }

    lobby.prizeMap = prizeMap;

    // Assign picks
    lobby.picks = {};
    for (const p of lobby.players) {
      if (!config.hostIsPlayer && p.id === lobby.host) continue;
      lobby.picks[p.nickname] = config.picks;
    }

    io.to(keyphrase).emit("updateRemainingPicks", lobby.picks);
    io.to(keyphrase).emit("startCountdown");
  });

  // Player picks a button
  socket.on("pickButton", ({ keyphrase, button, nickname }) => {
    const lobby = lobbies[keyphrase];
    if (!lobby || lobby.clicked.has(button)) return;

    const picksRemaining = lobby.picks[nickname];
    if (picksRemaining === undefined || picksRemaining <= 0) return;

    // Decrement pick count
    lobby.picks[nickname] -= 1;
    lobby.clicked.add(button);
    io.to(keyphrase).emit("boardUpdate", { buttonNumber: button });
    io.to(keyphrase).emit("updateRemainingPicks", lobby.picks);

    const prize = lobby.prizeMap[button];

    if (prize) {
      // Update leaderboard
      lobby.leaderboard[nickname] = prize.value;
      io.to(keyphrase).emit("leaderboardUpdate", lobby.leaderboard);

      // Notify winner
      io.to(socket.id).emit("prizeWon", {
        message: prize.type === "grand"
          ? `GRAND PRIZE! You've won ${prize.value}`
          : `You won a booby prize! Please enjoy ${prize.value}.`,
        code: prize.code
      });
    } else {
      const tries = lobby.picks[nickname];
      const message =
        tries > 0
          ? `Sorry, Better Luck Next Time! You still have ${tries} more tries!`
          : `Sorry, Better Luck Next Time! You're out of tries.`;
      io.to(socket.id).emit("prizeWon", { message });
    }
  });

  // Disconnect handler
  socket.on("disconnect", () => {
    for (const key in lobbies) {
      const lobby = lobbies[key];
      const idx = lobby.players.findIndex((p) => p.id === socket.id);
      if (idx !== -1) {
        const playerName = lobby.players[idx].nickname;
        lobby.players.splice(idx, 1);
        delete lobby.picks[playerName];
        delete lobby.leaderboard[playerName];

        if (lobby.players.length === 0 || lobby.host === socket.id) {
          delete lobbies[key];
        } else {
          io.to(key).emit("joined", { players: lobby.players });
        }
        break;
      }
    }
  });
});

// Launch server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
