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
  enemies: [
    { id: 'void-warden', x: 920, y: 300 },
    { id: 'neon-mite', x: 260, y: 420 },
  ],
};
