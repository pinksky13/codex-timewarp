#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const MARKETPLACE_SSH = "git@github.com:pinksky13/codex-timewarp.git";
const MARKETPLACE_SHORTHAND = "pinksky13/codex-timewarp";
const MARKETPLACE_NAME = "codex-timewarp";
const PLUGIN_SELECTOR = `timewarp@${MARKETPLACE_NAME}`;

const argv = process.argv.slice(2);
const command = argv[0] ?? "help";

switch (command) {
  case "install":
    await install(argv.slice(1));
    break;
  case "print-install":
    printInstallCommands(argv.slice(1));
    break;
  case "help":
  case "--help":
  case "-h":
    printHelp();
    break;
  case "version":
  case "--version":
  case "-v":
    console.log(packageVersion());
    break;
  default:
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exitCode = 1;
}

async function install(args) {
  const useHttps = args.includes("--https");
  const source = useHttps ? MARKETPLACE_SHORTHAND : MARKETPLACE_SSH;
  const commands = [
    ["codex", ["plugin", "marketplace", "add", source, "--ref", "main"]],
    ["codex", ["plugin", "add", PLUGIN_SELECTOR]]
  ];

  for (const [bin, binArgs] of commands) {
    await run(bin, binArgs);
  }

  console.log("");
  console.log("Codex Timewarp installed. Restart Codex so plugin skills and hooks are reloaded.");
}

function printInstallCommands(args) {
  const useHttps = args.includes("--https");
  const source = useHttps ? MARKETPLACE_SHORTHAND : MARKETPLACE_SSH;
  console.log(`codex plugin marketplace add ${source} --ref main`);
  console.log(`codex plugin add ${PLUGIN_SELECTOR}`);
}

function run(bin, args) {
  return new Promise((resolve, reject) => {
    console.log(`$ ${bin} ${args.join(" ")}`);
    const child = spawn(bin, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${bin} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

function printHelp() {
  console.log(`Codex Timewarp

Usage:
  codex-timewarp install [--https]
  codex-timewarp print-install [--https]
  codex-timewarp version

Commands:
  install        Register the GitHub marketplace with Codex and install the timewarp plugin.
  print-install  Print the Codex plugin commands without running them.
  version        Print the npm package version.

Options:
  --https        Use the GitHub owner/repo shorthand instead of the SSH URL.
`);
}

function packageVersion() {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  return packageJson.version;
}
