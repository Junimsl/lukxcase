// LUKX CASE catalog — bootstrap and routing.
//   #            → catalog (all cases)
//   #<category>  → catalog filtered by that category (e.g. #marvel)
//   #admin       → admin area (editors only)

import { store } from "./services/store.js";
import { platform } from "./services/platform.js";
import { ALL } from "./services/categories.js";
import { createCatalog } from "./ui/catalog.js";
import { createViewer } from "./ui/modal.js";
import { createAdmin, renderNoAccess } from "./ui/admin.js";
import { h, icons, toast } from "./ui/dom.js";
import { cart } from "./services/cart.js";
import { createCartDrawer } from "./ui/cart.js";

const $ = (s) => document.querySelector(s);
const els = {
  header: $(".site-header"),
  publicView: $("#public-view"),
  adminView: $("#admin-view"),
  search: $("#search"),
  searchClear: $("#search-clear"),
  manageLink: $("#manage-link"),
  catalogLink: $("#catalog-link"),
  heroCount: $("#stat-products"),
  heroThemes: $("#stat-themes"),
};

// Sticky filter bar sits right under the header, whatever its wrapped height.
new ResizeObserver(() => document.documentElement.style.setProperty("--header-h", els.header.offsetHeight + "px")).observe(els.header);

const drawer = createCartDrawer();
const onAdd = (p) => toast(`“${p.name}” no carrinho.`);
const viewer = createViewer({ onCategory: (id) => { catalog.setCategory(id); location.hash = id; scrollToResults(); }, onOpenCart: () => drawer.open(), onAdd });

// Header cart button + badge
const cartBtn = $("#cart-btn"), cartBadge = $("#cart-badge");
function renderCartBadge() {
  const n = cart.count();
  cartBadge.hidden = n === 0;
  cartBadge.textContent = n > 99 ? "99+" : n;
  cartBadge.classList.remove("bump"); void cartBadge.offsetWidth; if (n) cartBadge.classList.add("bump");
  cartBtn.setAttribute("aria-label", n ? `Abrir carrinho, ${n} ${n === 1 ? "capinha" : "capinhas"}` : "Abrir carrinho");
}
cartBtn.addEventListener("click", () => drawer.open());
cart.subscribe(renderCartBadge);
renderCartBadge();
const catalog = createCatalog({
  onAdd,
  menuEl: $("#filter-menu"), menuBtn: $("#filter-btn"), gridEl: $("#grid"), titleEl: $("#results-title"), summaryEl: $("#results-summary"),
  emptyEl: $("#empty"), sentinelEl: $("#sentinel"), searchInput: els.search,
  onOpen: (id, ids) => viewer.open(id, ids),
  onStateChange: (v) => {
    const want = v.category === ALL ? "" : v.category;
    if (location.hash.slice(1) !== want && location.hash !== "#admin") {
      history.replaceState(null, "", want ? "#" + want : location.pathname + location.search);
    }
  },
});
let admin = null;
let canManage = false;

function scrollToResults() {
  const top = $("#results").getBoundingClientRect().top + scrollY - els.header.offsetHeight - 8;
  if (scrollY > top) scrollTo({ top, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

// ---------- search ----------
let t;
els.search.addEventListener("input", () => {
  els.searchClear.hidden = !els.search.value;
  clearTimeout(t);
  t = setTimeout(() => {
    if (location.hash === "#admin") location.hash = "";
    catalog.setQuery(els.search.value.trim());
  }, 120);
});
els.search.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); scrollToResults(); } if (e.key === "Escape") { els.search.value = ""; els.search.dispatchEvent(new Event("input")); } });
els.searchClear.addEventListener("click", () => { els.search.value = ""; els.search.dispatchEvent(new Event("input")); els.search.focus(); });
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && !/input|textarea|select/i.test(document.activeElement?.tagName) && !document.querySelector("dialog[open]")) { e.preventDefault(); els.search.focus(); }
});

// ---------- routing ----------
function route() {
  const hash = decodeURIComponent(location.hash.slice(1));
  const isAdmin = hash === "admin";
  els.publicView.hidden = isAdmin;
  els.adminView.hidden = !isAdmin;
  els.catalogLink.setAttribute("aria-current", isAdmin ? "false" : "page");
  els.manageLink.setAttribute("aria-current", isAdmin ? "page" : "false");
  if (isAdmin) {
    viewer.close();
    if (!store.catalog) return;
    if (canManage) { admin ||= createAdmin(els.adminView); admin.render(); }
    else renderNoAccess(els.adminView);
    scrollTo(0, 0);
    return;
  }
  if (!store.catalog) return;
  const exists = hash && store.catalog.categories.some((c) => c.id === hash) || hash === "nao-classificadas";
  catalog.setCategory(exists ? hash : ALL);
}
addEventListener("hashchange", route);

// Warn before leaving with unsaved admin changes.
addEventListener("beforeunload", (e) => { if (store.isDirty()) { e.preventDefault(); e.returnValue = ""; } });

// ---------- hero ----------
function renderHero() {
  const products = store.publicProducts();
  els.heroCount.textContent = products.length;
  const used = new Set(products.flatMap((p) => p.categories));
  els.heroThemes.textContent = store.catalog.categories.filter((c) => used.has(c.id)).length;
}

// Center the hero art in the free space between the end of the title and the right edge of the screen.
function placeHeroArt() {
  const img = document.querySelector(".hero-art img");
  const title = document.querySelector("#hero-title");
  if (!img || !title) return;
  img.style.transform = "";
  if (innerWidth <= 820) return; // stacked layout on small screens
  const range = document.createRange();
  range.selectNodeContents(title);
  const titleRight = Math.max(...[...range.getClientRects()].map((r) => r.right));
  const box = img.getBoundingClientRect();
  const viewport = document.documentElement.clientWidth;
  let left = (titleRight + viewport) / 2 - box.width / 2;
  left = Math.min(left, viewport - box.width - 16); // never past the right edge
  left = Math.max(left, titleRight + 16);           // never over the title
  img.style.transform = `translateX(${Math.round(left - box.left)}px)`;
}
addEventListener("resize", placeHeroArt);
document.fonts?.ready.then(placeHeroArt);
document.querySelector(".hero-art img")?.addEventListener("load", placeHeroArt);
placeHeroArt();

// ---------- boot ----------
catalog.skeleton();
store.subscribe((reason) => {
  if (reason === "saving") return;
  renderHero();
  if (els.publicView.hidden) return;
  catalog.render();
});

(async () => {
  try {
    await store.load();
  } catch (e) {
    $("#grid").replaceChildren(h("div", { class: "empty" },
      h("h3", { text: "Catálogo indisponível" }),
      h("p", { text: "Não conseguimos carregar as capinhas agora. Recarregue a página em instantes." })));
    return;
  }
  route();
  if (!els.publicView.hidden) catalog.render();
  cart.prune(new Set(store.publicProducts().map((p) => p.id)));
  renderCartBadge();
  store.subscribe(() => drawer.render());

  canManage = await platform.canManage();
  els.manageLink.hidden = !canManage;
  if (location.hash === "#admin") route();
})();
