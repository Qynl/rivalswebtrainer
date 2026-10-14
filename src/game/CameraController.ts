import type * as THREE from 'three';
import type { MovementSnapshot, Vec3 } from './movement/MovementTypes';

export class CameraController {
  private yaw = Math.PI;
  private pitch = 0;
  private sensitivity = 0.0022;
  private eyeHeight = 1.56;

  setSensitivity(value: number): void {
    this.sensitivity = value;
  }

  setAngles(yaw: number, pitch = 0): void {
    this.yaw = yaw;
    this.pitch = Math.max(-Math.PI / 2 + 0.035, Math.min(Math.PI / 2 - 0.035, pitch));
  }

  reset(yaw = Math.PI, pitch = 0): void {
    this.setAngles(yaw, pitch);
    this.eyeHeight = 1.56;
  }

  handleMouseMovement(movementX: number, movementY: number): void {
    this.yaw -= movementX * this.sensitivity;
    this.pitch -= movementY * this.sensitivity;
    this.pitch = Math.max(-Math.PI / 2 + 0.035, Math.min(Math.PI / 2 - 0.035, this.pitch));
  }

  addRecoil(pitch: number, yaw = 0): void {
    this.pitch = Math.max(-Math.PI / 2 + 0.035, Math.min(Math.PI / 2 - 0.035, this.pitch + pitch));
    this.yaw += yaw;
  }

  getYaw(): number {
    return this.yaw;
  }

  getPitch(): number {
    return this.pitch;
  }

  update(
    camera: THREE.PerspectiveCamera,
    position: Vec3,
    snapshot: MovementSnapshot,
    dt: number,
    standingEyeHeight: number,
    slidingEyeHeight: number,
  ): void {
    const targetEye = snapshot.sliding ? slidingEyeHeight : standingEyeHeight;
    // A short critically-damped-looking interpolation gives the reference's
    // low camera transition without turning crouch into a physics operation.
    const blend = 1 - Math.exp(-Math.max(0, dt) * 18);
    this.eyeHeight += (targetEye - this.eyeHeight) * blend;

    camera.position.set(position.x, position.y + this.eyeHeight, position.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = this.yaw;
    camera.rotation.x = this.pitch;
    camera.rotation.z = 0;
  }
}
