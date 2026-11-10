export const officialAvatars = [
  {
    id: "hb-01",
    name: "گیو",
    group: "boys",
    src: new URL("../assets/avatars/hb-01.webp", import.meta.url).href,
  },
  {
    id: "hb-02",
    name: "جیگورو",
    group: "boys",
    src: new URL("../assets/avatars/hb-02.webp", import.meta.url).href,
  },
  {
    id: "hb-03",
    name: "تانجیرو",
    group: "boys",
    src: new URL("../assets/avatars/hb-03.webp", import.meta.url).href,
  },
  {
    id: "hb-04",
    name: "نینجای طلایی",
    group: "boys",
    src: new URL("../assets/avatars/hb-04.webp", import.meta.url).href,
  },
  {
    id: "hb-05",
    name: "جادوگر یخی",
    group: "boys",
    src: new URL("../assets/avatars/hb-05.webp", import.meta.url).href,
  },
  {
    id: "hb-06",
    name: "شوالیهٔ زمرد",
    group: "girls",
    src: new URL("../assets/avatars/hb-06.webp", import.meta.url).href,
  },
  {
    id: "hb-07",
    name: "شینوبو",
    group: "girls",
    src: new URL("../assets/avatars/hb-07.webp", import.meta.url).href,
  },
  {
    id: "hb-08",
    name: "قهرمان مسی",
    group: "girls",
    src: new URL("../assets/avatars/hb-08.webp", import.meta.url).href,
  },
  {
    id: "hb-09",
    name: "جادوگر سرخ",
    group: "girls",
    src: new URL("../assets/avatars/hb-09.webp", import.meta.url).href,
  },
  {
    id: "hb-10",
    name: "راپونزل",
    group: "girls",
    src: new URL("../assets/avatars/hb-10.webp", import.meta.url).href,
  },
] as const;

export function avatarPhoto(avatar: string | null | undefined, telegramPhoto: string | null) {
  if (!avatar) return telegramPhoto;
  if (avatar === "default") return null;
  if (
    /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]+={0,2}$/.test(avatar) &&
    avatar.length <= 240000
  )
    return avatar;
  return officialAvatars.find((item) => item.id === avatar)?.src ?? null;
}
