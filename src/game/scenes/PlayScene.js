import * as Phaser from 'phaser';
import Tank from '../entities/Tank.js';
import Bullet from '../entities/Bullet.js';
import socketManager from '../network/SocketManager.js';
import { getRandomUpgrades } from '../upgrades/UpgradeDefinitions.js';

export default class PlayScene extends Phaser.Scene {
  constructor() {
    super('PlayScene');
    this.tanks = {};
    this.bullets = {};
    this.worldSize = { width: 2100, height: 2100 };
    this.config = { moveSpeed: 160, rotateSpeed: 180, fireRate: 600 };
    this.lastFireTime = 0;
    this.kills = 0;
    this.deaths = 0;
    this.score = 0;
    this.leaderboard = [];
    this.lastHitBy = null;
    this.myId = null;
    this.myLevel = 1;
    this.myExp = 0;
    this.myNextLevelExp = 3;
    this.pendingUpgrades = [];
    this._upgradeMenuActive = false;
    this._upgradeMenuElements = [];
    this._upgradeMenuTimers = [];
    this._joinSent = false;
    this._lastUIUpdate = 0;
  }

  create() {
    try {
      const { width, height } = this.worldSize;
      this.physics.world.setBounds(0, 0, width, height);
      this.cameras.main.setBounds(0, 0, width, height);

      this._drawBackground();
      this._createMinimap();
      this._setupInput();

      // Load all sounds
      this.load.audio('explosion', '/src/assets/explosion.wav');
      this.load.audio('background_music', '/src/assets/battle_music.ogg');
      this.load.audio('sad_game_over', '/src/assets/sad_game_over.wav');
      this.load.audio('levelup', '/src/assets/levelup_short.mp3');
      this.load.audio('collect_points', '/src/assets/collect_points.mp3');
      this.load.audio('select', '/src/assets/select.mp3');
      
      this.load.once('complete', () => {
        this.explosionSound = this.sound.add('explosion', { volume: 0.5 });
        this.backgroundMusic = this.sound.add('background_music', { volume: 0.4, loop: true });
        this.sadGameOverSound = this.sound.add('sad_game_over', { volume: 0.5 });
        this.levelupSound = this.sound.add('levelup', { volume: 0.5 });
        this.collectPointsSound = this.sound.add('collect_points', { volume: 0.4 });
        this.selectSound = this.sound.add('select', { volume: 0.5 });
        
        // Start background music
        if (this.backgroundMusic) {
          this.backgroundMusic.play();
        }
      });
      this.load.start();

      // Start with minimal sockets to avoid freeze
      this._setupSockets();
      this._createUI();

      socketManager.on('connect', () => {
        try {
          console.log('[CLIENT] Connected! Socket ID:', socketManager.id);
          this._sendJoin();
        } catch (e) { console.error('[CLIENT] connect handler error:', e); }
      });

      if (!socketManager.connected) {
        socketManager.connect();
      } else {
        console.log('[CLIENT] Already connected, sending join');
        this._sendJoin();
      }
    } catch (e) {
      console.error('[PLAYSCENE] create() crashed:', e);
      alert('Game initialization failed. Check console for details.');
    }
  }

  _sendJoin() {
    if (this._joinSent) return;
    this._joinSent = true;
    const name = window.__playerName;
    const tankType = window.__tankType || 5;
    if (name) socketManager.emit('join', { name, tankType });
  }

  _drawBackground() {
    const { width, height } = this.worldSize;
    // Màu nền xanh đen sâu theo yêu cầu
    this.cameras.main.setBackgroundColor('#0B0E14');
    
    // Grid với màu Cyan mờ theo phong cách Sci-Fi
    const grid = this.add.graphics();
    grid.lineStyle(1, 0x00F5FF, 0.15);
    for (let i = 0; i <= width; i += 100) grid.lineBetween(i, 0, i, height);
    for (let j = 0; j <= height; j += 100) grid.lineBetween(0, j, width, j);
    
    const sub = this.add.graphics();
    sub.lineStyle(1, 0x00BFFF, 0.08);
    for (let i = 0; i <= width; i += 25) if (i % 100 !== 0) sub.lineBetween(i, 0, i, height);
    for (let j = 0; j <= height; j += 25) if (j % 100 !== 0) sub.lineBetween(0, j, width, j);
    
    // Border với màu Cyan phát sáng
    const border = this.add.graphics();
    border.lineStyle(3, 0x00F5FF, 0.6);
    border.strokeRect(0, 0, width, height);
  }

  _createMinimap() {
    const { width, height } = this.worldSize;
    // Minimap với nền Glassmorphism
    this.minimap = this.cameras.add(10, 10, 180, 180)
      .setZoom(180 / width)
      .setBackgroundColor(0x0F172A)
      .setBounds(0, 0, width, height);
    this.minimap.setName('minimap');
    
    // Thêm viền Glassmorphism cho minimap
    const minimapBorder = this.add.graphics().setScrollFactor(0).setDepth(98);
    minimapBorder.lineStyle(2, 0x00F5FF, 0.4);
    minimapBorder.strokeRoundedRect(8, 8, 184, 184, 8);
  }

  _setupInput() {
    this.controls = {
      ...this.input.keyboard.createCursorKeys(),
      ...this.input.keyboard.addKeys('W,A,S,D,SPACE,ONE,TWO,THREE')
    };
  }

  _setupSockets() {
    socketManager.off('worldState');
    socketManager.off('playerDisconnected');
    socketManager.off('tankDied');

    socketManager.on('worldState', (state) => {
      try {
        // Sanity checks BEFORE processing
        if (!state) {
          console.warn('[WS] Received null/undefined state');
          return;
        }
        if (!state.players || typeof state.players !== 'object') {
          console.warn('[WS] Invalid state.players:', typeof state.players);
          return;
        }
        const playerCount = Object.keys(state.players).length;
        if (playerCount === 0) {
          console.warn('[WS] Empty players object');
          return;
        }
        if (playerCount > 100) {
          console.error('[WS] Suspicious player count:', playerCount, '- aborting');
          return;
        }
        this._onWorldState(state);
      } catch (e) {
        console.error('[WS] worldState handler crashed:', e);
      }
    });

    socketManager.on('playerDisconnected', (id) => {
      if (this.tanks[id]) { this.tanks[id].destroy(); delete this.tanks[id]; }
    });

    socketManager.on('tankDied', (data) => {
      if (!data) return;
      const { id } = data;
      if (this.tanks[id]) {
        this.tanks[id].die();
        // Play explosion sound if it's my tank or nearby
        this._playExplosionSound(id);
        // Play sad game over sound if it's my tank and return to menu
        if (id === this.myId) {
          this._playSadGameOver();
          // Return to menu after 2 seconds
          this.time.delayedCall(2000, () => {
            window.__returnToMenu = true;
            this.scene.stop();
            this.game.destroy(true);
          });
        }
      }
    });

    socketManager.on('playerRespawned', (data) => {
      if (!data) return;
      const { id, x, y, level, exp, nextLevelExp, damage, maxHealth, speed, rotationSpeed, fireRate, regenPerSecond, bulletCount, bulletSpeed, armor, upgradeHistory } = data;
      if (this.tanks[id]) {
        // Force reset to defaults for local player
        if (id === this.myId) {
          const defaultStats = {
            damage: 20,
            maxHealth: 100,
            speed: 130,
            rotationSpeed: 160,
            fireRate: 600,
            regenPerSecond: 1,
            bulletCount: 1,
            bulletSpeed: 500,
            armor: 0,
            upgradeHistory: []
          };
          this.tanks[id].respawn(defaultStats);
        } else {
          // Use server stats for other players/bots
          const resetStats = { damage, maxHealth, speed, rotationSpeed, fireRate, regenPerSecond, bulletCount, bulletSpeed, armor, upgradeHistory };
          this.tanks[id].respawn(resetStats);
        }
        this.tanks[id].setPosition(x, y);
        this.tanks[id].setNetworkTarget(x, y, this.tanks[id].angle);
        // Sync level and exp
        if (typeof level === 'number') this.tanks[id].setLevel(level);
        // Update local player stats
        if (id === this.myId) {
          this.myLevel = level || 1;
          this.myExp = exp || 0;
          this.myNextLevelExp = nextLevelExp || 3;
        }
      }
    });

    socketManager.on('leaderboardUpdate', (data) => {
      this.leaderboard = data || [];
    });

    socketManager.on('playerUpgradeChosen', (data) => {
      if (!data || !data.id) return;
      const tank = this.tanks[data.id];
      if (!tank) return;
      if (data.stats) for (const [k, v] of Object.entries(data.stats)) tank[k] = v;
      if (data.history) tank.upgradeHistory = data.history;
    });

    socketManager.on('playerLevelUp', (data) => {
      if (!data) return;
      const isMe = data.id === socketManager.id;
      if (isMe) {
        this.myLevel = data.level;
        this.myExp = data.exp;
        this.myNextLevelExp = data.nextLevelExp;
        this.pendingUpgrades.push(true);
        this._playLevelUp();
      }
    });

    socketManager.on('tankHealthUpdate', (data) => {
      if (!data || !data.id) return;
      const tank = this.tanks[data.id];
      if (!tank) return;
      if (typeof data.health === 'number') tank.health = data.health;
      if (typeof data.maxHealth === 'number') tank.maxHealth = data.maxHealth;
      tank._drawHealthBar();
    });
  }

  _onWorldState(state) {
    if (!state || !state.players) return;

    const receivedTankIds = new Set();
    const receivedBulletIds = new Set();

    // Validate socket ID exists
    const socketId = socketManager.id;
    if (!socketId) {
      console.warn('[WS] No socket ID yet, skipping frame');
      return;
    }

    console.log('[WS] Socket ID:', socketId, 'Players in state:', Object.keys(state.players));
    
    if (!this.myId && state.players[socketId]) {
      this.myId = socketId;
      console.log('[WS] Set myId to:', this.myId);
    }
    if (this.myId && state.players && !state.players[this.myId] && socketManager.id && state.players[socketManager.id]) {
      this.myId = socketManager.id;
      console.log('[WS] Updated myId to:', this.myId);
    }

    this.leaderboard = Object.values(state.players).map(p => ({
      id: p.id, name: p.name,
      kills: p.kills || 0, deaths: p.deaths || 0, score: p.score || 0,
      isBot: p.isBot || false
    }));

    if (this.myId && state.players[this.myId]) {
      const me = state.players[this.myId];
      if (typeof me.level === 'number') this.myLevel = me.level;
      if (typeof me.exp === 'number') this.myExp = me.exp;
      if (typeof me.nextLevelExp === 'number') this.myNextLevelExp = me.nextLevelExp;
    }

    for (const [id, pd] of Object.entries(state.players)) {
      receivedTankIds.add(id);

      if (this.tanks[id]) {
        this.tanks[id].setNetworkTarget(pd.x, pd.y, pd.angle);
        if (pd.name) this.tanks[id].setName(pd.name);
        if (pd.level) this.tanks[id].setLevel(pd.level);
        if (pd.tankType && this.tanks[id].tankType !== pd.tankType) {
          this.tanks[id].tankType = pd.tankType;
          this.tanks[id]._createGraphics();
          if (this.tanks[id].body) {
            this.tanks[id].body.setCircle(this.tanks[id].size / 2, -this.tanks[id].size / 2, -this.tanks[id].size / 2);
          }
          console.log(`Updated tank ${id} to type ${pd.tankType}`);
        }
        // Update stats for my tank too
        if (this.tanks[id].isMine) {
          if (typeof pd.health === 'number') this.tanks[id].health = pd.health;
          if (typeof pd.maxHealth === 'number') this.tanks[id].maxHealth = pd.maxHealth;
          if (typeof pd.damage === 'number') this.tanks[id].damage = pd.damage;
          if (typeof pd.speed === 'number') this.tanks[id].speed = pd.speed;
          if (typeof pd.fireRate === 'number') this.tanks[id].fireRate = pd.fireRate;
          if (typeof pd.regenPerSecond === 'number') this.tanks[id].regenPerSecond = pd.regenPerSecond;
          if (typeof pd.bulletCount === 'number') this.tanks[id].bulletCount = pd.bulletCount;
          if (typeof pd.bulletSpeed === 'number') this.tanks[id].bulletSpeed = pd.bulletSpeed;
          if (typeof pd.armor === 'number') this.tanks[id].armor = pd.armor;
          if (typeof pd.rotationSpeed === 'number') this.tanks[id].rotationSpeed = pd.rotationSpeed;
          if (typeof pd.size === 'number') this.tanks[id].size = pd.size;
        }
        if (!this.tanks[id].isMine) {
          if (typeof pd.health === 'number') this.tanks[id].health = pd.health;
          if (typeof pd.maxHealth === 'number') this.tanks[id].maxHealth = pd.maxHealth;
          if (typeof pd.damage === 'number') this.tanks[id].damage = pd.damage;
          if (typeof pd.speed === 'number') this.tanks[id].speed = pd.speed;
          if (typeof pd.fireRate === 'number') this.tanks[id].fireRate = pd.fireRate;
          if (typeof pd.regenPerSecond === 'number') this.tanks[id].regenPerSecond = pd.regenPerSecond;
          if (typeof pd.bulletCount === 'number') this.tanks[id].bulletCount = pd.bulletCount;
          if (typeof pd.bulletSpeed === 'number') this.tanks[id].bulletSpeed = pd.bulletSpeed;
          if (typeof pd.armor === 'number') this.tanks[id].armor = pd.armor;
          if (typeof pd.rotationSpeed === 'number') this.tanks[id].rotationSpeed = pd.rotationSpeed;
          if (typeof pd.size === 'number') this.tanks[id].size = pd.size;
          if (pd.upgradeHistory) this.tanks[id].upgradeHistory = pd.upgradeHistory;
        }
        this.tanks[id]._drawHealthBar();
      } else {
        // Prevent duplicate tank creation
        if (this.tanks[id]) continue;
        const isMine = id === socketManager.id;
        const isBot = pd.isBot === true;
        console.log('[WS] Creating tank - ID:', id, 'isMine:', isMine, 'isBot:', isBot, 'socketId:', socketId);
        // For my tank, use the selected tankType from window, otherwise use server's tankType
        const tankType = isMine ? (window.__tankType || 5) : (pd.tankType || 5);
        const tank = new Tank(this, pd.x, pd.y, id, isMine, null, pd.name, pd.level, isBot, tankType);
        tank.setAngle(pd.angle || 0);
        if (typeof pd.health === 'number') tank.health = pd.health;
        if (!isMine) {
          if (typeof pd.damage === 'number') tank.damage = pd.damage;
          if (typeof pd.speed === 'number') tank.speed = pd.speed;
          if (typeof pd.fireRate === 'number') tank.fireRate = pd.fireRate;
          if (typeof pd.regenPerSecond === 'number') tank.regenPerSecond = pd.regenPerSecond;
          if (typeof pd.bulletCount === 'number') tank.bulletCount = pd.bulletCount;
          if (typeof pd.bulletSpeed === 'number') tank.bulletSpeed = pd.bulletSpeed;
          if (typeof pd.armor === 'number') tank.armor = pd.armor;
          if (typeof pd.rotationSpeed === 'number') tank.rotationSpeed = pd.rotationSpeed;
          if (typeof pd.maxHealth === 'number') tank.maxHealth = pd.maxHealth;
          if (typeof pd.size === 'number') tank.size = pd.size;
          if (pd.upgradeHistory) tank.upgradeHistory = pd.upgradeHistory;
        }
        this.tanks[id] = tank;
        if (isMine) {
          this.myId = id;
          this.cameras.main.startFollow(tank, true, 0.08, 0.08);
          this.cameras.main.setZoom(1);
          this.minimap.startFollow(tank, true);
          console.log('My tank:', id, 'at', pd.x, pd.y, 'type:', tankType);
        } else {
          console.log('Other tank:', id, 'at', pd.x, pd.y);
        }
      }
    }

    if (state.bullets) {
      for (const bd of state.bullets) {
        receivedBulletIds.add(bd.id);
        if (!this.bullets[bd.id]) {
          const bullet = new Bullet(this, bd.x, bd.y, bd.angle, bd.ownerId, 500, 10, bd.id);
          this.bullets[bd.id] = bullet;
          bullet.setDepth(5);
        }
      }
    }

    for (const id of Object.keys(this.bullets)) {
      if (!receivedBulletIds.has(id)) { 
        if (this.bullets[id]) this.bullets[id].destroy();
        delete this.bullets[id]; 
      }
    }
    for (const id of Object.keys(this.tanks)) {
      if (!receivedTankIds.has(id)) { 
        if (this.tanks[id]) this.tanks[id].destroy();
        delete this.tanks[id]; 
      }
    }
  }

  _fireBullet() {
    const myTank = this.myId ? this.tanks[this.myId] : null;
    if (!myTank || !myTank.alive) return;
    const now = this.time.now;
    if (now - this.lastFireTime < this.config.fireRate) return;
    this.lastFireTime = now;

    const count = myTank.bulletCount || 1;
    const spread = 0.2;
    const bulletSpeed = myTank.bulletSpeed || 500;
    if (this.myId) {
      for (let i = 0; i < count; i++) {
        const offset = (i - (count - 1) / 2) * spread;
        const a = myTank.angle + Phaser.Math.RadToDeg(offset);
        const rad = Phaser.Math.DegToRad(a);
        socketManager.emit('fireBullet', {
          x: myTank.x + Math.cos(rad) * 30, y: myTank.y + Math.sin(rad) * 30,
          angle: a, bulletId: `${this.myId}-${now}-${i}`, speed: bulletSpeed
        });
      }
    }
  }

  _createUI() {
    // ========================================
    // ÁP DỤNG GLASSMORPHISM CHO CÁC BẢNG UI
    // ========================================
    
    const W = this.scale.width;
    const H = this.scale.height;
    
    // Font Orbitron cho tất cả UI text
    const uiFont = 'Orbitron';
    
    this.scoreText = this.add.text(15, 200, '', {
      fontSize: '16px', color: '#00F5FF', fontFamily: uiFont,
      stroke: '#000000', strokeThickness: 3, fontStyle: 'bold'
    }).setScrollFactor(0).setDepth(100);
    
    // Leaderboard với Glassmorphism
    this.leaderboardBg = this.add.graphics().setScrollFactor(0).setDepth(99);
    this.leaderboardText = this.add.text(15, 245, '', {
      fontSize: '13px', color: '#ffffff', fontFamily: uiFont,
      stroke: '#000000', strokeThickness: 2
    }).setScrollFactor(0).setDepth(100);
    
    this.cooldownText = this.add.text(15, 165, '', {
      fontSize: '12px', color: '#00F5FF', fontFamily: uiFont,
      fontStyle: 'bold'
    }).setScrollFactor(0).setDepth(100);
    
    this.controlsHint = this.add.text(W / 2, H - 25, 'WASD / Arrows: Move | SPACE: Fire', {
      fontSize: '12px', color: 'rgba(0, 245, 255, 0.5)', fontFamily: uiFont
    }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(100);
    
    this.titleText = this.add.text(W / 2, 20, '⚔ TANK BATTLE.IO', {
      fontSize: '24px', color: '#00F5FF', fontFamily: uiFont,
      stroke: '#000000', strokeThickness: 4, fontStyle: 'bold',
      shadow: { blur: 10, color: '#00F5FF', fill: true }
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(100);

    this.xpBarY = H - 55;
    this.xpBarWidth = Math.min(420, W * 0.65);
    this.xpBarHeight = 14;
    this.xpBarX = (W - this.xpBarWidth) / 2;
    this.xpBarBg = this.add.graphics().setScrollFactor(0).setDepth(101);
    this.xpBarFill = this.add.graphics().setScrollFactor(0).setDepth(102);
    this.xpBarText = this.add.text(this.xpBarX + this.xpBarWidth / 2, this.xpBarY - 16, '', {
      fontSize: '12px', color: '#ffffff', fontFamily: uiFont,
      stroke: '#000000', strokeThickness: 2, fontStyle: 'bold'
    }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(103);
    
    // Character Stats với Glassmorphism
    this.statsBg = this.add.graphics().setScrollFactor(0).setDepth(99);
    this.statsText = this.add.text(15, 380, '', {
      fontSize: '12px', color: '#ffffff', fontFamily: uiFont,
      stroke: '#000000', strokeThickness: 2
    }).setScrollFactor(0).setDepth(100);
    
    // Upgrade History với Glassmorphism
    this.historyBg = this.add.graphics().setScrollFactor(0).setDepth(99);
    this.historyText = this.add.text(15, 380, '', {
      fontSize: '11px', color: '#00F5FF', fontFamily: uiFont,
      stroke: '#000000', strokeThickness: 1.5
    }).setScrollFactor(0).setDepth(100);
    this._upgradeChoiceContainer = this.add.container(0, 0).setScrollFactor(0).setDepth(200);
    
    // Make minimap ignore all UI elements
    this.minimap.ignore(this.scoreText);
    this.minimap.ignore(this.leaderboardBg);
    this.minimap.ignore(this.leaderboardText);
    this.minimap.ignore(this.cooldownText);
    this.minimap.ignore(this.controlsHint);
    this.minimap.ignore(this.titleText);
    this.minimap.ignore(this.xpBarBg);
    this.minimap.ignore(this.xpBarFill);
    this.minimap.ignore(this.xpBarText);
    this.minimap.ignore(this.statsBg);
    this.minimap.ignore(this.statsText);
    this.minimap.ignore(this.historyBg);
    this.minimap.ignore(this.historyText);
    this.minimap.ignore(this._upgradeChoiceContainer);
  }

  _drawCharacterStats() {
    if (!this.statsBg || !this.statsText) return;
    const myTank = this.myId ? this.tanks[this.myId] : null;
    const hp = myTank ? myTank.health : 0;
    const maxHp = myTank ? myTank.maxHealth : 100;
    const regen = myTank ? myTank.regenPerSecond || 0 : 0;
    const bullets = myTank ? myTank.bulletCount || 1 : 1;
    const fireRate = myTank ? myTank.fireRate || this.config.fireRate : this.config.fireRate;
    const spd = myTank ? myTank.speed || this.config.moveSpeed : this.config.moveSpeed;
    const dmg = myTank ? myTank.damage || 10 : 10;
    const armor = myTank ? myTank.armor || 0 : 0;
    
    this.statsText.setText(
      `⚡ CHARACTER STATS\n` +
      `Level: ${this.myLevel}\n` +
      `Exp: ${this.myExp}/${this.myNextLevelExp}\n` +
      `HP: ${hp} / ${maxHp} (+${regen}/s)\n` +
      `Damage: ${dmg} | Armor: ${armor}\n` +
      `Speed: ${spd}\n` +
      `Fire Rate: ${fireRate}ms\n` +
      `Bullets: ${bullets}/3`
    );
    
    // Áp dụng Glassmorphism cho background stats
    const bounds = this.statsText.getBounds();
    if (bounds) {
      this.statsBg.clear();
      // Nền Glassmorphism: #0F172A với độ trong suốt 60%
      this.statsBg.fillStyle(0x0F172A, 0.6);
      this.statsBg.fillRoundedRect(bounds.x - 8, bounds.y - 8, bounds.width + 16, bounds.height + 16, 8);
      // Viền mỏng trong suốt
      this.statsBg.lineStyle(1, 0xffffff, 0.15);
      this.statsBg.strokeRoundedRect(bounds.x - 8, bounds.y - 8, bounds.width + 16, bounds.height + 16, 8);
    }
    
    this._drawUpgradeHistory();
  }

  _drawUpgradeHistory() {
    if (!this.historyBg || !this.historyText) return;
    const myTank = this.myId ? this.tanks[this.myId] : null;
    if (!myTank) return;
    const history = myTank.upgradeHistory || [];
    const visibleHistory = history.slice(-10);
    if (visibleHistory.length === 0) {
      this.historyBg.clear();
      this.historyText.setText('');
      return;
    }
    let text = `📜 UPGRADE HISTORY\n` + `─`.repeat(22) + `\n`;
    visibleHistory.forEach((entry) => {
      text += `${entry.icon || '⬆'} ${entry.label} (Lv.${entry.levelChosen})\n`;
    });
    if (history.length > 10) text += `... and ${history.length - 10} more`;
    const statsBounds = this.statsText.getBounds();
    if (statsBounds) this.historyText.setPosition(15, statsBounds.y + statsBounds.height + 12);
    this.historyText.setText(text);
    const bounds = this.historyText.getBounds();
    
    // Áp dụng Glassmorphism cho background history
    this.historyBg.clear();
    // Nền Glassmorphism: #0F172A với độ trong suốt 60%
    this.historyBg.fillStyle(0x0F172A, 0.6);
    this.historyBg.fillRoundedRect(bounds.x - 8, bounds.y - 8, bounds.width + 16, bounds.height + 16, 8);
    // Viền mỏng trong suốt
    this.historyBg.lineStyle(1, 0xffffff, 0.15);
    this.historyBg.strokeRoundedRect(bounds.x - 8, bounds.y - 8, bounds.width + 16, bounds.height + 16, 8);
  }

  _showUpgradeChoices() {
    const myTank = this.myId ? this.tanks[this.myId] : null;
    if (!myTank) return;
    this._clearUpgradeMenu();
    const upgradeOptions = getRandomUpgrades(3);
    const W = this.scale.width;
    const H = this.scale.height;
    const boxY = this.xpBarY - 95;
    const boxWidth = 130;
    const boxHeight = 75;
    const gap = 10;
    const totalWidth = upgradeOptions.length * boxWidth + (upgradeOptions.length - 1) * gap;
    const startX = (W - totalWidth) / 2;
    // Upgrade menu với Glassmorphism
    const barBg = this.add.graphics().setScrollFactor(0).setDepth(199);
    // Nền Glassmorphism: #0F172A với độ trong suốt 60%
    barBg.fillStyle(0x0F172A, 0.6);
    barBg.fillRoundedRect(startX - 8, boxY - 8, totalWidth + 16, boxHeight + 16, 12);
    // Viền mỏng trong suốt với hiệu ứng phát sáng Cyan
    barBg.lineStyle(2, 0x00F5FF, 0.5);
    barBg.strokeRoundedRect(startX - 8, boxY - 8, totalWidth + 16, boxHeight + 16, 12);
    this._upgradeMenuElements.push(barBg);
    const hintText = this.add.text(W / 2, boxY - 22, '⬆ LEVEL UP! Choose an upgrade:', {
      fontSize: '14px', color: '#00F5FF', fontFamily: 'Orbitron',
      stroke: '#000000', strokeThickness: 3, fontStyle: 'bold'
    }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(201);
    this._upgradeMenuElements.push(hintText);
    upgradeOptions.forEach((opt, idx) => {
      const bx = startX + idx * (boxWidth + gap);
      const by = boxY;
      // Box cho từng option upgrade với Glassmorphism
      const boxBg = this.add.graphics().setScrollFactor(0).setDepth(200);
      boxBg.fillStyle(0x0F172A, 0.7);
      boxBg.fillRoundedRect(bx, by, boxWidth, boxHeight, 8);
      boxBg.lineStyle(2, 0x00F5FF, 0.4);
      boxBg.strokeRoundedRect(bx, by, boxWidth, boxHeight, 8);
      this._upgradeMenuElements.push(boxBg);
      const keyHint = this.add.text(bx + 4, by + 2, `[${idx + 1}]`, {
        fontSize: '11px', color: '#00F5FF', fontFamily: 'Orbitron',
        stroke: '#000000', strokeThickness: 2, fontStyle: 'bold'
      }).setScrollFactor(0).setDepth(201);
      this._upgradeMenuElements.push(keyHint);
      const iconText = this.add.text(bx + boxWidth / 2, by + 22, opt.icon || '⬆', {
        fontSize: '22px'
      }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(201);
      this._upgradeMenuElements.push(iconText);
      const labelText = this.add.text(bx + boxWidth / 2, by + 48, opt.label, {
        fontSize: '12px', color: '#ffffff', fontFamily: 'Orbitron',
        stroke: '#000000', strokeThickness: 2, fontStyle: 'bold'
      }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(201);
      this._upgradeMenuElements.push(labelText);
      const descText = this.add.text(bx + boxWidth / 2, by + 64, opt.desc, {
        fontSize: '10px', color: '#94a3b8', fontFamily: 'Orbitron',
        stroke: '#000000', strokeThickness: 1
      }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(201);
      this._upgradeMenuElements.push(descText);
    });
    const select = (idx) => {
      if (this._upgradeMenuActive === false) return;
      const opt = upgradeOptions[idx];
      if (!opt) return;
      console.log(`[UPGRADE] Selecting index ${idx}, key: ${opt.key}`);
      this._selectUpgrade(opt.key);
    };
    // Use only event.key checking to avoid conflicts
    this._upgradeMenuKeys = this.input.keyboard.on('keydown', (event) => {
      if (!this._upgradeMenuActive) return;
      if (event.key === '1') select(0);
      if (event.key === '2') select(1);
      if (event.key === '3') select(2);
    });
    this._upgradeMenuActive = true;
    const timer = this.time.delayedCall(10000, () => {
      if (this._upgradeMenuActive) this._clearUpgradeMenu();
    });
    this._upgradeMenuTimers.push(timer);
  }

  _selectUpgrade(key) {
    if (!this._upgradeMenuActive) return;
    this._upgradeMenuActive = false;
    const myTank = this.myId ? this.tanks[this.myId] : null;
    if (myTank) {
      myTank.applyUpgrade(key);
      this._playSelect();
      if (this.myId) {
        socketManager.emit('playerUpgradeChosen', {
          key: key,
          history: myTank.upgradeHistory,
          stats: {
            damage: myTank.damage,
            speed: myTank.speed,
            rotationSpeed: myTank.rotationSpeed,
            fireRate: myTank.fireRate,
            bulletCount: myTank.bulletCount,
            bulletSpeed: myTank.bulletSpeed || 400,
            maxHealth: myTank.maxHealth,
            regenPerSecond: myTank.regenPerSecond,
            armor: myTank.armor || 0
          }
        });
      }
    }
    this._clearUpgradeMenu();
  }

  _clearUpgradeMenu() {
    this._upgradeMenuActive = false;
    if (this._upgradeMenuKeys) { this.input.keyboard.off('keydown', this._upgradeMenuKeys); this._upgradeMenuKeys = null; }
    if (this._upgradeMenuKey1) { this.input.keyboard.removeKey(this._upgradeMenuKey1); this._upgradeMenuKey1 = null; }
    if (this._upgradeMenuKey2) { this.input.keyboard.removeKey(this._upgradeMenuKey2); this._upgradeMenuKey2 = null; }
    if (this._upgradeMenuKey3) { this.input.keyboard.removeKey(this._upgradeMenuKey3); this._upgradeMenuKey3 = null; }
    this._upgradeMenuTimers.forEach(t => t.destroy());
    this._upgradeMenuTimers = [];
    this._upgradeMenuElements.forEach(el => el.destroy());
    this._upgradeMenuElements = [];
  }

  _updateUI() {
    const W = this.scale.width;
    const H = this.scale.height;
    if (this.controlsHint) this.controlsHint.setPosition(W / 2, H - 25);
    if (this.titleText) this.titleText.setPosition(W / 2, 20);
    if (this.scoreText) this.scoreText.setText(`KILLS: ${this.kills} | DEATHS: ${this.deaths} | SCORE: ${this.score}`);
    if (this.xpBarBg) this.xpBarBg.setPosition(0, 0);
    if (this.xpBarFill) this.xpBarFill.setPosition(0, 0);
    this._drawXPBar();
    this._drawCharacterStats();
    if (this.leaderboardText) {
      if (this.leaderboard.length === 0) {
        this.leaderboardText.setText('🏆 LEADERBOARD\nWaiting for players...');
        this.leaderboardBg.clear();
      } else {
        const sorted = [...this.leaderboard].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 5);
        let lbText = '🏆 LEADERBOARD\n';
        sorted.forEach((entry, i) => {
          const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
          lbText += `${medal} ${entry.name || entry.id.slice(0, 6)}: ${entry.score || 0}\n`;
        });
        this.leaderboardText.setText(lbText);
        
        // Áp dụng Glassmorphism cho Leaderboard
        this.leaderboardBg.clear();
        // Nền Glassmorphism: #0F172A với độ trong suốt 60%
        this.leaderboardBg.fillStyle(0x0F172A, 0.6);
        this.leaderboardBg.fillRoundedRect(10, 240, 195, 20 + sorted.length * 18, 8);
        // Viền mỏng trong suốt
        this.leaderboardBg.lineStyle(1, 0xffffff, 0.15);
        this.leaderboardBg.strokeRoundedRect(10, 240, 195, 20 + sorted.length * 18, 8);
      }
    }
    if (this.cooldownText) {
      const myTank = this.myId ? this.tanks[this.myId] : null;
      if (myTank && myTank.alive) {
        const now = this.time.now;
        const elapsed = now - this.lastFireTime;
        const remaining = Math.max(0, this.config.fireRate - elapsed);
        this.cooldownText.setText(remaining > 0 ? `FIRE COOLDOWN: ${Math.ceil(remaining)}ms` : 'READY TO FIRE!');
      }
    }
  }

  _handleInput() {
    const myTank = this.myId ? this.tanks[this.myId] : null;
    if (!myTank) return;
    const { W, S, A, D, up, down, left, right, SPACE } = this.controls;
    const moveSpeed = myTank.speed || this.config.moveSpeed;
    const rotateSpeed = myTank.rotationSpeed || this.config.rotateSpeed;
    const delta = this.game.loop.delta / 1000;
    let rotated = false, moved = false;
    if (left.isDown || A.isDown) { myTank.angle -= rotateSpeed * delta; rotated = true; }
    else if (right.isDown || D.isDown) { myTank.angle += rotateSpeed * delta; rotated = true; }
    if (up.isDown || W.isDown) {
      const r = Phaser.Math.DegToRad(myTank.angle);
      myTank.x += Math.cos(r) * moveSpeed * delta;
      myTank.y += Math.sin(r) * moveSpeed * delta;
      moved = true;
    } else if (down.isDown || S.isDown) {
      const r = Phaser.Math.DegToRad(myTank.angle);
      myTank.x -= Math.cos(r) * moveSpeed * delta;
      myTank.y -= Math.sin(r) * moveSpeed * delta;
      moved = true;
    }
    if (myTank.x < 25) myTank.x = 25;
    if (myTank.x > this.worldSize.width - 25) myTank.x = this.worldSize.width - 25;
    if (myTank.y < 25) myTank.y = 25;
    if (myTank.y > this.worldSize.height - 25) myTank.y = this.worldSize.height - 25;
    if ((moved || rotated) && this.myId) {
      socketManager.emit('playerMovement', { x: myTank.x, y: myTank.y, angle: myTank.angle });
    }
    if (SPACE.isDown) this._fireBullet();
  }

  _updateBullets(delta) {
    for (const id of Object.keys(this.bullets)) {
      const bullet = this.bullets[id];
      if (!bullet || !bullet.alive) {
        if (bullet) bullet.destroy();
        delete this.bullets[id];
        continue;
      }
      const alive = bullet.update(this.time.now, delta);
      if (!alive) {
        delete this.bullets[id];
        continue;
      }
      this._checkBulletCollision(bullet);
    }
  }

  _checkBulletCollision(bullet) {
    if (!bullet.alive || bullet.ownerId === this.myId) return;
    const myTank = this.myId ? this.tanks[this.myId] : null;
    if (!myTank || !myTank.alive) return;
    const dist = Phaser.Math.Distance.Between(bullet.x, bullet.y, myTank.x, myTank.y);
    if (dist < 40) {
      bullet.onHit();
      // Check if this bullet killed the tank (health <= 0)
      if (myTank.health <= 0) {
        // Play collect/kill sound for the shooter
        const shooterTank = this.tanks[bullet.ownerId];
        if (shooterTank && shooterTank.isMine) {
          this._playCollectPoints();
        }
      }
    }
  }

  update(time, delta) {
    try {
      this._handleInput();
      Object.values(this.tanks).forEach(tank => tank.update(time));
      this._updateBullets(delta);
      // Throttle UI updates to every 100ms
      if (time - this._lastUIUpdate > 100) {
        this._updateUI();
        this._lastUIUpdate = time;
      }
      if (this.pendingUpgrades.length > 0 && !this._upgradeMenuActive) {
        this.pendingUpgrades.shift();
        this._showUpgradeChoices();
      }
    } catch (e) {
      console.error('[PLAYSCENE] update() crashed:', e);
    }
  }

  _drawXPBar() {
    if (!this.xpBarBg || !this.xpBarFill || !this.xpBarText) return;
    this.xpBarBg.clear();
    
    // Nền thanh XP với Glassmorphism
    this.xpBarBg.fillStyle(0x0F172A, 0.7);
    this.xpBarBg.fillRoundedRect(this.xpBarX, this.xpBarY, this.xpBarWidth, this.xpBarHeight, 8);
    // Viền mỏng trong suốt
    this.xpBarBg.lineStyle(1, 0xffffff, 0.2);
    this.xpBarBg.strokeRoundedRect(this.xpBarX, this.xpBarY, this.xpBarWidth, this.xpBarHeight, 8);
    
    this.xpBarFill.clear();
    const pct = Math.max(0, Math.min(1, this.myExp / (this.myNextLevelExp || 1)));
    const fillW = Math.max(0, this.xpBarWidth * pct);
    // Màu Cyan cho thanh XP theo phong cách Sci-Fi
    const color = pct >= 1 ? 0xFFD700 : 0x00F5FF;
    this.xpBarFill.fillStyle(color, 1);
    if (fillW > 0) this.xpBarFill.fillRoundedRect(this.xpBarX, this.xpBarY, fillW, this.xpBarHeight, 8);
    
    // Hiệu ứng phát sáng cho thanh XP
    if (fillW > 0) {
      this.xpBarFill.lineStyle(1, color, 0.5);
      this.xpBarFill.strokeRoundedRect(this.xpBarX, this.xpBarY, fillW, this.xpBarHeight, 8);
    }
    
    this.xpBarText.setText(`Lv. ${this.myLevel} — ${this.myExp} / ${this.myNextLevelExp} XP`);
  }

  _playExplosionSound(tankId) {
    if (!this.explosionSound) return;
    
    const myTank = this.myId ? this.tanks[this.myId] : null;
    const deadTank = this.tanks[tankId];
    
    if (!myTank || !deadTank) return;
    
    // Play if it's my tank or if the dead tank is nearby (within 500 pixels)
    const isMyTank = tankId === this.myId;
    const distance = Phaser.Math.Distance.Between(myTank.x, myTank.y, deadTank.x, deadTank.y);
    const isNearby = distance < 500;
    
    if (isMyTank || isNearby) {
      // Adjust volume based on distance
      let volume = 0.5;
      if (!isMyTank) {
        volume = 0.5 * (1 - distance / 500);
      }
      this.explosionSound.setVolume(Math.max(0.1, volume));
      this.explosionSound.play();
    }
  }

  _playSadGameOver() {
    if (!this.sadGameOverSound) return;
    // Stop background music when sad music plays
    if (this.backgroundMusic && this.backgroundMusic.isPlaying) {
      this.backgroundMusic.stop();
    }
    this.sadGameOverSound.play({ duration: 2000 }); // Limit to 2 seconds
    // Resume background music after 2 seconds
    this.time.delayedCall(2000, () => {
      if (this.backgroundMusic) {
        this.backgroundMusic.play();
      }
    });
  }

  _playLevelUp() {
    if (!this.levelupSound) return;
    this.levelupSound.play();
  }

  _playCollectPoints() {
    if (!this.collectPointsSound) return;
    this.collectPointsSound.play();
  }

  _playSelect() {
    if (!this.selectSound) return;
    this.selectSound.play();
  }

  destroy() {
    this._clearUpgradeMenu();
    super.destroy();
  }
}