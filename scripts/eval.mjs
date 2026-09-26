// Bundles the TypeScript eval script for Node, then runs it. Usage: see README "Compare models".
import * as esbuild from "esbuild";
import { mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

mkdirSync("node_modules/.cache", { recursive: true });
const outfile = "node_modules/.cache/eval.mjs";
await esbuild.build({
  entryPoints: ["scripts/eval-entry.ts"],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "warning",
});
await import(pathToFileURL(outfile).href);
