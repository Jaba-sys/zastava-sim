// state.js — состояние редактора: карта, выбор, отмена/возврат, сохранение в браузере.

import { $, STORE } from "./dom.js";
import { draw } from "./plan.js";
import { fillMapForm, renderSel } from "./panel.js";
import { runChecks } from "./checks.js";
import { view3d } from "./view3d.js";

// ---------------------------------------------------------------------------
// Состояние
// ---------------------------------------------------------------------------

export const S = { map: null, nextId: 1, selected: null, tool: "select", mirror: false, spaceDown: false, view: "top" };
export const undoStack = [], redoStack = [];

export function blankMap(){
  return {
    v: 1, id: "moya-karta", name: "Моя карта", subtitle: "Карта, сделанная в редакторе", hint: "",
    width: 80, depth: 56, floor: "#c9c2b0", sky: "#9fd0f0", light: "day", border: true,
    objects: []
  };
}

export function starterMap(){
  const m = blankMap();
  let id = 1;
  const o = x => ({ id: id++, ...x });
  m.objects = [
    o({ type: "spawn", team: "a", x: -34, z: -3 }), o({ type: "spawn", team: "a", x: -34, z: 3 }),
    o({ type: "spawn", team: "b", x: 34, z: -3 }),  o({ type: "spawn", team: "b", x: 34, z: 3 }),
    o({ type: "site", letter: "A", x: 20, z: -14 }), o({ type: "site", letter: "B", x: 20, z: 14 }),
    o({ type: "box", x: 0, z: 0, w: 6, d: 6, y: 0, h: 2.4, color: "#8e949e", decor: false }),
    o({ type: "ramp", x: 0, z: -7, w: 3, d: 8, y: 0, h: 2.4, dir: "+z", color: "#ffc83d" }),
    o({ type: "box", x: -12, z: -10, w: 2.4, d: 2.4, y: 0, h: 1.2, color: "#e0473c", decor: false }),
    o({ type: "box", x: 12, z: 10, w: 2.4, d: 2.4, y: 0, h: 1.2, color: "#3a7be0", decor: false })
  ];
  return m;
}

export function load(){
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || "null");
    if (saved?.v === 1 && Array.isArray(saved.objects)){ S.map = saved; }
    else S.map = starterMap();
  } catch { S.map = starterMap(); }
  S.nextId = Math.max(0, ...S.map.objects.map(o => o.id || 0)) + 1;
}
export function persist(){ try { localStorage.setItem(STORE, JSON.stringify(S.map)); } catch { /* ignore */ } }

export function snapshot(){
  undoStack.push(JSON.stringify(S.map));
  if (undoStack.length > 120) undoStack.shift();
  redoStack.length = 0;
}
export function undo(){
  if (!undoStack.length) return;
  redoStack.push(JSON.stringify(S.map));
  S.map = JSON.parse(undoStack.pop());
  S.selected = null; changed(false);
}
export function redo(){
  if (!redoStack.length) return;
  undoStack.push(JSON.stringify(S.map));
  S.map = JSON.parse(redoStack.pop());
  S.selected = null; changed(false);
}

export function changed(fillSettings = true){
  persist();
  if (fillSettings) fillMapForm();
  renderSel();
  runChecks();
  draw();
  if (S.view === "3d") view3d.rebuild();
}

export const byId = id => S.map.objects.find(o => o.id === id);
export const snapStep = () => Number($("snap").value) || 0.5;
export const snap = v => Math.round(v / snapStep()) * snapStep();
export const round2 = v => Math.round(v * 100) / 100;
