import { SnapshotInterpolation } from '@geckos.io/snapshot-interpolation';
import { Snapshot } from '@geckos.io/snapshot-interpolation/lib/types';
import Phaser from 'phaser';
import { BulletManager } from './BulletManager';
import { Controls } from './controls';
import { buildMapConfig, enemyDefinitionLookup, MissionConfig } from './data/data';
import { EnemyManager } from './EnemyManager';
import { GameEvent } from './events';
import { MapManager, SPAWN_TELEGRAPH_MS } from './MapManager';
import { PlayerManager } from './PlayerManager';
import * as sceneBridge from './sceneBridge';
import { TrackerManager } from './TrackerManager';
import {
  PeerEffectMessage,
  HostPeerMessage,
  ClientPeerMessage,
  PeerEntityMessage,
  PeerMapCompleteMessage,
  PeerPositionMessage,
} from './types/PeerMessages';
import { Synth } from './Synth';
import { createTextures } from './graphics';

const synth: Synth | null = new Synth();

export type MainSceneInitData = {
  isHost: boolean;
  roomCode: string | null;
  sendPeerMessage: ((msg: any) => void) | null;
  localPeerId: string | null;
  missionConfig: MissionConfig;
  mapIndex?: number;
};

export class MainScene extends Phaser.Scene {
  private score = 0;
  private gameOver = false;
  private isPaused = false;
  private lastFired = 0;
  private fireRate = 120;
  private gameStarted = true;

  private walls!: Phaser.Physics.Arcade.StaticGroup;

  private player: Phaser.Physics.Arcade.Sprite;

  private playerManager!: PlayerManager;
  private bulletManager!: BulletManager;
  private enemyManager!: EnemyManager;
  private mapManager!: MapManager;
  private trackerManager!: TrackerManager;

  private bulletSprites: Record<string, Phaser.GameObjects.Sprite> = {};
  private enemySprites: Record<string, Phaser.GameObjects.Sprite> = {};

  private emitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private scoreText!: Phaser.GameObjects.Text;
  private pauseText!: Phaser.GameObjects.Text;
  private gameOverText!: Phaser.GameObjects.Text;
  private mapCompleteText!: Phaser.GameObjects.Text;

  private controls!: Controls;

  private localPeerId: string | null = null;
  // private hostPlayerSprite?: Phaser.GameObjects.Sprite;
  // private otherRemoteSprites: Record<string, Phaser.GameObjects.Sprite> = {};

  private baseCenter = { x: 1000, y: 1600 };
  private baseRadius = 180;

  private baseGraphics!: Phaser.GameObjects.Graphics;

  private eventQueue: GameEvent[] = [];
  private entityLookup: Record<string, Phaser.GameObjects.Sprite> = {};

  private SI = new SnapshotInterpolation();

  private isHost = false;
  private roomCode: string | null = null;
  private sendPeerMessage: ((msg: any) => void) | null = null;
  private missionConfig!: MissionConfig;
  private mapIndex = 0;

  constructor() {
    super({ key: 'MainScene' });
  }

  init(data?: MainSceneInitData) {
    if (!data) return;
    this.isHost = data.isHost;
    this.roomCode = data.roomCode;
    this.sendPeerMessage = data.sendPeerMessage;
    this.localPeerId = data.localPeerId;
    this.missionConfig = data.missionConfig;
    this.mapIndex = data.mapIndex ?? 0;
  }

  preload() {
    createTextures(this);
  }

  create() {
    const missionConf = this.missionConfig;
    const mapId = missionConf.mapIds[this.mapIndex] ?? missionConf.mapIds[0];
    const mapConf = buildMapConfig(mapId);

    this.baseCenter = mapConf.baseCenter;
    this.baseRadius = mapConf.baseRadius;

    this.physics.world.setBounds(0, 0, 2000, 2000);
    this.cameras.main.setBounds(0, 0, 2000, 2000);
    this.add.tileSprite(1000, 1000, 2000, 2000, 'grid');

    // Build Walls
    this.walls = this.physics.add.staticGroup();
    mapConf.walls.forEach((w) => {
      const wall = this.add.tileSprite(w.x, w.y, w.w, w.h, 'wall');
      this.physics.add.existing(wall, true);
      this.walls.add(wall);
    });

    this.baseGraphics = this.add.graphics();
    this.baseGraphics.fillStyle(0x00ffcc, 0.16);
    this.baseGraphics.lineStyle(3, 0x00ffcc, 0.8);
    this.baseGraphics.strokeCircle(this.baseCenter.x, this.baseCenter.y, this.baseRadius);
    this.baseGraphics.fillCircle(this.baseCenter.x, this.baseCenter.y, this.baseRadius);
    this.baseGraphics.setDepth(40);

    this.gameOver = false;
    this.isPaused = false;
    this.lastFired = 0;
    this.fireRate = 120;
    this.gameStarted = true;

    this.bulletManager = new BulletManager({
      scene: this,
      entityLookup: this.entityLookup,
      isHost: this.isHost,
      pushEvent: (event) => this.eventQueue.push(event),
      explode: (count, x, y) => this.emitter.explode(count, x, y),
    });

    this.playerManager = new PlayerManager({
      scene: this,
      entityLookup: this.entityLookup,
      baseCenter: this.baseCenter,
      isHost: this.isHost,
      isGameOver: () => this.gameOver,
      isInBaseArea: (x, y) => this.isInBaseArea(x, y),
      broadcastEffect: (effect, x, y) => this.broadcastEffect(effect, x, y),
      pushEvent: (event) => this.eventQueue.push(event),
      fireBullet: (x, y, angle, speed, ownerType, ownerId) =>
        this.bulletManager.fire(x, y, angle, speed, ownerType, ownerId),
    });

    this.trackerManager = new TrackerManager({ scene: this });

    this.player = this.playerManager.createLocalPlayer(
      this.isHost ? 'player' : 'guest',
      this.localPeerId,
      this.isHost
    );
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);

    this.enemyManager = new EnemyManager({
      scene: this,
      walls: this.walls,
      entityLookup: this.entityLookup,
      baseCenter: this.baseCenter,
      baseRadius: this.baseRadius,
      pushEvent: (event) => this.eventQueue.push(event),
      broadcastEffect: (effect, x, y) => this.broadcastEffect(effect, x, y),
      addScore: (amount) => this.addScore(amount),
      fireBullet: (x, y, angle, speed, ownerType, ownerId) =>
        this.bulletManager.fire(x, y, angle, speed, ownerType, ownerId),
    });

    this.mapManager = new MapManager({
      scene: this,
      isHost: this.isHost,
      broadcastEffect: (effect, x, y) => this.broadcastEffect(effect, x, y),
      countAliveEnemies: (enemyId) => this.enemyManager.countAlive(enemyId),
      countAliveTotal: () => this.enemyManager.enemies.countActive(true),
      spawnEnemy: (definition, x, y) => this.enemyManager.spawnEnemy(definition, x, y),
      onMapComplete: () => this.handleMapComplete(),
    });

    // Core Colliders

    if (this.isHost) {
      this.physics.add.collider(this.playerManager.players, this.walls);
      this.physics.add.collider(
        this.bulletManager.bullets,
        this.walls,
        this.bulletManager.hitWall,
        undefined,
        this.bulletManager
      );
      this.physics.add.collider(
        this.bulletManager.bullets,
        this.enemyManager.enemies,
        this.enemyManager.handleBulletHit,
        undefined,
        this.enemyManager
      );
      this.physics.add.collider(
        this.bulletManager.bullets,
        this.playerManager.players,
        this.playerManager.handleBulletHit,
        undefined,
        this.playerManager
      );
      this.physics.add.collider(
        this.playerManager.players,
        this.enemyManager.enemies,
        this.playerManager.hitPlayer,
        undefined,
        this.playerManager
      );
      this.physics.add.collider(this.enemyManager.enemies, this.walls);
    }

    this.emitter = this.add.particles(0, 0, 'particle', {
      speed: { min: 50, max: 200 },
      angle: { min: 0, max: 360 },
      scale: { start: 1, end: 0 },
      blendMode: 'ADD',
      lifespan: 400,
      emitting: false,
    });

    this.scoreText = this.add
      .text(
        20,
        20,
        'SCORE: 0 | MISSION: ' +
          missionConf.name +
          ' | ROLE: ' +
          (this.isHost ? 'HOST (' + (this.roomCode ?? '') + ')' : 'CLIENT'),
        {
          fontSize: '20px',
          fontFamily: 'Courier',
          fontStyle: 'bold',
        }
      )
      .setScrollFactor(0)
      .setDepth(300);

    this.pauseText = this.add
      .text(this.scale.width / 2, this.scale.height / 2, 'GAME PAUSED', {
        fontSize: '48px',
        align: 'center',
        fontFamily: 'Courier',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setVisible(false)
      .setDepth(300);

    this.gameOverText = this.add
      .text(this.scale.width / 2, this.scale.height / 2, 'GAME OVER\nTap to Restart', {
        fontSize: '48px',
        align: 'center',
        fontFamily: 'Courier',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setVisible(false)
      .setDepth(300);

    this.mapCompleteText = this.add
      .text(this.scale.width / 2, this.scale.height / 2, 'MAP COMPLETE', {
        fontSize: '48px',
        align: 'center',
        fontFamily: 'Courier',
        fontStyle: 'bold',
        color: '#00ffcc',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setVisible(false)
      .setDepth(300);

    this.input.once('pointerdown', () => {
      if (synth) synth.unlock();
    });

    this.input.addPointer(2);
    this.controls = new Controls(this, {
      isGameOver: () => this.gameOver,
      onRestart: () => {
        if (this.isHost) this.scene.restart();
      },
    });
    this.controls.initialize();

    this.scale.on('resize', this.resize, this);

    this.mapManager.init(mapConf.spawnSchedule, this.time.now);
  }

  private isInBaseArea(x: number, y: number) {
    return (
      Phaser.Math.Distance.Between(this.baseCenter.x, this.baseCenter.y, x, y) <= this.baseRadius
    );
  }

  private applyEffect(effect: PeerEffectMessage['effect'], x?: number, y?: number) {
    switch (effect) {
      case 'explosion':
        if (x !== undefined && y !== undefined) this.emitter.explode(10, x, y);
        if (synth) synth.playExplosion();
        break;
      case 'hit':
        if (x !== undefined && y !== undefined) this.emitter.explode(6, x, y);
        if (synth) synth.playHit();
        break;
      case 'spawn':
        if (synth) synth.playHit();
        break;
      case 'big-spawn':
        if (synth) synth.playBigSpawn();
        break;
      case 'death':
        if (x !== undefined && y !== undefined) this.emitter.explode(30, x, y);
        if (synth) synth.playDeath();
        break;
      case 'shot':
        if (synth) synth.playShot();
        break;
      case 'laser':
        if (synth) synth.playLaser();
        break;
      case 'spawn-warning':
        if (x !== undefined && y !== undefined) this.showSpawnWarning(x, y);
        if (synth) synth.playWarning();
        break;
    }
  }

  private showSpawnWarning(x: number, y: number) {
    const ring = this.add
      .circle(x, y, 10, 0xff3300, 0)
      .setStrokeStyle(3, 0xff3300, 0.9)
      .setDepth(15);

    this.tweens.add({
      targets: ring,
      radius: 48,
      alpha: 0,
      duration: SPAWN_TELEGRAPH_MS,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });
  }

  private broadcastEffect(effect: PeerEffectMessage['effect'], x?: number, y?: number) {
    this.applyEffect(effect, x, y);
    if (!this.isHost) return;
    if (!this.sendPeerMessage) return;
    const message: PeerEffectMessage = { type: 'effect', effect, x, y };
    this.sendPeerMessage(message);
  }

  getEntityBySyncId(syncId: string): Phaser.Physics.Arcade.Sprite | null {
    return this.entityLookup[syncId] as Phaser.Physics.Arcade.Sprite;
  }

  private addScore(amount: number) {
    this.score += amount;
    this.scoreText.setText('SCORE: ' + this.score + ' | ROLE: HOST (' + (this.roomCode ?? '') + ')');
  }

  private handleEvent(event: GameEvent) {
    switch (event.type) {
      case 'bullet-destroyed': {
        this.bulletManager.destroyBullet(event);
        break;
      }
      case 'bullet-created': {
        this.bulletManager.createBulletSprite(event);
        break;
      }
      case 'enemy-created': {
        if (this.entityLookup[event.enemyId]) break; // already known (event replayed twice)
        const definition = enemyDefinitionLookup[event.definitionId];
        if (definition) {
          this.enemyManager.createEnemySprite(definition, event.x, event.y, event.enemyId);
        }
        break;
      }
      case 'enemy-hit': {
        const sprite = this.getEntityBySyncId(event.enemyId);
        if (sprite && sprite.active) {
          this.enemyManager.flashHit(sprite, !!event.indestructible);
        }
        break;
      }
      case 'enemy-destroyed': {
        const sprite = this.getEntityBySyncId(event.enemyId);
        if (sprite && sprite.active) {
          this.emitter.explode(8, sprite.x, sprite.y);
          sprite.destroy();
        }
        delete this.entityLookup[event.enemyId];

        if (event.cascadeParentId) {
          this.enemyManager.enemies.getChildren().forEach((e: Phaser.GameObjects.Sprite) => {
            if (e.active && e.getData('parentEnemy') === event.cascadeParentId) {
              const partSyncId = e.getData('syncId') as string;
              e.destroy();
              delete this.entityLookup[partSyncId];
            }
          });
        }
        break;
      }
      case 'player-left': {
        this.playerManager.removeRemotePlayer(event.peerId);
        break;
      }
    }
  }

  // Full snapshot sent on every client connect/disconnect, so a (re)joining client can
  // catch up on players, in-flight bullets, and any enemies it hasn't seen yet — every
  // enemy is spawned at runtime via the 'enemy-created' event (see spawnEnemy), so a
  // client that joins after a spawn never saw that event and relies on this instead.
  broadcastState() {
    if (!this.isHost || !this.sendPeerMessage) return;

    const state: PeerEntityMessage = {
      type: 'entities',
      players: this.playerManager.players.getChildren().map((e: Phaser.GameObjects.Sprite) => ({
        id: (e.getData('syncId') as string) || '',
        x: e.x,
        y: e.y,
        r: e.rotation,
        isDead: e.getData('isDead') as boolean,
      })),
      // All enemies are spawned dynamically at runtime (via MapManager's schedule or a
      // spawner), so late-joining clients rely entirely on this to catch up — see
      // receiveEntitySnapshot.
      enemies: this.enemyManager.enemies.getChildren().map((e: Phaser.GameObjects.Sprite) => ({
        id: (e.getData('syncId') as string) || '',
        x: e.x,
        y: e.y,
        r: e.rotation,
        definitionId: e.getData('enemyId') as string,
        partId: e.getData('isPart') ? (e.getData('partId') as string) : undefined,
      })),
      bullets: this.bulletManager.bullets.getChildren().map((b: Phaser.GameObjects.Sprite) => ({
        id: (b.getData('syncId') as string) || '',
        x: b.x,
        y: b.y,
        r: b.rotation,
        ownerType: (b.getData('ownerType') as 'player' | 'enemy') || 'enemy',
      })),
    };

    // send state to connected clients via stored send function
    this.sendPeerMessage(state);
  }

  sendInput() {
    if (this.isHost) return;
    const send = this.sendPeerMessage;
    if (!send) return;

    const movement = this.controls.getMovementInput();
    const shootInput = this.controls.getShootInput(this.player);

    send({
      type: 'input',
      moveX: movement.x,
      moveY: movement.y,
      shoot: shootInput.shoot,
      aimAngle: shootInput.angle,
    });
  }

  syncSprites<T extends { id: string; x: number; y: number; r: number }>(
    entities: T[],
    sprites: Record<string, Phaser.GameObjects.Sprite>,
    initSprite: (entity: T) => Phaser.GameObjects.Sprite,
    onRemove?: (id: string) => void
  ) {
    const existing = new Set<string>();

    for (const entity of entities) {
      const { id, x, y, r, ...rest } = entity;

      let sprite = sprites[id];

      if (!sprite) {
        sprite = initSprite(entity);
        sprites[id] = sprite;
      }
      sprite.setPosition(x, y);
      sprite.rotation = r;
      if ('visible' in rest && typeof rest.visible === 'boolean') {
        sprite.setVisible(rest.visible);
      }
      existing.add(id);
    }

    const forDeletion = Object.keys(sprites).filter((id) => !existing.has(id));

    for (const id of forDeletion) {
      sprites[id].destroy();
      delete sprites[id];
      onRemove?.(id);
    }
  }

  // Players: the local player's own sprite is already registered under its own
  // syncId (see create()), so syncSprites reuses and repositions it rather than
  // creating a duplicate "self" sprite from the host's snapshot.
  receiveEntitySnapshot(data: PeerEntityMessage) {
    this.syncSprites(
      data.players,
      this.playerManager.playerSprites,
      (player) => {
        const sprite = this.playerManager.players.create(player.x, player.y, 'guest');
        sprite.setDepth(2);
        sprite.setData('syncId', player.id);
        this.playerManager.applyPlayerColor(sprite, player.id);
        this.entityLookup[player.id] = sprite;
        return sprite;
      },
      (id) => delete this.entityLookup[id]
    );

    this.syncSprites(
      data.bullets,
      this.bulletSprites,
      (bullet) => {
        const existing = this.entityLookup[bullet.id];
        if (existing) return existing;
        const sprite = this.bulletManager.bullets.create(bullet.x, bullet.y, 'bullet');
        sprite.setData('syncId', bullet.id);
        sprite.setData('ownerType', bullet.ownerType);
        if (bullet.ownerType === 'enemy') sprite.setTint(0xff3333);
        this.entityLookup[bullet.id] = sprite;
        return sprite;
      },
      (id) => delete this.entityLookup[id]
    );

    // Enemies this client already knows about (from a live 'enemy-created' event) are
    // just reused/repositioned here. Only enemies it never saw — e.g. spawned by the
    // map's schedule or a spawner before it joined — actually get created.
    this.syncSprites(
      data.enemies,
      this.enemySprites,
      (enemy) => {
        const existing = this.entityLookup[enemy.id];
        if (existing) return existing;
        const textureKey = this.enemyManager.resolveEnemyTextureKey(enemy.definitionId, enemy.partId);
        const sprite = this.enemyManager.enemies.create(enemy.x, enemy.y, textureKey);
        sprite.setData('syncId', enemy.id);
        sprite.setData('enemyId', enemy.definitionId);
        sprite.setData('type', enemy.definitionId);
        if (enemy.partId) {
          sprite.setData('isPart', true);
          sprite.setData('partId', enemy.partId);
          sprite.setData('parentEnemy', enemy.id.split('::')[0]);
        }
        this.entityLookup[enemy.id] = sprite;
        return sprite;
      },
      (id) => delete this.entityLookup[id]
    );
  }

  // Called on clients when a host-originating message arrives
  receiveMessageFromHost(messages: HostPeerMessage[]) {
    if (!messages) return;
    for (const message of messages) {
      switch (message.type) {
        case 'entities':
          this.receiveEntitySnapshot(message);
          break;
        case 'positions':
          this.receivePositions(message.snapshot);
          break;
        case 'effect':
          this.receiveEffect(message);
          break;
        case 'events':
          this.receiveEvents(message.events);
          break;
        case 'map-complete':
          this.showMapComplete(message.nextMapIndex);
          break;
        default:
          // unknown host message
          break;
      }
    }
  }

  // Called on host when a client-originating message arrives. `peerId` is the client's id.
  receiveMessageFromClient(peerId: string, messages: ClientPeerMessage[]) {
    if (!messages) return;
    for (const message of messages) {
      if (message.type === 'input') {
        this.playerManager.handleRemoteInput(peerId, message);
      }
    }
  }

  handleClientDisconnect(peerId: string) {
    // remove any remote player state and indicators, and tell other clients
    this.playerManager.removeRemotePlayer(peerId);
    this.eventQueue.push({ type: 'player-left', peerId });
  }

  handleClientConnect(peerId: string) {
    this.playerManager.addRemotePlayer(peerId);
    this.broadcastState();
  }

  handleHostDisconnect() {
    // Client was disconnected from host — pause / end game
    this.gameOver = true;
    if (this.gameOverText) this.gameOverText.setVisible(true);
    try {
      this.physics.pause();
    } catch (err) {
      // ignore if physics not available
    }
  }

  receiveEffect(data: PeerEffectMessage) {
    if (this.isHost || !data || data.type !== 'effect') return;
    this.applyEffect(data.effect, data.x, data.y);
  }

  resize(gameSize: Phaser.Structs.Size) {
    if (this.gameOverText) this.gameOverText.setPosition(gameSize.width / 2, gameSize.height / 2);
    if (this.pauseText) this.pauseText.setPosition(gameSize.width / 2, gameSize.height / 2);
    if (this.mapCompleteText) {
      this.mapCompleteText.setPosition(gameSize.width / 2, gameSize.height / 2);
    }
  }

  // Host-only: called by MapManager once every enemy on the current map is dead.
  // Tells clients, then shows the success message locally on host and clients alike.
  private handleMapComplete() {
    const nextMapIndex = this.mapIndex + 1;
    const hasNextMap = nextMapIndex < this.missionConfig.mapIds.length;

    if (this.sendPeerMessage) {
      const message: PeerMapCompleteMessage = {
        type: 'map-complete',
        nextMapIndex: hasNextMap ? nextMapIndex : null,
      };
      this.sendPeerMessage(message);
    }

    this.showMapComplete(hasNextMap ? nextMapIndex : null);
  }

  // Shows the success banner and, if there is a next map, switches every peer to it
  // via sceneBridge after a beat so the message is actually readable.
  private showMapComplete(nextMapIndex: number | null) {
    this.mapCompleteText
      .setText(nextMapIndex !== null ? 'MAP COMPLETE' : 'MISSION COMPLETE')
      .setVisible(true);

    if (nextMapIndex === null) return;

    this.time.delayedCall(2500, () => {
      sceneBridge.launch('MainScene', {
        isHost: this.isHost,
        roomCode: this.roomCode,
        sendPeerMessage: this.sendPeerMessage,
        localPeerId: this.localPeerId,
        missionConfig: this.missionConfig,
        mapIndex: nextMapIndex,
      });
    });
  }

  update(time: number, delta: number) {
    if (this.controls.isPauseJustPressed()) {
      this.isPaused = !this.isPaused;
      this.pauseText.setVisible(this.isPaused);
      if (this.isPaused) this.physics.pause();
      else if (!this.gameOver) this.physics.resume();
    }

    this.trackerManager.update(this.playerManager.playerSprites, this.localPeerId);

    if (this.gameOver || this.isPaused || !this.gameStarted) return;

    if (!this.player!.getData('isDead')) {
      const movement = this.controls.getMovementInput();
      const moveX = movement.x;
      const moveY = movement.y;

      const speed = 350;
      this.player!.setVelocity(moveX * speed, moveY * speed);

      const shootInput = this.controls.getShootInput(this.player);

      if (shootInput.shoot) {
        this.player!.rotation = shootInput.angle;
        if (
          this.isHost &&
          !this.isInBaseArea(this.player!.x, this.player!.y) &&
          time > this.lastFired
        ) {
          this.bulletManager.fire(
            this.player!.x,
            this.player!.y,
            shootInput.angle,
            1000,
            'player',
            (this.player!.getData('syncId') as string) || 'host'
          );
          this.lastFired = time + this.fireRate;
        }
      } else if (moveX !== 0 || moveY !== 0) {
        this.player!.rotation = Math.atan2(moveY, moveX);
      }
    } else {
      this.player!.setVelocity(0, 0);
    }

    if (this.isHost) {
      this.playerManager.updateRemotePlayers(time, this.fireRate, this.player);

      const alivePlayers = this.playerManager.getAlivePlayers();
      this.enemyManager.update(time, alivePlayers);
      this.mapManager.update(time);

      const snapshot = this.SI.snapshot.create(
        Object.entries(this.entityLookup).map(([id, p]) => ({
          id,
          x: p.x,
          y: p.y,
          r: p.rotation,
        }))
      );
      this.SI.vault.add(snapshot);
      this.broadcastPositions(snapshot);
    } else {
      // calculate the interpolation for the parameters x and y and return the snapshot
      const snapshot = this.SI.calcInterpolation('x y r'); // [deep: string] as optional second parameter

      // access your state
      if (snapshot) {
        const { state } = snapshot;

        for (const pos of state) {
          if (pos.id === this.localPeerId) {
            this.reconcileLocalPlayer(pos.x as number, pos.y as number);
            continue;
          }
          const entity = this.entityLookup[pos.id];
          if (entity) {
            entity.x = pos.x as number;
            entity.y = pos.y as number;
            entity.rotation = pos.r as number;
          }
        }
      }

      this.sendInput();
    }

    this.enemyManager.draw();

    if (this.isHost) {
      this.broadcastEventQueue(this.eventQueue);
    }

    for (const event of this.eventQueue) {
      this.handleEvent(event);
    }
    this.eventQueue = [];
  }

  private broadcastPositions(snapshot: Snapshot) {
    if (!this.isHost || !this.sendPeerMessage) return;
    const message: PeerPositionMessage = { type: 'positions', snapshot };
    this.sendPeerMessage(message);
  }

  // The client predicts its own player locally from input rather than waiting on the
  // host's snapshot (that's what keeps movement responsive). Left alone, that prediction
  // drifts from the host's authoritative simulation — e.g. after a wall collision the two
  // physics steps can resolve slightly differently — and nothing ever pulled it back, so
  // the drift was permanent.
  //
  // The host's snapshot is always ~50-150ms stale (network + interpolation buffer), so
  // while the player is actively moving that gap is just latency, not drift — nudging
  // toward it every frame means fighting your own input each frame, which reads as bounce.
  // Only reconcile once movement has stopped, when a lingering gap is real drift rather
  // than lag; a huge gap (e.g. just reconnected) still snaps immediately either way.
  private reconcileLocalPlayer(hostX: number, hostY: number) {
    const player = this.player!;
    const dx = hostX - player.x;
    const dy = hostY - player.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    const SNAP_THRESHOLD = 150;
    const CORRECTION_RATE = 0.1;

    if (distance > SNAP_THRESHOLD) {
      player.x = hostX;
      player.y = hostY;
      return;
    }

    const body = player.body as Phaser.Physics.Arcade.Body;
    const isMoving = body.velocity.x !== 0 || body.velocity.y !== 0;
    if (isMoving) return;

    if (distance > 1) {
      player.x += dx * CORRECTION_RATE;
      player.y += dy * CORRECTION_RATE;
    }
  }

  private broadcastEventQueue(eventQueue: GameEvent[]) {
    if (!this.isHost || !this.sendPeerMessage) return;
    if (!eventQueue.length) return;
    const msg = { type: 'events', events: eventQueue };
    this.sendPeerMessage(msg);
  }

  receiveEvents(events: GameEvent[]) {
    this.eventQueue.push(...events);
  }

  receivePositions(snapshot: Snapshot) {
    if (this.isHost || !snapshot) return;
    this.SI.snapshot.add(snapshot);
  }
}
