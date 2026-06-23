import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

// Cấu hình đường dẫn cho chuẩn ES Module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' }
});

// Phục vụ file Frontend (Giao diện game)
app.use(express.static(path.join(__dirname, 'dist')));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const WORLD_WIDTH = 4200;
const WORLD_HEIGHT = 4200;
const BOT_COUNT = 10;
const BOT_RESPAWN_DELAY = 2000;
const BULLET_LIFETIME = 2000;
const CRATE_COUNT = 50;
const CRATE_HEALTH = 100;
const CRATE_XP_REWARD = 0.5;

const NETWORK_TICK = 333;
const AI_TICK = 500;
const COLLISION_TICK = 200;

const world = {
  players: {},
  bullets: {},   // { [id]: { id, ownerId, x, y, angle, speed, alive } }
  crates: {},    // { [id]: { id, x, y, health, maxHealth, alive } }
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
  { key: 'damage', apply: (p) => { p.damage = (p.damage || 10) + 4; } },
  { key: 'hp', apply: (p) => { p.maxHealth += 15; p.health = Math.min((p.health || 100) + 15, p.maxHealth); } },
  { key: 'speed', apply: (p) => {
    p.speed = (p.speed || 160) + 20;
    p.rotationSpeed = (p.rotationSpeed || 180) + 15;
  }},
  { key: 'firerate', apply: (p) => { p.fireRate = Math.max(100, (p.fireRate || 600) - 30); }},
  { key: 'regen', apply: (p) => { p.regenPerSecond = (p.regenPerSecond || 0) + 1.5; }},
  { key: 'armor', apply: (p) => { p.armor = (p.armor || 0) + 1; }},
  { key: 'multishot', apply: (p) => { p.bulletCount = Math.min((p.bulletCount || 1) + 1, 3); }},
  { key: 'bulletspeed', apply: (p) => { p.bulletSpeed = (p.bulletSpeed || 400) + 50; }},
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
  
  if (isBot) {
    // Grid-based spawning for even bot distribution
    const gridCols = 4; // 4x4 grid for 10 bots
    const gridRows = 4;
    const cellWidth = WORLD_WIDTH / gridCols;
    const cellHeight = WORLD_HEIGHT / gridRows;
    
    // Find which grid cells already have bots
    const occupiedCells = new Set();
    for (const id in world.players) {
      if (world.players[id].isBot && world.players[id].alive) {
        const col = Math.floor(world.players[id].x / cellWidth);
        const row = Math.floor(world.players[id].y / cellHeight);
        occupiedCells.add(`${col},${row}`);
      }
    }
    
    // Find an unoccupied cell
    let foundCell = false;
    for (let row = 0; row < gridRows && !foundCell; row++) {
      for (let col = 0; col < gridCols && !foundCell; col++) {
        if (!occupiedCells.has(`${col},${row}`)) {
          // Spawn in center of this cell with some randomness
          x = col * cellWidth + cellWidth / 2 + (Math.random() - 0.5) * cellWidth * 0.4;
          y = row * cellHeight + cellHeight / 2 + (Math.random() - 0.5) * cellHeight * 0.4;
          foundCell = true;
        }
      }
    }
    
    // If all cells occupied, fall back to random spawning
    if (!foundCell) {
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
    }
  } else {
    // Human players spawn randomly with distance check
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
  }
  
  return { x, y, level: isBot ? randomBotLevel() : 1 };
}

function createPlayerData(socketId, spawnPos, name, isBot, tankType = 5) {
  const level = spawnPos.level;
  let nextLevelExp;
  if (level === 1) {
    nextLevelExp = 1;
  } else if (level === 2) {
    nextLevelExp = 3;
  } else {
    nextLevelExp = level;
  }
  
  // Base stats by tank type
  const typeStats = {
    1: { // Defender - High HP/Armor, Slow speed
      health: 150, maxHealth: 150, damage: 18, speed: 120, rotationSpeed: 140, fireRate: 700,
      regenPerSecond: 2, bulletCount: 1, bulletSpeed: 350, armor: 3, size: 115
    },
    2: { // Speedster - High speed, Low HP
      health: 80, maxHealth: 80, damage: 15, speed: 220, rotationSpeed: 220, fireRate: 500,
      regenPerSecond: 1, bulletCount: 1, bulletSpeed: 500, armor: 0, size: 96
    },
    3: { // Destroyer - High damage, Slow
      health: 110, maxHealth: 110, damage: 30, speed: 110, rotationSpeed: 120, fireRate: 800,
      regenPerSecond: 1, bulletCount: 1, bulletSpeed: 380, armor: 1, size: 134
    },
    4: { // Healer - High regen, Support
      health: 100, maxHealth: 100, damage: 12, speed: 150, rotationSpeed: 160, fireRate: 550,
      regenPerSecond: 5, bulletCount: 1, bulletSpeed: 420, armor: 1, size: 114
    },
    5: { // Balanced - All-around
      health: 100, maxHealth: 100, damage: 20, speed: 160, rotationSpeed: 180, fireRate: 600,
      regenPerSecond: 1.5, bulletCount: 1, bulletSpeed: 400, armor: 1, size: 104
    }
  };
  
  const stats = typeStats[tankType] || typeStats[5];
  
  return {
    id: socketId, name,
    x: spawnPos.x, y: spawnPos.y, angle: Math.random() * 360,
    kills: 0, deaths: 0, score: 0, exp: 0,
    level: level, nextLevelExp: nextLevelExp,
    tankType: tankType,
    health: isBot ? 50 : stats.health, maxHealth: isBot ? 50 : stats.maxHealth,
    damage: isBot ? 5 : stats.damage, speed: isBot ? 130 : stats.speed,
    rotationSpeed: isBot ? 240 : stats.rotationSpeed, fireRate: isBot ? 1000 : stats.fireRate,
    regenPerSecond: isBot ? 1 : stats.regenPerSecond,
    bulletCount: 1, bulletSpeed: isBot ? 400 : stats.bulletSpeed,
    armor: isBot ? 0 : stats.armor, size: isBot ? 60 : stats.size,
    alive: true,
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

let crateCounter = 0;
function createCrate() {
  crateCounter++;
  const id = `crate_${crateCounter}_${Date.now()}`;
  // Random position with margin from edges
  const x = 100 + Math.random() * (WORLD_WIDTH - 200);
  const y = 100 + Math.random() * (WORLD_HEIGHT - 200);
  world.crates[id] = {
    id,
    x,
    y,
    health: CRATE_HEALTH,
    maxHealth: CRATE_HEALTH,
    alive: true
  };
}

function ensureCrateCount() {
  let count = 0;
  for (const id in world.crates) if (world.crates[id].alive) count++;
  while (count < CRATE_COUNT) { createCrate(); count++; }
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
        bot._nextDecision = now + 1000 + Math.random() * 500; // Reduced frequency: 1000-1500ms
        let bestId = null, bestDist = Infinity;
        let bestCrateId = null, bestCrateDist = Infinity;
        
        // Find closest player
        for (const oid of playerIds) {
          if (oid === id) continue;
          const o = world.players[oid];
          if (!o.alive) continue;
          const d = Math.hypot(bot.x - o.x, bot.y - o.y);
          if (d < bestDist) { bestDist = d; bestId = oid; }
        }
        
        // Find closest crate
        for (const crateId in world.crates) {
          const crate = world.crates[crateId];
          if (!crate || !crate.alive) continue;
          const d = Math.hypot(bot.x - crate.x, bot.y - crate.y);
          if (d < bestCrateDist) { bestCrateDist = d; bestCrateId = crateId; }
        }
        
        // Prioritize players/bots over crates
        // Only target crates if no player is within 800 units
        if (bestId && bestDist < 800) {
          bot._targetId = bestId;
          bot._targetCrateId = null;
        } else if (bestCrateId) {
          bot._targetId = null;
          bot._targetCrateId = bestCrateId;
        } else {
          bot._targetId = bestId;
          bot._targetCrateId = null;
        }
        bot._dodgeDir = Math.random() > 0.5 ? 1 : -1;
      }

      // Handle crate targeting
      if (bot._targetCrateId) {
        const crate = world.crates[bot._targetCrateId];
        if (!crate || !crate.alive) { bot._targetCrateId = null; continue; }
        
        const dx = crate.x - bot.x, dy = crate.y - bot.y;
        const dist = Math.hypot(dx, dy);
        const aimAngle = Math.atan2(dy, dx) * (180 / Math.PI);

        let angleDiff = aimAngle - bot.angle;
        angleDiff = ((angleDiff + 180) % 360 + 360) % 360 - 180;
        const maxRot = (bot.rotationSpeed || 240) * delta;
        if (Math.abs(angleDiff) > maxRot) bot.angle += Math.sign(angleDiff) * maxRot;
        else bot.angle += angleDiff * 0.9;
        bot.angle = ((bot.angle % 360) + 360) % 360;

        const spd = (bot.speed || 130) * delta;
        const rad = aimAngle * (Math.PI / 180);
        
        let mx = 0, my = 0;
        if (dist > 300) {
          mx += Math.cos(rad) * spd * 0.5;
          my += Math.sin(rad) * spd * 0.5;
        } else if (dist < 200) {
          mx -= Math.cos(rad) * spd * 0.3;
          my -= Math.sin(rad) * spd * 0.3;
        }
        bot.x += mx; bot.y += my;
        bot.x = Math.max(30, Math.min(WORLD_WIDTH - 30, bot.x));
        bot.y = Math.max(30, Math.min(WORLD_HEIGHT - 30, bot.y));

        if (Math.abs(angleDiff) < 40 && dist < 600) {
          const fr = Math.max(1000, (bot.fireRate || 500) * 2);
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
      // Handle player targeting
      else if (bot._targetId) {
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
      
      // Check collision with crates first
      for (const crateId in world.crates) {
        const crate = world.crates[crateId];
        if (!crate || !crate.alive) continue;
        if (Math.hypot(b.x - crate.x, b.y - crate.y) < 70) {
          hit = true;
          const dmg = owner.damage || 20;
          crate.health = Math.max(0, crate.health - dmg);
          delete world.bullets[bulletId];
          
          if (crate.health <= 0) {
            crate.alive = false;
            delete world.crates[crateId];
            // Give XP reward to owner
            owner.exp = (owner.exp || 0) + CRATE_XP_REWARD;
            while (owner.exp >= owner.nextLevelExp) {
              owner.exp -= owner.nextLevelExp;
              owner.level++;
              if (owner.level === 2) {
                owner.nextLevelExp = 1;
              } else if (owner.level === 3) {
                owner.nextLevelExp = 3;
              } else {
                owner.nextLevelExp = owner.level;
              }
              queueBatch('levelUp', { id: owner.id, level: owner.level, exp: owner.exp, nextLevelExp: owner.nextLevelExp });
            }
          }
          break; // Bullet can only hit one thing
        }
      }
      
      // Check collision with players if bullet didn't hit crate
      if (!hit) {
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
                  // Calculate next level exp based on new level
                  if (owner.level === 2) {
                    owner.nextLevelExp = 1;
                  } else if (owner.level === 3) {
                    owner.nextLevelExp = 3;
                  } else {
                    owner.nextLevelExp = owner.level;
                  }
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
                    p.level = nl;
                    // Calculate next level exp based on level
                    if (nl === 1) {
                      p.nextLevelExp = 1;
                    } else if (nl === 2) {
                      p.nextLevelExp = 3;
                    } else {
                      p.nextLevelExp = nl;
                    }
                    p.exp = 0;
                    p.damage = 5; p.maxHealth = 50; p.health = 50;
                    p.speed = 130; p.rotationSpeed = 240; p.fireRate = 1000;
                    p.regenPerSecond = 1; p.bulletCount = 1; p.bulletSpeed = 500;
                    p.armor = 0; p.upgradeHistory = [];
                    applyRandomUpgradesForLevel(p, nl);
                  } else {
                    // Reset human player to default stats on death (preserve tank type)
                    const tankType = p.tankType || 5;
                    const typeStats = {
                      1: { health: 150, maxHealth: 150, damage: 18, speed: 120, rotationSpeed: 140, fireRate: 700, regenPerSecond: 2, bulletCount: 1, bulletSpeed: 350, armor: 3, size: 115 },
                      2: { health: 80, maxHealth: 80, damage: 15, speed: 220, rotationSpeed: 220, fireRate: 500, regenPerSecond: 1, bulletCount: 1, bulletSpeed: 500, armor: 0, size: 96 },
                      3: { health: 110, maxHealth: 110, damage: 30, speed: 110, rotationSpeed: 120, fireRate: 800, regenPerSecond: 1, bulletCount: 1, bulletSpeed: 380, armor: 1, size: 134 },
                      4: { health: 100, maxHealth: 100, damage: 12, speed: 150, rotationSpeed: 160, fireRate: 550, regenPerSecond: 5, bulletCount: 1, bulletSpeed: 420, armor: 1, size: 114 },
                      5: { health: 100, maxHealth: 100, damage: 20, speed: 160, rotationSpeed: 180, fireRate: 600, regenPerSecond: 1.5, bulletCount: 1, bulletSpeed: 400, armor: 1, size: 104 }
                    };
                    const stats = typeStats[tankType] || typeStats[5];
                    p.level = 1; p.nextLevelExp = 1; p.exp = 0;
                    p.tankType = tankType;
                    p.damage = stats.damage; p.maxHealth = stats.maxHealth; p.health = stats.maxHealth;
                    p.speed = stats.speed; p.rotationSpeed = stats.rotationSpeed; p.fireRate = stats.fireRate;
                    p.regenPerSecond = stats.regenPerSecond; p.bulletCount = stats.bulletCount; p.bulletSpeed = stats.bulletSpeed;
                    p.armor = stats.armor; p.size = stats.size; p.upgradeHistory = [];
                  }
                  queueBatch('respawn', { id: t.id, x: sp.x, y: sp.y, level: p.level, exp: p.exp, nextLevelExp: p.nextLevelExp, damage: p.damage, maxHealth: p.maxHealth, speed: p.speed, rotationSpeed: p.rotationSpeed, fireRate: p.fireRate, regenPerSecond: p.regenPerSecond, bulletCount: p.bulletCount, bulletSpeed: p.bulletSpeed, armor: p.armor, tankType: p.tankType, size: p.size, upgradeHistory: p.upgradeHistory });
                  queueBatch('leaderboard', buildLeaderboard());
                }
              }, delay);
              respawnTimeouts.set(t.id, timeoutId);
            }
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
  // Ensure tankType and size are included
  if (p.tankType) c.tankType = p.tankType;
  if (p.size) c.size = p.size;
  return c;
}

function sanitizeBullet(b) {
  const c = { ...b };
  delete c.vx; delete c.vy; delete c.created;
  return c;
}

// Tick loop: broadcast full state
setInterval(() => {
  const snapshot = { players: {}, bullets: [], crates: [] };
  for (const id in world.players) snapshot.players[id] = sanitize(world.players[id]);
  for (const id in world.bullets) snapshot.bullets.push(sanitizeBullet(world.bullets[id]));
  for (const id in world.crates) snapshot.crates.push({ id: world.crates[id].id, x: world.crates[id].x, y: world.crates[id].y, health: world.crates[id].health, maxHealth: world.crates[id].maxHealth });
  io.emit('worldState', snapshot);

  const realCount = Object.values(world.players).filter(p => !p.isBot).length;
  const botAlive = Object.values(world.players).filter(p => p.isBot && p.alive).length;
  const botDead = Object.values(world.players).filter(p => p.isBot && !p.alive).length;
  const total = Object.keys(world.players).length;
  logOnce(total > 0 ? `[WORLD] Real:${realCount} Bots:${botAlive}alive ${botDead}dead` : '');
}, NETWORK_TICK);

setInterval(botAI, AI_TICK);
setInterval(checkCollisions, COLLISION_TICK);
setInterval(ensureCrateCount, 5000); // Check every 5 seconds and respawn crates

io.on('connection', (socket) => {
  const sp = spawnPlayer(socket.id, false);
  world.players[socket.id] = createPlayerData(socket.id, sp, generateName(), false, 5); // Default to type 5 initially
  ensureBotCount();
  ensureCrateCount();

  console.log(`[CONNECT] ${socket.id} joins. Total: ${Object.keys(world.players).length}`);

  // Send current world snapshot to the new player immediately
  const snapshot = { players: {}, bullets: [], crates: [] };
  for (const id in world.players) snapshot.players[id] = sanitize(world.players[id]);
  for (const id in world.bullets) snapshot.bullets.push(sanitizeBullet(world.bullets[id]));
  for (const id in world.crates) snapshot.crates.push({ id: world.crates[id].id, x: world.crates[id].x, y: world.crates[id].y, health: world.crates[id].health, maxHealth: world.crates[id].maxHealth });
  socket.emit('worldState', snapshot);

  const lb = buildLeaderboard();
  socket.emit('leaderboardUpdate', lb);
  io.emit('leaderboardUpdate', lb);

  socket.on('join', (data) => {
    const name = data && data.name ? String(data.name).trim() : '';
    const tankType = data && data.tankType ? data.tankType : 5;
    socket.tankType = tankType;
    if (name && world.players[socket.id]) {
      world.players[socket.id].name = name;
      // Update tank type and recalculate stats
      const typeStats = {
        1: { health: 150, maxHealth: 150, damage: 18, speed: 120, rotationSpeed: 140, fireRate: 700, regenPerSecond: 2, bulletCount: 1, bulletSpeed: 350, armor: 3, size: 115 },
        2: { health: 80, maxHealth: 80, damage: 15, speed: 220, rotationSpeed: 220, fireRate: 500, regenPerSecond: 1, bulletCount: 1, bulletSpeed: 500, armor: 0, size: 96 },
        3: { health: 110, maxHealth: 110, damage: 30, speed: 110, rotationSpeed: 120, fireRate: 800, regenPerSecond: 1, bulletCount: 1, bulletSpeed: 380, armor: 1, size: 134 },
        4: { health: 100, maxHealth: 100, damage: 12, speed: 150, rotationSpeed: 160, fireRate: 550, regenPerSecond: 5, bulletCount: 1, bulletSpeed: 420, armor: 1, size: 114 },
        5: { health: 100, maxHealth: 100, damage: 20, speed: 160, rotationSpeed: 180, fireRate: 600, regenPerSecond: 1.5, bulletCount: 1, bulletSpeed: 400, armor: 1, size: 104 }
      };
      const stats = typeStats[tankType] || typeStats[5];
      world.players[socket.id].tankType = tankType;
      world.players[socket.id].health = stats.health;
      world.players[socket.id].maxHealth = stats.maxHealth;
      world.players[socket.id].damage = stats.damage;
      world.players[socket.id].speed = stats.speed;
      world.players[socket.id].rotationSpeed = stats.rotationSpeed;
      world.players[socket.id].fireRate = stats.fireRate;
      world.players[socket.id].regenPerSecond = stats.regenPerSecond;
      world.players[socket.id].bulletCount = stats.bulletCount;
      world.players[socket.id].bulletSpeed = stats.bulletSpeed;
      world.players[socket.id].armor = stats.armor;
      world.players[socket.id].size = stats.size;
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
    ensureCrateCount();
  });
});

ensureBotCount();
ensureCrateCount();
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
    console.log(`TANK BATTLE.IO — ONE WORLD on port ${PORT}`);
});