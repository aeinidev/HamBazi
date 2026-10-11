import { MidnightIcon, OrnateFrame } from "../../../ui/midnight.js";
import { go } from "../../../ui/shared.js";

export function CoupEntry({ onStart, pending }: { onStart: () => void; pending: boolean }) {
  return (
    <section className="midnight-coup-entry" aria-labelledby="coup-entry-heading">
      <OrnateFrame className="coup-hero">
        <img
          src="/assets/home/coup-2811ce0e87a8.webp"
          alt="شخصیت کلاه‌دار، کارت‌های ملکه و شاه و سکه‌های طلایی"
          width="1200"
          height="676"
        />
        <div className="hero-plaque">
          <h1 id="coup-entry-heading">کودتا</h1>
        </div>
      </OrnateFrame>
      <div className="coup-entry-options">
        <button className="midnight-action outlined" onClick={() => go("/games/coup/tutorial")}>
          <MidnightIcon name="book" />
          <span>آموزش بازی</span>
        </button>
        <button className="midnight-action filled" disabled={pending} onClick={onStart}>
          <MidnightIcon name="play" />
          <span>{pending ? "در حال ورود…" : "شروع بازی"}</span>
        </button>
      </div>
    </section>
  );
}
