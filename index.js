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

HEAD
// In-memory store for active lobbies

// All active lobbies
const lobbies = {};

io.on("connection", (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Host creates lobby
  socket.on("createLobby", ({ keyphrase, nickname }) => {
    lobbies[keyphrase] = {
      host: socket.id,
      players: [{ id: socket.id, nickname }],
      config: null
    };
    socket.join(keyphrase);
 HEAD
    io.to(keyphrase).emit("joined", { players: lobbies[keyphrase].players });
    console.log(`Lobby created: ${keyphrase} by ${socket.id}`);
  });

  socket.on("joinLobby", ({ keyphrase }) => {
    if (!lobbies[keyphrase]) return;
    lobbies[keyphrase].players.push(socket.id);
    socket.join(keyphrase);
    io.to(keyphrase).emit("joined", { players: lobbies[keyphrase].players });
    console.log(`Player ${socket.id} joined lobby ${keyphrase}`);
  });

  socket.on("startGame", ({ keyphrase }) => {
    if (lobbies[keyphrase]?.host === socket.id) {
      io.to(keyphrase).emit("startCountdown");
      console.log(`Game started in lobby: ${keyphrase}`);
    }
  });

  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);
    for (const key in lobbies) {
      const index = lobbies[key].players.indexOf(socket.id);
      if (index !== -1) {
        lobbies[key].players.splice(index, 1);
        if (lobbies[key].host === socket.id || lobbies[key].players.length === 0) {
          delete lobbies[key];
          console.log(`Lobby ${key} closed`);
        } else {
          io.to(key).emit("joined", { players: lobbies[key].players });
        }
      }
    }
  });
});

// Railway uses process.env.PORT in production
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);

    io.to(keyphrase).emit("joined", {
      players: lobbies[keyphrase].players
    });
    console.log(`Lobby created: ${keyphrase}`);
  });

  // Player joins lobby
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

  // Host starts game
  socket.on("startGame", ({ keyphrase, config }) => {
    const lobby = lobbies[keyphrase];
    if (!lobby || lobby.host !== socket.id) return;
    lobby.config = config;
    io.to(keyphrase).emit("startCountdown");
    console.log(`Game started in lobby ${keyphrase}`);
  });

  // Disconnect handler
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

// Launch server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
 16c8261 (Update: improved lobby and game start handling)
});
