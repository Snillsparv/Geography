// Moving Least Squares affine deformation (Schaefer, McPhail & Warren 2006,
// "Image Deformation Using Moving Least Squares", §2.1).
//
// Given control point pairs {p_i → q_i}, returns a smooth deformation f(v)
// that interpolates every control point exactly (weights → ∞ as v → p_i) and
// degrades gracefully to a global affine far away. We use it to warp each
// hand-drawn region composition so every country lands on its true projected
// centroid while the in-between space deforms smoothly — neighbours stay
// neighbours, nothing tears.
//
// Convention: row vectors. f(v) = (v − p*) · M + q*, where
//   M = (Σ w_i p̂_iᵀ p̂_i)⁻¹ · (Σ w_i p̂_iᵀ q̂_i),  w_i = 1 / |p_i − v|^(2α)

export function mlsAffine(controls, alpha = 1) {
  if (controls.length === 0) throw new Error('mlsAffine: no control points');
  if (controls.length === 1) {
    const [c] = controls;
    const dx = c.q[0] - c.p[0], dy = c.q[1] - c.p[1];
    return v => [v[0] + dx, v[1] + dy];
  }
  return function f(v) {
    let W = 0;
    let psx = 0, psy = 0, qsx = 0, qsy = 0;
    const ws = new Array(controls.length);
    for (let i = 0; i < controls.length; i++) {
      const c = controls[i];
      const dx = v[0] - c.p[0], dy = v[1] - c.p[1];
      const d2 = dx * dx + dy * dy;
      if (d2 < 1e-12) return [c.q[0], c.q[1]];
      const w = 1 / Math.pow(d2, alpha);
      ws[i] = w; W += w;
      psx += w * c.p[0]; psy += w * c.p[1];
      qsx += w * c.q[0]; qsy += w * c.q[1];
    }
    psx /= W; psy /= W; qsx /= W; qsy /= W;

    let a11 = 0, a12 = 0, a22 = 0;
    let b11 = 0, b12 = 0, b21 = 0, b22 = 0;
    for (let i = 0; i < controls.length; i++) {
      const c = controls[i], w = ws[i];
      const px = c.p[0] - psx, py = c.p[1] - psy;
      const qx = c.q[0] - qsx, qy = c.q[1] - qsy;
      a11 += w * px * px; a12 += w * px * py; a22 += w * py * py;
      b11 += w * px * qx; b12 += w * px * qy;
      b21 += w * py * qx; b22 += w * py * qy;
    }
    const det = a11 * a22 - a12 * a12;
    const vx = v[0] - psx, vy = v[1] - psy;
    if (Math.abs(det) < 1e-12) {
      return [qsx + vx, qsy + vy];      // degenerate controls: pure translation
    }
    const i11 = a22 / det, i12 = -a12 / det, i22 = a11 / det;
    const m11 = i11 * b11 + i12 * b21, m12 = i11 * b12 + i12 * b22;
    const m21 = i12 * b11 + i22 * b21, m22 = i12 * b12 + i22 * b22;
    return [qsx + vx * m11 + vy * m21, qsy + vx * m12 + vy * m22];
  };
}
