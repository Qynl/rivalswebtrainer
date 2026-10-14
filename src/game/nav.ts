import { PLAYER, MOVE } from './config';
import type { Aabb, Vec3 } from './movement';

export interface NavGrid {
  size: number; // cells per side
  cell: number; // metres per cell
  origin: number; // world coord of cell 0 minimum corner
  walkable: Uint8Array;
}

/** Builds a walkability grid. A cell is blocked if any solid taller than the step height covers it. */
export function buildNavGrid(solids: readonly Aabb[], half: number, cell = 1): NavGrid {
  const size = Math.ceil((half * 2) / cell);
  const walkable = new Uint8Array(size * size);
  const origin = -half;
  const margin = PLAYER.radius;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const cx0 = origin + i * cell;
      const cz0 = origin + j * cell;
      const cx1 = cx0 + cell;
      const cz1 = cz0 + cell;
      let ok = true;
      for (const b of solids) {
        if (b.max.y <= PLAYER.stepHeight) continue; // climbable step / floor slab
        if (cx1 + margin <= b.min.x || cx0 - margin >= b.max.x) continue;
        if (cz1 + margin <= b.min.z || cz0 - margin >= b.max.z) continue;
        ok = false;
        break;
      }
      walkable[j * size + i] = ok ? 1 : 0;
    }
  }
  return { size, cell, origin, walkable };
}

export function toCell(g: NavGrid, x: number, z: number): [number, number] {
  const i = Math.min(g.size - 1, Math.max(0, Math.floor((x - g.origin) / g.cell)));
  const j = Math.min(g.size - 1, Math.max(0, Math.floor((z - g.origin) / g.cell)));
  return [i, j];
}

export function cellCenter(g: NavGrid, i: number, j: number): Vec3 {
  return { x: g.origin + (i + 0.5) * g.cell, y: 0, z: g.origin + (j + 0.5) * g.cell };
}

/** A* on 8-connected grid. Returns the list of waypoints (cell centres) from start to goal. */
export function findPath(g: NavGrid, from: Vec3, to: Vec3): Vec3[] {
  const [si, sj] = toCell(g, from.x, from.z);
  const [gi, gj] = toCell(g, to.x, to.z);
  const N = g.size * g.size;
  const start = sj * g.size + si;
  const goal = gj * g.size + gi;
  if (!g.walkable[goal]) return [];
  const gScore = new Float64Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  // simple binary heap of [f, idx]
  const heapF: number[] = [];
  const heapI: number[] = [];
  const push = (f: number, idx: number) => {
    heapF.push(f);
    heapI.push(idx);
    let k = heapF.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heapF[p] <= heapF[k]) break;
      [heapF[p], heapF[k]] = [heapF[k], heapF[p]];
      [heapI[p], heapI[k]] = [heapI[k], heapI[p]];
      k = p;
    }
  };
  const pop = (): number => {
    const top = heapI[0];
    const lastF = heapF.pop()!;
    const lastI = heapI.pop()!;
    if (heapF.length > 0) {
      heapF[0] = lastF;
      heapI[0] = lastI;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < heapF.length && heapF[l] < heapF[m]) m = l;
        if (r < heapF.length && heapF[r] < heapF[m]) m = r;
        if (m === k) break;
        [heapF[m], heapF[k]] = [heapF[k], heapF[m]];
        [heapI[m], heapI[k]] = [heapI[k], heapI[m]];
        k = m;
      }
    }
    return top;
  };
  const h = (i: number, j: number) => Math.hypot(i - gi, j - gj);
  gScore[start] = 0;
  push(h(si, sj), start);
  const dirs = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
  ];
  while (heapI.length > 0) {
    const cur = pop();
    if (cur === goal) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const ci = cur % g.size;
    const cj = (cur - ci) / g.size;
    for (const [di, dj, cost] of dirs) {
      const ni = ci + di;
      const nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= g.size || nj >= g.size) continue;
      const nidx = nj * g.size + ni;
      if (!g.walkable[nidx] || closed[nidx]) continue;
      // avoid corner cutting through blocked cells
      if (di !== 0 && dj !== 0 && (!g.walkable[cj * g.size + ni] || !g.walkable[nj * g.size + ci])) continue;
      const tentative = gScore[cur] + cost;
      if (tentative < gScore[nidx]) {
        gScore[nidx] = tentative;
        came[nidx] = cur;
        push(tentative + h(ni, nj), nidx);
      }
    }
  }
  if (came[goal] === -1 && goal !== start) return [];
  const path: Vec3[] = [];
  let c = goal;
  while (c !== -1 && c !== start) {
    const i = c % g.size;
    const j = (c - i) / g.size;
    path.push(cellCenter(g, i, j));
    c = came[c];
  }
  path.reverse();
  return path;
}

/** Max distance a bot can cover in one frame at run speed (used by tests / tuning). */
export const MAX_FRAME_SPEED = MOVE.runSpeed;
