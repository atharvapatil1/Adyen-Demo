// "Code" tab: shows the frontend and backend code that produces what's on screen,
// regenerated whenever an option changes.
(function () {
  const raw = (code) => ({ __raw: code });

  // Small JS-literal printer: unquoted keys, skips undefined/false-y defaults, supports raw code.
  function js(value, indent = 0) {
    const pad = "  ".repeat(indent + 1);
    const end = "  ".repeat(indent);
    if (value && value.__raw) return value.__raw.replace(/\n/g, `\n${end}`);
    if (Array.isArray(value)) return `[${value.map((v) => js(v, indent)).join(", ")}]`;
    if (value && typeof value === "object") {
      const entries = Object.entries(value).filter(([, v]) => v !== undefined);
      if (!entries.length) return "{}";
      return `{\n${entries.map(([k, v]) => `${pad}${/^[a-zA-Z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${js(v, indent + 1)},`).join("\n")}\n${end}}`;
    }
    return JSON.stringify(value);
  }

  function googlePay(opts) {
    return {
      buttonType: opts.gpButtonType,
      buttonColor: opts.gpButtonColor,
      buttonSizeMode: opts.gpButtonSizeMode,
      buttonRadius: opts.gpButtonRadius,
      emailRequired: opts.gpEmailRequired || undefined,
      billingAddressRequired: opts.gpBillingAddressRequired || undefined,
      billingAddressParameters: opts.gpBillingAddressRequired ? { format: "FULL", phoneNumberRequired: true } : undefined,
      shippingAddressRequired: opts.gpShippingAddressRequired || undefined,
      shippingAddressParameters: opts.gpShippingAddressRequired ? { phoneNumberRequired: true } : undefined,
      existingPaymentMethodRequired: opts.gpExistingPaymentMethodRequired || undefined,
      onAuthorized: raw("(data, actions) => {\n  // data.authorizedEvent has email/addresses; validate, then:\n  actions.resolve();\n}"),
    };
  }

  function card(opts) {
    return {
      hasHolderName: opts.cardHolderName,
      holderNameRequired: opts.cardHolderName || undefined,
      billingAddressRequired: opts.cardBillingAddress || undefined,
    };
  }

  function frontend(opts, data, cfg) {
    const sessions = opts.flow === "sessions";
    const imports = opts.ui === "dropin" ? "AdyenCheckout, Dropin" : "AdyenCheckout, GooglePay, Card";

    const config = {
      ...(sessions
        ? { session: raw("{ id: session.id, sessionData: session.sessionData }") }
        : { paymentMethodsResponse: raw("paymentMethods.paymentMethodsResponse") }),
      clientKey: cfg.clientKey,
      environment: cfg.environment,
      amount: data.amount,
      countryCode: opts.countryCode,
      locale: data.locale,
      ...(!sessions && {
        onSubmit: raw(
          'async (state, component, actions) => {\n  const res = await post("/api/advanced/payments", { reference, data: state.data });\n  if (!res.resultCode) return actions.reject();\n  const { resultCode, action, order, donationToken } = res;\n  actions.resolve({ resultCode, action, order, donationToken });\n}',
        ),
        onAdditionalDetails: raw(
          'async (state, component, actions) => {\n  const res = await post("/api/advanced/payments/details", state.data);\n  if (!res.resultCode) return actions.reject();\n  actions.resolve({ resultCode: res.resultCode, action: res.action });\n}',
        ),
      }),
      onPaymentCompleted: raw("(result, component) => showResult(result.resultCode)"),
      onPaymentFailed: raw("(result, component) => showResult(result.resultCode)"),
      onError: raw("(error, component) => console.error(error.name, error.message)"),
    };

    const setup = sessions
      ? '// 1. Your server creates the session\nconst session = await post("/api/sessions", { countryCode, items });'
      : '// 1. Your server fetches the available payment methods\nconst paymentMethods = await post("/api/advanced/paymentMethods", { countryCode, items });\nconst reference = paymentMethods.reference;';

    const mount =
      opts.ui === "dropin"
        ? `// 3. Mount Drop-in: renders every enabled method, incl. Google Pay\nnew Dropin(checkout, ${js({
            openFirstPaymentMethod: opts.dropinOpenFirst,
            paymentMethodsConfiguration: { card: card(opts), googlepay: googlePay(opts) },
          })}).mount("#dropin-container");`
        : `// 3. Mount Components where you want them\nconst googlePay = new GooglePay(checkout, ${js(googlePay(opts))});\n\ngooglePay.isAvailable()\n  .then(() => googlePay.mount("#googlepay-container"))\n  .catch(() => { /* hide the express checkout section */ });\n\nnew Card(checkout, ${js(card(opts))}).mount("#card-container");`;

    return `const { ${imports} } = window.AdyenWeb;\n\n${setup}\n\n// 2. Create the checkout instance\nconst checkout = await AdyenCheckout(${js(config)});\n\n${mount}`;
  }

  function backend(opts, data) {
    const tokenise = opts.tokenise
      ? { shopperReference: "demo-shopper-001", recurringProcessingModel: "CardOnFile", shopperInteraction: "Ecommerce" }
      : {};
    const base = {
      merchantAccount: raw("process.env.ADYEN_MERCHANT_ACCOUNT"),
      amount: raw(`{ value: ${data.amount.value}, currency: "${data.amount.currency}" } // priced on the server`),
    };

    if (opts.flow === "sessions") {
      return `// POST /api/sessions  (Node, @adyen/api-library)\nconst session = await checkout.PaymentsApi.sessions(${js({
        ...base,
        reference: raw("orderReference"),
        countryCode: opts.countryCode,
        shopperLocale: data.locale,
        channel: "Web",
        returnUrl: raw("`${baseUrl}/redirect?reference=${orderReference}`"),
        lineItems: raw("order.lineItems // needed for Klarna, Riverty, ..."),
        ...tokenise,
        ...(opts.tokenise && { storePaymentMethodMode: "askForConsent" }),
      })}, { idempotencyKey: orderReference });\n\nres.json({ id: session.id, sessionData: session.sessionData });`;
    }

    return `// 1. POST /api/advanced/paymentMethods\nconst paymentMethodsResponse = await checkout.PaymentsApi.paymentMethods(${js({
      ...base,
      countryCode: opts.countryCode,
      shopperLocale: data.locale,
      channel: "Web",
      ...(opts.tokenise && { shopperReference: "demo-shopper-001" }),
    })});\n\n// 2. POST /api/advanced/payments  (state.data from Drop-in)\nconst payment = await checkout.PaymentsApi.payments(${js({
      paymentMethod: raw("state.data.paymentMethod // encrypted card / Google Pay token"),
      browserInfo: raw("state.data.browserInfo // for 3DS2"),
      billingAddress: raw("state.data.billingAddress"),
      ...base,
      reference: raw("orderReference"),
      countryCode: opts.countryCode,
      channel: "Web",
      origin: raw("baseUrl"),
      returnUrl: raw("`${baseUrl}/redirect?reference=${orderReference}&flow=advanced`"),
      authenticationData: { threeDSRequestData: { nativeThreeDS: "preferred" } },
      lineItems: raw("order.lineItems"),
      ...tokenise,
    })}, { idempotencyKey });\n// → { resultCode, action? }  If there's an action, Drop-in performs it.\n\n// 3. POST /api/advanced/payments/details  (after 3DS2 / redirect)\nconst details = await checkout.PaymentsApi.paymentsDetails({\n  details: state.data.details, // or { redirectResult } from the returnUrl\n});`;
  }

  function webhook() {
    return `// POST /api/webhooks/notifications\nfor (const { NotificationRequestItem: item } of req.body.notificationItems) {\n  if (!hmacValidator.validateHMAC(item, process.env.ADYEN_HMAC_KEY)) return res.sendStatus(401);\n  if (alreadyProcessed(item)) continue;           // Adyen retries until it gets a 2xx\n  if (item.eventCode === "AUTHORISATION") {\n    markOrder(item.merchantReference, item.success === "true" ? "paid" : "failed");\n  }\n}\nres.status(202).send("[accepted]");`;
  }

  window.Demo.renderSnippets = function (opts, data, cfg) {
    const panel = document.getElementById("code-panel");
    if (!panel) return;
    const flowLabel = opts.flow === "sessions" ? "Sessions flow" : "Advanced flow";
    const uiLabel = opts.ui === "dropin" ? "Drop-in" : "Components";
    const blocks = [
      ["Browser", `${uiLabel} · ${flowLabel}. Change any option and this updates.`, frontend(opts, data, cfg)],
      ["Server", opts.flow === "sessions" ? "One endpoint. The API key never leaves the server." : "Three endpoints. You control each request.", backend(opts, data)],
      ["Webhook", "Source of truth for the payment outcome.", webhook()],
    ];
    panel.innerHTML = "";
    for (const [title, note, code] of blocks) {
      const h = document.createElement("h3");
      h.textContent = title;
      const copy = document.createElement("button");
      copy.type = "button";
      copy.textContent = "Copy";
      copy.addEventListener("click", () => navigator.clipboard?.writeText(code).then(() => (copy.textContent = "Copied")));
      h.appendChild(copy);
      const p = document.createElement("p");
      p.textContent = note;
      const pre = document.createElement("pre");
      pre.textContent = code;
      panel.append(h, p, pre);
    }
  };
})();
