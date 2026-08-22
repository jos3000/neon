import type { Map } from '../../types/Map';

export const emberCorridor: Map = {
  id: 'ember-corridor',
  name: 'Ember Corridor',
  width: 1400,
  height: 900,
  base: { x: 1180, y: 720 },
  walls: [
    { x: 180, y: 220, w: 250, h: 24 },
    { x: 620, y: 280, w: 180, h: 24 },
    { x: 940, y: 430, w: 220, h: 24 },
    { x: 420, y: 680, w: 260, h: 24 },
  ],
  spawnSchedule: [
    {
      type: 'time',
      atSeconds: 5,
      spawns: [{ id: 'glitch-scout', x: 880, y: 520 }],
    },
    {
      type: 'time',
      atSeconds: 22,
      spawns: [
        { id: 'arc-viper', x: 420, y: 220 },
        { id: 'arc-viper', x: 480, y: 260 },
      ],
    },
    {
      type: 'threshold',
      enemyId: 'glitch-scout',
      belowCount: 1,
      spawns: [{ id: 'glitch-scout', x: 880, y: 520 }],
    },
    {
      type: 'threshold',
      enemyId: 'arc-viper',
      belowCount: 1,
      spawns: [{ id: 'eclipse-guardian', x: 620, y: 360 }],
    },
    {
      type: 'time',
      atSeconds: 35,
      spawns: [{ id: 'rift-seeder', x: 1080, y: 180 }],
    },
  ],
};
