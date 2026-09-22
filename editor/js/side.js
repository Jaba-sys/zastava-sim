// side.js — вид сбоку: «Спереди» (смотрим с юга на север) и «Сбоку» (с востока
// на запад). Здесь видно ВЫСОТУ, и здесь её удобно менять мышью:
//
//   тянуть блок              — двигать вдоль стены и вверх-вниз (меняется «низ»);
//   тянуть верхний край      — выше / ниже (меняется высота);
//   тянуть нижний край       — поднять низ, верх остаётся на месте;
//   тянуть левый / правый    — ширина.
//
// Ближние блоки рисуются поверх дальних, дальние — темнее: так видно, что
// за чем стоит.

import { $ } from "./dom.js";
import { S, byId, changed, round2, snap, snapshot, undoStack } from "./state.js";
import { groundAt } from "./geometry.js";
import { ctx, W, H, dpr, label, shade } from "./plan.js";
import { renderSel } from "./panel.js";

export const sideCam = { h: 0, y: 5, scale: 12 };
let drag = null;

/** Для вида: горизонтальная ось, глубина (больше — ближе к нам). */
function axes(){
  return S.view === "front"
    ? { h: o => o.x, size: o => o.w, setH: (o, v) => { o.x = v; }, setSize: (o, v) => { o.w = v; },
        depth: o => o.z, span: () => S.map.width, name: "x" }
    : { h: o => -o.z, size: o => o.d, setH: (o, v) => { o.z = -v; }, setSize: (o, v) => { o.d = v; },
        depth: o => o.x, span: () => S.map.depth, name: "z" };
}

const toScreen = (h, y) => [W / 2 + (h - sideCam.h) * sideCam.scale, H / 2 - (y - sideCam.y) * sideCam.scale];
const toWorld = (sx, sy) => [(sx - W / 2) / sideCam.scale + sideCam.h, sideCam.y - (sy - H / 2) / sideCam.scale];

export function fitSide(){
  const span = axes().span();
  sideCam.h = 0;
  sideCam.scale = Math.max(6, Math.min((W - 60) / span, (H - 80) / 10));
  sideCam.y = (H / 2 - 40) / sideCam.scale;       // пол — у нижнего края
}

/** Прямоугольник объекта на экране: [x0, y0(верх), x1, y1(низ)]. */
function rectOf(o){
  const A = axes();
  const [x0, yTop] = toScreen(A.h(o) - A.size(o) / 2, o.y + o.h);
  const [x1, yBot] = toScreen(A.h(o) + A.size(o) / 2, o.y);
  return [x0, yTop, x1, yBot];
}

export function drawSide(){
  const A = axes();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = S.map.sky;
  ctx.fillRect(0, 0, W, H);

  // сетка высот
  const [, g0] = toScreen(0, 0);
  for (let y = 0; y <= 40; y++){
    const [, sy] = toScreen(0, y);
    if (sy < -2 || sy > H + 2) continue;
    ctx.strokeStyle = y % 5 === 0 ? "rgba(0,0,0,.22)" : "rgba(0,0,0,.08)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, sy + .5); ctx.lineTo(W, sy + .5); ctx.stroke();
    const every = sideCam.scale >= 22 ? 1 : sideCam.scale >= 9 ? 2 : 5;
    if (y % every === 0) label(`${y} м`, 24, sy - 7, "#ffffff", 10);
  }
  const half = A.span() / 2;
  for (let h = Math.ceil(-half); h <= half; h += sideCam.scale >= 14 ? 1 : 5){
    const [sx] = toScreen(h, 0);
    ctx.strokeStyle = h % 10 === 0 ? "rgba(0,0,0,.18)" : "rgba(0,0,0,.06)";
    ctx.beginPath(); ctx.moveTo(sx + .5, 0); ctx.lineTo(sx + .5, g0); ctx.stroke();
  }
  // земля
  const [lx] = toScreen(-half, 0), [rx] = toScreen(half, 0);
  ctx.fillStyle = S.map.floor;
  ctx.fillRect(lx, g0, rx - lx, H - g0);
  ctx.fillStyle = "rgba(0,0,0,.35)";
  ctx.fillRect(0, g0, lx, H - g0); ctx.fillRect(rx, g0, W - rx, H - g0);

  // рост бойца — ориентир
  const [, man] = toScreen(0, 1.75);
  ctx.setLineDash([5, 5]); ctx.strokeStyle = "rgba(255,255,255,.35)";
  ctx.beginPath(); ctx.moveTo(0, man); ctx.lineTo(W, man); ctx.stroke(); ctx.setLineDash([]);
  label("рост бойца 1.75 м", W - 70, man - 8, "rgba(255,255,255,.7)", 10);

  // объекты: дальние первыми
  const solids = S.map.objects.filter(o => o.type === "box" || o.type === "ramp")
    .sort((a, b) => A.depth(a) - A.depth(b));
  const dmin = Math.min(...solids.map(A.depth), 0), dmax = Math.max(...solids.map(A.depth), 1);
  for (const o of solids){
    const far = 1 - (A.depth(o) - dmin) / Math.max(1, dmax - dmin);    // 0 — ближний, 1 — дальний
    const [x0, y0, x1, y1] = rectOf(o);
    const sel = o.id === S.selected;
    ctx.globalAlpha = o.decor ? 0.5 : 1;
    ctx.fillStyle = shade(o.color, 1 - far * 0.45);
    if (o.type === "ramp" && o.dir[1] === A.name){
      // пандус вдоль этой оси — видно склон
      const up = (o.dir === "+x" && A.name === "x") || (o.dir === "-z" && A.name === "z");
      ctx.beginPath();
      if (up){ ctx.moveTo(x0, y1); ctx.lineTo(x1, y0); ctx.lineTo(x1, y1); }
      else { ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x0, y1); }
      ctx.closePath(); ctx.fill();
    } else ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = sel ? "#fff" : shade(o.color, 0.45);
    ctx.lineWidth = sel ? 2 : 1;
    ctx.strokeRect(x0 + .5, y0 + .5, x1 - x0 - 1, y1 - y0 - 1);
    if (sel){
      for (const [hx, hy] of [[(x0 + x1) / 2, y0], [(x0 + x1) / 2, y1], [x0, (y0 + y1) / 2], [x1, (y0 + y1) / 2]]){
        ctx.fillStyle = "#fff"; ctx.strokeStyle = "#000";
        ctx.fillRect(hx - 5, hy - 5, 10, 10); ctx.strokeRect(hx - 5, hy - 5, 10, 10);
      }
      label(`низ ${round2(o.y)} · верх ${round2(o.y + o.h)} м`, (x0 + x1) / 2, y0 - 14, "#fff", 11);
    }
  }
  // точки и бойцы
  for (const o of S.map.objects){
    if (o.type !== "site" && o.type !== "spawn") continue;
    const g = groundAt(o.x, o.z);
    const [sx, sy] = toScreen(A.h(o), g);
    if (o.type === "site"){
      ctx.fillStyle = "rgba(232,163,23,.35)";
      const [ax] = toScreen(A.h(o) - 5, g), [bx] = toScreen(A.h(o) + 5, g);
      ctx.fillRect(ax, sy - 3, bx - ax, 3);
      label(o.letter, sx, sy - 14, "#e8a317", 15);
    } else {
      const [, top] = toScreen(0, g + 1.75);
      ctx.fillStyle = o.team === "a" ? "#e8a317" : "#5aa0d2";
      ctx.globalAlpha = 0.8;
      ctx.fillRect(sx - 0.35 * sideCam.scale, top, 0.7 * sideCam.scale, sy - top);
      ctx.globalAlpha = 1;
    }
  }
  label(S.view === "front" ? "Вид спереди: ← запад · восток →" : "Вид сбоку: ← юг · север →", W / 2, 18, "#ffffff", 13);
}

// ---- мышь -----------------------------------------------------------------

function pickSide(sx, sy){
  const A = axes();
  const solids = S.map.objects.filter(o => o.type === "box" || o.type === "ramp")
    .sort((a, b) => A.depth(b) - A.depth(a));            // ближние первыми
  return solids.find(o => {
    const [x0, y0, x1, y1] = rectOf(o);
    return sx >= x0 - 4 && sx <= x1 + 4 && sy >= y0 - 4 && sy <= y1 + 4;
  }) || null;
}

export function sideDown(e){
  const [h, y] = toWorld(e.offsetX, e.offsetY);
  if (e.button === 1 || e.button === 2 || S.tool === "pan" || S.spaceDown){
    drag = { kind: "pan", sx: e.offsetX, sy: e.offsetY, ch: sideCam.h, cy: sideCam.y };
    return;
  }
  const A = axes();
  const cur = byId(S.selected);
  if (cur && (cur.type === "box" || cur.type === "ramp")){
    const [x0, y0, x1, y1] = rectOf(cur);
    const near = (a, b) => Math.abs(a - b) < 7;
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    let edge = null;
    if (near(e.offsetY, y0) && Math.abs(e.offsetX - mx) < Math.max(10, (x1 - x0) / 2)) edge = "top";
    else if (near(e.offsetY, y1) && Math.abs(e.offsetX - mx) < Math.max(10, (x1 - x0) / 2)) edge = "bottom";
    else if (near(e.offsetX, x0) && Math.abs(e.offsetY - my) < Math.max(10, (y1 - y0) / 2)) edge = "left";
    else if (near(e.offsetX, x1) && Math.abs(e.offsetY - my) < Math.max(10, (y1 - y0) / 2)) edge = "right";
    if (edge){
      snapshot();
      drag = { kind: "edge", edge, id: cur.id, h0: A.h(cur) - A.size(cur) / 2, h1: A.h(cur) + A.size(cur) / 2,
               top: cur.y + cur.h };
      return;
    }
  }
  if (S.tool === "erase"){
    const o = pickSide(e.offsetX, e.offsetY);
    if (o){ snapshot(); S.map.objects = S.map.objects.filter(x => x !== o); S.selected = null; changed(); }
    return;
  }
  const o = pickSide(e.offsetX, e.offsetY);
  S.selected = o ? o.id : null;
  if (o){
    snapshot();
    drag = { kind: "move", id: o.id, dh: h - A.h(o), dy: y - o.y, moved: false };
  }
  renderSel(); drawSide();
}

export function sideMove(e){
  const [h, y] = toWorld(e.offsetX, e.offsetY);
  $("coords").textContent = `${axes().name} ${h.toFixed(1)}  ·  высота ${y.toFixed(1)} м`;
  if (!drag) return;
  const A = axes();
  const o = drag.id ? byId(drag.id) : null;
  if (drag.kind === "pan"){
    sideCam.h = drag.ch - (e.offsetX - drag.sx) / sideCam.scale;
    sideCam.y = drag.cy + (e.offsetY - drag.sy) / sideCam.scale;
  } else if (drag.kind === "move" && o){
    A.setH(o, round2(snap(h - drag.dh)));
    o.y = round2(Math.max(0, snap(y - drag.dy)));
    drag.moved = true;
    renderSel();
  } else if (drag.kind === "edge" && o){
    const s = snap;
    if (drag.edge === "top") o.h = round2(Math.max(0.1, s(y) - o.y));
    if (drag.edge === "bottom"){ const ny = Math.max(0, Math.min(drag.top - 0.1, s(y))); o.y = round2(ny); o.h = round2(drag.top - ny); }
    if (drag.edge === "left"){ const a = Math.min(s(h), drag.h1 - 0.25); A.setSize(o, round2(drag.h1 - a)); A.setH(o, round2((a + drag.h1) / 2)); }
    if (drag.edge === "right"){ const b = Math.max(s(h), drag.h0 + 0.25); A.setSize(o, round2(b - drag.h0)); A.setH(o, round2((drag.h0 + b) / 2)); }
    renderSel();
  }
  drawSide();
}

export function sideUp(){
  if (!drag) return;
  if (drag.kind === "move" && !drag.moved) undoStack.pop();
  const edited = drag.kind === "edge" || (drag.kind === "move" && drag.moved);
  drag = null;
  if (edited) changed(); else drawSide();
}

export function sideWheel(e){
  const [h, y] = toWorld(e.offsetX, e.offsetY);
  sideCam.scale = Math.max(3, Math.min(80, sideCam.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
  const [nh, ny] = toWorld(e.offsetX, e.offsetY);
  sideCam.h += h - nh; sideCam.y += y - ny;
  drawSide();
}
