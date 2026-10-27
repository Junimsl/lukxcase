// Admin area: add cases (batch upload → duplicate check → visual classification → review),
// edit/hide/delete products, manage categories, review duplicates, save & export.
// Shown only to viewers who can edit this artifact on claude.ai; saving is enforced server-side.

import { h, icons, toast } from "./dom.js";
import { store } from "../services/store.js";
import { platform } from "../services/platform.js";
import { UNCLASSIFIED, categoryMap, effectiveCategories, normalizeText, slugify } from "../services/categories.js";
import { sha256Hex, decode, dims, dHash, hamming, toJpeg, extensionFor } from "../services/images.js";
import { classifierStatus, classifyImages } from "../services/classifier.js";
import { waNumber } from "../services/cart.js";
import { KEY_TYPES, normalizeKey, plain } from "../services/pix.js";

const SIMILAR_MAX_DISTANCE = 40; // artwork-hash bits (of 256): re-encoded/resized copies land at ~5–30, distinct designs at 80+

export function createAdmin(root) {
  const ui = {
    tab: "add",
    queue: [],
    productQuery: "",
    productFilter: "all",
    expanded: null,
    confirmDelete: null,
    confirmCat: null,
    similarPairs: null,
    scanning: false,
    suggestions: new Map(), // productId -> classification result
    busy: false,
  };
  const hashCache = new Map(); // productId -> dHash
  let classifier = { available: false, reason: "Verificando o classificador…" };
  let abortCtl = null;

  classifierStatus().then((s) => { classifier = s; render(); });
  store.subscribe((reason) => { if (root.isConnected && !root.hidden && reason !== "load") render(); });

  // ---------- helpers ----------
  const cats = () => store.catalog.categories;
  const cmap = () => categoryMap(store.catalog);
  const productById = (id) => store.catalog.products.find((p) => p.id === id);
  const now = () => new Date().toISOString();
  const newId = () => "lx-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  async function productHash(p) {
    if (hashCache.has(p.id)) return hashCache.get(p.id);
    try {
      const bmp = await decode(store.imageSrc(p));
      const hsh = dHash(bmp);
      hashCache.set(p.id, hsh);
      return hsh;
    } catch { return null; }
  }

  function categoryToggles(selected, onToggle, extra = []) {
    const all = [...cats(), ...extra];
    return h("div", { class: "toggle-row", role: "group", "aria-label": "Categorias" },
      all.map((c) => h("button", {
        type: "button", class: `toggle${c.suggested ? " suggested" : ""}`, "aria-pressed": String(selected.includes(c.id)),
        onclick: () => onToggle(c.id),
      }, c.suggested ? `+ ${c.name} (nova)` : c.name)),
      !selected.length ? h("span", { class: "tag review", text: UNCLASSIFIED.name }) : null);
  }

  // ---------- upload pipeline ----------
  async function addFiles(fileList) {
    const files = [...fileList].filter((f) => f.type.startsWith("image/") || extensionFor(f));
    if (!files.length) { toast("Nenhuma imagem reconhecida. Use AVIF, WebP, PNG ou JPG."); return; }
    const items = files.map((file) => ({
      key: Math.random().toString(36).slice(2), file, status: "reading", include: true,
      name: "", categories: [], keywords: [], description: "", personalizavel: false, newCategory: null,
      previewUrl: URL.createObjectURL(file),
    }));
    ui.queue.push(...items);
    ui.tab = "add";
    render();

    // 1) fingerprints
    for (const it of items) {
      const ext = extensionFor(it.file);
      if (!ext) { it.status = "error"; it.error = "Formato não aceito."; it.include = false; continue; }
      it.ext = ext;
      try {
        it.sha256 = await sha256Hex(it.file);
        const bmp = await decode(it.file);
        Object.assign(it, dims(bmp));
        it.dhash = dHash(bmp);
        it.jpeg = await toJpeg(bmp);
        it.status = "checking";
      } catch {
        it.status = "error"; it.error = "Não foi possível ler esta imagem."; it.include = false;
      }
      render();
    }

    // 2) duplicates: exact (same bytes) and visual (near-identical image)
    const products = store.catalog.products;
    for (const it of items.filter((x) => x.status === "checking")) {
      const exact = products.find((p) => p.sha256 && p.sha256 === it.sha256)
        || ui.queue.find((q) => q !== it && q.sha256 === it.sha256 && q.status !== "duplicate" && ui.queue.indexOf(q) < ui.queue.indexOf(it));
      if (exact) {
        it.status = "duplicate"; it.include = false;
        it.dupOf = exact.id ? { id: exact.id, name: exact.name } : { name: exact.file?.name || "outra imagem deste lote" };
        continue;
      }
      let best = null;
      for (const p of products) {
        const ph = await productHash(p);
        const d = hamming(it.dhash, ph);
        if (d <= SIMILAR_MAX_DISTANCE && (!best || d < best.d)) best = { p, d };
      }
      if (best) { it.status = "similar"; it.include = false; it.dupOf = { id: best.p.id, name: best.p.name, distance: best.d }; }
      else it.status = "queued";
    }
    render();

    // 3) visual classification
    await classifyQueue(items.filter((x) => x.status === "queued" || x.status === "similar"));
  }

  async function classifyQueue(items) {
    if (!items.length) return;
    if (!classifier.available) {
      for (const it of items) { if (it.status === "queued") it.status = "ready"; it.note = classifier.reason; }
      render(); return;
    }
    abortCtl = new AbortController();
    for (const it of items) it.analyzing = true;
    ui.busy = true; render();
    const results = await classifyImages(items, cats(), { signal: abortCtl.signal, onProgress: ({ done, total }) => { ui.progress = `${done} de ${total}`; render(); } });
    results.forEach((r, i) => applyResult(items[i], r));
    for (const it of items) it.analyzing = false;
    ui.busy = false; ui.progress = null; abortCtl = null;
    render();
  }

  function applyResult(it, r) {
    if (it.status === "queued") it.status = "ready";
    if (!r || r.error) { it.note = r?.error || "Sem resposta da análise."; it.result = null; return; }
    it.result = r;
    it.note = null;
    it.name = it.name || r.name || baseName(it.file.name);
    it.keywords = r.keywords; it.description = r.description; it.personalizavel = r.personalizavel;
    it.categories = [...r.categories];
    if (r.newCategory) {
      const id = slugify(r.newCategory.id || r.newCategory.name);
      const existing = cats().find((c) => c.id === id || normalizeText(c.name) === normalizeText(r.newCategory.name));
      if (existing) { if (!it.categories.includes(existing.id)) it.categories.push(existing.id); }
      else { it.newCategory = { id, name: r.newCategory.name, suggested: true }; it.categories.push(id); }
    }
  }

  const baseName = (n) => (n || "Nova capinha").replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim().slice(0, 48);

  async function commitQueue() {
    const ready = ui.queue.filter((it) => it.include && ["ready", "similar"].includes(it.status) && !it.analyzing);
    if (!ready.length) return;
    const stamp = now();
    store.mutate((c) => {
      for (const it of ready) {
        if (it.newCategory && it.categories.includes(it.newCategory.id) && !c.categories.some((x) => x.id === it.newCategory.id)) {
          c.categories.push({ id: it.newCategory.id, name: it.newCategory.name, keywords: [], order: c.categories.length, createdAt: stamp, createdBy: "classificação visual" });
        }
        const id = newId();
        const path = `img/cases/${id}.${it.ext}`;
        store.addImage(path, it.file);
        hashCache.set(id, it.dhash);
        c.products.unshift({
          id, name: it.name || baseName(it.file.name), image: path, sourceFile: it.file.name,
          sha256: it.sha256, dhash: it.dhash, bytes: it.file.size, width: it.width, height: it.height,
          categories: it.categories.filter((x) => x !== UNCLASSIFIED.id),
          keywords: it.keywords || [], personalizavel: !!it.personalizavel, description: it.description || "",
          classification: it.result
            ? { method: "visual", by: "Claude (análise visual)", confidence: it.result.confidence, evidence: it.result.evidence, at: stamp, manual: it.touched || false }
            : { method: "manual", by: "Administrador", at: stamp, manual: true },
          createdAt: stamp, updatedAt: stamp,
        });
      }
      for (const it of ui.queue.filter((q) => q.status === "duplicate")) {
        if (c.duplicates.some((d) => d.sha256 === it.sha256)) continue;
        c.duplicates.push({ file: it.file.name, sha256: it.sha256, duplicateOf: it.dupOf?.id || null, detectedAt: stamp });
      }
    }, "add");
    ui.queue = ui.queue.filter((it) => !ready.includes(it) && it.status !== "duplicate");
    await save(`${ready.length} ${ready.length === 1 ? "capinha adicionada" : "capinhas adicionadas"} ao catálogo.`);
  }

  async function save(successMsg = "Catálogo salvo.") {
    const res = await store.save();
    if (res.ok) toast(successMsg);
    else toast(res.message, 6000);
    render();
    return res;
  }

  // ---------- product actions ----------
  function editProduct(id, fn) {
    store.mutate((c) => {
      const p = c.products.find((x) => x.id === id);
      if (!p) return;
      fn(p);
      p.updatedAt = now();
    });
  }

  async function reclassify(p) {
    if (!classifier.available) { toast(classifier.reason, 5000); return; }
    ui.suggestions.set(p.id, { loading: true }); render();
    try {
      const bmp = await decode(store.imageSrc(p));
      const [r] = await classifyImages([{ jpeg: await toJpeg(bmp) }], cats());
      ui.suggestions.set(p.id, r);
    } catch {
      ui.suggestions.set(p.id, { error: "Não foi possível ler a imagem para análise." });
    }
    render();
  }

  function applySuggestion(p, r) {
    editProduct(p.id, (x) => {
      let catsNew = [...r.categories];
      if (r.newCategory) {
        const id = slugify(r.newCategory.id || r.newCategory.name);
        if (!store.catalog.categories.some((c) => c.id === id)) {
          store.catalog.categories.push({ id, name: r.newCategory.name, keywords: [], order: store.catalog.categories.length, createdAt: now(), createdBy: "classificação visual" });
        }
        catsNew.push(id);
      }
      x.categories = catsNew;
      if (r.keywords?.length) x.keywords = r.keywords;
      if (r.description && !x.description) x.description = r.description;
      x.classification = { method: "visual", by: "Claude (análise visual)", confidence: r.confidence, evidence: r.evidence, at: now(), manual: false };
    });
    ui.suggestions.delete(p.id);
  }

  function deleteProduct(p) {
    store.removeImage(p.image);
    store.mutate((c) => { c.products = c.products.filter((x) => x.id !== p.id); }, "delete");
    hashCache.delete(p.id);
    ui.expanded = null; ui.confirmDelete = null;
    toast(`“${p.name}” removida. Salve para publicar.`);
  }

  // ---------- similar scan ----------
  async function scanSimilar() {
    ui.scanning = true; ui.similarPairs = null; render();
    const ps = store.catalog.products;
    const hashes = [];
    for (const p of ps) hashes.push(await productHash(p));
    const pairs = [];
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      const d = hamming(hashes[i], hashes[j]);
      if (d <= SIMILAR_MAX_DISTANCE) pairs.push({ a: ps[i], b: ps[j], d });
    }
    ui.similarPairs = pairs.sort((x, y) => x.d - y.d);
    ui.scanning = false; render();
  }

  // ---------- views ----------
  function viewAdd() {
    const input = h("input", { type: "file", id: "admin-upload", multiple: true, accept: "image/avif,image/webp,image/png,image/jpeg,image/gif", class: "sr-only" });
    input.addEventListener("change", () => { addFiles(input.files); input.value = ""; });
    const drop = h("label", { class: "dropzone", for: "admin-upload" },
      h("span", { class: "dz-icon", html: icons.upload }),
      h("strong", { text: "Arraste as imagens das capinhas para cá" }),
      h("span", { text: "ou clique para escolher. Envie uma ou várias de uma vez (AVIF, WebP, PNG, JPG)." }));
    ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
    drop.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));

    const status = h("p", { class: `ai-status${classifier.available ? " on" : ""}` },
      h("span", { class: "dot" }),
      classifier.available
        ? "Classificação visual ativa: o Claude analisa cada imagem (personagens, escudos, símbolos, textos e cores) e sugere categorias, nome e palavras-chave. Você revisa antes de publicar."
        : classifier.reason + " Você ainda pode adicionar e categorizar manualmente.");

    const counts = { ready: 0, dup: 0, similar: 0 };
    for (const it of ui.queue) {
      if (it.include && ["ready", "similar"].includes(it.status) && !it.analyzing) counts.ready++;
      if (it.status === "duplicate") counts.dup++;
      if (it.status === "similar" && !it.include) counts.similar++;
    }

    const list = ui.queue.length ? h("div", { class: "queue" }, ui.queue.map(queueItem)) : null;
    const footer = ui.queue.length ? h("div", { class: "queue-footer" },
      h("p", {}, `${counts.ready} prontas para publicar`, counts.dup ? ` · ${counts.dup} duplicada(s) ignorada(s)` : "", counts.similar ? ` · ${counts.similar} parecida(s) aguardando decisão` : "",
        ui.busy && ui.progress ? ` · analisando ${ui.progress}` : ""),
      h("div", { class: "row" },
        ui.busy ? h("button", { type: "button", class: "btn", text: "Parar análise", onclick: () => abortCtl?.abort() }) : null,
        h("button", { type: "button", class: "btn", text: "Limpar lista", disabled: ui.busy, onclick: () => { ui.queue.forEach((q) => URL.revokeObjectURL(q.previewUrl)); ui.queue = []; render(); } }),
        h("button", { type: "button", class: "btn primary", disabled: !counts.ready || ui.busy || store.saving, onclick: commitQueue },
          store.saving ? "Salvando…" : `Adicionar ${counts.ready || ""} ao catálogo e salvar`))) : null;

    return h("section", { class: "panel" }, drop, input, status, list, footer);
  }

  function queueItem(it) {
    const badge = {
      reading: ["Lendo imagem…", ""], checking: ["Verificando duplicatas…", ""], queued: ["Na fila de análise", ""],
      ready: [it.result ? `Classificada · ${Math.round(it.result.confidence * 100)}% de confiança` : "Pronta (categorize manualmente)", it.result ? "ok" : "warn"],
      duplicate: [`Duplicata de “${it.dupOf?.name}” — não será publicada`, "bad"],
      similar: [`Muito parecida com “${it.dupOf?.name}”`, "warn"],
      error: [it.error || "Erro", "bad"],
    }[it.status] || ["", ""];
    const label = it.analyzing ? ["Analisando com Claude…", "busy"] : badge;
    const editable = ["ready", "similar"].includes(it.status) && !it.analyzing;
    const extra = it.newCategory ? [it.newCategory] : [];

    return h("article", { class: `qitem ${it.include ? "" : "excluded"}` },
      h("img", { src: it.previewUrl, alt: "", class: "qthumb" }),
      h("div", { class: "qbody" },
        h("div", { class: "qhead" },
          h("span", { class: `badge ${label[1]}`, text: label[0] }),
          h("span", { class: "file", text: it.file.name })),
        editable ? h("input", {
          type: "text", class: "field", value: it.name, placeholder: "Nome da capinha", "aria-label": "Nome da capinha", id: `q-name-${it.key}`,
          oninput: (e) => { it.name = e.target.value; },
        }) : null,
        editable ? categoryToggles(it.categories, (id) => {
          it.touched = true;
          it.categories = it.categories.includes(id) ? it.categories.filter((x) => x !== id) : [...it.categories, id];
          render();
        }, extra) : null,
        it.result?.evidence && editable ? h("p", { class: "evidence" }, h("span", { html: icons.sparkle }), it.result.evidence) : null,
        it.note ? h("p", { class: "evidence warn", text: it.note }) : null),
      h("div", { class: "qactions" },
        it.status === "similar" ? h("button", { type: "button", class: "btn small", text: it.include ? "Não adicionar" : "Adicionar mesmo assim", onclick: () => { it.include = !it.include; render(); } }) : null,
        editable && classifier.available ? h("button", { type: "button", class: "btn small", text: "Reclassificar", disabled: ui.busy, onclick: () => { it.name = ""; classifyQueue([it]); } }) : null,
        h("button", { type: "button", class: "btn small", text: "Remover", disabled: it.analyzing, onclick: () => { URL.revokeObjectURL(it.previewUrl); ui.queue = ui.queue.filter((q) => q !== it); render(); } })));
  }

  function viewProducts() {
    const m = cmap();
    const q = normalizeText(ui.productQuery);
    let list = store.catalog.products;
    if (ui.productFilter === "hidden") list = list.filter((p) => p.hidden);
    else if (ui.productFilter !== "all") list = list.filter((p) => effectiveCategories(p, m).includes(ui.productFilter));
    if (q) list = list.filter((p) => normalizeText([p.name, p.id, ...(p.keywords || []), ...effectiveCategories(p, m).map((id) => m.get(id)?.name)].join(" ")).includes(q));

    const search = h("input", { type: "search", class: "field", id: "admin-product-search", placeholder: "Buscar por nome, tema ou código", value: ui.productQuery, "aria-label": "Buscar produtos" });
    search.addEventListener("input", () => { ui.productQuery = search.value; renderKeepFocus("admin-product-search"); });
    const select = h("select", { class: "field", id: "admin-product-filter", "aria-label": "Filtrar por categoria" },
      h("option", { value: "all", text: "Todas as categorias" }),
      ...cats().map((c) => h("option", { value: c.id, text: c.name })),
      h("option", { value: UNCLASSIFIED.id, text: UNCLASSIFIED.name }),
      h("option", { value: "hidden", text: "Ocultas" }));
    select.value = ui.productFilter;
    select.addEventListener("change", () => { ui.productFilter = select.value; render(); });

    return h("section", { class: "panel" },
      h("div", { class: "toolbar" }, search, select, h("span", { class: "muted", text: `${list.length} de ${store.catalog.products.length}` })),
      h("div", { class: "plist" }, list.length ? list.map((p) => productRow(p, m)) : h("p", { class: "muted", text: "Nenhum produto encontrado com esses filtros." })));
  }

  function productRow(p, m) {
    const open = ui.expanded === p.id;
    const effective = effectiveCategories(p, m);
    const row = h("article", { class: `prow${open ? " open" : ""}${p.hidden ? " is-hidden" : ""}` },
      h("button", { type: "button", class: "prow-head", "aria-expanded": String(open), onclick: () => { ui.expanded = open ? null : p.id; ui.confirmDelete = null; render(); } },
        h("img", { src: store.imageSrc(p), alt: "", loading: "lazy", class: "pthumb" }),
        h("span", { class: "pmain" },
          h("strong", { text: p.name }),
          h("span", { class: "tags" },
            effective.map((id) => h("span", { class: `tag${id === UNCLASSIFIED.id ? " review" : ""}`, text: m.get(id)?.name || id })),
            p.hidden ? h("span", { class: "tag solid", text: "Oculta" }) : null,
            p.classification?.manual ? h("span", { class: "tag", text: "Ajuste manual" }) : null)),
        h("span", { class: "pcode", text: p.id.toUpperCase() }),
        h("span", { class: "chev", html: open ? icons.up : icons.down })));
    if (open) row.append(productEditor(p));
    return row;
  }

  function productEditor(p) {
    const sug = ui.suggestions.get(p.id);
    const name = h("input", { type: "text", class: "field", id: `p-name-${p.id}`, value: p.name, "aria-label": "Nome" });
    name.addEventListener("change", () => editProduct(p.id, (x) => { x.name = name.value.trim() || x.name; }));
    const desc = h("textarea", { class: "field", id: `p-desc-${p.id}`, rows: 2, "aria-label": "Descrição" });
    desc.value = p.description || "";
    desc.addEventListener("change", () => editProduct(p.id, (x) => { x.description = desc.value.trim(); }));
    const kw = h("input", { type: "text", class: "field", id: `p-kw-${p.id}`, value: (p.keywords || []).join(", "), "aria-label": "Palavras-chave" });
    kw.addEventListener("change", () => editProduct(p.id, (x) => { x.keywords = kw.value.split(",").map((s) => s.trim()).filter(Boolean); }));
    const pers = h("input", { type: "checkbox", id: `p-pers-${p.id}`, checked: !!p.personalizavel });
    pers.addEventListener("change", () => editProduct(p.id, (x) => { x.personalizavel = pers.checked; }));

    const c = p.classification || {};
    const source = c.method === "visual"
      ? `Classificada por ${c.by || "análise visual"}${c.confidence ? ` (${Math.round(c.confidence * 100)}%)` : ""}${c.manual ? ", com ajuste manual" : ""}.`
      : "Categorizada manualmente.";

    return h("div", { class: "editor" },
      h("div", { class: "editor-grid" },
        h("label", { class: "lbl", for: `p-name-${p.id}` }, "Nome", name),
        h("label", { class: "lbl", for: `p-kw-${p.id}` }, "Palavras-chave (separadas por vírgula)", kw),
        h("label", { class: "lbl wide", for: `p-desc-${p.id}` }, "Descrição", desc),
        h("label", { class: "check", for: `p-pers-${p.id}` }, pers, "Personalizável (arte com espaço para nome ou iniciais)")),
      h("div", { class: "lbl" }, "Categorias",
        categoryToggles(p.categories.filter((id) => cmap().has(id)), (id) => editProduct(p.id, (x) => {
          x.categories = x.categories.includes(id) ? x.categories.filter((y) => y !== id) : [...x.categories, id];
          x.classification = { ...(x.classification || {}), manual: true, at: now() };
        }))),
      h("p", { class: "muted small", text: source }),
      sug ? suggestionBox(p, sug) : null,
      h("div", { class: "row" },
        h("button", { type: "button", class: "btn small", disabled: !classifier.available || sug?.loading, onclick: () => reclassify(p) }, h("span", { html: icons.sparkle }), "Reclassificar com Claude"),
        h("button", { type: "button", class: "btn small", onclick: () => editProduct(p.id, (x) => { x.hidden = !x.hidden; }) },
          h("span", { html: p.hidden ? icons.eye : icons.eyeOff }), p.hidden ? "Mostrar no catálogo" : "Ocultar do catálogo"),
        ui.confirmDelete === p.id
          ? h("span", { class: "confirm" }, "Excluir de vez, com a imagem?",
              h("button", { type: "button", class: "btn small dark", text: "Sim, excluir", onclick: () => deleteProduct(p) }),
              h("button", { type: "button", class: "btn small", text: "Cancelar", onclick: () => { ui.confirmDelete = null; render(); } }))
          : h("button", { type: "button", class: "btn small", onclick: () => { ui.confirmDelete = p.id; render(); } }, h("span", { html: icons.trash }), "Excluir")));
  }

  function suggestionBox(p, s) {
    if (s.loading) return h("div", { class: "suggest" }, h("span", { class: "badge busy", text: "Analisando com Claude…" }));
    if (s.error) return h("div", { class: "suggest" }, h("p", { class: "evidence warn", text: s.error }));
    const m = cmap();
    const names = [...s.categories.map((id) => m.get(id)?.name || id), ...(s.newCategory ? [`${s.newCategory.name} (nova)`] : [])];
    return h("div", { class: "suggest" },
      h("p", {}, h("strong", { text: "Sugestão: " }), names.length ? names.join(", ") : UNCLASSIFIED.name, ` · ${Math.round(s.confidence * 100)}% de confiança`),
      s.evidence ? h("p", { class: "evidence" }, h("span", { html: icons.sparkle }), s.evidence) : null,
      h("div", { class: "row" },
        h("button", { type: "button", class: "btn small primary", text: "Aplicar sugestão", onclick: () => applySuggestion(p, s) }),
        h("button", { type: "button", class: "btn small", text: "Descartar", onclick: () => { ui.suggestions.delete(p.id); render(); } })));
  }

  function viewCategories() {
    const m = cmap();
    const counts = new Map();
    for (const p of store.catalog.products) for (const id of effectiveCategories(p, m)) counts.set(id, (counts.get(id) || 0) + 1);

    const nameIn = h("input", { type: "text", class: "field", id: "new-cat-name", placeholder: "Ex.: Dragon Ball", "aria-label": "Nome da nova categoria" });
    const form = h("form", { class: "toolbar" }, nameIn, h("button", { type: "submit", class: "btn primary", text: "Adicionar categoria" }));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const nm = nameIn.value.trim();
      if (!nm) return;
      let id = slugify(nm);
      if (id === UNCLASSIFIED.id || id === "todas" || id === "admin") id += "-1";
      if (cats().some((c) => c.id === id || normalizeText(c.name) === normalizeText(nm))) { toast("Essa categoria já existe."); return; }
      store.mutate((c) => c.categories.push({ id, name: nm, keywords: [], order: c.categories.length, createdAt: now() }));
      toast(`Categoria “${nm}” criada. Salve para publicar.`);
    });

    const rows = cats().map((c, i) => {
      const nm = h("input", { type: "text", class: "field", id: `cat-name-${c.id}`, value: c.name, "aria-label": `Nome da categoria ${c.name}` });
      nm.addEventListener("change", () => store.mutate((cat) => { const x = cat.categories.find((y) => y.id === c.id); if (nm.value.trim()) x.name = nm.value.trim(); }));
      const kw = h("input", { type: "text", class: "field", id: `cat-kw-${c.id}`, value: (c.keywords || []).join(", "), placeholder: "Sinônimos para a busca", "aria-label": `Palavras-chave de ${c.name}` });
      kw.addEventListener("change", () => store.mutate((cat) => { cat.categories.find((y) => y.id === c.id).keywords = kw.value.split(",").map((s) => s.trim()).filter(Boolean); }));
      const move = (d) => store.mutate((cat) => {
        const arr = cat.categories; const j = i + d;
        if (j < 0 || j >= arr.length) return;
        [arr[i], arr[j]] = [arr[j], arr[i]];
        arr.forEach((x, k) => { x.order = k; });
      });
      const n = counts.get(c.id) || 0;
      return h("div", { class: "crow" },
        h("div", { class: "order" },
          h("button", { type: "button", class: "icon-btn sm", "aria-label": `Mover ${c.name} para cima`, disabled: i === 0, html: icons.up, onclick: () => move(-1) }),
          h("button", { type: "button", class: "icon-btn sm", "aria-label": `Mover ${c.name} para baixo`, disabled: i === cats().length - 1, html: icons.down, onclick: () => move(1) })),
        nm, kw,
        h("span", { class: "ccount", text: `${n} ${n === 1 ? "capinha" : "capinhas"}` }),
        ui.confirmCat === c.id
          ? h("span", { class: "confirm" }, n ? `${n} capinha(s) perdem esta categoria.` : "Remover?",
              h("button", { type: "button", class: "btn small dark", text: "Remover", onclick: () => {
                store.mutate((cat) => {
                  cat.categories = cat.categories.filter((y) => y.id !== c.id);
                  cat.categories.forEach((x, k) => { x.order = k; });
                  for (const p of cat.products) p.categories = p.categories.filter((y) => y !== c.id);
                });
                ui.confirmCat = null;
              } }),
              h("button", { type: "button", class: "btn small", text: "Cancelar", onclick: () => { ui.confirmCat = null; render(); } }))
          : h("button", { type: "button", class: "icon-btn sm", "aria-label": `Remover ${c.name}`, html: icons.trash, onclick: () => { ui.confirmCat = c.id; render(); } }));
    });

    const review = counts.get(UNCLASSIFIED.id) || 0;
    return h("section", { class: "panel" },
      form,
      h("p", { class: "muted small", text: "A ordem abaixo é a ordem da barra de filtros. “Todas as capinhas” vem sempre primeiro. Capinhas sem categoria aparecem em “Não classificadas” até serem revisadas." }),
      h("div", { class: "clist" }, rows),
      review ? h("p", { class: "muted small" }, `${review} capinha(s) em Não classificadas. `,
        h("button", { type: "button", class: "linkish", text: "Revisar agora", onclick: () => { ui.tab = "products"; ui.productFilter = UNCLASSIFIED.id; render(); } })) : null);
  }

  function viewDuplicates() {
    const dups = store.catalog.duplicates;
    return h("section", { class: "panel" },
      h("h3", { class: "ptitle", text: "Arquivos duplicados bloqueados" }),
      h("p", { class: "muted small", text: "Cada imagem recebe uma impressão digital (SHA-256) e uma assinatura visual. Arquivos idênticos nunca entram duas vezes; imagens visualmente iguais (mesmo reexportadas ou redimensionadas) pedem sua confirmação." }),
      dups.length ? h("div", { class: "dlist" }, dups.map((d) => {
        const p = d.duplicateOf && productById(d.duplicateOf);
        return h("div", { class: "drow" },
          p ? h("img", { src: store.imageSrc(p), alt: "", class: "pthumb" }) : h("span", { class: "pthumb" }),
          h("span", {}, h("strong", { text: d.file }), h("br"), h("span", { class: "muted small", text: p ? `Igual a “${p.name}” (${p.id.toUpperCase()})` : "Igual a um produto já removido" })),
          h("span", { class: "muted small", text: new Date(d.detectedAt).toLocaleDateString("pt-BR") }));
      })) : h("p", { class: "muted", text: "Nenhuma duplicata registrada." }),
      h("h3", { class: "ptitle", text: "Procurar imagens parecidas no catálogo" }),
      h("button", { type: "button", class: "btn", disabled: ui.scanning, onclick: scanSimilar, text: ui.scanning ? "Comparando imagens…" : "Comparar todas as imagens" }),
      ui.similarPairs ? (ui.similarPairs.length
        ? h("div", { class: "dlist" }, ui.similarPairs.map(({ a, b, d }) => h("div", { class: "drow pair" },
            h("img", { src: store.imageSrc(a), alt: "", class: "pthumb" }), h("img", { src: store.imageSrc(b), alt: "", class: "pthumb" }),
            h("span", {}, h("strong", { text: `${a.name} × ${b.name}` }), h("br"), h("span", { class: "muted small", text: d === 0 ? "Visualmente idênticas" : `Diferença de ${d}/256` })),
            h("button", { type: "button", class: "btn small", text: `Revisar ${b.id.toUpperCase()}`, onclick: () => { ui.tab = "products"; ui.productFilter = "all"; ui.productQuery = b.id; ui.expanded = b.id; render(); } }))))
        : h("p", { class: "muted", text: "Nenhuma imagem parecida encontrada." })) : null);
  }

  function viewStore() {
    const current = store.catalog.settings?.whatsapp || "";
    const input = h("input", { type: "tel", class: "field", id: "store-whatsapp", value: current, placeholder: "Ex.: (85) 99999-9999", inputmode: "tel", autocomplete: "tel" });
    const status = h("p", { class: "muted small" });
    const check = () => {
      const n = waNumber(input.value);
      status.textContent = !input.value.trim() ? "Sem número cadastrado: o carrinho mostra só a opção “Copiar pedido”."
        : n ? `Os pedidos vão para +${n.slice(0, 2)} ${n.slice(2, 4)} ${n.slice(4)}.` : "Número incompleto. Use DDD + número, por exemplo (85) 99999-9999.";
    };
    input.addEventListener("input", check);
    input.addEventListener("change", () => {
      if (input.value.trim() && !waNumber(input.value)) return;
      store.mutate((c) => { c.settings = { ...(c.settings || {}), whatsapp: input.value.trim() }; });
    });
    check();
    return h("section", { class: "panel" },
      h("h3", { class: "ptitle", text: "Pedidos pelo WhatsApp" }),
      h("p", { class: "muted small", text: "Depois de pagar, o cliente toca em “Enviar pedido pelo WhatsApp” e abre uma conversa com este número, com a lista de capinhas, quantidades, nomes, valor e código do pedido já escritos." }),
      h("label", { class: "lbl", for: "store-whatsapp" }, "WhatsApp da loja", input),
      status,
      viewPix());
  }

  function viewPix() {
    const px = store.catalog.settings?.pix || {};
    const type = h("select", { class: "field", id: "pix-type" },
      KEY_TYPES.map((t) => h("option", { value: t.id, text: t.label, selected: (px.type || "cpf") === t.id })));
    const key = h("input", { type: "text", class: "field", id: "pix-key", value: px.key || "", autocomplete: "off", spellcheck: "false" });
    const name = h("input", { type: "text", class: "field", id: "pix-name", value: px.name || "", maxlength: 60, placeholder: "Como aparece no banco. Ex.: Lukx Case" });
    const city = h("input", { type: "text", class: "field", id: "pix-city", value: px.city || "", maxlength: 40, placeholder: "Ex.: Fortaleza" });
    const status = h("p", { class: "muted small" });
    const placeholders = { cpf: "Ex.: 123.456.789-09", phone: "Ex.: (85) 99999-9999", email: "Ex.: loja@email.com", evp: "Ex.: 123e4567-e89b-12d3-a456-426614174000" };

    const read = () => ({ type: type.value, key: key.value.trim(), name: name.value.trim(), city: city.value.trim() });
    const check = () => {
      const v = read();
      key.placeholder = placeholders[v.type];
      const k = normalizeKey(v.type, v.key);
      if (!v.key && !v.name && !v.city) { status.textContent = "Sem chave Pix: o carrinho manda o pedido direto pelo WhatsApp, sem pagamento antes."; return false; }
      if (!k) { status.textContent = v.key ? "Chave inválida para o tipo escolhido. Confira os números." : "Informe a chave Pix."; return false; }
      if (!plain(v.name, 25)) { status.textContent = "Informe o nome do recebedor."; return false; }
      if (!plain(v.city, 15)) { status.textContent = "Informe a cidade do recebedor."; return false; }
      status.textContent = `Pronto. O cliente paga para ${plain(v.name, 25)} (${plain(v.city, 15)}), chave ${k}. O pedido só vai para o WhatsApp depois que ele confirmar o pagamento.`;
      return true;
    };
    const commit = () => {
      const v = read();
      const empty = !v.key && !v.name && !v.city;
      if (!empty && !check()) return;
      store.mutate((c) => {
        c.settings = { ...(c.settings || {}) };
        if (empty) delete c.settings.pix; else c.settings.pix = v;
      });
    };
    for (const el of [key, name, city]) { el.addEventListener("input", check); el.addEventListener("change", commit); }
    type.addEventListener("change", () => { check(); commit(); });
    check();
    return h("div", { class: "panel" },
      h("h3", { class: "ptitle", text: "Pagamento com Pix" }),
      h("p", { class: "muted small", text: "No carrinho, o cliente vê o total, paga com o QR Code ou o Pix copia e cola gerado com esta chave e só depois envia o pedido pelo WhatsApp. O site não confirma o pagamento sozinho: confira o Pix no app do banco antes de separar o pedido." }),
      h("label", { class: "lbl", for: "pix-type" }, "Tipo de chave", type),
      h("label", { class: "lbl", for: "pix-key" }, "Chave Pix", key),
      h("label", { class: "lbl", for: "pix-name" }, "Nome do recebedor", name),
      h("label", { class: "lbl", for: "pix-city" }, "Cidade do recebedor", city),
      status);
  }

  async function exportJSON() {
    const dl = await platform.downloads();
    if (!dl) { toast("Exportar só funciona com o catálogo aberto no claude.ai."); return; }
    try { await dl.save({ filename: "lukx-case-catalogo.json", data: store.exportJSON() }); }
    catch (e) { if (e?.code !== "cancelled" && e?.code !== "declined") toast("O arquivo não foi salvo."); }
  }

  // ---------- render ----------
  function renderKeepFocus(id) {
    const pos = document.getElementById(id)?.selectionStart;
    render();
    const el = document.getElementById(id);
    if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch { /* not a text input */ } }
  }

  function render() {
    if (!store.catalog) return;
    const focusId = document.activeElement?.id;
    renderInner();
    if (focusId && root.contains(document.getElementById(focusId))) document.getElementById(focusId).focus({ preventScroll: true });
  }

  function renderInner() {
    const total = store.catalog.products.length;
    const hidden = store.catalog.products.filter((p) => p.hidden).length;
    const tabs = [
      ["add", "Adicionar capinhas", ui.queue.length || null],
      ["products", "Produtos", total],
      ["categories", "Categorias", cats().length],
      ["duplicates", "Duplicatas", store.catalog.duplicates.length],
      ["store", "Loja", null],
    ];
    const tabBar = h("div", { class: "tabs", role: "tablist" }, tabs.map(([id, label, n]) => h("button", {
      type: "button", role: "tab", class: "tab", "aria-selected": String(ui.tab === id), onclick: () => { ui.tab = id; render(); },
    }, label, n != null ? h("span", { class: "count", text: n }) : null)));

    const body = { add: viewAdd, products: viewProducts, categories: viewCategories, duplicates: viewDuplicates, store: viewStore }[ui.tab]();
    const dirty = store.isDirty();
    const changes = store.changeCount();
    const saveBar = dirty ? h("div", { class: "savebar", role: "region", "aria-label": "Alterações não salvas" },
      h("div", { class: "wrap" },
        h("span", { text: store.saving ? "Salvando…" : `${changes || 1} ${changes === 1 ? "alteração não salva" : "alterações não salvas"}` }),
        h("div", { class: "row" },
          h("button", { type: "button", class: "btn small", text: "Descartar", disabled: store.saving, onclick: () => { store.discard(); toast("Alterações descartadas."); } }),
          h("button", { type: "button", class: "btn small primary", text: "Salvar e publicar", disabled: store.saving, onclick: () => save() })))) : null;

    root.replaceChildren(
      h("div", { class: "admin-head" }, h("div", { class: "wrap" },
        h("div", {},
          h("p", { class: "eyebrow", text: "Área administrativa" }),
          h("h1", { text: "Gerenciar catálogo" }),
          h("p", { class: "muted", text: `${total} produtos · ${total - hidden} visíveis no catálogo${hidden ? ` · ${hidden} oculto(s)` : ""}` })),
        h("div", { class: "row" },
          h("button", { type: "button", class: "btn small", text: "Exportar JSON", onclick: exportJSON }),
          h("a", { class: "btn small dark", href: "#", text: "Ver catálogo" })))),
      h("div", { class: "wrap admin-body" }, tabBar, body),
      ...(saveBar ? [saveBar] : []));
  }

  return { render };
}

export function renderNoAccess(root) {
  root.replaceChildren(h("div", { class: "wrap" }, h("div", { class: "empty" },
    h("p", { class: "eyebrow", text: "Área administrativa" }),
    h("h3", { text: "Acesso restrito" }),
    h("p", { text: "O gerenciamento do catálogo é liberado para quem tem permissão de edição. Abra o catálogo no claude.ai com a conta da LUKX CASE ou peça acesso de edição ao dono." }),
    h("div", { class: "actions" }, h("a", { class: "btn primary", href: "#", text: "Voltar ao catálogo" })))));
}
