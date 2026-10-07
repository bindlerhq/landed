// PayPal Orders v2, sandbox by default.
//
// The point of putting the regulatory lines into the PayPal order rather than just returning them:
// the buyer approves what PayPal shows them. If the agent quotes the page price and the duty turns
// up later at the border, the buyer approved a number that was never the price. Here each
// regulatory line is its own order item with the instrument it comes from in its description, so
// the approval screen is the true landed cost and the citation travels with the money.
//
// Credentials come from the environment and are never written to a file or logged:
//   PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, optional PAYPAL_ENV=sandbox|live (default sandbox).

const HOSTS = { sandbox: "https://api-m.sandbox.paypal.com", live: "https://api-m.paypal.com" };
const money = (n) => (Math.round(Number(n) * 100) / 100).toFixed(2);

export function host(env = process.env) {
  const which = (env.PAYPAL_ENV || "sandbox").toLowerCase();
  if (!HOSTS[which]) throw new Error("PAYPAL_ENV must be sandbox or live");
  return HOSTS[which];
}

export async function token(env = process.env, f = fetch) {
  const id = env.PAYPAL_CLIENT_ID, secret = env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error("set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (a free sandbox app at developer.paypal.com)");
  const r = await f(host(env) + "/v1/oauth2/token", {
    method: "POST",
    headers: {
      // Basic auth, per PayPal's OAuth2 client-credentials flow.
      Authorization: "Basic " + Buffer.from(id + ":" + secret).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const j = await r.json();
  if (!r.ok) throw new Error("PayPal token " + r.status + ": " + (j.error_description || j.error || "unknown"));
  return j.access_token;
}

/** Turn a landed-cost quote into a PayPal order body.
 *
 *  PayPal rejects an order whose breakdown does not add up to the total, to the cent, so the
 *  arithmetic here is the part worth testing offline: item_total + tax_total + shipping == total.
 *  Unresolved lines are deliberately left out of the money and reported separately. Charging a
 *  buyer for a figure the engine could not work out would be the one unforgivable version of this. */
export function orderBody(q, opts = {}) {
  const currency = opts.currency || "EUR";
  const goods = Number(q.quoted_goods_value_eur) || 0;
  const freight = Number(opts.freight_eur) || 0;

  const resolved = q.lines.filter((l) => typeof l.amount_eur === "number" && l.amount_eur > 0);
  const vat = resolved.filter((l) => l.code === "IMPORT_VAT");
  const nonVat = resolved.filter((l) => l.code !== "IMPORT_VAT");

  const items = [{
    name: (opts.description || "Goods").slice(0, 127),
    description: ("Quoted goods value, before the border" ).slice(0, 127),
    quantity: "1",
    unit_amount: { currency_code: currency, value: money(goods) },
  }];
  for (const l of nonVat) {
    items.push({
      name: l.label.slice(0, 127),
      // The citation travels with the line, so the buyer can see where the charge comes from.
      description: (l.cites && l.cites[0] ? l.cites[0] : "Regulatory cost").slice(0, 127),
      quantity: "1",
      unit_amount: { currency_code: currency, value: money(l.amount_eur) },
    });
  }

  const itemTotal = goods + nonVat.reduce((a, l) => a + l.amount_eur, 0);
  const taxTotal = vat.reduce((a, l) => a + l.amount_eur, 0);
  const total = itemTotal + taxTotal + freight;

  return {
    intent: "CAPTURE",
    purchase_units: [{
      reference_id: opts.reference_id || "landed-1",
      description: ("Landed cost, regulatory lines itemised").slice(0, 127),
      custom_id: (opts.custom_id || "").slice(0, 127) || undefined,
      amount: {
        currency_code: currency,
        value: money(total),
        breakdown: {
          item_total: { currency_code: currency, value: money(itemTotal) },
          tax_total: { currency_code: currency, value: money(taxTotal) },
          shipping: { currency_code: currency, value: money(freight) },
        },
      },
      items,
    }],
    // Carried so the agent, the buyer and the merchant all see the same statement of what is
    // still unknown rather than discovering it at the border.
    ...(q.complete ? {} : { _landed_unresolved: q.unresolved }),
  };
}

export async function createOrder(q, opts = {}, env = process.env, f = fetch) {
  const body = orderBody(q, opts);
  delete body._landed_unresolved; // not a PayPal field; kept only for the caller's own record
  const t = await token(env, f);
  const r = await f(host(env) + "/v2/checkout/orders", {
    method: "POST",
    headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error("PayPal create order " + r.status + ": " + JSON.stringify(j.details || j));
  return j;
}

export async function captureOrder(id, env = process.env, f = fetch) {
  const t = await token(env, f);
  const r = await f(host(env) + "/v2/checkout/orders/" + encodeURIComponent(id) + "/capture", {
    method: "POST",
    headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" },
  });
  const j = await r.json();
  if (!r.ok) throw new Error("PayPal capture " + r.status + ": " + JSON.stringify(j.details || j));
  return j;
}
