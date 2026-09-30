import { useEffect, useState } from "react";
import type { CoupCommand } from "../adapters/index.js";

// Selection is presentation state only; an exact server-provided command must exist before submit.
export function useExchangeSelection(revision: number, commands: CoupCommand[]) {
  const [indices, setIndices] = useState<number[]>([]);
  useEffect(() => setIndices([]), [revision]);
  const selected = commands.find(
    (command) =>
      command.type === "SELECT_EXCHANGE" &&
      command.cardIndices.length === indices.length &&
      command.cardIndices.every((index) => indices.includes(index)),
  );
  return {
    indices,
    selected,
    toggle(index: number) {
      setIndices((current) =>
        current.includes(index)
          ? current.filter((value) => value !== index)
          : [...current, index].sort((a, b) => a - b),
      );
    },
  };
}
