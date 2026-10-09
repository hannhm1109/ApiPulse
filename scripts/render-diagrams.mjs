import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const directory = new URL("../docs/diagrams/", import.meta.url);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  await page.setContent('<html lang="en"><body style="margin:0;background:white"><div id="diagram" style="width:1200px;padding:32px;box-sizing:border-box"></div></body></html>');
  await page.addScriptTag({ type: "module", content: 'import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@12.1.0/dist/mermaid.esm.min.mjs"; window.diagramRenderer = mermaid;' });
  await page.waitForFunction(() => window.diagramRenderer);
  await page.evaluate(() => window.diagramRenderer.initialize({
    startOnLoad: false, securityLevel: "strict", theme: "base", look: "classic",
    themeVariables: { fontFamily: "Arial, sans-serif", fontSize: "16px", primaryColor: "#f5f6f8", primaryTextColor: "#24252a", primaryBorderColor: "#a4a8b3", lineColor: "#697079", clusterBkg: "#fafafd", clusterBorder: "#d5d7df", edgeLabelBackground: "#ffffff" },
    flowchart: { curve: "linear", padding: 16, nodeSpacing: 30, rankSpacing: 38, wrappingWidth: 320 },
  }));
  const architecture = await readFile(new URL("../docs/architecture.md", import.meta.url), "utf8");
  const embedded = [...architecture.matchAll(/```mermaid\r?\n([\s\S]*?)\r?\n```/g)];
  if (embedded.length !== 2) throw new Error("Expected the embedded data-model and incident diagrams.");
  for (const [, code] of embedded) await page.evaluate(code => window.diagramRenderer.parse(code), code);
  console.info("Validated embedded data-model and incident diagrams");
  for (const name of ["architecture", "monitoring-lifecycle"]) {
    const code = await readFile(new URL(`${name}.mmd`, directory), "utf8");
    const svg = await page.evaluate(async ({ code, name }) => {
      const { svg } = await window.diagramRenderer.render(`diagram-${name}`, code);
      document.getElementById("diagram").innerHTML = svg;
      const element = document.querySelector("#diagram > svg");
      document.getElementById("diagram").style.width = `${Math.min(1200, Math.ceil(element.viewBox.baseVal.width) + 64)}px`;
      element.style.maxWidth = "none";
      element.style.width = "100%";
      return svg;
    }, { code, name });
    await writeFile(new URL(`${name}.svg`, directory), svg);
    await page.locator("#diagram").screenshot({ path: fileURLToPath(new URL(`${name}.png`, directory)) });
    console.info(`Rendered ${name}`);
  }
} finally {
  await browser.close();
}
