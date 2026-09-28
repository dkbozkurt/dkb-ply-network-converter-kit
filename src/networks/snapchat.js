// Snapchat App Playables target.
//
// Spec — businesshelp.snapchat.com/s/article/app-playables and the Ads API
// "Playable Resources" notes:
//   • zip ≤ 5 MB with index.html AND config.json at the first directory
//     level — no wrapping folder, and the Ads API says no directory structure
//     at all, so everything is inlined into index.html (2 files total)
//   • config.json carries the orientation, 1 = portrait only (key name unstated)
//   • portrait, must not require mraid.js, no JS redirects, no external http
//     requests, no dynamic asset loading
//   • CTA → ScPlayableAd.onCTAClick()  (Snap's container injects the object)
//
// Structurally this is Meta's spec with a different CTA global, so the same
// audit applies (mraid.js and window.open() are both flagged).

import { createPackageAudit, MB } from "./shared/audit.js";

// Snap's article names only "the orientation field", in wording copied from
// TikTok's spec, whose key is playable_orientation — both keys are written.
const CONFIG_JSON = JSON.stringify({ orientation: 1, playable_orientation: 1 });

const LIFECYCLE =
  '<script>window.addEventListener("luna:build",(function(){window.pi&&window.pi.logLoaded(),' +
  'window.dispatchEvent(new Event("luna:start"))}))</script>';

// No window.open fallback — JS redirects are not allowed on Snapchat.
const CTA =
  "<script>window.PlayableAdapter.exit=function(){" +
  'window.ScPlayableAd&&"function"==typeof window.ScPlayableAd.onCTAClick?' +
  'window.ScPlayableAd.onCTAClick():console.warn("[playable] ScPlayableAd.onCTAClick is not available")},' +
  'window.addEventListener("luna:build",(()=>{Bridge.ready((()=>{' +
  "Luna.Unity.Playable.InstallFullGame=function(){window.PlayableAdapter.exit()}}))}))</script>";

export default {
  id: "snapchat",
  name: "Snapchat",
  color: "#FFFC00",
  platformIds: ["snapchat", "snap"],

  target: {
    supported: true,
    format: "index.html + config.json",
    platformId: "snapchat",
    zipSuffix: "Snapchat",
    packaging: { entryName: "index.html", externalizeAssets: false, externalizeImages: false },
    validation:
      "Upload the Snapchat zip as the Playable Asset of an App Promotion ad in Snap Ads Manager (it must stay under 5 MB) and confirm the CTA registers in Snap's preview.",

    patch(html, { log, helpers, files }) {
      html = helpers.injectBefore(html, "</body>", LIFECYCLE + CTA, { last: true });
      log.step("Wired lifecycle: luna:start on build (no SDK script — Snap injects ScPlayableAd)");
      log.step("Wired CTA → ScPlayableAd.onCTAClick() via PlayableAdapter.exit(), no window.open fallback");
      files["config.json"] = CONFIG_JSON;
      log.step(`Added config.json ${CONFIG_JSON} (portrait only) next to index.html`);
      return html;
    },

    audit: createPackageAudit({ label: "Snapchat", maxBytes: 5 * MB, forbidMraidScript: true }),
  },
};
