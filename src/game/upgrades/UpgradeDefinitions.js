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
    desc: '+5 Damage',
    apply: (tank) => { tank.damage = (tank.damage || 10) + 5; }
  },
  {
    key: 'hp',
    label: 'Max HP',
    icon: '❤️',
    desc: '+20 Max HP',
    apply: (tank) => {
      tank.maxHealth += 20;
      tank.health = Math.min(tank.health + 20, tank.maxHealth);
    }
  },
  {
    key: 'speed',
    label: 'Move Speed',
    icon: '⚡',
    desc: '+30 Speed, +20 Rotate +10% Bullet Spd',
    apply: (tank) => {
      tank.speed = (tank.speed || 160) + 30;
      tank.rotationSpeed = (tank.rotationSpeed || 180) + 20;
      tank.bulletSpeed = (tank.bulletSpeed || 400) + 40;
    }
  },
  {
    key: 'firerate',
    label: 'Fire Rate',
    icon: '🚀',
    desc: 'Faster firing',
    apply: (tank) => {
      tank.fireRate = Math.max(80, (tank.fireRate || 300) - 25);
    }
  },
  {
    key: 'regen',
    label: 'HP Regen',
    icon: '💚',
    desc: '+2 HP/s Regen',
    apply: (tank) => {
      tank.regenPerSecond = (tank.regenPerSecond || 0) + 2;
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