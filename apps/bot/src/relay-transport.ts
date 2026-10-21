import { request } from "node:https";
import type { RequestOptions } from "node:https";

/** Scoped HTTPS transport; public certificate/hostname verification stays on.
 * The explicit standard groups qualified TLS 1.3 on the VPS path where Node's
 * default negotiation stalled after connecting. Never change global TLS state.
 */
export function createRelayTransport(trust: Pick<RequestOptions, "ca"> = {}): typeof fetch {
  return async (input, init) => {
    const target = new URL(String(input));
    if (target.protocol !== "https:" || init?.method !== "POST" || typeof init.body !== "string")
      throw new Error("Invalid relay transport request");
    const body = init.body;
    return new Promise<Response>((resolve, reject) => {
      const fail = () => reject(new Error("Relay transport failed"));
      const req = request(
        target,
        {
          ...trust,
          method: "POST",
          agent: false,
          minVersion: "TLSv1.2",
          ecdhCurve: "X25519:P-256:P-384",
          maxHeaderSize: 8192,
          ...(init.signal ? { signal: init.signal } : {}),
          headers: {
            ...Object.fromEntries(new Headers(init.headers).entries()),
            "content-length": Buffer.byteLength(body),
            "accept-encoding": "identity",
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("error", fail);
          res.on("aborted", fail);
          res.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > 65536) {
              res.destroy();
              fail();
            } else chunks.push(chunk);
          });
          res.on("end", () => {
            const contentType = res.headers["content-type"];
            try {
              if (!res.statusCode || typeof contentType !== "string") return fail();
              resolve(
                new Response(Buffer.concat(chunks), {
                  status: res.statusCode,
                  headers: { "content-type": contentType },
                }),
              );
            } catch {
              fail();
            }
          });
        },
      );
      req.on("error", fail);
      req.end(body);
    });
  };
}
