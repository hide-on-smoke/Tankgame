import * as Phaser from 'phaser';
import { applyUpgradeByKey, getUpgradeByKey } from '../upgrades/UpgradeDefinitions.js';

export default class Tank extends Phaser.GameObjects.Container {
  constructor(scene, x, y, id, isMine, color = null, name = null, level = null, isBot = false, tankType = 5) {
    super(scene, x, y);
    scene.add.existing(this);

    this.tankId = id;
    this.tankName = name || (isMine ? "You" : id.slice(0, 6));
    this.isMine = isMine;
    this.isBot = isBot;
    this.tankType = tankType || 5;
    this.tankLevel = level || 1;
    this.myColor = color || (isMine ? 0x00ff00 : (isBot ? 0xff8800 : 0xff0000));
    this.size = 70; // Default size (doubled from 35)
    
    // Tank-specific base stats
    this._applyTankBaseStats();
    
    this.alive = true;
    this.respawnTimer = 0;

    this.bulletCount = 1;
    this.maxBullets = 3;
    this.bulletSpeed = 400;
    this.fireRate = 600;
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
      this.body.setCircle(this.size / 2, -this.size / 2, -this.size / 2);
      this.body.setCollideWorldBounds(true);
    }
  }

  _applyTankBaseStats() {
    const type = this.tankType || 5;
    
    // Base stats for each tank type
    const tankStats = {
      1: { // Defender - High HP/Armor, Slow speed
        health: 150,
        maxHealth: 150,
        speed: 120,
        rotationSpeed: 140,
        damage: 18,
        regenPerSecond: 2,
        armor: 3,
        fireRate: 700,
        bulletSpeed: 350
      },
      2: { // Speedster - High speed, Low HP
        health: 80,
        maxHealth: 80,
        speed: 220,
        rotationSpeed: 220,
        damage: 15,
        regenPerSecond: 1,
        armor: 0,
        fireRate: 500,
        bulletSpeed: 500
      },
      3: { // Destroyer - High damage, Slow
        health: 110,
        maxHealth: 110,
        speed: 110,
        rotationSpeed: 120,
        damage: 30,
        regenPerSecond: 1,
        armor: 1,
        fireRate: 800,
        bulletSpeed: 380
      },
      4: { // Healer - High regen, Support
        health: 100,
        maxHealth: 100,
        speed: 150,
        rotationSpeed: 160,
        damage: 12,
        regenPerSecond: 5,
        armor: 1,
        fireRate: 550,
        bulletSpeed: 420
      },
      5: { // Balanced - All-around
        health: 100,
        maxHealth: 100,
        speed: 160,
        rotationSpeed: 180,
        damage: 20,
        regenPerSecond: 1.5,
        armor: 1,
        fireRate: 600,
        bulletSpeed: 400
      }
    };

    const stats = tankStats[type] || tankStats[5];
    this.health = stats.health;
    this.maxHealth = stats.maxHealth;
    this.speed = stats.speed;
    this.rotationSpeed = stats.rotationSpeed;
    this.damage = stats.damage;
    this.regenPerSecond = stats.regenPerSecond;
    this.armor = stats.armor;
    this.fireRate = stats.fireRate;
    this.bulletSpeed = stats.bulletSpeed;
  }

  _createGraphics() {
    const stroke = 0xffffff;
    const level = this.tankLevel || 1;
    const type = this.tankType || 5;
    
    // Clear existing graphics if any
    if (this.bodyGfx) this.bodyGfx.destroy();
    if (this.cannon) this.cannon.destroy();
    if (this.turret) this.turret.destroy();
    if (this.decorations) this.decorations.destroy();

    // Bot has unique simple appearance
    if (this.isBot) {
      this._createBotGraphics();
      return;
    }

    // Tank type colors - use these instead of myColor
    const typeColors = {
      1: 0x2e5a8c, // Defender - Dark Blue
      2: 0x1a8c1a, // Speedster - Dark Green
      3: 0x8c1a1a, // Destroyer - Dark Red
      4: 0x1a8c6e, // Healer - Dark Teal
      5: 0x8c6e1a  // Balanced - Dark Gold
    };
    const typeColor = typeColors[type] || 0x8c6e1a;

    // Size based on tank type (doubled, Defender reduced by 30%)
    const sizes = {
      1: 115, // Defender - Large (164 * 0.7)
      2: 96, // Speedster - Small (48 * 2)
      3: 134, // Destroyer - Large (67 * 2)
      4: 114, // Healer - Medium (57 * 2)
      5: 104  // Balanced - Medium (52 * 2)
    };
    this.size = sizes[type] || 52;
    const halfSize = this.size / 2;

    // Level-based visual evolution (10 levels)
    const levelTier = Math.min(Math.ceil(level / 1), 10);
    
    // Thân tank (body) - completely different shapes for each type
    this.bodyGfx = this.scene.add.graphics();
    
    if (type === 1) { // Defender - Heavy armored tank
      // Main body - rounded rectangle with armor plates
      this.bodyGfx.fillStyle(typeColor, 1);
      this.bodyGfx.fillRoundedRect(-halfSize, -halfSize + 5, this.size, this.size - 10, 8);
      this.bodyGfx.lineStyle(3, 0x4a7acc, 0.9);
      this.bodyGfx.strokeRoundedRect(-halfSize, -halfSize + 5, this.size, this.size - 10, 8);
      
      // Armor plates on sides
      this.bodyGfx.fillStyle(0x1a3a5c, 0.8);
      this.bodyGfx.fillRect(-halfSize - 5, -halfSize + 10, 8, this.size - 20);
      this.bodyGfx.fillRect(halfSize - 3, -halfSize + 10, 8, this.size - 20);
      this.bodyGfx.lineStyle(2, 0x6a9acc, 0.7);
      this.bodyGfx.strokeRect(-halfSize - 5, -halfSize + 10, 8, this.size - 20);
      this.bodyGfx.strokeRect(halfSize - 3, -halfSize + 10, 8, this.size - 20);
      
      // Front armor plate
      this.bodyGfx.fillStyle(0x2a4a7c, 0.9);
      this.bodyGfx.fillRect(halfSize - 15, -halfSize + 12, 12, this.size - 24);
      this.bodyGfx.lineStyle(2, 0x8abaff, 0.8);
      this.bodyGfx.strokeRect(halfSize - 15, -halfSize + 12, 12, this.size - 24);
      
      // Shield emblem in center
      this.bodyGfx.fillStyle(0xffd700, 0.7);
      this.bodyGfx.beginPath();
      this.bodyGfx.arc(0, 0, 12, 0, Math.PI * 2);
      this.bodyGfx.fillPath();
      this.bodyGfx.lineStyle(2, 0xffaa00, 0.9);
      this.bodyGfx.strokeCircle(0, 0, 12);
      
      // Level-based additions
      if (levelTier >= 5) {
        this.bodyGfx.lineStyle(2, 0xffd700, 0.6);
        this.bodyGfx.strokeCircle(0, 0, halfSize - 8);
      }
      if (levelTier >= 10) {
        this.bodyGfx.fillStyle(0xffd700, 0.3);
        this.bodyGfx.fillCircle(0, 0, halfSize - 10);
      }
    } 
    else if (type === 2) { // Speedster - Sleek dart shape
      // Main body - dart/arrow shape
      this.bodyGfx.fillStyle(typeColor, 1);
      this.bodyGfx.beginPath();
      this.bodyGfx.moveTo(halfSize + 5, 0); // Front tip
      this.bodyGfx.lineTo(halfSize - 5, -halfSize + 8);
      this.bodyGfx.lineTo(-halfSize, -halfSize + 12);
      this.bodyGfx.lineTo(-halfSize, halfSize - 12);
      this.bodyGfx.lineTo(halfSize - 5, halfSize - 8);
      this.bodyGfx.closePath();
      this.bodyGfx.fillPath();
      this.bodyGfx.lineStyle(2, 0x4acc4a, 0.9);
      this.bodyGfx.strokePath();
      
      // Engine glow at back
      this.bodyGfx.fillStyle(0x00ffff, 0.6);
      this.bodyGfx.beginPath();
      this.bodyGfx.arc(-halfSize + 5, 0, 6, 0, Math.PI * 2);
      this.bodyGfx.fillPath();
      
      // Side fins
      this.bodyGfx.fillStyle(0x00ff00, 0.7);
      this.bodyGfx.beginPath();
      this.bodyGfx.moveTo(-halfSize + 10, -halfSize + 12);
      this.bodyGfx.lineTo(-halfSize + 18, -halfSize + 18);
      this.bodyGfx.lineTo(-halfSize + 15, -halfSize + 8);
      this.bodyGfx.closePath();
      this.bodyGfx.fillPath();
      
      this.bodyGfx.beginPath();
      this.bodyGfx.moveTo(-halfSize + 10, halfSize - 12);
      this.bodyGfx.lineTo(-halfSize + 18, halfSize - 18);
      this.bodyGfx.lineTo(-halfSize + 15, halfSize - 8);
      this.bodyGfx.closePath();
      this.bodyGfx.fillPath();
      
      // Speed lines
      if (levelTier >= 3) {
        this.bodyGfx.lineStyle(1, 0x00ffff, 0.7);
        this.bodyGfx.beginPath();
        this.bodyGfx.moveTo(-halfSize - 3, 0);
        this.bodyGfx.lineTo(-halfSize - 12, 0);
        this.bodyGfx.strokePath();
      }
      if (levelTier >= 7) {
        this.bodyGfx.fillStyle(0x00ffff, 0.5);
        this.bodyGfx.fillCircle(halfSize - 8, 0, 3);
      }
      if (levelTier >= 10) {
        this.bodyGfx.lineStyle(1, 0x00ffff, 0.8);
        this.bodyGfx.strokeCircle(0, 0, halfSize - 5);
      }
    }
    else if (type === 3) { // Destroyer - Heavy assault tank
      // Main body - bulky rectangular with armor
      this.bodyGfx.fillStyle(0x3a1a1a, 1);
      this.bodyGfx.fillRoundedRect(-halfSize, -halfSize + 3, this.size, this.size - 6, 6);
      this.bodyGfx.lineStyle(3, 0x5a3a3a, 0.9);
      this.bodyGfx.strokeRoundedRect(-halfSize, -halfSize + 3, this.size, this.size - 6, 6);
      
      // Heavy front plating
      this.bodyGfx.fillStyle(typeColor, 1);
      this.bodyGfx.fillRect(halfSize - 12, -halfSize + 8, 14, this.size - 16);
      this.bodyGfx.lineStyle(2, 0xcc4a4a, 0.9);
      this.bodyGfx.strokeRect(halfSize - 12, -halfSize + 8, 14, this.size - 16);
      
      // Side armor plates
      this.bodyGfx.fillStyle(0x2a2a2a, 0.8);
      this.bodyGfx.fillRect(-halfSize - 4, -halfSize + 10, 6, this.size - 20);
      this.bodyGfx.fillRect(halfSize - 2, -halfSize + 10, 6, this.size - 20);
      this.bodyGfx.lineStyle(2, 0x4a4a4a, 0.7);
      this.bodyGfx.strokeRect(-halfSize - 4, -halfSize + 10, 6, this.size - 20);
      this.bodyGfx.strokeRect(halfSize - 2, -halfSize + 10, 6, this.size - 20);
      
      // Skull emblem in center
      this.bodyGfx.fillStyle(0xff0000, 0.7);
      this.bodyGfx.beginPath();
      this.bodyGfx.arc(0, 0, 10, 0, Math.PI * 2);
      this.bodyGfx.fillPath();
      this.bodyGfx.fillStyle(0x000000, 0.8);
      this.bodyGfx.fillCircle(-4, -3, 2);
      this.bodyGfx.fillCircle(4, -3, 2);
      
      if (levelTier >= 7) {
        this.bodyGfx.lineStyle(2, 0xff0000, 0.6);
        this.bodyGfx.strokeRoundedRect(-halfSize - 2, -halfSize + 1, this.size + 4, this.size - 2, 4);
      }
      if (levelTier >= 10) {
        this.bodyGfx.fillStyle(0xff0000, 0.3);
        this.bodyGfx.fillRoundedRect(-halfSize - 4, -halfSize + 3, this.size + 8, this.size - 6, 4);
      }
    }
    else if (type === 4) { // Healer - Medical support tank
      // Main body - rounded with cross pattern
      this.bodyGfx.fillStyle(typeColor, 1);
      this.bodyGfx.fillRoundedRect(-halfSize, -halfSize + 4, this.size, this.size - 8, 10);
      this.bodyGfx.lineStyle(3, 0x4acc8c, 0.9);
      this.bodyGfx.strokeRoundedRect(-halfSize, -halfSize + 4, this.size, this.size - 8, 10);
      
      // Medical cross in center
      this.bodyGfx.fillStyle(0xffffff, 0.95);
      this.bodyGfx.fillRect(-10, -halfSize + 8, 20, this.size - 16);
      this.bodyGfx.fillRect(-halfSize + 8, -10, this.size - 16, 20);
      
      // Glow effect around cross
      this.bodyGfx.fillStyle(0x00ff00, 0.3);
      this.bodyGfx.beginPath();
      this.bodyGfx.arc(0, 0, 15, 0, Math.PI * 2);
      this.bodyGfx.fillPath();
      
      // Heart symbol
      if (levelTier >= 3) {
        this.bodyGfx.fillStyle(0xff69b4, 0.8);
        this.bodyGfx.beginPath();
        this.bodyGfx.moveTo(0, halfSize - 15);
        this.bodyGfx.bezierCurveTo(-8, halfSize - 22, -14, halfSize - 10, 0, halfSize - 3);
        this.bodyGfx.bezierCurveTo(14, halfSize - 10, 8, halfSize - 22, 0, halfSize - 15);
        this.bodyGfx.fillPath();
      }
      
      if (levelTier >= 6) {
        this.bodyGfx.lineStyle(2, 0x00ff00, 0.6);
        this.bodyGfx.strokeCircle(0, 0, halfSize - 6);
      }
      if (levelTier >= 10) {
        this.bodyGfx.fillStyle(0x00ff00, 0.3);
        this.bodyGfx.fillCircle(0, 0, halfSize - 8);
      }
    }
    else { // Balanced - Classic tank shape
      // Main body - rounded rectangle
      this.bodyGfx.fillStyle(typeColor, 1);
      this.bodyGfx.fillRoundedRect(-halfSize, -halfSize + 4, this.size, this.size - 8, 8);
      this.bodyGfx.lineStyle(3, stroke, 0.9);
      this.bodyGfx.strokeRoundedRect(-halfSize, -halfSize + 4, this.size, this.size - 8, 8);
      
      // Tracks on sides
      this.bodyGfx.fillStyle(0x333333, 0.85);
      this.bodyGfx.fillRect(-halfSize - 5, -halfSize + 8, 7, this.size - 16);
      this.bodyGfx.fillRect(halfSize - 2, -halfSize + 8, 7, this.size - 16);
      this.bodyGfx.lineStyle(2, 0x555555, 0.7);
      this.bodyGfx.strokeRect(-halfSize - 5, -halfSize + 8, 7, this.size - 16);
      this.bodyGfx.strokeRect(halfSize - 2, -halfSize + 8, 7, this.size - 16);
      
      // Track details
      this.bodyGfx.fillStyle(0x666666, 0.6);
      for (let i = 0; i < 5; i++) {
        const y = -halfSize + 12 + i * 8;
        this.bodyGfx.fillRect(-halfSize - 5, y, 7, 2);
        this.bodyGfx.fillRect(halfSize - 2, y, 7, 2);
      }
      
      // Front armor plate
      this.bodyGfx.fillStyle(0x4a4a4a, 0.7);
      this.bodyGfx.fillRect(halfSize - 10, -halfSize + 10, 10, this.size - 20);
      this.bodyGfx.lineStyle(1, 0x666666, 0.6);
      this.bodyGfx.strokeRect(halfSize - 10, -halfSize + 10, 10, this.size - 20);
      
      // Star emblem
      if (levelTier >= 5) {
        this.bodyGfx.fillStyle(0xffd700, 0.8);
        this.bodyGfx.beginPath();
        for (let i = 0; i < 5; i++) {
          const angle = (Math.PI * 2 / 5) * i - Math.PI / 2;
          const r = 9;
          const x = Math.cos(angle) * r;
          const y = Math.sin(angle) * r;
          if (i === 0) this.bodyGfx.moveTo(x, y);
          else this.bodyGfx.lineTo(x, y);
        }
        this.bodyGfx.closePath();
        this.bodyGfx.fillPath();
      }
      
      if (levelTier >= 10) {
        this.bodyGfx.lineStyle(2, 0xffd700, 0.6);
        this.bodyGfx.strokeRoundedRect(-halfSize - 3, -halfSize + 1, this.size + 6, this.size - 2, 6);
      }
    }

    // Tháp pháo (cannon) - completely different for each type
    this.cannon = this.scene.add.graphics();
    
    if (type === 1) { // Defender - Short, thick cannon
      this.cannon.fillStyle(0x2e5a8c, 1);
      this.cannon.fillRect(0, -12, 28, 24);
      this.cannon.lineStyle(3, 0x4a7acc, 0.9);
      this.cannon.strokeRect(0, -12, 28, 24);
      
      // Cannon tip
      this.cannon.fillStyle(0x1a3a5c, 1);
      this.cannon.fillRect(20, -10, 10, 20);
      this.cannon.lineStyle(2, 0x6a9acc, 0.8);
      this.cannon.strokeRect(20, -10, 10, 20);
    }
    else if (type === 2) { // Speedster - Long, thin cannon
      this.cannon.fillStyle(typeColor, 1);
      this.cannon.fillRect(0, -4, 42, 8);
      this.cannon.lineStyle(2, 0x4acc4a, 0.9);
      this.cannon.strokeRect(0, -4, 42, 8);
      
      // Muzzle tip
      this.cannon.fillStyle(0x00ff00, 0.8);
      this.cannon.fillRect(35, -3, 10, 6);
      this.cannon.lineStyle(1, 0x00ffff, 0.9);
      this.cannon.strokeRect(35, -3, 10, 6);
    }
    else if (type === 3) { // Destroyer - Massive dual cannon
      this.cannon.fillStyle(0x3a1a1a, 1);
      this.cannon.fillRect(0, -16, 38, 14);
      this.cannon.fillRect(0, 2, 38, 14);
      this.cannon.lineStyle(2, 0xcc4a4a, 0.9);
      this.cannon.strokeRect(0, -16, 38, 14);
      this.cannon.strokeRect(0, 2, 38, 14);
      
      // Muzzle tips
      this.cannon.fillStyle(0x8c1a1a, 0.9);
      this.cannon.fillRect(32, -18, 10, 18);
      this.cannon.fillRect(32, 0, 10, 18);
      this.cannon.lineStyle(2, 0xff4a4a, 0.8);
      this.cannon.strokeRect(32, -18, 10, 18);
      this.cannon.strokeRect(32, 0, 10, 18);
    }
    else if (type === 4) { // Healer - Cross-shaped cannon
      this.cannon.fillStyle(typeColor, 1);
      this.cannon.fillRect(0, -6, 32, 12);
      this.cannon.fillRect(12, -12, 8, 24);
      this.cannon.lineStyle(2, 0x4acc8c, 0.9);
      this.cannon.strokeRect(0, -6, 32, 12);
      this.cannon.strokeRect(12, -12, 8, 24);
      
      // Healing aura at tip
      this.cannon.fillStyle(0x00ff00, 0.5);
      this.cannon.beginPath();
      this.cannon.arc(32, 0, 8, 0, Math.PI * 2);
      this.cannon.fillPath();
    }
    else { // Balanced - Standard cannon
      this.cannon.fillStyle(typeColor, 1);
      this.cannon.fillRect(0, -7, 34, 14);
      this.cannon.lineStyle(2, stroke, 0.9);
      this.cannon.strokeRect(0, -7, 34, 14);
      
      // Muzzle brake
      this.cannon.fillStyle(0x333333, 0.7);
      this.cannon.fillRect(26, -9, 6, 18);
      this.cannon.lineStyle(1, 0x555555, 0.8);
      this.cannon.strokeRect(26, -9, 6, 18);
      
      // Muzzle tip
      this.cannon.fillStyle(0x4a4a4a, 0.9);
      this.cannon.fillRect(30, -6, 8, 12);
    }

    // Nắp tháp (turret) - different for each type
    this.turret = this.scene.add.graphics();
    
    if (type === 1) { // Defender - Hexagonal turret
      this.turret.fillStyle(0x2e5a8c, 1);
      this.turret.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i;
        const r = 14;
        const x = Math.cos(angle) * r;
        const y = Math.sin(angle) * r;
        if (i === 0) this.turret.moveTo(x, y);
        else this.turret.lineTo(x, y);
      }
      this.turret.closePath();
      this.turret.fillPath();
      this.turret.lineStyle(2, 0x4a7acc, 0.9);
      this.turret.strokePath();
    }
    else if (type === 2) { // Speedster - Small circular turret
      this.turret.fillStyle(typeColor, 1);
      this.turret.fillCircle(0, 0, 8);
      this.turret.lineStyle(1, 0x4acc4a, 0.9);
      this.turret.strokeCircle(0, 0, 8);
    }
    else if (type === 3) { // Destroyer - Large square turret
      this.turret.fillStyle(0x3a1a1a, 1);
      this.turret.fillRect(-12, -12, 24, 24);
      this.turret.lineStyle(3, 0xcc4a4a, 0.9);
      this.turret.strokeRect(-12, -12, 24, 24);
    }
    else if (type === 4) { // Healer - Cross turret
      this.turret.fillStyle(typeColor, 1);
      this.turret.fillRect(-3, -12, 6, 24);
      this.turret.fillRect(-12, -3, 24, 6);
      this.turret.lineStyle(2, 0x4acc8c, 0.9);
      this.turret.strokeRect(-3, -12, 6, 24);
      this.turret.strokeRect(-12, -3, 24, 6);
    }
    else { // Balanced - Circular turret
      this.turret.fillStyle(0x555555, 1);
      this.turret.fillCircle(0, 0, 12);
      this.turret.lineStyle(2, 0x777777, 0.8);
      this.turret.strokeCircle(0, 0, 12);
    }

    this.add([this.bodyGfx, this.turret, this.cannon]);
  }

  _createBotGraphics() {
    // 10 different bot appearances with varying shapes, colors, and sizes
    const botStyles = [
      { // Style 1: Gray square with cross
        bodyColor: 0x666666, bodyStroke: 0x888888,
        shape: 'square', sizeMod: 1.0,
        turretColor: 0x444444, turretShape: 'circle',
        cannonColor: 0x555555, cannonWidth: 0.3, cannonLength: 0.6
      },
      { // Style 2: Red triangle
        bodyColor: 0x8b4513, bodyStroke: 0xa0522d,
        shape: 'triangle', sizeMod: 0.9,
        turretColor: 0x5a2a0a, turretShape: 'square',
        cannonColor: 0x6b3510, cannonWidth: 0.25, cannonLength: 0.7
      },
      { // Style 3: Blue circle
        bodyColor: 0x4169e1, bodyStroke: 0x6495ed,
        shape: 'circle', sizeMod: 1.1,
        turretColor: 0x2a4a8a, turretShape: 'circle',
        cannonColor: 0x3a5a9a, cannonWidth: 0.35, cannonLength: 0.5
      },
      { // Style 4: Green hexagon
        bodyColor: 0x228b22, bodyStroke: 0x32cd32,
        shape: 'hexagon', sizeMod: 1.05,
        turretColor: 0x1a6b1a, turretShape: 'hexagon',
        cannonColor: 0x2a8b2a, cannonWidth: 0.28, cannonLength: 0.65
      },
      { // Style 5: Purple diamond
        bodyColor: 0x8b008b, bodyStroke: 0xba55d3,
        shape: 'diamond', sizeMod: 0.95,
        turretColor: 0x5a005a, turretShape: 'diamond',
        cannonColor: 0x6a006a, cannonWidth: 0.32, cannonLength: 0.55
      },
      { // Style 6: Orange rounded rect
        bodyColor: 0xff8c00, bodyStroke: 0xffa500,
        shape: 'rounded', sizeMod: 1.0,
        turretColor: 0xcc6600, turretShape: 'circle',
        cannonColor: 0xdd7700, cannonWidth: 0.3, cannonLength: 0.6
      },
      { // Style 7: Cyan star
        bodyColor: 0x00ced1, bodyStroke: 0x40e0d0,
        shape: 'star', sizeMod: 1.15,
        turretColor: 0x008b8b, turretShape: 'circle',
        cannonColor: 0x009b9b, cannonWidth: 0.25, cannonLength: 0.7
      },
      { // Style 8: Dark gray octagon
        bodyColor: 0x4a4a4a, bodyStroke: 0x6a6a6a,
        shape: 'octagon', sizeMod: 1.0,
        turretColor: 0x3a3a3a, turretShape: 'square',
        cannonColor: 0x4a4a4a, cannonWidth: 0.35, cannonLength: 0.5
      },
      { // Style 9: Pink heart shape
        bodyColor: 0xff69b4, bodyStroke: 0xff1493,
        shape: 'heart', sizeMod: 0.9,
        turretColor: 0xcc0066, turretShape: 'circle',
        cannonColor: 0xdd0077, cannonWidth: 0.28, cannonLength: 0.65
      },
      { // Style 10: Teal pentagon
        bodyColor: 0x008080, bodyStroke: 0x20b2aa,
        shape: 'pentagon', sizeMod: 1.05,
        turretColor: 0x005050, turretShape: 'pentagon',
        cannonColor: 0x006060, cannonWidth: 0.3, cannonLength: 0.6
      }
    ];

    // Select style based on bot ID hash
    const styleIndex = Math.abs(this.tankId.split('').reduce((a, b) => ((a << 5) - a) + b.charCodeAt(0), 0)) % 10;
    const style = botStyles[styleIndex];

    const baseSize = this.size || 60;
    const size = baseSize * style.sizeMod;
    const halfSize = size / 2;
    const cannonLength = halfSize * style.cannonLength;
    const cannonWidth = halfSize * style.cannonWidth;
    const turretRadius = halfSize * 0.35;

    this.bodyGfx = this.scene.add.graphics();
    this.bodyGfx.fillStyle(style.bodyColor, 1);
    this.bodyGfx.lineStyle(2, style.bodyStroke, 0.8);

    // Draw body based on shape
    switch (style.shape) {
      case 'circle':
        this.bodyGfx.fillCircle(0, 0, halfSize);
        this.bodyGfx.strokeCircle(0, 0, halfSize);
        break;
      case 'square':
        this.bodyGfx.fillRect(-halfSize, -halfSize, size, size);
        this.bodyGfx.strokeRect(-halfSize, -halfSize, size, size);
        break;
      case 'rounded':
        this.bodyGfx.fillRoundedRect(-halfSize, -halfSize, size, size, 8);
        this.bodyGfx.strokeRoundedRect(-halfSize, -halfSize, size, size, 8);
        break;
      case 'triangle':
        this.bodyGfx.beginPath();
        this.bodyGfx.moveTo(0, -halfSize);
        this.bodyGfx.lineTo(halfSize, halfSize);
        this.bodyGfx.lineTo(-halfSize, halfSize);
        this.bodyGfx.closePath();
        this.bodyGfx.fillPath();
        this.bodyGfx.strokePath();
        break;
      case 'diamond':
        this.bodyGfx.beginPath();
        this.bodyGfx.moveTo(0, -halfSize);
        this.bodyGfx.lineTo(halfSize, 0);
        this.bodyGfx.lineTo(0, halfSize);
        this.bodyGfx.lineTo(-halfSize, 0);
        this.bodyGfx.closePath();
        this.bodyGfx.fillPath();
        this.bodyGfx.strokePath();
        break;
      case 'hexagon':
        this.bodyGfx.beginPath();
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI / 3) * i;
          const x = Math.cos(angle) * halfSize;
          const y = Math.sin(angle) * halfSize;
          if (i === 0) this.bodyGfx.moveTo(x, y);
          else this.bodyGfx.lineTo(x, y);
        }
        this.bodyGfx.closePath();
        this.bodyGfx.fillPath();
        this.bodyGfx.strokePath();
        break;
      case 'octagon':
        this.bodyGfx.beginPath();
        for (let i = 0; i < 8; i++) {
          const angle = (Math.PI / 4) * i;
          const x = Math.cos(angle) * halfSize;
          const y = Math.sin(angle) * halfSize;
          if (i === 0) this.bodyGfx.moveTo(x, y);
          else this.bodyGfx.lineTo(x, y);
        }
        this.bodyGfx.closePath();
        this.bodyGfx.fillPath();
        this.bodyGfx.strokePath();
        break;
      case 'pentagon':
        this.bodyGfx.beginPath();
        for (let i = 0; i < 5; i++) {
          const angle = (Math.PI * 2 / 5) * i - Math.PI / 2;
          const x = Math.cos(angle) * halfSize;
          const y = Math.sin(angle) * halfSize;
          if (i === 0) this.bodyGfx.moveTo(x, y);
          else this.bodyGfx.lineTo(x, y);
        }
        this.bodyGfx.closePath();
        this.bodyGfx.fillPath();
        this.bodyGfx.strokePath();
        break;
      case 'star':
        this.bodyGfx.beginPath();
        for (let i = 0; i < 5; i++) {
          const outerAngle = (Math.PI * 2 / 5) * i - Math.PI / 2;
          const innerAngle = outerAngle + Math.PI / 5;
          const outerX = Math.cos(outerAngle) * halfSize;
          const outerY = Math.sin(outerAngle) * halfSize;
          const innerX = Math.cos(innerAngle) * halfSize * 0.5;
          const innerY = Math.sin(innerAngle) * halfSize * 0.5;
          if (i === 0) this.bodyGfx.moveTo(outerX, outerY);
          else this.bodyGfx.lineTo(outerX, outerY);
          this.bodyGfx.lineTo(innerX, innerY);
        }
        this.bodyGfx.closePath();
        this.bodyGfx.fillPath();
        this.bodyGfx.strokePath();
        break;
      case 'heart':
        this.bodyGfx.beginPath();
        this.bodyGfx.moveTo(0, halfSize * 0.3);
        this.bodyGfx.bezierCurveTo(-halfSize, -halfSize * 0.5, -halfSize, -halfSize, 0, -halfSize * 0.3);
        this.bodyGfx.bezierCurveTo(halfSize, -halfSize, halfSize, -halfSize * 0.5, 0, halfSize * 0.3);
        this.bodyGfx.fillPath();
        this.bodyGfx.strokePath();
        break;
      default:
        this.bodyGfx.fillRoundedRect(-halfSize, -halfSize, size, size, 4);
        this.bodyGfx.strokeRoundedRect(-halfSize, -halfSize, size, size, 4);
    }

    // Draw turret based on shape
    this.turret = this.scene.add.graphics();
    this.turret.fillStyle(style.turretColor, 1);
    this.turret.lineStyle(1, Phaser.Display.Color.ValueToColor(style.turretColor).lighten(30).color, 0.8);

    switch (style.turretShape) {
      case 'circle':
        this.turret.fillCircle(0, 0, turretRadius);
        this.turret.strokeCircle(0, 0, turretRadius);
        break;
      case 'square':
        this.turret.fillRect(-turretRadius, -turretRadius, turretRadius * 2, turretRadius * 2);
        this.turret.strokeRect(-turretRadius, -turretRadius, turretRadius * 2, turretRadius * 2);
        break;
      case 'diamond':
        this.turret.beginPath();
        this.turret.moveTo(0, -turretRadius);
        this.turret.lineTo(turretRadius, 0);
        this.turret.lineTo(0, turretRadius);
        this.turret.lineTo(-turretRadius, 0);
        this.turret.closePath();
        this.turret.fillPath();
        this.turret.strokePath();
        break;
      case 'hexagon':
        this.turret.beginPath();
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI / 3) * i;
          const x = Math.cos(angle) * turretRadius;
          const y = Math.sin(angle) * turretRadius;
          if (i === 0) this.turret.moveTo(x, y);
          else this.turret.lineTo(x, y);
        }
        this.turret.closePath();
        this.turret.fillPath();
        this.turret.strokePath();
        break;
      case 'pentagon':
        this.turret.beginPath();
        for (let i = 0; i < 5; i++) {
          const angle = (Math.PI * 2 / 5) * i - Math.PI / 2;
          const x = Math.cos(angle) * turretRadius;
          const y = Math.sin(angle) * turretRadius;
          if (i === 0) this.turret.moveTo(x, y);
          else this.turret.lineTo(x, y);
        }
        this.turret.closePath();
        this.turret.fillPath();
        this.turret.strokePath();
        break;
      default:
        this.turret.fillCircle(0, 0, turretRadius);
        this.turret.strokeCircle(0, 0, turretRadius);
    }

    // Draw cannon
    this.cannon = this.scene.add.graphics();
    this.cannon.fillStyle(style.cannonColor, 1);
    this.cannon.lineStyle(1, Phaser.Display.Color.ValueToColor(style.cannonColor).lighten(20).color, 0.8);
    this.cannon.fillRect(0, -cannonWidth / 2, cannonLength, cannonWidth);
    this.cannon.strokeRect(0, -cannonWidth / 2, cannonLength, cannonWidth);

    this.add([this.bodyGfx, this.turret, this.cannon]);
  }

  _createHealthBar() {
    // ========================================
    // PHẦN 3: THANH MÁU & THÔNG TIN - SCI-FI STYLE
    // ========================================
    
    // Container cho thanh máu và tên (để giữ nguyên orientation)
    this.healthBarContainer = this.scene.add.container(0, 0);
    this.add(this.healthBarContainer);

    // Tên người chơi và Cấp độ - màu trắng, font Orbitron, căn giữa
    this.nameTag = this.scene.add.text(0, -55, `${this.tankName} [Lv.${this.tankLevel}]`, {
      fontSize: '14px',
      color: '#ffffff',
      fontFamily: 'Orbitron',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 4,
      shadow: {
        offsetX: 0,
        offsetY: 0,
        color: '#00F5FF',
        blur: 5,
        stroke: false,
        fill: true
      }
    }).setOrigin(0.5, 0.5);
    this.healthBarContainer.add(this.nameTag);

    // Nền thanh máu - màu xám đen mờ (rgba)
    this.healthBarBg = this.scene.add.graphics();
    this.healthBarBg.fillStyle(0x1a1a2e, 0.8);
    // Vẽ nền thanh máu với viền mỏng trong suốt
    const barWidth = 50;
    const barHeight = 6;
    const barX = -barWidth / 2;
    const barY = -38;
    
    // Viền mỏng trong suốt bọc bên ngoài
    this.healthBarBg.lineStyle(1, 0xffffff, 0.3);
    this.healthBarBg.strokeRect(barX - 1, barY - 1, barWidth + 2, barHeight + 2);
    // Nền thanh máu
    this.healthBarBg.fillStyle(0x1a1a2e, 0.9);
    this.healthBarBg.fillRect(barX, barY, barWidth, barHeight);
    this.healthBarContainer.add(this.healthBarBg);

    // Thanh máu hiển thị lượng HP hiện tại
    this.healthBar = this.scene.add.graphics();
    this.healthBarContainer.add(this.healthBar);
    this._drawHealthBar();
  }

  setName(name) {
    if (!name || this.tankName === name) return;
    this.tankName = name;
    if (this.nameTag) {
      this.nameTag.setText(`${this.tankName} [Lv.${this.tankLevel}]`);
      // Cập nhật font sang Orbitron
      this.nameTag.setFont('Orbitron');
    }
  }

  setLevel(level) {
    const lv = Math.max(1, Number(level) || 1);
    if (this.tankLevel === lv) return;
    this.tankLevel = lv;
    if (this.nameTag) {
      this.nameTag.setText(`${this.tankName} [Lv.${this.tankLevel}]`);
      this.nameTag.setPosition(0, -55);
      // Đảm bảo font là Orbitron
      this.nameTag.setFont('Orbitron');
    }
    // Redraw graphics to show level evolution
    this._createGraphics();
    // Update physics body size
    if (this.body) {
      this.body.setCircle(this.size / 2, -this.size / 2, -this.size / 2);
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
    // ========================================
    // HÀM VẼ THANH MÁU - SCI-FI / CYBERPUNK STYLE
    // ========================================
    
    this.healthBar.clear();
    
    // Tính phần trăm HP hiện tại
    const healthPercent = Math.max(0, Math.min(1, this.health / this.maxHealth));
    
    // Màu thanh máu: Cyan nếu HP > 30%, Đỏ nếu HP <= 30%
    const barColor = healthPercent > 0.3 ? 0x00F5FF : 0xFF4444;
    
    // Kích thước thanh máu
    const barWidth = 50;
    const barHeight = 6;
    const barX = -barWidth / 2;
    const barY = -38;
    const fillWidth = barWidth * healthPercent;
    
    // Vẽ thanh máu với màu tương ứng
    if (fillWidth > 0) {
      this.healthBar.fillStyle(barColor, 1);
      this.healthBar.fillRect(barX, barY, fillWidth, barHeight);
      
      // Thêm hiệu ứng phát sáng neon cho thanh máu
      if (healthPercent > 0.3) {
        // Hiệu ứng glow cho Cyan
        this.healthBar.lineStyle(1, 0x00F5FF, 0.5);
        this.healthBar.strokeRect(barX, barY, fillWidth, barHeight);
      } else {
        // Hiệu ứng glow cho Đỏ (danger)
        this.healthBar.lineStyle(1, 0xFF4444, 0.5);
        this.healthBar.strokeRect(barX, barY, fillWidth, barHeight);
      }
    }
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

    // ========================================
    // GIỮ THANH MÁU LUÔN THẲNG ĐỨNG (KHÔNG XOAY THEO TANK)
    // ========================================
    if (this.healthBarContainer) {
      // Đảo ngược rotation của tank để container luôn thẳng đứng
      this.healthBarContainer.setRotation(-Phaser.Math.DegToRad(this.angle));
    }
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