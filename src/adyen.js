const { Client, CheckoutAPI, hmacValidator } = require("@adyen/api-library");
const { config } = require("./config");

const client = new Client({
  apiKey: config.apiKey,
  environment: config.environment,
  ...(config.liveUrlPrefix && { liveEndpointUrlPrefix: config.liveUrlPrefix }),
  applicationName: "adyen-sessions-dropin-demo",
});

const checkout = new CheckoutAPI(client);
const validator = new hmacValidator();

module.exports = { checkout, validator };
