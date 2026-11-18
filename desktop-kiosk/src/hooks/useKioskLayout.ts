import { useCallback, useEffect, useRef, useState } from "react";

export type KioskLayoutMode = "side-by-side" | "stacked-tall" | "single-view";

export interface KioskLayoutResult {
  layoutMode: KioskLayoutMode;
  isSingleView: boolean;
  containerRef: React.RefObject<HTMLDivElement>;
  dimensions: { width: number; height: number };
}

/**
 * Natural UI dimension requirements:
 * - Each panel (QrPanel, OtpKeypad) has a minimum comfortable width of ~360px and ~460px height.
 * - Side-by-side needs at least 2 panels + container gap (~740px container width or ~840px window width).
 * - Dual-stacking needs sufficient vertical height for 2 panels + header + margins without clipping (~980px container height or ~1150px window height).
 * - Single-view is activated whenever horizontal or vertical constraints cannot cleanly fit both panels.
 */
const CONTAINER_MIN_SIDE_BY_SIDE_WIDTH = 740;
const CONTAINER_MIN_SIDE_BY_SIDE_HEIGHT = 440;
const CONTAINER_MIN_STACKED_TALL_HEIGHT = 1200;

const VIEWPORT_MIN_SIDE_BY_SIDE_WIDTH = 840;
const VIEWPORT_MIN_SIDE_BY_SIDE_HEIGHT = 500;
const VIEWPORT_MIN_STACKED_TALL_HEIGHT = 1350;

export function computeKioskLayoutMode(
  width: number,
  height: number,
  isContainer = false
): KioskLayoutMode {
  const minStackedH = isContainer
    ? CONTAINER_MIN_STACKED_TALL_HEIGHT
    : VIEWPORT_MIN_STACKED_TALL_HEIGHT;
  const minSideW = isContainer
    ? CONTAINER_MIN_SIDE_BY_SIDE_WIDTH
    : VIEWPORT_MIN_SIDE_BY_SIDE_WIDTH;
  const minSideH = isContainer
    ? CONTAINER_MIN_SIDE_BY_SIDE_HEIGHT
    : VIEWPORT_MIN_SIDE_BY_SIDE_HEIGHT;

  // Tall commercial totems (portrait orientation with ample vertical space)
  if (height >= minStackedH && height > width) {
    return "stacked-tall";
  }

  // Side-by-side (adequate width & height, not an extreme vertical aspect ratio)
  if (width >= minSideW && height >= minSideH && width >= height * 0.75) {
    return "side-by-side";
  }

  // Single-view: constrained dimensions where mounting both cards would cause overflow or clipping
  return "single-view";
}

export function useKioskLayout(): KioskLayoutResult {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const getInitialDimensions = () => {
    if (typeof window !== "undefined") {
      return { width: window.innerWidth, height: window.innerHeight };
    }
    return { width: 1280, height: 800 };
  };

  const [dimensions, setDimensions] = useState(getInitialDimensions);
  const [layoutMode, setLayoutMode] = useState<KioskLayoutMode>(() => {
    const init = getInitialDimensions();
    return computeKioskLayoutMode(init.width, init.height, false);
  });

  const updateLayout = useCallback((w: number, h: number, isContainer: boolean) => {
    if (w <= 0 || h <= 0) return;
    setDimensions({ width: w, height: h });
    setLayoutMode(computeKioskLayoutMode(w, h, isContainer));
  }, []);

  useEffect(() => {
    const element = containerRef.current;
    let observer: ResizeObserver | null = null;

    if (typeof ResizeObserver !== "undefined" && element) {
      observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          if (width > 0 && height > 0) {
            updateLayout(width, height, true);
          }
        }
      });
      observer.observe(element);
    }

    const handleWindowResize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          updateLayout(rect.width, rect.height, true);
          return;
        }
      }
      updateLayout(window.innerWidth, window.innerHeight, false);
    };

    window.addEventListener("resize", handleWindowResize);

    const mql =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(orientation: portrait)")
        : null;

    const handleMediaChange = () => {
      handleWindowResize();
    };

    if (mql) {
      if (mql.addEventListener) {
        mql.addEventListener("change", handleMediaChange);
      } else {
        (mql as any).addListener(handleMediaChange);
      }
    }

    // Measure initially mounted container rect
    if (element) {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        updateLayout(rect.width, rect.height, true);
      }
    }

    return () => {
      if (observer) {
        observer.disconnect();
      }
      window.removeEventListener("resize", handleWindowResize);
      if (mql) {
        if (mql.removeEventListener) {
          mql.removeEventListener("change", handleMediaChange);
        } else {
          (mql as any).removeListener(handleMediaChange);
        }
      }
    };
  }, [updateLayout]);

  const isSingleView = layoutMode === "single-view";

  return {
    layoutMode,
    isSingleView,
    containerRef,
    dimensions,
  };
}
