import { useRef, useLayoutEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Stone } from "@connect6/shared";
import { gridToWorld, CELL_SIZE } from "./BoardGrid";
import { useGameSnapshot } from "../hooks/useGameStore";
import { useViewState } from "../hooks/useViewStore";
import { useComputeOccluded } from "../hooks/useOcclusion";

const SPHERE_RADIUS = CELL_SIZE * 0.3;

const sphereGeo = new THREE.SphereGeometry(SPHERE_RADIUS, 24, 16);

const blackMat = new THREE.MeshStandardMaterial({
  color: "#1a1a2e", roughness: 0.3, metalness: 0.8,
  emissive: "#0f0f23", emissiveIntensity: 0.2,
});
const whiteMat = new THREE.MeshStandardMaterial({
  color: "#e0e0e0", roughness: 0.2, metalness: 0.6,
  emissive: "#ffffff", emissiveIntensity: 0.1,
});

const dummy = new THREE.Object3D();
const HIDDEN_Y = -1000;

function hideAll(ref: THREE.InstancedMesh | null, count: number) {
  if (!ref) return;
  dummy.position.set(0, HIDDEN_Y, 0);
  dummy.updateMatrix();
  for (let i = 0; i < count; i++) ref.setMatrixAt(i, dummy.matrix);
  ref.instanceMatrix.needsUpdate = true;
}

interface StonesProps {
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  hoverGrid: { x: number; y: number; z: number } | null;
}

export function Stones({ sizeX, sizeY, sizeZ, hoverGrid }: StonesProps) {
  const blackRef = useRef<THREE.InstancedMesh>(null);
  const whiteRef = useRef<THREE.InstancedMesh>(null);

  const snapshot = useGameSnapshot();
  const { transparencyEnabled } = useViewState();
  const computeOccluded = useComputeOccluded();

  const maxStones = sizeX * sizeY * sizeZ;

  useLayoutEffect(() => {
    hideAll(blackRef.current, maxStones);
    hideAll(whiteRef.current, maxStones);
  }, [maxStones]);

  // Cache occlusion — only recompute when hoverGrid changes
  const lastHoverRef = useRef<{ x: number; y: number; z: number } | null>(null);
  const occludedRef = useRef(new Set<string>());
  if (hoverGrid !== lastHoverRef.current) {
    lastHoverRef.current = hoverGrid;
    occludedRef.current = transparencyEnabled && hoverGrid
      ? computeOccluded(hoverGrid, snapshot)
      : new Set<string>();
  }
  const occluded = occludedRef.current;

  useFrame(() => {
    const bRef = blackRef.current;
    const wRef = whiteRef.current;
    if (!bRef || !wRef) return;

    let bN = 0, wN = 0;
    const { board, config } = snapshot;
    const sx = config.sizeX, sy = config.sizeY, sz = config.sizeZ;

    for (let z = 0; z < sz; z++) {
      for (let y = 0; y < sy; y++) {
        for (let x = 0; x < sx; x++) {
          const stone = board[z * sy * sx + y * sx + x];
          if (stone === Stone.EMPTY) continue;

          if (occluded.has(`${x},${y},${z}`)) continue;

          const [wx, wy, wz] = gridToWorld(x, y, z, sx, sy, sz);
          dummy.position.set(wx, wy, wz);
          dummy.updateMatrix();

          if (stone === Stone.BLACK) {
            bRef.setMatrixAt(bN++, dummy.matrix);
          } else {
            wRef.setMatrixAt(wN++, dummy.matrix);
          }
        }
      }
    }

    dummy.position.set(0, HIDDEN_Y, 0);
    dummy.updateMatrix();
    for (let i = bN; i < maxStones; i++) bRef.setMatrixAt(i, dummy.matrix);
    for (let i = wN; i < maxStones; i++) wRef.setMatrixAt(i, dummy.matrix);

    bRef.instanceMatrix.needsUpdate = true;
    wRef.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <instancedMesh ref={blackRef} args={[sphereGeo, blackMat, maxStones]} frustumCulled={false} />
      <instancedMesh ref={whiteRef} args={[sphereGeo, whiteMat, maxStones]} frustumCulled={false} />
    </>
  );
}
