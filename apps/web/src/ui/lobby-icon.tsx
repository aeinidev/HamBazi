/** Decorative artwork; the containing control owns its accessible name. */
export function LobbyIcon({
  name,
}: {
  name: "games" | "friends" | "chat" | "trophy" | "profile" | "bell" | "gear";
}) {
  return <span className={`lobby-icon lobby-icon-${name}`} aria-hidden="true" />;
}
