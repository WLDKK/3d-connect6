import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

interface HoverIndicatorProps {
  position: [number, number, number] | null;
}

const GLOW_COLOR = new THREE.Color("#00f0ff");
const armLen = 0.65;
const armThick = 0.02;

/**
 * Glowing crosshair at the hovered grid cell.
 * All three arms pulse together.
 */
export function HoverIndicator({ position }: HoverIndicatorProps) {
  const groupRef = useRef<THREE.Group>(null);
  const xMat = useRef<THREE.MeshBasicMaterial>(null);
  const yMat = useRef<THREE.MeshBasicMaterial>(null);
  const zMat = useRef<THREE.MeshBasicMaterial>(null);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    if (!position) {
      groupRef.current.visible = false;
      return;
    }
    groupRef.current.visible = true;
    groupRef.current.position.set(...position);
    const opacity = 0.3 + Math.sin(clock.elapsedTime * 4) * 0.15;
    if (xMat.current) xMat.current.opacity = opacity;
    if (yMat.current) yMat.current.opacity = opacity;
    if (zMat.current) zMat.current.opacity = opacity;
  });

  return (
    <group ref={groupRef}>
      {/* X arm */}
      <mesh>
        <boxGeometry args={[armLen * 2, armThick, armThick]} />
        <meshBasicMaterial ref={xMat} color={GLOW_COLOR} transparent opacity={0.4} />
      </mesh>
      {/* Y arm */}
      <mesh>
        <boxGeometry args={[armThick, armLen * 2, armThick]} />
        <meshBasicMaterial ref={yMat} color={GLOW_COLOR} transparent opacity={0.4} />
      </mesh>
      {/* Z arm */}
      <mesh>
        <boxGeometry args={[armThick, armThick, armLen * 2]} />
        <meshBasicMaterial ref={zMat} color={GLOW_COLOR} transparent opacity={0.4} />
      </mesh>
      {/* Center sphere */}
      <mesh>
        <sphereGeometry args={[0.09, 12, 8]} />
        <meshBasicMaterial color={GLOW_COLOR} transparent opacity={0.8} />
      </mesh>
    </group>
  );
}
