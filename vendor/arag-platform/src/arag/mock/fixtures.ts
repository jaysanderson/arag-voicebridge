/**
 * Deterministic fixtures for the mock ARAG server: sample document texts keyed by filename
 * hints, call transcripts, and generators for structured outputs. Everything here is fictional.
 */

export const SAMPLE_DOCS: Record<string, string> = {
  invoice: `ACME ROBOTICS PTY LTD
Unit 7, 142 Burwood Road, Hawthorn VIC 3122, Australia
ABN 51 824 753 556

TAX INVOICE

Invoice Number: INV-2026-0042
Invoice Date: 15/06/2026
Due Date: 15/07/2026
Purchase Order: PO-88421

Bill To:
Progress Software Corporation
14 Oak Park, Bedford MA 01730, USA

Description                         Qty   Unit Price   Amount
Industrial 3D Printer (Model X9)      2    $48,000.00  $96,000.00
On-site Installation & Calibration    1     $3,200.00   $3,200.00
Extended Warranty (24 months)         2       $400.00     $800.00

Subtotal: $100,000.00
GST (10%): $10,000.00
TOTAL DUE: $110,000.00 AUD

Payment terms: 30 days. Bank: Westpac BSB 033-000 Acc 123456.`,
  "purchase-order": `COBALT MANUFACTURING INC.
PURCHASE ORDER

PO Number: PO-55218
Order Date: 03/05/2027
Supplier: Apex Industrial Supplies
Ship To: 900 Foundry Way, Dayton OH 45402, USA
Currency: USD

Item                          Qty   Unit Price   Amount
Hex bolts M12 (box of 500)     10      $85.00    $850.00
Bearing 6205-2RS               40      $12.50    $500.00
Hydraulic hose 3/8" (10 m)      6      $64.00    $384.00
Safety gloves (pair)          100       $4.20    $420.00
Cutting fluid 20 L              5      $58.00    $290.00

Subtotal: $2,444.00
Tax (7.25%): $177.19
Total: $2,621.19

Authorised by: R. Delgado, Procurement Manager`,
  "preauth-form": `MERIDIAN HEALTH — HOSPITAL PRE-AUTHORISATION REQUEST
Reference: PA-2027-33891
Scheme: Meridian Health    Benefit Option: Comprehensive Plus
Membership Number: MER-4471902
Patient Name: Sarah Donovan    Date of Birth: 04/11/1984
Treating Provider: Dr Anil Mehta (Orthopaedic Surgeon)
Facility: St Jude Private Hospital
Proposed Admission Date: 22/06/2027
Length of Stay: 3 nights
Procedure: Arthroscopic knee reconstruction (CPT 29888)
Primary Diagnosis: ICD-10 S83.511A
Authorisation Number: AUTH-90233
Status: APPROVED
Co-payment: $250.00`,
  "remittance-statement": `MERIDIAN HEALTH — CLAIMS REMITTANCE ADVICE
Claim Number: CLM-90233
Member Number: MER-4471902
Patient Name: Sarah Donovan
Provider: St Jude Private Hospital
Date of Service: 18/06/2027
Diagnosis Code: J45.9
Procedure Code: 99213
Currency: USD
Amount Claimed: $420.00
Amount Paid: $336.00
Member Liability: $84.00
Status: Partially paid`,
  contract: `MASTER SERVICES AGREEMENT

This Master Services Agreement ("Agreement") is entered into on 1 March 2027 (the "Effective Date")
between Helios Software LLC, a Delaware limited liability company ("Provider"), and Vanguard Retail Group,
Inc. ("Customer").

1. Term. The initial term is 24 months from the Effective Date, renewing annually unless terminated.
2. Fees. Customer shall pay Provider total fees of USD $480,000 payable quarterly in advance.
3. Termination. Either party may terminate for material breach with 30 days written notice and opportunity to cure.
4. Governing Law. This Agreement is governed by the laws of the State of Delaware.
5. Confidentiality. Each party shall protect the other's Confidential Information for five years.`,
  resume: `PRIYA NAIR
Senior Data Engineer · Melbourne, Australia
priya.nair@example.com · +61 400 123 456

SUMMARY
Data engineer with 9 years of experience building streaming and batch pipelines on AWS and GCP.

EXPERIENCE
Lead Data Engineer, Northwind Logistics (2022–present)
Data Engineer, Cobalt Analytics (2018–2022)
Software Engineer, Apex Systems (2016–2018)

SKILLS
Python, SQL, Spark, Kafka, dbt, Airflow, Terraform, Kubernetes

EDUCATION
BSc Computer Science, University of Melbourne (2016)`,
  receipt: `BREW & BEAN CAFE
09/09/2027 14:32
Flat white           $5.50
Almond croissant     $6.20
Avocado toast       $14.90
Sparkling water      $4.00
Subtotal            $30.60
GST                  $2.78
TOTAL               $33.38
VISA ending 4417 — APPROVED`,
  "bank-statement": `STERLING NATIONAL BANK — ACCOUNT STATEMENT
Account Holder: Priya Nair
Account Number: ****8842
Statement Period: 01 July 2027 – 31 July 2027
Currency: USD
Opening Balance: $4,210.55

Date        Description                 Debit      Credit     Balance
2027-07-02  Salary — Northwind Logistics          $6,400.00  $10,610.55
2027-07-05  Rent — Carlton Property Mgmt $2,150.00            $8,460.55
2027-07-09  Grocer Market                 $184.20             $8,276.35
2027-07-15  Electricity — PowerCo         $96.40              $8,179.95
2027-07-28  Transfer to savings         $1,000.00             $7,179.95

Closing Balance: $7,179.95`,
};

/** Pick a fixture text by filename hint (case-insensitive substring). */
export function sampleTextFor(filename: string): string | null {
  const f = filename.toLowerCase();
  for (const key of Object.keys(SAMPLE_DOCS)) if (f.includes(key)) return SAMPLE_DOCS[key]!;
  if (f.includes("po")) return SAMPLE_DOCS["purchase-order"]!;
  if (f.includes("claim")) return SAMPLE_DOCS["remittance-statement"]!;
  if (f.includes("cv")) return SAMPLE_DOCS.resume!;
  return null;
}

export const SAMPLE_CALL_TRANSCRIPT = `Agent: Thank you for calling Meridian Health Plan, this call may be recorded for quality and training. My name is Maria. Can I please verify your full name and date of birth?

Member: Yes, this is Robert Carlisle, date of birth March 4th, 1979. And I am pretty upset right now.

Agent: Thank you Robert, I have verified your account. I am sorry to hear that. Tell me what happened.

Member: You charged my card twice for my June premium. Two hundred and forty dollars, taken out twice. My account is now overdrawn.

Agent: I completely understand why that is frustrating, and I apologize. I can see the duplicate charge on June first. I am going to file a refund for the second charge right now.

Member: How long is that going to take? I have overdraft fees now because of this.

Agent: The refund will post in three to five business days. For the overdraft fees, I am opening a service complaint so our resolution team can review reimbursement. While I have you, you do not currently have our supplemental hospital indemnity plan, which would only be twelve dollars a month.

Member: No. I am not interested in buying anything else right now. I just want my money back.

Agent: That is completely fair, I will not push it. So to confirm, a refund of two hundred and forty dollars in three to five days, and a complaint filed for the overdraft fees with a callback within forty-eight hours. Is there anything else I can help with?

Member: No, that is it. Thank you for at least fixing it.`;

const MONEY_RE = /(?:[$€£]|AUD|USD|EUR|GBP|ZAR)\s?[\d,]+(?:\.\d{2})?/g;
const DATE_RE =
  /\b(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2} [A-Z][a-z]+ \d{4}|[A-Z][a-z]+ \d{1,2}, \d{4})\b/g;

function grab(text: string, re: RegExp): string | undefined {
  const m = re.exec(text);
  return m?.[1]?.trim() || m?.[0]?.trim() || undefined;
}
function firstLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean) ?? ""
  );
}
function lines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}
function title(s: string): string {
  return s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Classify a document by keywords (mirrors what a model would do). */
export function classifyText(text: string, allowed: string[]): string {
  const t = text.toLowerCase();
  const rules: Array<[string, RegExp]> = [
    ["invoice", /tax invoice|invoice number|invoice #|amount due|total due/],
    ["purchase_order", /purchase order|po number/],
    ["preauthorisation", /pre-authori[sz]ation|authorisation number|admission date/],
    ["medical_claim", /claim number|remittance|amount claimed/],
    ["bank_statement", /bank statement|account statement|opening balance|closing balance/],
    ["receipt", /receipt|visa ending|cafe|thermal/],
    ["contract", /agreement|governing law|hereinafter|terminat/],
    ["resume", /experience|education|skills|curriculum|résumé|resume/],
    ["report", /report|findings|executive summary/],
    ["form", /form|reference:|submitted by/],
  ];
  for (const [type, re] of rules) if (re.test(t) && allowed.includes(type)) return type;
  return allowed.includes("generic") ? "generic" : (allowed[0] ?? "generic");
}

/** Heuristic value extraction for a schema property key against document text. */
export function extractValue(
  key: string,
  prop: Record<string, unknown>,
  text: string,
  docTitle: string,
): unknown {
  const k = key.toLowerCase();
  const type = String(prop.type ?? "string");
  const enumVals = Array.isArray(prop.enum) ? (prop.enum as string[]) : null;
  if (enumVals) {
    if (k === "doc_type") return classifyText(text, enumVals);
    return enumVals[0];
  }
  const money = text.match(MONEY_RE) ?? [];
  const dates = text.match(DATE_RE) ?? [];
  const named = (label: RegExp) => grab(text, new RegExp(`(?:${label.source})[:#\\s]+([^\\n]+)`, "i"));
  const map: Record<string, () => unknown> = {
    vendor_name: () => firstLine(text),
    bank_name: () => firstLine(text).replace(/—.*$/, "").trim(),
    merchant: () => firstLine(text),
    supplier: () => named(/supplier/),
    buyer: () => firstLine(text),
    bill_to: () => grab(text, /bill to:?\s*\n?([^\n]+)/i),
    invoice_number: () => named(/invoice number|invoice #|invoice no/),
    po_number: () => named(/po number|purchase order/),
    claim_number: () => named(/claim number/),
    authorisation_number: () => named(/authorisation number/),
    reference: () => named(/reference/),
    member_number: () => named(/member(?:ship)? number/),
    account_number: () => named(/account number/),
    account_holder: () => named(/account holder/),
    patient_name: () => named(/patient name/),
    provider: () => named(/treating provider|provider/),
    facility: () => named(/facility/),
    scheme: () => named(/scheme/),
    benefit_option: () => named(/benefit option/),
    status: () => named(/status/),
    procedure: () => named(/procedure/),
    procedure_code: () => named(/procedure code|cpt/),
    diagnosis_code: () => grab(text, /ICD-10\s*([A-Z]\d+(?:\.\d+)?[A-Z]?)/i) ?? named(/diagnosis code/),
    length_of_stay: () => named(/length of stay/),
    co_payment: () => named(/co-?payment/),
    statement_period: () => named(/statement period/),
    invoice_date: () => named(/invoice date/) ?? dates[0],
    due_date: () => named(/due date/) ?? dates[1],
    order_date: () => named(/order date/) ?? dates[0],
    service_date: () => named(/date of service/) ?? dates[0],
    admission_date: () => named(/admission date/) ?? dates[0],
    transaction_date: () => dates[0],
    effective_date: () => grab(text, /entered into on ([^\s(]+ [^\s(]+ \d{4})/i) ?? dates[0],
    submitted_date: () => dates[0],
    date: () => dates[0],
    currency: () => grab(text, /\b(AUD|USD|EUR|GBP|ZAR)\b/) ?? (text.includes("$") ? "USD" : undefined),
    subtotal: () => grab(text, /subtotal:?\s*([$€£]?[\d,]+\.\d{2})/i),
    tax: () => grab(text, /(?:tax|gst|vat)[^\n$€£]*?([$€£]?[\d,]+\.\d{2})/i),
    total: () => grab(text, /\btotal(?: due)?:?\s*([$€£]?[\d,]+\.\d{2})/i) ?? money[money.length - 1],
    total_value: () => grab(text, /(USD \$[\d,]+)/i) ?? money[0],
    amount_claimed: () => named(/amount claimed/),
    amount_paid: () => named(/amount paid/),
    member_liability: () => named(/member liability/),
    opening_balance: () => named(/opening balance/),
    closing_balance: () => named(/closing balance/),
    payment_method: () => grab(text, /(visa|mastercard|amex|cash)[^\n]*/i),
    title: () =>
      k === "title" ? (grab(text, /^(.*agreement.*|.*report.*)$/im) ?? firstLine(text)) : firstLine(text),
    form_title: () => firstLine(text),
    document_kind: () =>
      title(
        classifyText(text, [
          "invoice",
          "purchase_order",
          "contract",
          "resume",
          "receipt",
          "bank_statement",
          "medical_claim",
          "preauthorisation",
          "form",
          "report",
          "generic",
        ]),
      ),
    full_name: () => firstLine(text),
    email: () => grab(text, /[\w.+-]+@[\w-]+\.[\w.]+/),
    phone: () => grab(text, /\+?\d[\d ()-]{7,}\d/),
    location: () => grab(text, /·\s*([A-Z][a-z]+, [A-Za-z ]+)/),
    headline: () => lines(text)[1],
    years_experience: () => Number(grab(text, /(\d+) years/i) ?? 5),
    term: () => grab(text, /term is ([^.]+)/i),
    governing_law: () => grab(text, /governed by the laws of ([^.]+)/i),
    termination: () => grab(text, /terminat[^.]*\.\s*[^.]*\./i),
    author: () => firstLine(text),
    submitted_by: () => named(/submitted by/),
    ship_to: () => named(/ship to/),
    vendor_address: () => lines(text)[1],
  };
  const fn = map[k];
  const v = fn?.();
  if (v !== undefined && v !== "" && type !== "array") return v;
  if (type === "array") {
    const items = (prop.items as Record<string, unknown> | undefined)?.type;
    if (k === "parties")
      return [
        grab(text, /between ([^,]+),/i) ?? "Party A",
        grab(text, /and ([A-Z][^,]+?),? Inc/i) ?? "Party B",
      ];
    if (k === "line_items" || k === "items" || k === "transactions")
      return lines(text)
        .filter((l) => /\$\s?[\d,]+\.\d{2}/.test(l) && !/total|subtotal|gst|tax|balance/i.test(l))
        .slice(0, 6);
    if (k === "skills") return grab(text, /SKILLS\s*\n([^\n]+)/)?.split(/,\s*/) ?? ["Python", "SQL"];
    if (k === "employers")
      return lines(text)
        .filter((l) => /\(\d{4}/.test(l))
        .map((l) => l.replace(/\s*\(.*$/, ""))
        .slice(0, 4);
    if (k === "education")
      return lines(text)
        .filter((l) => /BSc|MSc|University|Bachelor|Master/i.test(l))
        .slice(0, 3);
    if (k === "key_obligations")
      return lines(text)
        .filter((l) => /^\d\./.test(l))
        .slice(0, 4);
    if (k === "dates") return [...new Set(dates)].slice(0, 5);
    if (k === "amounts") return [...new Set(money)].slice(0, 5);
    if (k === "people_orgs")
      return [...new Set(text.match(/\b[A-Z][a-z]+ [A-Z][a-z]+(?: [A-Z][a-z]+)?\b/g) ?? [])].slice(0, 5);
    if (k === "tags")
      return [
        "document",
        classifyText(text, ["invoice", "contract", "resume", "receipt", "generic"]),
        "sample",
      ];
    if (k === "fields" || k === "key_values")
      return lines(text)
        .filter((l) => /^[A-Za-z ]+:\s*\S/.test(l))
        .slice(0, 8);
    if (k === "key_findings" || k === "metrics") return lines(text).slice(1, 4);
    if (items === "number") return [1, 2];
    return lines(text).slice(1, 3);
  }
  if (type === "number" || type === "integer") return k === "confidence" ? 0.92 : 3;
  if (type === "boolean") return false;
  if (k === "summary") return `${lines(text).slice(0, 3).join(" ").slice(0, 220)}.`.replace(/\.\.$/, ".");
  if (k === "confidence") return 0.92;
  return `${title(key)} (${docTitle})`;
}

/** Fill an OpenAI-function-style schema from document text. */
export function synthesizeJson(
  schema: { name?: string; parameters?: { properties?: Record<string, unknown>; required?: string[] } },
  text: string,
  docTitle: string,
  query = "",
): Record<string, unknown> {
  const props = schema.parameters?.properties ?? {};
  const out: Record<string, unknown> = {};
  if (schema.name === "extract_entities" || "entities" in props) {
    const money = [...new Set(text.match(MONEY_RE) ?? [])]
      .slice(0, 4)
      .map((t) => ({ text: t, type: "MONEY" }));
    const dates = [...new Set(text.match(DATE_RE) ?? [])].slice(0, 3).map((t) => ({ text: t, type: "DATE" }));
    const orgs = [
      ...new Set(
        text.match(/\b[A-Z][A-Za-z]+ (?:Pty Ltd|Inc\.?|LLC|Corporation|Bank|Health|Group)\b/g) ?? [],
      ),
    ]
      .slice(0, 3)
      .map((t) => ({ text: t, type: "ORG" }));
    const people = [...new Set(text.match(/\b(?:Dr |Mr |Ms )?[A-Z][a-z]+ [A-Z][a-z]+\b/g) ?? [])]
      .filter((p) => !orgs.some((o) => o.text.includes(p)))
      .slice(0, 3)
      .map((t) => ({ text: t, type: "PERSON" }));
    out.entities = [...orgs, ...people, ...money, ...dates];
    return out;
  }
  if (schema.name === "call_brief" || "suggested_questions" in props) return briefFixture(text, query);
  for (const [key, prop] of Object.entries(props)) {
    const v = extractValue(key, prop as Record<string, unknown>, text, docTitle);
    if (v !== undefined && v !== null && v !== "") out[key] = v;
  }
  return out;
}

export function briefFixture(transcript: string, latest: string): Record<string, unknown> {
  const t = (transcript + " " + latest).toLowerCase();
  const topic = /printer|sinter|furnace|binder/.test(t)
    ? "Metal binder-jet printing"
    : /plan|premium|refund|claim/.test(t)
      ? "Account and billing"
      : "General enquiry";
  return {
    topic,
    caller_profile: "Operations lead evaluating equipment; technically literate, budget-conscious.",
    their_goal: "Understand whether the product fits their production needs and what it costs.",
    stage: /price|cost|quote/.test(t) ? "evaluating" : "exploring",
    summary: `The caller is asking about ${topic.toLowerCase()}. The knowledge base covers the product range, materials and typical throughput.`,
    key_points: [
      "Entry-level systems start with a compact footprint.",
      "Sintering furnaces support stainless and tool steels.",
      "Typical lead time is six to eight weeks.",
    ],
    suggested_questions: [
      "What part volumes are you targeting per month?",
      "Which materials matter most for your parts?",
    ],
    suggested_answers: [
      "The Shop System is designed for mid-volume metal parts with binder jetting.",
      "PureSinter supports 17-4PH and 316L stainless.",
    ],
    recommended_products: /printer|metal|sinter/.test(t)
      ? ["Shop System — mid-volume binder jetting", "PureSinter Furnace — vacuum sintering"]
      : [],
  };
}

export function callAnalysisFixture(transcript: string): Record<string, unknown> {
  const t = transcript.toLowerCase();
  const complaint = /upset|complain|frustrat|charged .* twice|overdrawn/.test(t);
  const crossSell = /supplemental|add-on|plan .* month|would only be/.test(t);
  const accepted = crossSell && /yes,? (?:let'?s|sign me up|add it)/.test(t);
  return {
    executive_summary: complaint
      ? "The member called about a duplicate premium charge that overdrew their account. The agent verified identity, issued a refund and opened a complaint for overdraft fees. A cross-sell was offered and declined."
      : "The member called with a benefits question which the agent resolved on the call. The member was satisfied with the outcome.",
    member_intent: complaint
      ? "Get a duplicate charge refunded and overdraft fees reimbursed."
      : "Clarify plan coverage.",
    key_topics: complaint
      ? ["billing", "refund", "overdraft fees", "complaint", "cross-sell declined"]
      : ["benefits", "coverage", "resolution"],
    agent_scorecard: { empathy: 88, compliance: 96, resolution_effectiveness: complaint ? 82 : 90 },
    complaint: {
      present: complaint,
      category: complaint ? "Billing error" : null,
      severity: complaint ? "medium" : null,
      quote: complaint ? "You charged my card twice for my June premium." : null,
    },
    cross_sell: {
      offered: crossSell,
      product: crossSell ? "Hospital indemnity plan" : null,
      accepted,
      objection: crossSell && !accepted ? "Not interested in buying anything else right now." : null,
    },
    action_items: complaint
      ? ["Refund $240.00 within 3–5 business days", "Resolution team callback within 48 hours"]
      : [],
    risk_flags: complaint ? ["Retention risk"] : [],
    notable_quotes: [
      { speaker: "Member", quote: complaint ? "I just want my money back." : "Thanks, that answers it." },
    ],
  };
}

export function callMetricsFixture(transcript: string): Record<string, unknown> {
  const t = transcript.toLowerCase();
  const complaint = /upset|complain|frustrat|charged .* twice|overdrawn/.test(t);
  const crossSell = /supplemental|add-on|would only be/.test(t);
  return {
    call_reason: complaint
      ? "Billing & Payments"
      : /claim/.test(t)
        ? "Claims"
        : /dental|cover|benefit/.test(t)
          ? "Benefits & Coverage"
          : "Enrollment & Eligibility",
    outcome: complaint ? "Follow-up Required" : "Resolved",
    sentiment: complaint ? "Negative" : "Positive",
    line_of_business: /medicare/.test(t) ? "Medicare Advantage" : "Individual & Family",
    complaint,
    complaint_category: complaint ? "Billing error" : null,
    cross_sell_offered: crossSell,
    cross_sell_accepted: false,
    csat_estimate: complaint ? 3 : 5,
    compliance_score: 96,
    first_call_resolution: !complaint,
    escalated: false,
    product_mentioned: crossSell ? "Hospital indemnity plan" : null,
  };
}
