// files.js — файлы: скачать карту (.zmap.json), открыть, «Файл для игры (.js)».

import { $, toast } from "./dom.js";
import { S, blankMap, changed, round2, snapshot, starterMap } from "./state.js";
import { groundAt } from "./geometry.js";
import { fitView } from "./plan.js";
import { runChecks } from "./checks.js";

// ---------------------------------------------------------------------------
// Файлы
// ---------------------------------------------------------------------------

export function download(name, text, type = "application/json"){
  const blob = new Blob([text], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Карта в формате игры (js/game/maps/fromdata.js). */
export function gameData(){
  const f = v => round2(v);
  const standY = p => f(groundAt(p.x, p.z) + 0.1);
  const boxes = S.map.objects.filter(o => o.type === "box")
    .map(o => [f(o.x), f(o.y), f(o.z), f(o.w), f(o.h), f(o.d), o.color, o.decor ? 1 : 0]);
  const ramps = S.map.objects.filter(o => o.type === "ramp").map(o => {
    const x0 = o.x - o.w / 2, x1 = o.x + o.w / 2, z0 = o.z - o.d / 2, z1 = o.z + o.d / 2;
    const lo = o.y, hi = o.y + o.h;
    // от нижнего края к верхнему, по середине; ширина — поперёк подъёма
    if (o.dir === "+x") return [f(x0), f(lo), f(o.z), f(x1), f(hi), f(o.z), f(o.d), o.color, f(o.y)];
    if (o.dir === "-x") return [f(x1), f(lo), f(o.z), f(x0), f(hi), f(o.z), f(o.d), o.color, f(o.y)];
    if (o.dir === "+z") return [f(o.x), f(lo), f(z0), f(o.x), f(hi), f(z1), f(o.w), o.color, f(o.y)];
    return [f(o.x), f(lo), f(z1), f(o.x), f(hi), f(z0), f(o.w), o.color, f(o.y)];
  });
  const site = l => S.map.objects.find(o => o.type === "site" && o.letter === l);
  const sites = ["A", "B"].map(site).filter(Boolean).map(p => [f(p.x), standY(p), f(p.z)]);
  const sp = t => S.map.objects.filter(o => o.type === "spawn" && o.team === t).map(p => [f(p.x), standY(p), f(p.z)]);
  return {
    v: 1, id: S.map.id, name: S.map.name, subtitle: S.map.subtitle, hint: S.map.hint,
    size: [S.map.width, S.map.depth], floor: S.map.floor, sky: S.map.sky, light: S.map.light, border: S.map.border,
    boxes, ramps, sites, spawnsA: sp("a"), spawnsB: sp("b")
  };
}

$("bSave").addEventListener("click", () => {
  const ok = runChecks();
  if (!ok && !confirm("В проверке есть красные пункты — в игре карта может не заработать. Всё равно скачать?")) return;
  download(`${S.map.id}.zmap.json`, JSON.stringify({ ...S.map, editor: "zastava-map-editor" }, null, 1));
  toast("Файл карты скачан — отправь его создателю игры.");
});

$("bGame").addEventListener("click", () => {
  const ok = runChecks();
  if (!ok && !confirm("В проверке есть красные пункты. Всё равно сделать файл для игры?")) return;
  const data = gameData();
  const text = `// Карта «${S.map.name.replace(/[\r\n]/g, " ")}» — сделана в редакторе карт «Заставы» (editor/index.html).
//
// Положи этот файл в js/game/maps/ и допиши в js/game/maps/index.js:
//   import * as ${jsName(S.map.id)} from "./${S.map.id}.js";
// и добавь ${jsName(S.map.id)} в MAPS, а ${jsName(S.map.id)}.meta — в MAP_LIST.

import { mapFromData } from "./fromdata.js";

export const DATA = ${JSON.stringify(data, null, 1)};

export const made = mapFromData(DATA);
export const meta = made.meta;
export const build = made.build;
`;
  download(`${S.map.id}.js`, text, "text/javascript");
  toast("Файл для игры скачан.");
});
export const jsName = id => id.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase()).replace(/[^a-zA-Z0-9]/g, "") .replace(/^(\d)/, "m$1") || "customMap";

$("bOpen").addEventListener("click", () => $("fileIn").click());
$("fileIn").addEventListener("change", async () => {
  const file = $("fileIn").files[0];
  $("fileIn").value = "";
  if (file) openFile(file);
});

/**
 * Открыть файл карты. Понимает три вида файлов:
 *   .zmap.json         — файл этого редактора («Скачать карту»);
 *   .js                — «Файл для игры» (данные внутри, const DATA = …);
 *   JSON с boxes/ramps — те же данные игры без обёртки.
 */
export async function openFile(file){
  try {
    if (file.size > 3_000_000) throw new Error("файл слишком большой");
    loadMap(parseMapText(await file.text()), file.name);
  } catch (e){ toast("Не удалось открыть: " + e.message); }
}

export function parseMapText(text){
  let t = text.trim();
  if (!t.startsWith("{")){
    const i = t.indexOf("const DATA = ");
    if (i < 0) throw new Error("не похоже на карту «Заставы»");
    const j = t.indexOf("};", i);
    t = t.slice(i + "const DATA = ".length, j + 1);
  }
  const data = JSON.parse(t);
  if (Array.isArray(data?.objects)) return data;
  if (Array.isArray(data?.boxes)) return fromGameData(data);
  throw new Error("не похоже на карту «Заставы»");
}

/** Данные игры (boxes/ramps/sites/spawns) → объекты редактора. */
export function fromGameData(d){
  let id = 1;
  const objects = [];
  for (const [x, y, z, w, h, dd, color, decor] of d.boxes || [])
    objects.push({ id: id++, type: "box", x, z, w, d: dd, y, h, color, decor: !!decor });
  for (const [x1, y1, z1, x2, y2, z2, width, color, base = 0] of d.ramps || []){
    const alongX = Math.abs(x2 - x1) >= Math.abs(z2 - z1);
    const len = alongX ? Math.abs(x2 - x1) : Math.abs(z2 - z1);
    const dir = alongX ? (x2 > x1 ? "+x" : "-x") : (z2 > z1 ? "+z" : "-z");
    objects.push({ id: id++, type: "ramp", x: round2((x1 + x2) / 2), z: round2((z1 + z2) / 2),
      w: round2(alongX ? len : width), d: round2(alongX ? width : len), y: base, h: round2(Math.max(0.1, y2 - base)), dir, color });
  }
  (d.sites || []).forEach((p, i) => objects.push({ id: id++, type: "site", letter: i ? "B" : "A", x: p[0], z: p[2] }));
  for (const p of d.spawnsA || []) objects.push({ id: id++, type: "spawn", team: "a", x: p[0], z: p[2] });
  for (const p of d.spawnsB || []) objects.push({ id: id++, type: "spawn", team: "b", x: p[0], z: p[2] });
  const [width, depth] = d.size || [80, 56];
  return { v: 1, id: d.id || "karta", name: d.name, subtitle: d.subtitle, hint: d.hint, width, depth,
    floor: d.floor, sky: d.sky, light: d.light, border: d.border, objects };
}

/** Поставить карту в редактор (с возможностью отменить). */
export function loadMap(data, label = ""){
  snapshot();
  S.map = { ...blankMap(), ...data };
  delete S.map.editor;
  S.map.objects = S.map.objects.filter(o => ["box", "ramp", "site", "spawn"].includes(o.type));
  S.map.objects.forEach((o, i) => { if (!o.id) o.id = i + 1; });
  S.nextId = Math.max(0, ...S.map.objects.map(o => o.id || 0)) + 1;
  S.selected = null; fitView(); changed();
  toast(`Открыта карта «${S.map.name}»${label ? " — " + label : ""}. Ctrl+Z — вернуть прежнюю.`);
}

// Файл можно просто бросить на страницу.
addEventListener("dragover", e => { if (e.dataTransfer?.types?.includes("Files")) e.preventDefault(); });
addEventListener("drop", e => {
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  e.preventDefault();
  openFile(file);
});

// Карты самой игры — как заготовки: открыть, поменять, сохранить под своим именем.
$("officialMaps")?.addEventListener("change", async () => {
  const id = $("officialMaps").value;
  $("officialMaps").value = "";
  if (!id) return;
  try {
    const res = await fetch(`maps/${id}.zmap.json`);
    if (!res.ok) throw new Error("файл не найден");
    const data = await res.json();
    data.id = data.id + "-moya";
    data.name = data.name + " (моя)";
    loadMap(data, "карта игры как заготовка");
  } catch (e){ toast("Не удалось загрузить: " + e.message); }
});


$("bNew").addEventListener("click", () => {
  if (!confirm("Начать новую карту? Текущую сначала лучше скачать.")) return;
  snapshot(); S.map = starterMap(); S.nextId = 100; S.selected = null; fitView(); changed();
});

// Симулятор карт — отдельный сайт рядом (zastava-sim на GitHub или /sim/ на
// сайте игры). Карту передаём через хранилище браузера: у сайтов общий адрес
// (jaba-sys.github.io или zastava.web.app), поэтому симулятор её видит.
export const SIM_URL = location.pathname.includes("/zastava-maps") ? "../zastava-sim/" : "../sim/";
$("bSim")?.addEventListener("click", () => {
  try { localStorage.setItem("zastava.simMap", JSON.stringify(S.map)); } catch { /* ignore */ }
  window.open(SIM_URL + "?from=editor", "_blank", "noopener");
});
