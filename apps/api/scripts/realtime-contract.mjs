import { readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import process from "node:process";
import console from "node:console";
import { URL } from "node:url";
import { realtimeEventCatalog } from "../dist/realtime/index.js";

const target = new URL("../../../docs/contracts/realtime.events.json", import.meta.url);
const baseline = new URL("../../../docs/contracts/realtime.v1.baseline.json", import.meta.url);
const document = realtimeEventCatalog();
const generated = JSON.stringify(document, null, 2) + "\n";
if (process.argv.includes("--initialize-baseline")) {
  await writeFile(baseline, generated, { flag: "wx", mode: 0o644 });
} else {
  const previous = JSON.parse(await readFile(baseline, "utf8"));
  if (
    previous.schemaVersion !== document.schemaVersion ||
    previous.path !== document.path ||
    previous.namespace !== document.namespace ||
    !isDeepStrictEqual(previous.handshake, document.handshake) ||
    !isDeepStrictEqual(previous.acknowledgement, document.acknowledgement) ||
    previous.reservedServerEvents.some((name) => !document.reservedServerEvents.includes(name)) ||
    Object.entries(previous.clientEvents).some(
      ([name, schema]) => !isDeepStrictEqual(schema, document.clientEvents[name]),
    )
  )
    throw new Error("Breaking realtime v1 event contract change");
  const delivery = JSON.parse(
    await readFile(
      new URL("../../../docs/contracts/realtime.delivery.v1.baseline.json", import.meta.url),
      "utf8",
    ),
  );
  if (
    !isDeepStrictEqual(delivery.catchupResult, document.catchupResult) ||
    Object.entries(delivery.serverEvents).some(
      ([name, schema]) => !isDeepStrictEqual(schema, document.serverEvents[name]),
    ) ||
    Object.entries(delivery.clientEvents).some(
      ([name, schema]) => !isDeepStrictEqual(schema, document.clientEvents[name]),
    )
  )
    throw new Error("Breaking realtime v1 delivery contract change");
  const chatTarget = new URL(
    "../../../docs/contracts/realtime.chat.v1.baseline.json",
    import.meta.url,
  );
  const chat = {
    clientEvents: {
      "chat:send": document.clientEvents["chat:send"],
      "chat:list": document.clientEvents["chat:list"],
    },
    message: document.serverEvents["chat:message"],
    sendResult: document.chatSendResult,
    listResult: document.chatListResult,
  };
  if (process.argv.includes("--initialize-chat-baseline")) {
    await writeFile(chatTarget, JSON.stringify(chat, null, 2) + "\n", { flag: "wx", mode: 0o644 });
  } else if (!isDeepStrictEqual(JSON.parse(await readFile(chatTarget, "utf8")), chat)) {
    throw new Error("Breaking realtime v1 chat contract change");
  }
  if (process.argv.includes("--write")) await writeFile(target, generated);
  else if (
    !process.argv.includes("--initialize-chat-baseline") &&
    !isDeepStrictEqual(JSON.parse(await readFile(target, "utf8")), document)
  )
    throw new Error("Realtime event catalog drift");
}
console.log("Realtime event catalog verified/generated");
