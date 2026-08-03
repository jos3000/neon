import type { Map } from '../../types/Map';

export const quantumEcho: Map = {
  id: 'quantum-echo',
  name: 'Quantum Echo',
  width: 1700,
  height: 1000,
  walls: [
    { x: 200, y: 220, w: 260, h: 24 },
    { x: 760, y: 160, w: 180, h: 24 },
    { x: 1080, y: 360, w: 240, h: 24 },
    { x: 620, y: 660, w: 300, h: 24 },
  ],
  enemies: [
    { id: 'eclipse-guardian', x: 960, y: 260 },
    { id: 'neon-mite', x: 320, y: 420 },
    { id: 'glitch-scout', x: 760, y: 520 },
  ],
};
