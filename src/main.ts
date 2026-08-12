/// <reference types="vite/client" />

import Phaser from 'phaser';
import Peer, { DataConnection, PeerError } from 'peerjs';
import { Synth } from './Synth';
import { MISSION_CONFIGS } from './data/data';
import { relayRush } from './data/missions/relay-rush';
import {
  buildMissionButtons,
  disableMissionButtons,
  enableMissionButtons,
  hideLobbyOverlay,
  setStatusText,
} from './ui';
import { PeerMessage } from './types/Snapshot';
import { MainScene } from './MainScene';

export let isHost = false;
export let currentMissionId = relayRush.id;
export let roomCode: string | null = null;
export let hostConnection: DataConnection | null = null;
export let clientPeer: Peer | null = null;
let hostPeer: Peer | null = null;
export let connections: DataConnection[] = [];
export let gameScene: MainScene | null = null;

export function setGameScene(scene: MainScene) {
  gameScene = scene;
}

export const synth: Synth | null = new Synth();

buildMissionButtons(Object.values(MISSION_CONFIGS), selectMission);

export function selectMission(missionId: string) {
  const missionConfig = MISSION_CONFIGS[missionId] || MISSION_CONFIGS[relayRush.id];
  const targetPeerId = `neon-mission-${missionConfig.id}`;
  currentMissionId = missionConfig.id;

  disableMissionButtons();

  setStatusText(`Preparing mission ${missionConfig.name}...`);

  roomCode = targetPeerId;
  isHost = false;
  hostConnection = null;

  if (hostPeer) {
    hostPeer.destroy();
    hostPeer = null;
  }
  if (clientPeer) {
    clientPeer.destroy();
    clientPeer = null;
  }

  hostPeer = new Peer(targetPeerId);

  hostPeer.on('open', () => {
    isHost = true;
    setStatusText(`Mission ${missionConfig.name} host ready. Peer ID: ${targetPeerId}`);
    startGame(null);
  });

  hostPeer.on('connection', (conn: DataConnection) => {
    connections.push(conn);
    conn.on('open', () => {
      console.log('Client connected:', conn.peer);
    });
    conn.on('data', (data: PeerMessage) => {
      if (data.type === 'input' && gameScene && gameScene.handleRemoteInput) {
        gameScene.handleRemoteInput(conn.peer, data);
      }
    });
    conn.on('close', () => {
      const idx = connections.indexOf(conn);
      if (idx > -1) connections.splice(idx, 1);
      if (gameScene && gameScene.removeRemotePlayer) {
        gameScene.removeRemotePlayer(conn.peer);
      }
    });
    conn.on('error', (err: unknown) => {
      console.warn('Connection error:', err);
    });
  });

  hostPeer.on('error', (err: Error & { type?: string }) => {
    const message = (err && (err.message || err.type)) || '';
    const isUnavailableId =
      err &&
      (err.type === 'unavailable-id' ||
        err.type === 'peer-unavailable' ||
        message.toLowerCase().includes('unavailable') ||
        message.toLowerCase().includes('taken'));

    if (isUnavailableId) {
      if (hostPeer) {
        hostPeer.destroy();
        hostPeer = null;
      }
      setStatusText(`Mission ${missionConfig.name} is already live. Joining...`);

      joinSector(targetPeerId, missionId);
      return;
    }

    setStatusText(`Peer error: ${message || 'Unknown error'}`);

    enableMissionButtons();
  });
}

function joinSector(targetPeerId: string, missionId: string) {
  isHost = false;
  roomCode = targetPeerId;
  currentMissionId = missionId;
  clientPeer = new Peer();

  clientPeer.on('open', () => {
    setStatusText(`Connecting to mission ${missionId}...`);
    const conn = clientPeer.connect(targetPeerId, { reliable: true });
    hostConnection = conn;

    conn.on('open', () => {
      setStatusText(`Connected to mission ${missionId}. Starting game...`);
      startGame(conn);
    });

    conn.on('data', (data: PeerMessage) => {
      if (gameScene) {
        switch (data.type) {
          case 'state':
            gameScene.receiveState(data);
            break;
          case 'effect':
            gameScene.receiveEffect(data);
            break;
          case 'events':
            gameScene.receiveEvents(data.events);
            break;
          case 'positions':
            gameScene.receivePositions(data.snapshot);
            break;
        }
      }
    });

    conn.on('close', () => {
      setStatusText(`Connection to mission ${missionId} was lost.`);
      enableMissionButtons();
    });

    conn.on('error', (err: Error) => {
      setStatusText(`Connection error: ${err.message || 'Unable to join mission'}`);
      enableMissionButtons();
    });
  });

  clientPeer.on('error', (err: Error) => {
    setStatusText(`Peer error: ${err.message || 'Unable to create client peer'}`);
    enableMissionButtons();
  });
}

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  scale: { mode: Phaser.Scale.RESIZE, parent: 'game-container', width: '100%', height: '100%' },
  physics: { default: 'arcade', arcade: { gravity: { x: 0, y: 0 }, debug: false } },
  scene: MainScene,
};

function startGame(conn: DataConnection | null) {
  hideLobbyOverlay();
  new Phaser.Game(config);
}
