export function PalaceGem({ blue = false }: { blue?: boolean }) {
  return (
    <svg className={`khl-gem ${blue ? "is-blue" : ""}`} viewBox="0 0 100 140" aria-hidden="true">
      <path fill="var(--gem3,#b85505)" d="M50 1 96 52 83 108 50 139 12 106 4 53Z" />
      <path fill="var(--gem1,#ffe4a0)" d="M50 1 36 55 4 53Z" />
      <path fill="var(--gem2,#ffbd28)" d="m50 1 28 57-42-3Z" />
      <path fill="var(--gem4,#762208)" d="m50 1 46 51-18 6Z" />
      <path fill="var(--gem2,#ffbc17)" d="m4 53 32 2-24 51Z" />
      <path fill="var(--gem3,#e97609)" d="m36 55 42 3-28 46Z" />
      <path fill="var(--gem1,#ffe493)" d="m78 58 18-6-13 56Z" />
      <path fill="var(--gem4,#952a05)" d="m36 55 14 49-38 2Z" />
      <path fill="var(--gem2,#ffac0a)" d="m78 58 5 50-33-4Z" />
      <path fill="var(--gem1,#ffde65)" d="m12 106 38-2v35Z" />
      <path fill="var(--gem3,#e97903)" d="m50 104 33 4-33 31Z" />
      <path
        fill="none"
        stroke="#fff4c4"
        strokeWidth=".7"
        d="M50 1 36 55 4 53M36 55l14 49 28-46L50 1M12 106l38-2 33 4M50 104v35"
      />
    </svg>
  );
}
