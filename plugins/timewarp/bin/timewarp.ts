#!/usr/bin/env node

import { main } from "../src/cli.ts";

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`timewarp: ${message}`);
  process.exitCode = 1;
});
