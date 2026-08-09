import Phaser from 'phaser';

export type MovementInput = { x: number; y: number };
export type ShootInput = { shoot: boolean; angle: number };

export interface ControlsOptions {
  isGameOver?: () => boolean;
  onRestart?: () => void;
}

export class Controls {
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

  private isGameOver?: () => boolean;
  private onRestart?: () => void;

  constructor(
    private scene: Phaser.Scene,
    options: ControlsOptions = {}
  ) {
    this.isGameOver = options.isGameOver;
    this.onRestart = options.onRestart;
  }

  initialize() {
    this.cursors = this.scene.input.keyboard.createCursorKeys();
    this.wasd = this.scene.input.keyboard.addKeys('W,A,S,D') as Record<
      string,
      Phaser.Input.Keyboard.Key
    >;
    this.keyP = this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.P);

    this.joyLeftBase = this.scene.add
      .circle(0, 0, 60, 0x00ffff, 0.2)
      .setVisible(false)
      .setScrollFactor(0)
      .setDepth(100);
    this.joyLeftThumb = this.scene.add
      .circle(0, 0, 30, 0x00ffff, 0.6)
      .setVisible(false)
      .setScrollFactor(0)
      .setDepth(100);
    this.joyRightBase = this.scene.add
      .circle(0, 0, 60, 0xff00ff, 0.2)
      .setVisible(false)
      .setScrollFactor(0)
      .setDepth(100);
    this.joyRightThumb = this.scene.add
      .circle(0, 0, 30, 0xff00ff, 0.6)
      .setVisible(false)
      .setScrollFactor(0)
      .setDepth(100);

    this.scene.input.on('pointerdown', this.handlePointerDown);
    this.scene.input.on('pointermove', this.handlePointerMove);
    this.scene.input.on('pointerup', this.handlePointerUp);
    this.scene.input.on('pointerout', this.handlePointerUp);
    this.scene.events.on('shutdown', this.shutdown);
    this.scene.events.on('destroy', this.shutdown);
  }

  shutdown = () => {
    this.scene.input.off('pointerdown', this.handlePointerDown);
    this.scene.input.off('pointermove', this.handlePointerMove);
    this.scene.input.off('pointerup', this.handlePointerUp);
    this.scene.input.off('pointerout', this.handlePointerUp);

    this.scene.events.off('shutdown', this.shutdown);
    this.scene.events.off('destroy', this.shutdown);

    if (this.keyP) {
      this.scene.input.keyboard.removeKey(this.keyP);
    }
    if (this.wasd) {
      Object.values(this.wasd).forEach((key) => this.scene.input.keyboard.removeKey(key));
    }
    if (this.cursors) {
      this.scene.input.keyboard.removeKey(this.cursors.left);
      this.scene.input.keyboard.removeKey(this.cursors.right);
      this.scene.input.keyboard.removeKey(this.cursors.up);
      this.scene.input.keyboard.removeKey(this.cursors.down);
    }

    this.leftPointer = null;
    this.rightPointer = null;
    this.leftVector = null;
    this.rightVector = null;
  };

  isPauseJustPressed(): boolean {
    return Phaser.Input.Keyboard.JustDown(this.keyP);
  }

  getMovementInput(): MovementInput {
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

  getShootInput(player: Phaser.Physics.Arcade.Sprite | null): ShootInput {
    if (this.rightVector && this.rightVector.force > 0.2) {
      return { shoot: true, angle: this.rightVector.angle };
    }

    const gamepadAim = this.getGamepadAim();
    if (gamepadAim && gamepadAim.force > 0.2) {
      return { shoot: true, angle: gamepadAim.angle };
    }

    if (
      player &&
      this.scene.input.activePointer.isDown &&
      !this.leftPointer &&
      !this.rightPointer
    ) {
      return {
        shoot: true,
        angle: Phaser.Math.Angle.Between(
          player.x,
          player.y,
          this.scene.input.activePointer.worldX,
          this.scene.input.activePointer.worldY
        ),
      };
    }

    return { shoot: false, angle: 0 };
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

  private getGamepadMovement(): MovementInput | null {
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

  handlePointerDown = (pointer: Phaser.Input.Pointer) => {
    if (this.isGameOver?.()) {
      this.onRestart?.();
      return;
    }

    const halfWidth = this.scene.scale.width / 2;
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
  };

  handlePointerMove = (pointer: Phaser.Input.Pointer) => {
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
  };

  handlePointerUp = (pointer: Phaser.Input.Pointer) => {
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
  };
}
