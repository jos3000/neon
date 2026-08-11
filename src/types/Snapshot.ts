import { Snapshot } from '@geckos.io/snapshot-interpolation/lib/types';
import { GameEvent } from '../events';

type PlayerSnapshot = {
  x: number;
  y: number;
  r: number;
  isDead: boolean;
};
export type EnemySnapshot = {
  id: string;
  x: number;
  y: number;
  type: string;
  r: number;
  laserState?: 'idle' | 'charging' | 'firing';
  laserAngle?: number;
};
export type BulletSnapshot = {
  id: string;
  x: number;
  y: number;
};
export type PeerSnapshotMessage = {
  type: 'state';
  score: number;
  players: Record<string, PlayerSnapshot>;
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
  effect: 'explosion' | 'hit' | 'spawn' | 'big-spawn' | 'death' | 'shot' | 'laser';
  x?: number;
  y?: number;
};

type PeerEventMessage = {
  type: 'events';
  events: GameEvent[];
};

export type PeerPositionMessage = {
  type: 'positions';
  snapshot: Snapshot;
};

export type PeerMessage =
  | PeerSnapshotMessage
  | PeerInputMessage
  | PeerEffectMessage
  | PeerEventMessage
  | PeerPositionMessage;
