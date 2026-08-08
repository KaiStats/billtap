import { useState } from "react";
import { QrCode } from "lucide-react";
import { art, artSrcSet, artSizes } from "@/lib/landing-assets";
import { mkt } from "./tokens";

/**
 * The BillTap mark, shared across every public marketing page so the same
 * Higgsfield render — not a placeholder glyph — shows up everywhere. Falls
 * back to the lucide glyph only if the render fails to load, because a nav
 * with no logo at all is worse than a generic one.
 */
export default function Logo({ size = 32 }) {
  const [failed, setFailed] = useState(false);
  const src = art("logo");
  if (!src || failed) {
    return (
      <div
        className="rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: mkt.accent, width: size, height: size }}
      >
        <QrCode className="text-white" style={{ width: size * 0.62, height: size * 0.62 }} />
      </div>
    );
  }
  return (
    <img
      src={src}
      srcSet={artSrcSet("logo") || undefined}
      sizes={artSizes("logo") || undefined}
      alt="BillTap"
      width={size}
      height={size}
      decoding="async"
      onError={() => setFailed(true)}
      className="rounded-lg flex-shrink-0 object-cover"
      style={{ width: size, height: size }}
    />
  );
}
