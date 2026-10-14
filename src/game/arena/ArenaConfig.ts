import type { Vec3 } from '../movement/MovementTypes';

export type ArenaMode = 'arena' | 'lab';

export interface SpawnPoint {
  position: Vec3;
  yaw: number;
}

export const ARENA_SPAWN: SpawnPoint = {
  position: { x: 0, y: 0, z: -8.3 },
  yaw: Math.PI,
};

export const LAB_SPAWN: SpawnPoint = {
  position: { x: 25, y: 0, z: -12.5 },
  yaw: Math.PI,
};

export const ARENA_LAYOUT_NOTES = {
  overallTiles: 26,
  arenaBounds: { minX: -17, maxX: 17, minZ: -17, maxZ: 17 },
  rampLength: 6,
  rampWidth: 9,
  rampHeight: 2.2,
  centerPlatformHeight: 1.25,
  confidence: 'medium',
};
