// 순수 3D 벡터 수학. 좌표는 전부 [x, y, z] 배열, 길이 Å, 각도 degree.
const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const norm = (a) => Math.sqrt(dot(a, a));
export const unit = (a) => {
  const n = norm(a);
  return n === 0 ? [0, 0, 0] : scale(a, 1 / n);
};
export const distance = (a, b) => norm(sub(a, b));

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export function angleDeg(a, b, c) {
  const u = sub(a, b), v = sub(c, b);
  const d = norm(u) * norm(v);
  if (d === 0) return 0;
  return Math.acos(clamp(dot(u, v) / d, -1, 1)) * DEG;
}

// IUPAC 부호 규약. a-b-c-d 순서, 결과 -180 ~ 180.
export function dihedralDeg(a, b, c, d) {
  const b1 = sub(b, a), b2 = sub(c, b), b3 = sub(d, c);
  const n1 = cross(b1, b2), n2 = cross(b2, b3);
  const m1 = cross(n1, unit(b2));
  return -Math.atan2(dot(m1, n2), dot(n1, n2)) * DEG;
}

// Rodrigues 회전. axis는 단위벡터가 아니어도 되며 내부에서 정규화한다.
// 오른손 법칙(+deg가 axis 방향에서 볼 때 반시계).
export function rotateAround(p, origin, axis, deg) {
  const u = unit(axis);
  const v = sub(p, origin);
  const t = deg * RAD;
  const c = Math.cos(t), s = Math.sin(t);
  const term = add(
    add(scale(v, c), scale(cross(u, v), s)),
    scale(u, dot(u, v) * (1 - c)),
  );
  return add(origin, term);
}
