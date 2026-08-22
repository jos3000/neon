import type { StandardEnemySchema } from '../../types/Enemy';

export const riftSeeder: StandardEnemySchema = {
  type: 'standard',
  id: 'rift-seeder',
  name: 'Rift Seeder',
  visuals: {
    shape: 'pentagon',
    size: 38,
    fillColor: '0x2a0f3d',
    strokeColor: '0xd946ef',
    strokeWidth: 3,
    glowColor: '0xa855f7',
    spinSpeed: -15,
  },
  maxHp: 420,
  scoreValue: 650,
  movement: {
    style: 'stationary',
    speed: 0,
  },
  attack: {
    pattern: 'contact_only',
    damage: 14,
    fireRateMs: 500,
  },
  spawner: {
    minionNameRef: 'glitch-scout',
    baseSpawnRateMs: 4500,
    maxActive: 3,
    spawnRadius: 80,
  },
};
