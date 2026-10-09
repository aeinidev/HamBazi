import type { Api } from "grammy";
/** Explicit operator action; never changes identity, credentials or webhook receiving mode. */
export async function configureMiniAppMenu(
  api: Api,
  options: { username: string; miniAppUrl: string; ownerChatId: string },
  signal: AbortSignal,
) {
  const abort = signal as unknown as NonNullable<Parameters<Api["getMe"]>[0]>;
  const bot = await api.getMe(abort);
  if (bot.username?.toLowerCase() !== options.username.toLowerCase())
    throw new Error("Bot identity mismatch");
  const menu_button = {
    type: "web_app" as const,
    text: "Open",
    web_app: { url: options.miniAppUrl },
  };
  const previousDefault = await api.getChatMenuButton({}, abort);
  const previousOwner = await api.getChatMenuButton(
    { chat_id: Number(options.ownerChatId) },
    abort,
  );
  await api.setChatMenuButton({ menu_button }, abort);
  await api.setChatMenuButton({ chat_id: Number(options.ownerChatId), menu_button }, abort);
  const currentDefault = await api.getChatMenuButton({}, abort);
  const currentOwner = await api.getChatMenuButton({ chat_id: Number(options.ownerChatId) }, abort);
  for (const current of [currentDefault, currentOwner])
    if (
      current.type !== "web_app" ||
      current.text !== "Open" ||
      new URL(current.web_app.url).href !== new URL(options.miniAppUrl).href
    )
      throw new Error("Menu verification failed");
  return {
    previousDefaultType: previousDefault.type,
    previousOwnerType: previousOwner.type,
    defaultVerified: true,
    ownerVerified: true,
  };
}
