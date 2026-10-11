require("dotenv").config();

const required = ["ADYEN_API_KEY", "ADYEN_CLIENT_KEY", "ADYEN_MERCHANT_ACCOUNT"];

// Keys copied from PDFs or chat often carry invisible zero-width characters or stray spaces.
const clean = (value) => (value || "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
for (const key of [...required, "ADYEN_HMAC_KEY"]) process.env[key] = clean(process.env[key]);

const config = {
  apiKey: process.env.ADYEN_API_KEY,
  clientKey: process.env.ADYEN_CLIENT_KEY,
  merchantAccount: process.env.ADYEN_MERCHANT_ACCOUNT,
  hmacKey: process.env.ADYEN_HMAC_KEY || "",
  environment: (process.env.ADYEN_ENVIRONMENT || "TEST").toUpperCase(),
  liveUrlPrefix: process.env.ADYEN_LIVE_URL_PREFIX || "",
  port: Number(process.env.PORT) || 8080,
  baseUrl: (process.env.BASE_URL || "").replace(/\/$/, ""),
};

function validateConfig() {
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(", ")}. Copy .env.example to .env and fill them in.`);
  }
  if (!["TEST", "LIVE"].includes(config.environment)) {
    throw new Error("ADYEN_ENVIRONMENT must be TEST or LIVE");
  }
  if (config.environment === "LIVE" && !config.liveUrlPrefix) {
    throw new Error("ADYEN_LIVE_URL_PREFIX is required when ADYEN_ENVIRONMENT=LIVE");
  }
}

// Prefer the configured public URL (e.g. ngrok / Codespaces), otherwise use the request host.
function getBaseUrl(req) {
  return config.baseUrl || `${req.protocol}://${req.get("host")}`;
}

module.exports = { config, validateConfig, getBaseUrl };
