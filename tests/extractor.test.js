import test from "node:test";
import assert from "node:assert/strict";
import { parseInvoiceText } from "../src/invoice_parser.ts";
import { validateIBAN, validateVATFormat } from "../src/iban_validator.ts";

const SAMPLE_INVOICE = `ACME Solutions SAS
12 Rue de la Paix, 75002 Paris, France
Tél : +33 1 42 68 55 00
Email : contact@acme-solutions.fr
SIRET : 83921094800012
N° TVA : FR12839210948
IBAN : FR8330004012345678901234586
BIC : BNPAFRPPXXX

FACTURE N° : INV-2024-00892
Date d'émission : 15/04/2024
Date d'échéance : 15/05/2024

Facturé à :
Global Retail Group SA
45 Avenue des Champs-Élysées, 75008 Paris

Désignation                                      Quantité   Prix Unitaire   Total
Abonnement Cloud Infrastructure Pro              1          1200.00         1200.00 €
Audit de Sécurité & Conformité SOC2              2          750.00          1500.00 €
Support Dédié SLA 99.99%                         1          300.00          300.00 €

Total H.T. : 3000.00 €
TVA (20%) : 600.00 €
Net à payer : 3600.00 €
`;

test("IBAN Validation (ISO 7064 Mod 97-10)", () => {
  // Valid French IBAN
  const valid = validateIBAN("FR83 3000 4012 3456 7890 1234 586");
  assert.equal(valid.isValid, true);
  assert.equal(valid.countryCode, "FR");

  // Invalid IBAN (corrupted check digit)
  const invalid = validateIBAN("FR76 3000 4012 3456 7890 1234 599");
  assert.equal(invalid.isValid, false);
});

test("VAT Format Validation", () => {
  const validFR = validateVATFormat("FR12839210948");
  assert.equal(validFR.isValid, true);
  assert.equal(validFR.country, "FR");

  const validDE = validateVATFormat("DE123456789");
  assert.equal(validDE.isValid, true);
  assert.equal(validDE.country, "DE");

  const invalid = validateVATFormat("FR99INVALID");
  assert.equal(invalid.isValid, false);
});

test("Invoice Extraction & Financial Reconciliation", () => {
  const result = parseInvoiceText(SAMPLE_INVOICE, "text", "EUR");

  // Invoice Number
  assert.equal(result.invoice_number, "INV-2024-00892");

  // Dates
  assert.equal(result.dates.invoice_date, "2024-04-15");
  assert.equal(result.dates.due_date, "2024-05-15");

  // Financials
  assert.equal(result.financials.currency, "EUR");
  assert.equal(result.financials.subtotal_ht, 3000.00);
  assert.equal(result.financials.tax_amount, 600.00);
  assert.equal(result.financials.total_ttc, 3600.00);
  assert.equal(result.financials.tax_rate_detected, 20);

  // Supplier
  assert.equal(result.supplier.name, "ACME Solutions SAS");
  assert.equal(result.supplier.email, "contact@acme-solutions.fr");
  assert.equal(result.supplier.siret, "83921094800012");
  assert.equal(result.supplier.vat_number, "FR12839210948");
  assert.equal(result.supplier.bic, "BNPAFRPPXXX");

  // Customer
  assert.equal(result.customer.name, "Global Retail Group SA");

  // Line items
  assert.equal(result.line_items.length, 3);
  assert.equal(result.line_items[0].description, "Abonnement Cloud Infrastructure Pro");
  assert.equal(result.line_items[0].quantity, 1);
  assert.equal(result.line_items[0].unit_price, 1200.00);
  assert.equal(result.line_items[0].total_amount, 1200.00);

  // Audit
  assert.equal(result.audit.is_math_valid, true);
  assert.equal(result.audit.math_difference, 0);
  assert.equal(result.audit.confidence_score >= 80, true);
});

test("Math Mismatch & Fraud Audit Detection", () => {
  const FRAUD_INVOICE = `DevCorp Ltd
Invoice Number: US-99201
Date: 2024-03-01
Subtotal: $5,000.00
Tax: $500.00
Total: $6,000.00
`;
  const res = parseInvoiceText(FRAUD_INVOICE, "text", "USD");
  assert.equal(res.financials.currency, "USD");
  assert.equal(res.financials.subtotal_ht, 5000.00);
  assert.equal(res.financials.tax_amount, 500.00);
  assert.equal(res.financials.total_ttc, 6000.00);
  // Math mismatch: 5000 + 500 = 5500 != 6000
  assert.equal(res.audit.is_math_valid, false);
  assert.equal(res.audit.math_difference, 500);
  assert.equal(res.audit.warnings.length > 0, true);
});

