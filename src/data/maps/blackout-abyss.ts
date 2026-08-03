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
  enemies: [
    { id: 'glitch-scout', x: 360, y: 340 },
    { id: 'arc-viper', x: 840, y: 500 },
    { id: 'void-warden', x: 1200, y: 320 },
  ],
};
