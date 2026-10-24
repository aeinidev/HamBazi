import type { Locator } from "@playwright/test";
/** A cancelable touch sequence exercises the real non-passive document listener. */
export async function verticalDrag(target: Locator, dy = 80, count = 1, dx = 0) {
  return target.evaluate(
    (element, { dy, count, dx }) => {
      function touch(type: string, x: number, y: number) {
        const event = new Event(type, { bubbles: true, cancelable: true, composed: true });
        Object.defineProperty(event, "touches", {
          value: Array.from({ length: count }, (_, i) => ({
            clientX: x + i * 20,
            clientY: y,
            identifier: i,
          })),
        });
        element.dispatchEvent(event);
        return event.defaultPrevented;
      }
      touch("touchstart", 100, 200);
      return touch("touchmove", 100 + dx, 200 + dy);
    },
    { dy, count, dx },
  );
}
