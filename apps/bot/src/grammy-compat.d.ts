// grammY 1.46's unused framework adapters reference DOM aliases absent from
// Node's Fetch globals. Keep these narrow aliases instead of enabling all DOM APIs.
export {};
declare global {
  type Body = Pick<
    Response,
    "arrayBuffer" | "blob" | "formData" | "json" | "text" | "body" | "bodyUsed"
  >;
  type BodyInit = Exclude<RequestInit["body"], undefined | null>;
}
