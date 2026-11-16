// On-map movement input: the facing is chosen by where the cursor is inside the hex (zones) and/or by clicking one of the
// arrow "petals" around the hex centre. Pure geometry + drawing helpers; the game rules stay in core/.
import { mod6 } from '../core/hex.js';

export const ang = (f) => (f * Math.PI) / 3;                                  // facing 0..5 = 60°·f on screen: E, SE, SW, W, NW, NE
export const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
export const signedTurn = (from, to) => ((mod6(to - from) + 3) % 6) - 3;       // −1 / 0 / +1 for neighbouring facings
export const petalPos = (c, f, S) => ({ x: c.x + Math.cos(ang(f)) * S * 0.56, y: c.y + Math.sin(ang(f)) * S * 0.56 });
// radius of the hex centre that means "no turn" (zones) or "activate jump" on your own hex
export const centerR = (mode, dead, S) => (mode === 'petals' ? 0.25 : Math.max(dead, 0.25)) * S;

// Orientation under the cursor among `all`; `base` = "no turn" (hex centre) when it is allowed. null = nothing selected.
export function pickFacing({ mode, dead, S }, c, mx, my, all, base) {
  const dx = mx - c.x, dy = my - c.y, dist = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
  if (mode === 'petals') {
    for (const f of all) { const p = petalPos(c, f, S); if (Math.hypot(mx - p.x, my - p.y) <= S * 0.29) return f; }
    return all.includes(base) && dist <= S * 0.25 ? base : null;
  }
  if (dist < dead * S) return all.includes(base) ? base : null;
  let g = null, bd = Infinity;
  for (const f of all) { const d = angDiff(a, ang(f)); if (d < bd) { bd = d; g = f; } }
  return g;
}

function hexClip(ctx, c, r) {
  ctx.beginPath();
  for (let k = 0; k < 6; k++) { const a = ((60 * k - 30) * Math.PI) / 180; ctx[k ? 'lineTo' : 'moveTo'](c.x + r * Math.cos(a), c.y + r * Math.sin(a)); }
  ctx.closePath();
}
// blue sectors of the hex, one per allowed facing; the one under the cursor is brighter
export function drawZones(ctx, S, c, p, dead, pt) {
  const f = p.base, offs = p.all.map((x) => { let o = mod6(x - f); if (o > 3) o -= 6; return o; }).sort((a, b) => a - b), n = offs.length, A = offs.map((o) => o * 60);
  ctx.save(); hexClip(ctx, c, S - 1); ctx.clip();
  for (let i = 0; i < n; i++) {
    let lo, hi;
    if (n === 1) { lo = -180; hi = 180; } else {
      lo = i > 0 ? (A[i - 1] + A[i]) / 2 : (A[n - 1] - 360 + A[0]) / 2;
      hi = i < n - 1 ? (A[i] + A[i + 1]) / 2 : (A[n - 1] + A[0] + 360) / 2;
    }
    ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.arc(c.x, c.y, S * 1.3, ((f * 60 + lo) * Math.PI) / 180, ((f * 60 + hi) * Math.PI) / 180); ctx.closePath();
    ctx.fillStyle = `rgba(30,110,220,${mod6(f + offs[i]) === p.g ? 0.38 : 0.1})`; ctx.fill(); ctx.strokeStyle = 'rgba(30,110,220,.6)'; ctx.lineWidth = 1; ctx.stroke();
  }
  if (dead > 0 && p.type !== 'rot') {
    const inDead = pt && Math.hypot(pt.x - c.x, pt.y - c.y) < dead * S;
    ctx.beginPath(); ctx.arc(c.x, c.y, dead * S, 0, 7); ctx.fillStyle = inDead && p.g === f ? 'rgba(255,255,255,.75)' : 'rgba(255,255,255,.35)'; ctx.fill(); ctx.strokeStyle = 'rgba(30,110,220,.6)'; ctx.stroke();
  }
  ctx.restore(); ctx.lineWidth = 1;
}
// arrow circles around the hex; clicking one picks that facing, the dot in the middle = no turn
export function drawPetals(ctx, S, c, p, mode, pt) {
  const pr = S * 0.27;
  if (mode === 'petals' && p.all.includes(p.base)) {
    ctx.beginPath(); ctx.arc(c.x, c.y, S * 0.12, 0, 7);
    ctx.fillStyle = p.g === p.base && pt && Math.hypot(pt.x - c.x, pt.y - c.y) <= S * 0.25 ? '#1e6edc' : 'rgba(20,23,28,.55)'; ctx.fill();
  }
  for (const f of p.all) {
    const o = petalPos(c, f, S), on = p.g === f;
    ctx.beginPath(); ctx.arc(o.x, o.y, pr, 0, 7); ctx.fillStyle = on ? 'rgba(80,160,255,1)' : 'rgba(30,36,46,.92)'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(80,160,255,.9)'; ctx.stroke();
    ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(ang(f)); ctx.beginPath();
    ctx.moveTo(-pr * 0.55, 0); ctx.lineTo(pr * 0.55, 0); ctx.moveTo(pr * 0.12, -pr * 0.42); ctx.lineTo(pr * 0.58, 0); ctx.lineTo(pr * 0.12, pr * 0.42);
    ctx.lineWidth = Math.max(2, pr * 0.2); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = on ? '#0f1216' : '#cfe6ff'; ctx.stroke(); ctx.restore();
  }
  ctx.lineWidth = 1;
}
// translucent mech showing where it will stand and where it will look
export function drawGhost(ctx, S, c, g, alpha, color) {
  const R = S * 0.62;
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(c.x, c.y); ctx.rotate(ang(g));
  ctx.beginPath(); ctx.arc(0, 0, R * 0.9, 0, 7); ctx.fillStyle = color; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(R * 0.85, 0); ctx.lineTo(-R * 0.3, R * 0.5); ctx.lineTo(-R * 0.05, 0); ctx.lineTo(-R * 0.3, -R * 0.5); ctx.closePath(); ctx.fillStyle = '#fff'; ctx.fill();
  ctx.restore();
}
export function drawBadge(ctx, W, H, pt, text, color) {
  ctx.save(); ctx.font = '600 13px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + 14; let x = pt.x + 16, y = pt.y + 18;
  if (x + w > W - 4) x = pt.x - w - 10; if (y + 24 > H - 4) y = pt.y - 32;
  ctx.fillStyle = 'rgba(10,12,15,.92)'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, 24, 5) : ctx.rect(x, y, w, 24); ctx.fill();
  ctx.fillStyle = color; ctx.fillText(text, x + 7, y + 12.5); ctx.restore();
}
export function drawBanner(ctx, W, text, bg) {
  ctx.save(); ctx.font = '700 14px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + 28, x = (W - w) / 2; ctx.fillStyle = bg;
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, 8, w, 28, 14) : ctx.rect(x, 8, w, 28); ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillText(text, W / 2, 22.5); ctx.restore();
}
