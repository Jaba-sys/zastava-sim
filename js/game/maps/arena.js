// arena.js — «Арена».
//
// Маленькая яркая арена в духе Rivals: всё видно, всё рядом, бой начинается
// через десять секунд после старта. Два цвета — красная сторона (террористы,
// запад) и синяя (спецназ, восток), серый нейтральный центр.
//
//   Пьедестал. Посередине — площадка на высоте 2.4 м с пандусами с севера и
//              юга и низкими бортиками по бокам. С неё видно обе линии, но
//              и с обеих линий видно её.
//   Линии.     Вдоль северного и южного края — длинные стенки с проходами:
//              обход центра к точкам. За стенками — узкий задний коридор.
//   Базы.      У каждой стороны — стенка с тремя проходами: выбегаешь не
//              в одну дверь, куда все целятся.
//   Укрытия.   Кубы по пояс и столбы в рост, строго зеркально — ни у кого
//              нет лишнего угла.
//
// Точки A (север) и B (юг) — ближе к спецназу, как на остальных картах.

import { MapBuilder, THREE, rough, yawTowards } from "./builder.js";

export const meta = {
  id: "arena",
  name: "Арена",
  subtitle: "Маленькая яркая арена: пьедестал в центре, две линии",
  hint: "Бегом и подкатом (бег + присесть) от укрытия к укрытию. Пьедестал видит всё — и всем виден."
};

const CENTER = [0, 0, 0];
const facing = (focus, list) => list.map(pos => ({ pos, yaw: yawTowards(pos, focus) }));

export function build(){
  const b = new MapBuilder();

  const floor  = rough(0xd9dce2, { roughness: 0.85 });
  const tile   = rough(0xc4c8d0, { roughness: 0.9 });
  const grey   = rough(0x8e949e, { roughness: 0.7 });
  const dark   = rough(0x3a3f4a, { roughness: 0.6 });
  const red    = rough(0xe0473c, { roughness: 0.55 });
  const blue   = rough(0x3a7be0, { roughness: 0.55 });
  const white  = rough(0xf2f3f5, { roughness: 0.8 });
  const yellow = rough(0xffc83d, { roughness: 0.5 });

  // ---- пол: плитка и разметка ------------------------------------------
  b.box(0, -1, 0, 96, 1, 66, floor);
  for (let x = -40; x <= 40; x += 8) b.box(x, 0, 0, 0.1, 0.02, 58, tile, "decor");
  for (let z = -24; z <= 24; z += 8) b.box(0, 0, z, 86, 0.02, 0.1, tile, "decor");
  // цветные половины у баз
  b.box(-37, 0, 0, 12, 0.025, 56, rough(0xf1c4bf, { roughness: 0.9 }), "decor");
  b.box(37, 0, 0, 12, 0.025, 56, rough(0xbfd3f1, { roughness: 0.9 }), "decor");

  // ---- пьедестал в центре ----------------------------------------------
  b.box(0, 0, 0, 12, 2.4, 12, grey);
  b.box(0, 2.4, 0, 12.2, 0.12, 12.2, white, "decor");            // кант сверху
  b.box(-5.9, 2.4, 0, 0.35, 1.0, 12, dark);                      // бортики — укрытие сверху
  b.box(5.9, 2.4, 0, 0.35, 1.0, 12, dark);
  b.ramp(0, 0, -15, 0, 2.4, -6.1, 3.2, yellow);                  // пандусы с севера и юга
  b.ramp(0, 0, 15, 0, 2.4, 6.1, 3.2, yellow);

  for (const side of [-1, 1]){
    const team = side < 0 ? red : blue;

    // ---- база: стенка с тремя проходами ---------------------------------
    for (const [z0, z1] of [[-26, -15], [-9, -4], [4, 9], [15, 26]]){
      b.box(31 * side, 0, (z0 + z1) / 2, 1, 3.2, z1 - z0, team);
    }
    b.box(31 * side, 3.2, 0, 1.1, 0.3, 52, white, "decor");

    // ---- линии: стенки вдоль северного и южного края --------------------
    for (const z of [-22, 22]){
      b.box(13 * side, 0, z, 14, 3.4, 1, white);                   // x от 6 до 20
      b.box(13 * side, 3.4, z, 14.2, 0.2, 1.1, team, "decor");
    }

    // ---- укрытия ---------------------------------------------------------
    b.box(14 * side, 0, -6, 2.4, 1.2, 2.4, team);                  // кубы по пояс
    b.box(14 * side, 0, 6, 2.4, 1.2, 2.4, team);
    b.box(24 * side, 0, 0, 2, 2.2, 4, dark);                       // щит перед базой
    b.box(7 * side, 0, -12, 1.6, 3.4, 1.6, dark);                  // столбы в рост
    b.box(7 * side, 0, 12, 1.6, 3.4, 1.6, dark);
    b.box(9 * side, 0, -26, 3, 1.3, 1.5, grey);                    // задний коридор
    b.box(9 * side, 0, 26, 3, 1.3, 1.5, grey);
    b.box(26 * side, 0, -24, 2.2, 1.2, 2.2, grey);                 // у точек — пониже
    b.box(26 * side, 0, 24, 2.2, 1.2, 2.2, grey);
    b.box(18 * side, 0, 0, 1, 1.2, 3, white);                      // низкий барьер
  }

  // ---- край арены: видимый борт ----------------------------------------
  b.walls(-45, 45, -30, 30, 30);
  for (const [x, z, w, d, m] of [
    [0, -30.5, 92, 1, dark], [0, 30.5, 92, 1, dark],
    [-45.5, 0, 1, 62, red], [45.5, 0, 1, 62, blue]
  ]){
    b.box(x, 0, z, w, 4, d, m);
  }

  // ---- свет: ровный яркий «стадион» ------------------------------------
  const sun = new THREE.DirectionalLight(0xffffff, 2.1);
  sun.position.set(30, 80, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0015;
  sun.shadow.camera.left = -55; sun.shadow.camera.right = 55;
  sun.shadow.camera.top = 45;   sun.shadow.camera.bottom = -45;
  sun.shadow.camera.far = 200;
  b.light(sun);
  b.light(new THREE.HemisphereLight(0xeef4ff, 0xc9ccd4, 1.9));
  b.light(new THREE.AmbientLight(0xffffff, 0.3));

  return {
    group: b.group,
    colliders: b.colliders,
    sky: 0x9ec9ff,
    fog: { color: 0xd6e6fb, near: 80, far: 240 },
    sites: [[22, 0.1, -14], [22, 0.1, 14]],
    spawns: facing(CENTER, [
      [-38, 0.1, -3], [38, 0.1, 3], [-38, 0.1, 3], [38, 0.1, -3],
      [0, 0.1, -26], [0, 0.1, 26]
    ]),
    teamSpawns: {
      a: facing(CENTER, [[-38, 0.1, -3], [-38, 0.1, 3]]),
      b: facing(CENTER, [[38, 0.1, -3], [38, 0.1, 3]])
    },
    build: b
  };
}
