// fx.js — цифры урона и «ликвидирован», как в Rivals.
//
// Попал — над целью всплывает число урона: белое по телу, жёлтое в голову.
// Очередь по одной цели складывается в одно растущее число, а не в рой цифр:
// так и видно, сколько снял за очередь. Убил — снизу по центру короткая
// плашка «ЛИКВИДИРОВАН» с именем.
//
// Цифры — обычные DOM-элементы, их положение каждый кадр пересчитывается из
// точки в мире в точку на экране. Это дешевле спрайтов и всегда чётко.

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js";

const LIFE = 0.9;         // секунд висит число
const MERGE = 0.55;       // попадания по той же цели за это время складываются

export class DamageNumbers {
  constructor(camera){
    this.camera = camera;
    this.box = document.createElement("div");
    this.box.id = "dmgNums";
    document.body.append(this.box);
    this.items = [];
    this.elim = document.createElement("div");
    this.elim.id = "elim";
    this.elim.innerHTML = "<b>ЛИКВИДИРОВАН</b><span></span>";
    document.body.append(this.elim);
    this._v = new THREE.Vector3();
  }

  /** Попадание по цели targetId в точке point. */
  hit(targetId, point, damage, head = false){
    const now = performance.now() / 1000;
    const same = this.items.find(i => i.target === targetId && now - i.last < MERGE);
    if (same){
      same.value += damage;
      same.head = same.head || head;
      same.last = now;
      same.born = now;
      same.pos.copy(point);
      this._paint(same, true);
      return;
    }
    const el = document.createElement("i");
    this.box.append(el);
    const item = { target: targetId, value: damage, head, born: now, last: now, pos: point.clone(), el,
                   drift: (Math.random() - 0.5) * 30 };
    this.items.push(item);
    this._paint(item, true);
  }

  _paint(item, pop){
    item.el.textContent = Math.round(item.value);
    item.el.className = item.head ? "head" : "";
    if (pop){
      item.el.style.animation = "none";
      void item.el.offsetWidth;          // перезапустить «пружинку»
      item.el.style.animation = "";
    }
  }

  kill(name){
    this.elim.querySelector("span").textContent = name || "";
    this.elim.classList.remove("show");
    void this.elim.offsetWidth;
    this.elim.classList.add("show");
    clearTimeout(this._t);
    this._t = setTimeout(() => this.elim.classList.remove("show"), 1600);
  }

  update(){
    const now = performance.now() / 1000;
    const w = innerWidth, h = innerHeight;
    for (const item of [...this.items]){
      const age = now - item.born;
      if (age > LIFE){ item.el.remove(); this.items.splice(this.items.indexOf(item), 1); continue; }
      const v = this._v.copy(item.pos).project(this.camera);
      if (v.z > 1){ item.el.style.opacity = 0; continue; }
      const x = (v.x * 0.5 + 0.5) * w + item.drift * age;
      const y = (-v.y * 0.5 + 0.5) * h - 30 - age * 38;
      item.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
      item.el.style.opacity = String(Math.min(1, (LIFE - age) / 0.25));
    }
  }
}
