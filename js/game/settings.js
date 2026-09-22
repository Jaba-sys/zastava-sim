// settings.js — настройки игрока: чувствительность мыши, угол обзора, прицел.
//
// Живут на этом устройстве (localStorage): у мыши дома и у тачпада ноутбука
// разная «правильная» чувствительность, и синхронизировать её между ними —
// значит испортить обе. Правятся во вкладке «Настройки» в лобби, читаются
// игрой при входе в матч.

const KEY = "zastava.settings";

export const DEFAULTS = {
  sens: 1,            // множитель чувствительности мыши
  fov: 78,            // угол обзора по вертикали, градусы
  cross: "cross",     // вид прицела
  crossColor: "#ece7db",
  crossSize: 1,       // множитель размера прицела
  binds: {}           // переназначенные клавиши; пусто — все по умолчанию
};

// ---------------------------------------------------------------------------
// Клавиши
//
// Действие → код клавиши (KeyboardEvent.code: он не зависит от раскладки, и
// W остаётся W и в русской раскладке, где это «Ц»).
// ---------------------------------------------------------------------------

export const ACTIONS = [
  { id: "fwd",      name: "Вперёд",                 key: "KeyW" },
  { id: "back",     name: "Назад",                  key: "KeyS" },
  { id: "left",     name: "Влево",                  key: "KeyA" },
  { id: "right",    name: "Вправо",                 key: "KeyD" },
  { id: "jump",     name: "Прыжок",                 key: "Space" },
  { id: "sprint",   name: "Бег",                    key: "ShiftLeft" },
  { id: "crouch",   name: "Присесть",               key: "KeyC" },
  { id: "reload",   name: "Перезарядка",            key: "KeyR" },
  { id: "use",      name: "Заложить / разминировать", key: "KeyE" },
  { id: "nade",     name: "Бросить гранату",        key: "KeyG" },
  { id: "nadeSwap", name: "Сменить гранату",        key: "KeyH" },
  { id: "knife",    name: "Достать нож",            key: "KeyQ" },
  { id: "inspect",  name: "Осмотреть оружие",       key: "KeyF" },
  { id: "spectate", name: "Свободный полёт (после смерти)", key: "KeyV" },
  { id: "board",    name: "Табло",                  key: "Tab" },
  { id: "chat",     name: "Чат",                    key: "Enter" }
];

// Эти клавиши не отдаём: цифры — слоты оружия, Esc — пауза (браузер всё равно
// забирает его на выход из захвата мыши), Ctrl — из-за Ctrl+W, закрывающего
// вкладку, Meta/Win — система.
const RESERVED = /^(Digit[0-9]|Escape|ControlLeft|ControlRight|MetaLeft|MetaRight|AltLeft|AltRight|F\d+)$/;
export const isReservedKey = code => RESERVED.test(code);

export function bindsOf(settings = readSettings()){
  const out = {};
  for (const a of ACTIONS) out[a.id] = settings.binds?.[a.id] || a.key;
  return out;
}

/**
 * Назначить клавишу. Если она уже занята другим действием, действия
 * меняются клавишами — иначе одно из них осталось бы вовсе без кнопки.
 */
export function bindKey(actionId, code){
  if (isReservedKey(code)) return { ok: false, reason: "Эту клавишу занять нельзя." };
  const binds = bindsOf();
  const taken = Object.keys(binds).find(id => binds[id] === code && id !== actionId);
  if (taken) binds[taken] = binds[actionId];
  binds[actionId] = code;
  saveSettings({ binds });
  return { ok: true, swapped: taken || null };
}

export function resetBinds(){ saveSettings({ binds: {} }); }

/** Человеческое имя клавиши: KeyW → W, Space → Пробел. */
export function keyLabel(code = ""){
  const named = { Space: "Пробел", ShiftLeft: "Shift", ShiftRight: "Правый Shift", Tab: "Tab",
    Enter: "Enter", Backspace: "Backspace", CapsLock: "Caps Lock", Backquote: "Ё / `",
    ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Minus: "-", Equal: "=",
    BracketLeft: "[", BracketRight: "]", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/",
    Backslash: "\\" };
  if (named[code]) return named[code];
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Numpad")) return "Num " + code.slice(6);
  return code;
}

export const LIMITS = {
  sens: [0.2, 3, 0.05],
  fov: [60, 100, 1],
  crossSize: [0.6, 2, 0.1]
};

export const CROSS_STYLES = [
  { id: "cross",  name: "Крест" },
  { id: "dot",    name: "Точка" },
  { id: "circle", name: "Кольцо" },
  { id: "tee",    name: "Буква Т" }
];

export const CROSS_COLORS = ["#ece7db", "#4ef07a", "#3ee0ff", "#ffd23e", "#ff4f7a", "#ff8a1f"];

const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));

export function readSettings(){
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch { /* нет хранилища */ }
  const s = { ...DEFAULTS, ...saved };
  s.sens = clamp(Number(s.sens) || 1, LIMITS.sens);
  s.fov = clamp(Number(s.fov) || 78, LIMITS.fov);
  s.crossSize = clamp(Number(s.crossSize) || 1, LIMITS.crossSize);
  if (!CROSS_STYLES.some(c => c.id === s.cross)) s.cross = DEFAULTS.cross;
  if (!/^#[0-9a-f]{6}$/i.test(s.crossColor)) s.crossColor = DEFAULTS.crossColor;
  if (!s.binds || typeof s.binds !== "object") s.binds = {};
  return s;
}

export function saveSettings(patch){
  const next = { ...readSettings(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* не смертельно */ }
  return readSettings();
}

/** Применить вид прицела к странице: класс на body и две CSS-переменные. */
export function applyCrosshair(settings, root = document.body){
  for (const c of CROSS_STYLES) root.classList.remove("cross-" + c.id);
  root.classList.add("cross-" + settings.cross);
  root.style.setProperty("--cross-color", settings.crossColor);
  root.style.setProperty("--cross-scale", settings.crossSize);
}
