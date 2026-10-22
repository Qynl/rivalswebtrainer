import { clamp, lerp } from './geometry';

export interface Camera {
  x: number;
  y: number;
  shakeTime: number;
  shakeMag: number;
  offsetX: number;
  offsetY: number;
}

export function createCamera(): Camera {
  return { x: 0, y: 0, shakeTime: 0, shakeMag: 0, offsetX: 0, offsetY: 0 };
}

export function shake(cam: Camera, mag: number, time: number): void {
  cam.shakeMag = Math.max(cam.shakeMag, mag);
  cam.shakeTime = Math.max(cam.shakeTime, time);
}

export interface CameraTarget {
  x: number;
  y: number;
  vx: number;
}

export function updateCamera(
  cam: Camera,
  target: CameraTarget,
  viewW: number,
  viewH: number,
  worldW: number,
  worldH: number,
  dt: number,
): void {
  const lookAhead = clamp(target.vx * 0.12, -70, 70);
  const desiredX = target.x - viewW / 2 + lookAhead;
  const desiredY = target.y - viewH / 2 - 40;
  cam.x = lerp(cam.x, desiredX, 1 - Math.pow(0.0025, dt));
  cam.y = lerp(cam.y, desiredY, 1 - Math.pow(0.003, dt));
  cam.x = clamp(cam.x, 0, Math.max(0, worldW - viewW));
  cam.y = clamp(cam.y, -200, Math.max(-200, worldH - viewH));

  if (cam.shakeTime > 0) {
    cam.shakeTime = Math.max(0, cam.shakeTime - dt);
    cam.offsetX = (Math.random() * 2 - 1) * cam.shakeMag;
    cam.offsetY = (Math.random() * 2 - 1) * cam.shakeMag;
    if (cam.shakeTime === 0) cam.shakeMag = 0;
  } else {
    cam.offsetX = 0;
    cam.offsetY = 0;
  }
}
