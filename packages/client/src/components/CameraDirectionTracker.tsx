import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { cameraDir } from "./CoordInput";

const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();

/**
 * Tracks camera orientation every frame and writes the forward/right
 * vectors to the shared `cameraDir` object for keyboard navigation.
 *
 * Forward = direction camera is looking (projected onto XY plane)
 * Right = perpendicular to forward on the XY plane
 */
export function CameraDirectionTracker() {
  const camera = useThree((s) => s.camera);

  useFrame(() => {
    camera.getWorldDirection(_forward);

    // Project onto XY plane (ignore Z for horizontal movement)
    _forward.z = 0;

    // Guard: if camera looks straight down/forward is zero, keep previous values
    if (_forward.lengthSq() < 0.001) return;

    _forward.normalize();
    _right.set(-_forward.y, _forward.x, 0);
    _right.normalize();

    cameraDir.forward.x = _forward.x;
    cameraDir.forward.y = _forward.y;
    cameraDir.right.x = _right.x;
    cameraDir.right.y = _right.y;
  });

  return null;
}
