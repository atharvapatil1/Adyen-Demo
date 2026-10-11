// Handles the shopper returning to returnUrl after a redirect payment method.
// Sessions flow: recreate AdyenCheckout with only the session id, then submit the redirectResult.
// Advanced flow: send the redirectResult to our server, which calls /payments/details.
const { AdyenCheckout } = window.AdyenWeb;

(async function handleRedirect() {
  const params = new URLSearchParams(window.location.search);
  const reference = params.get("reference");
  const sessionId = params.get("sessionId");
  const redirectResult = params.get("redirectResult");

  Demo.logClientEvent("Shopper returned to returnUrl", { reference, sessionId, redirectResult: redirectResult && `${redirectResult.slice(0, 32)}…` });

  if (!redirectResult || (!sessionId && params.get("flow") !== "advanced")) {
    const status = document.getElementById("status");
    status.textContent = "Missing sessionId or redirectResult in the URL.";
    status.className = "status-banner show error";
    return;
  }

  if (params.get("flow") === "advanced") {
    const res = await fetch("/api/advanced/payments/details", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ details: { redirectResult } }),
    });
    const result = await res.json().catch(() => ({}));
    Demo.logClientEvent(`/payments/details after redirect: ${result.resultCode || "Error"}`, result);
    Demo.goToResult({ reference, resultCode: result.resultCode || "Error" });
    return;
  }

  const cfg = await Demo.getConfig();
  const checkout = await AdyenCheckout({
    session: { id: sessionId },
    clientKey: cfg.clientKey,
    environment: cfg.environment,
    onPaymentCompleted(result) {
      Demo.logClientEvent(`onPaymentCompleted (after redirect): ${result.resultCode}`, result);
      Demo.goToResult({ ...result, reference, sessionId });
    },
    onPaymentFailed(result) {
      Demo.logClientEvent(`onPaymentFailed (after redirect): ${result?.resultCode}`, result);
      Demo.goToResult({ ...result, reference, sessionId, resultCode: result?.resultCode || "Refused" });
    },
    onError(error) {
      Demo.logClientEvent(`onError (after redirect): ${error.name}`, { message: error.message });
      Demo.goToResult({ reference, sessionId, resultCode: "Error" });
    },
  });

  checkout.submitDetails({ details: { redirectResult } });
})();
