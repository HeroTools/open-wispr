import { useState, useCallback } from "react";

export interface UsePermissionsReturn {
  // State
  micPermissionGranted: boolean;
  accessibilityPermissionGranted: boolean;

  requestMicPermission: () => Promise<void>;
  testAccessibilityPermission: () => Promise<void>;
  setMicPermissionGranted: (granted: boolean) => void;
  setAccessibilityPermissionGranted: (granted: boolean) => void;
}

export interface UsePermissionsProps {
  showAlertDialog: (dialog: { title: string; description?: string }) => void;
}

export const usePermissions = (
  showAlertDialog?: UsePermissionsProps["showAlertDialog"]
): UsePermissionsReturn => {
  const [micPermissionGranted, setMicPermissionGranted] = useState(false);
  const [accessibilityPermissionGranted, setAccessibilityPermissionGranted] =
    useState(false);

  const requestMicPermission = useCallback(async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      setMicPermissionGranted(true);
    } catch (err) {
      console.error("Microphone permission denied:", err);
      if (showAlertDialog) {
        showAlertDialog({
          title: "Microphone Permission Required",
          description:
            "Please grant microphone permissions to use voice dictation.",
        });
      } else {
        alert("Please grant microphone permissions to use voice dictation.");
      }
    }
  }, [showAlertDialog]);

  const testAccessibilityPermission = useCallback(async () => {
    try {
      const platform = (window as any).electronAPI?.getPlatform?.() || "";
      const sessionType = (window as any).electronAPI?.getSessionType?.() || "";

      if (platform === "darwin") {
        // macOS requires Accessibility permissions for simulated paste
        await window.electronAPI.pasteText("OpenWispr accessibility test");
        setAccessibilityPermissionGranted(true);
        if (showAlertDialog) {
          showAlertDialog({
            title: "✅ Accessibility Test Successful",
            description:
              "Accessibility permissions working! Check if the test text appeared in another app.",
          });
        } else {
          alert(
            "✅ Accessibility permissions working! Check if the test text appeared in another app."
          );
        }
        return;
      }

      // On Linux/Windows, treat clipboard write as the test, since auto-paste may rely on tools (xdotool) or be unsupported on Wayland
      await window.electronAPI.writeClipboard("OpenWispr accessibility test");
      setAccessibilityPermissionGranted(true);

      const waylandNote =
        platform === "linux" && String(sessionType).toLowerCase() === "wayland"
          ? " Note: On Wayland, automatic Ctrl+V may not be available. The text was copied to clipboard successfully."
          : "";

      if (showAlertDialog) {
        showAlertDialog({
          title: "✅ Clipboard Test Successful",
          description:
            "Text copied to clipboard."
            + waylandNote,
        });
      } else {
        alert("✅ Text copied to clipboard." + waylandNote);
      }
    } catch (err: any) {
      console.error("Accessibility permission test failed:", err);
      const message = String(err?.message || err || "");

      // Special code from Linux path: clipboard succeeded, paste simulation failed
      if (err && (err as any)?.code === "PASTE_SIMULATION_FAILED") {
        try {
          // Ensure test text is at least in clipboard
          await window.electronAPI.writeClipboard("OpenWispr accessibility test");
        } catch (err) {
          console.error("Failed to copy test text to clipboard:", err);
        }
        setAccessibilityPermissionGranted(true);
        const note =
          "Text copied to clipboard. Auto-paste (Ctrl+V) not available: install a suitable tool (xdotool for X11, wtype/ydotool for Wayland) or paste manually.";
        if (showAlertDialog) {
          showAlertDialog({
            title: "✅ Clipboard Test Successful (Auto-paste unavailable)",
            description: note,
          });
        } else {
          alert("✅ Clipboard OK. " + note);
        }
        return;
      }

      if (showAlertDialog) {
        showAlertDialog({
          title: "❌ Accessibility/Clipboard Test Failed",
          description:
            "Could not copy/paste test text. Please try again or check system settings.",
        });
      } else {
        alert("❌ Could not copy/paste test text. Please check system settings.");
      }
    }
  }, [showAlertDialog]);

  return {
    micPermissionGranted,
    accessibilityPermissionGranted,
    requestMicPermission,
    testAccessibilityPermission,
    setMicPermissionGranted,
    setAccessibilityPermissionGranted,
  };
};
