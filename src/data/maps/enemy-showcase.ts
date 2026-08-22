import type { Map } from '../../types/Map';

export const enemyShowcase: Map = {
  id: 'enemy-showcase',
  name: 'Enemy Showcase',
  width: 1400,
  height: 900,
  base: { x: 700, y: 760 },
  walls: [
    { x: 220, y: 160, w: 180, h: 24 },
    { x: 620, y: 220, w: 180, h: 24 },
    { x: 980, y: 320, w: 180, h: 24 },
    { x: 360, y: 600, w: 220, h: 24 },
    { x: 860, y: 620, w: 220, h: 24 },
  ],
  spawnSchedule: [
    {
      type: 'time',
      atSeconds: 3,
      spawns: [{ id: 'neon-mite', x: 640, y: 500 }],
    },
    {
      type: 'time',
      atSeconds: 8,
      spawns: [{ id: 'glitch-scout', x: 840, y: 260 }],
    },
    {
      type: 'time',
      atSeconds: 13,
      spawns: [{ id: 'arc-viper', x: 240, y: 300 }],
    },
    {
      type: 'time',
      atSeconds: 18,
      spawns: [{ id: 'eclipse-guardian', x: 520, y: 240 }],
    },
    {
      type: 'time',
      atSeconds: 23,
      spawns: [{ id: 'void-warden', x: 1080, y: 560 }],
    },
  ],
};
