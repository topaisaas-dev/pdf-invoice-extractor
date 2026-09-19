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

// Root & Interactive Playground
app.get("/", (c) => {
  const accept = c.req.header("accept") || "";
  const format = c.req.query("format");

  if (format === "json" || (!accept.includes("text/html") && accept.includes("application/json"))) {
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
  }

  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PDF & Invoice Data Extractor API • Live Demo</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #090d16; color: #e2e8f0; padding: 40px 20px; line-height: 1.6; }
    .container { max-width: 900px; margin: 0 auto; background: #111827; border: 1px solid #1f2937; border-radius: 16px; padding: 36px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
    .badge { display: inline-flex; align-items: center; gap: 6px; background: rgba(255, 214, 0, 0.15); color: #ffd600; border: 1px solid rgba(255, 214, 0, 0.3); padding: 4px 12px; border-radius: 9999px; font-weight: 600; font-size: 13px; margin-bottom: 16px; }
    .badge::before { content: ''; width: 8px; height: 8px; background: #22c55e; border-radius: 50%; box-shadow: 0 0 8px #22c55e; }
    h1 { font-size: 28px; font-weight: 800; color: #ffffff; margin-bottom: 8px; }
    p.subtitle { font-size: 16px; color: #94a3b8; margin-bottom: 24px; }
    .playground { background: #1a2234; border: 1px solid #2d3748; border-radius: 12px; padding: 24px; margin-bottom: 28px; }
    textarea { width: 100%; min-height: 140px; padding: 14px 16px; background: #0b1120; border: 1px solid #334155; border-radius: 8px; color: #fff; font-size: 13px; font-family: monospace; outline: none; margin-bottom: 14px; transition: border-color 0.2s; }
    textarea:focus { border-color: #ffd600; }
    button { background: #ffd600; color: #000; border: none; padding: 14px 24px; border-radius: 8px; font-weight: 700; font-size: 15px; cursor: pointer; transition: transform 0.1s, background 0.2s; }
    button:hover { background: #ffea00; }
    button:active { transform: scale(0.98); }
    #output { display: none; margin-top: 16px; }
    pre { background: #070b12; border: 1px solid #1e293b; color: #38bdf8; padding: 16px; border-radius: 8px; overflow-x: auto; max-height: 400px; font-size: 13px; font-family: monospace; }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 24px; }
    .chip { background: #1e293b; border: 1px solid #334155; color: #cbd5e1; padding: 6px 12px; border-radius: 6px; font-size: 13px; text-decoration: none; }
    .links-bar { margin-top: 24px; padding-top: 20px; border-top: 1px solid #1f2937; display: flex; gap: 16px; font-size: 14px; }
    .links-bar a { color: #ffd600; text-decoration: none; font-weight: 600; }
    .links-bar a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <div class="badge">Live 24/7 on Cloudflare Global Edge</div>
    <h1>PDF & Invoice Data Extractor API</h1>
    <p class="subtitle">Zero-cost algorithmic extraction for invoices, line items table, ISO 7064 IBAN & VAT audit for AI agents.</p>

    <div class="playground">
      <textarea id="inv" placeholder="Paste invoice text or OCR output here...">ACME Solutions SAS
12 Rue de la Paix, 75002 Paris
SIRET : 83921094800012
N° TVA : FR12839210948
IBAN : FR8330004012345678901234586
FACTURE N° : INV-2024-00892
Date : 15/04/2024
Client : Global Retail Group SA
Abonnement Cloud Pro  1  1200.00  1200.00 €
Audit SOC2           2   750.00  1500.00 €
Total H.T. : 2700.00 €
TVA (20%) : 540.00 €
Net à payer : 3240.00 €</textarea>
      <button onclick="runExtract()" id="btn">Extract & Audit Invoice</button>
      <div id="output">
        <div style="margin-bottom: 8px; font-size: 14px; color: #a3e635;" id="stats"></div>
        <pre id="json"></pre>
      </div>
    </div>

    <h3 style="color:#fff; font-size:16px; margin-bottom: 8px;">📚 Official Endpoints</h3>
    <div class="chips">
      <span class="chip"><code>POST /v1/extract</code> (Full Extraction & Audit)</span>
      <span class="chip"><code>POST /v1/validate</code> (Financial & IBAN Check)</span>
      <span class="chip"><code>GET /v1/sample</code> (Mock Payload)</span>
      <span class="chip"><code>GET /v1/health</code> (Healthcheck)</span>
    </div>

    <div class="links-bar">
      <a href="https://rapidapi.com/user/topaisaas-dev" target="_blank">⚡ RapidAPI Marketplace</a>
      <a href="https://github.com/topaisaas-dev/pdf-invoice-extractor" target="_blank">📦 GitHub Repository</a>
      <a href="/v1/sample" target="_blank">📄 Sample Payload</a>
    </div>
  </div>

  <script>
    async function runExtract() {
      const btn = document.getElementById('btn');
      const text = document.getElementById('inv').value.trim();
      if (!text) return;

      btn.innerText = 'Extracting...';
      btn.disabled = true;

      try {
        const start = Date.now();
        const res = await fetch('/v1/extract', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ text })
        });
        const data = await res.json();
        const elapsed = Date.now() - start;

        document.getElementById('output').style.display = 'block';
        const score = data.audit ? data.audit.confidence_score : 100;
        document.getElementById('stats').innerText = '✓ Extracted in ' + elapsed + ' ms • Confidence: ' + score + '% • Math Valid: ' + (data.audit?.is_math_valid ? 'YES' : 'NO');
        document.getElementById('json').innerText = JSON.stringify(data, null, 2);
      } catch (err) {
        alert('Extraction failed: ' + err.message);
      } finally {
        btn.innerText = 'Extract & Audit Invoice';
        btn.disabled = false;
      }
    }
  </script>
</body>
</html>`);
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
