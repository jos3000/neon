import Phaser from 'phaser';
import type { GameEvent } from './events';

type BulletCreatedEvent = Extract<GameEvent, { type: 'bullet-created' }>;
type BulletDestroyedEvent = Extract<GameEvent, { type: 'bullet-destroyed' }>;

// How far a bullet flies before it expires of its own accord. The leash is a
// distance rather than a duration because speeds differ by more than 6x — player
// fire travels at 1000px/s, enemy projectiles crawl at 160-220px/s — so a single
// shared lifetime would have enemy fire winking out a couple of hundred pixels
// from the muzzle while player fire still crossed the map.
//
// The arena is 2000px across, so at this range nothing ever expires while it is
// still on someone's screen. It exists only to catch bullets that leave the world
// through a gap in the outer wall: those hit nothing, so without it they fly
// forever and accumulate for the rest of the mission.
export const BULLET_MAX_RANGE = 2000;

// Fallback for a bullet with no usable speed, so a bad definition can't produce
// an infinite lifetime and reintroduce the accumulation this guards against.
const FALLBACK_LIFETIME_MS = 3000;

// Clients keep their copy a little longer than the host does, so a bullet the
// host destroys right at the edge of its range (a hit landing on the last frame)
// is still around to receive the 'bullet-destroyed' event.
const CLIENT_BULLET_GRACE_MS = 1000;

// Every peer runs this off its own copy of the creation event, so an expiry costs
// no network traffic at all — unlike a hit, which is an authoritative host call.
function lifetimeForSpeed(speed: number): number {
  if (!(speed > 0)) return FALLBACK_LIFETIME_MS;
  return (BULLET_MAX_RANGE / speed) * 1000;
}

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
  fire(
    x: number,
    y: number,
    angle: number,
    speed: number,
    ownerType: 'player' | 'enemy',
    ownerId: string
  ) {
    const bulletId = `bullet-${++this.nextBulletId}`;
    this.pushEvent({ type: 'bullet-created', bulletId, x, y, angle, speed, ownerType, ownerId });
  }

  createBulletSprite(event: BulletCreatedEvent) {
    const bulletSprite = this.bullets.create(event.x, event.y, 'bullet');
    this.entityLookup[event.bulletId] = bulletSprite;
    bulletSprite.setData('syncId', event.bulletId);
    bulletSprite.setData('angle', event.angle);
    bulletSprite.setData('speed', event.speed);
    bulletSprite.setData('ownerType', event.ownerType);
    bulletSprite.setData('ownerId', event.ownerId);
    bulletSprite.setDepth(1);
    // Tint enemy fire red so it reads as hostile at a glance; player bullets keep the base yellow.
    if (event.ownerType === 'enemy') {
      bulletSprite.setTint(0xff3333);
    }

    // Clients dead-reckon bullets rather than reading their position out of the
    // host's snapshot. A bullet is a straight line at a constant speed, fully
    // described by the creation event every peer already receives, so simulating
    // it locally is exact — and it keeps by far the most numerous entity class
    // out of the position snapshot, which is what actually costs bandwidth.
    // It also removes the interpolation delay: a snapshot-driven bullet at
    // 1000 px/s was drawn ~100px behind where the host had it.
    this.launch(bulletSprite, event.angle, event.speed);

    this.leash(bulletSprite, lifetimeForSpeed(event.speed));
  }

  private launch(bulletSprite: Phaser.GameObjects.Sprite, angle: number, speed: number) {
    const body = (bulletSprite as Phaser.Physics.Arcade.Sprite).body;
    if (!body) return;
    this.scene.physics.velocityFromRotation(angle, speed, body.velocity as Phaser.Math.Vector2);
  }

  // Re-launches a bullet a late-joining client learned about from the host's
  // full entity snapshot rather than from its 'bullet-created' event, so it
  // dead-reckons from there like any other. The remaining lifetime is unknown,
  // so it gets a full one — the host's hit events still remove it on time, and
  // a stray extra bullet-flight is cheaper than one that vanishes early.
  adoptBullet(bulletSprite: Phaser.GameObjects.Sprite, angle: number, speed: number) {
    this.launch(bulletSprite, angle, speed);
    this.leash(bulletSprite, lifetimeForSpeed(speed));
  }

  // Gives the bullet its own expiry deadline. Clients hold theirs a little past
  // the host's so an authoritative destroy always finds something to destroy.
  private leash(bulletSprite: Phaser.GameObjects.Sprite, lifetime: number) {
    const expiresAt = this.scene.time.now + lifetime + (this.isHost ? 0 : CLIENT_BULLET_GRACE_MS);

    bulletSprite.update = (time: number) => {
      if (time < expiresAt) return;
      this.expireBullet(bulletSprite);
    };
  }

  // End of flight with nothing hit: no impact effect, and no event either. Host
  // and clients time this out independently from the same creation event.
  private expireBullet(bulletSprite: Phaser.GameObjects.Sprite) {
    if (!bulletSprite.active) return;
    delete this.entityLookup[bulletSprite.getData('syncId') as string];
    bulletSprite.destroy();
  }

  destroyBullet(event: BulletDestroyedEvent) {
    // destroy the bullet and show an impact effect at the host's authoritative
    // impact position (event.x/y) rather than at the local sprite's — the two are
    // a network hop apart, and the host's is the one that actually hit something.
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
