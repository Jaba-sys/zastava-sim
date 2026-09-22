// checks.js — проверка карты: точки A/B, возрождения, проходимость до точек.

import { $ } from "./dom.js";
import { S } from "./state.js";
import { covers, groundAt } from "./geometry.js";

// ---------------------------------------------------------------------------
// Проверка: всё, без чего карта в игре не заработает
// ---------------------------------------------------------------------------

export function runChecks(){
  const out = [];
  const add = (cls, text) => out.push(`<li class="${cls}">${text}</li>`);
  const sites = S.map.objects.filter(o => o.type === "site");
  const A = S.map.objects.filter(o => o.type === "spawn" && o.team === "a");
  const B = S.map.objects.filter(o => o.type === "spawn" && o.team === "b");
  const inside = o => Math.abs(o.x) <= S.map.width / 2 - 0.5 && Math.abs(o.z) <= S.map.depth / 2 - 0.5;

  const hasA = sites.some(s => s.letter === "A"), hasB = sites.some(s => s.letter === "B");
  add(hasA && hasB ? "ok" : "bad", hasA && hasB ? "Есть точки A и B" : "Нужны обе точки закладки: A (1) и B (2)");
  add(A.length >= 2 ? "ok" : "bad", `Возрождения террористов: ${A.length} (нужно от 2)`);
  add(B.length >= 2 ? "ok" : "bad", `Возрождения спецназа: ${B.length} (нужно от 2)`);
  const outside = [...sites, ...A, ...B].filter(o => !inside(o));
  if (outside.length) add("bad", `За краем карты: ${outside.length} точ.`);

  // Точка внутри стены: над ней блок, который начинается ниже роста бойца.
  const stuck = [...sites, ...A, ...B].filter(p => {
    const floor = groundAt(p.x, p.z);
    return S.map.objects.some(o => o.type === "box" && !o.decor && covers(o, p.x, p.z, 0.3) && o.y > floor - 0.01 && o.y < floor + 1.8 && o.y + o.h > floor + 0.45);
  });
  add(stuck.length ? "bad" : "ok", stuck.length ? `Точки внутри блоков: ${stuck.length} — отодвинь` : "Точки не застряли в блоках");
  const high = [...A, ...B].filter(p => groundAt(p.x, p.z) > 1);
  if (high.length) add("warn", `Возрождений на высоком блоке: ${high.length} — боец появится наверху. Так и задумано?`);

  // Дорога: сетка по полу, от возрождений до точек. Верхние этажи — через пандусы.
  if (hasA && hasB && A.length && B.length){
    const reach = team => walkFrom(team === "a" ? A : B);
    const ra = reach("a"), rb = reach("b");
    for (const s of sites){
      const k = cellKey(s.x, s.z);
      const okA = ra.has(k), okB = rb.has(k);
      add(okA && okB ? "ok" : "bad", okA && okB ? `До точки ${s.letter} добегают обе стороны`
        : `До точки ${s.letter} не добегают: ${!okA ? "террористы " : ""}${!okB ? "спецназ" : ""}`);
    }
    const meet = B.some(p => ra.has(cellKey(p.x, p.z)));
    add(meet ? "ok" : "bad", meet ? "Стороны могут дойти друг до друга" : "Базы отрезаны друг от друга");
  }
  if (!/^[a-z0-9-]{2,16}$/.test(S.map.id)) add("bad", "Код карты — латиницей, 2–16 символов");
  const n = S.map.objects.length;
  if (n > 700) add("warn", `Объектов много (${n}) — на слабых телефонах может тормозить`);
  $("checks").innerHTML = out.join("");
  const boxes = S.map.objects.filter(o => o.type === "box").length, ramps = S.map.objects.filter(o => o.type === "ramp").length;
  $("stat").textContent = `Блоков: ${boxes} · пандусов: ${ramps} · размер ${S.map.width} × ${S.map.depth} м`;
  return !out.some(l => l.includes('class="bad"'));
}

// Проходимость — клетки по 0.5 м; высота пола в клетке — опора под ней;
// шагнуть можно на ступень до 0.45 м вверх и спрыгнуть откуда угодно; над
// головой должно быть 1.8 м свободно.
export const CELL = 0.5;
export const cellKey = (x, z) => `${Math.round(x / CELL)},${Math.round(z / CELL)}`;
export function walkFrom(starts){
  const hw = S.map.width / 2, hd = S.map.depth / 2;
  const floorCache = new Map();
  const floorOf = (i, j) => {
    const k = i + "," + j;
    if (floorCache.has(k)) return floorCache.get(k);
    const x = i * CELL, z = j * CELL;
    let f = null;
    if (Math.abs(x) <= hw - 0.3 && Math.abs(z) <= hd - 0.3){
      f = groundAt(x, z);
      // над полом не должно быть блока ниже роста
      const blocked = S.map.objects.some(o => o.type === "box" && !o.decor && covers(o, x, z, 0.3) && o.y + o.h > f + 0.45 && o.y < f + 1.8);
      if (blocked) f = null;
    }
    floorCache.set(k, f);
    return f;
  };
  const seen = new Set(), queue = [];
  for (const p of starts){
    const i = Math.round(p.x / CELL), j = Math.round(p.z / CELL);
    if (floorOf(i, j) === null) continue;
    seen.add(i + "," + j); queue.push([i, j]);
  }
  while (queue.length){
    const [i, j] = queue.shift();
    const f = floorOf(i, j);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]){
      const ni = i + di, nj = j + dj, k = ni + "," + nj;
      if (seen.has(k)) continue;
      const g = floorOf(ni, nj);
      if (g === null || g - f > 0.5) continue;
      seen.add(k); queue.push([ni, nj]);
    }
  }
  return seen;
}
