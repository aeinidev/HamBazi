// tinybench's test-only Web Performance alias; keep Node production types DOM-free.
export {};
declare global {
  type DOMHighResTimeStamp = number;
}
