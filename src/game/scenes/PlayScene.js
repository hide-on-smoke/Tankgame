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
  }

  _onWorldState(state) {
    if (!state) return;

    const receivedTankIds = new Set();
    const receivedBulletIds = new Set();

    if (state.players) {
      for (const [id, playerData] of Object.entries(state.players)) {
        receivedTankIds.add(id);

        if (this.tanks[id]) {
          this.tanks[id].setNetworkTarget(playerData.x, playerData.y, playerData.angle);
          if (playerData.name) {
            this.tanks[id].setName(playerData.name);
          }
        } else {
          const isMine = id === socketManager.id;
          const tank = new Tank(this, playerData.x, playerData.y, id, isMine, null, playerData.name);
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
          const bullet = new Bullet(this, bulletData.x, bulletData.y, bulletData.angle, bulletData.ownerId);
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
    if (now - this.lastFireTime < this.config.fireRate) return;
    this.lastFireTime = now;

    const angleRad = Phaser.Math.DegToRad(myTank.angle);
    const bulletX = myTank.x + Math.cos(angleRad) * 30;
    const bulletY = myTank.y + Math.sin(angleRad) * 30;

    if (this.myId) {
      socketManager.emit('fireBullet', {
        x: bulletX, y: bulletY, angle: myTank.angle,
        bulletId: `${this.myId}-${now}`
      });
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
  }

  _updateUI() {
    const W = this.scale.width;
    const H = this.scale.height;

    if (this.controlsHint) this.controlsHint.setPosition(W / 2, H - 25);
    if (this.titleText) this.titleText.setPosition(W / 2, 20);
    if (this.scoreText) {
      this.scoreText.setText(`KILLS: ${this.kills} | DEATHS: ${this.deaths} | SCORE: ${this.score}`);
    }

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
    const { moveSpeed, rotateSpeed } = this.config;
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
      socketManager.emit('bulletHit', {
        bulletId: `${bullet.ownerId}-${this.time.now}`,
        shooterId: bullet.ownerId,
        targetId: this.myId,
        damage: 10
      });
    }
  }

  update(time, delta) {
    this._handleInput();
    Object.values(this.tanks).forEach(tank => tank.update());
    this._updateBullets(delta);
    this._updateUI();
  }

  destroy() {
    socketManager.disconnect();
    super.destroy();
  }
}