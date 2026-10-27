// Categories, counts, filtering and search. Categories are data (catalog.categories),
// so new themes appear in the filter bar without code changes.

export const ALL = "todas";
export const UNCLASSIFIED = { id: "nao-classificadas", name: "Não classificadas", keywords: ["revisão"], system: true };

export function normalizeText(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function slugify(name) {
  return normalizeText(name).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "categoria";
}

export function categoryMap(catalog) {
  const m = new Map(catalog.categories.map((c) => [c.id, c]));
  m.set(UNCLASSIFIED.id, UNCLASSIFIED);
  return m;
}

export function categoryName(catalog, id) {
  return categoryMap(catalog).get(id)?.name || id;
}

/** Ensure every product has at least one known category; unknown/empty -> Não classificadas. */
export function effectiveCategories(product, cmap) {
  const known = (product.categories || []).filter((id) => cmap.has(id));
  return known.length ? known : [UNCLASSIFIED.id];
}

/** Filter-bar entries with live counts, in catalog order. */
export function filterEntries(catalog, products) {
  const cmap = categoryMap(catalog);
  const counts = new Map();
  for (const p of products) for (const id of effectiveCategories(p, cmap)) counts.set(id, (counts.get(id) || 0) + 1);
  const entries = [{ id: ALL, name: "Todas as capinhas", count: products.length }];
  for (const c of catalog.categories) entries.push({ id: c.id, name: c.name, count: counts.get(c.id) || 0 });
  const review = counts.get(UNCLASSIFIED.id) || 0;
  if (review) entries.push({ id: UNCLASSIFIED.id, name: UNCLASSIFIED.name, count: review, review: true });
  return entries;
}

function haystack(product, cmap) {
  const cats = effectiveCategories(product, cmap).map((id) => cmap.get(id)).filter(Boolean);
  return normalizeText([
    product.name,
    product.description,
    ...(product.keywords || []),
    ...cats.map((c) => c.name),
    ...cats.flatMap((c) => c.keywords || []),
    product.personalizavel ? "personalizavel personalizada nome" : "",
  ].join(" "));
}

/** Combined category + text search. Every word of the query must match. */
export function filterProducts(catalog, products, { category = ALL, query = "" } = {}) {
  const cmap = categoryMap(catalog);
  const words = normalizeText(query).split(/\s+/).filter(Boolean);
  return products.filter((p) => {
    if (category !== ALL && !effectiveCategories(p, cmap).includes(category)) return false;
    if (!words.length) return true;
    const h = haystack(p, cmap);
    return words.every((w) => h.includes(w));
  });
}
