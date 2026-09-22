// hands.js — руки от первого лица.
//
// Раньше ствол висел в воздухе сам по себе. Теперь его держат две руки в
// перчатках и рукавах формы — цвет рукава тот же, что у твоего бойца (сторона
// и персонаж), на запястье — полоса цвета стороны.
//
// Хват у каждого ствола СВОЙ, как у живого человека:
//   автомат     — правая на рукояти, левая снизу на цевье;
//   ПП          — левая ближе, почти у магазина: коротко и цепко;
//   дробовик    — левая на помпе и после каждого выстрела передёргивает её;
//   снайперская — левая под ложем далеко впереди; после выстрела правая
//                 уходит на рукоятку затвора: вверх, назад, вперёд, вниз;
//   пулемёт     — левая сверху-снизу у кожуха, хват шире;
//   нож         — одна правая, обратным хватом ладонь вокруг рукояти;
//   граната     — правая держит, левая у кольца чеки;
//   бомба       — двумя руками по бокам.
// При перезарядке левая рука уходит к магазину, вынимает его вниз из кадра и
// вставляет новый.
//
// Руки — дочерние у того же держателя, что и ствол: качание, отдача и
// прицеливание двигают их вместе с оружием, отдельно считать ничего не надо.
// Своё у рук — только положение кистей относительно ствола.

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js";
import { TEAM_COLORS, GLOVE_COLOR } from "./soldier.js";

const Z = new THREE.Vector3(0, 0, 1);

// Точки хвата — в системе держателя (модель ствола в нём сдвинута на −0.05 по z).
// r / l — где кисть; rDir / lDir — куда от кисти уходит предплечье (к локтю).
// cycle — чем «передёргивать» после выстрела, mag — где магазин для перезарядки.
const HOLDS = {
  rifle:   { r: [0, -0.085, -0.035], l: [0, -0.058, -0.33], mag: [0, -0.12, -0.12] },
  smg:     { r: [0, -0.08, -0.04],   l: [0, -0.062, -0.26], mag: [0, -0.14, -0.14], lDir: [-0.55, -0.42, 0.72] },
  shotgun: { r: [0, -0.07, -0.035],  l: [0, -0.05, -0.38],  mag: [0.03, -0.03, -0.12], cycle: "pump" },
  sniper:  { r: [0, -0.075, -0.04],  l: [0, -0.075, -0.37], mag: [0, -0.1, -0.14], cycle: "bolt" },
  lmg:     { r: [0, -0.095, -0.035], l: [0, -0.05, -0.35],  mag: [0.03, -0.12, -0.13], lDir: [-0.68, -0.3, 0.67] },
  knife:   { r: [0, -0.012, 0.015],  l: null, rDir: [0.3, -0.55, 0.78] },
  nade:    { r: [0.008, -0.03, -0.05], l: [-0.045, 0.03, -0.03], rDir: [0.3, -0.6, 0.74], lDir: [-0.7, -0.35, 0.62] },
  bomb:    { r: [0.075, -0.01, -0.07], l: [-0.07, -0.01, -0.07], rDir: [0.5, -0.45, 0.74], lDir: [-0.5, -0.45, 0.74] }
};
// Правое предплечье идёт почти вдоль ствола назад и чуть вниз-вправо (локоть
// у бока), левое — назад-влево к локтю: так держат оружие у плеча.
const R_DIR = [0.2, -0.45, 0.87];
const L_DIR = [-0.62, -0.32, 0.72];

const mat = (color, rough = 0.85) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.02 });

/** Рука: кисть в начале координат, предплечье уходит по +Z к локтю. */
function buildArm({ cloth, trim, glove }, side){
  const arm = new THREE.Group();
  const box = (w, h, d, m, x, y, z, rx = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.rotation.x = rx;
    arm.add(mesh);
    return mesh;
  };
  // Кисть в перчатке: ладонь, сжатые пальцы, большой палец.
  box(0.062, 0.058, 0.085, glove, 0, 0, 0);
  box(0.064, 0.036, 0.05, glove, 0, 0.022, -0.048, 0.55);         // пальцы обхватывают
  box(0.024, 0.026, 0.055, glove, 0.034 * side, 0.024, -0.012, -0.3); // большой палец
  box(0.05, 0.012, 0.03, mat(0x2a241e, 0.9), 0, 0.027, 0.012);    // тыльная накладка
  // Манжета цвета стороны и рукав формы.
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.033, 0.035, 14), trim);
  cuff.rotation.x = Math.PI / 2;
  cuff.position.z = 0.06;
  arm.add(cuff);
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.043, 0.42, 14), cloth);
  sleeve.rotation.x = Math.PI / 2;
  sleeve.position.z = 0.29;
  arm.add(sleeve);
  // Складки ткани — два тёмных кольца: без них рукав выглядит трубой.
  for (const z of [0.2, 0.36]){
    const fold = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.005, 6, 16), mat(0x000000, 1));
    fold.material.transparent = true;
    fold.material.opacity = 0.25;
    fold.position.z = z;
    arm.add(fold);
  }
  arm.traverse(o => { if (o.isMesh) o.castShadow = false; });
  return arm;
}

export class FpHands {
  /** team — "a" | "b" | "free"; cloth — цвет формы персонажа (или null). */
  constructor(team = "free", cloth = null){
    const c = TEAM_COLORS[team] || TEAM_COLORS.free;
    const mats = { cloth: mat(cloth ?? c.cloth), trim: mat(c.trim, 0.6), glove: mat(GLOVE_COLOR, 0.8) };
    this.right = buildArm(mats, 1);
    this.left = buildArm(mats, -1);
    this.group = new THREE.Group();
    this.group.add(this.right, this.left);
    this.hold = HOLDS.rifle;
    this.weapon = "rifle";
    this.cycleT = 0;          // 1 → 0: идёт передёргивание после выстрела
    this.cycleLen = 0.6;
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
  }

  /** Сменилось оружие: новый хват и ссылки на помпу/затвор в модели. */
  setWeapon(weapon, kind, model){
    this.weapon = weapon;
    this.hold = HOLDS[weapon] || (kind === "knife" ? HOLDS.knife : HOLDS[kind]) || HOLDS.rifle;
    this.pump = model?.getObjectByName("pump") || null;
    this.bolt = model?.getObjectByName("bolt") || null;
    this.cycleT = 0;
  }

  /** Выстрел: у помпового и затворного — передёрнуть. gap — время до следующего. */
  fired(gap){
    if (!this.hold.cycle) return;
    this.cycleLen = Math.max(0.35, gap * 0.85);
    this.cycleT = 1;
  }

  /**
   * reload — доля перезарядки 0…1 (или −1, если не заряжаем).
   */
  update(dt, reload = -1){
    const h = this.hold;
    this.cycleT = Math.max(0, this.cycleT - dt / this.cycleLen);
    const c = 1 - this.cycleT;              // 0 → 1 по ходу передёргивания

    // ---- правая ------------------------------------------------------------
    const r = new THREE.Vector3(...h.r);
    if (h.cycle === "bolt" && this.cycleT > 0 && this.bolt){
      // Затвор: рука к рукоятке, вверх, назад, вперёд, вниз, обратно на рукоять.
      const knob = new THREE.Vector3(0.058, 0.008, -0.05);
      const lift = bump(c, 0.18, 0.38) - bump(c, 0.62, 0.82);
      const pull = bump(c, 0.38, 0.5) - bump(c, 0.5, 0.62);
      const onKnob = smooth(c, 0, 0.18) * (1 - smooth(c, 0.82, 1));
      this.bolt.rotation.z = lift * 1.3;
      this.bolt.position.z = pull * 0.075;
      knob.y += lift * 0.035;
      knob.z += pull * 0.075;
      r.lerp(knob, onKnob);
    } else if (this.bolt){ this.bolt.rotation.z = 0; this.bolt.position.z = 0; }
    this._place(this.right, r, h.rDir || R_DIR);

    // ---- левая -------------------------------------------------------------
    if (!h.l){ this.left.visible = false; return; }
    this.left.visible = true;
    const l = new THREE.Vector3(...h.l);
    if (h.cycle === "pump" && this.pump){
      // Помпа: резко назад и снова вперёд, левая рука вместе с ней.
      const back = this.cycleT > 0 ? bump(c, 0.1, 0.45) - bump(c, 0.5, 0.85) : 0;
      this.pump.position.z = back * 0.085;
      l.z += back * 0.085;
    }
    if (reload >= 0 && h.mag){
      // К магазину → вниз из кадра со старым → с новым обратно → на цевьё.
      const mag = new THREE.Vector3(...h.mag);
      const away = mag.clone().add(new THREE.Vector3(-0.06, -0.3, 0.12));
      if (reload < 0.25) l.lerp(mag, smooth(reload, 0, 0.25));
      else if (reload < 0.5) l.copy(mag).lerp(away, smooth(reload, 0.25, 0.5));
      else if (reload < 0.78) l.copy(away).lerp(mag, smooth(reload, 0.5, 0.78));
      else l.copy(mag).lerp(new THREE.Vector3(...h.l), smooth(reload, 0.78, 1));
    }
    this._place(this.left, l, h.lDir || L_DIR);
  }

  _place(arm, at, dir){
    arm.position.copy(at);
    this._v.set(...dir).normalize();
    this._q.setFromUnitVectors(Z, this._v);
    arm.quaternion.copy(this._q);
  }
}

function smooth(t, a, b){
  const x = Math.max(0, Math.min(1, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
}
/** Плавно 0 → 1 на отрезке [a, b], дальше держится 1. */
function bump(t, a, b){ return smooth(t, a, b); }
