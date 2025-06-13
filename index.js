const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// ===== In-memory lobby store ===== //
const lobbies = {};

// ===== Socket.IO connection ===== //
io.on("connection", (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // === Create Lobby === //
  socket.on("createLobby", ({ keyphrase, nickname }) => {
    lobbies[keyphrase] = {
      host: socket.id,
      players: [{ id: socket.id, nickname }],
      config: null,
      prizes: {
        grand: [],
        consolation: []
      },
      picksUsed: {}
    };
    socket.join(keyphrase);
    io.to(keyphrase).emit("joined", {
      players: lobbies[keyphrase].players
    });
    console.log(`Lobby created: ${keyphrase}`);
  });

  // === Join Lobby === //
  socket.on("joinLobby", ({ keyphrase, nickname, entryKey }) => {
    const lobby = lobbies[keyphrase];
    if (!lobby) return;
    const player = { id: socket.id, nickname, entryKey };
    lobby.players.push(player);
    socket.join(keyphrase);
    io.to(keyphrase).emit("joined", {
      players: lobby.players
    });
    console.log(`${nickname} joined lobby ${keyphrase}`);
  });

  // === Start Game === //
  socket.on("startGame", ({ keyphrase, config }) => {
    const lobby = lobbies[keyphrase];
    if (!lobby || lobby.host !== socket.id) return;
    lobby.config = config;
    io.to(keyphrase).emit("startCountdown");
    console.log(`Game started in lobby ${keyphrase}`);
  });

  // === Handle Button Pick === //
  socket.on("pickButton", ({ keyphrase, button }) => {
    const lobby = lobbies[keyphrase];
    if (!lobby || !lobby.config) return;

    const playerId = socket.id;
    const maxPicks = lobby.config.picks || 1;

    // Track pick usage
    lobby.picksUsed[playerId] = lobby.picksUsed[playerId] || 0;
    if (lobby.picksUsed[playerId] >= maxPicks) return;

    // Generate prize buttons on first pick
    if (lobby.prizes.grand.length === 0 && lobby.prizes.consolation.length === 0) {
      const allButtons = Array.from({ length: 99 }, (_, i) => i + 1);
      const shuffled = allButtons.sort(() => 0.5 - Math.random());

      const numGrand = lobby.config.grandPrizes.length;
      const numConsolation = lobby.config.consolationPrizes.length;
      lobby.prizes.grand = shuffled.slice(0, numGrand);
      lobby.prizes.consolation = shuffled.slice(numGrand, numGrand + numConsolation);
    }

    lobby.picksUsed[playerId]++;

    let message = "Sorry, better luck next time!";
    let type = "none";

    const grandIndex = lobby.prizes.grand.indexOf(button);
    const consIndex = lobby.prizes.consolation.indexOf(button);

    if (grandIndex !== -1) {
      const prize = lobby.config.grandPrizes[grandIndex];
      message = `🎉 GRAND PRIZE! You won: ${prize}`;
      type = "grand";
      lobby.prizes.grand.splice(grandIndex, 1);
    } else if (consIndex !== -1) {
      const prize = lobby.config.consolationPrizes[consIndex];
      message = `You won a consolation prize: ${prize}`;
      type = "consolation";
      lobby.prizes.consolation.splice(consIndex, 1);
    } else {
      const remaining = maxPicks - lobby.picksUsed[playerId];
      if (remaining > 0) {
        message += ` You still have ${remaining} tries!`;
      }
    }

    socket.emit("pickResult", { message, type, button });
  });

  // === Disconnect Handling === //
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
          io.to(key).emit("joined", {
            players: lobby.players
          });
          console.log(`${name} left lobby ${key}`);
        }
        break;
      }
    }
  });
});

// ===== Launch Server ===== //
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
