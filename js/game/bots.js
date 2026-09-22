// bots.js — боты на общем сервере.
//
// Зачем они вообще. Круглосуточный сервер без людей — это пустая карта и
// надпись «1 в игре». Человек заходит, видит пустоту и уходит, и следующий
// видит ровно то же самое. Боты разрывают этот круг: зашёл — а там идёт бой.
//
// Кто их считает. Своего сервера у игры нет, поэтому ботов ведёт ОДИН клиент —
// тот же, что крутит раунды: чей ключ сессии меньше всех в комнате. Он держит
// их у себя в голове, двигает, стреляет за них и складывает положение в базу,
// откуда его читают остальные. Ведущий ушёл — следующий по порядку подхватывает
// ботов с их последних позиций и ведёт дальше; мысли прежнего ведущего при
// этом теряются, и бот просто заново решает, куда идти. Это незаметно.
//
// Отсюда и важное свойство: без единого человека в комнате ботов НЕ СЧИТАЕТ
// НИКТО. Пустой сервер не жжёт трафик впустую — и не должен.
//
// Честность. Боты играют по тем же правилам, что люди: та же физика, то же
// оружие с тем же уроном и разбросом, те же стены. Они не видят сквозь
// геометрию и не стреляют сквозь дым. Единственная поблажка себе — они не
// «целятся» мышью, а поворачиваются к цели с ограниченной скоростью, и им
// добавлена задержка реакции: без неё бот попадает в момент появления врага в
// поле зрения, и играть против такого невозможно.

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js";
import { PLAYER, movePlayer, raycast } from "./physics.js";
import { WEAPONS, damageAt } from "./weapons.js";
import { BOMB } from "./modes.js";

export const BOT_PREFIX = "bot:";
export const isBotId = id => typeof id === "string" && id.startsWith(BOT_PREFIX);

/** Сколько ботов держим и как быстро они уходят, когда приходят люди. */
export const CREW = {
  target: 10,          // столько бойцов должно быть в комнате всего
  maxBots: 10,
  sendHz: 8            // как часто их положение уходит в базу
};

// Повадки. Подобраны так, чтобы бота можно было обыграть, а не чтобы он был
// беспомощным: он попадает, но не мгновенно и не всегда.
const SKILL = {
  reaction: [0.17, 0.34], // секунд от «увидел» до первого выстрела (у каждого своя)
  aimSpeed: 6.0,       // радиан в секунду: насколько быстро доворачивает ствол
  aimError: 0.028,     // разброс прицеливания, когда уже «прицелился», радианы
  aimSettle: 1.1,      // за сколько секунд прицел успокаивается (сначала хуже)
  burst: 0.45,         // сколько стреляет очередью
  rest: 0.32,          // и сколько отдыхает между очередями
  sight: 95,           // дальше этого не замечает вовсе, метры
  fov: Math.PI * 0.66, // и не видит того, что сильно сбоку
  lose: 2.5,           // секунд помнит врага, которого потерял из виду
  hear: 48,            // на сколько метров слышит выстрелы
  callout: 32,         // на сколько метров «кричит» своим, что видит врага
  lowHp: 35            // с таким здоровьем уже не лезет, а отходит, отстреливаясь
};

const NAMES = [
  "Сивый", "Тумак", "Кедр", "Штык", "Лось", "Кнопка", "Грач", "Шило",
  "Дрозд", "Батон", "Фитиль", "Хмурый", "Сойка", "Лещ", "Гвоздь", "Пепел"
];

const GUNS = ["rifle", "rifle", "rifle", "smg", "shotgun", "sniper", "lmg"];

/** На какой дистанции каждым стволом удобнее драться. */
const RANGE = { rifle: [8, 30], smg: [4, 16], shotgun: [2, 8], sniper: [18, 70], lmg: [8, 34] };

const up = new THREE.Vector3(0, 1, 0);

/** Один бот. Живёт только в голове ведущего; наружу уходит лишь положение. */
class Bot {
  constructor(id, { name, team, weapon, spawn, yaw }){
    this.id = id;
    this.name = name;
    this.team = team;
    this.weapon = weapon;

    this.pos = spawn.clone();
    this.vel = new THREE.Vector3();
    this.height = PLAYER.height;
    this.yaw = yaw || 0;
    this.pitch = 0;
    this.hp = 100;
    this.alive = true;
    this.kills = 0;
    this.deaths = 0;
    this.respawnAt = 0;

    this.path = null;
    this.step = 0;
    this.goal = null;          // куда идём и зачем
    this.job = "roam";
    this.hold = 0;             // сколько держим кнопку на точке
    this.repath = 0;           // когда пора пересчитать дорогу
    this.role = "roam";        // на раунд: guardA / guardB / hunt (спецназ)
    this.spot = null;          // своё место: где стоять, куда идти
    this.spotUntil = 0;
    this.spotFor = "";         // для чего выбрано место — сменилась задача, выбираем заново

    this.enemy = null;         // кого видим
    this.enemyAt = null;       // где видели последний раз
    this.seenFor = 0;          // сколько секунд уже видим
    this.lostFor = 0;
    this.reaction = 0.25;
    this.fireFor = 0;          // фаза очереди
    this.resting = 0;
    this.lastShot = 0;
    this.mag = this.spec.magazine;
    this.reloadUntil = 0;

    this.investigate = null;   // куда сходить проверить: услышал, свои крикнули
    this.investigateUntil = 0;
    this.heardAt = 0;
    this.strafe = 1;           // в какую сторону сейчас шагает вбок в перестрелке
    this.strafeUntil = 0;
    this.scan = 0;             // осматривается, стоя на месте
  }

  eye(out){ return out.set(this.pos.x, this.pos.y + PLAYER.eye, this.pos.z); }

  get spec(){ return WEAPONS[this.weapon] || WEAPONS.rifle; }

  /** Видит врага прямо сейчас (а не помнит). */
  get engaged(){ return !!this.enemy && this.lostFor === 0; }
}

/**
 * Отряд ботов: заводит, ведёт и выкладывает в базу.
 *
 * Наружу отдаёт ровно то, что нужно main.js: «вот их положение, разошли» и
 * «вот что случилось, сообщи остальным».
 */
export class BotCrew {
  constructor({ map, nav, mode, random = Math.random, hooks = {}, target = CREW.target }){
    this.target = target;       // сколько бойцов (с людьми) держать в комнате
    this.map = map;
    this.nav = nav;
    this.mode = mode;
    this.random = random;
    this.hooks = hooks;         // onShot, onHit, onKill, onPlant, onPlanting, onDefuse
    this.bots = new Map();
    this.nextId = 1;
    this.usedNames = new Set();
    this.clock = 0;
    this.sounds = [];           // недавние выстрелы: { pos, team, at }
    this.attackSite = null;     // куда террористы идут в этом раунде (все вместе)
  }

  get list(){ return [...this.bots.values()]; }

  /** Свой ли это. В «каждый сам за себя» своих нет. */
  _friend(bot, team){ return this.mode?.team !== false && team === bot.team; }

  /**
   * Довести число бойцов до нужного.
   *
   * Считаем ВМЕСТЕ с людьми: цель — чтобы в комнате было десятеро, а не чтобы
   * ботов было десять. Пришёл человек — лишний бот уходит, но не мгновенно:
   * выдёргивать бойца посреди перестрелки некрасиво, поэтому убирают только
   * между раундами (см. release).
   */
  fill(humans, teamCount){
    const want = Math.max(0, Math.min(CREW.maxBots, this.target - humans));
    while (this.bots.size < want) this._add(teamCount);
    return this.bots.size;
  }

  /** Отпустить лишних — зовётся на смене раунда, а не посреди боя. */
  release(humans){
    const want = Math.max(0, Math.min(CREW.maxBots, this.target - humans));
    const extra = this.list.slice(want);
    for (const bot of extra){
      this.bots.delete(bot.id);
      this.usedNames.delete(bot.name);
    }
    return extra.map(bot => bot.id);
  }

  _add(teamCount){
    const id = BOT_PREFIX + (this.nextId++);
    const free = NAMES.filter(n => !this.usedNames.has(n));
    const name = free.length ? free[Math.floor(this.random() * free.length)] : "Боец " + this.nextId;
    this.usedNames.add(name);

    // В какую сторону: туда, где народу меньше. Иначе одна сторона пустая.
    const a = teamCount?.a ?? 0, b = teamCount?.b ?? 0;
    // «Каждый сам за себя» — у ботов нет стороны, как и у людей.
    const team = this.mode?.team === false ? "free" : a <= b ? "a" : "b";
    if (teamCount){ teamCount[team] = (teamCount[team] || 0) + 1; }

    const mates = this.list.filter(x => x.team === team).length;
    const spawn = this._spawnFor(team, mates);
    const bot = new Bot(id, {
      name, team,
      weapon: GUNS[Math.floor(this.random() * GUNS.length)],
      spawn: spawn.pos, yaw: spawn.yaw
    });
    this.bots.set(id, bot);
    this._assignRoles();
    return bot;
  }

  /**
   * Где встать при возрождении. На картах всего по две точки на сторону, а
   * ботов на стороне до пяти — раньше они появлялись друг В ДРУГЕ и так и
   * бегали парами. Теперь каждый следующий встаёт в стороне от точки: кольцом,
   * а стены не пускают (ставим «шагом» от точки, как ходит сам боец).
   */
  _spawnFor(team, index = 0){
    const points = this.map.teamSpawns?.[team]?.length
      ? this.map.teamSpawns[team]
      : this.map.spawns;
    const pick = points[index % points.length] || points[0];
    const pos = new THREE.Vector3(...pick.pos);
    const ring = Math.floor(index / points.length);
    if (ring > 0){
      const a = ring * 2.1 + this.random() * 0.6;
      const body = { pos, vel: new THREE.Vector3(), height: PLAYER.height };
      movePlayer(body, new THREE.Vector3(Math.cos(a) * 1.6 * ring, 0, Math.sin(a) * 1.6 * ring), this.map.colliders);
    }
    return { pos, yaw: pick.yaw || 0 };
  }

  /** Роли спецназа на раунд: кто держит A, кто B, кто ищет врага по карте. */
  _assignRoles(){
    const ct = this.list.filter(b => b.team === "b");
    const roles = ["guardA", "guardB", "hunt", "guardA", "guardB", "hunt"];
    const shift = Math.floor(this.random() * 3);
    ct.forEach((bot, i) => { bot.role = roles[(i + shift) % roles.length]; });
    const sites = this.map.sites || [];
    if (this.attackSite === null && sites.length) this.attackSite = Math.floor(this.random() * sites.length);
  }

  /** Новый раунд: все живы и стоят на своих местах. */
  restart(){
    const count = { a: 0, b: 0 };
    const sites = this.map.sites || [];
    this.attackSite = sites.length ? Math.floor(this.random() * sites.length) : null;
    this.sounds = [];
    for (const bot of this.bots.values()){
      const spawn = this._spawnFor(bot.team, count[bot.team]++);
      bot.pos.copy(spawn.pos);
      bot.vel.set(0, 0, 0);
      bot.yaw = spawn.yaw;
      bot.hp = 100;
      bot.alive = true;
      bot.respawnAt = 0;
      this._forget(bot);
      bot.mag = bot.spec.magazine;
      bot.reloadUntil = 0;
    }
    this._assignRoles();
  }

  _forget(bot){
    bot.path = null;
    bot.goal = null;
    bot.hold = 0;
    bot.enemy = null;
    bot.enemyAt = null;
    bot.investigate = null;
    bot.spot = null;
    bot.spotFor = "";
    bot.rushFor = null;
  }

  /** Записать боту убийство. Зовётся, когда он завалил человека. */
  credit(botId){
    const bot = this.bots.get(botId);
    if (bot) bot.kills++;
  }

  /**
   * Где-то выстрелили. Боты слышат выстрелы врагов и идут проверить — раньше
   * они не замечали перестрелку за углом в десяти метрах.
   */
  hear(pos, team){
    this.sounds.push({ pos: pos.clone(), team, at: this.clock });
    if (this.sounds.length > 24) this.sounds.shift();
  }

  /** Урон боту. Возвращает true, если этим его убили. */
  hurt(botId, damage, fromId, fromName, fromPos){
    const bot = this.bots.get(botId);
    if (!bot || !bot.alive) return false;
    bot.hp -= damage;
    // Попали — значит, враг там, откуда стреляли: разворачиваемся туда.
    if (bot.hp > 0){
      if (fromPos && !bot.engaged) this._alert(bot, fromPos, 5);
      return false;
    }

    bot.hp = 0;
    bot.alive = false;
    bot.deaths++;
    bot.enemy = null;
    bot.respawnAt = this.mode?.respawn === false ? Infinity : this.clock + 5;
    this.credit(fromId);
    const r = v => Math.round(v * 100) / 100;
    this.hooks.onKill?.({ killer: fromId, killerName: fromName, victim: botId, victimName: bot.name,
      x: r(bot.pos.x), y: r(bot.pos.y), z: r(bot.pos.z), w: bot.weapon });
    return true;
  }

  /** Велеть боту проверить место — где стреляли, где свои видели врага. */
  _alert(bot, at, seconds){
    bot.investigate = at.clone ? at.clone() : new THREE.Vector3(at.x, at.y, at.z);
    bot.investigateUntil = this.clock + seconds;
    bot.repath = 0;
  }

  /**
   * Шаг всего отряда.
   *
   * world — то, что боты видят вокруг: живые бойцы (люди и другие боты),
   * состояние бомбы и можно ли сейчас вообще шевелиться.
   */
  step(dt, world){
    this.clock += dt;
    world.dt = dt;
    this.sounds = this.sounds.filter(s => this.clock - s.at < 3);
    for (const bot of this.bots.values()){
      if (!bot.alive){
        if (this.clock >= bot.respawnAt) this._revive(bot);
        continue;
      }
      this._look(bot, dt, world);
      this._listen(bot);
      this._decide(bot, world);
      this._walk(bot, dt, world);
      this._shoot(bot, dt, world);
    }
  }

  _revive(bot){
    const mates = this.list.filter(x => x.team === bot.team && x.alive).length;
    const spawn = this._spawnFor(bot.team, mates);
    bot.pos.copy(spawn.pos);
    bot.vel.set(0, 0, 0);
    bot.yaw = spawn.yaw;
    bot.hp = 100;
    bot.alive = true;
    this._forget(bot);
    bot.mag = bot.spec.magazine;
  }

  // ---- зрение и слух -----------------------------------------------------

  /**
   * Кого видно. Именно ВИДНО: луч от глаз к голове, поле зрения и дальность.
   *
   * Бот, который знает про врага за стеной, ломает всю игру — прятаться от
   * него бессмысленно. Поэтому проверка ровно та же, по которой игра решает,
   * гасить ли имя над головой: raycast по геометрии карты. Дым тоже считается
   * преградой, иначе дымовая граната против ботов не работает вовсе.
   */
  _look(bot, dt, world){
    const eye = bot.eye(new THREE.Vector3());
    const forward = new THREE.Vector3(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));

    let best = null, bestScore = Infinity;
    for (const target of world.fighters){
      if (this._friend(bot, target.team) || target.id === bot.id || target.hp <= 0) continue;

      const head = new THREE.Vector3(target.pos.x, target.pos.y + PLAYER.eye, target.pos.z);
      const to = head.clone().sub(eye);
      const distance = to.length();
      if (distance > SKILL.sight) continue;

      const dir = to.clone().divideScalar(distance);
      const flat = new THREE.Vector3(dir.x, 0, dir.z).normalize();
      // Совсем рядом (шаги за спиной) — чует и сбоку.
      if (distance > 4 && flat.dot(forward) < Math.cos(SKILL.fov / 2)) continue;
      if (raycast(eye, dir, this.map.colliders, [], distance - 0.3)) continue;
      if (world.blocked?.(eye, head)) continue;                        // дым

      // Кого бить первым: ближнего, а из равных — того, кого уже держит на
      // прицеле (не дёргаться между целями) и того, кто слабее.
      let score = distance;
      if (bot.enemy?.id === target.id) score -= 6;
      score -= (100 - target.hp) * 0.04;
      if (score < bestScore){ best = target; bestScore = score; }
    }

    if (best){
      if (bot.enemy?.id !== best.id){
        bot.seenFor = 0;
        bot.reaction = SKILL.reaction[0] + this.random() * (SKILL.reaction[1] - SKILL.reaction[0]);
        // Увидел — крикнул своим: соседи без дела идут на помощь.
        for (const mate of this.bots.values()){
          if (mate === bot || !mate.alive || !this._friend(bot, mate.team) || mate.engaged) continue;
          if (mate.pos.distanceTo(bot.pos) < SKILL.callout) this._alert(mate, best.pos, 6);
        }
      }
      bot.enemy = best;
      bot.enemyAt = new THREE.Vector3(best.pos.x, best.pos.y, best.pos.z);
      bot.seenFor += dt;
      bot.lostFor = 0;
    } else if (bot.enemy){
      bot.lostFor += dt;
      // Совсем забывать врага сразу нельзя: боец, нырнувший за угол,
      // перестал бы существовать, и бот тут же отвернулся бы от него. Потерял
      // — идёт проверить, где видел последний раз.
      if (bot.lostFor > SKILL.lose){
        if (bot.enemyAt) this._alert(bot, bot.enemyAt, 5);
        bot.enemy = null; bot.seenFor = 0;
      }
    }
  }

  /** Слух: выстрелы врагов поблизости — повод пойти посмотреть. */
  _listen(bot){
    if (bot.engaged) return;
    let best = null, bestD = SKILL.hear;
    for (const s of this.sounds){
      if (this._friend(bot, s.team) || s.at <= bot.heardAt) continue;
      const d = s.pos.distanceTo(bot.pos);
      if (d < bestD){ best = s; bestD = d; }
    }
    if (!best) return;
    bot.heardAt = best.at;
    this._alert(bot, best.pos, 6);
  }

  // ---- решение: куда идти ------------------------------------------------

  _decide(bot, world){
    if (this.clock < bot.repath && bot.path) return;

    const goal = this._goalFor(bot, world);
    if (!goal) return;

    // Пересчитываем дорогу, только если цель уехала: путь по сетке стоит
    // миллисекунды, но десять ботов по шестьдесят раз в секунду — это уже
    // заметно, а цель почти всегда там же, где была.
    const moved = !bot.goal || bot.goal.distanceTo(goal) > 2.5;
    if (moved || !bot.path || bot.step >= bot.path.length){
      const path = this.nav.path(bot.pos, goal);
      if (path){
        bot.path = path;
        bot.step = 0;
        bot.goal = goal.clone();
      } else {
        // Дороги нет. Раньше бот в этом случае всё равно получал цель и шёл к
        // ней напрямик — то есть упирался в скалу и стоял в неё до конца
        // раунда. Теперь он честно признаёт, что туда не пройти, и идёт куда
        // может: на другую точку, а если и туда никак — просто гулять.
        bot.spot = null;
        this._giveUp(bot, world);
      }
    }
    bot.repath = this.clock + 0.5 + this.random() * 0.5;
  }

  /** Цель недостижима — выбираем другую, до которой дорога есть. */
  _giveUp(bot){
    const sites = this.map.sites || [];
    const tries = [];
    for (let i = 0; i < sites.length; i++) tries.push(new THREE.Vector3(...sites[i]));
    for (let k = 0; k < 4; k++){
      const spot = this.nav.randomSpot(this.random);
      if (spot) tries.push(spot);
    }
    for (const at of tries.sort(() => this.random() - 0.5)){
      const path = this.nav.path(bot.pos, at);
      if (!path) continue;
      bot.path = path;
      bot.step = 0;
      bot.goal = at.clone();
      bot.spot = at.clone();
      bot.spotUntil = this.clock + 8;
      return;
    }
    // Совсем некуда — стоим. Лучше, чем упираться в стену.
    bot.path = null;
    bot.goal = null;
  }

  /**
   * Своё место под задачу. Выбирается один раз и держится, пока задача та же
   * (или пока не выйдет срок — тогда патруль переходит на соседнее место).
   * Главное тут — «вокруг», а не «в»: десять ботов с одной и той же целью
   * «середина точки A» и дают ту самую кучу, в которой все стоят друг в друге.
   */
  _spot(bot, key, center, rMin, rMax, seconds = Infinity){
    if (bot.spotFor !== key || !bot.spot || this.clock > bot.spotUntil){
      bot.spotFor = key;
      bot.spot = this.nav.spotNear(center, rMin, rMax, this.random);
      bot.spotUntil = this.clock + seconds * (0.7 + this.random() * 0.6);
    }
    return bot.spot;
  }

  _goalFor(bot, world){
    const bomb = world.bomb;
    const sites = this.map.sites || [];
    const siteVec = i => new THREE.Vector3(...sites[i]);
    const investigating = bot.investigate && this.clock < bot.investigateUntil;

    if (this.mode?.id === "bomb" && sites.length){
      const state = bomb?.state;
      const bombAt = bomb && typeof bomb.x === "number" ? new THREE.Vector3(bomb.x, bomb.y, bomb.z) : null;

      if (state === "planted" && bombAt){
        if (bot.team === "b"){
          // Снимать идёт ближайший из ботов спецназа; остальные прикрывают
          // его вокруг точки, а не толпятся на бомбе.
          const defuser = this._nearest(bombAt, "b");
          if (defuser === bot){ bot.job = "defuse"; return bombAt; }
          bot.job = "cover";
          if (bot.engaged && investigating) return bot.investigate;
          return this._spot(bot, "cover", bombAt, 4, 10, 12);
        }
        bot.job = "guard";
        if (investigating && bot.investigate.distanceTo(bombAt) < 25) return bot.investigate;
        return this._spot(bot, "guard", bombAt, 5, 13, 14);
      }

      if (bot.team === "a"){
        if (state === "dropped" && bombAt && this._nearest(bombAt, "a") === bot){
          bot.job = "fetch";                        // бомба на земле — подобрать
          return bombAt;
        }
        const site = this.attackSite ?? this._siteFor(bot, sites);
        if (world.carrier === bot.id){ bot.job = "plant"; bot.site = site; return siteVec(site); }
        bot.job = "push";
        if (investigating) return bot.investigate;
        return this._spot(bot, "push" + site, siteVec(site), 3, 10, 16);
      }

      // Спецназ. «Закладывают!» — бросают всё и бегут на СЛУЧАЙНУЮ точку:
      // какую именно закладывают, они не знают, только слышат.
      const heard = typeof bomb?.planting === "number" && world.now - bomb.planting < 9000;
      if (heard){
        if (bot.rushFor !== bomb.planting){
          bot.rushFor = bomb.planting;
          bot.rushSite = Math.floor(this.random() * sites.length);
          bot.spot = null;
        }
        bot.job = "rush";
        return this._spot(bot, "rush" + bot.rushSite, siteVec(bot.rushSite), 1, 5);
      }
      // До закладки спецназ ДЕРЁТСЯ: услышал или свои увидели — идёт туда.
      if (investigating){ bot.job = "fight"; return bot.investigate; }
      if (bot.role === "hunt"){
        bot.job = "hunt";
        if (bot.spotFor !== "hunt" || !bot.spot || this.clock > bot.spotUntil){
          bot.spotFor = "hunt";
          bot.spot = this.nav.randomSpot(this.random);
          bot.spotUntil = this.clock + 10 + this.random() * 8;
        }
        return bot.spot;
      }
      const guard = bot.role === "guardB" && sites.length > 1 ? 1 : 0;
      bot.job = "hold";
      return this._spot(bot, "hold" + guard, siteVec(guard), 5, 14, 18);
    }

    // В обычных режимах идём к тому, кого видели или слышали, иначе — гуляем.
    if (investigating){ bot.job = "fight"; return bot.investigate; }
    bot.job = "roam";
    if (bot.spotFor !== "roam" || !bot.spot || this.clock > bot.spotUntil){
      bot.spotFor = "roam";
      bot.spot = this.nav.randomSpot(this.random);
      bot.spotUntil = this.clock + 12 + this.random() * 10;
    }
    return bot.spot;
  }

  /** Ближайший живой бот стороны к точке. */
  _nearest(at, team){
    let best = null, bestD = Infinity;
    for (const b of this.bots.values()){
      if (!b.alive || b.team !== team) continue;
      const d = b.pos.distanceTo(at);
      if (d < bestD){ best = b; bestD = d; }
    }
    return best;
  }

  /** Какую точку этот бот считает «своей» в этом раунде. */
  _siteFor(bot, sites){
    if (bot.site === undefined || bot.site >= sites.length){
      bot.site = Math.floor(this.random() * sites.length);
    }
    return bot.site;
  }

  // ---- движение ----------------------------------------------------------

  _walk(bot, dt, world){
    if (world.frozen){ bot.vel.x = 0; bot.vel.z = 0; }

    const wantStill = this._working(bot, world);
    let wish = new THREE.Vector3();
    let speed = PLAYER.speed;

    // Куда шагать: по пути, а когда путь кончился — прямо к цели.
    //
    // Последнее важнее, чем кажется. Путь идёт по клеткам сетки, и последняя
    // клетка отстоит от настоящей цели на шаг сетки. Пока бот на ней и
    // останавливался, он замирал в трёх-четырёх метрах от точки закладки — то
    // есть НЕ в зоне, — и упорно ничего не закладывал, хотя стоял почти на
    // месте. Со стороны это выглядело как тупой бот, а на деле не хватало
    // последних двух метров.
    let point = null;
    if (!wantStill){
      let arrive = 1.2;
      if (bot.path && bot.step < bot.path.length) point = bot.path[bot.step];
      // Напрямик — только когда путь пройден до конца. Без пути идти напрямик
      // нельзя: это и есть «бот уткнулся в стену».
      else if (bot.path && bot.goal){ point = bot.goal; arrive = 0.7; }

      if (point){
        const flat = new THREE.Vector3(point.x - bot.pos.x, 0, point.z - bot.pos.z);
        if (flat.length() < arrive){
          if (bot.path && bot.step < bot.path.length) bot.step++;
        } else {
          wish = flat.normalize();
        }
      }
    }

    // Перестрелка: не стоять столбом и не бежать по прямой, а шагать вбок
    // (из стороны в сторону, в разном ритме), держать удобную своему стволу
    // дистанцию, а раненым — отходить. Срочное дело (закладка, разминирование,
    // подбор бомбы) важнее: туда идут, отстреливаясь на ходу.
    const urgent = ["plant", "defuse", "fetch", "rush"].includes(bot.job);
    if (bot.engaged && !wantStill && !world.frozen){
      const to = new THREE.Vector3(bot.enemy.pos.x - bot.pos.x, 0, bot.enemy.pos.z - bot.pos.z);
      const d = to.length() || 1;
      to.divideScalar(d);
      const side = new THREE.Vector3(-to.z, 0, to.x);
      if (this.clock > bot.strafeUntil){
        bot.strafe = this.random() < 0.5 ? -1 : 1;
        bot.strafeUntil = this.clock + 0.35 + this.random() * 0.8;
      }
      const [near, far] = RANGE[bot.weapon] || RANGE.rifle;
      let approach = 0;
      if (bot.hp < SKILL.lowHp) approach = -0.9;                 // ранен — назад
      else if (d > far) approach = 0.8;
      else if (d < near) approach = -0.6;
      const fight = side.multiplyScalar(bot.strafe).addScaledVector(to, approach);
      wish = urgent && wish.lengthSq() ? wish.multiplyScalar(0.8).addScaledVector(fight, 0.5) : fight;
      if (wish.lengthSq() > 1) wish.normalize();
      // Снайпер стреляет стоя: на бегу его ствол бесполезен.
      speed = bot.weapon === "sniper" && !urgent ? PLAYER.speed * 0.25 : PLAYER.speed * 0.62;
    }

    // Не залезать друг в друга: соседи ближе метра расталкиваются. Раньше двое
    // с одинаковой целью шли одной и той же дорогой и так и стояли слипшись.
    const push = new THREE.Vector3();
    for (const other of world.fighters){
      if (other.id === bot.id || other.hp <= 0) continue;
      const dx = bot.pos.x - other.pos.x, dz = bot.pos.z - other.pos.z;
      if (Math.abs(bot.pos.y - other.pos.y) > 1.5) continue;
      const d = Math.hypot(dx, dz);
      if (d > 1.1) continue;
      if (d < 0.05){ const a = this.random() * Math.PI * 2; push.x += Math.cos(a); push.z += Math.sin(a); continue; }
      push.x += dx / d * (1.1 - d) * 2.2;
      push.z += dz / d * (1.1 - d) * 2.2;
    }
    if (push.lengthSq() > 0){
      wish.add(push);
      if (wish.lengthSq() > 1) wish.normalize();
    }

    const target = wish.multiplyScalar(speed);
    const accel = 12 * dt;
    bot.vel.x += (target.x - bot.vel.x) * Math.min(1, accel);
    bot.vel.z += (target.z - bot.vel.z) * Math.min(1, accel);
    bot.vel.y -= PLAYER.gravity * dt;

    const { grounded } = movePlayer(bot, bot.vel.clone().multiplyScalar(dt), this.map.colliders);
    if (grounded && bot.vel.y < 0) bot.vel.y = 0;

    // Застрял ли.
    //
    // Смотрим не «сдвинулся ли», а «ПРИБЛИЗИЛСЯ ли к точке, куда идёт». Разница
    // решающая: бот, упёршийся в угол, не стоит — он скользит вдоль стены и
    // прекрасно «двигается», просто никуда. Раз в секунду сверяем расстояние до
    // цели: не сократилось — значит дорога не работает, пробуем следующую точку
    // пути, а кончились — ищем заново. В перестрелке не проверяем: там бот
    // шагает вбок нарочно.
    if (!wantStill && point && !bot.engaged){
      if (this.clock - (bot.progressAt || 0) > 1){
        const now = Math.hypot(point.x - bot.pos.x, point.z - bot.pos.z);
        if (bot.lastGap !== undefined && now > bot.lastGap - 0.4){
          if (bot.path && bot.step < bot.path.length - 1) bot.step++;
          else { bot.path = null; bot.goal = null; bot.repath = 0; }
          bot.lastGap = undefined;
        } else bot.lastGap = now;
        bot.progressAt = this.clock;
      }
    } else {
      bot.lastGap = undefined;
      bot.progressAt = this.clock;
    }

    // Куда смотрит: на врага, если видит; на место, где его видели или
    // слышали; по ходу движения; а стоя на месте — осматривается.
    let aim = null;
    if (bot.enemy) aim = new THREE.Vector3(bot.enemy.pos.x, bot.enemy.pos.y + PLAYER.eye, bot.enemy.pos.z);
    else if (bot.investigate && this.clock < bot.investigateUntil && bot.investigate.distanceTo(bot.pos) > 2)
      aim = bot.investigate.clone().setY(bot.investigate.y + PLAYER.eye);
    else if (point && wish.lengthSq() > 0.1) aim = point.clone().setY(bot.pos.y + PLAYER.eye);
    const eye = bot.eye(new THREE.Vector3());
    if (aim){
      const to = aim.clone().sub(eye);
      const wantYaw = Math.atan2(-to.x, -to.z);
      const wantPitch = Math.atan2(to.y, Math.hypot(to.x, to.z));
      bot.yaw += angleTo(bot.yaw, wantYaw) * Math.min(1, SKILL.aimSpeed * dt);
      bot.pitch += (wantPitch - bot.pitch) * Math.min(1, SKILL.aimSpeed * dt);
    } else {
      // Стоит на месте: медленно водит взглядом из стороны в сторону, чтобы
      // не прозевать того, кто зайдёт сбоку.
      bot.scan += dt;
      bot.yaw += Math.sin(bot.scan * 0.7) * 0.9 * dt;
      bot.pitch *= 1 - Math.min(1, dt * 2);
    }
  }

  /** Стоит ли бот на месте и делает дело — закладывает или снимает. */
  _working(bot, world){
    if (this.mode?.id !== "bomb" || world.frozen) return false;
    const sites = this.map.sites || [];
    const bomb = world.bomb;
    const planted = bomb?.state === "planted";

    if (bot.team === "a" && !planted && world.carrier === bot.id){
      const site = bot.site ?? this._siteFor(bot, sites);
      const at = sites[site];
      if (!at) return false;
      // Та же зона, что у человека, только с небольшим запасом от края: бот
      // подходит к середине, и на границе ему делать нечего.
      const near = Math.hypot(bot.pos.x - at[0], bot.pos.z - at[2]) < BOMB.siteRadius * 0.9
                && Math.abs(bot.pos.y - at[1]) < 3.5;
      if (!near) return false;
      if (bot.hold === 0) this.hooks.onPlanting?.({ bot, site });   // спецназ слышит
      bot.hold += world.dt;
      if (bot.hold >= BOMB.plantTime){
        bot.hold = 0;
        this.hooks.onPlant?.({ bot, site, at });
      }
      return true;
    }

    if (bot.team === "b" && planted){
      const near = Math.hypot(bot.pos.x - bomb.x, bot.pos.z - bomb.z) < 2.0
                && Math.abs(bot.pos.y - bomb.y) < 3.5;
      if (!near) return false;
      bot.hold += world.dt;
      if (bot.hold >= BOMB.defuseTime){
        bot.hold = 0;
        this.hooks.onDefuse?.({ bot });
      }
      return true;
    }

    bot.hold = 0;
    return false;
  }

  // ---- стрельба ----------------------------------------------------------

  _shoot(bot, dt, world){
    const spec = bot.spec;
    // Перезарядка: пустой магазин — ждём; без врага и полупустой — дозаряжаем.
    if (bot.reloadUntil){
      if (this.clock < bot.reloadUntil) return;
      bot.reloadUntil = 0;
      bot.mag = spec.magazine;
    }
    if (!bot.engaged && bot.mag < spec.magazine * 0.4 && !world.frozen){
      bot.reloadUntil = this.clock + spec.reload;
      return;
    }
    if (!bot.enemy || world.frozen || bot.lostFor > 0.6) return;
    // Задержка реакции: бот не открывает огонь в тот же кадр, в котором увидел.
    if (bot.seenFor < bot.reaction) return;

    if (bot.resting > 0){ bot.resting -= dt; return; }
    bot.fireFor += dt;
    if (bot.fireFor > SKILL.burst){ bot.fireFor = 0; bot.resting = SKILL.rest * (0.6 + this.random() * 0.8); return; }

    const gap = 60 / spec.rpm;
    if (this.clock - bot.lastShot < gap) return;
    bot.lastShot = this.clock;
    if (bot.mag <= 0){ bot.reloadUntil = this.clock + spec.reload; return; }
    bot.mag--;

    const eye = bot.eye(new THREE.Vector3());
    // Целится то в грудь, то в голову — как человек, а не лазером в одну точку.
    const aimHead = this.random() < 0.2;
    const aimY = aimHead ? PLAYER.eye * 0.97 : PLAYER.eye * 0.72;
    const head = new THREE.Vector3(bot.enemy.pos.x, bot.enemy.pos.y + aimY, bot.enemy.pos.z);
    const base = head.clone().sub(eye).normalize();
    const distance = eye.distanceTo(head);

    // Разброс: сначала хуже, потом прицел успокаивается; на бегу — хуже.
    const settle = 1.8 - Math.min(1, bot.seenFor / SKILL.aimSettle) * 0.8;
    const moving = Math.hypot(bot.vel.x, bot.vel.z) > 1;
    const aimErr = SKILL.aimError * settle * (moving ? 1.6 : 1);

    const pellets = spec.pellets || 1;
    let damage = 0, end = null;
    for (let p = 0; p < pellets; p++){
      const dir = base.clone();
      const spread = pellets > 1 ? Math.max(aimErr, spec.spread) : aimErr;
      dir.applyAxisAngle(up, (this.random() - 0.5) * spread * 2);
      dir.applyAxisAngle(new THREE.Vector3(dir.z, 0, -dir.x).normalize(), (this.random() - 0.5) * spread * 2);
      const wall = raycast(eye, dir, this.map.colliders, [], distance);
      if (!end) end = eye.clone().addScaledVector(dir, wall ? wall.distance : distance);
      if (wall) continue;                    // попал в стену, а не в человека
      // Проверка попадания по коробке цели — тем же способом, что у игрока.
      // В голову — ×1.6, как и у людей (main.js, HEAD_MULT).
      if (hitsBox(eye, dir, bot.enemy, distance + 0.5)) damage += damageAt(spec, distance) * (aimHead && pellets === 1 ? 1.6 : 1);
    }
    this.hooks.onShot?.({ bot, from: eye, to: end });
    this.hear(bot.pos, bot.team);
    if (damage > 0) this.hooks.onHit?.({ bot, target: bot.enemy, damage });
  }

  /**
   * Что уходит в базу: только то, без чего чужого бойца не нарисовать, и
   * только про тех, у кого хоть что-то изменилось.
   *
   * Второе важнее первого. Выкладка всех десятерых восемь раз в секунду — это
   * почти одиннадцать килобайт в секунду на каждого, кто в комнате, то есть
   * четыре с половиной гигабайта в месяц при двух часах игры вдвоём — почти
   * весь бесплатный месячный лимит Realtime Database. А шевелится в каждый
   * момент далеко не всякий: убитые в заминировании лежат до конца раунда и не
   * меняются вовсе, стоящие в засаде — тоже. Отправлять их снова незачем.
   *
   * Сравниваем по ОКРУГЛЁННЫМ числам, тем самым, что уходят в базу: дрожание в
   * сотой доле метра всё равно не долетит, а «изменением» считалось бы каждый
   * раз.
   */
  snapshot(){
    const patch = {};
    for (const bot of this.bots.values()){
      const row = {
        uid: bot.id, name: bot.name, team: bot.team, bot: true,
        x: round(bot.pos.x), y: round(bot.pos.y), z: round(bot.pos.z),
        yaw: round(bot.yaw), pitch: round(bot.pitch),
        w: bot.weapon, hp: Math.round(bot.hp),
        kills: bot.kills, deaths: bot.deaths
      };
      const mark = `${row.x},${row.y},${row.z},${row.yaw},${row.pitch},${row.hp},${row.kills},${row.deaths}`;
      if (bot.sent === mark) continue;
      bot.sent = mark;
      patch[bot.id] = row;
    }
    return patch;
  }

  /** Полная выкладка — на смене раунда и когда отряд только собрался. */
  snapshotAll(){
    for (const bot of this.bots.values()) bot.sent = null;
    return this.snapshot();
  }
}

/** Разница углов, приведённая к отрезку от -π до π. */
function angleTo(from, to){
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Задевает ли луч коробку бойца. */
function hitsBox(origin, dir, target, maxDistance){
  const half = PLAYER.width / 2;
  const box = new THREE.Box3(
    new THREE.Vector3(target.pos.x - half, target.pos.y, target.pos.z - half),
    new THREE.Vector3(target.pos.x + half, target.pos.y + PLAYER.height, target.pos.z + half));
  const ray = new THREE.Ray(origin, dir);
  const point = ray.intersectBox(box, new THREE.Vector3());
  return !!point && origin.distanceTo(point) <= maxDistance;
}

const round = v => Math.round(v * 100) / 100;
