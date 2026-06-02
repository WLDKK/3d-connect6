import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CELL_SIZE } from "./BoardGrid";

const SPHERE_RADIUS = CELL_SIZE * 0.3;

interface PreviewStoneProps {
  position: [number, number, number];
  isBlack: boolean;
  /** true = pulsing glow (typed coords), false = static subtle preview (hover) */
  pulsing?: boolean;
}

/**
 * Ghost preview stone.
 * pulsing=true: fluorescent pulse (typed coordinates, not yet placed)
 * pulsing=false: subtle static preview (hover over empty cell)
 */
export function PreviewStone({ position, isBlack, pulsing = true }: PreviewStoneProps) {
  const groupRef = useRef<THREE.Group>(null);
  const glowRef = useRef<THREE.MeshBasicMaterial>(null);
  const coreRef = useRef<THREE.MeshStandardMaterial>(null);

  const baseColor = isBlack ? "#1a1a2e" : "#e0e0e0";
  const glowColor = isBlack ? "#00f0ff" : "#ffffff";

  useFrame(({ clock }) => {
    if (!groupRef.current || !glowRef.current || !coreRef.current) return;
    groupRef.current.position.set(...position);

    if (pulsing) {
      const t = clock.elapsedTime;
      glowRef.current.opacity = 0.15 + Math.sin(t * 3) * 0.1;
      coreRef.current.opacity = 0.35 + Math.sin(t * 3) * 0.1;
      const s = 1.0 + Math.sin(t * 3) * 0.08;
      groupRef.current.children[1].scale.setScalar(s);
    } else {
      // Static hover preview — subtle, no animation
      glowRef.current.opacity = 0.08;
      coreRef.current.opacity = 0.2;
      groupRef.current.children[1].scale.setScalar(1.0);
    }
  });

  return (
    <group ref={groupRef}>
      <mesh>
        <sphereGeometry args={[SPHERE_RADIUS, 24, 16]} />
        <meshStandardMaterial
          ref={coreRef}
          color={baseColor}
          transparent
          opacity={0.2}
          depthWrite={false}
        />
      </mesh>
      <mesh>
        <sphereGeometry args={[SPHERE_RADIUS * 1.5, 24, 16]} />
        <meshBasicMaterial
          ref={glowRef}
          color={glowColor}
          transparent
          opacity={0.08}
          depthWrite={false}
          side={THREE.BackSide}
        />
      </mesh>
    </group>
  );
}
