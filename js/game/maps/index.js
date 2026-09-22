// index.js — список карт в одном месте. Лобби берёт отсюда описания, игра —
// саму геометрию. Добавить ещё карту = положить рядом файл и дописать сюда
// одну строчку.

import * as karier   from "./karier.js";
import * as depo     from "./depo.js";
import * as teplitsy from "./teplitsy.js";
import * as plotina  from "./plotina.js";
import * as port     from "./port.js";
import * as poligon  from "./poligon.js";
import * as arena    from "./arena.js";

export const MAPS = { karier, depo, teplitsy, plotina, port, poligon, arena };
export const MAP_LIST = [karier.meta, depo.meta, teplitsy.meta, plotina.meta, port.meta, poligon.meta, arena.meta];

import { mapFromData } from "./fromdata.js";

/**
 * Своя карта игрока (из редактора): кладём её под id "custom", и дальше она
 * работает как любая другая — buildMap("custom"), mapMeta("custom").
 */
export function registerCustomMap(data){
  const made = mapFromData({ ...data, id: "custom" });
  MAPS.custom = { meta: { ...made.meta, id: "custom" }, build: made.build };
  return MAPS.custom.meta;
}

export function mapMeta(id){
  return MAPS[id]?.meta || karier.meta;
}

export function buildMap(id){
  return (MAPS[id] || MAPS.karier).build();
}
