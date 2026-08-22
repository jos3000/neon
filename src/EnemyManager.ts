import Phaser from 'phaser';
import type { GameEvent } from './events';
import type { EnemyConfig } from './types/Enemy';
import type { PeerEffectMessage } from './types/PeerMessages';

export interface EnemyManagerOptions {
  scene: Phaser.Scene;
  walls: Phaser.Physics.Arcade.StaticGroup;
  entityLookup: Record<string, Phaser.GameObjects.Sprite>;
  baseCenter: { x: number; y: number };
  baseRadius: number;
  pushEvent: (event: GameEvent) => void;
  broadcastEffect: (effect: PeerEffectMessage['effect'], x?: number, y?: number) => void;
  addScore: (amount: number) => void;
  fireBullet: (x: number, y: number, angle: number, speed: number) => void;
}

// Owns everything about turning an EnemyConfig into live sprites and driving
// their per-frame behavior (movement, attacks, boss part layout, lasers),
// keeping MainScene focused on netcode/orchestration rather than enemy specifics.
export class EnemyManager {
  readonly enemies: Phaser.Physics.Arcade.Group;

  private scene: Phaser.Scene;
  private walls: Phaser.Physics.Arcade.StaticGroup;
  private entityLookup: Record<string, Phaser.GameObjects.Sprite>;
  private baseCenter: { x: number; y: number };
  private baseRadius: number;
  private pushEvent: (event: GameEvent) => void;
  private broadcastEffect: (effect: PeerEffectMessage['effect'], x?: number, y?: number) => void;
  private addScore: (amount: number) => void;
  private fireBullet: (x: number, y: number, angle: number, speed: number) => void;

  private nextEnemyId = 0;
  private laserGraphics: Phaser.GameObjects.Graphics;
  private connectionGraphics: Phaser.GameObjects.Graphics;

  constructor(options: EnemyManagerOptions) {
    this.scene = options.scene;
    this.walls = options.walls;
    this.entityLookup = options.entityLookup;
    this.baseCenter = options.baseCenter;
    this.baseRadius = options.baseRadius;
    this.pushEvent = options.pushEvent;
    this.broadcastEffect = options.broadcastEffect;
    this.addScore = options.addScore;
    this.fireBullet = options.fireBullet;

    this.enemies = this.scene.physics.add.group({ collideWorldBounds: true });
    this.laserGraphics = this.scene.add.graphics().setDepth(5);
    this.connectionGraphics = this.scene.add.graphics().setDepth(1);
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

  resolveEnemyTextureKey(definitionId: string, partId?: string): string {
    if (partId) {
      const partKey = `${definitionId}::${partId}`;
      if (this.scene.textures.exists(partKey)) return partKey;
    }
    return this.scene.textures.exists(definitionId) ? definitionId : 'enemy';
  }

  createEnemySprite(definition: EnemyConfig, x: number, y: number, forcedId?: string) {
    const enemyId = forcedId ?? `enemy-${++this.nextEnemyId}`;
    if (definition.type === 'standard') {
      const textureKey = this.resolveEnemyTextureKey(definition.id);
      const sprite = this.enemies.create(x, y, textureKey);
      if (!sprite) return null;

      sprite.setData('syncId', enemyId);
      sprite.setData('enemyId', definition.id);
      sprite.setData('type', definition.id);
      sprite.setData('hp', definition.maxHp);
      sprite.setData('definition', definition);
      sprite.setData('scoreValue', definition.scoreValue);
      sprite.setData('spawnTime', this.scene.time.now);
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

      this.entityLookup[enemyId] = sprite;

      return sprite;
    }

    // Boss: create a core sprite (root) and individual part sprites for each part
    const bossDef = definition;
    const corePart = bossDef.parts.find((p) => p.isCore) || bossDef.parts[0];
    const coreKey = this.resolveEnemyTextureKey(bossDef.id, corePart.partId);

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
    coreSprite.setData('spawnTime', this.scene.time.now);
    coreSprite.setBounce(1);
    coreSprite.setCollideWorldBounds(true);
    coreSprite.setDepth(2);
    this.configureHeavyBossSprite(coreSprite);

    // Store boss-level metadata on the core.
    coreSprite.setData('bossParts', bossDef.parts);
    coreSprite.setData('bossPhases', bossDef.phases);
    coreSprite.setData('bossPhaseIndex', 0);

    this.entityLookup[enemyId] = coreSprite;

    // Create non-core parts as independent sprites (so bullets can collide with them)
    bossDef.parts.forEach((part) => {
      if (part.partId === corePart.partId) return;
      const key = this.resolveEnemyTextureKey(bossDef.id, part.partId);
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

      this.entityLookup[`${enemyId}::${part.partId}`] = partSprite;
    });

    return coreSprite;
  }

  countAlive(enemyId: string): number {
    return this.enemies
      .getChildren()
      .filter((e) => e.active && e.getData('enemyId') === enemyId).length;
  }

  // Host-only, runtime-decided enemy creation (from MapManager's spawn schedule, or a
  // spawner enemy producing more enemies over time). Since only the host decides when
  // and where, the enemy is pushed as a GameEvent and built by MainScene's handleEvent()
  // on host and clients alike, the same way bullets are.
  spawnEnemy(definition: EnemyConfig, x: number, y: number): string {
    const enemyId = `enemy-${++this.nextEnemyId}`;
    this.pushEvent({ type: 'enemy-created', enemyId, definitionId: definition.id, x, y });
    return enemyId;
  }

  flashHit(sprite: Phaser.GameObjects.Sprite, indestructible: boolean) {
    sprite.setTintFill(indestructible ? 0x999999 : 0xffffff);
    this.scene.time.delayedCall(indestructible ? 80 : 50, () => {
      if (sprite && sprite.active) sprite.clearTint();
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
        this.scene.physics.velocityFromRotation(
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
        this.scene.physics.velocityFromRotation(
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
        this.scene.physics.moveTo(enemy, orbitX, orbitY, movement.speed);
        enemy.rotation = Phaser.Math.Angle.Between(enemy.x, enemy.y, orbitX, orbitY);
        return;
      }

      if (movement.style === 'chase' && target) {
        this.scene.physics.moveToObject(enemy, target, movement.speed);
        enemy.rotation = Phaser.Math.Angle.Between(enemy.x, enemy.y, target.x, target.y);
        return;
      }

      if (movement.style === 'flee' && target) {
        this.scene.physics.moveToObject(enemy, target, -movement.speed);
        enemy.rotation = Phaser.Math.Angle.Between(target.x, target.y, enemy.x, enemy.y);
        return;
      }

      this.scene.physics.velocityFromRotation(
        enemy.rotation,
        movement.speed,
        enemy.body.velocity as Phaser.Math.Vector2
      );

      if (enemyType === 'arc-viper') {
        enemy.rotation += 0.03;
      }
    }
  }

  // Host-only per-frame enemy movement/attack/boss-layout update.
  update(time: number, alivePlayers: Phaser.GameObjects.Sprite[]) {
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
          this.fireBullet(enemy.x, enemy.y, angle, definition.attack.projectileSpeed ?? 220);
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
            this.fireBullet(enemy.x, enemy.y, angle, definition.attack.projectileSpeed ?? 180);
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
  }

  handleBulletHit(
    bullet: Phaser.Types.Physics.Arcade.GameObjectWithBody,
    enemy: Phaser.Types.Physics.Arcade.GameObjectWithBody
  ) {
    const bulletSprite = bullet as Phaser.GameObjects.Sprite;
    this.pushEvent({
      type: 'bullet-destroyed',
      bulletId: bulletSprite.getData('syncId'),
      x: bulletSprite.x,
      y: bulletSprite.y,
    });
    const enemySprite = enemy as Phaser.GameObjects.Sprite;

    // If this sprite represents a boss part, damage that part specifically.
    const isPart = !!enemySprite.getData('isPart');
    if (isPart) {
      const destructible = enemySprite.getData('destructible');
      if (!destructible) {
        // Ping feedback for indestructible parts
        this.pushEvent({
          type: 'enemy-hit',
          enemyId: enemySprite.getData('syncId') as string,
          indestructible: true,
        });
        return;
      }

      const hp = (enemySprite.getData('hp') as number) - 1;
      enemySprite.setData('hp', hp);

      if (hp <= 0) {
        const isCore = !!enemySprite.getData('isCore');
        const syncId = enemySprite.getData('syncId') as string;

        // Award score for this part
        const partScore = (enemySprite.getData('scoreValue') as number) || 0;
        this.addScore(partScore);

        if (isCore) {
          this.broadcastEffect('explosion', enemySprite.x, enemySprite.y);
          this.pushEvent({
            type: 'enemy-destroyed',
            enemyId: syncId,
            cascadeParentId: syncId,
          });
        } else {
          this.broadcastEffect('hit', enemySprite.x, enemySprite.y);
          this.pushEvent({ type: 'enemy-destroyed', enemyId: syncId });
        }

        return;
      }

      // Part was hit but not destroyed: flash
      this.pushEvent({
        type: 'enemy-hit',
        enemyId: enemySprite.getData('syncId') as string,
      });

      return;
    }

    // Non-part enemies (legacy behavior)
    const hp = enemySprite.getData('hp') - 1;
    enemySprite.setData('hp', hp);
    if (hp <= 0) {
      this.broadcastEffect('explosion', enemySprite.x, enemySprite.y);
      this.pushEvent({
        type: 'enemy-destroyed',
        enemyId: enemySprite.getData('syncId') as string,
      });
      const scoreValue = enemySprite.getData('scoreValue') as number | undefined;
      this.addScore(scoreValue ?? 10);
    } else {
      this.pushEvent({
        type: 'enemy-hit',
        enemyId: enemySprite.getData('syncId') as string,
      });
    }
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

  private drawConnections() {
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

  private drawLasers() {
    this.laserGraphics.clear();

    const activeEnemies: Array<{ x: number; y: number; state?: string; angle?: number }> = [];

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

  // Draws boss-part connections and enemy telegraph/firing lasers. Runs on both
  // host and client every frame, purely from synced sprite data.
  draw() {
    this.drawConnections();
    this.drawLasers();
  }
}
