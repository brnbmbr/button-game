// ================================
// BACKEND: Button Game (Express + Socket.IO)
// ================================
// Features:
// - Host lobby creation & configuration
// - Real-time multiplayer with sync
// - Unique prize claiming per button
// - Player pick limits and cooldown support
// - Host opt-out mode and leaderboard

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
  console.log(`Client connected: ${socket.id}`);

  // Host creates lobby
  socket.on("createLobby", ({ keyphrase, nickname }) => {
    lobbies[keyphrase] = {
      host: socket.id,
      players: [{ id: socket.id, nickname, picksLeft: 0 }],
      config: null,
      board: {},
      winners: {},
    };
    socket.join(keyphrase);
    io.to(keyphrase).emit("joined", { players: lobbies[keyphrase].players });
    console.log(`Lobby created: ${keyphrase}`);
  });

  // Player joins lobby
  socket.on("joinLobby", ({ keyphrase, nickname, entryKey }) => {
    const lobby = lobbies[keyphrase];
    if (!lobby) return;
    const player = { id: socket.id, nickname, entryKey, picksLeft: 0 };
    lobby.players.push(player);
    socket.join(keyphrase);
    io.to(keyphrase).emit("joined", { players: lobby.players });
    console.log(`${nickname} joined lobby ${keyphrase}`);
  });

  // Host starts game
  socket.on("startGame", ({ keyphrase, config }) => {
    const lobby = lobbies[keyphrase];
    if (!lobby || lobby.host !== socket.id) return;
    lobby.config = config;

    const totalButtons = 99;
    const prizeButtons = [];
    const prizeMap = {};
    const availableButtons = Array.from({ length: totalButtons }, (_, i) => i + 1);

    // Randomly assign prizes
    const randomPick = () => {
      const index = Math.floor(Math.random() * availableButtons.length);
      return availableButtons.splice(index, 1)[0];
    };

    config.grandPrizes.forEach(prize => {
      const btn = randomPick();
      prizeMap[btn] = { prize, type: "grand", code: uuidv4() };
    });

    config.consolationPrizes.forEach(prize => {
      const btn = randomPick();
      prizeMap[btn] = { prize, type: "consolation", code: uuidv4() };
    });

    lobby.board = prizeMap;

    lobby.players.forEach(player => {
      if (player.id === lobby.host && !config.hostIsPlayer) {
        player.picksLeft = 0;
      } else {
        player.picksLeft = config.picks;
      }
    });

    const remainingMap = {};
    lobby.players.forEach(p => remainingMap[p.nickname] = p.picksLeft);
    io.to(keyphrase).emit("updateRemainingPicks", remainingMap);
    io.to(keyphrase).emit("startCountdown");
    console.log(`Game started in lobby ${keyphrase}`);
  });

  // Player picks a button
  socket.on("pickButton", ({ keyphrase, button }) => {
    const lobby = lobbies[keyphrase];
    if (!lobby) return;
    const player = lobby.players.find(p => p.id === socket.id);
    if (!player || player.picksLeft <= 0 || lobby.board[button]?.claimed) return;

    player.picksLeft--;
    if (lobby.board[button]) {
      const prizeData = lobby.board[button];
      prizeData.claimed = true;
      lobby.winners[socket.id] = prizeData;
      io.to(socket.id).emit("prizeWon", {
        message: prizeData.type === "grand"
          ? `GRAND PRIZE! You've won ${prizeData.prize}`
          : `You won a booby prize! Please enjoy ${prizeData.prize}. Next time might be the big one!`,
        code: prizeData.code
      });

      lobby.board[button].claimed = true;
      lobby.leaderboard = lobby.leaderboard || {};
      lobby.leaderboard[player.nickname] = prizeData.prize;
      io.to(keyphrase).emit("leaderboardUpdate", lobby.leaderboard);
    } else {
      io.to(socket.id).emit("prizeWon", {
        message: player.picksLeft > 0
          ? `Sorry, Better Luck Next Time! You still have ${player.picksLeft} more tries!`
          : `Sorry, Better Luck Next Time! You're out of picks.`
      });
    }

    const remainingMap = {};
    lobby.players.forEach(p => remainingMap[p.nickname] = p.picksLeft);
    io.to(keyphrase).emit("updateRemainingPicks", remainingMap);
    io.to(keyphrase).emit("boardUpdate", { buttonNumber: button });
  });

  // Disconnect
  socket.on("disconnect", () => {
    for (const key in lobbies) {
      const lobby = lobbies[key];
      const index = lobby.players.findIndex(p => p.id === socket.id);
      if (index !== -1) {
        const name = lobby.players[index].nickname;
        lobby.players.splice(index, 1);

        if (lobby.host === socket.id || lobby.players.length === 0) {
          delete lobbies[key];
          console.log(`Lobby ${key} closed`);
        } else {
          io.to(key).emit("joined", { players: lobby.players });
          const remainingMap = {};
          lobby.players.forEach(p => remainingMap[p.nickname] = p.picksLeft);
          io.to(key).emit("updateRemainingPicks", remainingMap);
          console.log(`${name} left lobby ${key}`);
        }
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
