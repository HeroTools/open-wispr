const { app, globalShortcut, BrowserWindow } = require("electron");

// Add global error handling for uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  // Don't exit the process for EPIPE errors as they're harmless
  if (error.code === "EPIPE") {
    console.log("EPIPE error caught and ignored");
    return;
  }
  // For other errors, log and continue
  console.error("Error stack:", error.stack);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

// Import helper modules
const EnvironmentManager = require("./src/helpers/environment");
const WindowManager = require("./src/helpers/windowManager");
const DatabaseManager = require("./src/helpers/database");
const ClipboardManager = require("./src/helpers/clipboard");
const WhisperManager = require("./src/helpers/whisper");
const TrayManager = require("./src/helpers/tray");
const IPCHandlers = require("./src/helpers/ipcHandlers");
const UpdateManager = require("./src/updater");

// Initialize managers
const environmentManager = new EnvironmentManager();
const windowManager = new WindowManager();
const databaseManager = new DatabaseManager();
const clipboardManager = new ClipboardManager();
const whisperManager = new WhisperManager();
const trayManager = new TrayManager();
const updateManager = new UpdateManager();

// Initialize IPC handlers with all managers
const ipcHandlers = new IPCHandlers({
  environmentManager,
  databaseManager,
  clipboardManager,
  whisperManager,
  windowManager,
});

// Main application startup
async function startApp() {
  // In development, add a small delay to let Vite start properly
  if (process.env.NODE_ENV === "development") {
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  // Initialize Whisper manager at startup (don't await to avoid blocking)
  whisperManager.initializeAtStartup().catch((err) => {
    console.log("Whisper initialization info:", err.message);
  });

  // Create main window
  try {
    await windowManager.createMainWindow();
  } catch (error) {
    console.error("Error creating main window:", error);
  }

  // Create control panel window
  try {
    await windowManager.createControlPanelWindow();
  } catch (error) {
    console.error("Error creating control panel window:", error);
  }

  // Set up tray
  trayManager.setWindows(
    windowManager.mainWindow,
    windowManager.controlPanelWindow
  );
  trayManager.setCreateControlPanelCallback(() =>
    windowManager.createControlPanelWindow()
  );
  await trayManager.createTray();

  // Set windows for update manager and check for updates
  updateManager.setWindows(
    windowManager.mainWindow,
    windowManager.controlPanelWindow
  );
  updateManager.checkForUpdatesOnStartup();
}

// App event handlers
app.whenReady().then(startApp);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    windowManager.createMainWindow();
  }
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});
