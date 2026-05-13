import * as Phaser from 'phaser';
import { applyUpgradeByKey, getUpgradeByKey } from '../upgrades/UpgradeDefinitions.js';

export default class Tank extends Phaser.GameObjects.Container {
  constructor(scene, x, y, id, isMine, color = null, name = null, level = null, isBot = false) {
    super(scene, x, y);
    scene.add.existing(this);

    this.tankId = id;
    this.tankName = name || (isMine ? "You" : id.slice(0, 6));
    this.isMine = isMine;
    this.isBot = isBot;
    this.myColor = color || (isMine ? 0x00ff00 : (isBot ? 0xff8800 : 0xff0000));
    this.health = 100;
    this.maxHealth = 100;
    this.speed = 160;
    this.rotationSpeed = 180;
    this.damage = 20;
    this.alive = true;
    this.respawnTimer = 0;

    this.regenPerSecond = 1;
    this.bulletCount = 1;
    this.maxBullets = 3;
    this.lastRegenTime = 0;

    // Upgrade history — list of { key, label, icon, desc, levelChosen }
    this.upgradeHistory = [];
    // Smooth interpolation targets
    this.targetX = x;
    this.targetY = y;
    this.targetAngle = 0;
    this.lastUpdateTime = Date.now();

    this._createGraphics();
    this._createHealthBar();

    // Physics body
    if (isMine) {
      scene.physics.world.enable(this);
      this.body.setCircle(22, -22, -22);
      this.body.setCollideWorldBounds(true);
    }
  }

  _createGraphics() {
    const color = this.myColor;
    const stroke = 0xffffff;

    // Thân tank (body) - hình vuông bo góc
    this.bodyGfx = this.scene.add.graphics();
    this.bodyGfx.fillStyle(color, 1);
    this.bodyGfx.fillRoundedRect(-22, -22, 44, 44, 6);
    this.bodyGfx.lineStyle(this.isMine ? 3 : 2, stroke, 0.9);
    this.bodyGfx.strokeRoundedRect(-22, -22, 44, 44, 6);
    // Chi tiết trang trí thân
    this.bodyGfx.fillStyle(0xffffff, 0.1);
    this.bodyGfx.fillRect(-15, -15, 12, 12);

    // Tháp pháo (cannon)
    this.cannon = this.scene.add.graphics();
    this.cannon.fillStyle(color, 1);
    this.cannon.fillRect(0, -5, 28, 10);
    this.cannon.lineStyle(2, stroke, 0.9);
    this.cannon.strokeRect(0, -5, 28, 10);
    // Đầu nòng
    this.cannon.fillStyle(0xffffff, 0.4);
    this.cannon.fillRect(22, -3, 6, 6);

    // Nắp tháp (turret top)
    this.turret = this.scene.add.graphics();
    this.turret.fillStyle(0x888888, 1);
    this.turret.fillCircle(0, 0, 12);
    this.turret.lineStyle(2, 0xaaaaaa, 0.8);
    this.turret.strokeCircle(0, 0, 12);

    this.add([this.bodyGfx, this.turret, this.cannon]);
  }

  _createHealthBar() {
    // Health bar background
    this.healthBarBg = this.scene.add.graphics();
    this.healthBarBg.fillStyle(0x333333, 0.8);
    this.healthBarBg.fillRect(-22, -30, 44, 5);
    this.add(this.healthBarBg);

    // Health bar fill
    this.healthBar = this.scene.add.graphics();
    this._drawHealthBar();
    this.add(this.healthBar);

    // Name tag
    this.nameTag = this.scene.add.text(0, -38, this.tankName, {
      fontSize: '14px',
      color: '#ffffff',
      fontFamily: 'Arial',
      stroke: '#000000',
      strokeThickness: 3
    }).setOrigin(0.5, 0.5);
    this.add(this.nameTag);
  }

  setName(name) {
    if (!name || this.tankName === name) return;
    this.tankName = name;
    if (this.nameTag) this.nameTag.setText(`${this.tankName} [Lv.${this.tankLevel}]`);
  }

  setLevel(level) {
    const lv = Math.max(1, Number(level) || 1);
    if (this.tankLevel === lv) return;
    this.tankLevel = lv;
    if (this.nameTag) {
      this.nameTag.setText(`${this.tankName} [Lv.${this.tankLevel}]`);
      this.nameTag.setPosition(0, -52);
    }
  }

  applyUpgrade(key) {
    const upgrade = getUpgradeByKey(key);
    if (!upgrade) return false;
    upgrade.apply(this);
    // Record upgrade history with the level at which it was chosen
    this.upgradeHistory.push({
      key: upgrade.key,
      label: upgrade.label,
      icon: upgrade.icon,
      desc: upgrade.desc,
      levelChosen: this.tankLevel
    });
    if (this.scene && this.scene._drawCharacterStats) {
      this.scene._drawCharacterStats();
    }
    return true;
  }

  _drawHealthBar() {
    this.healthBar.clear();
    const healthPercent = this.health / this.maxHealth;
    const barColor = healthPercent > 0.5 ? 0x00ff00 : healthPercent > 0.25 ? 0xffaa00 : 0xff0000;
    this.healthBar.fillStyle(barColor, 1);
    this.healthBar.fillRect(-22, -30, 44 * healthPercent, 5);
  }

  takeDamage(amount) {
    if (!this.alive) return;
    this.health = Math.max(0, this.health - amount);
    this._drawHealthBar();

    // Flash effect
    this.scene.tweens.add({
      targets: this,
      alpha: 0.5,
      duration: 50,
      yoyo: true,
      ease: 'Power1'
    });

    if (this.health <= 0) {
      this.die();
    }
  }

  die() {
    this.alive = false;
    this.health = 0;
    this._drawHealthBar();
    this.setAlpha(0.3);
    if (this.body) {
      this.body.setEnable(false);
    }

    // Explosion effect
    const particles = this.scene.add.graphics();
    particles.fillStyle(0xff8800, 1);
    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI * 2 / 8) * i;
      const px = this.x + Math.cos(angle) * 20;
      const py = this.y + Math.sin(angle) * 20;
      particles.fillCircle(px, py, 4);
    }
    this.scene.tweens.add({
      targets: particles,
      alpha: 0,
      scaleX: 2,
      scaleY: 2,
      duration: 500,
      onComplete: () => particles.destroy()
    });
  }

  respawn(stats = null) {
    // Apply reset stats if provided
    if (stats) {
      if (typeof stats.damage === 'number') this.damage = stats.damage;
      if (typeof stats.maxHealth === 'number') this.maxHealth = stats.maxHealth;
      if (typeof stats.speed === 'number') this.speed = stats.speed;
      if (typeof stats.rotationSpeed === 'number') this.rotationSpeed = stats.rotationSpeed;
      if (typeof stats.fireRate === 'number') this.fireRate = stats.fireRate;
      if (typeof stats.regenPerSecond === 'number') this.regenPerSecond = stats.regenPerSecond;
      if (typeof stats.bulletCount === 'number') this.bulletCount = stats.bulletCount;
      if (typeof stats.bulletSpeed === 'number') this.bulletSpeed = stats.bulletSpeed;
      if (typeof stats.armor === 'number') this.armor = stats.armor;
      if (stats.upgradeHistory) this.upgradeHistory = stats.upgradeHistory;
    }
    this.health = this.maxHealth;
    this.alive = true;
    this.setAlpha(1);
    this._drawHealthBar();
    if (this.body) {
      this.body.setEnable(true);
    }
    // Spawn at random position
    const world = this.scene.worldSize;
    this.x = Phaser.Math.Between(100, world.width - 100);
    this.y = Phaser.Math.Between(100, world.height - 100);
    this.targetX = this.x;
    this.targetY = this.y;
  }

  setNetworkTarget(x, y, angle) {
    this.targetX = x;
    this.targetY = y;
    this.targetAngle = angle;
    this.lastUpdateTime = Date.now();
  }

  updateSmooth() {
    if (this.isMine || !this.alive) return;

    // Smooth interpolation for position
    this.x += (this.targetX - this.x) * 0.2;
    this.y += (this.targetY - this.y) * 0.2;

    // Smooth interpolation for angle with wrap-around handling
    let diff = this.targetAngle - this.angle;
    // Normalize to [-180, 180] using modulo instead of while loops
    diff = ((diff + 180) % 360 + 360) % 360 - 180;
    this.angle += diff * 0.35; // Much faster interpolation for smoother rotation
    // Normalize final angle to [0, 360) using modulo
    this.angle = ((this.angle % 360) + 360) % 360;
  }

  // Called each frame by the scene
  update(time) {
    if (!this.alive) return;

    if (!this.isMine) {
      this.updateSmooth();
    } else {
      // Regen tick - only for local player
      if (this.regenPerSecond > 0 && this.health < this.maxHealth) {
        this.lastRegenTime = this.lastRegenTime || 0;
        if (time - this.lastRegenTime >= 1000) {
          this.lastRegenTime = time;
          this.health = Math.min(this.maxHealth, this.health + this.regenPerSecond);
          this._drawHealthBar();
        }
      }
    }

    // Keep health bar elements positioned correctly
    this.healthBarBg.setPosition(0, 0);
    this.healthBar.setPosition(0, 0);
    this.nameTag.setPosition(0, -38);
  }

  destroy() {
    if (this.bodyGfx) this.bodyGfx.destroy();
    if (this.healthBarBg) this.healthBarBg.destroy();
    if (this.healthBar) this.healthBar.destroy();
    if (this.nameTag) this.nameTag.destroy();
    if (this.cannon) this.cannon.destroy();
    if (this.turret) this.turret.destroy();
    super.destroy();
  }
}