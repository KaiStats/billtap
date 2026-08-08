/**
 * Shared color tokens for the public marketing pages (Landing, About, Blog,
 * Security, Terms, Privacy). One source instead of six copies of the same hex
 * values, which is how Security/Terms/Privacy ended up on a white background
 * with an off-brand indigo/violet accent while the rest of the site is dark
 * navy and emerald.
 *
 * Not the app's own token system (see src/index.css's --brand etc.) — those
 * drive the authenticated product UI and are out of scope here. This file is
 * marketing-only, deliberately kept separate so a change to one never risks
 * the other.
 */
export const mkt = {
  bg: "#0a0e1a",
  bgAlt: "#111827",
  card: "#1e2533",
  border: "#2d3748",
  text: "#f2f2f4",
  muted: "#8b90a8",
  dim: "#4a5068",
  accent: "#00c896",
  accentInk: "#0a0e1a",
  danger: "#f87171",
};
