const { spawn } = require("child_process");
const fs = require("fs");
const fsPromises = require("fs").promises;
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const PythonInstaller = require("./pythonInstaller");
const { runCommand, TIMEOUTS } = require("../utils/process");
const debugLogger = require("./debugLogger");

class WhisperManager {
  constructor() {
    this.pythonCmd = null; // Cache Python executable path
    this.whisperInstalled = null; // Cache installation status
    this.isInitialized = false; // Track if startup init completed
    this.currentDownloadProcess = null; // Track current download process for cancellation
    this.pythonInstaller = new PythonInstaller();
    this.venvPath = null; // Virtual environment path
    this.venvPythonPath = null; // Python executable in virtual environment
  }

  getWhisperScriptPath() {
    // In development, use the source file
    if (process.env.NODE_ENV === "development") {
      return path.join(__dirname, "..", "..", "whisper_bridge.py");
    } else {
      // In production, try multiple possible paths
      const possiblePaths = [
        // Current working directory (most reliable fallback)
        path.join(process.cwd(), "whisper_bridge.py"),
        // Relative to the current script
        path.join(__dirname, "..", "..", "whisper_bridge.py")
      ];
      
      // Add Electron-specific paths if available
      if (process.resourcesPath) {
        possiblePaths.unshift(
          path.join(process.resourcesPath, "app.asar.unpacked", "whisper_bridge.py"),
          path.join(process.resourcesPath, "whisper_bridge.py")
        );
      }
      
      // Check which path exists
      for (const scriptPath of possiblePaths) {
        if (fs.existsSync(scriptPath)) {
          debugLogger.log('Found whisper_bridge.py at:', scriptPath);
          return scriptPath;
        }
      }
      
      // If none found, return the first expected path and let the error handler deal with it
      debugLogger.error('whisper_bridge.py not found in any expected location:', possiblePaths);
      return possiblePaths[0];
    }
  }

  async initializeAtStartup() {
    try {
      // Try to initialize virtual environment first
      try {
        await this.createVirtualEnvironment();
      } catch (venvError) {
        debugLogger.log('Virtual environment initialization failed:', venvError.message);
      }
      
      await this.findPythonExecutable();
      await this.checkWhisperInstallation();
      this.isInitialized = true;
    } catch (error) {
      // Whisper not available at startup is not critical
      this.isInitialized = true;
    }
  }

  async transcribeLocalWhisper(audioBlob, options = {}) {
    debugLogger.logWhisperPipeline('transcribeLocalWhisper - start', {
      options,
      audioBlobType: audioBlob?.constructor?.name,
      audioBlobSize: audioBlob?.byteLength || audioBlob?.size || 0
    });
    
    // First check if FFmpeg is available
    const ffmpegCheck = await this.checkFFmpegAvailability();
    debugLogger.logWhisperPipeline('FFmpeg availability check', ffmpegCheck);
    
    if (!ffmpegCheck.available) {
      debugLogger.error('FFmpeg not available', ffmpegCheck);
      throw new Error(`FFmpeg not available: ${ffmpegCheck.error || 'Unknown error'}`);
    }
    
    const tempAudioPath = await this.createTempAudioFile(audioBlob);
    const model = options.model || "base";
    const language = options.language || null;

    try {
      const result = await this.runWhisperProcess(
        tempAudioPath,
        model,
        language
      );
      return this.parseWhisperResult(result);
    } catch (error) {
      throw error;
    } finally {
      await this.cleanupTempFile(tempAudioPath);
    }
  }

  async createTempAudioFile(audioBlob) {
    const tempDir = os.tmpdir();
    const filename = `whisper_audio_${crypto.randomUUID()}.wav`;
    const tempAudioPath = path.join(tempDir, filename);
    
    debugLogger.logAudioData('createTempAudioFile', audioBlob);
    debugLogger.log('Creating temp file at:', tempAudioPath);

    let buffer;
    if (audioBlob instanceof ArrayBuffer) {
      buffer = Buffer.from(audioBlob);
    } else if (audioBlob instanceof Uint8Array) {
      buffer = Buffer.from(audioBlob);
    } else if (typeof audioBlob === "string") {
      buffer = Buffer.from(audioBlob, "base64");
    } else if (audioBlob && audioBlob.buffer) {
      buffer = Buffer.from(audioBlob.buffer);
    } else {
      debugLogger.error('Unsupported audio data type:', typeof audioBlob, audioBlob);
      throw new Error(`Unsupported audio data type: ${typeof audioBlob}`);
    }
    
    debugLogger.log('Buffer created, size:', buffer.length);

    await fsPromises.writeFile(tempAudioPath, buffer);
    
    // Verify file was written correctly
    const stats = await fsPromises.stat(tempAudioPath);
    const fileInfo = {
      path: tempAudioPath,
      size: stats.size,
      isFile: stats.isFile(),
      permissions: stats.mode.toString(8)
    };
    debugLogger.logWhisperPipeline('Temp audio file created', fileInfo);
    
    if (stats.size === 0) {
      debugLogger.error('Audio file is empty after writing');
      throw new Error("Audio file is empty");
    }
    
    return tempAudioPath;
  }

  async runWhisperProcess(tempAudioPath, model, language) {
    const pythonCmd = await this.findPythonExecutable();
    const whisperScriptPath = this.getWhisperScriptPath();
    
    // Check if whisper script exists
    if (!fs.existsSync(whisperScriptPath)) {
      throw new Error(`Whisper script not found at: ${whisperScriptPath}`);
    }
    
    const args = [whisperScriptPath, tempAudioPath, "--model", model];
    if (language) {
      args.push("--language", language);
    }
    args.push("--output-format", "json");


    return new Promise(async (resolve, reject) => {
      // Get FFmpeg path with robust production/development handling
      let ffmpegPath;

      try {
        ffmpegPath = require("ffmpeg-static");
        debugLogger.logFFmpegDebug('Initial ffmpeg-static path', ffmpegPath);
        
        // Add Windows .exe extension if missing
        if (process.platform === "win32" && !ffmpegPath.endsWith(".exe")) {
          ffmpegPath += ".exe";
        }

        if (process.env.NODE_ENV !== "development" && !fs.existsSync(ffmpegPath)) {
          const possiblePaths = [
            ffmpegPath.replace("app.asar", "app.asar.unpacked"),
            ffmpegPath.replace(/.*app\.asar/, path.join(__dirname, "..", "..", "app.asar.unpacked")),
            path.join(process.resourcesPath, "app.asar.unpacked", "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg")
          ];

          debugLogger.log('FFmpeg not found at primary path, checking alternatives');
          
          for (const possiblePath of possiblePaths) {
            const exists = fs.existsSync(possiblePath);
            
            if (exists) {
              ffmpegPath = possiblePath;
              debugLogger.log('FFmpeg found at:', ffmpegPath);
              break;
            }
          }
        }

        // Final validation of bundled FFmpeg
        if (!fs.existsSync(ffmpegPath)) {
          debugLogger.error('Bundled FFmpeg not found at:', ffmpegPath);
          throw new Error(`Bundled FFmpeg not found at ${ffmpegPath}`);
        }
        
        // Validate it's actually executable
        try {
          fs.accessSync(ffmpegPath, fs.constants.X_OK);
          debugLogger.log('FFmpeg is executable');
        } catch (e) {
          debugLogger.error('FFmpeg exists but is not executable:', e.message);
          throw new Error(`FFmpeg exists but is not executable: ${ffmpegPath}`);
        }

      } catch (e) {
        debugLogger.log('Bundled FFmpeg not available, trying system FFmpeg');
        
        // Try system FFmpeg with validation
        const systemFFmpeg = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
        
        try {
          const versionResult = await runCommand(systemFFmpeg, ["--version"], { timeout: TIMEOUTS.QUICK_CHECK });
          ffmpegPath = systemFFmpeg;
          debugLogger.log('Using system FFmpeg');
        } catch (systemError) {
          debugLogger.error('System FFmpeg also unavailable:', systemError.message);
          ffmpegPath = systemFFmpeg; // Last resort - let Python handle the error
        }
      }

      // Enhanced environment setup - Python script checks multiple env vars
      // Make sure to use absolute paths
      const absoluteFFmpegPath = path.resolve(ffmpegPath);
      const enhancedEnv = {
        ...process.env,
        FFMPEG_PATH: absoluteFFmpegPath,
        FFMPEG_EXECUTABLE: absoluteFFmpegPath,
        FFMPEG_BINARY: absoluteFFmpegPath,
      };
      
      debugLogger.logFFmpegDebug('Setting FFmpeg env vars', absoluteFFmpegPath);

      // Add ffmpeg directory to PATH if we have a valid path
      if (ffmpegPath) {
        const ffmpegDir = path.dirname(ffmpegPath);
        const currentPath = enhancedEnv.PATH || "";
        const pathSeparator = process.platform === "win32" ? ";" : ":";

        if (!currentPath.includes(ffmpegDir)) {
          enhancedEnv.PATH = `${ffmpegDir}${pathSeparator}${currentPath}`;
        }
        
        // CRITICAL: Also create a symlink or use the actual unpacked path
        // The issue is that the ffmpeg path points to the ASAR archive, but we need the unpacked version
        if (ffmpegPath.includes('app.asar') && !ffmpegPath.includes('app.asar.unpacked')) {
          const unpackedPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
          if (fs.existsSync(unpackedPath)) {
            ffmpegPath = unpackedPath;
            enhancedEnv.FFMPEG_PATH = unpackedPath;
            enhancedEnv.FFMPEG_EXECUTABLE = unpackedPath;
            enhancedEnv.FFMPEG_BINARY = unpackedPath;
            // Update PATH with the unpacked directory
            const unpackedDir = path.dirname(unpackedPath);
            enhancedEnv.PATH = `${unpackedDir}${pathSeparator}${currentPath}`;
            debugLogger.log('Using unpacked FFmpeg path:', unpackedPath);
          }
        }
      } else {
        debugLogger.error('No valid FFmpeg path found, transcription may fail');
      }
      
      // Add common system paths for macOS GUI launches
      if (process.platform === "darwin") {
        const commonPaths = [
          "/usr/local/bin",
          "/opt/homebrew/bin",
          "/opt/homebrew/sbin",
          "/usr/bin",
          "/bin",
          "/usr/sbin",
          "/sbin"
        ];
        
        const currentPath = enhancedEnv.PATH || "";
        const pathsToAdd = commonPaths.filter(p => !currentPath.includes(p));
        
        if (pathsToAdd.length > 0) {
          enhancedEnv.PATH = `${currentPath}:${pathsToAdd.join(":")}`;
          debugLogger.log('Added system paths for GUI launch');
        }
      }

      const envDebugInfo = {
        FFMPEG_PATH: enhancedEnv.FFMPEG_PATH,
        PATH_includes_ffmpeg: enhancedEnv.PATH?.includes(path.dirname(ffmpegPath || "")),
        pythonCmd,
        args: args.join(" ")
      };
      debugLogger.logProcessStart(pythonCmd, args, { env: enhancedEnv });

      const whisperProcess = spawn(pythonCmd, args, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env: enhancedEnv,
      });

      let stdout = "";
      let stderr = "";
      let isResolved = false;

      // Set timeout for longer recordings
      const timeout = setTimeout(() => {
        if (!isResolved) {
          whisperProcess.kill("SIGTERM");
          reject(new Error("Whisper transcription timed out (120 seconds)"));
        }
      }, 1200000);

      whisperProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        debugLogger.logProcessOutput('Whisper', 'stdout', data);
      });

      whisperProcess.stderr.on("data", (data) => {
        const stderrText = data.toString();
        stderr += stderrText;

        debugLogger.logProcessOutput('Whisper', 'stderr', data);
      });

      whisperProcess.on("close", (code) => {
        if (isResolved) return;
        isResolved = true;
        clearTimeout(timeout);

        debugLogger.logWhisperPipeline('Process closed', {
          code,
          stdoutLength: stdout.length,
          stderrLength: stderr.length
        });

        if (code === 0) {
          debugLogger.log('Transcription successful');
          resolve(stdout);
        } else {
          // Better error message for FFmpeg issues
          let errorMessage = `Whisper transcription failed (code ${code}): ${stderr}`;

          if (
            stderr.includes("ffmpeg") ||
            stderr.includes("No such file or directory") ||
            stderr.includes("FFmpeg not found")
          ) {
            errorMessage +=
              "\n\nFFmpeg issue detected. Try restarting the app or reinstalling.";
          }

          reject(new Error(errorMessage));
        }
      });

      whisperProcess.on("error", (error) => {
        if (isResolved) return;
        isResolved = true;
        clearTimeout(timeout);
        reject(new Error(`Whisper process error: ${error.message}`));
      });
    });
  }

  parseWhisperResult(stdout) {
    debugLogger.logWhisperPipeline('Parsing result', { stdoutLength: stdout.length });
    try {
      // Clean stdout by removing any non-JSON content
      const lines = stdout.split("\n").filter((line) => line.trim());
      let jsonLine = "";

      // Find the line that looks like JSON (starts with { and ends with })
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
          jsonLine = trimmed;
          break;
        }
      }

      if (!jsonLine) {
        throw new Error("No JSON output found in Whisper response");
      }

      const result = JSON.parse(jsonLine);
      
      if (!result.text || result.text.trim().length === 0) {
        return { success: false, message: "No audio detected" };
      }
      return { success: true, text: result.text.trim() };
    } catch (parseError) {
      debugLogger.error('Failed to parse Whisper output');
      throw new Error(`Failed to parse Whisper output: ${parseError.message}`);
    }
  }

  async cleanupTempFile(tempAudioPath) {
    try {
      await fsPromises.unlink(tempAudioPath);
    } catch (cleanupError) {
      // Temp file cleanup error is not critical
    }
  }

  getVirtualEnvPath() {
    // Create a virtual environment in the user's home directory
    const homeDir = os.homedir();
    return path.join(homeDir, '.open-whispr-venv');
  }

  async createVirtualEnvironment(progressCallback = null) {
    const venvPath = this.getVirtualEnvPath();
    
    if (progressCallback) {
      progressCallback({ stage: "Creating virtual environment...", percentage: 10 });
    }

    try {
      // Check if virtual environment already exists
      if (fs.existsSync(venvPath)) {
        debugLogger.log('Virtual environment already exists at:', venvPath);
        this.venvPath = venvPath;
        this.venvPythonPath = path.join(venvPath, 'bin', 'python');
        if (process.platform === 'win32') {
          this.venvPythonPath = path.join(venvPath, 'Scripts', 'python.exe');
        }
        
        // Verify the virtual environment is still valid
        if (fs.existsSync(this.venvPythonPath)) {
          return { success: true, method: "existing" };
        } else {
          debugLogger.log('Virtual environment exists but Python executable not found, recreating...');
          // Remove corrupted virtual environment
          await fsPromises.rm(venvPath, { recursive: true, force: true });
        }
      }

      // Find system Python to create virtual environment
      const systemPython = await this.findSystemPython();
      
      if (progressCallback) {
        progressCallback({ stage: "Creating virtual environment...", percentage: 30 });
      }

      // Create virtual environment
      await runCommand(systemPython, ['-m', 'venv', venvPath], { timeout: TIMEOUTS.INSTALL });

      if (progressCallback) {
        progressCallback({ stage: "Virtual environment created!", percentage: 100 });
      }

      this.venvPath = venvPath;
      this.venvPythonPath = path.join(venvPath, 'bin', 'python');
      if (process.platform === 'win32') {
        this.venvPythonPath = path.join(venvPath, 'Scripts', 'python.exe');
      }

      // Verify the virtual environment was created successfully
      if (!fs.existsSync(this.venvPythonPath)) {
        throw new Error('Virtual environment created but Python executable not found');
      }

      return { success: true, method: "created" };
    } catch (error) {
      debugLogger.error('Failed to create virtual environment:', error);
      throw new Error(`Failed to create virtual environment: ${error.message}`);
    }
  }

  async findSystemPython() {
    const possiblePaths = [
      "python3.11",
      "python3",
      "python",
      "/usr/bin/python3.11",
      "/usr/bin/python3",
      "/usr/local/bin/python3.11",
      "/usr/local/bin/python3",
      "/opt/homebrew/bin/python3.11",
      "/opt/homebrew/bin/python3",
      "/usr/bin/python",
      "/usr/local/bin/python",
    ];

    for (const pythonPath of possiblePaths) {
      try {
        const version = await this.getPythonVersion(pythonPath);
        if (this.isPythonVersionSupported(version)) {
          return pythonPath;
        }
      } catch (error) {
        continue;
      }
    }

    throw new Error("No suitable Python installation found for creating virtual environment");
  }

  async findPythonExecutable() {
    // Return cached result if available
    if (this.pythonCmd) {
      return this.pythonCmd;
    }

    // First, try to use virtual environment Python if available
    if (this.venvPythonPath && fs.existsSync(this.venvPythonPath)) {
      try {
        const version = await this.getPythonVersion(this.venvPythonPath);
        if (this.isPythonVersionSupported(version)) {
          this.pythonCmd = this.venvPythonPath;
          return this.pythonCmd;
        }
      } catch (error) {
        debugLogger.log('Virtual environment Python not suitable, falling back to system Python');
      }
    }

    // Fall back to system Python detection
    const possiblePaths = [
      "python3.11",
      "python3",
      "python",
      "/usr/bin/python3.11",
      "/usr/bin/python3",
      "/usr/local/bin/python3.11",
      "/usr/local/bin/python3",
      "/opt/homebrew/bin/python3.11",
      "/opt/homebrew/bin/python3",
      "/usr/bin/python",
      "/usr/local/bin/python",
    ];

    for (const pythonPath of possiblePaths) {
      try {
        const version = await this.getPythonVersion(pythonPath);
        if (this.isPythonVersionSupported(version)) {
          this.pythonCmd = pythonPath; // Cache the result
          return pythonPath;
        }
      } catch (error) {
        continue;
      }
    }

    throw new Error(
      "Python 3.x not found. Use installPython() to install it automatically."
    );
  }

  async installPython(progressCallback = null) {
    try {
      // Clear cached Python command since we're installing new one
      this.pythonCmd = null;
      this.venvPythonPath = null; // Also clear virtual environment path
      
      const result = await this.pythonInstaller.installPython(progressCallback);
      
      // After installation, try to find Python again
      try {
        await this.findPythonExecutable();
        return result;
      } catch (findError) {
        throw new Error("Python installed but not found in PATH. Please restart the application.");
      }
      
    } catch (error) {
      console.error("Python installation failed:", error);
      throw error;
    }
  }

  async cleanupVirtualEnvironment() {
    const venvPath = this.getVirtualEnvPath();
    if (fs.existsSync(venvPath)) {
      try {
        // Remove the virtual environment directory
        await fsPromises.rm(venvPath, { recursive: true, force: true });
        this.venvPath = null;
        this.venvPythonPath = null;
        this.pythonCmd = null; // Clear cached Python command
        return { success: true, message: "Virtual environment cleaned up successfully" };
      } catch (error) {
        throw new Error(`Failed to cleanup virtual environment: ${error.message}`);
      }
    }
    return { success: true, message: "No virtual environment to cleanup" };
  }

  async checkPythonInstallation() {
    return await this.pythonInstaller.isPythonInstalled();
  }

  async getPythonVersion(pythonPath) {
    return new Promise((resolve) => {
      const testProcess = spawn(pythonPath, ["--version"]);
      let output = "";
      
      testProcess.stdout.on("data", (data) => output += data);
      testProcess.stderr.on("data", (data) => output += data);
      
      testProcess.on("close", (code) => {
        if (code === 0) {
          const match = output.match(/Python (\d+)\.(\d+)/i);
          resolve(match ? { major: +match[1], minor: +match[2] } : null);
        } else {
          resolve(null);
        }
      });
      
      testProcess.on("error", () => resolve(null));
    });
  }

  isPythonVersionSupported(version) {
    // Accept any Python 3.x version
    return version && version.major === 3;
  }

  async checkWhisperInstallation() {
    // Return cached result if available
    if (this.whisperInstalled !== null) {
      return this.whisperInstalled;
    }

    try {
      const pythonCmd = await this.findPythonExecutable();

      const result = await new Promise((resolve) => {
        const checkProcess = spawn(pythonCmd, [
          "-c",
          'import whisper; print("OK")',
        ]);

        let output = "";
        checkProcess.stdout.on("data", (data) => {
          output += data.toString();
        });

        checkProcess.on("close", (code) => {
          if (code === 0 && output.includes("OK")) {
            resolve({ installed: true, working: true });
          } else {
            resolve({ installed: false, working: false });
          }
        });

        checkProcess.on("error", (error) => {
          resolve({ installed: false, working: false, error: error.message });
        });
      });

      this.whisperInstalled = result; // Cache the result
      return result;
    } catch (error) {
      const errorResult = {
        installed: false,
        working: false,
        error: error.message,
      };
      this.whisperInstalled = errorResult;
      return errorResult;
    }
  }

  async checkFFmpegAvailability() {
    debugLogger.logWhisperPipeline('checkFFmpegAvailability - start', {});
    
    try {
      const pythonCmd = await this.findPythonExecutable();
      const whisperScriptPath = this.getWhisperScriptPath();

      // Get FFmpeg path to pass to Python script
      let ffmpegPath;
      try {
        ffmpegPath = require("ffmpeg-static");
        debugLogger.logFFmpegDebug('checkFFmpegAvailability', ffmpegPath, {
          NODE_ENV: process.env.NODE_ENV,
          resourcesPath: process.resourcesPath,
          __dirname: __dirname
        });
        
        // Always check if the path exists and handle ASAR unpacking
        if (!fs.existsSync(ffmpegPath)) {
          debugLogger.log('FFmpeg not found at initial path, checking alternatives');
          
          const possiblePaths = [
            // Direct ASAR replacement
            ffmpegPath.replace("app.asar", "app.asar.unpacked"),
            // Alternative ASAR replacement patterns
            ffmpegPath.replace(/app\.asar[\/\\]/, "app.asar.unpacked/"),
            // Resources folder fallback
            process.resourcesPath ? path.join(process.resourcesPath, "app.asar.unpacked", "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg") : null,
            // Development fallback
            path.join(__dirname, "..", "..", "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg")
          ].filter(Boolean);

          // Check alternative paths
          debugLogger.log('Checking alternative FFmpeg paths for availability check');
          
          for (const possiblePath of possiblePaths) {
            const exists = fs.existsSync(possiblePath);
            // Check path existence
            debugLogger.logFFmpegDebug('Checking availability path', possiblePath);
            
            if (exists) {
              ffmpegPath = possiblePath;
              // Found FFmpeg
              debugLogger.log('FFmpeg found for availability check at:', ffmpegPath);
              break;
            }
          }
        }
        
        // Final validation
        if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
          debugLogger.log('FFmpeg not found at any location');
          ffmpegPath = null;
        } else {
          // Using bundled FFmpeg
        }
      } catch (e) {
        debugLogger.log('ffmpeg-static error:', e.message);
        ffmpegPath = null;
      }

      const result = await new Promise((resolve) => {
        // Set up environment with FFmpeg path
        const env = {
          ...process.env,
          FFMPEG_PATH: ffmpegPath || "",
          FFMPEG_EXECUTABLE: ffmpegPath || "",
          FFMPEG_BINARY: ffmpegPath || ""
        };

        const checkProcess = spawn(pythonCmd, [
          whisperScriptPath,
          "--mode",
          "check-ffmpeg",
        ], {
          env: env
        });

        let output = "";
        let stderr = "";

        checkProcess.stdout.on("data", (data) => {
          output += data.toString();
        });

        checkProcess.stderr.on("data", (data) => {
          stderr += data.toString();
        });

        checkProcess.on("close", (code) => {
          debugLogger.logWhisperPipeline('FFmpeg check process closed', {
            code,
            outputLength: output.length,
            stderrLength: stderr.length
          });
          
          if (code === 0) {
            try {
              const result = JSON.parse(output);
              debugLogger.log('FFmpeg check result:', result);
              resolve(result);
            } catch (parseError) {
              debugLogger.error('Failed to parse FFmpeg check result:', parseError);
              resolve({
                available: false,
                error: "Failed to parse FFmpeg check result",
              });
            }
          } else {
            debugLogger.error('FFmpeg check failed with code:', code, 'stderr:', stderr);
            resolve({
              available: false,
              error: stderr || "FFmpeg check failed",
            });
          }
        });

        checkProcess.on("error", (error) => {
          resolve({ available: false, error: error.message });
        });
      });

      return result;
    } catch (error) {
      return { available: false, error: error.message };
    }
  }

  upgradePip(pythonCmd) {
    return runCommand(pythonCmd, ["-m", "pip", "install", "--upgrade", "pip"], { timeout: TIMEOUTS.PIP_UPGRADE });
  }

  // Removed - now using shared runCommand from utils/process.js

  async installWhisper() {
    let pythonCmd;
    
    try {
      // Try to create or use virtual environment first
      await this.createVirtualEnvironment();
      pythonCmd = this.venvPythonPath;
    } catch (venvError) {
      debugLogger.log('Virtual environment creation failed, falling back to system Python:', venvError.message);
      pythonCmd = await this.findPythonExecutable();
    }
    
    // Upgrade pip first to avoid version issues
    try {
      await this.upgradePip(pythonCmd);
    } catch (error) {
      debugLogger.log("First pip upgrade attempt failed:", error.message);
      
      // Try user install for pip upgrade (only if not using virtual environment)
      if (pythonCmd !== this.venvPythonPath) {
        try {
          await runCommand(pythonCmd, ["-m", "pip", "install", "--user", "--upgrade", "pip"], { timeout: TIMEOUTS.PIP_UPGRADE });
        } catch (userError) {
          // If pip upgrade fails completely, try to detect if it's the TOML error
          if (error.message.includes("pyproject.toml") || error.message.includes("TomlError")) {
            // Try installing with legacy resolver as a workaround
            try {
              await runCommand(pythonCmd, ["-m", "pip", "install", "--use-deprecated=legacy-resolver", "--upgrade", "pip"], { timeout: TIMEOUTS.PIP_UPGRADE });
            } catch (legacyError) {
              throw new Error("Failed to upgrade pip. Please manually run: python -m pip install --upgrade pip");
            }
          } else {
            debugLogger.log("Pip upgrade failed completely, attempting to continue");
          }
        }
      } else {
        debugLogger.log("Pip upgrade failed in virtual environment, attempting to continue");
      }
    }
    
    // Install OpenAI Whisper
    try {
      // In virtual environment, we can install directly without --user flag
      return await runCommand(pythonCmd, ["-m", "pip", "install", "-U", "openai-whisper"], { timeout: TIMEOUTS.DOWNLOAD });
    } catch (error) {
      // If using system Python, try user installation
      if (pythonCmd !== this.venvPythonPath) {
        if (error.message.includes("Permission denied") || error.message.includes("access is denied") || error.message.includes("externally-managed-environment")) {
          // Retry with user installation
          return await runCommand(pythonCmd, ["-m", "pip", "install", "--user", "-U", "openai-whisper"], { timeout: TIMEOUTS.DOWNLOAD });
        }
      }
      
      // If we still get TOML error after pip upgrade, try legacy resolver for whisper
      if (error.message.includes("pyproject.toml") || error.message.includes("TomlError")) {
        // TOML error persists, try legacy resolver
        try {
          return await runCommand(pythonCmd, ["-m", "pip", "install", "--use-deprecated=legacy-resolver", "-U", "openai-whisper"], { timeout: TIMEOUTS.DOWNLOAD });
        } catch (legacyError) {
          // Try user install with legacy resolver (only if not using virtual environment)
          if (pythonCmd !== this.venvPythonPath) {
            return await runCommand(pythonCmd, ["-m", "pip", "install", "--user", "--use-deprecated=legacy-resolver", "-U", "openai-whisper"], { timeout: TIMEOUTS.DOWNLOAD });
          } else {
            throw legacyError;
          }
        }
      }
      
      // Enhanced error messages for common issues
      let message = error.message;
      if (message.includes("Microsoft Visual C++")) {
        message = "Microsoft Visual C++ build tools required. Install Visual Studio Build Tools.";
      } else if (message.includes("No matching distribution")) {
        message = "Python version incompatible. OpenAI Whisper requires Python 3.8-3.11.";
      } else if (message.includes("externally-managed-environment")) {
        message = "System Python is externally managed. The app will create a virtual environment for you.";
      }
      
      throw new Error(message);
    }
  }

  async downloadWhisperModel(modelName, progressCallback = null) {
    try {
      const pythonCmd = await this.findPythonExecutable();
      const whisperScriptPath = this.getWhisperScriptPath();

      const args = [
        whisperScriptPath,
        "--mode",
        "download",
        "--model",
        modelName,
      ];

      return new Promise((resolve, reject) => {
        const downloadProcess = spawn(pythonCmd, args);
        this.currentDownloadProcess = downloadProcess; // Store for potential cancellation

        let stdout = "";
        let stderr = "";

        downloadProcess.stdout.on("data", (data) => {
          stdout += data.toString();
        });

        downloadProcess.stderr.on("data", (data) => {
          const output = data.toString();
          stderr += output;

          // Parse progress updates from stderr
          const lines = output.split("\n");
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("PROGRESS:")) {
              try {
                const progressData = JSON.parse(trimmed.substring(9));
                if (progressCallback) {
                  progressCallback({
                    type: "progress",
                    model: modelName,
                    ...progressData,
                  });
                }
              } catch (parseError) {
                // Ignore parsing errors for progress data
              }
            }
          }
        });

        downloadProcess.on("close", (code) => {
          this.currentDownloadProcess = null; // Clear process reference

          if (code === 0) {
            try {
              const result = JSON.parse(stdout);
              resolve(result);
            } catch (parseError) {
              console.error("Failed to parse download result:", parseError);
              reject(
                new Error(
                  `Failed to parse download result: ${parseError.message}`
                )
              );
            }
          } else {
            // Handle cancellation cases (SIGTERM, SIGKILL, or null exit codes)
            if (code === 143 || code === 137 || code === null) {
              reject(new Error("Download interrupted by user"));
            } else {
              console.error("Model download failed with code:", code);
              reject(new Error(`Model download failed (exit code ${code})`));
            }
          }
        });

        downloadProcess.on("error", (error) => {
          this.currentDownloadProcess = null;
          console.error("Model download process error:", error);
          reject(new Error(`Model download process error: ${error.message}`));
        });

        const timeout = setTimeout(() => {
          downloadProcess.kill("SIGTERM");
          setTimeout(() => {
            if (!downloadProcess.killed) {
              downloadProcess.kill("SIGKILL");
            }
          }, 5000);
          reject(new Error("Model download timed out (20 minutes)"));
        }, 1200000);

        downloadProcess.on("close", () => {
          clearTimeout(timeout);
        });
      });
    } catch (error) {
      console.error("Model download error:", error);
      throw error;
    }
  }

  async cancelDownload() {
    if (this.currentDownloadProcess) {
      try {
        this.currentDownloadProcess.kill("SIGTERM");
        setTimeout(() => {
          if (
            this.currentDownloadProcess &&
            !this.currentDownloadProcess.killed
          ) {
            this.currentDownloadProcess.kill("SIGKILL");
          }
        }, 3000);
        return { success: true, message: "Download cancelled" };
      } catch (error) {
        console.error("Error cancelling download:", error);
        return { success: false, error: error.message };
      }
    } else {
      return { success: false, error: "No active download to cancel" };
    }
  }

  async checkModelStatus(modelName) {
      const pythonCmd = await this.findPythonExecutable();
      const whisperScriptPath = this.getWhisperScriptPath();

      const args = [whisperScriptPath, "--mode", "check", "--model", modelName];

      return new Promise((resolve, reject) => {
        const checkProcess = spawn(pythonCmd, args);

        let stdout = "";
        let stderr = "";

        checkProcess.stdout.on("data", (data) => {
          stdout += data.toString();
        });

        checkProcess.stderr.on("data", (data) => {
          stderr += data.toString();
        });

        checkProcess.on("close", (code) => {
          if (code === 0) {
            try {
              const result = JSON.parse(stdout);
              resolve(result);
            } catch (parseError) {
              console.error("Failed to parse model status:", parseError);
              reject(
                new Error(`Failed to parse model status: ${parseError.message}`)
              );
            }
          } else {
            console.error("Model status check failed with code:", code);
            reject(
              new Error(`Model status check failed (code ${code}): ${stderr}`)
            );
          }
        });

        checkProcess.on("error", (error) => {
              reject(new Error(`Model status check error: ${error.message}`));
        });
      });
  }

  async listWhisperModels() {
      const pythonCmd = await this.findPythonExecutable();
      const whisperScriptPath = this.getWhisperScriptPath();

      const args = [whisperScriptPath, "--mode", "list"];

      return new Promise((resolve, reject) => {
        const listProcess = spawn(pythonCmd, args);

        let stdout = "";
        let stderr = "";

        listProcess.stdout.on("data", (data) => {
          stdout += data.toString();
        });

        listProcess.stderr.on("data", (data) => {
          stderr += data.toString();
        });

        listProcess.on("close", (code) => {
          if (code === 0) {
            try {
              const result = JSON.parse(stdout);
              resolve(result);
            } catch (parseError) {
              console.error("Failed to parse model list:", parseError);
              reject(
                new Error(`Failed to parse model list: ${parseError.message}`)
              );
            }
          } else {
            console.error("Model list failed with code:", code);
            reject(new Error(`Model list failed (code ${code}): ${stderr}`));
          }
        });

        listProcess.on("error", (error) => {
              reject(new Error(`Model list error: ${error.message}`));
        });
      });
  }

  async deleteWhisperModel(modelName) {
      const pythonCmd = await this.findPythonExecutable();
      const whisperScriptPath = this.getWhisperScriptPath();

      const args = [
        whisperScriptPath,
        "--mode",
        "delete",
        "--model",
        modelName,
      ];

      return new Promise((resolve, reject) => {
        const deleteProcess = spawn(pythonCmd, args);

        let stdout = "";
        let stderr = "";

        deleteProcess.stdout.on("data", (data) => {
          stdout += data.toString();
        });

        deleteProcess.stderr.on("data", (data) => {
          stderr += data.toString();
        });

        deleteProcess.on("close", (code) => {
          if (code === 0) {
            try {
              const result = JSON.parse(stdout);
              resolve(result);
            } catch (parseError) {
              console.error("Failed to parse delete result:", parseError);
              reject(
                new Error(
                  `Failed to parse delete result: ${parseError.message}`
                )
              );
            }
          } else {
            console.error("Model delete failed with code:", code);
            reject(new Error(`Model delete failed (code ${code}): ${stderr}`));
          }
        });

        deleteProcess.on("error", (error) => {
              reject(new Error(`Model delete error: ${error.message}`));
        });
      });
  }
}

module.exports = WhisperManager;
