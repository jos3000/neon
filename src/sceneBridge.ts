import Phaser from 'phaser';
import { MainScene, MainSceneInitData } from './MainScene';

let game: Phaser.Game | null = null;
let activeScene: MainScene | null = null;
let pending: Array<(scene: MainScene) => void> = [];

export function initialize(gameInstance: Phaser.Game) {
  game = gameInstance;
}

// Registers a scene class under `key` exactly once and wires its CREATE/SHUTDOWN
// events to track it as the active scene. Subscribing here (rather than per-launch)
// matters: the scene instance and its event emitter persist across every restart(),
// so a per-launch subscription would stack a duplicate listener pair on each restart.
export function registerScene(key: string, sceneClass: new () => MainScene) {
  if (!game) throw new Error('sceneBridge.initialize() must be called before registerScene()');

  // game.scene.add() returns null (and internally queues the add) if the
  // SceneManager itself hasn't finished booting yet — note this is
  // game.scene.isBooted, a separate, later flag than game.isBooted (which
  // flips true as soon as the DOM is ready, well before the SceneManager is
  // done). Defer until the SceneManager is actually ready.
  if (!game.scene.isBooted) {
    game.events.once(Phaser.Core.Events.READY, () => registerScene(key, sceneClass));
    return;
  }

  if (game.scene.getScene(key)) {
    console.warn(`sceneBridge: scene "${key}" is already registered`);
    return;
  }

  const scene = game.scene.add(key, sceneClass, false) as MainScene;

  scene.events.on(Phaser.Scenes.Events.CREATE, () => {
    activeScene = scene;
    const callbacks = pending;
    pending = [];
    callbacks.forEach((callback) => callback(scene));
  });

  scene.events.on(Phaser.Scenes.Events.SHUTDOWN, () => {
    if (activeScene === scene) activeScene = null;
  });
}

// Single entry point for running a scene, whether it's the first launch or a
// later switch to a different (or the same, i.e. restart) scene. Delegates to
// Phaser's own scene-to-scene start idiom once something is already running.
export function launch(key: string, data: MainSceneInitData) {
  if (!game) throw new Error('sceneBridge.initialize() must be called before launch()');
  if (activeScene) {
    activeScene.scene.start(key, data);
  } else {
    game.scene.start(key, data);
  }
}

// Calls back with the active scene immediately, or queues the callback until a
// scene becomes active (there's an inherent one-tick gap between scene.start()
// being requested and its CREATE event firing).
export function withScene(callback: (scene: MainScene) => void) {
  if (activeScene) {
    callback(activeScene);
  } else {
    pending.push(callback);
  }
}
