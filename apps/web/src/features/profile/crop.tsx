import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
} from "react";
import { cropGesture, cropRect, type CropPoint, type CropView } from "./image.js";

function paint(canvas: HTMLCanvasElement, image: HTMLImageElement, view: CropView) {
  const context = canvas.getContext("2d");
  if (!context) return false;
  const rect = cropRect(image.naturalWidth, image.naturalHeight, view.zoom, view.x, view.y);
  context.fillStyle = "#07152c";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, rect.x, rect.y, rect.size, rect.size, 0, 0, canvas.width, canvas.height);
  return true;
}

export function AvatarCrop({
  image,
  returnFocus,
  onCancel,
  onApply,
}: {
  image: HTMLImageElement;
  returnFocus: RefObject<HTMLElement | null>;
  onCancel(): void;
  onApply(value: string): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const pointers = useRef(new Map<number, CropPoint>());
  const gesture = useRef<{ view: CropView; points: CropPoint[] } | null>(null);
  const current = useRef<CropView>({ zoom: 1, x: 0, y: 0 });
  const [view, setView] = useState(current.current);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const modal = dialog.current!;
    // Decoding disables the file input, which can blur it before this modal mounts.
    const previousFocus = returnFocus.current ?? (document.activeElement as HTMLElement | null);
    const body = document.body;
    const properties = ["position", "top", "left", "width", "overflow"] as const;
    const before = properties.map(
      (name) =>
        [name, body.style.getPropertyValue(name), body.style.getPropertyPriority(name)] as const,
    );
    const scroll = { x: scrollX, y: scrollY };
    const background = [
      ...document.querySelectorAll<HTMLElement>(".profile-content, .midnight-shell > main"),
    ];
    const overflow = background.map((element) => element.style.overflowY);
    body.style.position = "fixed";
    body.style.top = `${-scroll.y}px`;
    body.style.left = `${-scroll.x}px`;
    body.style.width = "100%";
    body.style.overflow = "hidden";
    for (const element of background) element.style.overflowY = "hidden";
    const viewport = window.visualViewport;
    function resize() {
      modal.style.setProperty("--crop-viewport-height", `${viewport?.height ?? innerHeight}px`);
      modal.style.setProperty("--crop-viewport-top", `${viewport?.offsetTop ?? 0}px`);
      pointers.current.clear();
      gesture.current = null;
      setDragging(false);
    }
    resize();
    modal.showModal();
    modal.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
    window.addEventListener("resize", resize);
    window.addEventListener("blur", resize);
    viewport?.addEventListener("resize", resize);
    viewport?.addEventListener("scroll", resize);
    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("blur", resize);
      viewport?.removeEventListener("resize", resize);
      viewport?.removeEventListener("scroll", resize);
      modal.close();
      for (const [name, value, priority] of before) {
        if (value) body.style.setProperty(name, value, priority);
        else body.style.removeProperty(name);
      }
      background.forEach((element, index) => {
        element.style.overflowY = overflow[index]!;
      });
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      window.scrollTo(scroll.x, scroll.y);
    };
  }, [returnFocus]);
  useLayoutEffect(() => {
    if (canvas.current) paint(canvas.current, image, view);
  }, [image, view]);
  function update(next: CropView) {
    current.current = next;
    setView(next);
    setError("");
  }
  function rebase() {
    gesture.current = pointers.current.size
      ? { view: current.current, points: [...pointers.current.values()] }
      : null;
    setDragging(pointers.current.size > 0);
  }
  function point(event: PointerEvent<HTMLCanvasElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) / bounds.width,
      y: (event.clientY - bounds.top) / bounds.height,
    };
  }
  function end(event: PointerEvent<HTMLCanvasElement>) {
    if (!pointers.current.delete(event.pointerId)) return;
    rebase();
  }
  function apply() {
    try {
      if (!canvas.current || !paint(canvas.current, image, current.current)) throw new Error();
      const value = canvas.current.toDataURL("image/jpeg", 0.88);
      if (value.length > 240000) throw new Error();
      onApply(value);
    } catch {
      setError("ذخیرهٔ عکس ممکن نشد؛ دوباره تلاش کنید.");
    }
  }
  return (
    <dialog
      ref={dialog}
      className="profile-crop-dialog"
      aria-labelledby="crop-heading"
      aria-describedby="crop-help"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <div className="profile-crop-panel">
        <header className="profile-crop-heading">
          <div>
            <span className="profile-crop-eyebrow">چهرهٔ تو در هم‌بازی</span>
            <h2 id="crop-heading" tabIndex={-1}>
              تنظیم عکس پروفایل
            </h2>
          </div>
          <button
            type="button"
            className="profile-crop-close"
            aria-label="بستن تنظیم عکس"
            onClick={onCancel}
          >
            ×
          </button>
        </header>
        <p id="crop-help">عکس را بکشید؛ با دو انگشت نزدیک یا دور کنید.</p>
        <div className="profile-crop-stage">
          <canvas
            ref={canvas}
            width={384}
            height={384}
            className="profile-crop-preview"
            data-dragging={dragging}
            tabIndex={0}
            role="img"
            aria-label="پیش‌نمایش کراپ دایره‌ای"
            aria-describedby="crop-keyboard-help"
            onPointerDown={(event) => {
              if (event.pointerType === "mouse" && event.button !== 0) return;
              if (pointers.current.size >= 2) return;
              event.preventDefault();
              pointers.current.set(event.pointerId, point(event));
              event.currentTarget.setPointerCapture(event.pointerId);
              rebase();
            }}
            onPointerMove={(event) => {
              if (!pointers.current.has(event.pointerId) || !gesture.current) return;
              event.preventDefault();
              pointers.current.set(event.pointerId, point(event));
              update(
                cropGesture(
                  image.naturalWidth,
                  image.naturalHeight,
                  gesture.current.view,
                  gesture.current.points,
                  [...pointers.current.values()],
                ),
              );
            }}
            onPointerUp={end}
            onPointerCancel={end}
            onLostPointerCapture={end}
            onKeyDown={(event) => {
              const centre = { x: 0.5, y: 0.5 };
              const moves: Record<string, CropPoint> = {
                ArrowLeft: { x: 0.45, y: 0.5 },
                ArrowRight: { x: 0.55, y: 0.5 },
                ArrowUp: { x: 0.5, y: 0.45 },
                ArrowDown: { x: 0.5, y: 0.55 },
              };
              if (moves[event.key]) {
                event.preventDefault();
                update(
                  cropGesture(
                    image.naturalWidth,
                    image.naturalHeight,
                    current.current,
                    [centre],
                    [moves[event.key]!],
                  ),
                );
              } else if (["+", "=", "-", "_"].includes(event.key)) {
                event.preventDefault();
                const half = ["+", "="].includes(event.key) ? 0.22 : 0.18;
                update(
                  cropGesture(
                    image.naturalWidth,
                    image.naturalHeight,
                    current.current,
                    [
                      { x: 0.3, y: 0.5 },
                      { x: 0.7, y: 0.5 },
                    ],
                    [
                      { x: 0.5 - half, y: 0.5 },
                      { x: 0.5 + half, y: 0.5 },
                    ],
                  ),
                );
              }
            }}
          />
        </div>
        <p id="crop-keyboard-help" className="profile-crop-hint">
          با ماوس بکشید یا از کلیدهای جهت و + و − استفاده کنید.
        </p>
        {error && <p role="alert">{error}</p>}
        <div className="profile-crop-actions">
          <button type="button" className="profile-save" onClick={apply}>
            استفاده از این عکس
          </button>
          <button type="button" className="secondary" onClick={onCancel}>
            انصراف
          </button>
        </div>
      </div>
    </dialog>
  );
}
