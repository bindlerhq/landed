#!/usr/bin/env node
// Landed as an MCP server over stdio, so any agent that speaks MCP can price the border before it
// pays. No dependencies: JSON-RPC 2.0 over newline-delimited stdin, which is all MCP stdio is.
//
//   claude mcp add landed -- node /path/to/src/mcp.js
//
// Credentials, if the agent is going to create a PayPal order, come from this process's
// environment. The server never echoes them and never writes them anywhere.

import { quote } from "./landed.js";
import { createOrder, captureOrder, orderBody } from "./paypal.js";

const ORDER_SCHEMA = {
  type: "object",
  properties: {
    destination_region: { type: "string", description: "EU, or anything else for an order the EU border rules do not reach. Default EU." },
    origin_country: { type: "string", description: "ISO country the goods are shipped from." },
    year: { type: "integer", description: "Year of import, 2026 to 2034, for the CBAM phase-in factor. Default 2026." },
    intrinsic_value_eur: { type: "number", description: "The goods value the agent is quoting, excluding freight." },
    freight_and_insurance_eur: { type: "number", description: "Transport and insurance to the first destination in the EU." },
    customs_duty_eur: { type: "number", description: "Tariff duty, read from TARIC for the CN code and origin. Leave out and the line comes back unresolved rather than guessed." },
    destination_vat_rate: { type: "number", description: "Standard VAT rate of the destination member state, as a percentage. Leave out and the VAT line comes back unresolved: the rate is a member-state choice and this server will not assert one." },
    certificate_price_eur: { type: "number", description: "CBAM certificate price, which tracks the EU ETS auction price. Required only for Annex I goods." },
    goods: {
      type: "object",
      properties: {
        cbam_sector: { type: "string", description: "One of Cement, Fertilisers, Iron and steel, Aluminium, Hydrogen, Electricity. Omit for anything else: CBAM then does not apply and no line is returned." },
        cn_code: { type: "string" },
        tonnes: { type: "number" },
        embedded_tco2e_per_tonne: { type: "number", description: "Embedded emissions per tonne of goods, from the installation's own data or the default values." },
        origin_carbon_price_eur_per_tonne: { type: "number", description: "Carbon price already paid in the country of origin, credited against the certificate price." },
      },
    },
    ai_system: { type: "object", description: "Present only if what is being sold is an AI system placed on the EU market. Returns the AI Act classification, the obligations, the date they apply and the fine ceiling." },
  },
  required: ["destination_region"],
};

const TOOLS = [
  {
    name: "landed_quote",
    description: "Price the border on a cross-border order: the CBAM certificate cost, customs duty relief, import VAT and any EU AI Act obligation, each with the instrument it comes from. Returns the landed total and the uplift on the quoted price. Any figure it cannot derive comes back marked unresolved with what it needs, never estimated: call this before quoting a cross-border price to a buyer.",
    inputSchema: ORDER_SCHEMA,
  },
  {
    name: "landed_paypal_order",
    description: "Build the PayPal order for a landed-cost quote, with every regulatory line itemised and its legal instrument in the line description, so the buyer approves the true landed cost rather than the page price. Set dry_run true to see the exact order body without calling PayPal. Unresolved lines are excluded from the amount charged.",
    inputSchema: {
      type: "object",
      properties: {
        order: ORDER_SCHEMA,
        description: { type: "string", description: "What the goods are, for the buyer's approval screen." },
        currency: { type: "string", description: "Default EUR." },
        dry_run: { type: "boolean", description: "True returns the order body without contacting PayPal. Default false." },
      },
      required: ["order"],
    },
  },
  {
    name: "landed_capture_order",
    description: "Capture an approved PayPal order by id.",
    inputSchema: { type: "object", properties: { order_id: { type: "string" } }, required: ["order_id"] },
  },
];

async function call(name, args) {
  if (name === "landed_quote") return quote(args || {});
  if (name === "landed_paypal_order") {
    const q = quote(args.order || {});
    const opts = { freight_eur: (args.order || {}).freight_and_insurance_eur || 0, description: args.description, currency: args.currency };
    if (args.dry_run) return { quote: q, paypal_order_body: orderBody(q, opts), note: "dry run: PayPal was not contacted" };
    return { quote: q, paypal_order: await createOrder(q, opts) };
  }
  if (name === "landed_capture_order") return await captureOrder(args.order_id);
  throw new Error("no such tool: " + name);
}

function send(msg) { process.stdout.write(JSON.stringify(msg) + "\n"); }

let buf = "";
process.stdin.on("data", async (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    let m; try { m = JSON.parse(line); } catch { continue; }
    // A notification has no id and takes no reply.
    if (m.id === undefined) continue;
    try {
      if (m.method === "initialize") {
        send({ jsonrpc: "2.0", id: m.id, result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "landed", version: "1.0.0" },
        }});
      } else if (m.method === "tools/list") {
        send({ jsonrpc: "2.0", id: m.id, result: { tools: TOOLS } });
      } else if (m.method === "tools/call") {
        const out = await call(m.params.name, m.params.arguments || {});
        send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: JSON.stringify(out, null, 1) }] } });
      } else if (m.method === "ping") {
        send({ jsonrpc: "2.0", id: m.id, result: {} });
      } else {
        send({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "method not found: " + m.method } });
      }
    } catch (e) {
      // An error is returned as tool content, not as a transport error, so the agent can read
      // what it needs to supply and try again instead of seeing the server fall over.
      send({ jsonrpc: "2.0", id: m.id, result: { isError: true, content: [{ type: "text", text: String(e.message) }] } });
    }
  }
});
