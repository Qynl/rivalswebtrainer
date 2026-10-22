import type { PlayerEvents, PlayerState } from '../game/movement';
import { attackHitbox } from '../game/movement';
import { approach, lerp } from '../game/geometry';

interface Afterimage {
  x: number;
  y: number;
  facing: number;
  crouching: boolean;
  age: number;
}

export interface PlayerVisual {
  distTraveled: number;
  cloakX: number;
  cloakY: number;
  scaleX: number;
  scaleY: number;
  swingProgress: number; // 0..1 while a side-attack swing plays
  blinkClock: number;
  afterimages: Afterimage[];
  eyeGlow: number;
}

export function createPlayerVisual(): PlayerVisual {
  return {
    distTraveled: 0,
    cloakX: -18,
    cloakY: 0,
    scaleX: 1,
    scaleY: 1,
    swingProgress: 1,
    blinkClock: 2 + Math.random() * 2,
    afterimages: [],
    eyeGlow: 1,
  };
}

export function updatePlayerVisual(v: PlayerVisual, s: PlayerState, ev: PlayerEvents, dt: number): void {
  if (s.onGround && !s.crouching && s.dashTimer <= 0) {
    v.distTraveled += Math.abs(s.vel.x) * dt;
  }

  const targetCloakX = -s.facing * (18 + Math.min(26, Math.abs(s.vel.x) * 0.1)) - s.vel.x * 0.05;
  const targetCloakY = Math.min(24, Math.max(-10, s.vel.y * 0.06));
  v.cloakX = lerp(v.cloakX, targetCloakX, 1 - Math.pow(0.002, dt));
  v.cloakY = lerp(v.cloakY, targetCloakY, 1 - Math.pow(0.002, dt));

  v.scaleX = approach(v.scaleX, 1, dt * 3.2);
  v.scaleY = approach(v.scaleY, 1, dt * 3.2);
  if (ev.jumped || ev.wallJumped) {
    v.scaleX = 0.78;
    v.scaleY = 1.28;
  }
  if (ev.landed) {
    v.scaleX = 1.32;
    v.scaleY = 0.7;
  }
  if (ev.dashed) {
    v.scaleX = 1.3;
    v.scaleY = 0.82;
  }

  if (ev.attacked === 'side') v.swingProgress = 0;
  if (v.swingProgress < 1) v.swingProgress = Math.min(1, v.swingProgress + dt / 0.16);

  v.blinkClock -= dt;
  if (v.blinkClock <= 0) v.blinkClock = 2.5 + Math.random() * 2.5;
  v.eyeGlow = s.hurtTimer > 0 ? 1.6 : 1;

  if (s.dashTimer > 0) {
    v.afterimages.push({ x: s.pos.x, y: s.pos.y, facing: s.facing, crouching: s.crouching, age: 0 });
  }
  for (const a of v.afterimages) a.age += dt;
  v.afterimages = v.afterimages.filter((a) => a.age < 0.22);
}

function drawAfterimage(ctx: CanvasRenderingContext2D, s: PlayerState, a: Afterimage): void {
  const alpha = 0.22 * (1 - a.age / 0.22);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(a.x + s.width / 2, a.y + s.height);
  ctx.scale(a.facing, 1);
  ctx.fillStyle = '#eaf6ff';
  const h = a.crouching ? s.height * 0.65 : s.height;
  ctx.beginPath();
  ctx.ellipse(0, -h * 0.5, s.width * 0.38, h * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCloak(ctx: CanvasRenderingContext2D, v: PlayerVisual, bodyH: number, wallCling: boolean): void {
  const shoulderX = 0;
  const shoulderY = -bodyH * 0.78;
  const tailX = wallCling ? v.cloakX * 0.3 : v.cloakX;
  const tailY = wallCling ? v.cloakY * 0.3 + 6 : v.cloakY;

  ctx.beginPath();
  ctx.moveTo(shoulderX - 3, shoulderY + 2);
  ctx.bezierCurveTo(
    shoulderX + tailX * 0.3,
    shoulderY + bodyH * 0.25,
    tailX * 0.9,
    shoulderY + bodyH * 0.55 + tailY * 0.6,
    tailX,
    -2 + tailY,
  );
  ctx.bezierCurveTo(
    tailX * 0.5,
    -bodyH * 0.1 + tailY * 0.4,
    shoulderX + 10,
    -bodyH * 0.25,
    shoulderX + 6,
    shoulderY + 6,
  );
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, shoulderY, tailX, tailY);
  grad.addColorStop(0, '#5a3c52');
  grad.addColorStop(1, '#2a1c30');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,230,255,0.12)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function legCurve(ctx: CanvasRenderingContext2D, hipX: number, hipY: number, footX: number, footY: number): void {
  const kneeX = (hipX + footX) / 2 + (footX > hipX ? 2 : -2);
  const kneeY = hipY + (footY - hipY) * 0.55;
  ctx.beginPath();
  ctx.moveTo(hipX, hipY);
  ctx.quadraticCurveTo(kneeX, kneeY, footX, footY);
  ctx.stroke();
}

export function drawPlayer(ctx: CanvasRenderingContext2D, s: PlayerState, v: PlayerVisual): void {
  for (const a of v.afterimages) drawAfterimage(ctx, s, a);

  const centerX = s.pos.x + s.width / 2;
  const feetY = s.pos.y + s.height;
  const bodyH = s.crouching ? s.height * 0.68 : s.height;
  const wallCling = s.onWall !== 0 && !s.onGround;

  const blinking = v.blinkClock < 0.12;
  const hurtBlink = s.invulnTimer > 0 && Math.floor(s.invulnTimer * 14) % 2 === 0;

  ctx.save();
  ctx.translate(centerX, feetY);
  if (wallCling) {
    ctx.translate(s.onWall * 2, 0);
  }
  ctx.scale(s.facing * v.scaleX, v.scaleY);
  if (hurtBlink) ctx.globalAlpha = 0.35;

  drawCloak(ctx, v, bodyH, wallCling);

  // --- legs ---
  ctx.strokeStyle = '#201a24';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  const hipY = -bodyH * 0.32;
  if (wallCling) {
    legCurve(ctx, -2, hipY, 7, -2);
    legCurve(ctx, 2, hipY, 9, -1);
  } else if (!s.onGround) {
    const tuck = s.vel.y < 0 ? -6 : 4;
    legCurve(ctx, -3, hipY, -5, -2 - tuck * 0.3);
    legCurve(ctx, 3, hipY, 8, -1 + tuck * 0.3);
  } else if (s.crouching || Math.abs(s.vel.x) < 4) {
    legCurve(ctx, -3, hipY, -4, -1);
    legCurve(ctx, 3, hipY, 5, -1);
  } else {
    const phase = (v.distTraveled / 7) % (Math.PI * 2);
    const swing = 7;
    legCurve(ctx, -2, hipY, Math.sin(phase) * swing, -1);
    legCurve(ctx, 2, hipY, Math.sin(phase + Math.PI) * swing, -1);
  }

  // --- hood / body silhouette ---
  ctx.beginPath();
  ctx.moveTo(-s.width * 0.34, -bodyH * 0.1);
  ctx.quadraticCurveTo(-s.width * 0.46, -bodyH * 0.55, -s.width * 0.22, -bodyH * 0.92);
  ctx.quadraticCurveTo(0, -bodyH * 1.1, s.width * 0.3, -bodyH * 0.92);
  ctx.quadraticCurveTo(s.width * 0.5, -bodyH * 0.5, s.width * 0.3, -bodyH * 0.08);
  ctx.quadraticCurveTo(0, bodyH * 0.02, -s.width * 0.34, -bodyH * 0.1);
  ctx.closePath();
  const bodyGrad = ctx.createLinearGradient(-s.width * 0.4, -bodyH, s.width * 0.4, 0);
  bodyGrad.addColorStop(0, '#171019');
  bodyGrad.addColorStop(0.55, '#241827');
  bodyGrad.addColorStop(1, '#3a2638');
  ctx.fillStyle = bodyGrad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,225,255,0.14)';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // horn / hood point accents (needle-kin silhouette)
  ctx.beginPath();
  ctx.moveTo(-s.width * 0.12, -bodyH * 0.9);
  ctx.lineTo(-s.width * 0.26, -bodyH * 1.18);
  ctx.lineTo(-s.width * 0.02, -bodyH * 0.86);
  ctx.closePath();
  ctx.fill();

  // eyes
  if (!blinking) {
    const eyeY = -bodyH * 0.64;
    ctx.fillStyle = `rgba(255,245,210,${0.9 * v.eyeGlow})`;
    ctx.save();
    ctx.shadowColor = 'rgba(255,235,180,0.9)';
    ctx.shadowBlur = 6 * v.eyeGlow;
    ctx.beginPath();
    ctx.ellipse(s.width * 0.08, eyeY, 3.2, 2.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // --- needle / arm ---
  const attackBox = attackHitbox(s);
  let needleAngle = -0.35;
  if (s.attackKind === 'side') {
    const t = v.swingProgress;
    needleAngle = lerp(-1.3, 1.1, Math.min(1, t * 1.4));
  } else if (s.attackKind === 'down') {
    needleAngle = Math.PI / 2;
  }
  const handX = s.width * 0.14;
  const handY = -bodyH * 0.42;
  const needleLen = 30;
  ctx.save();
  ctx.translate(handX, handY);
  ctx.rotate(needleAngle);
  ctx.strokeStyle = s.attackKind ? '#f4ffe8' : '#cfd6c6';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(needleLen, 0);
  ctx.stroke();
  ctx.fillStyle = '#b8c2ae';
  ctx.beginPath();
  ctx.arc(0, 0, 2.4, 0, Math.PI * 2);
  ctx.fill();
  if (s.attackKind) {
    ctx.strokeStyle = 'rgba(244,255,232,0.45)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(0, 0, needleLen * 0.9, -0.9, 0.9);
    ctx.stroke();
  }
  ctx.restore();

  ctx.restore();

  if (attackBox) {
    // subtle debug-free hint glow so the active hit window reads as "sharp"
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#f4ffe8';
    ctx.fillRect(attackBox.x, attackBox.y, attackBox.w, attackBox.h);
    ctx.restore();
  }
}
