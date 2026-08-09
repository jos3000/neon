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

// enemy spawned
// enemy destroyed
// player spawned
// player destroyed

export type GameEvent = BulletCreatedEvent | BulletDestroyedEvent;
