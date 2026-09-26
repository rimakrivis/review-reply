// Bundles each TypeScript entry into a classic script and copies static files into dist/.
import * as esbuild from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

const watch = process.argv.includes("--watch");
const outdir = "dist";

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });
cpSync("public", outdir, { recursive: true });

const options = {
  entryPoints: {
    background: "src/background.ts",
    content: "src/content/content.ts",
    sidepanel: "src/sidepanel/sidepanel.ts",
    options: "src/options/options.ts",
    demo: "src/demo/demo.ts",
  },
  outdir,
  bundle: true,
  format: "iife", // content scripts and the service worker run as classic scripts
  target: "chrome114",
  sourcemap: watch ? "inline" : false,
  logLevel: "info",
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("Watching for changes. Reload the extension in chrome://extensions after edits.");
} else {
  await esbuild.build(options);
}
