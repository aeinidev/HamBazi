import { useCallback, useEffect, useState } from "react";
import "./fitted-page-scroll.css";

let owner: HTMLElement | null = null;

/** Lock only a measured, short page. Overflowing content and game routes stay scrollable. */
export function useFittedPageScroll<T extends HTMLElement>(enabled = true) {
  const [page, setPage] = useState<T | null>(null);
  const ref = useCallback((node: T | null) => setPage(node), []);
  useEffect(() => {
    if (!page || !enabled) return;
    let frame = 0;
    let start: { x: number; y: number } | null = null;
    const root = document.documentElement;
    function unlock() {
      if (owner !== page) return;
      root.removeAttribute("data-fitted-page");
      owner = null;
    }
    function measure() {
      frame = 0;
      if (!page!.isConnected) return;
      const viewport = window.visualViewport;
      const height = Math.min(innerHeight, viewport?.height ?? innerHeight);
      const bounds = page!.getBoundingClientRect();
      const extent = Math.max(
        bounds.top + scrollY + page!.scrollHeight,
        bounds.bottom + scrollY,
        document.body.scrollHeight,
        root.scrollHeight,
      );
      const fits =
        extent <= height + 1 &&
        root.scrollWidth <= innerWidth + 1 &&
        (viewport?.scale ?? 1) <= 1.01;
      if (!fits) return unlock();
      const wasFixed = owner === page;
      owner = page;
      root.dataset.fittedPage = "true";
      if (!wasFixed) window.scrollTo(0, 0);
    }
    function schedule() {
      if (!frame) frame = requestAnimationFrame(measure);
    }
    function touchStart(event: TouchEvent) {
      const touch = event.touches.length === 1 ? event.touches[0] : undefined;
      start = touch ? { x: touch.clientX, y: touch.clientY } : null;
    }
    function touchMove(event: TouchEvent) {
      if (owner !== page || !start || event.touches.length !== 1 || !event.cancelable) return;
      const touch = event.touches[0]!;
      const dy = touch.clientY - start.y;
      const dx = touch.clientX - start.x;
      start = { x: touch.clientX, y: touch.clientY };
      if (Math.abs(dy) <= Math.abs(dx)) return;
      const target = event.target instanceof Element ? event.target : null;
      // Keep native editing, selection and pickers available.
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      for (const node of event.composedPath()) {
        if (!(node instanceof HTMLElement) || node === page) continue;
        if (!/^(auto|scroll)$/.test(getComputedStyle(node).overflowY)) continue;
        const maximum = node.scrollHeight - node.clientHeight;
        if (maximum > 1 && (dy < 0 ? node.scrollTop < maximum - 1 : node.scrollTop > 0)) return;
      }
      // iOS fallback: prevent elastic movement and chaining at a nested sheet's edge.
      event.preventDefault();
    }
    const resize = new ResizeObserver(schedule);
    resize.observe(page);
    for (const child of page.querySelectorAll(":scope > *, main > *")) resize.observe(child);
    const mutations = new MutationObserver(schedule);
    // Notices may be siblings of the page (for example a lobby task error).
    mutations.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    });
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    document.fonts.addEventListener("loadingdone", schedule);
    page.addEventListener("load", schedule, true);
    page.addEventListener("focusin", schedule);
    page.addEventListener("focusout", schedule);
    document.addEventListener("touchstart", touchStart, { passive: true });
    document.addEventListener("touchmove", touchMove, { passive: false });
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      document.fonts.removeEventListener("loadingdone", schedule);
      page.removeEventListener("load", schedule, true);
      page.removeEventListener("focusin", schedule);
      page.removeEventListener("focusout", schedule);
      document.removeEventListener("touchstart", touchStart);
      document.removeEventListener("touchmove", touchMove);
      unlock();
    };
  }, [page, enabled]);
  return ref;
}
