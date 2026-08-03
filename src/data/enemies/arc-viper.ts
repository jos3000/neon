import type { StandardEnemySchema } from '../../types/Enemy';

export const arcViper: StandardEnemySchema = {
  type: 'standard',
  id: 'arc-viper',
  name: 'Arc Viper',
  visuals: {
    shape: 'diamond',
    size: 22,
    fillColor: '0x7c4dff',
    strokeColor: '0x00f5d4',
    strokeWidth: 2,
    glowColor: '0x8b5cf6',
  },
  maxHp: 110,
  scoreValue: 180,
  movement: {
    style: 'orbit',
    speed: 90,
    orbitRadius: 90,
  },
  attack: {
    pattern: 'burst',
    damage: 14,
    fireRateMs: 1200,
    projectileCount: 3,
    projectileSpeed: 180,
  },
};
