import { Map } from './types/Map';

// this module supports all of

// load map

// bullet created

interface BulletCreatedEvent {
  type: 'bullet-created';
  bulletId: string;
  x: number;
  y: number;
  angle: number;
  speed: number;
}

// bullet destroyed

interface BulletDestroyedEvent {
  type: 'bullet-destroyed';
  bulletId: string;
}

// enemy created (e.g. by a spawner, at a time/count the host alone decides)

interface EnemyCreatedEvent {
  type: 'enemy-created';
  enemyId: string;
  definitionId: string;
  x: number;
  y: number;
}

// enemy destroyed

interface EnemyDestroyedEvent {
  type: 'enemy-destroyed';
  enemyId: string;
  // when the destroyed enemy is a boss core, its remaining parts share this id
  // via their own 'parentEnemy' data and should be destroyed too
  cascadeParentId?: string;
}

// player left

interface PlayerLeftEvent {
  type: 'player-left';
  peerId: string;
}

// player spawned

export type GameEvent =
  | BulletCreatedEvent
  | BulletDestroyedEvent
  | EnemyCreatedEvent
  | EnemyDestroyedEvent
  | PlayerLeftEvent;
