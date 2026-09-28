// UI controller. Everything network-specific comes from the registry; this
// file only knows about "sources", "targets" and the pipeline stages.
import "./styles/main.scss";

import { SOURCE_NETWORKS, TARGET_GROUPS, SUPPORTED_TARGETS } from "./networks/index.js";
import { detectSource, convertPlayable } from "./core/converter.js";
import { createProcessLog } from "./core/logger.js";
import { packageResult, layoutResult, outputNameFor, uniqueName, bundle, LOG_FILE_NAME } from "./core/packager.js";
import { byteLength } from "./core/html.js";
import { logoFor } from "./ui/logos.js";
import { persistLog, DEV_LOG_ENABLED } from "./ui/devLogSink.js";

const $ = (id) => document.getElementById(id);
const drop = $("drop");
const dropBody = $("dropBody");
const fileInput = $("file");
const convertBtn = $("convert");
const resetBtn = $("reset");
const downloadBtn = $("download");
const downloadLogBtn = $("downloadLog");
const report = $("report");
const reportBody = $("reportBody");
const errEl = $("err");
const logStatus = $("logStatus");
const validationNote = $("validationNote");
const networksEl = $("networks");
const stages = [...document.querySelectorAll(".stage")];

// ---- state ------------------------------------------------------------------
let sources = []; // [{ name, text, size, source: networkDef|null, platform }]
let jobs = []; // [{ name, fileName, result, blob, log: scope, target }]
let download = null; // { blob, name }
let processLog = null;

// ---- helpers ----------------------------------------------------------------
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const kb = (bytes) => (bytes / 1024).toFixed(1) + " KB";

function chip(network, extraClass = "") {
  if (!network) return `<span class="chip chip--unknown ${extraClass}">unknown source</span>`;
  return (
    `<span class="chip ${extraClass}" style="--chip:${network.color}">` +
    logoFor(network.id) +
    esc(network.name) +
    "</span>"
  );
}

function showError(msg) {
  errEl.textContent = msg;
  errEl.classList.add("is-show");
}
function clearError() {
  errEl.classList.remove("is-show");
  errEl.textContent = "";
}

function triggerDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- step 1: sources --------------------------------------------------------
function renderSourceChips() {
  $("sourceChips").innerHTML = SOURCE_NETWORKS.map((n) => chip(n)).join("");
}

function renderDrop() {
  if (!sources.length) {
    drop.classList.remove("has-files");
    dropBody.innerHTML =
      '<div class="drop__big">Drop playable HTML files here</div>' +
      '<div class="drop__small">or click to browse — one or more exported index.html / playable.html</div>';
  } else {
    drop.classList.add("has-files");
    const list = sources
      .map(
        (s) =>
          '<div class="file">' +
          chip(s.source) +
          `<span class="file__name">${esc(s.name)}</span>` +
          `<span class="file__meta">· ${kb(s.size)}</span>` +
          "</div>"
      )
      .join("");
    dropBody.innerHTML =
      `<div class="filechip">${sources.length}</div>` +
      `<div><div class="fname">${sources.length} playable${sources.length > 1 ? "s" : ""} loaded</div>` +
      `<div class="filelist">${list}</div></div>`;
  }
  syncActions();
}

function addFiles(fileList) {
  clearError();
  const files = [...fileList];
  let pending = files.length;
  let rejected = 0;
  if (!pending) return;

  const done = () => {
    if (--pending) return;
    if (rejected) showError(`${rejected} file(s) skipped — only .html/.htm entry points are accepted.`);
    const unknown = sources.filter((s) => !s.source).length;
    if (unknown) {
      showError(
        `${unknown} playable(s) did not match a supported source network — they will be converted with the target layer only.`
      );
    }
    renderDrop();
  };

  files.forEach((file) => {
    if (!/\.html?$/i.test(file.name)) {
      rejected++;
      done();
      return;
    }
    if (sources.some((s) => s.name === file.name)) {
      done(); // de-dupe by name
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result;
      const detected = detectSource(text);
      sources.push({ name: file.name, text, size: file.size, source: detected.network, platform: detected.platform });
      done();
    };
    reader.onerror = () => {
      rejected++;
      done();
    };
    reader.readAsText(file);
  });
}

drop.addEventListener("click", () => fileInput.click());
drop.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});
fileInput.addEventListener("change", (e) => {
  if (e.target.files.length) addFiles(e.target.files);
  fileInput.value = "";
});
["dragenter", "dragover"].forEach((t) =>
  drop.addEventListener(t, (e) => {
    e.preventDefault();
    drop.classList.add("is-over");
  })
);
["dragleave", "drop"].forEach((t) =>
  drop.addEventListener(t, (e) => {
    e.preventDefault();
    drop.classList.remove("is-over");
  })
);
drop.addEventListener("drop", (e) => {
  if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
});

// ---- step 2: targets --------------------------------------------------------
function renderNetworkCard(n) {
  const ok = n.target.supported;
  const hint = ok ? n.target.format || "Ready" : n.target.hint || "Not available";
  return (
    `<label class="network ${ok ? "is-available" : "is-disabled"}" style="--net:${n.color}" ` +
    `data-id="${n.id}" title="${esc(n.name)} — ${esc(hint)}">` +
    `<input type="checkbox" name="target" value="${n.id}" ${ok ? "" : "disabled"}>` +
    `<span class="network__logo">${logoFor(n.id)}</span>` +
    `<span class="network__body"><span class="network__name">${esc(n.name)}</span>` +
    `<span class="network__hint">${esc(hint)}</span></span>` +
    `<span class="network__check" aria-hidden="true"></span>` +
    "</label>"
  );
}

function renderNetworks() {
  networksEl.innerHTML = TARGET_GROUPS.map((g) => {
    const title = g.title
      ? `<h3 class="networks__title" id="networks-${g.id}">${esc(g.title)}</h3>`
      : "";
    return (
      `<section class="networks__group" data-group="${g.id}"${g.title ? ` aria-labelledby="networks-${g.id}"` : ""}>` +
      title +
      `<div class="networks__grid">${g.networks.map(renderNetworkCard).join("")}</div>` +
      "</section>"
    );
  }).join("");
  networksEl.addEventListener("change", syncActions);
}

function selectedTargets() {
  const ids = [...networksEl.querySelectorAll("input:checked:not(:disabled)")].map((i) => i.value);
  return SUPPORTED_TARGETS.filter((n) => ids.includes(n.id));
}

function syncActions() {
  const targets = selectedTargets();
  const ready = sources.length > 0 && targets.length > 0;
  convertBtn.disabled = !ready;
  resetBtn.disabled = sources.length === 0 && jobs.length === 0;
  if (!targets.length) convertBtn.textContent = "Select a target network";
  else if (targets.length === 1) convertBtn.textContent = `Convert to ${targets[0].name}`;
  else convertBtn.textContent = `Convert to ${targets.length} networks`;
}

// ---- pipeline animation -----------------------------------------------------
function lightStage(i) {
  return new Promise((res) =>
    setTimeout(() => {
      if (stages[i]) stages[i].classList.add("is-run");
      res();
    }, 220)
  );
}
async function runPipelineAnimation() {
  for (const s of stages) s.classList.remove("is-run");
  for (let i = 0; i < stages.length; i++) await lightStage(i);
}

// ---- convert ----------------------------------------------------------------
convertBtn.addEventListener("click", async () => {
  clearError();
  convertBtn.disabled = true;
  report.classList.remove("is-show");

  const targets = selectedTargets();
  processLog = createProcessLog("Playable Ads Converter Kit — process log", {
    sources: sources.map((s) => s.name).join(", "),
    targets: targets.map((t) => t.name).join(", "),
    mode: DEV_LOG_ENABLED ? "dev" : "static",
    agent: navigator.userAgent,
  });

  try {
    const animation = runPipelineAnimation();
    jobs = [];
    const used = new Map(); // per-target used zip names

    for (const src of sources) {
      for (const target of targets) {
        const scope = processLog.scope(`${src.name} → ${target.name}`);
        try {
          const raw = convertPlayable(src.text, { target, log: scope });
          if (!used.has(target.id)) used.set(target.id, new Set());
          const fileName = uniqueName(outputNameFor(src.name, target), used.get(target.id));
          const result = layoutResult(raw, fileName);
          if (result !== raw) scope.step(`Laid out as ${result.entryName} (everything inside one folder named after the zip)`);
          const blob = await packageResult(result);
          scope.step(`${/\.zip$/i.test(fileName) ? "Zipped" : "Saved"} → ${fileName} (${kb(blob.size)})`);
          jobs.push({ name: src.name, fileName, result, blob, log: scope, target });
        } catch (e) {
          scope.error(`Conversion failed: ${e.message}`);
          throw e;
        }
      }
    }

    processLog.step(`${jobs.length} package(s) built from ${sources.length} source(s) × ${targets.length} target(s)`);
    download = await bundle(jobs, processLog.toText());
    processLog.step(`Download ready: ${download.name}${download.nested ? ` (includes ${LOG_FILE_NAME})` : ""}`);

    await animation;
    renderReport(targets);
    await shipLog();
  } catch (e) {
    if (processLog) processLog.error(e.message);
    showError("Conversion failed: " + e.message);
    console.error(e);
    convertBtn.disabled = false;
    await shipLog();
  }
});

async function shipLog() {
  if (!processLog) return;
  const res = await persistLog(logFileName(), processLog.toText());
  if (res === null) {
    logStatus.innerHTML =
      `Static build — no server to write to. Use <code>Download log</code>` +
      (download && download.nested ? ` or find <code>${LOG_FILE_NAME}</code> inside the bundle.` : ".");
  } else if (res.ok) {
    logStatus.innerHTML = `Process log written to <code>${esc(res.file.replace(/^.*?(temp\/)/, "$1"))}</code>`;
  } else {
    logStatus.innerHTML = `Could not write process log to temp/: <code>${esc(res.error || "unknown error")}</code>`;
  }
}

function logFileName() {
  const first = sources[0] ? sources[0].name.replace(/\.html?$/i, "") : "conversion";
  const more = sources.length > 1 ? `_and_${sources.length - 1}_more` : "";
  return `${first}${more}_process-log.txt`;
}

// ---- step 3: report ---------------------------------------------------------
function renderJob(job) {
  const { result } = job;
  const isRaw = /\.html?$/i.test(job.fileName); // single-file target: the html *is* the download
  const rows = [[isRaw ? job.fileName : result.entryName || "index.html", byteLength(result.html)]];
  const bundled = [];
  for (const [p, c] of Object.entries(result.files)) {
    if (/(?:^|\/)assets\/assets\/bundles\//.test(p)) bundled.push([p, byteLength(c)]);
    else rows.push([p, byteLength(c)]);
  }
  if (bundled.length) {
    rows.push([`assets/assets/bundles/ — ${bundled.length} files`, bundled.reduce((a, [, n]) => a + n, 0)]);
  }
  const fileCount = 1 + Object.keys(result.files).length;

  const logHtml = job.log.entries
    .map((e) => {
      const cls = e.level === "step" ? "" : ` class="is-${e.level}${/^— .* —$/.test(e.message) ? " is-section" : ""}"`;
      return `<li${cls}>${esc(e.message)}</li>`;
    })
    .join("");

  return (
    '<div class="result">' +
    '<div class="result__line">' +
    chip(result.source) +
    `<span class="name">${esc(job.name)}</span>` +
    '<span class="arrow">▶</span>' +
    chip(job.target) +
    (result.passthrough
      ? '<span class="audit audit--ok">passed through</span>'
      : result.auditPassed === null || result.auditPassed === undefined
        ? ""
        : `<span class="audit ${result.auditPassed ? "audit--ok" : "audit--warn"}">${
            result.auditPassed ? "audit passed" : "audit warnings"
          }</span>`) +
    "</div>" +
    `<ul class="log">${logHtml}</ul>` +
    '<div class="files">' +
    rows.map(([p, n]) => `<div class="frow"><span class="p">${esc(p)}</span><span>${kb(n)}</span></div>`).join("") +
    `<div class="frow frow--total"><span>${esc(job.fileName)} (${fileCount} file${fileCount === 1 ? "" : "s"})</span><span>${kb(job.blob.size)}</span></div>` +
    "</div>" +
    "</div>"
  );
}

function renderReport(targets) {
  reportBody.innerHTML = jobs.map(renderJob).join("");
  downloadBtn.textContent = `Download ${download.name}`;
  const notes = [...new Set(targets.map((t) => t.target.validation).filter(Boolean))];
  validationNote.innerHTML =
    notes.length === 1
      ? esc(notes[0])
      : `Before launch, validate each package in its network's test tool:<ul>${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`;
  validationNote.style.display = notes.length ? "" : "none";
  report.classList.add("is-show");
  report.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

downloadBtn.addEventListener("click", () => {
  if (download) triggerDownload(download.blob, download.name);
});
downloadLogBtn.addEventListener("click", () => {
  if (!processLog) return;
  triggerDownload(new Blob([processLog.toText()], { type: "text/plain" }), logFileName());
});
resetBtn.addEventListener("click", () => location.reload());

// ---- boot -------------------------------------------------------------------
renderSourceChips();
renderNetworks();
renderDrop();
