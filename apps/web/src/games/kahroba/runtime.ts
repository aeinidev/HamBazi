import { io } from "socket.io-client";
import { createRealtime } from "../../platform/realtime.js";
export const createKahrobaRealtime: typeof createRealtime = (origin, token, callbacks) =>
  createRealtime(origin, token, callbacks, io, false, {
    namespace: "kahroba-v1",
    path: "/v1/kahroba/socket.io",
  });
