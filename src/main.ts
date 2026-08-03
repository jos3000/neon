/// <reference types="vite/client" />

import Phaser from 'phaser';
import Peer, { DataConnection, PeerError } from 'peerjs';
import { Synth } from './Synth';

type PlayerSnapshot = {
  x: number;
  y: number;
  r: number;
  isDead: boolean;
};

type EnemySnapshot = {
  id: string;
  x: number;
  y: number;
  type: string;
  r: number;
  laserState?: 'idle' | 'charging' | 'firing';
  laserAngle?: number;
};

type BulletSnapshot = {
  id: string;
  x: number;
  y: number;
};

type PeerSnapshotMessage = {
  type: 'state';
  score: number;
  players: Record<string, PlayerSnapshot>;
  enemies: EnemySnapshot[];
  bullets: BulletSnapshot[];
};

type PeerInputMessage = {
  type: 'input';
  moveX: number;
  moveY: number;
  shoot: boolean;
  aimAngle: number;
};

type PeerEffectMessage = {
  type: 'effect';
  effect: 'explosion' | 'hit' | 'spawn' | 'big-spawn' | 'death' | 'shot' | 'laser';
  x?: number;
  y?: number;
};

type PeerMessage = PeerSnapshotMessage | PeerInputMessage | PeerEffectMessage;

type WallConfig = { x: number; y: number; w: number; h: number };

type SectorConfig = {
  baseCenter: { x: number; y: number };
  baseRadius: number;
  spawners: { x: number; y: number }[];
  walls: WallConfig[];
};

const SECTORS: Record<string, SectorConfig> = {
  '0': {
    // Crossroads
    baseCenter: { x: 1000, y: 1000 },
    baseRadius: 180,
    spawners: [
      { x: 300, y: 300 },
      { x: 1700, y: 300 },
      { x: 300, y: 1700 },
      { x: 1700, y: 1700 },
    ],
    walls: [
      { x: 1000, y: 350, w: 400, h: 80 },
      { x: 1000, y: 1650, w: 400, h: 80 },
      { x: 350, y: 1000, w: 80, h: 400 },
      { x: 1650, y: 1000, w: 80, h: 400 },
      { x: 600, y: 600, w: 200, h: 60 },
      { x: 600, y: 600, w: 60, h: 200 },
      { x: 1400, y: 600, w: 200, h: 60 },
      { x: 1400, y: 600, w: 60, h: 200 },
      { x: 600, y: 1400, w: 200, h: 60 },
      { x: 600, y: 1400, w: 60, h: 200 },
      { x: 1400, y: 1400, w: 200, h: 60 },
      { x: 1400, y: 1400, w: 60, h: 200 },
    ],
  },
  '1': {
    // Twin Forts
    baseCenter: { x: 500, y: 1000 },
    baseRadius: 200,
    spawners: [
      { x: 1500, y: 300 },
      { x: 1800, y: 1000 },
      { x: 1500, y: 1700 },
    ],
    walls: [
      { x: 1000, y: 400, w: 100, h: 800 },
      { x: 1000, y: 1600, w: 100, h: 800 },
      { x: 1400, y: 1000, w: 100, h: 600 },
      { x: 500, y: 1800, w: 600, h: 80 },
      { x: 500, y: 200, w: 600, h: 80 },
    ],
  },
  '2': {
    // The Maze
    baseCenter: { x: 1000, y: 1700 },
    baseRadius: 160,
    spawners: [
      { x: 200, y: 200 },
      { x: 1000, y: 200 },
      { x: 1800, y: 200 },
    ],
    walls: [
      { x: 800, y: 1300, w: 1600, h: 80 },
      { x: 1200, y: 900, w: 1600, h: 80 },
      { x: 800, y: 500, w: 1600, h: 80 },
    ],
  },
};

class MainScene extends Phaser.Scene {
  private score = 0;
  private gameOver = false;
  private isPaused = false;
  private lastFired = 0;
  private fireRate = 120;
  private gameStarted = true;
  private enemySpeed = 150;
  private broadcastTimer?: Phaser.Time.TimerEvent;
  private inputTimer?: Phaser.Time.TimerEvent;

  private player: Phaser.Physics.Arcade.Sprite | null = null;
  private remotePlayers: Record<string, Phaser.Physics.Arcade.Sprite> = {};
  private bullets!: Phaser.Physics.Arcade.Group;
  private enemies!: Phaser.Physics.Arcade.Group;
  private walls!: Phaser.Physics.Arcade.StaticGroup;

  private enemySprites: Record<string, Phaser.GameObjects.Sprite> = {};
  private bulletSprites: Record<string, Phaser.GameObjects.Sprite> = {};
  private nextEnemyId = 0;
  private nextBulletId = 0;

  private emitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private scoreText!: Phaser.GameObjects.Text;
  private pauseText!: Phaser.GameObjects.Text;
  private gameOverText!: Phaser.GameObjects.Text;

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<string, Phaser.Input.Keyboard.Key>;
  private keyP!: Phaser.Input.Keyboard.Key;

  private joyLeftBase!: Phaser.GameObjects.Arc;
  private joyLeftThumb!: Phaser.GameObjects.Arc;
  private joyRightBase!: Phaser.GameObjects.Arc;
  private joyRightThumb!: Phaser.GameObjects.Arc;
  private leftPointer: Phaser.Input.Pointer | null = null;
  private rightPointer: Phaser.Input.Pointer | null = null;
  private leftVector: { x: number; y: number } | null = null;
  private rightVector: { angle: number; force: number } | null = null;

  private localPeerId: string | null = null;
  private hostPlayerSprite?: Phaser.GameObjects.Sprite;
  private otherRemoteSprites: Record<string, Phaser.GameObjects.Sprite> = {};
  private playerIndicators: Record<string, Phaser.GameObjects.Graphics> = {};
  private playerColors: Record<string, number> = {};

  private baseCenter = { x: 1000, y: 1600 };
  private baseRadius = 180;
  private SPAWNER_CONFIG: { x: number; y: number }[] = [];

  private baseGraphics!: Phaser.GameObjects.Graphics;
  private laserGraphics!: Phaser.GameObjects.Graphics;

  constructor() {
    super({ key: 'MainScene' });
  }

  preload() {
    const playerGraphics = this.make.graphics({});
    playerGraphics.fillStyle(0x00ffff, 1);
    playerGraphics.fillTriangle(30, 15, 0, 30, 0, 0);
    playerGraphics.generateTexture('player', 30, 30);

    const guestGraphics = this.make.graphics({});
    guestGraphics.fillStyle(0x00ff88, 1);
    guestGraphics.fillTriangle(30, 15, 0, 30, 0, 0);
    guestGraphics.generateTexture('guest', 30, 30);

    const enemyGraphics = this.make.graphics({});
    enemyGraphics.lineStyle(3, 0xff00ff);
    enemyGraphics.strokeRect(2, 2, 26, 26);
    enemyGraphics.fillStyle(0x330033, 1);
    enemyGraphics.fillRect(2, 2, 26, 26);
    enemyGraphics.generateTexture('enemy', 30, 30);

    const bigEnemyGraphics = this.make.graphics({});
    bigEnemyGraphics.lineStyle(4, 0xff8800);
    bigEnemyGraphics.strokeCircle(25, 25, 23);
    bigEnemyGraphics.fillStyle(0x442200, 1);
    bigEnemyGraphics.fillCircle(25, 25, 23);
    bigEnemyGraphics.generateTexture('bigenemy', 50, 50);

    const spawnerGraphics = this.make.graphics({});
    spawnerGraphics.lineStyle(5, 0xff0055);
    spawnerGraphics.strokeRect(3, 3, 54, 54);
    spawnerGraphics.fillStyle(0x440022, 1);
    spawnerGraphics.fillRect(3, 3, 54, 54);
    spawnerGraphics.fillStyle(0xff0055, 1);
    spawnerGraphics.fillRect(20, 20, 20, 20);
    spawnerGraphics.generateTexture('spawner', 60, 60);

    const laserEnemyGraphics = this.make.graphics({});
    laserEnemyGraphics.lineStyle(3, 0xff0044);
    laserEnemyGraphics.fillStyle(0x440011, 1);
    laserEnemyGraphics.beginPath();
    laserEnemyGraphics.moveTo(20, 2);
    laserEnemyGraphics.lineTo(38, 20);
    laserEnemyGraphics.lineTo(20, 38);
    laserEnemyGraphics.lineTo(2, 20);
    laserEnemyGraphics.closePath();
    laserEnemyGraphics.fillPath();
    laserEnemyGraphics.strokePath();
    laserEnemyGraphics.fillStyle(0xff0044, 1);
    laserEnemyGraphics.fillCircle(20, 20, 7);
    laserEnemyGraphics.generateTexture('laserenemy', 40, 40);

    const bulletGraphics = this.make.graphics({});
    bulletGraphics.fillStyle(0xffff00, 1);
    bulletGraphics.fillCircle(8, 8, 8);
    bulletGraphics.generateTexture('bullet', 16, 16);

    const gridGraphics = this.make.graphics({});
    gridGraphics.lineStyle(1, 0x003333, 0.5);
    gridGraphics.strokeRect(0, 0, 100, 100);
    gridGraphics.generateTexture('grid', 100, 100);

    const particleGraphics = this.make.graphics({});
    particleGraphics.fillStyle(0x00ffff, 1);
    particleGraphics.fillRect(0, 0, 4, 4);
    particleGraphics.generateTexture('particle', 4, 4);

    const wallGraphics = this.make.graphics({});
    wallGraphics.fillStyle(0x001a33, 1);
    wallGraphics.fillRect(0, 0, 64, 64);
    wallGraphics.lineStyle(2, 0x00ffff, 0.8);
    wallGraphics.strokeRect(0, 0, 64, 64);
    wallGraphics.lineStyle(1, 0x0088cc, 0.3);
    wallGraphics.moveTo(0, 0);
    wallGraphics.lineTo(64, 64);
    wallGraphics.moveTo(64, 0);
    wallGraphics.lineTo(0, 64);
    wallGraphics.generateTexture('wall', 64, 64);
  }

  create() {
    gameScene = this;
    const sectorConf = SECTORS[currentSectorId] || SECTORS['1'];

    this.baseCenter = sectorConf.baseCenter;
    this.baseRadius = sectorConf.baseRadius;
    this.SPAWNER_CONFIG = sectorConf.spawners;

    this.physics.world.setBounds(0, 0, 2000, 2000);
    this.cameras.main.setBounds(0, 0, 2000, 2000);
    this.add.tileSprite(1000, 1000, 2000, 2000, 'grid');

    // Build Walls
    this.walls = this.physics.add.staticGroup();
    sectorConf.walls.forEach((w) => {
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

    this.gameOver = false;
    this.isPaused = false;
    this.lastFired = 0;
    this.fireRate = 120;
    this.gameStarted = true;

    this.player = this.physics.add.sprite(
      this.baseCenter.x,
      this.baseCenter.y,
      isHost ? 'player' : 'guest'
    );
    this.player.setDepth(2);
    this.player.setCollideWorldBounds(true);
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
    this.localPeerId = clientPeer && clientPeer.id ? clientPeer.id : null;

    this.bullets = this.physics.add.group({ runChildUpdate: true });
    this.enemies = this.physics.add.group();

    // Core Colliders
    this.physics.add.collider(this.player, this.walls);
    this.physics.add.collider(this.bullets, this.walls, this.hitWall, undefined, this);

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
        'SCORE: 0 | SECTOR: ' +
          currentSectorId +
          ' | ROLE: ' +
          (isHost ? 'HOST (' + roomCode + ')' : 'CLIENT'),
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
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys('W,A,S,D') as Record<string, Phaser.Input.Keyboard.Key>;
    this.keyP = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.P);

    this.joyLeftBase = this.add
      .circle(0, 0, 60, 0x00ffff, 0.2)
      .setVisible(false)
      .setScrollFactor(0)
      .setDepth(100);
    this.joyLeftThumb = this.add
      .circle(0, 0, 30, 0x00ffff, 0.6)
      .setVisible(false)
      .setScrollFactor(0)
      .setDepth(100);
    this.joyRightBase = this.add
      .circle(0, 0, 60, 0xff00ff, 0.2)
      .setVisible(false)
      .setScrollFactor(0)
      .setDepth(100);
    this.joyRightThumb = this.add
      .circle(0, 0, 30, 0xff00ff, 0.6)
      .setVisible(false)
      .setScrollFactor(0)
      .setDepth(100);

    this.input.on('pointerdown', this.handlePointerDown, this);
    this.input.on('pointermove', this.handlePointerMove, this);
    this.input.on('pointerup', this.handlePointerUp, this);
    this.input.on('pointerout', this.handlePointerUp, this);

    if (isHost) {
      this.enemySpeed = 150;
      this.initSpawners();

      this.physics.add.collider(this.bullets, this.enemies, this.hitEnemy, undefined, this);
      this.physics.add.collider(this.player, this.enemies, this.hitPlayer, undefined, this);
      this.physics.add.collider(this.enemies, this.walls);

      this.broadcastTimer = this.time.addEvent({
        delay: 50,
        callback: this.broadcastState,
        callbackScope: this,
        loop: true,
      });
    } else {
      this.inputTimer = this.time.addEvent({
        delay: 30,
        callback: this.sendInput,
        callbackScope: this,
        loop: true,
      });
    }

    this.scale.on('resize', this.resize, this);
  }

  private getPrimaryGamepad(): Gamepad | null {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    for (const pad of pads) {
      if (pad && pad.connected) return pad;
    }
    return null;
  }

  private getStickVector(x: number, y: number): { x: number; y: number; force: number } | null {
    const magnitude = Math.sqrt(x * x + y * y);
    if (magnitude < 0.15) return null;
    return {
      x: x / magnitude,
      y: y / magnitude,
      force: magnitude,
    };
  }

  private getGamepadMovement(): { x: number; y: number } | null {
    const gamepad = this.getPrimaryGamepad();
    if (!gamepad) return null;
    const stick = this.getStickVector(gamepad.axes[0] ?? 0, gamepad.axes[1] ?? 0);
    if (!stick) return null;
    return { x: stick.x, y: stick.y };
  }

  private getGamepadAim(): { angle: number; force: number } | null {
    const gamepad = this.getPrimaryGamepad();
    if (!gamepad) return null;
    const stick = this.getStickVector(gamepad.axes[2] ?? 0, gamepad.axes[3] ?? 0);
    if (!stick) return null;
    return { angle: Math.atan2(stick.y, stick.x), force: stick.force };
  }

  private getMovementInput(): { x: number; y: number } {
    if (this.leftVector) {
      return { x: this.leftVector.x, y: this.leftVector.y };
    }

    const gamepadMove = this.getGamepadMovement();
    if (gamepadMove) {
      return gamepadMove;
    }

    let moveX = 0;
    let moveY = 0;
    if (this.cursors.left.isDown || this.wasd.A.isDown) moveX = -1;
    if (this.cursors.right.isDown || this.wasd.D.isDown) moveX = 1;
    if (this.cursors.up.isDown || this.wasd.W.isDown) moveY = -1;
    if (this.cursors.down.isDown || this.wasd.S.isDown) moveY = 1;
    if (moveX !== 0 && moveY !== 0) {
      const len = Math.sqrt(moveX * moveX + moveY * moveY);
      moveX /= len;
      moveY /= len;
    }

    return { x: moveX, y: moveY };
  }

  private getShootInput(): { shoot: boolean; angle: number } {
    if (this.rightVector && this.rightVector.force > 0.2) {
      return { shoot: true, angle: this.rightVector.angle };
    }

    const gamepadAim = this.getGamepadAim();
    if (gamepadAim && gamepadAim.force > 0.2) {
      return { shoot: true, angle: gamepadAim.angle };
    }

    if (this.input.activePointer.isDown && !this.leftPointer && !this.rightPointer) {
      return {
        shoot: true,
        angle: Phaser.Math.Angle.Between(
          this.player!.x,
          this.player!.y,
          this.input.activePointer.worldX,
          this.input.activePointer.worldY
        ),
      };
    }

    return { shoot: false, angle: 0 };
  }

  handlePointerDown(pointer: Phaser.Input.Pointer) {
    if (this.gameOver) {
      if (isHost) this.scene.restart();
      return;
    }
    const halfWidth = this.scale.width / 2;
    if (pointer.x < halfWidth) {
      if (!this.leftPointer) {
        this.leftPointer = pointer;
        this.joyLeftBase.setPosition(pointer.x, pointer.y).setVisible(true);
        this.joyLeftThumb.setPosition(pointer.x, pointer.y).setVisible(true);
        this.leftVector = { x: 0, y: 0 };
      }
    } else {
      if (!this.rightPointer) {
        this.rightPointer = pointer;
        this.joyRightBase.setPosition(pointer.x, pointer.y).setVisible(true);
        this.joyRightThumb.setPosition(pointer.x, pointer.y).setVisible(true);
        this.rightVector = { angle: 0, force: 0 };
      }
    }
  }

  handlePointerMove(pointer: Phaser.Input.Pointer) {
    if (this.gameOver || this.isPaused) return;
    const maxRadius = 60;
    if (pointer === this.leftPointer) {
      let dist = Phaser.Math.Distance.Between(
        this.joyLeftBase.x,
        this.joyLeftBase.y,
        pointer.x,
        pointer.y
      );
      let angle = Phaser.Math.Angle.Between(
        this.joyLeftBase.x,
        this.joyLeftBase.y,
        pointer.x,
        pointer.y
      );
      if (dist > maxRadius) dist = maxRadius;
      this.joyLeftThumb.x = this.joyLeftBase.x + Math.cos(angle) * dist;
      this.joyLeftThumb.y = this.joyLeftBase.y + Math.sin(angle) * dist;
      this.leftVector = {
        x: Math.cos(angle) * (dist / maxRadius),
        y: Math.sin(angle) * (dist / maxRadius),
      };
    } else if (pointer === this.rightPointer) {
      let dist = Phaser.Math.Distance.Between(
        this.joyRightBase.x,
        this.joyRightBase.y,
        pointer.x,
        pointer.y
      );
      let angle = Phaser.Math.Angle.Between(
        this.joyRightBase.x,
        this.joyRightBase.y,
        pointer.x,
        pointer.y
      );
      if (dist > maxRadius) dist = maxRadius;
      this.joyRightThumb.x = this.joyRightBase.x + Math.cos(angle) * dist;
      this.joyRightThumb.y = this.joyRightBase.y + Math.sin(angle) * dist;
      this.rightVector = { angle: angle, force: dist / maxRadius };
    }
  }

  handlePointerUp(pointer: Phaser.Input.Pointer) {
    if (pointer === this.leftPointer) {
      this.leftPointer = null;
      this.joyLeftBase.setVisible(false);
      this.joyLeftThumb.setVisible(false);
      this.leftVector = null;
    } else if (pointer === this.rightPointer) {
      this.rightPointer = null;
      this.joyRightBase.setVisible(false);
      this.joyRightThumb.setVisible(false);
      this.rightVector = null;
    }
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

    if (this.hostPlayerSprite) {
      trackedSprites.push({ id: 'host', sprite: this.hostPlayerSprite });
    }

    Object.entries(this.otherRemoteSprites).forEach(([id, sprite]) => {
      trackedSprites.push({ id, sprite });
    });

    if (isHost) {
      Object.entries(this.remotePlayers).forEach(([id, sprite]) => {
        trackedSprites.push({ id: `remote-${id}`, sprite });
      });
    }

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

  private getSpawnPointOutsideBase() {
    const cam = this.cameras.main;
    const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
    const dist = Math.max(cam.width, cam.height) / 2 + 220;

    for (let i = 0; i < 20; i++) {
      const x = Phaser.Math.Clamp(this.player!.x + Math.cos(angle) * dist, 40, 1960);
      const y = Phaser.Math.Clamp(this.player!.y + Math.sin(angle) * dist, 40, 1960);
      if (!this.isInBaseArea(x, y)) {
        return { x, y };
      }
    }

    return {
      x: this.baseCenter.x + this.baseRadius + 80,
      y: this.baseCenter.y - this.baseRadius - 80,
    };
  }

  initSpawners() {
    this.SPAWNER_CONFIG.forEach((pos) => {
      const enemyId = `enemy-${++this.nextEnemyId}`;
      const spawner = this.enemies.create(pos.x, pos.y, 'spawner');
      if (spawner) {
        spawner.setData('syncId', enemyId);
        spawner.setData('type', 'spawner');
        spawner.setData('hp', 100);
        // Stagger initial spawn times
        spawner.setData('nextSpawnTime', this.time.now + Phaser.Math.Between(500, 2500));
        spawner.setImmovable(true);
        spawner.setCollideWorldBounds(true);
      }
    });
  }

  updateSpawners(time: number) {
    if (!this.gameStarted || this.gameOver || this.isPaused) return;

    const spawners: Phaser.GameObjects.Sprite[] = [];
    const enemyCounts: Record<string, number> = {};

    // Map active spawners and count how many enemies belong to each
    this.enemies.getChildren().forEach((e: Phaser.GameObjects.Sprite) => {
      if (!e.active) return;
      const type = e.getData('type');
      if (type === 'spawner') {
        spawners.push(e);
        if (enemyCounts[e.getData('syncId')] === undefined) {
          enemyCounts[e.getData('syncId')] = 0;
        }
      } else {
        const spawnerId = e.getData('spawnerId');
        if (spawnerId) {
          enemyCounts[spawnerId] = (enemyCounts[spawnerId] || 0) + 1;
        }
      }
    });

    spawners.forEach((spawner) => {
      const nextSpawnTime = spawner.getData('nextSpawnTime') || 0;

      if (time > nextSpawnTime) {
        const spawnerId = spawner.getData('syncId');
        const currentSpawns = enemyCounts[spawnerId] || 0;

        const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
        const spawnX = Phaser.Math.Clamp(spawner.x + Math.cos(angle) * 45, 40, 1960);
        const spawnY = Phaser.Math.Clamp(spawner.y + Math.sin(angle) * 45, 40, 1960);

        // Ensure enemies don't spawn inside the safe base
        if (this.isInBaseArea(spawnX, spawnY)) {
          spawner.setData('nextSpawnTime', time + 500);
          return;
        }

        const rand = Math.random();
        let enemyType = 'normal';
        let texture = 'enemy';
        let hp = 1;
        if (rand < 0.25) {
          enemyType = 'big';
          texture = 'bigenemy';
          hp = 5;
        } else if (rand < 0.5) {
          enemyType = 'laser';
          texture = 'laserenemy';
          hp = 3;
        }

        const enemyId = `enemy-${++this.nextEnemyId}`;
        const enemy = this.enemies.create(spawnX, spawnY, texture);
        if (enemy) {
          enemy.setData('syncId', enemyId);
          enemy.setData('spawnerId', spawnerId); // Track which spawner made this
          enemy.setData('type', enemyType);
          enemy.setData('hp', hp);
          enemy.setData('spawnTime', this.time.now - Phaser.Math.Between(0, 10000));
          enemy.setBounce(1);
          enemy.setCollideWorldBounds(true);
          if (isHost) this.broadcastEffect(enemyType === 'big' ? 'big-spawn' : 'spawn');
        }

        // Calculate dynamic delay: faster when fewer, slower when many
        // E.g., Base: 800ms + 1200ms per existing spawn
        // 0 spawns = 800ms, 2 spawns = 3.2s, 5 spawns = 6.8s
        const nextDelay = 800 + currentSpawns * 1200;
        spawner.setData('nextSpawnTime', time + nextDelay);
      }
    });
  }

  spawnEnemy() {
    if (!this.gameStarted || this.gameOver || this.isPaused) return;
    const spawn = this.getSpawnPointOutsideBase();
    const enemyId = `enemy-${++this.nextEnemyId}`;
    const enemy = this.enemies.create(spawn.x, spawn.y, 'enemy');
    if (enemy) {
      enemy.setData('syncId', enemyId);
      enemy.setData('type', 'normal');
      enemy.setData('hp', 1);
      enemy.setBounce(1);
      enemy.setCollideWorldBounds(true);
      if (isHost) this.broadcastEffect('spawn');
    }
  }

  spawnBigEnemy() {
    if (!this.gameStarted || this.gameOver || this.isPaused) return;
    const spawn = this.getSpawnPointOutsideBase();
    const enemyId = `enemy-${++this.nextEnemyId}`;
    const enemy = this.enemies.create(spawn.x, spawn.y, 'bigenemy');
    if (enemy) {
      enemy.setData('syncId', enemyId);
      enemy.setData('type', 'big');
      enemy.setData('hp', 5);
      enemy.setBounce(1);
      enemy.setCollideWorldBounds(true);
      if (isHost) this.broadcastEffect('big-spawn');
    }
  }

  spawnLaserEnemy() {
    if (!this.gameStarted || this.gameOver || this.isPaused) return;
    const spawn = this.getSpawnPointOutsideBase();
    const enemyId = `enemy-${++this.nextEnemyId}`;
    const enemy = this.enemies.create(spawn.x, spawn.y, 'laserenemy');
    if (enemy) {
      enemy.setData('syncId', enemyId);
      enemy.setData('type', 'laser');
      enemy.setData('hp', 3);
      enemy.setData('spawnTime', this.time.now - Phaser.Math.Between(0, 10000));
      enemy.setBounce(1);
      enemy.setCollideWorldBounds(true);
      if (isHost) this.broadcastEffect('spawn');
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
    if (!isHost) return;
    if (!connections.length) return;
    const message: PeerEffectMessage = { type: 'effect', effect, x, y };
    connections.forEach((conn) => conn.send(message));
  }

  private showEnemyImpact(enemySprite: Phaser.GameObjects.Sprite | null) {
    if (!enemySprite || !enemySprite.active) return;
    this.emitter.explode(10, enemySprite.x, enemySprite.y);
    this.cameras.main.shake(30, 0.003);
    if (synth) synth.playExplosion();
  }

  hitWall(
    bullet: Phaser.Types.Physics.Arcade.GameObjectWithBody,
    wall: Phaser.Types.Physics.Arcade.GameObjectWithBody
  ) {
    const bulletSprite = bullet as Phaser.GameObjects.Sprite;
    this.emitter.explode(4, bulletSprite.x, bulletSprite.y);
    bulletSprite.destroy();
  }

  hitEnemy(
    bullet: Phaser.Types.Physics.Arcade.GameObjectWithBody,
    enemy: Phaser.Types.Physics.Arcade.GameObjectWithBody
  ) {
    bullet.destroy();
    const enemySprite = enemy as Phaser.GameObjects.Sprite;
    const hp = enemySprite.getData('hp') - 1;
    enemySprite.setData('hp', hp);
    if (hp <= 0) {
      this.broadcastEffect('explosion', enemySprite.x, enemySprite.y);
      enemySprite.destroy();
      const type = enemySprite.getData('type');
      this.score += type === 'spawner' ? 500 : type === 'big' ? 50 : type === 'laser' ? 25 : 10;
      this.scoreText.setText('SCORE: ' + this.score + ' | ROLE: HOST (' + roomCode + ')');
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

  getAlivePlayers(): Phaser.Physics.Arcade.Sprite[] {
    const alivePlayers: Phaser.Physics.Arcade.Sprite[] = [];
    if (this.player && this.player.active && !this.player.getData('isDead')) {
      alivePlayers.push(this.player);
    }
    for (const id in this.remotePlayers) {
      const rp = this.remotePlayers[id];
      if (rp && rp.active && !rp.getData('isDead')) {
        alivePlayers.push(rp);
      }
    }
    return alivePlayers;
  }

  handleRemoteInput(peerId: string, data: PeerInputMessage) {
    if (!isHost || this.gameOver) return;
    if (!this.remotePlayers[peerId]) {
      const rp = this.physics.add.sprite(this.baseCenter.x, this.baseCenter.y, 'guest');
      rp.setDepth(2);
      rp.setCollideWorldBounds(true);
      this.remotePlayers[peerId] = rp;
      this.applyPlayerColor(rp, peerId);
      this.physics.add.collider(rp, this.enemies, this.hitPlayer, undefined, this);
      this.physics.add.collider(rp, this.walls);
    }
    const rp = this.remotePlayers[peerId];
    rp.setData('moveX', data.moveX || 0);
    rp.setData('moveY', data.moveY || 0);
    rp.setData('aimAngle', data.aimAngle || 0);
    rp.setData('shoot', data.shoot || false);
    rp.setData('lastFired', rp.getData('lastFired') || 0);
  }

  removeRemotePlayer(peerId: string) {
    if (this.remotePlayers[peerId]) {
      this.remotePlayers[peerId].destroy();
      delete this.remotePlayers[peerId];
    }
    const indicatorKey = `indicator-remote-${peerId}`;
    if (this.playerIndicators[indicatorKey]) {
      this.playerIndicators[indicatorKey].destroy();
      delete this.playerIndicators[indicatorKey];
    }
  }

  private createBulletSprite(x: number, y: number, id: string) {
    const bullet: Phaser.GameObjects.Sprite = this.bullets.create(x, y, 'bullet');
    if (!bullet) return null;

    bullet.setDepth(1);
    bullet.setActive(true).setVisible(true);
    bullet.setData('syncId', id);
    bullet.setData('born', 0);
    bullet.update = function (t: number, d: number) {
      const born = this.getData('born') + d;
      this.setData('born', born);
      if (born > 1500) this.destroy();
    };

    return bullet;
  }

  private syncEnemySprites(enemies: EnemySnapshot[]) {
    const nextEnemySprites: Record<string, Phaser.GameObjects.Sprite> = {};

    enemies.forEach((enemy) => {
      let sprite = this.enemySprites[enemy.id];
      if (!sprite) {
        const texture =
          enemy.type === 'spawner'
            ? 'spawner'
            : enemy.type === 'big'
              ? 'bigenemy'
              : enemy.type === 'laser'
                ? 'laserenemy'
                : 'enemy';
        sprite = this.enemies.create(enemy.x, enemy.y, texture);
        if (!sprite) return;
        sprite.setData('syncId', enemy.id);
      }

      sprite.setPosition(enemy.x, enemy.y);
      sprite.rotation = enemy.r;
      sprite.setVisible(true);
      sprite.setActive(true);
      sprite.setData('type', enemy.type);
      sprite.setData(
        'hp',
        enemy.type === 'spawner' ? 100 : enemy.type === 'big' ? 5 : enemy.type === 'laser' ? 3 : 1
      );
      sprite.setData('laserState', enemy.laserState || 'idle');
      sprite.setData('laserAngle', enemy.laserAngle ?? enemy.r);
      nextEnemySprites[enemy.id] = sprite;
    });

    Object.keys(this.enemySprites).forEach((id) => {
      if (!nextEnemySprites[id]) {
        const sprite = this.enemySprites[id];
        if (sprite) {
          this.showEnemyImpact(sprite);
          sprite.destroy();
        }
        delete this.enemySprites[id];
      }
    });

    this.enemySprites = nextEnemySprites;
  }

  private syncBulletSprites(bullets: BulletSnapshot[]) {
    const nextBulletSprites: Record<string, Phaser.GameObjects.Sprite> = {};

    bullets.forEach((bullet) => {
      let sprite = this.bulletSprites[bullet.id];
      if (!sprite || !sprite.scene || !sprite.active) {
        sprite = this.createBulletSprite(bullet.x, bullet.y, bullet.id);
      }

      if (!sprite) return;

      sprite.setPosition(bullet.x, bullet.y);
      sprite.setVisible(true);
      sprite.setActive(true);
      nextBulletSprites[bullet.id] = sprite;
    });

    Object.keys(this.bulletSprites).forEach((id) => {
      if (!nextBulletSprites[id]) {
        const sprite = this.bulletSprites[id];
        if (sprite && sprite.scene) {
          sprite.setVisible(false);
          sprite.setActive(false);
          sprite.destroy();
        }
        delete this.bulletSprites[id];
      }
    });

    this.bulletSprites = nextBulletSprites;
  }

  broadcastState() {
    if (!isHost || !connections.length) return;
    const players: Record<string, { x: number; y: number; r: number; isDead: boolean }> = {};
    players['host'] = {
      x: this.player!.x,
      y: this.player!.y,
      r: this.player!.rotation,
      isDead: !!this.player!.getData('isDead'),
    };
    for (const id in this.remotePlayers) {
      const rp = this.remotePlayers[id];
      players[id] = { x: rp.x, y: rp.y, r: rp.rotation, isDead: !!rp.getData('isDead') };
    }

    const state: PeerSnapshotMessage = {
      type: 'state',
      score: this.score,
      players,
      enemies: this.enemies.getChildren().map((e: Phaser.GameObjects.Sprite) => ({
        id: (e.getData('syncId') as string) || '',
        x: e.x,
        y: e.y,
        type: e.getData('type') as string,
        r: e.rotation,
        laserState: e.getData('laserState'),
        laserAngle: e.getData('laserAngle'),
      })),
      bullets: this.bullets.getChildren().map((b: Phaser.GameObjects.Sprite) => ({
        id: (b.getData('syncId') as string) || '',
        x: b.x,
        y: b.y,
      })),
    };

    connections.forEach((conn) => conn.send(state));
  }

  sendInput() {
    if (isHost) return;
    if (!hostConnection || !hostConnection.open) return;

    const movement = this.getMovementInput();
    const shootInput = this.getShootInput();

    hostConnection.send({
      type: 'input',
      moveX: movement.x,
      moveY: movement.y,
      shoot: shootInput.shoot,
      aimAngle: shootInput.angle,
    });
  }

  receiveState(data: PeerSnapshotMessage) {
    if (isHost || !data || data.type !== 'state') return;
    this.score = data.score;
    this.scoreText.setText('SCORE: ' + data.score + ' | ROLE: CLIENT');

    this.syncEnemySprites(data.enemies || []);
    this.syncBulletSprites(data.bullets || []);

    if (data.players) {
      for (const id in data.players) {
        const playerState = data.players[id];
        const isDead = !!(playerState && playerState.isDead);

        if (id === 'host') {
          if (!this.hostPlayerSprite) {
            this.hostPlayerSprite = this.add.sprite(playerState.x, playerState.y, 'player');
            this.hostPlayerSprite.setDepth(2);
            this.applyPlayerColor(this.hostPlayerSprite, 'host');
          }
          this.hostPlayerSprite.setPosition(playerState.x, playerState.y);
          this.hostPlayerSprite.rotation = playerState.r;
          this.hostPlayerSprite.setVisible(!isDead);
        } else if (id === this.localPeerId) {
          if (this.player) {
            this.player.setData('isDead', isDead);
            this.player.setVisible(!isDead);
            if (!isDead) {
              this.player.setPosition(playerState.x, playerState.y);
              this.player.rotation = playerState.r;
            }
          }
        } else if (id !== 'host' && id !== this.localPeerId) {
          if (!this.otherRemoteSprites[id]) {
            const spr = this.add.sprite(playerState.x, playerState.y, 'guest');
            spr.setDepth(2);
            this.applyPlayerColor(spr, id);
            this.otherRemoteSprites[id] = spr;
          }
          this.otherRemoteSprites[id].setPosition(playerState.x, playerState.y);
          this.otherRemoteSprites[id].rotation = playerState.r;
          this.otherRemoteSprites[id].setVisible(!isDead);
        }
      }

      for (const id in this.otherRemoteSprites) {
        if (!data.players[id]) {
          this.otherRemoteSprites[id].destroy();
          delete this.otherRemoteSprites[id];
          const indicatorKey = `indicator-${id}`;
          if (this.playerIndicators[indicatorKey]) {
            this.playerIndicators[indicatorKey].destroy();
            delete this.playerIndicators[indicatorKey];
          }
        }
      }
    }
  }

  receiveEffect(data: PeerEffectMessage) {
    if (isHost || !data || data.type !== 'effect') return;
    this.applyEffect(data.effect, data.x, data.y);
  }

  resize(gameSize: Phaser.Structs.Size) {
    if (this.gameOverText) this.gameOverText.setPosition(gameSize.width / 2, gameSize.height / 2);
    if (this.pauseText) this.pauseText.setPosition(gameSize.width / 2, gameSize.height / 2);
  }

  update(time: number, delta: number) {
    if (Phaser.Input.Keyboard.JustDown(this.keyP)) {
      this.isPaused = !this.isPaused;
      this.pauseText.setVisible(this.isPaused);
      if (this.isPaused) this.physics.pause();
      else if (!this.gameOver) this.physics.resume();
    }

    this.updateOffscreenIndicators();

    if (this.gameOver || this.isPaused || !this.gameStarted) return;

    if (!this.player!.getData('isDead')) {
      const movement = this.getMovementInput();
      const moveX = movement.x;
      const moveY = movement.y;

      const speed = 350;
      this.player!.setVelocity(moveX * speed, moveY * speed);

      const shootInput = this.getShootInput();

      if (shootInput.shoot) {
        this.player!.rotation = shootInput.angle;
        if (isHost && !this.isInBaseArea(this.player!.x, this.player!.y) && time > this.lastFired) {
          const bulletId = `bullet-${++this.nextBulletId}`;
          const bullet = this.createBulletSprite(this.player!.x, this.player!.y, bulletId);
          if (bullet) {
            this.physics.velocityFromRotation(
              shootInput.angle,
              1000,
              bullet.body.velocity as Phaser.Math.Vector2
            );
            bullet.rotation = shootInput.angle;
            this.broadcastEffect('shot');
          }
          this.lastFired = time + this.fireRate;
        }
      } else if (moveX !== 0 || moveY !== 0) {
        this.player!.rotation = Math.atan2(moveY, moveX);
      }
    } else {
      this.player!.setVelocity(0, 0);
    }

    if (isHost) {
      // Dynamic Spawner Loop Replaces the fixed timer
      this.updateSpawners(time);

      const speed = 350;
      for (const id in this.remotePlayers) {
        const rp = this.remotePlayers[id];
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
          const bul: Phaser.GameObjects.Sprite | null = this.createBulletSprite(
            rp.x,
            rp.y,
            bulletId
          );
          if (bul) {
            this.physics.velocityFromRotation(
              angle,
              1000,
              bul.body.velocity as Phaser.Math.Vector2
            );
            bul.rotation = angle;
            this.broadcastEffect('shot');
          }
          rp.setData('lastFired', time + this.fireRate);
        }
      }

      const alivePlayers = this.getAlivePlayers();
      this.enemies.getChildren().forEach((enemy: Phaser.Physics.Arcade.Sprite) => {
        if (!enemy.active) return;
        if (enemy.getData('type') === 'spawner') {
          enemy.setVelocity(0, 0);
          return;
        }

        let target: Phaser.Physics.Arcade.Sprite | null = null;
        let minDist = Infinity;
        alivePlayers.forEach((player) => {
          if (!player || !player.active) return;
          const d = Phaser.Math.Distance.Between(enemy.x, enemy.y, player.x, player.y);
          if (d < minDist) {
            minDist = d;
            target = player;
          }
        });

        if (enemy.getData('type') === 'laser') {
          let spawnTime = enemy.getData('spawnTime') as number;
          if (!spawnTime) {
            spawnTime = time - Phaser.Math.Between(0, 10000);
            enemy.setData('spawnTime', spawnTime);
          }
          const cycleTime = (time - spawnTime) % 10000;

          if (cycleTime >= 8800 && cycleTime < 9800) {
            // Charging phase
            if (enemy.getData('laserState') !== 'charging') {
              enemy.setData('laserState', 'charging');
              let angle = enemy.rotation;
              if (target) {
                angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, target.x, target.y);
              }
              enemy.setData('laserAngle', angle);
            }
            enemy.setVelocity(0, 0);
            enemy.rotation = enemy.getData('laserAngle') as number;
          } else if (cycleTime >= 9800) {
            // Firing phase
            if (enemy.getData('laserState') !== 'firing') {
              enemy.setData('laserState', 'firing');
              this.broadcastEffect('laser', enemy.x, enemy.y);
              this.cameras.main.shake(100, 0.005);
            }
            enemy.setVelocity(0, 0);
            const angle = (enemy.getData('laserAngle') as number) ?? enemy.rotation;
            enemy.rotation = angle;

            const endPos = this.getLaserEndPoint(enemy.x, enemy.y, angle);
            const beamWidth = 16;
            const playerHitRadius = 15;

            alivePlayers.forEach((player) => {
              if (!player || !player.active || player.getData('isDead')) return;
              const dist = this.pointToSegmentDistance(
                player.x,
                player.y,
                enemy.x,
                enemy.y,
                endPos.x,
                endPos.y
              );
              if (dist <= beamWidth / 2 + playerHitRadius) {
                this.handlePlayerDeath(player);
              }
            });
          } else {
            // Normal moving phase
            if (enemy.getData('laserState') !== 'idle') {
              enemy.setData('laserState', 'idle');
            }
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

            if (!target || minDist > 600) {
              let wanderDirection = enemy.getData('wanderDirection') || 0;
              let nextTurnAt = enemy.getData('nextTurnAt') || 0;
              if (time > nextTurnAt) {
                wanderDirection = Phaser.Math.FloatBetween(0, Math.PI * 2);
                enemy.setData('wanderDirection', wanderDirection);
                enemy.setData('nextTurnAt', time + 800);
              }
              this.physics.velocityFromRotation(
                wanderDirection,
                80,
                enemy.body.velocity as Phaser.Math.Vector2
              );
              enemy.rotation = wanderDirection;
            } else {
              this.physics.moveToObject(enemy, target, 120);
              enemy.rotation = Phaser.Math.Angle.Between(enemy.x, enemy.y, target.x, target.y);
            }
          }
          return;
        }

        // Standard Enemy Handling
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

        if (!target || minDist > 600) {
          let wanderDirection = enemy.getData('wanderDirection') || 0;
          let nextTurnAt = enemy.getData('nextTurnAt') || 0;
          if (time > nextTurnAt) {
            wanderDirection = Phaser.Math.FloatBetween(0, Math.PI * 2);
            enemy.setData('wanderDirection', wanderDirection);
            enemy.setData('nextTurnAt', time + 800);
          }
          this.physics.velocityFromRotation(
            wanderDirection,
            80,
            enemy.body.velocity as Phaser.Math.Vector2
          );
          enemy.rotation = wanderDirection;
        } else {
          this.physics.moveToObject(enemy, target, 150);
          enemy.rotation += 0.05;
        }
      });
    }

    this.drawLasers();
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

  private pointToSegmentDistance(
    px: number,
    py: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number
  ): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    if (l2 === 0) return Phaser.Math.Distance.Between(px, py, x1, y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    return Phaser.Math.Distance.Between(px, py, projX, projY);
  }

  private drawLasers() {
    if (!this.laserGraphics) return;
    this.laserGraphics.clear();

    const activeEnemies: Array<{ x: number; y: number; state?: string; angle?: number }> = [];

    if (isHost) {
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
}

let isHost = false;
let currentSectorId = '1';
let roomCode: string | null = null;
let hostConnection: DataConnection | null = null;
let clientPeer: Peer | null = null;
let hostPeer: Peer | null = null;
let connections: DataConnection[] = [];
let gameScene: MainScene | null = null;

const synth: Synth | null = new Synth();
const sectorButtons = Array.from(document.querySelectorAll<HTMLElement>('.sector-btn'));
const statusText = document.getElementById('lobby-status');

sectorButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const sector = button.getAttribute('data-sector');
    if (!sector) return;
    selectSector(sector);
  });
});

function selectSector(sector: string) {
  const targetPeerId = `neon-sector-${sector}`;
  currentSectorId = sector;

  sectorButtons.forEach((button: HTMLButtonElement) => {
    button.disabled = true;
  });
  if (statusText) {
    statusText.innerText = `Preparing sector ${sector}...`;
  }

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
    if (statusText) {
      statusText.innerText = `Sector ${sector} host ready. Peer ID: ${targetPeerId}`;
    }
    startGameAsHost();
  });

  hostPeer.on('connection', (conn: DataConnection) => {
    connections.push(conn);
    conn.on('open', () => {
      console.log('Client connected:', conn.peer);
    });
    conn.on('data', (data: PeerMessage) => {
      if (data.type === 'input' && gameScene && gameScene.handleRemoteInput) {
        gameScene.handleRemoteInput(conn.peer, data);
      } else if (data.type === 'effect' && gameScene && gameScene.receiveEffect) {
        gameScene.receiveEffect(data);
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
      if (statusText) {
        statusText.innerText = `Sector ${sector} is already live. Joining...`;
      }
      joinSector(targetPeerId, sector);
      return;
    }

    if (statusText) {
      statusText.innerText = `Peer error: ${message || 'Unknown error'}`;
    }
    sectorButtons.forEach((button: HTMLButtonElement) => {
      button.disabled = false;
    });
  });
}

function joinSector(targetPeerId: string, sector: string) {
  isHost = false;
  roomCode = targetPeerId;
  currentSectorId = sector;
  clientPeer = new Peer();

  clientPeer.on('open', () => {
    if (statusText) {
      statusText.innerText = `Connecting to sector ${sector}...`;
    }
    const conn = clientPeer.connect(targetPeerId, { reliable: true });
    hostConnection = conn;

    conn.on('open', () => {
      if (statusText) {
        statusText.innerText = `Connected to sector ${sector}. Starting game...`;
      }
      startGameAsClient(conn);
    });

    conn.on('data', (data: PeerMessage) => {
      if (data.type === 'state' && gameScene && gameScene.receiveState) {
        gameScene.receiveState(data);
      } else if (data.type === 'effect' && gameScene && gameScene.receiveEffect) {
        gameScene.receiveEffect(data);
      }
    });

    conn.on('close', () => {
      if (statusText) {
        statusText.innerText = `Connection to sector ${sector} was lost.`;
      }
      sectorButtons.forEach((button: HTMLButtonElement) => {
        button.disabled = false;
      });
    });

    conn.on('error', (err: Error) => {
      if (statusText) {
        statusText.innerText = `Connection error: ${err.message || 'Unable to join sector'}`;
      }
      sectorButtons.forEach((button: HTMLButtonElement) => {
        button.disabled = false;
      });
    });
  });

  clientPeer.on('error', (err: Error) => {
    if (statusText) {
      statusText.innerText = `Peer error: ${err.message || 'Unable to create client peer'}`;
    }
    sectorButtons.forEach((button: HTMLButtonElement) => {
      button.disabled = false;
    });
  });
}

function startGameAsHost() {
  const lobbyOverlay = document.getElementById('lobby-overlay');
  if (lobbyOverlay) {
    lobbyOverlay.style.display = 'none';
  }
  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    scale: { mode: Phaser.Scale.RESIZE, parent: 'game-container', width: '100%', height: '100%' },
    physics: { default: 'arcade', arcade: { gravity: { x: 0, y: 0 }, debug: false } },
    scene: MainScene,
  };
  new Phaser.Game(config);
}

function startGameAsClient(conn: DataConnection) {
  const lobbyOverlay = document.getElementById('lobby-overlay');
  if (lobbyOverlay) {
    lobbyOverlay.style.display = 'none';
  }
  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    scale: { mode: Phaser.Scale.RESIZE, parent: 'game-container', width: '100%', height: '100%' },
    physics: { default: 'arcade', arcade: { gravity: { x: 0, y: 0 }, debug: false } },
    scene: MainScene,
  };
  new Phaser.Game(config);
}
