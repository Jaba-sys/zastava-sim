// drops.js — оружие, выпавшее из убитых.
//
// Убили бойца (человека или бота) — его ствол падает на землю там, где он
// лежит. Подойди и нажми E (на телефоне — кнопку «Заложить»/«Взять»): ствол
// твой до конца жизни, с полным магазином.
//
// Выпавшие стволы живут у каждого СВОИ, в базе их нет. Событие смерти и так
// приходит всем, и каждый кладёт ствол в одно и то же место — считать и
// хранить тут нечего. Подобрал — уходит событие «pickup», и ствол исчезает у
// всех. Если двое схватят его в одну и ту же долю секунды, достанется обоим —
// это дешевле, чем городить ради редкого случая запись в базу.

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js";
import { buildGunModel, disposeGun } from "./gunmodels.js";
import { WEAPONS } from "./weapons.js";

const LIFE = 45;          // секунд лежит, потом исчезает
const REACH = 1.8;        // с какого расстояния можно взять

export class Drops {
  constructor(scene){
    this.scene = scene;
    this.items = new Map();
    this.clock = 0;
    this.prompt = document.createElement("div");
    this.prompt.id = "pickPrompt";
    document.body.append(this.prompt);
  }

  /** Положить ствол на землю. id — один и тот же у всех (см. dropId). */
  add(id, weapon, pos){
    if (!WEAPONS[weapon] || this.items.has(id)) return;
    const { group } = buildGunModel(weapon);
    // На боку, случайно развёрнут — как упал из рук.
    const holder = new THREE.Group();
    group.rotation.z = Math.PI / 2;
    group.position.y = 0.05;
    holder.add(group);
    holder.rotation.y = hash(id) * Math.PI * 2;
    holder.position.set(pos.x, pos.y + 0.02, pos.z);
    holder.traverse(o => { if (o.isMesh){ o.castShadow = true; } });
    this.scene.add(holder);
    this.items.set(id, { id, weapon, holder, model: group, born: this.clock, pos: holder.position });
  }

  remove(id){
    const item = this.items.get(id);
    if (!item) return;
    this.scene.remove(item.holder);
    disposeGun(item.model);
    this.items.delete(id);
  }

  clear(){ for (const id of [...this.items.keys()]) this.remove(id); this.show(null); }

  /** Ближайший ствол, до которого дотянуться. */
  near(pos){
    let best = null, bestD = REACH;
    for (const item of this.items.values()){
      const d = Math.hypot(item.pos.x - pos.x, item.pos.z - pos.z);
      if (d < bestD && Math.abs(item.pos.y - pos.y) < 1.6){ best = item; bestD = d; }
    }
    return best;
  }

  step(dt){
    this.clock += dt;
    for (const item of [...this.items.values()]){
      if (this.clock - item.born > LIFE) this.remove(item.id);
    }
  }

  show(text){
    this.prompt.textContent = text || "";
    this.prompt.classList.toggle("show", !!text);
  }
}

/** Одинаковый у всех ключ выпавшего ствола: кто умер и который раз. */
export function dropId(victim, deaths){
  return `${victim}#${deaths}`;
}

function hash(text){
  let h = 0;
  for (const c of String(text)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (h % 1000) / 1000;
}
