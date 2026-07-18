import type {
  GatewayRunExecutor,
  GatewayRunRecord,
  GatewayWorkerExecutionState,
} from "../agent-core";
import { agentSessionManager } from "./agentSessionManage";

const stringInput = (run: GatewayRunRecord, key: string) => {
  const value = run.input[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Gateway run input ${key} is required`);
  }
  return value.trim();
};

export class OpenCodeGatewayRunExecutor implements GatewayRunExecutor {
  execute(
    run: GatewayRunRecord,
    hooks: {
      onState(state: GatewayWorkerExecutionState): void | Promise<void>;
    },
  ) {
    const collaborationID = stringInput(run, "collaborationID");
    const title = stringInput(run, "title");
    const instruction = stringInput(run, "instruction");
    const objective = stringInput(run, "objective");
    const dependencies = Array.isArray(run.input.dependencies)
      ? run.input.dependencies
      : [];
    const prompt = [
      "You are a worker in an OpenIM-centered distributed Agent collaboration.",
      `Overall objective: ${objective}`,
      `Assigned task: ${title}`,
      `Instruction: ${instruction}`,
      dependencies.length > 0
        ? `Completed dependency outputs:\n${JSON.stringify(dependencies, null, 2)}`
        : "There are no dependency outputs.",
      "Work only on this assigned task. Do not send OpenIM messages yourself.",
      "Return a concise result that another reviewer can aggregate.",
      "If you create deliverable files or folders, list workspace-relative paths under",
      "## Output Files or ## Output Folders at the end of the response.",
    ].join("\n\n");
    return agentSessionManager.executeCollaborationRun({
      parentSessionID: run.sessionID,
      collaborationID,
      runID: run.runID,
      title,
      prompt,
      onState: (state) => hooks.onState(state),
    });
  }
}
