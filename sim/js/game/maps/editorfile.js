// editorfile.js — файл карты из редактора (.zmap.json) → карта для игры.
//
// Редактор карт (editor/, zastava-maps на GitHub) сохраняет карту как список
// объектов: блоки, пандусы, точки A/B, возрождения. Игра строит карты из
// «данных» (fromdata.js). Здесь — перевод одного в другое и проверка, что по
// карте вообще можно играть: без точек, без возрождений или с гигантским
// числом блоков карту не запускаем, а говорим, что не так.
//
// Тот же перевод делает и сам редактор (кнопка «Файл для игры»), поэтому
// правила «где стоит боец» здесь такие же: на верху самого высокого блока или
// пандуса под точкой.

const LIMITS = { objects: 900, minSize: 30, maxSize: 200 };

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const r2 = v => Math.round(v * 100) / 100;
const color = c => (/^#[0-9a-fA-F]{6}$/.test(String(c)) ? String(c) : "#8e949e");

function covers(o, x, z){
  return x >= o.x - o.w / 2 && x <= o.x + o.w / 2 && z >= o.z - o.d / 2 && z <= o.z + o.d / 2;
}
function rampHeightAt(o, x, z){
  let t;
  if (o.dir === "+x") t = (x - (o.x - o.w / 2)) / o.w;
  else if (o.dir === "-x") t = ((o.x + o.w / 2) - x) / o.w;
  else if (o.dir === "+z") t = (z - (o.z - o.d / 2)) / o.d;
  else t = ((o.z + o.d / 2) - z) / o.d;
  return o.y + Math.max(0, Math.min(1, t)) * o.h;
}
function groundAt(objects, x, z){
  let top = 0;
  for (const o of objects){
    if (o.type === "box" && !o.decor && covers(o, x, z)) top = Math.max(top, o.y + o.h);
    if (o.type === "ramp" && covers(o, x, z)) top = Math.max(top, rampHeightAt(o, x, z));
  }
  return top;
}

/**
 * Разобрать файл. Возвращает { ok: true, data, name } или { ok: false, error }.
 * Понимает и файл редактора (objects), и уже готовые данные (boxes).
 */
export function readMapFile(text){
  let json;
  try { json = typeof text === "string" ? JSON.parse(text) : text; }
  catch { return { ok: false, error: "Это не файл карты (не читается как JSON)." }; }
  if (!json || typeof json !== "object") return { ok: false, error: "Пустой файл." };

  const data = Array.isArray(json.objects) ? fromEditor(json) : Array.isArray(json.boxes) ? json : null;
  if (!data) return { ok: false, error: "Не похоже на карту «Заставы». Сделай её в редакторе карт и нажми «Скачать карту»." };

  const [W, D] = data.size || [];
  if (!(W >= LIMITS.minSize && W <= LIMITS.maxSize && D >= LIMITS.minSize && D <= LIMITS.maxSize))
    return { ok: false, error: `Размер карты — от ${LIMITS.minSize} до ${LIMITS.maxSize} м.` };
  const count = (data.boxes?.length || 0) + (data.ramps?.length || 0);
  if (count > LIMITS.objects) return { ok: false, error: `Слишком много блоков: ${count} (можно до ${LIMITS.objects}).` };
  if ((data.sites || []).length !== 2) return { ok: false, error: "На карте нужны обе точки закладки — A и B." };
  if ((data.spawnsA || []).length < 2 || (data.spawnsB || []).length < 2)
    return { ok: false, error: "Нужно минимум по 2 точки возрождения на каждую сторону." };

  // Всё, что пришло извне, приводим к числам и длинам — в базу и в сцену
  // попадает только то, что мы сами понимаем.
  const clean = {
    v: 1, id: "custom",
    name: String(data.name || "Своя карта").slice(0, 40),
    subtitle: String(data.subtitle || "Карта игрока").slice(0, 80),
    hint: String(data.hint || "").slice(0, 160),
    size: [num(W), num(D)],
    floor: color(data.floor), sky: color(data.sky),
    light: ["day", "evening", "night"].includes(data.light) ? data.light : "day",
    border: data.border !== false,
    boxes: (data.boxes || []).map(b => [r2(num(b[0])), r2(Math.max(0, num(b[1]))), r2(num(b[2])),
      r2(Math.max(0.05, num(b[3], 1))), r2(Math.max(0.05, num(b[4], 1))), r2(Math.max(0.05, num(b[5], 1))), color(b[6]), b[7] ? 1 : 0]),
    ramps: (data.ramps || []).map(r => [r2(num(r[0])), r2(num(r[1])), r2(num(r[2])), r2(num(r[3])), r2(num(r[4])), r2(num(r[5])),
      r2(Math.max(0.5, num(r[6], 2))), color(r[7]), r2(Math.max(0, num(r[8])))]),
    sites: data.sites.slice(0, 2).map(p => [r2(num(p[0])), r2(num(p[1], 0.1)), r2(num(p[2]))]),
    spawnsA: data.spawnsA.slice(0, 8).map(p => [r2(num(p[0])), r2(num(p[1], 0.1)), r2(num(p[2]))]),
    spawnsB: data.spawnsB.slice(0, 8).map(p => [r2(num(p[0])), r2(num(p[1], 0.1)), r2(num(p[2]))])
  };
  return { ok: true, data: clean, name: clean.name };
}

/** Объекты редактора → данные игры (как «Файл для игры» в редакторе). */
function fromEditor(m){
  const objs = m.objects.filter(o => o && typeof o === "object").map(o => ({
    ...o, x: num(o.x), z: num(o.z), y: num(o.y), w: num(o.w, 1), d: num(o.d, 1), h: num(o.h, 1)
  }));
  const stand = p => [r2(p.x), r2(groundAt(objs, p.x, p.z) + 0.1), r2(p.z)];
  const ramps = objs.filter(o => o.type === "ramp").map(o => {
    const x0 = o.x - o.w / 2, x1 = o.x + o.w / 2, z0 = o.z - o.d / 2, z1 = o.z + o.d / 2;
    const lo = o.y, hi = o.y + o.h;
    if (o.dir === "+x") return [x0, lo, o.z, x1, hi, o.z, o.d, o.color, o.y];
    if (o.dir === "-x") return [x1, lo, o.z, x0, hi, o.z, o.d, o.color, o.y];
    if (o.dir === "+z") return [o.x, lo, z0, o.x, hi, z1, o.w, o.color, o.y];
    return [o.x, lo, z1, o.x, hi, z0, o.w, o.color, o.y];
  });
  const site = l => objs.find(o => o.type === "site" && o.letter === l);
  return {
    name: m.name, subtitle: m.subtitle, hint: m.hint,
    size: [num(m.width, 80), num(m.depth, 56)], floor: m.floor, sky: m.sky, light: m.light, border: m.border,
    boxes: objs.filter(o => o.type === "box").map(o => [o.x, o.y, o.z, o.w, o.h, o.d, o.color, o.decor ? 1 : 0]),
    ramps,
    sites: ["A", "B"].map(site).filter(Boolean).map(stand),
    spawnsA: objs.filter(o => o.type === "spawn" && o.team === "a").map(stand),
    spawnsB: objs.filter(o => o.type === "spawn" && o.team === "b").map(stand)
  };
}
