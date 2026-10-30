import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
await mkdir("dist/ui", { recursive: true });
await build({
  entryPoints: ["src/main.ts", "src/preload.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outdir: "dist",
  outExtension: { ".js": ".cjs" },
  external: ["electron", "original-fs"],
  target: "node22",
});
await build({
  entryPoints: ["src/ui/app.ts"],
  bundle: true,
  platform: "browser",
  outfile: "dist/ui/app.js",
  target: "chrome130",
});
await copyFile("src/ui/index.html", "dist/ui/index.html");
await copyFile("src/ui/style.css", "dist/ui/style.css");
