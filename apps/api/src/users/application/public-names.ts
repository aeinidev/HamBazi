import { z } from "zod";
export interface PublicNamesPort {
  find(ids: readonly string[]): Promise<readonly { userId: string; displayName: string }[]>;
}
export type PublicNamesRepository = PublicNamesPort;
export function publicNamesService(repository: PublicNamesRepository): PublicNamesPort {
  return Object.freeze({
    async find(ids: readonly string[]) {
      const input = z.array(z.uuid()).max(50).parse(ids);
      return repository.find([...new Set(input.map((id) => id.toLowerCase()))]);
    },
  });
}
