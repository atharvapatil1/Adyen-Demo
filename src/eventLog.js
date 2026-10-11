// In-memory event log, streamed to the browser's "Integration inspector" via
// Server-Sent Events so the audience can see each API call and webhook live.
// A real integration would persist payment state in a database instead.
const MAX_EVENTS = 200;
const events = [];
const clients = new Set();
let nextId = 1;

function record(source, title, data) {
  const event = { id: nextId++, at: new Date().toISOString(), source, title, data };
  events.push(event);
  if (events.length > MAX_EVENTS) events.shift();
  for (const res of clients) res.write(`data: ${JSON.stringify(event)}\n\n`);
  return event;
}

function stream(req, res) {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.flushHeaders();
  for (const event of events) res.write(`data: ${JSON.stringify(event)}\n\n`);
  clients.add(res);
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => {
    clearInterval(ping);
    clients.delete(res);
  });
}

function clear() {
  events.length = 0;
}

module.exports = { record, stream, clear };
