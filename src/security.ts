/**
 * Security & Threat Mitigation Layer for Financial API (as per SECURITY.md)
 */

export const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024; // 5 MB

export function getSecurityHeaders(): HeadersInit {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-RapidAPI-Key, X-RapidAPI-Host",
  };
}

export function sanitizeInput(input: string): string {
  if (!input) return "";
  // Strip control characters while preserving newlines and tabs
  return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim();
}
