// weapons.js — оружие: характеристики, цены, отдача, перезарядка, урон.
//
// Стрельба — лучом, а не летящей пулей: на дистанциях этих карт разница
// незаметна, а расхождений между тем, что видит стрелок, и тем, что видит
// цель, на порядок меньше. Урон считает СТРЕЛЯЮЩИЙ и сообщает жертве. Это
// доверие к клиенту, и оно осознанное: без своего сервера проверить выстрел
// негде. Что из этого следует — написано в README, в разделе про доверие.
//
// Цены и баланс. Пять стволов подобраны так, чтобы ни один не был «лучше
// всех»: у каждого есть дистанция, на которой он выигрывает, и дистанция, на
// которой проигрывает. Дорогой пулемёт не сильнее автомата в прямой
// перестрелке — он просто дольше не требует перезарядки. Иначе покупка
// превращается в «кто дольше играл, тот и побеждает», а это скучно.

export const WEAPONS = {
  rifle: {
    id: "rifle",
    name: "Автомат",
    short: "АК",           // для полосы слотов: там места мало
    about: "Ровный середняк: годится везде, нигде не лучший",
    price: 0,                // выдаётся сразу, его нельзя не иметь
    damage: 24,
    rpm: 620,                // выстрелов в минуту
    magazine: 30,
    reload: 2.1,
    spread: 0.011,           // разброс в покое, радианы
    spreadMoving: 0.035,
    recoil: 0.009,
    falloffStart: 45,        // с какой дистанции урон начинает падать
    falloffEnd: 120,
    falloffMin: 0.55,
    pellets: 1,
    zoom: 1.35               // во сколько раз приближает прицеливание
  },

  smg: {
    id: "smg",
    name: "Пистолет-пулемёт",
    short: "ПП",           // для полосы слотов: там места мало
    about: "Очень скорострельный, но дальше двадцати метров бесполезен",
    price: 250,
    damage: 15,
    rpm: 950,
    magazine: 32,
    reload: 1.7,
    spread: 0.022,
    spreadMoving: 0.05,
    recoil: 0.006,
    falloffStart: 18,
    falloffEnd: 55,
    falloffMin: 0.32,
    pellets: 1,
    zoom: 1.25
  },

  shotgun: {
    id: "shotgun",
    name: "Дробовик",
    short: "Дробовик",           // для полосы слотов: там места мало
    about: "Вплотную убивает с одного выстрела, дальше — щекочет",
    price: 400,
    damage: 13,              // на дробину; вплотную все восемь — это 104
    rpm: 78,
    magazine: 6,
    reload: 3.0,
    spread: 0.055,
    spreadMoving: 0.075,
    recoil: 0.035,
    falloffStart: 9,
    falloffEnd: 30,
    falloffMin: 0.12,
    pellets: 8,
    zoom: 1.15
  },

  sniper: {
    id: "sniper",
    name: "Винтовка",
    short: "Винтовка",           // для полосы слотов: там места мало
    about: "Два попадания — и готово, но между выстрелами целая секунда",
    price: 750,
    damage: 58,
    rpm: 45,
    magazine: 5,
    reload: 3.4,
    spread: 0.0016,          // почти точно — но только стоя на месте
    spreadMoving: 0.06,      // на бегу стрелять бессмысленно
    recoil: 0.05,
    falloffStart: 130,
    falloffEnd: 240,
    falloffMin: 0.85,
    pellets: 1,
    zoom: 3.4                // единственный ствол с настоящим прицелом
  },

  lmg: {
    id: "lmg",
    name: "Пулемёт",
    short: "Пулемёт",           // для полосы слотов: там места мало
    about: "Сто патронов подряд; перезарядка — пять секунд беспомощности",
    price: 1100,
    damage: 20,
    rpm: 700,
    magazine: 100,
    reload: 5.2,
    spread: 0.03,
    spreadMoving: 0.075,
    recoil: 0.012,
    falloffStart: 35,
    falloffEnd: 110,
    falloffMin: 0.5,
    pellets: 1,
    zoom: 1.2
  }
};

// Порядок в оружейной: от бесплатного к дорогому.
export const WEAPON_ORDER = ["rifle", "smg", "shotgun", "sniper", "lmg"];

// Что есть у игрока с самого начала и с чем он идёт в бой, пока ничего не
// выбрал. Автомат бесплатный, поэтому второго ствола поначалу просто нет.
export const STARTER_OWNED = ["rifle"];
export const DEFAULT_LOADOUT = ["rifle"];

export const LOADOUT_SLOTS = 2;

export function weaponById(id){
  return WEAPONS[id] || WEAPONS.rifle;
}

/** Сколько монет за убийство этим стволом. Дорогой ствол не кормит лучше. */
export const COINS_PER_KILL = 12;
export const COINS_PER_MATCH = 25;   // просто за то, что доиграл до конца

// ---------------------------------------------------------------------------
// Состояние оружия в бою
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Ножи
//
// Все ножи бьют ОДИНАКОВО — отличаются только видом. Так устроено в любом
// честном шутере: за нож платят за красоту, а не за силу, иначе покупка решала
// бы исход ближнего боя. Обычный нож есть у всех с первого захода.
// ---------------------------------------------------------------------------

const MELEE = {
  kind: "melee",
  damage: 55,              // два удара — и готово
  rpm: 100,                // удар раз в 0.6 с
  range: 2.3,              // метры: дотянуться до стоящего вплотную
  magazine: Infinity, reload: 0,
  spread: 0, spreadMoving: 0, recoil: 0, pellets: 1, zoom: 1,
  falloffStart: 99, falloffEnd: 100, falloffMin: 1,
  // С ножом бегают быстрее — ради этого его и достают, когда надо добежать.
  speedMul: 1.18
};

export const KNIVES = {
  knife:     { ...MELEE, id: "knife",     name: "Нож",       short: "Нож",      price: 0,
               about: "Есть у всех. Два удара — и готово, а бегать с ним быстрее" },
  bayonet:   { ...MELEE, id: "bayonet",   name: "Штык-нож",  short: "Штык",     price: 400,
               about: "Длинный клинок с долом и рифлёной рукоятью" },
  karambit:  { ...MELEE, id: "karambit",  name: "Керамбит",  short: "Керамбит", price: 700,
               about: "Изогнутый коготь с кольцом под палец" },
  butterfly: { ...MELEE, id: "butterfly", name: "Бабочка",   short: "Бабочка",  price: 1000,
               about: "Клинок между двух раскрывающихся рукоятей" }
};
export const KNIFE_ORDER = ["knife", "bayonet", "karambit", "butterfly"];

/** Какой нож носить. Выбор — на устройстве; некупленный заменяется обычным. */
const KNIFE_KEY = "zastava.knife";
export function equippedKnife(owned = []){
  let id = "knife";
  try { id = localStorage.getItem(KNIFE_KEY) || "knife"; } catch { /* ignore */ }
  return KNIVES[id] && (id === "knife" || owned.includes(id)) ? id : "knife";
}
export function equipKnife(id){
  try { localStorage.setItem(KNIFE_KEY, id); } catch { /* ignore */ }
}

// То, что берут в руки, но не стреляет: граната и бомба. Они тоже занимают
// цифру на полосе слотов — нажал, достал, ЛКМ — бросил или заложил.
export const HAND = {
  nade: { id: "nade", kind: "nade", name: "Граната", short: "Граната", zoom: 1, speedMul: 1.05, magazine: 0 },
  bomb: { id: "bomb", kind: "bomb", name: "Бомба",   short: "Бомба",   zoom: 1, speedMul: 1,    magazine: 0 }
};

export function itemById(id){
  return WEAPONS[id] || KNIVES[id] || HAND[id] || WEAPONS.rifle;
}

/**
 * Все купленные стволы в порядке слотов: сначала набор из лобби (первый
 * ствол — основной, с ним и возрождаешься), затем остальные купленные.
 * Раньше в бой шло только два ствола из набора, и купивший третий не мог
 * вернуться к старому автомату, не заходя в лобби.
 */
export function gunsFor(loadout = [], owned = []){
  const first = (Array.isArray(loadout) ? loadout : []).filter(id => WEAPONS[id] && (owned.includes(id) || id === "rifle"));
  const rest = WEAPON_ORDER.filter(id => !first.includes(id) && (owned.includes(id) || id === "rifle"));
  return [...first, ...rest];
}

export class Arsenal {
  /**
   * guns — стволы по порядку слотов (см. gunsFor); knife — какой нож носить.
   * Кривой или пустой список заменяется автоматом.
   */
  constructor(guns, { knife = "knife" } = {}){
    const clean = (Array.isArray(guns) ? guns : []).filter(id => WEAPONS[id]);
    this.guns = clean.length ? clean : ["rifle"];
    this.knife = KNIVES[knife] ? knife : "knife";
    this.extras = [];
    this.bombKey = 0;             // 5 — в заминировании (см. keys)
    this.order = [...this.guns, this.knife];

    this.baseGuns = [...this.guns];   // с чем возрождаешься (подобранное — на одну жизнь)

    this.index = 0;
    this.ammo = {};
    for (const id of this.guns) this.ammo[id] = WEAPONS[id].magazine;

    this.reloadingUntil = 0;
    this.nextShotAt = 0;
  }

  get current(){ return itemById(this.order[this.index]); }
  get isGun(){ return !!WEAPONS[this.order[this.index]]; }
  get isMelee(){ return this.current.kind === "melee"; }
  get inMagazine(){ return this.isGun ? this.ammo[this.current.id] : Infinity; }
  get reloading(){ return performance.now() / 1000 < this.reloadingUntil; }

  /**
   * Граната и бомба появляются и исчезают по ходу боя: бомбу передали,
   * гранаты кончились. Порядок слотов пересобирается, а то, что в руках,
   * остаётся в руках — если оно ещё есть.
   */
  setExtras({ nade = false, bomb = false } = {}){
    const extras = [...(nade ? ["nade"] : []), ...(bomb ? ["bomb"] : [])];
    if (extras.join() === this.extras.join()) return false;
    const held = this.order[this.index];
    this.extras = extras;
    this.order = [...this.guns, this.knife, ...extras];
    const again = this.order.indexOf(held);
    this.index = again >= 0 ? again : 0;
    return true;
  }

  /**
   * Подобрал ствол с земли: он встаёт в слоты до конца жизни, с полным
   * магазином, и сразу в руки. Такой уже есть — просто полный магазин.
   */
  addGun(id){
    if (!WEAPONS[id]) return false;
    if (!this.guns.includes(id)){
      const held = this.order[this.index];
      this.guns = [...this.guns, id];
      this.order = [...this.guns, this.knife, ...this.extras];
      this.index = Math.max(0, this.order.indexOf(held));
    }
    this.ammo[id] = WEAPONS[id].magazine;
    this.index = -1;                      // чтобы select точно сработал
    this.select(this.order.indexOf(id));
    return true;
  }

  /** Новая жизнь — только свои стволы, подобранные остаются на земле прошлой. */
  resetGuns(){
    this.guns = [...this.baseGuns];
    this.order = [...this.guns, this.knife, ...this.extras];
    this.index = 0;
  }

  select(index){
    if (index < 0 || index >= this.order.length || index === this.index) return false;
    this.index = index;
    this.reloadingUntil = 0;              // смена оружия отменяет перезарядку
    this.nextShotAt = performance.now() / 1000 + 0.25;
    return true;
  }

  selectId(id){ return this.select(this.order.indexOf(id)); }

  /**
   * Номера клавиш по слотам. В заминировании бомба ВСЕГДА на 5 — так её
   * ждут руки (как в любом шутере про бомбу), а остальное нумеруется по
   * порядку, перешагивая пятёрку. Раньше бомба получала «следующий свободный»
   * номер — у кого четыре ствола, та была на восьмёрке, и нажатие 5 доставало
   * нож.
   */
  keys(){
    let n = 1;
    return this.order.map(id => {
      if (id === "bomb" && this.bombKey) return this.bombKey;
      if (this.bombKey && n === this.bombKey) n++;
      return n++;
    });
  }

  selectKey(key){
    const i = this.keys().indexOf(key);
    return i >= 0 ? this.select(i) : false;
  }

  /** Колесо и кнопка «сменить» листают только стволы и нож — не гранату. */
  next(){
    const pool = this.guns.length + 1;
    const at = this.index < pool ? this.index : -1;
    return this.select((at + 1) % pool);
  }

  startReload(){
    if (!this.isGun) return false;
    const w = this.current;
    if (this.reloading || this.ammo[w.id] >= w.magazine) return false;
    this.reloadingUntil = performance.now() / 1000 + w.reload;
    return true;
  }

  /** Успела ли закончиться перезарядка — вызывать каждый кадр. */
  tick(){
    if (this.reloadingUntil && performance.now() / 1000 >= this.reloadingUntil){
      const w = this.current;
      if (this.isGun) this.ammo[w.id] = w.magazine;
      this.reloadingUntil = 0;
      return true;                        // чтобы щёлкнуть затвором
    }
    return false;
  }

  /**
   * Можно ли стрелять (бить) прямо сейчас. Если магазин пуст — сама ставит
   * перезарядку: человеку не надо помнить про R, когда уже поздно.
   */
  canFire(){
    const now = performance.now() / 1000;
    if (this.reloading || now < this.nextShotAt) return false;
    if (this.isGun && this.inMagazine <= 0){ this.startReload(); return false; }
    return this.isGun || this.isMelee;
  }

  consume(){
    const w = this.current;
    if (this.isGun) this.ammo[w.id]--;
    this.nextShotAt = performance.now() / 1000 + 60 / w.rpm;
  }
}

/** Урон с учётом падения на дистанции. */
export function damageAt(weapon, distance){
  if (distance <= weapon.falloffStart) return weapon.damage;
  if (distance >= weapon.falloffEnd)   return weapon.damage * weapon.falloffMin;
  const t = (distance - weapon.falloffStart) / (weapon.falloffEnd - weapon.falloffStart);
  return weapon.damage * (1 - t * (1 - weapon.falloffMin));
}

/** Случайное отклонение внутри конуса разброса. */
export function scatter(dir, spread, THREE){
  if (spread <= 0) return dir;
  const angle = Math.random() * Math.PI * 2;
  const radius = Math.sqrt(Math.random()) * spread;
  const up = Math.abs(dir.y) > 0.95
    ? new THREE.Vector3(1, 0, 0)
    : new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(dir, up).normalize();
  const realUp = new THREE.Vector3().crossVectors(right, dir).normalize();
  return dir.clone()
    .addScaledVector(right,  Math.cos(angle) * radius)
    .addScaledVector(realUp, Math.sin(angle) * radius)
    .normalize();
}
