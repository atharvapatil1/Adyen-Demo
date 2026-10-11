// Renders docs/CASE_STUDY.md as a page in the demo, so it can be presented
// from the same browser tab as the checkout. Mermaid diagrams render client-side.
const express = require("express");
const fs = require("fs/promises");
const path = require("path");
const { Marked } = require("marked");

const router = express.Router();
const file = path.join(__dirname, "../../docs/CASE_STUDY.md");

const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const marked = new Marked({
  renderer: {
    code({ text, lang }) {
      if (lang === "mermaid") return `<pre class="mermaid">${escapeHtml(text)}</pre>`;
      return false; // default rendering
    },
  },
});

router.get("/", async (req, res, next) => {
  try {
    const html = marked.parse(await fs.readFile(file, "utf8"));
    res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Kestrel &amp; Co. · Case study</title>
  <link rel="stylesheet" href="/css/style.css">
</head>
<body>
  <header class="top">
    <a class="logo" href="/">Kestrel<span>&amp;Co.</span></a>
    <span class="tag">Adyen TEST · Adyen Web v6.45.2</span>
    <nav><a href="/">Shop</a><a href="/case-study">Case study</a><a href="/how-it-works">How it works</a></nav>
  </header>
  <main class="layout single"><article class="card prose">${html}</article></main>
  <script src="/vendor/mermaid.min.js"></script>
  <script>mermaid.initialize({ startOnLoad: true, theme: "neutral", sequence: { mirrorActors: false } });</script>
</body>
</html>`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
