// fromdata.js — карта из файла редактора карт (editor/index.html).
//
// Редактор отдаёт карту как простые данные: коробки, пандусы, точки закладки
// и возрождения, цвета и свет. Здесь эти данные превращаются в ту же самую
// карту, что и рукописные (karier.js, arena.js…): те же коробки MapBuilder,
// те же столкновения, те же поля sites / spawns / teamSpawns.
//
// Как добавить карту игрока в игру:
//   1. В редакторе нажать «Файл для игры (.js)» — получится, например,
//      moya-karta.js. Положить его в js/game/maps/.
//   2. В js/game/maps/index.js дописать импорт и добавить карту в MAPS и
//      MAP_LIST (см. README, раздел «Карты игроков»).
//
// Формат (DATA):
//   { v: 1, id, name, subtitle, hint,
//     size: [ширина, глубина], floor: "#rrggbb", sky: "#rrggbb",
//     light: "day" | "evening" | "night", border: true/false,
//     boxes: [[x, y, z, w, h, d, "#цвет", decor(0/1)], ...]   // центр x/z, низ y
//     ramps: [[x1, y1, z1, x2, y2, z2, ширина, "#цвет", низ], ...]
//     sites: [[x, y, z], [x, y, z]]                          // A, затем B
//     spawnsA: [[x, y, z], ...], spawnsB: [[x, y, z], ...] }  // террористы / спецназ

import { MapBuilder, THREE, rough, yawTowards } from "./builder.js";

const hex = c => typeof c === "number" ? c : parseInt(String(c || "#888888").replace("#", ""), 16) || 0x888888;

const LIGHTS = {
  day:     { sun: 0xfff1d6, sunI: 2.1, hemiSky: 0xdfeeff, hemiGround: 0xbdb3a0, hemiI: 1.7, amb: 0.28, fogK: 1 },
  evening: { sun: 0xffb46b, sunI: 1.6, hemiSky: 0xffc9a0, hemiGround: 0x5a4a3e, hemiI: 1.0, amb: 0.2,  fogK: 0.8 },
  night:   { sun: 0x9fb8ff, sunI: 0.7, hemiSky: 0x5a6f9e, hemiGround: 0x1d2230, hemiI: 0.75, amb: 0.22, fogK: 0.6 }
};

export function mapFromData(data){
  const meta = {
    id: String(data.id || "custom").slice(0, 16),
    name: String(data.name || "Карта игрока").slice(0, 40),
    subtitle: String(data.subtitle || "Карта, сделанная в редакторе").slice(0, 80),
    hint: String(data.hint || "").slice(0, 160)
  };

  function build(){
    const b = new MapBuilder();
    const mats = new Map();
    const mat = c => {
      const k = hex(c);
      if (!mats.has(k)) mats.set(k, rough(k, { roughness: 0.8 }));
      return mats.get(k);
    };
    const [W, D] = data.size || [80, 60];

    b.box(0, -1, 0, W + 12, 1, D + 12, mat(data.floor || "#c9c2b0"));
    for (const [x, y, z, w, h, d, color, decor] of data.boxes || []){
      b.box(x, y, z, w, h, d, mat(color), decor ? "decor" : "solid");
    }
    for (const [x1, y1, z1, x2, y2, z2, width, color, base] of data.ramps || []){
      b.ramp(x1, y1, z1, x2, y2, z2, width, mat(color), base || 0);
    }

    b.walls(-W / 2, W / 2, -D / 2, D / 2, 30);
    if (data.border !== false){
      const edge = mat("#3a3f4a");
      b.box(0, 0, -D / 2 - 0.5, W + 2, 3, 1, edge);
      b.box(0, 0, D / 2 + 0.5, W + 2, 3, 1, edge);
      b.box(-W / 2 - 0.5, 0, 0, 1, 3, D, edge);
      b.box(W / 2 + 0.5, 0, 0, 1, 3, D, edge);
    }

    const L = LIGHTS[data.light] || LIGHTS.day;
    const sun = new THREE.DirectionalLight(L.sun, L.sunI);
    const r = Math.max(W, D) * 0.65;
    sun.position.set(r * 0.5, r * 1.2, r * 0.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0015;
    sun.shadow.camera.left = -r; sun.shadow.camera.right = r;
    sun.shadow.camera.top = r;   sun.shadow.camera.bottom = -r;
    sun.shadow.camera.far = r * 4;
    b.light(sun);
    b.light(new THREE.HemisphereLight(L.hemiSky, L.hemiGround, L.hemiI));
    b.light(new THREE.AmbientLight(0xffffff, L.amb));

    const center = [0, 0, 0];
    const facing = list => list.map(pos => ({ pos, yaw: yawTowards(pos, center) }));
    const A = data.spawnsA || [], B = data.spawnsB || [];
    const sky = hex(data.sky || "#9fd0f0");
    return {
      group: b.group,
      colliders: b.colliders,
      sky,
      fog: { color: sky, near: 90 * L.fogK, far: Math.max(240, Math.max(W, D) * 3) * L.fogK },
      sites: (data.sites || []).slice(0, 2),
      // Общие точки — вперемешку со сторон, как у рукописных карт.
      spawns: facing(A.flatMap((p, i) => (B[i] ? [p, B[i]] : [p])).concat(B.slice(A.length))),
      teamSpawns: { a: facing(A), b: facing(B) },
      build: b
    };
  }

  return { meta, build };
}
