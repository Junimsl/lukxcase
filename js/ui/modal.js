// Product viewer: enlarged image, details, previous/next within the current results.

import { h, icons } from "./dom.js";
import { UNCLASSIFIED, categoryMap, effectiveCategories } from "../services/categories.js";
import { store } from "../services/store.js";
import { cart } from "../services/cart.js";
import { qtyStepper } from "./cart.js";

export function createViewer({ onCategory, onOpenCart, onAdd }) {
  const img = h("img", { alt: "" });
  const title = h("h2", { id: "viewer-title" });
  const price = h("p", { class: "viewer-price" });
  const count = h("span", { class: "viewer-count" });
  const desc = h("p");
  const tags = h("div", { class: "tags" });
  const details = h("dl");
  const prevBtn = h("button", { type: "button", class: "icon-btn", "aria-label": "Capinha anterior", html: icons.prev });
  const nextBtn = h("button", { type: "button", class: "icon-btn", "aria-label": "Próxima capinha", html: icons.next });
  const closeBtn = h("button", { type: "button", class: "icon-btn", "aria-label": "Fechar", html: icons.close });
  const buy = h("div", { class: "viewer-buy" });
  const actions = h("div", { class: "viewer-actions" });

  const dialog = h("dialog", { class: "viewer", "aria-labelledby": "viewer-title" },
    h("div", { class: "viewer-grid" },
      h("div", { class: "viewer-media" }, img, h("div", { class: "viewer-nav" }, prevBtn, nextBtn)),
      h("div", { class: "viewer-info" },
        h("div", { class: "viewer-top" }, count, closeBtn),
        title, price, tags, desc, details, buy, actions)));
  document.body.append(dialog);

  let ids = [], index = 0;

  function show() {
    const p = store.catalog.products.find((x) => x.id === ids[index]);
    if (!p) return close();
    const cmap = categoryMap(store.catalog);
    const cats = effectiveCategories(p, cmap);
    img.src = store.imageSrc(p);
    img.alt = `Capinha ${p.name}`;
    title.textContent = p.name;
    const value = Number(p.price ?? store.catalog.settings?.price);
    price.textContent = value > 0 ? value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "";
    price.hidden = !(value > 0);
    count.textContent = ids.length > 1 ? `${index + 1} de ${ids.length}` : "";
    tags.replaceChildren(...cats.map((id) => h("span", { class: `tag${id === UNCLASSIFIED.id ? " review" : ""}`, text: cmap.get(id)?.name || id })),
      ...(p.personalizavel ? [h("span", { class: "tag solid", text: "Personalizável" })] : []));
    desc.textContent = p.description || "";
    desc.hidden = !p.description;
    const rows = [];
    if (p.personalizavel) rows.push(["Personalização", "Arte com espaço para nome ou iniciais"]);
    if (p.keywords?.length) rows.push(["Temas", p.keywords.slice(0, 6).join(", ")]);
    rows.push(["Código", p.id.toUpperCase()]);
    details.replaceChildren(...rows.flatMap(([k, v]) => [h("dt", { text: k }), h("dd", { text: v })]));
    actions.replaceChildren(...cats.filter((id) => id !== UNCLASSIFIED.id).map((id) =>
      h("button", { type: "button", class: "btn small", text: `Ver mais de ${cmap.get(id)?.name}`, onclick: () => { close(); onCategory(id); } })));
    renderBuy(p);
    prevBtn.disabled = nextBtn.disabled = ids.length < 2;
    prevBtn.hidden = nextBtn.hidden = ids.length < 2;
  }

  function renderBuy(p) {
    const q = cart.qty(p.id);
    buy.replaceChildren(...(q
      ? [qtyStepper(p.id, { label: p.name }), h("button", { type: "button", class: "btn dark", text: "Ver carrinho", onclick: () => { close(); onOpenCart?.(); } })]
      : [h("button", { type: "button", class: "btn primary", onclick: () => { cart.add(p.id); onAdd?.(p); } }, h("span", { html: icons.plus }), "Adicionar ao carrinho")]));
    if (p.personalizavel) buy.append(h("p", { class: "muted small buy-note", text: "Você escreve o nome que vai na arte no carrinho." }));
  }
  cart.subscribe(() => {
    if (!dialog.open) return;
    const p = store.catalog.products.find((x) => x.id === ids[index]);
    const hadFocus = buy.contains(document.activeElement);
    if (p) renderBuy(p);
    if (hadFocus) buy.querySelector("button:last-of-type, button")?.focus();
  });

  function step(d) { if (ids.length < 2) return; index = (index + d + ids.length) % ids.length; show(); }
  function open(id, list) {
    ids = list?.length ? list : [id];
    index = Math.max(0, ids.indexOf(id));
    show();
    if (!dialog.open) dialog.showModal();
    closeBtn.focus();
  }
  function close() { if (dialog.open) dialog.close(); }

  prevBtn.addEventListener("click", () => step(-1));
  nextBtn.addEventListener("click", () => step(1));
  closeBtn.addEventListener("click", close);
  dialog.addEventListener("click", (e) => { if (e.target === dialog) close(); });
  dialog.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
    if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
  });
  // Swipe on touch screens
  let x0 = null;
  img.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  img.addEventListener("touchend", (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
  });

  return { open, close };
}
