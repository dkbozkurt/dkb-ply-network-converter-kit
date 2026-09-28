// Liftoff Monetize (Vungle) "Adaptive Creative" integration layer, used by
// the Vungle target. The host loads the playable as a child `ad.html` inside
// a parent index.html and talks to it via postMessage. (The Liftoff target is
// Liftoff Accelerate, which is plain MRAID — see liftoff.js.)
// Spec (support.vungle.com → Develop Adaptive Creative):
//
//   CTA         parent.postMessage("download", "*")
//   Game ended  parent.postMessage("complete", "*")   — never together with download
//   Lifecycle   window events: ad-event-init, ad-event-pause, ad-event-resume
//   Helper      window.VungleHelper { closeDelay, rewardedAd } after ad-event-init
//
// There is no SDK script to load and no viewability API, so the playable
// starts on luna:build and pauses/resumes on the ad-event-* signals.

// Luna scenes often auto-open the store shortly after the end card
// (_openStoreAfterEndCard). That would fire "download" right after
// "complete", which Liftoff explicitly asks creatives to avoid. Any
// download attempt inside this window after complete is treated as that
// automatic follow-up and dropped; a real tap later still goes through.
export const COMPLETE_DOWNLOAD_GUARD_MS = 2500;

const LIFECYCLE =
  "<script>" +
  'window.addEventListener("DOMContentLoaded",(()=>{window.devicePixelRatio=2})),' +
  'window.addEventListener("luna:build",(function(){window.pi&&window.pi.logLoaded(),' +
  'window.dispatchEvent(new Event("luna:start"))})),' +
  'window.addEventListener("ad-event-pause",(()=>{window.dispatchEvent(new Event("luna:unsafe:pause"))})),' +
  'window.addEventListener("ad-event-resume",(()=>{window.dispatchEvent(new Event("luna:unsafe:resume"))}))' +
  "</script>";

const CTA_AND_COMPLETE =
  "<script>" +
  "(function(){var A=window.PlayableAdapter,c=0;" +
  'function post(m){try{window.parent&&window.parent!==window&&window.parent.postMessage(m,"*")}catch(e){}}' +
  `A.complete=function(){c=Date.now(),post("complete")},` +
  `A.exit=function(){if(c&&Date.now()-c<${COMPLETE_DOWNLOAD_GUARD_MS})return;post("download")},` +
  'window.addEventListener("luna:ended",(function(){A.complete()})),' +
  'window.addEventListener("luna:build",(function(){Bridge.ready((function(){' +
  "Luna.Unity.Playable.InstallFullGame=function(){A.exit()}}))}))" +
  "})()" +
  "</script>";

/** Target `patch()` for Adaptive Creative hosts. */
export function patchAdaptiveCreative(html, { log, helpers }) {
  html = helpers.injectBefore(html, "</body>", LIFECYCLE + CTA_AND_COMPLETE, { last: true });
  log.step("Wired lifecycle: luna:start on build, ad-event-pause/resume → luna pause/resume");
  log.step('Wired CTA → parent.postMessage("download") via PlayableAdapter.exit()');
  log.step(
    `Wired game end (luna:ended) → parent.postMessage("complete"); download suppressed for ${COMPLETE_DOWNLOAD_GUARD_MS} ms after complete`
  );
  return html;
}

export const ADAPTIVE_CREATIVE_VALIDATION =
  "Test Vungle output with Liftoff's Creative Verifier before launch; the entry file is ad.html (the Verifier itself asks for index.html — rename it there if it complains).";
