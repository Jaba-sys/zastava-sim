// agents.js — персонажи: внешний вид бойца и скорость бега.
//
// Покупаются за те же монеты, что и стволы, и лежат в том же списке owned
// (правила Firestore знают их имена). Чем дороже персонаж, тем быстрее он
// бегает — но прибавка нарочно небольшая, до 12 %: новичок на бесплатном
// бойце не должен проигрывать только потому, что у соперника больше монет.
//
// Внешность меняет форму (одежда, головной убор), но НЕ цвета стороны: каска
// или повязка, лямки и наплечники всегда цвета команды — своих и чужих
// должно быть видно издалека, кем бы ты ни играл.

export const AGENTS = [
  { id: "recruit", name: "Новобранец", price: 0,    speed: 1.00, hat: "helmet",
    about: "Стандартная форма и каска. Есть у всех" },
  { id: "scout",   name: "Разведчик",  price: 400,  speed: 1.03, hat: "cap",
    cloth: 0x5f6b45, about: "Лёгкая полевая форма и кепка" },
  { id: "ranger",  name: "Рейнджер",   price: 800,  speed: 1.06, hat: "beret",
    cloth: 0x3b3f36, hatColor: 0x8a1c1c, about: "Тёмная форма и красный берет" },
  { id: "ghost",   name: "Призрак",    price: 1300, speed: 1.09, hat: "hood",
    cloth: 0x2a2c30, skin: 0x2a2c30, about: "Капюшон и маска — лица не видно" },
  { id: "viper",   name: "Гадюка",     price: 2000, speed: 1.12, hat: "balaclava",
    cloth: 0x2f4a3a, about: "Балаклава, очки ночного видения. Самый быстрый" }
];

export const agentById = id => AGENTS.find(a => a.id === id) || AGENTS[0];

/** Какого персонажа носить. Выбор — на устройстве; некупленный заменяется новобранцем. */
const KEY = "zastava.agent";
export function equippedAgent(owned = []){
  let id = "recruit";
  try { id = localStorage.getItem(KEY) || "recruit"; } catch { /* ignore */ }
  const agent = agentById(id);
  return agent.price === 0 || owned.includes(agent.id) ? agent.id : "recruit";
}
export function equipAgent(id){
  try { localStorage.setItem(KEY, id); } catch { /* ignore */ }
}

/** CSS-образец для карточки: цвет формы и головного убора. */
export function agentSwatch(agent){
  const hex = n => "#" + n.toString(16).padStart(6, "0");
  const cloth = agent.cloth ? hex(agent.cloth) : "#8a6a3a";
  const hat = agent.hatColor ? hex(agent.hatColor) : agent.hat === "helmet" ? "#57411f" : "#1d1f22";
  return `linear-gradient(180deg, ${hat} 0 26%, ${cloth} 26% 100%)`;
}
