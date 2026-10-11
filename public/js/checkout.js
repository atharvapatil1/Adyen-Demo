// Checkout page: one Adyen Web integration, switchable between
//   backend flow: Sessions (POST /sessions) or Advanced (/paymentMethods, /payments, /payments/details)
//   frontend:     Drop-in (all methods in one UI) or Components (Google Pay button + Card form)
// UI-only options (Google Pay button, card fields) remount on the same session / payment methods.
const { AdyenCheckout, Dropin, GooglePay, Card } = window.AdyenWeb;

const params = new URLSearchParams(window.location.search);
const items = ["sunglasses", "headphones"]
  .map((id) => ({ id, quantity: Number(params.get(id) || 0) }))
  .filter((item) => item.quantity > 0);

const countrySelect = document.getElementById("country");
const statusEl = document.getElementById("status");
let cache = null; // { key, data } for the current session / payment methods
let mounted = [];
let renderToken = 0;

/* ---------- helpers ---------- */

function showStatus(message, type = "info") {
  statusEl.textContent = message;
  statusEl.className = `status-banner show ${type}`;
}

function hideStatus() {
  statusEl.className = "status-banner";
}

async function post(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `${url} failed (${res.status})`);
  return json;
}

function readOptions() {
  const opts = {
    flow: document.querySelector('input[name="flow"]:checked').value,
    ui: document.querySelector('input[name="ui"]:checked').value,
    countryCode: countrySelect.value,
  };
  document.querySelectorAll("[data-opt]").forEach((el) => {
    opts[el.dataset.opt] = el.type === "checkbox" ? el.checked : el.type === "range" ? Number(el.value) : el.value;
  });
  return opts;
}

/* ---------- server calls ---------- */

// Sessions: one call returns { id, sessionData }.
// Advanced: /paymentMethods returns the list Drop-in renders; /payments happens on submit.
async function loadPaymentData(opts) {
  const key = [opts.flow, opts.countryCode, opts.tokenise].join("|");
  if (cache?.key === key) return cache.data;

  const body = { countryCode: opts.countryCode, items, storePaymentMethod: opts.tokenise };
  const data = await post(opts.flow === "sessions" ? "/api/sessions" : "/api/advanced/paymentMethods", body);
  cache = { key, data };
  return data;
}

/* ---------- Adyen Web configuration ---------- */

function googlePayConfiguration(opts) {
  return {
    buttonType: opts.gpButtonType,
    buttonColor: opts.gpButtonColor,
    buttonSizeMode: opts.gpButtonSizeMode,
    buttonRadius: opts.gpButtonRadius,
    emailRequired: opts.gpEmailRequired,
    billingAddressRequired: opts.gpBillingAddressRequired,
    billingAddressParameters: opts.gpBillingAddressRequired ? { format: "FULL", phoneNumberRequired: true } : undefined,
    shippingAddressRequired: opts.gpShippingAddressRequired,
    shippingAddressParameters: opts.gpShippingAddressRequired ? { phoneNumberRequired: true } : undefined,
    existingPaymentMethodRequired: opts.gpExistingPaymentMethodRequired,

    onClick(resolve) {
      Demo.logClientEvent("Google Pay button clicked → payment sheet opens");
      resolve();
    },
    // Called when the shopper approves in the Google Pay sheet, before Adyen makes the payment.
    // Validate email/addresses here; call actions.reject() to show an error in the sheet.
    onAuthorized(data, actions) {
      const event = data.authorizedEvent || {};
      Demo.logClientEvent("Google Pay onAuthorized", {
        email: event.email,
        card: event.paymentMethodData?.info,
        billingAddress: data.billingAddress,
        deliveryAddress: data.deliveryAddress,
        token: "(encrypted Google Pay token, forwarded to Adyen)",
      });
      actions.resolve();
    },
  };
}

function cardConfiguration(opts) {
  return {
    hasHolderName: opts.cardHolderName,
    holderNameRequired: opts.cardHolderName,
    billingAddressRequired: opts.cardBillingAddress,
  };
}

function checkoutConfiguration(opts, data, cfg) {
  const finish = (result, fallback) =>
    Demo.goToResult({ ...result, reference: data.reference, sessionId: data.id, resultCode: result?.resultCode || fallback });

  const configuration = {
    clientKey: cfg.clientKey,
    environment: cfg.environment, // "test" or "live"; Google Pay follows this (TEST / PRODUCTION)
    amount: data.amount,
    countryCode: opts.countryCode,
    locale: data.locale,

    // Final result for successful/pending payments (Authorised, Pending, Received).
    onPaymentCompleted(result) {
      Demo.logClientEvent(`onPaymentCompleted: ${result.resultCode}`, result);
      finish(result, "Authorised");
    },
    // Final result for unsuccessful payments (Refused, Cancelled, Error).
    onPaymentFailed(result) {
      Demo.logClientEvent(`onPaymentFailed: ${result?.resultCode}`, result);
      finish(result, "Refused");
    },
    // Technical errors (network, invalid config, shopper closed the Google Pay sheet, ...).
    onError(error) {
      Demo.logClientEvent(`onError: ${error.name}`, { name: error.name, message: error.message });
      if (error.name !== "CANCEL") showStatus(`${error.name}: ${error.message}`, "error");
    },
  };

  if (opts.flow === "sessions") {
    // Drop-in talks to Adyen directly with the session; no other server calls needed.
    configuration.session = { id: data.id, sessionData: data.sessionData };
    return configuration;
  }

  // Advanced flow: we pass the /paymentMethods response and handle the payment calls ourselves.
  configuration.paymentMethodsResponse = data.paymentMethodsResponse;

  configuration.onSubmit = async (state, component, actions) => {
    Demo.logClientEvent(`onSubmit: ${state.data.paymentMethod?.type}`, { paymentMethod: { type: state.data.paymentMethod?.type } });
    try {
      const result = await post("/api/advanced/payments", { reference: data.reference, data: state.data });
      if (!result.resultCode) return actions.reject();
      // If there's an action (3DS2, redirect, QR), Drop-in handles it and then calls onAdditionalDetails.
      actions.resolve({ resultCode: result.resultCode, action: result.action, order: result.order, donationToken: result.donationToken });
    } catch (err) {
      showStatus(err.message, "error");
      actions.reject();
    }
  };

  configuration.onAdditionalDetails = async (state, component, actions) => {
    Demo.logClientEvent("onAdditionalDetails", { details: Object.keys(state.data.details || {}) });
    try {
      const result = await post("/api/advanced/payments/details", state.data);
      if (!result.resultCode) return actions.reject();
      actions.resolve({ resultCode: result.resultCode, action: result.action, order: result.order, donationToken: result.donationToken });
    } catch (err) {
      showStatus(err.message, "error");
      actions.reject();
    }
  };

  return configuration;
}

/* ---------- mounting ---------- */

function unmountAll() {
  mounted.forEach((component) => component.unmount());
  mounted = [];
  ["dropin-container", "googlepay-container", "card-container"].forEach((id) => (document.getElementById(id).innerHTML = ""));
}

function renderSummary(data, cfg) {
  const lines = items
    .map((item) => {
      const p = cfg.products[item.id];
      const amount = { value: p.price * item.quantity, currency: data.amount.currency };
      return `<div class="summary-line"><span>${item.quantity} × ${p.name}</span><span>${Demo.formatAmount(amount, data.locale)}</span></div>`;
    })
    .join("");
  const id = data.id ? ` · Session <code>${data.id}</code>` : "";
  document.getElementById("order-summary").innerHTML = `${lines}
    <div class="summary-line total"><span>Total</span><span>${Demo.formatAmount(data.amount, data.locale)}</span></div>
    <div class="muted" style="margin-top:8px">Reference <code>${data.reference}</code>${id}</div>`;
}

async function render() {
  const token = ++renderToken;
  const cfg = await Demo.getConfig();
  const opts = readOptions();

  hideStatus();
  document.getElementById("dropin-container").classList.toggle("hidden", opts.ui !== "dropin");
  document.getElementById("components-container").classList.toggle("hidden", opts.ui !== "components");

  let data;
  try {
    data = await loadPaymentData(opts);
  } catch (err) {
    unmountAll();
    showStatus(err.message, "error");
    return;
  }
  if (token !== renderToken) return; // a newer render started while we waited

  renderSummary(data, cfg);
  Demo.renderSnippets(opts, data, cfg);

  const checkout = await AdyenCheckout(checkoutConfiguration(opts, data, cfg));
  if (token !== renderToken) return;
  unmountAll();

  const types = checkout.paymentMethodsResponse?.paymentMethods?.map((pm) => pm.type) || [];
  const hasGooglePay = types.some((t) => t === "googlepay" || t === "paywithgoogle");
  Demo.logClientEvent(`AdyenCheckout initialised (${opts.flow}, ${opts.ui})`, { paymentMethods: types });

  if (opts.ui === "dropin") {
    const dropin = new Dropin(checkout, {
      openFirstPaymentMethod: opts.dropinOpenFirst,
      paymentMethodsConfiguration: {
        card: cardConfiguration(opts),
        googlepay: googlePayConfiguration(opts),
      },
      onReady: () => Demo.logClientEvent("Drop-in ready"),
      onSelect: (component) => Demo.logClientEvent(`Payment method selected: ${component.props?.type || component.type}`),
    }).mount("#dropin-container");
    mounted.push(dropin);
    return;
  }

  // Components: you decide the layout, e.g. an express Google Pay button above the card form.
  const note = document.getElementById("googlepay-note");
  note.classList.add("hidden");
  if (hasGooglePay) {
    const googlePay = new GooglePay(checkout, googlePayConfiguration(opts));
    mounted.push(googlePay);
    try {
      await googlePay.isAvailable(); // false if the browser / shopper can't use Google Pay
      if (token === renderToken) googlePay.mount("#googlepay-container");
    } catch {
      note.textContent = "Google Pay isn't available in this browser. Try Chrome signed in to a Google account.";
      note.classList.remove("hidden");
    }
  } else {
    note.textContent = "Google Pay isn't in the /paymentMethods response. Enable it for this merchant account in the Customer Area.";
    note.classList.remove("hidden");
  }
  if (token !== renderToken) return;

  const card = new Card(checkout, cardConfiguration(opts)).mount("#card-container");
  mounted.push(card);
}

/* ---------- wiring ---------- */

(async function init() {
  if (!items.length) {
    document.getElementById("order-summary").innerHTML = 'Your cart is empty. <a href="/">Go back</a>.';
    return;
  }
  const cfg = await Demo.getConfig();
  for (const [code, c] of Object.entries(cfg.countries)) countrySelect.add(new Option(`${c.name} (${c.currency})`, code));
  countrySelect.value = cfg.countries[params.get("country")] ? params.get("country") : "NL";

  document.querySelectorAll('input[name="flow"], input[name="ui"], #country, [data-opt]').forEach((el) =>
    el.addEventListener("change", render),
  );
  // Live value next to range sliders.
  document.querySelectorAll('input[type="range"]').forEach((el) =>
    el.addEventListener("input", () => (el.nextElementSibling.textContent = el.value)),
  );
  // Inspector / Code tabs.
  document.querySelectorAll(".tabs button").forEach((btn) =>
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b === btn));
      document.querySelectorAll(".side .panel").forEach((p) => p.classList.toggle("hidden", p.id !== btn.dataset.tab));
    }),
  );

  render();
})();
