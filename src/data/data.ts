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
  baseCenter: { x: number; y: number };
  baseRadius: number;
  spawnSchedule: SpawnTrigger[];
  walls: WallConfig[];
  mapIds: string[];
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
  const primaryMap = mapLookup[mission.maps[0]] ?? echoGrid;
  return {
    id: mission.id,
    name: mission.name,
    baseCenter: primaryMap.base ?? { x: primaryMap.width / 2, y: primaryMap.height / 2 },
    baseRadius: Math.max(120, Math.min(primaryMap.width, primaryMap.height) * 0.2),
    spawnSchedule: primaryMap.spawnSchedule,
    walls: primaryMap.walls.map((wall) => ({ ...wall })),
    mapIds: mission.maps,
  };
}

export const MISSION_CONFIGS: Record<string, MissionConfig> = {
  [relayRush.id]: buildMissionConfig(relayRush),
  [phaseShift.id]: buildMissionConfig(phaseShift),
  [enemyShowcaseMission.id]: buildMissionConfig(enemyShowcaseMission),
};
