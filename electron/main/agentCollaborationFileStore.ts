import fs from "node:fs";
import path from "node:path";

import type { CollaborationSnapshot, CollaborationStateStore } from "../agent-core";

export class AgentCollaborationFileStore implements CollaborationStateStore {
  constructor(private readonly filePath: string) {}

  async load() {
    try {
      return JSON.parse(
        await fs.promises.readFile(this.filePath, "utf8"),
      ) as CollaborationSnapshot;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async save(snapshot: CollaborationSnapshot) {
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await fs.promises.writeFile(
      temporaryPath,
      `${JSON.stringify(snapshot, null, 2)}\n`,
      "utf8",
    );
    await fs.promises.rename(temporaryPath, this.filePath);
  }
}
