/**
 * ISO 7064 Mod 97-10 IBAN Validation & Checksum Verification
 */
export function validateIBAN(ibanRaw: string): { isValid: boolean; countryCode?: string; error?: string } {
  if (!ibanRaw) return { isValid: false, error: "Empty IBAN" };

  // Remove spaces, dashes, convert uppercase
  const iban = ibanRaw.replace(/[\s\-]/g, "").toUpperCase();

  // Basic length check (IBAN is between 15 and 34 characters)
  if (iban.length < 15 || iban.length > 34) {
    return { isValid: false, error: `Invalid length: ${iban.length} chars (must be 15-34)` };
  }

  // Check valid country code and check digits
  const countryCode = iban.slice(0, 2);
  if (!/^[A-Z]{2}$/.test(countryCode)) {
    return { isValid: false, error: "Country code must be 2 letters" };
  }

  const checkDigits = iban.slice(2, 4);
  if (!/^\d{2}$/.test(checkDigits)) {
    return { isValid: false, error: "Check digits must be 2 numbers" };
  }

  // Country specific lengths
  const expectedLengths: { [key: string]: number } = {
    AL: 28, AD: 24, AT: 20, AZ: 28, BH: 22, BE: 16, BA: 20, BR: 29, BG: 22, CR: 22,
    HR: 21, CY: 28, CZ: 24, DK: 18, DO: 28, EE: 20, FO: 18, FI: 18, FR: 27, GE: 22,
    DE: 22, GI: 23, GR: 27, GL: 18, GT: 28, HU: 28, IS: 26, IE: 22, IL: 23, IT: 27,
    JO: 30, KZ: 20, KW: 30, LV: 21, LB: 28, LI: 21, LT: 20, LU: 20, MK: 19, MT: 31,
    MR: 27, MU: 30, MD: 24, MC: 27, ME: 22, NL: 18, NO: 15, PK: 24, PS: 29, PL: 28,
    PT: 25, QA: 29, RO: 24, SM: 27, SA: 24, RS: 22, SK: 24, SI: 19, ES: 24, SE: 24,
    CH: 21, TN: 24, TR: 26, AE: 23, GB: 22, VA: 22
  };

  if (expectedLengths[countryCode] && iban.length !== expectedLengths[countryCode]) {
    return {
      isValid: false,
      countryCode,
      error: `Invalid length for ${countryCode}: expected ${expectedLengths[countryCode]}, got ${iban.length}`
    };
  }

  // Move first 4 characters to the end
  const rearranged = iban.slice(4) + iban.slice(0, 4);

  // Convert letters to numbers (A=10, B=11, ... Z=35)
  let numericString = "";
  for (let i = 0; i < rearranged.length; i++) {
    const code = rearranged.charCodeAt(i);
    if (code >= 65 && code <= 90) {
      numericString += (code - 55).toString();
    } else if (code >= 48 && code <= 57) {
      numericString += rearranged[i];
    } else {
      return { isValid: false, countryCode, error: "Invalid characters detected" };
    }
  }

  // Mod 97 on large numbers using chunking (BigInt)
  try {
    const remainder = BigInt(numericString) % 97n;
    if (remainder === 1n) {
      return { isValid: true, countryCode };
    } else {
      return { isValid: false, countryCode, error: `Checksum failed (mod 97 = ${remainder}, expected 1)` };
    }
  } catch {
    return { isValid: false, countryCode, error: "Failed to compute checksum" };
  }
}

/**
 * Standard European VAT Number Format Check
 */
export function validateVATFormat(vatRaw: string): { isValid: boolean; country?: string } {
  if (!vatRaw) return { isValid: false };
  const vat = vatRaw.replace(/[\s\.\-]/g, "").toUpperCase();

  const vatRegexMap: { [country: string]: RegExp } = {
    FR: /^FR[0-9A-Z]{2}[0-9]{9}$/,
    DE: /^DE[0-9]{9}$/,
    IT: /^IT[0-9]{11}$/,
    ES: /^ES[0-9A-Z][0-9]{7}[0-9A-Z]$/,
    GB: /^GB([0-9]{9}|[0-9]{12}|(HA|GD)[0-9]{3})$/,
    NL: /^NL[0-9]{9}B[0-9]{2}$/,
    BE: /^BE0?[0-9]{9}$/,
    CH: /^CHE[0-9]{9}(MWST|TVA|IVA)?$/,
    IE: /^IE[0-9][A-Z0-9\+\*][0-9]{5}[A-Z]{1,2}$/,
    PL: /^PL[0-9]{10}$/,
    PT: /^PT[0-9]{9}$/
  };

  const country = vat.slice(0, 2);
  const regex = vatRegexMap[country];

  if (regex) {
    return { isValid: regex.test(vat), country };
  }

  // Generic check: 2 letters country code + 8-12 alphanumeric chars
  const genericValid = /^[A-Z]{2}[0-9A-Z]{8,14}$/.test(vat);
  return { isValid: genericValid, country: vat.slice(0, 2) };
}
