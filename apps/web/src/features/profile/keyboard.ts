import { useEffect, type RefObject } from "react";

/** Keep soft-keyboard sizing local to the profile; focus alone also occurs with hardware keyboards. */
export function useProfileKeyboard(
  hub: RefObject<HTMLElement | null>,
  content: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    const shell = hub.current?.closest<HTMLElement>(".midnight-shell");
    const main = shell?.querySelector<HTMLElement>(":scope > main");
    const app = window.Telegram?.WebApp;
    const mobile =
      ["ios", "android", "android_x"].includes(app?.platform ?? "") ||
      window.matchMedia("(pointer: coarse)").matches;
    if (!shell || !main || !mobile) return;
    const viewport = window.visualViewport;
    const height = () =>
      Math.min(
        innerHeight,
        viewport?.height ?? innerHeight,
        app?.viewportHeight && app.viewportHeight > 0 ? app.viewportHeight : innerHeight,
      );
    let baseline = height(),
      width = innerWidth,
      opened = false,
      frame = 0,
      closing = 0;
    let scroll: { inner: number; main: number; x: number; y: number } | null = null;
    const field = () => {
      const active = document.activeElement;
      return active instanceof HTMLInputElement &&
        hub.current?.contains(active) &&
        active.matches("#profile-name, #profile-username")
        ? active
        : null;
    };
    function remember() {
      scroll ??= {
        inner: content.current?.scrollTop ?? 0,
        main: main!.scrollTop,
        x: scrollX,
        y: scrollY,
      };
    }
    function pin() {
      shell!.dataset.profileViewport = "true";
      shell!.style.setProperty("--profile-viewport-height", `${height()}px`);
      shell!.style.setProperty("--profile-viewport-top", `${viewport?.offsetTop ?? 0}px`);
    }
    function release() {
      delete shell!.dataset.profileViewport;
      shell!.style.removeProperty("--profile-viewport-height");
      shell!.style.removeProperty("--profile-viewport-top");
    }
    function close() {
      closing = 0;
      opened = false;
      delete shell!.dataset.profileKeyboard;
      const normal = Math.min(innerHeight, app?.viewportStableHeight || innerHeight);
      // Keep the final frame until Telegram's stable size catches up with iOS's visible viewport.
      if (Math.abs(normal - height()) <= 1) release();
      else pin();
      if (scroll) {
        main!.scrollTop = scroll.main;
        if (content.current) content.current.scrollTop = scroll.inner;
        window.scrollTo(scroll.x, scroll.y);
      }
      if (content.current?.querySelector('[role="alert"]'))
        content.current.scrollTop = content.current.scrollHeight;
      scroll = null;
      baseline = height();
    }
    function measure() {
      frame = 0;
      if ((viewport?.scale ?? 1) > 1.05) return;
      const active = field();
      if (!opened && !active) {
        scroll = null;
        baseline = height();
        width = innerWidth;
        if (shell!.dataset.profileViewport) close();
        return;
      }
      if (width !== innerWidth) {
        // Android can resize both viewports: the previous screen width gives the rotated full-height axis.
        baseline = opened ? Math.max(height(), width) : height();
        width = innerWidth;
      }
      const reduced = baseline - height() > (opened ? 64 : Math.max(120, baseline * 0.15));
      clearTimeout(closing);
      closing = 0;
      if (reduced && (active || opened)) {
        if (!opened) {
          remember();
          opened = true;
          shell!.dataset.profileKeyboard = "true";
        }
        pin();
        if (active) {
          const bounds = active.getBoundingClientRect(),
            area = main!.getBoundingClientRect();
          const top = Math.max(area.top, viewport?.offsetTop ?? 0) + 12;
          const bottom = Math.min(area.bottom, (viewport?.offsetTop ?? 0) + height()) - 12;
          if (bounds.bottom > bottom) main!.scrollTop += bounds.bottom - bottom;
          else if (bounds.top < top) main!.scrollTop += bounds.top - top;
        }
      } else if (opened) {
        pin();
        closing = window.setTimeout(close, 120);
      } else if (shell!.dataset.profileViewport) close();
    }
    function schedule() {
      if (!frame) frame = requestAnimationFrame(measure);
    }
    function focus() {
      if (field() && !opened) remember();
      schedule();
    }
    hub.current?.addEventListener("focusin", focus);
    hub.current?.addEventListener("focusout", schedule);
    window.addEventListener("resize", schedule);
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    app?.onEvent("viewportChanged", schedule);
    const element = hub.current;
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(closing);
      element?.removeEventListener("focusin", focus);
      element?.removeEventListener("focusout", schedule);
      window.removeEventListener("resize", schedule);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      app?.offEvent("viewportChanged", schedule);
      delete shell.dataset.profileKeyboard;
      release();
    };
  }, [hub, content]);
}
