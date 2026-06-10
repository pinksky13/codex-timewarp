#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getCodexHome } from "../src/paths.ts";
import { readStdinJson } from "../src/stdin.ts";

try {
  const payload = await readStdinJson();
  const codexHome = getCodexHome();
  const stateDir = join(codexHome, "timewarp", "hooks");

  await mkdir(stateDir, { recursive: true });
  await writeFile(
    join(stateDir, "last-hook.json"),
    JSON.stringify(
      {
        captured_at: new Date().toISOString(),
        payload
      },
      null,
      2
    )
  );

  console.log("timewarp hook captured latest Codex hook payload");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`timewarp hook warning: could not record diagnostic hook payload: ${message}`);
}
