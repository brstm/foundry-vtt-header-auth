#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SENTINEL = (process.env.PATCH_NAME || "").trim().replace(/[^A-Za-z0-9_-]/g, "-") || "patch";

function fileExists(file) {
  if (!file) throw new Error("Expected file path to be defined.");
  if (!fs.existsSync(file)) {
    console.log(`Skipping ${file} (not found)`);
    return false;
  }
  return true;
}

function buildMarkerPattern(marker) {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prefix = SENTINEL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`// ${prefix} begin: ${escaped}[\\s\\S]*?// ${prefix} end: ${escaped}`);
}

function wrapWithMarker({ label, patch }) {
  if (!label) throw new Error("wrapWithMarker requires a label");
  if (!patch) throw new Error(`wrapWithMarker requires patch content for ${label}`);
  return `// ${SENTINEL} begin: ${label}\n${patch.trim()}\n// ${SENTINEL} end: ${label}\n`;
}

export function patchSource({ file, operations }) {
  if (!fileExists(file)) return;

  let source = fs.readFileSync(file, "utf8");
  let changed = false;

  for (const op of operations) {
    const { label, remove, patch } = op;
    if (!label) throw new Error("Operations require a label");
    if (!patch) throw new Error(`Operation '${label}' must provide patch content`);

    const block = wrapWithMarker({ label, patch });
    const markerPattern = buildMarkerPattern(label);

    if (remove && source.includes(remove)) {
      source = source.replace(remove, block);
      changed = true;
      console.log(`[ok] ${path.basename(file)}: ${label} inserted`);
      continue;
    }

    if (markerPattern.test(source)) {
      const next = source.replace(markerPattern, block);
      if (next === source) {
        console.log(`[skip] ${path.basename(file)}: ${label} already up-to-date`);
      } else {
        source = next;
        changed = true;
        console.log(`[ok] ${path.basename(file)}: ${label} updated`);
      }
      continue;
    }

    if (remove) {
      throw new Error(`[fail] ${path.basename(file)}: cannot locate anchor for ${label}`);
    }

    source = `${source.trimEnd()}\n${block}`;
    changed = true;
    console.log(`[ok] ${path.basename(file)}: ${label} appended`);
  }

  if (changed) {
    fs.writeFileSync(file, source);
  } else {
    console.log(`[noop] ${path.basename(file)}: no changes needed`);
  }
}

export async function runPatchModule({ modulePath, context = {} }) {
  const absoluteModulePath = path.resolve(modulePath);
  const moduleUrl = pathToFileURL(absoluteModulePath).href;

  const mod = await import(moduleUrl);
  const runner = mod.default ?? mod.apply ?? mod.run ?? mod.patch;

  if (typeof runner !== "function") {
    throw new Error(`Patch module '${modulePath}' does not export a runnable function`);
  }

  await runner({ patchSource, context: { modulePath: absoluteModulePath, ...context } });
}

async function main(cliArgs) {
  const [moduleArg] = cliArgs;
  if (!moduleArg) {
    throw new Error("Usage: node exec.js <patch-module>");
  }

  const modulePath = path.resolve(process.cwd(), moduleArg);
  await runPatchModule({ modulePath, context: { workspace: process.cwd() } });
}

const isMainModule = fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
