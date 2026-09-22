// radar.js — радар в левом верхнем углу, как в CS.
//
// Показывает карту сверху вокруг тебя (повёрнутую так, что «вперёд» — всегда
// вверх), точки закладки и ТОЛЬКО СВОИХ: союзников с направлением взгляда,
// убитых — крестиком. Врагов на радаре нет никогда: иначе он стал бы
// волхаком, и прятаться стало бы бессмысленно. Бомбу видят террористы (где
// носильщик, где она упала); заложенную — все, о ней и так объявили.
//
// Карта рисуется ОДИН раз при загрузке в отдельный холст — прямоугольники
// коллайдеров сверху; каждый кадр этот холст просто поворачивается и
// сдвигается. Сам радар перерисовывается 30 раз в секунду, а не 60: глаз
// разницы не видит, а на телефоне это заметная экономия.

const TEAM = { a: "#e8a317", b: "#5aa0d2", free: "#e8e2d4" };
const SHOW_METERS = 38;           // радиус видимого круга, метры

export class Radar {
  constructor(map, nav = null){
    this.canvas = document.createElement("canvas");
    this.canvas.id = "radar";
    document.body.append(this.canvas);
    this.ctx = this.canvas.getContext("2d");
    this.last = 0;
    this._bake(map, nav);
  }

  /**
   * Карта сверху, как на радаре CS: где можно ходить — светлым (чем выше,
   * тем светлее), стены и всё непроходимое — тёмным. Проходимые места берём
   * из графа ботов (nav.js): он и так знает каждую клетку, куда дойдёт боец.
   * Нет графа — рисуем по коробкам: пол тёмный, препятствия светлые.
   */
  _bake(map, nav){
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    const boxes = map.colliders.map(c => c.box);
    for (const b of boxes){
      if (b.max.x - b.min.x > 400 || b.max.z - b.min.z > 400) continue;
      minX = Math.min(minX, b.min.x); minZ = Math.min(minZ, b.min.z);
      maxX = Math.max(maxX, b.max.x); maxZ = Math.max(maxZ, b.max.z);
    }
    if (!isFinite(minX)){ minX = minZ = -60; maxX = maxZ = 60; }
    const ppm = 3;                                  // пикселей на метр
    const w = Math.min(2048, Math.ceil((maxX - minX) * ppm));
    const h = Math.min(2048, Math.ceil((maxZ - minZ) * ppm));
    const img = document.createElement("canvas");
    img.width = w; img.height = h;
    const g = img.getContext("2d");
    g.fillStyle = "rgba(24,27,29,0.95)";
    g.fillRect(0, 0, w, h);

    if (nav?.reachSet?.size){
      const step = nav.x(1) - nav.x(0);
      let lo = Infinity, hi = -Infinity;
      const cells = [];
      for (const key of nav.reachSet){
        const [cell, y] = key.split("@");
        const [i, j] = cell.split(",").map(Number);
        const fy = Number(y);
        cells.push([nav.x(i), nav.z(j), fy]);
        lo = Math.min(lo, fy); hi = Math.max(hi, fy);
      }
      cells.sort((p, q) => p[2] - q[2]);             // верхние этажи — поверх
      const span = Math.max(1, hi - lo);
      for (const [x, z, y] of cells){
        const t = (y - lo) / span;
        const c = Math.round(118 + t * 70);
        g.fillStyle = `rgb(${c},${c - 3},${c - 12})`;
        g.fillRect((x - step / 2 - minX) * ppm, (z - step / 2 - minZ) * ppm, step * ppm + 1, step * ppm + 1);
      }
    } else {
      const solid = boxes
        .filter(b => b.max.y > 0.9 && b.max.y - b.min.y > 0.5)
        .sort((p, q) => p.max.y - q.max.y);
      for (const b of solid){
        const tall = Math.min(1, (b.max.y - 0.9) / 4);
        const shade = Math.round(92 + tall * 70);
        g.fillStyle = `rgb(${shade},${shade - 4},${shade - 12})`;
        g.fillRect((b.min.x - minX) * ppm, (b.min.z - minZ) * ppm,
                   Math.max(1, (b.max.x - b.min.x) * ppm), Math.max(1, (b.max.z - b.min.z) * ppm));
      }
    }
    this.img = img;
    this.origin = { x: minX, z: minZ };
    this.size = { x: w / ppm, z: h / ppm };
  }

  hide(){ this.canvas.style.display = "none"; }

  /**
   * view: { x, z, yaw } — откуда смотрим; team — своя сторона;
   * mates: [{ x, z, yaw, alive, bomb }]; sites: [[x,y,z]…];
   * bomb: { x, z, planted } | null — показывать ли бомбу и где.
   */
  draw({ view, team, mates, sites, bomb }){
    const now = performance.now();
    if (now - this.last < 33) return;
    this.last = now;

    const css = this.canvas.clientWidth || 180;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const px = Math.round(css * dpr);
    if (this.canvas.width !== px){ this.canvas.width = px; this.canvas.height = px; }
    const ctx = this.ctx;
    const R = px / 2;
    const k = R / SHOW_METERS;
    const cos = Math.cos(view.yaw), sin = Math.sin(view.yaw);
    // Мир → экран: «вперёд» вверх. Вперёд у нас (−sin yaw, −cos yaw).
    const toScreen = (x, z) => {
      const dx = x - view.x, dz = z - view.z;
      return [R + (dx * cos - dz * sin) * k, R + (dx * sin + dz * cos) * k];
    };

    ctx.clearRect(0, 0, px, px);
    ctx.save();
    ctx.beginPath();
    ctx.arc(R, R, R - dpr, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = "rgba(20,23,25,0.9)";
    ctx.fillRect(0, 0, px, px);

    // карта
    ctx.save();
    ctx.translate(R, R);
    ctx.rotate(view.yaw);
    ctx.scale(k, k);
    ctx.translate(-view.x, -view.z);
    ctx.drawImage(this.img, this.origin.x, this.origin.z, this.size.x, this.size.z);
    ctx.restore();

    // точки закладки
    ctx.font = `700 ${Math.round(13 * dpr)}px Oswald, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    (sites || []).forEach((s, i) => {
      const [sx, sy] = toScreen(s[0], s[2]);
      ctx.fillStyle = "rgba(232,163,23,0.2)";
      ctx.beginPath(); ctx.arc(sx, sy, 5 * k, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(232,163,23,0.95)";
      ctx.fillText(i === 1 ? "B" : "A", sx, sy);
    });

    // бомба
    if (bomb){
      const [bx, by] = toScreen(bomb.x, bomb.z);
      const blink = !bomb.planted || Math.floor(now / 300) % 2 === 0;
      ctx.fillStyle = blink ? "#ff4a3a" : "#7a2018";
      ctx.fillRect(bx - 4 * dpr, by - 3 * dpr, 8 * dpr, 6 * dpr);
    }

    // свои
    const color = TEAM[team] || TEAM.free;
    for (const m of mates){
      const [mx, my] = toScreen(m.x, m.z);
      if (!m.alive){
        ctx.strokeStyle = "rgba(236,231,219,0.55)";
        ctx.lineWidth = 2 * dpr;
        const d = 3.5 * dpr;
        ctx.beginPath();
        ctx.moveTo(mx - d, my - d); ctx.lineTo(mx + d, my + d);
        ctx.moveTo(mx + d, my - d); ctx.lineTo(mx - d, my + d);
        ctx.stroke();
        continue;
      }
      // куда смотрит — короткий «луч»
      const a = m.yaw - view.yaw;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.lineTo(mx - Math.sin(a) * 9 * dpr, my - Math.cos(a) * 9 * dpr);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(mx, my, 3.6 * dpr, 0, Math.PI * 2); ctx.fill();
      if (m.bomb){
        ctx.fillStyle = "#ff4a3a";
        ctx.fillRect(mx + 3 * dpr, my - 7 * dpr, 5 * dpr, 4 * dpr);
      }
    }

    // я — стрелка в центре, всегда смотрит вверх
    ctx.fillStyle = "#fff6e0";
    ctx.beginPath();
    ctx.moveTo(R, R - 7 * dpr);
    ctx.lineTo(R + 5 * dpr, R + 5 * dpr);
    ctx.lineTo(R, R + 2 * dpr);
    ctx.lineTo(R - 5 * dpr, R + 5 * dpr);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // обводка
    ctx.strokeStyle = "rgba(201,184,150,0.55)";
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath(); ctx.arc(R, R, R - dpr, 0, Math.PI * 2); ctx.stroke();
  }
}
