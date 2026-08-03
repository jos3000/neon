import type { BossSchema } from '../../types/Enemy';

export const voidWarden: BossSchema = {
  type: 'boss',
  id: 'void-warden',
  name: 'Void Warden',
  parts: [
    {
      partId: 'core',
      isCore: true,
      destructible: true,
      offsetX: 0,
      offsetY: 0,
      name: 'Core',
      visuals: {
        shape: 'hexagon',
        size: 48,
        fillColor: '0x111827',
        strokeColor: '0x8b5cf6',
        strokeWidth: 3,
        glowColor: '0x4c1d95',
      },
      maxHp: 900,
      scoreValue: 1800,
    },
    {
      partId: 'left_shield',
      isCore: false,
      destructible: true,
      offsetX: -85,
      offsetY: -10,
      name: 'Left Shield',
      visuals: {
        shape: 'square',
        size: 28,
        fillColor: '0x1f2937',
        strokeColor: '0x22d3ee',
        strokeWidth: 2,
        glowColor: '0x0891b2',
      },
      maxHp: 350,
      scoreValue: 700,
      connection: {
        parentPartId: 'core',
        style: 'rigid',
        visuals: {
          color: '0x22d3ee',
          thickness: 2,
        },
      },
    },
    {
      partId: 'right_shield',
      isCore: false,
      destructible: true,
      offsetX: 85,
      offsetY: -10,
      name: 'Right Shield',
      visuals: {
        shape: 'square',
        size: 28,
        fillColor: '0x1f2937',
        strokeColor: '0x22d3ee',
        strokeWidth: 2,
        glowColor: '0x0891b2',
      },
      maxHp: 350,
      scoreValue: 700,
      connection: {
        parentPartId: 'core',
        style: 'rigid',
        visuals: {
          color: '0x22d3ee',
          thickness: 2,
        },
      },
    },
  ],
  phases: [
    {
      trigger: {
        type: 'hp_threshold',
        value: 0.5,
      },
      partBehaviors: {
        core: {
          movement: {
            style: 'orbit',
            speed: 40,
            orbitRadius: 100,
          },
          attack: {
            pattern: 'spiral',
            damage: 18,
            fireRateMs: 1000,
            projectileCount: 6,
            projectileSpeed: 220,
          },
        },
        left_shield: {
          movement: {
            style: 'stationary',
            speed: 0,
          },
        },
        right_shield: {
          movement: {
            style: 'stationary',
            speed: 0,
          },
        },
      },
    },
  ],
};
