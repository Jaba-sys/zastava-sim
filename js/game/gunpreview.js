// gunpreview.js — ствол на витрине в оружейной лобби: крутится, тащится мышью.
//
// Грузится лениво, только когда человек открыл вкладку «Оружие»: Three весит
// заметно, и платить за него тому, кто пришёл просто нажать «Играть», незачем.

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js";
import { buildGunModel, disposeGun, studioEnvironment } from "./gunmodels.js";

export class GunPreview {
  constructor(canvas){
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.environment = studioEnvironment(this.renderer);
    this.camera = new THREE.PerspectiveCamera(28, 2, 0.05, 20);
    this.camera.position.set(0, 0.12, 2.3);
    this.camera.lookAt(0, 0, 0);

    const key = new THREE.DirectionalLight(0xfff0dc, 2.2);
    key.position.set(-1.5, 2, 1.5);
    const rim = new THREE.DirectionalLight(0xbcd8ff, 1.2);
    rim.position.set(1.5, 0.8, -2);
    this.scene.add(key, rim, new THREE.AmbientLight(0xffffff, 0.25));

    // Пятно тени под стволом — без него предмет «висит в пустоте».
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.62, 40),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28 })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.scale.set(1.25, 0.32, 1);
    shadow.position.y = -0.26;
    this.scene.add(shadow);

    this.holder = new THREE.Group();
    this.scene.add(this.holder);
    this.model = null;
    this.key = "";

    this.yaw = -Math.PI / 2 + 0.35;   // три четверти: видно и бок, и дуло
    this.pitch = 0.12;
    this.spin = 0.35;          // радиан в секунду, пока человек не трогает
    this.dragging = false;
    this._drag();

    this.running = false;
    this.last = 0;
    this._frame = this._frame.bind(this);
  }

  show(weaponId, skinId){
    const key = weaponId + ":" + skinId;
    if (key === this.key) return;
    this.key = key;
    if (this.model){ this.holder.remove(this.model); disposeGun(this.model); }
    const { group } = buildGunModel(weaponId, skinId);
    // Центрируем по габаритам: у винтовки дуло далеко впереди, у ПП — нет,
    // и без центровки короткий ствол крутился бы вокруг чужой точки.
    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    group.position.sub(center);
    const wrap = new THREE.Group();
    wrap.add(group);
    const scale = 1.3 / Math.max(size.z, 0.5);
    wrap.scale.setScalar(scale);
    this.model = wrap;
    this.holder.add(wrap);
    this.start();
  }

  start(){
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this._frame);
  }

  _frame(now){
    // Вкладку закрыли — перестаём рисовать. Крутить невидимый ствол значит
    // зря греть видеокарту телефона.
    if (!this.canvas.offsetParent){ this.running = false; return; }
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!this.dragging) this.yaw += this.spin * dt;

    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(w * this.renderer.getPixelRatio())){
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / Math.max(1, h);
      // На узком экране отодвигаем камеру, чтобы длинный ствол влез целиком.
      this.camera.position.z = this.camera.aspect < 1.6 ? 2.3 * 1.6 / this.camera.aspect : 2.3;
      this.camera.updateProjectionMatrix();
    }
    this.holder.rotation.set(this.pitch, this.yaw, 0);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this._frame);
  }

  _drag(){
    let x = 0, y = 0;
    const el = this.canvas;
    el.style.touchAction = "pan-y";
    el.addEventListener("pointerdown", e => {
      this.dragging = true; x = e.clientX; y = e.clientY;
      el.setPointerCapture?.(e.pointerId);
    });
    el.addEventListener("pointermove", e => {
      if (!this.dragging) return;
      this.yaw += (e.clientX - x) * 0.01;
      this.pitch = Math.max(-0.6, Math.min(0.6, this.pitch + (e.clientY - y) * 0.006));
      x = e.clientX; y = e.clientY;
    });
    const stop = () => { this.dragging = false; };
    el.addEventListener("pointerup", stop);
    el.addEventListener("pointercancel", stop);
  }
}
