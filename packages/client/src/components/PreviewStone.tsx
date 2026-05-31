import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CELL_SIZE } from "./BoardGrid";

const SPHERE_RADIUS = CELL_SIZE * 0.3;

interface PreviewStoneProps {
  position: [number, number, number];
  isBlack: boolean;
}

/**
 * Ghost preview stone with pulsing fluorescent outer glow.
 * Shown when valid coordinates are typed but not yet placed.
 */
export function PreviewStone({ position, isBlack }: PreviewStoneProps) {
  const groupRef = useRef<THREE.Group>(null);
  const glowRef = useRef<THREE.MeshBasicMaterial>(null);
  const coreRef = useRef<THREE.MeshStandardMaterial>(null);

  const baseColor = isBlack ? "#aaaaaa" : "#ffffff";
  const glowColor = isBlack ? "#00f0ff" : "#f0f0ff";

  useFrame(({ clock }) => {
    if (!groupRef.current || !glowRef.current || !coreRef.current) return;
    groupRef.current.position.set(...position);
    const t = clock.elapsedTime;
    // Pulse the glow
    glowRef.current.opacity = 0.15 + Math.sin(t * 3) * 0.1;
    // Pulse the core
    coreRef.current.opacity = 0.35 + Math.sin(t * 3) * 0.1;
    // Gentle scale pulse on the glow shell
    const s = 1.0 + Math.sin(t * 3) * 0.08;
    groupRef.current.children[1].scale.setScalar(s);
  });

  return (
    <group ref={groupRef}>
      {/* Inner core — semi-transparent stone */}
      <mesh>
        <sphereGeometry args={[SPHERE_RADIUS, 24, 16]} />
        <meshStandardMaterial
          ref={coreRef}
          color={baseColor}
          transparent
          opacity={0.35}
          depthWrite={false}
        />
      </mesh>
      {/* Outer glow shell */}
      <mesh>
        <sphereGeometry args={[SPHERE_RADIUS * 1.5, 24, 16]} />
        <meshBasicMaterial
          ref={glowRef}
          color={glowColor}
          transparent
          opacity={0.15}
          depthWrite={false}
          side={THREE.BackSide}
        />
      </mesh>
    </group>
  );
}
