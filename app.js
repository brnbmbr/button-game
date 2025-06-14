// ================================
// BACKEND: Button Game Server
// ================================
// Tech Stack: Node.js + Express + Socket.IO
// - Hosts real-time lobbies
// - Assigns players to rooms based on keyphrase
// - Host can trigger game start
// - Broadcasts countdown to all players
// ================================

const express = require("express");              // Web server framework
const http = require("http");                    // Node HTTP server
const { Server } = require("socket.io");         // WebSockets via Socket.IO
const cors = require("cors");                    // Cross-origin requests support

const app = express();
app.use(cors());                                 // Allow all origins by default (customize in production)

const server = http.createServer(app);           // Create HTTP server
const io = new Server(server, {
  cors: {
    origin: "*",                                 // Allow all origins during development
    methods: ["GET", "POST"]
  }
});

// ================================
// In-memory store of active lobbies
// ================================
const lobbies = {}; // Format: { keyphrase: { host: socket.id, players: [socketId1, socketId2, ...] } }

// ================================
// Socket.IO Connection Handler
// ================================
io.on("connection", (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // --- Host creates a new lobby with a keyphrase --- //
  socket.on("createLobby", ({ keyphrase }) => {
    lobbies[keyphrase] = {
      host: socket.id,
      players: [socket.id]
    };
    socket.join(keyphrase); // Join the Socket.IO room
    io.to(keyphrase).emit("joined", { players: lobbies[keyphrase].players });
    console.log(`Lobby created: ${keyphrase} by host ${socket.id}`);
  });

  // --- Player joins an existing lobby --- //
  socket.on("joinLobby", ({ keyphrase }) => {
    if (!lobbies[keyphrase]) {
      console.log(`Attempt to join invalid lobby: ${keyphrase}`);
      return;
    }
    lobbies[keyphrase].players.push(socket.id);
    socket.join(keyphrase);
    io.to(keyphrase).emit("joined", { players: lobbies[keyphrase].players });
    console.log(`Player ${socket.id} joined lobby: ${keyphrase}`);
  });

  // --- Host starts the game, triggering countdown for all players --- //
  socket.on("startGame", ({ keyphrase }) => {
    if (lobbies[keyphrase]?.host === socket.id) {
      console.log(`Starting game for lobby: ${keyphrase}`);
      io.to(keyphrase).emit("startCountdown");
    } else {
      console.log(`Unauthorized game start attempt from ${socket.id} in lobby ${keyphrase}`);
    }
  });

  // --- Handle disconnection and clean-up --- //
  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);

    // Remove player from all lobbies they were part of
    for (const key in lobbies) {
      const index = lobbies[key].players.indexOf(socket.id);
      if (index !== -1) {
        lobbies[key].players.splice(index, 1);

        // If host leaves, destroy the lobby
        if (lobbies[key].host === socket.id || lobbies[key].players.length === 0) {
          console.log(`Lobby ${key} closed`);
          delete lobbies[key];
        } else {
          io.to(key).emit("joined", { players: lobbies[key].players });
        }
      }
    }
  });
});

// ================================
// Start Server
// ================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
