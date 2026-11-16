// A spring is two numbers: a perceptual duration and a bounce, turned into
// stiffness `k` and damping `c` for a unit mass. Unlike a timed transition it
// has no fixed length and no fixed start: retarget it mid-flight and it carries
// on from the position and velocity it has, so nothing ever jumps.

export interface Spring {
  x: number;
  v: number;
  to: number;
  k: number;
  c: number;
}

export function tune<S extends Spring>(s: S, duration: number, bounce: number): S {
  const w = (2 * Math.PI) / duration;
  s.k = w * w;
  s.c = 2 * (1 - bounce) * w;
  return s;
}

export const spring = (x: number, duration: number, bounce: number): Spring =>
  tune({ x, v: 0, to: x, k: 0, c: 0 }, duration, bounce);

// Sub-steps keep a long frame from blowing up a stiff spring.
export function step(s: Spring, dt: number): void {
  const n = Math.ceil(dt / 0.004);
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    s.v += (-s.k * (s.x - s.to) - s.c * s.v) * h;
    s.x += s.v * h;
  }
}

export const settled = (s: Spring, dx: number, dv: number): boolean =>
  Math.abs(s.x - s.to) < dx && Math.abs(s.v) < dv;

export function snap(s: Spring): void {
  s.x = s.to;
  s.v = 0;
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
