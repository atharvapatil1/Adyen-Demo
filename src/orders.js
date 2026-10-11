// Order store keyed by merchant reference. In-memory for the demo;
// use a database in production so state survives restarts.
const orders = new Map();

function create(reference, order) {
  orders.set(reference, { reference, ...order, status: "Created", webhooks: [], createdAt: new Date().toISOString() });
}

function get(reference) {
  return orders.get(reference);
}

function update(reference, fields) {
  const order = orders.get(reference);
  if (order) Object.assign(order, fields);
  return order;
}

module.exports = { create, get, update };
