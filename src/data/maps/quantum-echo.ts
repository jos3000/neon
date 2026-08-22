import type { Map } from '../../types/Map';

export const quantumEcho: Map = {
  id: 'quantum-echo',
  name: 'Quantum Echo',
  width: 1700,
  height: 1000,
  base: { x: 1420, y: 760 },
  walls: [
    { x: 200, y: 220, w: 260, h: 24 },
    { x: 760, y: 160, w: 180, h: 24 },
    { x: 1080, y: 360, w: 240, h: 24 },
    { x: 620, y: 660, w: 300, h: 24 },
  ],
  spawnSchedule: [
    {
      type: 'time',
      atSeconds: 6,
      spawns: [
        { id: 'neon-mite', x: 320, y: 420 },
        { id: 'glitch-scout', x: 760, y: 520 },
      ],
    },
    {
      type: 'time',
      atSeconds: 30,
      spawns: [{ id: 'eclipse-guardian', x: 960, y: 260 }],
    },
    {
      type: 'threshold',
      enemyId: 'glitch-scout',
      belowCount: 1,
      spawns: [
        { id: 'glitch-scout', x: 760, y: 520 },
        { id: 'neon-mite', x: 700, y: 480 },
      ],
    },
    {
      type: 'threshold',
      enemyId: 'eclipse-guardian',
      belowCount: 1,
      spawns: [{ id: 'void-warden', x: 1000, y: 300 }],
    },
    {
      type: 'time',
      atSeconds: 40,
      spawns: [{ id: 'rift-seeder', x: 1500, y: 600 }],
    },
  ],
};
