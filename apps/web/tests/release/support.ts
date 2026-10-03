import { expect, type Locator } from "@playwright/test";

// Locator matcher failures attach ARIA snapshots independently of recorder flags.
export async function visible(locator: Locator) {
  await expect.poll(() => locator.isVisible()).toBe(true);
}
export async function enabled(locator: Locator) {
  await expect.poll(() => locator.isEnabled().catch(() => false)).toBe(true);
}
export async function clickGameIntent(button: Locator) {
  try {
    if (!(await button.isEnabled())) return false;
    await button.click();
    return true;
  } catch {
    // Resolved-element call logs can contain the button's private card label.
    throw new Error("Release game intent could not be clicked");
  }
}
