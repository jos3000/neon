import Phaser from 'phaser';

export interface TrackerManagerOptions {
  scene: Phaser.Scene;
}

// Draws off-screen directional indicators (radar-style arrows) pointing
// toward tracked sprites — e.g. teammates — that have scrolled outside the
// camera view.
export class TrackerManager {
  private scene: Phaser.Scene;
  private indicators: Record<string, Phaser.GameObjects.Graphics> = {};

  constructor(options: TrackerManagerOptions) {
    this.scene = options.scene;
  }

  update(trackedSprites: Record<string, Phaser.GameObjects.Sprite>, excludeId: string | null) {
    const camera = this.scene.cameras.main;
    const viewLeft = camera.scrollX;
    const viewRight = camera.scrollX + camera.width;
    const viewTop = camera.scrollY;
    const viewBottom = camera.scrollY + camera.height;
    const tracked: Array<{ id: string; sprite: Phaser.GameObjects.Sprite }> = [];

    Object.entries(trackedSprites).forEach(([id, sprite]) => {
      if (id !== excludeId) {
        tracked.push({ id, sprite });
      }
    });

    tracked.forEach(({ id, sprite }) => {
      const indicatorId = `indicator-${id}`;
      if (!this.indicators[indicatorId]) {
        this.indicators[indicatorId] = this.scene.add
          .graphics({ x: 0, y: 0 })
          .setScrollFactor(0)
          .setDepth(250);
      }
      const indicator = this.indicators[indicatorId];
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

    Object.keys(this.indicators).forEach((indicatorKey) => {
      const isTracked = tracked.some(({ id }) => `indicator-${id}` === indicatorKey);
      if (!isTracked) {
        this.indicators[indicatorKey].destroy();
        delete this.indicators[indicatorKey];
      }
    });
  }
}
