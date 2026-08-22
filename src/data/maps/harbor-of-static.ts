import type { Map } from '../../types/Map';

export const harborOfStatic: Map = {
  id: 'harbor-of-static',
  name: 'Harbor of Static',
  width: 1500,
  height: 900,
  base: { x: 1240, y: 700 },
  walls: [
    { x: 220, y: 160, w: 240, h: 24 },
    { x: 780, y: 220, w: 220, h: 24 },
    { x: 420, y: 520, w: 260, h: 24 },
    { x: 980, y: 620, w: 220, h: 24 },
  ],
  spawnSchedule: [
    {
      type: 'time',
      atSeconds: 5,
      spawns: [
        { id: 'neon-mite', x: 300, y: 320 },
        { id: 'neon-mite', x: 340, y: 360 },
      ],
    },
    {
      type: 'time',
      atSeconds: 20,
      spawns: [{ id: 'arc-viper', x: 760, y: 420 }],
    },
    {
      type: 'time',
      atSeconds: 45,
      spawns: [{ id: 'eclipse-guardian', x: 1100, y: 260 }],
    },
    {
      type: 'threshold',
      enemyId: 'neon-mite',
      belowCount: 1,
      spawns: [{ id: 'neon-mite', x: 300, y: 320 }],
    },
    {
      type: 'threshold',
      enemyId: 'arc-viper',
      belowCount: 1,
      spawns: [{ id: 'glitch-scout', x: 780, y: 460 }],
    },
  ],
};
