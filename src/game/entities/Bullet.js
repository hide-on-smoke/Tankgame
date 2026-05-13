import * as Phaser from 'phaser';

export default class Bullet extends Phaser.GameObjects.Graphics {
  constructor(scene, x, y, angle, ownerId, speed = 400, damage = 10) {
    super(scene);
    scene.add.existing(this);

    this.ownerId = ownerId;
    this.damage = damage;
    this.speed = speed;
    this.angle_rad = Phaser.Math.DegToRad(angle);
    this.alive = true;
    this.lifetime = 2000; // Bullet lives for 2 seconds max
    this.birthTime = scene.time.now;

    // Draw bullet - a small bright circle
    this.fillStyle(0xffff00, 1);
    this.fillCircle(0, 0, 4);
    this.lineStyle(1, 0xffffff, 0.8);
    this.strokeCircle(0, 0, 4);

    // Glow effect
    this.fillStyle(0xffff88, 0.3);
    this.fillCircle(0, 0, 7);

    // Set initial position
    this.setPosition(x, y);

    // Calculate velocity
    this.vx = Math.cos(this.angle_rad) * this.speed;
    this.vy = Math.sin(this.angle_rad) * this.speed;

    // Physics body for collision
    scene.physics.world.enable(this);
    this.body.setCircle(4, -4, -4);
    this.body.setAllowGravity(false);
  }

  update(time, delta) {
    if (!this.alive) return false;

    // Move bullet
    this.x += this.vx * (delta / 1000);
    this.y += this.vy * (delta / 1000);

    // Check lifetime
    if (time - this.birthTime > this.lifetime) {
      this.destroy();
      return false;
    }

    // Check world bounds
    const world = this.scene.worldSize;
    if (this.x < 0 || this.x > world.width || this.y < 0 || this.y > world.height) {
      this.destroy();
      return false;
    }

    return true;
  }

  onHit() {
    if (!this.alive) return;
    this.alive = false;

    // Create impact effect as separate graphics object
    const impact = this.scene.add.graphics();
    impact.fillStyle(0xff8800, 1);
    impact.fillCircle(this.x, this.y, 6);

    this.scene.tweens.add({
      targets: impact,
      alpha: 0,
      x: this.x,
      y: this.y,
      scaleX: 2,
      scaleY: 2,
      duration: 100,
      onComplete: () => impact.destroy()
    });

    // Hide the bullet immediately
    this.clear();
  }

  destroy() {
    this.alive = false;
    super.destroy();
  }
}