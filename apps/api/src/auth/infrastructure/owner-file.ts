import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { parseOwnerAdmissionPolicy } from "@hambazi/config";

/** No cache: every authentication sees permission/content removal. Unlinked bind inodes deny. */
export function ownerFileSource(path: string) {
  if (!isAbsolute(path)) throw new Error("OWNER_ADMISSION_CONFIGURATION_INVALID");
  return async () => {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await file.stat();
      if (
        !info.isFile() ||
        info.nlink !== 1 ||
        (info.mode & 0o077) !== 0 ||
        info.size < 1 ||
        info.size > 4096
      )
        throw new Error("OWNER_ADMISSION_POLICY_INVALID");
      const bytes = await file.readFile();
      const current = await file.stat();
      if (current.nlink !== 1 || (current.mode & 0o077) !== 0 || current.size !== bytes.length)
        throw new Error("OWNER_ADMISSION_POLICY_INVALID");
      return parseOwnerAdmissionPolicy(bytes.toString("utf8")).reveal();
    } finally {
      await file.close();
    }
  };
}
