// Liftoff (Liftoff Accelerate, the former Liftoff DSP) target.
//
// Spec — docs.liftoff.io/creative_integration_api (linked from the creative
// guidelines): Liftoff hosts the creative itself and expects "a zip file
// containing a single folder of all assets", with one html at the root of
// that folder (index.html when there are several) and assets loaded by
// relative URL. The creative is MRAID: start on `ready` once viewable, CTA
// via mraid.open() (window.open accepted, window.location not), and only
// after a user interaction. No iframes, no end-of-game event. Luna: "Zip file
// with resources", 5 MB.
//
// Not to be confused with Liftoff Monetize / Direct (the former Vungle),
// whose Adaptive Creative postMessage layer is the Vungle target.

import { mraidTarget } from "./shared/mraid.js";

export default {
  id: "liftoff",
  name: "Liftoff",
  color: "#FF6A3D",
  platformIds: ["liftoff"],
  group: "primary",

  target: {
    ...mraidTarget({
      name: "Liftoff",
      platformId: "liftoff",
      zipSuffix: "Liftoff",
      shape: "zip",
      folder: "wrap",
      maxMB: 5,
      blockAutoRedirect: true,
      validation:
        "Liftoff output is an MRAID zip (<Name>/index.html + assets/). Upload it in Liftoff Creative Lab — its automatic QA scan must detect the click — or check it first in an MRAID container such as AppLovin's Playable Preview and confirm the CTA opens the store via mraid.open().",
    }),
    format: "<Name>/index.html + resources",
  },
};
