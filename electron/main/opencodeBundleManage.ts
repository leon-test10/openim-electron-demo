import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";

export interface EnsureBundledOpencodeCommandParams {
  archivePath: string;
  installDir: string;
}

export const ensureBundledOpencodeCommand = ({
  archivePath,
  installDir,
}: EnsureBundledOpencodeCommandParams) => {
  if (!fs.existsSync(archivePath)) return undefined;

  const commandPath = path.join(installDir, "opencode.exe");
  if (fs.existsSync(commandPath)) return commandPath;

  fs.mkdirSync(installDir, { recursive: true });
  const zip = new AdmZip(archivePath);
  zip.extractAllTo(installDir, true);

  if (fs.existsSync(commandPath)) return commandPath;

  const findBinary = (dir: string): string | undefined => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isFile() && /^opencode.*\.exe$/i.test(entry.name)) {
        return entryPath;
      }
      if (entry.isDirectory()) {
        const nested = findBinary(entryPath);
        if (nested) return nested;
      }
    }
    return undefined;
  };

  const sourcePath = findBinary(installDir);
  if (!sourcePath) return undefined;
  fs.copyFileSync(sourcePath, commandPath);
  return commandPath;
};
