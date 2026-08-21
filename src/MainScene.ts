import { SnapshotInterpolation } from '@geckos.io/snapshot-interpolation';
import { Snapshot } from '@geckos.io/snapshot-interpolation/lib/types';
import Phaser from 'phaser';
import { Controls } from './controls';
import { MISSION_CONFIGS, enemyDefinitionLookup } from './data/data';
import { relayRush } from './data/missions/relay-rush';
import { GameEvent } from './events';
import { currentMissionId, setGameScene } from './main';
import type { EnemyConfig } from './types/Enemy';
import {
  PeerEffectMessage,
  PeerInputMessage,
  HostPeerMessage,
  ClientPeerMessage,
  EnemySnapshot,
  PeerEntityMessage,
  PeerPositionMessage,
  PlayerSnapshot,
} from './types/PeerMessages';
import { Synth } from './Synth';
import { createTextures } from './graphics';

const synth: Synth | null = new Synth();

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
  private enemies!: Phaser.Physics.Arcade.Group;
  private players!: Phaser.Physics.Arcade.Group;

  private enemySprites: Record<string, Phaser.GameObjects.Sprite> = {};
  private playerSprites: Record<string, Phaser.Physics.Arcade.Sprite> = {};
  private bulletSprites: Record<string, Phaser.GameObjects.Sprite> = {};

  private nextEnemyId = 0;
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
  private ENEMY_SPAWNS: { id: string; x: number; y: number }[] = [];

  private baseGraphics!: Phaser.GameObjects.Graphics;
  private laserGraphics!: Phaser.GameObjects.Graphics;
  private connectionGraphics!: Phaser.GameObjects.Graphics;

  private eventQueue: GameEvent[] = [];
  private entityLookup: Record<string, Phaser.GameObjects.Sprite> = {};

  private SI = new SnapshotInterpolation();

  private isHost = false;
  private roomCode: string | null = null;
  private sendPeerMessage: ((msg: any) => void) | null = null;

  constructor(opts?: {
    isHost?: boolean;
    roomCode?: string | null;
    sendPeerMessage?: (msg: any) => void;
  }) {
    super({ key: 'MainScene' });
    this.isHost = !!opts?.isHost;
    this.roomCode = opts?.roomCode ?? null;
    this.sendPeerMessage = opts?.sendPeerMessage ?? null;
  }

  preload() {
    createTextures(this);
  }

  create() {
    setGameScene(this);
    const missionConf = MISSION_CONFIGS[currentMissionId] || MISSION_CONFIGS[relayRush.id];

    this.baseCenter = missionConf.baseCenter;
    this.baseRadius = missionConf.baseRadius;
    this.ENEMY_SPAWNS = missionConf.enemySpawns;

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

    this.laserGraphics = this.add.graphics().setDepth(5);
    this.connectionGraphics = this.add.graphics().setDepth(1);

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

    this.playerSprites[this.localPeerId] = this.player;

    this.player.setDepth(2);
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);

    this.bullets = this.physics.add.group({ runChildUpdate: true });
    this.enemies = this.physics.add.group({ collideWorldBounds: true });

    // Core Colliders

    if (this.isHost) {
      this.physics.add.collider(this.players, this.walls);
      this.physics.add.collider(this.bullets, this.walls, this.hitWall, undefined, this);
      this.physics.add.collider(this.bullets, this.enemies, this.hitEnemy, undefined, this);
      this.physics.add.collider(this.players, this.enemies, this.hitPlayer, undefined, this);
      this.physics.add.collider(this.enemies, this.walls);
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

    this.initMapEnemies();
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

  private configureHeavyBossSprite(sprite: Phaser.GameObjects.Sprite) {
    const body = sprite.body as Phaser.Physics.Arcade.Body;
    if (!body) return;

    body.setBounce(0);
    body.setImmovable(true);
    body.setDrag(1000, 1000);
    body.setVelocity(0, 0);
  }

  private createEnemySprite(definition: EnemyConfig, x: number, y: number) {
    const enemyId = `enemy-${++this.nextEnemyId}`;
    if (definition.type === 'standard') {
      const textureKey = this.textures.exists(definition.id) ? definition.id : 'enemy';
      const sprite = this.enemies.create(x, y, textureKey);
      if (!sprite) return null;

      sprite.setData('syncId', enemyId);
      sprite.setData('enemyId', definition.id);
      sprite.setData('type', definition.id);
      sprite.setData('hp', definition.maxHp);
      sprite.setData('definition', definition);
      sprite.setData('scoreValue', definition.scoreValue);
      sprite.setData('spawnTime', this.time.now);
      sprite.setBounce(1);
      sprite.setCollideWorldBounds(true);
      sprite.setDepth(2);

      sprite.setData('behavior', definition);
      sprite.setData('movementStyle', definition.movement.style);
      sprite.setData('movementSpeed', definition.movement.speed);
      sprite.setData('attackPattern', definition.attack.pattern);
      sprite.setData('attackDamage', definition.attack.damage);
      sprite.setData('attackCooldown', definition.attack.fireRateMs);
      sprite.setData('attackProjectileCount', definition.attack.projectileCount ?? 1);
      sprite.setData('attackProjectileSpeed', definition.attack.projectileSpeed ?? 220);
      sprite.setData('orbitRadius', definition.movement.orbitRadius ?? 0);

      return sprite;
    }

    // Boss: create a core sprite (root) and individual part sprites for each part
    const bossDef = definition;
    const corePart = bossDef.parts.find((p) => p.isCore) || bossDef.parts[0];
    const coreKey = this.textures.exists(`${bossDef.id}::${corePart.partId}`)
      ? `${bossDef.id}::${corePart.partId}`
      : bossDef.id;

    const coreSprite = this.enemies.create(x, y, coreKey);
    if (!coreSprite) return null;

    coreSprite.setData('syncId', enemyId);
    coreSprite.setData('enemyId', bossDef.id);
    coreSprite.setData('type', bossDef.id);
    coreSprite.setData('definition', bossDef);
    coreSprite.setData('isPart', true);
    coreSprite.setData('partId', corePart.partId);
    coreSprite.setData('isCore', true);
    coreSprite.setData('hp', corePart.maxHp);
    coreSprite.setData('maxHp', corePart.maxHp);
    coreSprite.setData('destructible', corePart.destructible);
    coreSprite.setData('scoreValue', corePart.scoreValue ?? 0);
    coreSprite.setData('spawnTime', this.time.now);
    coreSprite.setBounce(1);
    coreSprite.setCollideWorldBounds(true);
    coreSprite.setDepth(2);
    this.configureHeavyBossSprite(coreSprite);

    // Store boss-level metadata on the core.
    coreSprite.setData('bossParts', bossDef.parts);
    coreSprite.setData('bossPhases', bossDef.phases);
    coreSprite.setData('bossPhaseIndex', 0);

    // Create non-core parts as independent sprites (so bullets can collide with them)
    bossDef.parts.forEach((part) => {
      if (part.partId === corePart.partId) return;
      const key = this.textures.exists(`${bossDef.id}::${part.partId}`)
        ? `${bossDef.id}::${part.partId}`
        : bossDef.id;
      const partSprite = this.enemies.create(x + (part.offsetX ?? 0), y + (part.offsetY ?? 0), key);
      if (!partSprite) return;
      partSprite.setData('syncId', `${enemyId}::${part.partId}`);
      partSprite.setData('enemyId', bossDef.id);
      partSprite.setData('type', bossDef.id);
      partSprite.setData('definition', bossDef);
      partSprite.setData('isPart', true);
      partSprite.setData('partId', part.partId);
      partSprite.setData('isCore', false);
      partSprite.setData('hp', part.maxHp);
      partSprite.setData('maxHp', part.maxHp);
      partSprite.setData('destructible', part.destructible);
      partSprite.setData('scoreValue', part.scoreValue ?? 0);
      partSprite.setData('parentEnemy', enemyId);
      partSprite.setBounce(1);
      partSprite.setCollideWorldBounds(true);
      partSprite.setDepth(2);
      this.configureHeavyBossSprite(partSprite);
    });

    return coreSprite;
  }

  initMapEnemies() {
    this.ENEMY_SPAWNS.forEach((spawn) => {
      const definition = enemyDefinitionLookup[spawn.id];
      if (!definition) return;

      const sprite = this.createEnemySprite(definition, spawn.x, spawn.y);
      if (!sprite) return;

      if (this.isHost) {
        this.broadcastEffect(definition.type === 'boss' ? 'big-spawn' : 'spawn');
      }
    });
  }

  private updateEnemyBehavior(
    enemy: Phaser.GameObjects.Sprite,
    time: number,
    target: Phaser.GameObjects.Sprite | null,
    minDist: number
  ) {
    const definition = enemy.getData('definition') as EnemyConfig | undefined;
    if (!definition) return;

    if (definition.type === 'standard') {
      const movement = definition.movement;
      const enemyType = definition.id;

      if (this.isInBaseArea(enemy.x, enemy.y)) {
        const angle = Phaser.Math.Angle.Between(
          this.baseCenter.x,
          this.baseCenter.y,
          enemy.x,
          enemy.y
        );
        const safeX = this.baseCenter.x + Math.cos(angle) * (this.baseRadius + 25);
        const safeY = this.baseCenter.y + Math.sin(angle) * (this.baseRadius + 25);
        enemy.setPosition(safeX, safeY);
        this.physics.velocityFromRotation(
          angle + Math.PI,
          180,
          enemy.body.velocity as Phaser.Math.Vector2
        );
        enemy.rotation = angle + Math.PI;
        return;
      }

      if (movement.style === 'wander' || !target || minDist > 600) {
        let wanderDirection = enemy.getData('wanderDirection') || 0;
        let nextTurnAt = enemy.getData('nextTurnAt') || 0;
        if (time > nextTurnAt) {
          wanderDirection = Phaser.Math.FloatBetween(0, Math.PI * 2);
          enemy.setData('wanderDirection', wanderDirection);
          enemy.setData('nextTurnAt', time + 800);
        }
        this.physics.velocityFromRotation(
          wanderDirection,
          movement.speed,
          enemy.body.velocity as Phaser.Math.Vector2
        );
        enemy.rotation = wanderDirection;
        return;
      }

      if (movement.style === 'orbit' && target) {
        const orbitAngle = (time / 1000) * 1.5 + enemy.getData('orbitOffset') || 0;
        const orbitX = target.x + Math.cos(orbitAngle) * movement.orbitRadius!;
        const orbitY = target.y + Math.sin(orbitAngle) * movement.orbitRadius!;
        this.physics.moveTo(enemy, orbitX, orbitY, movement.speed);
        enemy.rotation = Phaser.Math.Angle.Between(enemy.x, enemy.y, orbitX, orbitY);
        return;
      }

      if (movement.style === 'chase' && target) {
        this.physics.moveToObject(enemy, target, movement.speed);
        enemy.rotation = Phaser.Math.Angle.Between(enemy.x, enemy.y, target.x, target.y);
        return;
      }

      if (movement.style === 'flee' && target) {
        this.physics.moveToObject(enemy, target, -movement.speed);
        enemy.rotation = Phaser.Math.Angle.Between(target.x, target.y, enemy.x, enemy.y);
        return;
      }

      this.physics.velocityFromRotation(
        enemy.rotation,
        movement.speed,
        enemy.body.velocity as Phaser.Math.Vector2
      );

      if (enemyType === 'arc-viper') {
        enemy.rotation += 0.03;
      }
    }
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

  private showEnemyImpact(enemySprite: Phaser.GameObjects.Sprite | null) {
    if (!enemySprite || !enemySprite.active) return;
    this.emitter.explode(10, enemySprite.x, enemySprite.y);
    this.cameras.main.shake(30, 0.003);
    if (synth) synth.playExplosion();
  }

  getEntityBySyncId(syncId: string): Phaser.Physics.Arcade.Sprite | null {
    return this.entityLookup[syncId] as Phaser.Physics.Arcade.Sprite;
  }

  private handleEvent(event: GameEvent) {
    switch (event.type) {
      case 'bullet-destroyed': {
        // destroy the bullet and show an impact effect
        const bulletSprite = this.getEntityBySyncId(event.bulletId);
        if (bulletSprite) {
          this.emitter.explode(4, bulletSprite.x, bulletSprite.y);
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
              });
            }
          };
        }

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
    });
  }

  hitEnemy(
    bullet: Phaser.Types.Physics.Arcade.GameObjectWithBody,
    enemy: Phaser.Types.Physics.Arcade.GameObjectWithBody
  ) {
    const bulletSprite = bullet as Phaser.GameObjects.Sprite;
    this.eventQueue.push({
      type: 'bullet-destroyed',
      bulletId: bulletSprite.getData('syncId'),
    });
    const enemySprite = enemy as Phaser.GameObjects.Sprite;

    // If this sprite represents a boss part, damage that part specifically.
    const isPart = !!enemySprite.getData('isPart');
    if (isPart) {
      const destructible = enemySprite.getData('destructible');
      if (!destructible) {
        // Ping feedback for indestructible parts
        enemySprite.setTintFill(0x999999);
        this.time.delayedCall(80, () => {
          if (enemySprite && enemySprite.active) enemySprite.clearTint();
        });
        return;
      }

      const hp = (enemySprite.getData('hp') as number) - 1;
      enemySprite.setData('hp', hp);

      if (hp <= 0) {
        const isCore = !!enemySprite.getData('isCore');
        const parentEnemyId = enemySprite.getData('parentEnemy') as string | undefined;

        // Award score for this part
        const partScore = (enemySprite.getData('scoreValue') as number) || 0;
        this.score += partScore;

        if (isCore) {
          // Destroy all remaining parts that belong to this boss
          this.enemies.getChildren().forEach((e: Phaser.GameObjects.Sprite) => {
            try {
              if (e && e.getData && e.getData('parentEnemy') === parentEnemyId) {
                this.emitter.explode(8, e.x, e.y);
                e.destroy();
              }
            } catch (err) {
              // ignore
            }
          });

          this.broadcastEffect('explosion', enemySprite.x, enemySprite.y);
          enemySprite.destroy();
        } else {
          this.showEnemyImpact(enemySprite);
          enemySprite.destroy();
        }

        this.scoreText.setText(
          'SCORE: ' + this.score + ' | ROLE: HOST (' + (this.roomCode ?? '') + ')'
        );
        return;
      }

      // Part was hit but not destroyed: flash
      enemySprite.setTintFill(0xffffff);
      this.time.delayedCall(50, () => {
        if (enemySprite && enemySprite.active) enemySprite.clearTint();
      });

      return;
    }

    // Non-part enemies (legacy behavior)
    const hp = enemySprite.getData('hp') - 1;
    enemySprite.setData('hp', hp);
    if (hp <= 0) {
      this.broadcastEffect('explosion', enemySprite.x, enemySprite.y);
      enemySprite.destroy();
      const scoreValue = enemySprite.getData('scoreValue') as number | undefined;
      this.score += scoreValue ?? 10;
      this.scoreText.setText(
        'SCORE: ' + this.score + ' | ROLE: HOST (' + (this.roomCode ?? '') + ')'
      );
    } else {
      enemySprite.setTintFill(0xffffff);
      this.time.delayedCall(50, () => {
        if (enemySprite && enemySprite.active) enemySprite.clearTint();
      });
    }
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
    const rp = this.players.create(this.baseCenter.x, this.baseCenter.y, 'guest');
    rp.setDepth(2);
    rp.setCollideWorldBounds(true);
    this.applyPlayerColor(rp, peerId);
    this.playerSprites[peerId] = rp;
  }

  removeRemotePlayer(peerId: string) {
    const sprite = this.playerSprites[peerId];
    this.players.remove(sprite, true, true);
    delete this.playerSprites[peerId];

    const indicatorKey = `indicator-remote-${peerId}`;
    if (this.playerIndicators[indicatorKey]) {
      this.playerIndicators[indicatorKey].destroy();
      delete this.playerIndicators[indicatorKey];
    }
  }

  // private syncEnemySprites(enemies: EnemySnapshot[]) {
  //   const nextEnemySprites: Record<string, Phaser.GameObjects.Sprite> = {};

  //   function createEnemySprite(scene: MainScene, enemy: EnemySnapshot): Phaser.GameObjects.Sprite {
  //     let textureKey = 'enemy';
  //     const idParts = (enemy.id || '').split('::');
  //     if (idParts.length === 2) {
  //       const partKey = `${enemy.type}::${idParts[1]}`;
  //       if (scene.textures.exists(partKey)) textureKey = partKey;
  //       else if (scene.textures.exists(enemy.type)) textureKey = enemy.type;
  //     } else {
  //       textureKey = scene.textures.exists(enemy.type) ? enemy.type : 'enemy';
  //     }

  //     const sprite = scene.enemies.create(enemy.x, enemy.y, textureKey);
  //     sprite.setData('syncId', enemy.id);

  //     // If this is a part (id contains ::), store part metadata
  //     if (idParts.length === 2) {
  //       sprite.setData('isPart', true);
  //       sprite.setData('partId', idParts[1]);
  //       sprite.setData('parentEnemy', idParts[0]);
  //       sprite.setData('isCore', idParts[1] === 'core');
  //     }

  //     return sprite;
  //   }

  //   function syncEnemySprite(sprite: Phaser.GameObjects.Sprite, enemy: EnemySnapshot) {
  //     sprite.setPosition(enemy.x, enemy.y);
  //     sprite.rotation = enemy.r;
  //     sprite.setVisible(true);
  //     sprite.setActive(true);
  //     sprite.setData('type', enemy.type);
  //     // lightweight hp on clients for visuals; authoritative HP stays on host
  //     sprite.setData(
  //       'hp',
  //       enemy.type === 'spawner' ? 100 : enemy.type === 'big' ? 5 : enemy.type === 'laser' ? 3 : 1
  //     );
  //     // sprite.setData('laserState', enemy.laserState || 'idle');
  //     // sprite.setData('laserAngle', enemy.laserAngle ?? enemy.r);
  //   }

  //   enemies.forEach((enemy) => {
  //     // Use the sync id to detect boss part sprites: format 'enemy-<n>::<partId>'
  //     let sprite = this.enemySprites[enemy.id];
  //     if (!sprite) {
  //       sprite = createEnemySprite(this, enemy);
  //     }

  //     syncEnemySprite(sprite, enemy);

  //     nextEnemySprites[enemy.id] = sprite;
  //   });

  //   Object.keys(this.enemySprites).forEach((id) => {
  //     if (!nextEnemySprites[id]) {
  //       const sprite = this.enemySprites[id];
  //       if (sprite) {
  //         this.showEnemyImpact(sprite);
  //         sprite.destroy();
  //       }
  //       delete this.enemySprites[id];
  //     }
  //   });

  //   this.enemySprites = nextEnemySprites;
  // }

  broadcastState() {
    if (!this.isHost || !this.sendPeerMessage) return;
    const players: Record<string, { x: number; y: number; r: number; isDead: boolean }> = {};
    players['host'] = {
      x: this.player!.x,
      y: this.player!.y,
      r: this.player!.rotation,
      isDead: !!this.player!.getData('isDead'),
    };
    for (const id in this.playerSprites) {
      const rp = this.playerSprites[id];
      players[id] = { x: rp.x, y: rp.y, r: rp.rotation, isDead: !!rp.getData('isDead') };
    }

    const state: PeerEntityMessage = {
      type: 'entities',
      players: this.players.getChildren().map((e: Phaser.GameObjects.Sprite) => ({
        id: (e.getData('syncId') as string) || '',
        x: e.x,
        y: e.y,
        r: e.rotation,
        isDead: e.getData('isDead') as boolean,
      })),
      enemies: this.enemies.getChildren().map((e: Phaser.GameObjects.Sprite) => ({
        id: (e.getData('syncId') as string) || '',
        x: e.x,
        y: e.y,
        r: e.rotation,
        type: e.getData('type') as string,
        laserState: e.getData('laserState'),
        laserAngle: e.getData('laserAngle'),
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
    initSprite: (entity: T) => Phaser.GameObjects.Sprite
  ) {
    const existing = new Set<string>();

    for (const entity of entities) {
      const { id, x, y, r, ...rest } = entity;

      let sprite = sprites[id];

      if (!sprite) {
        const sprite = initSprite(entity);

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

    for (const id in forDeletion) {
      sprites[id].destroy();
      delete sprites[id];
    }
  }

  receiveEntitySnapshot(data: PeerEntityMessage) {
    this.syncSprites(data.enemies, this.enemySprites, (enemy) => {
      const sprite = this.enemies.create(enemy.x, enemy.y, enemy.type);
      return sprite;
    });

    this.syncSprites(data.players, this.playerSprites, (player) => {
      const sprite = this.players.create(player.x, player.y, 'guest');
      sprite.setDepth(2);
      this.applyPlayerColor(sprite, player.id);
      return sprite;
    });

    this.syncSprites(data.bullets, this.bulletSprites, (bullet) => {
      const sprite = this.bullets.create(bullet.x, bullet.y, 'bullet');
      return sprite;
    });
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
    // remove any remote player state and indicators
    this.removeRemotePlayer(peerId);
  }

  handleClientConnect(peerId: string) {
    // TODO: trigger a state broadcast to add everything for the new player
    this.addRemotePlayer(peerId);
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

        if (mx !== 0 || my !== 0) rp.rotation = Math.atan2(my, mx);

        if (
          rp.getData('shoot') &&
          !this.isInBaseArea(rp.x, rp.y) &&
          time > rp.getData('lastFired')
        ) {
          const angle = rp.getData('aimAngle') || 0;
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

      const updateEnemy = (enemy: Phaser.Physics.Arcade.Sprite) => {
        if (!enemy.active) return;
        if (enemy.getData('type') === 'spawner') {
          enemy.setVelocity(0, 0);
          return;
        }

        const definition = enemy.getData('definition') as EnemyConfig | undefined;
        if (!definition) return;

        let target: Phaser.GameObjects.Sprite | null = null;
        let minDist = Infinity;
        alivePlayers.forEach((player) => {
          if (!player || !player.active) return;
          const d = Phaser.Math.Distance.Between(enemy.x, enemy.y, player.x, player.y);
          if (d < minDist) {
            minDist = d;
            target = player;
          }
        });

        if (definition.type === 'standard') {
          this.updateEnemyBehavior(enemy, time, target, minDist);

          if (
            definition.attack.pattern === 'single_shot' &&
            target &&
            time > (enemy.getData('nextShotAt') || 0)
          ) {
            const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, target.x, target.y);
            const bulletId = `bullet-${++this.nextBulletId}`;
            this.eventQueue.push({
              type: 'bullet-created',
              bulletId,
              x: enemy.x,
              y: enemy.y,
              angle,
              speed: definition.attack.projectileSpeed ?? 220,
            });
            enemy.setData('nextShotAt', time + definition.attack.fireRateMs);
          }

          if (
            definition.attack.pattern === 'burst' &&
            target &&
            time > (enemy.getData('nextShotAt') || 0)
          ) {
            for (let i = 0; i < (definition.attack.projectileCount ?? 3); i += 1) {
              const spread = (i - ((definition.attack.projectileCount ?? 3) - 1) / 2) * 0.15;
              const angle =
                Phaser.Math.Angle.Between(enemy.x, enemy.y, target.x, target.y) + spread;
              const bulletId = `bullet-${++this.nextBulletId}`;
              this.eventQueue.push({
                type: 'bullet-created',
                bulletId,
                x: enemy.x,
                y: enemy.y,
                angle,
                speed: definition.attack.projectileSpeed ?? 180,
              });
            }
            enemy.setData('nextShotAt', time + definition.attack.fireRateMs);
          }

          return;
        }

        if (definition.type === 'boss') {
          const corePart = definition.parts.find((part) => part.isCore);
          const isCoreSprite = !!enemy.getData('isCore');

          // Rotate only the core sprite toward the target
          if (isCoreSprite && corePart && target) {
            const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, target.x, target.y);
            enemy.rotation = angle;
          }

          // Position non-core parts relative to their core
          if (isCoreSprite) {
            const parentId = enemy.getData('syncId') as string;
            // find all child parts that reference this core
            this.enemies.getChildren().forEach((child: Phaser.GameObjects.Sprite) => {
              try {
                if (!child || !child.active) return;
                const parent = child.getData('parentEnemy') as string | undefined;
                if (parent !== parentId) return;
                const partId = child.getData('partId') as string;
                const partDef = definition.parts.find((p) => p.partId === partId);
                if (!partDef) return;
                // Simple positioning: apply configured offsets relative to core
                const tx = enemy.x + (partDef.offsetX ?? 0);
                const ty = enemy.y + (partDef.offsetY ?? 0);
                child.setPosition(tx, ty);
                // Optionally match rotation
                child.rotation = enemy.rotation;
              } catch (err) {
                // ignore
              }
            });
          }
        }
      };

      this.enemies.getChildren().forEach(updateEnemy);

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

    this.drawConnections();
    this.drawLasers();

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

  private broadcastEventQueue(eventQueue: GameEvent[]) {
    if (!this.isHost || !this.sendPeerMessage) return;
    const msg = { type: 'events', events: eventQueue };
    this.sendPeerMessage(msg);
  }

  receiveEvents(events: GameEvent[]) {
    this.eventQueue.push(...events);
  }

  private drawConnections() {
    if (!this.connectionGraphics) return;
    this.connectionGraphics.clear();

    // iterate cores and draw connections to their child parts
    this.enemies.getChildren().forEach((coreObj: Phaser.GameObjects.Sprite) => {
      try {
        const core = coreObj as Phaser.GameObjects.Sprite;
        if (!core.active) return;
        if (!core.getData('isCore')) return;

        const parentId = core.getData('syncId') as string;
        const definition = core.getData('definition') as EnemyConfig | undefined;
        if (!definition || definition.type !== 'boss') return;

        const parts = definition.parts;

        // find child sprites that reference this core
        this.enemies.getChildren().forEach((childObj: Phaser.GameObjects.Sprite) => {
          try {
            const child = childObj as Phaser.GameObjects.Sprite;
            if (!child.active) return;
            const p = child.getData('parentEnemy') as string | undefined;
            if (p !== parentId) return;
            const partId = child.getData('partId') as string;
            const partDef = parts.find((pp) => pp.partId === partId);
            if (!partDef || !partDef.connection || !partDef.connection.visuals) return;

            const vis = partDef.connection.visuals as {
              color: string;
              thickness: number;
              isDashed?: boolean;
            };
            const color = vis.color ? parseInt(vis.color, 16) : 0xffffff;
            const thickness = vis.thickness ?? 2;
            const isDashed = vis.isDashed ?? false;

            if (partDef.connection.style === 'orbit') {
              // draw an orbit ring at the offset distance
              const ox = partDef.offsetX ?? 0;
              const oy = partDef.offsetY ?? 0;
              const radius = Math.sqrt(ox * ox + oy * oy) || 10;
              this.connectionGraphics.lineStyle(thickness, color, 0.9);
              if (isDashed) {
                // draw dashed circle by drawing many small segments
                const segments = 60;
                const dash = 4;
                for (let i = 0; i < segments; i += 1) {
                  const a1 = (Math.PI * 2 * i) / segments;
                  const a2 = (Math.PI * 2 * (i + 0.6)) / segments;
                  const x1 = core.x + Math.cos(a1) * radius;
                  const y1 = core.y + Math.sin(a1) * radius;
                  const x2 = core.x + Math.cos(a2) * radius;
                  const y2 = core.y + Math.sin(a2) * radius;
                  this.connectionGraphics.beginPath();
                  this.connectionGraphics.moveTo(x1, y1);
                  this.connectionGraphics.lineTo(x2, y2);
                  this.connectionGraphics.strokePath();
                }
              } else {
                this.connectionGraphics.strokeCircle(core.x, core.y, radius);
              }
            } else {
              // draw straight/tether line between core and part
              const x1 = core.x;
              const y1 = core.y;
              const x2 = child.x;
              const y2 = child.y;
              this.connectionGraphics.lineStyle(thickness, color, 0.9);
              if (isDashed) {
                // dashed line
                const dash = 8;
                const gap = 6;
                const dx = x2 - x1;
                const dy = y2 - y1;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const nx = dx / dist;
                const ny = dy / dist;
                let drawn = 0;
                while (drawn < dist) {
                  const segStart = drawn;
                  const segEnd = Math.min(drawn + dash, dist);
                  const sx = x1 + nx * segStart;
                  const sy = y1 + ny * segStart;
                  const ex = x1 + nx * segEnd;
                  const ey = y1 + ny * segEnd;
                  this.connectionGraphics.beginPath();
                  this.connectionGraphics.moveTo(sx, sy);
                  this.connectionGraphics.lineTo(ex, ey);
                  this.connectionGraphics.strokePath();
                  drawn += dash + gap;
                }
              } else {
                this.connectionGraphics.beginPath();
                this.connectionGraphics.moveTo(x1, y1);
                this.connectionGraphics.lineTo(x2, y2);
                this.connectionGraphics.strokePath();
              }
            }
          } catch (err) {
            // ignore per-child exceptions
          }
        });
      } catch (err) {
        // ignore per-core exceptions
      }
    });
  }

  private getLaserEndPoint(x: number, y: number, angle: number): { x: number; y: number } {
    let maxDist = 2000;
    const cx = this.baseCenter.x;
    const cy = this.baseCenter.y;
    const r = this.baseRadius;
    const dx = x - cx;
    const dy = y - cy;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    // 1. Raycast vs Base Circle (Quadratic intersect)
    const b = 2 * (dx * cos + dy * sin);
    const c = dx * dx + dy * dy - r * r;
    const disc = b * b - 4 * c;

    if (disc >= 0) {
      const sqrtDisc = Math.sqrt(disc);
      const t1 = (-b - sqrtDisc) / 2;
      const t2 = (-b + sqrtDisc) / 2;
      if (t1 > 0 && t1 < maxDist) {
        maxDist = t1;
      } else if (t2 > 0 && t2 < maxDist) {
        maxDist = t2;
      }
    }

    // 2. Raycast vs Walls (AABB intersects)
    if (this.walls) {
      const rayLine = new Phaser.Geom.Line(x, y, x + cos * maxDist, y + sin * maxDist);
      const walls = this.walls.getChildren();

      walls.forEach((wallObj) => {
        const wall = wallObj as Phaser.GameObjects.TileSprite;
        const body = wall.body as Phaser.Physics.Arcade.Body;
        if (body) {
          const rect = new Phaser.Geom.Rectangle(body.x, body.y, body.width, body.height);
          const intersects = Phaser.Geom.Intersects.GetLineToRectangle(rayLine, rect);

          intersects.forEach((pt: Phaser.Geom.Point) => {
            const dist = Phaser.Math.Distance.Between(x, y, pt.x, pt.y);
            if (dist < maxDist) {
              maxDist = dist;
            }
          });
        }
      });
    }

    return {
      x: x + Math.cos(angle) * maxDist,
      y: y + Math.sin(angle) * maxDist,
    };
  }

  private drawLasers() {
    if (!this.laserGraphics) return;
    this.laserGraphics.clear();

    const activeEnemies: Array<{ x: number; y: number; state?: string; angle?: number }> = [];

    if (this.isHost) {
      this.enemies.getChildren().forEach((e: Phaser.GameObjects.Sprite) => {
        if (e.active && e.getData('type') === 'laser') {
          activeEnemies.push({
            x: e.x,
            y: e.y,
            state: e.getData('laserState'),
            angle: e.getData('laserAngle'),
          });
        }
      });
    } else {
      Object.values(this.enemySprites).forEach((e) => {
        if (e.active && e.getData('type') === 'laser') {
          activeEnemies.push({
            x: e.x,
            y: e.y,
            state: e.getData('laserState'),
            angle: e.getData('laserAngle'),
          });
        }
      });
    }

    activeEnemies.forEach((e) => {
      const state = e.state;
      const angle = e.angle ?? 0;
      const endPos = this.getLaserEndPoint(e.x, e.y, angle);

      if (state === 'charging') {
        this.laserGraphics.lineStyle(12, 0xff0055, 0.25);
        this.laserGraphics.lineBetween(e.x, e.y, endPos.x, endPos.y);
        this.laserGraphics.lineStyle(2, 0xff6688, 0.7);
        this.laserGraphics.lineBetween(e.x, e.y, endPos.x, endPos.y);
      } else if (state === 'firing') {
        this.laserGraphics.lineStyle(24, 0xff0044, 0.85);
        this.laserGraphics.lineBetween(e.x, e.y, endPos.x, endPos.y);
        this.laserGraphics.lineStyle(8, 0xffffff, 1.0);
        this.laserGraphics.lineBetween(e.x, e.y, endPos.x, endPos.y);
      }
    });
  }

  destroy() {
    this.controls.shutdown();
  }

  receivePositions(snapshot: Snapshot) {
    if (this.isHost || !snapshot) return;
    this.SI.snapshot.add(snapshot);
  }
}
