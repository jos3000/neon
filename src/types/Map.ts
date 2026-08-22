export type Wall = { x: number; y: number; w: number; h: number };

export type SpawnPoint = { id: string; x: number; y: number };

export type TimeSpawnTrigger = {
  type: 'time';
  atSeconds: number; // fires once, this many seconds after map start
  spawns: SpawnPoint[]; // one or more enemies spawned together as a wave
};

export type ThresholdSpawnTrigger = {
  type: 'threshold';
  enemyId: string; // watched enemy type
  belowCount: number; // fires once the alive count of enemyId drops below this
  spawns: SpawnPoint[];
};

export type SpawnTrigger = TimeSpawnTrigger | ThresholdSpawnTrigger;

export interface Map {
  id: string; // unique id for this map
  name: string;
  width: number;
  height: number;
  base: { x: number; y: number };
  walls: Wall[];
  spawnSchedule: SpawnTrigger[];
}
