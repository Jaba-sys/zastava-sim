// gunmodels.js — модели оружия: и в руках от первого лица, и в оружейной лобби.
//
// Ни одного загруженного файла. Модели собраны из выдавленных силуэтов
// (ExtrudeGeometry с фаской) и цилиндров, текстуры рисуются на холсте при
// первом обращении. Так они:
//   • грузятся мгновенно — ни мегабайтов .glb, ни ожидания на мобильном;
//   • не несут чужих лицензий — всё нарисовано здесь, с нуля;
//   • перекрашиваются скином на лету: камуфляж — это просто другая текстура
//     на тех же деталях.
//
// Оси. Ствол смотрит вдоль −Z, начало координат — у спускового крючка, там,
// где правая рука держит рукоять. Силуэты удобнее задавать «сбоку», поэтому
// в profile() координата x — это «вперёд по стволу» (мир: −z), y — вверх.
//
// Габариты подобраны под камеру от первого лица: затылок приклада не дальше
// +0.34 назад (ближе к объективу — раздувается на пол-экрана), дуло — около
// −0.6 вперёд. Винтовка длиннее, но у неё и прицел, при котором модель прячут.

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js";

// Список скинов и уровни — в skins.js: они нужны лобби ещё до того, как
// загружен Three, и тянуть ради списка названий целый движок незачем.
export { SKINS, skinById, levelOf, skinFor } from "./skins.js";

// ---------------------------------------------------------------------------
// Текстуры на холсте
// ---------------------------------------------------------------------------

const TEX = 256;

// Шум по решётке с гладкой интерполяцией. Свой, крошечный: тянуть библиотеку
// ради нескольких текстур незачем.
function makeNoise(seed){
  const perm = new Float32Array(256 * 256);
  let s = seed * 9301 + 49297;
  for (let i = 0; i < perm.length; i++){ s = (s * 9301 + 49297) % 233280; perm[i] = s / 233280; }
  const at = (x, y) => perm[((y & 255) << 8) | (x & 255)];
  const smooth = t => t * t * (3 - 2 * t);
  // Периодичный fbm: период кратен размеру холста, поэтому текстура
  // бесшовно повторяется — на стволе не видно стыков плиток.
  return (x, y, octaves = 4, base = 8) => {
    let sum = 0, amp = 0.5, total = 0, f = base;
    for (let o = 0; o < octaves; o++){
      const period = f;
      const u = x * f, v = y * f;
      // оборачиваем решётку по периоду
      const xi = Math.floor(u), yi = Math.floor(v);
      const fx = u - xi, fy = v - yi;
      const w = (i, j) => at(((i % period) + period) % period + o * 31, ((j % period) + period) % period + o * 17);
      const sx = smooth(fx), sy = smooth(fy);
      const a = w(xi, yi), b = w(xi + 1, yi), c = w(xi, yi + 1), d = w(xi + 1, yi + 1);
      sum += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
      total += amp; amp *= 0.5; f *= 2;
    }
    return sum / total;
  };
}

const hex = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

/** Рисует холст по функции пикселя (u, v) → [r, g, b]. */
function paint(fn){
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = TEX;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(TEX, TEX);
  for (let y = 0; y < TEX; y++){
    for (let x = 0; x < TEX; x++){
      const [r, g, b] = fn(x / TEX, y / TEX, x, y);
      const i = (y * TEX + x) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function texture(canvas, color = true){
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const cache = new Map();
function cached(key, make){
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

/** Воронёная сталь: тёмная, с продольными следами шлифовки и потёртостями. */
function steelMaps(){
  return cached("steel", () => {
    const n = makeNoise(3);
    const rough = [];
    const color = paint((u, v) => {
      const streak = n(u * 0.05, v, 3, 32);            // вытянутые вдоль u полосы
      const wear = n(u, v, 4, 4);
      const scratch = Math.max(0, n(u * 0.3, v * 3, 2, 16) - 0.72) * 3;
      const k = 0.78 + streak * 0.22 + scratch * 0.35 + Math.max(0, wear - 0.62) * 0.5;
      rough.push(Math.min(255, 110 + streak * 70 - scratch * 60 + wear * 40));
      return [78 * k, 84 * k, 90 * k];
    });
    let i = 0;
    const roughness = paint(() => { const r = rough[i++]; return [r, r, r]; });
    return { map: texture(color), roughnessMap: texture(roughness, false) };
  });
}

/** Орех: волокна с «завитками» от сучков и лёгкие тёмные поры. */
function woodMaps(){
  return cached("wood", () => {
    const n = makeNoise(7);
    const color = paint((u, v) => {
      const warp = n(u, v, 3, 2) * 2.5 + n(u, v, 2, 8) * 0.6;
      const ring = Math.sin((v * 36 + warp) * Math.PI);
      const grain = 0.5 + 0.5 * ring;
      const pore = n(u * 4, v * 0.5, 2, 32) > 0.7 ? 0.82 : 1;
      const k = (0.72 + grain * 0.28) * pore;
      return [128 * k, 74 * k, 38 * k];
    });
    return { map: texture(color) };
  });
}

/** Полимер: матовый, с мелкой «шагренью», как у настоящих рукоятей. */
function polymerMaps(tone = [34, 36, 34]){
  return cached("poly" + tone, () => {
    const n = makeNoise(11);
    const color = paint((u, v) => {
      const k = 0.88 + n(u, v, 3, 64) * 0.2 + n(u, v, 2, 4) * 0.06;
      return tone.map(c => c * k);
    });
    return { map: texture(color) };
  });
}

/** Камуфляж: четыре цвета пятнами из порогов двух масштабов шума. */
function camoMaps(id, palette, seed, scale = 3){
  return cached("camo" + id, () => {
    const n = makeNoise(seed);
    const cols = palette.map(hex);
    const color = paint((u, v) => {
      const a = n(u, v, 4, scale);
      const b = n(u + 0.37, v + 0.11, 4, scale * 2);
      let idx = 0;
      if (a > 0.54) idx = 1;
      if (b > 0.58) idx = 2;
      if (a < 0.4 && b < 0.47) idx = 3;
      const k = 0.94 + n(u, v, 2, 64) * 0.1;
      return cols[idx].map(c => c * k);
    });
    return { map: texture(color) };
  });
}

function tigerMaps(){
  return cached("tiger", () => {
    const n = makeNoise(19);
    const color = paint((u, v) => {
      const s = Math.sin((u * 9 + n(u, v, 3, 3) * 3.2) * Math.PI * 2);
      const stripe = s > 0.55 && n(u, v, 2, 4) > 0.3;
      const k = 0.9 + n(u, v, 2, 64) * 0.15;
      return stripe ? [22 * k, 18 * k, 14 * k] : [214 * k, 110 * k, 32 * k];
    });
    return { map: texture(color) };
  });
}

function carbonMaps(){
  return cached("carbon", () => {
    const rough = [];
    const color = paint((u, v, x, y) => {
      const cell = 16;
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
      const fx = (x % cell) / cell, fy = (y % cell) / cell;
      const horizontal = (cx + cy) % 2 === 0;
      const t = horizontal ? fy : fx;
      const shade = 0.55 + 0.45 * Math.sin(t * Math.PI);
      rough.push(80 + (1 - shade) * 90);
      const k = horizontal ? 1 : 0.8;
      return [58 * shade * k + 18, 60 * shade * k + 18, 66 * shade * k + 22];
    });
    let i = 0;
    const roughness = paint(() => { const r = rough[i++]; return [r, r, r]; });
    return { map: texture(color), roughnessMap: texture(roughness, false) };
  });
}

function redlineMaps(){
  return cached("redline", () => {
    const n = makeNoise(23);
    const glow = [];
    const color = paint((u, v) => {
      const line = Math.abs(n(u, v, 4, 2) - 0.5) < 0.018 || Math.abs(n(u + 0.5, v, 3, 3) - 0.5) < 0.012;
      glow.push(line ? 1 : 0);
      const k = 0.9 + n(u, v, 2, 64) * 0.15;
      return line ? [210, 24, 30] : [22 * k, 22 * k, 24 * k];
    });
    let i = 0;
    const emissive = paint(() => { const g = glow[i++]; return [g * 140, 0, g * 8]; });
    return { map: texture(color), emissiveMap: texture(emissive) };
  });
}

function goldMaps(){
  return cached("gold", () => {
    const n = makeNoise(29);
    const color = paint((u, v) => {
      const k = 0.85 + n(u * 0.05, v, 3, 32) * 0.2 + n(u, v, 3, 4) * 0.08;
      return [236 * k, 180 * k, 72 * k];
    });
    return { map: texture(color) };
  });
}

function neonMaps(){
  return cached("neon", () => {
    const glow = [];
    const color = paint((u, v) => {
      // соты: расстояние до центра ближайшей шестиугольной ячейки
      const s = 16, x = u * s, y = v * s * 1.1547;
      const row = Math.floor(y), off = row % 2 ? 0.5 : 0;
      const cx = Math.floor(x - off) + 0.5 + off, cy = row + 0.5;
      const d = Math.max(Math.abs(x - cx), Math.abs(y - cy) * 0.9);
      const edge = d > 0.43 ? 1 : 0;
      const hue = (u + v) % 1;
      const c = hue < 0.5 ? [40, 240, 255] : [255, 60, 220];
      glow.push(edge ? c : [0, 0, 0]);
      return edge ? c : [16, 14, 26];
    });
    let i = 0;
    const emissive = paint(() => glow[i++]);
    return { map: texture(color), emissiveMap: texture(emissive) };
  });
}

/** Дамасская сталь: волнистые слои светлого и тёмного металла. */
function damascusMaps(){
  return cached("damascus", () => {
    const n = makeNoise(31);
    const color = paint((u, v) => {
      const w = Math.sin((v * 26 + n(u, v, 4, 3) * 5 + u * 3) * Math.PI);
      const k = 0.55 + 0.45 * (0.5 + 0.5 * w);
      return [150 * k + 30, 152 * k + 30, 158 * k + 34];
    });
    return { map: texture(color) };
  });
}

/** Рубин: густо-красный кристалл с яркими гранями. */
function rubyMaps(){
  return cached("ruby", () => {
    const n = makeNoise(37);
    const glow = [];
    const color = paint((u, v) => {
      const f = n(u, v, 4, 5);
      const facet = Math.abs(Math.sin(f * 30)) > 0.92;
      glow.push(facet ? 1 : 0.15 * f);
      return facet ? [255, 120, 140] : [150 * f + 60, 8, 24 + 20 * f];
    });
    let i = 0;
    const emissive = paint(() => { const g = glow[i++]; return [200 * g, 10 * g, 40 * g]; });
    return { map: texture(color), emissiveMap: texture(emissive) };
  });
}

// ---------------------------------------------------------------------------
// Материалы
// ---------------------------------------------------------------------------

/** Что стоит на «мебели» ствола (приклад, цевьё, рукоять) без скина. */
const FURNITURE = { rifle: "wood", smg: "poly", shotgun: "wood", sniper: "olive", lmg: "poly",
  knife: "poly", bayonet: "wood", karambit: "poly", butterfly: "poly", nade: "olive", bomb: "olive" };
const KNIFE_IDS = ["knife", "bayonet", "karambit", "butterfly"];

function furnitureMaterial(kind){
  if (kind === "wood")  return new THREE.MeshStandardMaterial({ ...woodMaps(), roughness: 0.62, metalness: 0 });
  if (kind === "olive") return new THREE.MeshStandardMaterial({ ...polymerMaps([74, 78, 58]), roughness: 0.82, metalness: 0 });
  return new THREE.MeshStandardMaterial({ ...polymerMaps(), roughness: 0.86, metalness: 0 });
}

function skinMaterial(skinId){
  switch (skinId){
    case "forest":  return new THREE.MeshStandardMaterial({ ...camoMaps("forest", ["#4a5a32", "#6f6a44", "#2a3020", "#8a7a52"], 41), roughness: 0.8 });
    case "desert":  return new THREE.MeshStandardMaterial({ ...camoMaps("desert", ["#c8a978", "#a78455", "#8a6a44", "#e0cfa2"], 43), roughness: 0.82 });
    case "winter":  return new THREE.MeshStandardMaterial({ ...camoMaps("winter", ["#e6eaee", "#9aa3ab", "#5e666e", "#c9d0d6"], 47, 4), roughness: 0.75 });
    case "urban":   return new THREE.MeshStandardMaterial({ ...camoMaps("urban", ["#6c7075", "#3d4145", "#9da1a4", "#25282b"], 53, 5), roughness: 0.78 });
    case "tiger":   return new THREE.MeshStandardMaterial({ ...tigerMaps(), roughness: 0.6 });
    case "carbon":  return new THREE.MeshStandardMaterial({ ...carbonMaps(), roughness: 0.4, metalness: 0.2 });
    case "redline": return new THREE.MeshStandardMaterial({ ...redlineMaps(), emissive: 0xffffff, emissiveIntensity: 1.2, roughness: 0.55 });
    case "gold":    return new THREE.MeshStandardMaterial({ ...goldMaps(), roughness: 0.22, metalness: 1 });
    case "damascus": return new THREE.MeshStandardMaterial({ ...damascusMaps(), roughness: 0.28, metalness: 0.9 });
    case "ruby":    return new THREE.MeshStandardMaterial({ ...rubyMaps(), emissive: 0xffffff, emissiveIntensity: 0.5, roughness: 0.18, metalness: 0.6 });
    case "neon":    return new THREE.MeshStandardMaterial({ ...neonMaps(), emissive: 0xffffff, emissiveIntensity: 1.6, roughness: 0.4, metalness: 0.3 });
    default:        return null;
  }
}

/**
 * Набор материалов ствола. Скин ложится на мебель и корпус-«краску»; сталь
 * ствола, болты и прицел остаются сталью — так камуфляж читается как
 * покраска, а не как ствол, отлитый из пластилина.
 */
export function gunMaterials(weaponId, skinId = "base"){
  const steel = steelMaps();
  const metal = new THREE.MeshStandardMaterial({ ...steel, color: 0xffffff, metalness: 0.78, roughness: 1 });
  const dark  = new THREE.MeshStandardMaterial({ ...polymerMaps([30, 31, 32]), roughness: 0.7, metalness: 0.15 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1b3d5a, roughness: 0.05, metalness: 0.9, emissive: 0x0a2236, emissiveIntensity: 0.6 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xb8903a, roughness: 0.3, metalness: 1 });

  const skinned = skinMaterial(skinId);
  // У ножа скин ложится на КЛИНОК, а рукоять остаётся своей — так на ножах
  // скины и выглядят: камуфляжная рукоятка читается как дешёвка.
  const knife = KNIFE_IDS.includes(weaponId);
  const furniture = (!knife && skinned) || furnitureMaterial(FURNITURE[weaponId] || "poly");
  if (knife && !skinned){
    // Голый клинок — полированная сталь, светлее воронёной.
    metal.color.setRGB(1.7, 1.75, 1.8);
    metal.roughness = 0.5;
    metal.metalness = 0.55;
  }
  // Корпус со скином красится целиком; без скина — тёмный металл/полимер.
  const body = skinned || metal;
  return { metal, dark, glass, brass, furniture, body, skinned: !!skinned };
}

// ---------------------------------------------------------------------------
// Геометрия
// ---------------------------------------------------------------------------

/**
 * Развёртка «коробкой»: каждая грань получает координаты по двум осям, вдоль
 * которых она лежит. Стандартные UV у выдавленных фигур в разных единицах, и
 * камуфляж на прикладе вышел бы крупнее, чем на цевье. А так плотность рисунка
 * одна на всём стволе — в метрах, а не «на деталь».
 */
function boxUV(geometry, scale = 3.2){
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++){
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let u, v;
    if (nx >= ny && nx >= nz){ u = z; v = y; }
    else if (ny >= nz){ u = z; v = x; }
    else { u = x; v = y; }
    uv[i * 2] = u * scale; uv[i * 2 + 1] = v * scale;
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return geometry;
}

function mesh(geometry, material){
  const m = new THREE.Mesh(boxUV(geometry), material);
  m.castShadow = true;
  return m;
}

/**
 * Деталь по силуэту сбоку. points — [вперёд, вверх] в метрах; thick — толщина
 * поперёк ствола; bevel — фаска по краю (именно она убирает «картонность»:
 * у настоящего металла рёбра никогда не бывают острыми).
 */
function profile(points, thick, material, bevel = 0.004, holes = []){
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const hole of holes) shape.holes.push(new THREE.Path(hole.map(([x, y]) => new THREE.Vector2(x, y))));
  const depth = Math.max(0.001, thick - bevel * 2);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel,
    bevelSegments: 2, curveSegments: 10
  });
  g.translate(0, 0, -depth / 2);
  g.rotateY(Math.PI / 2);   // x силуэта → −z мира (вперёд), толщина → x мира
  g.computeVertexNormals();
  return mesh(g, material);
}

/** Скруглённый брусок: длина вдоль ствола, центр в (x вперёд, y). */
function block(len, h, w, material, x, y, r = 0.006){
  const hl = len / 2, hh = h / 2;
  const s = new THREE.Shape();
  r = Math.min(r, hl, hh);
  s.moveTo(-hl + r, -hh);
  s.lineTo(hl - r, -hh); s.quadraticCurveTo(hl, -hh, hl, -hh + r);
  s.lineTo(hl, hh - r);  s.quadraticCurveTo(hl, hh, hl - r, hh);
  s.lineTo(-hl + r, hh); s.quadraticCurveTo(-hl, hh, -hl, hh - r);
  s.lineTo(-hl, -hh + r); s.quadraticCurveTo(-hl, -hh, -hl + r, -hh);
  const bevel = Math.min(0.004, w / 4);
  const depth = Math.max(0.001, w - bevel * 2);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, -depth / 2);
  g.rotateY(Math.PI / 2);
  g.computeVertexNormals();
  const m = mesh(g, material);
  m.position.set(0, y, -x);
  return m;
}

/** Труба вдоль ствола: от x0 до x1 (вперёд), радиус r (или r0 → r1 — конус). */
function tube(x0, x1, r, material, y = 0, side = 0, r1 = r, segments = 18){
  const len = x1 - x0;
  const g = new THREE.CylinderGeometry(r1, r, len, segments, 1);
  g.rotateX(-Math.PI / 2);          // ось цилиндра → −z (вперёд)
  const m = mesh(g, material);
  m.position.set(side, y, -(x0 + len / 2));
  return m;
}

/** Кольцо вокруг ствола (рёбра цевья дробовика, бандажи). */
function ring(x, r, thick, material, y = 0){
  const g = new THREE.TorusGeometry(r, thick, 8, 20);
  const m = mesh(g, material);
  m.position.set(0, y, -x);
  return m;
}

function add(group, ...parts){ for (const p of parts) group.add(p); return group; }

// ---------------------------------------------------------------------------
// Сами стволы
// ---------------------------------------------------------------------------

const BUILDERS = {
  // Автомат: деревянные цевьё и приклад, изогнутый магазин, газовая трубка.
  rifle(g, m){
    // ствольная коробка и крышка
    add(g,
      profile([[-0.085, 0.028], [0.205, 0.028], [0.205, -0.034], [0.03, -0.034], [0.0, -0.028], [-0.085, -0.022]], 0.05, m.body, 0.003),
      block(0.27, 0.022, 0.046, m.body, 0.06, 0.038, 0.01),
      block(0.03, 0.028, 0.03, m.metal, 0.2, 0.046, 0.004)                     // колодка прицела
    );
    // цевьё снизу и накладка над газовой трубкой
    add(g,
      profile([[0.205, 0.022], [0.37, 0.022], [0.375, 0.0], [0.37, -0.03], [0.205, -0.036]], 0.058, m.furniture, 0.006),
      tube(0.205, 0.36, 0.017, m.furniture, 0.047),
      tube(0.36, 0.43, 0.009, m.metal, 0.047),
      tube(0.205, 0.585, 0.011, m.metal, 0.008),                                 // ствол
      tube(0.555, 0.61, 0.016, m.metal, 0.008),                                  // дульный тормоз
      profile([[0.515, 0.012], [0.545, 0.012], [0.54, 0.07], [0.525, 0.07]], 0.016, m.metal, 0.002), // мушка
      tube(0.43, 0.445, 0.02, m.metal, 0.03)                                     // газовый блок
    );
    // изогнутый магазин
    const mag = [];
    for (let i = 0; i <= 10; i++){
      const t = i / 10, a = t * 0.55;
      mag.push([0.095 + Math.sin(a) * 0.11 * t, -0.032 - t * 0.165]);
    }
    const back = mag.map(([x, y], i) => [x - 0.058 + i * 0.001, y + 0.004]).reverse();
    add(g, profile([...mag, ...back], 0.03, m.dark, 0.003));
    // рукоять, спусковая скоба, приклад, затыльник
    add(g,
      profile([[-0.03, -0.03], [0.02, -0.03], [0.0, -0.135], [-0.052, -0.128]], 0.034, m.furniture, 0.006),
      profile([[0.0, -0.034], [0.07, -0.034], [0.068, -0.062], [0.01, -0.064]], 0.008, m.metal, 0.002),
      profile([[-0.085, 0.024], [-0.085, -0.022], [-0.33, -0.088], [-0.33, 0.02]], 0.042, m.furniture, 0.008),
      block(0.012, 0.11, 0.046, m.dark, -0.336, -0.033, 0.004),
      tube(0.1, 0.13, 0.006, m.metal, 0.03, 0.03)                              // рукоятка затвора
    );
    return { muzzle: 0.61, sightY: 0.075 };
  },

  // ПП: компактный, выдвижной приклад из двух тяг, прямой магазин.
  smg(g, m){
    add(g,
      block(0.3, 0.07, 0.052, m.body, 0.07, 0.0, 0.014),
      tube(-0.01, 0.2, 0.027, m.body, 0.016),                                   // верхняя трубчатая коробка
      profile([[0.16, -0.036], [0.3, -0.036], [0.3, 0.02], [0.16, 0.02]], 0.06, m.furniture, 0.008), // цевьё
      tube(0.3, 0.36, 0.011, m.metal, 0.012),
      tube(0.33, 0.36, 0.016, m.metal, 0.012),                                  // пламегаситель
      tube(-0.02, 0.02, 0.022, m.metal, 0.05),                                  // барабанный целик
      profile([[0.27, 0.03], [0.29, 0.03], [0.285, 0.07], [0.275, 0.07]], 0.014, m.metal, 0.002)
    );
    // магазин — чуть изогнут
    const mag = [];
    for (let i = 0; i <= 8; i++){ const t = i / 8; mag.push([0.13 + t * t * 0.04, -0.035 - t * 0.19]); }
    const back = mag.map(([x, y]) => [x - 0.036, y]).reverse();
    add(g, profile([...mag, ...back], 0.024, m.dark, 0.003));
    add(g,
      profile([[-0.025, -0.034], [0.02, -0.034], [0.0, -0.13], [-0.048, -0.122]], 0.034, m.furniture, 0.006),
      profile([[0.0, -0.036], [0.065, -0.036], [0.062, -0.06], [0.01, -0.062]], 0.008, m.metal, 0.002),
      tube(-0.24, -0.08, 0.006, m.metal, 0.012, 0.018),                         // тяги приклада
      tube(-0.24, -0.08, 0.006, m.metal, 0.012, -0.018),
      block(0.02, 0.1, 0.05, m.dark, -0.25, -0.02, 0.006)                       // затыльник
    );
    return { muzzle: 0.36, sightY: 0.075 };
  },

  // Помповый дробовик: трубчатый магазин под стволом и рифлёное цевьё.
  shotgun(g, m){
    add(g,
      block(0.24, 0.075, 0.056, m.body, 0.06, 0.004, 0.012),
      tube(0.18, 0.64, 0.015, m.metal, 0.028),                                  // ствол
      tube(0.18, 0.58, 0.013, m.metal, -0.008),                                  // подствольный магазин
      tube(0.58, 0.6, 0.016, m.metal, -0.008),
      tube(0.625, 0.64, 0.0045, m.brass, 0.047)                                 // мушка-бусина
    );
    // Цевьё-помпа — отдельной группой «pump»: от первого лица рука дёргает
    // его назад-вперёд после каждого выстрела.
    const pump = new THREE.Group();
    pump.name = "pump";
    pump.add(tube(0.25, 0.44, 0.026, m.furniture, -0.004, 0, 0.026, 20));
    for (let x = 0.27; x < 0.43; x += 0.022) pump.add(ring(x, 0.026, 0.004, m.furniture, -0.004));
    g.add(pump);
    add(g,
      profile([[-0.03, -0.03], [0.02, -0.03], [-0.005, -0.1], [-0.05, -0.095]], 0.036, m.furniture, 0.006),
      profile([[0.0, -0.034], [0.07, -0.034], [0.066, -0.06], [0.01, -0.062]], 0.008, m.metal, 0.002),
      profile([[-0.06, 0.036], [-0.06, -0.03], [-0.33, -0.085], [-0.34, -0.08], [-0.34, 0.02], [-0.3, 0.03]], 0.044, m.furniture, 0.008),
      block(0.012, 0.11, 0.048, m.dark, -0.345, -0.03, 0.004)
    );
    return { muzzle: 0.64, sightY: 0.05 };
  },

  // Снайперская: скользящий затвор, длинный конический ствол, прицел, сошки.
  sniper(g, m){
    add(g,
      tube(-0.06, 0.2, 0.022, m.metal, 0.01),                                    // коробка-цилиндр
      tube(0.2, 0.74, 0.013, m.metal, 0.01, 0, 0.009),                          // ствол сужается
      tube(0.72, 0.77, 0.014, m.metal, 0.01),                                    // дульный тормоз
      profile([[0.2, -0.012], [0.46, -0.018], [0.46, -0.05], [0.2, -0.052]], 0.05, m.furniture, 0.008), // ложе
      block(0.07, 0.07, 0.03, m.dark, 0.09, -0.06, 0.006)                        // магазин
    );
    // прицел
    add(g,
      tube(-0.02, 0.26, 0.017, m.dark, 0.083),
      tube(-0.05, 0.0, 0.024, m.dark, 0.083, 0, 0.017),
      tube(0.23, 0.3, 0.017, m.dark, 0.083, 0, 0.028),
      tube(0.297, 0.3, 0.025, m.glass, 0.083),
      tube(-0.052, -0.048, 0.02, m.glass, 0.083),
      tube(0.1, 0.13, 0.012, m.metal, 0.108),                                    // барабанчик
      block(0.025, 0.04, 0.03, m.metal, 0.02, 0.05, 0.004),                      // кольца крепления
      block(0.025, 0.04, 0.03, m.metal, 0.19, 0.05, 0.004)
    );
    // затвор: рукоятка с шаром справа
    // Затвор — группой «bolt» с осью у коробки: от первого лица после
    // выстрела рука поднимает рукоятку, отводит назад и досылает патрон.
    const boltGroup = new THREE.Group();
    boltGroup.name = "bolt";
    boltGroup.position.set(0.012, 0.012, 0.0);
    const bolt = tube(-0.02, 0.02, 0.005, m.metal, 0.0, 0.033);
    bolt.rotation.y = Math.PI / 2;
    bolt.position.set(0.023, 0.0, 0.0);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.011, 12, 10), m.metal);
    knob.position.set(0.046, -0.004, 0.0);
    boltGroup.add(bolt, knob);
    add(g, boltGroup);
    // ложе с пистолетным хватом и щекой
    add(g,
      profile([[-0.03, -0.03], [0.03, -0.03], [0.005, -0.115], [-0.045, -0.11]], 0.036, m.furniture, 0.008),
      profile([[0.02, -0.012], [0.2, -0.012], [0.2, -0.05], [0.02, -0.04]], 0.05, m.furniture, 0.008),
      profile([[-0.06, 0.03], [-0.06, -0.035], [-0.1, -0.05], [-0.25, -0.06], [-0.33, -0.1], [-0.345, -0.1], [-0.345, 0.03], [-0.26, 0.052], [-0.12, 0.052]], 0.044, m.furniture, 0.008),
      block(0.012, 0.13, 0.05, m.dark, -0.35, -0.035, 0.004),
      profile([[0.0, -0.032], [0.06, -0.032], [0.058, -0.058], [0.01, -0.06]], 0.008, m.metal, 0.002)
    );
    // сложенные сошки
    add(g,
      tube(0.3, 0.44, 0.004, m.metal, -0.058, 0.012),
      tube(0.3, 0.44, 0.004, m.metal, -0.058, -0.012)
    );
    return { muzzle: 0.77, sightY: 0.083, scope: true };
  },

  // Пулемёт: массивная коробка, кожух с отверстиями, ручка для переноски,
  // короб с лентой сбоку.
  lmg(g, m){
    add(g,
      block(0.3, 0.09, 0.07, m.body, 0.06, 0.0, 0.01),
      block(0.22, 0.02, 0.066, m.metal, 0.03, 0.054, 0.006),                    // крышка
      tube(0.21, 0.42, 0.024, m.dark, 0.012, 0, 0.024, 12),                     // кожух
      tube(0.21, 0.66, 0.013, m.metal, 0.012),                                   // ствол
      tube(0.62, 0.68, 0.018, m.metal, 0.012),
      profile([[0.1, 0.06], [0.13, 0.11], [0.26, 0.11], [0.28, 0.06], [0.25, 0.06], [0.24, 0.095], [0.15, 0.095], [0.13, 0.06]], 0.016, m.dark, 0.003) // ручка
    );
    for (let x = 0.23; x < 0.41; x += 0.03){
      for (const a of [0, 1, 2]){
        const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.052, 8), m.metal);
        hole.rotation.set(Math.PI / 2, 0, a * Math.PI / 3);
        hole.position.set(0, 0.012, -x);
        g.add(hole);
      }
    }
    add(g,
      block(0.14, 0.13, 0.09, m.furniture, 0.08, -0.1, 0.01),                   // короб
      block(0.12, 0.015, 0.02, m.brass, 0.08, -0.032, 0.004),                    // лента
      profile([[-0.03, -0.045], [0.02, -0.045], [0.0, -0.14], [-0.05, -0.132]], 0.036, m.furniture, 0.006),
      profile([[-0.09, 0.035], [-0.09, -0.04], [-0.32, -0.09], [-0.34, -0.09], [-0.34, 0.03], [-0.32, 0.035]], 0.05, m.furniture, 0.008),
      block(0.012, 0.13, 0.055, m.dark, -0.345, -0.03, 0.004),
      tube(0.44, 0.62, 0.005, m.metal, -0.02, 0.015),                            // сошки
      tube(0.44, 0.62, 0.005, m.metal, -0.02, -0.015)
    );
    return { muzzle: 0.68, sightY: 0.07 };
  }
};

// ---------------------------------------------------------------------------
// Ножи, граната, бомба
// ---------------------------------------------------------------------------

/** Дуга точками: от угла a0 до a1 вокруг (cx, cy). */
function arc(cx, cy, r, a0, a1, steps = 10){
  const out = [];
  for (let i = 0; i <= steps; i++){
    const a = a0 + (a1 - a0) * i / steps;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

Object.assign(BUILDERS, {
  // Обычный нож: клинок с обухом и скосом к острию, упор, рукоять.
  knife(g, m){
    add(g,
      profile([[0.0, 0.014], [0.12, 0.014], [0.175, 0.002], [0.13, -0.014], [0.0, -0.016]], 0.006, m.body, 0.0015),
      block(0.012, 0.05, 0.02, m.dark, -0.004, 0.0, 0.003),
      profile([[-0.012, 0.014], [-0.11, 0.016], [-0.118, 0.006], [-0.118, -0.012], [-0.11, -0.02], [-0.012, -0.016]], 0.024, m.furniture, 0.005)
    );
    return { muzzle: 0.175, sightY: 0.02, blade: true };
  },

  // Штык-нож: длинный клинок с долом, кольцо упора, рифлёная рукоять.
  bayonet(g, m){
    add(g,
      profile([[0.0, 0.016], [0.17, 0.016], [0.225, 0.004], [0.2, -0.008], [0.16, -0.016], [0.0, -0.018]], 0.007, m.body, 0.0015),
      block(0.12, 0.004, 0.009, m.dark, 0.085, 0.004, 0.001),                   // дол
      block(0.014, 0.07, 0.024, m.metal, -0.004, 0.012, 0.004),
      tube(-0.012, 0.002, 0.012, m.metal, 0.036),                               // кольцо под ствол
      tube(-0.13, -0.012, 0.014, m.furniture, -0.001, 0, 0.015, 12)
    );
    for (let x = -0.12; x < -0.02; x += 0.016) g.add(ring(x, 0.0145, 0.0022, m.dark, -0.001));
    return { muzzle: 0.225, sightY: 0.02, blade: true };
  },

  // Керамбит: коготь — клинок по дуге вниз, кольцо на конце рукояти.
  karambit(g, m){
    const outer = arc(0.0, -0.09, 0.105, Math.PI * 0.5, Math.PI * 0.06, 12);
    const inner = arc(0.012, -0.09, 0.082, Math.PI * 0.08, Math.PI * 0.52, 12);
    add(g,
      profile([...outer, ...inner], 0.006, m.body, 0.0015),
      profile([[0.0, 0.016], [-0.1, 0.01], [-0.108, -0.006], [-0.004, -0.004]], 0.022, m.furniture, 0.005)
    );
    const loop = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.005, 10, 24), m.metal);
    loop.rotation.y = Math.PI / 2;
    loop.position.set(0, 0.0, 0.125);
    g.add(loop);
    return { muzzle: 0.1, sightY: 0.02, blade: true };
  },

  // Бабочка: клинок между двумя рукоятями с прорезями.
  butterfly(g, m){
    add(g,
      profile([[0.0, 0.012], [0.12, 0.012], [0.165, 0.0], [0.12, -0.012], [0.0, -0.013]], 0.005, m.body, 0.0012)
    );
    const slot = [[-0.03, 0.004], [-0.1, 0.004], [-0.1, -0.004], [-0.03, -0.004]];
    for (const side of [-0.008, 0.008]){
      const h = profile([[0.0, 0.012], [-0.12, 0.012], [-0.125, 0.0], [-0.12, -0.012], [0.0, -0.012]], 0.007, m.furniture, 0.0015, [slot]);
      h.position.x = side;
      g.add(h);
    }
    const pin = tube(-0.004, 0.004, 0.004, m.brass, 0.0);
    pin.rotation.y = Math.PI / 2;
    g.add(pin);
    return { muzzle: 0.165, sightY: 0.02, blade: true };
  },

  // Граната: корпус, чека с кольцом, рычаг.
  nade(g, m){
    const body = new THREE.Mesh(boxUV(new THREE.SphereGeometry(0.034, 18, 14)), m.furniture);
    body.scale.set(1, 1.22, 1);
    add(g, body,
      tube(-0.01, 0.01, 0.014, m.metal, 0.046),
      block(0.012, 0.07, 0.01, m.metal, 0.02, 0.02, 0.003));
    const pinRing = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.0022, 8, 18), m.metal);
    pinRing.position.set(-0.018, 0.05, 0.0);
    pinRing.rotation.y = Math.PI / 2;
    g.add(pinRing);
    return { muzzle: 0.03, sightY: 0.02 };
  },

  // Бомба: связка шашек, табло и провода.
  bomb(g, m){
    for (const [x, y] of [[0, 0], [0, 0.045], [0.07, 0], [0.07, 0.045]]){
      g.add(block(0.065, 0.04, 0.1, m.furniture, x - 0.035, y - 0.02, 0.004));
    }
    const screen = block(0.05, 0.03, 0.004, m.glass, 0.0, 0.07, 0.003);
    screen.position.x = 0.05;
    add(g, block(0.07, 0.04, 0.02, m.dark, 0.0, 0.07, 0.004), screen,
      tube(-0.07, 0.07, 0.003, m.brass, 0.052, 0.03));
    return { muzzle: 0.07, sightY: 0.05 };
  }
});

/**
 * Собрать ствол. Возвращает группу (ствол вдоль −Z) и точку дула — туда
 * ставится вспышка выстрела.
 */
export function buildGunModel(weaponId, skinId = "base"){
  const group = new THREE.Group();
  const materials = gunMaterials(weaponId, skinId);
  const build = BUILDERS[weaponId] || BUILDERS.rifle;
  const info = build(group, materials);
  group.userData.weapon = weaponId;
  group.userData.skin = skinId;
  group.userData.materials = materials;
  return { group, muzzle: new THREE.Vector3(0, 0.01, -info.muzzle), info };
}

/** Освободить геометрию и материалы (при смене ствола в лобби). */
export function disposeGun(group){
  const mats = new Set();
  group.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) mats.add(o.material);
  });
  // Текстуры общие (кэш) — их не трогаем, только сами материалы.
  for (const m of mats) m.dispose();
}

export const GUN_IDS = ["rifle", "smg", "shotgun", "sniper", "lmg"];
export const KNIFE_MODEL_IDS = KNIFE_IDS;

/**
 * Студийное окружение для оружейной: металл без отражений выглядит чёрным
 * пластиком, потому что отражать ему нечего. Сцена-«софтбокс» из нескольких
 * светящихся панелей, свёрнутая PMREM в карту отражений, — то же, что делает
 * RoomEnvironment из примеров Three, только без лишнего импорта.
 */
export function studioEnvironment(renderer){
  const room = new THREE.Scene();
  room.background = new THREE.Color(0x3a3f46);
  const panel = (w, h, color, intensity, x, y, z, ry = 0, rx = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.rotation.set(rx, ry, 0);
    room.add(m);
  };
  panel(6, 2, 0xfff2e0, 3.2, 0, 4, 0, 0, Math.PI / 2);      // сверху — основной
  panel(2, 3, 0xd8e8ff, 1.6, -4, 1, 0, Math.PI / 2);         // слева — холодный
  panel(2, 3, 0xffe4c8, 1.3, 4, 1, 1, -Math.PI / 2);         // справа — тёплый
  panel(8, 1, 0x20242a, 1, 0, -2, 0, 0, Math.PI / 2);        // пол — тёмный
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(room, 0.03).texture;
  pmrem.dispose();
  return env;
}
