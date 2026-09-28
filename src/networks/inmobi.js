// InMobi — MRAID 3.0 host. Luna: single HTML, 5 MB.
//
// Spec — support.inmobi.com → InMobi DSP → Creative Specifications and
// Guidelines: a single index.html with every asset inlined (or a zip with
// index.html + subfolders), `<script src="mraid.js">` in <head>, wait for
// viewableChange before starting, CTA via mraid.open(url). Prohibited:
// external network requests, dynamic asset loading and "auto-redirects to app
// stores without user action" — Luna's timed store opens are dropped.

import { mraidTarget } from "./shared/mraid.js";

export default {
  id: "inmobi",
  name: "InMobi",
  color: "#D9232E",
  platformIds: ["inmobi"],

  target: mraidTarget({
    name: "InMobi",
    platformId: "inmobi",
    zipSuffix: "InMobi",
    shape: "single",
    maxMB: 5,
    blockAutoRedirect: true,
  }),
};
