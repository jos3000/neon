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
  enemies: [
    { id: 'glitch-scout', x: 320, y: 220 },
    { id: 'neon-mite', x: 640, y: 340 },
  ],
};
