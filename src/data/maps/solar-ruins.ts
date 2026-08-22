import type { Map } from '../../types/Map';

export const solarRuins: Map = {
  id: 'solar-ruins',
  name: 'Solar Ruins',
  width: 1450,
  height: 950,
  base: { x: 1180, y: 760 },
  walls: [
    { x: 160, y: 180, w: 340, h: 24 },
    { x: 760, y: 240, w: 200, h: 24 },
    { x: 520, y: 560, w: 260, h: 24 },
    { x: 1020, y: 640, w: 180, h: 24 },
  ],
  spawnSchedule: [
    {
      type: 'time',
      atSeconds: 6,
      spawns: [
        { id: 'neon-mite', x: 260, y: 420 },
        { id: 'neon-mite', x: 320, y: 460 },
      ],
    },
    {
      type: 'time',
      atSeconds: 25,
      spawns: [{ id: 'void-warden', x: 920, y: 300 }],
    },
    {
      type: 'threshold',
      enemyId: 'neon-mite',
      belowCount: 1,
      spawns: [
        { id: 'neon-mite', x: 260, y: 420 },
        { id: 'glitch-scout', x: 640, y: 400 },
      ],
    },
    {
      type: 'threshold',
      enemyId: 'void-warden',
      belowCount: 1,
      spawns: [{ id: 'arc-viper', x: 700, y: 500 }],
    },
  ],
};
