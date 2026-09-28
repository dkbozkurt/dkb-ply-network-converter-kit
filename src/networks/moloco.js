// Moloco target.
//
// Spec — help.moloco.com → "Playable and Interactive End Card (IEC) creative
// guide": one HTML5 file (.html), < 5 MB, every asset data-URI inlined, and
// "must not be compressed into .zip format"; must not include mraid.js,
// XMLHttpRequest, external requests or JavaScript redirects. CTA →
// FbPlayableAd.onCTAClick() with no arguments (Moloco's container injects
// the object, the preview shows a confirmation pop-up when it fires).
//
// Luna's own Moloco build is different: a < 3 KB .txt ad tag pointing at
// Luna's CDN, uploaded through "Upload playable ad tags". That needs hosting
// the kit doesn't have, so this produces the self-contained html Moloco's
// guide describes, uploaded as an HTML (Playable) creative file.

import { createPackageAudit, MB } from "./shared/audit.js";

const LIFECYCLE =
  '<script>window.addEventListener("luna:build",(function(){window.pi&&window.pi.logLoaded(),' +
  'window.dispatchEvent(new Event("luna:start"))}))</script>';

// No window.open fallback — JS redirects are not allowed on Moloco.
const CTA =
  "<script>window.PlayableAdapter.exit=function(){" +
  'window.FbPlayableAd&&"function"==typeof window.FbPlayableAd.onCTAClick?' +
  'window.FbPlayableAd.onCTAClick():console.warn("[playable] FbPlayableAd.onCTAClick is not available")},' +
  'window.addEventListener("luna:build",(()=>{Bridge.ready((()=>{' +
  "Luna.Unity.Playable.InstallFullGame=function(){window.PlayableAdapter.exit()}}))}))</script>";

export default {
  id: "moloco",
  name: "Moloco",
  color: "#5B5BD6",
  platformIds: ["moloco"],

  target: {
    supported: true,
    format: "Single .html",
    platformId: "moloco",
    zipSuffix: "Moloco",
    packaging: { entryName: "index.html", externalizeAssets: false, externalizeImages: false, raw: true },
    validation:
      "Moloco output is a single html (not zipped). Upload it as an HTML (Playable) creative in Moloco Cloud and tap the CTA in the preview — Moloco shows an \"action is working\" confirmation when FbPlayableAd.onCTAClick() fires.",

    patch(html, { log, helpers }) {
      html = helpers.injectBefore(html, "</body>", LIFECYCLE + CTA, { last: true });
      log.step("Wired lifecycle: luna:start on build (no SDK script — Moloco injects FbPlayableAd)");
      log.step("Wired CTA → FbPlayableAd.onCTAClick() via PlayableAdapter.exit(), no window.open fallback");
      return html;
    },

    audit: createPackageAudit({ label: "Moloco", maxBytes: 5 * MB, forbidMraidScript: true }),
  },
};
