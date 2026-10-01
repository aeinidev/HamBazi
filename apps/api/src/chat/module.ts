import { chatService } from "./application/service.js";
import { createChatRepository } from "./infrastructure/repositories/history.js";
export function createChatPort(
  database: Parameters<typeof createChatRepository>[0],
  options: Omit<Parameters<typeof chatService>[0], "repository"> & { clock: { nowMs(): number } },
) {
  return chatService({ ...options, repository: createChatRepository(database, options.clock) });
}
