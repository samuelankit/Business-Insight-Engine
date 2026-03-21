// GoRigo brand colors — gold on near-black dark theme
export const COLORS = {
  background: "#0A0A0A",
  surface: "#1A1A1A",
  gold: "#F5A623",
  goldDark: "#E6940F",
  text: "#FFFFFF",
  textSecondary: "#8A8A8A",
  border: "#2A2A2A",
  success: "#22C55E",
  error: "#EF4444",
};

const GOLD = "#F5A623";
const GOLD_DARK = "#E6940F";
const GOLD_LIGHT = "#FFF3DC";
const GOLD_MUTED = "rgba(245, 166, 35, 0.15)";

const createStyles = (isDark: boolean) => ({
  background: isDark ? "#0A0A0A" : "#FAFAFA",
  backgroundSecondary: isDark ? "#141414" : "#FFFFFF",
  backgroundTertiary: isDark ? "#1E1E1E" : "#F4F4F4",
  surface: isDark ? "#1A1A1A" : "#FFFFFF",
  surfaceElevated: isDark ? "#222222" : "#FFFFFF",
  border: isDark ? "#2A2A2A" : "#E8E8E8",
  borderFaint: isDark ? "#1E1E1E" : "#F0F0F0",
  text: isDark ? "#FFFFFF" : "#0A0A0A",
  textSecondary: isDark ? "#8A8A8A" : "#6B6B6B",
  textTertiary: isDark ? "#555555" : "#9A9A9A",
  textInverse: isDark ? "#0A0A0A" : "#FFFFFF",
  gold: GOLD,
  goldDark: GOLD_DARK,
  goldLight: GOLD_LIGHT,
  goldMuted: GOLD_MUTED,
  tint: GOLD,
  tabIconDefault: isDark ? "#444444" : "#BBBBBB",
  tabIconSelected: GOLD,
  success: "#22C55E",
  successBg: isDark ? "rgba(34, 197, 94, 0.15)" : "rgba(34, 197, 94, 0.1)",
  warning: "#F59E0B",
  warningBg: isDark ? "rgba(245, 158, 11, 0.15)" : "rgba(245, 158, 11, 0.1)",
  error: "#EF4444",
  errorBg: isDark ? "rgba(239, 68, 68, 0.15)" : "rgba(239, 68, 68, 0.1)",
  info: "#3B82F6",
  infoBg: isDark ? "rgba(59, 130, 246, 0.15)" : "rgba(59, 130, 246, 0.1)",
  shadowColor: isDark ? "#000000" : "#000000",
  overlay: "rgba(0, 0, 0, 0.6)",
});

export type ColorTheme = ReturnType<typeof createStyles>;

const Colors = {
  light: createStyles(false),
  dark: createStyles(true),
  gold: GOLD,
  goldDark: GOLD_DARK,
  goldLight: GOLD_LIGHT,
  goldMuted: GOLD_MUTED,
};

export { createStyles };
export default Colors;
