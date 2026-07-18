const fs = require("node:fs");
const path = require("node:path");

const outputRoot = path.resolve("dist-electron");
const coreRoot = path.resolve("electron", "agent-core");
const failures = [];

const walk = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(filePath);
      continue;
    }
    if (!entry.isFile() || path.extname(entry.name) !== ".js") continue;

    const source = fs.readFileSync(filePath, "utf8");
    const imports = source.matchAll(/require\(["'](\.[^"']+)["']\)/g);
    for (const match of imports) {
      const specifier = match[1];
      try {
        require.resolve(path.resolve(path.dirname(filePath), specifier));
      } catch {
        failures.push(`${path.relative(outputRoot, filePath)} -> ${specifier}`);
      }
    }
  }
};

if (!fs.existsSync(outputRoot)) {
  throw new Error("dist-electron does not exist; run the Electron build first");
}

walk(outputRoot);

const checkCoreBoundary = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      checkCoreBoundary(filePath);
      continue;
    }
    if (!entry.isFile() || path.extname(entry.name) !== ".ts") continue;
    const source = fs.readFileSync(filePath, "utf8");
    if (
      /from\s+["'][^"']*\/src(?:\/|["'])/.test(source) ||
      /from\s+["']electron(?:\/|["'])/.test(source)
    ) {
      failures.push(
        `${path.relative(coreRoot, filePath)} -> environment-specific dependency`,
      );
    }
  }
};

checkCoreBoundary(coreRoot);

if (failures.length > 0) {
  throw new Error(
    `Electron build contains unresolved relative imports:\n${failures.join("\n")}`,
  );
}

console.log(
  "Electron build relative imports resolved; agent-core boundary is environment-neutral",
);
