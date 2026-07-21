import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { AdaptiveDpr, OrbitControls } from "@react-three/drei";
import type { Vec3 } from "@connect6/shared";
import { GameScene } from "./GameScene";
import { CameraDirectionTracker } from "./CameraDirectionTracker";

interface GameBoardProps {
  backgroundColor: string;
  previewCoords: Vec3 | null;
  replayBoard: number[] | null;
  interactionDisabled: boolean;
  onPlace: (grid: Vec3) => void;
}

const CAMERA = { position: [18, -18, 16] as [number, number, number], fov: 45, up: [0, 0, 1] as [number, number, number] };
const GL = { antialias: true, alpha: false, powerPreference: "high-performance" as const };
const DPR: [number, number] = [1, 1.75];

export default function GameBoard({
  backgroundColor,
  previewCoords,
  replayBoard,
  interactionDisabled,
  onPlace,
}: GameBoardProps) {
  return (
    <Canvas
      camera={CAMERA}
      gl={GL}
      dpr={DPR}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
    >
      <color attach="background" args={[backgroundColor]} />
      <fog attach="fog" args={[backgroundColor, 40, 80]} />
      <AdaptiveDpr pixelated={false} />
      <Suspense fallback={null}>
        <GameScene
          previewCoords={previewCoords}
          replayBoard={replayBoard}
          interactionDisabled={interactionDisabled}
          onPlace={onPlace}
        />
      </Suspense>
      <CameraDirectionTracker />
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        enablePan={false}
        minDistance={12}
        maxDistance={48}
      />
    </Canvas>
  );
}
