import "three";

declare module "three" {
  interface BufferGeometry {
    computeBoundsTree(options?: Record<string, unknown>): void;
    disposeBoundsTree(): void;
  }
  interface Mesh {
    raycast(
      raycaster: Raycaster,
      intersects: Intersection[],
    ): void;
  }
}
