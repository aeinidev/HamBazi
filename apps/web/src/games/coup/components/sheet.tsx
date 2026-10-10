import { useEffect, useRef, type ReactNode } from "react";
export function TableSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="table-sheet"
      aria-label={title}
      onCancel={onClose}
      onClose={onClose}
    >
      <header>
        <h2>{title}</h2>
        <button onClick={onClose} aria-label="بستن پنجره">
          ×
        </button>
      </header>
      <div className="table-sheet-content">{children}</div>
    </dialog>
  );
}
