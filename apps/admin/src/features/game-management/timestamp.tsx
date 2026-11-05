export function Timestamp({ value }: { value: string | null }) {
  return value ? (
    <time dateTime={value}>
      {new Date(value).toLocaleString("fa-IR", { timeZone: "Asia/Tehran" })} · تهران (Asia/Tehran)
    </time>
  ) : (
    <>ثبت نشده</>
  );
}
