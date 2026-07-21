import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { BoardGrid, CELL_SIZE, gridToWorld, worldToGrid } from "./BoardGrid";
import { Stones } from "./Stones";
import { HoverIndicator } from "./HoverIndicator";
import { AxisLabels } from "./AxisLabels";
import { PreviewStone } from "./PreviewStone";
import { useGameSnapshot } from "../hooks/useGameStore";
import { useViewState } from "../hooks/useViewStore";
import { Player, Stone, type Vec3 } from "@connect6/shared";

const DDA_ENTRY = new THREE.Vector3();

/**
 * 3D DDA (Digital Differential Analyzer) grid traversal.
 * Steps through every cell the ray passes through, in front-to-back order.
 * Returns the first empty cell hit, or null if none found.
 */
function ddaFindFirstEmpty(
  ray: THREE.Ray,
  sizeX: number, sizeY: number, sizeZ: number,
  board: Uint8Array | number[],
  boardBox: THREE.Box3,
): { x: number; y: number; z: number } | null {
  const hitEntry = boardBox.containsPoint(ray.origin)
    ? DDA_ENTRY.copy(ray.origin)
    : ray.intersectBox(boardBox, DDA_ENTRY);
  if (!hitEntry) return null;
  DDA_ENTRY.addScaledVector(ray.direction, 1e-7);

  // Convert entry point to grid coords
  const g = worldToGrid(DDA_ENTRY.x, DDA_ENTRY.y, DDA_ENTRY.z, sizeX, sizeY, sizeZ);
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
    ? (cellWorld[0] + CELL_SIZE / 2 - DDA_ENTRY.x) / dir.x
    : stepX < 0
      ? (cellWorld[0] - CELL_SIZE / 2 - DDA_ENTRY.x) / dir.x
      : Infinity;
  let tMaxY = stepY > 0
    ? (cellWorld[1] + CELL_SIZE / 2 - DDA_ENTRY.y) / dir.y
    : stepY < 0
      ? (cellWorld[1] - CELL_SIZE / 2 - DDA_ENTRY.y) / dir.y
      : Infinity;
  let tMaxZ = stepZ > 0
    ? (cellWorld[2] + CELL_SIZE / 2 - DDA_ENTRY.z) / dir.z
    : stepZ < 0
      ? (cellWorld[2] - CELL_SIZE / 2 - DDA_ENTRY.z) / dir.z
      : Infinity;

  // Clamp negative tMax (ray origin inside cell)
  if (tMaxX < 0) tMaxX = 0;
  if (tMaxY < 0) tMaxY = 0;
  if (tMaxZ < 0) tMaxZ = 0;

  let cx = g.x, cy = g.y, cz = g.z;

  for (let i = 0; i < sizeX + sizeY + sizeZ + 3; i++) {
    if (cx < 0 || cx >= sizeX || cy < 0 || cy >= sizeY || cz < 0 || cz >= sizeZ) break;
    const idx = cz * sizeY * sizeX + cy * sizeX + cx;
    if (board[idx] === Stone.EMPTY) {
      return { x: cx, y: cy, z: cz };
    }

    // Crossing an edge/corner advances every tied axis, avoiding phantom cells.
    const nextT = Math.min(tMaxX, tMaxY, tMaxZ);
    if (Math.abs(tMaxX - nextT) < 1e-9) { cx += stepX; tMaxX += tDeltaX; }
    if (Math.abs(tMaxY - nextT) < 1e-9) { cy += stepY; tMaxY += tDeltaY; }
    if (Math.abs(tMaxZ - nextT) < 1e-9) { cz += stepZ; tMaxZ += tDeltaZ; }
  }

  return null;
}

/**
 * Invisible box covering the board volume.
 * On pointer events, uses DDA to find the nearest empty cell.
 */
function BoardHitTarget({
  sizeX, sizeY, sizeZ, snapshot, disabled, onHover, onPlace,
}: {
  sizeX: number; sizeY: number; sizeZ: number;
  snapshot: { board: number[]; config: { sizeX: number; sizeY: number; sizeZ: number } };
  onHover: (grid: Vec3 | null) => void;
  disabled: boolean;
  onPlace: (grid: Vec3) => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const gl = useThree((s) => s.gl);
  const lastGridRef = useRef<Vec3 | null>(null);

  const geometry = useMemo(
    () => new THREE.BoxGeometry(
      sizeX * CELL_SIZE,
      sizeY * CELL_SIZE,
      sizeZ * CELL_SIZE,
    ),
    [sizeX, sizeY, sizeZ],
  );
  const boardBox = useMemo(() => new THREE.Box3(
    new THREE.Vector3(-sizeX * CELL_SIZE / 2, -sizeY * CELL_SIZE / 2, -sizeZ * CELL_SIZE / 2),
    new THREE.Vector3(sizeX * CELL_SIZE / 2, sizeY * CELL_SIZE / 2, sizeZ * CELL_SIZE / 2),
  ), [sizeX, sizeY, sizeZ]);

  useEffect(() => () => {
    gl.domElement.style.cursor = "";
  }, [gl]);

  const handlePointerMove = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      const grid = ddaFindFirstEmpty(event.ray, sizeX, sizeY, sizeZ, snapshot.board, boardBox);
      const previous = lastGridRef.current;
      if (grid && previous && grid.x === previous.x && grid.y === previous.y && grid.z === previous.z) {
        gl.domElement.style.cursor = disabled ? "not-allowed" : "crosshair";
        return;
      }
      if (!grid && !previous) return;
      lastGridRef.current = grid;
      if (grid) {
        gl.domElement.style.cursor = disabled ? "not-allowed" : "crosshair";
        onHover(grid);
      } else {
        gl.domElement.style.cursor = "grab";
        onHover(null);
      }
    },
    [boardBox, disabled, gl, sizeX, sizeY, sizeZ, snapshot.board, onHover],
  );

  const handlePointerOut = useCallback(() => {
    if (!lastGridRef.current) return;
    lastGridRef.current = null;
    gl.domElement.style.cursor = "grab";
    onHover(null);
  }, [gl, onHover]);

  const handleClick = useCallback((event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (disabled || event.delta > 4) return;
    const grid = ddaFindFirstEmpty(event.ray, sizeX, sizeY, sizeZ, snapshot.board, boardBox);
    if (grid) onPlace(grid);
  }, [boardBox, disabled, onPlace, sizeX, sizeY, sizeZ, snapshot.board]);

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      onPointerMove={handlePointerMove}
      onPointerOut={handlePointerOut}
      onClick={handleClick}
    >
      <meshBasicMaterial visible={false} />
    </mesh>
  );
}

/**
 * Main game scene — right-hand coordinate system, Z up.
 */
export function GameScene({ previewCoords, replayBoard, interactionDisabled = false, onPlace }: {
  previewCoords: { x: number; y: number; z: number } | null;
  replayBoard?: number[] | null;
  interactionDisabled?: boolean;
  onPlace: (grid: Vec3) => void;
}) {
  const snapshot = useGameSnapshot();
  const { transparencyEnabled } = useViewState();
  const [hoverGrid, setHoverGrid] = useState<Vec3 | null>(null);

  const { sizeX, sizeY, sizeZ } = snapshot.config;

  const handleHover = useCallback((grid: Vec3 | null) => setHoverGrid(grid), []);
  const hoverPos = hoverGrid
    ? gridToWorld(hoverGrid.x, hoverGrid.y, hoverGrid.z, sizeX, sizeY, sizeZ)
    : null;

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
      <ambientLight intensity={0.28} />
      <hemisphereLight args={["#c7edff", "#101827", 0.55]} />
      <directionalLight position={[12, 8, 18]} intensity={1.25} color="#fffaf0" />
      <directionalLight position={[-8, -6, 10]} intensity={0.42} color="#8090ff" />
      <pointLight position={[0, 0, 20]} intensity={0.62} color="#4a90d9" distance={50} />
      <pointLight position={[-12, -12, 5]} intensity={0.36} color="#7b61ff" distance={40} />

      <BoardGrid sizeX={sizeX} sizeY={sizeY} sizeZ={sizeZ} xray={transparencyEnabled} />
      <Stones sizeX={sizeX} sizeY={sizeY} sizeZ={sizeZ} hoverGrid={hoverGrid} replayBoard={replayBoard} />

      <BoardHitTarget
        sizeX={sizeX} sizeY={sizeY} sizeZ={sizeZ}
        snapshot={snapshot}
        disabled={interactionDisabled}
        onHover={handleHover}
        onPlace={onPlace}
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
