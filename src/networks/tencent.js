// Tencent Ads (优量汇 / GDT Union) playable ads target.
//
// Spec — developers.adnet.qq.com/doc/web/tryable:
//   • .zip ≤ 3 MB with index.html and config.json in the root; file names
//     only letters, digits, ".", "-", "_"
//   • config.json {"name", "version", "config": {"play_direction": 0}} —
//     0 both, 1 portrait, 2 landscape
//   • unsdk.js in <head>, then window._gdtUnSdk = new GDTUnSdk({type:"playable", …})
//   • CTA → window._gdtUnSdk.playAble.onClick()
//   • no mraid.js, no JS redirects, no HTTP(S) requests besides Tencent's own
//     stats, no dynamic external loading, no crossorigin on <script>, no
//     document.write
// Luna: "Zip file with resources", 3 MB.

import { createPackageAudit, MB } from "./shared/audit.js";

const SDK_SCRIPT =
  '<script type="text/javascript" src="https://qzs.gdtimg.com/union/res/union_sdk/page/unjs/unsdk.js"></script>';

const SDK_INIT =
  "<script>try{window._gdtUnSdk=new window.GDTUnSdk({type:\"playable\",onSuccess:function(){}," +
  'onError:function(e){console.warn("[playable] GDTUnSdk init failed",e)}})}' +
  'catch(e){console.warn("[playable] GDTUnSdk is not available (unsdk.js not loaded)")}</script>';

// Responsive: Luna builds adapt to either orientation.
const CONFIG_JSON = JSON.stringify({ name: "playable", version: "0.0.1", config: { play_direction: 0 } });

const LIFECYCLE =
  '<script>window.addEventListener("luna:build",(function(){window.pi&&window.pi.logLoaded(),' +
  'window.dispatchEvent(new Event("luna:start"))}))</script>';

// No window.open fallback — JS redirects are not allowed on Tencent.
const CTA =
  "<script>window.PlayableAdapter.exit=function(){" +
  'window._gdtUnSdk&&window._gdtUnSdk.playAble?window._gdtUnSdk.playAble.onClick():console.warn("[playable] _gdtUnSdk.playAble is not available")},' +
  'window.addEventListener("luna:build",(()=>{Bridge.ready((()=>{' +
  "Luna.Unity.Playable.InstallFullGame=function(){window.PlayableAdapter.exit()}}))}))</script>";

export default {
  id: "tencent",
  name: "Tencent",
  color: "#0052D9",
  platformIds: ["tencent"],

  target: {
    supported: true,
    format: "index.html + config.json + resources",
    platformId: "tencent",
    zipSuffix: "Tencent",
    packaging: { entryName: "index.html", externalizeAssets: true, externalizeImages: true },
    validation:
      "Upload the Tencent zip as a playable (试玩) creative in Tencent Ads / 优量汇 and tap the CTA in its preview — it must reach _gdtUnSdk.playAble.onClick(). The zip must stay under 3 MB.",

    patch(html, { log, helpers, files }) {
      html = helpers.injectBefore(html, "</head>", SDK_SCRIPT + SDK_INIT);
      log.step("Injected unsdk.js into <head> and created window._gdtUnSdk (type: playable)");
      html = helpers.injectBefore(html, "</body>", LIFECYCLE + CTA, { last: true });
      log.step("Wired lifecycle: luna:start on build");
      log.step("Wired CTA → _gdtUnSdk.playAble.onClick() via PlayableAdapter.exit(), no window.open fallback");
      files["config.json"] = CONFIG_JSON;
      log.step(`Added config.json ${CONFIG_JSON} (responsive) next to index.html`);
      return html;
    },

    audit: createPackageAudit({ label: "Tencent", maxBytes: 3 * MB, forbidMraidScript: true, allowScripts: [SDK_SCRIPT] }),
  },
};
