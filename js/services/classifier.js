// Visual classification of case images with Claude (vision), through the artifact's
// `sample` capability. Claude looks at the actual pixels: characters, crests, symbols,
// text printed on the design, colours. File names are never sent.

import { platform } from "./platform.js";
import { UNCLASSIFIED } from "./categories.js";

export const MIN_CONFIDENCE = 0.6;

export async function classifierStatus() {
  const sample = await platform.sample();
  if (!sample) return { available: false, reason: "O classificador visual só funciona com o catálogo aberto no claude.ai." };
  let limits = null;
  try { limits = await sample.limits(); } catch { /* treat as no images */ }
  if (!limits?.images) return { available: false, reason: "Esta visualização não permite enviar imagens ao Claude." };
  return { available: true, maxPerCall: Math.max(1, Math.min(limits.images.maxCount || 1, 6)) };
}

function buildPrompt(categories, count) {
  const list = categories.map((c) => `- ${c.id}: ${c.name}${c.keywords?.length ? ` (ex.: ${c.keywords.join(", ")})` : ""}`).join("\n");
  return `Você classifica capinhas de celular para o catálogo da loja LUKX CASE.
Você recebeu ${count} imagem(ns) de produto, na ordem 0 a ${count - 1}. Analise o CONTEÚDO VISUAL de cada uma: personagens, escudos e logos de times, símbolos religiosos, textos impressos na arte, cores e estilo.

Categorias existentes (use o id):
${list}

Regras:
- Atribua uma ou mais categorias existentes quando o tema estiver claro. Ex.: Homem-Aranha, Justiceiro, Thanos → marvel; Naruto, Sasuke, Itachi, Kakashi → naruto; escudo do Ceará Sporting Club → ceara; Fortaleza Esporte Clube → fortaleza.
- Uma capinha pode ter mais de uma categoria quando fizer sentido.
- Se o tema for claro mas nenhuma categoria existente servir, sugira "newCategory" com id (minúsculas, hífens, sem acento) e nome em português. Ex.: um personagem da Disney sem categoria Disney.
- Se não for possível identificar com segurança, deixe "categories" vazio e use confidence abaixo de 0.6.
- Ignore marcas de fabricante/mockup (por exemplo, o logotipo pequeno do fabricante no topo) ao decidir o tema.
- "name": nome curto e comercial em português (até 48 caracteres), ex.: "Homem-Aranha — HQ Clássica".
- "keywords": 3 a 8 termos de busca em português (personagens, time, estilo, cores).
- "description": uma frase objetiva descrevendo a arte.
- "personalizavel": true se a arte mostra espaço para nome/iniciais (ex.: "SEU NOME").
- "evidence": em poucas palavras, o que você viu que justifica a categoria.

Responda SOMENTE com JSON neste formato:
{"items":[{"index":0,"categories":["marvel"],"newCategory":null,"confidence":0.95,"name":"...","keywords":["..."],"description":"...","personalizavel":false,"evidence":"..."}]}`;
}

/**
 * Classify a list of {jpeg: Blob}. Returns an array (same order) of results:
 * {categories, newCategory, confidence, name, keywords, description, personalizavel, evidence, error?}
 */
export async function classifyImages(items, categories, { onProgress, signal } = {}) {
  const status = await classifierStatus();
  if (!status.available) return items.map(() => ({ error: status.reason }));
  const sample = await platform.sample();
  const out = new Array(items.length);
  const known = new Set(categories.map((c) => c.id));

  for (let start = 0; start < items.length; start += status.maxPerCall) {
    const batch = items.slice(start, start + status.maxPerCall);
    onProgress?.({ done: start, total: items.length });
    let parsed;
    try {
      parsed = await sample.json(buildPrompt(categories, batch.length), {
        images: batch.map((b) => b.jpeg),
        modelTier: "default",
        signal,
      });
    } catch (e) {
      const msg = errorCopy(e?.code);
      batch.forEach((_, i) => { out[start + i] = { error: msg, code: e?.code }; });
      if (["not_granted", "sampling_disabled", "cancelled", "rate_limited", "not_declared", "capability_disabled"].includes(e?.code)) {
        for (let j = start + batch.length; j < items.length; j++) out[j] = { error: msg, code: e?.code };
        break;
      }
      continue;
    }
    const arr = Array.isArray(parsed?.items) ? parsed.items : [];
    batch.forEach((_, i) => {
      const r = arr.find((x) => Number(x?.index) === i) || arr[i] || {};
      out[start + i] = sanitize(r, known);
    });
  }
  onProgress?.({ done: items.length, total: items.length });
  return out;
}

function sanitize(r, known) {
  const confidence = Math.max(0, Math.min(1, Number(r.confidence) || 0));
  let categories = (Array.isArray(r.categories) ? r.categories : []).map(String).filter((id) => known.has(id));
  let newCategory = null;
  if (r.newCategory && typeof r.newCategory === "object" && r.newCategory.name) {
    newCategory = { id: String(r.newCategory.id || ""), name: String(r.newCategory.name).slice(0, 40) };
  }
  if (confidence < MIN_CONFIDENCE) { categories = []; newCategory = null; }
  return {
    categories,
    newCategory,
    confidence,
    name: String(r.name || "").slice(0, 60),
    keywords: (Array.isArray(r.keywords) ? r.keywords : []).map(String).slice(0, 10),
    description: String(r.description || "").slice(0, 240),
    personalizavel: !!r.personalizavel,
    evidence: String(r.evidence || "").slice(0, 200),
    unclassified: !categories.length && !newCategory,
    fallbackCategory: UNCLASSIFIED.id,
  };
}

function errorCopy(code) {
  switch (code) {
    case "not_granted": return "A análise com Claude não foi autorizada nesta visualização.";
    case "sampling_disabled": return "O Claude não está disponível para esta conta.";
    case "rate_limited": return "Muitas análises seguidas. Aguarde um pouco e reclassifique.";
    case "cancelled": return "Análise interrompida.";
    case "image_rejected": return "A imagem não pôde ser enviada para análise.";
    case "invalid_json": return "A resposta da análise veio incompleta. Tente reclassificar.";
    default: return "A análise falhou. Tente reclassificar.";
  }
}
