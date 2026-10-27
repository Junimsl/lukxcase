// Cart drawer: review picked cases, change quantities, add the name for personalised
// designs, and send the order to the store on WhatsApp.

import { h, icons, toast } from "./dom.js";
import { store } from "../services/store.js";
import { cart, waNumber, orderMessage } from "../services/cart.js";

export function qtyStepper(id, { compact = false, label = "" } = {}) {
  const q = cart.qty(id);
  return h("div", { class: `stepper${compact ? " compact" : ""}`, role: "group", "aria-label": `Quantidade${label ? ` de ${label}` : ""}` },
    h("button", { type: "button", "aria-label": q === 1 ? "Remover do carrinho" : "Diminuir quantidade", html: q === 1 ? icons.trash : icons.minus, onclick: () => cart.setQty(id, q - 1) }),
    h("span", { class: "q", text: q, "aria-live": "polite" }),
    h("button", { type: "button", "aria-label": "Aumentar quantidade", html: icons.plus, disabled: q >= 99, onclick: () => cart.add(id) }));
}

export function createCartDrawer() {
  const list = h("div", { class: "cart-list" });
  const empty = h("div", { class: "cart-empty" },
    h("span", { class: "cart-empty-icon", html: icons.bag }),
    h("strong", { text: "Seu carrinho está vazio" }),
    h("p", { text: "Toque em “Adicionar” nas capinhas que você curtir. Você pode escolher quantas quiser." }));
  const summary = h("p", { class: "cart-summary" });
  const send = h("a", { class: "btn primary block", target: "_blank", rel: "noopener" }, h("span", { html: icons.whatsapp }), "Finalizar pelo WhatsApp");
  const note = h("p", { class: "cart-note" });
  const copyBtn = h("button", { type: "button", class: "btn block", text: "Copiar pedido" });
  const clearBtn = h("button", { type: "button", class: "linkish", text: "Esvaziar carrinho" });
  const closeBtn = h("button", { type: "button", class: "icon-btn", "aria-label": "Fechar carrinho", html: icons.close });
  const footer = h("div", { class: "cart-footer" }, summary, send, copyBtn, note, clearBtn);

  const dialog = h("dialog", { class: "drawer", "aria-labelledby": "cart-title" },
    h("div", { class: "drawer-inner" },
      h("div", { class: "drawer-head" }, h("h2", { id: "cart-title", text: "Seu carrinho" }), closeBtn),
      list, empty, footer));
  document.body.append(dialog);

  let confirmClear = false;

  function lines() {
    const byId = new Map(store.publicProducts().map((p) => [p.id, p]));
    return cart.items().map((it) => ({ it, p: byId.get(it.id) })).filter((x) => x.p)
      .map(({ it, p }) => ({ id: p.id, name: p.name, code: p.id.toUpperCase(), qty: it.qty, nome: it.nome, personalizavel: !!p.personalizavel, product: p }));
  }

  function message() { return orderMessage(lines()); }

  function updateSend() {
    const number = waNumber(store.catalog?.settings?.whatsapp);
    if (number) {
      send.href = `https://wa.me/${number}?text=${encodeURIComponent(message())}`;
      send.removeAttribute("aria-disabled");
      note.textContent = "Abre o WhatsApp da loja com o pedido já escrito. É só enviar.";
    } else {
      send.removeAttribute("href");
      send.setAttribute("aria-disabled", "true");
      note.textContent = "O WhatsApp da loja ainda não foi cadastrado. Use “Copiar pedido” e envie para a LUKX CASE.";
    }
  }

  function render() {
    if (!store.catalog) return;
    const ls = lines();
    const total = ls.reduce((n, l) => n + l.qty, 0);
    empty.hidden = ls.length > 0;
    footer.hidden = ls.length === 0;
    list.hidden = ls.length === 0;
    list.replaceChildren(...ls.map((l) => {
      const nome = l.personalizavel ? h("input", {
        type: "text", class: "field", id: `cart-nome-${l.id}`, maxlength: 40, value: l.nome,
        placeholder: "Nome que vai na arte (ex.: Maria)", "aria-label": `Nome na arte de ${l.name}`,
      }) : null;
      nome?.addEventListener("input", () => { cart.setNome(l.id, nome.value); updateSend(); });
      return h("article", { class: "cart-item" },
        h("img", { src: store.imageSrc(l.product), alt: "", class: "cart-thumb" }),
        h("div", { class: "cart-info" },
          h("strong", { text: l.name }),
          h("span", { class: "muted small", text: l.code }),
          nome,
          qtyStepper(l.id, { compact: true, label: l.name })));
    }));
    summary.textContent = `${total} ${total === 1 ? "capinha" : "capinhas"} em ${ls.length} ${ls.length === 1 ? "modelo" : "modelos"}`;
    clearBtn.textContent = confirmClear ? "Toque de novo para esvaziar" : "Esvaziar carrinho";
    updateSend();
  }

  send.addEventListener("click", (e) => { if (send.getAttribute("aria-disabled") === "true") e.preventDefault(); });
  copyBtn.addEventListener("click", async () => {
    const text = message();
    try { await navigator.clipboard.writeText(text); toast("Pedido copiado. Cole na conversa com a loja."); }
    catch {
      const ta = h("textarea", { class: "sr-only" }); ta.value = text; dialog.append(ta); ta.select();
      try { document.execCommand("copy"); toast("Pedido copiado. Cole na conversa com a loja."); } catch { toast("Não foi possível copiar. Selecione o texto manualmente."); }
      ta.remove();
    }
  });
  clearBtn.addEventListener("click", () => {
    if (!confirmClear) { confirmClear = true; render(); setTimeout(() => { confirmClear = false; render(); }, 3000); return; }
    confirmClear = false; cart.clear(); toast("Carrinho esvaziado.");
  });
  closeBtn.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });

  cart.subscribe(() => {
    // keep focus on the same control when quantities change
    const focusId = document.activeElement?.id;
    render();
    if (focusId) document.getElementById(focusId)?.focus();
  });

  return {
    render,
    open() { render(); if (!dialog.open) dialog.showModal(); closeBtn.focus(); },
    close() { if (dialog.open) dialog.close(); },
  };
}
