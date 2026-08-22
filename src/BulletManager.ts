import Phaser from 'phaser';
import type { GameEvent } from './events';

type BulletCreatedEvent = Extract<GameEvent, { type: 'bullet-created' }>;
type BulletDestroyedEvent = Extract<GameEvent, { type: 'bullet-destroyed' }>;

export interface BulletManagerOptions {
  scene: Phaser.Scene;
  entityLookup: Record<string, Phaser.GameObjects.Sprite>;
  isHost: boolean;
  pushEvent: (event: GameEvent) => void;
  explode: (count: number, x: number, y: number) => void;
}

// Owns the bullets group and the fire/create/destroy lifecycle. Bullets, like
// enemies, are created via a GameEvent so host and clients build the same
// sprite from the same event rather than the host pushing raw state.
export class BulletManager {
  readonly bullets: Phaser.Physics.Arcade.Group;

  private scene: Phaser.Scene;
  private entityLookup: Record<string, Phaser.GameObjects.Sprite>;
  private isHost: boolean;
  private pushEvent: (event: GameEvent) => void;
  private explode: (count: number, x: number, y: number) => void;

  private nextBulletId = 0;

  constructor(options: BulletManagerOptions) {
    this.scene = options.scene;
    this.entityLookup = options.entityLookup;
    this.isHost = options.isHost;
    this.pushEvent = options.pushEvent;
    this.explode = options.explode;

    this.bullets = this.scene.physics.add.group({ runChildUpdate: true });
  }

  // Generates a new bullet id and pushes a 'bullet-created' event, built by
  // createBulletSprite() on host and clients alike, the same way enemies are.
  fire(x: number, y: number, angle: number, speed: number) {
    const bulletId = `bullet-${++this.nextBulletId}`;
    this.pushEvent({ type: 'bullet-created', bulletId, x, y, angle, speed });
  }

  createBulletSprite(event: BulletCreatedEvent) {
    const bulletSprite = this.bullets.create(event.x, event.y, 'bullet');
    this.entityLookup[event.bulletId] = bulletSprite;
    bulletSprite.setData('syncId', event.bulletId);
    bulletSprite.setData('angle', event.angle);
    bulletSprite.setDepth(1);
    if (this.isHost) {
      bulletSprite.setData('speed', event.speed);
      this.scene.physics.velocityFromRotation(
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
  }

  destroyBullet(event: BulletDestroyedEvent) {
    // destroy the bullet and show an impact effect at the host's authoritative
    // impact position (event.x/y) — the client's own bulletSprite.x/y lags behind
    // due to snapshot interpolation, so using it here made the effect land short.
    const bulletSprite = this.entityLookup[event.bulletId];
    this.explode(4, event.x, event.y);
    if (bulletSprite) {
      bulletSprite.destroy();
      delete this.entityLookup[event.bulletId];
    }
  }

  hitWall(
    bullet: Phaser.Types.Physics.Arcade.GameObjectWithBody,
    _wall: Phaser.Types.Physics.Arcade.GameObjectWithBody
  ) {
    const bulletSprite = bullet as Phaser.GameObjects.Sprite;
    this.pushEvent({
      type: 'bullet-destroyed',
      bulletId: bulletSprite.getData('syncId'),
      x: bulletSprite.x,
      y: bulletSprite.y,
    });
  }
}
