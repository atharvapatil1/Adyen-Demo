// Sessions flow, client side:
//   1. Ask our server to create a session (POST /api/sessions).
//   2. Create AdyenCheckout with { id, sessionData } and mount Drop-in.
//   3. Drop-in fetches payment methods, collects details, makes the payment and
//      handles any action (3DS2, QR code, redirect) by itself.
//   4. We get onPaymentCompleted / onPaymentFailed and show the result.
const { AdyenCheckout, Dropin } = window.AdyenWeb;

const params = new URLSearchParams(window.location.search);
const items = ["sunglasses", "headphones"]
  .map((id) => ({ id, quantity: Number(params.get(id) || 0) }))
  .filter((item) => item.quantity > 0);

const countrySelect = document.getElementById("country");
const statusEl = document.getElementById("status");
let dropin;

function showStatus(message, type = "info") {
  statusEl.textContent = message;
  statusEl.className = `status-banner show ${type}`;
}

function hideStatus() {
  statusEl.className = "status-banner";
}

function options() {
  return {
    holderName: document.getElementById("opt-holder").checked,
    billing: document.getElementById("opt-billing").checked,
    openFirst: document.getElementById("opt-open-first").checked,
    store: document.getElementById("opt-store").checked,
  };
}

async function createSession(countryCode, storePaymentMethod) {
  const res = await fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ countryCode, items, storePaymentMethod }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `Session request failed (${res.status})`);
  return body;
}

function renderSummary(session, cfg) {
  const { locale } = session;
  const lines = items
    .map((item) => {
      const p = cfg.products[item.id];
      const amount = { value: p.price * item.quantity, currency: session.amount.currency };
      return `<div class="summary-line"><span>${item.quantity} × ${p.name}</span><span>${Demo.formatAmount(amount, locale)}</span></div>`;
    })
    .join("");
  document.getElementById("order-summary").innerHTML = `${lines}
    <div class="summary-line total"><span>Total</span><span>${Demo.formatAmount(session.amount, locale)}</span></div>
    <div class="muted" style="margin-top:8px">Reference <code>${session.reference}</code> · Session <code>${session.id}</code></div>`;
}

async function startCheckout() {
  const cfg = await Demo.getConfig();
  const countryCode = countrySelect.value;
  const opts = options();

  hideStatus();
  if (dropin) {
    dropin.unmount();
    dropin = null;
  }
  document.getElementById("dropin-container").innerHTML = '<p class="muted">Creating session…</p>';

  let session;
  try {
    session = await createSession(countryCode, opts.store);
  } catch (err) {
    document.getElementById("dropin-container").innerHTML = "";
    showStatus(err.message, "error");
    return;
  }
  renderSummary(session, cfg);

  const checkout = await AdyenCheckout({
    // Only id + sessionData are needed; Drop-in calls Adyen with them directly.
    session: { id: session.id, sessionData: session.sessionData },
    clientKey: cfg.clientKey,
    environment: cfg.environment, // "test" or "live"
    amount: session.amount, // used to render the amount on the Pay button
    countryCode,
    locale: session.locale,

    // Final result for successful/pending payments (Authorised, Pending, Received).
    onPaymentCompleted(result) {
      Demo.logClientEvent(`onPaymentCompleted: ${result.resultCode}`, result);
      Demo.goToResult({ ...result, reference: session.reference, sessionId: session.id });
    },

    // Final result for unsuccessful payments (Refused, Cancelled, Error).
    onPaymentFailed(result) {
      Demo.logClientEvent(`onPaymentFailed: ${result?.resultCode}`, result);
      Demo.goToResult({ ...result, reference: session.reference, sessionId: session.id, resultCode: result?.resultCode || "Refused" });
    },

    // Technical errors (network, invalid config, shopper cancelled a wallet popup, ...).
    onError(error) {
      Demo.logClientEvent(`onError: ${error.name}`, { name: error.name, message: error.message });
      if (error.name !== "CANCEL") showStatus(`${error.name}: ${error.message}`, "error");
    },
  });

  Demo.logClientEvent("AdyenCheckout initialised", {
    paymentMethods: checkout.paymentMethodsResponse?.paymentMethods?.map((pm) => pm.type),
  });

  dropin = new Dropin(checkout, {
    openFirstPaymentMethod: opts.openFirst,
    // Per payment method configuration.
    paymentMethodsConfiguration: {
      card: {
        hasHolderName: opts.holderName,
        holderNameRequired: opts.holderName,
        billingAddressRequired: opts.billing,
      },
    },
    onReady() {
      Demo.logClientEvent("Drop-in ready");
    },
    onSelect(component) {
      Demo.logClientEvent(`Payment method selected: ${component.props?.type || component.type}`);
    },
  }).mount("#dropin-container");
}

(async function init() {
  if (!items.length) {
    document.getElementById("order-summary").innerHTML = 'Your cart is empty. <a href="/">Go back</a>.';
    return;
  }
  const cfg = await Demo.getConfig();
  for (const [code, c] of Object.entries(cfg.countries)) countrySelect.add(new Option(`${c.name} (${c.currency})`, code));
  countrySelect.value = cfg.countries[params.get("country")] ? params.get("country") : "NL";

  countrySelect.addEventListener("change", startCheckout);
  document.querySelectorAll(".controls input").forEach((el) => el.addEventListener("change", startCheckout));

  startCheckout();
})();
