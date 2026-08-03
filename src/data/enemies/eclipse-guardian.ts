import type { BossSchema } from '../../types/Enemy';

export const eclipseGuardian: BossSchema = {
  type: 'boss',
  id: 'eclipse-guardian',
  name: 'Eclipse Guardian',
  parts: [
    {
      partId: 'core',
      isCore: true,
      destructible: true,
      offsetX: 0,
      offsetY: 0,
      name: 'Core',
      visuals: {
        shape: 'octagon',
        size: 44,
        fillColor: '0x0f172a',
        strokeColor: '0xffd166',
        strokeWidth: 3,
        glowColor: '0xf59e0b',
      },
      maxHp: 780,
      scoreValue: 2200,
    },
    {
      partId: 'tail',
      isCore: false,
      destructible: false,
      offsetX: -110,
      offsetY: 20,
      name: 'Tail',
      visuals: {
        shape: 'triangle',
        size: 24,
        fillColor: '0x111827',
        strokeColor: '0xfbbf24',
        strokeWidth: 2,
        glowColor: '0xf59e0b',
      },
      maxHp: 200,
      scoreValue: 600,
      connection: {
        parentPartId: 'core',
        style: 'snake',
        visuals: {
          color: '0xfbbf24',
          thickness: 2,
          isDashed: true,
        },
        followDelay: 10,
      },
    },
    {
      partId: 'orbit_1',
      isCore: false,
      destructible: true,
      offsetX: 90,
      offsetY: -50,
      name: 'Orbit Ring',
      visuals: {
        shape: 'star',
        size: 20,
        fillColor: '0x1e293b',
        strokeColor: '0xff7a59',
        strokeWidth: 2,
        glowColor: '0xfb923c',
      },
      maxHp: 260,
      scoreValue: 900,
      connection: {
        parentPartId: 'core',
        style: 'orbit',
        visuals: {
          color: '0xff7a59',
          thickness: 1,
        },
        orbitSpeed: 80,
      },
    },
  ],
  phases: [
    {
      trigger: {
        type: 'parts_destroyed',
        value: ['tail'],
      },
      partBehaviors: {
        core: {
          movement: {
            style: 'flee',
            speed: 70,
          },
          attack: {
            pattern: 'charging_laser',
            damage: 20,
            fireRateMs: 1800,
          },
        },
        orbit_1: {
          attack: {
            pattern: 'mine_dropper',
            damage: 10,
            fireRateMs: 1400,
            projectileCount: 4,
            projectileSpeed: 160,
          },
        },
      },
    },
  ],
};
