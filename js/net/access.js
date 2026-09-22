// access.js — пускать ли человека на серверы: блокировки и выключатель.
//
// Всё хранится в Firestore проекта мессенджера (правила — там же):
//   gameAdmin/state      { serversOff, note, at, by } — выключатель серверов;
//   gameBans/{uid}       { reason, silent, name, at, by } — блокировка игрока.
//
// Заблокированный или «выключенный» игрок видит при входе на сервер ровно то,
// что видит человек с плохой связью: «Не удалось подключиться к этому
// серверу». Никаких «вас забанили» — если только админ не выбрал блокировку с
// плашкой (silent: false): тогда в лобби сверху мигает красная строка.
//
// Честно о границах: проверка идёт в клиенте. Без своего сервера (бесплатный
// план) базу боя не научить читать Firestore, поэтому человек, который
// разберёт код игры и полезет в базу руками, формально сможет войти. Для всех
// остальных — а это все — сервер просто «не отвечает».

import { auth, db } from "../firebase.js";
import {
  doc, getDoc, setDoc, deleteDoc, onSnapshot, collection, getDocs, query, limit, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

export const ADMIN_EMAIL = "sop3chit.xpol.viva0@gmail.com";
export const CONNECT_FAIL = "Не удалось подключиться к этому серверу.";

// Пароль консоли в коде НЕ лежит — только его отпечаток (SHA-256 с солью).
// Код игры открыт любому, кто нажмёт «просмотр кода», и пароль открытым
// текстом прочитал бы каждый. Отпечаток назад в пароль не превращается.
const CONSOLE_HASH = "6c3b6eab6467a1ada0adb16ff5e0a7e251d03251c24970119b042e818e725bf1";
const SALT = "zastava-admin:";

const stateRef = () => doc(db, "gameAdmin", "state");
const banRef = uid => doc(db, "gameBans", uid);

/**
 * Админ ли это. Та же логика, что в правилах (isGameAdmin): почта Google в
 * самом входе, либо карточка мессенджера с isAdmin или этой почтой. Решает
 * только, показывать ли вкладку «Консоль», — права на запись всё равно
 * проверяют правила.
 */
export async function isAdminPlayer(uid){
  const user = auth?.currentUser;
  if (user && !user.isAnonymous && user.email === ADMIN_EMAIL && user.emailVerified) return true;
  try {
    const snap = await getDoc(doc(db, "users", uid));
    const data = snap.exists() ? snap.data() : null;
    return !!data && (data.isAdmin === true || data.email === ADMIN_EMAIL);
  } catch { return false; }
}

export async function checkPassword(text){
  const bytes = new TextEncoder().encode(SALT + String(text || ""));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
  return hex === CONSOLE_HASH;
}

/** Разовая проверка перед входом на сервер. */
export async function checkAccess(uid, { admin = false } = {}){
  try {
    const [ban, state] = await Promise.all([getDoc(banRef(uid)), getDoc(stateRef())]);
    const b = ban.exists() ? ban.data() : null;
    const s = state.exists() ? state.data() : {};
    if (b) return { ok: false, banned: true, silent: !!b.silent, reason: b.reason || "" };
    if (s.serversOff && !admin) return { ok: false, serversOff: true };
    return { ok: true };
  } catch {
    // Не смогли прочитать — пускаем: ошибка сети не должна запирать всех.
    return { ok: true };
  }
}

/** Подписка на своё положение: блокировка и выключатель меняются на лету. */
export function watchAccess(uid, callback, { admin = false } = {}){
  let ban = null, state = {};
  const emit = () => callback(ban
    ? { ok: false, banned: true, silent: !!ban.silent, reason: ban.reason || "" }
    : state.serversOff && !admin ? { ok: false, serversOff: true } : { ok: true });
  const stopBan = onSnapshot(banRef(uid), snap => { ban = snap.exists() ? snap.data() : null; emit(); }, () => {});
  const stopState = onSnapshot(stateRef(), snap => { state = snap.exists() ? snap.data() : {}; emit(); }, () => {});
  return () => { stopBan(); stopState(); };
}

// ---------------------------------------------------------------------------
// Действия админа
// ---------------------------------------------------------------------------

export async function readState(){
  const snap = await getDoc(stateRef());
  return snap.exists() ? snap.data() : { serversOff: false };
}

export async function setServers(on, note, by){
  await setDoc(stateRef(), { serversOff: !on, note: note || "", at: serverTimestamp(), by: by || "" });
}

export async function ban(uid, { reason = "", silent = false, name = "", by = "" } = {}){
  await setDoc(banRef(uid), {
    reason: String(reason).slice(0, 200), silent: !!silent, name: String(name).slice(0, 40),
    at: serverTimestamp(), by: String(by).slice(0, 40)
  });
}

export async function unban(uid){ await deleteDoc(banRef(uid)); }

export async function listBans(){
  const snap = await getDocs(query(collection(db, "gameBans"), limit(200)));
  return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
}

export async function banOf(uid){
  const snap = await getDoc(banRef(uid));
  return snap.exists() ? snap.data() : null;
}
