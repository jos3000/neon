import Phaser from 'phaser';
import type { GameEvent } from './events';
import type { PeerEffectMessage, PeerInputMessage } from './types/PeerMessages';

export interface PlayerManagerOptions {
  scene: Phaser.Scene;
  entityLookup: Record<string, Phaser.GameObjects.Sprite>;
  baseCenter: { x: number; y: number };
  isHost: boolean;
  isGameOver: () => boolean;
  isInBaseArea: (x: number, y: number) => boolean;
  broadcastEffect: (effect: PeerEffectMessage['effect'], x?: number, y?: number) => void;
  pushEvent: (event: GameEvent) => void;
  fireBullet: (
    x: number,
    y: number,
    angle: number,
    speed: number,
    ownerType: 'player' | 'enemy',
    ownerId: string
  ) => void;
}

// Owns player sprite creation, color assignment, and lifecycle (death/respawn),
// plus host-side simulation of remote players from their latest input — keeping
// MainScene focused on the locally-controlled player and netcode orchestration.
export class PlayerManager {
  readonly players: Phaser.Physics.Arcade.Group;
  readonly playerSprites: Record<string, Phaser.Physics.Arcade.Sprite> = {};

  private scene: Phaser.Scene;
  private entityLookup: Record<string, Phaser.GameObjects.Sprite>;
  private baseCenter: { x: number; y: number };
  private isHost: boolean;
  private isGameOver: () => boolean;
  private isInBaseArea: (x: number, y: number) => boolean;
  private broadcastEffect: (effect: PeerEffectMessage['effect'], x?: number, y?: number) => void;
  private pushEvent: (event: GameEvent) => void;
  private fireBullet: (
    x: number,
    y: number,
    angle: number,
    speed: number,
    ownerType: 'player' | 'enemy',
    ownerId: string
  ) => void;

  private playerColors: Record<string, number> = {};

  constructor(options: PlayerManagerOptions) {
    this.scene = options.scene;
    this.entityLookup = options.entityLookup;
    this.baseCenter = options.baseCenter;
    this.isHost = options.isHost;
    this.isGameOver = options.isGameOver;
    this.isInBaseArea = options.isInBaseArea;
    this.broadcastEffect = options.broadcastEffect;
    this.pushEvent = options.pushEvent;
    this.fireBullet = options.fireBullet;

    this.players = this.scene.physics.add.group({ collideWorldBounds: true });
  }

  createLocalPlayer(
    textureKey: string,
    syncId: string | null,
    isHost: boolean
  ): Phaser.Physics.Arcade.Sprite {
    const sprite = this.players.create(this.baseCenter.x, this.baseCenter.y, textureKey);
    sprite.setData('syncId', syncId);
    this.playerSprites[syncId] = sprite;
    if (isHost && syncId) {
      this.entityLookup[syncId] = sprite;
    }
    sprite.setDepth(2);
    return sprite;
  }

  getPlayerColor(id: string): number {
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

  applyPlayerColor(sprite: Phaser.GameObjects.Sprite, id: string) {
    const color = this.getPlayerColor(id);
    sprite.setTint(color);
    sprite.setData('playerColor', color);
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

  // Applies the actual death visuals/state to a sprite. Invoked via the 'player-died'
  // event on host and clients alike (see handlePlayerDeath below), the same way enemy
  // destruction is applied uniformly through 'enemy-destroyed' — otherwise only the
  // host's own copy of the sprite would ever reflect the death.
  applyPlayerDeath(player: Phaser.Physics.Arcade.Sprite) {
    if (!player || !player.active) return;

    player.setData('isDead', true);
    player.setTint(0xff0000);
    player.setVelocity(0, 0);
    player.body.enable = false;
    player.setVisible(false);
  }

  // Host-only: decides a player has died (from a collision, so only ever runs where
  // physics colliders are registered — see MainScene's `if (this.isHost)` collider
  // setup) and schedules their respawn. The actual state change is deferred to the
  // 'player-died'/'player-respawned' events so it applies the same way on every peer.
  handlePlayerDeath(player: Phaser.Physics.Arcade.Sprite) {
    if (!player || !player.active || player.getData('isDead')) return;

    player.setData('isDead', true);
    const peerId = player.getData('syncId') as string;
    this.pushEvent({ type: 'player-died', peerId });
    this.broadcastEffect('death', player.x, player.y);

    this.scene.time.delayedCall(3000, () => {
      if (!player || !player.active) return;
      this.pushEvent({ type: 'player-respawned', peerId });
    });
  }

  hitPlayer(
    player: Phaser.Types.Physics.Arcade.GameObjectWithBody,
    enemy: Phaser.Types.Physics.Arcade.GameObjectWithBody
  ) {
    if (this.isGameOver()) return;
    this.handlePlayerDeath(player as Phaser.Physics.Arcade.Sprite);
  }

  handleBulletHit(
    bullet: Phaser.Types.Physics.Arcade.GameObjectWithBody,
    player: Phaser.Types.Physics.Arcade.GameObjectWithBody
  ) {
    const bulletSprite = bullet as Phaser.GameObjects.Sprite;
    // The bullet always gets destroyed on contact, even against its own team,
    // so friendly fire still collides — it just doesn't hurt.
    this.pushEvent({
      type: 'bullet-destroyed',
      bulletId: bulletSprite.getData('syncId'),
      x: bulletSprite.x,
      y: bulletSprite.y,
    });

    if (bulletSprite.getData('ownerType') === 'player') return;
    if (this.isGameOver()) return;
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
    if (!this.isHost || this.isGameOver()) return;
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
  }

  // Host-only: simulate every remote player's movement/aim/fire from their
  // latest input snapshot (see handleRemoteInput), skipping the locally
  // controlled sprite which MainScene drives directly from Controls.
  updateRemotePlayers(time: number, fireRate: number, localPlayer: Phaser.GameObjects.Sprite) {
    const speed = 350;
    for (const id in this.playerSprites) {
      const rp = this.playerSprites[id];
      if (rp === localPlayer) continue;
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
        this.fireBullet(rp.x, rp.y, angle, 1000, 'player', id);
        rp.setData('lastFired', time + fireRate);
      }
    }
  }
}
