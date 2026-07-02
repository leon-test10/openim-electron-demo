import fs from "node:fs";
import path from "node:path";

export type OpencodeWorkspaceConfigMode = "create-if-missing" | "overwrite";

export interface OpencodeWorkspaceConfig {
  enabled?: boolean;
  mode?: OpencodeWorkspaceConfigMode;
  fileName?: string;
  templatePath?: string;
}

export interface EnsureOpencodeConfigParams {
  targetDir: string;
  defaultTemplatePath: string;
  config?: OpencodeWorkspaceConfig;
}

const DEFAULT_CONFIG_FILE_NAME = "opencode.jsonc";

const sanitizeConfigFileName = (fileName?: string) => {
  const name = fileName?.trim() || DEFAULT_CONFIG_FILE_NAME;
  if (name.includes("/") || name.includes("\\") || path.isAbsolute(name)) {
    throw new Error("OpenCode config fileName must be a file name, not a path");
  }
  if (name !== "opencode.jsonc") {
    throw new Error("OpenCode workspace config fileName must be opencode.jsonc");
  }
  return name;
};

const resolveTemplatePath = (
  config: OpencodeWorkspaceConfig | undefined,
  defaultTemplatePath: string,
) => {
  const configuredTemplatePath = config?.templatePath?.trim();
  return configuredTemplatePath || defaultTemplatePath;
};

export const ensureOpencodeConfigFile = ({
  targetDir,
  defaultTemplatePath,
  config,
}: EnsureOpencodeConfigParams) => {
  if (config?.enabled === false) {
    return {
      written: false,
      path: path.join(targetDir, sanitizeConfigFileName(config.fileName)),
      reason: "disabled",
    };
  }

  const targetPath = path.join(targetDir, sanitizeConfigFileName(config?.fileName));
  const mode = config?.mode || "create-if-missing";
  if (mode === "create-if-missing" && fs.existsSync(targetPath)) {
    return {
      written: false,
      path: targetPath,
      reason: "exists",
    };
  }

  const templatePath = resolveTemplatePath(config, defaultTemplatePath);
  if (!fs.existsSync(templatePath)) {
    return {
      written: false,
      path: targetPath,
      reason: "template-missing",
    };
  }

  fs.mkdirSync(targetDir, { recursive: true });
  fs.copyFileSync(templatePath, targetPath);
  return {
    written: true,
    path: targetPath,
    reason: mode,
  };
};
