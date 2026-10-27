// Pix "copia e cola" (BR Code, padrão EMV do Banco Central) para pagamento com valor fixo.
// Gera o texto que o app do banco lê no QR Code. Não confirma pagamento: a loja confere no banco.

export const KEY_TYPES = [
  { id: "cpf", label: "CPF ou CNPJ" },
  { id: "phone", label: "Celular" },
  { id: "email", label: "E-mail" },
  { id: "evp", label: "Chave aleatória" },
];

const digits = (s) => String(s || "").replace(/\D/g, "");

function validCpf(d) {
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const calc = (n) => { let s = 0; for (let i = 0; i < n; i++) s += +d[i] * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return calc(9) === +d[9] && calc(10) === +d[10];
}
function validCnpj(d) {
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const calc = (n) => { const w = n === 12 ? [5,4,3,2,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2]; let s = 0; for (let i = 0; i < n; i++) s += +d[i] * w[i]; const r = s % 11; return r < 2 ? 0 : 11 - r; };
  return calc(12) === +d[12] && calc(13) === +d[13];
}

/** Normalised key in the format the Pix network expects, or "" when invalid. */
export function normalizeKey(type, raw) {
  const v = String(raw || "").trim();
  if (!v) return "";
  switch (type) {
    case "cpf": { const d = digits(v); return validCpf(d) || validCnpj(d) ? d : ""; }
    case "phone": {
      let d = digits(v);
      if (d.length === 10 || d.length === 11) d = "55" + d;
      return (d.length === 12 || d.length === 13) && d.startsWith("55") ? "+" + d : "";
    }
    case "email": { const e = v.toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 77 ? e : ""; }
    case "evp": { const e = v.toLowerCase(); return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(e) ? e : ""; }
    default: return "";
  }
}

/** Upper-case ASCII, no accents, only what bank apps accept in name/city fields. */
export function plain(s, max) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();
}

/** Pix settings ready to use, or null when the store has not configured Pix. */
export function pixConfig(settings) {
  const px = settings?.pix;
  if (!px) return null;
  const key = normalizeKey(px.type, px.key);
  const name = plain(px.name, 25);
  const city = plain(px.city, 15);
  return key && name && city ? { key, name, city } : null;
}

const tlv = (id, value) => id + String(value.length).padStart(2, "0") + value;

function crc16(str) {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(str)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** Order code used as the Pix txid and in the WhatsApp message (A–Z, 0–9). */
export function newOrderCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return "LUKX" + [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

export function pixPayload({ key, name, city, amount, txid }) {
  const body =
    tlv("00", "01") +
    tlv("26", tlv("00", "br.gov.bcb.pix") + tlv("01", key)) +
    tlv("52", "0000") +
    tlv("53", "986") +
    (Number(amount) > 0 ? tlv("54", Number(amount).toFixed(2)) : "") +
    tlv("58", "BR") +
    tlv("59", name) +
    tlv("60", city) +
    tlv("62", tlv("05", (txid || "***").replace(/[^A-Za-z0-9]/g, "").slice(0, 25) || "***")) +
    "6304";
  return body + crc16(body);
}

export const brl = (n) => Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
