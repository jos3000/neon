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
import { ClientPeerMessage, HostPeerMessage, PeerMessage } from './types/Snapshot';
import { MainScene } from './MainScene';
import { createOrJoinPeerId } from './network';

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

  createOrJoinPeerId<HostPeerMessage, ClientPeerMessage>(
    targetPeerId,
    (hostEvent) => {
      switch (hostEvent.type) {
        case 'start': {
          hostEvent.sendMessage; // this should be an argument
          startGame(null);
          break;
        }
        case 'message': {
          gameScene && gameScene.receiveMessageFromClient(hostEvent.message);
          break;
        }
        case 'disconnected': {
          gameScene && gameScene.handleClientDisconnect(hostEvent.id);
          enableMissionButtons();
          break;
        }
      }
    },
    (clientEvent) => {
      switch (clientEvent.type) {
        case 'start': {
          clientEvent.sendMessage; // this should be an argument
          startGame(null);
          break;
        }
        case 'message': {
          gameScene && gameScene.receiveMessageFromHost(clientEvent.message);
          break;
        }
        case 'disconnected': {
          gameScene && gameScene.handleHostDisconnect();
          enableMissionButtons();
          break;
        }
      }
    }
  );
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
