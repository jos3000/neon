import type { Map } from '../../types/Map';

export const harborOfStatic: Map = {
  id: 'harbor-of-static',
  name: 'Harbor of Static',
  width: 1500,
  height: 900,
  walls: [
    { x: 220, y: 160, w: 240, h: 24 },
    { x: 780, y: 220, w: 220, h: 24 },
    { x: 420, y: 520, w: 260, h: 24 },
    { x: 980, y: 620, w: 220, h: 24 },
  ],
  enemies: [
    { id: 'neon-mite', x: 300, y: 320 },
    { id: 'arc-viper', x: 760, y: 420 },
    { id: 'eclipse-guardian', x: 1100, y: 260 },
  ],
};
