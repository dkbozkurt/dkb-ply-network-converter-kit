// TikTok (TikTok Ad Network / Pangle) playable ads target.
//
// Spec — ads.tiktok.com/resources/help/article/how-to-create-tiktok-pangle-playable-ads:
//   • .zip, < 5 MB after compression (Luna: 3 MB); index.html and config.json
//     in the first-level directory
//   • config.json { "playable_orientation": 0 } — 0 either, 1 portrait, 2 landscape
//   • playable-sdk.js "at the bottom of body and before the developer's own
//     JS" — the game's scripts start right after <body>, so it goes first there
//   • CTA → window.openAppStore()
//   • no mraid.js, no JS redirects, no HTTP requests, no dynamic external loading
// Luna: "Zip file with resources", so startup scripts and images are externalized.

import { createPackageAudit, MB } from "./shared/audit.js";

const SDK_SCRIPT =
  '<script src="https://sf16-muse-va.ibytedtos.com/obj/union-fe-nc-i18n/playable/sdk/playable-sdk.js"></script>';

// Responsive: Luna builds adapt to either orientation.
const CONFIG_JSON = JSON.stringify({ playable_orientation: 0 });

const LIFECYCLE =
  '<script>window.addEventListener("luna:build",(function(){window.pi&&window.pi.logLoaded(),' +
  'window.dispatchEvent(new Event("luna:start"))}))</script>';

// No window.open fallback — JS redirects are not allowed on TikTok.
const CTA =
  "<script>window.PlayableAdapter.exit=function(){" +
  '"function"==typeof window.openAppStore?window.openAppStore():console.warn("[playable] window.openAppStore is not available (playable-sdk.js not loaded)")},' +
  'window.addEventListener("luna:build",(()=>{Bridge.ready((()=>{' +
  "Luna.Unity.Playable.InstallFullGame=function(){window.PlayableAdapter.exit()}}))}))</script>";

export default {
  id: "tiktok",
  name: "TikTok",
  color: "#FE2C55",
  platformIds: ["tiktok", "pangle"],

  target: {
    supported: true,
    format: "index.html + config.json + resources",
    platformId: "tiktok",
    zipSuffix: "TikTok",
    packaging: { entryName: "index.html", externalizeAssets: true, externalizeImages: true },
    validation:
      "Upload the TikTok zip as a playable in TikTok Ads Manager (TikTok Ad Network / Pangle placement) and tap the CTA in its preview — it must reach window.openAppStore(). Luna's own cap is 3 MB, TikTok's is 5 MB compressed.",

    patch(html, { log, helpers, files }) {
      const m = html.match(/<body\b[^>]*>/i);
      if (!m) throw new Error("No <body> found in entry point");
      const at = m.index + m[0].length;
      html = html.slice(0, at) + SDK_SCRIPT + html.slice(at);
      log.step("Injected playable-sdk.js at the start of <body>, before the game's scripts");
      html = helpers.injectBefore(html, "</body>", LIFECYCLE + CTA, { last: true });
      log.step("Wired lifecycle: luna:start on build");
      log.step("Wired CTA → window.openAppStore() via PlayableAdapter.exit(), no window.open fallback");
      files["config.json"] = CONFIG_JSON;
      log.step(`Added config.json ${CONFIG_JSON} (responsive) next to index.html`);
      return html;
    },

    audit: createPackageAudit({ label: "TikTok", maxBytes: 5 * MB, forbidMraidScript: true, allowScripts: [SDK_SCRIPT] }),
  },
};
