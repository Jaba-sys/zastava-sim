// poligon.js — «Полигон».
//
// Учебный полигон в ярких цветах: белые блоки, цветные ограждения, башня в
// центре. По духу — быстрые браузерные арены: всё читается с первого взгляда,
// стены низкие, прыгать и перелезать можно почти везде.
//
//   Башня.     Два этажа в центре, лестницы с двух сторон. Сверху видно всё,
//              но и тебя видно всем — долго там не простоишь.
//   Кольцо.    Вокруг башни — низкие блоки по пояс: перебегать от одного к
//              другому, держать угол, перепрыгивать.
//   Фланги.    По краям — длинные стенки с окнами: обходной путь к точкам.
//
// Зеркальна по x: террористы с запада, спецназ с востока.

import { MapBuilder, THREE, rough, yawTowards } from "./builder.js";

export const meta = {
  id: "poligon",
  name: "Полигон",
  subtitle: "Яркая арена: башня в центре, блоки по пояс",
  hint: "Башня видит всё, но и её видят все. Через блоки по пояс можно перепрыгнуть."
};

const CENTER = [0, 0, 0];
const facing = (focus, list) => list.map(pos => ({ pos, yaw: yawTowards(pos, focus) }));

export function build(){
  const b = new MapBuilder();

  const floor  = rough(0xe8e4da, { roughness: 0.9 });
  const white  = rough(0xf4f2ec, { roughness: 0.85 });
  const grid   = rough(0xd4cfc2, { roughness: 0.9 });
  const orange = rough(0xff7a2f, { roughness: 0.6 });
  const teal   = rough(0x1fb5a8, { roughness: 0.6 });
  const pink   = rough(0xe8457a, { roughness: 0.6 });
  const navy   = rough(0x2c3e70, { roughness: 0.7 });
  const yellow = rough(0xffc93c, { roughness: 0.6 });

  b.box(0, -1, 0, 120, 1, 100, floor);
  // сетка на полу — ориентир расстояния, как на тренировочной площадке
  for (let x = -50; x <= 50; x += 10) b.box(x, 0, 0, 0.12, 0.02, 92, grid, "decor");
  for (let z = -40; z <= 40; z += 10) b.box(0, 0, z, 112, 0.02, 0.12, grid, "decor");

  // ---- башня в центре ----------------------------------------------------
  // Первый этаж — открытая площадка на столбах (под ней можно пройти), второй
  // — площадка с бортиком. Лестницы с запада и востока.
  for (const [x, z] of [[-4.5, -4.5], [4.5, -4.5], [-4.5, 4.5], [4.5, 4.5]]) b.box(x, 0, z, 1, 4, 1, navy);
  b.box(0, 4, 0, 10, 0.4, 10, white);                     // пол первого этажа
  for (const [x, z] of [[-3.5, -3.5], [3.5, -3.5], [-3.5, 3.5], [3.5, 3.5]]) b.box(x, 4.4, z, 0.8, 3.6, 0.8, navy);
  b.box(0, 8, 0, 8, 0.4, 8, white);                       // второй этаж
  b.box(0, 8.4, 3.8, 8, 1, 0.3, orange);                  // бортик (с севера — вход)
  b.ramp(-15, 0, 0, -5.2, 4.4, 0, 3, yellow);             // лестница на первый
  b.ramp(15, 0, 0, 5.2, 4.4, 0, 3, yellow);
  // На второй этаж — длинный пандус с севера, прямо с земли: внутри башни
  // для него нет места, первый этаж низкий.
  b.ramp(0, 0, -25, 0, 8.4, -4.2, 2.6, yellow);

  // ---- кольцо низких блоков ----------------------------------------------
  for (const side of [-1, 1]){
    for (const [x, z, w, d, m] of [
      [14, -14, 4, 2, teal], [14, 14, 4, 2, teal],
      [22, -4, 2, 5, pink],  [22, 7, 2, 4, pink],
      [8, -22, 5, 2, white], [8, 22, 5, 2, white],
      [26, -24, 3, 3, orange], [26, 24, 3, 3, orange]
    ]){
      b.box(x * side, 0, z, w, 1.15, d, m);
    }
    // высокие блоки — настоящее укрытие в полный рост
    b.box(34 * side, 0, -12, 3, 3, 3, navy);
    b.box(34 * side, 0, 12, 3, 3, 3, navy);
    b.box(36 * side, 0, 0, 2, 1.15, 6, yellow);

    // ---- фланги: длинные стенки с окнами -------------------------------
    for (const z of [-36, 36]){
      b.box(18 * side, 0, z, 16, 1, 1, white);             // низ стенки
      b.box(18 * side, 1, z, 3, 1.4, 1, white);            // простенки
      b.box(13 * side, 1, z, 3, 1.4, 1, white);
      b.box(23 * side, 1, z, 3, 1.4, 1, white);
      b.box(18 * side, 2.4, z, 16, 0.8, 1, white);         // верх: окна между простенками
    }
  }

  // ---- ворота у возрождений: цветная арка своей стороны ------------------
  for (const [side, m] of [[-1, orange], [1, teal]]){
    b.box(50 * side, 0, -7, 1, 5, 1, m);
    b.box(50 * side, 0, 7, 1, 5, 1, m);
    b.box(50 * side, 5, 0, 1, 1, 15, m);
  }

  b.walls(-58, 58, -46, 46, 30);
  // ограждение по краю — видимое, чтобы край арены читался
  for (const [x, z, w, d] of [[0, -46.5, 118, 1], [0, 46.5, 118, 1], [-58.5, 0, 1, 94], [58.5, 0, 1, 94]]){
    b.box(x, 0, z, w, 1.2, d, navy, "decor");
  }

  // ---- свет: ровный яркий день -------------------------------------------
  const sun = new THREE.DirectionalLight(0xffffff, 2.0);
  sun.position.set(40, 90, 55);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0015;
  sun.shadow.camera.left = -70; sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 60;   sun.shadow.camera.bottom = -60;
  sun.shadow.camera.far = 220;
  b.light(sun);
  b.light(new THREE.HemisphereLight(0xe6f2ff, 0xd8cfbb, 1.8));
  b.light(new THREE.AmbientLight(0xffffff, 0.3));

  return {
    group: b.group,
    colliders: b.colliders,
    sky: 0xa9d8ff,
    fog: { color: 0xdcecfa, near: 90, far: 280 },
    // A — у восточных высоких блоков на севере, B — на юге. Башня между ними
    // простреливает обе, и за неё идёт главная драка раунда.
    sites: [[30, 0.1, -18], [30, 0.1, 18]],
    spawns: facing(CENTER, [
      [-52, 0.1, -4], [52, 0.1, 4], [-52, 0.1, 4], [52, 0.1, -4],
      [0, 0.1, -40], [0, 0.1, 40]
    ]),
    teamSpawns: {
      a: facing(CENTER, [[-52, 0.1, -4], [-52, 0.1, 4]]),
      b: facing(CENTER, [[52, 0.1, -4], [52, 0.1, 4]])
    },
    build: b
  };
}
