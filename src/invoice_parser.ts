import type {
  ParsedInvoice,
  LineItem,
  SupplierInfo,
  CustomerInfo,
  InvoiceDates,
  FinancialSummary,
  ValidationAudit
} from "./types.ts";
import { validateIBAN, validateVATFormat } from "./iban_validator.ts";

export function parseInvoiceText(rawText: string, inputType: "text" | "pdf_base64" | "raw" = "text", fallbackCurrency = "EUR"): ParsedInvoice {
  const startTime = Date.now();
  const text = rawText.replace(/\r\n/g, "\n");
  const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);

  // 1. Identify Currency
  const { currency, currencySymbol } = detectCurrency(text, fallbackCurrency);

  // 2. Extract Invoice Number & Reference
  const invoiceNumber = extractInvoiceNumber(text);
  const purchaseOrder = extractPurchaseOrder(text);

  // 3. Extract Dates
  const dates = extractDates(text);

  // 4. Extract Financial Totals
  const financials = extractFinancials(text, currency, currencySymbol);

  // 5. Extract Line Items
  const lineItems = extractLineItems(lines, currencySymbol);

  // If subtotal is missing but line items exist, compute it
  if (financials.subtotal_ht === 0 && lineItems.length > 0) {
    financials.subtotal_ht = Number(lineItems.reduce((acc, item) => acc + item.total_amount, 0).toFixed(2));
    if (financials.total_ttc === 0 && financials.tax_amount === 0) {
      financials.total_ttc = financials.subtotal_ht;
    }
  }

  // 6. Extract Supplier & Customer
  const supplier = extractSupplier(text, lines);
  const customer = extractCustomer(text, lines);

  // 7. Math Consistency & Audit
  const audit = auditInvoice(financials, supplier);

  const processingTimeMs = Date.now() - startTime;

  return {
    invoice_number: invoiceNumber,
    purchase_order: purchaseOrder,
    dates,
    supplier,
    customer,
    line_items: lineItems,
    financials,
    audit,
    metadata: {
      engine: "TopAISaaS-InvoiceEngine-v1",
      version: "1.0.0",
      processing_time_ms: processingTimeMs,
      lines_parsed: lines.length,
      input_type: inputType
    }
  };
}

/**
 * Currency Detection
 */
function detectCurrency(text: string, fallback: string): { currency: string; currencySymbol: string } {
  if (/€|\bEUR\b|\bEURO\b|\bEUROS\b/i.test(text)) return { currency: "EUR", currencySymbol: "€" };
  if (/\$|\bUSD\b|\bDOLLAR\b|\bDOLLARS\b/i.test(text)) return { currency: "USD", currencySymbol: "$" };
  if (/£|\bGBP\b|\bLIVRE\b|\bPOUND\b/i.test(text)) return { currency: "GBP", currencySymbol: "£" };
  if (/\bCHF\b/i.test(text)) return { currency: "CHF", currencySymbol: "CHF" };
  if (/\bCAD\b/i.test(text)) return { currency: "CAD", currencySymbol: "CA$" };
  if (/\bAUD\b/i.test(text)) return { currency: "AUD", currencySymbol: "AU$" };
  if (/¥|\bJPY\b/i.test(text)) return { currency: "JPY", currencySymbol: "¥" };

  return { currency: fallback, currencySymbol: fallback === "EUR" ? "€" : fallback === "USD" ? "$" : fallback };
}

/**
 * Invoice Number Extraction
 */
function extractInvoiceNumber(text: string): string | undefined {
  const patterns = [
    /(?:facture|invoice|bill|reçu|inv|fac)[\s\.:#\-°nno]{1,8}([A-Z0-9\-_]{3,25})/i,
    /(?:n°|numéro|number|no\.)\s*(?:de\s+facture)?[\s\.:#\-]{1,4}([A-Z0-9\-_]{3,25})/i,
    /\b(INV[-_]?[0-9]{4,}[-_]?[0-9]*)\b/i,
    /\b(FAC[-_]?[0-9]{4,}[-_]?[0-9]*)\b/i
  ];

  for (const regex of patterns) {
    const match = text.match(regex);
    if (match && match[1]) {
      const candidate = match[1].trim();
      // Exclude generic words
      if (!/^(date|total|client|page|du|le)$/i.test(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

/**
 * Purchase Order Extraction
 */
function extractPurchaseOrder(text: string): string | undefined {
  const match = text.match(/(?:bon\s+de\s+commande|purchase\s+order|bon\s+n°|po\s*#?)[\s\.:#\-]{1,6}([A-Z0-9\-_]{3,25})/i);
  return match ? match[1].trim() : undefined;
}

/**
 * Date Extraction
 */
function extractDates(text: string): InvoiceDates {
  const result: InvoiceDates = { raw_detected: {} };

  // Match ISO YYYY-MM-DD
  const isoMatch = text.match(/\b(20\d{2}[-\/.](?:0[1-9]|1[0-2])[-\/.](?:0[1-9]|[12]\d|3[01]))\b/);
  // Match European DD/MM/YYYY
  const euMatch = text.match(/\b((?:0[1-9]|[12]\d|3[01])[-\/.](?:0[1-9]|1[0-2])[-\/.](?:20\d{2}))\b/);

  // Issue date
  const issueDateMatch = text.match(/(?:date\s*(?:de\s*facture|d'émission|de\s*la\s*facture|facture)?|invoice\s*date|issued\s*on)[\s\.:#\-]{1,5}((?:0[1-9]|[12]\d|3[01])[-\/.](?:0[1-9]|1[0-2])[-\/.](?:20\d{2})|20\d{2}[-\/.](?:0[1-9]|1[0-2])[-\/.](?:0[1-9]|[12]\d|3[01]))/i);
  if (issueDateMatch) {
    result.invoice_date = normalizeDate(issueDateMatch[1]);
  } else if (euMatch) {
    result.invoice_date = normalizeDate(euMatch[1]);
  } else if (isoMatch) {
    result.invoice_date = normalizeDate(isoMatch[1]);
  }

  // Due date
  const dueDateMatch = text.match(/(?:échéance|date\s*d'échéance|due\s*date|payable\s*(?:by|before)|date\s*limite)[\s\.:#\-]{1,5}((?:0[1-9]|[12]\d|3[01])[-\/.](?:0[1-9]|1[0-2])[-\/.](?:20\d{2})|20\d{2}[-\/.](?:0[1-9]|1[0-2])[-\/.](?:0[1-9]|[12]\d|3[01]))/i);
  if (dueDateMatch) {
    result.due_date = normalizeDate(dueDateMatch[1]);
  }

  return result;
}

function normalizeDate(raw: string): string {
  const cleaned = raw.replace(/[\/.]/g, "-");
  const parts = cleaned.split("-");
  if (parts[0].length === 4) {
    // Already YYYY-MM-DD
    return cleaned;
  } else if (parts[2].length === 4) {
    // DD-MM-YYYY -> YYYY-MM-DD
    return `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
  }
  return raw;
}

/**
 * Financial Totals Parser
 */
function extractFinancials(text: string, currency: string, currencySymbol: string): FinancialSummary {
  let subtotal = 0;
  let tax = 0;
  let total = 0;
  let taxRate: number | undefined;

  // Subtotal HT / Net / Subtotal
  const htMatch = text.match(/(?:total\s*h\.?t\.?|sous[- ]total(?:\s*h\.?t\.?)?|net\s*ht|montant\s*ht|subtotal)[\s\.:#\-=]{1,8}(?:[\$€£¥]|EUR|USD|GBP|CHF)?\s*([\d\s,]+(?:[\.,]\d{2})?)/i);
  if (htMatch) subtotal = parsePrice(htMatch[1]);

  // Tax Rate (e.g. TVA (20%), TVA 20%, VAT @ 20%, TVA à 5.5%)
  const taxRateMatch = text.match(/(?:tva|vat|taxe?)\s*(?:à|at|@)?\s*\(?\s*([12]?\d(?:[,\.]\d{1,2})?)\s*%\)?/i);
  if (taxRateMatch) taxRate = parseFloat(taxRateMatch[1].replace(",", "."));

  // Tax / VAT Amount
  const taxMatch = text.match(/(?:total\s*t\.?v\.?a\.?|montant\s*t\.?v\.?a\.?|tva(?:\s*20%|\s*10%|\s*5\.5%)?|vat\s*amount|tax\s*amount|tax)[\s\.:#\-=]{1,8}(?:[\$€£¥]|EUR|USD|GBP|CHF)?\s*([\d\s,]+(?:[\.,]\d{2})?)/i);
  if (taxMatch) tax = parsePrice(taxMatch[1]);

  // Total TTC (must not match subtotal or sous-total)
  const ttcMatch = text.match(/(?:total\s*t\.?t\.?c\.?|net\s*à\s*payer|montant\s*total|(?<!sub)(?<!sous-)\btotal\s*(?:dû|payable|general|amount)?\b|(?<!sub)(?<!sous-)\btotal\b)[\s\.:#\-=]{1,8}(?:[\$€£¥]|EUR|USD|GBP|CHF)?\s*([\d\s,]+(?:[\.,]\d{2})?)/i);
  if (ttcMatch) total = parsePrice(ttcMatch[1]);

  // Deduce tax if subtotal & total are known but tax is missing
  if (tax === 0 && subtotal > 0 && total > subtotal) {
    tax = Number((total - subtotal).toFixed(2));
  }
  // Deduce total if subtotal & tax are known
  if (total === 0 && subtotal > 0 && tax > 0) {
    total = Number((subtotal + tax).toFixed(2));
  }

  return {
    currency,
    currency_symbol: currencySymbol,
    subtotal_ht: subtotal,
    tax_amount: tax,
    total_ttc: total,
    tax_rate_detected: taxRate,
    tax_breakdown: taxRate && tax > 0 ? [{ rate_percent: taxRate, base_amount: subtotal, tax_amount: tax }] : undefined
  };
}

function parsePrice(raw: string): number {
  if (!raw) return 0;
  // Replace spaces
  let cleaned = raw.replace(/\s/g, "");
  // Replace french comma with dot if it's the decimal separator
  if (cleaned.includes(",") && !cleaned.includes(".")) {
    cleaned = cleaned.replace(",", ".");
  } else if (cleaned.includes(",") && cleaned.includes(".")) {
    // 1,234.56 or 1.234,56
    if (cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")) {
      cleaned = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      cleaned = cleaned.replace(/,/g, "");
    }
  }
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : Number(parsed.toFixed(2));
}

/**
 * Line Items Table Parser
 */
function extractLineItems(lines: string[], currencySymbol: string): LineItem[] {
  const items: LineItem[] = [];

  // Typical row: Description ... Qty ... Price ... Total
  // Regex to detect quantity, unit price, and row total at end of string
  const rowPattern = /^(.*?)\s+(\d{1,4}(?:[,\.]\d{1,2})?)\s+(?:x\s+)?([\d\s]+(?:[,\.]\d{2}))\s*(?:€|\$|EUR|USD)?\s+([\d\s]+(?:[,\.]\d{2}))\s*(?:€|\$|EUR|USD)?$/i;

  for (const line of lines) {
    // Skip header lines or total lines
    if (/^(description|désignation|quantité|prix|total|subtotal|tva|net|ttc|ht|remise)/i.test(line)) {
      continue;
    }

    const match = line.match(rowPattern);
    if (match) {
      const description = match[1].trim();
      const qty = parseFloat(match[2].replace(",", "."));
      const unitPrice = parsePrice(match[3]);
      const lineTotal = parsePrice(match[4]);

      if (description.length > 2 && unitPrice > 0 && lineTotal > 0) {
        items.push({
          description,
          quantity: qty,
          unit_price: unitPrice,
          total_amount: lineTotal
        });
      }
    }
  }

  return items;
}

/**
 * Supplier / Vendor Extraction
 */
function extractSupplier(text: string, lines: string[]): SupplierInfo {
  const supplier: SupplierInfo = {};

  // Email
  const emailMatch = text.match(/\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/);
  if (emailMatch) supplier.email = emailMatch[1].toLowerCase();

  // Phone
  const phoneMatch = text.match(/(?:tél|tel|phone|téléphone)[\s\.:]{1,4}(\+?[0-9\s\.\-]{8,18})/i);
  if (phoneMatch) supplier.phone = phoneMatch[1].trim();

  // Website
  const webMatch = text.match(/\b(https?:\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|www\.[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/i);
  if (webMatch) supplier.website = webMatch[1];

  // SIRET / SIREN
  const siretMatch = text.match(/(?:siret|siren)[\s\.:#\-]{1,5}([0-9\s]{9,17})/i);
  if (siretMatch) {
    const digits = siretMatch[1].replace(/\s/g, "");
    if (digits.length === 14 || digits.length === 9) {
      supplier.siret = digits;
    }
  }

  // EU VAT Number (only match horizontal whitespace, not newlines)
  const vatMatch = text.match(/(?:n°\s*tva|vat(?:\s*id|\s*number)?|tva\s*intra(?:communautaire)?)[\s\.:#\-]{1,5}([A-Z]{2}[0-9A-Z ]{8,14})/i);
  if (vatMatch) {
    supplier.vat_number = vatMatch[1].replace(/\s/g, "").toUpperCase();
  }

  // IBAN (only horizontal spaces)
  const ibanMatch = text.match(/\b([A-Z]{2}[0-9]{2}[A-Z0-9 ]{12,30})\b/);
  if (ibanMatch) {
    const candidate = ibanMatch[1].replace(/\s/g, "").toUpperCase();
    const { isValid } = validateIBAN(candidate);
    if (isValid) {
      supplier.iban = candidate;
    }
  }

  // BIC
  const bicMatch = text.match(/(?:bic|swift)[\s\.:#\-]{1,5}([A-Z0-9]{8,11})/i);
  if (bicMatch) supplier.bic = bicMatch[1].toUpperCase();

  // Supplier Name: First 1-3 lines usually contain supplier corporate name
  for (let i = 0; i < Math.min(4, lines.length); i++) {
    const line = lines[i];
    if (!/facture|invoice|date|devis|client|page|n°/i.test(line) && line.length < 50) {
      supplier.name = line;
      break;
    }
  }

  return supplier;
}

/**
 * Customer / Buyer Extraction
 */
function extractCustomer(text: string, lines: string[]): CustomerInfo {
  const customer: CustomerInfo = {};

  const clientHeaderIndex = lines.findIndex(l => /^(?:facturé\s*à|bill\s*to|client|destinataire|customer)[\s\.:]*$/i.test(l) || /^(?:facturé\s*à|bill\s*to|client|destinataire)[\s\.:]/i.test(l));

  if (clientHeaderIndex !== -1 && clientHeaderIndex + 1 < lines.length) {
    customer.name = lines[clientHeaderIndex + 1];
    if (clientHeaderIndex + 2 < lines.length && !/date|total|facture|montant/i.test(lines[clientHeaderIndex + 2])) {
      customer.address = lines[clientHeaderIndex + 2];
    }
  }

  return customer;
}

/**
 * Financial Consistency & Audit
 */
function auditInvoice(financials: FinancialSummary, supplier: SupplierInfo): ValidationAudit {
  const warnings: string[] = [];
  let confidence = 50; // baseline

  // Math consistency: HT + VAT == TTC
  let isMathValid = false;
  let mathDiff = 0;

  if (financials.subtotal_ht > 0 && financials.total_ttc > 0) {
    const calculatedTTC = financials.subtotal_ht + financials.tax_amount;
    mathDiff = Number(Math.abs(calculatedTTC - financials.total_ttc).toFixed(2));
    isMathValid = mathDiff <= 0.05; // allow small rounding delta

    if (isMathValid) {
      confidence += 20;
    } else {
      warnings.push(`Math mismatch: Subtotal HT (${financials.subtotal_ht}) + Tax (${financials.tax_amount}) != Total TTC (${financials.total_ttc}) [delta: ${mathDiff}]`);
    }
  }

  // VAT validation
  let isVatValid: boolean | undefined;
  if (supplier.vat_number) {
    const vatCheck = validateVATFormat(supplier.vat_number);
    isVatValid = vatCheck.isValid;
    if (isVatValid) {
      confidence += 15;
    } else {
      warnings.push(`VAT format invalid for country code ${vatCheck.country || "unknown"}`);
    }
  }

  // IBAN validation
  let isIbanValid: boolean | undefined;
  let ibanError: string | undefined;
  if (supplier.iban) {
    const ibanCheck = validateIBAN(supplier.iban);
    isIbanValid = ibanCheck.isValid;
    if (isIbanValid) {
      confidence += 15;
    } else {
      ibanError = ibanCheck.error;
      warnings.push(`IBAN invalid: ${ibanCheck.error}`);
    }
  }

  return {
    is_math_valid: isMathValid,
    math_difference: mathDiff,
    is_iban_valid: isIbanValid,
    iban_validation_error: ibanError,
    is_vat_format_valid: isVatValid,
    warnings,
    confidence_score: Math.min(100, confidence)
  };
}
