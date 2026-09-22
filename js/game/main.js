// main.js — сам матч: сцена, цикл, стрельба, сеть.
//
// Порядок кадра всегда один и тот же и менять его нельзя:
//   1. посчитать своё движение и столкновения;
//   2. подтянуть чужих бойцов к их последним известным местам;
//   3. посчитать выстрел — уже по подтянутым позициям, чтобы стрелять туда,
//      где люди нарисованы, а не туда, где они были в момент прихода пакета;
//   4. отрисовать.
//
// Пункт 3 после пункта 2 — не мелочь: если поменять их местами, на глаз будет
// казаться, что пули проходят сквозь людей.

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js";

import { hasRealtimeDb } from "../firebase.js";
import { resolvePlayer } from "../mypeal-auth.js";
import { ensurePlayer, addMatchResult, displayName } from "../profile.js";
import { buildMap, mapMeta, registerCustomMap } from "./maps/index.js";
import { PLAYER, movePlayer, onGround, raycast } from "./physics.js";
import { Controls } from "./controls.js";
import {
  Arsenal, damageAt, scatter, COINS_PER_KILL, COINS_PER_MATCH, WEAPONS, gunsFor, equippedKnife
} from "./weapons.js";
import { RemotePlayer } from "./remote.js";
import { Hud } from "./hud.js";
import { TouchControls, isTouchDevice } from "./touch.js";
import {
  wakeSound, setVolume, getVolume, playShot, playRemoteShot, playHit, playHurt,
  playReloadOut, playReloadIn, playSwitch, playDeath, playSpawn, playKill,
  playMatchEnd, playStep, playChat, playClick, playDenied, playSlash
} from "./sound.js";
import * as net from "../net/live.js";
import { registerServiceWorker } from "../pwa.js";
import * as access from "../net/access.js";
import {
  setupRenderer, dressMap, detailMaterial, readQuality, saveQuality, QUALITY, QUALITY_ORDER
} from "./render.js";
import {
  SIDES, MODES, BOMB, ROUND_END, sideName, otherSide, isTeamMode, modeShort,
  sideAllowed, canSwitchTo, thinnerSide
} from "./modes.js";
import {
  GRENADES, GRENADE_ORDER, Grenade, Smoke, fragDamage, smokeBlocks, throwVelocity, primeSmoke
} from "./grenades.js";
import {
  BOMB_STATE, buildSite, buildBomb, blink, siteAt, fuseLeft, bombLine, pickCarrier, ActionBar
} from "./bomb.js";
import { navFor } from "./nav.js";
import { buildGunModel, disposeGun, skinFor } from "./gunmodels.js";
import { readSettings, applyCrosshair, bindsOf, keyLabel } from "./settings.js";
import { agentById, equippedAgent } from "./agents.js";
import { Drops } from "./drops.js";
import { Radar } from "./radar.js";
import { FpHands } from "./hands.js";
import { DamageNumbers } from "./fx.js";
import { BotCrew, CREW, isBotId } from "./bots.js";

const MATCH_SECONDS = 8 * 60;
const GOAL = { dm: 25, team: 40 };
const RESPAWN_DELAY = 3;
const SEND_HZ = 12;

const params = new URLSearchParams(location.search);
const roomId = params.get("room");

const hud = new Hud();
const canvas = document.getElementById("view");

// Служебный работник — чтобы игра, открытая как приложение, стартовала из кэша.
registerServiceWorker();

let me = null;               // { sessionUid, uid, name, tag, team }
let room = null;             // meta комнаты
let map = null;
let scene, camera, renderer, clock;
let controls, arsenal;
let remotes = new Map();     // sessionUid -> RemotePlayer
let tracers = [];
let stopWatchers = [];
let leaveRoom = null;
let matchOver = false;
let localStats = { kills: 0, deaths: 0 };
let touch = null;
let stepAt = 0;
let leaving = false;
let playerPoints = 0;
let myAgent = null;         // персонаж (agents.js): чем дороже, тем быстрее
let saved = false;
let aimNow = 1;          // текущее приближение, плавно едет к целевому
let scopeShown = false;
let stopAnnounce = null;
let quality = readQuality();
let presence = [];       // кто сейчас в игре — для панели в паузе
let roomList = [];       // открытые комнаты — туда можно перейти

// ---- заминирование --------------------------------------------------------
let bomb = null;            // состояние из базы
let bombGroup = null;       // ящик в сцене
let siteGroup = null;       // размеченные точки A и B
let actionBar = null;       // полоса «закладываю / разминирую»
let holdFor = 0;            // сколько секунд уже держу кнопку действия
let roundOver = false;      // раунд кончился, ждём следующего
let carriesBomb = false;    // бомба у меня
let carrierSession = null;  // ...а вот у кого она вообще
let sideWasFlipped = false; // сторону из адреса пришлось поменять ради равенства
let nades = { frag: 0, smoke: 0 };   // сколько осталось в этой жизни
let owned = [];             // что куплено в оружейной
let flying = [];            // летящие гранаты
let clouds = [];            // облака дыма
let nextNade = "frag";      // какую бросаем по кнопке

// ---- боты -----------------------------------------------------------------
// Считает их ТОЛЬКО ведущий (тот же, что крутит раунды), и только на постоянном
// сервере. У всех остальных crew остаётся пустым, а ботов они просто рисуют по
// тому, что пришло из базы, — как обычных чужих бойцов.
let crew = null;            // отряд ботов, если веду их я
let nav = null;             // граф проходимости карты, строится по надобности
let botsPushAt = 0;         // когда последний раз выкладывал их в базу
let wasKeeper = false;      // был ли я ведущим на прошлой проверке
let drops = null;           // стволы, выпавшие из убитых (drops.js)
let radar = null;           // радар слева вверху (radar.js)
let useBefore = false;      // E в прошлом кадре — чтобы подбирать по нажатию
const lastLook = {};        // взгляд в прошлом кадре — для инерции ствола в руках
let camRoll = 0;            // крен камеры в подкате
let fx = null;              // цифры урона и «ликвидирован» (fx.js)
const HEAD_MULT = 1.6;      // попадание в голову — урон ×1.6 (как в Rivals)
let fovKick = 0;            // расширение обзора на бегу и в подкате
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));

// Угол обзора и чувствительность — из настроек игрока (вкладка «Настройки»).
const settings = readSettings();
const binds = bindsOf(settings);     // назначенные клавиши (вкладка «Настройки»)
const BASE_FOV = settings.fov;

const self = {
  pos: new THREE.Vector3(),
  vel: new THREE.Vector3(),
  height: PLAYER.height,
  hp: 100,
  alive: true,
  respawnAt: 0,
  fell: false
};

start().catch(error => {
  // «Не удалось подключиться» показываем голым, как настоящий обрыв связи.
  document.getElementById("loading").innerHTML =
    `<b>${error.message === access.CONNECT_FAIL ? "Нет соединения" : "Не получилось начать матч."}</b><span>${error.message}</span>
     <a class="btn btn-ghost" href="lobby.html">Вернуться в лобби</a>`;
});

async function start(){
  if (!hasRealtimeDb) throw new Error("Realtime Database не создана — смотри подсказку в лобби.");
  if (!roomId) throw new Error("Не указана комната. Заходи в матч из лобби.");

  const resolved = await resolvePlayer();
  if (!resolved.uid) { leaving = true; location.href = "index.html"; return; }

  const profile = await ensurePlayer(resolved.uid, resolved.fresh || {});
  playerPoints = profile.points || 0;     // по очкам открываются скины
  myAgent = agentById(equippedAgent(profile.owned || []));   // персонаж: вид и скорость
  me = {
    sessionUid: resolved.sessionUid,
    uid: resolved.uid,
    // В бою человека зовут его игровым позывным, а не именем из мессенджера:
    // имя там пишут для переписки, а над головой нужно короткое.
    name: displayName(profile),
    tag: profile.tag,
    team: "free"
  };

  // Заблокирован или серверы выключены — сервер для него «не отвечает».
  const isAdmin = await access.isAdminPlayer(resolved.uid);
  const allowed = await access.checkAccess(resolved.uid, { admin: isAdmin });
  if (!allowed.ok){
    await new Promise(r => setTimeout(r, 1500));
    throw new Error(access.CONNECT_FAIL);
  }
  // И во время боя: заблокировали или выключили серверы — отключаем молча.
  access.watchAccess(resolved.uid, state => {
    if (!state.ok && !leaving) dropConnection();
  }, { admin: isAdmin });

  // Один аккаунт — одно устройство. Им уже играют где-то ещё (другой телефон,
  // компьютер, вторая вкладка) — спрашиваем: остаться в лобби или перехватить
  // (и тогда там игра остановится).
  const claim = await net.claimPlay(me.uid, me.sessionUid, roomId);
  if (claim.busy){
    const here = await askTakeOver();
    if (!here){ leaving = true; location.href = "lobby.html"; return; }
    await net.claimPlay(me.uid, me.sessionUid, roomId, { force: true });
  }
  const releasePlay = net.holdPlay(me.uid, me.sessionUid, roomId, () => {
    if (!leaving) dropConnection("В этот аккаунт вошли на другом устройстве.",
      "Играть одним аккаунтом сразу с двух устройств нельзя — здесь игра остановлена.");
  });
  stopWatchers.push(() => { releasePlay(); });

  room = await waitForMeta();
  if (!room) throw new Error("Комната закрылась.");

  // Мест может не остаться, пока человек шёл сюда из лобби. Правила базы такого
  // всё равно не пустят, но отказ от базы выглядит как поломка — скажем прямо.
  const seats = await net.roomCapacity(roomId);
  if (!seats.ok) throw new Error(seats.reason);

  // Своя карта игрока: скачиваем её данные из комнаты (их положил туда
  // хозяин) и регистрируем как карту «custom».
  if (room.map === "custom"){
    const data = await net.getCustomMap(roomId);
    if (!data) throw new Error("Не удалось загрузить карту этой комнаты.");
    registerCustomMap(data);
  }
  map = buildMap(room.map);
  buildScene();
  // Управление создаём до первого возрождения: spawn() ставит controls.yaw.
  controls = new Controls(canvas, binds);
  // Подсказка на экране паузы — по НАЗНАЧЕННЫМ клавишам, а не по заводским.
  const L = id => keyLabel(binds[id]);
  document.getElementById("keyHint").textContent =
    `${L("fwd")} ${L("left")} ${L("back")} ${L("right")} — движение · ${L("crouch")} — присесть · ПКМ — прицел · ` +
    `${L("reload")} — перезарядка · 1 2 3… — оружие · ${L("knife")} — нож · ${L("nade")} — граната · ` +
    `${L("nadeSwap")} — сменить гранату · ${L("use")} — заложить или разминировать · ${L("board")} — табло · ` +
    `${L("chat")} — чат · Esc — пауза`;
  controls.sensitivity *= settings.sens;
  applyCrosshair(settings);
  // В бой идём с тем набором, который собран в оружейной. Если он пуст или
  // в нём оружие, которого уже нет, Arsenal сам подставит автомат.
  // В бой идут ВСЕ купленные стволы (1, 2, 3…), за ними нож, а граната и
  // бомба занимают следующие цифры, когда они есть.
  arsenal = new Arsenal(gunsFor(profile.loadout, profile.owned || []),
                        { knife: equippedKnife(profile.owned || []) });
  // В заминировании бомба всегда на клавише 5 (см. Arsenal.keys).
  arsenal.bombKey = room.mode === "bomb" ? 5 : 0;

  owned = Array.isArray(profile.owned) ? profile.owned : [];

  // Сторона. Из лобби или по ссылке к другу она приходит в адресе; иначе
  // человек выбирает её сам, экраном ниже — там видно, сколько народу на
  // каждой стороне, а в лобби этого не видно.
  if (isTeamMode(room.mode)){
    const wanted = params.get("team");
    if (wanted === "a" || wanted === "b"){
      // Сторону из адреса тоже проверяем. Ссылка «Зайти к другу» ведёт на
      // сторону друга — и это ровно тот случай, когда стороны перекашивает:
      // двое заходят к третьему, и получается три на ноль. Если там уже
      // больше людей, ставим к соперникам и говорим об этом вслух.
      const counted = await net.teamCounts(roomId).catch(() => null);
      const people = counted?.people || { a: 0, b: 0 };
      me.team = sideAllowed(wanted, people) ? wanted : otherSide(wanted);
      if (me.team !== wanted) sideWasFlipped = true;
    } else {
      me.team = await askSide();
    }
  }

  if (room.mode === "bomb"){
    // Класс на body: по нему интерфейс раздвигается под строку о бомбе.
    document.body.classList.add("bomb");
    setupBombMode();
  }
  // Радар слева вверху — карта сверху и только свои.
  try { nav = nav || navFor(map, room.map); radar = new Radar(map, nav); } catch (e) { console.warn("radar", e); }

  leaveRoom = await net.joinRoom(roomId, me.sessionUid, {
    uid: me.uid, name: me.name, tag: me.tag || null, team: me.team, away: document.hidden,
    ag: myAgent?.id || "recruit",
    w: arsenal.current.id
  });

  // Объявляем, где мы: по этому и видно в лобби и в паузе, кто сейчас играет,
  // и по этому же друг заходит к другу одной кнопкой.
  stopAnnounce = await net.announce(me.sessionUid, {
    uid: me.uid, nick: me.name, tag: me.tag || null,
    room: roomId, map: room.map, mode: room.mode, team: me.team
  });

  spawn();
  wireNetwork();
  wireInput();
  // Табло рисуем сразу, не дожидаясь чужих: в одиночной комнате обработчик
  // "пришёл игрок" не сработает ни разу, и по Tab открывалась пустота.
  refreshBoard();

  document.getElementById("loading").classList.add("gone");
  hud.setHint(mapMeta(room.map).hint);
  hud.banner(mapMeta(room.map).name, mapMeta(room.map).subtitle, 3200);
  if (sideWasFlipped){
    hud.say(`За ту сторону уже больше людей — играешь за «${sideName(me.team)}».`, 7000);
  }

  clock = new THREE.Clock();
  renderer.setAnimationLoop(frame);
}

function waitForMeta(){
  return new Promise(resolve => {
    const stop = net.watchMeta(roomId, meta => { stop(); resolve(meta); });
  });
}

// ---------------------------------------------------------------------------
// Сцена
// ---------------------------------------------------------------------------

function buildScene(){
  scene = new THREE.Scene();
  scene.add(map.group);

  camera = new THREE.PerspectiveCamera(BASE_FOV, innerWidth / innerHeight, 0.08, 600);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setSize(innerWidth, innerHeight);

  // Свет, поверхность и воздух — всё в render.js. Здесь только зовём: небо
  // куполом, карта окружения под цвет этой карты, шум в шероховатости и
  // нормали, разрешение теней. Качество берётся из настроек или угадывается
  // по устройству.
  setupRenderer(renderer, quality);
  dressMap(renderer, scene, map, quality);
  // Дым — единственное полупрозрачное в игре, и первая его программа шейдера
  // собирается в тот самый кадр, когда облако встаёт. Соберём заранее.
  primeSmoke(renderer, scene, camera);

  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  // Оружие в руках — отдельная маленькая сцена поверх основной. Так ствол
  // никогда не влезает в стену и не обрезается ближней плоскостью, что иначе
  // случается в каждом втором самодельном шутере.
  viewModel.init();
}

// ---------------------------------------------------------------------------
// Модель оружия в руках
// ---------------------------------------------------------------------------

// Позы в руках по видам: ствол, нож, граната, бомба. [x, y, z] и повороты.
// Подобраны на стенде: у ствола — справа внизу, развёрнут к прицелу слегка,
// так что он смотрит почти туда же, куда летят пули, а не вбок.
const POSES = {
  gun:   { pos: [0.19, -0.19, -0.55], rot: [0.02, 0.1, 0.0] },
  knife: { pos: [0.17, -0.15, -0.34], rot: [0.4, 0.6, -0.45] },
  // Прицельная: ствол по центру, дуло — у самого перекрестья, чуть правее, так
  // что видно и мушку, и коробку сверху (ровно в торец смотреть некрасиво:
  // тогда в кадре только затыльник приклада).
  aim:   { pos: [0.07, -0.1, -0.5],   rot: [0.02, 0.08, 0.0] },
  nade:  { pos: [0.17, -0.17, -0.38], rot: [0.2, 0.3, 0.0] },
  bomb:  { pos: [0.13, -0.25, -0.42], rot: [0.55, 0.35, 0.0] }
};

// Поправки позы под конкретный ствол: ПП ближе и выше, пулемёт ниже и шире.
const GUN_POSE = {
  none: [0, 0, 0],
  smg: [0.005, 0.01, 0.04],
  shotgun: [0, -0.005, -0.01],
  sniper: [0.005, -0.008, -0.02],
  lmg: [0.015, -0.025, 0.0]
};
// Вес: как широко и как медленно качается в руках.
const WEIGHT = { knife: 0.55, karambit: 0.55, bayonet: 0.6, butterfly: 0.55, nade: 0.6,
  smg: 0.8, rifle: 1, shotgun: 1.1, sniper: 1.25, lmg: 1.5, bomb: 0.9 };
const clampNum = (v, a, b) => Math.max(a, Math.min(b, v));

// Осмотр оружия — ключевые кадры: [доля, dx, dy, dz, rx, ry, rz].
const INSPECT_GUN = [
  [0,    0, 0, 0,  0, 0, 0],
  [0.14, -0.075, 0.05, 0.1,   0.1, 0.95, 0.42],     // поднял и развернул боком
  [0.42, -0.065, 0.058, 0.1,  0.04, 1.05, 0.48],    // рассматривает
  [0.62, -0.05, 0.075, 0.08, -0.28, -0.55, -1.05],  // перевернул — другая сторона
  [0.84, -0.05, 0.068, 0.08, -0.22, -0.62, -1.0],
  [1,    0, 0, 0,  0, 0, 0]
];
const INSPECT_KNIFE = [
  [0,    0, 0, 0,  0, 0, 0],
  [0.16, -0.05, 0.05, 0.06,  0.2, 0.45, 0.3],
  [0.36, -0.04, 0.09, 0.06,  0.2, 0.45, 0.3 + Math.PI],        // подкинул — оборот
  [0.52, -0.05, 0.05, 0.06,  0.2, 0.45, 0.3 + Math.PI * 2],
  [0.8,  -0.05, 0.05, 0.06, -0.3, 0.9, Math.PI * 2 - 0.4],
  [1,    0, 0, 0,  0, 0, Math.PI * 2]
];
const INSPECT_ITEM = [
  [0, 0, 0, 0, 0, 0, 0],
  [0.25, -0.04, 0.05, 0.06, -0.3, 0.7, 0.3],
  [0.6, -0.04, 0.05, 0.06, 0.2, -0.5, -0.3],
  [1, 0, 0, 0, 0, 0, 0]
];
function keyframes(frames, t){
  let i = 0;
  while (i < frames.length - 2 && t > frames[i + 1][0]) i++;
  const [t0, ...a] = frames[i], [t1, ...b] = frames[i + 1];
  let k = Math.max(0, Math.min(1, (t - t0) / (t1 - t0 || 1)));
  k = k * k * (3 - 2 * k);
  return a.map((v, j) => v + (b[j] - v) * k);
}

const viewModel = {
  init(){
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.01, 4);
    this.group = new THREE.Group();

    // Сам ствол собирается в gunmodels.js — детальная модель с текстурами
    // и скином. Здесь только «держатель»: он качается при ходьбе и дёргается
    // от отдачи, а модель внутри меняется при смене оружия.
    //
    // РАССТОЯНИЯ ВАЖНЫ. Камера смотрит вдоль −Z; всё, что ближе четверти
    // метра, раздувается на пол-экрана, а заехавшее за объектив показывается
    // изнутри чёрным пятном. Затылок приклада у моделей — в +0.34 от начала,
    // держатель стоит в −0.72: до объектива остаётся 38 см.
    this.shown = null;
    this.model = null;
    // Поза подобрана на стенде: ствол справа внизу, чуть развёрнут к прицелу,
    // так что видно левый бок — коробку, магазин, цевьё, — а не только торец
    // приклада. Затылок приклада при этом в 44 см от объектива.
    this.base = new THREE.Vector3(...POSES.gun.pos);
    this.group.position.copy(this.base);
    this.group.rotation.set(...POSES.gun.rot);
    this.scene.add(this.group);

    this.flash = new THREE.PointLight(0xffd9a0, 0, 2.2);
    this.flash.position.set(0.2, -0.1, -0.95);
    this.scene.add(this.flash);

    // Свет на оружии — три источника, как ставят предмет в студии, и заливка
    // нарочно слабая. Раньше тут была почти ровная засветка со всех сторон, и
    // после тональной компрессии ствол превращался в плоский силуэт: грани
    // переставали отличаться друг от друга, и самый близкий к глазу предмет на
    // экране выглядел вырезанным из бумаги.
    //
    //   ключевой  — тёплый, сверху-слева: он и лепит форму;
    //   заполняющий — холодный, снизу-справа и втрое слабее: он не даёт тени
    //                 провалиться в чёрное, но формы не портит;
    //   контровой — сзади: тонкая светлая кромка по верхнему ребру, от которой
    //               предмет отделяется от карты за ним.
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.28));

    const key = new THREE.DirectionalLight(0xfff0dc, 2.0);
    key.position.set(-0.7, 1, 0.45);
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0xbcd2e8, 0.7);
    fill.position.set(0.8, -0.5, 0.3);
    this.scene.add(fill);

    // Контровой слабее ключевого втрое: его задача — тонкая кромка, а не
    // второй блик. На единице верхняя грань ствола уходила в чистый белый.
    const rim = new THREE.DirectionalLight(0xffffff, 0.62);
    rim.position.set(0.2, 0.55, -1);
    this.scene.add(rim);

    this.recoil = 0;
    this.bob = 0;
    this.fit = 1;
    // Живое оружие: инерция при повороте, дыхание, дрожь рук, приземление,
    // случайный увод при отдаче. Всё — пружинами, без рывков.
    this.t = 0;
    this.lagYaw = 0; this.lagPitch = 0;
    this.kickYaw = 0; this.kickRoll = 0;
    this.land = 0; this.prevVy = 0;
    this.sprintK = 0; this.airK = 0; this.rollK = 0; this.slideK = 0; this.crouchK = 0;
    this.inspectT = -1;           // осмотр оружия (F): 0…1, −1 — не осматриваем
    this.hands = null;
    this.outfit = "";
    this._measure();

    addEventListener("resize", () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this._measure();
    });
  },

  /**
   * На телефоне в горизонтальном положении экран низкий и широкий, и ствол при
   * той же геометрии занимает половину высоты. Ужимаем его по высоте экрана,
   * а не по ширине — от ширины он не зависит.
   */
  _measure(){
    this.fit = Math.max(0.62, Math.min(1, innerHeight / 620));
  },

  /** Рукава — цвета своей формы: сторона и персонаж. */
  setOutfit(team, cloth){
    const key = `${team}:${cloth ?? ""}`;
    if (key === this.outfit) return;
    this.outfit = key;
    if (this.hands) this.group.remove(this.hands.group);
    this.hands = new FpHands(team, cloth ?? null);
    this.group.add(this.hands.group);
    if (this.model) this.hands.setWeapon(this.weaponId, this.kind, this.model);
  },

  /** Поставить в руки нужный ствол (и нужный скин). Дёшево: только при смене. */
  _show(weapon){
    const skin = skinFor(weapon, playerPoints);
    const key = weapon + ":" + skin;
    if (this.shown === key) return;
    if (this.model){ this.group.remove(this.model); disposeGun(this.model); }
    const built = buildGunModel(weapon, skin);
    this.model = built.group;
    this.model.traverse(o => {
      if (!o.material) return;
      o.material.envMap = scene.environment || null;
      o.material.envMapIntensity = 0.35 + (o.material.metalness || 0) * 0.7;
      o.castShadow = false;
    });
    this.model.position.z = -0.05;
    this.group.add(this.model);
    // Вспышка — у дула именно этого ствола и едет вместе с ним (в том числе
    // при прицеливании): поэтому она дочерняя у держателя, а не у сцены.
    if (this.flash.parent !== this.group) this.group.add(this.flash);
    this.flash.position.copy(built.muzzle).add(new THREE.Vector3(0, 0, -0.09));
    this.sightY = built.info.sightY || 0.07;
    this.kind = WEAPONS[weapon] ? "gun" : built.info.blade ? "knife" : weapon;
    this.weaponId = weapon;
    this.hands?.setWeapon(weapon, this.kind, this.model);
    this.shown = key;
    // Смена оружия — ствол «поднимается» снизу, а не возникает из воздуха.
    this.raise = 1;
    this.inspectT = -1;
  },

  /**
   * Осмотр оружия, как в CS: поднять, развернуть боком, перевернуть и показать
   * другую сторону, вернуть. Нож — подкинуть и провернуть в руке.
   */
  inspect(){
    if (this.inspectT >= 0 || this.raise > 0.2) return;
    this.inspectT = 0;
    this.inspectLen = this.kind === "knife" ? 2.2 : this.kind === "gun" ? 3.1 : 2.0;
  },
  stopInspect(){ this.inspectT = -1; },

  /** Взмах ножом: короткая дуга справа налево. */
  slash(){ this.swing = 1; },

  /**
   * aimT — насколько доехало прицеливание, 0…1. В прицеле ствол выезжает в
   * центр экрана так, что мушка встаёт ровно на линию взгляда; раньше
   * прицеливание только сужало угол обзора, и ствол оставался стоять сбоку.
   */
  update(dt, speed, weapon, aimT = 0, extra = {}){
    this._show(weapon);
    this.t += dt;
    this.recoil = Math.max(0, this.recoil - dt * 6);
    this.swing = Math.max(0, (this.swing || 0) - dt / 0.3);
    this.raise = Math.max(0, (this.raise || 0) - dt / 0.25);
    this.bob += dt * (4 + speed * 1.05) * (speed > 0.5 ? 1 : 0);

    const pose = POSES[this.kind] || POSES.gun;
    const tweak = GUN_POSE[weapon] || GUN_POSE.none;
    const w = WEIGHT[weapon] ?? 1;               // тяжёлое качается медленнее и шире
    const k = this.fit;
    const t = this.kind === "gun" ? aimT : 0;
    const aimPos = POSES.aim.pos, aimRot = POSES.aim.rot;
    const calm = 1 - t * 0.85;          // в прицеле ствол почти не качается
    const move = Math.min(1, speed / 7);

    // Инерция: повернул мышью — ствол чуть отстаёт и догоняет.
    this.lagYaw = clampNum(this.lagYaw + (extra.dyaw || 0) * 0.85, -0.14, 0.14);
    this.lagPitch = clampNum(this.lagPitch + (extra.dpitch || 0) * 0.85, -0.12, 0.12);
    const back = Math.exp(-dt * 10 / w);
    this.lagYaw *= back; this.lagPitch *= back;

    // Приземление: ствол проседает и пружинит обратно.
    const vy = extra.vy || 0;
    if (this.prevVy < -4 && vy > -0.5) this.land = Math.min(1, -this.prevVy / 11);
    this.prevVy = vy;
    this.land = Math.max(0, this.land - dt * 3.2);
    const landDip = Math.sin(this.land * Math.PI) * 0.045 * this.land;

    // Шаг — «восьмёркой»: вбок на каждый шаг, вниз на каждую ногу.
    const bx = Math.sin(this.bob) * 0.012 * move * calm * w;
    const by = -Math.abs(Math.cos(this.bob)) * 0.01 * move * calm * w;
    const broll = Math.sin(this.bob) * 0.025 * move * calm;
    // Дыхание и дрожь рук — видно, что ствол держит живой человек.
    const breath = Math.sin(this.t * 1.3) * 0.0026 * w * (1 - move) * calm;
    const tremor = (Math.sin(this.t * 7.3) + Math.sin(this.t * 11.9) * 0.6 + Math.sin(this.t * 17.1) * 0.35)
      * 0.00055 * w * (0.4 + calm * 0.6);

    // Отдача уводит случайно вбок и крутит — и пружиной возвращается.
    const kb = Math.exp(-dt * 12);
    this.kickYaw *= kb; this.kickRoll *= kb;

    // Перезарядка: ствол заваливается набок, пока рука меняет магазин.
    const r = extra.reload ?? -1;
    const tilt = r >= 0 ? Math.sin(Math.PI * Math.min(1, r * 1.1)) : 0;

    // Бег (как в kour.io): ствол опущен и развёрнут к груди; в воздухе — чуть
    // приподнят (руки «всплывают» при падении); вбок — наклон; подкат —
    // сильный завал набок; присед — чуть ниже.
    const ease = (k, want, rate) => k + (want - k) * Math.min(1, dt * rate);
    this.sprintK = ease(this.sprintK, extra.sprint && t < 0.1 ? 1 : 0, 9);
    this.airK = ease(this.airK, extra.air ? clampNum(-vy / 9, -0.6, 1) : 0, 7);
    this.rollK = ease(this.rollK, clampNum(extra.strafe || 0, -1, 1), 7);
    this.slideK = ease(this.slideK, extra.slide ? 1 : 0, 10);
    this.crouchK = ease(this.crouchK, extra.crouch ? 1 : 0, 10);
    const sp = this.sprintK * (1 - this.slideK), sl = this.slideK;
    const runBob = Math.sin(this.bob * 1.0) * 0.022 * sp;
    const runBobY = -Math.abs(Math.cos(this.bob)) * 0.02 * sp;

    // Осмотр оружия.
    let ip = [0, 0, 0, 0, 0, 0];
    if (this.inspectT >= 0){
      this.inspectT += dt / this.inspectLen;
      if (this.inspectT >= 1 || t > 0.05 || sp > 0.3 || r >= 0) this.inspectT = -1;
      else ip = keyframes(this.kind === "knife" ? INSPECT_KNIFE : this.kind === "gun" ? INSPECT_GUN : INSPECT_ITEM, this.inspectT);
    }

    const sw = Math.sin(Math.PI * this.swing);
    const up = this.raise * this.raise;
    const lerp = (a, b) => a + (b - a) * t;
    this.group.position.set(
      lerp(pose.pos[0] + tweak[0], aimPos[0]) + bx - sw * 0.1 + this.lagYaw * 0.09 + tremor
        - sp * 0.05 + runBob - sl * 0.03 + ip[0],
      lerp(pose.pos[1] + tweak[1], aimPos[1]) + by + breath - this.recoil * 0.02 * calm - up * 0.18
        - landDip - this.lagPitch * 0.07 - tilt * 0.05 + tremor * 0.8
        - sp * 0.045 + runBobY + this.airK * 0.03 - sl * 0.035 - this.crouchK * 0.012 + ip[1],
      lerp(pose.pos[2] + tweak[2], aimPos[2]) + this.recoil * (0.05 - t * 0.025) + sw * 0.04
        + sp * 0.04 + ip[2]
    );
    this.group.rotation.set(
      lerp(pose.rot[0], aimRot[0]) + this.recoil * 0.22 * calm - sw * 0.5 + up * 0.6
        - this.lagPitch * 0.45 + breath * 1.4 + landDip * 1.5 - tilt * 0.3
        - sp * 0.32 + this.airK * 0.12 - sl * 0.1 + ip[3],
      lerp(pose.rot[1], aimRot[1]) + sw * 1.1 - this.lagYaw * 0.55 + this.kickYaw
        + sp * 0.62 + sl * 0.2 + ip[4],
      lerp(pose.rot[2], aimRot[2]) + sw * 0.6 + broll + this.kickRoll + tilt * 0.5 + this.lagYaw * 0.25
        + sp * 0.34 - this.rollK * 0.07 * (1 - t * 0.7) + sl * 0.42 + ip[5]
    );
    this.group.scale.set(k, k, k);
    this.flash.intensity = Math.max(0, this.flash.intensity - dt * 30);
    this.hands?.update(dt, r);
  },

  kick(strength, gap = 0.1){
    this.recoil = Math.min(1, this.recoil + strength);
    this.kickYaw += (Math.random() - 0.5) * 0.05 * Math.min(1, strength * 2);
    this.kickRoll += (Math.random() - 0.5) * 0.08 * Math.min(1, strength * 2);
    this.hands?.fired(gap);
    this.flash.intensity = 6;
  },

  render(renderer){
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = true;
  }
};

// ---------------------------------------------------------------------------
// Возрождение
// ---------------------------------------------------------------------------

function spawn(){
  const points = isTeamMode(room.mode) && map.teamSpawns?.[me.team]?.length
    ? map.teamSpawns[me.team]
    : map.spawns;

  // Из подходящих точек выбираем ту, что дальше всех от живых чужих: появиться
  // лицом к лицу с противником — самый обидный способ умереть.
  let best = points[0], bestScore = -Infinity;
  for (const point of points){
    const here = new THREE.Vector3(...point.pos);
    let nearest = Infinity;
    for (const other of remotes.values()){
      if (other.hp <= 0) continue;
      if (isTeamMode(room.mode) && other.team === me.team) continue;
      nearest = Math.min(nearest, here.distanceTo(other.shown));
    }
    const score = nearest === Infinity ? Math.random() * 10 : nearest;
    if (score > bestScore){ bestScore = score; best = point; }
  }

  self.pos.set(...best.pos);
  self.vel.set(0, 0, 0);
  self.hp = 100;
  self.alive = true;
  showSpecBar();
  self.fell = false;
  self.height = PLAYER.height;
  controls.yaw = best.yaw;
  controls.pitch = 0;
  hud.health(self.hp);
  hud.hideBanner();
  playSpawn();

  // Гранаты выдаются НА ЖИЗНЬ, а не на матч: иначе купивший однажды кидал бы
  // их бесконечно, и всё остальное оружие стало бы не нужно. Куплено — значит
  // есть по одной в каждом возрождении.
  nades.frag  = owned.includes("frag")  ? 1 : 0;
  nades.smoke = owned.includes("smoke") ? 1 : 0;
  nextNade = nades.frag ? "frag" : "smoke";
  // Новая жизнь — полные магазины и основной ствол в руках. Подобранное в
  // прошлой жизни не переносится.
  arsenal.resetGuns();
  viewModel.setOutfit(isTeamMode(room.mode) ? me.team : "free", myAgent?.cloth);
  for (const id of arsenal.guns) arsenal.ammo[id] = WEAPONS[id].magazine;
  arsenal.reloadingUntil = 0;
  arsenal.select(0);
  showSlots();
  refreshCarrier();

  net.pushScore(roomId, me.sessionUid, { hp: 100 });
}

// ---------------------------------------------------------------------------
// Заминирование
// ---------------------------------------------------------------------------

/** Разметить точки, собрать бомбу, подписаться на её состояние. */
function setupBombMode(){
  actionBar = new ActionBar();

  siteGroup = new THREE.Group();
  const sites = map.sites || [];
  sites.forEach((site, i) => siteGroup.add(buildSite(site, i === 1 ? "B" : "A")));
  scene.add(siteGroup);

  bombGroup = buildBomb();
  bombGroup.visible = false;
  scene.add(bombGroup);

  stopWatchers.push(net.watchBomb(roomId, state => {
    const was = bomb?.state;
    const hadIt = carriesBomb;
    bomb = state;
    refreshCarrier();
    if (!state) return;

    if (state.state === BOMB_STATE.PLANTED && was !== BOMB_STATE.PLANTED){
      bombGroup.position.set(state.x, state.y, state.z);
      bombGroup.visible = true;
      hud.banner("Бомба заложена", `Точка ${state.site === 1 ? "B" : "A"}`, 2200);
      playMatchEnd();
    }
    if (state.state === BOMB_STATE.DEFUSED && was === BOMB_STATE.PLANTED){
      endRound("defused");
    }
    // Бомба на земле — лежит там, где убили носильщика; огонёк не мигает.
    if (state.state === BOMB_STATE.DROPPED){
      bombGroup.position.set(state.x, state.y, state.z);
      bombGroup.visible = true;
      bombGroup.userData.glow.intensity = 0;
      bombGroup.userData.lamp.material.color.setHex(0x5a1a12);
      if (was === BOMB_STATE.CARRIED && me.team === "a") hud.say("Носильщика убили — бомба на земле. Подбери её!");
    }
    if (state.state === BOMB_STATE.CARRIED){
      bombGroup.visible = false;
      if (carriesBomb && !hadIt) hud.say(`Бомба у тебя — клавиша ${arsenal.bombKey || 5}. Неси на точку A или B.`);
    }
  }));
}

/**
 * Кто несёт бомбу — записано в базе (bomb.carrier). Назначает ведущий:
 * СЛУЧАЙНОГО живого террориста в начале раунда (см. keepBomb). Убили
 * носильщика — бомба падает на землю, и её подбирает любой террорист, пройдя
 * по ней. Раньше носильщик «вычислялся» по наименьшему ключу — и бомба каждый
 * раунд доставалась одному и тому же.
 */
function refreshCarrier(){
  carrierSession = null;
  carriesBomb = false;
  if (room?.mode !== "bomb") return;
  if (bomb?.state === BOMB_STATE.CARRIED && bomb.carrier) carrierSession = bomb.carrier;
  carriesBomb = carrierSession === me.sessionUid && self.alive && me.team === "a";
}

const bombPos = v => ({ x: round(v.x), y: round(v.y), z: round(v.z) });
let bombWriteAt = 0;       // не засыпать базу одинаковыми записями, пока она не ответила
let pickTryAt = 0;

/**
 * Ведущий следит за бомбой: выдать в начале раунда, уронить с убитого бота
 * или ушедшего человека, отдать боту, наступившему на неё.
 */
function keepBomb(){
  if (roundOver || matchOver || room.mode !== "bomb") return;
  // Узла бомбы в базе нет вовсе (старая комната) — считаем, что она на руках
  // и ещё никому не выдана.
  const state = bomb || { state: BOMB_STATE.CARRIED };
  const now = performance.now();
  if (now - bombWriteAt < 1200) return;
  const write = fn => { bombWriteAt = now; fn(); };

  const aliveT = [];
  if (me.team === "a" && self.alive) aliveT.push(me.sessionUid);
  for (const [id, r] of remotes){
    if (r.team !== "a") continue;
    const bot = crew?.bots.get(id);
    if (bot ? bot.alive : r.hp > 0) aliveT.push(id);
  }
  for (const bot of crew?.list || []) if (bot.team === "a" && bot.alive && !aliveT.includes(bot.id)) aliveT.push(bot.id);

  if (state.state === BOMB_STATE.CARRIED){
    const c = state.carrier;
    if (!c){
      const pick = pickCarrier(aliveT);
      if (pick) write(() => net.giveBomb(roomId, pick));
      return;
    }
    if (c === me.sessionUid){
      if (!self.alive) write(() => net.dropBomb(roomId, bombPos(self.pos)));
      return;
    }
    const bot = crew?.bots.get(c);
    if (bot){ if (!bot.alive) write(() => net.dropBomb(roomId, bombPos(bot.pos))); return; }
    const r = remotes.get(c);
    if (!r){
      // Носильщик вышел из комнаты — бомбу получает другой.
      const pick = pickCarrier(aliveT);
      if (pick) write(() => net.giveBomb(roomId, pick));
      return;
    }
    // Убитый человек роняет бомбу сам (takeDamage); это — страховка, если его
    // вкладка не успела.
    if (r.hp <= 0) write(() => net.dropBomb(roomId, bombPos(r.shown)));
    return;
  }

  if (state.state === BOMB_STATE.DROPPED && crew){
    const at = new THREE.Vector3(state.x, state.y, state.z);
    for (const bot of crew.list){
      if (bot.team === "a" && bot.alive && bot.pos.distanceTo(at) < 1.6){
        write(() => net.giveBomb(roomId, bot.id));
        return;
      }
    }
  }
}

/** Сам наступил на лежащую бомбу — подобрал. */
function stepBombPickup(){
  if (room.mode !== "bomb" || bomb?.state !== BOMB_STATE.DROPPED) return;
  if (me.team !== "a" || !self.alive || roundOver) return;
  const now = performance.now();
  if (now - pickTryAt < 1000) return;
  if (self.pos.distanceTo(new THREE.Vector3(bomb.x, bomb.y, bomb.z)) > 1.6) return;
  pickTryAt = now;
  net.giveBomb(roomId, me.sessionUid);
}

/**
 * Закладка и разминирование — единственное в игре действие, которое ЗАНИМАЕТ
 * ВРЕМЯ. Кнопку надо держать, и любое движение сбивает: три секунды
 * неподвижности посреди боя и есть цена бомбы.
 */
function stepBombAction(dt){
  if (room.mode !== "bomb" || !self.alive || roundOver){ actionBar?.hide(); holdFor = 0; return; }

  const moving = Math.hypot(self.vel.x, self.vel.z) > 0.6;
  const planted = bomb?.state === BOMB_STATE.PLANTED;

  // Что вообще можно делать в этом месте этой стороной.
  let job = null;
  if (!planted && me.team === "a" && carriesBomb){
    const site = siteAt(self.pos, map.sites);
    if (site >= 0) job = { kind: "plant", site, time: BOMB.plantTime, text: "Закладываю…" };
  } else if (planted && me.team === "b"){
    const near = new THREE.Vector3(bomb.x, bomb.y, bomb.z).distanceTo(self.pos);
    if (near < 2.2) job = { kind: "defuse", time: BOMB.defuseTime, text: "Разминирую…" };
  }

  // Заложить можно и по-старому (E), и «по-новому»: достал бомбу цифрой и
  // держишь ЛКМ. Разминируют так же — E или ЛКМ с бомбой… которой у
  // спецназа нет, поэтому им остаётся E.
  const holding = controls.keys.use || (controls.firing && arsenal.current.id === "bomb");
  if (!job || !holding || moving){
    if (holdFor > 0 && job) hud.say("Держи кнопку и стой на месте.");
    holdFor = 0;
    actionBar?.hide();
    return;
  }

  // Начал закладывать — спецназ это «слышит» (боты спецназа бегут на точки).
  if (holdFor === 0 && job.kind === "plant") net.markPlanting(roomId, job.site);
  holdFor += dt;
  actionBar?.show(job.text, holdFor / job.time);
  if (holdFor < job.time) return;

  holdFor = 0;
  actionBar?.hide();

  if (job.kind === "plant"){
    const site = map.sites[job.site];
    net.plantBomb(roomId, {
      site: job.site, x: site[0], y: site[1], z: site[2],
      by: me.sessionUid, byName: me.name
    });
    localStats.coins = (localStats.coins || 0) + BOMB.coinsPlant;
    playPurchaseSafe();
  } else {
    net.defuseBomb(roomId, { by: me.sessionUid, byName: me.name });
    localStats.coins = (localStats.coins || 0) + BOMB.coinsDefuse;
    playPurchaseSafe();
  }
}

/** Радар: я, мои (только своя сторона!), точки и — террористам — бомба. */
function stepRadar(){
  if (!radar) return;
  const team = isTeamMode(room.mode);
  const mates = [];
  if (team){
    for (const r of remotes.values()){
      if (r.team !== me.team) continue;
      mates.push({ x: r.shown.x, z: r.shown.z, yaw: r.shownYaw, alive: r.hp > 0,
                   bomb: me.team === "a" && r.id === carrierSession });
    }
  }
  let shownBomb = null;
  if (room.mode === "bomb" && bomb && typeof bomb.x === "number"){
    if (bomb.state === BOMB_STATE.PLANTED) shownBomb = { x: bomb.x, z: bomb.z, planted: true };
    else if (bomb.state === BOMB_STATE.DROPPED && me.team === "a") shownBomb = { x: bomb.x, z: bomb.z };
  }
  radar.draw({
    view: { x: camera.position.x, z: camera.position.z, yaw: camera.rotation.y },
    team: team ? me.team : "free",
    mates,
    sites: room.mode === "bomb" ? map.sites : null,
    bomb: shownBomb
  });
}

function ensureFx(){ return fx || (fx = new DamageNumbers(camera)); }

function ensureDrops(){ return drops || (drops = new Drops(scene)); }

/** Подобрать ствол с земли — по нажатию E рядом с ним. */
function stepPickup(dt){
  if (!drops) return;
  drops.step(dt);
  const pressed = controls.keys.use && !useBefore;
  useBefore = !!controls.keys.use;
  const item = self.alive && !roundOver ? drops.near(self.pos) : null;
  // Бомба важнее: в зоне закладки с бомбой и у заложенной бомбы E — для неё.
  const bombBusy = holdFor > 0
    || (carriesBomb && siteAt(self.pos, map.sites) >= 0)
    || (bomb?.state === BOMB_STATE.PLANTED && me.team === "b" &&
        self.pos.distanceTo(new THREE.Vector3(bomb.x, bomb.y, bomb.z)) < 2.4);
  if (!item || bombBusy){ drops.show(null); return; }
  drops.show(`${keyLabel(binds.use)} — подобрать: ${WEAPONS[item.weapon].name}`);
  if (!pressed) return;
  arsenal.addGun(item.weapon);
  drops.remove(item.id);
  net.sendEvent(roomId, { type: "pickup", id: item.id });
  hud.say(`Подобрал: ${WEAPONS[item.weapon].name}. Он твой до конца жизни.`);
  showSlots();
}

// Монетный звон у нас лежит в оружейной; в бою он же отмечает удачное дело.
function playPurchaseSafe(){ try { playKill(); } catch { /* ignore */ } }

/** Тикающая бомба: мигание, обратный отсчёт и взрыв. */
function stepBomb(dt){
  if (room.mode !== "bomb" || !bomb) return;

  if (bomb.state === BOMB_STATE.PLANTED){
    const left = fuseLeft(bomb, net.serverNow());
    blink(bombGroup, left, BOMB.fuse);
    if (left <= 0 && !roundOver) bombExplodes();
  }
}

function bombExplodes(){
  const center = new THREE.Vector3(bomb.x, bomb.y + 0.5, bomb.z);
  // Рядом с бомбой не выживает никто — и это правильно: иначе спецназ просто
  // стоял бы на точке до последней секунды, ничем не рискуя.
  if (self.alive){
    const d = center.distanceTo(self.pos);
    if (d < BOMB.blastRadius) takeDamage(BOMB.blastDamage, null, "Взрыв");
  }
  hud.banner("Бомба взорвалась", "", 2200);
  playMatchEnd();
  endRound("exploded");
}

// ---------------------------------------------------------------------------
// Выбор стороны
// ---------------------------------------------------------------------------

/**
 * Экран «за кого играешь».
 *
 * Показывается до входа в комнату и ждёт ответа. Почему не в лобби: сторону
 * выбирают, зная, сколько народу уже на каждой, — а это видно только здесь.
 * И ещё: к другу заходят кнопкой прямо в матч, лобби при этом не открывается
 * вовсе, и спросить было бы негде.
 *
 * Возвращает "a" или "b". «Всё равно» ставит туда, где меньше, — и это не то
 * же самое, что чётность числа вошедших: после чужого ухода стороны бывают
 * неравны, и чётность загоняет человека в ту, где и так больше.
 */
async function askSide(){
  const panel = document.getElementById("sidePick");
  const counted = await net.teamCounts(roomId).catch(() => null);
  let people = counted?.people || { a: 0, b: 0 };
  const bots = counted?.bots || { a: 0, b: 0 };

  if (!panel) return thinnerSide(people);

  document.getElementById("sidePickSub").textContent =
    room.mode === "bomb"
      ? "В заминировании у сторон разные задачи, и раунд для них выглядит по-разному"
      : "Стороны дерутся между собой; счёт общий на команду";

  document.getElementById("loading").classList.add("gone");
  panel.classList.add("show");

  /**
   * Перерисовать карточки под текущий счёт людей.
   *
   * Сторона, где людей БОЛЬШЕ, запирается. Считаются именно люди: боты
   * добивают обе стороны поровну, и по числу бойцов перекос не виден вовсе —
   * при одном человеке против нуля будет пять на пять.
   */
  const render = () => {
    for (const side of ["a", "b"]){
      const card = panel.querySelector(`[data-pick="${side}"]`);
      const open = sideAllowed(side, people);
      card.disabled = !open;
      card.classList.toggle("locked", !open);
      card.querySelector("u").textContent = open
        ? `${people[side]} ${plural(people[side], "человек", "человека", "человек")}` +
          (bots[side] ? ` и ${bots[side]} ботов` : "")
        : `Тут уже ${people[side]} против ${people[otherSide(side)]} — занято`;
    }
  };
  render();

  // Пока человек думает, в комнату может кто-то зайти. Тогда правильный выбор
  // становится неправильным — и карточка запирается прямо под курсором.
  const stop = net.watchTeamCounts(roomId, rows => { people = rows; render(); });

  const side = await new Promise(resolve => {
    const done = value => { panel.classList.remove("show"); resolve(value); };
    for (const button of panel.querySelectorAll("[data-pick]")){
      button.onclick = () => {
        if (button.disabled) return;
        playClick();
        done(button.dataset.pick);
      };
    }
    document.getElementById("sideAuto").onclick = () => { playClick(); done(thinnerSide(people)); };
  });

  stop?.();
  // Последняя сверка: между нажатием и входом кто-то мог зайти той же секундой.
  return sideAllowed(side, people) ? side : thinnerSide(people);
}

/** «1 человек», «2 человека», «5 человек» — мелочь, но глаз цепляется. */
function plural(n, one, few, many){
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/**
 * Смена стороны посреди матча — со следующего раунда, а не сейчас.
 *
 * Мгновенная смена ломала бы раунд: человек, которому надоело проигрывать,
 * перебегал бы к победителям прямо посреди перестрелки, да ещё и оказывался бы
 * в тылу у бывших своих. Поэтому переход откладывается до конца раунда — ровно
 * так же, как это устроено в играх, откуда режим и взят.
 */
let pendingTeam = null;

async function askSwapSide(){
  if (!isTeamMode(room.mode)) return;
  if (pendingTeam){ pendingTeam = null; updateSwapButton(); hud.say("Остаёшься где был."); return; }

  const target = otherSide(me.team);
  const counted = await net.teamCounts(roomId).catch(() => null);
  const people = counted?.people || { a: 0, b: 0 };

  // Перейти можно, только если там людей СТРОГО меньше. При равенстве переход
  // сам и создаёт перекос: уходишь оттуда, где было поровну, и делаешь 3:1.
  if (!canSwitchTo(target, people)){
    hud.say(`Там уже ${people[target]} против ${people[me.team]} — переходить некуда.`);
    playDenied();
    return;
  }

  pendingTeam = target;
  updateSwapButton();
  hud.say(`Перейдёшь в «${sideName(pendingTeam)}» со следующего раунда.`);
}

function updateSwapButton(){
  const button = document.getElementById("swapSideBtn");
  if (!button) return;
  button.hidden = !isTeamMode(room.mode);
  button.textContent = pendingTeam
    ? `Отменить переход в «${sideName(pendingTeam)}»`
    : `Перейти в «${sideName(otherSide(me.team))}»`;
}

/** Применить отложенный переход. Зовётся на смене раунда. */
function applyPendingTeam(){
  if (!pendingTeam || pendingTeam === me.team){ pendingTeam = null; return; }
  me.team = pendingTeam;
  pendingTeam = null;
  net.pushScore(roomId, me.sessionUid, { team: me.team });
  updateSwapButton();
  hud.say(`Теперь ты за «${sideName(me.team)}».`);
}

// ---------------------------------------------------------------------------
// Боты
// ---------------------------------------------------------------------------

/**
 * Завести отряд. Зовётся один раз — в тот момент, когда я оказался ведущим.
 *
 * Все «руки» отряда выведены наружу сюда: сам bots.js в сеть не ходит и про
 * Firebase не знает вовсе. Он считает, кто куда идёт и кто в кого попал, а
 * рассылка — дело этого файла. Так бота можно проверить на стенде без всякой
 * базы, и так же его можно будет однажды перенести на настоящий сервер.
 */
function startCrew(){
  nav = nav || navFor(map, room.map);
  crew = new BotCrew({
    map, nav, mode: MODES[room.mode],
    // На общем сервере — до 10 бойцов; на своей карте — сколько мест в комнате.
    target: room.permanent ? CREW.target : Math.max(2, Math.min(CREW.maxBots, room.maxPlayers || 8)),
    hooks: {
      onShot({ bot, from, to }){
        drawTracer(from, to);
        playRemoteShot(bot.weapon, from.distanceTo(camera.position));
        net.sendEvent(roomId, {
          type: "shot", from: bot.id, weapon: bot.weapon,
          ox: round(from.x), oy: round(from.y), oz: round(from.z),
          hx: round(to.x),   hy: round(to.y),   hz: round(to.z)
        });
      },
      onHit({ bot, target, damage }){
        const dmg = Math.round(damage);
        // По боту урон снимаем прямо здесь: он же у нас в руках.
        if (isBotId(target.id)){ crew.hurt(target.id, dmg, bot.id, bot.name, bot.pos); return; }
        // По себе — тоже напрямую: гонять событие самому себе через базу
        // значит ждать круга до сервера и обратно ради своего же выстрела.
        if (target.id === me.sessionUid){ takeDamage(dmg, bot.id, bot.name); return; }
        net.sendEvent(roomId, {
          type: "hit", to: target.id, from: bot.id,
          byName: bot.name, dmg, weapon: bot.weapon
        });
      },
      onKill(event){ net.sendEvent(roomId, { type: "kill", ...event }); },
      onPlant({ bot, site, at }){
        net.plantBomb(roomId, { site, x: at[0], y: at[1], z: at[2], by: bot.id, byName: bot.name });
      },
      onDefuse({ bot }){ net.defuseBomb(roomId, { by: bot.id, byName: bot.name }); },
      // Бот начал закладывать — «слышно» всем (боты спецназа бегут на точки).
      onPlanting({ site }){ net.markPlanting(roomId, site); }
    }
  });
}

/** Что боты видят вокруг себя в этот кадр. */
function botWorld(dt){
  const fighters = [];
  if (self.alive){
    fighters.push({ id: me.sessionUid, team: me.team, pos: self.pos, hp: self.hp });
  }
  for (const [id, remote] of remotes){
    // Своих ботов берём из отряда, а не из базы: там они с задержкой в восьмую
    // долю секунды, и бот стрелял бы по тому месту, где сосед был недавно.
    if (isBotId(id) || remote.hp <= 0) continue;
    fighters.push({ id, team: remote.team, pos: remote.shown, hp: remote.hp });
  }
  for (const bot of crew.list){
    if (bot.alive) fighters.push({ id: bot.id, team: bot.team, pos: bot.pos, hp: bot.hp });
  }

  return {
    fighters, dt, bomb,
    carrier: carrierSession,
    now: net.serverNow(),
    frozen: roundOver || matchOver,
    // Дым — настоящая преграда и для ботов: иначе дымовая граната против них
    // не работает вовсе, а это половина смысла дыма.
    blocked: (from, to) => smokeBlocks(clouds, from, to)
  };
}

let botFillAt = 0;

/**
 * Ход ботов. Считает их только ведущий и только на общем сервере.
 *
 * Отсюда важное следствие: пока в комнате нет НИ ОДНОГО человека, ботов не
 * считает никто, и пустой сервер не тратит ни трафика, ни чужого времени.
 * Боты существуют ровно тогда, когда есть кому на них смотреть.
 */
function stepBots(dt){
  // Боты — на общем сервере и на своих картах, где хозяин их включил.
  if (!(room?.permanent || room?.bots) || matchOver){ crew = null; return; }

  if (!isKeeper()){
    // Ведущий сменился — отпускаем отряд. Новый ведущий заведёт своих, а
    // позиции старых он всё равно перепишет первой же выкладкой.
    crew = null;
    wasKeeper = false;
    return;
  }
  if (!crew){
    // На сервере ни одного человека, кроме меня, — значит, ботов до меня
    // никто не вёл, и в базе лежат «замороженные» с прошлого раза (кто убит,
    // кто где стоял, чей счёт). Сносим их целиком и заводим отряд заново.
    const alone = ![...remotes.keys()].some(id => !isBotId(id));
    if (alone) resetBotsHard();
    startCrew(); wasKeeper = true;
  }

  const now = performance.now() / 1000;

  // Добор раз в две секунды, а не каждый кадр: считать головы шестьдесят раз в
  // секунду незачем, а создание бота — это ещё и поиск пути.
  if (now - botFillAt > 2){
    botFillAt = now;
    const counts = { a: 0, b: 0 };
    let humans = 1;
    counts[me.team] = (counts[me.team] || 0) + 1;
    for (const [id, remote] of remotes){
      if (isBotId(id)) continue;
      humans++;
      counts[remote.team] = (counts[remote.team] || 0) + 1;
    }
    for (const bot of crew.list) counts[bot.team] = (counts[bot.team] || 0) + 1;
    crew.fill(humans, counts);
  }

  crew.step(dt, botWorld(dt));

  if (now - botsPushAt > 1 / CREW.sendHz){
    botsPushAt = now;
    net.pushBots(roomId, crew.snapshot());
  }
}

/** Полный сброс ботов: убрать всех из базы и со сцены; бомбу — на руки. */
function resetBotsHard(){
  net.clearBots(roomId);
  for (const [id, remote] of [...remotes]){
    if (!isBotId(id)) continue;
    remote.dispose(scene);
    remotes.delete(id);
  }
  if (room.mode === "bomb") net.resetBomb(roomId);
  drops?.clear();
  refreshBoard();
}

/** Новый раунд: боты встают заново, и лишние уходят — между раундами, не в бою. */
function restartBots(){
  if (!crew) return;
  let humans = 1;
  for (const id of remotes.keys()) if (!isBotId(id)) humans++;

  // Ушедших надо стереть явно: выкладка шлёт только изменившихся, и молча
  // пропавший бот остался бы в базе стоять столбом навсегда.
  const gone = crew.release(humans);
  crew.restart();

  // Снимок берём ПОСЛЕ restart: иначе в базу уехали бы позиции, с которых
  // бойцы только что ушли, и первые полсекунды нового раунда все стояли бы
  // там, где их убили в прошлом.
  const patch = crew.snapshotAll();
  for (const id of gone) patch[id] = null;
  net.pushBots(roomId, patch);
}

// ---------------------------------------------------------------------------
// Сеть
// ---------------------------------------------------------------------------

function wireNetwork(){
  stopWatchers.push(net.watchPlayers(roomId, {
    onJoin(id, data){
      if (id === me.sessionUid) return;
      const remote = new RemotePlayer(id, data);
      remotes.set(id, remote);
      scene.add(remote.group);
      refreshBoard();
    },
    onUpdate(id, data){
      if (id === me.sessionUid) return;
      remotes.get(id)?.apply(data);
      refreshBoard();
    },
    onLeave(id){
      const remote = remotes.get(id);
      if (remote){ remote.dispose(scene); remotes.delete(id); refreshBoard(); }
    }
  }));

  // Боты приходят одним узлом, а не по одному: их выкладывает разом ведущий.
  // Рисуем их теми же RemotePlayer, что и людей, и кладём в тот же remotes —
  // тогда и табло, и имена над головами, и попадания, и подсчёт живых в конце
  // раунда работают без единой отдельной ветки «а если это бот».
  stopWatchers.push(net.watchBots(roomId, all => {
    const seen = new Set();
    for (const [id, data] of Object.entries(all)){
      seen.add(id);
      const known = remotes.get(id);
      if (known) known.apply(data);
      else {
        const remote = new RemotePlayer(id, data);
        remotes.set(id, remote);
        scene.add(remote.group);
      }
    }
    // Ушедших ботов убираем. Людей эта уборка не касается: у них свой ключ.
    for (const [id, remote] of remotes){
      if (!isBotId(id) || seen.has(id)) continue;
      remote.dispose(scene);
      remotes.delete(id);
    }
    refreshBoard();
  }));

  stopWatchers.push(net.watchEvents(roomId, (event, key) => {
    // Выстрелы людей слышат боты (свои выстрелы боты слышат сами, в bots.js).
    if (event.type === "shot" && crew && !isBotId(event.from)){
      const team = event.from === me.sessionUid ? me.team : remotes.get(event.from)?.team;
      if (team) crew.hear(new THREE.Vector3(event.ox, event.oy, event.oz), team);
    }
    if (event.type === "shot" && event.from !== me.sessionUid){
      const from = new THREE.Vector3(event.ox, event.oy, event.oz);
      drawTracer(from, new THREE.Vector3(event.hx, event.hy, event.hz));
      // Чужой выстрел слышно тише и глуше — по этому звуку и понимаешь,
      // далеко стреляют или уже за спиной.
      playRemoteShot(event.weapon, from.distanceTo(camera.position));
      remotes.get(event.from)?.kick();
    }

    if (event.type === "nade" && event.from !== me.sessionUid){
      // Чужой бросок: повторяем его у себя теми же числами. Траектория
      // получится та же — считать её по сети незачем.
      spawnNade({
        kind: event.kind, owner: event.from, team: event.team,
        from: new THREE.Vector3(event.x, event.y, event.z),
        velocity: new THREE.Vector3(event.vx, event.vy, event.vz)
      });
    }

    if (event.type === "hit" && event.to === me.sessionUid && self.alive){
      takeDamage(event.dmg, event.from, event.byName);
    }

    // Попадание по БОТУ применяет ведущий — тот, кто этого бота и считает.
    // Событие видят все, но трогает его один: иначе десять клиентов сняли бы
    // с бота один и тот же урон десять раз.
    if (event.type === "hit" && isBotId(event.to) && crew){
      const from = event.from === me.sessionUid ? self.pos : remotes.get(event.from)?.shown;
      crew.hurt(event.to, event.dmg, event.from, event.byName, from);
    }

    // Убитый роняет ствол там, где упал (у всех в одно и то же место).
    if (event.type === "kill" && typeof event.x === "number" && event.w){
      ensureDrops().add(key || `${event.victim}@${event.x},${event.z}`, event.w, event);
    }
    if (event.type === "pickup") drops?.remove(event.id);

    if (event.type === "kill"){
      // Бот убил человека — зачтём боту. Само событие приходит к каждому, но
      // счёт бота ведёт тот, у кого этот бот в руках.
      if (crew && isBotId(event.killer)) crew.credit(event.killer);
      const killer = event.killerName || "Кто-то";
      const victim = event.victimName || "боец";
      hud.kill(killer, victim, event.killer === me.sessionUid || event.victim === me.sessionUid);
      if (event.killer === me.sessionUid){
        ensureFx().kill(event.victimName);
        playKill();
        localStats.kills++;
        net.pushScore(roomId, me.sessionUid, { kills: localStats.kills });
        // Счёт раунда на общем сервере прибавляется ИМЕННО ЗДЕСЬ, в момент
        // убийства, и нигде больше. checkGoal() зовётся ещё и при каждом
        // обновлении табло — поставь начисление туда, и счёт команды рос бы от
        // любого шевеления в комнате.
        if (room.permanent) net.addRoundKill(me.team);
        checkGoal();
      }
    }
  }));

  // Кто сейчас играет — для панели в паузе. Держим подписку всё время, а не
  // заводим её по Escape: подписка дешёвая, а пауза должна открываться сразу,
  // а не «сейчас посмотрим».
  stopWatchers.push(net.watchPresence(rows => { presence = rows; renderWhoNow(); }));
  stopWatchers.push(net.watchRooms(rows => { roomList = rows; renderWhoNow(); }));

  // Связь. На плохом интернете чужие бойцы просто перестают двигаться, и без
  // подсказки это неотличимо от «в комнате никого». Говорим прямо.
  let wasOnline = true;
  stopWatchers.push(net.watchConnection(online => {
    document.getElementById("netlost").classList.toggle("show", !online);
    if (online && !wasOnline) hud.say("Связь вернулась.");
    wasOnline = online;
  }));

  stopWatchers.push(net.watchChat(roomId, message => {
    hud.chat(message, message.uid === me.uid);
    if (message.uid !== me.uid) playChat();
  }));

  stopWatchers.push(net.watchMeta(roomId, meta => {
    if (!meta){ endMatch("Комната закрылась"); return; }
    const wasRound = roundNow;
    // Режим сменился прямо под нами (общий сервер переведён на заминирование)
    // — перезаходим: сцена, стороны и счёт у режимов разные.
    if (room?.mode && meta.mode && meta.mode !== room.mode && !leaving){
      hud.banner("Сервер сменил режим", modeShort(meta.mode), 2500);
      setTimeout(() => { leaving = true; location.reload(); }, 2600);
      room = meta;
      return;
    }
    room = meta;
    // Заминирование живёт раундами в ЛЮБОЙ комнате, не только в постоянной:
    // бомбе надо куда-то возвращаться после взрыва.
    if (meta.mode === "bomb"){
      if (!wasRound){ roundNow = meta.round || 1; roundMap = meta.map || null; }
      else if (meta.round && meta.round !== wasRound) onBombRound(meta);
      hud.score(roundScore(me.team), BOMB.roundsToWin, "bomb");
      // Матч кончается счётом раундов — но только в обычной комнате. Общий
      // сервер работает круглосуточно: досчитав до восьми, он просто начинает
      // новый счёт, а не выставляет всех в лобби.
      if (!meta.permanent && !matchOver &&
          (roundScore("a") >= BOMB.roundsToWin || roundScore("b") >= BOMB.roundsToWin)){
        const winner = roundScore("a") >= BOMB.roundsToWin ? "a" : "b";
        endMatch(`Победа: ${sideName(winner)}`);
      }
      return;
    }

    if (meta.permanent){
      // Общий сервер не заканчивается — у него меняются раунды.
      if (!wasRound){ roundNow = meta.round || 1; roundMap = meta.map || null; }
      else if (meta.round && meta.round !== wasRound) onRoundChanged(meta);
      hud.score(roundScore(me.team), net.MAIN.killsToWin, "team");
      return;
    }
    if (meta.state === net.ROOM_STATE.OVER && !matchOver) endMatch(meta.winner || "Матч окончен");
  }));

  // Закрытая комната: хозяин видит, кто просится войти (друзья игроков).
  if (room.priv && room.hostSession === me.sessionUid){
    stopWatchers.push(net.watchKnocks(roomId, list => { knocks = list; showKnock(); }));
  }

  // Свернул вкладку — сразу говорим остальным: ведущим такой быть не может
  // (см. isKeeper), и боты переходят к тому, у кого игра на экране.
  const onVisibility = () => net.pushScore(roomId, me.sessionUid, { away: document.hidden });
  document.addEventListener("visibilitychange", onVisibility);
  stopWatchers.push(() => document.removeEventListener("visibilitychange", onVisibility));

  // Отправка своего состояния идёт по таймеру, а не каждый кадр: шестьдесят
  // записей в секунду на игрока не нужны никому, а трафик съедят.
  const sender = setInterval(() => {
    if (!self.alive) return;
    net.pushState(roomId, me.sessionUid, {
      x: round(self.pos.x), y: round(self.pos.y), z: round(self.pos.z),
      yaw: round(controls.yaw),
      // Наклон взгляда и ствол в руках: без них чужой боец стоит с ружьём
      // строго горизонтально и всегда с автоматом, чем бы ни стрелял.
      pitch: round(controls.pitch),
      w: arsenal.current.id,
      hp: Math.round(self.hp)
    });
  }, 1000 / SEND_HZ);
  stopWatchers.push(() => clearInterval(sender));

  // Пульс комнаты подаёт КАЖДЫЙ, кто в ней есть, а не только хозяин: иначе
  // стоило хозяину закрыть вкладку — и комната пропадала из списка, хотя бой
  // в ней идёт. Заодно тем же ударом пульса обновляется число игроков, которое
  // лобби показывает как «3/8».
  stopWatchers.push(net.roomHeartbeat(roomId, () => remotes.size + 1));

  // Подчищать старые события — дело хозяина: если это будут делать все сразу,
  // получится лишний трафик на ровном месте.
  if (room.hostSession === me.sessionUid){
    const pruner = setInterval(() => net.pruneEvents(roomId), 12_000);
    stopWatchers.push(() => clearInterval(pruner));
  }

  // Случайно закрыть вкладку посреди боя — Ctrl+W рядом с W, — теперь нельзя
  // без вопроса: браузер спросит «Покинуть сайт?». Сам выход из комнаты
  // переехал на pagehide — он наступает, только когда страница ДЕЙСТВИТЕЛЬНО
  // уходит. На beforeunload его делать нельзя: человек нажмёт «Остаться», а
  // из комнаты его уже выписали, и он бегает по карте невидимкой.
  addEventListener("beforeunload", e => {
    if (leaving || matchOver) return;   // уходим нарочно — не спрашиваем
    e.preventDefault();
    e.returnValue = "";
  });
  addEventListener("pagehide", () => { leaveRoom?.(); });
}

const round = n => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Управление
// ---------------------------------------------------------------------------

function wireInput(){
  const start = document.getElementById("start");

  controls.onChat = () => {
    controls.blocked = true;
    controls.releaseLock();
    hud.openChat();
  };

  hud.onSend = text => {
    net.sendChat(roomId, { uid: me.uid, name: me.name, tag: me.tag, text });
    controls.blocked = false;
    if (!touch) controls.requestLock();
  };

  const reload = () => { if (arsenal.startReload()) playReloadOut(); };

  const swap   = () => { if (arsenal.next()) playSwitch(); };

  document.addEventListener("keydown", e => {
    if (controls.blocked) return;
    if (e.code === "Escape"){ openPause(); return; }
    if (e.code === binds.reload) reload();
    if (e.code === binds.nade) throwNade(nextNade);
    if (e.code === binds.nadeSwap) swapNade();
    if (e.code === binds.knife && arsenal.selectId(arsenal.knife)){ playSwitch(); showSlots(); }
    if (e.code === binds.inspect && self.alive) viewModel.inspect();
    if (e.code === binds.spectate) toggleFreeCam();
    // Ответ на просьбу войти: Y — впустить, N — отказать (только когда она есть).
    if (knocks.length && e.code === "KeyY") answerKnock(true);
    if (knocks.length && e.code === "KeyN") answerKnock(false);
    // Цифры 1…9 — слоты по порядку: стволы, нож, граната, бомба.
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit){
      const key = Number(digit[1]);
      if (arsenal.selectKey(key)){ playSwitch(); showSlots(); }
      else if (key === arsenal.bombKey && !carriesBomb) sayNoBomb();
    }
    if (e.code === binds.board){ e.preventDefault(); hud.showBoard(true); }
  });
  document.addEventListener("keyup", e => {
    if (e.code === binds.board) hud.showBoard(false);
  });
  addEventListener("wheel", () => { if (!controls.blocked && arsenal.next()) playSwitch(); },
    { passive: true });

  // ---- телефон ------------------------------------------------------------
  if (isTouchDevice()){
    touch = new TouchControls(controls, {
      onReload: reload, onSwap: swap, onPause: openPause,
      onNade: () => throwNade(nextNade),
      onNadeSwap: swapNade,
      onInspect: () => { if (self.alive) viewModel.inspect(); },
      // Из настройки кнопок возвращаемся туда же, откуда в неё вошли, — в паузу.
      onEditDone: () => { document.getElementById("start").classList.remove("gone"); openPause(); }
    });
    // Табло на телефоне открывается тапом по счёту вверху — Tab нажать нечем.
    const bar = document.getElementById("topbar");
    let boardOpen = false;
    bar.addEventListener("click", () => {
      boardOpen = !boardOpen;
      hud.showBoard(boardOpen);
    });
    // Захвата мыши на телефоне нет, поэтому "в игре" объявляем сами — иначе
    // стрельба, завязанная на controls.locked, никогда бы не включилась.
    controls.requestLock = () => {
      controls.locked = true;
      controls.onLockChange?.(true);
    };
    controls.releaseLock = () => {
      controls.locked = false;
      controls.onLockChange?.(false);
    };
  }

  // ---- пуск и пауза -------------------------------------------------------
  start.addEventListener("click", event => {
    // Клик по кнопкам внутри меню обрабатывают сами кнопки.
    if (event.target.closest("#pauseBox")) return;
    if (start.classList.contains("paused")) return;
    wakeSound();
    controls.blocked = false;
    controls.requestLock();
  });

  document.getElementById("resumeBtn").onclick = () => {
    start.classList.remove("paused");
    controls.requestLock();
  };
  document.getElementById("leaveBtn").onclick = () => leaveMatch();

  // Полный экран: в нём игра забирает себе Ctrl+W и прочие сочетания браузера.
  const fsBtn = document.getElementById("fullscreenBtn");
  if (fsBtn){
    if (!document.documentElement.requestFullscreen || touch) fsBtn.remove();
    else fsBtn.onclick = async () => {
      await controls.fullscreen();
      start.classList.remove("paused");
      controls.requestLock();
    };
  }

  // ---- просьбы войти: кнопки (на телефоне и в паузе) --------------------------
  document.getElementById("knockYes").onclick = () => answerKnock(true);
  document.getElementById("knockNo").onclick = () => answerKnock(false);

  // ---- слоты пальцем: на телефоне цифр нет ------------------------------------
  document.getElementById("slots").addEventListener("click", e => {
    const cell = e.target.closest(".slot[data-i]");
    if (cell && arsenal.select(Number(cell.dataset.i))){ playSwitch(); showSlots(); }
  });

  // ---- наблюдение после смерти (кнопки для телефона) ------------------------
  document.getElementById("specPrev").onclick = () => cycleSpectate(-1);
  document.getElementById("specNext").onclick = () => cycleSpectate(1);
  document.getElementById("specFly").onclick = () => toggleFreeCam();

  // ---- смена стороны -------------------------------------------------------
  const swapSide = document.getElementById("swapSideBtn");
  if (swapSide){
    swapSide.onclick = askSwapSide;
    updateSwapButton();
  }

  // ---- настройка экранных кнопок -----------------------------------------
  // Кнопка есть смысл только там, где эти кнопки вообще нарисованы.
  const editBtn = document.getElementById("editTouchBtn");
  if (!touch) editBtn.remove();
  else editBtn.onclick = () => {
    // Меню паузы уезжает, чтобы не закрывать те самые кнопки, которые человек
    // сейчас двигает; игра при этом остаётся на паузе.
    document.getElementById("start").classList.add("gone");
    touch.startEdit();
  };

  // ---- комната: код и закрытие -------------------------------------------
  const codeBox = document.getElementById("roomCode");
  codeBox.textContent = room.code || "—";
  document.getElementById("copyCodeBtn").onclick = async () => {
    try {
      await navigator.clipboard.writeText(room.code || "");
      hud.say("Код скопирован — отправь его своим.");
    } catch {
      // На телефоне и без https буфер обмена запрещён: тогда просто выделяем,
      // чтобы человек скопировал сам. Молчать в этом месте нельзя — выглядит
      // как сломанная кнопка.
      hud.say("Скопировать не дали — код на экране: " + (room.code || "—"));
    }
    playClick();
  };

  // Закрыть комнату может только тот, кто её создал: правила базы сверяют
  // ключ сессии, и у остальных кнопка просто не нужна.
  const closeBtn = document.getElementById("closeRoomBtn");
  if (room.hostSession !== me.sessionUid){
    closeBtn.remove();
  } else {
    closeBtn.onclick = async () => {
      if (closeBtn.dataset.sure !== "1"){
        closeBtn.dataset.sure = "1";
        closeBtn.textContent = "Точно закрыть? Нажми ещё раз";
        setTimeout(() => {
          if (!closeBtn.isConnected) return;
          closeBtn.dataset.sure = "";
          closeBtn.textContent = "Закрыть комнату";
        }, 4000);
        return;
      }
      closeBtn.disabled = true;
      closeBtn.textContent = "Закрываем…";
      await net.closeRoom(roomId).catch(() => {});
      leaveMatch();
    };
  }

  // ---- качество картинки --------------------------------------------------
  // Смена качества перестраивает шейдеры и карту окружения, поэтому делается
  // перезагрузкой матча, а не на ходу: половина настроек (шум в шейдере,
  // разрешение теней, PMREM) живёт внутри уже собранных материалов, и снимать
  // их по одной — верный способ получить наполовину перестроенную сцену.
  const qualityRow = document.getElementById("qualityRow");
  for (const id of QUALITY_ORDER){
    const button = document.createElement("button");
    button.type = "button";
    button.className = quality === id ? "on" : "";
    button.textContent = QUALITY[id].name;
    button.onclick = () => {
      if (quality === id) return;
      saveQuality(id);
      playClick();
      hud.banner("Графика: " + QUALITY[id].name, "Перезапускаем матч", 1400);
      setTimeout(() => location.reload(), 900);
    };
    qualityRow.append(button);
  }

  const volume = document.getElementById("volume");
  volume.value = Math.round(getVolume() * 100);
  document.getElementById("volumeValue").textContent = volume.value;
  volume.oninput = () => {
    setVolume(Number(volume.value) / 100);
    document.getElementById("volumeValue").textContent = volume.value;
  };

  controls.onLockChange = locked => {
    start.classList.toggle("gone", locked);
    touch?.setVisible(locked);
    if (locked){
      start.classList.remove("paused");
      wakeSound();
    }
  };
}

/**
 * Панель «кто сейчас играет» в паузе.
 *
 * Сверху — бойцы этого матча со счётом, ниже — все остальные, кто сейчас в
 * «Заставе»: в какой комнате и на какой карте. Смысл именно в нижней части:
 * зайти вдвоём в пустую комнату и не понять, что рядом идёт матч на шестерых, —
 * обычное дело, когда список видно только из лобби.
 */
function renderWhoNow(){
  const here = $("whoHere"), other = $("whoElse");
  if (!here || !other) return;

  // Свой матч: я и все чужие бойцы, по убийствам.
  const rows = [
    { name: me.name, team: me.team, kills: localStats.kills, deaths: localStats.deaths, mine: true },
    ...[...remotes.values()].map(r => ({
      name: r.name, team: r.team, kills: r.kills || 0, deaths: r.deaths || 0
    }))
  ].sort((a, b) => b.kills - a.kills);

  here.innerHTML = "";
  for (const row of rows){
    const line = document.createElement("div");
    line.className = "who-row" + (row.mine ? " mine" : "");
    line.innerHTML = `
      <span class="who-team ${row.team || "free"}"></span>
      <b>${escapeHtml(row.name)}</b>
      <u>${row.kills}</u><u class="dim">${row.deaths}</u>`;
    here.append(line);
  }

  // Остальные комнаты. Своя не считается, закрытые не показываем — но если
  // там играет кто-то из присутствия, число всё равно видно по комнате.
  const counts = new Map();
  for (const row of presence){
    if (!row.room || row.room === roomId) continue;
    counts.set(row.room, (counts.get(row.room) || 0) + 1);
  }

  const elsewhere = roomList
    .filter(r => r.id !== roomId && !r.priv && r.state !== net.ROOM_STATE.OVER)
    .map(r => ({ ...r, live: counts.get(r.id) || r.count || 0 }))
    .sort((a, b) => b.live - a.live)
    .slice(0, 6);

  const playing = presence.filter(r => r.room).length;
  $("whoCount").textContent = `${playing} в игре`;

  other.innerHTML = "";
  if (!elsewhere.length){
    other.innerHTML = `<p class="who-empty">Других матчей сейчас нет.</p>`;
    return;
  }
  for (const room of elsewhere){
    const line = document.createElement("div");
    line.className = "who-room";
    const isMain = room.id === net.MAIN_ROOM;
    line.innerHTML = `
      <div>
        <b>${isMain ? "Застава — общий" : escapeHtml(room.hostName || "Боец")}</b>
        <i>${escapeHtml(mapMeta(room.map).name)} · ${modeShort(room.mode)}</i>
      </div>
      <span>${room.live}/${room.maxPlayers || 4}</span>
      <button class="btn btn-ghost tiny" type="button">Перейти</button>`;
    line.querySelector("button").onclick = () => switchRoom(room.id);
    other.append(line);
  }
}

const $ = id => document.getElementById(id);

function escapeHtml(text){
  return String(text ?? "").replace(/[&<>"]/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

/** Уйти в другой матч. Сначала выходим честно, потом переходим. */
async function switchRoom(id){
  if (leaving) return;
  leaving = true;
  stopAnnounce?.();
  for (const stop of stopWatchers) { try { stop(); } catch { /* ignore */ } }
  stopWatchers = [];
  try { await leaveRoom?.(); } catch { /* ignore */ }
  await saveResult();
  location.href = `game.html?room=${id}`;
}

/** Меню паузы. Оно же — экран, с которого бой начинается. */
function openPause(){
  if (matchOver || leaving) return;
  const start = document.getElementById("start");
  controls.releaseLock();
  controls.firing = false;
  start.classList.add("paused");
  start.classList.remove("gone");
  renderWhoNow();
  document.getElementById("startTitle").textContent = "Пауза";
  document.getElementById("startSub").textContent = "Матч продолжается без тебя";
  touch?.setVisible(false);
}

/**
 * Сервер «оборвал связь»: выходим из комнаты и показываем то же, что при
 * настоящей потере соединения. Ни слова о блокировке — так задумано.
 */
/** Аккаунт занят на другом устройстве: остаться в лобби или играть здесь. */
function askTakeOver(){
  return new Promise(resolve => {
    const box = document.getElementById("loading");
    box.classList.remove("gone");
    box.innerHTML = `<b>Этим аккаунтом уже играют на другом устройстве</b>
      <span>Играть одним аккаунтом сразу с двух устройств нельзя.
      Можно продолжить здесь — тогда на том устройстве игра остановится.</span>
      <button class="btn btn-main" type="button" id="takeOverBtn">Играть здесь</button>
      <a class="btn btn-ghost" href="lobby.html" id="takeOverNo">Вернуться в лобби</a>`;
    document.getElementById("takeOverBtn").onclick = () => {
      box.innerHTML = "<b>Входим…</b>";
      resolve(true);
    };
    document.getElementById("takeOverNo").onclick = e => { e.preventDefault(); resolve(false); };
  });
}

async function dropConnection(title = "Соединение с сервером потеряно.", text = access.CONNECT_FAIL){
  if (leaving) return;
  leaving = true;
  controls?.releaseLock();
  for (const stop of stopWatchers) { try { stop(); } catch { /* ignore */ } }
  stopWatchers = [];
  try { await leaveRoom?.(); } catch { /* ignore */ }
  try { await saveResult(); } catch { /* ignore */ }
  const box = document.getElementById("loading");
  box.innerHTML = `<b>${title}</b><span>${text}</span>
     <a class="btn btn-ghost" href="lobby.html">Вернуться в лобби</a>`;
  box.classList.remove("gone");
  document.getElementById("start")?.classList.add("gone");
  touch?.setVisible(false);
}

/**
 * Выход в лобби. Сначала убираем себя из комнаты и записываем итог, и только
 * потом уходим со страницы: уйти первым — значит бросить в базе бойца, который
 * ещё несколько секунд будет стоять на карте мишенью для остальных.
 */
async function leaveMatch(){
  if (leaving) return;
  leaving = true;
  stopAnnounce?.();
  document.getElementById("leaveBtn").textContent = "Выходим…";

  for (const stop of stopWatchers) { try { stop(); } catch { /* ignore */ } }
  stopWatchers = [];
  try { await leaveRoom?.(); } catch { /* ignore */ }
  await saveResult();
  location.href = "lobby.html";
}

// ---------------------------------------------------------------------------
// Кадр
// ---------------------------------------------------------------------------

function frame(){
  const dt = Math.min(clock.getDelta(), 0.05);   // после сворачивания вкладки
                                                 // dt бывает огромным — тогда
                                                 // игрок телепортируется сквозь
                                                 // стены. Ограничиваем.
  if (matchOver){ renderer.render(scene, camera); return; }

  if (arsenal.tick()) playReloadIn();
  stepSelf(dt);
  for (const remote of remotes.values()){
    remote.update(dt);
    remote.soldier.setBomb(remote.alive && remote.id === carrierSession);
  }
  stepShooting(dt);
  stepTracers(dt);

  if (self.alive){
    camera.position.set(self.pos.x, self.pos.y + (self.height - PLAYER.height + PLAYER.eye), self.pos.z);
    // Подкат — камера заваливается чуть набок; бег и подкат — шире угол
    // обзора (ощущение скорости, как в kour.io и Rivals).
    camRoll += ((move.slideT > 0 ? 0.075 : 0) - camRoll) * Math.min(1, dt * 8);
    camera.rotation.set(controls.pitch, controls.yaw, camRoll, "YXZ");
  } else {
    stepSpectate(dt);
  }
  viewModel.group.visible = self.alive && !scopeShown;

  const speed = Math.hypot(self.vel.x, self.vel.z);
  const dyaw = wrapAngle(controls.yaw - (lastLook.yaw ?? controls.yaw));
  const dpitch = controls.pitch - (lastLook.pitch ?? controls.pitch);
  lastLook.yaw = controls.yaw; lastLook.pitch = controls.pitch;
  const cur = arsenal.current;
  const reloadT = arsenal.reloading && cur.reload
    ? 1 - (arsenal.reloadingUntil - performance.now() / 1000) / cur.reload : -1;
  // Скорость вбок относительно взгляда — для наклона ствола при стрейфе.
  const side = (self.vel.x * Math.cos(controls.yaw) - self.vel.z * Math.sin(controls.yaw)) / PLAYER.speed;
  viewModel.update(dt, speed, cur.id, aimProgress(), {
    dyaw, dpitch, vy: self.vel.y, reload: reloadT,
    sprint: move.sprinting && speed > PLAYER.speed * 0.9, slide: move.slideT > 0,
    air: !onGround(self, map.colliders), strafe: side, crouch: !!controls.keys.crouch
  });
  stepAim(dt);
  stepSteps(dt, speed);
  stepLabels();
  stepRound();
  stepNades(dt);
  stepBots(dt);
  stepBombAction(dt);
  stepBombPickup();
  stepPickup(dt);
  stepRadar();
  fx?.update();
  stepBomb(dt);
  stepBombRound();

  hud.ammo(arsenal);
  showSlots();
  hud.timer(secondsLeft());
  if (room.mode === "bomb"){
    const left = fuseLeft(bomb, net.serverNow());
    hud.bomb(bombLine(bomb, carriesBomb, net.serverNow(), me.team), left !== null && left < 12);
  }

  renderer.render(scene, camera);
  viewModel.render(renderer);

  // На общем сервере нулевой таймер — это конец РАУНДА, им занимается
  // stepRound; заканчивать матч по нему нельзя, матч там бесконечный.
  //
  // В заминировании — то же самое, и по той же причине. Часы там показывают
  // остаток РАУНДА (а после закладки и вовсе запал), и нулём они кончаются по
  // несколько раз за матч. Матч в этом режиме кончается счётом, а не временем:
  // без этой оговорки первый же истёкший раунд объявлял бы «Время вышло» и
  // выкидывал всех в лобби. Ровно это и случилось на стенде.
  if (!room.permanent && room.mode !== "bomb" && secondsLeft() <= 0 && !matchOver){
    endMatch("Время вышло");
  }
}

/**
 * Имена над головами: гасим те, что за стеной.
 *
 * Метка рисуется поверх всей сцены (depthTest отключён) — иначе её резало бы
 * собственной каской бойца и углами вагонов, и читалась бы она кусками.
 * Обратная сторона ровно та, на которую и жаловались: имя светилось сквозь
 * стены, и по нему было видно, кто за каким вагоном стоит, — половина смысла
 * укрытий на «Депо» и «Теплицах» пропадала.
 *
 * Поэтому видимость считаем сами: пускаем луч от глаз к голове чужого бойца и
 * смотрим, не упрётся ли он раньше в геометрию карты. СТЕКЛО не считается
 * преградой (raycast пропускает bulletPass) — и это правильно: сквозь стекло
 * человека и так видно целиком, прятать над ним имя было бы странно.
 *
 * Считаем не каждый кадр, а раз в сотню миллисекунд и по одному лучу на
 * бойца: имя не должно мигать от каждого шага, а лишние лучи по всем
 * коллайдерам карты — это как раз то, на чём проседает частота кадров.
 */
const LABEL_RANGE = 90;        // дальше имена не читаются всё равно
let labelClock = 0;
const labelDir = new THREE.Vector3();
const labelHead = new THREE.Vector3();

function stepLabels(){
  const now = performance.now();
  if (now - labelClock < 100) return;
  labelClock = now;

  for (const remote of remotes.values()){
    remote.head(labelHead);
    labelDir.copy(labelHead).sub(camera.position);
    const distance = labelDir.length();

    if (distance > LABEL_RANGE){ remote.setVisible(false); continue; }
    labelDir.divideScalar(distance || 1);

    // Цели не передаём: нас интересует только, есть ли СТЕНА между нами.
    const hit = raycast(camera.position, labelDir, map.colliders, [], distance - 0.3);
    // Дым — такая же преграда, как стена. Дым, сквозь который видно имена, —
    // украшение, а не тактика: ставить его было бы незачем.
    remote.setVisible(!hit && !smokeBlocks(clouds, camera.position, labelHead));
  }
}

/**
 * Прицеливание по правой кнопке. Меняем угол обзора камеры, а не двигаем её:
 * так не нужно ни второй модели оружия, ни отдельной анимации, а ощущение
 * приближения то же самое. Чувствительность мыши делится на то же число —
 * без этого при трёхкратном прицеле навести на человека невозможно.
 */
/** Насколько доехало прицеливание, от 0 до 1. */
function aimProgress(){
  const zoom = arsenal.current.zoom || 1;
  return zoom > 1 ? Math.max(0, Math.min(1, (aimNow - 1) / (zoom - 1))) : 0;
}

function stepAim(dt){
  const weapon = arsenal.current;
  const want = controls.aiming && self.alive && arsenal.isGun ? weapon.zoom : 1;
  aimNow += (want - aimNow) * Math.min(1, dt * 12);

  const kickWant = move.slideT > 0 ? 11 : move.sprinting && Math.hypot(self.vel.x, self.vel.z) > PLAYER.speed ? 6 : 0;
  fovKick += (kickWant - fovKick) * Math.min(1, dt * 6);
  camera.fov = (BASE_FOV + fovKick) / aimNow;
  camera.updateProjectionMatrix();
  controls.zoomFactor = aimNow;

  // Окуляр показываем только у винтовки и только когда приближение почти
  // доехало: мелькающая чёрная рамка при каждом клике раздражает.
  const scoped = weapon.id === "sniper" && aimNow > weapon.zoom * 0.75;
  // У остальных стволов в прицеле вместо обычного креста — прицельная марка:
  // красная точка с крестиком, как в коллиматоре.
  document.body.classList.toggle("ads", !scoped && arsenal.isGun && aimProgress() > 0.7);
  if (scoped !== scopeShown){
    scopeShown = scoped;
    document.body.classList.toggle("scoped", scoped);
    // Через окуляр ствол не видно — в него и смотрят. Оставленная в кадре
    // модель торчала бы прямо посреди прицельной картинки.
    viewModel.group.visible = !scoped;
  }
}

/** Шаги. Частота от скорости; в воздухе молчим. */
function stepSteps(dt, speed){
  if (!self.alive || speed < 1.5 || !onGround(self, map.colliders)) return;
  const now = performance.now() / 1000;
  const interval = 0.42 * (PLAYER.speed / Math.max(speed, 1));
  if (now - stepAt > interval){
    stepAt = now;
    playStep();
  }
}

// Движение: бег (Shift), присед, подкат и прыжок из подката.
//
// Бег — как в kour.io: только вперёд, ствол опущен к груди, и стрелять на бегу
// нельзя — нажал огонь или прицел, и бег сам прекращается.
// Подкат — как в Rivals: бежишь и жмёшь «присесть» — скользишь по земле
// с разгоном, пригнувшись; можно рулить, можно выпрыгнуть из подката и
// сохранить скорость. Затем полсекунды передышки.
const MOVE = {
  slideBoost: 1.28,     // во сколько раз подкат разгоняет
  slideMin: 12.5,       // и не медленнее этого
  slideTime: 0.85,      // сколько длится
  slideDrag: 1.35,      // как быстро тормозит
  slideCooldown: 0.7
};
const move = { slideT: 0, slideCd: 0, crouchWas: false, sprinting: false, slideDir: new THREE.Vector3() };

function stepSelf(dt){
  if (!self.alive){
    move.slideT = 0; move.sprinting = false;
    if (performance.now() / 1000 >= self.respawnAt) spawn();
    return;
  }

  const grounded = onGround(self, map.colliders);
  const crouching = !!controls.keys.crouch;
  const pressedCrouch = crouching && !move.crouchWas;
  move.crouchWas = crouching;
  move.slideCd = Math.max(0, move.slideCd - dt);

  const forward = (controls.keys.fwd ? 1 : 0) - (controls.keys.back ? 1 : 0);
  const strafe  = (controls.keys.right ? 1 : 0) - (controls.keys.left ? 1 : 0);

  const dir = new THREE.Vector3(strafe, 0, -forward);
  if (dir.lengthSq() > 0) dir.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), controls.yaw);

  const flat = Math.hypot(self.vel.x, self.vel.z);
  move.sprinting = !!controls.keys.sprint && forward > 0 && !crouching && !controls.firing && !controls.aiming
    && arsenal.current.kind !== "bomb";

  // ---- подкат --------------------------------------------------------------
  if (pressedCrouch && grounded && move.slideT <= 0 && move.slideCd <= 0 && flat > PLAYER.speed * 1.05){
    move.slideT = MOVE.slideTime;
    move.slideDir.set(self.vel.x, 0, self.vel.z).normalize();
    const v = Math.max(flat * MOVE.slideBoost, MOVE.slideMin);
    self.vel.x = move.slideDir.x * v;
    self.vel.z = move.slideDir.z * v;
    viewModel.stopInspect();
    playSlideSafe();
  }
  if (move.slideT > 0){
    move.slideT -= dt;
    self.height += (PLAYER.crouchHeight - self.height) * Math.min(1, dt * 16);
    // Рулить можно чуть-чуть: подкат идёт по инерции, а не по клавишам.
    const steer = new THREE.Vector3(dir.x, 0, dir.z).multiplyScalar(dt * 4);
    self.vel.x += steer.x; self.vel.z += steer.z;
    const drag = Math.max(0, 1 - dt * MOVE.slideDrag);
    self.vel.x *= drag; self.vel.z *= drag;
    const now = Math.hypot(self.vel.x, self.vel.z);
    // Прыжок из подката: скорость сохраняется — главный приём Rivals.
    if (controls.keys.jump && grounded){ self.vel.y = PLAYER.jump; move.slideT = 0; }
    if (!crouching || now < PLAYER.crouchSpeed + 0.6) move.slideT = 0;
    if (move.slideT <= 0) move.slideCd = MOVE.slideCooldown;
    self.vel.y -= PLAYER.gravity * dt;
    movePlayer(self, self.vel.clone().multiplyScalar(dt), map.colliders);
    if (self.fell){ self.fell = false; takeDamage(1000, null, "Пропасть"); }
    return;
  }

  // Приседание: меняем высоту коробки, а не только камеру — иначе под вагоном
  // можно было бы пройти, только если смотреть в пол.
  const wanted = crouching ? PLAYER.crouchHeight : PLAYER.height;
  self.height += (wanted - self.height) * Math.min(1, dt * 12);

  // С ножом в руках бегают быстрее (speedMul), с пулемётом — как обычно.
  const maxSpeed = (crouching ? PLAYER.crouchSpeed
    : (move.sprinting ? PLAYER.sprint : PLAYER.speed))
    * (arsenal.current.speedMul || 1) * (myAgent?.speed || 1);

  // В воздухе управление резко слабее — иначе прыжок превращается в полёт.
  // И скорость из подката в воздухе не срезаем до обычной: иначе прыжок из
  // подката не давал бы ничего.
  const control = grounded ? 1 : PLAYER.airControl;
  const accel = grounded ? 52 : 52 * PLAYER.airControl;
  const k = Math.min(1, dt * accel * control / 6);
  if (grounded || flat <= maxSpeed || dir.lengthSq() === 0){
    self.vel.x += (dir.x * maxSpeed - self.vel.x) * k;
    self.vel.z += (dir.z * maxSpeed - self.vel.z) * k;
  } else {
    // быстрее обычного в воздухе: можно только рулить, скорость держится
    const turn = new THREE.Vector3(dir.x, 0, dir.z).multiplyScalar(flat);
    self.vel.x += (turn.x - self.vel.x) * k * 0.6;
    self.vel.z += (turn.z - self.vel.z) * k * 0.6;
  }

  if (grounded && dir.lengthSq() === 0){
    const friction = Math.max(0, 1 - dt * 12);
    self.vel.x *= friction;
    self.vel.z *= friction;
  }

  if (controls.keys.jump && grounded && !crouching) self.vel.y = PLAYER.jump;
  self.vel.y -= PLAYER.gravity * dt;

  movePlayer(self, self.vel.clone().multiplyScalar(dt), map.colliders);

  if (self.fell){ self.fell = false; takeDamage(1000, null, "Пропасть"); }
}

/** Шорох подката — короткий шум (тот же, что у шагов, только длинный). */
function playSlideSafe(){ try { playStep?.(); } catch { /* ignore */ } }

let firedBefore = false;   // была ли ЛКМ нажата в прошлом кадре — для гранаты

function stepShooting(dt){
  const pressed = controls.firing && !firedBefore;
  firedBefore = controls.firing;
  if (!self.alive || !controls.locked || controls.blocked) return;
  if (!controls.firing) return;

  const weapon = arsenal.current;
  viewModel.stopInspect();
  // Граната в руках — ЛКМ бросает (по нажатию, не очередью). Бомба в руках —
  // ЛКМ закладывает, это делает stepBomb, здесь стрелять нечем.
  if (weapon.kind === "nade"){ if (pressed) throwNade(nextNade); return; }
  if (weapon.kind === "bomb") return;
  if (!arsenal.canFire()) return;
  arsenal.consume();
  if (weapon.kind === "melee"){ strike(weapon); return; }

  const origin = camera.position.clone();
  const base = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
  const moving = Math.hypot(self.vel.x, self.vel.z) > 1.4;
  // Прицеливание втрое собирает разброс — это и есть смысл правой кнопки.
  const aimBonus = controls.aiming ? 0.34 : 1;
  const spread = (moving ? weapon.spreadMoving : weapon.spread) * aimBonus;

  const targets = [...remotes.values()]
    .filter(r => r.hp > 0 && (!isTeamMode(room.mode) || r.team !== me.team));

  let farthest = origin.clone().addScaledVector(base, 60);
  let anyHit = false, anyHead = false;

  for (let i = 0; i < weapon.pellets; i++){
    const dir = scatter(base, spread, THREE);
    const hit = raycast(origin, dir, map.colliders, targets);
    const point = hit?.point || origin.clone().addScaledVector(dir, 120);
    if (i === 0) farthest = point;

    if (hit?.target){
      anyHit = true;
      // Голова — верхние ~30 см коробки бойца.
      const head = hit.point.y > hit.target.shown.y + PLAYER.height - 0.33;
      if (head) anyHead = true;
      const dmg = damageAt(weapon, hit.distance) * (head ? HEAD_MULT : 1);
      ensureFx().hit(hit.target.id, hit.point, dmg, head);
      net.sendEvent(roomId, {
        type: "hit", to: hit.target.id, from: me.sessionUid,
        byName: me.name, dmg: Math.round(dmg), weapon: weapon.id, head: head || null
      });
    }
  }

  playShot(weapon.id);
  if (anyHit){ hud.hitMark(anyHead); playHit(); }

  drawTracer(origin.clone().addScaledVector(base, 0.6), farthest);
  viewModel.kick(weapon.recoil * 26, 60 / weapon.rpm);
  controls.pitch = Math.min(Math.PI / 2 - 0.02, controls.pitch + weapon.recoil);

  net.sendEvent(roomId, {
    type: "shot", from: me.sessionUid, weapon: weapon.id,
    ox: round(origin.x), oy: round(origin.y), oz: round(origin.z),
    hx: round(farthest.x), hy: round(farthest.y), hz: round(farthest.z)
  });
}

/**
 * Удар ножом: короткий луч на длину руки. Тот же raycast, что и у выстрела, —
 * поэтому стены и дым работают так же, а сквозь забор ножом не достать.
 */
function strike(weapon){
  const origin = camera.position.clone();
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
  const targets = [...remotes.values()]
    .filter(r => r.hp > 0 && (!isTeamMode(room.mode) || r.team !== me.team));
  const hit = raycast(origin, dir, map.colliders, targets);
  const landed = hit?.target && hit.distance <= weapon.range;
  viewModel.slash();
  playSlash(!!landed);
  if (!landed) return;
  ensureFx().hit(hit.target.id, hit.point, weapon.damage, false);
  net.sendEvent(roomId, {
    type: "hit", to: hit.target.id, from: me.sessionUid,
    byName: me.name, dmg: weapon.damage, weapon: weapon.id
  });
  hud.hitMark();
}

// ---------------------------------------------------------------------------
// Урон и смерть
// ---------------------------------------------------------------------------

function takeDamage(amount, fromSession, fromName){
  if (!self.alive) return;
  self.hp -= amount;
  hud.health(self.hp);
  hud.damageFlash();
  playHurt();

  if (self.hp > 0){
    net.pushScore(roomId, me.sessionUid, { hp: Math.round(self.hp) });
    return;
  }

  self.alive = false;
  self.hp = 0;
  localStats.deaths++;
  // В заминировании убитый ждёт следующего раунда. Уносим точку возрождения в
  // бесконечность, а не заводим отдельный флаг: stepSelf и так сравнивает
  // время, и одной ветки меньше.
  self.respawnAt = MODES[room.mode]?.respawn === false
    ? Infinity
    : performance.now() / 1000 + RESPAWN_DELAY;

  net.pushScore(roomId, me.sessionUid, { hp: 0, deaths: localStats.deaths });
  net.sendEvent(roomId, {
    type: "kill",
    killer: fromSession || null,
    killerName: fromName || "Пропасть",
    victim: me.sessionUid,
    victimName: me.name,
    // где упал и какой ствол выронил — его подберут
    x: round(self.pos.x), y: round(self.pos.y), z: round(self.pos.z),
    w: arsenal.isGun ? arsenal.current.id : arsenal.guns[0]
  });

  // Носильщик убит — бомба падает на землю, где он лежит; подберёт любой
  // террорист, пройдя по ней.
  if (carriesBomb) net.dropBomb(roomId, bombPos(self.pos));
  refreshCarrier();
  playDeath();
  hud.banner("Вас убил " + (fromName || "никто"),
    MODES[room.mode]?.respawn === false
      ? "Ждём конца раунда"
      : `Возрождение через ${RESPAWN_DELAY} с`,
    MODES[room.mode]?.respawn === false ? 2600 : RESPAWN_DELAY * 1000);
  controls.firing = false;
  controls.aiming = false;
  startSpectate();
}

// ---------------------------------------------------------------------------
// После смерти: наблюдение за своими или свободный полёт
//
// Убитый не смотрит в пол до конца раунда. Два режима:
//   «наблюдение» — камера за плечом живого товарища (в свалке — любого живого),
//                  ЛКМ / ПКМ листают, кого смотреть;
//   «свободный полёт» (noclip) — летаешь сквозь стены: WASD, мышь, пробел —
//                  вверх, присед — вниз, Shift — быстрее.
// V (или кнопка на телефоне) переключает режимы. Позиция полёта НЕ уходит в
// сеть: для остальных ты по-прежнему лежишь там, где упал, — летает только
// твоя камера.
// ---------------------------------------------------------------------------

const spec = { mode: "follow", target: null, pos: new THREE.Vector3(), firedBefore: false, aimedBefore: false };

function specCandidates(){
  return [...remotes.values()]
    .filter(r => r.hp > 0 && (!isTeamMode(room.mode) || r.team === me.team))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function startSpectate(){
  spec.pos.set(self.pos.x, self.pos.y + PLAYER.eye + 1.2, self.pos.z);
  spec.mode = "follow";
  spec.target = specCandidates()[0]?.id || null;
  if (!spec.target) spec.mode = "free";
  showSpecBar();
}

function cycleSpectate(step){
  const list = specCandidates();
  if (!list.length){ spec.mode = "free"; showSpecBar(); return; }
  const at = list.findIndex(r => r.id === spec.target);
  spec.target = list[(at + step + list.length) % list.length].id;
  spec.mode = "follow";
  playClick();
  showSpecBar();
}

function toggleFreeCam(){
  if (self.alive) return;
  if (spec.mode === "free"){ cycleSpectate(0); return; }
  // Полёт начинается оттуда, где сейчас камера, — без скачка.
  spec.pos.copy(camera.position);
  spec.mode = "free";
  playClick();
  showSpecBar();
}

function showSpecBar(){
  const bar = document.getElementById("specBar");
  if (!bar) return;
  bar.classList.toggle("show", !self.alive);
  document.body.classList.toggle("spectating", !self.alive);
  if (self.alive) return;
  const who = remotes.get(spec.target);
  const fly = keyLabel(binds.spectate || "KeyV");
  document.getElementById("specText").textContent = spec.mode === "free"
    ? `Свободный полёт · WASD, пробел — вверх, ${keyLabel(binds.crouch)} — вниз · ${fly} — к своим`
    : `Наблюдаешь: ${who?.name || "—"} · ЛКМ / ПКМ — сменить · ${fly} — свободный полёт`;
}

function stepSpectate(dt){
  // ЛКМ и ПКМ — по нажатию, а не пока держишь.
  const fired = controls.firing, aimed = controls.aiming;
  if (spec.mode === "follow"){
    if (fired && !spec.firedBefore) cycleSpectate(1);
    if (aimed && !spec.aimedBefore) cycleSpectate(-1);
  }
  spec.firedBefore = fired; spec.aimedBefore = aimed;

  let target = spec.mode === "follow" ? remotes.get(spec.target) : null;
  if (spec.mode === "follow" && (!target || target.hp <= 0)){
    // Товарищ погиб или ушёл — переключаемся на следующего живого.
    const next = specCandidates()[0];
    if (next){ spec.target = next.id; target = next; showSpecBar(); }
    else { spec.mode = "free"; showSpecBar(); }
  }

  if (spec.mode === "follow" && target){
    // Камера за плечом: чуть сзади и сверху, смотрит туда же, куда он.
    const head = target.head(new THREE.Vector3());
    const yaw = target.shownYaw;
    const back = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const want = head.clone().addScaledVector(back, 2.6).add(new THREE.Vector3(0, 0.55, 0));
    // Стена за спиной — придвигаемся, чтобы камера не ушла в бетон.
    const dir = want.clone().sub(head);
    const len = dir.length();
    const hit = raycast(head, dir.normalize(), map.colliders, [], len);
    const place = hit ? head.clone().addScaledVector(dir, Math.max(0.4, hit.distance - 0.25)) : want;
    camera.position.lerp(place, Math.min(1, dt * 10));
    camera.lookAt(head.x - back.x * 6, head.y - 0.2, head.z - back.z * 6);
    return;
  }

  // Свободный полёт.
  camera.rotation.set(controls.pitch, controls.yaw, 0, "YXZ");
  const k = controls.keys;
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const move = new THREE.Vector3()
    .addScaledVector(fwd, (k.fwd ? 1 : 0) - (k.back ? 1 : 0))
    .addScaledVector(right, (k.right ? 1 : 0) - (k.left ? 1 : 0));
  move.y += (k.jump ? 1 : 0) - (k.crouch ? 1 : 0);
  if (move.lengthSq() > 0) move.normalize().multiplyScalar((k.sprint ? 24 : 11) * dt);
  spec.pos.add(move);
  camera.position.copy(spec.pos);
}


/**
 * Конец раунда.
 *
 * Очко начисляет ВЕДУЩИЙ — тот, чей ключ сессии меньше всех. Если бы это делал
 * каждый, кто увидел взрыв, счёт рос бы на число живых игроков за раз. Все
 * остальные просто показывают итог и ждут.
 */
function endRound(reasonId){
  if (roundOver || room.mode !== "bomb") return;
  roundOver = true;

  const reason = ROUND_END[reasonId] || ROUND_END.timeout;
  const won = reason.winner === me.team;

  hud.banner(won ? "Раунд выигран" : "Раунд проигран", reason.text, 3000);
  if (won){
    localStats.coins = (localStats.coins || 0) + BOMB.coinsRoundWin;
    playKill();
  } else playDeath();

  controls.firing = false;
  actionBar?.hide();

  if (isKeeper()){
    net.addRoundWin(roomId, reason.winner);
    // Пауза перед следующим раундом — чтобы успеть прочитать, чем кончилось.
    setTimeout(() => {
      net.nextRoundIn(roomId, room, { seconds: BOMB.roundSeconds, winner: reason.winner });
    }, 4000);
  }
}

/**
 * Ведущий раундов: наименьший ключ сессии среди ЛЮДЕЙ в комнате.
 *
 * Именно среди людей. Боты лежат в том же remotes, что и живые бойцы, — так и
 * задумано, иначе пришлось бы дублировать табло, имена и попадания. Но ключи у
 * них вида "bot:1", и по алфавиту они встают раньше любой сессии. Стоило
 * появиться первому боту — и «ведущим» оказывался он: раунды переставали
 * крутиться, а отряд ботов каждый кадр распускался и заводился заново. Со
 * стороны это выглядело так, что боты есть, стоят на местах и не шевелятся.
 */
/**
 * Ведущий — тот, кто считает ботов и раунды. Раньше им был просто наименьший
 * ключ сессии, и это ломалось, стоило ведущему свернуть вкладку: браузер
 * останавливает в свёрнутой вкладке кадры, боты замирают, а попадания по ним
 * от остальных игроков доходят до ведущего и там… лежат. Со стороны это
 * выглядело так: «стреляю — урона нет». Теперь свернувшие вкладку (away) в
 * выборах не участвуют; если свернули все — берём из всех, как раньше.
 */
function isKeeper(){
  const others = [...remotes.values()].filter(r => !isBotId(r.id));
  // Своя карта: ведёт ХОЗЯИН — его компьютер считает раунды, ботов и бомбу.
  // Если хозяин вышел или свернул окно — как обычно, по очереди.
  if (room?.hostKeeper){
    if (room.hostSession === me.sessionUid && !document.hidden) return true;
    const host = others.find(r => r.id === room.hostSession);
    if (host && !host.away) return false;
  }
  const active = [...(document.hidden ? [] : [me.sessionUid]), ...others.filter(r => !r.away).map(r => r.id)];
  const pool = active.length ? active : [me.sessionUid, ...others.map(r => r.id)];
  return net.isRoundKeeper(me.sessionUid, pool);
}

/**
 * Проверка условий конца раунда — то, чего не видно из отдельного события.
 *
 * Взрыв и разминирование приходят сами; а вот «время вышло» и «сторона
 * уничтожена» надо заметить. Смотрит только ведущий, раз в полсекунды: если бы
 * смотрели все, каждый начал бы свой раунд.
 */
let roundCheck = 0;
function stepBombRound(){
  if (room.mode !== "bomb" || roundOver || matchOver) return;
  const now = performance.now();
  if (now - roundCheck < 500) return;
  roundCheck = now;
  if (!isKeeper()) return;
  keepBomb();

  const planted = bomb?.state === BOMB_STATE.PLANTED;
  const alive = { a: 0, b: 0 };
  if (self.alive) alive[me.team] = (alive[me.team] || 0) + 1;
  for (const r of remotes.values()) if (r.hp > 0) alive[r.team] = (alive[r.team] || 0) + 1;

  // Сторону считаем уничтоженной, только если в ней вообще КТО-ТО был: в
  // пустой комнате иначе раунды крутились бы сами собой без единого игрока.
  const had = { a: 0, b: 0 };
  had[me.team] = 1;
  for (const r of remotes.values()) had[r.team] = 1;

  if (had.a && !alive.a && !planted) return endRound("wipedA");
  if (had.b && !alive.b) return endRound("wipedB");
  // Заложенная бомба переживает своих: даже если террористов не осталось,
  // раунд идёт, пока она тикает, — спецназ обязан прийти и снять её.
  if (had.a && !alive.a && planted) return;

  if (!planted && Date.now() > (room.roundEnds || 0)) endRound("timeout");
}

// ---------------------------------------------------------------------------
// Гранаты
// ---------------------------------------------------------------------------

/**
 * Бросок.
 *
 * По сети уходит ОДНО событие: откуда, с какой скоростью и какая. Траекторию
 * каждый считает у себя по одинаковым числам — гонять двенадцать пакетов в
 * секунду на каждую летящую гранату и дорого, и не нужно.
 */
/**
 * Перерисовать полосу слотов.
 *
 * Зовётся отовсюду, где меняется хоть что-то из показанного: сменил ствол,
 * бросил гранату, получил бомбу, возродился. Дешевле перерисовать четыре
 * ячейки, чем разводить по коду четыре отдельных обновления и однажды забыть
 * про пятое.
 */
let slotsShown = "";

function showSlots(){
  const owns = owned.includes("frag") || owned.includes("smoke");
  // Подпись того, что на полосе видно. Зовут showSlots из десятка мест и каждый
  // кадр, а перерисовка — это innerHTML: шестьдесят раз в секунду собирать
  // одну и ту же строку незачем. Сравнение подписи стоит ничего и избавляет
  // от необходимости помнить, откуда ещё надо позвать.
  arsenal.setExtras({ nade: owns, bomb: carriesBomb });
  const mark = `${arsenal.order.join(",")}|${arsenal.index}|${nades.frag}|${nades.smoke}|${nextNade}|${carriesBomb}|${owns}`;
  if (mark === slotsShown) return;
  slotsShown = mark;
  hud.slots?.({ arsenal, nades, nextNade, carries: carriesBomb, owns });
}

// ---------------------------------------------------------------------------
// Просьбы войти в закрытую комнату (видит только хозяин)
// ---------------------------------------------------------------------------

let knocks = [];

function showKnock(){
  const box = document.getElementById("knockBox");
  if (!box) return;
  const k = knocks[0];
  box.classList.toggle("show", !!k);
  if (!k) return;
  // Друг самого хозяина — пишем «твой друг», иначе — чей именно.
  const whose = !k.friendOf ? "" : k.friendOf === me.name ? " — твой друг" : ` — друг игрока ${k.friendOf}`;
  document.getElementById("knockText").textContent = `${k.nick}${whose} просится в комнату`;
  document.getElementById("knockMore").textContent = knocks.length > 1 ? `ещё ${knocks.length - 1} ждут` : "";
  playChat();
}

function answerKnock(yes){
  const k = knocks.shift();
  if (!k) return;
  net.answerKnock(roomId, k.session, yes);
  hud.say(yes ? `${k.nick} впущен.` : `${k.nick} — отказано.`);
  showKnock();
}

/** Нажал 5 без бомбы — объясняем, у кого она, вместо молчания. */
function sayNoBomb(){
  if (me.team !== "a"){ hud.say("Бомба только у террористов — спецназ её разминирует (E)."); return; }
  const who = carrierSession && carrierSession !== me.sessionUid ? remotes.get(carrierSession)?.name : null;
  hud.say(bomb?.state === "planted" ? "Бомба уже заложена."
    : bomb?.state === "dropped" ? "Бомба лежит на земле — подбери её (пройди по ней)."
    : who ? `Бомба у ${who}. Её выдают одному случайному террористу на раунд.` : "Бомбы у тебя нет: её выдают одному случайному террористу на раунд.");
}

/** Переключить, какую гранату бросаем следующей. */
function swapNade(){
  nextNade = nextNade === "frag" ? "smoke" : "frag";
  showSlots();
  playClick();
}

function throwNade(kind){
  if (!self.alive) return;
  if (!nades[kind]){
    // Молчаливый отказ читается как «кнопка не работает». Лучше сказать.
    hud.say(`${GRENADES[kind]?.name || "Граната"} кончилась — будет со следующей жизнью.`);
    return;
  }
  nades[kind]--;
  showSlots();

  const from = camera.position.clone().addScaledVector(
    camera.getWorldDirection(new THREE.Vector3()), 0.5);
  // К броску добавляется своя скорость: на бегу граната летит дальше, и это
  // ровно то, чего человек ждёт.
  const velocity = throwVelocity(camera, kind, Math.hypot(self.vel.x, self.vel.z) * 0.35);

  spawnNade({ kind, from, velocity, owner: me.sessionUid, team: me.team });
  net.sendEvent(roomId, {
    type: "nade", kind, from: me.sessionUid, team: me.team,
    x: round(from.x), y: round(from.y), z: round(from.z),
    vx: round(velocity.x), vy: round(velocity.y), vz: round(velocity.z)
  });
  playSwitch();
}

function spawnNade(opts){
  const nade = new Grenade(opts);
  scene.add(nade.mesh);
  flying.push(nade);
}

function stepNades(dt){
  const now = performance.now() / 1000;

  for (let i = flying.length - 1; i >= 0; i--){
    const nade = flying[i];
    if (!nade.step(dt, map.colliders)) continue;

    if (nade.kind === "smoke"){
      const cloud = new Smoke(nade.pos, now);
      scene.add(cloud.group);
      clouds.push(cloud);
      playReloadOut();
    } else {
      explodeFrag(nade);
    }
    nade.dispose(scene);
    flying.splice(i, 1);
  }

  for (let i = clouds.length - 1; i >= 0; i--){
    clouds[i].update(dt, now);
    if (clouds[i].done){ clouds[i].dispose(scene); clouds.splice(i, 1); }
  }
}

/**
 * Взрыв осколочной.
 *
 * Урон себе считаем всегда — своя же граната бьёт своего, и это не
 * недоработка: иначе её кидали бы себе под ноги в упор. По чужим считает
 * ХОЗЯИН броска и сообщает жертве, как и с выстрелом: у здоровья один хозяин,
 * и второго быть не должно.
 */
function explodeFrag(nade){
  flash(nade.pos, 0xffb257, 0.35);
  playRemoteShot("lmg", nade.pos.distanceTo(camera.position));

  if (self.alive){
    const eye = self.pos.clone().setY(self.pos.y + PLAYER.eye * 0.6);
    const damage = fragDamage(nade.pos, eye, map.colliders);
    if (damage > 0){
      const byMe = nade.owner === me.sessionUid;
      takeDamage(damage, byMe ? null : nade.owner, byMe ? "Своя граната" : "Граната");
    }
  }

  if (nade.owner !== me.sessionUid) return;

  for (const [id, remote] of remotes){
    if (remote.hp <= 0) continue;
    const eye = remote.shown.clone().setY(remote.shown.y + PLAYER.eye * 0.6);
    const damage = fragDamage(nade.pos, eye, map.colliders);
    if (damage <= 0) continue;
    net.sendEvent(roomId, {
      type: "hit", to: id, from: me.sessionUid,
      byName: me.name, dmg: damage, weapon: "frag"
    });
  }
}

/** Короткая вспышка на месте взрыва — чтобы его было видно, а не только слышно. */
function flash(at, color, seconds){
  const light = new THREE.PointLight(color, 1200, 26, 2);
  light.position.copy(at);
  scene.add(light);
  const born = performance.now();
  const tick = () => {
    const k = 1 - (performance.now() - born) / (seconds * 1000);
    if (k <= 0){ scene.remove(light); return; }
    light.intensity = 1200 * k * k;
    requestAnimationFrame(tick);
  };
  tick();
}


/**
 * Начался новый раунд заминирования.
 *
 * Все живут заново, счёт раунда обнулён, бомба снова на руках. Если вместе с
 * раундом сменилась карта (общий сервер), перезагружаемся — по той же причине,
 * что и в командном режиме: разбирать собранную сцену по частям надёжнее не
 * получается.
 */
function onBombRound(meta){
  const mapChanged = meta.map && roundMap && meta.map !== roundMap;
  roundNow = meta.round;
  roundMap = meta.map || roundMap;

  if (mapChanged){
    hud.banner(mapMeta(meta.map).name, `Раунд ${meta.round} — меняем карту`, 3000);
    setTimeout(() => { leaving = true; location.href = `game.html?room=${roomId}&team=${me.team}`; }, 3200);
    return;
  }

  roundOver = false;
  holdFor = 0;
  bombGroup.visible = false;
  drops?.clear();
  // Дым и гранаты прошлого раунда не переносятся: иначе новый раунд начинался
  // бы в чужом дыму, который никто не ставил.
  for (const nade of flying) nade.dispose(scene);
  for (const cloud of clouds) cloud.dispose(scene);
  flying = []; clouds = [];

  self.respawnAt = 0;
  applyPendingTeam();
  spawn();
  refreshCarrier();
  restartBots();
  hud.banner(`Раунд ${meta.round}`, SIDES[me.team]?.goal || "", 2600);
}

function checkGoal(){
  // В заминировании на табло не убийства, а ВЫИГРАННЫЕ РАУНДЫ: они и решают
  // матч, а личный счёт виден по Tab.
  if (room.mode === "bomb"){
    hud.score(roundScore(me.team), BOMB.roundsToWin, "bomb");
    return;
  }
  // Общий сервер живёт раундами: цель — счёт КОМАНДЫ за раунд, он же лежит в
  // meta и одинаков у всех. Здесь только показываем: начисляет обработчик
  // убийства, потому что сюда заходят ещё и по обновлению табло.
  if (room.permanent){
    hud.score(roundScore(me.team), net.MAIN.killsToWin, "team");
    return;
  }

  const goal = GOAL[room.mode] || GOAL.dm;
  const mine = room.mode === "team" ? teamScore(me.team) : localStats.kills;
  hud.score(mine, goal, room.mode);
  if (mine >= goal && room.hostSession === me.sessionUid){
    net.setRoomState(roomId, net.ROOM_STATE.OVER, { winner: room.mode === "team"
      ? `Победила команда ${me.team === "a" ? "песочных" : "синих"}`
      : `Победил ${me.name}` });
  }
}

/**
 * Счёт команды за текущий раунд на общем сервере.
 *
 * Берётся из meta, а не складывается из счётчиков бойцов, и это важно: убийства
 * у бойца копятся за всё время, что он в комнате, а раунд обнуляется. Складывая
 * личные счётчики, мы бы получали сумму за весь вечер, и раунд заканчивался бы
 * через минуту после начала.
 */
function roundScore(team){
  return Number(team === "b" ? room.scoreB : room.scoreA) || 0;
}

/**
 * Раунды на общем сервере.
 *
 * Крутит их ровно один клиент — тот, чей ключ сессии меньше всех среди
 * присутствующих. Это не выборы: все видят один и тот же список игроков и
 * приходят к одному ответу сами, а когда ведущий уходит, следующий по порядку
 * берёт дело на себя молча. Иначе четверо разом начали бы четыре раунда.
 *
 * Проверяем раз в две секунды, а не каждый кадр: спешить некуда, а шестьдесят
 * записей в секунду в meta не нужны никому.
 */
let roundCheckedAt = 0;
function stepRound(){
  if (!room?.permanent || matchOver || leaving) return;
  // Заминирование крутит свои раунды само (stepBombRound + endRound): там
  // раунд кончается взрывом, снятием или уничтожением стороны, а не счётом
  // убийств. Если пустить сюда и его, раунд переключался бы дважды — один раз
  // по бомбе, второй по этому таймеру, и бомба пропадала бы на полуслове.
  if (room.mode === "bomb") return;

  const now = Date.now();
  if (now - roundCheckedAt < 2000) return;
  roundCheckedAt = now;

  // Через isKeeper, а не своим списком: ботов в ведущие пускать нельзя, и
  // помнить об этом в двух местах — верный способ однажды забыть в одном.
  if (!isKeeper()) return;

  const done = roundScore("a") >= net.MAIN.killsToWin
            || roundScore("b") >= net.MAIN.killsToWin
            || now > (room.roundEnds || 0);
  if (done) net.nextRound(room).catch(() => {});
}

/**
 * Начался новый раунд.
 *
 * Если вместе с ним сменилась карта — перезагружаем страницу. Перестраивать
 * сцену на ходу можно, но это самый богатый на ошибки кусок работы во всей
 * игре: надо снять все старые коллайдеры, выбросить геометрию, переставить
 * всех бойцов и не забыть ни одной мелочи. Перезагрузка делает то же самое
 * гарантированно и занимает секунду — на общем сервере это происходит раз в
 * полчаса, и лучше честная пауза, чем редкий необъяснимый сбой.
 */
let roundNow = 0;
let roundMap = null;      // карта, по которой мы СЕЙЧАС бегаем

function onRoundChanged(meta){
  // Сравниваем с отдельно запомненной картой, а не с room.map. Причина в том,
  // что room к этому моменту уже переписан пришедшим meta, и карта в нём,
  // разумеется, новая; а полагаться на то, что предыдущий объект meta никто не
  // изменил, нельзя — это зависит от того, отдаёт ли библиотека копию.
  // Собственная переменная не зависит ни от чего.
  const mapChanged = meta.map && roundMap && meta.map !== roundMap;
  roundNow = meta.round;
  roundMap = meta.map || roundMap;

  if (mapChanged){
    hud.banner(mapMeta(meta.map).name, `Раунд ${meta.round} — меняем карту`, 3000);
    playMatchEnd();
    setTimeout(() => { leaving = true; location.href = `game.html?room=${roomId}`; }, 3200);
    return;
  }

  applyPendingTeam();
  hud.banner(`Раунд ${meta.round}`, "Счёт обнулён", 2200);
  playSpawn();
  localStats.kills = 0;
  net.pushScore(roomId, me.sessionUid, { kills: 0, deaths: localStats.deaths });
  if (self.alive) { self.hp = 100; hud.health(self.hp); }
  else spawn();
}

function teamScore(team){
  let total = team === me.team ? localStats.kills : 0;
  for (const remote of remotes.values()) if (remote.team === team) total += remote.kills || 0;
  return total;
}

function secondsLeft(){
  // В заминировании после закладки часы показывают ЗАПАЛ, а не остаток раунда:
  // с этой секунды время раунда никого не интересует, а до взрыва — всех.
  if (room.mode === "bomb"){
    const fuse = fuseLeft(bomb);
    if (fuse !== null) return fuse;
    return ((room.roundEnds || Date.now()) - Date.now()) / 1000;
  }
  // На общем сервере матч не кончается никогда — кончается РАУНД, и его конец
  // записан в meta.roundEnds. Считать от начала матча тут нечего: он идёт
  // круглосуточно.
  if (room.permanent) return ((room.roundEnds || Date.now()) - Date.now()) / 1000;
  return MATCH_SECONDS - (Date.now() - (room.startedAt || room.createdAt || Date.now())) / 1000;
}

/**
 * Запись итога. Вынесена отдельно, потому что поводов два: матч кончился сам
 * или человек вышел в лобби посреди боя. Во втором случае честно засчитываем
 * всё, что он успел: уход не должен обнулять полчаса игры.
 */
async function saveResult(){
  if (saved) return;
  saved = true;
  try {
    await addMatchResult(me.uid, {
      points: localStats.kills * 10,
      coins: localStats.kills * COINS_PER_KILL + COINS_PER_MATCH,
      kills: localStats.kills,
      deaths: localStats.deaths
    });
  } catch { /* не записалось — матч это не портит */ }
}

async function endMatch(reason){
  if (matchOver) return;
  matchOver = true;
  controls.releaseLock();
  touch?.setVisible(false);
  playMatchEnd();

  hud.banner("Матч окончен", reason, 0);
  document.getElementById("start").classList.add("gone");
  document.getElementById("finish").classList.add("show");
  document.getElementById("finishKills").textContent = localStats.kills;
  document.getElementById("finishDeaths").textContent = localStats.deaths;
  document.getElementById("finishCoins").textContent =
    "+" + (localStats.kills * COINS_PER_KILL + COINS_PER_MATCH);

  // Итог пишем в Firestore ОДНОЙ записью в самом конце. Начислять по ходу боя
  // — это и лишний расход бесплатного лимита, и задержка ровно тогда, когда
  // она мешает больше всего.
  await saveResult();
}

// ---------------------------------------------------------------------------
// Трассеры
// ---------------------------------------------------------------------------

function drawTracer(from, to){
  const geometry = new THREE.BufferGeometry().setFromPoints([from, to]);
  const material = new THREE.LineBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.85 });
  const line = new THREE.Line(geometry, material);
  scene.add(line);
  tracers.push({ line, life: 0.09 });
}

function stepTracers(dt){
  for (let i = tracers.length - 1; i >= 0; i--){
    const tracer = tracers[i];
    tracer.life -= dt;
    tracer.line.material.opacity = Math.max(0, tracer.life / 0.09) * 0.85;
    if (tracer.life <= 0){
      scene.remove(tracer.line);
      tracer.line.geometry.dispose();
      tracer.line.material.dispose();
      tracers.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Табло
// ---------------------------------------------------------------------------

function refreshBoard(){
  const rows = [{
    name: me.name, tag: me.tag, team: me.team,
    kills: localStats.kills, deaths: localStats.deaths, me: true
  }];
  for (const remote of remotes.values()){
    rows.push({
      name: remote.name, tag: remote.tag, team: remote.team,
      kills: remote.kills || 0, deaths: remote.deaths || 0, me: false
    });
  }
  hud.scoreboard(rows, room.mode);
  checkGoal();
  // Кто несёт бомбу, зависит от того, КТО ЖИВ: ушёл прежний носильщик — бомба
  // переходит следующему. Считаем здесь, потому что сюда сходятся все поводы
  // для пересчёта — вход, выход, смерть, обновление счёта. Раньше это делалось
  // только на смене раунда, и в САМОМ ПЕРВОМ раунде бомбы не было ни у кого:
  // закладывать её было некому, и раунд всегда кончался по времени.
  refreshCarrier();
}
