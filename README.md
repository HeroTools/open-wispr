# OpenWispr

An open source desktop dictation application that converts speech to text using OpenAI Whisper. Features both local and cloud processing options for maximum flexibility and privacy.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details. This means you can freely use, modify, and distribute this software for personal or commercial purposes.

## Features

- 🎤 **Global Hotkey**: Customizable hotkey to start/stop dictation from anywhere (default: backtick `)
- 🤖 **Dual AI Processing**: Choose between local Whisper models (private) or OpenAI API (fast)
- 🎯 **Agent Naming**: Personalize your AI assistant with a custom name for natural interactions
- 🔒 **Privacy-First**: Local processing keeps your voice data completely private
- 🎨 **Modern UI**: Built with React 19, TypeScript, and Tailwind CSS v4
- 🚀 **Fast**: Optimized with Vite and modern tooling
- 📱 **Control Panel**: Manage settings, view history, and configure API keys
- 🗄️ **Transcription History**: SQLite database stores all your transcriptions locally
- 🔧 **Model Management**: Download and manage local Whisper models (tiny, base, small, medium, large)
- 🌐 **Cross-Platform**: Works on macOS, Windows, and Linux
- ⚡ **Automatic Pasting**: Transcribed text automatically pastes at your cursor location
- 🖱️ **Draggable Interface**: Move the dictation panel anywhere on your screen

## Prerequisites

- **Node.js 18+** and npm (Download from [nodejs.org](https://nodejs.org/))
- **macOS 10.15+**, **Windows 10+**, or **Linux**
- **Python 3.7+** (Optional - the app can install it automatically for local Whisper processing)

## Quick Start

### For Personal Use (Recommended)

1. **Clone the repository**:
   ```bash
   git clone https://github.com/HeroTools/open-whispr.git
   cd open-whispr
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Optional: Set up OpenAI API key** (only needed for cloud processing):
   
   **Method A - Environment file**:
   ```bash
   cp env.example .env
   # Edit .env and add your OpenAI API key
   ```
   
   **Method B - In-app configuration**:
   - Run the app and configure the API key through the Control Panel

4. **Run the application**:
   ```bash
   npm run dev  # Development mode with hot reload
   # OR
   npm start    # Production mode
   ```

### Building for Personal Use (Optional)

If you want to build a standalone app for personal use:

```bash
# Build without code signing (no certificates required)
npm run pack

# The unsigned app will be in: dist/mac-arm64/OpenWispr.app (macOS)
# or dist/win-unpacked/OpenWispr.exe (Windows)
# or dist/linux-unpacked/open-whispr (Linux)
```

**Note**: On macOS, you may see a security warning when first opening the unsigned app. Right-click and select "Open" to bypass this.

### Building for Distribution

For maintainers who need to distribute signed builds:

```bash
# Requires code signing certificates and notarization setup
npm run build        # Build for the current platform
npm run build -- --x64 --linux deb # Build for specific platform, package and architecture

```

### First Time Setup

1. **Choose Processing Method**:
   - **Local Processing**: Download Whisper models for completely private transcription
   - **Cloud Processing**: Use OpenAI's API for faster transcription (requires API key)

2. **Grant Permissions**:
   - **Microphone Access**: Required for voice recording
   - **Accessibility Permissions**: Required for automatic text pasting (macOS)

3. **Name Your Agent**: Give your AI assistant a personal name (e.g., "Assistant", "Jarvis", "Alex")
   - Makes interactions feel more natural and conversational
   - Helps distinguish between giving commands and regular dictation
   - Can be changed anytime in settings

4. **Configure Global Hotkey**: Default is backtick (`) but can be customized

## Usage

### Basic Dictation
1. **Start the app** - A small draggable panel appears on your screen
2. **Press your hotkey** (default: backtick `) - Start dictating (panel shows recording animation)
3. **Press your hotkey again** - Stop dictation and begin transcription (panel shows processing animation)
4. **Text appears** - Transcribed text is automatically pasted at your cursor location
5. **Drag the panel** - Click and drag to move the dictation panel anywhere on your screen

### Control Panel
- **Access**: Right-click the tray icon (macOS) or through the system menu
- **Configure**: Choose between local and cloud processing
- **History**: View, copy, and delete past transcriptions
- **Models**: Download and manage local Whisper models
- **Settings**: Configure API keys, customize hotkeys, and manage permissions

### Agent Naming
Once you've named your agent during setup, you can interact with it in two ways:

**🎯 Agent Commands** (for AI assistance):
- "Hey [AgentName], make this more professional"
- "Hey [AgentName], format this as a list"
- "Hey [AgentName], write a thank you email"
- "Hey [AgentName], convert this to bullet points"

**📝 Regular Dictation** (for normal text):
- "This is just normal text I want transcribed"
- "Meeting notes: John mentioned the quarterly report"
- "Dear Sarah, thank you for your help"

The AI automatically detects when you're giving it commands versus dictating regular text, and removes agent name references from the final output.

### Processing Options
- **Local Processing**: 
  - Install Whisper automatically through the Control Panel
  - Download models: tiny (fastest), base (recommended), small, medium, large (best quality)
  - Complete privacy - audio never leaves your device
- **Cloud Processing**:
  - Requires OpenAI API key
  - Faster processing
  - Uses OpenAI's Whisper API

## Project Structure

```
open-whispr/
├── main.js              # Electron main process & IPC handlers
├── preload.js           # Electron preload script & API bridge
├── whisper_bridge.py    # Python script for local Whisper processing
├── setup.js             # First-time setup script
├── package.json         # Dependencies and scripts
├── env.example          # Environment variables template
├── CHANGELOG.md         # Project changelog
├── src/
│   ├── App.jsx          # Main dictation interface
│   ├── main.jsx         # React entry point
│   ├── index.html       # Vite HTML template
│   ├── index.css        # Tailwind CSS v4 configuration
│   ├── vite.config.js   # Vite configuration
│   ├── components/
│   │   ├── ControlPanel.tsx     # Settings and history UI
│   │   ├── OnboardingFlow.tsx   # First-time setup wizard
│   │   ├── SettingsPage.tsx     # Settings interface
│   │   ├── ui/                  # shadcn/ui components
│   │   │   ├── button.tsx
│   │   │   ├── card.tsx
│   │   │   ├── input.tsx
│   │   │   ├── LoadingDots.tsx
│   │   │   ├── DotFlashing.tsx
│   │   │   ├── Toast.tsx
│   │   │   ├── toggle.tsx
│   │   │   └── tooltip.tsx
│   │   └── lib/
│   │       └── utils.ts         # Utility functions
│   ├── services/
│   │   └── ReasoningService.js  # AI processing and agent name detection
│   ├── utils/
│   │   └── agentName.ts         # Agent name management utility
│   └── components.json          # shadcn/ui configuration
└── assets/                      # App icons and resources
```

## Technology Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS v4
- **Build Tool**: Vite with optimized Tailwind plugin
- **Desktop**: Electron 36 with context isolation
- **UI Components**: shadcn/ui with Radix primitives
- **Database**: better-sqlite3 for local transcription storage
- **Speech-to-Text**: OpenAI Whisper (local models + API)
- **Local Processing**: Python with OpenAI Whisper package
- **Icons**: Lucide React for consistent iconography

## Development

### Scripts

- `npm run dev` - Start development with hot reload
- `npm run start` - Start production build
- `npm run setup` - First-time setup (creates .env file)
- `npm run build:renderer` - Build the React app only
- `npm run build` - Full build with electron-builder (requires certificates for signed builds)
- `npm run pack` - Build without signing (for personal use)
- `npm run lint` - Run ESLint
- `npm run preview` - Preview production build
- `npm run clean` - Remove generated build artifacts

### Architecture

The app consists of two main windows:
1. **Main Window**: Minimal overlay for dictation controls
2. **Control Panel**: Full settings and history interface

Both use the same React codebase but render different components based on URL parameters.

### Key Components

- **main.js**: Electron main process, IPC handlers, database operations
- **preload.js**: Secure bridge between main and renderer processes
- **App.jsx**: Main dictation interface with recording controls
- **ControlPanel.tsx**: Settings, history, and model management
- **whisper_bridge.py**: Python bridge for local Whisper processing
- **better-sqlite3**: Local database for transcription history

### Tailwind CSS v4 Setup

This project uses the latest Tailwind CSS v4 with:
- CSS-first configuration using `@theme` directive
- Vite plugin for optimal performance
- Custom design tokens for consistent theming
- Dark mode support with `@variant`

## Building

The build process creates a single executable for your platform:

```bash
# Development build
npm run pack

# Production builds
npm run build          # Build for the current platform
npm run build -- --x64 --linux deb # Build for specific platform, package and architecture
```

## Configuration

### Environment Variables

Create a `.env` file in the root directory (or use `npm run setup`):

```env
# OpenAI API Configuration (optional - only needed for cloud processing)
OPENAI_API_KEY=your_openai_api_key_here

# Optional: Customize the Whisper model
WHISPER_MODEL=whisper-1

# Optional: Set language for better transcription accuracy
LANGUAGE=

# Optional: Debug mode
DEBUG=false
```

### Local Whisper Setup

For local processing, OpenWispr offers automated setup:

1. **Automatic Python Installation** (if needed):
   - The app will detect if Python is missing
   - Offers to install Python 3.11 automatically
   - macOS: Uses Homebrew if available, otherwise official installer
   - Windows: Downloads and installs official Python
   - Linux: Uses system package manager (apt, yum, or pacman)

2. **Automatic Whisper Setup**:
   - Installs OpenAI Whisper package via pip
   - Downloads your chosen model on first use
   - Handles all transcription locally

**Requirements**:
- Sufficient disk space for models (39MB - 1.5GB depending on model)
- Admin/sudo access may be required for Python installation

### Customization

- **Hotkey**: Change in the Control Panel (default: backtick `) - fully customizable
- **Panel Position**: Drag the dictation panel to any location on your screen`
- **Processing Method**: Choose local or cloud in Control Panel
- **Whisper Model**: Select quality vs speed in Control Panel
- **UI Theme**: Edit CSS variables in `src/index.css`
- **Window Size**: Adjust dimensions in `main.js`
- **Database**: Transcriptions stored in user data directory

## Contributing

We welcome contributions! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Run `npm run lint` before committing
- Follow the existing code style
- Update documentation as needed
- Test on your target platform before submitting
## Security

OpenWispr is designed with privacy and security in mind:

- **Local Processing Option**: Keep your voice data completely private
- **No Analytics**: We don't collect any usage data or telemetry
- **Open Source**: All code is available for review
- **Secure Storage**: API keys are stored securely in your system's keychain/credential manager
- **Minimal Permissions**: Only requests necessary permissions (microphone, accessibility)

## Troubleshooting

### Common Issues

1. **Microphone permissions**: Grant permissions in System Preferences/Settings
2. **Accessibility permissions (macOS)**: Required for automatic text pasting
   - Go to System Settings → Privacy & Security → Accessibility
   - Add OpenWispr and enable the checkbox
   - Use "Fix Permission Issues" in Control Panel if needed
3. **API key errors** (cloud processing only): Ensure your OpenAI API key is valid and has credits
   - Set key through Control Panel or .env file
   - Check logs for "OpenAI API Key present: Yes/No"
4. **Local Whisper installation**: 
   - Ensure Python 3.7+ is installed
   - Use Control Panel to install Whisper automatically
   - Check available disk space for models
5. **Global hotkey conflicts**: Change the hotkey in the Control Panel - any key can be used
6. **Text not pasting**: Check accessibility permissions and try manual paste with Cmd+V
7. **Panel position**: If the panel appears off-screen, restart the app to reset position

### Getting Help

- Check the [Issues](https://github.com/your-repo/open-whispr/issues) page
- Review the console logs for debugging information
- For local processing: Ensure Python and pip are working
- For cloud processing: Verify your OpenAI API key and billing status
- Check the Control Panel for system status and diagnostics

### Performance Tips

- **Local Processing**: Use "base" model for best balance of speed and accuracy
- **Cloud Processing**: Generally faster but requires internet connection
- **Model Selection**: tiny (fastest) → base (recommended) → small → medium → large (best quality)
- **Permissions**: Ensure all required permissions are granted for smooth operation

## FAQ

**Q: Is OpenWispr really free?**
A: Yes! OpenWispr is open source and free to use. You only pay for OpenAI API usage if you choose cloud processing.

**Q: Which processing method should I use?**
A: Use local processing for privacy and offline use. Use cloud processing for speed and convenience.

**Q: Can I use this commercially?**
A: Yes! The MIT license allows commercial use.

**Q: How do I change the hotkey?**
A: Open the Control Panel (right-click tray icon) and go to Settings. You can set any key as your hotkey.

**Q: Is my data secure?**
A: With local processing, your audio never leaves your device. With cloud processing, audio is sent to OpenAI's servers (see their privacy policy).

**Q: What languages are supported?**
A: OpenWispr supports 58 languages including English, Spanish, French, German, Chinese, Japanese, and more. Set your preferred language in the .env file or use auto-detect.

## Project Status

OpenWispr is actively maintained and ready for production use. Current version: 1.0.2

- ✅ Core functionality complete
- ✅ Cross-platform support
- ✅ Local and cloud processing
- ✅ Automatic Python/Whisper installation
- ✅ Agent naming system
- ✅ Draggable interface
- 🚧 Continuous improvements and bug fixes
