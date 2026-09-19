export interface LineItem {
  description: string;
  quantity: number;
  unit_price: number;
  tax_rate_percent?: number;
  total_amount: number;
}

export interface SupplierInfo {
  name?: string;
  address?: string;
  email?: string;
  phone?: string;
  website?: string;
  tax_id?: string;
  vat_number?: string;
  siret?: string;
  iban?: string;
  bic?: string;
}

export interface CustomerInfo {
  name?: string;
  address?: string;
  vat_number?: string;
  customer_id?: string;
}

export interface InvoiceDates {
  invoice_date?: string; // ISO 8601 YYYY-MM-DD
  due_date?: string;
  delivery_date?: string;
  raw_detected?: { [key: string]: string };
}

export interface FinancialSummary {
  currency: string;
  currency_symbol: string;
  subtotal_ht: number;
  tax_amount: number;
  total_ttc: number;
  tax_rate_detected?: number;
  tax_breakdown?: Array<{ rate_percent: number; base_amount: number; tax_amount: number }>;
  discount_amount?: number;
  amount_paid?: number;
  amount_due?: number;
}

export interface ValidationAudit {
  is_math_valid: boolean;
  math_difference: number;
  is_iban_valid?: boolean;
  iban_validation_error?: string;
  is_vat_format_valid?: boolean;
  warnings: string[];
  confidence_score: number; // 0 to 100
}

export interface ParsedInvoice {
  invoice_number?: string;
  purchase_order?: string;
  dates: InvoiceDates;
  supplier: SupplierInfo;
  customer: CustomerInfo;
  line_items: LineItem[];
  financials: FinancialSummary;
  audit: ValidationAudit;
  metadata: {
    engine: string;
    version: string;
    processing_time_ms: number;
    lines_parsed: number;
    input_type: "text" | "pdf_base64" | "raw";
  };
}

export interface ExtractRequest {
  text?: string;
  pdf_base64?: string;
  currency_fallback?: string;
}

export interface ValidateRequest {
  subtotal_ht?: number;
  tax_amount?: number;
  total_ttc?: number;
  vat_number?: string;
  iban?: string;
}
