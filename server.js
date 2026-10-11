const express = require("express");
const path = require("path");
const { config, validateConfig } = require("./src/config");

try {
  validateConfig();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const app = express();
app.set("trust proxy", true);
app.use(express.json());
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

app.use("/api", require("./src/routes/payments"));
app.use("/api/webhooks", require("./src/routes/webhooks"));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(config.port, () => {
  console.log(`Adyen Drop-in demo running on http://localhost:${config.port} (${config.environment})`);
});
