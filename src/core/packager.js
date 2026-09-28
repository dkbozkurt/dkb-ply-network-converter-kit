// Packaging: turns conversion results into downloadable zips.
//
//  - one source × one target  → <source>_<TargetSuffix>.zip (or .html for
//                                raw single-file targets) handed back directly
//  - anything else            → Converted_Playables.zip containing
//                                 <TargetName>/<source>_<TargetSuffix>.zip|.html …
//                                 conversion-log.txt
// Inner zips are DEFLATE-compressed; the parent stores them as-is.

import JSZip from "jszip";

export const BUNDLE_NAME = "Converted_Playables.zip";
export const LOG_FILE_NAME = "conversion-log.txt";

/**
 * Output file name for one job: "<original>_<Suffix>.zip", or
 * "<original>_<Suffix>.html" for targets packaged `raw` (single-file networks
 * such as AppLovin / Unity that take the html itself).
 * Targets with `packaging.safeName` (Mintegral) get the base name reduced to
 * letters, digits and underscores, which their validators require.
 */
export function outputNameFor(sourceName, target) {
  const packaging = target.target.packaging || {};
  let base = sourceName.replace(/\.html?$/i, "");
  if (packaging.safeName) {
    base = base.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "playable";
  }
  return base + "_" + target.target.zipSuffix + (packaging.raw ? ".html" : ".zip");
}

/** @deprecated use outputNameFor */
export const zipNameFor = outputNameFor;

/**
 * Package one conversion result into a downloadable Blob: the html itself
 * for `raw` targets, otherwise a DEFLATE zip of entry html + files.
 */
export async function packageResult(result) {
  const packaging = (result.target && result.target.target.packaging) || {};
  if (packaging.raw) {
    if (Object.keys(result.files).length) {
      throw new Error(`${result.target.name} is packaged as a single html but the result has loose files`);
    }
    return new Blob([result.html], { type: "text/html" });
  }
  return zipResult(result);
}

/**
 * Apply the target's zip layout to a conversion result, given the final zip
 * name. `packaging.folder` wraps everything in one folder named after the zip:
 *   "named" (Mintegral) — the entry html is renamed to match the folder
 *                         Foo_Mintegral.zip → Foo_Mintegral/Foo_Mintegral.html
 *   "wrap"  (Liftoff)   — the entry html keeps its name
 *                         Foo_Liftoff.zip → Foo_Liftoff/index.html
 * Returns a new result; the original is left untouched.
 */
export function layoutResult(result, zipName) {
  const packaging = (result.target && result.target.target.packaging) || {};
  if (!packaging.folder) return result;
  const base = zipName.replace(/\.zip$/i, "");
  const files = {};
  for (const [path, content] of Object.entries(result.files)) files[`${base}/${path}`] = content;
  const entry = packaging.folder === "named" ? `${base}.html` : result.entryName || "index.html";
  return { ...result, entryName: `${base}/${entry}`, files };
}

/** Zip a single conversion result (entry html + files). */
export async function zipResult(result) {
  const zip = new JSZip();
  zip.file(result.entryName || "index.html", result.html);
  for (const [path, content] of Object.entries(result.files)) zip.file(path, content);
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

/** Folder name for a target inside the bundle: the display name made path-safe ("RZR / Aarki" → "RZR-Aarki"). */
export function folderNameFor(target) {
  return target.name.replace(/\s*[\\/]+\s*/g, "-").trim();
}

/** Ensure no two jobs collapse to the same file name inside the same folder. */
export function uniqueName(name, used) {
  let candidate = name;
  let i = 2;
  while (used.has(candidate)) candidate = name.replace(/(\.[a-z0-9]+)$/i, `_${i++}$1`);
  used.add(candidate);
  return candidate;
}

/**
 * Build the final download.
 * @param {Array<{ fileName, blob, target }>} jobs
 * @param {string} logText  contents of the debug log to bundle
 */
export async function bundle(jobs, logText) {
  if (jobs.length === 1) {
    return { blob: jobs[0].blob, name: jobs[0].fileName, nested: false };
  }
  const parent = new JSZip();
  // Folder per target — display names may contain "/" (e.g. "RZR / Aarki").
  for (const job of jobs) parent.file(`${folderNameFor(job.target)}/${job.fileName}`, job.blob);
  if (logText) parent.file(LOG_FILE_NAME, logText);
  const blob = await parent.generateAsync({ type: "blob", compression: "STORE" });
  return { blob, name: BUNDLE_NAME, nested: true };
}
