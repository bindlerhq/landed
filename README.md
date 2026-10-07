# Landed

**An AI shopping agent quotes the price on the page. For a cross-border order that is not the price that lands.**

Import VAT, the customs duty relief threshold and, for six categories of goods entering the EU, a
CBAM certificate cost all attach at the border. None of them is on the product page. So an agent
instructed to "buy 60 tonnes of hot-rolled coil under 45,000 euro" finds a listing at 40,000, pays
it, and the importer is later billed 10,090 euro it never saw. The agent did not get the price
slightly wrong. It was working from a number that was never the price.

Landed is the missing call. Give it the order and it returns the regulatory lines with the
instrument each one comes from, then builds the PayPal order with those lines itemised, so the
buyer approves the real landed cost instead of the page price.

```
Goods, quoted on the page                      EUR 40,000.00
CBAM certificates, Iron and steel                     228.00   Reg (EU) 2023/956 as amended by 2025/2083
Customs duty                                        1,000.00   Reg (EC) 1186/2009 Art 23
Import VAT at 21%                                   8,862.00   Dir 2006/112/EC Arts 2(1)(d), 96, 97
Freight and insurance                               1,200.00
                                               -------------
Landed total                                   EUR 51,290.00   a 25.2% uplift on the quoted price
```

That order body goes straight to PayPal Orders v2 with each line as its own item and the citation
in the line description, so the approval screen carries the law, not just the number.

## The part that matters: it refuses to guess

Every landed-cost tool on the market returns a number. The useful question is whether the number
is derived or estimated, and almost none of them tell you.

Landed will not assert a figure it cannot cite. A customs duty rate is specific to the tariff line
and the origin, so without one it returns:

```json
{ "code": "CUSTOMS_DUTY", "amount_eur": null,
  "unresolved": "Above the EUR 150 relief threshold, so duty is due, and the rate is specific to
                 the CN code 7208 and the origin. This engine does not hold the tariff and will
                 not guess it: read the rate from TARIC and supply customs_duty_eur." }
```

And because duty sits inside the taxable amount for import VAT, an unresolved duty makes the VAT
line unresolved too, rather than quietly returning a VAT figure understated by the duty times the
rate. The quote reports `complete: false`, and the PayPal order excludes those lines from the
amount charged instead of estimating them.

An agent can act on "I do not know this yet". It cannot act on a confident wrong number, and it
will not know it is wrong until the goods are at the border.

A line that does not apply is absent, not zero. Goods outside CBAM Annex I return no CBAM line at
all, because a zero reads as "computed, nothing due" and absence reads as "this instrument does
not reach this order", which is the true statement.

## What it computes, and from what

| Line | Instrument | Notes |
|---|---|---|
| CBAM certificate cost | Regulation (EU) 2023/956 as amended by Regulation (EU) 2025/2083; phase-out factor from Directive (EU) 2023/959 Art 10a(1a) | All six Annex I sectors, the 2026 to 2034 factor schedule, indirect emissions where the sector counts them, the origin carbon price credited and floored at zero, whole certificates, and the same basket priced in every year to 2034 |
| Customs duty relief | Council Regulation (EC) No 1186/2009 Art 23 | Relief at an intrinsic value of 150 euro or less; above it the tariff is not guessed |
| Import VAT | Council Directive 2006/112/EC Arts 2(1)(d), 96, 97; Directives (EU) 2017/2455 and 2019/1995 | Taxable amount is customs value plus duty plus freight; IOSS scope at 150 euro; the 22 euro relief abolished on 1 July 2021, so a 10 euro consignment still bears VAT |
| EU AI Act obligations | Regulation (EU) 2024/1689 | Where the thing sold is an AI system: classification, the obligation set, the date it applies, and the fine ceiling at the greater of 15m euro and 3% of turnover |

The CBAM and AI Act engines are not new code written for a hackathon. They are carried over
unchanged from a production API that serves them at
[bindler.co/api](https://bindler.co/api), where they are recalculated cell by cell against an
independent replica before release.

## Checked, not asserted

`node test/verify.js` runs 49 checks. Every expected figure in it was worked out by hand from the
instrument and written down before the engine was called, because a test that recomputes the answer
the same way the code does is just the code twice. A sample:

> 60 t of steel at 1.9 tCO2e embedded per tonne is 114.0 tCO2e. The 2026 CBAM factor is 0.025, so
> 2.85 tCO2e is chargeable. At 80 euro a certificate and no origin carbon price, that is 228.00
> euro, and 3 whole certificates are surrendered.

It also proves the things that break quietly: the origin carbon price credit floors at zero rather
than paying a refund, the PayPal breakdown adds to the total to the cent (PayPal rejects the order
otherwise), and an incomplete quote is never turned into money.

## Run it

```bash
node test/verify.js      # 49 checks, no network, no credentials
node src/server.js       # the demo at http://localhost:8787
node src/mcp.js          # MCP server over stdio
```

As an MCP server, so any agent can price the border before it pays:

```bash
claude mcp add landed -- node /absolute/path/to/landed/src/mcp.js
```

It exposes `landed_quote`, `landed_paypal_order` (with `dry_run` to see the exact order body
without contacting PayPal) and `landed_capture_order`.

To create real sandbox orders, set `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` from a free
sandbox app at developer.paypal.com. Nothing is written to disk and no credential is ever logged.
Everything except order creation works without them.

## PayPal integration

- **Orders v2 create and capture**, OAuth2 client credentials, sandbox by default.
- **Each regulatory line is its own order item**, with its legal instrument in the line
  description, so the citation travels with the money to the approval screen.
- **The breakdown is honest**: `item_total` is the goods plus the non-VAT regulatory lines,
  `tax_total` is the import VAT, `shipping` is the freight, and the three add to the total to the
  cent. Unresolved lines are excluded from the amount rather than estimated into it.

## Why this is the agentic commerce problem and not a tax tool

An agent transacting across a border has to answer a question no product page answers, and it has
to answer it before the money moves, not after. Today it either ignores the border, which makes
every cross-border quote wrong, or it asks a human, which is the thing it was deployed to avoid.
The gap is not that the arithmetic is hard. It is that the arithmetic has to come with its source,
because an agent that cannot tell a derived number from an estimate cannot responsibly spend
someone else's money.

Landed is built so the answer is always one of three things: here is the figure and here is the
instrument, this instrument does not reach your order, or I need this one input and here is where
to read it. Never a number with nothing behind it.

## Licence

MIT. See [LICENSE](LICENSE).
