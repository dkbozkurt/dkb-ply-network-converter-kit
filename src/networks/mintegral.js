// Mintegral (Mindworks) integration layer.
//
// Spec: playturbo.com/review/doc (Mindworks "Playable Testing" guideline)
//
//   Host → playable   window.gameStart()   host calls it when the ad begins
//                     window.gameClose()   host calls it when the ad is closed
//   Playable → host   window.gameReady()   all resources loaded
//                     window.gameEnd()     game won / lost
//                     window.install()     CTA — the ONLY allowed way to the store
//                     window.gameRetry()   optional, on replay
//
//   Package           "Zip with resources": <Name>.zip → <Name>/<Name>.html plus
//                     the playable's resources as separate files in that folder
//                     (the guideline's own example ships libs/, resource/, *.js
//                     next to the html). Zip, folder and html share one name
//                     made of [A-Za-z0-9_]; zip < 5 MB; the html must open
//                     locally; "All files besides JS and HTML should be
//                     processed into base64" — so the startup scripts, jsons,
//                     blobs and the (still base-122 encoded) images each go to
//                     their own assets/*.js rather than to loose .png/.mp3
//                     files. No dynamic requests, no console override, no
//                     auto-redirect.

import { createPackageAudit, MB } from "./shared/audit.js";

// Mintegral blocks creatives that redirect without a user action. Luna
// scenes commonly auto-open the store ~1.5 s after the end card
// (_openStoreAfterEndCard); any install() inside this window after gameEnd
// is treated as that automatic follow-up and dropped.
export const END_INSTALL_GUARD_MS = 2500;

// If the host never calls gameStart() (plain browser preview, older
// containers) the game still starts after this grace period.
const START_FALLBACK_MS = 3000;

const LAYER =
  "<script>" +
  "(function(){var A=window.PlayableAdapter,started=!1,ended=0,inHost=!1;" +
  'function start(){started||(started=!0,window.dispatchEvent(new Event("luna:start")))}' +
  'window.gameStart=function(){started?window.dispatchEvent(new Event("luna:resume")):start()},' +
  'window.gameClose=function(){window.dispatchEvent(new Event("luna:pause"))},' +
  "A.complete=function(){ended||(ended=Date.now(),window.gameEnd&&window.gameEnd())}," +
  `A.exit=function(){if(ended&&Date.now()-ended<${END_INSTALL_GUARD_MS})return;` +
  'window.install?window.install():console.warn("[playable] window.install is not available (not inside a Mintegral container)")},' +
  'window.addEventListener("luna:ended",(function(){A.complete()})),' +
  'window.addEventListener("luna:build",(function(){window.pi&&window.pi.logLoaded(),' +
  'inHost="function"==typeof window.gameReady,inHost&&window.gameReady(),' +
  `setTimeout(start,inHost?${START_FALLBACK_MS}:0),` +
  "Bridge.ready((function(){Luna.Unity.Playable.InstallFullGame=function(){A.exit()}}))}))" +
  "})()" +
  "</script>";

export default {
  id: "mintegral",
  name: "Mintegral",
  color: "#12B5A5",
  platformIds: ["mintegral"],
  group: "primary",

  target: {
    supported: true,
    format: "<Name>/<Name>.html + resources",
    platformId: "mintegral",
    zipSuffix: "Mintegral",
    packaging: {
      entryName: "index.html", // replaced by layoutResult → <Name>/<Name>.html
      externalizeAssets: true, // assets/scripts.js, jsons.js, blobs.js
      externalizeImages: "script", // assets/images.js — encoded, not loose files
      safeName: true,
      folder: "named",
    },
    validation:
      "Drop the Mintegral zip into the Mindworks Playable Test Tool (playturbo.com/review) and play to the end: gameReady, install and gameEnd must all turn green.",

    patch(html, { log, helpers }) {
      html = helpers.injectBefore(html, "</body>", LAYER, { last: true });
      log.step("Wired lifecycle: gameReady() on build → luna:start when the host calls gameStart() (fallback after 3 s), gameClose() → pause");
      log.step("Wired CTA → window.install() via PlayableAdapter.exit(); no self-redirect fallback");
      log.step(`Wired game end (luna:ended) → window.gameEnd(); install suppressed for ${END_INSTALL_GUARD_MS} ms after it (Mintegral blocks auto-redirects)`);
      if (!/<meta\s[^>]*charset\s*=\s*["']?utf-8/i.test(html)) log.warn("No <meta charset=utf-8> found — Mintegral requires it");
      return html;
    },

    audit: createPackageAudit({
      label: "Mintegral",
      maxBytes: 5 * MB,
      forbidMraidScript: true,
      forbidConsoleOverride: true,
    }),
  },
};
