export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (const c of Buffer.from(String(str), 'utf8')) {
    h ^= c; h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
export function mulberry32(a) {
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
