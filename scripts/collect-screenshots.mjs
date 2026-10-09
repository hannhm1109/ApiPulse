import { access, copyFile, mkdir, readFile, readdir } from "node:fs/promises";

const results = new URL("../test-results/", import.meta.url);
const destination = new URL("../docs/images/", import.meta.url);
const run = JSON.parse(await readFile(new URL(".last-run.json", results), "utf8"));
if (run.status !== "passed") throw new Error("Run the full browser suite successfully before collecting screenshots.");

const directories = (await readdir(results, { withFileTypes: true })).filter(entry => entry.isDirectory());
const captures = [
  { project: "desktop", source: "dashboard.png", target: "dashboard.png" },
  { project: "desktop", source: "detail-overview.png", target: "endpoint-detail.png" },
  { project: "mobile", source: "detail-latency.png", target: "mobile-latency.png" },
];
const resolved = [];
for (const capture of captures) {
  const matches = [];
  for (const directory of directories.filter(entry => entry.name.endsWith(`-${capture.project}`))) {
    const source = new URL(`${directory.name}/${capture.source}`, results);
    try { await access(source); matches.push(source); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  if (matches.length !== 1) throw new Error(`Expected one ${capture.project} ${capture.source}; found ${matches.length}.`);
  resolved.push({ source: matches[0], target: new URL(capture.target, destination) });
}
await mkdir(destination, { recursive: true });
for (const capture of resolved) await copyFile(capture.source, capture.target);
console.info("Collected three labelled local-fixture screenshots.");
