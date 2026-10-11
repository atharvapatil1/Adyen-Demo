const express = require("express");
const { validator } = require("../adyen");
const { config } = require("../config");
const orders = require("../orders");
const log = require("../eventLog");

const router = express.Router();
const processed = new Set();

// Adyen sends Standard webhooks here. Configure the URL in
// Customer Area → Developers → Webhooks, e.g. https://<public-host>/api/webhooks/notifications
router.post("/notifications", (req, res) => {
  const items = req.body?.notificationItems;
  if (!Array.isArray(items)) return res.status(400).json({ error: "notificationItems missing" });

  for (const { NotificationRequestItem: item } of items) {
    if (!item) continue;

    // 1. Verify the HMAC signature so nobody can forge a payment result.
    if (config.hmacKey) {
      if (!validator.validateHMAC(item, config.hmacKey)) {
        log.record("error", "Webhook rejected: invalid HMAC", { pspReference: item.pspReference });
        return res.status(401).json({ error: "Invalid HMAC signature" });
      }
    } else {
      log.record("error", "ADYEN_HMAC_KEY not set: webhook signature NOT verified", null);
    }

    // 2. Deduplicate: Adyen retries until it gets a 2xx, so the same event can arrive twice.
    const key = `${item.pspReference}:${item.eventCode}:${item.success}`;
    const duplicate = processed.has(key);
    processed.add(key);

    log.record("webhook", `${item.eventCode} ${item.success === "true" ? "✓" : "✗"}${duplicate ? " (duplicate)" : ""}`, {
      merchantReference: item.merchantReference,
      pspReference: item.pspReference,
      eventCode: item.eventCode,
      success: item.success,
      paymentMethod: item.paymentMethod,
      amount: item.amount,
      reason: item.reason,
    });

    if (!duplicate) applyToOrder(item);
  }

  // 3. Acknowledge quickly. Do heavy processing asynchronously in production.
  res.status(202).send("[accepted]");
});

function applyToOrder(item) {
  const order = orders.get(item.merchantReference);
  if (!order) return;

  order.webhooks.push({ eventCode: item.eventCode, success: item.success, pspReference: item.pspReference, at: new Date().toISOString() });

  if (item.eventCode === "AUTHORISATION") {
    orders.update(item.merchantReference, {
      status: item.success === "true" ? "Authorised" : "Refused",
      pspReference: item.pspReference,
      paymentMethod: item.paymentMethod,
      reason: item.reason,
    });
  }
}

module.exports = router;
