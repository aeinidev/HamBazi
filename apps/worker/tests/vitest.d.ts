// Test-only compatibility for tinybench 6.1.4; do not enable DOM in the Worker.
export {};
declare global {
  type DOMHighResTimeStamp = number;
}
