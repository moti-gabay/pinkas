/**
 * Evolving merchant normalization used for categorization, grouping and display.
 * It is NOT used by the dedupe hash (see dedupe-hash.ts) so it can change freely.
 */
const bidiAndZeroWidth = /[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;
const branchSuffix =
  /\s*[-–]?\s*(?:סניף|ת"א|תל אביב|חיפה|ירושלים|ב"ש|באר שבע|פ"ת|פתח תקוה|ר"ג|רמת גן|הרצליה|נתניה|ראשל"צ|ראשון לציון)(?=\s|$).*$/u;
const trailingNumbers = /[\s#*-]*\d{2,}[\s\d#*-]*$/;
const payPrefixes = /^(paybox|bit|פייבוקס|ביט)\s*[-:]?\s*/i;

export function normalizeMerchant(descriptionRaw: string): string {
  let s = descriptionRaw.normalize('NFKC').replace(bidiAndZeroWidth, '');
  s = s
    .replace(/[\u00a0\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  s = s.replace(/^(?:חיוב|זיכוי)\s*[-:]\s*/u, '');
  s = s.replace(payPrefixes, '');
  s = s.replace(branchSuffix, '');
  s = s.replace(trailingNumbers, '');
  s = s.replace(/\s*(בע"מ|בעמ|ltd\.?|inc\.?|llc)\s*$/iu, '');
  s = s.replace(/[*]+/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.toLowerCase();
  return s === '' ? descriptionRaw.trim().toLowerCase() : s;
}
