// MRAID (IAB Mobile Rich Media Ad Interface Definitions) integration layer.
//
// MRAID is the common denominator for most ad networks: the host SDK injects
// a `mraid` object into the webview and the creative talks to it. Luna's own
// AppLovin / Unity builds ship exactly two MRAID blocks, which this module
// reproduces so that a converted build matches a native Luna MRAID export:
//
//   1. viewability/state watcher — waits for `ready`, then drives
//      luna:start / luna:pause / luna:resume from isViewable() + getState(),
//      and luna:unsafe:mute / unmute from audioVolumeChange
//   2. CTA handler — InstallFullGame → mraid.open(store url), picking the
//      iOS / Android link from $environment.packageConfig by user agent,
//      with a window.open() fallback for browser previews (never reached
//      inside an MRAID container)
//
// Networks built on MRAID (AppLovin, Unity, Liftoff, AdColony, Aarki, Adikteev,
// BigaBid, InMobi, YouAppi, Appreciate, Remerge, …) differ only in
// packaging and size caps, which each definition sets via `mraidTarget()`.

import { createPackageAudit, MB } from "./audit.js";

/** Strip rules: any source network built on MRAID ships these blocks. */
export const MRAID_STRIP_RULES = [
  /mraid\.open\s*\(/,
  /mraid\.addEventListener\s*\(\s*["']viewableChange["']/,
  /mraid\.isViewable\s*\(\)/,
];

// Declared as early as possible in <head>: MRAID 3.0 hosts (Unity since
// 2026) require the tag to be present before any mraid.* call, and every
// MRAID container intercepts the request and serves its own implementation.
export const MRAID_SCRIPT_TAG = '<script src="mraid.js"></script>';

// Luna's viewability watcher, verbatim from its AppLovin / Unity exports.
const LIFECYCLE =
  "<script>!function(){var n=!1,e=!1;" +
  'function t(){return mraid.isViewable()&&"hidden"!==mraid.getState()}' +
  'function a(){n?t()&&e?(window.dispatchEvent(new Event("luna:resume")),e=!1):t()||e||(window.dispatchEvent(new Event("luna:pause")),e=!0):t()&&(window.dispatchEvent(new Event("luna:start")),n=!0)}' +
  "function i(){}" +
  'function d(n){window.dispatchEvent(new Event(n?"luna:unsafe:unmute":"luna:unsafe:mute"))}' +
  'var r=function(){"undefined"!=typeof mraid?(mraid.removeEventListener("ready",r),mraid.addEventListener("viewableChange",a),mraid.addEventListener("stateChange",a),mraid.addEventListener("orientationchange",i),mraid.addEventListener("audioVolumeChange",d),a()):window.dispatchEvent(new Event("luna:start"))};' +
  'window.addEventListener("luna:build",(function(){window.pi&&window.pi.logLoaded(),"undefined"!=typeof mraid?"loading"===mraid.getState()?mraid.addEventListener("ready",r):r():window.dispatchEvent(new Event("luna:start"))}))' +
  "}()</script>";

// Luna's CTA handler, routed through the PlayableAdapter seam.
const CTA =
  "<script>window.PlayableAdapter.exit=function(n,i){" +
  "window.pi&&window.pi.logCta&&window.pi.logCta();" +
  "var c=window.$environment&&window.$environment.packageConfig||{};" +
  "n=n||c.iosLink,i=i||c.androidLink;" +
  // Prefer the store matching the UA; fall back to whichever link the build has
  // (Luna's original calls mraid.open("") when the preferred link is empty).
  "var o=(/iphone|ipad|ipod|macintosh/i.test(window.navigator.userAgent.toLowerCase())?n:i)||n||i;" +
  'if(!o){console.warn("[playable] no store link in $environment.packageConfig");return}' +
  '"undefined"!=typeof mraid?mraid.open(o):(console.warn("Mraid is not defined"),window.open(o,"_blank"))},' +
  'window.addEventListener("luna:build",(function(){Bridge.ready((function(){' +
  "Luna.Unity.Playable.InstallFullGame=function(n,i){window.PlayableAdapter.exit(n,i)}}))}))</script>";

// How recent a tap / click / key press must be for a store open to count as
// user-initiated when `blockAutoRedirect` is on.
export const GESTURE_WINDOW_MS = 1000;

// Opt-in for hosts that reject store opens without a user action (InMobi:
// "Auto-redirects to app stores without user action" are prohibited;
// Liftoff: the click may only follow a user interaction). Luna scenes can
// open the store on a timer (_openStoreAfterEndCard, _openStoreAfterSeconds);
// those calls have no input event in front of them and are dropped, while a
// real tap on the CTA / end card goes through.
const GESTURE_GUARD =
  "<script>!function(){var A=window.PlayableAdapter,x=A.exit,t=0;" +
  "function g(){t=Date.now()}" +
  '["pointerdown","pointerup","touchstart","touchend","mousedown","mouseup","click","keydown"].forEach((function(n){window.addEventListener(n,g,!0)}));' +
  `A.exit=function(n,i){if(Date.now()-t>${GESTURE_WINDOW_MS})return void console.warn("[playable] store open without a user action dropped (auto-redirect)");x.call(A,n,i)}` +
  "}()</script>";

/** Target `patch()` shared by every MRAID network. */
export function patchMraid(html, { log, helpers }, { blockAutoRedirect = false } = {}) {
  if (/<script\b[^>]*\bsrc\s*=\s*["'][^"']*mraid\.js["']/i.test(html)) {
    log.info("mraid.js script tag already present");
  } else {
    const m = html.match(/<head\b[^>]*>/i);
    if (m) {
      html = html.slice(0, m.index + m[0].length) + MRAID_SCRIPT_TAG + html.slice(m.index + m[0].length);
    } else {
      html = helpers.injectBefore(html, "</head>", MRAID_SCRIPT_TAG);
    }
    log.step('Declared <script src="mraid.js"> at the top of <head> (host SDK serves it)');
  }
  html = helpers.injectBefore(html, "</body>", LIFECYCLE + CTA + (blockAutoRedirect ? GESTURE_GUARD : ""), { last: true });
  log.step("Wired lifecycle: mraid ready → isViewable/getState → luna:start / pause / resume, audioVolumeChange → mute/unmute");
  log.step("Wired CTA → mraid.open(store url from $environment.packageConfig) via PlayableAdapter.exit()");
  if (blockAutoRedirect) {
    log.step(`Blocked auto-redirects: a store open with no tap / click in the last ${GESTURE_WINDOW_MS} ms is dropped`);
  }
  const links = (html.match(/iosLink:"([^"]*)",androidLink:"([^"]*)"/) || []).slice(1);
  if (links.length) {
    const missing = ["iOS", "Android"].filter((_, i) => !links[i]);
    if (missing.length) log.warn(`Store link missing for ${missing.join(" and ")} in packageConfig — CTA falls back to the other store`);
    else log.info("Store links present for iOS and Android");
  }
  return html;
}

export const MRAID_VALIDATION =
  "MRAID outputs (Aarki, AdColony, Adikteev, Appreciate, BigaBid, InMobi, Liftoff, Remerge, YouAppi, generic MRAID) are standard MRAID creatives — verify them in an MRAID test container such as AppLovin's Playable Preview (p.applov.in/playablePreview) and confirm the CTA opens the store via mraid.open(). Check each network's own size cap in the audit line.";

/**
 * Build a `target` block for an MRAID network.
 * @param {object} o
 * @param {string} o.name          display name (for logs / validation)
 * @param {string} o.platformId    value for $environment.targetPlatform
 * @param {string} o.zipSuffix     <source>_<zipSuffix>.zip
 * @param {"single"|"zip"} [o.shape="single"]  single inline HTML or index.html + resources
 * @param {number} [o.maxMB]       size cap used by the audit
 * @param {string} [o.validation]  extra guidance shown under the result
 * @param {"wrap"} [o.folder]      zip shape only: put everything inside one folder named after the zip
 * @param {boolean} [o.blockAutoRedirect]  drop store opens that no user action led to
 */
export function mraidTarget({ name, platformId, zipSuffix, shape = "single", maxMB, validation, folder, blockAutoRedirect = false }) {
  const single = shape === "single";
  const packaging = { entryName: "index.html", externalizeAssets: !single, externalizeImages: !single };
  if (!single && folder) packaging.folder = folder;
  return {
    supported: true,
    format: single ? "Single index.html" : "index.html + resources",
    platformId,
    zipSuffix,
    packaging,
    validation: validation || MRAID_VALIDATION,
    patch: (html, ctx) => patchMraid(html, ctx, { blockAutoRedirect }),
    audit: createPackageAudit({ label: name, maxBytes: maxMB ? maxMB * MB : undefined, allowWindowOpen: true }),
  };
}
