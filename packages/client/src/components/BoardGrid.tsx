import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { Vec3 } from "@connect6/shared";
import { useViewState } from "../hooks/useViewStore";

export const CELL_SIZE = 1.5;
const HALF = CELL_SIZE / 2;

// Right-hand coordinate system: Z up, X left, Y right (depth)
// Grid (x,y,z) → World: (-x*CELL, y*CELL, z*CELL) centered at origin

interface BoardGridProps {
  sizeX: number;
  sizeY: number;
  sizeZ: number;
}

/**
 * Wireboard grid — renders small dashed cube wireframes at each cell.
 */
export function BoardGrid({ sizeX, sizeY, sizeZ }: BoardGridProps) {
  const lineRef = useRef<THREE.LineSegments>(null);
  const { theme } = useViewState();
  const gridColor = theme === "dark" ? "#3a4a5a" : "#a0aab4";

  const geometry = useMemo(() => {
    const positions: number[] = [];
    const lo = -HALF * 0.42;
    const hi = HALF * 0.42;

    const edges: [number[], number[]][] = [
      [[lo, lo, lo], [hi, lo, lo]], [[hi, lo, lo], [hi, lo, hi]],
      [[hi, lo, hi], [lo, lo, hi]], [[lo, lo, hi], [lo, lo, lo]],
      [[lo, hi, lo], [hi, hi, lo]], [[hi, hi, lo], [hi, hi, hi]],
      [[hi, hi, hi], [lo, hi, hi]], [[lo, hi, hi], [lo, hi, lo]],
      [[lo, lo, lo], [lo, hi, lo]], [[hi, lo, lo], [hi, hi, lo]],
      [[hi, lo, hi], [hi, hi, hi]], [[lo, lo, hi], [lo, hi, hi]],
    ];

    for (let z = 0; z < sizeZ; z++) {
      for (let y = 0; y < sizeY; y++) {
        for (let x = 0; x < sizeX; x++) {
          const [cx, cy, cz] = gridToWorld(x, y, z, sizeX, sizeY, sizeZ);
          for (const [a, b] of edges) {
            positions.push(
              cx + a[0], cy + a[1], cz + a[2],
              cx + b[0], cy + b[1], cz + b[2],
            );
          }
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.computeBoundingSphere();
    // Compute line distances for dashed material
    const count = positions.length / 3;
    const dists = new Float32Array(count);
    for (let i = 0; i < count; i += 2) {
      const ax = positions[i * 3], ay = positions[i * 3 + 1], az = positions[i * 3 + 2];
      const bx = positions[(i + 1) * 3], by = positions[(i + 1) * 3 + 1], bz = positions[(i + 1) * 3 + 2];
      const len = Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2 + (bz - az) ** 2);
      dists[i] = 0;
      dists[i + 1] = len;
    }
    geo.setAttribute("lineDistance", new THREE.Float32BufferAttribute(dists, 1));
    return geo;
  }, [sizeX, sizeY, sizeZ]);

  return (
    <lineSegments ref={lineRef} geometry={geometry}>
      <lineBasicMaterial color={gridColor} transparent opacity={0.5} />
    </lineSegments>
  );
}

/**
 * Grid → World (right-hand, Z-up, X-left)
 */
export function gridToWorld(
  x: number, y: number, z: number,
  sizeX: number, sizeY: number, sizeZ: number,
): [number, number, number] {
  return [
    -x * CELL_SIZE + ((sizeX - 1) * CELL_SIZE) / 2,  // X: left
    y * CELL_SIZE - ((sizeY - 1) * CELL_SIZE) / 2,    // Y: right (depth)
    z * CELL_SIZE - ((sizeZ - 1) * CELL_SIZE) / 2,    // Z: up
  ];
}

/**
 * World → Grid (inverse of gridToWorld)
 */
export function worldToGrid(
  wx: number, wy: number, wz: number,
  sizeX: number, sizeY: number, sizeZ: number,
): Vec3 | null {
  const x = Math.round((wx - ((sizeX - 1) * CELL_SIZE) / 2) / -CELL_SIZE);
  const y = Math.round((wy + ((sizeY - 1) * CELL_SIZE) / 2) / CELL_SIZE);
  const z = Math.round((wz + ((sizeZ - 1) * CELL_SIZE) / 2) / CELL_SIZE);
  if (x < 0 || x >= sizeX || y < 0 || y >= sizeY || z < 0 || z >= sizeZ) return null;
  return { x, y, z };
}
