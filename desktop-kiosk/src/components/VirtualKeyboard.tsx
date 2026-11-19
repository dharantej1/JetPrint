import React, { useState } from "react";
import {
  Delete,
  CornerDownLeft,
  X,
  ArrowBigUp,
  Keyboard as KeyboardIcon,
} from "lucide-react";

export type KeyboardLayout = "letters" | "symbols";

export interface VirtualKeyboardProps {
  label?: string;
  value: string;
  onChange: (val: string) => void;
  onClose: () => void;
  onSubmit?: () => void;
  type?: "text" | "password" | "number" | "url";
}

const LETTERS_ROW_1 = ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"];
const LETTERS_ROW_2 = ["a", "s", "d", "f", "g", "h", "j", "k", "l"];
const LETTERS_ROW_3 = ["z", "x", "c", "v", "b", "n", "m"];

const SYMBOLS_ROW_1 = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
const SYMBOLS_ROW_2 = ["@", "#", "$", "%", "&", "-", "+", "(", ")", "/"];
const SYMBOLS_ROW_3 = ["*", "\"", "'", ":", ";", "!", "?", "_", "~"];

export const VirtualKeyboard: React.FC<VirtualKeyboardProps> = ({
  label,
  value,
  onChange,
  onClose,
  onSubmit,
  type = "text",
}) => {
  const [layout, setLayout] = useState<KeyboardLayout>("letters");
  const [capsLock, setCapsLock] = useState(false);
  const [shift, setShift] = useState(false);

  const isUppercase = capsLock || shift;

  const handleChar = (char: string) => {
    const nextChar = isUppercase ? char.toUpperCase() : char.toLowerCase();
    onChange(value + nextChar);
    if (shift && !capsLock) {
      setShift(false);
    }
  };

  const handleBackspace = () => {
    if (value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  const handleClear = () => {
    onChange("");
  };

  const toggleShift = () => {
    setShift((prev) => !prev);
  };

  const toggleCapsLock = () => {
    setCapsLock((prev) => !prev);
    setShift(false);
  };

  const row1 = layout === "letters" ? LETTERS_ROW_1 : SYMBOLS_ROW_1;
  const row2 = layout === "letters" ? LETTERS_ROW_2 : SYMBOLS_ROW_2;
  const row3 = layout === "letters" ? LETTERS_ROW_3 : SYMBOLS_ROW_3;

  return (
    <div
      className="vk-dock-overlay"
      role="region"
      aria-label="On-screen touch keyboard"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
    >
      <div className="vk-container" onClick={(e) => e.stopPropagation()}>
        <div className="vk-header">
          <div className="vk-header-title">
            <KeyboardIcon size={16} />
            <span>{label || "Touch Keyboard"}</span>
          </div>

          <div className="vk-live-preview">
            <div className="vk-live-value-wrap">
              {value ? (
                <span className="vk-live-value">
                  {type === "password" ? "•".repeat(value.length) : value}
                </span>
              ) : (
                <span className="vk-live-placeholder">
                  Type {label ? label.toLowerCase() : "value"}...
                </span>
              )}
              <span className="vk-live-cursor" />
            </div>
          </div>

          <div className="vk-header-actions">
            <button
              type="button"
              className="vk-action-btn vk-clear-btn"
              onClick={(e) => {
                e.stopPropagation();
                handleClear();
              }}
              title="Clear input"
            >
              Clear
            </button>
            <button
              type="button"
              className="vk-action-btn vk-close-btn"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              title="Hide keyboard"
              aria-label="Hide keyboard"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Number bar for letters mode */}
        {layout === "letters" && (
          <div className="vk-row vk-num-row">
            {SYMBOLS_ROW_1.map((num) => (
              <button
                key={num}
                type="button"
                className="vk-key vk-key-num"
                onClick={() => handleChar(num)}
              >
                {num}
              </button>
            ))}
          </div>
        )}

        {/* Row 1 */}
        <div className="vk-row">
          {row1.map((char) => (
            <button
              key={char}
              type="button"
              className="vk-key"
              onClick={() => handleChar(char)}
            >
              {isUppercase && layout === "letters" ? char.toUpperCase() : char}
            </button>
          ))}
        </div>

        {/* Row 2 */}
        <div className="vk-row">
          <div className="vk-spacer-half" />
          {row2.map((char) => (
            <button
              key={char}
              type="button"
              className="vk-key"
              onClick={() => handleChar(char)}
            >
              {isUppercase && layout === "letters" ? char.toUpperCase() : char}
            </button>
          ))}
          <div className="vk-spacer-half" />
        </div>

        {/* Row 3 with Shift and Backspace */}
        <div className="vk-row">
          {layout === "letters" ? (
            <button
              type="button"
              className={`vk-key vk-key-special vk-key-shift ${shift ? "active" : ""} ${capsLock ? "caps-active" : ""}`}
              onClick={toggleShift}
              onDoubleClick={toggleCapsLock}
              title="Shift (Double click for Caps Lock)"
              aria-label="Shift or Caps Lock"
            >
              <ArrowBigUp size={18} />
            </button>
          ) : (
            <button
              type="button"
              className="vk-key vk-key-special"
              onClick={() => handleChar("=")}
            >
              =
            </button>
          )}

          {row3.map((char) => (
            <button
              key={char}
              type="button"
              className="vk-key"
              onClick={() => handleChar(char)}
            >
              {isUppercase && layout === "letters" ? char.toUpperCase() : char}
            </button>
          ))}

          <button
            type="button"
            className="vk-key vk-key-special vk-key-backspace"
            onClick={handleBackspace}
            aria-label="Backspace"
            title="Backspace"
          >
            <Delete size={20} />
          </button>
        </div>

        {/* Row 4: Switch mode, Period, Slash, Space, Enter */}
        <div className="vk-row vk-bottom-row">
          <button
            type="button"
            className="vk-key vk-key-special vk-key-mode"
            onClick={() => setLayout((prev) => (prev === "letters" ? "symbols" : "letters"))}
          >
            {layout === "letters" ? "?123" : "ABC"}
          </button>

          <button
            type="button"
            className="vk-key vk-key-symbol"
            onClick={() => handleChar(".")}
          >
            .
          </button>

          <button
            type="button"
            className="vk-key vk-key-symbol"
            onClick={() => handleChar("/")}
          >
            /
          </button>

          <button
            type="button"
            className="vk-key vk-key-space"
            onClick={() => handleChar(" ")}
            aria-label="Spacebar"
          >
            Space
          </button>

          <button
            type="button"
            className="vk-key vk-key-symbol"
            onClick={() => handleChar("-")}
          >
            -
          </button>

          {type === "url" && (
            <button
              type="button"
              className="vk-key vk-key-special"
              onClick={() => {
                onChange(value + "http://");
              }}
            >
              http://
            </button>
          )}

          <button
            type="button"
            className="vk-key vk-key-enter"
            onClick={(e) => {
              e.stopPropagation();
              if (onSubmit) onSubmit();
              else onClose();
            }}
            aria-label="Enter or Done"
            title="Done"
          >
            <CornerDownLeft size={18} />
            <span>Done</span>
          </button>
        </div>
      </div>
    </div>
  );
};

