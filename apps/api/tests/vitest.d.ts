// tinybench 6.1.4 references this numeric Web Performance type.
// Keep the compatibility alias test-local instead of enabling DOM in the API.
export {};
declare global {
  type DOMHighResTimeStamp = number;
}
