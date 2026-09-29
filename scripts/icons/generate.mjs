// Renders scripts/icons/icon.svg to the PNG sizes the web manifest and iOS need, using
// the Playwright Chromium already installed for e2e tests. Re-run after editing the SVG:
//   node scripts/icons/generate.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const dir = path.dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(path.join(dir, "icon.svg"), "utf8");
const out = path.resolve(dir, "../../public/icons");
const targets = [
  { file: "icon-192.png", size: 192, padding: 0, bg: "transparent" },
  { file: "icon-512.png", size: 512, padding: 0, bg: "transparent" },
  // Maskable: full-bleed background, artwork inside the central 80% safe zone.
  { file: "icon-maskable-512.png", size: 512, padding: 0.1, bg: "#1d4ed8" },
  { file: "apple-touch-icon.png", size: 180, padding: 0, bg: "#1d4ed8" },
];

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {},
);
const page = await browser.newPage();
for (const t of targets) {
  await page.setViewportSize({ width: t.size, height: t.size });
  const inner = Math.round(t.size * (1 - 2 * t.padding));
  await page.setContent(
    `<html><body style="margin:0;background:${t.bg};display:flex;align-items:center;justify-content:center;width:${t.size}px;height:${t.size}px">
      <div style="width:${inner}px;height:${inner}px">${svg.replace("<svg ", `<svg width="${inner}" height="${inner}" `)}</div></body></html>`,
  );
  await page.screenshot({ path: path.join(out, t.file), omitBackground: t.bg === "transparent" });
  console.log(`wrote public/icons/${t.file}`);
}
await browser.close();
