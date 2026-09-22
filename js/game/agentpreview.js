// agentpreview.js — твой боец на главном экране лобби.
//
// Тот же Soldier, что бегает по карте у других игроков, с твоим основным
// стволом и твоим скином на нём. Стоит на подиуме, дышит, медленно
// поворачивается; мышью (или пальцем) его можно покрутить. Сторону —
// террористы или спецназ — переключают кнопки рядом: форма у сторон разная.
//
// Грузится лениво, как и витрина оружия: Three нужен только для картинки.

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js";
import { Soldier } from "./soldier.js";
import { studioEnvironment } from "./gunmodels.js";

export class AgentPreview {
  constructor(canvas){
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.environment = studioEnvironment(this.renderer);
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 30);
    this.camera.position.set(0, 1.3, 4.1);
    this.camera.lookAt(0, 0.95, 0);

    // Три источника, как в фотостудии: ключевой тёплый, контровой холодный
    // (обводит силуэт — без него фигура сливается с тёмным фоном), заливка.
    const key = new THREE.DirectionalLight(0xfff1dc, 2.4);
    key.position.set(-2.5, 4, 3);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -2; key.shadow.camera.right = 2;
    key.shadow.camera.top = 3; key.shadow.camera.bottom = -1;
    const rim = new THREE.DirectionalLight(0x9fd0ff, 2.2);
    rim.position.set(2.5, 2.5, -3);
    this.scene.add(key, rim, new THREE.HemisphereLight(0xdfe8ff, 0x2a2622, 0.9));

    // Подиум: низкий диск со светящимся кантом.
    const podium = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.05, 0.12, 48),
      new THREE.MeshStandardMaterial({ color: 0x23282c, roughness: 0.5, metalness: 0.4 }));
    podium.position.y = -0.06;
    podium.receiveShadow = true;
    const glow = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.012, 8, 64),
      new THREE.MeshBasicMaterial({ color: 0xe8a317 }));
    glow.rotation.x = Math.PI / 2;
    glow.position.y = 0.005;
    this.glow = glow;
    this.scene.add(podium, glow);

    this.holder = new THREE.Group();
    this.scene.add(this.holder);
    this.soldier = null;
    this.key = "";

    this.yaw = Math.PI - 0.55;   // лицом к нам, в три четверти: видно и лицо, и ствол
    this.spin = 0.2;
    this.dragging = false;
    this._drag();
    this.running = false;
    this._frame = this._frame.bind(this);
  }

  /** Показать бойца: сторона ("a" | "b"), ствол и скин на нём. */
  show(team, weaponId, skin, agent = "recruit"){
    const key = `${team}:${weaponId}:${skin}:${agent}`;
    if (key === this.key) return;
    this.key = key;
    if (this.soldier){
      this.holder.remove(this.soldier.root);
      this.soldier.dispose?.();
    }
    this.soldier = new Soldier(team, weaponId, { skin, agent });
    this.soldier.root.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true;
      if (o.material){ o.material.envMap = this.scene.environment; o.material.envMapIntensity = 0.6; }
    });
    this.holder.add(this.soldier.root);
    // Кант подиума — цвета стороны: оранжевый у террористов, голубой у спецназа.
    this.glow.material.color.set(team === "b" ? 0x5aa0d2 : 0xe8a317);
    this.start();
  }

  start(){
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this._frame);
  }

  _frame(now){
    if (!this.canvas.offsetParent){ this.running = false; return; }
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!this.dragging) this.yaw += this.spin * dt;

    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(w * this.renderer.getPixelRatio())){
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / Math.max(1, h);
      this.camera.updateProjectionMatrix();
    }
    this.holder.rotation.y = this.yaw;
    this.soldier?.update(dt, 0, 0, false);         // стоит и дышит
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this._frame);
  }

  _drag(){
    let x = 0;
    const el = this.canvas;
    el.style.touchAction = "pan-y";
    el.addEventListener("pointerdown", e => { this.dragging = true; x = e.clientX; el.setPointerCapture?.(e.pointerId); });
    el.addEventListener("pointermove", e => { if (this.dragging){ this.yaw += (e.clientX - x) * 0.012; x = e.clientX; } });
    const stop = () => { this.dragging = false; };
    el.addEventListener("pointerup", stop);
    el.addEventListener("pointercancel", stop);
  }
}
