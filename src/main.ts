/// <reference types="vite/client" />

import Phaser from 'phaser';
import { MISSION_CONFIGS, MissionConfig } from './data/data';
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
import * as sceneBridge from './sceneBridge';

buildMissionButtons(Object.values(MISSION_CONFIGS), selectMission);

function selectMission(missionId: string) {
  const missionConfig = MISSION_CONFIGS[missionId] || MISSION_CONFIGS[relayRush.id];
  const targetPeerId = `neon-mission-${missionConfig.id}`;

  disableMissionButtons();

  setStatusText(`Preparing mission ${missionConfig.name}...`);

  createOrJoinPeerId<HostPeerMessage, ClientPeerMessage>(
    targetPeerId,
    (hostEvent) => {
      console.log('message from client', hostEvent.type, targetPeerId, hostEvent);

      switch (hostEvent.type) {
        case 'start': {
          // Hosting: pass host info and sendMessage function into the game
          startGame(true, targetPeerId, missionConfig, hostEvent.sendMessage, 'host');
          break;
        }
        case 'message': {
          sceneBridge.withScene((scene) =>
            scene.receiveMessageFromClient(hostEvent.id, hostEvent.message)
          );
          break;
        }
        case 'connected': {
          sceneBridge.withScene((scene) => scene.handleClientConnect(hostEvent.id));
          break;
        }
        case 'disconnected': {
          sceneBridge.withScene((scene) => scene.handleClientDisconnect(hostEvent.id));
          enableMissionButtons();
          break;
        }
      }
    },
    (clientEvent) => {
      console.log('message from host', clientEvent.type, targetPeerId, clientEvent);
      switch (clientEvent.type) {
        case 'start': {
          // Joined as client: pass client send function into the game
          startGame(false, targetPeerId, missionConfig, clientEvent.sendMessage, clientEvent.id);
          break;
        }
        case 'message': {
          sceneBridge.withScene((scene) => scene.receiveMessageFromHost(clientEvent.message));
          break;
        }
        case 'disconnected': {
          sceneBridge.withScene((scene) => scene.handleHostDisconnect());
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
};

const game = new Phaser.Game(config);
sceneBridge.initialize(game);
sceneBridge.registerScene('MainScene', MainScene);

// Guard against leaking a second Game/WebGL context if Vite HMR re-executes
// this module without a full page reload.
if (import.meta.hot) {
  import.meta.hot.dispose(() => game.destroy(true));
}

function startGame(
  hostFlag: boolean,
  code: string | null,
  missionConfig: MissionConfig,
  sendMessage?: (msg: any) => void,
  localPeerId?: string
) {
  hideLobbyOverlay();

  sceneBridge.launch('MainScene', {
    isHost: hostFlag,
    roomCode: code,
    sendPeerMessage: sendMessage ?? null,
    localPeerId: localPeerId ?? null,
    missionConfig,
  });
}
