// Checked, not asserted.
//
// Every case below is worked out independently from the instrument, by hand, and the expected
// figure written down before the engine is called. The engine is then run against it. That is the
// only way a test tells you anything: a test that recomputes the answer the same way the code does
// is just the code twice.
//
// Run: node test/verify.js   Exit 0 and "ALL OK" means every case matched.

import { quote, cbamLine, vatLine, dutyLine, aiActLine } from "../src/landed.js";

let fails = 0, checks = 0;
const money2 = (n) => (Math.round(Number(n) * 100) / 100).toFixed(2);
function eq(label, got, want, tol = 0.005) {
  checks++;
  const ok = typeof want === "number" ? Math.abs(got - want) <= tol : got === want;
  if (ok) console.log("OK  " + label + " = " + got);
  else { console.log("FAIL " + label + ": got " + got + ", expected " + want); fails++; }
}

// ---------------------------------------------------------------------------
// CBAM. Reg (EU) 2023/956 as amended by 2025/2083; factor from Dir (EU) 2023/959 Art 10a(1a).
// Case 1, by hand: 60 t of steel at 1.9 tCO2e embedded per tonne = 114.0 tCO2e embedded.
// 2026 CBAM factor is 0.025, so chargeable = 114.0 x 0.025 = 2.85 tCO2e.
// Certificate price EUR 80, no origin carbon price, so cost = 2.85 x 80 = EUR 228.00.
// Certificates surrendered are whole, so ceil(2.85) = 3.
const steel = { cbam_sector: "Iron and steel", cn_code: "7208", tonnes: 60, embedded_tco2e_per_tonne: 1.9 };
const o1 = { destination_region: "EU", origin_country: "IN", year: 2026, certificate_price_eur: 80, goods: steel };
const c1 = cbamLine(o1);
eq("CBAM 2026 steel embedded tCO2e", c1.basis.embedded_tco2e, 114.0);
eq("CBAM 2026 steel chargeable tCO2e", c1.basis.chargeable_tco2e, 2.85);
eq("CBAM 2026 steel cost EUR", c1.amount_eur, 228.0);
eq("CBAM 2026 steel certificates (whole)", c1.basis.certificates, 3);
eq("CBAM steel indirect emissions not counted", c1.basis.indirect_emissions_counted, false);

// Case 2, by hand: an origin carbon price of EUR 30/t is credited against the certificate price,
// so the net price is 80 - 30 = EUR 50 and cost = 2.85 x 50 = EUR 142.50.
const c2 = cbamLine({ ...o1, goods: { ...steel, origin_carbon_price_eur_per_tonne: 30 } });
eq("CBAM origin carbon price credited", c2.amount_eur, 142.5);

// Case 3, by hand: the credit cannot go negative. An origin price of EUR 200 against a EUR 80
// certificate gives net max(0, 80-200) = 0, so cost = EUR 0.00, not a refund.
const c3 = cbamLine({ ...o1, goods: { ...steel, origin_carbon_price_eur_per_tonne: 200 } });
eq("CBAM credit floors at zero, never negative", c3.amount_eur, 0);

// Case 4, by hand: cement counts indirect emissions. 2030 factor is 0.485.
// 100 t at 0.8 = 80 tCO2e; x 0.485 = 38.8; x EUR 80 = EUR 3,104.00.
const c4 = cbamLine({ destination_region: "EU", year: 2030, certificate_price_eur: 80,
  goods: { cbam_sector: "Cement", tonnes: 100, embedded_tco2e_per_tonne: 0.8 } });
eq("CBAM 2030 cement cost EUR", c4.amount_eur, 3104.0);
eq("CBAM cement indirect emissions counted", c4.basis.indirect_emissions_counted, true);
eq("CBAM 2030 factor", c4.basis.cbam_factor, 0.485);

// Case 5, by hand: 2034 is full rate, factor 1.0, so 114.0 x 1.0 x 80 = EUR 9,120.00.
eq("CBAM 2034 full rate cost EUR", cbamLine({ ...o1, year: 2034 }).amount_eur, 9120.0);

// Case 6: goods outside the six Annex I categories are not reached by CBAM at all. The engine
// must return null, not a zero, because a zero reads as "computed and nothing due".
eq("CBAM absent for non-Annex-I goods", cbamLine({ ...o1, goods: { cn_code: "6109", tonnes: 2 } }), null);
eq("CBAM absent for a non-EU destination", cbamLine({ ...o1, destination_region: "UAE" }), null);

// Case 7: the engine refuses to invent the certificate price, which tracks the ETS auction.
checks++;
try { cbamLine({ destination_region: "EU", year: 2026, goods: steel }); console.log("FAIL missing certificate price was accepted"); fails++; }
catch (e) { console.log("OK  refuses to invent the certificate price"); }
checks++;
try { cbamLine({ ...o1, year: 2025 }); console.log("FAIL year outside the phase-in was accepted"); fails++; }
catch (e) { console.log("OK  rejects a year outside the 2026 to 2034 phase-in"); }

// ---------------------------------------------------------------------------
// Duty relief. Reg (EC) 1186/2009 Art 23, applied at an intrinsic value of EUR 150.
eq("duty relieved at exactly EUR 150", dutyLine({ destination_region: "EU", intrinsic_value_eur: 150 }).amount_eur, 0);
eq("duty relief applied flag at 150", dutyLine({ destination_region: "EU", intrinsic_value_eur: 150 }).basis.relief_applied, true);
// A cent over the threshold and duty is due; the engine must not guess the tariff.
eq("duty unresolved just above 150", dutyLine({ destination_region: "EU", intrinsic_value_eur: 150.01 }).amount_eur, null);

// ---------------------------------------------------------------------------
// Import VAT. Dir 2006/112/EC: the taxable amount on importation is the customs value plus
// duties and incidental costs. By hand: (40,000 + 1,200 + 1,000) = 42,200; at 21% = EUR 8,862.00.
const vat = vatLine({ destination_region: "EU", intrinsic_value_eur: 40000,
  freight_and_insurance_eur: 1200, customs_duty_eur: 1000, destination_vat_rate: 21 }, false);
eq("VAT taxable amount includes freight and duty", vat.basis.taxable_amount_eur, 42200.0);
eq("VAT at 21% of the full base", vat.amount_eur, 8862.0);
// The EUR 22 relief is gone, so a EUR 10 consignment still bears VAT: 10 x 0.21 = EUR 2.10.
eq("VAT still due below the old EUR 22 relief", vatLine({ destination_region: "EU", intrinsic_value_eur: 10, destination_vat_rate: 21 }, false).amount_eur, 2.1);
eq("IOSS eligible at or below EUR 150", vatLine({ destination_region: "EU", intrinsic_value_eur: 150, destination_vat_rate: 21 }, false).basis.ioss_eligible, true);
eq("IOSS not eligible above EUR 150", vatLine({ destination_region: "EU", intrinsic_value_eur: 150.01, destination_vat_rate: 21 }, false).basis.ioss_eligible, false);
// A rate the caller did not supply is never inferred.
eq("VAT unresolved without a supplied rate", vatLine({ destination_region: "EU", intrinsic_value_eur: 500 }, false).amount_eur, null);
// And VAT must not look authoritative while a component of its own base is unknown.
eq("VAT unresolved when duty is unresolved", vatLine({ destination_region: "EU", intrinsic_value_eur: 40000, destination_vat_rate: 21 }, true).amount_eur, null);

// ---------------------------------------------------------------------------
// EU AI Act. Reg (EU) 2024/1689. The wrapper must default the Article 5 question to "None":
// leaving it unset classified every system as a prohibited practice.
const ai = aiActLine({ ai_system: { role: "Provider", worldwide_annual_turnover_eur: 5000000 } });
eq("AI Act: an ordinary system is not prohibited", ai.basis.classification, "Minimal risk");
const gp = aiActLine({ ai_system: { role: "Provider", general_purpose_model: "Yes", worldwide_annual_turnover_eur: 5000000 } });
eq("AI Act: GPAI model classified", gp.basis.classification, "General-purpose AI model");
// The fine ceiling is the greater of EUR 15,000,000 and 3% of worldwide turnover, so a
// EUR 5,000,000 turnover takes the floor, not 3% of it.
eq("AI Act: fine ceiling takes the EUR 15m floor", gp.basis.maximum_fine_eur, 15000000);
// At EUR 1,000,000,000 turnover, 3% = EUR 30,000,000, which is above the floor.
eq("AI Act: fine ceiling takes 3% above the floor",
  aiActLine({ ai_system: { role: "Provider", general_purpose_model: "Yes", worldwide_annual_turnover_eur: 1000000000 } }).basis.maximum_fine_eur, 30000000);
eq("AI Act: an explicit Article 5 practice is caught",
  aiActLine({ ai_system: { role: "Provider", prohibited_practice: "5(1)(c) Social scoring", worldwide_annual_turnover_eur: 5000000 } }).basis.classification, "PROHIBITED (Article 5)");
eq("AI Act line absent when nothing is being sold as an AI system", aiActLine({}), null);

// ---------------------------------------------------------------------------
// The whole quote. By hand, for the steel order with duty supplied at EUR 1,000:
// CBAM 228.00 + duty 1,000.00 + VAT 8,862.00 = EUR 10,090.00 of regulatory cost.
// Landed = goods 40,000 + freight 1,200 + regulatory 10,090 = EUR 51,290.00.
// Uplift on the quoted goods value = 10,090 / 40,000 = 25.225%.
const full = quote({ destination_region: "EU", origin_country: "IN", year: 2026, certificate_price_eur: 80,
  intrinsic_value_eur: 40000, freight_and_insurance_eur: 1200, customs_duty_eur: 1000,
  destination_vat_rate: 21, goods: steel });
eq("quote regulatory cost EUR", full.regulatory_cost_eur, 10090.0);
eq("quote landed total EUR", full.landed_total_eur, 51290.0);
eq("quote uplift percent", full.uplift_percent, 25.23, 0.01);
eq("quote reports itself complete", full.complete, true);

// And the same order with duty unknown must report itself incomplete rather than quietly
// returning a smaller number that looks just as final.
const partial = quote({ destination_region: "EU", origin_country: "IN", year: 2026, certificate_price_eur: 80,
  intrinsic_value_eur: 40000, freight_and_insurance_eur: 1200, destination_vat_rate: 21, goods: steel });
eq("quote reports itself incomplete when duty is unknown", partial.complete, false);
eq("two lines are flagged unresolved, not zeroed", partial.unresolved.length, 2);

// A domestic order inside the destination has no border lines at all.
eq("no lines for a non-EU destination", quote({ destination_region: "UAE", intrinsic_value_eur: 500 }).lines.length, 0);


// ---------------------------------------------------------------------------
// The PayPal order body. PayPal rejects an order to the cent if the breakdown does not add up,
// so this is worth proving without a network call. By hand, for the full steel order:
//   item_total = goods 40,000.00 + CBAM 228.00 + duty 1,000.00 = 41,228.00
//   tax_total  = import VAT 8,862.00
//   shipping   = 1,200.00
//   total      = 41,228.00 + 8,862.00 + 1,200.00 = 51,290.00, equal to the landed total above.
import { orderBody } from "../src/paypal.js";
const ob = orderBody(full, { freight_eur: 1200, description: "Hot-rolled coil, 60 t" });
const pu = ob.purchase_units[0], bd = pu.amount.breakdown;
eq("PayPal item_total", bd.item_total.value, "41228.00");
eq("PayPal tax_total is the import VAT", bd.tax_total.value, "8862.00");
eq("PayPal shipping", bd.shipping.value, "1200.00");
eq("PayPal total", pu.amount.value, "51290.00");
eq("PayPal breakdown adds up to the total",
  money2(+bd.item_total.value + +bd.tax_total.value + +bd.shipping.value), pu.amount.value);
eq("PayPal total equals the engine's landed total", pu.amount.value, money2(full.landed_total_eur));
eq("PayPal itemises goods plus each non-VAT regulatory line", pu.items.length, 3);
eq("every PayPal item carries its instrument in the description",
  pu.items.slice(1).every((i) => i.description && i.description.length > 10), true);
eq("PayPal intent is CAPTURE", ob.intent, "CAPTURE");
// An incomplete quote must never be turned into money silently.
const pob = orderBody(partial, { freight_eur: 1200 });
eq("an incomplete quote carries its unresolved lines with the order", pob._landed_unresolved.length, 2);
// And the unresolved lines are excluded from what the buyer is charged, not guessed at:
// goods 40,000.00 + CBAM 228.00 = 40,228.00, no duty, no VAT, plus 1,200.00 freight.
eq("unresolved lines are excluded from the charge, not estimated", pob.purchase_units[0].amount.value, "41428.00");

console.log("");
if (fails) { console.log(fails + " of " + checks + " FAILED"); process.exit(1); }
console.log("ALL OK, " + checks + " checks");
