// Package audit shared by targets. Runs over the finished package (entry html
// + loose files) and logs anything a network's validator or reviewer would
// reject. Warnings only — the package is still produced.
//
// Almost every network forbids external resources and runtime fetching; the
// differences are the size cap, the file-count cap, whether mraid.js may be
// referenced (Meta / Snapchat: no) and whether a window.open() fallback is
// acceptable (MRAID hosts: yes, it never runs there; Meta / Snapchat: no).

const MB = 1024 * 1024;

const EXTERNAL_REF_RULES = [
  { re: /<script\b[^>]*\bsrc\s*=\s*["']https?:\/\//gi, what: "external <script src>" },
  { re: /<link\b[^>]*\bhref\s*=\s*["']https?:\/\//gi, what: "external <link href>" },
  { re: /<(?:img|video|audio|source|iframe)\b[^>]*\bsrc\s*=\s*["']https?:\/\//gi, what: "external media src" },
  { re: /url\(\s*["']?https?:\/\//gi, what: "external CSS url()" },
  { re: /\bXMLHttpRequest\b/g, what: "XMLHttpRequest usage" },
  { re: /\b(?:window\.)?location\.(?:href|assign|replace)\s*[=(]/g, what: "location redirect" },
];
const WINDOW_OPEN_RULE = { re: /\bwindow\.open\s*\(/g, what: "window.open() (JS redirect)" };
const MRAID_SCRIPT_RULE = { re: /<script\b[^>]*\bsrc\s*=\s*["'][^"']*mraid\.js["']/gi, what: "mraid.js script tag (forbidden here)" };
const CONSOLE_OVERRIDE_RULE = { re: /\bconsole\.(?:log|warn|error|info|debug)\s*=[^=]/g, what: "global console method override" };

function countMatches(text, re) {
  re.lastIndex = 0;
  let n = 0;
  while (re.exec(text)) n++;
  return n;
}

function byteLength(content) {
  if (typeof content === "string") return new TextEncoder().encode(content).length;
  return content.byteLength || content.length || 0;
}

/**
 * Build a `target.audit()` for a network.
 * @param {object} o
 * @param {string} o.label              network name used in log lines
 * @param {number} [o.maxBytes]         cap for the uncompressed package
 * @param {number} [o.maxFiles]         cap for the number of files in the package
 * @param {boolean} [o.forbidMraidScript] flag a <script src="mraid.js"> reference
 * @param {boolean} [o.allowWindowOpen]   don't flag window.open() (MRAID fallback)
 * @param {boolean} [o.forbidConsoleOverride] flag global console.* reassignment
 * @param {string[]} [o.allowScripts]     exact <script src> tags the network requires
 *                                        (its own SDK) — not counted as external references
 */
export function createPackageAudit({
  label,
  maxBytes,
  maxFiles,
  forbidMraidScript = false,
  allowWindowOpen = false,
  forbidConsoleOverride = false,
  allowScripts = [],
}) {
  const rules = [...EXTERNAL_REF_RULES];
  if (!allowWindowOpen) rules.push(WINDOW_OPEN_RULE);
  if (forbidMraidScript) rules.push(MRAID_SCRIPT_RULE);
  if (forbidConsoleOverride) rules.push(CONSOLE_OVERRIDE_RULE);

  return function audit({ html, files, entryName = "index.html", log }) {
    let entry = html;
    for (const tag of allowScripts) entry = entry.split(tag).join("");
    const texts = [[entryName, entry]];
    for (const [path, content] of Object.entries(files)) {
      if (typeof content === "string") texts.push([path, content]);
    }

    let flagged = 0;
    for (const [path, text] of texts) {
      for (const rule of rules) {
        const n = countMatches(text, rule.re);
        if (n) {
          flagged += n;
          log.warn(`${label} audit: ${n}× ${rule.what} in ${path}`);
        }
      }
    }

    // Luna's analytics module contains fetch() but only calls it when a
    // collector URL is configured; the neutral stage clears that config.
    const fetchCalls = countMatches(html, /\bfetch\s*\(/g);
    const neutralAnalytics = /window\.pi\.apply\(window,\[\]\)/.test(html);
    if (fetchCalls && !neutralAnalytics) {
      flagged++;
      log.warn(`${label} audit: ${fetchCalls}× fetch() and analytics config is not neutral — external calls possible`);
    } else if (fetchCalls) {
      log.info(`${label} audit: ${fetchCalls}× fetch() present but analytics endpoints are empty — no calls will be made`);
    }

    const fileCount = 1 + Object.keys(files).length;
    if (maxFiles && fileCount > maxFiles) {
      flagged++;
      log.warn(`${label} audit: ${fileCount} files exceeds the ${maxFiles}-file limit`);
    }

    let bytes = byteLength(html);
    for (const c of Object.values(files)) bytes += byteLength(c);
    const size = `${(bytes / MB).toFixed(2)} MB`;
    if (maxBytes && bytes > maxBytes) {
      flagged++;
      log.warn(`${label} audit: package is ${size} uncompressed — over the ${(maxBytes / MB).toFixed(0)} MB limit`);
    } else {
      const caps = [maxFiles && `${maxFiles} files`, maxBytes && `${(maxBytes / MB).toFixed(0)} MB`].filter(Boolean).join(", ");
      log.info(`${label} audit: ${fileCount} file${fileCount === 1 ? "" : "s"}, ${size} uncompressed${caps ? ` (limits: ${caps})` : ""}`);
    }

    if (!flagged) log.step(`${label} audit passed: no external references, redirects or size/file-count violations`);
    return flagged === 0;
  };
}

export { MB };
