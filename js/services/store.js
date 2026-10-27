// Catalog store: loads data/catalog.json, keeps the working copy and saves it back
// as a new version of this artifact (files publish), together with any new images.

import { platform } from "./platform.js";

const CATALOG_PATH = "data/catalog.json";
const listeners = new Set();

const state = {
  catalog: null,        // working copy
  savedJSON: "",        // last saved/loaded catalog, serialized
  pendingFiles: new Map(),   // path -> Blob (new images to publish)
  deletedFiles: new Set(),   // paths to remove on next save
  objectUrls: new Map(),     // path -> blob: URL for images this view added (not served yet)
  saving: false,
};

function emit(reason) { listeners.forEach((fn) => { try { fn(reason); } catch (e) { console.error(e); } }); }

export const store = {
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  async load() {
    const res = await fetch(CATALOG_PATH, { cache: "no-store" });
    if (!res.ok) throw new Error(`Não foi possível carregar o catálogo (${res.status}).`);
    const data = await res.json();
    normalize(data);
    state.catalog = data;
    state.savedJSON = JSON.stringify(data);
    emit("load");
    return data;
  },

  get catalog() { return state.catalog; },
  get saving() { return state.saving; },

  /** Products visible to customers. */
  publicProducts() { return (state.catalog?.products || []).filter((p) => !p.hidden); },

  imageSrc(product) { return state.objectUrls.get(product.image) || product.image; },

  isDirty() {
    return state.pendingFiles.size > 0 || state.deletedFiles.size > 0 || JSON.stringify(state.catalog) !== state.savedJSON;
  },

  changeCount() {
    if (!state.catalog) return 0;
    const before = JSON.parse(state.savedJSON || "{}");
    const beforeById = new Map((before.products || []).map((p) => [p.id, JSON.stringify(p)]));
    let n = 0;
    for (const p of state.catalog.products) if (beforeById.get(p.id) !== JSON.stringify(p)) n++;
    const nowIds = new Set(state.catalog.products.map((p) => p.id));
    for (const id of beforeById.keys()) if (!nowIds.has(id)) n++;
    if (JSON.stringify(before.categories) !== JSON.stringify(state.catalog.categories)) n++;
    if (JSON.stringify(before.duplicates) !== JSON.stringify(state.catalog.duplicates)) n++;
    return n;
  },

  /** Apply a mutation to the working copy. */
  mutate(fn, reason = "change") {
    fn(state.catalog);
    state.catalog.updatedAt = new Date().toISOString();
    emit(reason);
  },

  addImage(path, blob) {
    state.pendingFiles.set(path, blob);
    state.deletedFiles.delete(path);
    state.objectUrls.set(path, URL.createObjectURL(blob));
  },

  removeImage(path) {
    if (state.pendingFiles.has(path)) state.pendingFiles.delete(path);
    else state.deletedFiles.add(path);
  },

  discard() {
    state.catalog = JSON.parse(state.savedJSON);
    for (const path of state.pendingFiles.keys()) {
      const url = state.objectUrls.get(path);
      if (url) URL.revokeObjectURL(url);
      state.objectUrls.delete(path);
    }
    state.pendingFiles.clear();
    state.deletedFiles.clear();
    emit("discard");
  },

  /**
   * Publish the catalog and new images as a new version of this artifact.
   * Resolves {ok:true} or {ok:false, code, message}.
   */
  async save() {
    if (state.saving) return { ok: false, code: "busy", message: "Já existe um salvamento em andamento." };
    const artifact = await platform.artifact();
    if (!artifact) return { ok: false, code: "unavailable", message: "Salvar só funciona com o catálogo aberto no claude.ai por quem tem permissão de edição." };

    state.saving = true; emit("saving");
    const files = {};
    for (const [path, blob] of state.pendingFiles) files[path] = blob;
    for (const path of state.deletedFiles) files[path] = null;
    state.catalog.updatedAt = new Date().toISOString();
    const json = JSON.stringify(state.catalog, null, 1);
    files[CATALOG_PATH] = { content: json, contentType: "application/json" };

    try {
      await artifact.publish(files);
      state.savedJSON = JSON.stringify(JSON.parse(json));
      state.pendingFiles.clear();
      state.deletedFiles.clear();
      return { ok: true };
    } catch (e) {
      const code = e?.code || "upstream_error";
      return { ok: false, code, message: saveErrorCopy(code) };
    } finally {
      state.saving = false; emit("saved");
    }
  },

  exportJSON() { return JSON.stringify(state.catalog, null, 2); },
};

function saveErrorCopy(code) {
  switch (code) {
    case "conflict": return "Outra pessoa salvou o catálogo agora há pouco. A página vai recarregar com a versão mais recente; refaça a última alteração.";
    case "not_writer":
    case "not_granted":
    case "consent_required": return "Sua conta pode ver o catálogo, mas não editar. Peça acesso de edição ao dono.";
    case "capability_disabled":
    case "capability_removed": return "Salvar não está disponível nesta visualização (por exemplo, em um link público). Abra o catálogo no claude.ai.";
    case "too_large": return "As imagens deste lote passam do limite de envio. Salve em lotes menores.";
    case "rate_limited": return "Muitos salvamentos seguidos. Aguarde alguns segundos e tente de novo.";
    case "invalid_content": return "Um dos arquivos não pôde ser salvo (formato não aceito).";
    default: return "O serviço não respondeu. Tente salvar novamente em instantes.";
  }
}

function normalize(data) {
  data.categories ||= [];
  data.products ||= [];
  data.duplicates ||= [];
  data.settings ||= {};
  data.categories.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  for (const p of data.products) {
    p.categories ||= [];
    p.keywords ||= [];
  }
}
