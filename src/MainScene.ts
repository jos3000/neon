import { SnapshotInterpolation } from '@geckos.io/snapshot-interpolation';
import { Snapshot } from '@geckos.io/snapshot-interpolation/lib/types';
import Phaser from 'phaser';
import { Controls } from './controls';
import { enemyDefinitionLookup, MissionConfig } from './data/data';
import { EnemyManager } from './EnemyManager';
import { GameEvent } from './events';
import {
  PeerEffectMessage,
  PeerInputMessage,
  HostPeerMessage,
  ClientPeerMessage,
  PeerEntityMessage,
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

  private bullets!: Phaser.Physics.Arcade.Group;
  private players!: Phaser.Physics.Arcade.Group;
  private enemyManager!: EnemyManager;

  private playerSprites: Record<string, Phaser.Physics.Arcade.Sprite> = {};
  private bulletSprites: Record<string, Phaser.GameObjects.Sprite> = {};
  private enemySprites: Record<string, Phaser.GameObjects.Sprite> = {};

  private nextBulletId = 0;

  private emitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private scoreText!: Phaser.GameObjects.Text;
  private pauseText!: Phaser.GameObjects.Text;
  private gameOverText!: Phaser.GameObjects.Text;

  private controls!: Controls;

  private localPeerId: string | null = null;
  // private hostPlayerSprite?: Phaser.GameObjects.Sprite;
  // private otherRemoteSprites: Record<string, Phaser.GameObjects.Sprite> = {};
  private playerIndicators: Record<string, Phaser.GameObjects.Graphics> = {};
  private playerColors: Record<string, number> = {};

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
  }

  preload() {
    createTextures(this);
  }

  create() {
    const missionConf = this.missionConfig;

    this.baseCenter = missionConf.baseCenter;
    this.baseRadius = missionConf.baseRadius;

    this.physics.world.setBounds(0, 0, 2000, 2000);
    this.cameras.main.setBounds(0, 0, 2000, 2000);
    this.add.tileSprite(1000, 1000, 2000, 2000, 'grid');

    // Build Walls
    this.walls = this.physics.add.staticGroup();
    missionConf.walls.forEach((w) => {
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

    this.players = this.physics.add.group({ collideWorldBounds: true });

    this.player = this.players.create(
      this.baseCenter.x,
      this.baseCenter.y,
      this.isHost ? 'player' : 'guest'
    );

    this.player.setData('syncId', this.localPeerId);
    this.playerSprites[this.localPeerId] = this.player;
    if (this.isHost && this.localPeerId) {
      this.entityLookup[this.localPeerId] = this.player;
    }

    this.player.setDepth(2);
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);

    this.bullets = this.physics.add.group({ runChildUpdate: true });

    this.enemyManager = new EnemyManager({
      scene: this,
      walls: this.walls,
      entityLookup: this.entityLookup,
      baseCenter: this.baseCenter,
      baseRadius: this.baseRadius,
      isHost: this.isHost,
      pushEvent: (event) => this.eventQueue.push(event),
      broadcastEffect: (effect, x, y) => this.broadcastEffect(effect, x, y),
      addScore: (amount) => this.addScore(amount),
      nextBulletId: () => `bullet-${++this.nextBulletId}`,
    });

    // Core Colliders

    if (this.isHost) {
      this.physics.add.collider(this.players, this.walls);
      this.physics.add.collider(this.bullets, this.walls, this.hitWall, undefined, this);
      this.physics.add.collider(
        this.bullets,
        this.enemyManager.enemies,
        this.enemyManager.handleBulletHit,
        undefined,
        this.enemyManager
      );
      this.physics.add.collider(this.players, this.enemyManager.enemies, this.hitPlayer, undefined, this);
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

    this.enemyManager.initMapEnemies(missionConf.enemySpawns);
  }

  private getPlayerColor(id: string): number {
    if (this.playerColors[id] !== undefined) return this.playerColors[id];

    const palette = [0xff5d73, 0x4ecdc4, 0xffd166, 0x6c5ce7, 0x2ec4b6, 0xff8fab, 0x7f5af0];
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = (hash << 5) - hash + id.charCodeAt(i);
      hash |= 0;
    }

    const color = palette[Math.abs(hash) % palette.length];
    this.playerColors[id] = color;
    return color;
  }

  private applyPlayerColor(sprite: Phaser.GameObjects.Sprite, id: string) {
    const color = this.getPlayerColor(id);
    sprite.setTint(color);
    sprite.setData('playerColor', color);
  }

  private updateOffscreenIndicators() {
    const camera = this.cameras.main;
    const viewLeft = camera.scrollX;
    const viewRight = camera.scrollX + camera.width;
    const viewTop = camera.scrollY;
    const viewBottom = camera.scrollY + camera.height;
    const trackedSprites: Array<{ id: string; sprite: Phaser.GameObjects.Sprite }> = [];

    Object.entries(this.playerSprites).forEach(([id, sprite]) => {
      if (id !== this.localPeerId) {
        trackedSprites.push({ id, sprite });
      }
    });

    trackedSprites.forEach(({ id, sprite }) => {
      const indicatorId = `indicator-${id}`;
      if (!this.playerIndicators[indicatorId]) {
        this.playerIndicators[indicatorId] = this.add
          .graphics({ x: 0, y: 0 })
          .setScrollFactor(0)
          .setDepth(250);
      }
      const indicator = this.playerIndicators[indicatorId];
      const isVisible =
        sprite.x >= viewLeft &&
        sprite.x <= viewRight &&
        sprite.y >= viewTop &&
        sprite.y <= viewBottom;

      if (isVisible) {
        indicator.clear();
        indicator.setVisible(false);
        return;
      }

      const screenX = sprite.x - viewLeft;
      const screenY = sprite.y - viewTop;
      const centerX = camera.width / 2;
      const centerY = camera.height / 2;
      const relX = screenX - centerX;
      const relY = screenY - centerY;
      const scale = Math.max(
        Math.abs(relX) / (camera.width / 2),
        Math.abs(relY) / (camera.height / 2)
      );
      const edgeX = centerX + relX / scale;
      const edgeY = centerY + relY / scale;
      const angle = Math.atan2(screenY - edgeY, screenX - edgeX);
      const pointerSize = 14;
      const tipX = edgeX;
      const tipY = edgeY;
      const baseX = tipX - Math.cos(angle) * pointerSize;
      const baseY = tipY - Math.sin(angle) * pointerSize;
      const leftX = baseX + Math.cos(angle + Math.PI / 2) * pointerSize * 0.6;
      const leftY = baseY + Math.sin(angle + Math.PI / 2) * pointerSize * 0.6;
      const rightX = baseX + Math.cos(angle - Math.PI / 2) * pointerSize * 0.6;
      const rightY = baseY + Math.sin(angle - Math.PI / 2) * pointerSize * 0.6;
      const color = sprite.getData('playerColor') || 0xffffff;

      indicator.clear();
      indicator.setVisible(true);
      indicator.lineStyle(2, color, 1);
      indicator.beginPath();
      indicator.moveTo(tipX, tipY);
      indicator.lineTo(leftX, leftY);
      indicator.lineTo(rightX, rightY);
      indicator.closePath();
      indicator.strokePath();
      indicator.fillStyle(color, 1);
      indicator.fillPath();
    });

    Object.keys(this.playerIndicators).forEach((indicatorKey) => {
      const isTracked = trackedSprites.some(({ id }) => `indicator-${id}` === indicatorKey);
      if (!isTracked) {
        this.playerIndicators[indicatorKey].destroy();
        delete this.playerIndicators[indicatorKey];
      }
    });
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
    }
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
        // destroy the bullet and show an impact effect at the host's authoritative
        // impact position (event.x/y) — the client's own bulletSprite.x/y lags behind
        // due to snapshot interpolation, so using it here made the effect land short.
        const bulletSprite = this.getEntityBySyncId(event.bulletId);
        this.emitter.explode(4, event.x, event.y);
        if (bulletSprite) {
          bulletSprite.destroy();
          delete this.entityLookup[event.bulletId];
        }
        break;
      }
      case 'bullet-created': {
        // create a new bullet with the given properties
        const bulletSprite = this.bullets.create(event.x, event.y, 'bullet');
        this.entityLookup[event.bulletId] = bulletSprite;
        bulletSprite.setData('syncId', event.bulletId);
        bulletSprite.setData('angle', event.angle);
        bulletSprite.setDepth(1);
        if (this.isHost) {
          bulletSprite.setData('speed', event.speed);
          this.physics.velocityFromRotation(
            event.angle,
            event.speed,
            bulletSprite.body.velocity as Phaser.Math.Vector2
          );
          // TODO: potentially put this in a seperate management function
          bulletSprite.update = function (t: number, d: number) {
            const born = this.getData('born') || 0 + d;
            this.setData('born', born);
            if (born > 1500) {
              this.eventQueue.push({
                type: 'bullet-destroyed',
                bulletId: this.getData('syncId'),
                x: this.x,
                y: this.y,
              });
            }
          };
        }

        break;
      }
      case 'enemy-created': {
        if (this.entityLookup[event.enemyId]) break; // already known (e.g. from initMapEnemies)
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
        this.removeRemotePlayer(event.peerId);
        break;
      }
    }
  }

  hitWall(
    bullet: Phaser.Types.Physics.Arcade.GameObjectWithBody,
    _wall: Phaser.Types.Physics.Arcade.GameObjectWithBody
  ) {
    const bulletSprite = bullet as Phaser.GameObjects.Sprite;
    this.eventQueue.push({
      type: 'bullet-destroyed',
      bulletId: bulletSprite.getData('syncId'),
      x: bulletSprite.x,
      y: bulletSprite.y,
    });
  }

  respawnPlayer(player: Phaser.Physics.Arcade.Sprite) {
    if (!player || !player.active) return;

    const spawnX = this.baseCenter.x + Phaser.Math.Between(-80, 80);
    const spawnY = this.baseCenter.y + Phaser.Math.Between(-80, 80);

    player.setData('isDead', false);
    player.clearTint();
    player.setVisible(true);
    player.body.enable = true;
    player.body.reset(spawnX, spawnY);
    player.setVelocity(0, 0);
  }

  handlePlayerDeath(player: Phaser.Physics.Arcade.Sprite) {
    if (!player || !player.active || player.getData('isDead')) return;

    player.setData('isDead', true);
    player.setTint(0xff0000);
    player.setVelocity(0, 0);
    player.body.enable = false;
    player.setVisible(false);
    this.broadcastEffect('death', player.x, player.y);

    this.time.delayedCall(3000, () => {
      if (!player || !player.active) return;
      this.respawnPlayer(player);
    });
  }

  hitPlayer(
    player: Phaser.Types.Physics.Arcade.GameObjectWithBody,
    enemy: Phaser.Types.Physics.Arcade.GameObjectWithBody
  ) {
    if (this.gameOver) return;
    this.handlePlayerDeath(player as Phaser.Physics.Arcade.Sprite);
  }

  getAlivePlayers(): Phaser.GameObjects.Sprite[] {
    const alivePlayers: Phaser.GameObjects.Sprite[] = [];

    for (const [id, sprite] of Object.entries(this.playerSprites)) {
      if (sprite.visible) {
        alivePlayers.push(sprite);
      }
    }

    return alivePlayers;
  }

  handleRemoteInput(peerId: string, data: PeerInputMessage) {
    if (!this.isHost || this.gameOver) return;
    if (!this.playerSprites[peerId]) {
      this.addRemotePlayer(peerId);
    }
    const rp = this.playerSprites[peerId];
    rp.setData('moveX', data.moveX || 0);
    rp.setData('moveY', data.moveY || 0);
    rp.setData('aimAngle', data.aimAngle || 0);
    rp.setData('shoot', data.shoot || false);
    rp.setData('lastFired', rp.getData('lastFired') || 0);
  }

  addRemotePlayer(peerId: string) {
    console.log('creating remote player');
    const rp = this.players.create(this.baseCenter.x, this.baseCenter.y, 'guest');
    rp.setDepth(2);
    rp.setCollideWorldBounds(true);
    rp.setData('syncId', peerId);
    this.applyPlayerColor(rp, peerId);
    this.playerSprites[peerId] = rp;
    this.entityLookup[peerId] = rp;
  }

  removeRemotePlayer(peerId: string) {
    const sprite = this.playerSprites[peerId];
    if (!sprite) return;
    this.players.remove(sprite, true, true);
    delete this.playerSprites[peerId];
    delete this.entityLookup[peerId];

    const indicatorKey = `indicator-remote-${peerId}`;
    if (this.playerIndicators[indicatorKey]) {
      this.playerIndicators[indicatorKey].destroy();
      delete this.playerIndicators[indicatorKey];
    }
  }

  // Full snapshot sent on every client connect/disconnect, so a (re)joining client can
  // catch up on players, in-flight bullets, and any enemies it hasn't seen yet (most
  // enemies are already created locally via the deterministic initMapEnemies() layout
  // and just get repositioned here — see receiveEntitySnapshot).
  broadcastState() {
    if (!this.isHost || !this.sendPeerMessage) return;

    const state: PeerEntityMessage = {
      type: 'entities',
      players: this.players.getChildren().map((e: Phaser.GameObjects.Sprite) => ({
        id: (e.getData('syncId') as string) || '',
        x: e.x,
        y: e.y,
        r: e.rotation,
        isDead: e.getData('isDead') as boolean,
      })),
      // Most enemies are created deterministically by initMapEnemies() on both sides and
      // just need this for late-joining clients to catch up (see receiveEntitySnapshot);
      // enemies spawned dynamically at runtime (e.g. by a spawner) rely on this too, since
      // a client that joins after the spawn never saw its 'enemy-created' event.
      enemies: this.enemyManager.enemies.getChildren().map((e: Phaser.GameObjects.Sprite) => ({
        id: (e.getData('syncId') as string) || '',
        x: e.x,
        y: e.y,
        r: e.rotation,
        definitionId: e.getData('enemyId') as string,
        partId: e.getData('isPart') ? (e.getData('partId') as string) : undefined,
      })),
      bullets: this.bullets.getChildren().map((b: Phaser.GameObjects.Sprite) => ({
        id: (b.getData('syncId') as string) || '',
        x: b.x,
        y: b.y,
        r: b.rotation,
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
      this.playerSprites,
      (player) => {
        const sprite = this.players.create(player.x, player.y, 'guest');
        sprite.setDepth(2);
        sprite.setData('syncId', player.id);
        this.applyPlayerColor(sprite, player.id);
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
        const sprite = this.bullets.create(bullet.x, bullet.y, 'bullet');
        sprite.setData('syncId', bullet.id);
        this.entityLookup[bullet.id] = sprite;
        return sprite;
      },
      (id) => delete this.entityLookup[id]
    );

    // Enemies from the deterministic mission layout already exist locally (via
    // initMapEnemies, same id on every peer) and are just reused/repositioned here.
    // Only enemies this client has never seen — e.g. spawned by a spawner before it
    // joined — actually get created.
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
        this.handleRemoteInput(peerId, message);
      }
    }
  }

  handleClientDisconnect(peerId: string) {
    // remove any remote player state and indicators, and tell other clients
    this.removeRemotePlayer(peerId);
    this.eventQueue.push({ type: 'player-left', peerId });
  }

  handleClientConnect(peerId: string) {
    this.addRemotePlayer(peerId);
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
  }

  update(time: number, delta: number) {
    if (this.controls.isPauseJustPressed()) {
      this.isPaused = !this.isPaused;
      this.pauseText.setVisible(this.isPaused);
      if (this.isPaused) this.physics.pause();
      else if (!this.gameOver) this.physics.resume();
    }

    this.updateOffscreenIndicators();

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
          const bulletId = `bullet-${++this.nextBulletId}`;
          this.eventQueue.push({
            type: 'bullet-created',
            bulletId,
            x: this.player!.x,
            y: this.player!.y,
            angle: shootInput.angle,
            speed: 1000,
          });
          this.lastFired = time + this.fireRate;
        }
      } else if (moveX !== 0 || moveY !== 0) {
        this.player!.rotation = Math.atan2(moveY, moveX);
      }
    } else {
      this.player!.setVelocity(0, 0);
    }

    if (this.isHost) {
      const speed = 350;
      for (const id in this.playerSprites) {
        const rp = this.playerSprites[id];
        if (rp === this.player) continue;
        if (rp.getData('isDead')) {
          rp.setVelocity(0, 0);
          continue;
        }

        let mx = rp.getData('moveX') || 0;
        let my = rp.getData('moveY') || 0;
        rp.setVelocity(mx * speed, my * speed);

        const isShooting = !!rp.getData('shoot');
        const angle = rp.getData('aimAngle') || 0;

        if (isShooting) {
          rp.rotation = angle;
        } else if (mx !== 0 || my !== 0) {
          rp.rotation = Math.atan2(my, mx);
        }

        if (isShooting && !this.isInBaseArea(rp.x, rp.y) && time > rp.getData('lastFired')) {
          const bulletId = `bullet-${++this.nextBulletId}`;
          this.eventQueue.push({
            type: 'bullet-created',
            bulletId,
            x: rp.x,
            y: rp.y,
            angle,
            speed: 1000,
          });
          rp.setData('lastFired', time + this.fireRate);
        }
      }

      const alivePlayers = this.getAlivePlayers();
      this.enemyManager.update(time, alivePlayers);

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
