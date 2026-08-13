import { enemyDefinitions } from './data/data';
import { EnemyConfig } from './types/Enemy';

export function createTextures(scene: Phaser.Scene) {
  const playerGraphics = scene.make.graphics({});
  playerGraphics.fillStyle(0x00ffff, 1);
  playerGraphics.fillTriangle(30, 15, 0, 30, 0, 0);
  playerGraphics.generateTexture('player', 30, 30);

  const guestGraphics = scene.make.graphics({});
  guestGraphics.fillStyle(0x00ff88, 1);
  guestGraphics.fillTriangle(30, 15, 0, 30, 0, 0);
  guestGraphics.generateTexture('guest', 30, 30);

  const bulletGraphics = scene.make.graphics({});
  bulletGraphics.fillStyle(0xffff00, 1);
  bulletGraphics.fillCircle(8, 8, 8);
  bulletGraphics.generateTexture('bullet', 16, 16);

  const gridGraphics = scene.make.graphics({});
  gridGraphics.lineStyle(1, 0x003333, 0.5);
  gridGraphics.strokeRect(0, 0, 100, 100);
  gridGraphics.generateTexture('grid', 100, 100);

  const particleGraphics = scene.make.graphics({});
  particleGraphics.fillStyle(0x00ffff, 1);
  particleGraphics.fillRect(0, 0, 4, 4);
  particleGraphics.generateTexture('particle', 4, 4);

  const wallGraphics = scene.make.graphics({});
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

  enemyDefinitions.forEach((definition) => {
    createEnemyTexture(scene, definition);
  });
}

function createEnemyTexture(scene: Phaser.Scene, definition: EnemyConfig) {
  if (definition.type === 'boss') {
    // Generate a texture for each part using a namespaced key: "id::partId"
    definition.parts.forEach((part) => {
      const visuals = part.visuals;
      if (!visuals) return;
      const size = Math.max(10, visuals.size ?? 16);
      const graphics = scene.make.graphics({});
      const fillColor = parseInt(visuals.fillColor, 16);
      const strokeColor = visuals.strokeColor ? parseInt(visuals.strokeColor, 16) : 0xffffff;
      const strokeWidth = visuals.strokeWidth ?? 2;

      graphics.lineStyle(strokeWidth, strokeColor, 1);
      graphics.fillStyle(fillColor, 1);

      const center = size + 2;
      const radius = size;

      switch (visuals.shape) {
        case 'circle':
          graphics.fillCircle(center, center, radius);
          graphics.strokeCircle(center, center, radius);
          break;
        case 'square':
          graphics.fillRect(center - radius, center - radius, radius * 2, radius * 2);
          graphics.strokeRect(center - radius, center - radius, radius * 2, radius * 2);
          break;
        case 'triangle':
          graphics.beginPath();
          graphics.moveTo(center, center - radius);
          graphics.lineTo(center + radius, center + radius);
          graphics.lineTo(center - radius, center + radius);
          graphics.closePath();
          graphics.fillPath();
          graphics.strokePath();
          break;
        case 'diamond':
          graphics.beginPath();
          graphics.moveTo(center, center - radius);
          graphics.lineTo(center + radius, center);
          graphics.lineTo(center, center + radius);
          graphics.lineTo(center - radius, center);
          graphics.closePath();
          graphics.fillPath();
          graphics.strokePath();
          break;
        case 'hexagon':
          for (let i = 0; i < 6; i += 1) {
            const angle = (Math.PI / 3) * i - Math.PI / 6;
            const x = center + Math.cos(angle) * radius;
            const y = center + Math.sin(angle) * radius;
            if (i === 0) graphics.moveTo(x, y);
            else graphics.lineTo(x, y);
          }
          graphics.closePath();
          graphics.fillPath();
          graphics.strokePath();
          break;
        case 'octagon':
          for (let i = 0; i < 8; i += 1) {
            const angle = (Math.PI / 4) * i - Math.PI / 8;
            const x = center + Math.cos(angle) * radius;
            const y = center + Math.sin(angle) * radius;
            if (i === 0) graphics.moveTo(x, y);
            else graphics.lineTo(x, y);
          }
          graphics.closePath();
          graphics.fillPath();
          graphics.strokePath();
          break;
        case 'star':
          graphics.beginPath();
          for (let i = 0; i < 10; i += 1) {
            const outerRadius = radius;
            const innerRadius = radius * 0.4;
            const angle = (Math.PI / 5) * i - Math.PI / 2;
            const r = i % 2 === 0 ? outerRadius : innerRadius;
            const x = center + Math.cos(angle) * r;
            const y = center + Math.sin(angle) * r;
            if (i === 0) graphics.moveTo(x, y);
            else graphics.lineTo(x, y);
          }
          graphics.closePath();
          graphics.fillPath();
          graphics.strokePath();
          break;
        case 'pentagon':
          for (let i = 0; i < 5; i += 1) {
            const angle = (Math.PI * 2 * i) / 5 - Math.PI / 2;
            const x = center + Math.cos(angle) * radius;
            const y = center + Math.sin(angle) * radius;
            if (i === 0) graphics.moveTo(x, y);
            else graphics.lineTo(x, y);
          }
          graphics.closePath();
          graphics.fillPath();
          graphics.strokePath();
          break;
        default:
          graphics.fillCircle(center, center, radius);
          graphics.strokeCircle(center, center, radius);
      }

      graphics.generateTexture(`${definition.id}::${part.partId}`, size * 2 + 4, size * 2 + 4);
      graphics.destroy();
    });

    // Also generate a fallback texture for the boss id using the core visuals
    const coreVisuals = definition.parts[0]?.visuals;
    if (coreVisuals) {
      const size = Math.max(10, coreVisuals.size ?? 16);
      const graphics = scene.make.graphics({});
      graphics.lineStyle(
        coreVisuals.strokeWidth ?? 2,
        coreVisuals.strokeColor ? parseInt(coreVisuals.strokeColor, 16) : 0xffffff,
        1
      );
      graphics.fillStyle(parseInt(coreVisuals.fillColor, 16), 1);
      const center = size + 2;
      const radius = size;
      graphics.fillCircle(center, center, radius);
      graphics.strokeCircle(center, center, radius);
      graphics.generateTexture(definition.id, size * 2 + 4, size * 2 + 4);
      graphics.destroy();
    }
    return;
  }

  const visuals = definition.visuals;
  if (!visuals) return;

  const size = Math.max(10, visuals.size ?? 16);
  const graphics = scene.make.graphics({});
  const fillColor = parseInt(visuals.fillColor, 16);
  const strokeColor = visuals.strokeColor ? parseInt(visuals.strokeColor, 16) : 0xffffff;
  const strokeWidth = visuals.strokeWidth ?? 2;

  graphics.lineStyle(strokeWidth, strokeColor, 1);
  graphics.fillStyle(fillColor, 1);

  const center = size + 2;
  const radius = size;

  switch (visuals.shape) {
    case 'circle':
      graphics.fillCircle(center, center, radius);
      graphics.strokeCircle(center, center, radius);
      break;
    case 'square':
      graphics.fillRect(center - radius, center - radius, radius * 2, radius * 2);
      graphics.strokeRect(center - radius, center - radius, radius * 2, radius * 2);
      break;
    case 'triangle':
      graphics.beginPath();
      graphics.moveTo(center, center - radius);
      graphics.lineTo(center + radius, center + radius);
      graphics.lineTo(center - radius, center + radius);
      graphics.closePath();
      graphics.fillPath();
      graphics.strokePath();
      break;
    case 'diamond':
      graphics.beginPath();
      graphics.moveTo(center, center - radius);
      graphics.lineTo(center + radius, center);
      graphics.lineTo(center, center + radius);
      graphics.lineTo(center - radius, center);
      graphics.closePath();
      graphics.fillPath();
      graphics.strokePath();
      break;
    case 'hexagon':
      for (let i = 0; i < 6; i += 1) {
        const angle = (Math.PI / 3) * i - Math.PI / 6;
        const x = center + Math.cos(angle) * radius;
        const y = center + Math.sin(angle) * radius;
        if (i === 0) graphics.moveTo(x, y);
        else graphics.lineTo(x, y);
      }
      graphics.closePath();
      graphics.fillPath();
      graphics.strokePath();
      break;
    case 'octagon':
      for (let i = 0; i < 8; i += 1) {
        const angle = (Math.PI / 4) * i - Math.PI / 8;
        const x = center + Math.cos(angle) * radius;
        const y = center + Math.sin(angle) * radius;
        if (i === 0) graphics.moveTo(x, y);
        else graphics.lineTo(x, y);
      }
      graphics.closePath();
      graphics.fillPath();
      graphics.strokePath();
      break;
    case 'star':
      graphics.beginPath();
      for (let i = 0; i < 10; i += 1) {
        const outerRadius = radius;
        const innerRadius = radius * 0.4;
        const angle = (Math.PI / 5) * i - Math.PI / 2;
        const r = i % 2 === 0 ? outerRadius : innerRadius;
        const x = center + Math.cos(angle) * r;
        const y = center + Math.sin(angle) * r;
        if (i === 0) graphics.moveTo(x, y);
        else graphics.lineTo(x, y);
      }
      graphics.closePath();
      graphics.fillPath();
      graphics.strokePath();
      break;
    case 'pentagon':
      for (let i = 0; i < 5; i += 1) {
        const angle = (Math.PI * 2 * i) / 5 - Math.PI / 2;
        const x = center + Math.cos(angle) * radius;
        const y = center + Math.sin(angle) * radius;
        if (i === 0) graphics.moveTo(x, y);
        else graphics.lineTo(x, y);
      }
      graphics.closePath();
      graphics.fillPath();
      graphics.strokePath();
      break;
    default:
      graphics.fillCircle(center, center, radius);
      graphics.strokeCircle(center, center, radius);
  }

  graphics.generateTexture(definition.id, size * 2 + 4, size * 2 + 4);
  graphics.destroy();
}
