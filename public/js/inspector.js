// Integration inspector: live timeline of server calls, Adyen responses,
// Drop-in client events and webhooks (streamed from /api/events via SSE).
(function () {
  const root = document.getElementById("inspector");
  if (!root) return;

  root.innerHTML = `
    <div class="head"><h2>Integration inspector</h2><button type="button" id="inspector-clear">Clear</button></div>
    <div class="legend">
      <span class="badge client">client</span><span class="badge server">server</span>
      <span class="badge adyen">adyen</span><span class="badge webhook">webhook</span><span class="badge error">error</span>
    </div>
    <div class="events" id="inspector-events"><div class="empty">Waiting for events… Create a session to start.</div></div>`;

  const list = root.querySelector("#inspector-events");
  const seen = new Set();

  function render(event) {
    if (seen.has(event.id)) return;
    seen.add(event.id);
    list.querySelector(".empty")?.remove();

    const el = document.createElement("details");
    el.className = `event ${event.source}`;
    const time = new Date(event.at).toLocaleTimeString([], { hour12: false });
    el.innerHTML = `<summary><time></time><span class="badge ${event.source}"></span><span class="title"></span></summary>`;
    el.querySelector("time").textContent = time;
    el.querySelector(".badge").textContent = event.source;
    el.querySelector(".title").textContent = event.title;
    if (event.data !== null && event.data !== undefined) {
      const pre = document.createElement("pre");
      pre.textContent = JSON.stringify(event.data, null, 2);
      el.appendChild(pre);
    }
    list.appendChild(el);
    list.scrollTop = list.scrollHeight;
  }

  const source = new EventSource("/api/events");
  source.onmessage = (msg) => render(JSON.parse(msg.data));

  root.querySelector("#inspector-clear").addEventListener("click", async () => {
    await fetch("/api/events", { method: "DELETE" });
    list.innerHTML = '<div class="empty">Cleared.</div>';
  });
})();
