// plan.js — план карты сверху: рисование, мышь, создание блоков, пандусов и точек.

import { $, toast } from "./dom.js";
import { S, byId, changed, round2, snap, snapStep, snapshot, undoStack } from "./state.js";
import { covers, groundAt, topUnder } from "./geometry.js";
import { renderSel } from "./panel.js";
import { drawSide, sideDown, sideMove, sideUp, sideWheel } from "./side.js";

// ---------------------------------------------------------------------------
// План сверху
// ---------------------------------------------------------------------------

export const canvas = $("plan");
export const ctx = canvas.getContext("2d");
export const cam = { x: 0, z: 0, scale: 9 };           // пикселей на метр
export let W = 0, H = 0, dpr = 1;

export function resize(){
  dpr = Math.min(2, devicePixelRatio || 1);
  W = canvas.clientWidth; H = canvas.clientHeight;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  draw();
}
export const toScreen = (x, z) => [W / 2 + (x - cam.x) * cam.scale, H / 2 + (z - cam.z) * cam.scale];
export const toWorld = (sx, sz) => [(sx - W / 2) / cam.scale + cam.x, (sz - H / 2) / cam.scale + cam.z];

export function fitView(){
  cam.x = 0; cam.z = 0;
  cam.scale = Math.max(3, Math.min((W - 40) / S.map.width, (H - 40) / S.map.depth));
}

export function draw(){
  if (!W || S.view === "3d") return;
  if (S.view === "front" || S.view === "side") return drawSide();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#101214";
  ctx.fillRect(0, 0, W, H);

  // пол и сетка
  const [fx0, fz0] = toScreen(-S.map.width / 2, -S.map.depth / 2);
  const fw = S.map.width * cam.scale, fd = S.map.depth * cam.scale;
  ctx.fillStyle = S.map.floor;
  ctx.fillRect(fx0, fz0, fw, fd);
  ctx.save();
  ctx.beginPath(); ctx.rect(fx0, fz0, fw, fd); ctx.clip();
  const minor = cam.scale >= 6 ? 1 : cam.scale >= 3 ? 2 : 5;
  for (let x = Math.ceil(-S.map.width / 2); x <= S.map.width / 2; x += minor){
    const [sx] = toScreen(x, 0);
    ctx.strokeStyle = x % 10 === 0 ? "rgba(0,0,0,.28)" : x % 5 === 0 ? "rgba(0,0,0,.16)" : "rgba(0,0,0,.07)";
    ctx.lineWidth = x === 0 ? 2 : 1;
    ctx.beginPath(); ctx.moveTo(sx + .5, fz0); ctx.lineTo(sx + .5, fz0 + fd); ctx.stroke();
  }
  for (let z = Math.ceil(-S.map.depth / 2); z <= S.map.depth / 2; z += minor){
    const [, sz] = toScreen(0, z);
    ctx.strokeStyle = z % 10 === 0 ? "rgba(0,0,0,.28)" : z % 5 === 0 ? "rgba(0,0,0,.16)" : "rgba(0,0,0,.07)";
    ctx.lineWidth = z === 0 ? 2 : 1;
    ctx.beginPath(); ctx.moveTo(fx0, sz + .5); ctx.lineTo(fx0 + fw, sz + .5); ctx.stroke();
  }
  // половины сторон (подсказка, где чья база)
  ctx.fillStyle = "rgba(232,163,23,.07)"; ctx.fillRect(fx0, fz0, fw * 0.2, fd);
  ctx.fillStyle = "rgba(90,160,210,.08)"; ctx.fillRect(fx0 + fw * 0.8, fz0, fw * 0.2, fd);
  ctx.restore();
  ctx.strokeStyle = S.map.border ? "#3a3f4a" : "rgba(255,255,255,.3)";
  ctx.lineWidth = S.map.border ? 4 : 1.5;
  ctx.strokeRect(fx0, fz0, fw, fd);

  // блоки и пандусы — снизу вверх по высоте верха
  const solids = S.map.objects.filter(o => o.type === "box" || o.type === "ramp")
    .sort((a, b) => (a.y + a.h) - (b.y + b.h));
  for (const o of solids) drawSolid(o);
  for (const o of S.map.objects) if (o.type === "site") drawSite(o);
  for (const o of S.map.objects) if (o.type === "spawn") drawSpawn(o);

  // тянем новый прямоугольник
  if (drag?.kind === "create"){
    const r = rectFrom(drag.x0, drag.z0, drag.x1, drag.z1);
    const [sx, sz] = toScreen(r.x - r.w / 2, r.z - r.d / 2);
    ctx.fillStyle = "rgba(232,163,23,.25)"; ctx.strokeStyle = "#e8a317"; ctx.lineWidth = 2;
    ctx.fillRect(sx, sz, r.w * cam.scale, r.d * cam.scale);
    ctx.strokeRect(sx, sz, r.w * cam.scale, r.d * cam.scale);
    label(`${r.w} × ${r.d} м`, sx + r.w * cam.scale / 2, sz - 10, "#e8a317");
  }
  if (S.mirror){
    const [mx] = toScreen(0, 0);
    ctx.setLineDash([6, 6]); ctx.strokeStyle = "rgba(232,163,23,.8)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(mx, fz0); ctx.lineTo(mx, fz0 + fd); ctx.stroke(); ctx.setLineDash([]);
  }
}

export function shade(hex, k){
  const n = parseInt(hex.slice(1), 16);
  const f = c => Math.max(0, Math.min(255, Math.round(c * k)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

export function drawSolid(o){
  const [sx, sz] = toScreen(o.x - o.w / 2, o.z - o.d / 2);
  const w = o.w * cam.scale, d = o.d * cam.scale;
  const sel = o.id === S.selected;
  if (o.type === "box"){
    ctx.globalAlpha = o.decor ? 0.55 : 1;
    ctx.fillStyle = o.color;
    ctx.fillRect(sx, sz, w, d);
    // «тень» объёма: чем выше, тем толще тёмный край снизу-справа
    const t = Math.min(6, 1 + (o.y + o.h) * 0.9);
    ctx.fillStyle = "rgba(0,0,0,.25)";
    ctx.fillRect(sx + w - Math.min(t, w / 3), sz, Math.min(t, w / 3), d);
    ctx.fillRect(sx, sz + d - Math.min(t, d / 3), w, Math.min(t, d / 3));
    ctx.globalAlpha = 1;
    ctx.strokeStyle = sel ? "#fff" : shade(o.color, 0.55);
    ctx.lineWidth = sel ? 2 : 1;
    if (o.decor) ctx.setLineDash([4, 3]);
    ctx.strokeRect(sx + .5, sz + .5, w - 1, d - 1);
    ctx.setLineDash([]);
    if (w > 26 && d > 14){
      label(o.y > 0 ? `${round2(o.y)}→${round2(o.y + o.h)}` : `${round2(o.h)} м`, sx + w / 2, sz + d / 2, "#fff");
    }
  } else {
    ctx.fillStyle = o.color;
    ctx.fillRect(sx, sz, w, d);
    // шевроны вверх по склону
    ctx.strokeStyle = "rgba(0,0,0,.45)"; ctx.lineWidth = 2;
    const along = o.dir[1] === "x";
    const n = Math.max(2, Math.floor((along ? w : d) / 14));
    for (let i = 1; i <= n; i++){
      const f = i / (n + 1);
      ctx.beginPath();
      if (along){
        const x = o.dir === "+x" ? sx + w * f : sx + w * (1 - f);
        const tip = o.dir === "+x" ? 6 : -6;
        ctx.moveTo(x - tip, sz + d * 0.25); ctx.lineTo(x, sz + d / 2); ctx.lineTo(x - tip, sz + d * 0.75);
      } else {
        const z = o.dir === "+z" ? sz + d * f : sz + d * (1 - f);
        const tip = o.dir === "+z" ? 6 : -6;
        ctx.moveTo(sx + w * 0.25, z - tip); ctx.lineTo(sx + w / 2, z); ctx.lineTo(sx + w * 0.75, z - tip);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = sel ? "#fff" : shade(o.color, 0.55);
    ctx.lineWidth = sel ? 2 : 1;
    ctx.strokeRect(sx + .5, sz + .5, w - 1, d - 1);
    if (w > 26 && d > 26) label(`↑${round2(o.y + o.h)}`, sx + w / 2, sz + d / 2, "#fff");
  }
  if (sel) drawHandles(o);
}

export function drawHandles(o){
  for (const [hx, hz] of corners(o)){
    const [sx, sz] = toScreen(hx, hz);
    ctx.fillStyle = "#fff"; ctx.strokeStyle = "#000"; ctx.lineWidth = 1;
    ctx.fillRect(sx - 4, sz - 4, 8, 8); ctx.strokeRect(sx - 4, sz - 4, 8, 8);
  }
}
export const corners = o => [[o.x - o.w / 2, o.z - o.d / 2], [o.x + o.w / 2, o.z - o.d / 2],
                      [o.x + o.w / 2, o.z + o.d / 2], [o.x - o.w / 2, o.z + o.d / 2]];

export function drawSite(o){
  const [sx, sz] = toScreen(o.x, o.z);
  const r = 5 * cam.scale;
  ctx.fillStyle = "rgba(232,163,23,.18)"; ctx.strokeStyle = "#e8a317"; ctx.lineWidth = o.id === S.selected ? 3 : 2;
  ctx.beginPath(); ctx.arc(sx, sz, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#1b1406";
  ctx.beginPath(); ctx.arc(sx, sz, 12, 0, Math.PI * 2); ctx.fill();
  label(o.letter, sx, sz, "#e8a317", 15);
}

export function drawSpawn(o){
  const [sx, sz] = toScreen(o.x, o.z);
  const color = o.team === "a" ? "#e8a317" : "#5aa0d2";
  // смотрит в центр карты
  const a = Math.atan2(-o.z, -o.x);
  ctx.strokeStyle = color; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(sx, sz); ctx.lineTo(sx + Math.cos(a) * 18, sz + Math.sin(a) * 18); ctx.stroke();
  ctx.fillStyle = color; ctx.strokeStyle = o.id === S.selected ? "#fff" : "#000"; ctx.lineWidth = o.id === S.selected ? 3 : 1.5;
  ctx.beginPath(); ctx.arc(sx, sz, Math.max(6, 0.45 * cam.scale), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  label(o.team === "a" ? "Т" : "СН", sx, sz - Math.max(14, 0.45 * cam.scale + 9), color, 11);
}

export function label(text, x, y, color = "#fff", size = 12){
  ctx.font = `700 ${size}px "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,.7)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color; ctx.fillText(text, x, y);
}

// ---------------------------------------------------------------------------
// Мышь
// ---------------------------------------------------------------------------

export let drag = null;

export function pick(x, z){
  // точки — первыми (они сверху), затем блоки сверху вниз
  const pts = S.map.objects.filter(o => o.type === "spawn" || o.type === "site");
  for (const o of pts){
    const r = o.type === "site" ? Math.max(1.4, 14 / cam.scale) : Math.max(0.8, 8 / cam.scale);
    if (Math.hypot(o.x - x, o.z - z) <= r) return o;
  }
  const solids = S.map.objects.filter(o => o.type === "box" || o.type === "ramp")
    .sort((a, b) => (b.y + b.h) - (a.y + a.h));
  return solids.find(o => covers(o, x, z)) || null;
}

export function rectFrom(x0, z0, x1, z1){
  const ax = snap(Math.min(x0, x1)), bx = snap(Math.max(x0, x1));
  const az = snap(Math.min(z0, z1)), bz = snap(Math.max(z0, z1));
  const w = Math.max(snapStep(), round2(bx - ax)), d = Math.max(snapStep(), round2(bz - az));
  return { x: round2(ax + w / 2), z: round2(az + d / 2), w, d };
}

canvas.addEventListener("contextmenu", e => e.preventDefault());
canvas.addEventListener("pointerdown", e => {
  canvas.setPointerCapture(e.pointerId);
  if (S.view !== "top") return sideDown(e);
  const [x, z] = toWorld(e.offsetX, e.offsetY);
  if (e.button === 1 || e.button === 2 || S.tool === "pan" || S.spaceDown){
    drag = { kind: "pan", sx: e.offsetX, sz: e.offsetY, cx: cam.x, cz: cam.z };
    return;
  }
  if (S.tool === "box" || S.tool === "ramp"){
    drag = { kind: "create", x0: x, z0: z, x1: x, z1: z };
    return;
  }
  if (S.tool === "siteA" || S.tool === "siteB"){ placeSite(S.tool === "siteA" ? "A" : "B", x, z); return; }
  if (S.tool === "spawnA" || S.tool === "spawnB"){ placeSpawn(S.tool === "spawnA" ? "a" : "b", x, z); return; }
  if (S.tool === "erase"){
    const o = pick(x, z);
    if (o){ snapshot(); removeObj(o); changed(); }
    return;
  }
  // выбор: сначала — не за угол ли выбранного тянем
  const cur = byId(S.selected);
  if (cur && (cur.type === "box" || cur.type === "ramp")){
    const hit = corners(cur).findIndex(([hx, hz]) => {
      const [sx, sz] = toScreen(hx, hz);
      return Math.abs(sx - e.offsetX) < 8 && Math.abs(sz - e.offsetY) < 8;
    });
    if (hit >= 0){
      snapshot();
      const [ox, oz] = corners(cur)[(hit + 2) % 4];          // противоположный угол — неподвижен
      drag = { kind: "resize", id: cur.id, ox, oz };
      return;
    }
  }
  const o = pick(x, z);
  S.selected = o ? o.id : null;
  if (o){
    snapshot();
    drag = { kind: "move", id: o.id, dx: x - o.x, dz: z - o.z, moved: false };
  }
  renderSel(); draw();
});

canvas.addEventListener("pointermove", e => {
  if (S.view !== "top") return sideMove(e);
  const [x, z] = toWorld(e.offsetX, e.offsetY);
  $("coords").textContent = `x ${x.toFixed(1)}  z ${z.toFixed(1)}  ·  опора ${groundAt(x, z).toFixed(1)} м`;
  if (!drag) return;
  if (drag.kind === "pan"){
    cam.x = drag.cx - (e.offsetX - drag.sx) / cam.scale;
    cam.z = drag.cz - (e.offsetY - drag.sz) / cam.scale;
  } else if (drag.kind === "create"){
    drag.x1 = x; drag.z1 = z;
  } else if (drag.kind === "move"){
    const o = byId(drag.id);
    if (o){ o.x = round2(snap(x - drag.dx)); o.z = round2(snap(z - drag.dz)); drag.moved = true; renderSel(); }
  } else if (drag.kind === "resize"){
    const o = byId(drag.id);
    if (o){ Object.assign(o, rectFrom(drag.ox, drag.oz, x, z)); renderSel(); }
  }
  draw();
});

canvas.addEventListener("pointerup", () => {
  if (S.view !== "top") return sideUp();
  if (!drag) return;
  if (drag.kind === "create"){
    const r = rectFrom(drag.x0, drag.z0, drag.x1, drag.z1);
    if (r.w * r.d >= snapStep() * snapStep()) createSolid(S.tool, r);
  } else if (drag.kind === "move" && !drag.moved){
    undoStack.pop();                     // просто клик — отмена не нужна
  }
  const wasEdit = drag.kind === "move" || drag.kind === "resize";
  drag = null;
  if (wasEdit) changed(); else draw();
});

canvas.addEventListener("wheel", e => {
  e.preventDefault();
  if (S.view !== "top") return sideWheel(e);
  const [x, z] = toWorld(e.offsetX, e.offsetY);
  cam.scale = Math.max(2, Math.min(60, cam.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
  const [nx, nz] = toWorld(e.offsetX, e.offsetY);
  cam.x += x - nx; cam.z += z - nz;
  draw();
}, { passive: false });

// ---------------------------------------------------------------------------
// Создание объектов
// ---------------------------------------------------------------------------

export function mirrored(o){
  const m = { ...o, id: S.nextId++, x: round2(-o.x) };
  if (m.type === "ramp" && m.dir[1] === "x") m.dir = m.dir === "+x" ? "-x" : "+x";
  if (m.type === "spawn") m.team = o.team === "a" ? "b" : "a";
  return m;
}

export function createSolid(kind, r){
  snapshot();
  const h = Math.max(0.1, Number($("newH").value) || 2.4);
  let y = Math.max(0, Number($("newY").value) || 0);
  if ($("stackOn").checked && kind === "box" && y === 0) y = topUnder(r.x, r.z, r.w, r.d);
  const color = $("newColor").value;
  const o = kind === "box"
    ? { id: S.nextId++, type: "box", ...r, y: round2(y), h, color, decor: false }
    : { id: S.nextId++, type: "ramp", ...r, y: round2(y), h, color: color === "#8e949e" ? "#ffc83d" : color,
        dir: r.w >= r.d ? "+x" : "+z" };
  S.map.objects.push(o);
  if (S.mirror && Math.abs(o.x) > 0.01) S.map.objects.push(mirrored(o));
  S.selected = o.id;
  changed();
}

export function placeSite(letter, x, z){
  snapshot();
  S.map.objects = S.map.objects.filter(o => !(o.type === "site" && o.letter === letter));
  const o = { id: S.nextId++, type: "site", letter, x: round2(snap(x)), z: round2(snap(z)) };
  S.map.objects.push(o);
  S.selected = o.id;
  changed();
}

export function placeSpawn(team, x, z){
  const count = S.map.objects.filter(o => o.type === "spawn" && o.team === team).length;
  if (count >= 6){ toast("Хватит: до 6 точек возрождения на сторону."); return; }
  snapshot();
  const o = { id: S.nextId++, type: "spawn", team, x: round2(snap(x)), z: round2(snap(z)) };
  S.map.objects.push(o);
  if (S.mirror && Math.abs(o.x) > 0.01) S.map.objects.push(mirrored(o));
  S.selected = o.id;
  changed();
}

export function removeObj(o){
  S.map.objects = S.map.objects.filter(x => x !== o);
  if (S.selected === o.id) S.selected = null;
}
