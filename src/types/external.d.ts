declare module "gif-encoder-2" {
  class GIFEncoder {
    constructor(
      width: number,
      height: number,
      algorithm?: "neuquant" | "octree",
      useOptimizer?: boolean,
      totalFrames?: number
    );

    out: {
      getData(): Buffer;
    };

    start(): void;
    setRepeat(repeat: number): void;
    setDelay(delayMs: number): void;
    setQuality(quality: number): void;
    addFrame(input: Uint8Array | Buffer): void;
    finish(): void;
  }

  export = GIFEncoder;
}

declare module "pngjs" {
  export const PNG: {
    sync: {
      read(buffer: Buffer): {
        data: Buffer;
      };
    };
  };
}
