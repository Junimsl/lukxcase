// Public catalog: theme filter (dropdown beside the results title), results header, product grid (paged + lazy images), empty state.

import { h, icons } from "./dom.js";
import { ALL, UNCLASSIFIED, categoryMap, effectiveCategories, filterEntries, filterProducts } from "../services/categories.js";
import { store } from "../services/store.js";
import { cart } from "../services/cart.js";
import { qtyStepper } from "./cart.js";

const PAGE = 24;

export function createCatalog({ onAdd, menuEl, menuBtn, gridEl, titleEl, summaryEl, emptyEl, sentinelEl, searchInput, onOpen, onStateChange }) {
  const view = { category: ALL, query: "", shown: PAGE, list: [] };
  let io;

  function setCategory(id, { focus = false } = {}) {
    view.category = id; view.shown = PAGE;
    render();
    onStateChange?.(view);
    if (focus) menuBtn.focus();
  }
  function setQuery(q) { view.query = q; view.shown = PAGE; render(); onStateChange?.(view); }

  // ---------- theme dropdown ----------
  const check = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

  function renderMenu(catalog, products) {
    const entries = filterEntries(catalog, products);
    if (!entries.some((e) => e.id === view.category)) view.category = ALL;
    menuEl.replaceChildren(...entries.map((e) => {
      const selected = e.id === view.category;
      return h("li", {
        role: "option", id: `opt-${e.id}`, class: `filter-opt${e.review ? " review" : ""}`, "aria-selected": String(selected),
        tabindex: selected ? "0" : "-1", dataset: { id: e.id },
      }, h("span", { class: "check", html: selected ? check : "" }), h("span", { class: "name", text: e.name }),
        h("span", { class: "count", text: e.count, "aria-label": `${e.count} capinhas` }));
    }));
    menuBtn.classList.toggle("active", view.category !== ALL);
  }

  const options = () => [...menuEl.querySelectorAll('[role="option"]')];
  function focusOption(el) { options().forEach((o) => { o.tabIndex = o === el ? 0 : -1; }); el?.focus(); }
  function openMenu(focusSelected = true) {
    menuEl.hidden = false;
    menuBtn.setAttribute("aria-expanded", "true");
    if (focusSelected) focusOption(menuEl.querySelector('[aria-selected="true"]') || options()[0]);
  }
  function closeMenu(returnFocus = false) {
    if (menuEl.hidden) return;
    menuEl.hidden = true;
    menuBtn.setAttribute("aria-expanded", "false");
    if (returnFocus) menuBtn.focus();
  }
  function choose(el) { if (!el) return; closeMenu(true); setCategory(el.dataset.id); }

  menuBtn.addEventListener("click", () => (menuEl.hidden ? openMenu() : closeMenu()));
  menuBtn.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); openMenu(); }
  });
  menuEl.addEventListener("click", (e) => choose(e.target.closest('[role="option"]')));
  menuEl.addEventListener("keydown", (e) => {
    const list = options(); const i = list.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); focusOption(list[Math.min(i + 1, list.length - 1)]); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusOption(list[Math.max(i - 1, 0)]); }
    else if (e.key === "Home") { e.preventDefault(); focusOption(list[0]); }
    else if (e.key === "End") { e.preventDefault(); focusOption(list[list.length - 1]); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(document.activeElement.closest('[role="option"]')); }
    else if (e.key === "Escape") { e.preventDefault(); closeMenu(true); }
    else if (e.key === "Tab") closeMenu();
  });
  document.addEventListener("pointerdown", (e) => { if (!e.target.closest(".filter-dd")) closeMenu(); });

  function card(p, cmap, index) {
    const cats = effectiveCategories(p, cmap);
    const img = h("img", {
      src: store.imageSrc(p), alt: `Capinha ${p.name}`, loading: index < 8 ? "eager" : "lazy", decoding: "async",
      width: p.width || 550, height: p.height || 550, class: "loading",
    });
    img.addEventListener("load", () => img.classList.remove("loading"), { once: true });
    img.addEventListener("error", () => img.classList.remove("loading"), { once: true });
    return h("article", { class: "card" },
      h("button", { type: "button", class: "card-media", "aria-label": `Ampliar ${p.name}`, onclick: () => onOpen(p.id, view.list.map((x) => x.id)) },
        img, h("span", { class: "zoom", html: icons.zoom })),
      h("div", { class: "card-body" },
        h("h3", { class: "card-title", text: p.name }),
        h("div", { class: "tags" }, cats.map((id) => h("span", { class: `tag${id === UNCLASSIFIED.id ? " review" : ""}`, text: cmap.get(id)?.name || id }))),
        cartControl(p),
      ));
  }

  // "Adicionar" button, or a quantity stepper once the case is in the cart.
  function cartControl(p) {
    const slot = h("div", { class: "card-cart", dataset: { cartId: p.id } });
    fillCartControl(slot, p);
    return slot;
  }
  function fillCartControl(slot, p) {
    slot.replaceChildren(cart.qty(p.id)
      ? qtyStepper(p.id, { label: p.name })
      : h("button", { type: "button", class: "btn small add-btn", "aria-label": `Adicionar ${p.name} ao carrinho`, onclick: () => { cart.add(p.id); onAdd?.(p); } },
          h("span", { html: icons.plus }), "Adicionar"));
  }
  cart.subscribe(() => {
    const byId = new Map(store.publicProducts().map((p) => [p.id, p]));
    const focusId = document.activeElement?.closest?.(".card-cart")?.dataset.cartId;
    gridEl.querySelectorAll(".card-cart").forEach((slot) => {
      const p = byId.get(slot.dataset.cartId);
      if (p) fillCartControl(slot, p);
    });
    if (focusId) gridEl.querySelector(`.card-cart[data-cart-id="${CSS.escape(focusId)}"] button`)?.focus();
  });

  function render() {
    const catalog = store.catalog;
    if (!catalog) return;
    const products = store.publicProducts();
    renderMenu(catalog, products);
    const cmap = categoryMap(catalog);
    view.list = filterProducts(catalog, products, view);

    const catName = view.category === ALL ? "Todas as capinhas" : cmap.get(view.category)?.name || "";
    titleEl.textContent = catName;
    const n = view.list.length;
    summaryEl.replaceChildren(
      `${n} ${n === 1 ? "capinha" : "capinhas"}`,
      view.query ? ` para “${view.query}”` : "",
      ...(view.query || view.category !== ALL ? [" · ", h("button", { type: "button", class: "linkish", text: "Limpar filtros", onclick: reset })] : []),
    );

    if (!n) {
      gridEl.replaceChildren();
      emptyEl.hidden = false;
      const msg = emptyEl.querySelector("[data-empty-msg]");
      msg.textContent = view.query
        ? `Não achamos capinhas para “${view.query}”${view.category !== ALL ? ` em ${catName}` : ""}. Confira a grafia ou tente outro termo, como um personagem ou time.`
        : `Ainda não há capinhas em ${catName}.`;
      emptyEl.querySelector("[data-clear-search]").hidden = !view.query;
      emptyEl.querySelector("[data-all]").hidden = view.category === ALL && !view.query;
      sentinelEl.hidden = true;
      return;
    }
    emptyEl.hidden = true;
    gridEl.replaceChildren(...view.list.slice(0, view.shown).map((p, i) => card(p, cmap, i)));
    sentinelEl.hidden = view.shown >= n;
  }

  function more() {
    if (view.shown >= view.list.length) return;
    const cmap = categoryMap(store.catalog);
    const next = view.list.slice(view.shown, view.shown + PAGE);
    gridEl.append(...next.map((p, i) => card(p, cmap, view.shown + i)));
    view.shown += next.length;
    sentinelEl.hidden = view.shown >= view.list.length;
  }

  function reset() {
    searchInput.value = "";
    searchInput.dispatchEvent(new Event("input"));
    view.query = ""; setCategory(ALL);
  }

  function skeleton(count = 8) {
    gridEl.replaceChildren(...Array.from({ length: count }, () => h("div", { class: "card skeleton", "aria-hidden": "true" },
      h("div", { class: "card-media" }), h("div", { class: "card-body" }, h("div", { class: "bar" }), h("div", { class: "bar short" })))));
  }

  if ("IntersectionObserver" in window) {
    io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && more(), { rootMargin: "600px 0px" });
    io.observe(sentinelEl);
  }
  emptyEl.querySelector("[data-clear-search]").addEventListener("click", () => { searchInput.value = ""; searchInput.dispatchEvent(new Event("input")); setQuery(""); searchInput.focus(); });
  emptyEl.querySelector("[data-all]").addEventListener("click", reset);

  return { view, render, setCategory, setQuery, skeleton, reset };
}
