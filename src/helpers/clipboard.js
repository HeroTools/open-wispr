const { clipboard } = require("electron");
const { spawn, spawnSync } = require("child_process");

class ClipboardManager {
  constructor() {
    // Initialize clipboard manager
  }

  // Safe logging method - only log in development
  safeLog(...args) {
    if (process.env.NODE_ENV === "development") {
      try {
        console.log(...args);
      } catch (error) {
        // Silently ignore EPIPE errors in logging
        if (error.code !== "EPIPE") {
          process.stderr.write(`Log error: ${error.message}\n`);
        }
      }
    }
  }

  async pasteText(text) {
    try {
      // Save original clipboard content first
      const originalClipboard = clipboard.readText();
      this.safeLog(
        "💾 Saved original clipboard content:",
        originalClipboard.substring(0, 50) + "..."
      );

      // Copy text to clipboard first - this always works
      clipboard.writeText(text);
      this.safeLog(
        "📋 Text copied to clipboard:",
        text.substring(0, 50) + "..."
      );

      if (process.platform === "darwin") {
        // Check accessibility permissions first
        this.safeLog(
          "🔍 Checking accessibility permissions for paste operation..."
        );
        const hasPermissions = await this.checkAccessibilityPermissions();

        if (!hasPermissions) {
          this.safeLog(
            "⚠️ No accessibility permissions - text copied to clipboard only"
          );
          const errorMsg =
            "Accessibility permissions required for automatic pasting. Text has been copied to clipboard - please paste manually with Cmd+V.";
          throw new Error(errorMsg);
        }

        this.safeLog("✅ Permissions granted, attempting to paste...");
        return await this.pasteMacOS(originalClipboard);
      } else if (process.platform === "win32") {
        return await this.pasteWindows(originalClipboard);
      } else {
        return await this.pasteLinux(originalClipboard);
      }
    } catch (error) {
      throw error;
    }
  }

  async pasteMacOS(originalClipboard) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        const pasteProcess = spawn("osascript", [
          "-e",
          'tell application "System Events" to keystroke "v" using command down',
        ]);

        let errorOutput = "";
        let hasTimedOut = false;

        pasteProcess.stderr.on("data", (data) => {
          errorOutput += data.toString();
        });

        pasteProcess.on("close", (code) => {
          if (hasTimedOut) return;

          // Clear timeout first
          clearTimeout(timeoutId);

          // Clean up the process reference
          pasteProcess.removeAllListeners();

          if (code === 0) {
            this.safeLog("✅ Text pasted successfully via Cmd+V simulation");
            setTimeout(() => {
              clipboard.writeText(originalClipboard);
              this.safeLog("🔄 Original clipboard content restored");
            }, 100);
            resolve();
          } else {
            const errorMsg = `Paste failed (code ${code}). Text is copied to clipboard - please paste manually with Cmd+V.`;
            reject(new Error(errorMsg));
          }
        });

        pasteProcess.on("error", (error) => {
          if (hasTimedOut) return;
          clearTimeout(timeoutId);
          pasteProcess.removeAllListeners();
          const errorMsg = `Paste command failed: ${error.message}. Text is copied to clipboard - please paste manually with Cmd+V.`;
          reject(new Error(errorMsg));
        });

        const timeoutId = setTimeout(() => {
          hasTimedOut = true;
          pasteProcess.kill("SIGKILL");
          pasteProcess.removeAllListeners();
          const errorMsg =
            "Paste operation timed out. Text is copied to clipboard - please paste manually with Cmd+V.";
          reject(new Error(errorMsg));
        }, 3000);
      }, 100);
    });
  }

  async pasteWindows(originalClipboard) {
    return new Promise((resolve, reject) => {
      const pasteProcess = spawn("powershell", [
        "-Command",
        'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("^v")',
      ]);

      pasteProcess.on("close", (code) => {
        if (code === 0) {
          // Text pasted successfully
          setTimeout(() => {
            clipboard.writeText(originalClipboard);
          }, 100);
          resolve();
        } else {
          reject(
            new Error(
              `Windows paste failed with code ${code}. Text is copied to clipboard.`
            )
          );
        }
      });

      pasteProcess.on("error", (error) => {
        reject(
          new Error(
            `Windows paste failed: ${error.message}. Text is copied to clipboard.`
          )
        );
      });
    });
  }

  async pasteLinux(originalClipboard) {
    const commandExists = (cmd) => {
      try {
        const res = spawnSync("sh", ["-lc", `command -v ${cmd}`], { stdio: "ignore" });
        return res.status === 0;
      } catch (_) {
        return false;
      }
    };

    const isWayland =
      (process.env.XDG_SESSION_TYPE || "").toLowerCase() === "wayland" ||
      !!process.env.WAYLAND_DISPLAY;

    // Define candidate tools in preference order
    const candidates = isWayland
      ? [
          { cmd: "wtype", args: ["-M", "ctrl", "-p", "v", "-m", "ctrl"] },
          // ydotool often requires uinput permissions; include as a best-effort
          { cmd: "ydotool", args: ["key", "29:1", "47:1", "47:0", "29:0"] },
        ]
      : [
          { cmd: "xdotool", args: ["key", "ctrl+v"] },
        ];

    const available = candidates.filter((c) => commandExists(c.cmd));

    const pasteWith = (tool) =>
      new Promise((resolve, reject) => {
        const proc = spawn(tool.cmd, tool.args);

        let timedOut = false;
        const timeoutId = setTimeout(() => {
          timedOut = true;
          try { proc.kill("SIGKILL"); } catch (_) {}
        }, 1000);

        proc.on("close", (code) => {
          if (timedOut) return reject(new Error(`Paste on Linux via ${tool.cmd} timed out`));
          clearTimeout(timeoutId);
          if (code === 0) {
            setTimeout(() => clipboard.writeText(originalClipboard), 100);
            resolve();
          } else {
            reject(new Error(`${tool.cmd} exited with code ${code}`));
          }
        });

        proc.on("error", (error) => {
          if (timedOut) return;
          clearTimeout(timeoutId);
          reject(error);
        });
      });

    // Try tools in order; on total failure, return special error
    for (const tool of available) {
      try {
        await pasteWith(tool);
        return; // success
      } catch (e) {
        this.safeLog(`Paste with ${tool.cmd} failed:`, e?.message || e);
        // try next
      }
    }

    const err = new Error(
      "Clipboard copied, but paste failed (no suitable tool or not permitted)."
    );
    // Special code for renderer to detect
    err.code = "PASTE_SIMULATION_FAILED";
    throw err;
  }

  async checkAccessibilityPermissions() {
    if (process.platform !== "darwin") return true;

    return new Promise((resolve) => {
      // Check accessibility permissions

      const testProcess = spawn("osascript", [
        "-e",
        'tell application "System Events" to get name of first process',
      ]);

      let testOutput = "";
      let testError = "";

      testProcess.stdout.on("data", (data) => {
        testOutput += data.toString();
      });

      testProcess.stderr.on("data", (data) => {
        testError += data.toString();
      });

      testProcess.on("close", (code) => {
        if (code === 0) {
          resolve(true);
        } else {
          this.showAccessibilityDialog(testError);
          resolve(false);
        }
      });

      testProcess.on("error", (error) => {
        resolve(false);
      });
    });
  }

  showAccessibilityDialog(testError) {
    const isStuckPermission =
      testError.includes("not allowed assistive access") ||
      testError.includes("(-1719)") ||
      testError.includes("(-25006)");

    let dialogMessage;
    if (isStuckPermission) {
      dialogMessage = `🔒 OpenWispr needs Accessibility permissions, but it looks like you may have OLD PERMISSIONS from a previous version.

❗ COMMON ISSUE: If you've rebuilt/reinstalled OpenWispr, the old permissions may be "stuck" and preventing new ones.

🔧 To fix this:
1. Open System Settings → Privacy & Security → Accessibility
2. Look for ANY old "OpenWispr" entries and REMOVE them (click the - button)
3. Also remove any entries that say "Electron" or have unclear names
4. Click the + button and manually add the NEW OpenWispr app
5. Make sure the checkbox is enabled
6. Restart OpenWispr

⚠️ This is especially common during development when rebuilding the app.

📝 Without this permission, text will only copy to clipboard (no automatic pasting).

Would you like to open System Settings now?`;
    } else {
      dialogMessage = `🔒 OpenWispr needs Accessibility permissions to paste text into other applications.

📋 Current status: Clipboard copy works, but pasting (Cmd+V simulation) fails.

🔧 To fix this:
1. Open System Settings (or System Preferences on older macOS)
2. Go to Privacy & Security → Accessibility
3. Click the lock icon and enter your password
4. Add OpenWispr to the list and check the box
5. Restart OpenWispr

⚠️ Without this permission, dictated text will only be copied to clipboard but won't paste automatically.

💡 In production builds, this permission is required for full functionality.

Would you like to open System Settings now?`;
    }

    const permissionDialog = spawn("osascript", [
      "-e",
      `display dialog "${dialogMessage}" buttons {"Cancel", "Open System Settings"} default button "Open System Settings"`,
    ]);

    permissionDialog.on("close", (dialogCode) => {
      if (dialogCode === 0) {
        this.openSystemSettings();
      }
    });

    permissionDialog.on("error", (error) => {
      // Permission dialog error - user will need to manually grant permissions
    });
  }

  openSystemSettings() {
    const settingsCommands = [
      [
        "open",
        [
          "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
        ],
      ],
      ["open", ["-b", "com.apple.systempreferences"]],
      ["open", ["/System/Library/PreferencePanes/Security.prefPane"]],
    ];

    let commandIndex = 0;
    const tryNextCommand = () => {
      if (commandIndex < settingsCommands.length) {
        const [cmd, args] = settingsCommands[commandIndex];
        const settingsProcess = spawn(cmd, args);

        settingsProcess.on("error", (error) => {
          commandIndex++;
          tryNextCommand();
        });

        settingsProcess.on("close", (settingsCode) => {
          if (settingsCode !== 0) {
            commandIndex++;
            tryNextCommand();
          }
        });
      } else {
        // All settings commands failed, try fallback
        spawn("open", ["-a", "System Preferences"]).on("error", () => {
          spawn("open", ["-a", "System Settings"]).on("error", () => {
            // Could not open settings app
          });
        });
      }
    };

    tryNextCommand();
  }

  async readClipboard() {
    try {
      const text = clipboard.readText();
      return text;
    } catch (error) {
      throw error;
    }
  }

  async writeClipboard(text) {
    try {
      clipboard.writeText(text);
      return { success: true };
    } catch (error) {
      throw error;
    }
  }
}

module.exports = ClipboardManager;
