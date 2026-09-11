// tinybench 6.1.4 (via Vitest) references this numeric Web Performance type.
// Keep the compatibility alias test-local; do not enable DOM in Node presets.
export {};

declare global {
  type DOMHighResTimeStamp = number;
}
