import { spawn } from "node:child_process";
import { platform } from "node:os";

export type ClipboardResult =
  | {
      copied: true;
      command: string;
    }
  | {
      copied: false;
      warning: string;
    };

export async function copyToClipboard(text: string): Promise<ClipboardResult> {
  const commands = clipboardCommands();
  if (commands.length === 0) {
    return {
      copied: false,
      warning: `Clipboard copy is not supported on platform ${platform()}.`
    };
  }

  const failures: string[] = [];
  for (const command of commands) {
    const result = await tryClipboardCommand(command, text);
    if (result.copied) {
      return result;
    }
    failures.push(result.warning);
  }

  return {
    copied: false,
    warning: `Clipboard copy failed: ${failures.join("; ")}`
  };
}

function clipboardCommands(): string[] {
  switch (platform()) {
    case "darwin":
      return ["pbcopy"];
    case "linux":
      return ["wl-copy", "xclip -selection clipboard", "xsel --clipboard --input"];
    case "win32":
      return ["clip"];
    default:
      return [];
  }
}

function tryClipboardCommand(command: string, text: string): Promise<ClipboardResult> {
  return new Promise((resolve) => {
    const [name, ...args] = command.split(" ");
    const child = spawn(name, args, {
      stdio: ["pipe", "ignore", "pipe"],
      windowsHide: true
    });
    const stderr: Buffer[] = [];

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
    });
    child.on("error", (error) => {
      resolve({
        copied: false,
        warning: `${command}: ${error.message}`
      });
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({
          copied: true,
          command
        });
        return;
      }

      const message = Buffer.concat(stderr).toString("utf8").trim();
      resolve({
        copied: false,
        warning: `${command}: exited ${code}${message ? `: ${message}` : ""}`
      });
    });

    child.stdin.end(text);
  });
}
