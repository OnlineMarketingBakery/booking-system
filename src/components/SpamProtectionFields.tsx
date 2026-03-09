import { useEffect } from "react";

const hiddenStyle: React.CSSProperties = {
  position: "absolute",
  left: "-9999px",
  width: 1,
  height: 1,
  opacity: 0,
  pointerEvents: "none",
  overflow: "hidden",
};

type SpamProtectionFieldsProps = {
  honeypotName: string;
  setFormStarted: () => void;
};

/**
 * Renders hidden honeypot and records form start time for spam protection.
 * Add inside every <form> and call validateSpamProtection(formData) in submit handler.
 */
export function SpamProtectionFields({ honeypotName, setFormStarted }: SpamProtectionFieldsProps) {
  useEffect(() => {
    setFormStarted();
  }, [setFormStarted]);

  return (
    <div aria-hidden="true" style={hiddenStyle}>
      <input
        type="text"
        name={honeypotName}
        tabIndex={-1}
        autoComplete="off"
        style={{ width: 1, height: 1, padding: 0, margin: 0, border: 0 }}
      />
    </div>
  );
}
