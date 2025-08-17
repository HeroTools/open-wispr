#!/usr/bin/env node
/* Cross-platform release script for electron-builder.
   Linux: builds x64 + arm64 (AppImage, deb, rpm, tar.gz, flatpak, based on electron-builder.json).
   macOS/Windows: builds for the host OS.
*/

const { spawnSync } = require("node:child_process");

function run(cmd, args) {
  const res = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: process.platform === "win32", // smoother on Windows
  });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

function eb(...args) {
  // -y prevents npx prompts on fresh runners
  run("npx", ["-y", "electron-builder", ...args]);
}

const platform = process.platform;
console.log(
  `[release] Platform=${platform}`
);

//
// Build renderer first (shared for all OS)
//
run("npm", ["run", "build:renderer"]);

if (platform === "linux") {
  // Ensure native deps exist for both arches
  eb("install-app-deps", "--arch", "x64");
  eb("install-app-deps", "--arch", "arm64");

  // Build + publish both arches
  eb(
    "--linux",
    "--x64",
    "--arm64",
    "--publish",
    "always",
  );
} else if (platform === "darwin") {
  eb("--mac", "--publish", "always");
} else if (platform === "win32") {
  eb("--win", "--publish", "always");
} else {
  console.error(`[release] Unsupported platform: ${platform}`);
  process.exit(1);
}
