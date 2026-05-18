/**
 * UpgradeDefinitions — Central registry of all possible upgrades.
 * To add a new upgrade, simply add a new entry to the UPGRADE_POOL array.
 * Each upgrade must have:
 *   key       - unique string identifier
 *   label     - display name (shown in upgrade menu)
 *   icon      - emoji icon
 *   desc      - short description
 *   apply     - function(tank) that modifies the tank's stats
 *   maxLevel  - (optional) max times this can be taken, default = Infinity
 */
const UPGRADE_POOL = [
  {
    key: 'damage',
    label: 'Damage',
    icon: '🔥',
    desc: '+4 Damage',
    apply: (tank) => { tank.damage = (tank.damage || 10) + 4; }
  },
  {
    key: 'hp',
    label: 'Max HP',
    icon: '❤️',
    desc: '+15 Max HP',
    apply: (tank) => {
      tank.maxHealth += 15;
      tank.health = Math.min(tank.health + 15, tank.maxHealth);
    }
  },
  {
    key: 'speed',
    label: 'Move Speed',
    icon: '⚡',
    desc: '+20 Speed, +15 Rotate',
    apply: (tank) => {
      tank.speed = (tank.speed || 160) + 20;
      tank.rotationSpeed = (tank.rotationSpeed || 180) + 15;
    }
  },
  {
    key: 'firerate',
    label: 'Fire Rate',
    icon: '🚀',
    desc: '-30ms Fire Rate',
    apply: (tank) => {
      tank.fireRate = Math.max(100, (tank.fireRate || 600) - 30);
    }
  },
  {
    key: 'regen',
    label: 'HP Regen',
    icon: '💚',
    desc: '+1.5 HP/s Regen',
    apply: (tank) => {
      tank.regenPerSecond = (tank.regenPerSecond || 0) + 1.5;
    }
  },
  {
    key: 'armor',
    label: 'Armor',
    icon: '🛡️',
    desc: '+1 Armor',
    apply: (tank) => {
      tank.armor = (tank.armor || 0) + 1;
    }
  },
  {
    key: 'multishot',
    label: 'Multishot',
    icon: '🎯',
    desc: '+1 Bullet',
    apply: (tank) => {
      tank.bulletCount = Math.min((tank.bulletCount || 1) + 1, tank.maxBullets || 3);
    }
  },
  {
    key: 'bulletspeed',
    label: 'Bullet Speed',
    icon: '💨',
    desc: '+50 Bullet Speed',
    apply: (tank) => {
      tank.bulletSpeed = (tank.bulletSpeed || 400) + 50;
    }
  },
  // ========== Add new upgrades below this line ==========
  // Example:
  // {
  //   key: 'lifesteal',
  //   label: 'Lifesteal',
  //   icon: '🩸',
  //   desc: 'Heal 10% of damage dealt',
  //   apply: (tank) => { tank.lifesteal = (tank.lifesteal || 0) + 0.1; }
  // },
];

/**
 * Get a random selection of upgrades
 * @param {number} count - How many to pick
 * @param {Array} [excludeKeys] - Optional keys to exclude (e.g. already taken)
 * @returns {Array} Array of upgrade objects
 */
export function getRandomUpgrades(count = 3, excludeKeys = []) {
  const pool = UPGRADE_POOL.filter(u => !excludeKeys.includes(u.key));
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

/**
 * Apply an upgrade to a tank by key.
 * @param {string} key - The upgrade key
 * @param {object} tank - The tank instance
 * @returns {boolean} true if applied, false if not found
 */
export function applyUpgradeByKey(key, tank) {
  const upgrade = UPGRADE_POOL.find(u => u.key === key);
  if (!upgrade) return false;
  upgrade.apply(tank);
  return true;
}

/**
 * Get the full upgrade pool (for display/admin purposes)
 */
export function getAllUpgrades() {
  return [...UPGRADE_POOL];
}

/**
 * Look up an upgrade definition by key
 */
export function getUpgradeByKey(key) {
  return UPGRADE_POOL.find(u => u.key === key);
}

export default UPGRADE_POOL;