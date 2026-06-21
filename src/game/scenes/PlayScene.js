import * as Phaser from 'phaser';
import Tank from '../entities/Tank.js';
import Bullet from '../entities/Bullet.js';
import socketManager from '../network/SocketManager.js';

export default class PlayScene extends Phaser.Scene {
  constructor() {
    super('PlayScene');
    this.tanks = {};
    this.bullets = {};
    this.worldSize = { width: 3000, height: 3000 };
    this.config = { moveSpeed: 160, rotateSpeed: 180, fireRate: 300 };
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
  }

  create() {
    const { width, height } = this.worldSize;
    this.physics.world.setBounds(0, 0, width, height);
    this.cameras.main.setBounds(0, 0, width, height);

    this._drawBackground();
    this._createMinimap();
    this._setupInput();

    this._setupSockets();
    this._createUI();

    const serverUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
      ? 'http://localhost:3001'
      : `${window.location.protocol}//${window.location.hostname}:3001`;

    socketManager.on('connect', () => {
      const name = window.__playerName;
      if (name) {
        console.log('[CLIENT] Emitting join with name:', name);
        socketManager.emit('join', { name });
      }
    });
    socketManager.connect(serverUrl);
  }

  _drawBackground() {
    const { width, height } = this.worldSize;
    this.cameras.main.setBackgroundColor('#1a1a2e');
    const gridGraphics = this.add.graphics();
    gridGraphics.lineStyle(1, 0x333355, 0.3);
    for (let i = 0; i <= width; i += 100) gridGraphics.lineBetween(i, 0, i, height);
    for (let j = 0; j <= height; j += 100) gridGraphics.lineBetween(0, j, width, j);
    const subGrid = this.add.graphics();
    subGrid.lineStyle(1, 0x222244, 0.15);
    for (let i = 0; i <= width; i += 25) if (i % 100 !== 0) subGrid.lineBetween(i, 0, i, height);
    for (let j = 0; j <= height; j += 25) if (j % 100 !== 0) subGrid.lineBetween(0, j, width, j);
    const border = this.add.graphics();
    border.lineStyle(4, 0xff4444, 0.8);
    border.strokeRect(0, 0, width, height);
  }

  _createMinimap() {
    const { width, height } = this.worldSize;
    this.minimap = this.cameras.add(10, 10, 180, 180)
      .setZoom(180 / width)
      .setBackgroundColor(0x111122)
      .setBounds(0, 0, width, height);
    this.minimap.setName('minimap');
  }

  _setupInput() {
    this.controls = {
      ...this.input.keyboard.createCursorKeys(),
      ...this.input.keyboard.addKeys('W,A,S,D,SPACE')
    };
  }

  _setupSockets() {
    socketManager.off('worldState');
    socketManager.off('playerDisconnected');
    socketManager.off('tankDied');

    socketManager.on('worldState', (state) => {
      if (state && state.players) {
        const count = Object.keys(state.players).length;
        const names = Object.values(state.players).map(p => p.name || p.id.slice(0, 6)).join(', ');
        console.log('[CLIENT] worldState received:', count, 'players —', names);
      }
      this._onWorldState(state);
    });

    socketManager.on('playerDisconnected', (id) => {
      if (this.tanks[id]) {
        this.tanks[id].destroy();
        delete this.tanks[id];
      }
    });

    socketManager.on('tankDied', (data) => {
      if (!data) return;
      const { id } = data;
      if (this.tanks[id]) {
        this.tanks[id].die();
      }
    });

    socketManager.on('playerRespawned', (data) => {
      if (!data) return;
      const { id, x, y } = data;
      if (this.tanks[id]) {
        this.tanks[id].respawn();
        this.tanks[id].setPosition(x, y);
        this.tanks[id].setNetworkTarget(x, y, this.tanks[id].angle);
      }
    });

    socketManager.on('leaderboardUpdate', (data) => {
      console.log('[CLIENT] leaderboardUpdate received:', data);
      this.leaderboard = data || [];
      if (this.myId && data) {
        const me = data.find(p => p.id === this.myId);
        if (me) {
          this.kills = me.kills || 0;
          this.deaths = me.deaths || 0;
          this.score = me.score || 0;
        }
      }
    });

    socketManager.on('playerLevelUp', (data) => {
      if (!data) return;
      console.log('[CLIENT] playerLevelUp:', data);
      const isMe = data.id === socketManager.id;
      if (isMe) {
        this.myLevel = data.level;
        this.myExp = data.exp;
        this.myNextLevelExp = data.nextLevelExp;
        this.upgradeOptions = this._randomUpgrades(3);
        this.showUpgradeMenu();
      }
    });
  }

  _onWorldState(state) {
    if (!state) return;

    const receivedTankIds = new Set();
    const receivedBulletIds = new Set();

    // Sync my XP/Level from worldState so XP bar updates even without level-up event
    if (this.myId && state.players && state.players[this.myId]) {
      const me = state.players[this.myId];
      if (typeof me.level === 'number') this.myLevel = me.level;
      if (typeof me.exp === 'number') this.myExp = me.exp;
      if (typeof me.nextLevelExp === 'number') this.myNextLevelExp = me.nextLevelExp;
    }

    if (state.players) {
      for (const [id, playerData] of Object.entries(state.players)) {
        receivedTankIds.add(id);

        if (this.tanks[id]) {
          this.tanks[id].setNetworkTarget(playerData.x, playerData.y, playerData.angle);
          if (playerData.name) {
            this.tanks[id].setName(playerData.name);
          }
          if (playerData.level) {
            this.tanks[id].setLevel(playerData.level);
          }
          if (typeof playerData.health === 'number') {
            this.tanks[id].health = playerData.health;
            this.tanks[id]._drawHealthBar();
          }
        } else {
          const isMine = id === socketManager.id;
          const tank = new Tank(this, playerData.x, playerData.y, id, isMine, null, playerData.name, playerData.level);
          tank.setAngle(playerData.angle || 0);
          this.tanks[id] = tank;

          if (isMine) {
            this.myId = id;
            this.cameras.main.startFollow(tank, true, 0.08, 0.08);
            this.cameras.main.setZoom(1);
            this.minimap.startFollow(tank, true);
            console.log('My tank:', id, 'at', playerData.x, playerData.y);
          } else {
            console.log('Other tank:', id, 'at', playerData.x, playerData.y);
          }
        }
      }
    }

    if (state.bullets) {
      for (const bulletData of state.bullets) {
        receivedBulletIds.add(bulletData.id);

        const existing = this.bullets[bulletData.id];
        if (existing) {
          // skip
        } else {
          const bullet = new Bullet(this, bulletData.x, bulletData.y, bulletData.angle, bulletData.ownerId, 400, 10, bulletData.id);
          this.bullets[bulletData.id] = bullet;
          bullet.setDepth(5);
        }
      }
    }

    for (const id of Object.keys(this.bullets)) {
      if (!receivedBulletIds.has(id)) {
        this.bullets[id].destroy();
        delete this.bullets[id];
      }
    }

    for (const id of Object.keys(this.tanks)) {
      if (!receivedTankIds.has(id)) {
        this.tanks[id].destroy();
        delete this.tanks[id];
      }
    }
  }

  _fireBullet() {
    const myTank = this.myId ? this.tanks[this.myId] : null;
    if (!myTank || !myTank.alive) return;

    const now = this.time.now;
    const fireRate = myTank.fireRate || this.config.fireRate;
    if (now - this.lastFireTime < fireRate) return;
    this.lastFireTime = now;

    const count = myTank.bulletCount || 1;
    const spread = 0.2; // radians between bullets

    if (this.myId) {
      for (let i = 0; i < count; i++) {
        const offset = (i - (count - 1) / 2) * spread;
        const a = myTank.angle + Phaser.Math.RadToDeg(offset);
        const rad = Phaser.Math.DegToRad(a);
        const bulletX = myTank.x + Math.cos(rad) * 30;
        const bulletY = myTank.y + Math.sin(rad) * 30;
        socketManager.emit('fireBullet', {
          x: bulletX, y: bulletY, angle: a,
          bulletId: `${this.myId}-${now}-${i}`
        });
      }
    }
  }

  _createUI() {
    const W = this.scale.width;
    const H = this.scale.height;

    this.scoreText = this.add.text(15, 200, '', {
      fontSize: '18px', color: '#ffffff', fontFamily: 'Arial',
      stroke: '#000000', strokeThickness: 3
    }).setScrollFactor(0).setDepth(100);

    this.leaderboardBg = this.add.graphics().setScrollFactor(0).setDepth(99);
    this.leaderboardText = this.add.text(15, 245, '', {
      fontSize: '14px', color: '#ffffff', fontFamily: 'Arial',
      stroke: '#000000', strokeThickness: 2
    }).setScrollFactor(0).setDepth(100);

    this.cooldownText = this.add.text(15, 165, '', {
      fontSize: '13px', color: '#aaaaaa', fontFamily: 'Arial'
    }).setScrollFactor(0).setDepth(100);

    this.controlsHint = this.add.text(W / 2, H - 25,
      'WASD / Arrows: Move | SPACE: Fire', {
        fontSize: '13px', color: 'rgba(255,255,255,0.4)', fontFamily: 'Arial'
      }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(100);

    this.titleText = this.add.text(W / 2, 20, '⚔ TANK BATTLE.IO', {
      fontSize: '22px', color: '#00ff00', fontFamily: 'Arial',
      stroke: '#000000', strokeThickness: 3, fontStyle: 'bold'
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(100);

    this.xpBarY = H - 55;
    this.xpBarWidth = Math.min(420, W * 0.65);
    this.xpBarHeight = 14;
    this.xpBarX = (W - this.xpBarWidth) / 2;

    this.xpBarBg = this.add.graphics().setScrollFactor(0).setDepth(101);
    this.xpBarFill = this.add.graphics().setScrollFactor(0).setDepth(102);
    this.xpBarText = this.add.text(this.xpBarX + this.xpBarWidth / 2, this.xpBarY - 16, '', {
      fontSize: '13px', color: '#ffffff', fontFamily: 'Arial',
      stroke: '#000000', strokeThickness: 2
    }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(103);

    this.statsBg = this.add.graphics().setScrollFactor(0).setDepth(99);
    this.statsText = this.add.text(15, 380, '', {
      fontSize: '14px', color: '#ffffff', fontFamily: 'Arial',
      stroke: '#000000', strokeThickness: 2
    }).setScrollFactor(0).setDepth(100);

    this.upgradeBg = this.add.graphics().setScrollFactor(0).setDepth(200);
    this.upgradeOptions = [];
  }

  _updateUI() {
    const W = this.scale.width;
    const H = this.scale.height;

    if (this.controlsHint) this.controlsHint.setPosition(W / 2, H - 25);
    if (this.titleText) this.titleText.setPosition(W / 2, 20);
    if (this.scoreText) {
      this.scoreText.setText(`KILLS: ${this.kills} | DEATHS: ${this.deaths} | SCORE: ${this.score}`);
    }

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
        this.leaderboardBg.clear();
        this.leaderboardBg.fillStyle(0x000000, 0.4);
        this.leaderboardBg.fillRoundedRect(10, 240, 195, 20 + sorted.length * 18, 4);
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
    const { rotateSpeed } = this.config;
    const moveSpeed = myTank.speed || this.config.moveSpeed;
    const delta = this.game.loop.delta / 1000;
    let rotated = false, moved = false;

    if (left.isDown || A.isDown) { myTank.angle -= rotateSpeed * delta; rotated = true; }
    else if (right.isDown || D.isDown) { myTank.angle += rotateSpeed * delta; rotated = true; }

    if (up.isDown || W.isDown) {
      const rotation = Phaser.Math.DegToRad(myTank.angle);
      myTank.x += Math.cos(rotation) * moveSpeed * delta;
      myTank.y += Math.sin(rotation) * moveSpeed * delta;
      moved = true;
    } else if (down.isDown || S.isDown) {
      const rotation = Phaser.Math.DegToRad(myTank.angle);
      myTank.x -= Math.cos(rotation) * moveSpeed * delta;
      myTank.y -= Math.sin(rotation) * moveSpeed * delta;
      moved = true;
    }

    if (myTank.x < 25) myTank.x = 25;
    if (myTank.x > this.worldSize.width - 25) myTank.x = this.worldSize.width - 25;
    if (myTank.y < 25) myTank.y = 25;
    if (myTank.y > this.worldSize.height - 25) myTank.y = this.worldSize.height - 25;

    if ((moved || rotated) && this.myId) {
      socketManager.emit('playerMovement', {
        x: myTank.x, y: myTank.y, angle: myTank.angle
      });
    }

    if (SPACE.isDown) this._fireBullet();
  }

  _updateBullets(delta) {
    for (const id of Object.keys(this.bullets)) {
      const bullet = this.bullets[id];
      if (!bullet.alive) {
        bullet.destroy();
        delete this.bullets[id];
        continue;
      }
      const stillAlive = bullet.update(this.time.now, delta);
      if (!stillAlive) {
        bullet.destroy();
        delete this.bullets[id];
        continue;
      }
      this._checkBulletCollision(bullet);
    }
  }

  _checkBulletCollision(bullet) {
    if (!bullet.alive) return;
    if (bullet.ownerId === this.myId) return;

    const myTank = this.myId ? this.tanks[this.myId] : null;
    if (!myTank || !myTank.alive) return;

    const dist = Phaser.Math.Distance.Between(bullet.x, bullet.y, myTank.x, myTank.y);
    if (dist < 26) {
      bullet.onHit();
      // Use the original bulletId from server so it can be removed
      const bulletId = bullet.bulletId || `${bullet.ownerId}-${this.time.now}`;
      console.log('[CLIENT] bulletHit! bulletId=', bulletId, 'owner=', bullet.ownerId);
      socketManager.emit('bulletHit', {
        bulletId,
        shooterId: bullet.ownerId,
        targetId: this.myId,
        damage: 1
      });
    }
  }

  update(time, delta) {
    this._handleInput();
    Object.values(this.tanks).forEach(tank => tank.update());
    this._updateBullets(delta);
    this._updateUI();

    if (this.pendingUpgrades.length > 0) {
      this.showUpgradeMenu();
    }
  }

  _drawXPBar() {
    if (!this.xpBarBg || !this.xpBarFill || !this.xpBarText) return;

    this.xpBarBg.clear();
    this.xpBarBg.fillStyle(0x333333, 0.85);
    this.xpBarBg.fillRoundedRect(this.xpBarX, this.xpBarY, this.xpBarWidth, this.xpBarHeight, 6);

    this.xpBarFill.clear();
    const pct = Math.max(0, Math.min(1, this.myExp / (this.myNextLevelExp || 1)));
    const fillW = Math.max(0, this.xpBarWidth * pct);
    const color = pct >= 1 ? 0xffdd00 : 0x00ccff;
    this.xpBarFill.fillStyle(color, 1);
    if (fillW > 0) {
      this.xpBarFill.fillRoundedRect(this.xpBarX, this.xpBarY, fillW, this.xpBarHeight, 6);
    }

    this.xpBarText.setText(`Lv. ${this.myLevel} — ${this.myExp} / ${this.myNextLevelExp} XP`);
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
    this.statsText.setText(
      `📊 CHARACTER STATS\n` +
      `Level: ${this.myLevel}\n` +
      `Exp: ${this.myExp}/${this.myNextLevelExp}\n` +
      `HP: ${hp} / ${maxHp} (+${regen}/s)\n` +
      `Damage: ${dmg}\n` +
      `Speed: ${spd}\n` +
      `Fire Rate: ${fireRate}ms\n` +
      `Bullets: ${bullets}/3`
    );
  }

  showUpgradeMenu() {
    if (this.pendingUpgrades.length === 0) return;
    this.pendingUpgrades.shift();

    if (!this.upgradeBg || !this.upgradeOptions.length) return;

    const W = this.scale.width;
    const H = this.scale.height;
    const boxW = Math.min(520, W * 0.85);
    const boxH = 220;
    const boxX = (W - boxW) / 2;
    const boxY = (H - boxH) / 2 - 20;

    this.upgradeBg.clear();
    this.upgradeBg.fillStyle(0x000000, 0.85);
    this.upgradeBg.fillRoundedRect(boxX, boxY, boxW, boxH, 12);
    this.upgradeBg.lineStyle(2, 0x00ff00, 0.9);
    this.upgradeBg.strokeRoundedRect(boxX, boxY, boxW, boxH, 12);

    const title = this.add.text(W / 2, boxY + 24, '⬆ LEVEL UP! Choose an upgrade', {
      fontSize: '20px', color: '#00ff00', fontFamily: 'Arial',
      stroke: '#000000', strokeThickness: 3, fontStyle: 'bold'
    }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(201);

    const optionTexts = [];
    this.upgradeOptions.forEach((opt, idx) => {
      const y = boxY + 70 + idx * 48;
      const txt = this.add.text(W / 2, y, `[${idx + 1}] ${opt.label}`, {
        fontSize: '18px', color: '#ffffff', fontFamily: 'Arial',
        stroke: '#000000', strokeThickness: 2
      }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(201);
      optionTexts.push({ text: txt, key: opt.key });
    });

    const hint = this.add.text(W / 2, boxY + boxH - 18, 'Press 1/2/3 to select', {
      fontSize: '14px', color: '#aaaaaa', fontFamily: 'Arial'
    }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(201);

    const cleanup = () => {
      title.destroy();
      hint.destroy();
      optionTexts.forEach(o => o.text.destroy());
      this.upgradeBg.clear();
    };

    const select = (idx) => {
      if (!optionTexts[idx]) return;
      const key = optionTexts[idx].key;
      console.log('[UPGRADE] Selected:', key);
      if (this.tanks[this.myId]) {
        this.tanks[this.myId].applyUpgrade(key);
      }
      cleanup();
    };

    this.input.keyboard.once('keydown-ONE', () => select(0));
    this.input.keyboard.once('keydown-TWO', () => select(1));
    this.input.keyboard.once('keydown-THREE', () => select(2));

    setTimeout(() => {
      if (this.upgradeBg && this.upgradeBg.list && this.upgradeBg.list.length) cleanup();
    }, 8000);
  }

  _randomUpgrades(count) {
    const pool = [
      { key: 'damage', label: '🔥 +Damage' },
      { key: 'hp', label: '❤️ +Max HP' },
      { key: 'speed', label: '⚡ +Move Speed' },
      { key: 'firerate', label: '🚀 +Fire Rate' },
      { key: 'regen', label: '💚 +HP Regen' },
      { key: 'armor', label: '🛡️ +Armor' },
      { key: 'multishot', label: '🎯 +Multishot' }
    ];
    const shuffled = pool.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }

  destroy() {
    socketManager.disconnect();
    super.destroy();
  }
}
