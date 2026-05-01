import { Server } from 'socket.io';

const io = new Server(3001, {
  cors: {
    origin: "*" 
  }
});

let players = {};

io.on('connection', (socket) => {
  console.log(`New player: ${socket.id}`);

  players[socket.id] = {
    id: socket.id,
    x: Math.floor(Math.random() * 700) + 50,
    y: Math.floor(Math.random() * 500) + 50
  };

  socket.emit('currentPlayers', players);
  
  socket.broadcast.emit('newPlayer', players[socket.id]);

  socket.on('playerMovement', (movementData) => {
    if (players[socket.id]) {
      players[socket.id].x = movementData.x;
      players[socket.id].y = movementData.y;
      socket.broadcast.emit('playerMoved', players[socket.id]);
    }
  });

  socket.on('disconnect', () => {
    console.log(`Player out: ${socket.id}`);
    delete players[socket.id];
    io.emit('playerDisconnected', socket.id);
  });
});

console.log("Server running port 3001...");