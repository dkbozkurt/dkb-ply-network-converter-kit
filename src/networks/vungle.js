// Vungle (Liftoff Monetize / Direct) target.
// Uses the Adaptive Creative postMessage layer. Luna's network table lists
// Vungle as "Single HTML or Zip with resources, 5 MB", so the output is one
// self-contained ad.html with everything inlined, delivered inside the zip.
import { patchAdaptiveCreative, ADAPTIVE_CREATIVE_VALIDATION } from "./shared/adaptiveCreative.js";

export default {
  id: "vungle",
  name: "Vungle",
  color: "#26C281",
  platformIds: ["vungle"],

  target: {
    supported: true,
    format: "Single ad.html",
    platformId: "vungle",
    zipSuffix: "Vungle",
    packaging: { entryName: "ad.html", externalizeAssets: false, externalizeImages: false },
    validation: ADAPTIVE_CREATIVE_VALIDATION,
    patch: patchAdaptiveCreative,
  },
};
