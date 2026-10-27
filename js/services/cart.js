// Shopping cart: which cases the visitor picked, how many of each, and the name for
// personalised designs. Kept in this visitor's browser only (a per-visitor convenience);
// the order itself is sent to the store over WhatsApp.

const KEY = "lukx-cart-v1";
const listeners = new Set();
let items = load(); // [{ id, qty, nome }]

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(data) ? data.filter((x) => x && typeof x.id === "string").map((x) => ({ id: x.id, qty: Math.max(1, Math.min(99, x.qty | 0 || 1)), nome: String(x.nome || "").slice(0, 40) })) : [];
  } catch { return []; }
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* storage unavailable: cart lives for this visit */ } }
function emit() { save(); listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } }); }

export const cart = {
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  items() { return items.map((x) => ({ ...x })); },
  get(id) { return items.find((x) => x.id === id) || null; },
  qty(id) { return this.get(id)?.qty || 0; },
  count() { return items.reduce((n, x) => n + x.qty, 0); },

  add(id, n = 1) {
    const it = items.find((x) => x.id === id);
    if (it) it.qty = Math.min(99, it.qty + n);
    else items.push({ id, qty: Math.min(99, n), nome: "" });
    emit();
  },
  setQty(id, qty) {
    if (qty <= 0) return this.remove(id);
    const it = items.find((x) => x.id === id);
    if (it) { it.qty = Math.min(99, qty); emit(); }
  },
  setNome(id, nome) {
    const it = items.find((x) => x.id === id);
    if (it) { it.nome = String(nome).slice(0, 40); save(); }
  },
  remove(id) { items = items.filter((x) => x.id !== id); emit(); },
  clear() { items = []; emit(); },
  /** Drop cases that are no longer in the public catalog. */
  prune(validIds) {
    const before = items.length;
    items = items.filter((x) => validIds.has(x.id));
    if (items.length !== before) emit();
  },
};

/** Brazilian number → digits for wa.me (adds country code 55 when missing). */
export function waNumber(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("0")) d = d.replace(/^0+/, "");
  if (d.length === 10 || d.length === 11) d = "55" + d;
  return d.length >= 12 && d.length <= 13 ? d : "";
}

export function orderMessage(lines) {
  const total = lines.reduce((n, l) => n + l.qty, 0);
  const body = lines.map((l, i) => {
    const parts = [`${i + 1}. ${l.name} (${l.code})`, `${l.qty} ${l.qty === 1 ? "unidade" : "unidades"}`];
    if (l.personalizavel) parts.push(l.nome ? `Nome na arte: ${l.nome}` : "Nome na arte: a combinar");
    return parts.join(" — ");
  }).join("\n");
  return `Olá! Quero fazer este pedido pelo catálogo LUKX CASE:\n\n${body}\n\nTotal: ${total} ${total === 1 ? "capinha" : "capinhas"}`;
}
