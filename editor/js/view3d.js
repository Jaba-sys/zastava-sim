// view3d.js — 3D вид карты, в котором можно и править (Three.js с CDN,
// нужен интернет).
//
//   Вращать вид        — левая кнопка по пустому месту; правая — сдвиг; колесо — ближе.
//   Выбор (V)          — клик по блоку; тянуть блок — двигать по земле;
//                        Shift + тянуть — поднимать / опускать (меняется «низ»).
//   Жёлтая стрелка     — над выбранным блоком: тянуть вверх-вниз — высота блока.
//   Блок (B)           — клик по земле или по верху другого блока: ставит новый
//                        блок (размер 2×2, высота — из «Новый блок»).
//   Точки, возрождения — клик по земле; Стереть (E) — клик по объекту.

import { $, toast } from "./dom.js";
import { S, byId, changed, round2, snap, snapshot, undoStack } from "./state.js";
import { groundAt } from "./geometry.js";
import { renderSel } from "./panel.js";
import { placeSite, placeSpawn, mirrored } from "./plan.js";

export const view3d = {
  open: false, THREE: null, scene: null, renderer: null, camera: null, controls: null, root: null,
  meshes: [], drag: null,

  async show(){
    this.open = true;
    $("view3d").classList.add("show");
    if (!this.THREE){
      try {
        this.THREE = await import("three");
        const { OrbitControls } = await import("three/addons/controls/OrbitControls.js");
        this.setup(OrbitControls);
      } catch {
        toast("Для 3D вида нужен интернет (загрузка Three.js).");
        this.hide();
        return false;
      }
    }
    this.rebuild(); this.resize(); this.loop();
    return true;
  },
  hide(){
    this.open = false;
    $("view3d").classList.remove("show");
  },

  setup(OrbitControls){
    const T = this.THREE;
    this.renderer = new T.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    const el = this.renderer.domElement;
    $("view3d").append(el);
    this.scene = new T.Scene();
    this.camera = new T.PerspectiveCamera(55, 1, 0.1, 1000);
    this.camera.position.set(0, 45, 55);
    this.ray = new T.Raycaster();
    this.ndc = new T.Vector2();
    // Свои обработчики — ДО OrbitControls: если попали по блоку, вращение
    // вида на время перетаскивания выключается.
    el.addEventListener("pointerdown", e => this.down(e));
    el.addEventListener("pointermove", e => this.move(e));
    el.addEventListener("pointerup", e => this.up(e));
    el.addEventListener("contextmenu", e => e.preventDefault());
    this.controls = new OrbitControls(this.camera, el);
    this.controls.target.set(0, 0, 0);
    this.controls.maxPolarAngle = Math.PI * 0.49;
    addEventListener("resize", () => this.resize());
  },

  resize(){
    if (!this.renderer) return;
    const el = $("view3d");
    this.renderer.setSize(el.clientWidth, el.clientHeight);
    this.camera.aspect = el.clientWidth / Math.max(1, el.clientHeight);
    this.camera.updateProjectionMatrix();
  },

  // ---- сцена ---------------------------------------------------------------

  rebuild(){
    if (!this.THREE || !this.open) return;
    const T = this.THREE, m = S.map;
    if (this.root){
      this.scene.remove(this.root);
      this.root.traverse(o => { o.geometry?.dispose?.(); });
    }
    const root = this.root = new T.Group();
    this.meshes = [];
    const mats = new Map();
    const mat = (c, opacity = 1) => {
      const k = c + ":" + opacity;
      if (!mats.has(k)) mats.set(k, new T.MeshStandardMaterial({ color: c, roughness: 0.8, transparent: opacity < 1, opacity }));
      return mats.get(k);
    };
    const add = (parent, x, y, z, w, h, d, c, opacity = 1) => {
      const mesh = new T.Mesh(new T.BoxGeometry(w, h, d), mat(c, opacity));
      mesh.position.set(x, y + h / 2, z); mesh.castShadow = true; mesh.receiveShadow = true;
      parent.add(mesh); return mesh;
    };

    // земля — по ней ставят и двигают
    this.ground = add(root, 0, -1, 0, m.width + 12, 1, m.depth + 12, m.floor);
    this.ground.userData.ground = true;
    const size = Math.max(m.width, m.depth);
    const grid = new T.GridHelper(size, Math.round(size / 2), 0x000000, 0x000000);
    grid.material.opacity = 0.12; grid.material.transparent = true; grid.position.y = 0.01;
    root.add(grid);

    for (const o of m.objects){
      const sel = o.id === S.selected;
      if (o.type === "box"){
        const mesh = add(root, o.x, o.y, o.z, o.w, o.h, o.d, o.color, o.decor ? 0.55 : 1);
        mesh.userData.id = o.id; this.meshes.push(mesh);
        if (sel) this.outline(root, mesh);
      } else if (o.type === "ramp"){
        const g = new T.Group(); root.add(g);
        const alongX = o.dir[1] === "x", up = o.dir[0] === "+";
        const len = alongX ? o.w : o.d, steps = Math.max(4, Math.ceil(o.h / 0.28));
        for (let i = 0; i < steps; i++){
          const t = (i + 0.5) / steps, top = o.y + o.h * (i + 1) / steps;
          const off = (up ? t - 0.5 : 0.5 - t) * len;
          const piece = add(g, alongX ? o.x + off : o.x, o.y, alongX ? o.z : o.z + off,
            alongX ? len / steps + 0.02 : o.w, Math.max(0.1, top - o.y), alongX ? o.d : len / steps + 0.02, o.color);
          piece.userData.id = o.id; this.meshes.push(piece);
        }
        if (sel) this.outline(root, g);
      } else if (o.type === "site"){
        const gy = groundAt(o.x, o.z);
        const ring = new T.Mesh(new T.RingGeometry(4.65, 5, 40), new T.MeshBasicMaterial({ color: 0xe8a317, side: T.DoubleSide }));
        ring.rotation.x = -Math.PI / 2; ring.position.set(o.x, gy + 0.05, o.z); root.add(ring);
        const post = add(root, o.x, gy, o.z, 0.25, 2.6, 0.25, "#e8a317");
        post.userData.id = o.id; this.meshes.push(post);
        if (sel) this.outline(root, post);
      } else if (o.type === "spawn"){
        const gy = groundAt(o.x, o.z);
        const man = add(root, o.x, gy, o.z, 0.7, 1.75, 0.7, o.team === "a" ? "#e8a317" : "#5aa0d2", 0.85);
        man.userData.id = o.id; this.meshes.push(man);
        if (sel) this.outline(root, man);
      }
    }

    // ручка высоты над выбранным блоком
    this.handle = null;
    const cur = byId(S.selected);
    if (cur && (cur.type === "box" || cur.type === "ramp")){
      const h = new T.Mesh(new T.ConeGeometry(0.45, 0.9, 16), new T.MeshBasicMaterial({ color: 0xffd23d, depthTest: false }));
      h.renderOrder = 10;
      h.position.set(cur.x, cur.y + cur.h + 0.9, cur.z);
      root.add(h);
      this.handle = h;
    }

    const L = { day: [0xfff1d6, 2.1, 1.7], evening: [0xffb46b, 1.6, 1.0], night: [0x9fb8ff, 0.7, 0.75] }[m.light] || [0xffffff, 2, 1.6];
    const sun = new T.DirectionalLight(L[0], L[1]);
    const r = Math.max(m.width, m.depth) * 0.65;
    sun.position.set(r * 0.5, r * 1.2, r * 0.6); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, far: r * 4 });
    root.add(sun, new T.HemisphereLight(0xdfeeff, 0x7a7060, L[2]), new T.AmbientLight(0xffffff, 0.25));
    this.scene.background = new T.Color(m.sky);
    this.scene.fog = new T.Fog(m.sky, 150, 450);
    this.scene.add(root);
  },

  outline(root, obj){
    const box = new this.THREE.BoxHelper(obj, 0xffffff);
    box.material.depthTest = false; box.renderOrder = 9;
    root.add(box);
  },

  loop(){
    if (!this.open) return;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(() => this.loop());
  },

  // ---- мышь ----------------------------------------------------------------

  cast(e){
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
  },
  /** Точка на горизонтальной плоскости высоты y. */
  onPlaneY(y){
    const T = this.THREE, p = new T.Vector3();
    return this.ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), -y), p) ? p : null;
  },
  /** Точка на вертикальной плоскости через точку at, повёрнутой к камере. */
  onPlaneUp(at){
    const T = this.THREE, n = new T.Vector3().subVectors(this.camera.position, at).setY(0).normalize();
    const p = new T.Vector3();
    return this.ray.ray.intersectPlane(new T.Plane().setFromNormalAndCoplanarPoint(n, at), p) ? p : null;
  },

  down(e){
    if (e.button !== 0) return;
    this.cast(e);
    const T = this.THREE;
    // ручка высоты
    if (this.handle && this.ray.intersectObject(this.handle).length){
      const o = byId(S.selected);
      snapshot();
      this.drag = { kind: "height", id: o.id, at: new T.Vector3(o.x, o.y + o.h, o.z) };
      this.controls.enabled = false;
      return;
    }
    const hits = this.ray.intersectObjects([...this.meshes, this.ground], false);
    const hit = hits[0];
    const id = hit?.object.userData.id;
    const tool = S.tool;

    if (tool === "pan") return;
    if (tool === "erase"){
      if (id){
        this.controls.enabled = false;
        snapshot();
        S.map.objects = S.map.objects.filter(o => o.id !== id);
        if (S.selected === id) S.selected = null;
        changed();
      }
      return;
    }
    if (tool === "box" || tool === "ramp" || tool.startsWith("site") || tool.startsWith("spawn")){
      if (!hit) return;
      this.controls.enabled = false;
      const px = round2(snap(hit.point.x)), pz = round2(snap(hit.point.z));
      if (tool === "siteA" || tool === "siteB"){ placeSite(tool === "siteA" ? "A" : "B", px, pz); return; }
      if (tool === "spawnA" || tool === "spawnB"){ placeSpawn(tool === "spawnA" ? "a" : "b", px, pz); return; }
      // блок / пандус — на ту поверхность, по которой кликнули
      snapshot();
      const top = round2(Math.max(0, hit.point.y));
      const h = Math.max(0.1, Number($("newH").value) || 2.4);
      const o = tool === "box"
        ? { id: S.nextId++, type: "box", x: px, z: pz, w: 2, d: 2, y: top, h, color: $("newColor").value, decor: false }
        : { id: S.nextId++, type: "ramp", x: px, z: pz, w: 3, d: 6, y: top, h, color: "#ffc83d", dir: "+z" };
      S.map.objects.push(o);
      if (S.mirror && Math.abs(o.x) > 0.01) S.map.objects.push(mirrored(o));
      S.selected = o.id;
      changed();
      return;
    }
    // выбор
    if ((S.selected || null) !== (id || null)){ S.selected = id || null; renderSel(); this.rebuild(); }
    if (id){
      const o = byId(id);
      snapshot();
      this.controls.enabled = false;
      const lift = e.shiftKey;
      const start = lift ? this.onPlaneUp(new T.Vector3(o.x, o.y, o.z)) : this.onPlaneY(o.y);
      this.drag = { kind: lift ? "lift" : "move", id, start, x: o.x, y: o.y, z: o.z, moved: false };
    }
  },

  move(e){
    if (!this.drag) return;
    this.cast(e);
    const o = byId(this.drag.id);
    if (!o) return;
    const T = this.THREE;
    if (this.drag.kind === "move"){
      const p = this.onPlaneY(this.drag.y);
      if (!p || !this.drag.start) return;
      o.x = round2(snap(this.drag.x + p.x - this.drag.start.x));
      o.z = round2(snap(this.drag.z + p.z - this.drag.start.z));
    } else if (this.drag.kind === "lift"){
      const p = this.onPlaneUp(new T.Vector3(this.drag.x, this.drag.y, this.drag.z));
      if (!p || !this.drag.start) return;
      o.y = round2(Math.max(0, snap(this.drag.y + p.y - this.drag.start.y)));
    } else if (this.drag.kind === "height"){
      const p = this.onPlaneUp(this.drag.at);
      if (!p) return;
      o.h = round2(Math.max(0.1, snap(p.y - o.y)));
    }
    this.drag.moved = true;
    this.rebuild();
    renderSel();
  },

  up(){
    this.controls.enabled = true;
    if (!this.drag) return;
    const d = this.drag;
    this.drag = null;
    if (!d.moved){ undoStack.pop(); return; }
    changed();
  }
};
