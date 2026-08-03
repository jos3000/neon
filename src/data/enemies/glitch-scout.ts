import type { StandardEnemySchema } from '../../types/Enemy';

export const glitchScout: StandardEnemySchema = {
  type: 'standard',
  id: 'glitch-scout',
  name: 'Glitch Scout',
  visuals: {
    shape: 'triangle',
    size: 18,
    fillColor: '0xff4d6d',
    strokeColor: '0x1f1f1f',
    strokeWidth: 2,
    glowColor: '0xff6b6b',
  },
  maxHp: 70,
  scoreValue: 120,
  movement: {
    style: 'chase',
    speed: 140,
  },
  attack: {
    pattern: 'single_shot',
    damage: 12,
    fireRateMs: 900,
    projectileSpeed: 220,
  },
};
