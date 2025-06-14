const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
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

// Store lobbies
const lobbies = {};

io.on("connection", (socket) => {
  console.log("New client:", socket.id);

  // Create a new lobby
  socket.on("createLobby", ({ keyphrase, nickname }) => {
    lobbies[keyphrase] = {
      host: socket.id,
      players: {},
      config: null,
      board: new Set(),
      prizeLocations: {},
      prizeCodes: {},
    };
    lobbies[keyphrase].players[nickname] = {
      id: socket.id,
      nickname,
      remainingPicks: 0,
      hasJoined: true,
    };
    socket.join(keyphrase);
    io.to(keyphrase).emit("joined", { players: Object.values(lobbies[keyphrase].players) });
  });

  // Join existing lobby
  socket.on("joinLobby", ({ keyphrase, nickname }) => {
    const lobby = lobbies[keyphrase];
    if (!lobby || lobby.config || lobby.players[nickname]) return;

    lobby.players[nickname] = {
      id: socket.id,
      nickname,
      remainingPicks: 0,
      hasJoined: true,
    };
    socket.join(keyphrase);
    io.to(keyphrase).emit("joined", { players: Object.values(lobby.players) });
  });

  // Start the game
  socket.on("startGame", ({ keyphrase, config }) => {
    const lobby = lobbies[keyphrase];
    if (!lobby || lobby.host !== socket.id) return;

    lobby.config = config;

    // Assign random prize buttons
    const allButtons = [...Array(99)].map((_, i) => i + 1);
    const shuffle = (arr) => arr.sort(() => Math.random() - 0.5);
    const randomButtons = shuffle([...allButtons]);

    let prizeIndex = 0;

    // Assign grand prizes
    for (const prize of config.grandPrizes) {
      const btn = randomButtons[prizeIndex++];
      lobby.prizeLocations[btn] = { type: "grand", label: prize };
      lobby.prizeCodes[btn] = uuidv4().slice(0, 6).toUpperCase();
    }

    // Assign consolation prizes
    for (const prize of config.consolationPrizes) {
      const btn = randomButtons[prizeIndex++];
      lobby.prizeLocations[btn] = { type: "consolation", label: prize };
      lobby.prizeCodes[btn] = uuidv4().slice(0, 6).toUpperCase();
    }

    // Assign pick counts
    for (const nickname in lobby.players) {
      const isHost = lobby.host === lobby.players[nickname].id;
      const allowHost = config.hostIsPlayer;
      const picks = isHost && !allowHost ? 0 : config.picks;
      lobby.players[nickname].remainingPicks = picks;
    }

    const pickMap = {};
    for (const [name, data] of Object.entries(lobby.players)) {
      pickMap[name] = data.remainingPicks;
    }

    io.to(keyphrase).emit("startCountdown");
    io.to(keyphrase).emit("updateRemainingPicks", pickMap);
  });

  // Handle button pick
  socket.on("pickButton", ({ keyphrase, button, nickname }) => {
    const lobby = lobbies[keyphrase];
    if (!lobby || !lobby.players[nickname]) return;

    const player = lobby.players[nickname];

    if (player.remainingPicks <= 0 || lobby.board.has(button)) return;

    player.remainingPicks -= 1;
    lobby.board.add(button);

    const result = lobby.prizeLocations[button];
    const code = lobby.prizeCodes[button];
    let message;

    if (result?.type === "grand") {
      message = `🎉 GRAND PRIZE! You've won ${result.label}!`;
    } else if (result?.type === "consolation") {
      message = `You won a consolation prize: ${result.label}`;
    } else {
      const tries = player.remainingPicks;
      message = `Sorry, better luck next time. You have ${tries} picks remaining.`;
    }

    if (result) {
      io.to(socket.id).emit("prizeWon", { message, code });
      io.to(keyphrase).emit("leaderboardUpdate", {
        ...Object.fromEntries(
          Object.entries(lobby.players).map(([k, p]) => [
            k,
            p.remainingPicks < config.picks ? result.label : ""
          ])
        ),
      });
    } else {
      io.to(socket.id).emit("prizeWon", { message });
    }

    // Update the board for all clients
    io.to(keyphrase).emit("boardUpdate", { buttonNumber: button });

    // Send updated pick map
    const updated = {};
    for (const [name, data] of Object.entries(lobby.players)) {
      updated[name] = data.remainingPicks;
    }
    io.to(keyphrase).emit("updateRemainingPicks", updated);
  });

  // Disconnect cleanup
  socket.on("disconnect", () => {
    for (const key in lobbies) {
      const lobby = lobbies[key];
      const playerEntry = Object.entries(lobby.players).find(([_, v]) => v.id === socket.id);
      if (playerEntry) {
        const [nickname] = playerEntry;
        delete lobby.players[nickname];
        io.to(key).emit("joined", { players: Object.values(lobby.players) });

        if (Object.keys(lobby.players).length === 0) {
          delete lobbies[key];
        }
        break;
      }
    }
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Backend running on port", PORT));
