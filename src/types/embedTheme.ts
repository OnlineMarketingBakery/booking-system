export type EmbedTheme = {
  primaryColor?: string;
  primaryColorOpacity?: number; // 0-100
  primaryForegroundColor?: string;
  primaryForegroundColorOpacity?: number;
  backgroundColor?: string;
  backgroundColorOpacity?: number;
  cardBackgroundColor?: string;
  cardBackgroundColorOpacity?: number;
  headingColor?: string;
  headingColorOpacity?: number;
  bodyTextColor?: string;
  bodyTextColorOpacity?: number;
  mutedTextColor?: string;
  mutedTextColorOpacity?: number;
  cardBorderColor?: string;
  cardBorderColorOpacity?: number;
  cardBorderWidth?: number; // px
  /** Outline/secondary button (e.g. location selector) */
  buttonBackgroundColor?: string;
  buttonTextColor?: string;
  buttonBorderColor?: string;
  buttonHoverBackgroundColor?: string;
  buttonHoverTextColor?: string;
  buttonActiveBackgroundColor?: string;
  buttonActiveTextColor?: string;
  buttonFocusRingColor?: string;
  /** Form input fields (Name, Email, Phone) */
  inputBackgroundColor?: string;
  inputTextColor?: string;
  inputBorderColor?: string;
  inputPlaceholderColor?: string;
  /** Booking Summary panel */
  summaryBackgroundColor?: string;
  summaryTitleColor?: string;
  summaryTextColor?: string;
  summaryBorderColor?: string;
  summarySeparatorColor?: string;
  /** Custom CSS (applied inside the booking widget; scope with .embed-booking-widget) */
  customCss?: string;
  /** Step progress pills (completed = past steps, current = active step, default = not reached) */
  stepPillCompletedColor?: string;
  stepPillCurrentColor?: string;
  stepPillDefaultColor?: string;
  textColor?: string;
  headingText?: string;
  subheadingText?: string;
};

export const DEFAULT_EMBED_THEME: EmbedTheme = {
  primaryColor: "#3990F0",
  primaryForegroundColor: "#ffffff",
  backgroundColor: "#f5f5f5",
  cardBackgroundColor: "#ffffff",
  headingColor: "#111827",
  bodyTextColor: "#1f2937",
  mutedTextColor: "#6b7280",
  cardBorderColor: "#e5e7eb",
  cardBorderWidth: 1,
  buttonBackgroundColor: "#ffffff",
  buttonTextColor: "#1f2937",
  buttonBorderColor: "#e5e7eb",
  buttonHoverBackgroundColor: "#f3f4f6",
  buttonHoverTextColor: "#111827",
  buttonActiveBackgroundColor: "#e5e7eb",
  buttonActiveTextColor: "#111827",
  buttonFocusRingColor: "#3990F0",
  inputBackgroundColor: "#ffffff",
  inputTextColor: "#1f2937",
  inputBorderColor: "#e5e7eb",
  inputPlaceholderColor: "#9ca3af",
  summaryBackgroundColor: "#f9fafb",
  summaryTitleColor: "#6b7280",
  summaryTextColor: "#1f2937",
  summaryBorderColor: "#e5e7eb",
  summarySeparatorColor: "#e5e7eb",
  stepPillCompletedColor: "#3990F0",
  stepPillCurrentColor: "#ffffff",
  stepPillDefaultColor: "#e5e7eb",
  textColor: "#1f2937",
  headingText: "Book an appointment",
  subheadingText: "Choose your service and time",
};

/** Relative luminance (0–1). Used to pick contrasting text on a background. */
export function getLuminance(hex: string): number {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return 0.5;
  const [r, g, b] = [result[1], result[2], result[3]].map((s) => parseInt(s, 16) / 255);
  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** Return foreground and muted text hex colors that contrast with the given background. */
export function getContrastingTextColors(backgroundHex: string): { foreground: string; muted: string } {
  const hex = backgroundHex.replace(/^#/, "");
  const six = hex.length === 3
    ? `${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`
    : hex;
  const luminance = getLuminance(six.length === 6 ? `#${six}` : "#ffffff");
  const isDark = luminance < 0.4;
  if (isDark) {
    return { foreground: "#ffffff", muted: "#a3a3a3" };
  }
  return { foreground: "#111827", muted: "#6b7280" };
}

/** Build a full EmbedTheme from the three base colors: primary, card, and text (derived from card). */
export function buildFullThemeFromColors(options: {
  primaryColor: string;
  primaryColorOpacity?: number;
  cardBackgroundColor: string;
  cardBackgroundColorOpacity?: number;
  headingText?: string;
  subheadingText?: string;
  customCss?: string;
}): EmbedTheme {
  const { primaryColor, cardBackgroundColor } = options;
  const primaryOpacity = options.primaryColorOpacity ?? 100;
  const cardOpacity = options.cardBackgroundColorOpacity ?? 100;
  const onPrimary = getContrastingTextColors(primaryColor);
  const onCard = getContrastingTextColors(cardBackgroundColor);
  return {
    ...DEFAULT_EMBED_THEME,
    primaryColor,
    primaryColorOpacity: primaryOpacity,
    primaryForegroundColor: onPrimary.foreground,
    primaryForegroundColorOpacity: 100,
    cardBackgroundColor,
    cardBackgroundColorOpacity: cardOpacity,
    headingText: options.headingText ?? DEFAULT_EMBED_THEME.headingText,
    subheadingText: options.subheadingText ?? DEFAULT_EMBED_THEME.subheadingText,
    customCss: options.customCss ?? "",
    buttonBackgroundColor: cardBackgroundColor,
    buttonTextColor: onCard.foreground,
    buttonBorderColor: primaryColor,
    buttonHoverBackgroundColor: cardBackgroundColor,
    buttonHoverTextColor: onCard.foreground,
    buttonActiveBackgroundColor: cardBackgroundColor,
    buttonActiveTextColor: onCard.foreground,
    buttonFocusRingColor: primaryColor,
    inputBackgroundColor: cardBackgroundColor,
    inputTextColor: onCard.foreground,
    inputBorderColor: primaryColor,
    inputPlaceholderColor: onCard.muted,
    summaryBackgroundColor: cardBackgroundColor,
    summaryTitleColor: onCard.muted,
    summaryTextColor: onCard.foreground,
    summaryBorderColor: primaryColor,
    summarySeparatorColor: primaryColor,
    stepPillCompletedColor: primaryColor,
    stepPillCurrentColor: onPrimary.foreground,
    stepPillDefaultColor: onCard.muted,
    cardBorderColor: primaryColor,
    cardBorderColorOpacity: 100,
    cardBorderWidth: 1,
  };
}

/** Convert hex to HSL string "H S% L%" for CSS variables */
export function hexToHsl(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return "262 83% 58%";
  let r = parseInt(result[1], 16) / 255;
  let g = parseInt(result[2], 16) / 255;
  let b = parseInt(result[3], 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      default: h = ((r - g) / d + 4) / 6; break;
    }
  }
  h = Math.round(h * 360);
  s = Math.round(s * 100);
  const lR = Math.round(l * 100);
  return `${h} ${s}% ${lR}%`;
}

/** Convert hex to "H S% L%" with optional alpha for CSS "H S% L% / a" */
export function hexToHslWithAlpha(hex: string, alpha?: number): string {
  const base = hexToHsl(hex);
  if (alpha != null && alpha < 100) return `${base} / ${(alpha / 100).toFixed(2)}`;
  return base;
}

/** Convert hex to "r, g, b" for rgba(r, g, b, a) */
export function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return "124, 58, 237"; // fallback purple
  return [
    parseInt(result[1], 16),
    parseInt(result[2], 16),
    parseInt(result[3], 16),
  ].join(", ");
}

/** Return rgba(r,g,b,alpha) from hex and 0-100 opacity (default 100 = opaque) */
export function hexToRgba(hex: string, opacityPercent?: number): string {
  const a = opacityPercent == null || opacityPercent >= 100 ? 1 : Math.min(100, Math.max(0, opacityPercent)) / 100;
  return `rgba(${hexToRgb(hex)}, ${a})`;
}

/** Parse "rgba(r,g,b,a)" or "#rrggbb" from input; returns hex + opacity 0-100 or null */
export function parseRgbaOrHex(input: string): { hex: string; opacity: number } | null {
  const t = input.trim();
  const hexMatch = /^#?([a-f\d]{6})$/i.exec(t);
  if (hexMatch) {
    return { hex: "#" + hexMatch[1].toLowerCase(), opacity: 100 };
  }
  const rgbaMatch = /rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/i.exec(t);
  if (rgbaMatch) {
    const r = Math.min(255, parseInt(rgbaMatch[1], 10));
    const g = Math.min(255, parseInt(rgbaMatch[2], 10));
    const b = Math.min(255, parseInt(rgbaMatch[3], 10));
    const a = rgbaMatch[4] != null ? Math.min(1, Math.max(0, parseFloat(rgbaMatch[4]))) : 1;
    const hex = "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
    return { hex, opacity: Math.round(a * 100) };
  }
  return null;
}
