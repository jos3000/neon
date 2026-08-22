import Phaser from 'phaser';
import { enemyDefinitionLookup } from './data/data';
import type { EnemyConfig } from './types/Enemy';
import type { SpawnPoint, SpawnTrigger } from './types/Map';
import type { PeerEffectMessage } from './types/PeerMessages';

// Time between a spawn's warning effect (ring + sound) and the enemy actually
// appearing — long enough for a player to see it and move away.
export const SPAWN_TELEGRAPH_MS = 1200;

export interface MapManagerOptions {
  scene: Phaser.Scene;
  isHost: boolean;
  broadcastEffect: (effect: PeerEffectMessage['effect'], x?: number, y?: number) => void;
  countAliveEnemies: (enemyId: string) => number;
  spawnEnemy: (definition: EnemyConfig, x: number, y: number) => void;
}

// Owns the current map's spawn schedule: watches elapsed map time and live
// enemy counts to decide when each trigger fires, telegraphing the location
// before handing the actual spawn off to EnemyManager.
export class MapManager {
  private scene: Phaser.Scene;
  private isHost: boolean;
  private broadcastEffect: (effect: PeerEffectMessage['effect'], x?: number, y?: number) => void;
  private countAliveEnemies: (enemyId: string) => number;
  private spawnEnemyCallback: (definition: EnemyConfig, x: number, y: number) => void;

  private schedule: SpawnTrigger[] = [];
  private mapStartTime = 0;
  private firedTriggers = new Set<number>();
  private everSpawnedIds = new Set<string>();

  constructor(options: MapManagerOptions) {
    this.scene = options.scene;
    this.isHost = options.isHost;
    this.broadcastEffect = options.broadcastEffect;
    this.countAliveEnemies = options.countAliveEnemies;
    this.spawnEnemyCallback = options.spawnEnemy;
  }

  init(schedule: SpawnTrigger[], startTime: number) {
    this.schedule = schedule;
    this.mapStartTime = startTime;
    this.firedTriggers.clear();
    this.everSpawnedIds.clear();
  }

  // Host-only schedule evaluation, called each frame from MainScene.update()'s
  // existing `if (this.isHost)` block.
  update(time: number) {
    if (!this.isHost) return;

    this.schedule.forEach((trigger, index) => {
      if (this.firedTriggers.has(index)) return;

      const met =
        trigger.type === 'time'
          ? time - this.mapStartTime >= trigger.atSeconds * 1000
          : this.everSpawnedIds.has(trigger.enemyId) &&
            this.countAliveEnemies(trigger.enemyId) < trigger.belowCount;

      if (!met) return;

      this.firedTriggers.add(index);
      trigger.spawns.forEach((spawn) => this.telegraphSpawn(spawn));
    });
  }

  private telegraphSpawn(spawn: SpawnPoint) {
    this.broadcastEffect('spawn-warning', spawn.x, spawn.y);

    this.scene.time.delayedCall(SPAWN_TELEGRAPH_MS, () => {
      const definition = enemyDefinitionLookup[spawn.id];
      if (!definition) return;

      this.everSpawnedIds.add(spawn.id);
      this.spawnEnemyCallback(definition, spawn.x, spawn.y);
    });
  }
}
