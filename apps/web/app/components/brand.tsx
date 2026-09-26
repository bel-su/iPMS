/**
 * AXIOM brand artwork, served from /public/brand.
 *
 * The full logo shows on the sign-in screen and in the expanded sidebar; the
 * collapsed rail and the standalone cards show just the "A" mark. Plain <img> on purpose: they are static SVGs
 * and gain nothing from the image optimiser.
 */

export function BrandMark({ size = 32 }: { size?: number }) {
  // viewBox is 387×346, so the height follows from the width.
  return <img className="brand-mark" src="/brand/axiom-mark.svg" alt="AXIOM" width={size} height={Math.round(size * 346 / 387)} />;
}

export function BrandLogo({ width = 320 }: { width?: number }) {
  // viewBox is 1267×346.
  return <img className="brand-logo" src="/brand/axiom-logo-horizontal.svg" alt="AXIOM — Engineering Project Assurance Platform" width={width} height={Math.round(width * 346 / 1267)} />;
}
