# PDF & Invoice Data Extractor API

[![Status](https://img.shields.io/badge/Status-Operational-brightgreen)](https://pdf-invoice-extractor.topaisaas.workers.dev/v1/health)
[![RapidAPI](https://img.shields.io/badge/RapidAPI-Subscribe-blue?logo=rapidapi)](https://rapidapi.com/user/topaisaas-dev)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Cloudflare%20Workers-orange)](https://workers.cloudflare.com)
[![Zero Cost](https://img.shields.io/badge/Tokens%20Cost-%E2%82%AC0.00%20(Zero%20LLM)-success)](https://topaisaas.com)

High-performance, zero-LLM-token algorithmic engine for parsing, extracting, and mathematically auditing invoices, receipts, and billing documents into clean, type-safe JSON for AI agents, fintech workflows, and ERP automation.

---

## ⚡ Key Capabilities

- **Zero Token Cost / Infinite Scalability**: Pure algorithmic extraction running on Cloudflare's global edge network (sub-30ms latency). Zero dependence on OpenAI, Gemini, or third-party paid OCR token billing.
- **Complete Entity Extraction**:
  - **Invoice ID & References**: Number, PO Number, Order ID.
  - **Normalized Dates**: Issue Date, Due Date, Delivery Date (normalized to standard ISO 8601 `YYYY-MM-DD`).
  - **Supplier & Buyer Intelligence**: Names, physical addresses, emails, phone numbers, website domains.
  - **Tax & Corporate Registration**: SIRET, SIREN, EU VAT numbers, Tax IDs across Europe and North America.
  - **Banking Coordinates (ISO 7064 Mod 97-10)**: Extracts IBAN and BIC/SWIFT with real-time mathematical checksum verification.
- **Line Items Table Parser**: Extracts item descriptions, quantities, unit prices HT, and row totals.
- **Financial Reconciliation & Fraud Detection**:
  - Automatically verifies `Subtotal HT + VAT == Total TTC` with micro-delta calculation.
  - Generates an automated **Audit & Confidence Score (0-100%)** alerting agents to math errors or fraudulent discrepancies.

---

## 🚀 API Endpoints

### 1. Healthcheck
`GET /v1/health`

```bash
curl -X GET "https://pdf-invoice-extractor.topaisaas.workers.dev/v1/health"
```

### 2. Extract Invoice Data
`POST /v1/extract`

**Headers**:
- `Content-Type: application/json`
- `X-RapidAPI-Key: YOUR_RAPIDAPI_KEY` (when using RapidAPI)

**Request Body**:
```json
{
  "text": "ACME SAS\\nFACTURE N° : INV-2024-001\\nDate : 15/04/2024\\nTotal HT : 1000.00 €\\nTVA (20%) : 200.00 €\\nNet à payer : 1200.00 €\\nIBAN : FR7630004012345678901234586",
  "currency_fallback": "EUR"
}
```

*Note: You can also pass `"pdf_base64": "..."` to extract directly from native PDF binary streams!*

**Response (200 OK)**:
```json
{
  "invoice_number": "INV-2024-001",
  "dates": {
    "invoice_date": "2024-04-15"
  },
  "supplier": {
    "name": "ACME SAS",
    "iban": "FR7630004012345678901234586"
  },
  "financials": {
    "currency": "EUR",
    "currency_symbol": "€",
    "subtotal_ht": 1000.0,
    "tax_amount": 200.0,
    "total_ttc": 1200.0,
    "tax_rate_detected": 20
  },
  "audit": {
    "is_math_valid": true,
    "math_difference": 0,
    "is_iban_valid": true,
    "confidence_score": 95
  }
}
```

### 3. Financial Validator & IBAN Check
`POST /v1/validate`

Validates math consistency, VAT number syntax, and IBAN MOD 97 checksum.

```json
{
  "subtotal_ht": 1000.00,
  "tax_amount": 200.00,
  "total_ttc": 1200.00,
  "vat_number": "FR12839210948",
  "iban": "FR7630004012345678901234586"
}
```

---

## 🛡️ Security & Zero Cost Guarantee

- **Zero Paid Third-Party Dependencies**: No paid LLMs or external credits required.
- **SSRF & Denial-of-Service Hardening**: Max payload enforcement (5MB), strict input sanitization, and catastrophic regex backtracking protection.
