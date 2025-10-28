// patch-runner.js
//  - owns the generic helpers used to apply sentinel-based patches
//  - exported by server-patch.js so the actual patch list can stay separate

import fs from "node:fs";
import path from "node:path";

// Ensure the target file exists before attempting to modify it.
function fileExists(file) {
  if (!file) throw new Error("Expected file path to be defined.");
  if (!fs.existsSync(file)) {
    console.log(`Skipping ${file} (not found)`);
    return false;
  }
  return true;
}

// Locate an existing sentinel-wrapped block.
function buildMarkerPattern(marker) {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`// header-auth begin: ${escaped}[\\s\\S]*?// header-auth end: ${escaped}`);
}

// Wrap patch content in begin/end sentinel comments.
function wrapWithMarker({ label, patch }) {
  if (!label) throw new Error("wrapWithMarker requires a label");
  if (!patch) throw new Error(`wrapWithMarker requires patch content for ${label}`);
  return `// header-auth begin: ${label}\n${patch.trim()}\n// header-auth end: ${label}\n`;
}

// Apply each patch operation (replace or append) to the given file.
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
