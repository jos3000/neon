import { Snapshot } from '@geckos.io/snapshot-interpolation/lib/types';
import { GameEvent } from '../events';

export type PlayerSnapshot = {
  id: string;
  x: number;
  y: number;
  r: number;
  isDead: boolean;
};

export type BulletSnapshot = {
  id: string;
  x: number;
  y: number;
  r: number;
  ownerType: 'player' | 'enemy';
};

export type EnemySnapshot = {
  id: string;
  x: number;
  y: number;
  r: number;
  definitionId: string;
  partId?: string;
};

export type PeerEntityMessage = {
  type: 'entities';
  players: PlayerSnapshot[];
  enemies: EnemySnapshot[];
  bullets: BulletSnapshot[];
};

export type PeerInputMessage = {
  type: 'input';
  moveX: number;
  moveY: number;
  shoot: boolean;
  aimAngle: number;
};

export type PeerEffectMessage = {
  type: 'effect';
  effect:
    | 'explosion'
    | 'hit'
    | 'spawn'
    | 'big-spawn'
    | 'death'
    | 'shot'
    | 'laser'
    | 'spawn-warning';
  x?: number;
  y?: number;
};

type PeerEventMessage = {
  type: 'events';
  events: GameEvent[];
};

// Host-authoritative announcement that the current map's enemies are all cleared.
// `nextMapIndex` is null when the just-completed map was the mission's last one.
export type PeerMapCompleteMessage = {
  type: 'map-complete';
  nextMapIndex: number | null;
};

export type PeerPositionMessage = {
  type: 'positions';
  snapshot: Snapshot;
};

export type HostPeerMessage =
  | PeerEntityMessage
  | PeerEffectMessage
  | PeerEventMessage
  | PeerPositionMessage
  | PeerMapCompleteMessage;

export type ClientPeerMessage = PeerInputMessage;
