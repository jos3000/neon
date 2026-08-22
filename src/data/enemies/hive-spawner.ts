import type { StandardEnemySchema } from '../../types/Enemy';

export const hiveSpawner: StandardEnemySchema = {
  type: 'standard',
  id: 'hive-spawner',
  name: 'Hive Spawner',
  visuals: {
    shape: 'hexagon',
    size: 34,
    fillColor: '0x0f2e1f',
    strokeColor: '0x39ff88',
    strokeWidth: 3,
    glowColor: '0x22c55e',
    spinSpeed: 20,
  },
  maxHp: 260,
  scoreValue: 400,
  movement: {
    style: 'stationary',
    speed: 0,
  },
  attack: {
    pattern: 'contact_only',
    damage: 10,
    fireRateMs: 500,
  },
  spawner: {
    minionNameRef: 'neon-mite',
    baseSpawnRateMs: 3000,
    maxActive: 4,
    spawnRadius: 60,
  },
};
