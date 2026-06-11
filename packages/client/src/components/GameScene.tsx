import { useCallback, useRef, useState } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { MeshBVH, acceleratedRaycast } from "three-mesh-bvh";
import { BoardGrid, CELL_SIZE, gridToWorld, worldToGrid } from "./BoardGrid";
import { Stones } from "./Stones";
import { HoverIndicator } from "./HoverIndicator";
import { AxisLabels } from "./AxisLabels";
import { PreviewStone } from "./PreviewStone";
import { useGameSnapshot } from "../hooks/useGameStore";
import { useViewState } from "../hooks/useViewStore";
import { Player, Stone } from "@connect6/shared";

// Patch THREE prototypes for BVH
THREE.Mesh.prototype.raycast = acceleratedRaycast;
(THREE.BufferGeometry.prototype as any).computeBoundsTree = function (opts?: any) {
  (this as any).boundsTree = new MeshBVH(this, opts);
  return (this as any).boundsTree;
};
(THREE.BufferGeometry.prototype as any).disposeBoundsTree = function () {
  (this as any).boundsTree = null;
};

/**
 * 3D DDA (Digital Differential Analyzer) grid traversal.
 * Steps through every cell the ray passes through, in front-to-back order.
 * Returns the first empty cell hit, or null if none found.
 */
function ddaFindFirstEmpty(
  ray: THREE.Ray,
  sizeX: number, sizeY: number, sizeZ: number,
  board: Uint8Array | number[],
): { x: number; y: number; z: number } | null {
  // Board AABB in world space (matches gridToWorld centering)
  const halfX = ((sizeX - 1) * CELL_SIZE) / 2 + CELL_SIZE / 2;
  const halfY = ((sizeY - 1) * CELL_SIZE) / 2 + CELL_SIZE / 2;
  const halfZ = ((sizeZ - 1) * CELL_SIZE) / 2 + CELL_SIZE / 2;
  const boxMin = new THREE.Vector3(-halfX, -halfY, -halfZ);
  const boxMax = new THREE.Vector3(halfX, halfY, halfZ);

  // Find entry point
  const entry = new THREE.Vector3();
  const entryRay = new THREE.Ray(ray.origin.clone(), ray.direction.clone());
  const hitEntry = entryRay.intersectBox(new THREE.Box3(boxMin, boxMax), entry);
  if (!hitEntry) return null;

  // Find exit point
  const exit = new THREE.Vector3();
  const exitRay = new THREE.Ray(
    ray.origin.clone().addScaledVector(ray.direction, 200),
    ray.direction.clone().negate(),
  );
  const hitExit = exitRay.intersectBox(new THREE.Box3(boxMin, boxMax), exit);
  if (!hitExit) return null;

  // Convert entry point to grid coords
  const g = worldToGrid(entry.x, entry.y, entry.z, sizeX, sizeY, sizeZ);
  if (!g) return null;

  // DDA setup
  const dir = ray.direction;
  const stepX = dir.x > 0 ? 1 : dir.x < 0 ? -1 : 0;
  const stepY = dir.y > 0 ? 1 : dir.y < 0 ? -1 : 0;
  const stepZ = dir.z > 0 ? 1 : dir.z < 0 ? -1 : 0;

  const tDeltaX = stepX !== 0 ? Math.abs(CELL_SIZE / dir.x) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(CELL_SIZE / dir.y) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(CELL_SIZE / dir.z) : Infinity;

  // World position of cell (g.x, g.y, g.z)
  const cellWorld = gridToWorld(g.x, g.y, g.z, sizeX, sizeY, sizeZ);

  // Distance to next cell boundary
  let tMaxX = stepX > 0
    ? (cellWorld[0] + CELL_SIZE / 2 - entry.x) / dir.x
    : stepX < 0
      ? (cellWorld[0] - CELL_SIZE / 2 - entry.x) / dir.x
      : Infinity;
  let tMaxY = stepY > 0
    ? (cellWorld[1] + CELL_SIZE / 2 - entry.y) / dir.y
    : stepY < 0
      ? (cellWorld[1] - CELL_SIZE / 2 - entry.y) / dir.y
      : Infinity;
  let tMaxZ = stepZ > 0
    ? (cellWorld[2] + CELL_SIZE / 2 - entry.z) / dir.z
    : stepZ < 0
      ? (cellWorld[2] - CELL_SIZE / 2 - entry.z) / dir.z
      : Infinity;

  // Clamp negative tMax (ray origin inside cell)
  if (tMaxX < 0) tMaxX = 0;
  if (tMaxY < 0) tMaxY = 0;
  if (tMaxZ < 0) tMaxZ = 0;

  // Total ray length through the board
  const totalT = entry.distanceTo(exit);

  let cx = g.x, cy = g.y, cz = g.z;

  // Check up to 300 cells (more than enough for 10x10x10 diagonal)
  for (let i = 0; i < 300; i++) {
    // Bounds check
    if (cx >= 0 && cx < sizeX && cy >= 0 && cy < sizeY && cz >= 0 && cz < sizeZ) {
      const idx = cz * sizeY * sizeX + cy * sizeX + cx;
      if (board[idx] === Stone.EMPTY) {
        return { x: cx, y: cy, z: cz };
      }
    }

    // Step to next cell boundary
    if (tMaxX < tMaxY) {
      if (tMaxX < tMaxZ) {
        if (tMaxX > totalT) break;
        cx += stepX;
        tMaxX += tDeltaX;
      } else {
        if (tMaxZ > totalT) break;
        cz += stepZ;
        tMaxZ += tDeltaZ;
      }
    } else {
      if (tMaxY < tMaxZ) {
        if (tMaxY > totalT) break;
        cy += stepY;
        tMaxY += tDeltaY;
      } else {
        if (tMaxZ > totalT) break;
        cz += stepZ;
        tMaxZ += tDeltaZ;
      }
    }
  }

  return null;
}

/**
 * Invisible box covering the board volume.
 * On pointer events, uses DDA to find the nearest empty cell.
 */
function BoardHitTarget({
  sizeX, sizeY, sizeZ, snapshot, onHover,
}: {
  sizeX: number; sizeY: number; sizeZ: number;
  snapshot: { board: number[]; config: { sizeX: number; sizeY: number; sizeZ: number } };
  onHover: (pos: [number, number, number] | null, grid: { x: number; y: number; z: number } | null) => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const camera = useThree((s) => s.camera);
  const lastGridRef = useRef<{ x: number; y: number; z: number } | null>(null);

  const geometry = useCallback(() => {
    const geo = new THREE.BoxGeometry(
      sizeX * CELL_SIZE + CELL_SIZE,
      sizeY * CELL_SIZE + CELL_SIZE,
      sizeZ * CELL_SIZE + CELL_SIZE,
    );
    geo.computeBoundsTree();
    return geo;
  }, [sizeX, sizeY, sizeZ])();

  const makeRay = useCallback(
    (worldPoint: THREE.Vector3) => {
      const origin = camera.position.clone();
      const dir = worldPoint.clone().sub(origin).normalize();
      return new THREE.Ray(origin, dir);
    },
    [camera],
  );

  const handlePointerMove = useCallback(
    (e: { point: THREE.Vector3 }) => {
      const ray = makeRay(e.point);
      const grid = ddaFindFirstEmpty(ray, sizeX, sizeY, sizeZ, snapshot.board);
      lastGridRef.current = grid;
      if (grid) {
        onHover(gridToWorld(grid.x, grid.y, grid.z, sizeX, sizeY, sizeZ), grid);
      } else {
        onHover(null, null);
      }
    },
    [makeRay, sizeX, sizeY, sizeZ, snapshot.board, onHover],
  );

  const handlePointerOut = useCallback(() => {
    lastGridRef.current = null;
    onHover(null, null);
  }, [onHover]);

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      onPointerMove={handlePointerMove}
      onPointerOut={handlePointerOut}
    >
      <meshBasicMaterial visible={false} />
    </mesh>
  );
}

/**
 * Main game scene — right-hand coordinate system, Z up.
 */
export function GameScene({ previewCoords, replayBoard }: {
  previewCoords: { x: number; y: number; z: number } | null;
  replayBoard?: number[] | null;
}) {
  const snapshot = useGameSnapshot();
  const { transparencyEnabled } = useViewState();
  const [hoverPos, setHoverPos] = useState<[number, number, number] | null>(null);
  const [hoverGrid, setHoverGrid] = useState<{ x: number; y: number; z: number } | null>(null);

  const { sizeX, sizeY, sizeZ } = snapshot.config;

  const handleHover = useCallback(
    (pos: [number, number, number] | null, grid: { x: number; y: number; z: number } | null) => {
      setHoverPos(pos);
      setHoverGrid(grid);
    },
    [],
  );

  // Preview position: typed coords take priority, otherwise show hover preview
  const previewPos = previewCoords
    ? gridToWorld(previewCoords.x, previewCoords.y, previewCoords.z, sizeX, sizeY, sizeZ)
    : hoverGrid
      ? gridToWorld(hoverGrid.x, hoverGrid.y, hoverGrid.z, sizeX, sizeY, sizeZ)
      : null;

  const isPreviewFromHover = !previewCoords && hoverGrid !== null;

  return (
    <group>
      {/* Three-point lighting setup for dramatic 3D look */}
      <ambientLight intensity={0.35} />
      <directionalLight position={[12, 8, 18]} intensity={1.0} castShadow color="#fffaf0" />
      <directionalLight position={[-8, -6, 10]} intensity={0.3} color="#8090ff" />
      <pointLight position={[0, 0, 20]} intensity={0.5} color="#4a90d9" distance={50} />
      <pointLight position={[-12, -12, 5]} intensity={0.3} color="#7b61ff" distance={40} />

      {!transparencyEnabled && <BoardGrid sizeX={sizeX} sizeY={sizeY} sizeZ={sizeZ} />}
      <Stones sizeX={sizeX} sizeY={sizeY} sizeZ={sizeZ} hoverGrid={hoverGrid} replayBoard={replayBoard} />

      <BoardHitTarget
        sizeX={sizeX} sizeY={sizeY} sizeZ={sizeZ}
        snapshot={snapshot}
        onHover={handleHover}
      />

      <HoverIndicator position={hoverPos} />
      {previewPos && (
        <PreviewStone
          position={previewPos}
          isBlack={snapshot.currentPlayer === Player.BLACK}
          pulsing={!isPreviewFromHover}
        />
      )}
      <AxisLabels sizeX={sizeX} sizeY={sizeY} sizeZ={sizeZ} />
    </group>
  );
}
