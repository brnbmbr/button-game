// ================================
// BACKEND: Button Game Logic (Express + Socket.IO)
// ================================
// Features:
// - Lobby creation and joining
// - Secure prize generation and assignment
// - Shared game state for button sync
// - Player pick limits and cooldown
// - Real-time leaderboard updates
// - Unique prize claim codes and post-game audit

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

// In-memory lobbies
const lobbies = {};

io.on("connection", (socket) => {
  console.log(`Connected: ${socket.id}`);

  // Host creates lobby
  socket.on("createLobby", ({ keyphrase, nickname }) => {
    lobbies[keyphrase] = {
      host: socket.id,
      players: [{ id: socket.id, nickname, clicks: 0 }],
      config: null,
      prizes: {},
      pickedButtons: new Set(),
      leaderboard: {},
      prizeCodes: {}
    };
    socket.join(keyphrase);
    io.to(keyphrase).emit("joined", { players: lobbies[keyphrase].players });
    console.log(`Lobby created: ${keyphrase}`);
  });

  // Player joins lobby
  socket.on("joinLobby", ({ keyphrase, nickname, entryKey }) => {
    const lobby = lobbies[keyphrase];
    if (!lobby || lobby.config) return;
    lobby.players.push({ id: socket.id, nickname, clicks: 0, entryKey });
    socket.join(keyphrase);
    io.to(keyphrase).emit("joined", { players: lobby.players });
    console.log(`${nickname} joined ${keyphrase}`);
  });

  // Host starts the game
  socket.on("startGame", ({ keyphrase, config }) => {
    const lobby = lobbies[keyphrase];
    if (!lobby || lobby.host !== socket.id) return;
    lobby.config = config;

    const totalButtons = 99;
    const availableButtons = Array.from({ length: totalButtons }, (_, i) => i + 1);

    const assignPrizes = (prizes) => {
      const assigned = {};
      for (let prize of prizes) {
        const idx = Math.floor(Math.random() * availableButtons.length);
        const btn = availableButtons.splice(idx, 1)[0];
        const code = uuidv4();
        assigned[btn] = { prize, code };
        lobby.prizeCodes[btn] = code;
      }
      return assigned;
    };

    lobby.prizes = {
      ...assignPrizes(config.grandPrizes),
      ...assignPrizes(config.consolationPrizes)
    };

    io.to(keyphrase).emit("startCountdown");
  });

  // Handle button pick
  socket.on("pickButton", ({ keyphrase, button }) => {
    const lobby = lobbies[keyphrase];
    if (!lobby || !lobby.config) return;
    const player = lobby.players.find(p => p.id === socket.id);
    if (!player || player.clicks >= lobby.config.picks) return;
    if (!lobby.config.allowDuplicates && lobby.pickedButtons.has(button)) return;

    player.clicks++;
    lobby.pickedButtons.add(button);
    io.to(keyphrase).emit("boardUpdate", { buttonNumber: button });

    // Prize logic
    const prize = lobby.prizes[button];
    if (prize) {
      const isGrand = lobby.config.grandPrizes.includes(prize.prize);
      const message = isGrand
        ? `GRAND PRIZE! You've won ${prize.prize}`
        : `You won a booby prize! Enjoy ${prize.prize}`;
      const result = {
        message,
        code: prize.code
      };
      lobby.leaderboard[player.nickname] = prize.prize;
      io.to(socket.id).emit("prizeWon", result);
      io.to(keyphrase).emit("leaderboardUpdate", lobby.leaderboard);
    } else {
      io.to(socket.id).emit("prizeWon", {
        message: player.clicks < lobby.config.picks
          ? `Sorry, Better Luck Next Time. You still have ${lobby.config.picks - player.clicks} more tries!`
          : `Sorry, Better Luck Next Time. You're out of tries.`
      });
    }
  });

  // Disconnect cleanup
  socket.on("disconnect", () => {
    for (const key in lobbies) {
      const lobby = lobbies[key];
      const idx = lobby.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        const name = lobby.players[idx].nickname;
        lobby.players.splice(idx, 1);
        if (lobby.host === socket.id || lobby.players.length === 0) {
          delete lobbies[key];
        } else {
          io.to(key).emit("joined", { players: lobby.players });
        }
        console.log(`${name} disconnected from ${key}`);
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
