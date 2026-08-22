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
  // The host's authoritative impact position. The client's own view of the bullet's
  // position lags behind (it's smoothed via snapshot interpolation), so the explosion
  // effect must use this rather than wherever the client currently renders the bullet,
  // or it visibly lands short of what it actually hit.
  x: number;
  y: number;
}

// enemy created (e.g. by a spawner, at a time/count the host alone decides)

interface EnemyCreatedEvent {
  type: 'enemy-created';
  enemyId: string;
  definitionId: string;
  x: number;
  y: number;
}

// enemy hit but not destroyed (tint-flash feedback only)

interface EnemyHitEvent {
  type: 'enemy-hit';
  enemyId: string;
  // indestructible parts flash a dimmer grey rather than the normal hit-white
  indestructible?: boolean;
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
  | EnemyHitEvent
  | EnemyDestroyedEvent
  | PlayerLeftEvent;
