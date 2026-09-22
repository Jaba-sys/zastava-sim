// skins.js — скины оружия и уровень игрока. Без Three: это просто данные,
// и лобби читает их сразу, не дожидаясь загрузки движка.

/**
 * Скины открываются уровнем, а не покупкой. Уровень считается из очков,
 * которые и так копятся в карточке игрока, — поэтому для скинов не нужно ни
 * нового поля в базе, ни новых правил: подделать уровень можно ровно в той же
 * мере, что и очки, то есть никак (их правила уже стерегут).
 */
export const SKINS = [
  { id: "base",    name: "Заводской",     level: 1,  swatch: "linear-gradient(135deg,#2c3034 0 45%,#7a4a26 45% 100%)", about: "Как с завода: воронёная сталь и дерево" },
  { id: "forest",  name: "Лес",           level: 2,  swatch: "radial-gradient(circle at 30% 30%,#2a3020 0 18%,transparent 19%),radial-gradient(circle at 70% 65%,#8a7a52 0 20%,transparent 21%),radial-gradient(circle at 60% 20%,#6f6a44 0 16%,transparent 17%),#4a5a32", about: "Пятнистый камуфляж, зелень и глина" },
  { id: "desert",  name: "Пустыня",       level: 4,  swatch: "radial-gradient(circle at 30% 35%,#8a6a44 0 18%,transparent 19%),radial-gradient(circle at 72% 62%,#e0cfa2 0 22%,transparent 23%),radial-gradient(circle at 62% 22%,#a78455 0 15%,transparent 16%),#c8a978", about: "Песок, охра и выгоревший хаки" },
  { id: "winter",  name: "Зима",          level: 6,  swatch: "radial-gradient(circle at 30% 35%,#5e666e 0 16%,transparent 17%),radial-gradient(circle at 70% 60%,#9aa3ab 0 20%,transparent 21%),#e6eaee", about: "Снег с серыми разводами" },
  { id: "damascus", name: "Дамаск",       level: 5,  swatch: "repeating-radial-gradient(ellipse at 30% 120%,#d9dbe0 0 3px,#6d7078 3px 6px)", about: "Слоёная сталь с волнистым узором" },
  { id: "urban",   name: "Город",         level: 8,  swatch: "radial-gradient(circle at 30% 35%,#25282b 0 16%,transparent 17%),radial-gradient(circle at 70% 60%,#9da1a4 0 20%,transparent 21%),radial-gradient(circle at 55% 20%,#3d4145 0 14%,transparent 15%),#6c7075", about: "Бетон, асфальт, графит" },
  { id: "tiger",   name: "Тигр",          level: 10, swatch: "repeating-linear-gradient(100deg,#d66e20 0 9px,#161210 9px 13px)", about: "Рыжий с чёрными полосами" },
  { id: "carbon",  name: "Карбон",        level: 13, swatch: "repeating-conic-gradient(#3a3d44 0 25%,#1d1f23 0 50%) 0 0/10px 10px", about: "Плетёное углеволокно" },
  { id: "redline", name: "Красная линия", level: 16, swatch: "linear-gradient(160deg,transparent 46%,#e0202c 47% 50%,transparent 51%),linear-gradient(20deg,transparent 60%,#e0202c 61% 63%,transparent 64%),#18181a", about: "Чёрный полимер и алые прожилки" },
  { id: "ruby",    name: "Рубин",         level: 12, swatch: "linear-gradient(135deg,#5a0612,#e8203c 45%,#ff90a4 50%,#8a0a1c 60%)", about: "Густо-красный кристалл с яркими гранями" },
  { id: "gold",    name: "Золото",        level: 20, swatch: "linear-gradient(135deg,#8a6420,#f6d27a 45%,#b8862e 60%,#ffe6a0)", about: "Полированное золото. Видно издалека" },
  { id: "neon",    name: "Неон",          level: 25, swatch: "linear-gradient(135deg,#28f0ff,#1a1026 40%,#1a1026 60%,#ff3cdc)", about: "Светящиеся соты. Для тех, кто дошёл" }
];
// По порядку уровней: «следующий скин» ищется первым с уровнем выше текущего.
SKINS.sort((a, b) => a.level - b.level);
export const skinById = id => SKINS.find(s => s.id === id) || SKINS[0];

// Уровень: очки → уровень. Шаг растёт: второй уровень — 8 убийств, десятый —
// около 360, двадцать пятый — 2400. Как в любом шутере с прокачкой: первые
// награды быстро, последние — для упорных.
const XP_K = 40;
export const xpForLevel = level => XP_K * level * (level - 1);
export function levelOf(points = 0){
  let level = 1;
  while (level < 99 && points >= xpForLevel(level + 1)) level++;
  const from = xpForLevel(level), to = xpForLevel(level + 1);
  return { level, from, to, progress: Math.min(1, (points - from) / (to - from)) };
}
export const skinOpen = (skinId, points) => levelOf(points).level >= skinById(skinId).level;

// Выбор скина — на этом устройстве. Скин виден только тебе (в руках и в
// оружейной), поэтому синхронизировать его через базу незачем.
const SKIN_KEY = "zastava.skins";
export function readSkins(){
  try { return JSON.parse(localStorage.getItem(SKIN_KEY) || "{}") || {}; }
  catch { return {}; }
}
export function saveSkin(weaponId, skinId){
  const all = readSkins();
  all[weaponId] = skinId;
  try { localStorage.setItem(SKIN_KEY, JSON.stringify(all)); } catch { /* не смертельно */ }
  return all;
}
/** Скин ствола с учётом уровня: закрытый (например, после сброса) не отдаём. */
export function skinFor(weaponId, points){
  const id = readSkins()[weaponId] || "base";
  return skinOpen(id, points) ? id : "base";
}

