// main.js — запуск редактора: инструменты, горячие клавиши, палитра.

import { $, PALETTE, STORE } from "./dom.js";
import { S, byId, changed, load, redo, round2, snapStep, snapshot, undo } from "./state.js";
import { canvas, draw, fitView, removeObj, resize } from "./plan.js";
import { bindMapForm, duplicate, fillMapForm, renderSel, rotateSel } from "./panel.js";
import { runChecks } from "./checks.js";
import { gameData } from "./files.js";
import { view3d } from "./view3d.js";
import { fitSide } from "./side.js";

// ---------------------------------------------------------------------------
// Инструменты, клавиши, прочее
// ---------------------------------------------------------------------------

const HINTS = {
  select: "Кликни по объекту, чтобы выбрать. Тяни — двигать, тяни за угол — менять размер. Del — удалить.",
  box: "Тяни мышью прямоугольник — будет блок. Высота и цвет — справа, в «Новый блок».",
  ramp: "Тяни прямоугольник — пандус. Подъём = высота площадки, на которую ведёт. R — повернуть.",
  siteA: "Кликни, где будет точка A (круг радиусом 5 м).",
  siteB: "Кликни, где будет точка B.",
  spawnA: "Кликни, где появляются террористы (обычно слева). Нужно минимум 2.",
  spawnB: "Кликни, где появляется спецназ (обычно справа). Нужно минимум 2.",
  erase: "Кликни по объекту, чтобы удалить.",
  pan: "Тяни, чтобы двигать вид. Колесо — приблизить."
};
function setTool(t){
  S.tool = t;
  document.querySelectorAll(".tool").forEach(b => b.classList.toggle("on", b.dataset.tool === t));
  $("stageHint").textContent = HINTS[t] + (S.mirror ? "  ·  Зеркало включено." : "");
  canvas.style.cursor = t === "pan" ? "grab" : t === "select" || S.view !== "top" ? "default" : "crosshair";
  if (S.view === "front" || S.view === "side")
    $("stageHint").textContent = "Вид сбоку: тяни блок — двигать и поднимать; верхний край — высота; нижний — низ; боковые — ширина. Новые блоки ставь сверху или в 3D.";
  if (S.view === "3d")
    $("stageHint").textContent = "3D: тяни блок — двигать, Shift+тяни — поднимать, жёлтая стрелка — высота. «Блок» (B) — клик по земле/верху блока ставит новый. Пустое место — крутить вид.";
}
document.querySelectorAll(".tool").forEach(b => b.addEventListener("click", () => setTool(b.dataset.tool)));

function toggleMirror(){
  S.mirror = !S.mirror;
  $("bMirror").classList.toggle("on", S.mirror);
  setTool(S.tool); draw();
}
$("bMirror").addEventListener("click", toggleMirror);

/** Вид: сверху, спереди, сбоку, 3D. */
async function setView(v){
  if (v === S.view) return;
  const was = S.view;
  S.view = v;
  document.querySelectorAll("#views .btn").forEach(b => b.classList.toggle("on", b.dataset.view === v));
  if (v === "3d"){
    const ok = await view3d.show();
    if (ok === false){ S.view = was; document.querySelectorAll("#views .btn").forEach(b => b.classList.toggle("on", b.dataset.view === was)); }
  } else {
    view3d.hide();
    if ((v === "front" || v === "side") && was !== "front" && was !== "side") fitSide();
    else if (v === "front" || v === "side") fitSide();
  }
  setTool(S.tool);
  draw();
}
document.querySelectorAll("#views .btn").forEach(b => b.addEventListener("click", () => setView(b.dataset.view)));
$("bUndo").addEventListener("click", undo);
$("bRedo").addEventListener("click", redo);
$("bHelp").addEventListener("click", () => $("help").showModal());
$("bProps").addEventListener("click", () => $("props").classList.toggle("open"));

addEventListener("keydown", e => {
  if (e.target.matches("input, select, textarea")) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && (k === "z" || k === "я")){ e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if ((e.ctrlKey || e.metaKey) && (k === "y" || k === "н")){ e.preventDefault(); redo(); return; }
  if ((e.ctrlKey || e.metaKey) && (k === "d" || k === "в")){ e.preventDefault(); duplicate(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code === "Space"){ S.spaceDown = true; e.preventDefault(); return; }
  const map1 = { KeyV: "select", KeyB: "box", KeyP: "ramp", Digit1: "siteA", Digit2: "siteB", KeyT: "spawnA",
                 KeyC: "spawnB", KeyE: "erase", KeyH: "pan" };
  if (map1[e.code]){ setTool(map1[e.code]); return; }
  if (e.code === "KeyM"){ toggleMirror(); return; }
  if (e.code === "KeyR"){ rotateSel(); return; }
  if (e.code === "KeyF"){ if (S.view === "top") fitView(); else fitSide(); draw(); return; }
  // высота выбранного с клавиатуры — в любом виде
  const sel = byId(S.selected);
  if (sel && (sel.type === "box" || sel.type === "ramp")){
    const st = snapStep();
    if (e.code === "PageUp" || e.code === "PageDown"){
      e.preventDefault(); snapshot();
      sel.y = round2(Math.max(0, sel.y + (e.code === "PageUp" ? st : -st))); changed(); return;
    }
    if (e.key === "+" || e.key === "=" || e.key === "-" || e.code === "NumpadAdd" || e.code === "NumpadSubtract"){
      e.preventDefault(); snapshot();
      const up = e.key === "+" || e.key === "=" || e.code === "NumpadAdd";
      sel.h = round2(Math.max(0.1, sel.h + (up ? st : -st))); changed(); return;
    }
  }
  if (e.code === "Delete" || e.code === "Backspace"){
    const o = byId(S.selected); if (o){ snapshot(); removeObj(o); changed(); }
    return;
  }
  if (e.code === "Escape"){ S.selected = null; renderSel(); draw(); if (S.view === "3d") view3d.rebuild(); }
  // стрелки — подвинуть выбранное на шаг сетки
  const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (arrows[e.code] && byId(S.selected)){
    e.preventDefault(); snapshot();
    const o = byId(S.selected), [dx, dz] = arrows[e.code];
    o.x = round2(o.x + dx * snapStep()); o.z = round2(o.z + dz * snapStep()); changed();
  }
});
addEventListener("keyup", e => { if (e.code === "Space") S.spaceDown = false; });

// палитра
for (const c of PALETTE){
  const i = document.createElement("i");
  i.style.background = c; i.title = c;
  i.addEventListener("click", () => {
    $("newColor").value = c;
    const o = byId(S.selected);
    if (o && (o.type === "box" || o.type === "ramp")){ snapshot(); o.color = c; changed(); }
  });
  $("swatches").append(i);
}
if (innerWidth <= 900) $("bProps").style.display = "";

// старт
load();
bindMapForm();
fillMapForm();
new ResizeObserver(() => { resize(); view3d.resize(); }).observe($("stage"));
resize();
fitView();
setTool("select");
changed(false);
if (!localStorage.getItem(STORE + ".seen")){ try { localStorage.setItem(STORE + ".seen", "1"); } catch {} $("help").showModal(); }

// для проверки со стенда
window.__editor = { get map(){ return S.map; }, gameData, runChecks };
