const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3001;

let worldState = {
  players: {},
};

io.on("connection", (socket) => {
  console.log(`New client connected: ${socket.id}`);

  // When a player connects, add them to the worldState
  worldState.players[socket.id] = {
    id: socket.id,        // CRITICAL: include 'id' for client compatibility
    x: Math.random() * 800,
    y: Math.random() * 600,
    angle: 0,
    tankId: socket.id,
    name: `Player-${socket.id.slice(0, 4)}`,
  };

  // Send current players to the newly connected client immediately
  socket.emit("currentPlayers", worldState.players);

  // Broadcast new player to all other clients
  socket.broadcast.emit("newPlayer", worldState.players[socket.id]);

  // Handle player movement
  socket.on("playerMovement", (movementData) => {
    if (worldState.players[socket.id]) {
      worldState.players[socket.id].x = movementData.x;
      worldState.players[socket.id].y = movementData.y;
      worldState.players[socket.id].angle = movementData.angle;

      // Broadcast the updated player position to all clients
      io.emit("playerMoved", worldState.players[socket.id]);
    }
  });

  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);

    delete worldState.players[socket.id];

    io.emit("playerDisconnected", socket.id);
  });
});
app.use(express.static(path.join(__dirname, 'dist')));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "index.html"));
});

server.listen(PORT,'0.0.0.0', () => {
  console.log(`Listening on port ${PORT}`);
});