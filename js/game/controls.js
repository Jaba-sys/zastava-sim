// controls.js — мышь и клавиши.
//
// Мышь захватывается браузером (Pointer Lock), иначе целиться невозможно: без
// захвата курсор упирается в край окна и обзор перестаёт крутиться. Захват
// браузер даёт только по клику человека — поэтому игра начинается с экрана
// "нажми, чтобы играть", а не сама.

// Раскладка по умолчанию — ACTIONS в settings.js. Здесь только то, что
// Controls держит «зажатым» каждый кадр (ходьба, бег, прыжок, присед, дело);
// разовые действия — перезарядку, гранату, табло — ловит main.js по тем же
// назначениям.
const HELD = ["fwd", "back", "left", "right", "jump", "sprint", "crouch", "use"];

/**
 * Карта «код клавиши → действие» из назначений игрока. Стрелки дублируют
 * ходьбу всегда. Левый Ctrl — «безопасный присед»: работает только в полном
 * экране с захваченной клавиатурой (см. crouchSafe ниже). Раньше присесть
 * можно было и на Ctrl в окне, и это была ловушка: Ctrl+W браузер понимает
 * как «закрыть вкладку», и перехватить это сочетание страница НЕ МОЖЕТ.
 */
function keyMap(binds){
  const map = { ArrowUp: "fwd", ArrowDown: "back", ArrowLeft: "left", ArrowRight: "right",
                ControlLeft: "crouchSafe" };
  for (const action of HELD) if (binds[action]) map[binds[action]] = action;
  return map;
}

export class Controls {
  constructor(canvas, binds = {}){
    this.canvas = canvas;
    this.binds = binds;
    this.KEYS = keyMap(binds);
    this.keys = {};
    this.yaw = 0;
    this.pitch = 0;
    this.sensitivity = 0.0022;
    this.locked = false;
    this.firing = false;
    this.aiming = false;        // зажата правая кнопка — прицеливание
    // Во сколько раз приближает текущий прицел. Ставится из игры и влияет на
    // чувствительность мыши: если её не поделить, при трёхкратном увеличении
    // прицел мечется по экрану и попасть невозможно.
    this.zoomFactor = 1;
    this.onChat = null;        // вызывается по Enter — открыть строку чата
    this.onLockChange = null;
    this.blocked = false;      // true, пока человек печатает в чат
    this.keyLocked = false;    // клавиатура захвачена (полный экран) — Ctrl безопасен

    this._bind();
  }

  _bind(){
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked){
        // Иначе "залипнет" бег и стрельба: клавиши отпускали уже вне игры.
        this.keys = {};
        this.firing = false;
        this.aiming = false;
      }
      this.onLockChange?.(this.locked);
    });

    document.addEventListener("mousemove", e => {
      if (!this.locked) return;
      const k = this.sensitivity / this.zoomFactor;
      this.yaw   -= e.movementX * k;
      this.pitch -= e.movementY * k;
      // Чуть меньше прямого угла: ровно 90° дают дрожание камеры на полюсе.
      const limit = Math.PI / 2 - 0.02;
      this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
    });

    this.canvas.addEventListener("mousedown", e => {
      if (!this.locked) return;
      if (e.button === 0) this.firing = true;
      if (e.button === 2) this.aiming = true;
    });
    document.addEventListener("mouseup", e => {
      if (e.button === 0) this.firing = false;
      if (e.button === 2) this.aiming = false;
    });
    // Правая кнопка — это прицеливание, а не контекстное меню.
    this.canvas.addEventListener("contextmenu", e => e.preventDefault());

    document.addEventListener("keydown", e => {
      if (this.blocked) return;
      if (e.code === (this.binds.chat || "Enter")){ this.onChat?.(); return; }
      let key = this.KEYS[e.code];
      // Ctrl приседает ТОЛЬКО когда клавиатура захвачена (полный экран): тогда
      // Ctrl+W достаётся игре, а не браузеру. В окне Ctrl ничего не делает —
      // пусть лучше не работает, чем закрывает вкладку посреди боя.
      if (key === "crouchSafe") key = this.keyLocked ? "crouch" : null;
      if (key){ this.keys[key] = true; e.preventDefault(); }
    });
    document.addEventListener("keyup", e => {
      let key = this.KEYS[e.code];
      if (key === "crouchSafe") key = "crouch";
      if (key) this.keys[key] = false;
    });

    // Полный экран + Keyboard Lock: единственный законный способ забрать у
    // браузера Ctrl+W, Ctrl+T и прочие его сочетания. Работает в Chrome и Edge.
    // Esc НЕ захватываем — иначе из полного экрана выходят долгим нажатием,
    // и человек думает, что игра зависла.
    document.addEventListener("fullscreenchange", () => this._syncKeyLock());

    // Уходя из вкладки, снимаем все клавиши: вернувшись, человек не должен
    // обнаружить себя бегущим в стену.
    window.addEventListener("blur", () => {
      this.keys = {};
      this.firing = false;
      this.aiming = false;
    });
  }

  /** Включить полный экран и захватить клавиши. Только по действию человека. */
  async fullscreen(){
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    } catch { /* браузер отказал — остаёмся в окне */ }
    await this._syncKeyLock();
  }

  async _syncKeyLock(){
    const kb = navigator.keyboard;
    if (!kb?.lock){ this.keyLocked = false; return; }
    if (document.fullscreenElement){
      try {
        await kb.lock(["KeyW", "KeyA", "KeyS", "KeyD", "KeyT", "KeyN", "KeyR", "KeyQ",
                       "ControlLeft", "ControlRight", "Tab", "Space"]);
        this.keyLocked = true;
      } catch { this.keyLocked = false; }
    } else {
      kb.unlock?.();
      this.keyLocked = false;
    }
  }

  requestLock(){
    this.canvas.requestPointerLock?.();
  }

  releaseLock(){
    if (document.pointerLockElement) document.exitPointerLock();
  }
}
