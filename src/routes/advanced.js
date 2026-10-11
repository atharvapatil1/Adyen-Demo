// Advanced flow: three server endpoints instead of one /sessions call.
// You own each step, so you can change the request right before /payments
// (e.g. add risk data, split payments, apply a discount) and run your own logic
// between steps.
const express = require("express");
const crypto = require("crypto");
const { checkout } = require("../adyen");
const { config, getBaseUrl } = require("../config");
const { buildOrder, newReference, tokenisationFields } = require("../catalog");
const orders = require("../orders");
const log = require("../eventLog");
const { describeAdyenError } = require("../util");

const router = express.Router();

// Only these fields of Drop-in's state.data are forwarded to Adyen.
// Amount, reference and merchant account always come from the server.
const ALLOWED_STATE_FIELDS = [
  "paymentMethod", "browserInfo", "billingAddress", "deliveryAddress", "riskData", "storePaymentMethod",
  "shopperName", "shopperEmail", "telephoneNumber", "installments", "clientStateDataIndicator", "conversionId", "origin",
];

// Step 1: which payment methods can this shopper use for this amount/country?
router.post("/paymentMethods", async (req, res) => {
  const { countryCode = "NL", items, storePaymentMethod } = req.body || {};
  let order;
  try {
    order = buildOrder(items, countryCode);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const reference = newReference();
  const request = {
    merchantAccount: config.merchantAccount,
    amount: order.amount,
    countryCode,
    shopperLocale: order.locale,
    channel: "Web",
    ...(storePaymentMethod && { shopperReference: tokenisationFields.shopperReference }),
  };
  log.record("server", "POST /paymentMethods → Adyen", request);

  try {
    const paymentMethodsResponse = await checkout.PaymentsApi.paymentMethods(request);
    orders.create(reference, { ...order, countryCode, flow: "advanced", storePaymentMethod: !!storePaymentMethod });
    log.record("adyen", "200 /paymentMethods ← Adyen", {
      paymentMethods: paymentMethodsResponse.paymentMethods?.map((pm) => pm.type),
      storedPaymentMethods: paymentMethodsResponse.storedPaymentMethods?.length || 0,
    });
    res.json({ paymentMethodsResponse, reference, amount: order.amount, countryCode, locale: order.locale });
  } catch (err) {
    fail(res, "/paymentMethods failed", err);
  }
});

// Step 2: make the payment with the encrypted data Drop-in collected (state.data).
router.post("/payments", async (req, res) => {
  const { reference, data } = req.body || {};
  const order = orders.get(reference);
  if (!order || order.flow !== "advanced") return res.status(404).json({ error: "Unknown order reference" });
  if (!data?.paymentMethod) return res.status(400).json({ error: "paymentMethod is required" });

  const stateData = Object.fromEntries(ALLOWED_STATE_FIELDS.filter((k) => k in data).map((k) => [k, data[k]]));
  const request = {
    ...stateData,
    merchantAccount: config.merchantAccount,
    amount: order.amount,
    reference,
    countryCode: order.countryCode,
    shopperLocale: order.locale,
    lineItems: order.lineItems,
    channel: "Web",
    origin: getBaseUrl(req), // needed for native 3DS2
    returnUrl: `${getBaseUrl(req)}/redirect?reference=${encodeURIComponent(reference)}&flow=advanced`,
    shopperIP: req.ip,
    authenticationData: { threeDSRequestData: { nativeThreeDS: "preferred" } },
    ...(order.storePaymentMethod && tokenisationFields),
  };
  log.record("server", "POST /payments → Adyen", { ...request, paymentMethod: redactPaymentMethod(request.paymentMethod) });

  try {
    // Same request body → same key, so a network retry returns the original result instead of
    // charging twice, while a new attempt (different card, new encrypted data) gets a new key.
    const idempotencyKey = crypto.createHash("sha256").update(JSON.stringify(request)).digest("hex");
    const response = await checkout.PaymentsApi.payments(request, { idempotencyKey });
    if (response.pspReference) orders.update(reference, { pspReference: response.pspReference });
    log.record("adyen", `/payments ← Adyen: ${response.resultCode}${response.action ? ` + action:${response.action.type}` : ""}`, response);
    res.json(pick(response));
  } catch (err) {
    fail(res, "/payments failed", err);
  }
});

// Step 3: complete the payment after an action (3DS2 challenge, redirect, ...).
router.post("/payments/details", async (req, res) => {
  const { details, paymentData } = req.body || {};
  if (!details) return res.status(400).json({ error: "details is required" });
  log.record("server", "POST /payments/details → Adyen", { details: Object.keys(details), paymentData: !!paymentData });

  try {
    const response = await checkout.PaymentsApi.paymentsDetails({ details, ...(paymentData && { paymentData }) });
    log.record("adyen", `/payments/details ← Adyen: ${response.resultCode}`, response);
    res.json(pick(response));
  } catch (err) {
    fail(res, "/payments/details failed", err);
  }
});

// Only send the browser what Drop-in needs.
function pick({ resultCode, action, order, donationToken, merchantReference, pspReference, refusalReason }) {
  return { resultCode, action, order, donationToken, merchantReference, pspReference, refusalReason };
}

function redactPaymentMethod(pm = {}) {
  return Object.fromEntries(Object.entries(pm).map(([k, v]) => [k, typeof v === "string" && v.length > 40 ? `${v.slice(0, 20)}…` : v]));
}

function fail(res, title, err) {
  const error = describeAdyenError(err);
  log.record("error", title, error);
  res.status(error.status || 500).json({ error: error.message, details: error });
}

module.exports = router;
