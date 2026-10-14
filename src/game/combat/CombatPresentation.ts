import * as THREE from 'three';
import type { MovementSnapshot, Vec3 } from '../movement/MovementTypes';
import type { WeaponId } from './CombatTypes';

const bodyMaterial = new THREE.MeshStandardMaterial({
  color: 0x7b344e,
  roughness: 0.62,
  metalness: 0.08,
  emissive: 0x210916,
  emissiveIntensity: 0.42,
});
const armorMaterial = new THREE.MeshStandardMaterial({
  color: 0xd36b75,
  roughness: 0.45,
  metalness: 0.2,
});
const visorMaterial = new THREE.MeshStandardMaterial({
  color: 0x5ff1e4,
  roughness: 0.24,
  metalness: 0.42,
  emissive: 0x1d8d8e,
  emissiveIntensity: 0.55,
});

function mesh<T extends THREE.BufferGeometry>(
  geometry: T,
  material: THREE.Material,
  name: string,
): THREE.Mesh<T, THREE.Material> {
  const result = new THREE.Mesh(geometry, material);
  result.name = name;
  result.castShadow = true;
  result.receiveShadow = true;
  return result;
}

export class BotAvatarView {
  readonly group = new THREE.Group();
  private readonly body: THREE.Mesh;
  private readonly visor: THREE.Mesh;
  private readonly shadowRing: THREE.Mesh;
  private hitPulse = 0;

  constructor() {
    this.group.name = 'combat:bot-avatar';
    this.body = mesh(new THREE.BoxGeometry(0.82, 1.05, 0.5), bodyMaterial, 'bot:body');
    this.body.position.y = 0.525;
    this.group.add(this.body);

    const shoulder = mesh(new THREE.BoxGeometry(1.12, 0.22, 0.58), armorMaterial, 'bot:shoulder');
    shoulder.position.y = 0.98;
    this.group.add(shoulder);

    const head = mesh(new THREE.BoxGeometry(0.64, 0.56, 0.58), bodyMaterial, 'bot:head');
    head.position.y = 1.5;
    this.group.add(head);

    this.visor = mesh(new THREE.BoxGeometry(0.5, 0.14, 0.04), visorMaterial, 'bot:visor');
    this.visor.position.set(0, 1.54, -0.3);
    this.group.add(this.visor);

    const weapon = mesh(new THREE.BoxGeometry(0.18, 0.14, 0.76), armorMaterial, 'bot:weapon');
    weapon.position.set(0.46, 0.72, -0.38);
    weapon.rotation.x = -0.08;
    this.group.add(weapon);

    this.shadowRing = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.7, 24),
      new THREE.MeshBasicMaterial({
        color: 0xff6d8d,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.shadowRing.rotation.x = -Math.PI / 2;
    this.shadowRing.position.y = 0.02;
    this.shadowRing.name = 'bot:threat-ring';
    this.group.add(this.shadowRing);
  }

  addTo(scene: THREE.Scene): void {
    scene.add(this.group);
  }

  update(position: Vec3, yaw: number, movement: MovementSnapshot, dt: number): void {
    this.group.position.set(position.x, position.y, position.z);
    this.group.rotation.y = yaw;
    const crouch = movement.sliding ? 0.58 : 1;
    this.group.scale.y += (crouch - this.group.scale.y) * Math.min(1, dt * 18);
    this.visor.material = visorMaterial;
    this.hitPulse = Math.max(0, this.hitPulse - dt * 3.5);
    (this.shadowRing.material as THREE.MeshBasicMaterial).opacity = 0.28 + this.hitPulse * 0.55;
    this.shadowRing.scale.setScalar(1 + this.hitPulse * 0.16);
  }

  flashHit(): void {
    this.hitPulse = 1;
  }

  dispose(): void {
    this.group.traverse((object) => {
      const renderable = object as THREE.Mesh;
      if (renderable.geometry) renderable.geometry.dispose();
    });
  }
}

export class WeaponView {
  readonly group = new THREE.Group();
  private readonly carbine: THREE.Group;
  private readonly sidearm: THREE.Group;
  private activeWeapon: WeaponId = 'carbine';
  private recoil = 0;
  private firingPulse = 0;
  private bobTime = 0;

  constructor(camera: THREE.Camera) {
    this.group.name = 'combat:first-person-weapon';
    this.carbine = this.createCarbine();
    this.sidearm = this.createSidearm();
    this.group.add(this.carbine, this.sidearm);
    camera.add(this.group);
    this.setWeapon('carbine');
  }

  setWeapon(weapon: WeaponId): void {
    this.activeWeapon = weapon;
    this.carbine.visible = weapon === 'carbine';
    this.sidearm.visible = weapon === 'sidearm';
  }

  triggerFire(): void {
    this.recoil = Math.min(1, this.recoil + 0.72);
    this.firingPulse = 0.055;
    const muzzle = this.getMuzzle();
    muzzle.visible = true;
  }

  update(dt: number, movement: MovementSnapshot, aimHeld: boolean, reloading = false): void {
    this.bobTime += dt * (movement.horizontalSpeed > 1 ? 8 : 3.2);
    const speedFactor = Math.min(1, movement.horizontalSpeed / 15);
    const bobX = Math.sin(this.bobTime) * 0.008 * speedFactor;
    const bobY = Math.abs(Math.cos(this.bobTime * 0.5)) * 0.007 * speedFactor;
    const targetX = aimHeld ? 0.12 : 0.28;
    const targetY = (aimHeld ? -0.2 : -0.27) + (reloading ? -0.12 : 0);
    const targetZ = (aimHeld ? -0.58 : -0.7) + (reloading ? 0.06 : 0);
    this.group.position.x += (targetX + bobX - this.group.position.x) * Math.min(1, dt * 12);
    this.group.position.y += (targetY + bobY - this.group.position.y) * Math.min(1, dt * 12);
    this.group.position.z += (targetZ - this.group.position.z) * Math.min(1, dt * 12);
    this.recoil = Math.max(0, this.recoil - dt * 8.5);
    this.firingPulse = Math.max(0, this.firingPulse - dt);
    this.group.rotation.x = -this.recoil * 0.055 + (reloading ? 0.16 : 0);
    this.group.rotation.y = Math.sin(this.bobTime * 0.7) * 0.004 * speedFactor;
    this.group.rotation.z = reloading ? -0.11 : 0;
    this.getMuzzle().visible = this.firingPulse > 0 && !reloading;
  }

  private getMuzzle(): THREE.Object3D {
    return this.activeWeapon === 'carbine'
      ? this.carbine.getObjectByName('weapon:muzzle')!
      : this.sidearm.getObjectByName('weapon:muzzle')!;
  }

  private createCarbine(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'weapon:carbine';
    const dark = new THREE.MeshStandardMaterial({ color: 0x243744, roughness: 0.38, metalness: 0.54 });
    const accent = new THREE.MeshStandardMaterial({ color: 0x54d9d5, roughness: 0.3, metalness: 0.26, emissive: 0x1c6c6d, emissiveIntensity: 0.5 });
    const body = mesh(new THREE.BoxGeometry(0.24, 0.2, 0.72), dark, 'weapon:body');
    body.position.set(0, 0, 0);
    group.add(body);
    const barrel = mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.46, 12), dark, 'weapon:barrel');
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.015, -0.56);
    group.add(barrel);
    const sight = mesh(new THREE.BoxGeometry(0.06, 0.08, 0.18), accent, 'weapon:sight');
    sight.position.set(0, 0.14, -0.12);
    group.add(sight);
    const muzzle = mesh(new THREE.SphereGeometry(0.095, 8, 6), accent, 'weapon:muzzle');
    muzzle.position.set(0, 0.015, -0.8);
    muzzle.scale.set(1, 0.6, 0.7);
    muzzle.visible = false;
    group.add(muzzle);
    return group;
  }

  private createSidearm(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'weapon:sidearm';
    const dark = new THREE.MeshStandardMaterial({ color: 0x263b48, roughness: 0.34, metalness: 0.5 });
    const accent = new THREE.MeshStandardMaterial({ color: 0xf0bb68, roughness: 0.3, metalness: 0.22, emissive: 0x683e18, emissiveIntensity: 0.38 });
    const body = mesh(new THREE.BoxGeometry(0.22, 0.18, 0.42), dark, 'weapon:body');
    group.add(body);
    const grip = mesh(new THREE.BoxGeometry(0.16, 0.3, 0.16), dark, 'weapon:grip');
    grip.position.set(0, -0.19, 0.08);
    grip.rotation.x = -0.15;
    group.add(grip);
    const muzzle = mesh(new THREE.SphereGeometry(0.08, 8, 6), accent, 'weapon:muzzle');
    muzzle.position.set(0, 0, -0.34);
    muzzle.visible = false;
    group.add(muzzle);
    return group;
  }
}

export function createImpactEffect(scene: THREE.Scene, point: Vec3, normal: Vec3, color = 0x74f1e8): THREE.Group {
  const effect = new THREE.Group();
  effect.name = 'combat:impact';
  effect.position.set(point.x, point.y, point.z);
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 });
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.11, 0), material);
  effect.add(core);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.12, 0.18, 12),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false }),
  );
  ring.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(normal.x, normal.y, normal.z).normalize(),
  );
  effect.add(ring);
  scene.add(effect);
  return effect;
}
