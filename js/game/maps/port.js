// port.js — «Порт».
//
// Контейнерный терминал ясным днём. Яркие ящики в два яруса, краны над
// головой — самая «аркадная» из карт, в духе быстрых браузерных шутеров:
// короткие дистанции, много углов, всегда есть куда запрыгнуть.
//
//   Проходы между рядами. Длинные прямые коридоры — простреливаются вдоль,
//              зато в каждом ряду есть разрыв, через который можно свернуть.
//   Второй ярус. На крыши контейнеров ведут лестницы; сверху видно проходы,
//              но стоишь на виду у всей карты.
//   Центр.     Кран на опорах и низкая баррикада из поддонов — ничья земля.
//
// Карта зеркальна по x: террористы (a) с запада, спецназ (b) с востока, обе
// точки закладки ближе к спецназу — как и положено: одни держат, другие идут.

import { MapBuilder, THREE, rough, yawTowards } from "./builder.js";

export const meta = {
  id: "port",
  name: "Порт",
  subtitle: "Яркие контейнеры в два яруса, краны над головой",
  hint: "Коридоры между контейнерами простреливаются насквозь. Лезь наверх — или сворачивай в разрывы."
};

const CONCRETE = 0xbdb6a6;
const COLORS = [0xc0392b, 0x2e6ea6, 0xe07b24, 0x3f8f4f, 0xe0b020, 0x7b4ea3];
const STEEL = 0x6f777c;

const CENTER = [0, 0, 0];
const facing = (focus, list) => list.map(pos => ({ pos, yaw: yawTowards(pos, focus) }));

export function build(){
  const b = new MapBuilder();

  const ground = rough(CONCRETE, { roughness: 0.96 });
  const steel = rough(STEEL, { roughness: 0.45, metalness: 0.6 });
  const paints = COLORS.map(c => rough(c, { roughness: 0.62, metalness: 0.25 }));
  const pallet = rough(0x9a7448, { roughness: 0.9 });
  const lines = rough(0xf2e14c, { roughness: 0.7 });

  b.box(0, -1, 0, 150, 1, 110, ground);
  // жёлтая разметка проездов — только на вид
  for (const z of [-30, 0, 30]) b.box(0, 0, z, 130, 0.02, 0.3, lines, "decor");

  let paint = 0;
  const color = () => paints[paint++ % paints.length];

  /**
   * Контейнер 12 × 2.6 × 2.5. along — вдоль какой оси вытянут. Рёбра-обвязка
   * по торцам делают его контейнером, а не цветной коробкой.
   */
  function container(x, y, z, along = "x", mat = color()){
    const [w, d] = along === "x" ? [12, 2.5] : [2.5, 12];
    b.box(x, y, z, w, 2.6, d, mat);
    const edge = along === "x" ? [[x - 5.95, z], [x + 5.95, z]] : [[x, z - 5.95], [x, z + 5.95]];
    for (const [ex, ez] of edge){
      b.box(ex, y, ez, along === "x" ? 0.14 : 2.6, 2.62, along === "x" ? 2.6 : 0.14, steel, "decor");
    }
  }

  for (const side of [-1, 1]){
    // ---- дальние ряды у своих возрождений: низкие, по одному ярусу -------
    container(48 * side, 0, -20, "z");
    container(48 * side, 0, 20, "z");

    // ---- средние ряды: два яруса и лестница наверх -----------------------
    // Одиночные контейнеры по краям ряда — укрытие внизу; двухъярусный
    // штабель — точка сверху. Лестница идёт к штабелю со стороны центра.
    container(30 * side, 0, -40, "x");
    container(30 * side, 0, -31, "x");
    container(30 * side, 2.6, -31, "x");
    b.ramp(30 * side, 0, -19.5, 30 * side, 5.2, -29.8, 3, steel);

    container(30 * side, 0, 40, "x");
    container(30 * side, 0, 31, "x");
    container(30 * side, 2.6, 31, "x");
    b.ramp(30 * side, 0, 19.5, 30 * side, 5.2, 29.8, 3, steel);

    // ---- ближние к центру: одиночные, вразброс ---------------------------
    container(14 * side, 0, -12, "z");
    container(16 * side, 0, 14, "z");
    b.box(9 * side, 0, 0, 2.4, 1.2, 2.4, pallet);      // поддоны
    b.box(9 * side, 1.2, 0, 2.2, 1.1, 2.2, pallet);
  }

  // ---- центр: кран на опорах и баррикада ---------------------------------
  for (const [x, z] of [[-6, -18], [6, -18], [-6, 18], [6, 18]]) b.box(x, 0, z, 1, 14, 1, steel);
  b.box(0, 14, -18, 13, 1.2, 1.4, steel);
  b.box(0, 14, 18, 13, 1.2, 1.4, steel);
  b.box(0, 15.2, 0, 2.2, 1.2, 38, rough(0xe0b020, { roughness: 0.5, metalness: 0.4 }));
  b.box(0, 8, 0, 2.4, 0.3, 2.4, steel, "decor");     // подвешенный захват
  b.box(0, 0, 0, 1.8, 1.3, 7, pallet);                // баррикада в самом центре

  // ---- краны на причале вдоль севера — ориентир и декорация -------------
  for (const x of [-40, 0, 40]){
    b.box(x - 3, 0, -52, 1.2, 22, 1.2, steel);
    b.box(x + 3, 0, -52, 1.2, 22, 1.2, steel);
    b.box(x, 22, -52, 8, 1.4, 1.4, steel);
    b.box(x, 22.5, -45, 1.4, 1.2, 16, steel, "decor");
  }
  b.box(0, 0, -50, 150, 0.8, 2, rough(0x3a3f44), "decor");   // край причала

  b.walls(-72, 72, -50, 52, 30);

  // ---- свет: ясный полдень у моря ----------------------------------------
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
  sun.position.set(-50, 90, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0015;
  sun.shadow.camera.left = -85; sun.shadow.camera.right = 85;
  sun.shadow.camera.top = 70;   sun.shadow.camera.bottom = -70;
  sun.shadow.camera.far = 240;
  b.light(sun);
  b.light(new THREE.HemisphereLight(0xcfe6ff, 0xb4a88e, 1.6));
  b.light(new THREE.AmbientLight(0xffffff, 0.25));

  return {
    group: b.group,
    colliders: b.colliders,
    sky: 0x9fd0f0,
    fog: { color: 0xc8e2f0, near: 90, far: 300 },
    // A — у северного двухъярусного ряда спецназа, B — у южного. Между ними
    // центр с краном: перебросить защиту можно, но на виду.
    sites: [[40, 0.1, -12], [40, 0.1, 12]],
    spawns: facing(CENTER, [
      [-60, 0.1, -6], [60, 0.1, 6], [-60, 0.1, 6], [60, 0.1, -6],
      [0, 0.1, -40], [0, 0.1, 40]
    ]),
    teamSpawns: {
      a: facing(CENTER, [[-60, 0.1, -6], [-60, 0.1, 6]]),
      b: facing(CENTER, [[60, 0.1, -6], [60, 0.1, 6]])
    },
    build: b
  };
}
