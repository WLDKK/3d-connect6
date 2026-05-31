import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

interface HoverIndicatorProps {
  position: [number, number, number] | null;
}

const GLOW_COLOR = new THREE.Color("#00f0ff");

/**
 * Renders a glowing crosshair at the hovered grid cell.
 * Pulses gently with time.
 */
export function HoverIndicator({ position }: HoverIndicatorProps) {
  const groupRef = useRef<THREE.Group>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);

  useFrame(({ clock }) => {
    if (!groupRef.current || !matRef.current) return;
    if (!position) {
      groupRef.current.visible = false;
      return;
    }
    groupRef.current.visible = true;
    groupRef.current.position.set(...position);
    // Pulse opacity
    matRef.current.opacity = 0.3 + Math.sin(clock.elapsedTime * 4) * 0.15;
  });

  const armLen = 0.65;
  const armThick = 0.02;

  return (
    <group ref={groupRef}>
      {/* 3 axis arms of the crosshair */}
      {/* X arm */}
      <mesh>
        <boxGeometry args={[armLen * 2, armThick, armThick]} />
        <meshBasicMaterial ref={matRef} color={GLOW_COLOR} transparent opacity={0.4} />
      </mesh>
      {/* Y arm */}
      <mesh>
        <boxGeometry args={[armThick, armLen * 2, armThick]} />
        <meshBasicMaterial color={GLOW_COLOR} transparent opacity={0.4} />
      </mesh>
      {/* Z arm */}
      <mesh>
        <boxGeometry args={[armThick, armThick, armLen * 2]} />
        <meshBasicMaterial color={GLOW_COLOR} transparent opacity={0.4} />
      </mesh>
      {/* Center sphere */}
      <mesh>
        <sphereGeometry args={[0.09, 12, 8]} />
        <meshBasicMaterial color={GLOW_COLOR} transparent opacity={0.8} />
      </mesh>
    </group>
  );
}
