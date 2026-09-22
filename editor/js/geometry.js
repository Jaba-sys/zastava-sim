// geometry.js — что под точкой: высота опоры, верх блоков, склон пандуса.

import { S } from "./state.js";

// ---------------------------------------------------------------------------
// Геометрия: «что под точкой», верх блоков
// ---------------------------------------------------------------------------

export function covers(o, x, z, pad = 0){
  return x >= o.x - o.w / 2 - pad && x <= o.x + o.w / 2 + pad && z >= o.z - o.d / 2 - pad && z <= o.z + o.d / 2 + pad;
}
/** Высота опоры в точке: верх самого высокого твёрдого блока / пандуса под ней. */
export function groundAt(x, z, below = Infinity){
  let top = 0;
  for (const o of S.map.objects){
    if (o.type === "box" && !o.decor && covers(o, x, z) && o.y + o.h <= below) top = Math.max(top, o.y + o.h);
    if (o.type === "ramp" && covers(o, x, z)) top = Math.max(top, rampHeightAt(o, x, z));
  }
  return top;
}
export function rampHeightAt(o, x, z){
  let t;
  if (o.dir === "+x") t = (x - (o.x - o.w / 2)) / o.w;
  else if (o.dir === "-x") t = ((o.x + o.w / 2) - x) / o.w;
  else if (o.dir === "+z") t = (z - (o.z - o.d / 2)) / o.d;
  else t = ((o.z + o.d / 2) - z) / o.d;
  return o.y + Math.max(0, Math.min(1, t)) * o.h;
}
/** Под прямоугольником: самый высокий верх, на который можно поставить. */
export function topUnder(x, z, w, d){
  let top = 0;
  for (const o of S.map.objects){
    if (o.type !== "box" || o.decor) continue;
    if (Math.abs(o.x - x) < (o.w + w) / 2 - 0.01 && Math.abs(o.z - z) < (o.d + d) / 2 - 0.01) top = Math.max(top, o.y + o.h);
  }
  return top;
}
