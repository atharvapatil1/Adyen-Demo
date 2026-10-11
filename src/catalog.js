const crypto = require("crypto");

// The server owns prices. The browser only sends item ids and quantities,
// so a shopper can't change the amount they're charged.
const products = {
  sunglasses: { name: "Kestrel Aviator Sunglasses", price: 9500, image: "/images/sunglasses.svg" },
  headphones: { name: "Kestrel Studio Headphones", price: 14900, image: "/images/headphones.svg" },
};

// Country drives currency, locale and which payment methods Drop-in shows.
const countries = {
  NL: { name: "Netherlands", currency: "EUR", locale: "nl-NL" },
  DE: { name: "Germany", currency: "EUR", locale: "de-DE" },
  BE: { name: "Belgium", currency: "EUR", locale: "nl-BE" },
  FR: { name: "France", currency: "EUR", locale: "fr-FR" },
  GB: { name: "United Kingdom", currency: "GBP", locale: "en-GB" },
  US: { name: "United States", currency: "USD", locale: "en-US" },
  SE: { name: "Sweden", currency: "SEK", locale: "sv-SE" },
  PL: { name: "Poland", currency: "PLN", locale: "pl-PL" },
  AU: { name: "Australia", currency: "AUD", locale: "en-AU" },
  SG: { name: "Singapore", currency: "SGD", locale: "en-SG" },
};

function buildOrder(items, countryCode) {
  const country = countries[countryCode];
  if (!country) throw new Error(`Unsupported country: ${countryCode}`);

  const lineItems = [];
  for (const { id, quantity } of items || []) {
    const product = products[id];
    const qty = Math.floor(Number(quantity));
    if (!product || !(qty > 0 && qty <= 10)) continue;
    lineItems.push({
      id,
      description: product.name,
      quantity: qty,
      amountIncludingTax: product.price,
    });
  }
  if (!lineItems.length) throw new Error("Cart is empty");

  const value = lineItems.reduce((sum, li) => sum + li.amountIncludingTax * li.quantity, 0);
  return { amount: { currency: country.currency, value }, lineItems, locale: country.locale };
}

function newReference() {
  return `ORDER-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
}

// Tokenisation: with a shopperReference, Drop-in shows the shopper's stored cards.
// Use your own stable customer id in production.
const DEMO_SHOPPER_REFERENCE = "demo-shopper-001";
const tokenisationFields = {
  shopperReference: DEMO_SHOPPER_REFERENCE,
  recurringProcessingModel: "CardOnFile",
  shopperInteraction: "Ecommerce",
};

module.exports = { products, countries, buildOrder, newReference, DEMO_SHOPPER_REFERENCE, tokenisationFields };
