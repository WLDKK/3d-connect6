import { useCallback, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { SerializedState } from "@connect6/shared";
import { Stone } from "@connect6/shared";
import { gridToWorld, CELL_SIZE } from "../components/BoardGrid";

const _ray = new THREE.Ray();
const _vec = new THREE.Vector3();

/**
 * Given a hover grid position, returns the set of stone coordinates
 * that occlude the hover point from the camera's perspective.
 * Uses a simple ray-step through the 3D grid.
 */
export function useComputeOccluded() {
  const camera = useThree((s) => s.camera);
  const prevHoverRef = useRef<{ x: number; y: number; z: number } | null>(null);
  const prevResultRef = useRef<Set<string>>(new Set());

  return useCallback(
    (hoverGrid: { x: number; y: number; z: number } | null, snapshot: SerializedState): Set<string> => {
      if (!hoverGrid) {
        prevHoverRef.current = null;
        prevResultRef.current = new Set();
        return prevResultRef.current;
      }

      // Skip recompute if hover hasn't changed
      if (
        prevHoverRef.current &&
        prevHoverRef.current.x === hoverGrid.x &&
        prevHoverRef.current.y === hoverGrid.y &&
        prevHoverRef.current.z === hoverGrid.z
      ) {
        return prevResultRef.current;
      }
      prevHoverRef.current = hoverGrid;

      const { sizeX, sizeY, sizeZ } = snapshot.config;
      const board = snapshot.board;

      // World position of the hover target
      const [hwx, hwy, hwz] = gridToWorld(hoverGrid.x, hoverGrid.y, hoverGrid.z, sizeX, sizeY, sizeZ);

      // Ray from camera to hover point
      _ray.origin.copy(camera.position);
      _ray.direction.set(hwx, hwy, hwz).sub(camera.position).normalize();

      const occluded = new Set<string>();

      // Step along the ray in small increments and check grid cells
      const totalDist = _ray.origin.distanceTo(_vec.set(hwx, hwy, hwz));
      const step = CELL_SIZE * 0.3; // smaller than cell size
      const tempPoint = new THREE.Vector3();

      for (let d = step; d < totalDist - step; d += step) {
        tempPoint.copy(_ray.origin).addScaledVector(_ray.direction, d);

        // Convert to grid coordinates (matching BoardGrid.worldToGrid)
        const gx = Math.round((tempPoint.x - ((sizeX - 1) * CELL_SIZE) / 2) / -CELL_SIZE);
        const gy = Math.round((tempPoint.y + ((sizeY - 1) * CELL_SIZE) / 2) / CELL_SIZE);
        const gz = Math.round((tempPoint.z + ((sizeZ - 1) * CELL_SIZE) / 2) / CELL_SIZE);

        // Bounds check
        if (gx < 0 || gx >= sizeX || gy < 0 || gy >= sizeY || gz < 0 || gz >= sizeZ) continue;

        // Skip the hover cell itself
        if (gx === hoverGrid.x && gy === hoverGrid.y && gz === hoverGrid.z) continue;

        const flatIdx = gz * sizeY * sizeX + gy * sizeX + gx;
        if (board[flatIdx] !== Stone.EMPTY) {
          occluded.add(`${gx},${gy},${gz}`);
        }
      }

      prevResultRef.current = occluded;
      return occluded;
    },
    [camera],
  );
}
