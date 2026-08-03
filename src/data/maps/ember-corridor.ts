import type { Map } from '../../types/Map';

export const emberCorridor: Map = {
  id: 'ember-corridor',
  name: 'Ember Corridor',
  width: 1400,
  height: 900,
  base: { x: 1180, y: 720 },
  walls: [
    { x: 180, y: 220, w: 250, h: 24 },
    { x: 620, y: 280, w: 180, h: 24 },
    { x: 940, y: 430, w: 220, h: 24 },
    { x: 420, y: 680, w: 260, h: 24 },
  ],
  enemies: [
    { id: 'arc-viper', x: 420, y: 220 },
    { id: 'glitch-scout', x: 880, y: 520 },
  ],
};
