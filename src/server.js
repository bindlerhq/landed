// The demo server. No dependencies, no build step: node src/server.js and open the page.
// POST /api/quote  -> the landed-cost quote plus the PayPal order body that would be created.
// POST /api/paypal -> actually creates the sandbox order, if credentials are in the environment.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { quote } from "./landed.js";
import { orderBody, createOrder } from "./paypal.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8787;
const json = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj, null, 1)); };

async function readBody(req) {
  let s = ""; for await (const c of req) { s += c; if (s.length > 1e6) throw new Error("body too large"); }
  return s ? JSON.parse(s) : {};
}

createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/api/quote") {
      const order = await readBody(req);
      const q = quote(order);
      return json(res, 200, { quote: q, paypal_order_body: orderBody(q, { freight_eur: order.freight_and_insurance_eur || 0, description: order.description }) });
    }
    if (req.method === "POST" && req.url === "/api/paypal") {
      const order = await readBody(req);
      const q = quote(order);
      if (!q.complete) return json(res, 400, { error: "this quote is incomplete, so it is not turned into money", unresolved: q.unresolved });
      return json(res, 200, await createOrder(q, { freight_eur: order.freight_and_insurance_eur || 0, description: order.description }));
    }
    if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
      const html = await readFile(join(HERE, "..", "public", "index.html"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(html);
    }
    json(res, 404, { error: "not found" });
  } catch (e) { json(res, 400, { error: String(e.message) }); }
}).listen(PORT, () => console.log("Landed demo on http://localhost:" + PORT));
