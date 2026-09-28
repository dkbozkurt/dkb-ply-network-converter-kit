// Playable ad network converter — generic engine.
//
// Takes a playable exported for one ad network and rewrites only the
// ad-network integration layer to target another network, leaving the game
// core, scaffold and assets untouched. Which networks exist, how they are
// detected, what gets stripped and what gets injected is entirely described
// by the definitions in src/networks/ — nothing in here is network-specific.
//
// Pipeline (mirrors the stages shown in the UI):
//   1. analyze   — detect source network, classify inline <script> blocks
//   2. strip     — delete the source network's integration blocks
//   3. neutral   — reset analytics config, retarget $environment, externalize
//                  startup assets, install the PlayableAdapter seam
//   4. target    — let the target definition graft on its own layer
//   5. package   — (optional) decode inline images to loose files, or move
//                  them (still encoded) into an external script
//   6. audit     — (optional) target-defined checks over the final package,
//                  e.g. Meta's "no external calls" rule; warnings only
//
// Output is { html, files } ready to be zipped by the packager.

import { scanScripts, applyEdits, injectBefore, readTargetPlatform, findScriptSyntaxErrors } from "./html.js";
import { extractAndRewriteImages, extractImagesToScript } from "./images.js";
import { SOURCE_NETWORKS, networkForPlatform } from "../networks/index.js";

export const PLAYABLE_ADAPTER_GLOBAL = "PlayableAdapter";

// The neutral seam every target wires into. A target overrides exit() (and
// anything else it needs) after this shim is in place.
const PLAYABLE_ADAPTER_SHIM =
  `<script>window.${PLAYABLE_ADAPTER_GLOBAL}=window.${PLAYABLE_ADAPTER_GLOBAL}||{` +
  "ready(){},complete(){},trackEvent(){},exit(){}};</script>";

// Luna's analytics bootstrap carries the source network name and collector
// endpoints: window.pi.apply(window,["<network>", ...]). A neutral build
// passes an empty config, exactly like a native export for a network without
// analytics wiring does.
const ANALYTICS_BOOTSTRAP_RE = /window\.pi\.apply\s*\(\s*window\s*,\s*\[([^\]]*)\]\s*(?:\|\|\s*\[\s*\])?\s*\)/;
const ANALYTICS_BOOTSTRAP_NEUTRAL = "window.pi.apply(window,[])";

const helpers = { injectBefore, readTargetPlatform, PLAYABLE_ADAPTER_GLOBAL };

// --- Detection --------------------------------------------------------------

/**
 * Work out which network a playable was exported for.
 * Prefers the build tool's own declaration ($environment.targetPlatform) and
 * falls back to marker regexes from the source definitions.
 */
export function detectSource(html) {
  const platform = readTargetPlatform(html);
  const declared = networkForPlatform(platform);
  if (declared) {
    return { network: declared, platform, via: "targetPlatform" };
  }
  for (const n of SOURCE_NETWORKS) {
    if (n.source.markers.some((re) => re.test(html))) {
      return { network: n, platform, via: "markers" };
    }
  }
  return { network: null, platform, via: "none" };
}

// --- Block classification ---------------------------------------------------

function assetKind(attrs, body) {
  if (!/data-startup-only/.test(attrs)) return null;
  if (!/_compressedAssets/.test(body)) return null;
  if (/^\s*window\.jsons\s*=/.test(body)) return "jsons";
  if (/^\s*window\.blobs\s*=/.test(body)) return "blobs";
  if (/decompress(String|ArrayBuffer)\s*\(/.test(body)) return "scripts";
  return null;
}

// Luna dev-only helpers that ship inert in production exports but reference
// remote hosts (console.re remote logging, spector.js WebGL inspector, the
// ?startup timing probe). Networks that forbid external references
// (Mintegral, Meta, Snapchat) flag those URLs, so they are always removed.
const DEV_TOOLING_RULES = [
  /insertYourRemoteDebuggingTokenHere/,
  /spectorjs|SPECTOR\.Spector/,
  /window\.lunaStartup\s*=/,
];

export function analyze(html) {
  const detected = detectSource(html);
  const source = detected.network;
  const stripRules = source && source.source ? source.source.strip : [];

  const scripts = scanScripts(html);
  const networkBlocks = [];
  const devBlocks = [];
  const assetBlocks = [];
  for (const s of scripts) {
    if (s.external) continue;
    if (stripRules.some((re) => re.test(s.body))) {
      networkBlocks.push(s);
    } else if (DEV_TOOLING_RULES.some((re) => re.test(s.body))) {
      devBlocks.push(s);
    } else {
      const kind = assetKind(s.attrs, s.body);
      if (kind) assetBlocks.push({ kind, ...s });
    }
  }
  return { ...detected, source, scripts, networkBlocks, devBlocks, assetBlocks };
}

// --- Neutral stage helpers --------------------------------------------------

function neutralizeAnalytics(html, log) {
  const m = html.match(ANALYTICS_BOOTSTRAP_RE);
  if (!m) return html;
  if (!m[1].trim()) return html; // already neutral
  log.step("Reset analytics bootstrap config (window.pi.apply) to a neutral, network-less call");
  return html.replace(ANALYTICS_BOOTSTRAP_RE, ANALYTICS_BOOTSTRAP_NEUTRAL);
}

function retargetEnvironment(html, from, to, log) {
  const next = html.replace(/targetPlatform:\s*"[^"]*"/, `targetPlatform:"${to}"`);
  if (next !== html) log.step(`Set $environment.targetPlatform "${from || "?"}" → "${to}"`);
  else log.warn("No $environment.targetPlatform found to retarget");
  return next;
}

function externalizeAssets(blocks, log) {
  const files = {};
  const edits = [];
  for (const b of blocks) {
    files[`assets/${b.kind}.js`] = b.body;
    edits.push({
      start: b.start,
      end: b.end,
      text: `<script src="assets/${b.kind}.js" defer data-startup-only></script>`,
    });
  }
  if (blocks.length) {
    log.step(`Externalized ${blocks.length} startup asset block(s) → ${Object.keys(files).join(", ")}`);
  }
  return { files, edits };
}

// --- Conversion -------------------------------------------------------------

/**
 * Convert one playable to one target network.
 * @param {string} html            source entry-point markup
 * @param {object} opts
 * @param {object} opts.target     network definition with a supported `target`
 * @param {object} [opts.log]      logger scope ({ step, warn, error, info })
 * @param {object} [opts.source]   force a source definition (skip detection)
 */
export function convertPlayable(html, { target, log, source: forcedSource } = {}) {
  if (!target || !target.target) throw new Error("A target network definition is required");
  if (!target.target.supported) throw new Error(`Target "${target.name}" is not supported yet`);
  if (typeof target.target.patch !== "function") {
    throw new Error(`Target "${target.name}" has no patch() implementation`);
  }
  log = log || { step() {}, warn() {}, error() {}, info() {}, section() {} };

  // 1 · analyze
  log.section("analyze");
  const info = analyze(html);
  const source = forcedSource || info.source;
  if (source) {
    log.step(`Detected source network: ${source.name} (via ${info.via}${info.platform ? `, targetPlatform="${info.platform}"` : ""})`);
  } else {
    log.warn(`No known source network markers found${info.platform ? ` (targetPlatform="${info.platform}")` : ""}; applying target layer only`);
  }
  if (source && source.id === target.id) {
    if (target.target.passthrough) {
      // The loaded file is already a build for this network: hand it back
      // unchanged, just renamed. (Loading a *different* source and targeting
      // this network still runs the full pipeline below.)
      log.step(`Loaded file is already a ${target.name} build — passed through unchanged, only renamed with _${target.target.zipSuffix}`);
      return {
        html,
        files: {},
        entryName: (target.target.packaging && target.target.packaging.entryName) || "index.html",
        source,
        target,
        sourcePlatform: info.platform,
        auditPassed: null,
        passthrough: true,
      };
    }
    log.warn(`Source and target are both ${target.name}; the network layer will be re-applied`);
  }
  log.info(`Entry point: ${html.length.toLocaleString()} chars, ${info.scripts.length} <script> blocks ` +
    `(${info.networkBlocks.length} network, ${info.devBlocks.length} dev-tooling, ${info.assetBlocks.length} startup-asset)`);

  // 2 · strip
  log.section("strip source layer");
  const edits = info.networkBlocks.map((b) => ({ start: b.start, end: b.end, text: "" }));
  if (info.networkBlocks.length) {
    log.step(`Removed ${info.networkBlocks.length} ${source ? source.name : "network"} integration block(s)`);
  } else {
    log.warn("No network integration blocks matched the strip rules");
  }

  // 3 · neutral adapter
  log.section("neutral adapter");
  const packaging = target.target.packaging || {};
  let files = {};
  if (info.devBlocks.length) {
    edits.push(...info.devBlocks.map((b) => ({ start: b.start, end: b.end, text: "" })));
    log.step(`Removed ${info.devBlocks.length} inert dev-tooling block(s) (remote debugging / spector / startup probe) that reference external hosts`);
  }
  if (packaging.externalizeAssets) {
    const ext = externalizeAssets(info.assetBlocks, log);
    files = ext.files;
    edits.push(...ext.edits);
  }
  html = applyEdits(html, edits);
  html = neutralizeAnalytics(html, log);
  html = retargetEnvironment(html, info.platform, target.target.platformId, log);
  html = injectBefore(html, "</body>", PLAYABLE_ADAPTER_SHIM, { last: true });
  log.step(`Installed neutral window.${PLAYABLE_ADAPTER_GLOBAL} seam`);

  // 4 · target layer
  log.section(`target layer · ${target.name}`);
  // `files` is handed to the target so it can add sidecar files (e.g.
  // Snapchat's config.json) next to the entry html.
  html = target.target.patch(html, { source, log, helpers, files });

  // Parse-check every inline script so a broken injected layer surfaces here
  // instead of as a silently dead <script> in the ad network's container.
  const syntaxErrors = findScriptSyntaxErrors(html);
  if (syntaxErrors.length) {
    for (const e of syntaxErrors) {
      log.error(`Inline <script> #${e.index} does not parse: ${e.error} — "${e.preview}…"`);
    }
    throw new Error(`${syntaxErrors.length} inline <script> block(s) fail to parse after the ${target.name} layer`);
  }
  log.step(`Parse-checked ${scanScripts(html).filter((b) => !b.external).length} inline <script> blocks`);

  // 5 · package
  log.section("package");
  if (packaging.externalizeImages === "script") {
    const extracted = extractImagesToScript(html, log);
    html = extracted.html;
    Object.assign(files, extracted.files);
  } else if (packaging.externalizeImages) {
    const extracted = extractAndRewriteImages(html, log);
    html = extracted.html;
    for (const [id, data] of Object.entries(extracted.assets)) files[`assets/${id}`] = data;
  }
  const entryName = packaging.entryName || "index.html";
  log.step(`Output: ${entryName} + ${Object.keys(files).length} file(s)`);

  // 6 · optional network audit over the final package (warnings only)
  let auditPassed = null;
  if (typeof target.target.audit === "function") {
    log.section(`audit · ${target.name}`);
    auditPassed = target.target.audit({ html, files, entryName, log }) !== false;
  }

  return {
    html,
    files,
    entryName,
    auditPassed,
    source,
    target,
    sourcePlatform: info.platform,
  };
}
