// panel.js — правая панель: свойства выбранного объекта и настройки карты.

import { $ } from "./dom.js";
import { S, byId, changed, round2, snapshot } from "./state.js";
import { topUnder } from "./geometry.js";
import { mirrored, removeObj } from "./plan.js";

// ---------------------------------------------------------------------------
// Панель выбранного
// ---------------------------------------------------------------------------

export const TYPE_NAMES = { box: "Блок", ramp: "Пандус", site: "Точка закладки", spawn: "Возрождение" };

export function renderSel(){
  const o = byId(S.selected);
  const box = $("selPanel");
  if (!o){ box.className = "muted"; box.textContent = "Ничего не выбрано. Инструмент «Выбор» (V) — кликни по объекту."; return; }
  box.className = "selbox";
  const num = (key, label, step = 0.5, min = -500) =>
    `<div class="row"><label>${label}</label><input type="number" data-k="${key}" value="${o[key]}" step="${step}" min="${min}"></div>`;
  let html = `<b>${TYPE_NAMES[o.type]}${o.type === "site" ? " " + o.letter : ""}${o.type === "spawn" ? (o.team === "a" ? " · террористы" : " · спецназ") : ""}</b>`;
  html += `<div class="pair">${num("x", "x")}${num("z", "z")}</div>`;
  if (o.type === "box" || o.type === "ramp"){
    html += `<div class="pair">${num("w", "Ш", 0.5, 0.25)}${num("d", "Г", 0.5, 0.25)}</div>`;
    html += `<div class="pair">${num("y", "Низ", 0.1, 0)}${num("h", o.type === "ramp" ? "Подъём" : "Выс.", 0.1, 0.1)}</div>`;
    html += `<div class="row"><label>Цвет</label><input type="color" data-k="color" value="${o.color}"></div>`;
  }
  if (o.type === "box"){
    html += `<div class="row"><label>Только вид</label><input type="checkbox" data-k="decor" ${o.decor ? "checked" : ""}><span class="muted">не преграда</span></div>`;
  }
  if (o.type === "ramp"){
    html += `<div class="row"><label>Подъём к</label><select data-k="dir">
      ${[["+x", "востоку →"], ["-x", "западу ←"], ["+z", "югу ↓"], ["-z", "северу ↑"]].map(([v, t]) =>
        `<option value="${v}" ${o.dir === v ? "selected" : ""}>${t}</option>`).join("")}</select></div>`;
  }
  if (o.type === "spawn"){
    html += `<div class="row"><label>Сторона</label><select data-k="team">
      <option value="a" ${o.team === "a" ? "selected" : ""}>Террористы</option>
      <option value="b" ${o.team === "b" ? "selected" : ""}>Спецназ</option></select></div>`;
  }
  html += `<div class="btnrow">
    ${o.type === "box" || o.type === "ramp" ? `<button class="btn" id="sStack" title="Поставить на верх того, что под ним">На верх</button>` : ""}
    ${o.type === "ramp" ? `<button class="btn" id="sRot" title="R">Повернуть</button>` : ""}
    ${o.type !== "site" ? `<button class="btn" id="sDup" title="Ctrl+D">Копия</button>` : ""}
    ${o.type !== "site" ? `<button class="btn" id="sMir" title="Копия на другой половине карты">Отразить</button>` : ""}
    <button class="btn" id="sDel" style="color:var(--danger)" title="Del">Удалить</button></div>`;
  box.innerHTML = html;

  box.querySelectorAll("[data-k]").forEach(el => {
    el.addEventListener("change", () => {
      snapshot();
      const k = el.dataset.k;
      if (el.type === "checkbox") o[k] = el.checked;
      else if (el.type === "number"){
        let v = Number(el.value);
        if (!Number.isFinite(v)) return;
        if (["w", "d"].includes(k)) v = Math.max(0.25, v);
        if (k === "h") v = Math.max(0.1, v);
        if (k === "y") v = Math.max(0, v);
        o[k] = round2(v);
      } else o[k] = el.value;
      changed();
    });
  });
  $("sDel")?.addEventListener("click", () => { snapshot(); removeObj(o); changed(); });
  $("sDup")?.addEventListener("click", duplicate);
  $("sRot")?.addEventListener("click", rotateSel);
  $("sMir")?.addEventListener("click", () => { snapshot(); const m = mirrored(o); S.map.objects.push(m); S.selected = m.id; changed(); });
  $("sStack")?.addEventListener("click", () => {
    snapshot();
    const others = S.map.objects.filter(x => x !== o);
    const keep = S.map.objects; S.map.objects = others;
    o.y = round2(topUnder(o.x, o.z, o.w, o.d));
    S.map.objects = keep;
    changed();
  });
}

export function duplicate(){
  const o = byId(S.selected);
  if (!o || o.type === "site") return;
  snapshot();
  const c = { ...o, id: S.nextId++, x: round2(o.x + 2), z: round2(o.z + 2) };
  S.map.objects.push(c); S.selected = c.id; changed();
}
export function rotateSel(){
  const o = byId(S.selected);
  if (!o) return;
  snapshot();
  if (o.type === "ramp"){
    const order = ["+x", "+z", "-x", "-z"];
    o.dir = order[(order.indexOf(o.dir) + 1) % 4];
    if ((o.dir[1] === "x") !== (o.w >= o.d)) [o.w, o.d] = [o.d, o.w];
  } else if (o.type === "box") [o.w, o.d] = [o.d, o.w];
  changed();
}

// ---------------------------------------------------------------------------
// Настройки карты
// ---------------------------------------------------------------------------

export function translit(s){
  const t = { а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"e",ж:"zh",з:"z",и:"i",й:"y",к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",
    с:"s",т:"t",у:"u",ф:"f",х:"h",ц:"c",ч:"ch",ш:"sh",щ:"sch",ъ:"",ы:"y",ь:"",э:"e",ю:"yu",я:"ya",і:"i",ї:"yi",є:"e",ґ:"g" };
  return s.toLowerCase().split("").map(c => t[c] ?? c).join("").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 16) || "karta";
}

export function fillMapForm(){
  $("mName").value = S.map.name; $("mId").value = S.map.id; $("mSub").value = S.map.subtitle; $("mHint").value = S.map.hint;
  $("mW").value = S.map.width; $("mD").value = S.map.depth; $("mFloor").value = S.map.floor; $("mSky").value = S.map.sky;
  $("mLight").value = S.map.light; $("mBorder").checked = S.map.border;
}
export function bindMapForm(){
  const on = (id, fn) => $(id).addEventListener("change", () => { snapshot(); fn($(id)); changed(); });
  on("mName", el => { const auto = S.map.id === translit(S.map.name); S.map.name = el.value.trim() || "Моя карта"; if (auto) S.map.id = translit(S.map.name); });
  on("mId", el => { S.map.id = translit(el.value); });
  on("mSub", el => { S.map.subtitle = el.value.trim(); });
  on("mHint", el => { S.map.hint = el.value.trim(); });
  on("mW", el => { S.map.width = Math.max(30, Math.min(200, Math.round(Number(el.value) || 80))); });
  on("mD", el => { S.map.depth = Math.max(30, Math.min(200, Math.round(Number(el.value) || 56))); });
  on("mFloor", el => { S.map.floor = el.value; });
  on("mSky", el => { S.map.sky = el.value; });
  on("mLight", el => { S.map.light = el.value; });
  on("mBorder", el => { S.map.border = el.checked; });
}
