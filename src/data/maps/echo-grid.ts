import type { Map } from '../../types/Map';

export const echoGrid: Map = {
  id: 'echo-grid',
  name: 'Echo Grid',
  width: 1200,
  height: 800,
  base: { x: 1000, y: 660 },
  walls: [
    { x: 140, y: 120, w: 180, h: 24 },
    { x: 500, y: 180, w: 160, h: 24 },
    { x: 780, y: 360, w: 220, h: 24 },
    { x: 240, y: 560, w: 220, h: 24 },
  ],
  spawnSchedule: [
    {
      type: 'time',
      atSeconds: 4,
      spawns: [{ id: 'neon-mite', x: 640, y: 340 }],
    },
    {
      type: 'time',
      atSeconds: 16,
      spawns: [
        { id: 'glitch-scout', x: 320, y: 220 },
        { id: 'neon-mite', x: 280, y: 260 },
      ],
    },
    {
      type: 'threshold',
      enemyId: 'neon-mite',
      belowCount: 1,
      spawns: [{ id: 'neon-mite', x: 640, y: 340 }],
    },
    {
      type: 'threshold',
      enemyId: 'glitch-scout',
      belowCount: 1,
      spawns: [{ id: 'glitch-scout', x: 320, y: 220 }],
    },
    {
      type: 'time',
      atSeconds: 30,
      spawns: [{ id: 'hive-spawner', x: 980, y: 180 }],
    },
  ],
};
