import { Hono } from "hono";
import { cors } from "hono/cors";
import { getSecurityHeaders, sanitizeInput, MAX_PAYLOAD_BYTES } from "./security.ts";
import { parseInvoiceText } from "./invoice_parser.ts";
import { extractTextFromPDFBytes } from "./pdf_text_decoder.ts";
import { validateIBAN, validateVATFormat } from "./iban_validator.ts";
import type { ExtractRequest, ValidateRequest } from "./types.ts";

const app = new Hono();

// Global CORS & Security Headers
app.use("*", cors({
  origin: "*",
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "X-RapidAPI-Key", "X-RapidAPI-Host", "X-RapidAPI-User"]
}));

app.use("*", async (c, next) => {
  await next();
  const headers = getSecurityHeaders();
  for (const [key, value] of Object.entries(headers)) {
    c.header(key, value as string);
  }
});

// Root & Healthcheck
app.get("/", (c) => {
  return c.json({
    service: "pdf-invoice-extractor",
    version: "1.0.0",
    docs: "/v1/sample",
    endpoints: {
      health: "/v1/health",
      extract: "POST /v1/extract",
      validate: "POST /v1/validate",
      sample: "GET /v1/sample"
    },
    status: "operational"
  });
});

app.get("/v1/health", (c) => {
  return c.json({
    status: "healthy",
    uptime: "24/7",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
    engine: "TopAISaaS-InvoiceEngine-v1",
    capabilities: [
      "zero-llm-token-cost",
      "algorithmic-table-extraction",
      "iso-7064-iban-checksum",
      "eu-vat-format-validation",
      "math-reconciliation-ht-ttc",
      "pdf-native-stream-decoding"
    ]
  });
});

// Sample Mock Invoice for RapidAPI 1-Click Testing
const SAMPLE_INVOICE_TEXT = `ACME Solutions SAS
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

app.get("/v1/sample", (c) => {
  const parsed = parseInvoiceText(SAMPLE_INVOICE_TEXT, "text", "EUR");
  return c.json({
    sample_input: {
      text: SAMPLE_INVOICE_TEXT,
      instructions: "Send this payload to POST /v1/extract with JSON { \"text\": \"...\" } or base64 PDF"
    },
    sample_output: parsed
  });
});

// POST /v1/extract
app.post("/v1/extract", async (c) => {
  try {
    const contentType = c.req.header("content-type") || "";
    let extractedText = "";
    let inputType: "text" | "pdf_base64" | "raw" = "text";
    let fallbackCurrency = "EUR";

    if (contentType.includes("application/json")) {
      const body = await c.req.json<ExtractRequest>().catch(() => null);
      if (!body) {
        return c.json({ error: "Invalid JSON body" }, 400);
      }

      if (body.currency_fallback) {
        fallbackCurrency = body.currency_fallback;
      }

      if (body.pdf_base64) {
        inputType = "pdf_base64";
        // Decode base64 to binary bytes
        const binaryStr = atob(body.pdf_base64.replace(/^data:application\/pdf;base64,/, ""));
        const len = binaryStr.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        extractedText = await extractTextFromPDFBytes(bytes);
      } else if (body.text) {
        extractedText = sanitizeInput(body.text);
      } else {
        return c.json({
          error: "Missing required parameter",
          details: "Provide either 'text' (string) or 'pdf_base64' (base64 encoded PDF document)"
        }, 400);
      }
    } else {
      // Direct raw text or raw binary payload
      const raw = await c.req.text();
      extractedText = sanitizeInput(raw);
      inputType = "raw";
    }

    if (!extractedText || extractedText.length < 5) {
      return c.json({
        error: "Insufficient content extracted",
        details: "Unable to find invoice text or PDF text streams in payload."
      }, 422);
    }

    const parsedInvoice = parseInvoiceText(extractedText, inputType, fallbackCurrency);
    return c.json(parsedInvoice, 200);

  } catch (err: any) {
    return c.json({
      error: "Extraction failed",
      message: err?.message || "Internal extraction error"
    }, 500);
  }
});

// POST /v1/validate
app.post("/v1/validate", async (c) => {
  try {
    const body = await c.req.json<ValidateRequest>().catch(() => null);
    if (!body) {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const results: any = {
      is_valid: true,
      checks: {}
    };

    // 1. Math check
    if (body.subtotal_ht !== undefined && body.tax_amount !== undefined && body.total_ttc !== undefined) {
      const calculated = body.subtotal_ht + body.tax_amount;
      const diff = Number(Math.abs(calculated - body.total_ttc).toFixed(2));
      const mathOk = diff <= 0.05;
      results.checks.math = {
        passed: mathOk,
        calculated_total: calculated,
        declared_total: body.total_ttc,
        difference: diff
      };
      if (!mathOk) results.is_valid = false;
    }

    // 2. VAT number format check
    if (body.vat_number) {
      const vatCheck = validateVATFormat(body.vat_number);
      results.checks.vat = {
        passed: vatCheck.isValid,
        country: vatCheck.country,
        vat_number: body.vat_number
      };
      if (!vatCheck.isValid) results.is_valid = false;
    }

    // 3. IBAN check
    if (body.iban) {
      const ibanCheck = validateIBAN(body.iban);
      results.checks.iban = {
        passed: ibanCheck.isValid,
        country: ibanCheck.countryCode,
        error: ibanCheck.error
      };
      if (!ibanCheck.isValid) results.is_valid = false;
    }

    return c.json(results, 200);

  } catch (err: any) {
    return c.json({
      error: "Validation failed",
      message: err?.message || "Internal validation error"
    }, 500);
  }
});

export default app;
