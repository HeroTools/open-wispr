import React, { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { Minus, Square, X, Copy } from "lucide-react";

export default function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let mounted = true;
    const syncIsMaximized = async () => {
      try {
        const isMaximized = await window.electronAPI?.windowIsMaximized?.();
        if (mounted) setIsMaximized(!!isMaximized);
      } catch {}
    };
    syncIsMaximized();
    const intervalId = setInterval(syncIsMaximized, 1000);
    return () => {
      mounted = false;
      clearInterval(intervalId);
    };
  }, []);

  return (
    <div className="flex items-center gap-1 pointer-events-auto">
      <Button
        variant="ghost"
        size="icon"
        onClick={async () => {
          await window.electronAPI?.windowMinimize?.();
        }}
        title="Minimize"
      >
        <Minus size={14} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={async () => {
          await window.electronAPI?.windowMaximize?.();
          const isMaximized = await window.electronAPI?.windowIsMaximized?.();
          setIsMaximized(!!isMaximized);
        }}
        title={isMaximized ? "Restore" : "Maximize"}
      >
        {isMaximized ? <Copy size={14} /> : <Square size={12} />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={async () => {
          await window.electronAPI?.windowClose?.();
        }}
        className="hover:text-red-600 hover:bg-red-50"
        title="Close"
      >
        <X size={14} />
      </Button>
    </div>
  );
}
