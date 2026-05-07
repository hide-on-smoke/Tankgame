import React, { useEffect } from 'react';
import * as Phaser from 'phaser';
import { io } from 'socket.io-client';

const socket = io('http://localhost:3001');

class PlayScene extends Phaser.Scene {
  constructor() {
    super('PlayScene');
    this.myTank = null;
    this.otherTanks = {};
    this.worldSize = { width: 2000, height: 2000 };
    this.config = { moveSpeed: 3, rotateSpeed: 2 };
  }

  create() {
    const { width, height } = this.worldSize;
    this.physics.world.setBounds(0, 0, width, height);

    // 1. Vẽ nền lưới (Grid)
    const graphics = this.add.graphics().lineStyle(2, 0x333333, 1);
    for (let i = 0; i <= width; i += 100) graphics.lineBetween(i, 0, i, height);
    for (let j = 0; j <= height; j += 100) graphics.lineBetween(0, j, width, j);

    // 2. Thiết lập phím điều khiển
    this.controls = {
      ...this.input.keyboard.createCursorKeys(),
      ...this.input.keyboard.addKeys('W,A,S,D')
    };

    // 3. Khởi tạo Camera Minimap
    this.minimap = this.cameras.add(10, 10, 150, 150)
      .setZoom(0.07).setBackgroundColor(0x000000).setBounds(0, 0, width, height);

    this.setupSockets();
  }

  setupSockets() {
    socket.on('currentPlayers', (players) => {
      Object.entries(players).forEach(([id, info]) => {
        id === socket.id ? this.createTank(info, true) : this.createTank(info, false);
      });
    });

    socket.on('newPlayer', (info) => this.createTank(info, false));

    socket.on('playerMoved', ({ id, x, y, angle }) => {
      if (this.otherTanks[id]) {
        this.otherTanks[id].setPosition(x, y).setAngle(angle);
      }
    });

    socket.on('playerDisconnected', (id) => {
      if (this.otherTanks[id]) {
        this.otherTanks[id].destroy();
        delete this.otherTanks[id];
      }
    });
  }

  createTank(info, isMine) {
    const color = isMine ? 0x00ff00 : 0xff0000;
    const tank = this.add.container(info.x, info.y);
    
    const body = this.add.rectangle(0, 0, 44, 44, color).setStrokeStyle(isMine ? 3 : 2, 0xffffff);
    const cannon = this.add.rectangle(22, 0, 24, 10, color).setStrokeStyle(2, 0xffffff);
    tank.add([body, cannon]).setAngle(info.angle || 0);

    if (isMine) {
      this.myTank = tank;
      this.physics.world.enable(tank);
      tank.body.setCollideWorldBounds(true).setSize(44, 44);
      this.cameras.main.startFollow(tank, true, 0.1, 0.1);
      this.minimap.startFollow(tank, true);
    } else {
      this.otherTanks[info.id] = tank;
    }
  }

  update() {
    if (!this.myTank) return;

    const { W, S, A, D, up, down, left, right } = this.controls;
    const { moveSpeed, rotateSpeed } = this.config;
    
    let moved = false;
    const isRotating = left.isDown || right.isDown || A.isDown || D.isDown;
    const isMoving = up.isDown || down.isDown || W.isDown || S.isDown;

    // Ưu tiên xoay khi đứng yên, hoặc tiến/lùi khi không xoay
    if (isRotating && !isMoving) {
      this.myTank.angle += (left.isDown || A.isDown) ? -rotateSpeed : rotateSpeed;
      moved = true;
    } 
    else if (isMoving && !isRotating) {
      const rotation = Phaser.Math.DegToRad(this.myTank.angle);
      const direction = (up.isDown || W.isDown) ? 1 : -1;
      this.myTank.x += Math.cos(rotation) * moveSpeed * direction;
      this.myTank.y += Math.sin(rotation) * moveSpeed * direction;
      moved = true;
    }

    if (moved) {
      socket.emit('playerMovement', { x: this.myTank.x, y: this.myTank.y, angle: this.myTank.angle });
    }
  }
}

function App() {
  useEffect(() => {
    const config = {
      type: Phaser.AUTO,
      parent: 'phaser-game',
      width: 800,
      height: 600,
      backgroundColor: '#1a1a1a',
      scene: PlayScene,
      physics: { default: 'arcade' },
      disableVisibilityChange: true
    };
    const game = new Phaser.Game(config);
    return () => {
      ['currentPlayers', 'newPlayer', 'playerMoved', 'playerDisconnected'].forEach(ev => socket.off(ev));
      game.destroy(true);
    };
  }, []);

  return (
    <div style={{ textAlign: 'center', backgroundColor: '#111', minHeight: '100vh', color: 'white', paddingTop: '20px' }}>
      <h2 style={{ color: '#00ff00' }}>TANK ONLINE </h2>
      <div id="phaser-game" style={{ border: '2px solid #333', display: 'inline-block' }}></div>
      <p style={{ opacity: 0.6 }}>WASD / Mũi tên</p>
    </div>
  );
}

export default App;