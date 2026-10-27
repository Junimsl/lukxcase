// Cart drawer: review picked cases, change quantities, add the name for personalised
// designs, pay the total with Pix (QR Code / copia e cola) and only then send the order
// to the store on WhatsApp.

import { h, icons, toast } from "./dom.js";
import { store } from "../services/store.js";
import { cart, waNumber, orderMessage, orderTotal, priceOf } from "../services/cart.js";
import { pixConfig, pixPayload, newOrderCode, brl } from "../services/pix.js";
import qrcode from "../vendor/qrcode.js";

export function qtyStepper(id, { compact = false, label = "" } = {}) {
  const q = cart.qty(id);
  return h("div", { class: `stepper${compact ? " compact" : ""}`, role: "group", "aria-label": `Quantidade${label ? ` de ${label}` : ""}` },
    h("button", { type: "button", "aria-label": q === 1 ? "Remover do carrinho" : "Diminuir quantidade", html: q === 1 ? icons.trash : icons.minus, onclick: () => cart.setQty(id, q - 1) }),
    h("span", { class: "q", text: q, "aria-live": "polite" }),
    h("button", { type: "button", "aria-label": "Aumentar quantidade", html: icons.plus, disabled: q >= 99, onclick: () => cart.add(id) }));
}

async function copyText(text, container, okMsg) {
  try { await navigator.clipboard.writeText(text); toast(okMsg); return; } catch { /* fall back below */ }
  const ta = h("textarea", { class: "sr-only" }); ta.value = text; container.append(ta); ta.select();
  try { document.execCommand("copy"); toast(okMsg); } catch { toast("Não foi possível copiar. Selecione o texto manualmente."); }
  ta.remove();
}

export function createCartDrawer() {
  // ----- cart step -----
  const list = h("div", { class: "cart-list" });
  const empty = h("div", { class: "cart-empty" },
    h("span", { class: "cart-empty-icon", html: icons.bag }),
    h("strong", { text: "Seu carrinho está vazio" }),
    h("p", { text: "Toque em “Adicionar” nas capinhas que você curtir. Você pode escolher quantas quiser." }));
  const summary = h("p", { class: "cart-summary" });
  const totalRow = h("p", { class: "cart-total" });
  const payBtn = h("button", { type: "button", class: "btn primary block" }, h("span", { html: icons.pix }), "Pagar com Pix");
  const send = h("a", { class: "btn primary block", target: "_blank", rel: "noopener" }, h("span", { html: icons.whatsapp }), "Finalizar pelo WhatsApp");
  const note = h("p", { class: "cart-note" });
  const copyBtn = h("button", { type: "button", class: "btn block", text: "Copiar pedido" });
  const clearBtn = h("button", { type: "button", class: "linkish", text: "Esvaziar carrinho" });
  const footer = h("div", { class: "cart-footer" }, summary, totalRow, payBtn, send, copyBtn, note, clearBtn);
  const cartStep = h("div", { class: "drawer-step" }, list, empty, footer);

  // ----- Pix step -----
  const backBtn = h("button", { type: "button", class: "linkish back", html: `${icons.prev}<span>Voltar ao carrinho</span>` });
  const pixAmount = h("p", { class: "pix-amount" });
  const pixTo = h("p", { class: "muted small pix-to" });
  const qrBox = h("div", { class: "pix-qr", role: "img" });
  const codeField = h("textarea", { class: "field pix-code", readonly: true, rows: 3, "aria-label": "Código Pix copia e cola" });
  const copyPix = h("button", { type: "button", class: "btn dark block", text: "Copiar código Pix" });
  const orderInfo = h("p", { class: "muted small" });
  const paidCheck = h("input", { type: "checkbox", id: "pix-paid" });
  const paidLabel = h("label", { class: "pix-paid", for: "pix-paid" }, paidCheck, h("span"));
  const sendPaid = h("a", { class: "btn primary block", target: "_blank", rel: "noopener" }, h("span", { html: icons.whatsapp }), "Enviar pedido pelo WhatsApp");
  const copyPaid = h("button", { type: "button", class: "btn block", text: "Copiar pedido" });
  const paidNote = h("p", { class: "cart-note" });
  const pixStep = h("div", { class: "drawer-step pix-step" },
    backBtn,
    h("div", { class: "pix-body" },
      h("p", { class: "eyebrow", text: "Pagamento" }),
      pixAmount, pixTo, qrBox,
      h("ol", { class: "pix-steps" },
        h("li", { text: "Abra o app do seu banco e escolha Pix." }),
        h("li", { text: "Leia o QR Code ou use o Pix copia e cola." }),
        h("li", { text: "Confira o valor e o nome do recebedor e pague." })),
      codeField, copyPix, orderInfo),
    h("div", { class: "cart-footer" }, paidLabel, sendPaid, copyPaid, paidNote));

  const closeBtn = h("button", { type: "button", class: "icon-btn", "aria-label": "Fechar carrinho", html: icons.close });
  const titleEl = h("h2", { id: "cart-title", text: "Seu carrinho" });
  const dialog = h("dialog", { class: "drawer", "aria-labelledby": "cart-title" },
    h("div", { class: "drawer-inner" },
      h("div", { class: "drawer-head" }, titleEl, closeBtn),
      cartStep, pixStep));
  document.body.append(dialog);

  let confirmClear = false;
  let step = "cart";
  let order = null; // { code, payload, total, signature }

  function lines() {
    const byId = new Map(store.publicProducts().map((p) => [p.id, p]));
    return cart.items().map((it) => ({ it, p: byId.get(it.id) })).filter((x) => x.p)
      .map(({ it, p }) => ({ id: p.id, name: p.name, code: p.id.toUpperCase(), qty: it.qty, nome: it.nome, personalizavel: !!p.personalizavel, price: priceOf(p, store.catalog), product: p }));
  }
  const signature = (ls) => ls.map((l) => `${l.id}:${l.qty}:${l.price}`).join("|");

  function waHref(text) {
    const number = waNumber(store.catalog?.settings?.whatsapp);
    return number ? `https://wa.me/${number}?text=${encodeURIComponent(text)}` : "";
  }
  function setLink(a, href) {
    if (href) { a.href = href; a.removeAttribute("aria-disabled"); }
    else { a.removeAttribute("href"); a.setAttribute("aria-disabled", "true"); }
  }

  // ----- cart step -----
  function renderCart() {
    const ls = lines();
    const count = ls.reduce((n, l) => n + l.qty, 0);
    const total = orderTotal(ls);
    const pix = pixConfig(store.catalog?.settings);
    empty.hidden = ls.length > 0;
    footer.hidden = ls.length === 0;
    list.hidden = ls.length === 0;
    list.replaceChildren(...ls.map((l) => {
      const nome = l.personalizavel ? h("input", {
        type: "text", class: "field", id: `cart-nome-${l.id}`, maxlength: 40, value: l.nome,
        placeholder: "Nome que vai na arte (ex.: Maria)", "aria-label": `Nome na arte de ${l.name}`,
      }) : null;
      nome?.addEventListener("input", () => { cart.setNome(l.id, nome.value); updateLegacy(); });
      return h("article", { class: "cart-item" },
        h("img", { src: store.imageSrc(l.product), alt: "", class: "cart-thumb" }),
        h("div", { class: "cart-info" },
          h("strong", { text: l.name }),
          h("span", { class: "muted small", text: l.price ? `${l.code} · ${brl(l.price)} cada` : l.code }),
          nome,
          qtyStepper(l.id, { compact: true, label: l.name })));
    }));
    summary.textContent = `${count} ${count === 1 ? "capinha" : "capinhas"} em ${ls.length} ${ls.length === 1 ? "modelo" : "modelos"}`;
    totalRow.replaceChildren(h("span", { text: "Total" }), h("strong", { text: brl(total) }));
    totalRow.hidden = !total;
    clearBtn.textContent = confirmClear ? "Toque de novo para esvaziar" : "Esvaziar carrinho";

    // With Pix configured, the order only reaches WhatsApp from the Pix step, after payment.
    const usePix = !!pix && total > 0;
    payBtn.hidden = !usePix;
    send.hidden = copyBtn.hidden = usePix;
    if (usePix) note.textContent = "Você paga o total com Pix e depois envia o pedido para a loja pelo WhatsApp.";
    else updateLegacy();
  }

  function updateLegacy() {
    if (!payBtn.hidden) return;
    const href = waHref(orderMessage(lines()));
    setLink(send, href);
    note.textContent = href ? "Abre o WhatsApp da loja com o pedido já escrito. É só enviar."
      : "O WhatsApp da loja ainda não foi cadastrado. Use “Copiar pedido” e envie para a LUKX CASE.";
  }

  // ----- Pix step -----
  function startPix() {
    const ls = lines();
    const pix = pixConfig(store.catalog?.settings);
    const total = orderTotal(ls);
    if (!pix || !total) return;
    const sig = signature(ls);
    if (!order || order.signature !== sig) {
      const code = newOrderCode();
      order = { code, total, signature: sig, payload: pixPayload({ ...pix, amount: total, txid: code }), name: pix.name };
      paidCheck.checked = false;
    }
    step = "pix";
    render();
    backBtn.focus();
  }

  function renderPix() {
    const ls = lines();
    if (!order || order.signature !== signature(ls) || !ls.length) { step = "cart"; order = null; return renderCart(); }
    pixAmount.textContent = brl(order.total);
    pixTo.textContent = `Para: ${order.name}`;
    const qr = qrcode(0, "M");
    qr.addData(order.payload);
    qr.make();
    qrBox.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    qrBox.setAttribute("aria-label", `QR Code Pix de ${brl(order.total)}`);
    codeField.value = order.payload;
    orderInfo.textContent = `Pedido ${order.code}. O QR Code vale para este valor; se mudar o carrinho, um novo é gerado.`;
    paidLabel.querySelector("span").textContent = `Já paguei ${brl(order.total)} com Pix`;
    const msg = orderMessage(ls, { orderCode: order.code, paid: true });
    const href = paidCheck.checked ? waHref(msg) : "";
    setLink(sendPaid, href);
    const hasWa = !!waHref(msg);
    sendPaid.hidden = !hasWa;
    copyPaid.hidden = hasWa;
    copyPaid.disabled = !paidCheck.checked;
    paidNote.textContent = !paidCheck.checked
      ? "O envio do pedido libera depois que você confirmar o pagamento."
      : hasWa ? "Mande também o comprovante na conversa. A loja confere o Pix antes de separar o pedido."
        : "Copie o pedido e envie para a LUKX CASE junto com o comprovante.";
  }

  function render() {
    if (!store.catalog) return;
    if (step === "pix") renderPix();
    cartStep.hidden = step !== "cart";
    pixStep.hidden = step !== "pix";
    titleEl.textContent = step === "pix" ? "Pagar com Pix" : "Seu carrinho";
    if (step === "cart") renderCart();
  }

  payBtn.addEventListener("click", startPix);
  backBtn.addEventListener("click", () => { step = "cart"; render(); payBtn.focus(); });
  paidCheck.addEventListener("change", renderPix);
  copyPix.addEventListener("click", () => copyText(codeField.value, dialog, "Código Pix copiado. Cole no app do banco."));
  codeField.addEventListener("focus", () => codeField.select());
  send.addEventListener("click", (e) => { if (send.getAttribute("aria-disabled") === "true") e.preventDefault(); });
  sendPaid.addEventListener("click", (e) => { if (sendPaid.getAttribute("aria-disabled") === "true") e.preventDefault(); });
  copyBtn.addEventListener("click", () => copyText(orderMessage(lines()), dialog, "Pedido copiado. Cole na conversa com a loja."));
  copyPaid.addEventListener("click", () => { if (paidCheck.checked && order) copyText(orderMessage(lines(), { orderCode: order.code, paid: true }), dialog, "Pedido copiado. Cole na conversa com a loja."); });
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
    open() { step = "cart"; render(); if (!dialog.open) dialog.showModal(); closeBtn.focus(); },
    close() { if (dialog.open) dialog.close(); },
  };
}
