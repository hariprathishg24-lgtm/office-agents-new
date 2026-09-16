// Redact credentials before anything is written to disk.
//
// The agents can read the owner's real Notion, Drive, Gmail and CRM, and every deliverable is now
// committed to git. Those two facts together mean a single quoted password becomes permanent
// history. This is the last gate before a note is written: obvious secrets are replaced with a
// marker naming what was removed, so the deliverable still makes sense and the secret does not
// travel.
//
// Deliberately conservative: it redacts shapes that are unambiguously credentials. It is a safety
// net for an agent that quotes something it should not have, not a content filter.

const RULES = [
  // provider keys with distinctive prefixes
  [/\b(sk-ant-[A-Za-z0-9_-]{12,})/g, 'ANTHROPIC KEY'],
  [/\b(sk-[A-Za-z0-9]{20,})/g, 'API KEY'],
  [/\b(gh[pousr]_[A-Za-z0-9]{20,})/g, 'GITHUB TOKEN'],
  [/\b(xox[abposr]-[A-Za-z0-9-]{10,})/g, 'SLACK TOKEN'],
  [/\b(AKIA[0-9A-Z]{16})\b/g, 'AWS KEY ID'],
  [/\b(AIza[0-9A-Za-z_-]{30,})/g, 'GOOGLE KEY'],
  [/\bya29\.[A-Za-z0-9._-]{20,}/g, 'OAUTH TOKEN'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, 'JWT'],
  [/\b1000\.[a-f0-9]{32}\.[a-f0-9]{32}\b/gi, 'ZOHO TOKEN'],
  // labelled secrets: "password: hunter2", "api_key = abc123", "secret -> ..."
  [/\b(pass(?:word|phrase)?|pwd|secret|api[\s_-]?key|access[\s_-]?token|auth[\s_-]?token|client[\s_-]?secret|private[\s_-]?key)\b\s*(?:[:=]|->|is)\s*["'`]?([^\s"'`,;]{6,})/gi, 'CREDENTIAL'],
  // a PEM block
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, 'PRIVATE KEY'],
];

/**
 * @returns {{ text: string, found: string[] }} the cleaned text and what was removed
 */
export function scrub(text) {
  let out = String(text ?? '');
  const found = [];
  for (const [re, label] of RULES) {
    out = out.replace(re, (match, ...groups) => {
      // for the labelled form, keep the label and redact only the value
      if (label === 'CREDENTIAL' && groups.length >= 2) {
        found.push(label);
        return `${groups[0]}: [REDACTED — ${label} removed by the office]`;
      }
      found.push(label);
      return `[REDACTED — ${label} removed by the office]`;
    });
  }
  return { text: out, found: [...new Set(found)] };
}
