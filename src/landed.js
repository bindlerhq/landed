// The landed-cost engine.
//
// The problem it exists for: an AI shopping agent quotes the price on the product page. For a
// cross-border order that is not the price that lands. Import VAT, the duty relief threshold and,
// for six categories of goods entering the EU, a CBAM certificate cost all attach at the border
// and none of them is on the page. The agent completes a purchase at a number it has no basis for.
//
// This returns those lines explicitly, each with the instrument it comes from, so the agent can
// put them in the order the buyer actually approves.
//
// What it will not do: assert a figure it cannot cite. Where a rate is a member-state choice the
// caller supplies it and the response says so. A wrong number dressed as a computed one is worse
// than no number, because the agent will act on it.

import { cbamCompute, classify, FACTOR, SECTORS } from "./calc.js";

export const CITES = {
  cbam: "Regulation (EU) 2023/956 as amended by Regulation (EU) 2025/2083, and Directive (EU) 2023/959 Article 10a(1a) for the free-allocation phase-out",
  cbam_threshold: "Regulation (EU) 2025/2083: the 50 tonne per importer per year de minimis mass threshold",
  vat_import: "Council Directive 2006/112/EC Article 2(1)(d): importation of goods is a taxable transaction; the standard rate is set by each member state under Articles 96 and 97",
  ioss: "Council Directive (EU) 2017/2455 and Council Directive (EU) 2019/1995: from 1 July 2021 the EUR 22 low-value VAT relief is abolished, so import VAT is due on every consignment regardless of value; the Import One-Stop Shop may be used for distance sales of imported goods in consignments not exceeding EUR 150",
  duty_relief: "Council Regulation (EEC) No 2658/87 and Commission Regulation (EC) No 1186/2009 Article 23: relief from customs duty for consignments of negligible value, applied in the Union at an intrinsic value not exceeding EUR 150",
  ai_act: "Regulation (EU) 2024/1689 (the EU AI Act)",
};

const r2 = (n) => Math.round(n * 100) / 100;

/** A CBAM line only exists for the six Annex I goods categories. Everything else returns null
 *  rather than a zero, because a zero reads as "checked and nothing due" and null reads as
 *  "this instrument does not reach this order", which is the true statement. */
export function cbamLine(order) {
  const g = order.goods || {};
  const sector = SECTORS.find((s) => s[0].toLowerCase() === String(g.cbam_sector || "").toLowerCase());
  if (!sector) return null;
  if (String(order.destination_region || "EU").toUpperCase() !== "EU") return null;
  const year = Number(order.year) || 2026;
  if (!FACTOR[year]) throw new Error("CBAM applies from 2026 to 2034; year " + year + " is outside the phase-in");

  const tonnes = Number(g.tonnes) || 0;
  const per = Number(g.embedded_tco2e_per_tonne) || 0;
  const price = Number(order.certificate_price_eur);
  if (!Number.isFinite(price)) throw new Error("certificate_price_eur is required: the CBAM certificate price is the ETS auction price and is not a constant this engine may invent");

  const line = {
    sec: sector[0], cn: String(g.cn_code || ""), org: String(order.origin_country || ""),
    qty: tonnes, per, ind: sector[1], tot: tonnes * per,
    ocp: Number(g.origin_carbon_price_eur_per_tonne) || 0,
  };
  const c = cbamCompute(year, price, [line]);

  return {
    code: "CBAM",
    label: "CBAM certificates, " + sector[0],
    amount_eur: r2(c.cost),
    basis: {
      year, cbam_factor: c.f, embedded_tco2e: r2(c.te), chargeable_tco2e: r2(c.tc),
      certificates: c.certs, certificate_price_eur: price,
      indirect_emissions_counted: sector[1],
      origin_carbon_price_credited_eur_per_tonne: line.ocp,
    },
    // The mass threshold is per importer per year, so one order cannot settle it. Say that
    // rather than silently applying or silently ignoring it.
    threshold_note: tonnes > 50
      ? "This order alone exceeds the 50 tonne annual de minimis mass threshold, so CBAM applies."
      : "Below 50 tonnes on this order. The threshold is per importer per calendar year, not per order, so whether it is crossed depends on the importer's other imports this year. This figure is what this order contributes if the threshold is crossed.",
    cites: [CITES.cbam, CITES.cbam_threshold],
    every_year_same_basket: Object.keys(FACTOR).map((y) => {
      const x = cbamCompute(+y, price, [line]);
      return { year: +y, cbam_factor: FACTOR[y], cost_eur: r2(x.cost) };
    }),
  };
}

/** Import VAT. The rate is the caller's, because it is a member-state choice and this engine
 *  does not hold a rate table it can cite per state. What it does own is the base and the
 *  threshold rules, which is the part agents get wrong. */
export function vatLine(order, dutyUnresolved) {
  if (String(order.destination_region || "EU").toUpperCase() !== "EU") return null;
  const rate = Number(order.destination_vat_rate);
  const intrinsic = Number(order.intrinsic_value_eur) || 0;
  const freight = Number(order.freight_and_insurance_eur) || 0;
  const dutyAmount = Number(order.customs_duty_eur) || 0;

  if (!Number.isFinite(rate)) {
    return {
      code: "IMPORT_VAT", label: "Import VAT", amount_eur: null,
      unresolved: "destination_vat_rate was not supplied. The standard rate is set by each member state, and this engine does not assert a rate it cannot cite for the destination. Supply the rate and the line resolves.",
      cites: [CITES.vat_import, CITES.ioss],
    };
  }
  // Taxable amount on importation is customs value plus duties and incidental costs to the
  // first destination, which is why freight and any duty sit inside the base, not beside it.
  const base = intrinsic + freight + dutyAmount;
  if (dutyUnresolved) {
    return {
      code: "IMPORT_VAT", label: "Import VAT at " + rate + "%", amount_eur: null,
      unresolved: "Customs duty is part of the taxable amount on importation and is itself unresolved on this order, so any VAT figure here would be understated by the duty times the rate. Resolve customs_duty_eur and this line resolves with it.",
      basis: { rate_percent: rate, base_so_far_eur: r2(base), missing_from_base: "customs_duty_eur" },
      cites: [CITES.vat_import, CITES.ioss, CITES.duty_relief],
    };
  }
  return {
    code: "IMPORT_VAT", label: "Import VAT at " + rate + "%",
    amount_eur: r2(base * rate / 100),
    basis: {
      taxable_amount_eur: r2(base), rate_percent: rate,
      components: { intrinsic_value_eur: r2(intrinsic), freight_and_insurance_eur: r2(freight), customs_duty_eur: r2(dutyAmount) },
      ioss_eligible: intrinsic <= 150,
    },
    threshold_note: intrinsic <= 150
      ? "Intrinsic value is EUR 150 or less, so this consignment is within the Import One-Stop Shop scope and customs duty relief applies, but import VAT is still due: the EUR 22 relief was abolished on 1 July 2021."
      : "Intrinsic value exceeds EUR 150, so the consignment is outside IOSS and outside duty relief: customs duty is due in addition to import VAT.",
    cites: [CITES.vat_import, CITES.ioss, CITES.duty_relief],
  };
}

/** Customs duty is tariff-line specific. The engine reports whether relief applies and refuses
 *  to invent a tariff rate, which is the honest half of the answer. */
export function dutyLine(order) {
  if (String(order.destination_region || "EU").toUpperCase() !== "EU") return null;
  const intrinsic = Number(order.intrinsic_value_eur) || 0;
  if (intrinsic <= 150) {
    return {
      code: "CUSTOMS_DUTY", label: "Customs duty", amount_eur: 0,
      basis: { intrinsic_value_eur: r2(intrinsic), relief_applied: true },
      threshold_note: "Relieved: intrinsic value does not exceed EUR 150.",
      cites: [CITES.duty_relief],
    };
  }
  const supplied = Number(order.customs_duty_eur);
  return {
    code: "CUSTOMS_DUTY", label: "Customs duty",
    amount_eur: Number.isFinite(supplied) ? r2(supplied) : null,
    unresolved: Number.isFinite(supplied) ? undefined
      : "Above the EUR 150 relief threshold, so duty is due, and the rate is specific to the CN code " + (order.goods && order.goods.cn_code ? order.goods.cn_code : "(not supplied)") + " and the origin. This engine does not hold the tariff and will not guess it: read the rate from TARIC and supply customs_duty_eur.",
    basis: { intrinsic_value_eur: r2(intrinsic), relief_applied: false },
    cites: [CITES.duty_relief],
  };
}

/** If the thing being sold is an AI system, the obligation attaches to placing it on the EU
 *  market, which is a cost the agent should surface even though it is not a border charge. */
export function aiActLine(order) {
  const a = order.ai_system;
  if (!a) return null;
  const v = {
    role: a.role || "Provider", annex: a.annex || "None", a61: a.safety_component || "No",
    prof: a.profiling || "No", ex: a.exempt_under_6_3 || "No", a50: a.transparency_obligation || "No",
    gpai: a.general_purpose_model || "No", pre: a.placed_before_cutoff || "No",
    turn: Number(a.worldwide_annual_turnover_eur) || 0,
    // The classifier reads prohib !== "None" as a banned Article 5 practice, so this must be
    // an explicit "None" and never undefined: leaving it unset classified every system as
    // prohibited with a EUR 35,000,000 ceiling. Default it, and let the caller override.
    prohib: (a.prohibited_practice && String(a.prohibited_practice)) || "None",
  };
  const c = classify(v);
  return {
    code: "EU_AI_ACT", label: "EU AI Act obligation: " + c.cls,
    amount_eur: 0,
    basis: { classification: c.cls, obligations: c.obl, applies_from: c.date, maximum_fine_eur: c.fine },
    threshold_note: "Not a border charge. It is a condition of placing this system on the EU market, and the fine ceiling is what non-compliance costs.",
    cites: [CITES.ai_act],
  };
}

/** The whole quote. Lines that do not apply are absent; lines that apply but need an input the
 *  caller did not give are present and marked unresolved, so an agent can tell "nothing due"
 *  apart from "nobody worked it out". */
export function quote(order) {
  const duty = dutyLine(order);
  const dutyUnresolved = !!(duty && typeof duty.amount_eur !== "number");
  const lines = [cbamLine(order), duty, vatLine(order, dutyUnresolved), aiActLine(order)].filter(Boolean);
  const resolved = lines.filter((l) => typeof l.amount_eur === "number");
  const unresolved = lines.filter((l) => typeof l.amount_eur !== "number");
  const regulatory = r2(resolved.reduce((a, l) => a + l.amount_eur, 0));
  const goodsValue = r2(Number(order.intrinsic_value_eur) || 0);
  return {
    quoted_goods_value_eur: goodsValue,
    regulatory_cost_eur: regulatory,
    landed_total_eur: r2(goodsValue + (Number(order.freight_and_insurance_eur) || 0) + regulatory),
    uplift_percent: goodsValue ? r2((regulatory / goodsValue) * 100) : 0,
    complete: unresolved.length === 0,
    lines,
    unresolved: unresolved.map((l) => ({ code: l.code, needs: l.unresolved })),
    disclaimer: "Computed from the instruments cited on each line. It is a computation, not tax or customs advice, and the importer of record remains responsible for the declaration.",
  };
}
