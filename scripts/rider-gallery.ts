/**
 * scripts/rider-gallery.ts
 * ────────────────────────
 * Render every rider variant/pose via /drop-in/rider-gallery (dev server must
 * be running) and write the PNGs plus contact sheets to --out.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = process.argv[process.argv.indexOf("--out") + 1] ?? "/tmp/rider-gallery";
const base = process.argv.includes("--base") ? process.argv[process.argv.indexOf("--base") + 1] : "http://localhost:3000";
mkdirSync(out, { recursive: true });

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto(`${base}/drop-in/rider-gallery`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => (window as unknown as { __riderGallery?: { done: boolean } }).__riderGallery?.done === true, null, { timeout: 600_000 });
  const tiles = await page.evaluate(() => (window as unknown as { __riderGallery: { tiles: { group: string; label: string; dataUrl: string }[] } }).__riderGallery.tiles);
  const counts = new Map<string, number>();
  const index: string[] = [];
  for (const tile of tiles) {
    const slug = `${tile.group}--${tile.label}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const n = (counts.get(slug) ?? 0) + 1; counts.set(slug, n);
    const file = `${slug}-${n}.png`;
    writeFileSync(path.join(out, file), Buffer.from(tile.dataUrl.split(",")[1], "base64"));
    index.push(`${file}\t${tile.group}\t${tile.label}`);
  }
  writeFileSync(path.join(out, "index.tsv"), index.join("\n"));
  // Contact sheets per group.
  const groups = [...new Set(tiles.map((t) => t.group))];
  for (const group of groups) {
    const sheet = await page.evaluate(async ({ group }) => {
      const g = (window as unknown as { __riderGallery: { tiles: { group: string; label: string; dataUrl: string }[] } }).__riderGallery.tiles.filter((t) => t.group === group);
      const cols = Math.min(6, g.length), size = 300, pad = 8, cap = 30;
      const rows = Math.ceil(g.length / cols);
      const canvas = document.createElement("canvas");
      canvas.width = cols * (size + pad) + pad; canvas.height = rows * (size + cap + pad) + pad + 40;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#06080b"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#e8edf2"; ctx.font = "bold 18px ui-monospace, monospace"; ctx.fillText(`DROP IN RIDER · ${group.toUpperCase()}`, pad, 28);
      for (let i = 0; i < g.length; i++) {
        const img = new Image(); img.src = g[i].dataUrl; await img.decode();
        const x = pad + (i % cols) * (size + pad), y = 40 + pad + Math.floor(i / cols) * (size + cap + pad);
        ctx.drawImage(img, x, y, size, size);
        ctx.fillStyle = "#7f8b99"; ctx.font = "11px ui-monospace, monospace"; ctx.fillText(g[i].label.slice(0, 44), x, y + size + 18);
      }
      return canvas.toDataURL("image/png");
    }, { group });
    writeFileSync(path.join(out, `sheet-${group.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`), Buffer.from(sheet.split(",")[1], "base64"));
  }
  console.log(`${tiles.length} tiles, ${groups.length} sheets → ${out}`);
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
