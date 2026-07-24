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
  x: number;
  y: number;
  type: string;
  r: number;
};

type BulletSnapshot = {
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

type PeerMessage = PeerSnapshotMessage | PeerInputMessage;

class MainScene extends Phaser.Scene {
  private score = 0;
  private gameOver = false;
  private isPaused = false;
  private lastFired = 0;
  private fireRate = 120;
  private gameStarted = true;
  private player: Phaser.Physics.Arcade.Sprite | null = null;
  private remotePlayers: Record<string, Phaser.Physics.Arcade.Sprite> = {};
  private bullets!: Phaser.Physics.Arcade.Group;
  private enemies!: Phaser.Physics.Arcade.Group;
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
  private enemySpeed = 150;
  private spawnTimer?: Phaser.Time.TimerEvent;
  private bigSpawnTimer?: Phaser.Time.TimerEvent;
  private broadcastTimer?: Phaser.Time.TimerEvent;
  private inputTimer?: Phaser.Time.TimerEvent;

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
  }

  create() {
    gameScene = this;

    this.physics.world.setBounds(0, 0, 2000, 2000);
    this.cameras.main.setBounds(0, 0, 2000, 2000);
    this.add.tileSprite(1000, 1000, 2000, 2000, 'grid');

    this.gameOver = false;
    this.isPaused = false;
    this.lastFired = 0;
    this.fireRate = 120;
    this.gameStarted = true;

    this.player = this.physics.add.sprite(1000, 1000, isHost ? 'player' : 'guest');
    this.player.setCollideWorldBounds(true);
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
    this.localPeerId = clientPeer && clientPeer.id ? clientPeer.id : null;

    this.bullets = this.physics.add.group({ runChildUpdate: true });
    this.enemies = this.physics.add.group();

    this.emitter = this.add.particles(0, 0, 'particle', {
      speed: { min: 50, max: 200 },
      angle: { min: 0, max: 360 },
      scale: { start: 1, end: 0 },
      blendMode: 'ADD',
      lifespan: 400,
      emitting: false,
    });

    this.scoreText = this.add
      .text(20, 20, 'SCORE: 0 | ROLE: ' + (isHost ? 'HOST (' + roomCode + ')' : 'CLIENT'), {
        fontSize: '20px',
        fontFamily: 'Courier',
        fontStyle: 'bold',
      })
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
      this.spawnTimer = this.time.addEvent({
        delay: 1000,
        callback: this.spawnEnemy,
        callbackScope: this,
        loop: true,
      });
      this.bigSpawnTimer = this.time.addEvent({
        delay: 6000,
        callback: this.spawnBigEnemy,
        callbackScope: this,
        loop: true,
      });

      this.physics.add.collider(this.bullets, this.enemies, this.hitEnemy, undefined, this);
      this.physics.add.collider(this.player, this.enemies, this.hitPlayer, undefined, this);

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

  spawnEnemy() {
    if (!this.gameStarted || this.gameOver || this.isPaused) return;
    const cam = this.cameras.main;
    const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
    const dist = Math.max(cam.width, cam.height) / 2 + 100;
    const ex = Phaser.Math.Clamp(this.player!.x + Math.cos(angle) * dist, 20, 1980);
    const ey = Phaser.Math.Clamp(this.player!.y + Math.sin(angle) * dist, 20, 1980);
    const enemy = this.enemies.create(ex, ey, 'enemy');
    if (enemy) {
      enemy.setData('type', 'normal');
      enemy.setData('hp', 1);
      enemy.setBounce(1);
      enemy.setCollideWorldBounds(true);
      if (synth && isHost) synth.playHit();
    }
  }

  spawnBigEnemy() {
    if (!this.gameStarted || this.gameOver || this.isPaused) return;
    const cam = this.cameras.main;
    const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
    const dist = Math.max(cam.width, cam.height) / 2 + 150;
    const ex = Phaser.Math.Clamp(this.player!.x + Math.cos(angle) * dist, 40, 1960);
    const ey = Phaser.Math.Clamp(this.player!.y + Math.sin(angle) * dist, 40, 1960);
    const enemy = this.enemies.create(ex, ey, 'bigenemy');
    if (enemy) {
      enemy.setData('type', 'big');
      enemy.setData('hp', 5);
      enemy.setBounce(1);
      enemy.setCollideWorldBounds(true);
      if (synth && isHost) synth.playBigSpawn();
    }
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
      this.emitter.explode(10, enemySprite.x, enemySprite.y);
      enemySprite.destroy();
      this.score += enemySprite.getData('type') === 'big' ? 50 : 10;
      this.scoreText.setText('SCORE: ' + this.score + ' | ROLE: HOST (' + roomCode + ')');
      if (synth && isHost) synth.playExplosion();
    } else {
      enemySprite.setTint(0xffffff);
      this.time.delayedCall(50, () => {
        if (enemySprite && enemySprite.active) enemySprite.clearTint();
      });
    }
    this.cameras.main.shake(30, 0.003);
  }

  respawnPlayer(player: Phaser.Physics.Arcade.Sprite) {
    if (!player || !player.active) return;

    const spawnX = 1000 + Phaser.Math.Between(-200, 200);
    const spawnY = 1000 + Phaser.Math.Between(-200, 200);

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
    this.emitter.explode(30, player.x, player.y);
    if (synth) synth.playDeath();

    this.time.delayedCall(5000, () => {
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

  getAlivePlayers() {
    const alivePlayers = [] as Phaser.Physics.Arcade.Sprite[];
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
      const rp = this.physics.add.sprite(1000, 1000, 'guest');
      rp.setCollideWorldBounds(true);
      this.remotePlayers[peerId] = rp;
      this.physics.add.collider(rp, this.enemies, this.hitPlayer, undefined, this);
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
        x: e.x,
        y: e.y,
        type: e.getData('type') as string,
        r: e.rotation,
      })),
      bullets: this.bullets
        .getChildren()
        .map((b: Phaser.GameObjects.Sprite) => ({ x: b.x, y: b.y })),
    };

    connections.forEach((conn) => conn.send(state));
  }

  sendInput() {
    if (isHost) return;
    if (!hostConnection || !hostConnection.open) return;

    let moveX = 0;
    let moveY = 0;
    if (this.leftVector) {
      moveX = this.leftVector.x;
      moveY = this.leftVector.y;
    } else {
      if (this.cursors.left.isDown || this.wasd.A.isDown) moveX = -1;
      if (this.cursors.right.isDown || this.wasd.D.isDown) moveX = 1;
      if (this.cursors.up.isDown || this.wasd.W.isDown) moveY = -1;
      if (this.cursors.down.isDown || this.wasd.S.isDown) moveY = 1;
    }
    let shoot = false;
    let aimAngle = 0;
    if (this.rightVector && this.rightVector.force > 0.2) {
      shoot = true;
      aimAngle = this.rightVector.angle;
    } else if (this.input!.activePointer.isDown && !this.leftPointer && !this.rightPointer) {
      shoot = true;
      aimAngle = Phaser.Math.Angle.Between(
        this.player!.x,
        this.player!.y,
        this.input!.activePointer.worldX,
        this.input!.activePointer.worldY
      );
    }

    hostConnection.send({
      type: 'input',
      moveX,
      moveY,
      shoot,
      aimAngle,
    });
  }

  receiveState(data: PeerSnapshotMessage) {
    if (isHost || !data || data.type !== 'state') return;
    this.scoreText.setText('SCORE: ' + data.score + ' | ROLE: CLIENT');

    this.enemies.clear(true, true);
    data.enemies.forEach((ed) => {
      const en = this.enemies.create(ed.x, ed.y, ed.type === 'big' ? 'bigenemy' : 'enemy');
      en.rotation = ed.r;
    });

    this.bullets.clear(true, true);
    data.bullets.forEach((bd) => {
      this.bullets.create(bd.x, bd.y, 'bullet');
    });

    if (data.players) {
      for (const id in data.players) {
        const playerState = data.players[id];
        const isDead = !!(playerState && playerState.isDead);

        if (id === 'host') {
          if (!this.hostPlayerSprite) {
            this.hostPlayerSprite = this.add.sprite(playerState.x, playerState.y, 'player');
            this.hostPlayerSprite.setDepth(2);
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
        }
      }
    }
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

    if (this.gameOver || this.isPaused || !this.gameStarted) return;

    let moveX = 0;
    let moveY = 0;
    if (!this.player!.getData('isDead')) {
      if (this.leftVector) {
        moveX = this.leftVector.x;
        moveY = this.leftVector.y;
      } else {
        if (this.cursors.left.isDown || this.wasd.A.isDown) moveX = -1;
        if (this.cursors.right.isDown || this.wasd.D.isDown) moveX = 1;
        if (this.cursors.up.isDown || this.wasd.W.isDown) moveY = -1;
        if (this.cursors.down.isDown || this.wasd.S.isDown) moveY = 1;
        if (moveX !== 0 && moveY !== 0) {
          const len = Math.sqrt(moveX * moveX + moveY * moveY);
          moveX /= len;
          moveY /= len;
        }
      }

      const speed = 350;
      this.player!.setVelocity(moveX * speed, moveY * speed);

      let isShooting = false;
      let aimAngle = 0;
      if (this.rightVector && this.rightVector.force > 0.2) {
        isShooting = true;
        aimAngle = this.rightVector.angle;
      } else if (this.input!.activePointer.isDown && !this.leftPointer && !this.rightPointer) {
        isShooting = true;
        aimAngle = Phaser.Math.Angle.Between(
          this.player!.x,
          this.player!.y,
          this.input!.activePointer.worldX,
          this.input!.activePointer.worldY
        );
      }

      if (isShooting) {
        this.player!.rotation = aimAngle;
        if (time > this.lastFired) {
          const bullet = this.bullets.create(this.player!.x, this.player!.y, 'bullet');
          if (bullet) {
            bullet.setActive(true).setVisible(true);
            this.physics.velocityFromRotation(
              aimAngle,
              1000,
              bullet.body.velocity as Phaser.Math.Vector2
            );
            bullet.rotation = aimAngle;
            bullet.setData('born', 0);
            bullet.update = function (t: number, d: number) {
              const born = (this as Phaser.GameObjects.Sprite).getData('born') + d;
              (this as Phaser.GameObjects.Sprite).setData('born', born);
              if (born > 1500) this.destroy();
            };
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
        if (synth) synth.playShot();

        if (mx !== 0 || my !== 0) rp.rotation = Math.atan2(my, mx);

        if (rp.getData('shoot') && time > rp.getData('lastFired')) {
          const angle = rp.getData('aimAngle') || 0;
          const bul: Phaser.GameObjects.Sprite | null = this.bullets.create(rp.x, rp.y, 'bullet');
          if (bul) {
            bul.setActive(true).setVisible(true);
            this.physics.velocityFromRotation(
              angle,
              1000,
              bul.body.velocity as Phaser.Math.Vector2
            );
            bul.rotation = angle;
            bul.setData('born', 0);
            bul.update = function (t: number, d: number) {
              const born = (this as Phaser.GameObjects.Sprite).getData('born') + d;
              (this as Phaser.GameObjects.Sprite).setData('born', born);
              if (born > 1500) this.destroy();
            };
            if (synth) synth.playShot();
          }
          rp.setData('lastFired', time + this.fireRate);
        }
      }

      const alivePlayers = this.getAlivePlayers();
      this.enemies.getChildren().forEach((enemy: Phaser.GameObjects.Sprite) => {
        if (!enemy.active) return;

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
  }
}

let isHost = false;
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
