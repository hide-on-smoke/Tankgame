import { createServer } from 'http';
import { Server } from 'socket.io';

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: { origin: '*' }
});

const WORLD_WIDTH = 3000;
const WORLD_HEIGHT = 3000;
const BOT_COUNT = 10;
const BOT_RESPAWN_DELAY = 2000;
const BULLET_LIFETIME = 2000;

const NETWORK_TICK = 200;
const AI_TICK = 300;
const COLLISION_TICK = 200;

const world = {
  players: {},
  bullets: {},   // { [id]: { id, ownerId, x, y, angle, speed, alive } }
};

// Batched network updates to prevent flooding clients
const batch = { healthUpdate: null, levelUp: null, tankDied: null, respawn: null, leaderboard: null, needsFlush: false };
function queueBatch(key, data) { batch[key] = data; batch.needsFlush = true; }
function flushBatch() {
  if (!batch.needsFlush) return;
  batch.needsFlush = false;
  if (batch.healthUpdate) { io.emit('tankHealthUpdate', batch.healthUpdate); batch.healthUpdate = null; }
  if (batch.levelUp) { io.emit('playerLevelUp', batch.levelUp); batch.levelUp = null; }
  if (batch.tankDied) { io.emit('tankDied', batch.tankDied); batch.tankDied = null; }
  if (batch.respawn) { io.emit('playerRespawned', batch.respawn); batch.respawn = null; }
  if (batch.leaderboard) { io.emit('leaderboardUpdate', batch.leaderboard); batch.leaderboard = null; }
}
setInterval(flushBatch, 50);

const respawnTimeouts = new Map();

let lastLogState = '';
function logOnce(msg) {
  if (msg !== lastLogState) { console.log(msg); lastLogState = msg; }
}

const BOT_UPGRADE_POOL = [
  { key: 'damage', apply: (p) => { p.damage = (p.damage || 10) + 5; } },
  { key: 'hp', apply: (p) => { p.maxHealth += 20; p.health = Math.min((p.health || 100) + 20, p.maxHealth); } },
  { key: 'speed', apply: (p) => {
    p.speed = (p.speed || 130) + 20;
    p.rotationSpeed = (p.rotationSpeed || 160) + 15;
    p.bulletSpeed = (p.bulletSpeed || 400) + 40;
  }},
  { key: 'firerate', apply: (p) => { p.fireRate = Math.max(200, (p.fireRate || 500) - 40); }},
  { key: 'regen', apply: (p) => { p.regenPerSecond = (p.regenPerSecond || 0) + 2; }},
  { key: 'armor', apply: (p) => { p.armor = (p.armor || 0) + 1; }},
  { key: 'multishot', apply: (p) => { p.bulletCount = Math.min((p.bulletCount || 1) + 1, 3); }},
];

function applyBotUpgrade(p) {
  try {
    const pool = BOT_UPGRADE_POOL.filter(u => {
      if (u.key === 'multishot' && (p.bulletCount || 1) >= 3) return false;
      if (u.key === 'firerate' && (p.fireRate || 500) <= 200) return false;
      return true;
    });
    if (pool.length === 0) return;
    const u = pool[Math.floor(Math.random() * pool.length)];
    if (!u || typeof u.apply !== 'function') return;
    u.apply(p);
    if (!p.upgradeHistory) p.upgradeHistory = [];
    p.upgradeHistory.push({ key: u.key, label: u.label || u.key, icon: getUpgradeIcon(u.key), desc: '', levelChosen: p.level || 1 });
  } catch (e) {
    console.error('[BOT UPGRADE] Error applying upgrade:', e);
  }
}

function getUpgradeIcon(key) {
  const map = { damage: '\u{1F525}', hp: '\u2764\uFE0F', speed: '\u26A1', firerate: '\u{1F680}', regen: '\u{1F49A}', armor: '\u{1F6E1}\uFE0F', multishot: '\u{1F3AF}' };
  return map[key] || '\u2B06';
}

function randomBotLevel() { return Math.floor(Math.random() * 6) + 1; }

function applyRandomUpgradesForLevel(p, level) {
  const maxLoops = Math.min(level, 20); // Safety limit
  for (let i = 1; i < maxLoops; i++) applyBotUpgrade(p);
}

function generateName() {
  const adjs = ["Red","Blue","Green","Fast","Brave","Iron","Shadow","Storm","Sniper","Cyber","Omega","Delta","Frost","Blaze","Venom","Crystal","Lunar","Steel"];
  const nouns = ["Tank","Hero","Wolf","Bot","Striker","Legend","Falcon","Titan","Phantom","Viper","Hunter","Raven","Saber","Aegis","Cyclone"];
  return `${adjs[Math.floor(Math.random()*adjs.length)]}${nouns[Math.floor(Math.random()*nouns.length)]}${Math.floor(Math.random()*99)}`;
}

function spawnPlayer(socketId, isBot) {
  let x, y, attempts = 0;
  while (attempts < 50) {
    x = 150 + Math.random() * (WORLD_WIDTH - 300);
    y = 150 + Math.random() * (WORLD_HEIGHT - 300);
    let tooClose = false;
    for (const id in world.players) {
      if (id !== socketId && world.players[id].alive && Math.hypot(world.players[id].x - x, world.players[id].y - y) < 150) {
        tooClose = true; break;
      }
    }
    if (!tooClose) break;
    attempts++;
  }
  return { x, y, level: isBot ? randomBotLevel() : 1 };
}

function createPlayerData(socketId, spawnPos, name, isBot) {
  return {
    id: socketId, name,
    x: spawnPos.x, y: spawnPos.y, angle: Math.random() * 360,
    kills: 0, deaths: 0, score: 0, exp: 0,
    level: spawnPos.level, nextLevelExp: spawnPos.level * 3,
    health: isBot ? 50 : 100, maxHealth: isBot ? 50 : 100, damage: isBot ? 5 : 20, speed: 130,
    rotationSpeed: isBot ? 240 : 160, fireRate: isBot ? 1000 : 600, regenPerSecond: 1,
    bulletCount: 1, bulletSpeed: 500, armor: 0, alive: true,
    upgradeHistory: [], lastRespawn: Date.now(), isBot,
    _targetId: null, _lastFire: 0, _nextDecision: 0, _dodgeDir: 1, _lastHurt: 0,
  };
}

let botCounter = 0;
function createBot() {
  botCounter++;
  const id = `bot_${botCounter}_${Date.now()}`;
  const sp = spawnPlayer(id, true);
  const bot = createPlayerData(id, sp, generateName(), true);
  if (sp.level > 1) applyRandomUpgradesForLevel(bot, sp.level);
  world.players[id] = bot;
}

function ensureBotCount() {
  let count = 0;
  for (const id in world.players) if (world.players[id].isBot) count++;
  while (count < BOT_COUNT) { createBot(); count++; }
}

function buildLeaderboard() {
  return Object.values(world.players).map(p => ({
    id: p.id, name: p.name,
    kills: p.kills || 0, deaths: p.deaths || 0, score: p.score || 0,
    isBot: p.isBot || false
  }));
}

function botAI() {
  try {
    const now = Date.now();
    const delta = AI_TICK / 1000;
    const playerIds = Object.keys(world.players);
    
    // Early exit if no players
    if (playerIds.length === 0) return;

    for (const id in world.players) {
      const bot = world.players[id];
      if (!bot.isBot || !bot.alive) continue;

      if (now > bot._nextDecision) {
        bot._nextDecision = now + 800 + Math.random() * 400; // Reduced frequency: 800-1200ms
        let bestId = null, bestDist = Infinity;
        for (const oid of playerIds) {
          if (oid === id) continue;
          const o = world.players[oid];
          if (!o.alive) continue;
          const d = Math.hypot(bot.x - o.x, bot.y - o.y);
          if (d < bestDist) { bestDist = d; bestId = oid; }
        }
        bot._targetId = bestId;
        bot._dodgeDir = Math.random() > 0.5 ? 1 : -1;
      }

      if (!bot._targetId) continue;
      const target = world.players[bot._targetId];
      if (!target || !target.alive) { bot._targetId = null; continue; }

      const dx = target.x - bot.x, dy = target.y - bot.y;
      const dist = Math.hypot(dx, dy);
      const aimAngle = Math.atan2(dy, dx) * (180 / Math.PI);

      let angleDiff = aimAngle - bot.angle;
      // Normalize to [-180, 180] using modulo instead of while loops
      angleDiff = ((angleDiff + 180) % 360 + 360) % 360 - 180;
      const maxRot = (bot.rotationSpeed || 240) * delta;
      if (Math.abs(angleDiff) > maxRot) bot.angle += Math.sign(angleDiff) * maxRot;
      else bot.angle += angleDiff * 0.9; // Much faster convergence for smoother rotation
      // Normalize final angle to [0, 360) using modulo
      bot.angle = ((bot.angle % 360) + 360) % 360;

      const spd = (bot.speed || 130) * delta;
      const strafeRad = (aimAngle + 90 * bot._dodgeDir) * (Math.PI / 180);

      let mx = 0, my = 0;
      const rad = aimAngle * (Math.PI / 180);
      if (dist > 400) {
        mx += Math.cos(rad) * spd * 0.4; // Slower approach
        my += Math.sin(rad) * spd * 0.4;
      } else if (dist < 300) {
        mx -= Math.cos(rad) * spd * 0.5; // Back away when too close
        my -= Math.sin(rad) * spd * 0.5;
      }
      if (dist < 600) {
        const dodgeMul = (now - bot._lastHurt < 1000) ? 1.0 : 0.5;
        mx += Math.cos(strafeRad) * spd * dodgeMul;
        my += Math.sin(strafeRad) * spd * dodgeMul;
      }
      bot.x += mx; bot.y += my;
      bot.x = Math.max(30, Math.min(WORLD_WIDTH - 30, bot.x));
      bot.y = Math.max(30, Math.min(WORLD_HEIGHT - 30, bot.y));

      if (Math.abs(angleDiff) < 40 && dist < 800) {
        const fr = Math.max(1000, (bot.fireRate || 500) * 2); // Minimum 1s between shots
        if (now - bot._lastFire >= fr) {
          bot._lastFire = now;
          const bc = bot.bulletCount || 1, bs = bot.bulletSpeed || 400;
          for (let i = 0; i < bc; i++) {
            const off = (i - (bc - 1) / 2) * 0.15;
            const a = bot.angle + off * (180 / Math.PI);
            const r = a * (Math.PI / 180);
            const bid = `${id}-${now}-${i}`;
            world.bullets[bid] = {
              id: bid, ownerId: id,
              x: bot.x + Math.cos(r) * 30, y: bot.y + Math.sin(r) * 30,
              angle: a, speed: bs, vx: Math.cos(r) * bs, vy: Math.sin(r) * bs,
              created: now, alive: true
            };
          }
        }
      }
    }
  } catch (e) {
    console.error('[BOT AI] Error in botAI:', e);
  }
}

function checkCollisions() {
  try {
    const now = Date.now();
    const delta = COLLISION_TICK / 1000;
    const alivePlayers = [];
    for (const id in world.players) {
      const p = world.players[id];
      if (p.alive) alivePlayers.push(p);
    }

    for (const bulletId in world.bullets) {
      const b = world.bullets[bulletId];
      if (!b) continue;
      if (now - b.created > BULLET_LIFETIME || b.x < 0 || b.x > WORLD_WIDTH || b.y < 0 || b.y > WORLD_HEIGHT) {
        delete world.bullets[bulletId]; continue;
      }

      const owner = world.players[b.ownerId];
      if (!owner) { delete world.bullets[bulletId]; continue; }

      const bvx = b.vx || Math.cos(b.angle * (Math.PI / 180)) * b.speed;
      const bvy = b.vy || Math.sin(b.angle * (Math.PI / 180)) * b.speed;
      b.x += bvx * delta;
      b.y += bvy * delta;

      let hit = false;
      for (let ti = 0; ti < alivePlayers.length && !hit; ti++) {
        const t = alivePlayers[ti];
        if (t.id === b.ownerId) continue;
        if (Math.hypot(b.x - t.x, b.y - t.y) < 40) {
          hit = true;
          const dmg = owner.damage || 20;
          const armor = t.armor || 0;
          t.health = Math.max(0, (t.health ?? 100) - Math.max(1, dmg - armor));
          if (t.isBot) t._lastHurt = now;
          delete world.bullets[bulletId];

          queueBatch('healthUpdate', { id: t.id, health: t.health, maxHealth: t.maxHealth });

          if (t.health <= 0) {
            t.alive = false; t.deaths++;
            if (owner.id !== t.id) {
              owner.kills++; owner.score++;
              owner.exp = (owner.exp || 0) + 1;
              while (owner.exp >= owner.nextLevelExp) {
                owner.exp -= owner.nextLevelExp;
                owner.level++;
                owner.nextLevelExp = owner.level * 3;
                queueBatch('levelUp', { id: owner.id, level: owner.level, exp: owner.exp, nextLevelExp: owner.nextLevelExp });
              }
            }
            queueBatch('tankDied', { id: t.id, killerId: owner.id });
            queueBatch('leaderboard', buildLeaderboard());

            const delay = t.isBot ? BOT_RESPAWN_DELAY : 3000;
            // Clear existing timeout if any
            if (respawnTimeouts.has(t.id)) {
              clearTimeout(respawnTimeouts.get(t.id));
            }
            const timeoutId = setTimeout(() => {
              respawnTimeouts.delete(t.id);
              if (world.players[t.id]) {
                const isBot = t.isBot || false;
                const sp = spawnPlayer(t.id, isBot);
                const p = world.players[t.id];
                p.alive = true; p.health = p.maxHealth;
                p.x = sp.x; p.y = sp.y; p.angle = Math.random() * 360;
                p._lastHurt = 0;
                if (isBot) {
                  const nl = randomBotLevel();
                  p.level = nl; p.nextLevelExp = nl * 3; p.exp = 0;
                  p.damage = 5; p.maxHealth = 50; p.health = 50;
                  p.speed = 130; p.rotationSpeed = 240; p.fireRate = 1000;
                  p.regenPerSecond = 1; p.bulletCount = 1; p.bulletSpeed = 500;
                  p.armor = 0; p.upgradeHistory = [];
                  applyRandomUpgradesForLevel(p, nl);
                } else {
                  // Reset human player to default stats on death
                  p.level = 1; p.nextLevelExp = 3; p.exp = 0;
                  p.damage = 20; p.maxHealth = 100; p.health = 100;
                  p.speed = 130; p.rotationSpeed = 160; p.fireRate = 600;
                  p.regenPerSecond = 1; p.bulletCount = 1; p.bulletSpeed = 500;
                  p.armor = 0; p.upgradeHistory = [];
                }
                queueBatch('respawn', { id: t.id, x: sp.x, y: sp.y, level: p.level, exp: p.exp, nextLevelExp: p.nextLevelExp, damage: p.damage, maxHealth: p.maxHealth, speed: p.speed, rotationSpeed: p.rotationSpeed, fireRate: p.fireRate, regenPerSecond: p.regenPerSecond, bulletCount: p.bulletCount, bulletSpeed: p.bulletSpeed, armor: p.armor, upgradeHistory: p.upgradeHistory });
                queueBatch('leaderboard', buildLeaderboard());
              }
            }, delay);
            respawnTimeouts.set(t.id, timeoutId);
          }
        }
      }
    }
  } catch (e) {
    console.error('[COLLISION] Error in checkCollisions:', e);
  }
}

function sanitize(p) {
  const c = { ...p };
  delete c._targetId; delete c._lastFire; delete c._nextDecision; delete c._dodgeDir; delete c._lastHurt;
  return c;
}

function sanitizeBullet(b) {
  const c = { ...b };
  delete c.vx; delete c.vy; delete c.created;
  return c;
}

// Tick loop: broadcast full state
setInterval(() => {
  const snapshot = { players: {}, bullets: [] };
  for (const id in world.players) snapshot.players[id] = sanitize(world.players[id]);
  for (const id in world.bullets) snapshot.bullets.push(sanitizeBullet(world.bullets[id]));
  io.emit('worldState', snapshot);

  const realCount = Object.values(world.players).filter(p => !p.isBot).length;
  const botAlive = Object.values(world.players).filter(p => p.isBot && p.alive).length;
  const botDead = Object.values(world.players).filter(p => p.isBot && !p.alive).length;
  const total = Object.keys(world.players).length;
  logOnce(total > 0 ? `[WORLD] Real:${realCount} Bots:${botAlive}alive ${botDead}dead` : '');
}, NETWORK_TICK);

setInterval(botAI, AI_TICK);
setInterval(checkCollisions, COLLISION_TICK);

io.on('connection', (socket) => {
  const sp = spawnPlayer(socket.id, false);
  world.players[socket.id] = createPlayerData(socket.id, sp, generateName(), false);
  ensureBotCount();

  console.log(`[CONNECT] ${socket.id} joins. Total: ${Object.keys(world.players).length}`);

  // Send current world snapshot to the new player immediately
  const snapshot = { players: {}, bullets: [] };
  for (const id in world.players) snapshot.players[id] = sanitize(world.players[id]);
  for (const id in world.bullets) snapshot.bullets.push(sanitizeBullet(world.bullets[id]));
  socket.emit('worldState', snapshot);

  const lb = buildLeaderboard();
  socket.emit('leaderboardUpdate', lb);
  io.emit('leaderboardUpdate', lb);

  socket.on('join', (data) => {
    const name = data && data.name ? String(data.name).trim() : '';
    if (name && world.players[socket.id]) {
      world.players[socket.id].name = name;
      io.emit('leaderboardUpdate', buildLeaderboard());
    }
  });

  socket.on('playerMovement', (data) => {
    const p = world.players[socket.id];
    if (p && p.alive) { p.x = data.x; p.y = data.y; p.angle = data.angle; }
  });

  socket.on('fireBullet', (data) => {
    const p = world.players[socket.id];
    if (!p || !p.alive) return;
    const id = data.bulletId || `${socket.id}-${Date.now()}`;
    const bs = data.speed || p.bulletSpeed || 400;
    const r = data.angle * (Math.PI / 180);
    world.bullets[id] = {
      id, ownerId: socket.id, x: data.x, y: data.y, angle: data.angle,
      speed: bs, vx: Math.cos(r) * bs, vy: Math.sin(r) * bs, created: Date.now(), alive: true
    };
  });

  socket.on('playerUpgradeChosen', (data) => {
    if (!data || !world.players[socket.id]) return;
    const p = world.players[socket.id];
    if (data.stats) for (const [k, v] of Object.entries(data.stats)) p[k] = v;
    if (data.history) p.upgradeHistory = data.history;
    socket.broadcast.emit('tankUpgradeData', { id: socket.id, stats: data.stats || {}, history: data.history || [] });
  });

  socket.on('disconnect', () => {
    // Clear respawn timeout if exists
    if (respawnTimeouts.has(socket.id)) {
      clearTimeout(respawnTimeouts.get(socket.id));
      respawnTimeouts.delete(socket.id);
    }
    delete world.players[socket.id];
    for (const id in world.bullets) { if (world.bullets[id].ownerId === socket.id) delete world.bullets[id]; }
    io.emit('playerDisconnected', socket.id);
    io.emit('leaderboardUpdate', buildLeaderboard());
    ensureBotCount();
  });
});

ensureBotCount();
httpServer.listen(3001, '0.0.0.0', () => console.log('TANK BATTLE.IO — ONE WORLD on port 3001'));