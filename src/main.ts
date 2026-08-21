/// <reference types="vite/client" />

import Phaser from 'phaser';
import { MISSION_CONFIGS } from './data/data';
import { relayRush } from './data/missions/relay-rush';
import {
  buildMissionButtons,
  disableMissionButtons,
  enableMissionButtons,
  hideLobbyOverlay,
  setStatusText,
} from './ui';
import { ClientPeerMessage, HostPeerMessage } from './types/PeerMessages';
import { MainScene } from './MainScene';
import { createOrJoinPeerId } from './network';

export let currentMissionId = relayRush.id;
export let gameScene: MainScene | null = null;

export function setGameScene(scene: MainScene) {
  gameScene = scene;
}

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
          // Hosting: pass host info and sendMessage function into the game
          startGame(true, targetPeerId, hostEvent.sendMessage);
          break;
        }
        case 'message': {
          gameScene && gameScene.receiveMessageFromClient(hostEvent.id, hostEvent.message);
          break;
        }
        case 'connected': {
          gameScene && gameScene.handleClientConnect(hostEvent.id);
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
          // Joined as client: pass client send function into the game
          startGame(false, targetPeerId, clientEvent.sendMessage);
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
  scene: undefined,
};

function startGame(hostFlag: boolean, code: string | null, sendMessage?: (msg: any) => void) {
  hideLobbyOverlay();

  const sceneInstance = new MainScene({
    isHost: hostFlag,
    roomCode: code,
    sendPeerMessage: sendMessage,
  });

  const runtimeConfig: Phaser.Types.Core.GameConfig = {
    ...config,
    scene: sceneInstance,
  };

  new Phaser.Game(runtimeConfig);
}
