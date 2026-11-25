export declare const SOFT_DEFAULTS: { fadeMs: number; lowpassHz: number; repeat: number; gapMs: number };
export declare function soften(wave: Float32Array, rate: number, opts?: Partial<typeof SOFT_DEFAULTS>): Float32Array;
export declare function dbfs(x: Float32Array): number;
