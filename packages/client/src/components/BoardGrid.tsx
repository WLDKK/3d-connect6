import { useMemo } from "react";
import * as THREE from "three";
import type { Vec3 } from "@connect6/shared";
import { useViewState } from "../hooks/useViewStore";

export const CELL_SIZE = 1.5;

// Right-hand coordinate system: Z up, X left, Y right (depth)
// Grid (x,y,z) -> World: (-x*CELL, y*CELL, z*CELL) centered at origin

interface BoardGridProps {
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  xray?: boolean;
}

/** Connected lattice plus a brighter outer cage for spatial orientation. */
export function BoardGrid({ sizeX, sizeY, sizeZ, xray = false }: BoardGridProps) {
  const { theme } = useViewState();
  const gridColor = theme === "dark" ? "#42637a" : "#728292";
  const frameColor = theme === "dark" ? "#00d9f5" : "#176b87";

  const geometry = useMemo(() => {
    const positions: number[] = [];
    const [xMin] = gridToWorld(sizeX - 1, 0, 0, sizeX, sizeY, sizeZ);
    const [xMax] = gridToWorld(0, 0, 0, sizeX, sizeY, sizeZ);
    const [, yMin] = gridToWorld(0, 0, 0, sizeX, sizeY, sizeZ);
    const [, yMax] = gridToWorld(0, sizeY - 1, 0, sizeX, sizeY, sizeZ);
    const [, , zMin] = gridToWorld(0, 0, 0, sizeX, sizeY, sizeZ);
    const [, , zMax] = gridToWorld(0, 0, sizeZ - 1, sizeX, sizeY, sizeZ);

    for (let z = 0; z < sizeZ; z++) for (let y = 0; y < sizeY; y++) {
      const [, wy, wz] = gridToWorld(0, y, z, sizeX, sizeY, sizeZ);
      positions.push(xMin, wy, wz, xMax, wy, wz);
    }
    for (let z = 0; z < sizeZ; z++) for (let x = 0; x < sizeX; x++) {
      const [wx, , wz] = gridToWorld(x, 0, z, sizeX, sizeY, sizeZ);
      positions.push(wx, yMin, wz, wx, yMax, wz);
    }
    for (let y = 0; y < sizeY; y++) for (let x = 0; x < sizeX; x++) {
      const [wx, wy] = gridToWorld(x, y, 0, sizeX, sizeY, sizeZ);
      positions.push(wx, wy, zMin, wx, wy, zMax);
    }

    const result = new THREE.BufferGeometry();
    result.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    result.computeBoundingSphere();
    return result;
  }, [sizeX, sizeY, sizeZ]);

  const frameGeometry = useMemo(() => {
    const box = new THREE.BoxGeometry(
      sizeX * CELL_SIZE,
      sizeY * CELL_SIZE,
      sizeZ * CELL_SIZE,
    );
    const edges = new THREE.EdgesGeometry(box);
    box.dispose();
    return edges;
  }, [sizeX, sizeY, sizeZ]);

  return (
    <group>
      <lineSegments geometry={geometry}>
        <lineBasicMaterial
          color={gridColor}
          transparent
          opacity={xray ? 0.1 : 0.3}
          depthWrite={false}
        />
      </lineSegments>
      <lineSegments geometry={frameGeometry}>
        <lineBasicMaterial
          color={frameColor}
          transparent
          opacity={xray ? 0.28 : 0.58}
          depthWrite={false}
        />
      </lineSegments>
    </group>
  );
}

/** Grid -> World (right-hand, Z-up, X-left). */
export function gridToWorld(
  x: number, y: number, z: number,
  sizeX: number, sizeY: number, sizeZ: number,
): [number, number, number] {
  return [
    -x * CELL_SIZE + ((sizeX - 1) * CELL_SIZE) / 2,
    y * CELL_SIZE - ((sizeY - 1) * CELL_SIZE) / 2,
    z * CELL_SIZE - ((sizeZ - 1) * CELL_SIZE) / 2,
  ];
}

/** World -> Grid (inverse of gridToWorld). */
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
