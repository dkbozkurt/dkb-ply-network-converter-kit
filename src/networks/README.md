# Network definitions

Every ad network the kit knows about lives in its own file here and is
registered in `index.js`. The core engine (`src/core/converter.js`) never
references a network by name — it only reads these definitions. Adding a
network is a matter of adding a file and a registry entry.

```js
export default {
  id: "example",          // stable id, used in logs / zip folder names
  name: "Example",        // display name
  color: "#RRGGBB",       // brand accent used for chips and cards
  platformIds: ["example"], // values of $environment.targetPlatform this network emits
  group: "primary",       // optional — first picker section; omit for "Others"

  // Optional — the kit can *read* playables exported for this network.
  source: {
    supported: true,
    markers: [/regex that only appears in this network's build/],
    strip:   [/regex identifying inline <script> blocks to delete/],
  },

  // Optional — the kit can *write* playables for this network.
  target: {
    supported: true,        // false => shown greyed out in the UI
    hint: "Coming soon",    // shown on the card when not supported
    format: "ad.html + resources", // shown on the card when supported
    platformId: "example",  // value written to $environment.targetPlatform
    zipSuffix: "Example",   // <source>_Example.zip (or .html when packaging.raw)
    validation: "Test in …", // shown under the result
    passthrough: false,     // true => a source that *is* this network is returned
                            //         untouched (renamed only); other sources convert
    packaging: {
      entryName: "index.html",  // name of the entry html inside the zip
      externalizeAssets: true,  // move inline scripts/jsons/blobs to assets/*.js
      externalizeImages: true,  // true => decode data-src122 images to assets/<id>;
                                // "script" => keep them encoded in assets/images.js (Mintegral)
      raw: false,               // true => deliver the html itself, no zip (AppLovin, Unity, Moloco)
      safeName: false,          // true => output name limited to [A-Za-z0-9_] (Mintegral)
      folder: undefined,        // "named" => <Name>.zip holds <Name>/<Name>.html + files (Mintegral)
                                // "wrap"  => <Name>.zip holds <Name>/index.html + files (Liftoff)
    },
    patch(html, ctx) { /* inject SDK, CTA, lifecycle — return new html */ },
    audit(pkg) { /* optional: check the final package, return false to flag warnings */ },
  },
};
```

Logos live in `src/assets/logos/<id>.svg` and are picked up automatically by file name.

`ctx` passed to `patch` is `{ source, log, helpers, files }` where `helpers` exposes
`injectBefore`, `readTargetPlatform` and the `PLAYABLE_ADAPTER_GLOBAL` name, and
`files` is the package's loose-file map — add to it to ship sidecar files next to
the entry html (Snapchat puts its `config.json` there).

### Shared layers

- `shared/mraid.js` — `mraidTarget({ name, platformId, zipSuffix, shape, maxMB, validation, folder, blockAutoRedirect })`
  returns a complete `target` block for any MRAID host (Luna's own MRAID watcher + CTA,
  `mraid.js` declaration, size audit). `shape` is `"single"` (inline `index.html`) or
  `"zip"` (`index.html` + externalized resources); `folder: "wrap"` puts the zip's
  content inside one folder; `blockAutoRedirect` drops store opens without a recent
  user tap. See `aarki.js` (one-liner), `appreciate.js` (zip shape) and `liftoff.js`
  (wrapped zip, no auto-redirects).
- `shared/adaptiveCreative.js` — Liftoff Monetize (Vungle) postMessage layer.
- `shared/audit.js` — `createPackageAudit({ label, maxBytes, maxFiles, forbidMraidScript, allowWindowOpen, forbidConsoleOverride, allowScripts })`
  for networks that don't use `mraidTarget` but still need the external-reference / size
  checks (Meta, Snapchat, Mintegral, Moloco, TikTok, Tencent). `allowScripts` lists the
  exact SDK `<script src>` tags a network requires, which are then not flagged.

### Packaging shapes

`packageResult` / `layoutResult` in `src/core/packager.js` read the `packaging` flags:
the default is a DEFLATE zip of `entryName` + `files`; `raw` returns the html as the
download itself; `folder` moves everything into one folder named after the final
(possibly `safeName`-sanitised) output name — `"named"` also renames the html to
`<Name>.html`. `mintegral.js` uses `safeName` + `folder: "named"` + `externalizeImages: "script"`,
`liftoff.js` uses `folder: "wrap"`, `applovin.js` / `unity.js` use `raw` + `passthrough`,
`moloco.js` uses `raw`.

The engine also strips Luna's inert dev-tooling blocks (remote debugging, spector.js,
startup probe) before any target layer runs — see `DEV_TOOLING_RULES` in
`src/core/converter.js` if a future export ships another one.
Every target should route its CTA through `window.PlayableAdapter.exit()` so
the neutral adapter layer stays the single seam between game and network.

After `patch` runs, the engine parse-checks every inline `<script>` in the
result and fails the conversion if one does not compile — keep injected
snippets small and test them with `node -e 'new Function(\`…\`)'` if in doubt.

`audit(pkg)` is optional and runs last, over the finished package:
`pkg` is `{ html, files, entryName, log }`. Log findings with `log.warn` /
`log.info` and return `false` when something needs the user's attention — the
result card then shows an "audit warnings" badge instead of "audit passed".
See `meta.js` for an example (external references, redirects, size limits).
