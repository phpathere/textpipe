import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const extensionPath = resolve(
  root,
  "release",
  `textpipe-${packageJson.version}-cross-device-unpacked`,
);
const playwrightCli = resolve(root, "node_modules", "@playwright", "test", "cli.js");

const child = spawn(process.execPath, [playwrightCli, "test"], {
  cwd: root,
  env: {
    ...process.env,
    EXPECTED_EXTENSION_ID: "khdimndigbjmblggkgjpbhkokechiedd",
    EXTENSION_PATH: extensionPath,
  },
  stdio: "inherit",
});

const exitCode = await new Promise((resolveExit, reject) => {
  child.once("error", reject);
  child.on("exit", (code, signal) => {
    if (signal) {
      reject(new Error(`Pinned E2E terminated by ${signal}`));
      return;
    }
    resolveExit(code ?? 1);
  });
});

process.exitCode = exitCode;
