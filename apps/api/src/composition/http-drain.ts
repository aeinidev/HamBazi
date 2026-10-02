import type { FastifyInstance } from "fastify";
/** Socket completion alone cannot prove an aborted client's application write has settled. */
export function trackHttpWork(server: FastifyInstance) {
  const active = new Set<Promise<unknown>>();
  server.addHook("onRoute", (route) => {
    const handler = route.handler;
    route.handler = function (request, reply) {
      const work = Promise.resolve().then(() => handler.call(this, request, reply));
      active.add(work);
      return work.finally(() => active.delete(work));
    };
  });
  return async () => {
    await Promise.allSettled([...active]);
  };
}
