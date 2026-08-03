export type Wall = { x: number; y: number; w: number; h: number };

export interface Map {
  id: string; // unique id for this map
  name: string;
  width: number;
  height: number;
  walls: Wall[];
  enemies: {
    id: string;
    x: number;
    y: number;
  }[];
}
