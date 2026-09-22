// dom.js — мелочи для страницы: $(id), ключ сохранения, палитра цветов, всплывающая подсказка.

// ===========================================================================
// Редактор карт «Заставы».
//
// Карта — это список прямоугольных блоков, пандусов, двух точек закладки и
// точек возрождения. Ровно из таких кусков сложены и карты самой игры
// (js/game/maps/builder.js), поэтому всё, что построено здесь, в игре
// выглядит и работает так же. Файл карты — обычный JSON; создатель игры
// открывает его здесь же и жмёт «Файл для игры (.js)».
// ===========================================================================

export const $ = id => document.getElementById(id);
export const STORE = "zastava.mapEditor.v1";

export const PALETTE = ["#8e949e", "#3a3f4a", "#f2f3f5", "#c9c2b0", "#8a6a3a", "#6b4a2c", "#57411f",
  "#e0473c", "#3a7be0", "#e8a317", "#ffc83d", "#3f8f4f", "#2e6ea6", "#c0392b", "#7b4ea3", "#1fb5a8"];

export let toastTimer = null;
export function toast(text){
  $("toast").textContent = text; $("toast").classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $("toast").classList.remove("show"), 2600);
}

