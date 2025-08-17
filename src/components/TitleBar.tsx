import React from "react";
import WindowControls from "./WindowControls";

interface TitleBarProps {
  title?: string;
  showTitle?: boolean;
  children?: React.ReactNode;
  className?: string;
  actions?: React.ReactNode;
}

export default function TitleBar({
  title = "",
  showTitle = false,
  children,
  className = "",
  actions,
}: TitleBarProps) {
  return (
    <div
      className={`bg-white border-b border-gray-100 select-none ${className}`}
    >
      <div
        className="flex items-center justify-between h-12 px-4"
        style={{ WebkitAppRegion: "drag" }}
      >
        {/* Left section - title or custom content */}
        <div className="flex items-center gap-2">
          {showTitle && title && (
            <h1 className="text-sm font-semibold text-gray-900">{title}</h1>
          )}
          {children}
        </div>

        {/* Right section - actions */}
        <div 
          className="flex items-center gap-2"
          style={{ WebkitAppRegion: "no-drag" }}
        >
          {actions}
          {process.platform !== "darwin" ? <WindowControls /> : null}
        </div>
      </div>
    </div>
  );
}
