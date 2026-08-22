import type { EnemyConfig } from '../types/Enemy';
import type { Map as GameMap, SpawnTrigger } from '../types/Map';
import type { Mission as GameMission } from '../types/Mission';
import { relayRush } from './missions/relay-rush';
import { phaseShift } from './missions/phase-shift';
import { enemyShowcaseMission } from './missions/enemy-showcase';
import { echoGrid } from './maps/echo-grid';
import { emberCorridor } from './maps/ember-corridor';
import { harborOfStatic } from './maps/harbor-of-static';
import { solarRuins } from './maps/solar-ruins';
import { blackoutAbyss } from './maps/blackout-abyss';
import { quantumEcho } from './maps/quantum-echo';
import { enemyShowcase } from './maps/enemy-showcase';
import { arcViper } from './enemies/arc-viper';
import { eclipseGuardian } from './enemies/eclipse-guardian';
import { glitchScout } from './enemies/glitch-scout';
import { neonMite } from './enemies/neon-mite';
import { voidWarden } from './enemies/void-warden';

export type WallConfig = { x: number; y: number; w: number; h: number };

export type MissionConfig = {
  id: string;
  name: string;
  mapIds: string[];
};

export type MapRuntimeConfig = {
  baseCenter: { x: number; y: number };
  baseRadius: number;
  spawnSchedule: SpawnTrigger[];
  walls: WallConfig[];
};

export const mapLookup: Record<string, GameMap> = {
  'echo-grid': echoGrid,
  'ember-corridor': emberCorridor,
  'harbor-of-static': harborOfStatic,
  'solar-ruins': solarRuins,
  'blackout-abyss': blackoutAbyss,
  'quantum-echo': quantumEcho,
  'enemy-showcase': enemyShowcase,
};

export const enemyDefinitionLookup: Record<string, EnemyConfig> = {
  'arc-viper': arcViper,
  'eclipse-guardian': eclipseGuardian,
  'glitch-scout': glitchScout,
  'neon-mite': neonMite,
  'void-warden': voidWarden,
};

export const enemyDefinitions: EnemyConfig[] = [
  arcViper,
  eclipseGuardian,
  glitchScout,
  neonMite,
  voidWarden,
];

export function buildMissionConfig(mission: GameMission): MissionConfig {
  return {
    id: mission.id,
    name: mission.name,
    mapIds: mission.maps,
  };
}

// Per-map runtime fields (base, walls, spawn schedule), looked up fresh whenever
// MainScene starts or advances to a given map within a mission.
export function buildMapConfig(mapId: string): MapRuntimeConfig {
  const map = mapLookup[mapId] ?? echoGrid;
  return {
    baseCenter: map.base ?? { x: map.width / 2, y: map.height / 2 },
    baseRadius: Math.max(120, Math.min(map.width, map.height) * 0.2),
    spawnSchedule: map.spawnSchedule,
    walls: map.walls.map((wall) => ({ ...wall })),
  };
}

export const MISSION_CONFIGS: Record<string, MissionConfig> = {
  [relayRush.id]: buildMissionConfig(relayRush),
  [phaseShift.id]: buildMissionConfig(phaseShift),
  [enemyShowcaseMission.id]: buildMissionConfig(enemyShowcaseMission),
};
