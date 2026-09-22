// lobby.js — экран между входом и боем: кто ты, во что играем, с кем.

import { isConfigured, hasRealtimeDb } from "./firebase.js";
import { resolvePlayer, forgetPlayer, signInWithGoogle, goToMyPeal } from "./mypeal-auth.js";
import {
  ensurePlayer, buyWeapon, buyGear, setLoadout, setNick, findPlayers, displayName, NICK_MAX,
  suggestPlayers, listPlayers
} from "./profile.js";
import * as friends from "./friends.js";
import { MAP_LIST } from "./game/maps/index.js";
import {
  WEAPONS, WEAPON_ORDER, LOADOUT_SLOTS, KNIVES, KNIFE_ORDER, gunsFor, equippedKnife, equipKnife, itemById
} from "./game/weapons.js";
import { GRENADES, GRENADE_ORDER } from "./game/grenades.js";
import { MODES, MODE_ORDER, SIDES, SIDE_ORDER, isTeamMode, modeName, modeShort } from "./game/modes.js";
import { MAX_PLAYERS, MYPEAL_ORIGIN } from "./config.js";
import { wakeSound, playPurchase, playClick, playDenied, getVolume, setVolume } from "./game/sound.js";
import { SKINS, skinById, levelOf, xpForLevel, readSkins, saveSkin, skinFor } from "./game/skins.js";
import { AGENTS, agentById, equippedAgent, equipAgent, agentSwatch } from "./game/agents.js";
import {
  readSettings, saveSettings, applyCrosshair, LIMITS, CROSS_STYLES, CROSS_COLORS,
  ACTIONS, bindsOf, bindKey, resetBinds, keyLabel
} from "./game/settings.js";
import * as net from "./net/live.js";
import { registerServiceWorker, wireInstallButton, isInstalled, canInstall, promptInstall, isIOS } from "./pwa.js";
import { readMapFile } from "./game/maps/editorfile.js";
import * as access from "./net/access.js";

const $ = id => document.getElementById(id);

let me = null;
let chosenMap = "karier";
let chosenMode = "dm";
// Сколько человек пускать. Двое — это «позвал друга», шестнадцать — свалка;
// MAX_PLAYERS из config.js остаётся значением по умолчанию.
const SIZES = [2, 4, 6, 8, 12, 16];
let chosenSize = SIZES.includes(MAX_PLAYERS) ? MAX_PLAYERS : 4;
// По умолчанию комната — по коду: зовёшь своих, а не весь интернет.
let chosenPrivate = true;
const SHOW_CUSTOM_MAP = false;  // кнопка «Своя карта» в окне «Новая комната» — выключена
let customMap = null;        // своя карта из файла: { data, name } — только в приложении
// Сторона: пусто — «как получится», иначе «a» или «b». Выбор есть только в
// командных режимах, в свалке сторон не бывает.
let chosenSide = "";

// Друзья и присутствие живут подписками: и то и другое меняется само собой,
// пока человек смотрит на лобби.
let friendIds = [];
let friendCards = new Map();
let presence = [];
let requests = [];
let stopAnnounce = null;
// Ствол, открытый на витрине «Оружие» (и чьи скины показаны в инвентаре).
let pickedWeapon = "rifle";
let preview = null;          // GunPreview — грузится при первом заходе на вкладку
let agent = null;            // AgentPreview — боец на главном экране
let resolvedLogin = null;    // как вошёл: { method, email }
let admin = false;           // администратор игры (вкладка «Консоль»)
let myAccess = { ok: true }; // блокировка / выключенные серверы (см. net/access.js)
let allRooms = [];           // все комнаты, включая закрытые (для консоли: rooms)

registerServiceWorker();
wireInstallButton(document.getElementById("installBtn"));

boot().catch(error => say(error.message));

async function boot(){
  if (!isConfigured){ say("Ключи Firebase не вписаны — смотри js/config.js."); return; }

  const resolved = await resolvePlayer();
  if (!resolved.uid){ location.href = "index.html"; return; }

  const profile = await ensurePlayer(resolved.uid, resolved.fresh || {});
  me = { ...resolved, ...profile };
  resolvedLogin = { method: resolved.method, email: resolved.email };
  pickedWeapon = me.loadout?.[0] || "rifle";

  $("who").textContent = displayName(profile);
  $("tag").textContent = profile.tag ? "@" + profile.tag : "";
  $("nickInput").value = displayName(profile);
  $("sPoints").textContent = profile.points ?? 0;
  $("sKills").textContent  = profile.kills ?? 0;
  $("sMatches").textContent = profile.matches ?? 0;
  $("sRatio").textContent = ratio(profile.kills, profile.deaths);

  admin = await access.isAdminPlayer(me.uid);
  document.querySelector('.tab[data-tab="console"]').hidden = !admin;
  access.watchAccess(me.uid, state => {
    myAccess = state;
    // Плашка — только при блокировке «с плашкой». Тихая блокировка и
    // выключенные серверы ничем себя не выдают до попытки войти.
    $("banFlash").hidden = !(state.banned && !state.silent);
    $("banReason").textContent = state.banned && state.reason ? "Причина: " + state.reason : "";
  }, { admin });

  wireTabs();
  if (admin) wireConsole();
  renderLevel();
  renderAccount();
  renderSettings();
  renderMaps();
  renderModes();
  renderSizes();
  renderArmory();
  wire();

  if (!hasRealtimeDb){
    $("rtdbNote").classList.add("show");
    $("createBtn").disabled = true;
    $("joinBtn").disabled = true;
    return;
  }

  net.watchRooms(rooms => { allRooms = rooms; renderRooms(rooms); });

  // Объявляем о себе: «в лобби». Без комнаты — значит, свободен и его можно
  // позвать; друзья увидят это у себя в списке.
  stopAnnounce = await net.announce(me.sessionUid, {
    uid: me.uid, nick: displayName(me), tag: me.tag || null, room: null
  });
  addEventListener("pagehide", () => stopAnnounce?.());

  net.watchPresence(rows => { presence = rows; renderFriends(); renderMainServer(); });
  friends.watchFriends(me.uid, async ids => {
    friendIds = ids;
    friendCards = await friends.loadCards(ids);
    renderFriends();
  });
  friends.watchRequests(me.uid, rows => { requests = rows; renderRequests(); });
}

const ratio = (k = 0, d = 0) => (d === 0 ? (k || 0).toFixed(2) : (k / d).toFixed(2));

function say(text, kind = "err"){
  const note = $("note");
  note.textContent = text;
  note.className = "note show " + kind;
}

// ---------------------------------------------------------------------------
// Выбор карты и режима
// ---------------------------------------------------------------------------

function renderMaps(){
  $("maps").innerHTML = "";
  for (const meta of MAP_LIST){
    const card = document.createElement("button");
    card.type = "button";
    card.className = "map-card" + (meta.id === chosenMap ? " on" : "");
    card.dataset.map = meta.id;
    card.innerHTML = `
      <span class="map-art ${meta.id}"></span>
      <b>${meta.name}</b>
      <i>${meta.subtitle}</i>`;
    card.onclick = () => {
      chosenMap = meta.id;
      renderMaps();
    };
    $("maps").append(card);
  }
  // «Своя карта» — последней. На сайте зовёт скачать приложение, в
  // приложении открывает место, куда перетащить файл карты.
  // Пока выключена (SHOW_CUSTOM_MAP) — кнопки в окне нет.
  if (!SHOW_CUSTOM_MAP){ $("customDrop").hidden = true; return; }
  const own = document.createElement("button");
  own.type = "button";
  own.className = "map-card custom" + (chosenMap === "custom" ? " on" : "");
  own.dataset.map = "custom";
  own.innerHTML = `
    <span class="map-art custom"></span>
    <b>${customMap ? escape(customMap.name) : "Своя карта"}${isInstalled() ? "" : '<em class="app-tag">приложение</em>'}</b>
    <i>${customMap ? "из твоего файла · считает твой ПК" : "загрузить карту из редактора"}</i>`;
  own.onclick = () => {
    if (!isInstalled()){ openAppModal(); return; }
    chosenMap = "custom";
    $("customDrop").hidden = false;
    renderMaps();
    if (!customMap) $("customFile").click();
  };
  $("maps").append(own);
  if (chosenMap !== "custom") $("customDrop").hidden = true;
}

function openAppModal(){
  const m = $("appModal");
  m.hidden = false;
  playClick();
  $("appNote").textContent = isIOS()
    ? "На iPhone и iPad: «Поделиться» → «На экран „Домой“». Своя карта удобнее всего на компьютере."
    : canInstall() ? "" : "Если кнопка не сработала: в Chrome или Edge открой меню ⋮ → «Установить приложение „Застава“».";
}

/** Файл карты: прочитать, проверить, показать, что получилось. */
async function loadCustomFile(file){
  const zone = $("customZone");
  zone.classList.remove("ok", "bad");
  if (!file) return;
  if (file.size > 2_000_000){ showCustom(false, "Файл слишком большой для карты."); return; }
  const res = readMapFile(await file.text());
  if (!res.ok){ customMap = null; showCustom(false, res.error); renderMaps(); return; }
  customMap = { data: res.data, name: res.name };
  chosenMap = "custom";
  const n = res.data.boxes.length + res.data.ramps.length;
  showCustom(true, `«${res.name}» — ${res.data.size[0]}×${res.data.size[1]} м, блоков: ${n}`);
  renderMaps();
}
function showCustom(ok, text){
  const zone = $("customZone");
  zone.classList.toggle("ok", ok); zone.classList.toggle("bad", !ok);
  $("customTitle").textContent = ok ? "Карта загружена ✓" : "Не получилось";
  $("customSub").innerHTML = escape(text) + ' · <button class="link" id="customPick2" type="button">другой файл</button>';
  $("customPick2").onclick = () => $("customFile").click();
}

function renderSizes(){
  const box = $("sizes");
  box.innerHTML = "";
  for (const n of SIZES){
    const button = document.createElement("button");
    button.type = "button";
    button.className = "size" + (n === chosenSize ? " on" : "");
    button.textContent = n;
    button.onclick = () => { chosenSize = n; playClick(); renderSizes(); };
    box.append(button);
  }
}

/** Режимы и выбор стороны — оба списка рисуются из modes.js, а не из вёрстки. */
function renderModes(){
  const box = $("modes");
  box.innerHTML = "";
  for (const id of MODE_ORDER){
    const mode = MODES[id];
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mode" + (id === chosenMode ? " on" : "");
    button.dataset.mode = id;
    button.innerHTML = `<b>${mode.name}</b><i>${mode.hint}</i>`;
    button.onclick = () => { chosenMode = id; playClick(); renderModes(); renderSides(); };
    box.append(button);
  }
  renderSides();
}

function renderSides(){
  const wrap = $("sidePick");
  wrap.hidden = !isTeamMode(chosenMode);
  if (wrap.hidden){ chosenSide = ""; return; }

  const box = $("sides");
  box.innerHTML = "";
  const options = [{ id: "", name: "Как получится", hint: "стороны наберутся поровну" },
    ...SIDE_ORDER.map(id => ({ id, name: SIDES[id].name, hint: SIDES[id].goal }))];

  for (const option of options){
    const button = document.createElement("button");
    button.type = "button";
    button.className = "side" + (option.id === chosenSide ? " on" : "") +
      (option.id ? " side-" + option.id : "");
    button.dataset.side = option.id || "auto";
    button.innerHTML = `<b>${option.name}</b><i>${option.hint}</i>`;
    button.onclick = () => { chosenSide = option.id; playClick(); renderSides(); };
    box.append(button);
  }
}

function wire(){
  $("mainServerBtn").onclick = enterMainServer;
  // Имя: просмотр → «Изменить» → форма с счётчиком → «Сохранить» / «Отмена».
  const openName = on => {
    $("nameForm").hidden = !on;
    $("nameView").hidden = on;
    if (on){ $("nickInput").value = displayName(me); countNick(); $("nickInput").focus(); $("nickInput").select(); }
  };
  $("nameEditBtn").onclick = () => { playClick(); openName(true); };
  $("nameCancelBtn").onclick = () => openName(false);
  $("nickInput").addEventListener("input", countNick);
  $("nameForm").onsubmit = async e => {
    e.preventDefault();
    if (await changeNick()) openName(false);
  };
  $("resetLocalBtn").onclick = () => {
    if (!confirmTwice($("resetLocalBtn"), "Точно сбросить?")) return;
    for (const key of ["zastava.settings", "zastava.skins", "zastava.knife", "zastava.graphics", "zastava.tab"]){
      try { localStorage.removeItem(key); } catch { /* ignore */ }
    }
    location.reload();
  };
  $("findBtn").onclick = searchPeople;
  $("findInput").addEventListener("keydown", e => {
    if (e.key === "Enter"){ hideSuggest(); searchPeople(); }
    if (e.key === "Escape") hideSuggest();
  });
  // Подсказки по мере набора: «@vo» → все теги, начинающиеся с «vo».
  $("findInput").addEventListener("input", () => {
    clearTimeout(suggestTimer);
    suggestTimer = setTimeout(showSuggest, 250);
  });
  $("findInput").addEventListener("blur", () => setTimeout(hideSuggest, 200));

  // Окно «Новая комната»: карта, режим, кто может зайти.
  const modal = $("createModal");
  const openModal = on => { modal.hidden = !on; if (on) playClick(); };
  $("openCreate").onclick = () => openModal(true);
  $("closeCreate").onclick = () => openModal(false);
  $("cancelCreate").onclick = () => openModal(false);
  modal.addEventListener("click", e => { if (e.target === modal) openModal(false); });
  addEventListener("keydown", e => { if (e.key === "Escape" && !modal.hidden) openModal(false); });
  for (const opt of $("access").querySelectorAll(".access-opt")){
    opt.onclick = () => {
      chosenPrivate = opt.dataset.priv === "1";
      for (const o of $("access").querySelectorAll(".access-opt")) o.classList.toggle("on", o === opt);
      playClick();
    };
  }

  // Своя карта: окно «скачай приложение» и приём файла.
  $("closeApp").onclick = () => { $("appModal").hidden = true; };
  $("appModal").addEventListener("click", e => { if (e.target === $("appModal")) $("appModal").hidden = true; });
  $("appInstall").onclick = async () => {
    const r = await promptInstall();
    if (r === "unavailable") location.href = "install.html";
    else if (r === "accepted") $("appNote").textContent = "Готово! Открой «Заставу» из установленного приложения.";
  };
  $("customPick").onclick = () => $("customFile").click();
  $("customFile").addEventListener("change", () => { loadCustomFile($("customFile").files[0]); $("customFile").value = ""; });
  const zone = $("customZone");
  zone.addEventListener("dragover", e => { e.preventDefault(); zone.classList.add("over"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("over"));
  zone.addEventListener("drop", e => { e.preventDefault(); zone.classList.remove("over"); loadCustomFile(e.dataTransfer.files[0]); });
  // Файл можно бросить в любое место окна «Новая комната».
  modal.addEventListener("dragover", e => { if (SHOW_CUSTOM_MAP && isInstalled()) e.preventDefault(); });
  modal.addEventListener("drop", e => {
    if (!SHOW_CUSTOM_MAP || !isInstalled() || !e.dataTransfer?.files?.length) return;
    e.preventDefault();
    $("customDrop").hidden = false;
    loadCustomFile(e.dataTransfer.files[0]);
  });

  $("createBtn").onclick = createRoom;
  $("joinBtn").onclick = joinByCode;
  $("outBtn").onclick = async () => {
    if (!confirmTwice($("outBtn"), "Нажми ещё раз — выйти")) return;
    await forgetPlayer(me.sessionUid);
    location.href = "index.html";
  };
  $("mypealBtn").onclick = () => open(MYPEAL_ORIGIN, "_blank", "noopener");
  $("googleSwitchBtn").onclick = async () => {
    try {
      const user = await signInWithGoogle();
      if (user) location.reload();
    } catch (error){ say(error.message); }
  };
  $("linkMyPealBtn").onclick = () => goToMyPeal();
  // Звук браузер разрешает только после действия человека, поэтому будим его
  // на первом же клике по странице — к матчу он уже готов.
  document.addEventListener("pointerdown", wakeSound, { once: true });
  $("codeInput").addEventListener("keydown", e => { if (e.key === "Enter") joinByCode(); });
}

// ---------------------------------------------------------------------------
// Оружейная
// ---------------------------------------------------------------------------

function shopSay(text, kind = "err"){
  const note = $("shopNote");
  note.textContent = text;
  note.className = "note show " + kind;
  clearTimeout(shopSay._timer);
  shopSay._timer = setTimeout(() => { note.className = "note"; }, 4000);
}

function renderArmory(){
  const box = $("weapons");
  box.innerHTML = "";
  $("sCoins").textContent = me.coins ?? 0;
  $("railCoins").textContent = me.coins ?? 0;

  for (const id of WEAPON_ORDER){
    const w = WEAPONS[id];
    const owned = me.owned.includes(id) || id === "rifle";
    // Теперь в бою все купленные стволы — у каждого своя цифра. Первый —
    // основной: с ним возрождаешься.
    const guns = gunsFor(me.loadout, me.owned);
    const slot = guns.indexOf(id) + 1;
    const inUse = owned;

    const card = document.createElement("div");
    card.className = "weapon" + (owned ? " owned" : "") + (inUse ? " on" : "") +
      (id === pickedWeapon ? " picked" : "");
    // Нажатие на карточку — показать ствол на витрине; кнопки внутри делают
    // своё и витрину не трогают.
    card.onclick = e => {
      if (e.target.closest("button")) return;
      pickedWeapon = id;
      playClick();
      renderArmory();
    };
    card.innerHTML = `
      <div class="weapon-head">
        <b>${w.name}</b>
        ${owned ? `<span class="slot">${slot === 1 ? "основной · 1" : "клавиша " + slot}</span>` : ""}
      </div>
      <i>${w.about}</i>
      <div class="bars">
        ${bar("урон", w.damage * w.pellets, 110)}
        ${bar("темп", w.rpm, 950)}
        ${bar("точность", 1 / (w.spread + 0.004), 220)}
        ${bar("запас", w.magazine, 100)}
      </div>
      <div class="weapon-foot"></div>`;

    const foot = card.querySelector(".weapon-foot");
    if (!owned){
      const price = document.createElement("span");
      price.className = "price";
      price.textContent = w.price + " монет";
      const buy = document.createElement("button");
      buy.type = "button";
      buy.className = "btn btn-ghost";
      buy.textContent = "Купить";
      buy.disabled = (me.coins ?? 0) < w.price;
      buy.onclick = () => purchase(id);
      foot.append(price, buy);
    } else {
      const state = document.createElement("span");
      state.className = "price owned-mark";
      state.textContent = slot === 1 ? "с ним возрождаешься" : `в бою на ${slot}`;
      foot.append(state);
      if (slot !== 1){
        const pick = document.createElement("button");
        pick.type = "button";
        pick.className = "btn btn-ghost";
        pick.textContent = "Сделать основным";
        pick.onclick = () => makePrimary(id);
        foot.append(pick);
      }
    }
    box.append(card);
  }

  renderGear();
  renderKnives();
  renderShowcase();
  renderInventory();
  if (agent) renderHero(); else renderAgents();
}

/** Ножи: купить и выбрать, какой носить. Бьют все одинаково — платят за вид. */
function renderKnives(){
  const box = $("knives");
  if (!box) return;
  box.innerHTML = "";
  const worn = equippedKnife(me.owned);
  for (const id of KNIFE_ORDER){
    const k = KNIVES[id];
    const has = id === "knife" || me.owned.includes(id);
    const card = document.createElement("div");
    card.className = "weapon" + (has ? " owned" : "") + (id === worn ? " on" : "") + (id === pickedWeapon ? " picked" : "");
    card.onclick = e => { if (e.target.closest("button")) return; pickedWeapon = id; playClick(); renderArmory(); };
    card.innerHTML = `
      <div class="weapon-head"><b>${k.name}</b>${id === worn ? `<span class="slot">в руке</span>` : ""}</div>
      <i>${k.about}</i>
      <div class="weapon-foot"></div>`;
    const foot = card.querySelector(".weapon-foot");
    if (!has){
      const price = document.createElement("span");
      price.className = "price";
      price.textContent = k.price + " монет";
      const buy = document.createElement("button");
      buy.type = "button"; buy.className = "btn btn-ghost"; buy.textContent = "Купить";
      buy.disabled = (me.coins ?? 0) < k.price;
      buy.onclick = () => purchase(id);
      foot.append(price, buy);
    } else {
      const state = document.createElement("span");
      state.className = "price owned-mark";
      state.textContent = id === worn ? "носишь его" : "куплен";
      foot.append(state);
      if (id !== worn){
        const wear = document.createElement("button");
        wear.type = "button"; wear.className = "btn btn-ghost"; wear.textContent = "Носить";
        wear.onclick = () => { equipKnife(id); playClick(); shopSay(`Теперь в руке ${k.name.toLowerCase()}.`, "ok"); renderArmory(); };
        foot.append(wear);
      }
    }
    box.append(card);
  }
}

/** Основной ствол — первый в наборе: с ним возрождаешься, он на клавише 1. */
async function makePrimary(id){
  const next = [id, ...me.loadout.filter(x => x !== id)].slice(0, LOADOUT_SLOTS);
  try {
    const result = await setLoadout(me.uid, me, next);
    if (!result.ok){ playDenied(); return shopSay(result.reason); }
    me = { ...me, ...result.player };
    playClick();
    shopSay(`${WEAPONS[id].name} теперь основной — на клавише 1.`, "ok");
    renderArmory();
  } catch (error){
    playDenied();
    shopSay("Не получилось сохранить: " + error.message);
  }
}

/** Гранаты. Купил один раз — выдаются каждую жизнь, слотов не занимают. */
function renderGear(){
  const box = $("gear");
  box.innerHTML = "";

  for (const id of GRENADE_ORDER){
    const item = GRENADES[id];
    const has = me.owned.includes(id);

    const card = document.createElement("div");
    card.className = "weapon" + (has ? " owned" : "");
    card.dataset.gear = id;
    card.innerHTML = `
      <div class="weapon-head"><b>${item.name}</b></div>
      <i>${item.about}</i>
      <div class="weapon-foot"></div>`;

    const foot = card.querySelector(".weapon-foot");
    if (has){
      const state = document.createElement("span");
      state.className = "price owned-mark";
      state.textContent = "по одной за жизнь";
      foot.append(state);
    } else {
      const price = document.createElement("span");
      price.className = "price";
      price.textContent = item.price + " монет";
      const buy = document.createElement("button");
      buy.type = "button";
      buy.className = "btn btn-ghost";
      buy.textContent = "Купить";
      buy.disabled = (me.coins ?? 0) < item.price;
      buy.onclick = () => purchaseGear(id);
      foot.append(price, buy);
    }
    box.append(card);
  }
}

async function purchaseGear(id){
  try {
    const result = await buyGear(me.uid, me, id);
    if (!result.ok){ playDenied(); return shopSay(result.reason); }
    me = { ...me, ...result.player };
    playPurchase();
    shopSay(`${GRENADES[id].name} куплена. Выдаётся каждую жизнь.`, "ok");
    renderArmory();
  } catch (error){
    playDenied();
    shopSay("Не получилось купить: " + error.message);
  }
}

/** Полоска характеристики. Чисто на глаз: точные числа тут никому не нужны. */
function bar(label, value, max){
  const pct = Math.max(4, Math.min(100, Math.round(value / max * 100)));
  return `<div class="bar"><span>${label}</span><u><i style="width:${pct}%"></i></u></div>`;
}

async function purchase(id){
  const w = itemById(id);
  try {
    const result = await buyWeapon(me.uid, me, id);
    if (!result.ok){ playDenied(); return shopSay(result.reason); }
    me = { ...me, ...result.player };
    playPurchase();
    shopSay(KNIVES[id]
      ? `${w.name} куплен. Нажми «Носить», чтобы взять его в бой.`
      : `${w.name} куплен и уже в бою — на своей цифре. Переключение: 1, 2, 3…`, "ok");
    renderArmory();
  } catch (error){
    playDenied();
    shopSay("Не получилось купить: " + error.message);
  }
}



// ---------------------------------------------------------------------------
// Позывной
// ---------------------------------------------------------------------------

function nickSay(text, kind = "err"){
  const note = $("nickNote");
  note.textContent = text;
  note.className = "note show " + kind;
  clearTimeout(nickSay._timer);
  nickSay._timer = setTimeout(() => { note.className = "note"; }, 4000);
}

async function changeNick(){
  const wanted = $("nickInput").value;
  $("nickBtn").disabled = true;
  let done = false;
  try {
    const result = await setNick(me.uid, me, wanted);
    if (!result.ok){ playDenied(); return nickSay(result.reason); }
    me = { ...me, ...result.player };
    $("who").textContent = displayName(me);
    $("nickInput").value = displayName(me);
    // Присутствие пишется отдельно от карточки: список друзей должен показать
    // новый позывной сразу, а не когда человек в следующий раз зайдёт.
    net.updateAnnounce(me.sessionUid, { nick: displayName(me) });
    playClick();
    nickSay("Теперь ты " + displayName(me) + ".", "ok");
    renderAccount();
    done = true;
    renderFriends();
  } catch (error){
    playDenied();
    nickSay("Не получилось сменить: " + error.message);
  } finally {
    $("nickBtn").disabled = false;
  }
  return done;
}

function countNick(){
  const n = $("nickInput").value.trim().length;
  $("nickCount").textContent = `${n} / ${NICK_MAX}`;
  $("nickCount").parentElement.classList.toggle("bad", n < 2 || n > NICK_MAX);
}

/**
 * Опасная кнопка срабатывает со второго нажатия: первое меняет надпись и
 * ждёт три секунды. Системное окно confirm() в игре выглядит чужеродно и на
 * телефоне пугает сильнее, чем надо.
 */
function confirmTwice(button, text){
  if (button.dataset.armed){ delete button.dataset.armed; return true; }
  const was = button.textContent;
  button.dataset.armed = "1";
  button.textContent = text;
  setTimeout(() => { delete button.dataset.armed; button.textContent = was; }, 3000);
  return false;
}

// ---------------------------------------------------------------------------
// Друзья
// ---------------------------------------------------------------------------

function friendSay(text, kind = "err"){
  const note = $("friendNote");
  note.textContent = text;
  note.className = "note show " + kind;
  clearTimeout(friendSay._timer);
  friendSay._timer = setTimeout(() => { note.className = "note"; }, 5000);
}

/** Где человек сейчас — по записям присутствия, самой свежей из его вкладок. */
function whereIs(uid){
  let best = null;
  for (const row of presence){
    if (row.uid !== uid) continue;
    if (!best || (row.at || 0) > (best.at || 0)) best = row;
  }
  return best;
}

function mapName(id, room){
  if (id === "custom") return room?.customName || "Своя карта";
  return MAP_LIST.find(m => m.id === id)?.name || id || "";
}

async function searchPeople(){
  const text = $("findInput").value;
  if (String(text).trim().replace(/^@/, "").length < 2){
    return friendSay("Введи хотя бы два символа — тег @ или ник целиком.");
  }
  $("findBtn").disabled = true;
  $("findResult").innerHTML = `<p class="empty">Ищем…</p>`;
  try {
    const found = (await findPlayers(text)).filter(p => p.uid !== me.uid);
    if (!found.length){
      $("findResult").innerHTML =
        `<p class="empty">Никого. Ник и тег ищутся целиком, не по кусочку.</p>`;
      return;
    }
    $("findResult").innerHTML = "";
    for (const person of found) $("findResult").append(personRow(person, "find"));
  } catch (error){
    friendSay("Поиск не получился: " + error.message);
    $("findResult").innerHTML = "";
  } finally {
    $("findBtn").disabled = false;
  }
}

/**
 * Строчка человека. Одна и та же для находки, заявки и друга — меняется только
 * набор кнопок справа: так список читается как один список, а не три разных.
 */
function personRow(person, kind){
  const row = document.createElement("div");
  row.className = "person";

  const at = whereIs(person.uid);
  const online = !!at;
  const place = !at ? "не в игре"
    : at.room ? `${mapName(at.map)} · ${modeShort(at.mode)}`
    : "в лобби";

  row.innerHTML = `
    <span class="dot${online ? " on" : ""}"></span>
    <div class="person-who">
      <b>${escape(displayName(person))}</b>
      <i>${person.tag ? "@" + escape(person.tag) : ""}${person.tag && kind !== "find" ? " · " : ""}${kind === "find" ? "" : escape(place)}</i>
    </div>
    <div class="person-act"></div>`;

  const act = row.querySelector(".person-act");
  const button = (text, cls, onclick) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn btn-ghost tiny " + (cls || "");
    b.textContent = text;
    b.onclick = onclick;
    act.append(b);
    return b;
  };

  if (kind === "find"){
    if (friendIds.includes(person.uid)) act.innerHTML = `<span class="price owned-mark">уже друг</span>`;
    else button("Позвать", "", async () => {
      try {
        const result = await friends.invite({ ...me, nick: displayName(me) }, person);
        if (!result.ok) return friendSay(result.reason);
        playClick();
        friendSay(result.becameFriends
          ? `Вы уже звали друг друга — теперь друзья.`
          : `Позвал ${displayName(person)}. Ждём согласия.`, "ok");
        $("findResult").innerHTML = "";
        $("findInput").value = "";
      } catch (error){
        playDenied();
        friendSay("Не получилось позвать: " + error.message);
      }
    });
  }

  if (kind === "request"){
    button("Принять", "accept", async () => {
      await friends.accept(me, person.request).catch(() => {});
      playClick();
    });
    button("Отказать", "", async () => {
      await friends.dropRequest(me.uid, person.uid);
    });
  }

  if (kind === "friend"){
    // В открытую комнату — сразу. В закрытую — только с разрешения хозяина:
    // стучимся, хозяин видит просьбу в бою («друг такого-то просится») и решает.
    if (at?.room){
      const room = allRooms.find(r => r.id === at.room);
      if (room?.priv && room.hostSession !== me.sessionUid){
        button("Попроситься", "go", e => askToJoin(room, person, e.target));
      } else {
        button("Зайти", "go", () => enterRoom(at.room));
      }
    }
    button("Убрать", "", async () => {
      await friends.unfriend(me.uid, person.uid);
      playClick();
    });
  }

  return row;
}

function renderRequests(){
  const box = $("requests");
  $("requestsBox").hidden = requests.length === 0;
  // Заявки видно и со свёрнутой панели — красной цифрой на значке «Друзья».
  $("friendBadge").hidden = requests.length === 0;
  $("friendBadge").textContent = requests.length;
  box.innerHTML = "";
  for (const request of requests){
    box.append(personRow(
      { uid: request.from, nick: request.nick, tag: request.tag, request },
      "request"
    ));
  }
}

function renderFriends(){
  const box = $("friends");
  if (!friendIds.length){
    box.innerHTML = `<p class="empty">Друзей пока нет. Найди по тегу @ — он тот же, что в мессенджере.</p>`;
    return;
  }

  // Сначала те, кто в игре: список нужен, чтобы к кому-то пойти, а не чтобы
  // любоваться на список.
  const rows = friendIds
    .map(uid => friendCards.get(uid) || { uid, nick: "Боец" })
    .sort((a, b) => {
      const pa = whereIs(a.uid), pb = whereIs(b.uid);
      const wa = pa ? (pa.room ? 2 : 1) : 0;
      const wb = pb ? (pb.room ? 2 : 1) : 0;
      if (wa !== wb) return wb - wa;
      return displayName(a).localeCompare(displayName(b));
    });

  box.innerHTML = "";
  for (const person of rows) box.append(personRow(person, "friend"));
}

// ---------------------------------------------------------------------------
// Общий сервер
// ---------------------------------------------------------------------------

function renderMainServer(){
  const here = presence.filter(row => row.room === net.MAIN_ROOM).length;
  $("mainServerSeats").textContent = `${here} / ${net.MAIN.maxPlayers}`;
  $("mainServerLine").textContent =
    `Заминирование · террористы против спецназа `
    + `· каждые ${net.MAIN.mapsPerCycle} раундов новая карта`;
}

/**
 * Пускают ли на серверы. Заблокированному и при выключенных серверах —
 * пауза «подключаемся…» и сухое «не удалось подключиться»: ровно то, что
 * видит человек с плохой связью. Никаких объяснений — так задумано.
 */
async function mayConnect(){
  const state = await access.checkAccess(me.uid, { admin });
  if (state.ok) return true;
  say("Подключаемся к серверу…", "ok");
  await new Promise(r => setTimeout(r, 1600));
  playDenied();
  say(access.CONNECT_FAIL);
  return false;
}

async function enterMainServer(){
  $("mainServerBtn").disabled = true;
  if (!(await mayConnect())){ $("mainServerBtn").disabled = false; return; }
  try {
    await net.ensureMainRoom();
    location.href = gameLink(net.MAIN_ROOM);
  } catch (error){
    say("Не получилось зайти на общий: " + error.message);
    $("mainServerBtn").disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Комнаты
// ---------------------------------------------------------------------------

async function createRoom(){
  $("createBtn").disabled = true;
  if (!(await mayConnect())){ $("createBtn").disabled = false; return; }
  try {
    if (chosenMap === "custom" && !(isInstalled() && customMap)){
      $("createBtn").disabled = false;
      if (!isInstalled()) openAppModal();
      else say("Сначала перетащи файл своей карты.");
      return;
    }
    const { id, code } = await net.createRoom({
      custom: chosenMap === "custom" ? { ...customMap, bots: $("customBots").checked } : null,
      map: chosenMap,
      mode: chosenMode,
      hostUid: me.uid,
      hostSession: me.sessionUid,
      hostName: me.name,
      maxPlayers: chosenSize,
      priv: chosenPrivate
    });
    // Код закрытой комнаты нигде больше не показать — она не попадёт в список,
    // а человек уже уходит на страницу боя. Кладём его в адрес, чтобы игра
    // вывела его на табло, и запоминаем на случай, если человек вернётся.
    try { sessionStorage.setItem("zastava.lastCode", code); } catch { /* ignore */ }
    // Матч начинается сразу: ждать в пустой комнате скучнее, чем бегать по
    // карте одному в ожидании, пока подтянутся остальные.
    await net.setRoomState(id, net.ROOM_STATE.LIVE, { startedAt: Date.now() });
    location.href = gameLink(id);
  } catch (error){
    say("Не получилось создать комнату: " + error.message);
    $("createBtn").disabled = false;
  }
}

async function joinByCode(){
  const code = $("codeInput").value.trim().toUpperCase();
  if (code.length < 4) return say("Код комнаты — пять символов.");
  $("joinBtn").disabled = true;
  try {
    const id = await net.findRoomByCode(code);
    if (!id) return say("Комнаты с таким кодом нет. Может, она уже закрылась.");
    await enterRoom(id);
  } catch (error){
    say("Не получилось: " + error.message);
  } finally {
    $("joinBtn").disabled = false;
  }
}

/**
 * Вход в комнату с проверкой мест.
 *
 * Проверять здесь — не формальность: правила базы всё равно не дадут войти
 * лишнему, но отказ прилетел бы уже на странице боя, после загрузки карты, и
 * выглядел бы как поломка. Лучше сказать честно и сразу.
 */
async function enterRoom(id){
  if (!(await mayConnect())) return;
  const check = await net.roomCapacity(id);
  if (!check.ok){ playDenied(); return say(check.reason); }
  location.href = gameLink(id);
}

/** Адрес матча. Сторона едет в нём же — игра прочитает её при входе. */
function gameLink(id){
  return `game.html?room=${id}` + (chosenSide ? `&team=${chosenSide}` : "");
}

function renderRooms(rooms){
  const list = $("rooms");
  // Закрытые комнаты в списке не показываем — в этом и весь их смысл. Общий
  // сервер тоже: у него своя кнопка выше, и дублировать его строчкой в общем
  // списке значит показать одно и то же дважды.
  const open = rooms.filter(r =>
    r.state !== net.ROOM_STATE.OVER && !r.priv && r.id !== net.MAIN_ROOM);

  if (!open.length){
    list.innerHTML = `<p class="empty">Открытых комнат нет. Создай свою — код можно продиктовать или отправить ссылкой.</p>`;
    return;
  }

  list.innerHTML = "";
  for (const room of open){
    const card = document.createElement("div");
    card.className = "room";
    const mapName = room.map === "custom" ? (room.customName || "Своя карта") : (MAP_LIST.find(m => m.id === room.map)?.name || room.map);
    const max = room.maxPlayers || 4;
    const busy = (room.count || 0) >= max;
    card.innerHTML = `
      <div>
        <b>${escape(room.hostName || "Боец")}</b>
        <i>${mapName} · ${modeName(room.mode).toLowerCase()}</i>
      </div>
      <span class="seats${busy ? " full" : ""}">${room.count || 0}/${max}</span>
      <span class="code">${room.code}</span>
      <button class="btn btn-ghost" type="button"${busy ? " disabled" : ""}>${busy ? "Полно" : "Войти"}</button>`;
    card.querySelector("button").onclick = () => enterRoom(room.id);
    list.append(card);
  }
}

function escape(text){
  return String(text ?? "").replace(/[&<>"]/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}


// ---------------------------------------------------------------------------
// Вкладки слева
// ---------------------------------------------------------------------------

const TAB_KEY = "zastava.tab";
const TABS = ["play", "weapons", "inventory", "friends", "account", "settings", "console"];

function wireTabs(){
  for (const tab of document.querySelectorAll(".tab")){
    tab.onclick = () => { playClick(); openTab(tab.dataset.tab); tab.blur(); };
  }
  let first = location.hash.slice(1);
  if (!TABS.includes(first)){
    try { first = localStorage.getItem(TAB_KEY) || "play"; } catch { first = "play"; }
  }
  if (first === "console" && !admin) first = "play";
  openTab(TABS.includes(first) ? first : "play", false);
  addEventListener("hashchange", () => {
    const id = location.hash.slice(1);
    if (TABS.includes(id) && (id !== "console" || admin)) openTab(id, false);
  });
}

function openTab(id, remember = true){
  for (const tab of document.querySelectorAll(".tab")) tab.classList.toggle("on", tab.dataset.tab === id);
  for (const view of document.querySelectorAll(".view")) view.classList.toggle("on", view.dataset.view === id);
  if (remember){
    try { localStorage.setItem(TAB_KEY, id); } catch { /* ignore */ }
    history.replaceState(null, "", "#" + id);
  }
  if (id === "weapons") loadPreview();
  if (id === "play") loadAgent();
  scrollTo({ top: 0 });
}

// ---------------------------------------------------------------------------
// Уровень
// ---------------------------------------------------------------------------

function renderLevel(){
  const points = me.points ?? 0;
  const lv = levelOf(points);
  const pct = Math.round(lv.progress * 100) + "%";
  $("lvlBadge").textContent = lv.level;
  $("xpBar").style.width = pct;
  $("xpText").textContent = `${points - lv.from} / ${lv.to - lv.from} оп.`;
  $("accLevel").textContent = lv.level;
  $("accXpBar").style.width = pct;
  $("accXpText").textContent = `уровень ${lv.level} · ${points} очков`;

  const next = SKINS.find(sk => sk.level > lv.level);
  $("accNext").textContent = next
    ? `Следующий скин — «${next.name}» на ${next.level} уровне: ещё ${xpForLevel(next.level) - points} очков, это примерно ${Math.ceil((xpForLevel(next.level) - points) / 10)} убийств.`
    : "Открыты все скины. Дальше — только слава.";
}

// ---------------------------------------------------------------------------
// Витрина «Оружие»: модель, характеристики, скины
// ---------------------------------------------------------------------------

async function loadPreview(){
  if (preview){ preview.show(pickedWeapon, skinFor(pickedWeapon, me.points)); preview.start(); return; }
  try {
    const { GunPreview } = await import("./game/gunpreview.js");
    preview = new GunPreview($("gunCanvas"));
    preview.show(pickedWeapon, skinFor(pickedWeapon, me.points));
  } catch (error){
    // Нет WebGL (редкий старый телефон) — витрина без модели, всё остальное работает.
    $("gunCanvas").parentElement.classList.add("no3d");
    console.warn("Витрина без 3D:", error);
  }
}

function renderShowcase(){
  const id = pickedWeapon;
  const knife = !!KNIVES[id];
  const w = WEAPONS[id] || KNIVES[id];
  if (!w) return;
  const owned = me.owned.includes(id) || id === "rifle" || id === "knife";
  const slot = knife ? 0 : gunsFor(me.loadout, me.owned).indexOf(id) + 1;
  $("showName").textContent = w.name;
  $("showAbout").textContent = w.about;
  $("showSlot").hidden = !owned || knife;
  $("showSlot").textContent = slot === 1 ? "основной · 1" : "клавиша " + slot;
  $("showBars").innerHTML = knife
    ? bar("урон", w.damage * 2, 110) + bar("темп", w.rpm * 3, 950) + bar("дальность", 20, 220) + bar("скорость", 118, 120)
    : bar("урон", w.damage * w.pellets, 110) + bar("темп", w.rpm, 950) +
      bar("точность", 1 / (w.spread + 0.004), 220) + bar("запас", w.magazine, 100);

  renderSkinStrip($("skinStrip"), id, owned);

  const foot = $("showFoot");
  foot.innerHTML = "";
  if (!owned){
    const price = document.createElement("span");
    price.className = "price";
    price.textContent = w.price + " монет";
    const buy = document.createElement("button");
    buy.type = "button"; buy.className = "btn btn-main";
    buy.textContent = "Купить";
    buy.disabled = (me.coins ?? 0) < w.price;
    buy.onclick = () => purchase(id);
    foot.append(price, buy);
  } else if (knife){
    const worn = equippedKnife(me.owned) === id;
    const state = document.createElement("span");
    state.className = "price owned-mark";
    state.textContent = worn ? "носишь его" : "куплен";
    foot.append(state);
    if (!worn){
      const wear = document.createElement("button");
      wear.type = "button"; wear.className = "btn btn-ghost"; wear.textContent = "Носить";
      wear.onclick = () => { equipKnife(id); playClick(); renderArmory(); };
      foot.append(wear);
    }
  } else {
    const state = document.createElement("span");
    state.className = "price owned-mark";
    state.textContent = slot === 1 ? "с ним возрождаешься" : `в бою на клавише ${slot}`;
    foot.append(state);
    if (slot !== 1){
      const pick = document.createElement("button");
      pick.type = "button"; pick.className = "btn btn-ghost";
      pick.textContent = "Сделать основным";
      pick.onclick = () => makePrimary(id);
      foot.append(pick);
    }
  }
  preview?.show(id, skinFor(id, me.points));
}

/** Ряд скинов для ствола. Закрытые видны, но с уровнем — есть к чему стремиться. */
function renderSkinStrip(box, weaponId, owned = true){
  box.innerHTML = "";
  const lv = levelOf(me.points ?? 0).level;
  const current = skinFor(weaponId, me.points);
  for (const skin of SKINS){
    const open = lv >= skin.level;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "skin" + (skin.id === current ? " on" : "") + (open ? "" : " locked");
    b.style.background = skin.swatch;
    b.dataset.level = "ур. " + skin.level;
    b.title = open ? `${skin.name} — ${skin.about}` : `${skin.name}: откроется на ${skin.level} уровне`;
    b.onclick = () => {
      if (!open){ playDenied(); return shopSay(`«${skin.name}» откроется на ${skin.level} уровне.`); }
      saveSkin(weaponId, skin.id);
      playClick();
      renderShowcase();
      renderInventory();
      if (!owned) shopSay(`Скин выбран. Он появится, когда купишь ${itemById(weaponId).name.toLowerCase()}.`, "ok");
    };
    box.append(b);
  }
}

// ---------------------------------------------------------------------------
// Инвентарь
// ---------------------------------------------------------------------------

function renderInventory(){
  const slots = $("loadoutSlots");
  if (!slots) return;
  slots.innerHTML = "";
  const slot = (key, title, sub, on, empty = false) => {
    const el = document.createElement("div");
    el.className = "lslot" + (on ? " on" : "") + (empty ? " empty" : "");
    el.innerHTML = `<kbd>${key}</kbd><b>${escape(title)}</b><i>${escape(sub)}</i>`;
    slots.append(el);
    return el;
  };
  // Ровно как полоса слотов в бою: все купленные стволы, нож, граната, бомба.
  const guns = gunsFor(me.loadout, me.owned);
  let key = 1;
  for (const id of guns){
    const el = slot(key++, WEAPONS[id].name,
      (key === 2 ? "основной · " : "") + "скин: " + skinById(skinFor(id, me.points)).name, true);
    el.style.cursor = "pointer";
    el.onclick = () => { pickedWeapon = id; openTab("weapons"); renderArmory(); };
  }
  const knife = equippedKnife(me.owned);
  const kn = slot(key++, KNIVES[knife].name, "бегать быстрее · скин: " + skinById(skinFor(knife, me.points)).name, true);
  kn.style.cursor = "pointer";
  kn.onclick = () => { pickedWeapon = knife; openTab("weapons"); renderArmory(); };
  const nades = GRENADE_ORDER.filter(id => me.owned.includes(id));
  if (nades.length) slot(key++, nades.map(id => GRENADES[id].name).join(" · "), "ЛКМ — бросить, H — сменить", true);
  else slot("—", "Без гранат", "купи в «Оружии» → Снаряжение", false, true);
  slot(key, "Бомба", "у террориста-носильщика: ЛКМ или E на точке", false);

  // Коллекция скинов — для выбранного ствола.
  const grid = $("skinGrid");
  grid.innerHTML = "";
  const lv = levelOf(me.points ?? 0).level;
  const current = skinFor(pickedWeapon, me.points);
  $("skinHint").innerHTML = `Скины для: <b>${escape(itemById(pickedWeapon).name)}</b>. ` +
    `Открываются уровнем, уровень растёт от очков — по десять за убийство. Сейчас у тебя ${lv}-й.`;
  const chooser = document.createElement("div");
  chooser.className = "chips";
  chooser.style.gridColumn = "1 / -1";
  for (const id of [...WEAPON_ORDER, ...KNIFE_ORDER]){
    const b = document.createElement("button");
    b.type = "button";
    b.className = id === pickedWeapon ? "on" : "";
    b.textContent = itemById(id).short || itemById(id).name;
    b.onclick = () => { pickedWeapon = id; playClick(); renderArmory(); };
    chooser.append(b);
  }
  grid.append(chooser);
  for (const skin of SKINS){
    const open = lv >= skin.level;
    const card = document.createElement("button");
    card.type = "button";
    card.className = "skin-card" + (open ? "" : " locked") + (skin.id === current ? " on" : "");
    if (skin.id === current) card.style.borderColor = "var(--signal)";
    card.innerHTML = `<div class="swatch" style="background:${skin.swatch}"></div>
      <b>${skin.name}</b><i>${open ? escape(skin.about) : "откроется на " + skin.level + " уровне"}</i>`;
    card.onclick = () => {
      if (!open){ playDenied(); return; }
      saveSkin(pickedWeapon, skin.id);
      playClick();
      renderShowcase();
      renderInventory();
    };
    grid.append(card);
  }
}

// ---------------------------------------------------------------------------
// Аккаунт
// ---------------------------------------------------------------------------

const GOOGLE_G = `<svg viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;

function renderAccount(){
  $("accName").textContent = displayName(me);
  $("nameNow").textContent = displayName(me);

  const created = me.createdAt?.toDate ? me.createdAt.toDate() : null;
  const facts = [
    ["Позывной", escape(displayName(me))],
    ["Тег", me.tag ? "@" + escape(me.tag) : "—"],
    ["Почта", escape(resolvedLogin?.email || "—")],
    ["Номер игрока", `${escape(String(me.uid).slice(0, 10))}… <button type="button" id="copyUid">скопировать</button>`],
    ["В игре с", created ? created.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }) : "—"]
  ];
  $("accFacts").innerHTML = facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
  $("copyUid").onclick = async () => {
    try { await navigator.clipboard.writeText(me.uid); $("copyUid").textContent = "скопировано"; }
    catch { $("copyUid").textContent = me.uid; }
  };

  const lv = levelOf(me.points ?? 0);
  const stats = [
    [lv.level, "уровень"], [me.points ?? 0, "очки"], [me.kills ?? 0, "убийства"], [me.deaths ?? 0, "смерти"],
    [ratio(me.kills, me.deaths), "у/с"], [me.matches ?? 0, "матчи"], [me.coins ?? 0, "монеты"],
    [(me.owned || []).filter(id => WEAPONS[id] || KNIVES[id]).length + 1, "стволы и ножи"]
  ];
  $("accStats").innerHTML = stats.map(([v, k]) => `<div><b>${v}</b><span>${k}</span></div>`).join("");
  $("accTag").textContent = me.tag ? "@" + me.tag : (resolvedLogin?.method === "google" ? "без тега — тег есть только у аккаунтов MyPeal" : "");
  const box = $("loginMethod");
  const google = resolvedLogin?.method === "google";
  box.innerHTML = google
    ? `${GOOGLE_G}<div>Вошёл через Google<small>${escape(resolvedLogin.email || "")}</small></div>`
    : `<b style="color:var(--signal)">MP</b><div>Вошёл через MyPeal<small>имя и тег — из мессенджера</small></div>`;
  // Вошедшему через Google — предложить привязать MyPeal (тогда тег, друзья
  // и статистика будут общими с мессенджером). Вошедшему через MyPeal —
  // войти аккаунтом Google вместо него.
  $("linkMyPealBtn").hidden = !google;
  $("googleSwitchBtn").hidden = false;
  $("googleSwitchBtn").lastChild.textContent = google ? " Войти другим аккаунтом Google" : " Войти через Google";
}

// ---------------------------------------------------------------------------
// Настройки
// ---------------------------------------------------------------------------

function renderSettings(){
  let st = readSettings();
  const slider = (id, key, fmt) => {
    const input = $(id);
    const [lo, hi, step] = LIMITS[key];
    Object.assign(input, { min: lo, max: hi, step, value: st[key] });
    const show = () => { $(id + "Value").textContent = fmt(Number(input.value)); };
    show();
    input.oninput = () => { st = saveSettings({ [key]: Number(input.value) }); show(); applyCrosshair(st, $("crossBox")); };
  };
  slider("setSens", "sens", v => v.toFixed(2));
  slider("setFov", "fov", v => v + "°");
  slider("setCrossSize", "crossSize", v => v.toFixed(1));

  const chips = $("setCross");
  const drawChips = () => {
    chips.innerHTML = "";
    for (const c of CROSS_STYLES){
      const b = document.createElement("button");
      b.type = "button"; b.textContent = c.name; b.className = st.cross === c.id ? "on" : "";
      b.onclick = () => { st = saveSettings({ cross: c.id }); playClick(); drawChips(); applyCrosshair(st, $("crossBox")); };
      chips.append(b);
    }
  };
  drawChips();

  const sw = $("setCrossColor");
  const drawColors = () => {
    sw.innerHTML = "";
    for (const color of CROSS_COLORS){
      const b = document.createElement("button");
      b.type = "button"; b.style.background = color; b.title = color;
      b.className = st.crossColor === color ? "on" : "";
      b.onclick = () => { st = saveSettings({ crossColor: color }); playClick(); drawColors(); applyCrosshair(st, $("crossBox")); };
      sw.append(b);
    }
  };
  drawColors();
  applyCrosshair(st, $("crossBox"));

  // Графика — те же ступени, что в меню паузы. Список берём из render.js лениво:
  // он тянет за собой Three, а настройки должны открываться мгновенно.
  const QUALITY_NAMES = { low: "Простая", medium: "Средняя", high: "Высокая" };
  const q = $("setQuality");
  let quality = null;
  try { quality = localStorage.getItem("zastava.graphics"); } catch { /* ignore */ }
  const drawQuality = () => {
    q.innerHTML = "";
    for (const [id, name] of Object.entries(QUALITY_NAMES)){
      const b = document.createElement("button");
      b.type = "button"; b.textContent = name; b.className = quality === id ? "on" : "";
      b.onclick = () => {
        quality = id;
        try { localStorage.setItem("zastava.graphics", id); } catch { /* ignore */ }
        playClick(); drawQuality();
      };
      q.append(b);
    }
    if (!quality){
      const auto = document.createElement("span");
      auto.className = "armory-hint"; auto.style.margin = "6px 0 0";
      auto.textContent = "сейчас — подбирается сама под устройство";
      q.append(auto);
    }
  };
  drawQuality();

  renderBinds();

  const vol = $("setVolume");
  vol.value = Math.round(getVolume() * 100);
  $("setVolumeValue").textContent = vol.value;
  vol.oninput = () => { setVolume(Number(vol.value) / 100); $("setVolumeValue").textContent = vol.value; };
}


// ---------------------------------------------------------------------------
// Клавиши
// ---------------------------------------------------------------------------

let waitingBind = null;     // действие, для которого ждём новую клавишу

function renderBinds(){
  const list = $("bindList");
  if (!list) return;
  const binds = bindsOf();
  list.innerHTML = "";
  for (const action of ACTIONS){
    const row = document.createElement("div");
    row.className = "bind";
    const b = document.createElement("button");
    b.type = "button";
    const waiting = waitingBind === action.id;
    b.className = (waiting ? "wait" : "") + (binds[action.id] !== action.key ? " changed" : "");
    b.textContent = waiting ? "нажми…" : keyLabel(binds[action.id]);
    b.onclick = () => { waitingBind = waiting ? null : action.id; playClick(); renderBinds(); };
    row.innerHTML = `<span>${action.name}</span>`;
    row.append(b);
    list.append(row);
  }
  $("bindResetBtn").onclick = () => { resetBinds(); waitingBind = null; playClick(); bindSay("Клавиши как было.", "ok"); renderBinds(); };
}

// Ловим клавишу, пока ждём: на всём документе и ДО всего остального, чтобы
// Tab не увёл фокус, а Enter не нажал кнопку.
addEventListener("keydown", e => {
  if (!waitingBind) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.code === "Escape"){ waitingBind = null; renderBinds(); return; }
  const action = ACTIONS.find(a => a.id === waitingBind);
  const result = bindKey(waitingBind, e.code);
  if (!result.ok){ playDenied(); bindSay(result.reason + (e.code.startsWith("Control") ? " Ctrl+W закрывает вкладку." : "")); return; }
  waitingBind = null;
  playClick();
  const other = result.swapped && ACTIONS.find(a => a.id === result.swapped);
  bindSay(other
    ? `${action.name} — ${keyLabel(e.code)}. «${other.name}» переехало на прежнюю клавишу.`
    : `${action.name} — ${keyLabel(e.code)}.`, "ok");
  renderBinds();
}, true);

function bindSay(text, kind = "err"){
  const note = $("bindNote");
  note.textContent = text;
  note.className = "note show " + kind;
  clearTimeout(bindSay._t);
  bindSay._t = setTimeout(() => { note.className = "note"; }, 4000);
}


// ---------------------------------------------------------------------------
// Консоль администратора
// ---------------------------------------------------------------------------

const CONSOLE_KEY = "zastava.console";   // открыта ли в этой вкладке (до закрытия)
let consoleReady = false;

function wireConsole(){
  $("consoleForm").onsubmit = async e => {
    e.preventDefault();
    const ok = await access.checkPassword($("consolePass").value);
    $("consolePass").value = "";
    if (!ok){
      playDenied();
      const note = $("consoleNote");
      note.textContent = "Неверный пароль.";
      note.className = "note show err";
      return;
    }
    try { sessionStorage.setItem(CONSOLE_KEY, "1"); } catch { /* ignore */ }
    openConsole();
  };
  let open = false;
  try { open = sessionStorage.getItem(CONSOLE_KEY) === "1"; } catch { /* ignore */ }
  if (open) openConsole();
}

function openConsole(){
  $("consoleGate").hidden = true;
  $("consoleBox").hidden = false;
  if (consoleReady) return;
  consoleReady = true;
  $("consoleLine").onsubmit = e => {
    e.preventDefault();
    const text = $("consoleInput").value.trim();
    $("consoleInput").value = "";
    if (text) runCommand(text);
  };
  for (const b of $("consoleQuick").querySelectorAll("button")) b.onclick = () => runCommand(b.dataset.cmd);
  // Стрелка вверх — прошлая команда, как в любом терминале.
  const history = [];
  let at = 0;
  $("consoleInput").addEventListener("keydown", e => {
    if (e.key === "ArrowUp" && history.length){ at = Math.max(0, at - 1); $("consoleInput").value = history[at]; e.preventDefault(); }
    if (e.key === "ArrowDown" && history.length){ at = Math.min(history.length, at + 1); $("consoleInput").value = history[at] || ""; e.preventDefault(); }
  });
  runCommand._history = cmd => { history.push(cmd); at = history.length; };
  out("Консоль «Заставы». help — список команд.", "dim");
  refreshConsoleState();
}

function out(text, kind = ""){
  const line = document.createElement("div");
  if (kind) line.className = kind;
  line.textContent = text;
  $("consoleLog").append(line);
  $("consoleLog").scrollTop = $("consoleLog").scrollHeight;
}

async function refreshConsoleState(){
  try {
    const st = await access.readState();
    $("consoleState").textContent = st.serversOff ? "СЕРВЕРЫ ВЫКЛЮЧЕНЫ" : "серверы работают";
    $("consoleState").className = "console-state " + (st.serversOff ? "off" : "on");
  } catch { $("consoleState").textContent = "нет связи"; }
}

/** Кого имеют в виду: @тег, ник или uid. Несколько совпадений — просим уточнить. */
async function resolveTarget(word){
  if (!word) throw new Error("Укажи игрока: @тег, ник или uid.");
  if (!word.startsWith("@") && word.length >= 20 && !/\s/.test(word)) return { uid: word, name: word };
  const found = await findPlayers(word);
  if (!found.length) throw new Error(`Игрок «${word}» не найден.`);
  if (found.length > 1){
    throw new Error("Найдено несколько: " + found.map(p => `${displayName(p)} (${p.uid})`).join(", ") + ". Укажи uid.");
  }
  return { uid: found[0].uid, name: displayName(found[0]) };
}

const HELP = `Команды:
  status                      — серверы, блокировки, кто онлайн
  online                      — кто сейчас в игре и где
  find <@тег|ник>             — найти игрока и его uid
  rooms                       — все комнаты с кодами, в том числе закрытые
  users [начало]              — все игроки: ник, тег, блокировка
  ban <@тег|ник|uid> [причина] — заблокировать с красной плашкой
  sban <@тег|ник|uid> [причина]— тихая блокировка: просто «не удалось подключиться»
  unban <@тег|ник|uid>        — снять блокировку
  bans                        — список блокировок
  servers off [причина]       — выключить серверы для всех (тех. работы)
  servers on                  — включить обратно
  clear                       — очистить экран
Заблокированных и при выключенных серверах выбрасывает и из идущего матча.`;

async function runCommand(text){
  runCommand._history?.(text);
  out("> " + text, "in");
  const [cmd, ...rest] = text.split(/\s+/);
  const arg = rest.join(" ");
  try {
    switch (cmd.toLowerCase()){
      case "help": out(HELP); break;
      case "clear": $("consoleLog").innerHTML = ""; break;

      case "status": {
        const [st, bans] = await Promise.all([access.readState(), access.listBans()]);
        const online = presence.length;
        out(`Серверы: ${st.serversOff ? "ВЫКЛЮЧЕНЫ" + (st.note ? " — " + st.note : "") : "работают"}`, st.serversOff ? "err" : "ok");
        out(`Блокировок: ${bans.length} · онлайн: ${online}`);
        break;
      }

      case "online": {
        if (!presence.length){ out("Никого нет.", "dim"); break; }
        for (const row of presence){
          const where = row.room ? `${mapName(row.map)} · ${modeShort(row.mode)} (${row.room})` : "лобби";
          out(`${row.nick || "Боец"}${row.tag ? " @" + row.tag : ""} — ${where} — ${row.uid}`);
        }
        break;
      }

      case "rooms": {
        if (!allRooms.length){ out("Комнат нет.", "dim"); break; }
        out(`Комнат: ${allRooms.length}`, "dim");
        for (const r of allRooms){
          const who = `${r.count || 0}/${r.maxPlayers || 4}`;
          const kind = r.id === net.MAIN_ROOM ? "общий" : r.priv ? "по коду" : "открытая";
          out(`${r.code || "—"}  ${mapName(r.map)} · ${modeShort(r.mode)} · ${who} · ${kind} · хозяин ${r.hostName || "?"} — ${r.id}`);
        }
        break;
      }

      case "users": {
        const [players, bans] = await Promise.all([listPlayers(), access.listBans()]);
        const banned = new Map(bans.map(b => [b.uid, b]));
        const online = new Set(presence.map(p => p.uid));
        const needle = arg.replace(/^@/, "").toLowerCase();
        const rows = players
          .filter(p => !needle || (p.tag || "").toLowerCase().startsWith(needle) || displayName(p).toLowerCase().startsWith(needle))
          .sort((a, b) => displayName(a).localeCompare(displayName(b)));
        out(`Игроков: ${rows.length}${needle ? " (по «" + needle + "»)" : ""} · в бане: ${rows.filter(p => banned.has(p.uid)).length}`, "dim");
        for (const p of rows){
          const b = banned.get(p.uid);
          const status = b ? (b.silent ? "БАН тихо" : "БАН") : "ок";
          out(`${displayName(p)}${p.tag ? " @" + p.tag : ""} — ${status}${online.has(p.uid) ? " · онлайн" : ""} — ${p.uid}`, b ? "err" : "");
        }
        break;
      }

      case "find": {
        const found = await findPlayers(arg);
        if (!found.length) out("Никого.", "dim");
        for (const p of found) out(`${displayName(p)}${p.tag ? " @" + p.tag : ""} — ${p.uid}`);
        break;
      }

      case "ban": case "sban": {
        const [who, ...why] = rest;
        const target = await resolveTarget(who);
        if (target.uid === me.uid) throw new Error("Себя заблокировать нельзя.");
        const silent = cmd.toLowerCase() === "sban";
        await access.ban(target.uid, { reason: why.join(" "), silent, name: target.name, by: displayName(me) });
        out(`${target.name} заблокирован${silent ? " тихо" : " (с плашкой)"}.`, "ok");
        break;
      }

      case "unban": {
        const target = await resolveTarget(arg);
        if (!(await access.banOf(target.uid))){ out(`${target.name} не заблокирован.`, "dim"); break; }
        await access.unban(target.uid);
        out(`${target.name} разблокирован.`, "ok");
        break;
      }

      case "bans": {
        const bans = await access.listBans();
        if (!bans.length){ out("Блокировок нет.", "dim"); break; }
        for (const b of bans){
          const when = b.at?.toDate ? b.at.toDate().toLocaleString("ru-RU") : "";
          out(`${b.name || "?"} — ${b.silent ? "тихо" : "с плашкой"}${b.reason ? " — " + b.reason : ""} — ${when} — ${b.uid}`);
        }
        break;
      }

      case "servers": {
        const [state, ...note] = rest;
        if (state !== "on" && state !== "off") throw new Error("servers on или servers off [причина]");
        await access.setServers(state === "on", note.join(" "), displayName(me));
        out(state === "on" ? "Серверы включены." : "Серверы выключены: всех отключит, новые входы — «не удалось подключиться».",
            state === "on" ? "ok" : "err");
        refreshConsoleState();
        break;
      }

      default: out(`Нет такой команды: ${cmd}. help — список.`, "err");
    }
  } catch (error){
    const text = String(error?.message || error);
    out(/permission|insufficient/i.test(text)
      ? "База отказала: нет прав администратора. Проверь, что залиты новые правила Firestore и что вход — админским аккаунтом."
      : text, "err");
  }
}


// ---------------------------------------------------------------------------
// Подсказки при поиске друга
// ---------------------------------------------------------------------------

let suggestTimer = null;
let suggestAsked = "";

async function showSuggest(){
  const text = $("findInput").value.trim();
  const box = $("findSuggest");
  if (!text.replace(/^@/, "")){ hideSuggest(); return; }
  suggestAsked = text;
  const found = (await suggestPlayers(text)).filter(p => p.uid !== me.uid);
  if (suggestAsked !== text) return;            // пока ждали, человек набрал ещё
  if (!found.length){
    box.innerHTML = `<p class="empty">Нет тегов, начинающихся с «${escape(text.replace(/^@/, ""))}»</p>`;
    box.hidden = false;
    return;
  }
  box.innerHTML = "";
  for (const person of found){
    const b = document.createElement("button");
    b.type = "button";
    b.className = "suggest-row";
    b.innerHTML = `<b>${person.tag ? "@" + escape(person.tag) : escape(displayName(person))}</b>
      <i>${escape(displayName(person))}${friendIds.includes(person.uid) ? " · уже друг" : ""}</i>`;
    // mousedown, а не click: иначе поле теряет фокус раньше и список прячется.
    b.onmousedown = e => {
      e.preventDefault();
      $("findInput").value = person.tag ? "@" + person.tag : displayName(person);
      hideSuggest();
      $("findResult").innerHTML = "";
      $("findResult").append(personRow(person, "find"));
    };
    box.append(b);
  }
  box.hidden = false;
}

function hideSuggest(){ const box = $("findSuggest"); if (box) box.hidden = true; }


// ---------------------------------------------------------------------------
// Боец на главном экране
// ---------------------------------------------------------------------------

const AGENT_TEAM_KEY = "zastava.agentTeam";
function agentTeam(){
  try { return localStorage.getItem(AGENT_TEAM_KEY) === "b" ? "b" : "a"; } catch { return "a"; }
}

function renderHero(){
  const gun = gunsFor(me.loadout, me.owned)[0] || "rifle";
  const skin = skinFor(gun, me.points);
  $("heroName").textContent = displayName(me);
  const ag = agentById(equippedAgent(me.owned));
  $("heroWeapon").textContent = `${ag.name} · ${WEAPONS[gun].name} · скин «${skinById(skin).name}» · уровень ${levelOf(me.points ?? 0).level}`;
  for (const b of $("agentSide").querySelectorAll("button")){
    b.classList.toggle("on", b.dataset.team === agentTeam());
    b.onclick = () => {
      try { localStorage.setItem(AGENT_TEAM_KEY, b.dataset.team); } catch { /* ignore */ }
      playClick();
      renderHero();
    };
  }
  $("heroArmory").onclick = () => { pickedWeapon = gun; openTab("weapons"); renderArmory(); };
  agent?.show(agentTeam(), gun, skin, pickedAgent || equippedAgent(me.owned));
  renderAgents();
}

async function loadAgent(){
  if (!me) return;
  if (agent){ renderHero(); agent.start(); return; }
  try {
    const { AgentPreview } = await import("./game/agentpreview.js");
    agent = new AgentPreview($("agentCanvas"));
  } catch (error){
    console.warn("Боец без 3D:", error);
  }
  renderHero();
}


// ---------------------------------------------------------------------------
// Попроситься в закрытую комнату друга
// ---------------------------------------------------------------------------

let knocking = null;   // { roomId, stop, timer }

async function askToJoin(room, friend, button){
  if (knocking){ friendSay("Уже ждём ответа из другой комнаты."); return; }
  if (!(await mayConnect())) return;
  button.disabled = true;
  button.textContent = "Ждём…";
  const friendName = displayName(friend);
  try {
    await net.knock(room.id, me.sessionUid, { uid: me.uid, nick: displayName(me), friendOf: friendName });
  } catch (error){
    button.disabled = false; button.textContent = "Попроситься";
    return friendSay("Не получилось отправить просьбу: " + error.message);
  }
  friendSay(`Спросили хозяина комнаты${room.hostName ? " (" + room.hostName + ")" : ""}. Ждём ответа — до минуты.`, "ok");

  const finish = text => {
    clearTimeout(knocking?.timer);
    knocking?.stop?.();
    net.cancelKnock(room.id, me.sessionUid);
    knocking = null;
    button.disabled = false; button.textContent = "Попроситься";
    if (text) friendSay(text);
  };
  knocking = {
    roomId: room.id,
    timer: setTimeout(() => finish("Хозяин комнаты не ответил. Попробуй позже."), 60_000),
    stop: net.watchKnockAnswer(room.id, me.sessionUid, answer => {
      if (answer === "yes"){
        finish();
        playPurchase();
        friendSay("Пустили! Заходим…", "ok");
        location.href = gameLink(room.id);
      } else if (answer === "no"){
        playDenied();
        finish("Хозяин комнаты не разрешил зайти.");
      }
    })
  };
}


// ---------------------------------------------------------------------------
// Персонажи
// ---------------------------------------------------------------------------

let pickedAgent = null;      // какой сейчас показан на подиуме (нажали карточку)

function renderAgents(){
  const box = $("agents");
  if (!box || !me) return;
  box.innerHTML = "";
  const worn = equippedAgent(me.owned);
  const shown = pickedAgent || worn;
  for (const a of AGENTS){
    const has = a.price === 0 || me.owned.includes(a.id);
    const card = document.createElement("div");
    card.className = "agent-card" + (a.id === worn ? " on" : "") + (a.id === shown && a.id !== worn ? " picked" : "");
    const pct = Math.round((a.speed - 1) * 100);
    card.innerHTML = `
      <div class="swatch" style="background:${agentSwatch(a)}"></div>
      <b>${a.name}</b>
      <i>${a.about}</i>
      <div class="speed"><span>скорость ${pct ? "+" + pct + "%" : "обычная"}</span><u><i style="width:${Math.max(6, pct / 12 * 100)}%"></i></u></div>
      <div class="foot"></div>`;
    // Нажал на карточку — боец на подиуме переодевается: можно посмотреть до покупки.
    card.onclick = e => {
      if (e.target.closest("button")) return;
      pickedAgent = a.id; playClick(); renderHero(); loadAgent();
    };
    const foot = card.querySelector(".foot");
    if (!has){
      const price = document.createElement("span");
      price.className = "price"; price.textContent = a.price + " монет";
      const buy = document.createElement("button");
      buy.type = "button"; buy.className = "btn btn-ghost"; buy.textContent = "Купить";
      buy.disabled = (me.coins ?? 0) < a.price;
      buy.onclick = () => buyAgent(a.id);
      foot.append(price, buy);
    } else if (a.id === worn){
      foot.innerHTML = `<span class="price owned-mark">в игре</span>`;
    } else {
      const wear = document.createElement("button");
      wear.type = "button"; wear.className = "btn btn-ghost"; wear.textContent = "Выбрать";
      wear.onclick = () => { equipAgent(a.id); pickedAgent = null; playClick(); agentSay(`Теперь ты — ${a.name}.`, "ok"); renderHero(); };
      foot.append(document.createElement("span"), wear);
    }
    box.append(card);
  }
}

async function buyAgent(id){
  const a = agentById(id);
  try {
    const result = await buyWeapon(me.uid, me, id);
    if (!result.ok){ playDenied(); return agentSay(result.reason); }
    me = { ...me, ...result.player };
    equipAgent(id);
    pickedAgent = null;
    playPurchase();
    agentSay(`${a.name} куплен и уже выбран. Бегаешь на ${Math.round((a.speed - 1) * 100)}% быстрее.`, "ok");
    renderArmory();
    renderHero();
  } catch (error){
    playDenied();
    agentSay(/permission|insufficient/i.test(error.message)
      ? "База не разрешила покупку — нужно обновить правила Firestore (см. инструкцию)."
      : "Не получилось купить: " + error.message);
  }
}

function agentSay(text, kind = "err"){
  const note = $("agentNote");
  note.textContent = text;
  note.className = "note show " + kind;
  clearTimeout(agentSay._t);
  agentSay._t = setTimeout(() => { note.className = "note"; }, 4500);
}
