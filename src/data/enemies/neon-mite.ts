import type { StandardEnemySchema } from '../../types/Enemy';

export const neonMite: StandardEnemySchema = {
  type: 'standard',
  id: 'neon-mite',
  name: 'Neon Mite',
  visuals: {
    shape: 'circle',
    size: 12,
    fillColor: '0x00e5ff',
    strokeColor: '0xffffff',
    strokeWidth: 1,
    glowColor: '0x4dd9ff',
  },
  maxHp: 40,
  scoreValue: 85,
  movement: {
    style: 'wander',
    speed: 95,
  },
  attack: {
    pattern: 'contact_only',
    damage: 8,
    fireRateMs: 400,
  },
};
