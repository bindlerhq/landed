// Verified regulatory compute, carried over unchanged from the Bindler API
// (functions/api/v1/_calc.js, generated from the free browser tools at bindler.co/apps).
// Every figure these functions produce is recalculated cell by cell against an independent
// replica before release; the harnesses live in that repository. Do not edit here: edit there.
// UAE Corporate Tax computation, mirrors products/uae-ct (Federal Decree-Law 47 of 2022 and the Decisions cited in the workbook).
function ctCompute(i){
  const yes=v=>v==="Yes";
  const eligible = yes(i.resident) && i.rev<=3000000 && !yes(i.prevOver) && !yes(i.mne) && !(yes(i.fz)&&yes(i.qf));
  const relief = eligible && yes(i.elect);
  const deminimis = i.nqr <= Math.min(0.05*i.rev, 5000000);
  const qfzp = yes(i.fz) && yes(i.qf) && deminimis;
  const rows=[];
  const acc=i.acc, div=i.div, part=i.part, oex=i.oex;
  const ent=0.5*i.ent, fines=i.fines, don=i.don, other=i.dvo+i.ctx+i.vat+i.ftx, nb=i.nb+i.exx;
  const ebitda = acc + i.ie - i.ii + i.da - div - part - oex;
  const nie = Math.max(0, i.ie + i.icf - i.ii);
  const limit = !(yes(i.bank) || nie<=12000000);
  const cap = 0.3*Math.max(0,ebitda);
  const disallowed = limit ? Math.max(0,(i.ie-i.ii)-cap) : 0;
  const bfUsed = limit ? -Math.min(i.icf, Math.max(0, cap-(i.ie-i.ii))) : -i.icf;
  const tiBefore = acc - div - part - oex + ent + fines + don + other + nb + disallowed + bfUsed;
  const lossRelief = relief ? 0 : -Math.min(i.loss, Math.max(0, 0.75*tiBefore));
  const ti = relief ? 0 : Math.max(0, tiBefore + lossRelief);
  const band0 = qfzp ? 0 : Math.min(ti,375000);
  const std9 = qfzp ? 0 : 0.09*Math.max(0,ti-375000);
  const qf9 = qfzp ? 0.09*Math.max(0,ti-i.qi) : 0;
  const before = std9+qf9;
  const ftc = -Math.min(i.ftc, before);
  const tax = Math.max(0, before+ftc);
  const lossCf = relief ? i.loss : i.loss + lossRelief + (tiBefore<0 ? -tiBefore : 0);
  const intCf = relief ? i.icf : i.icf + disallowed + bfUsed;
  const eff = i.acc>0 ? tax/i.acc : 0;
  return {eligible, relief, deminimis, qfzp, ebitda, nie, limit, disallowed, bfUsed, tiBefore, lossRelief, ti, band0, std9, qf9, before, ftc, tax, lossCf, intCf, eff,
    steps:[["Accounting Income",acc,"Article 20(2)"],["Less: exempt dividends from UAE residents",-div,"Article 22(1)"],["Less: Participation Exemption income",-part,"Article 23"],["Less: other exempt income",-oex,"Articles 22, 24"],["Add: non-deductible entertainment (50%)",ent,"Article 32(1)"],["Add: fines and penalties",fines,"Article 33(2)"],["Add: non-qualifying donations",don,"Article 33(1)"],["Add: dividends to owners, Corporate Tax, recoverable VAT, foreign tax",other,"Article 33(4), (6), (7), (8)"],["Add: expenditure not for the Business or for Exempt Income",nb,"Article 28(2)"],["Add: Net Interest Expenditure disallowed this period",disallowed,"Article 30(1), 30% of EBITDA; MD 126/2023 AED 12m safe harbour"],["Less: brought-forward interest now deductible",bfUsed,"Article 30(4)"],["Taxable Income before Tax Loss relief",tiBefore,"Article 20(2)"],["Less: Tax Loss relief",lossRelief,"Article 37(2): at most 75%"],["Taxable Income",ti,relief?"Article 21: nil under Small Business Relief":"Article 20"],["Standard: 0% band",band0,"Cabinet Decision 116 of 2022"],["Standard: 9% on the excess",std9,"Article 3(1)(b)"],["QFZP: 9% on non-qualifying Taxable Income",qf9,"Article 3(2)"],["Less: Foreign Tax Credit",ftc,"Article 47(2)"],["Corporate Tax Payable",tax,"Article 48"]]};
}


const ANNEX=["None","1(a) Remote biometric identification","1(b) Biometric categorisation by sensitive attributes","1(c) Emotion recognition","2 Critical infrastructure safety component","3(a) Education access or admission","3(b) Evaluating learning outcomes","3(c) Level of education","3(d) Test monitoring","4(a) Recruitment and selection","4(b) Employment decisions and monitoring","5(a) Public benefits eligibility","5(b) Creditworthiness or credit scoring","5(c) Life and health insurance pricing","5(d) Emergency call triage","6(a) to 6(e) Law enforcement","7(a) to 7(d) Migration and border","8(a) Justice","8(b) Elections"];
const PROHIB=["None","5(1)(a) Manipulative or deceptive techniques","5(1)(b) Exploiting vulnerabilities","5(1)(c) Social scoring","5(1)(d) Predictive policing on profiling alone","5(1)(e) Untargeted facial scraping","5(1)(f) Workplace or school emotion inference","5(1)(g) Sensitive biometric categorisation","5(1)(h) Real-time remote biometric ID for law enforcement"];
function classify(v){
  if(v.scope==="No") return {cls:"Out of scope",code:"m",obl:"None under this Regulation (Article 2 exclusion). Record which exclusion applies.",date:"n/a",fine:0};
  if(v.prohib!=="None") return {cls:"PROHIBITED (Article 5)",code:"p",obl:"Stop: the practice is banned since 2 February 2025. Document and remove.",date:"2 February 2025",fine:Math.max(35e6,0.07*v.turn)};
  const annex=v.annex!=="None"; const high=v.a61==="Yes"||(annex&&(v.prof==="Yes"||v.ex!=="Yes"));
  if(high){const prov=v.role.startsWith("Provider"); const dep=v.role.includes("eployer"); let o=[]; if(prov)o.push("Article 16 provider duties: Section 2 requirements (Arts 9 to 15), QMS (17), documentation (18), logs (19), conformity assessment (43), declaration and CE marking (47, 48), EU database registration (49), post-market monitoring and incident reporting (72, 73)"); if(dep)o.push("Article 26 deployer duties: use per instructions, human oversight, input data, monitoring and suspension, six-month logs, worker information, inform affected persons; Article 27 FRIA where applicable"); if(!prov&&!dep)o.push("Articles 23 and 24: importer and distributor checks of conformity, documentation and CE marking"); if(v.a50==="Yes")o.push("plus Article 50 transparency"); o.push("plus Article 4 AI literacy");
    const date=v.a61==="Yes"?"2 August 2027 (Article 6(1) systems)":(v.pre==="Yes"?"Only on significant change in design after 2 August 2026 (Article 111(2))":"2 August 2026");
    return {cls:"High-risk",code:"h",obl:o.join("; "),date,fine:Math.max(15e6,0.03*v.turn)};}
  if(v.gpai==="Yes") return {cls:"General-purpose AI model",code:"g",obl:"Article 53: technical documentation, downstream information, copyright policy, public training-content summary; Article 55 if systemic risk (presumed above 10^25 FLOP); plus Article 4",date:v.pre==="Yes"?"2 August 2027 (Article 111(3))":"2 August 2025",fine:Math.max(15e6,0.03*v.turn)};
  if(v.a50==="Yes") return {cls:"Limited risk (transparency)",code:"l",obl:"Article 50: interaction notice, machine-readable marking of synthetic output, deep fake and emotion recognition disclosures; plus Article 4 AI literacy"+(annex?" (Annex III use case exempted under Article 6(3): document and register the assessment, Article 6(4))":""),date:"2 August 2026",fine:Math.max(15e6,0.03*v.turn)};
  return {cls:"Minimal risk",code:"m",obl:"Article 4 AI literacy; voluntary codes of conduct (Article 95)"+(annex?" (Annex III use case exempted under Article 6(3): document and register the assessment, Article 6(4))":""),date:"2 August 2026 (Article 4 from 2 February 2025)",fine:0};}
const FACTOR={2026:0.025,2027:0.05,2028:0.10,2029:0.225,2030:0.485,2031:0.61,2032:0.735,2033:0.86,2034:1.0};
const SECTORS=[["Cement",true],["Fertilisers",true],["Iron and steel",false],["Aluminium",false],["Hydrogen",false],["Electricity",false]];
function cbamCompute(year,price,ls){const f=FACTOR[year]; let tq=0,te=0,tc=0,cost=0; const rows=ls.map(l=>{const ch=l.tot*f; const net=Math.max(0,price-l.ocp); const c=ch*net; tq+=l.qty; te+=l.tot; tc+=ch; cost+=c; return {...l,ch,net,c};}); return {f,rows,tq,te,tc,cost,certs:Math.ceil(tc),perT:tq?cost/tq:0};}
export { ctCompute, classify, cbamCompute, ANNEX, PROHIB, FACTOR, SECTORS };
