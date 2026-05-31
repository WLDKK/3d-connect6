import { useMemo } from "react";
import { Billboard, Text } from "@react-three/drei";
import { CELL_SIZE, gridToWorld } from "./BoardGrid";
import { useViewState } from "../hooks/useViewStore";

interface AxisLabelsProps {
  sizeX: number;
  sizeY: number;
  sizeZ: number;
}

const TICK_SIZE = CELL_SIZE * 0.2;
const AXIS_SIZE = CELL_SIZE * 0.35;

/**
 * Right-hand Cartesian axes. Z up, X right, Y back.
 * Origin = board corner = grid(sizeX-1, 0, 0) where X=0,Y=0,Z=0 meet.
 * X axis: rightward → X=9 at grid(0,0,0), label at right end
 * Y axis: backward → Y=9 at grid(sizeX-1,sizeY-1,0), label at far end
 * Z axis: upward → Z=9 at grid(sizeX-1,0,sizeZ-1), label at top
 */
export function AxisLabels({ sizeX, sizeY, sizeZ }: AxisLabelsProps) {
  const { theme } = useViewState();
  const isDark = theme === "dark";

  const tipGap = CELL_SIZE * 1.5;
  const tickGap = CELL_SIZE * 0.6;

  // Theme-aware colors
  const xColor = isDark ? "#ff4444" : "#991111";
  const yColor = isDark ? "#44ff44" : "#116611";
  const zColor = isDark ? "#4488ff" : "#113399";

  // Origin: where X=0, Y=0, Z=0 meet = board corner
  const origin = gridToWorld(sizeX - 1, 0, 0, sizeX, sizeY, sizeZ);
  const ox = origin[0] - tickGap;
  const oy = origin[1] + tickGap - CELL_SIZE;
  const oz = origin[2] - tickGap;

  const ticks = useMemo(() => {
    const result: { pos: [number, number, number]; text: string; color: string }[] = [];

    // X ticks — rightward from origin: grid x = sizeX-1 → 0
    for (let i = 0; i < sizeX; i++) {
      const [wx] = gridToWorld(sizeX - 1 - i, 0, 0, sizeX, sizeY, sizeZ);
      result.push({ pos: [wx, oy, oz], text: String(i), color: xColor });
    }

    // Y ticks — away from camera: grid y = 0 → sizeY-1
    for (let i = 0; i < sizeY; i++) {
      const [, wy] = gridToWorld(sizeX - 1, i, 0, sizeX, sizeY, sizeZ);
      result.push({ pos: [ox, wy, oz], text: String(i), color: yColor });
    }

    // Z ticks — upward from origin: grid z = 0 → sizeZ-1
    for (let i = 0; i < sizeZ; i++) {
      const [, , wz] = gridToWorld(sizeX - 1, 0, i, sizeX, sizeY, sizeZ);
      result.push({ pos: [ox, oy, wz], text: String(i), color: zColor });
    }

    return result;
  }, [sizeX, sizeY, sizeZ, ox, oy, oz]);

  const axisTips = useMemo(() => {
    const halfX = (sizeX - 1) * CELL_SIZE / 2;
    const halfY = (sizeY - 1) * CELL_SIZE / 2;
    const halfZ = (sizeZ - 1) * CELL_SIZE / 2;
    return [
      { pos: [halfX + tipGap, oy, oz] as [number, number, number], text: "X", color: xColor },
      { pos: [ox, halfY + tipGap, oz] as [number, number, number], text: "Y", color: yColor },
      { pos: [ox, oy, halfZ + tipGap] as [number, number, number], text: "Z", color: zColor },
    ];
  }, [sizeX, sizeY, sizeZ, ox, oy, oz, tipGap]);

  return (
    <group>
      {ticks.map((t, i) => (
        <Billboard key={i} position={t.pos} follow lockX={false} lockY={false} lockZ={false}>
          <Text fontSize={TICK_SIZE} color={t.color}
            anchorX="center" anchorY="middle" fillOpacity={0.7}>
            {t.text}
          </Text>
        </Billboard>
      ))}
      {axisTips.map((a, i) => (
        <Billboard key={`t${i}`} position={a.pos} follow lockX={false} lockY={false} lockZ={false}>
          <Text fontSize={AXIS_SIZE} color={a.color}
            anchorX="center" anchorY="middle" fontWeight="bold">
            {a.text}
          </Text>
        </Billboard>
      ))}
    </group>
  );
}
