import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Stone } from "@connect6/shared";
import { gridToWorld, CELL_SIZE } from "./BoardGrid";
import { useGameSnapshot, useWinningLine } from "../hooks/useGameStore";
import { useViewState } from "../hooks/useViewStore";
import { useComputeOccluded } from "../hooks/useOcclusion";

const SPHERE_RADIUS = CELL_SIZE * 0.3;
const sphereGeo = new THREE.SphereGeometry(SPHERE_RADIUS, 24, 18);

const blackMat = new THREE.MeshPhysicalMaterial({
  color: "#111827",
  roughness: 0.2,
  metalness: 0.62,
  clearcoat: 0.85,
  clearcoatRoughness: 0.16,
  emissive: "#07111f",
  emissiveIntensity: 0.24,
});
const whiteMat = new THREE.MeshPhysicalMaterial({
  color: "#f8fafc",
  roughness: 0.16,
  metalness: 0.28,
  clearcoat: 1,
  clearcoatRoughness: 0.1,
  emissive: "#dbeafe",
  emissiveIntensity: 0.1,
});
const blackGoldMat = new THREE.MeshPhysicalMaterial({
  color: "#ffd54a",
  roughness: 0.16,
  metalness: 0.88,
  clearcoat: 1,
  emissive: "#ff8c00",
  emissiveIntensity: 0.6,
});
const whiteGoldMat = new THREE.MeshPhysicalMaterial({
  color: "#fff7c2",
  roughness: 0.12,
  metalness: 0.7,
  clearcoat: 1,
  emissive: "#ffd700",
  emissiveIntensity: 0.5,
});

const dummy = new THREE.Object3D();
const HIDDEN_Y = -1000;
const EMPTY_OCCLUDED = new Set<string>();

function hideUnused(ref: THREE.InstancedMesh, from: number, count: number): void {
  dummy.position.set(0, HIDDEN_Y, 0);
  dummy.scale.setScalar(1);
  dummy.updateMatrix();
  for (let i = from; i < count; i++) ref.setMatrixAt(i, dummy.matrix);
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
  const latestRef = useRef<THREE.Mesh>(null);

  const snapshot = useGameSnapshot();
  const liveWinningLine = useWinningLine();
  const winningLine = replayBoard ? [] : liveWinningLine;
  const { transparencyEnabled } = useViewState();
  const computeOccluded = useComputeOccluded();

  const board = replayBoard ?? snapshot.board;
  const maxStones = sizeX * sizeY * sizeZ;
  const maxWin = Math.max(sizeX, sizeY, sizeZ);
  const winSet = useMemo(
    () => new Set(winningLine.map((pos) => `${pos.x},${pos.y},${pos.z}`)),
    [winningLine],
  );
  const occluded = transparencyEnabled && hoverGrid
    ? computeOccluded(hoverGrid, snapshot)
    : EMPTY_OCCLUDED;

  const latestMove = replayBoard ? null : snapshot.moves.at(-1) ?? null;
  const latestWorld = latestMove
    ? gridToWorld(latestMove.x, latestMove.y, latestMove.z, sizeX, sizeY, sizeZ)
    : null;

  // Instance transforms only change when board/view state changes, not every frame.
  useLayoutEffect(() => {
    const black = blackRef.current;
    const white = whiteRef.current;
    const blackGold = blackGoldRef.current;
    const whiteGold = whiteGoldRef.current;
    if (!black || !white || !blackGold || !whiteGold) return;

    let blackCount = 0;
    let whiteCount = 0;
    let blackGoldCount = 0;
    let whiteGoldCount = 0;

    for (let z = 0; z < sizeZ; z++) for (let y = 0; y < sizeY; y++) for (let x = 0; x < sizeX; x++) {
      const stone = board[z * sizeY * sizeX + y * sizeX + x];
      if (stone === Stone.EMPTY || occluded.has(`${x},${y},${z}`)) continue;

      dummy.position.set(...gridToWorld(x, y, z, sizeX, sizeY, sizeZ));
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      const isWinning = winSet.has(`${x},${y},${z}`);

      if (stone === Stone.BLACK) {
        if (isWinning && blackGoldCount < maxWin) blackGold.setMatrixAt(blackGoldCount++, dummy.matrix);
        else black.setMatrixAt(blackCount++, dummy.matrix);
      } else if (isWinning && whiteGoldCount < maxWin) {
        whiteGold.setMatrixAt(whiteGoldCount++, dummy.matrix);
      } else {
        white.setMatrixAt(whiteCount++, dummy.matrix);
      }
    }

    hideUnused(black, blackCount, maxStones);
    hideUnused(white, whiteCount, maxStones);
    hideUnused(blackGold, blackGoldCount, maxWin);
    hideUnused(whiteGold, whiteGoldCount, maxWin);
    black.instanceMatrix.needsUpdate = true;
    white.instanceMatrix.needsUpdate = true;
    blackGold.instanceMatrix.needsUpdate = true;
    whiteGold.instanceMatrix.needsUpdate = true;
  }, [board, maxStones, maxWin, occluded, sizeX, sizeY, sizeZ, winSet]);

  useFrame(({ clock }) => {
    const now = clock.elapsedTime;
    if (winningLine.length > 0) {
      const pulse = 0.4 + Math.sin(now * 3) * 0.2;
      blackGoldMat.emissiveIntensity = pulse + 0.2;
      whiteGoldMat.emissiveIntensity = pulse + 0.1;
    }
    if (latestRef.current) {
      const scale = 1 + Math.sin(now * 3.5) * 0.06;
      latestRef.current.scale.setScalar(scale);
      latestRef.current.rotation.z = now * 0.18;
    }
  });

  return (
    <>
      <instancedMesh ref={blackRef} args={[sphereGeo, blackMat, maxStones]} frustumCulled={false} />
      <instancedMesh ref={whiteRef} args={[sphereGeo, whiteMat, maxStones]} frustumCulled={false} />
      <instancedMesh ref={blackGoldRef} args={[sphereGeo, blackGoldMat, maxWin]} frustumCulled={false} />
      <instancedMesh ref={whiteGoldRef} args={[sphereGeo, whiteGoldMat, maxWin]} frustumCulled={false} />
      {latestWorld && (
        <mesh ref={latestRef} position={latestWorld}>
          <sphereGeometry args={[SPHERE_RADIUS * 1.24, 16, 12]} />
          <meshBasicMaterial
            color="#22d3ee"
            transparent
            opacity={0.72}
            wireframe
            depthTest={false}
          />
        </mesh>
      )}
    </>
  );
}
