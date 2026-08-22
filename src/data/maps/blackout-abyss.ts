import type { Map } from '../../types/Map';

export const blackoutAbyss: Map = {
  id: 'blackout-abyss',
  name: 'Blackout Abyss',
  width: 1600,
  height: 1000,
  base: { x: 1300, y: 760 },
  walls: [
    { x: 220, y: 200, w: 320, h: 24 },
    { x: 760, y: 260, w: 260, h: 24 },
    { x: 360, y: 620, w: 280, h: 24 },
    { x: 1040, y: 720, w: 220, h: 24 },
  ],
  spawnSchedule: [
    {
      type: 'time',
      atSeconds: 5,
      spawns: [{ id: 'glitch-scout', x: 360, y: 340 }],
    },
    {
      type: 'time',
      atSeconds: 18,
      spawns: [
        { id: 'arc-viper', x: 840, y: 500 },
        { id: 'glitch-scout', x: 780, y: 460 },
      ],
    },
    {
      type: 'time',
      atSeconds: 40,
      spawns: [{ id: 'void-warden', x: 1200, y: 320 }],
    },
    {
      type: 'threshold',
      enemyId: 'glitch-scout',
      belowCount: 1,
      spawns: [
        { id: 'glitch-scout', x: 360, y: 340 },
        { id: 'glitch-scout', x: 420, y: 380 },
      ],
    },
    {
      type: 'threshold',
      enemyId: 'void-warden',
      belowCount: 1,
      spawns: [{ id: 'arc-viper', x: 1160, y: 360 }],
    },
  ],
};
