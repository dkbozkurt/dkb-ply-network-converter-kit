# Playable Ads Converter Kit

Browser-based tool that takes a playable ad exported for one ad network and produces
upload-ready packages for other networks. It rewrites only the ad-network integration
layer (SDK bootstrap, lifecycle, CTA, analytics config) — the game code, scaffold and
assets are never touched.

Runs entirely client-side, so it can be hosted as a static site (GitHub Pages).

## How it works

```
source playable ──▶ 01 Analyze ──▶ 02 Strip source layer ──▶ 03 Neutral adapter ──▶ 04 Target layer ──▶ 05 Package ──▶ zip per target
```

| Stage | What happens |
| --- | --- |
| **01 Analyze** | Detects the source network (from the build's own `$environment.targetPlatform`, falling back to marker regexes) and classifies every inline `<script>` block: network integration, startup asset, or game code. |
| **02 Strip source layer** | Deletes the blocks that belong to the source network's integration (viewability watcher, CTA handler, network analytics). |
| **03 Neutral adapter** | Resets the analytics bootstrap to a network-less call, retargets `$environment.targetPlatform`, optionally externalizes the inline startup assets (`assets/scripts.js`, `jsons.js`, `blobs.js`) and installs the `window.PlayableAdapter` seam that every target wires into. |
| **04 Target layer** | The selected target's definition injects its own SDK, lifecycle and CTA (`PlayableAdapter.exit()` → network exit call). Every inline `<script>` in the result is then parse-checked, so a broken injected block fails the conversion instead of silently dying inside the ad network's container. |
| **05 Package** | Optionally decodes the base-122 inlined images to loose files under `assets/` (or, for Mintegral, moves them still encoded into `assets/images.js`), then zips the entry file + assets. A target can also define an `audit()` over the final package (Meta uses it to flag external references, redirects and size/file-count violations); its verdict shows as a badge on the result card. |

Each loaded playable is converted to **every selected target**, so N sources × M targets
produce N×M packages.

## Supported networks

Networks are described by small definition files in [`src/networks/`](src/networks/) and
registered in [`src/networks/index.js`](src/networks/index.js). The engine itself has no
network names in it — adding a network means adding a file there (see the
[network README](src/networks/README.md) for the shape).

The target picker has two sections: the primary networks first, then **Others**.
A network opts into the first section with `group: "primary"` in its definition.

| Network | Section | As source | As target |
| --- | --- | :-: | :-: |
| AppLovin | primary | ✅ | ✅ single `.html` — an AppLovin source is passed through renamed; other sources get the MRAID + ALPlayableAnalytics layer |
| Unity | primary | ✅ | ✅ single `.html` — a Unity source is passed through renamed; other sources get the MRAID layer |
| Google | primary | – | ✅ `index.html` + resources |
| Meta | primary | – | ✅ `index.html` + resources |
| Liftoff | primary | – | ✅ `<Name>.zip` → `<Name>/index.html` + resources (MRAID) |
| Mintegral | primary | – | ✅ `<Name>.zip` → `<Name>/<Name>.html` + `<Name>/assets/*.js` (5 MB cap) |
| Moloco | others | – | ✅ single `.html`, not zipped |
| Vungle | others | – | ✅ single `ad.html` |
| TikTok | others | – | ✅ `index.html` + `config.json` + resources |
| MRAID (generic) | others | – | ✅ single `index.html` |
| AdColony | others | – | ✅ single `index.html` (2 MB cap) |
| RZR / Aarki | others | – | ✅ single `index.html` |
| Appreciate | others | – | ✅ `index.html` + resources (4 MB cap) |
| Remerge | others | – | ✅ `index.html` + resources |
| Tencent | others | – | ✅ `index.html` + `config.json` + resources (3 MB cap) |
| Adikteev | others | – | ✅ single `index.html` |
| BigaBid | others | – | ✅ single `index.html` |
| InMobi | others | – | ✅ single `index.html` |
| Kayzen | others | – | greyed out (coming soon) |
| Snapchat | others | – | ✅ single `index.html` + `config.json` |
| The Trade Desk | others | – | greyed out (coming soon) |
| YouAppi | others | – | ✅ single `index.html` |

Unsupported targets still appear in the UI (disabled) so the picker is ready for them;
flipping `target.supported` to `true` and adding a `patch()` enables one.

### Target layers

| Target | SDK / CTA | Game end | Lifecycle | Packaging |
| --- | --- | --- | --- | --- |
| **Google** | `exitapi.js` in `<head>`, CTA → `ExitApi.exit()` | – | `luna:start` on build, `ad.orientation` meta | `index.html`, startup scripts + images externalized under `assets/` |
| **Meta** | no SDK script (Meta's container injects `window.FbPlayableAd`), CTA → `FbPlayableAd.onCTAClick()`, no `window.open` fallback | – | `luna:start` on build | `index.html` + externalized resources (43 files, ~2.4 MB) — Luna's single-file limit for Meta is 2 MB, so the zip form is used |
| **Vungle** | Liftoff Monetize Adaptive Creative: CTA → `parent.postMessage("download","*")` | `luna:ended` → `parent.postMessage("complete","*")` | `luna:start` on build; `ad-event-pause` / `ad-event-resume` → luna pause/resume | single self-contained `ad.html` (Luna: "Single HTML or Zip") |
| **Liftoff** | Liftoff Accelerate = MRAID layer, CTA → `mraid.open(store url)`; store opens without a user tap are dropped | – | MRAID watcher | `<Name>.zip` → `<Name>/index.html` + externalized resources (Liftoff: "a zip file containing a single folder of all assets") |
| **Moloco** | no SDK script (Moloco's container injects `window.FbPlayableAd`), CTA → `FbPlayableAd.onCTAClick()`, no `window.open` fallback | – | `luna:start` on build | single inline `.html`, delivered as the file itself — Moloco: "must not be compressed into .zip format" |
| **TikTok** | `playable-sdk.js` at the start of `<body>`, before the game's scripts; CTA → `window.openAppStore()` | – | `luna:start` on build | `index.html` + `config.json` `{"playable_orientation":0}` + externalized resources |
| **Tencent** | `unsdk.js` in `<head>` + `window._gdtUnSdk = new GDTUnSdk({type:"playable"})`; CTA → `_gdtUnSdk.playAble.onClick()` | – | `luna:start` on build | `index.html` + `config.json` `{"name","version","config":{"play_direction":0}}` + externalized resources, ≤ 3 MB |
| **MRAID family** — generic MRAID, AdColony, Aarki, Adikteev, BigaBid, InMobi, YouAppi (InMobi also drops store opens without a user tap) | `<script src="mraid.js">` at the top of `<head>` (served by the host SDK), CTA → `mraid.open(store url)` with the iOS / Android link from `$environment.packageConfig`, `window.open` fallback for browser previews | – | Luna's own MRAID watcher: wait for `ready`, then `isViewable()` + `getState()` → `luna:start` / `pause` / `resume`; `audioVolumeChange` → mute / unmute | single inline `index.html` (Luna: "Single HTML file"); size cap per network in the audit |
| **MRAID family** — Appreciate, Remerge | same as above | – | same as above | `index.html` + externalized resources (Luna: "Zip file with resources") |
| **Snapchat** | no SDK script (Snap's container injects `window.ScPlayableAd`), CTA → `ScPlayableAd.onCTAClick()`, no `window.open` fallback | – | `luna:start` on build | flat zip: single inline `index.html` + `config.json` `{"orientation":1}` |
| **Mintegral** | no SDK script (Mindworks injects the API), CTA → `window.install()`, no self-redirect fallback | `luna:ended` → `window.gameEnd()`; `install()` suppressed for 2.5 s after it | `window.gameReady()` on build → `luna:start` when the host calls `window.gameStart()` (3 s fallback); `window.gameClose()` → pause | "Zip with resources": `<Name>.zip` → `<Name>/<Name>.html` + `<Name>/assets/scripts.js`, `jsons.js`, `blobs.js`, `images.js`; name limited to `[A-Za-z0-9_]` |
| **AppLovin** | MRAID layer + Luna's `ALPlayableAnalytics` stream (`LOADING` / `LOADED` / `DISPLAYED` / `COMPLETED`, `CTA_CLICKED` before `mraid.open`) | – | MRAID watcher | single `.html`, delivered as the file itself (no zip) |
| **Unity** | MRAID layer (`platformId: unityads`) | – | MRAID watcher | single `.html`, delivered as the file itself (no zip) |

"Liftoff" names two products with different specs. Luna's **Liftoff** build (and this
kit's Liftoff target) is **Liftoff Accelerate**, the former Liftoff DSP
([docs.liftoff.io/creative_integration_api](https://docs.liftoff.io/creative_integration_api)):
a plain MRAID creative uploaded as "a zip file containing a single folder of all
assets", CTA via `mraid.open()`, start on `ready` once viewable, and the click may only
follow a user interaction. **Liftoff Monetize / Direct** (the former Vungle) is the
**Vungle** target and uses the Adaptive Creative postMessage layer,
[`src/networks/shared/adaptiveCreative.js`](src/networks/shared/adaptiveCreative.js).
Because Liftoff Monetize requires that `download` and `complete` never fire together,
that adapter drops any `download` that arrives within 2.5 s after `complete` — that
swallows Luna's automatic "open store after end card" follow-up while a real tap on the
CTA later still goes through.

Liftoff Accelerate and InMobi both reject store opens that no user action led to, and
Luna scenes can open the store on a timer (`_openStoreAfterEndCard`,
`_openStoreAfterSeconds` in `playgroundOverrides`). Their MRAID layer is built with
`mraidTarget({ …, blockAutoRedirect: true })`, which drops a store open when there was no
tap, click or key press in the previous second.

Moloco's own [playable guide](https://help.moloco.com/hc/en-us/articles/24124525963799-Playable-and-Interactive-End-Card-IEC-creative-guide)
asks for one self-contained, un-zipped HTML without `mraid.js`, with the CTA on
`FbPlayableAd.onCTAClick()`. Luna's Moloco build is instead a < 3 KB `.txt` ad tag pointing
at Luna's CDN, which needs hosting the kit doesn't have — so the kit produces the HTML
form, uploaded as an *HTML (Playable)* creative.

Meta's [playable spec](https://www.facebook.com/business/help/412951382532338) is the
strictest of the set: no `mraid.js`, **no external network calls of any kind**
(`XMLHttpRequest`, dynamic asset loading), no JavaScript redirects, portrait +
responsive, ≤ 5 MB and ≤ 100 files per zip. Luna's analytics module (`window.pi`) only
calls `fetch()` when a collector URL is configured, and the neutral stage clears that
config, so converted output makes zero requests — the Meta `audit()` verifies this on
every conversion. Note that Meta's *Instant Games* docs (`FBInstant` SDK,
`fbapp-config.json`, 200 MB bundles) describe a different product and do not apply to
playable ads.

The MRAID family shares one layer, [`src/networks/shared/mraid.js`](src/networks/shared/mraid.js),
which reproduces the two MRAID blocks Luna ships in its own AppLovin / Unity exports (the
same blocks the strip stage removes from a source build), plus the `mraid.js` declaration
that MRAID 3.0 hosts now require. A network joins the family with one line —
`mraidTarget({ name, platformId, zipSuffix, shape, maxMB })` — choosing the single-file or
zip shape and its size cap. Luna's overview table
([docs.lunalabs.io/docs/playable/ad-networks/overview](https://docs.lunalabs.io/docs/playable/ad-networks/overview))
is the source for each network's shape and cap. One deviation from Luna's CTA: when the
store link for the current platform is empty, the adapter falls back to the other store
instead of calling `mraid.open("")`, and the log warns which link is missing.

Snapchat is *not* MRAID despite Luna listing it as "single HTML": Snap's spec mirrors
Meta's (no `mraid.js`, no external requests, no JS redirects, portrait) with its own
`ScPlayableAd.onCTAClick()` CTA and a mandatory `config.json` beside `index.html`.

Mintegral's [Mindworks guideline](https://www.playturbo.com/review/doc) is unusual in
three ways. The host drives the start: the creative reports `gameReady()` once loaded and
must wait for the container to call its global `gameStart()` (Mindworks shows its own
loading page until then), so the layer maps `gameStart()` → `luna:start` and falls back
to starting on its own after 3 s when no host is present. And Mintegral *blocks
auto-redirects*: Luna scenes open the store ~1.5 s after the end card, which would be
exactly that, so any `install()` inside 2.5 s after `gameEnd()` is dropped — a real tap
on the end card CTA after that goes through. The zip layout is also enforced by their
uploader: zip, folder and html must share one name made only of letters, digits and
underscores ("Html file should be in a folder and the folder should be compressed into a
zip file"), so the packager sanitises the source name and lays the files out as
`<Name>/<Name>.html` + `<Name>/assets/`. Resources may be separate files, but "all
files besides JS and HTML should be processed into base64" and the html "needs to be
openable locally" — so the startup scripts, jsons and blobs go to their own
`assets/*.js`, and the images stay base-122 encoded inside `assets/images.js` (a
synchronous script that re-inserts the `<img>` tags right before Luna's decoder runs)
rather than becoming loose `.png` files, which a browser would also refuse to use as
WebGL textures when the html is opened from disk.

AppLovin and Unity are the two source formats, so they double as targets in two modes.
Loading an AppLovin build and ticking AppLovin (or Unity → Unity) **passes the file
through untouched** — it is only renamed `<source>_AppLovin.html` / `<source>_Unity.html`
and delivered as the html itself, since both networks take a single file. Any *other*
source (Unity → AppLovin today; Google → AppLovin once Google becomes a source) runs the
full pipeline and gets the network's real layer: Unity is plain MRAID, AppLovin is MRAID
plus the `ALPlayableAnalytics` event block Luna ships in its own AppLovin export. A
target opts into the pass-through with `passthrough: true`; the engine only takes that
shortcut when the detected source *is* that network.

The neutral stage also drops Luna's inert dev-tooling blocks (console.re remote logging,
the spector.js WebGL inspector, the `?startup` timing probe) from every conversion —
they never run in production but reference external hosts, which Mintegral, Meta and
Snapchat all scan for.

TikTok ([TikTok Ad Network playable spec](https://ads.tiktok.com/resources/help/article/how-to-create-tiktok-pangle-playable-ads?lang=en))
and Tencent ([优量汇 playable spec](https://developers.adnet.qq.com/doc/web/tryable)) each
load their own SDK from their CDN — the only external script the audit allows for them —
and read orientation from a `config.json` next to `index.html` (`0` = responsive, which is
what Luna builds are; change it in `tiktok.js` / `tencent.js` for a fixed-orientation
creative).

Still greyed out: Kayzen and The Trade Desk. Both take hosted MRAID ad tags (Kayzen's
`index.html` is capped at 10 KB and loads its assets from a CDN; The Trade Desk takes
third-party MRAID tags) rather than an uploaded package. For a self-contained build,
the generic **MRAID** target is the closest fit.

## Using it

1. **Source playables** — drop one or more exported `.html` entry points. The chip next to
   each file shows which source network was detected.
2. **Target networks** — tick the networks you want (none is preselected). Disabled cards are not available yet.
3. **Convert** — the pipeline runs per source × target; the result card lists every step,
   the output file layout and sizes.
4. **Download** — one job hands back `<source>_<Target>.zip` directly (or `<source>_<Target>.html`
   for the single-file AppLovin / Unity / Moloco targets); more than one gives `Converted_Playables.zip`
   containing `<TargetName>/<source>_<Target>.zip|.html` files plus `conversion-log.txt`.

Validate before launch: Google output in the Google Playable Ad Testing Tool, Vungle
output with Liftoff's Creative Verifier, Liftoff output through Liftoff Creative Lab's
automatic QA scan (it must detect the click), Moloco output in Moloco Cloud's preview
(tapping the CTA shows an "action is working" confirmation), and Meta output in the
[Meta Playable Preview tool](https://developers.facebook.com/tools/playable-preview/)
(requires a Facebook login) — drop the `<source>_Meta.zip` in, confirm every spec item
on the right turns green, play through, and check that the tool reports the app-store
click when you tap the CTA / end card. MRAID outputs can all be checked in one place —
AppLovin's Playable Preview ([p.applov.in/playablePreview](https://p.applov.in/playablePreview?create=1&qr=1))
is a plain MRAID container — Snapchat output in Snap Ads Manager's playable preview, and
Mintegral output in the [Mindworks Playable Test Tool](https://www.playturbo.com/review)
(no login): drop the `<Name>_Mintegral.zip` in, play to the end and tap the CTA on the
end card; *HTML requirements*, *Game Ready*, *Game End* and *CTA Call method* must all
turn green. The tool's server injects the `install` / `gameEnd` API, so only a real upload
exercises it — the kit's own check is a local container harness that replays the same
contract (`gameReady` → host `gameStart` → play → `gameEnd` → suppressed auto-open → tap →
`install`). When several targets are selected the result card lists one note per distinct
test tool.

## Debug / process logs

Every run writes a plain-text process log listing, per `source → target` job, each step
that ran with timestamps and any warnings or errors.

- **`npm run dev`** — the dev server writes it to **`temp/logs/<timestamp>_<name>.txt`**
  in the project root automatically (see [`temp/README.md`](temp/README.md)). The result
  card shows the path.
- **Hosted / static build** — there is no server to write to; use **Download log (.txt)**
  or open `conversion-log.txt` inside the bundle.

`temp/` is git-ignored.

## Development

```bash
npm install
npm run dev       # http://localhost:5173  (logs → temp/logs/)
npm run build     # static site in dist/
npm run preview   # serve dist/ locally
```

Stack: [Vite](https://vitejs.dev) + vanilla ES modules + [Sass](https://sass-lang.com)
(`src/styles/`, one partial per UI region) + [JSZip](https://stuk.github.io/jszip/).
No framework, no runtime dependencies beyond JSZip.

```
index.html                 shell markup
src/main.js                UI controller (sources, target picker, pipeline, report)
src/core/converter.js      generic engine: detect → strip → neutral → target → package
src/core/logger.js         process log (UI lines + .txt)
src/core/packager.js       zip naming / nesting / bundle
src/core/images.js         base-122 image extraction + <img> rewrite
src/core/html.js           script scanning, edits, injection helpers
src/networks/*.js          one definition per network + registry
src/ui/logos.js            inline SVG logos per network
src/styles/*.scss          tokens, base, header, pipeline, card, drop, networks, buttons, report
test-playable-builds/      sample AppLovin / Unity exports + a reference Google export
vite.config.js             GitHub Pages base path + dev log sink
```

The `src/core` and `src/networks` modules have no DOM or bundler dependencies, so they can
be imported straight into node for scripted checks.

## Deploying to GitHub Pages

The workflow in [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml)
builds on every push to `main` and publishes `dist/` with the official Pages actions.

One-time setup in the repository: **Settings → Pages → Build and deployment → Source:
GitHub Actions**. If the source is left on *Deploy from a branch*, GitHub publishes the
raw repository root instead — the unbuilt `index.html` then points at `/src/main.js` and
the page renders without styles.

The production base path is taken from the repository name in CI (`/<repo-name>/`), so
renaming the repo needs no config change; `REPO_BASE` in `vite.config.js` is only the
fallback for a local `npm run build`. For a custom domain or a user/organisation site set
`BASE_PATH=/` when building.

Live site: <https://dkbozkurt.github.io/dkb-ply-network-converter-kit/>

## Notes

- Network logos in `src/assets/logos/` are simplified representative glyphs; drop in
  official brand assets with the same file names to replace them.
- Google output keeps images as loose files under `assets/assets/bundles/`, matching the
  layout of a native Google export; the extracted bytes are identical to the reference
  export in `test-playable-builds/`.
