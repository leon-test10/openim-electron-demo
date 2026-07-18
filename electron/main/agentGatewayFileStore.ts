import fs from "node:fs";
import path from "node:path";

import type { AgentGatewaySnapshot, AgentGatewayStateStore } from "../agent-core";

export class AgentGatewayFileStore implements AgentGatewayStateStore {
  constructor(private readonly filePath: string) {}

  async load() {
    try {
      const content = await fs.promises.readFile(this.filePath, "utf8");
      return JSON.parse(content) as AgentGatewaySnapshot;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async save(snapshot: AgentGatewaySnapshot) {
    const directory = path.dirname(this.filePath);
    await fs.promises.mkdir(directory, { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await fs.promises.writeFile(
      temporaryPath,
      `${JSON.stringify(snapshot, null, 2)}\n`,
      "utf8",
    );
    await fs.promises.rename(temporaryPath, this.filePath);
  }
}
