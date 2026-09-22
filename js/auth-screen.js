// auth-screen.js — экран входа. Своей регистрации у игры нет вовсе: аккаунт
// один и тот же, что в мессенджере. Это не упрощение, а суть задумки — в бою
// тебя видят под тем же именем, под которым ты пишешь друзьям.

import { isConfigured } from "./firebase.js";
import { resolvePlayer, goToMyPeal, signInWithGoogle } from "./mypeal-auth.js";
import { ensurePlayer } from "./profile.js";
import { MYPEAL_ORIGIN } from "./config.js";
import { registerServiceWorker, wireInstallButton } from "./pwa.js";

const $ = id => document.getElementById(id);

// Служебный работник и кнопка установки — до всякой проверки ключей Firebase:
// поставить игру на телефон можно и до того, как она настроена, а если ключи
// не вписаны, экран входа вообще не доходит до этого места.
registerServiceWorker();
wireInstallButton(document.getElementById("installBtn"));

function say(text, kind = "err"){
  const note = $("note");
  note.textContent = text;
  note.className = "note show " + kind;
}

if (!isConfigured){
  $("setup").classList.add("show");
  $("enterBtn").disabled = true;
  say("Ключи Firebase не вписаны — смотри подсказку ниже.");
} else {
  boot();
}

async function boot(){
  $("enterBtn").onclick = () => {
    $("enterBtn").disabled = true;
    $("enterBtn").textContent = "Открываю MyPeal…";
    goToMyPeal();
  };
  $("aboutBtn").onclick = () => open(MYPEAL_ORIGIN, "_blank", "noopener");
  $("googleBtn").onclick = async () => {
    const button = $("googleBtn");
    button.disabled = true;
    try {
      const user = await signInWithGoogle();
      if (!user) return;                                // окно закрыли — ничего страшного
      await enter(await resolvePlayer());
    } catch (error){
      say(error.message);
    } finally {
      button.disabled = false;
    }
  };

  try {
    const resolved = await resolvePlayer();

    if (!resolved.uid){
      // Обычный первый заход: показываем кнопку и ничего больше не делаем.
      $("gate").classList.add("ready");
      return;
    }

    // Либо вернулись с пропуском, либо эта вкладка уже входила раньше.
    $("gate").classList.add("ready");
    await enter(resolved);

  } catch (error){
    $("gate").classList.add("ready");
    $("enterBtn").disabled = false;
    $("enterBtn").textContent = "Войти через MyPeal";
    say(error.message);
  }
}

/** Карточка игрока есть (или заведена) — в лобби. */
async function enter(resolved){
  const profile = await ensurePlayer(resolved.uid, resolved.fresh || {});
  say(`Вход выполнен: ${profile.nick || profile.name}. Переходим в лобби…`, "ok");
  setTimeout(() => { location.href = "lobby.html"; }, 700);
}
