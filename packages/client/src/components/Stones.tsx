import { useRef, useLayoutEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Stone, type Vec3 } from "@connect6/shared";
import { gridToWorld, CELL_SIZE } from "./BoardGrid";
import { useGameSnapshot, useWinningLine } from "../hooks/useGameStore";
import { useViewState } from "../hooks/useViewStore";
import { useComputeOccluded } from "../hooks/useOcclusion";

const SPHERE_RADIUS = CELL_SIZE * 0.3;

const sphereGeo = new THREE.SphereGeometry(SPHERE_RADIUS, 24, 16);

// Normal materials
const blackMat = new THREE.MeshStandardMaterial({
  color: "#1a1a2e", roughness: 0.3, metalness: 0.8,
  emissive: "#0f0f23", emissiveIntensity: 0.2,
});
const whiteMat = new THREE.MeshStandardMaterial({
  color: "#e0e0e0", roughness: 0.2, metalness: 0.6,
  emissive: "#ffffff", emissiveIntensity: 0.1,
});

// Gold materials for winning stones
const blackGoldMat = new THREE.MeshStandardMaterial({
  color: "#ffd700", roughness: 0.2, metalness: 0.9,
  emissive: "#ff8c00", emissiveIntensity: 0.6,
});
const whiteGoldMat = new THREE.MeshStandardMaterial({
  color: "#fffacd", roughness: 0.15, metalness: 0.8,
  emissive: "#ffd700", emissiveIntensity: 0.5,
});

const dummy = new THREE.Object3D();
const HIDDEN_Y = -1000;

function hideAll(ref: THREE.InstancedMesh | null, count: number) {
  if (!ref) return;
  dummy.position.set(0, HIDDEN_Y, 0);
  dummy.scale.setScalar(1);
  dummy.updateMatrix();
  for (let i = 0; i < count; i++) ref.setMatrixAt(i, dummy.matrix);
  ref.instanceMatrix.needsUpdate = true;
}

interface StonesProps {
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  hoverGrid: { x: number; y: number; z: number } | null;
  replayBoard?: number[] | null;
}

export function Stones({ sizeX, sizeY, sizeZ, hoverGrid, replayBoard }: StonesProps) {
  const blackRef = useRef<THREE.InstancedMesh>(null);
  const whiteRef = useRef<THREE.InstancedMesh>(null);
  const blackGoldRef = useRef<THREE.InstancedMesh>(null);
  const whiteGoldRef = useRef<THREE.InstancedMesh>(null);

  const snapshot = useGameSnapshot();
  const liveWinningLine = useWinningLine();
  const winningLine = replayBoard ? [] : liveWinningLine;
  const { transparencyEnabled } = useViewState();
  const computeOccluded = useComputeOccluded();

  const maxStones = sizeX * sizeY * sizeZ;
  const maxWin = 6;

  const winSet = new Set<string>();
  for (const p of winningLine) winSet.add(`${p.x},${p.y},${p.z}`);

  useLayoutEffect(() => {
    hideAll(blackRef.current, maxStones);
    hideAll(whiteRef.current, maxStones);
    hideAll(blackGoldRef.current, maxWin);
    hideAll(whiteGoldRef.current, maxWin);
  }, [maxStones, maxWin]);

  // Cache occlusion
  const lastHoverRef = useRef<{ x: number; y: number; z: number } | null>(null);
  const occludedRef = useRef(new Set<string>());
  if (hoverGrid !== lastHoverRef.current) {
    lastHoverRef.current = hoverGrid;
    occludedRef.current = transparencyEnabled && hoverGrid
      ? computeOccluded(hoverGrid, snapshot)
      : new Set<string>();
  }
  const occluded = occludedRef.current;

  // Track board changes to only update instances when needed
  const prevBoardKey = useRef("");

  useFrame(({ clock }) => {
    const bRef = blackRef.current;
    const wRef = whiteRef.current;
    const bgRef = blackGoldRef.current;
    const wgRef = whiteGoldRef.current;
    if (!bRef || !wRef || !bgRef || !wgRef) return;

    const config = snapshot.config;
    const board = replayBoard ?? snapshot.board;
    const sx = config.sizeX, sy = config.sizeY, sz = config.sizeZ;

    // Build a quick hash to skip redundant updates
    const boardKey = `${board.length}:${board[0]}:${board[board.length - 1]}:${winningLine.length}:${occluded.size}`;
    const now = clock.elapsedTime;
    const goldNeedsUpdate = winningLine.length > 0;

    let bN = 0, wN = 0, bgN = 0, wgN = 0;

    for (let z = 0; z < sz; z++) {
      for (let y = 0; y < sy; y++) {
        for (let x = 0; x < sx; x++) {
          const stone = board[z * sy * sx + y * sx + x];
          if (stone === Stone.EMPTY) continue;
          if (occluded.has(`${x},${y},${z}`)) continue;

          const [wx, wy, wz] = gridToWorld(x, y, z, sx, sy, sz);
          dummy.position.set(wx, wy, wz);
          dummy.scale.setScalar(1);
          dummy.updateMatrix();

          const isWin = winSet.has(`${x},${y},${z}`);

          if (stone === Stone.BLACK) {
            if (isWin && bgN < maxWin) {
              bgRef.setMatrixAt(bgN++, dummy.matrix);
            } else {
              bRef.setMatrixAt(bN++, dummy.matrix);
            }
          } else {
            if (isWin && wgN < maxWin) {
              wgRef.setMatrixAt(wgN++, dummy.matrix);
            } else {
              wRef.setMatrixAt(wN++, dummy.matrix);
            }
          }
        }
      }
    }

    // Hide unused instances
    dummy.position.set(0, HIDDEN_Y, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    for (let i = bN; i < maxStones; i++) bRef.setMatrixAt(i, dummy.matrix);
    for (let i = wN; i < maxStones; i++) wRef.setMatrixAt(i, dummy.matrix);
    for (let i = bgN; i < maxWin; i++) bgRef.setMatrixAt(i, dummy.matrix);
    for (let i = wgN; i < maxWin; i++) wgRef.setMatrixAt(i, dummy.matrix);

    bRef.instanceMatrix.needsUpdate = true;
    wRef.instanceMatrix.needsUpdate = true;
    bgRef.instanceMatrix.needsUpdate = true;
    wgRef.instanceMatrix.needsUpdate = true;

    // Pulse gold materials emissive intensity
    if (goldNeedsUpdate && (bgN > 0 || wgN > 0)) {
      const pulse = 0.4 + Math.sin(now * 3) * 0.2;
      blackGoldMat.emissiveIntensity = pulse + 0.2;
      whiteGoldMat.emissiveIntensity = pulse + 0.1;
    }
  });

  return (
    <>
      <instancedMesh ref={blackRef} args={[sphereGeo, blackMat, maxStones]} frustumCulled={false} />
      <instancedMesh ref={whiteRef} args={[sphereGeo, whiteMat, maxStones]} frustumCulled={false} />
      <instancedMesh ref={blackGoldRef} args={[sphereGeo, blackGoldMat, maxWin]} frustumCulled={false} />
      <instancedMesh ref={whiteGoldRef} args={[sphereGeo, whiteGoldMat, maxWin]} frustumCulled={false} />
    </>
  );
}
