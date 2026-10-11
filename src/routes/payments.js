const express = require("express");
const crypto = require("crypto");
const { checkout } = require("../adyen");
const { config, getBaseUrl } = require("../config");
const { buildOrder, countries, products } = require("../catalog");
const orders = require("../orders");
const log = require("../eventLog");

const router = express.Router();
const DEMO_SHOPPER_REFERENCE = "demo-shopper-001";

// Public settings the browser needs. The client key is safe to expose;
// the API key never leaves the server.
router.get("/config", (req, res) => {
  res.json({
    clientKey: config.clientKey,
    environment: config.environment.toLowerCase(),
    countries,
    products,
  });
});

// Step 1 of the Sessions flow: the server creates a payment session.
// Drop-in then uses { id, sessionData } to fetch payment methods and make the payment.
router.post("/sessions", async (req, res) => {
  const { countryCode = "NL", items, storePaymentMethod } = req.body || {};

  let order;
  try {
    order = buildOrder(items, countryCode);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const reference = `ORDER-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const sessionRequest = {
    merchantAccount: config.merchantAccount,
    amount: order.amount,
    reference,
    countryCode,
    shopperLocale: order.locale,
    channel: "Web",
    // Where the shopper lands after a redirect method (iDEAL, 3DS2 fallback, PayPal, ...)
    returnUrl: `${getBaseUrl(req)}/redirect?reference=${encodeURIComponent(reference)}`,
    // Line items are required for open invoice methods like Klarna and Riverty.
    lineItems: order.lineItems,
  };

  // Tokenisation: with a shopperReference, Drop-in shows the shopper's stored cards
  // and a "save for next time" checkbox. Use your own stable customer id in production.
  if (storePaymentMethod) {
    Object.assign(sessionRequest, {
      shopperReference: DEMO_SHOPPER_REFERENCE,
      storePaymentMethodMode: "askForConsent",
      recurringProcessingModel: "CardOnFile",
      shopperInteraction: "Ecommerce",
    });
  }

  log.record("server", "POST /sessions → Adyen", sessionRequest);

  try {
    // Idempotency key makes a retried request safe: Adyen returns the original session.
    const session = await checkout.PaymentsApi.sessions(sessionRequest, { idempotencyKey: reference });
    orders.create(reference, { amount: order.amount, countryCode, sessionId: session.id });

    log.record("adyen", "201 /sessions ← Adyen", {
      id: session.id,
      reference: session.reference,
      amount: session.amount,
      expiresAt: session.expiresAt,
      sessionData: truncate(session.sessionData),
    });

    res.json({ id: session.id, sessionData: session.sessionData, amount: session.amount, reference, countryCode, locale: order.locale });
  } catch (err) {
    const error = describeAdyenError(err);
    log.record("error", "/sessions failed", error);
    res.status(error.status || 500).json({ error: error.message, details: error });
  }
});

// Optional server-side check of the session outcome (GET /sessions/{id}?sessionResult=...).
// The client result is only a hint for the UI; webhooks are the source of truth.
router.get("/sessions/:id/result", async (req, res) => {
  const { sessionResult } = req.query;
  if (!sessionResult) return res.status(400).json({ error: "sessionResult is required" });
  try {
    const result = await checkout.PaymentsApi.getResultOfPaymentSession(req.params.id, sessionResult);
    log.record("adyen", "GET /sessions/{id} ← Adyen", result);
    res.json(result);
  } catch (err) {
    const error = describeAdyenError(err);
    log.record("error", "Session result lookup failed", error);
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.get("/orders/:reference", (req, res) => {
  const order = orders.get(req.params.reference);
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.json(order);
});

// Lets the browser forward Drop-in events into the shared inspector timeline.
router.post("/client-events", (req, res) => {
  const { title, data } = req.body || {};
  if (typeof title === "string") log.record("client", title.slice(0, 120), data);
  res.status(204).end();
});

router.get("/events", log.stream);
router.delete("/events", (req, res) => {
  log.clear();
  res.status(204).end();
});

function truncate(value, length = 48) {
  return typeof value === "string" && value.length > length ? `${value.slice(0, length)}… (${value.length} chars)` : value;
}

function describeAdyenError(err) {
  let body;
  try {
    body = err.responseBody ? JSON.parse(err.responseBody) : undefined;
  } catch {
    body = err.responseBody;
  }
  return {
    status: err.statusCode,
    message: body?.message || err.message,
    errorCode: body?.errorCode || err.errorCode,
    errorType: body?.errorType,
  };
}

module.exports = router;
