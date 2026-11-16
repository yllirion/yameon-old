// Axial coordinates {q, r}, point-top hexes. Facing 0..5 goes clockwise on screen: E, SE, SW, W, NW, NE.
export const DIRS = [
  { q: 1, r: 0 }, { q: 0, r: 1 }, { q: -1, r: 1 },
  { q: -1, r: 0 }, { q: 0, r: -1 }, { q: 1, r: -1 },
];
export const mod6 = (n) => ((n % 6) + 6) % 6;
export const key = (h) => `${h.q},${h.r}`;
export const same = (a, b) => a.q === b.q && a.r === b.r;
export const add = (h, d) => ({ q: h.q + d.q, r: h.r + d.r });
export const neighbor = (h, dir) => add(h, DIRS[mod6(dir)]);
export const neighbors = (h) => DIRS.map((d) => add(h, d));
export const distance = (a, b) => {
  const dq = a.q - b.q, dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
};
export const dirTo = (a, b) => DIRS.findIndex((d) => a.q + d.q === b.q && a.r + d.r === b.r); // -1 if not adjacent
export const offsetToAxial = (col, row) => ({ q: col - (row - (row & 1)) / 2, r: row }); // "odd-r" layout
export const toPixel = (h) => ({ x: Math.sqrt(3) * (h.q + h.r / 2), y: 1.5 * h.r });

function cubeRound(q, r) {
  const x = q, z = r, y = -x - z;
  let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
  const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return { q: rx + 0, r: rz + 0 };
}

// Line of hexes from a to b (inclusive). `nudge` shifts the ray by a hair to resolve edge-grazing lines.
export function line(a, b, nudge = 0) {
  const n = distance(a, b), out = [];
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n;
    out.push(cubeRound(a.q + (b.q - a.q) * t + nudge * 1e-6, a.r + (b.r - a.r) * t + nudge * 2e-6));
  }
  return out;
}
// Both possible lines. "Disputed cases favour the defender" = take the worse one for the attacker.
export const lineVariants = (a, b) => [line(a, b, 1), line(a, b, -1)];

export function inArc(from, facing, target, deg = 120, inclusive = true) {
  if (same(from, target)) return false;
  const a = toPixel(from), b = toPixel(target), f = toPixel(DIRS[mod6(facing)]);
  const vx = b.x - a.x, vy = b.y - a.y;
  const cos = (vx * f.x + vy * f.y) / (Math.hypot(vx, vy) * Math.hypot(f.x, f.y));
  const angle = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
  return angle <= deg / 2 + (inclusive ? 1e-6 : -1e-6);
}
