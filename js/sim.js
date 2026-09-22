// sim.js — симулятор карт «Заставы».
//
// Загружает карту (карту игры или файл из редактора) и даёт пробежать по ней
// от первого лица: та же физика, что в игре (game/physics.js — копия), те же
// коробки карты (game/maps/fromdata.js), та же скорость бега, прыжок, присед
// и подкат. Секундомер меряет, за сколько сторона добегает от возрождения до
// точек A и B, — это и есть главный вопрос к новой карте: честная ли она.

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js";
import { PLAYER, movePlayer, onGround, raycast } from "./game/physics.js";
import { mapFromData } from "./game/maps/fromdata.js";
import { readMapFile } from "./game/maps/editorfile.js";

const $ = id => document.getElementById(id);
const SITE_R = 5;
const MOVE = { slideBoost: 1.28, slideMin: 12.5, slideTime: 0.85, slideDrag: 1.35, slideCooldown: 0.7 };

// ---- сцена ------------------------------------------------------------------

const canvas = $("view");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 900);
scene.add(camera);

function resize(){
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();

// ---- состояние ----------------------------------------------------------------

let map = null;          // { group, colliders, sites, teamSpawns, … }
let mapTitle = "";
let side = "a";
let extras = null;       // метки точек и мишени
let targets = [];
const self = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), height: PLAYER.height, fell: false };
const look = { yaw: 0, pitch: 0 };
const keys = {};
let fly = false;
const move = { slideT: 0, slideCd: 0, crouchWas: false };
const run = { start: 0, moving: false, reached: {} };
const best = { a: {}, b: {} };      // лучшее время: best[side][site]

// ---- загрузка карты -------------------------------------------------------------

function parseText(text){
  let t = text.trim();
  if (!t.startsWith("{")){
    const i = t.indexOf("const DATA = ");
    if (i < 0) throw new Error("это не файл карты «Заставы»");
    t = t.slice(i + "const DATA = ".length, t.indexOf("};", i) + 1);
  }
  const res = readMapFile(t);
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

function useMap(data, title){
  if (map) scene.remove(map.group);
  if (extras) scene.remove(extras);
  map = mapFromData(data).build();
  mapTitle = title || data.name || "Карта";
  scene.add(map.group);
  scene.background = new THREE.Color(map.sky);
  scene.fog = new THREE.Fog(map.fog.color, map.fog.near, map.fog.far);
  buildExtras();
  best.a = {}; best.b = {};
  showTimes();
  $("mapName").textContent = mapTitle;
  $("loaded").textContent = `Загружена: «${mapTitle}» — ${data.size[0]}×${data.size[1]} м, блоков: ${data.boxes.length + data.ramps.length}.`;
  $("play").disabled = false;
  respawn();
}

/** Метки точек A/B и мишени. */
function buildExtras(){
  extras = new THREE.Group();
  scene.add(extras);
  map.sites.forEach((s, i) => {
    const ring = new THREE.Mesh(new THREE.RingGeometry(SITE_R - 0.35, SITE_R, 48),
      new THREE.MeshBasicMaterial({ color: 0xe8a317, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(s[0], s[1] + 0.05, s[2]);
    extras.add(ring);
    const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: letter(i ? "B" : "A"), depthWrite: false }));
    sign.position.set(s[0], s[1] + 3, s[2]); sign.scale.set(1.4, 1.4, 1);
    extras.add(sign);
  });
  targets = [];
  if (!$("targets").checked) return;
  const enemy = side === "a" ? "b" : "a";
  const spots = [...(map.teamSpawns[enemy] || []).map(s => s.pos), ...map.sites];
  for (const p of spots){
    const g = new THREE.Group();
    const color = enemy === "a" ? 0xc9853a : 0x3f6fa0;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.3, 0.4), new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
    body.position.y = 0.65 + 0.2; body.castShadow = true;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.3), new THREE.MeshStandardMaterial({ color: 0xb98d68 }));
    head.position.y = 1.55; head.castShadow = true;
    g.add(body, head);
    g.position.set(p[0] + 1.2, p[1], p[2]);
    extras.add(g);
    const box = new THREE.Box3().setFromObject(g);
    targets.push({ group: g, box, alive: true });
  }
}

function letter(text){
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const x = c.getContext("2d");
  x.fillStyle = "rgba(16,18,20,.82)"; x.fillRect(10, 10, 108, 108);
  x.strokeStyle = "#e8a317"; x.lineWidth = 7; x.strokeRect(10, 10, 108, 108);
  x.fillStyle = "#e8a317"; x.font = "700 82px system-ui, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
  x.fillText(text, 64, 70);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function respawn(){
  if (!map) return;
  const list = map.teamSpawns[side]?.length ? map.teamSpawns[side] : map.spawns;
  const p = list[Math.floor(Math.random() * list.length)];
  self.pos.set(...p.pos);
  self.vel.set(0, 0, 0);
  self.height = PLAYER.height;
  look.yaw = p.yaw || 0; look.pitch = 0;
  move.slideT = 0;
  run.start = 0; run.moving = false; run.reached = {};
  for (const t of targets){ t.alive = true; t.group.rotation.z = 0; t.group.position.y = t.group.userData.y ?? t.group.position.y; }
  $("timerMain").textContent = "0.0 с";
  $("timerSub").textContent = "побежали — секундомер пойдёт с первого шага";
}

async function loadOfficial(id){
  try {
    const res = await fetch(`maps/${id}.zmap.json`);
    if (!res.ok) throw new Error("не найдена");
    useMap(parseText(await res.text()));
  } catch (e){ $("loaded").textContent = "Не удалось загрузить карту: " + e.message; }
}
async function loadFile(file){
  try { useMap(parseText(await file.text())); }
  catch (e){ $("loaded").textContent = "Не удалось открыть файл: " + e.message; }
}

// ---- меню -------------------------------------------------------------------

$("official").addEventListener("change", () => { if ($("official").value) loadOfficial($("official").value); });
$("openFile").addEventListener("click", () => $("fileIn").click());
$("fileIn").addEventListener("change", () => { const f = $("fileIn").files[0]; $("fileIn").value = ""; if (f) loadFile(f); });
addEventListener("dragover", e => { if (e.dataTransfer?.types?.includes("Files")){ e.preventDefault(); document.body.classList.add("drop"); } });
addEventListener("dragleave", () => document.body.classList.remove("drop"));
addEventListener("drop", e => {
  document.body.classList.remove("drop");
  const f = e.dataTransfer?.files?.[0];
  if (!f) return;
  e.preventDefault(); loadFile(f); openMenu();
});
for (const b of document.querySelectorAll(".side")){
  b.addEventListener("click", () => {
    side = b.dataset.side;
    document.querySelectorAll(".side").forEach(x => x.classList.toggle("on", x === b));
    if (map){ scene.remove(extras); buildExtras(); respawn(); }
  });
}
$("targets").addEventListener("change", () => { if (map){ scene.remove(extras); buildExtras(); } });
$("play").addEventListener("click", () => { if (map) canvas.requestPointerLock?.(); });
$("editorLink").href = location.pathname.includes("/zastava-sim") ? "../zastava-maps/" : "../editor/";

// Карта из редактора: кнопка «Пробежать» кладёт её в хранилище браузера.
function editorMap(){
  try { return JSON.parse(localStorage.getItem("zastava.simMap") || "null"); } catch { return null; }
}
if (editorMap()){
  $("fromEditor").hidden = false;
  $("fromEditor").addEventListener("click", () => {
    try { useMap(parseText(JSON.stringify(editorMap())), "из редактора"); }
    catch (e){ $("loaded").textContent = "Карта из редактора не открылась: " + e.message; }
  });
  const q = new URLSearchParams(location.search);
  if (q.get("from") === "editor") $("fromEditor").click();
  // Режим теста карты: симулятор открыт внутри редактора (в рамке), и меню
  // тут только мешает — человек уже выбрал карту, нажав «Тест карты».
  // Поэтому сразу прячем меню и предлагаем щёлкнуть, чтобы взять мышь.
  if (q.get("test") === "1"){
    $("menu").classList.add("hidden");
    $("keys").textContent = "Щёлкни, чтобы взять мышь · " + $("keys").textContent;
    canvas.addEventListener("click", () => canvas.requestPointerLock?.(), { once: false });
  }
}

function openMenu(){ $("menu").classList.remove("hidden"); }
document.addEventListener("pointerlockchange", () => {
  const locked = document.pointerLockElement === canvas;
  $("menu").classList.toggle("hidden", locked);
  if (!locked) for (const k in keys) keys[k] = false;
});

// ---- управление ---------------------------------------------------------------

document.addEventListener("mousemove", e => {
  if (document.pointerLockElement !== canvas) return;
  look.yaw -= e.movementX * 0.0022;
  look.pitch = Math.max(-1.55, Math.min(1.55, look.pitch - e.movementY * 0.0022));
});
addEventListener("keydown", e => {
  if (document.pointerLockElement !== canvas) return;
  keys[e.code] = true;
  if (e.code === "KeyV"){ fly = !fly; self.vel.set(0, 0, 0); toast(fly ? "Полёт: сквозь стены, Space — вверх, C — вниз" : "Полёт выключен"); }
  if (e.code === "KeyR") respawn();
  if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
});
addEventListener("keyup", e => { keys[e.code] = false; });
canvas.addEventListener("mousedown", e => {
  if (document.pointerLockElement !== canvas || e.button !== 0 || !map) return;
  shoot();
});

function shoot(){
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const alive = targets.filter(t => t.alive);
  const hit = raycast(camera.position.clone(), dir, map.colliders, alive);
  if (hit?.target){
    hit.target.alive = false;
    hit.target.group.rotation.z = Math.PI / 2;
    hit.target.group.userData.y = hit.target.group.position.y;
    hit.target.group.position.y += 0.2;
    const left = targets.filter(t => t.alive).length;
    toast(left ? `Попал! Осталось: ${left}` : "Все мишени сбиты!");
  }
}

let toastT = null;
function toast(text){
  $("toast").textContent = text; $("toast").classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => $("toast").classList.remove("show"), 1400);
}

// ---- движение (как в игре: main.js stepSelf) ---------------------------------

function step(dt){
  const f = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  const s = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  const dir = new THREE.Vector3(s, 0, -f);
  if (dir.lengthSq() > 0) dir.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), look.yaw);

  if (fly){
    const up = (keys.Space ? 1 : 0) - (keys.KeyC ? 1 : 0);
    const sp = keys.ShiftLeft ? 30 : 14;
    self.pos.addScaledVector(dir, sp * dt);
    self.pos.y += up * sp * dt;
    return;
  }

  const grounded = onGround(self, map.colliders);
  const crouching = !!keys.KeyC || !!keys.ControlLeft;
  const pressed = crouching && !move.crouchWas;
  move.crouchWas = crouching;
  move.slideCd = Math.max(0, move.slideCd - dt);
  const flat = Math.hypot(self.vel.x, self.vel.z);
  const sprint = !!keys.ShiftLeft && f > 0 && !crouching;

  if (pressed && grounded && move.slideT <= 0 && move.slideCd <= 0 && flat > PLAYER.speed * 1.05){
    move.slideT = MOVE.slideTime;
    const v = Math.max(flat * MOVE.slideBoost, MOVE.slideMin);
    self.vel.x = self.vel.x / flat * v; self.vel.z = self.vel.z / flat * v;
  }
  if (move.slideT > 0){
    move.slideT -= dt;
    self.height += (PLAYER.crouchHeight - self.height) * Math.min(1, dt * 16);
    self.vel.x += dir.x * dt * 4; self.vel.z += dir.z * dt * 4;
    const drag = Math.max(0, 1 - dt * MOVE.slideDrag);
    self.vel.x *= drag; self.vel.z *= drag;
    if (keys.Space && grounded){ self.vel.y = PLAYER.jump; move.slideT = 0; }
    if (!crouching || Math.hypot(self.vel.x, self.vel.z) < PLAYER.crouchSpeed + 0.6) move.slideT = 0;
    if (move.slideT <= 0) move.slideCd = MOVE.slideCooldown;
  } else {
    self.height += ((crouching ? PLAYER.crouchHeight : PLAYER.height) - self.height) * Math.min(1, dt * 12);
    const max = crouching ? PLAYER.crouchSpeed : sprint ? PLAYER.sprint : PLAYER.speed;
    const control = grounded ? 1 : PLAYER.airControl;
    const k = Math.min(1, dt * 52 * control * control / 6);
    if (grounded || flat <= max || dir.lengthSq() === 0){
      self.vel.x += (dir.x * max - self.vel.x) * k;
      self.vel.z += (dir.z * max - self.vel.z) * k;
    } else {
      self.vel.x += (dir.x * flat - self.vel.x) * k * 0.6;
      self.vel.z += (dir.z * flat - self.vel.z) * k * 0.6;
    }
    if (grounded && dir.lengthSq() === 0){ const fr = Math.max(0, 1 - dt * 12); self.vel.x *= fr; self.vel.z *= fr; }
    if (keys.Space && grounded && !crouching) self.vel.y = PLAYER.jump;
  }
  self.vel.y -= PLAYER.gravity * dt;
  movePlayer(self, self.vel.clone().multiplyScalar(dt), map.colliders);
  if (self.fell){ self.fell = false; toast("Упал с карты — заново"); respawn(); }
  $("mode").textContent = move.slideT > 0 ? "Подкат" : crouching ? "Присед" : sprint ? "Бег (Shift)" : "Шаг";
}

// ---- секундомер -------------------------------------------------------------

function stepTimer(now){
  if (fly || !map) return;
  const moving = Math.hypot(self.vel.x, self.vel.z) > 0.5;
  if (!run.moving && moving){ run.moving = true; run.start = now; }
  if (!run.moving) return;
  const t = (now - run.start) / 1000;
  $("timerMain").textContent = t.toFixed(1) + " с";
  map.sites.forEach((s, i) => {
    const key = i ? "B" : "A";
    if (run.reached[key]) return;
    if (Math.hypot(self.pos.x - s[0], self.pos.z - s[2]) <= SITE_R && Math.abs(self.pos.y - s[1]) < 3.5){
      run.reached[key] = t;
      const was = best[side][key];
      if (!was || t < was) best[side][key] = t;
      toast(`${side === "a" ? "Террористы" : "Спецназ"}: до точки ${key} — ${t.toFixed(1)} с`);
      showTimes();
    }
  });
  const got = Object.entries(run.reached).map(([k, v]) => `${k}: ${v.toFixed(1)} с`).join(" · ");
  $("timerSub").textContent = got || "беги к точке A или B · R — начать заново";
}

function showTimes(){
  for (const s of ["a", "b"]) for (const k of ["A", "B"]){
    const el = $(`t${s === "a" ? "A" : "B"}_${k.toLowerCase()}`);
    el.textContent = best[s][k] ? best[s][k].toFixed(1) + " с" : "—";
  }
}

// ---- кадр ---------------------------------------------------------------------

let last = performance.now();
function frame(now){
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (map){
    if (document.pointerLockElement === canvas) step(dt);
    stepTimer(now);
    const eye = self.pos.y + (fly ? PLAYER.eye : self.height - PLAYER.height + PLAYER.eye);
    camera.position.set(self.pos.x, eye, self.pos.z);
    camera.rotation.set(look.pitch, look.yaw, move.slideT > 0 ? 0.07 : 0, "YXZ");
    const want = 75 + (move.slideT > 0 ? 10 : keys.ShiftLeft && keys.KeyW ? 5 : 0);
    if (Math.abs(camera.fov - want) > 0.1){ camera.fov += (want - camera.fov) * Math.min(1, dt * 6); camera.updateProjectionMatrix(); }
    $("speed").textContent = Math.hypot(self.vel.x, self.vel.z).toFixed(1) + " м/с";
    $("pos").textContent = `x ${self.pos.x.toFixed(1)} · z ${self.pos.z.toFixed(1)} · высота ${self.pos.y.toFixed(1)} м${fly ? " · полёт" : ""}`;
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// по умолчанию — Арена, чтобы сразу было что посмотреть
if (!new URLSearchParams(location.search).get("from")) loadOfficial("arena").then(() => { $("official").value = "arena"; });

window.__sim = { get map(){ return map; }, self, best, respawn, keys };
