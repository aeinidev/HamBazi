import { useEffect, useId, useRef, type ReactNode } from "react";
export function KahrobaSheet({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null),
    id = useId();
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null,
      bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.querySelector<HTMLElement>("button,input,select")?.focus();
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      if (e.key !== "Tab") return;
      const elements = [
        ...ref.current!.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]',
        ),
      ];
      const first = elements[0],
        last = elements.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = bodyOverflow;
      document.removeEventListener("keydown", key);
      prior?.focus();
    };
  }, []);
  return (
    <div
      className="kh-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className="kh-sheet"
        dir="rtl"
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
      >
        <div className="kh-sheet-head">
          <h2 id={id}>{title}</h2>
          <button aria-label="بستن" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
