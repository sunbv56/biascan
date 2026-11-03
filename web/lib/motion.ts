export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export const EASE_OUT = "expo.out";
export const EASE_IN = "power3.in";
