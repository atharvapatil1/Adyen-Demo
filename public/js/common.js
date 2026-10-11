// Shared helpers used by every page.
window.Demo = {
  async getConfig() {
    if (!this._config) this._config = fetch("/api/config").then((r) => r.json());
    return this._config;
  },

  formatAmount({ value, currency }, locale = "en-US") {
    // Minor units: most currencies have 2 decimals (e.g. 10000 EUR = €100.00).
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(value / 100);
  },

  // Send a browser-side event to the server so it shows up in the inspector timeline.
  logClientEvent(title, data) {
    console.info(`[Drop-in] ${title}`, data ?? "");
    fetch("/api/client-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, data: data ?? null }),
      keepalive: true,
    }).catch(() => {});
  },

  // Navigate to the result page with whatever the client knows.
  // The result page then confirms the outcome via the server / webhooks.
  goToResult({ reference, sessionId, resultCode, sessionResult }) {
    const params = new URLSearchParams({ reference: reference || "", resultCode: resultCode || "Error" });
    if (sessionId) params.set("sessionId", sessionId);
    if (sessionResult) params.set("sessionResult", sessionResult);
    window.location.href = `/result?${params}`;
  },
};
