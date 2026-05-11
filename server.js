import { createServer } from 'http';
import { Server } from 'socket.io';

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: {
    origin: '*'
  }
});

const WORLD_WIDTH = 3000;
const WORLD_HEIGHT = 3000;
const TICK_RATE = 50;

const world = {
  players: {},
  bullets: {},   // { [id]: { id, ownerId, x, y, angle, speed, alive } }
};

function logActivePlayers() {
  const count = Object.keys(world.players).length;
  const names = Object.values(world.players).map(p => p.name || p.id.slice(0, 6)).join(', ');
  console.log(`[WORLD] Active players in world: ${count} — [${names}]`);
}

function spawnPlayer(socketId) {
  let x, y;
  let attempts = 0;
  const minDistance = 100;
  const minX = 100, maxX = WORLD_WIDTH - 100;
  const minY = 100, maxY = WORLD_HEIGHT - 100;

  while (attempts < 100) {
    x = Math.floor(Math.random() * (maxX - minX)) + minX;
    y = Math.floor(Math.random() * (maxY - minY)) + minY;
    let tooClose = false;
    for (const id in world.players) {
      if (id !== socketId && world.players[id].alive) {
        if (Math.hypot(world.players[id].x - x, world.players[id].y - y) < minDistance) {
          tooClose = true;
          break;
        }
      }
    }
    if (!tooClose) break;
    attempts++;
  }
  return { x, y };
}

function generateName() {
  const adjs = ["Red","Blue","Green","Fast","Brave","Iron","Shadow","Storm"];
  const nouns = ["Tank","Hero","Wolf","Bot","Striker","Legend","Falcon"];
  return `${adjs[Math.floor(Math.random()*adjs.length)]}${nouns[Math.floor(Math.random()*nouns.length)]}${Math.floor(Math.random()*999)}`;
}

// Tick loop: broadcast full state
setInterval(() => {
  const snapshot = {
    players: {},
    bullets: Object.values(world.bullets).map(b => ({ ...b })),
  };
  for (const id in world.players) {
    snapshot.players[id] = { ...world.players[id] };
  }
  io.emit('worldState', snapshot);

  const count = Object.keys(world.players).length;
  if (count > 0) logActivePlayers();
}, TICK_RATE);

io.on('connection', (socket) => {
  const spawnPos = spawnPlayer(socket.id);

  world.players[socket.id] = {
    id: socket.id,
    name: generateName(),
    x: spawnPos.x,
    y: spawnPos.y,
    angle: 0,
    kills: 0,
    deaths: 0,
    score: 0,
    alive: true,
    lastRespawn: Date.now()
  };

  console.log(`[CONNECT] ${socket.id} joins. Total: ${Object.keys(world.players).length}`);

  // Send current world snapshot to the new player immediately
  const snapshot = {
    players: {},
    bullets: Object.values(world.bullets).map(b => ({ ...b })),
  };
  for (const id in world.players) {
    snapshot.players[id] = { ...world.players[id] };
  }
  socket.emit('worldState', snapshot);

  // Send initial leaderboard to newly connected player
  const initialLb = Object.values(world.players).map(p => ({
    id: p.id, name: p.name,
    kills: p.kills || 0, deaths: p.deaths || 0, score: p.score || 0
  }));
  socket.emit('leaderboardUpdate', initialLb);

  socket.on('join', (data) => {
    const name = data && data.name ? String(data.name).trim() : '';
    if (name && world.players[socket.id]) {
      world.players[socket.id].name = name;
      console.log('Player joined:', name, 'Total players in world:', Object.keys(world.players).length);
      io.emit('leaderboardUpdate', Object.values(world.players).map(p => ({
        id: p.id, name: p.name,
        kills: p.kills || 0, deaths: p.deaths || 0, score: p.score || 0
      })));
    }
  });

  socket.on('playerMovement', (data) => {
    if (world.players[socket.id] && world.players[socket.id].alive) {
      world.players[socket.id].x = data.x;
      world.players[socket.id].y = data.y;
      world.players[socket.id].angle = data.angle;
    }
  });

  socket.on('fireBullet', (data) => {
    if (!world.players[socket.id] || !world.players[socket.id].alive) return;
    const bulletId = data.bulletId || `${socket.id}-${Date.now()}`;
    world.bullets[bulletId] = {
      id: bulletId,
      ownerId: socket.id,
      x: data.x,
      y: data.y,
      angle: data.angle,
      speed: 400,
      alive: true
    };
    // Auto-remove after 2s
    setTimeout(() => {
      delete world.bullets[bulletId];
    }, 2000);
  });

  socket.on('bulletHit', (data) => {
    const { targetId, shooterId } = data;
    console.log('[SERVER] bulletHit from', socket.id, 'shooterId:', shooterId, 'targetId:', targetId, 'data:', data);
    const target = world.players[targetId];
    const shooter = world.players[shooterId] || world.players[socket.id];
    console.log('[SERVER] shooter resolved:', shooter ? shooter.id : 'null', 'target alive:', target ? target.alive : 'null');
    if (!target || !target.alive) return;
    if (!shooter) return;

    target.alive = false;
    target.deaths++;
    if (shooter.id !== targetId) {
      shooter.kills++;
      shooter.score += 1;
      console.log('[SERVER] Kill counted! Shooter', shooter.id, 'now has', shooter.kills, 'kills,', shooter.score, 'score');
    }

    io.emit('tankDied', {
      id: targetId,
      killerId: shooter ? shooter.id : 'unknown'
    });

    io.emit('leaderboardUpdate', Object.values(world.players).map(p => ({
      id: p.id, name: p.name,
      kills: p.kills || 0, deaths: p.deaths || 0, score: p.score || 0
    })));

    setTimeout(() => {
      if (world.players[targetId]) {
        const sp = spawnPlayer(targetId);
        world.players[targetId].alive = true;
        world.players[targetId].x = sp.x;
        world.players[targetId].y = sp.y;
        io.emit('playerRespawned', {
          id: targetId,
          x: sp.x,
          y: sp.y
        });
      }
    }, 3000);
  });

  socket.on('disconnect', () => {
    console.log(`[DISCONNECT] ${socket.id} leaves.`);
    delete world.players[socket.id];
    // Remove all bullets from this player
    for (const id in world.bullets) {
      if (world.bullets[id].ownerId === socket.id) delete world.bullets[id];
    }
    io.emit('playerDisconnected', socket.id);
  });
});

httpServer.listen(3001, '0.0.0.0', () => {
  console.log('TANK BATTLE.IO — ONE WORLD on port 3001');
});