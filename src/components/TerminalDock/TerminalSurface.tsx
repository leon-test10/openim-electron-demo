import "@xterm/xterm/css/xterm.css";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useMemo, useRef } from "react";

import { useTerminalDockStore } from "@/store/terminalDock";
import { TerminalOutputChunk, TerminalTab } from "@/store/type";
import { TerminalResizeParams } from "@/types/globalExpose";

export type TerminalSurfaceApi = {
  getSelectionText: () => string;
  getVisibleText: () => string;
  getRecentOutputText: () => string;
  focus: () => void;
};

const ANSI_ESCAPE = String.fromCharCode(27);
const ANSI_CONTROL_PATTERN = new RegExp(
  `${ANSI_ESCAPE}(?:\\[[0-?]*[ -/]*[@-~]|\\][^\\x07]*(?:\\x07|${ANSI_ESCAPE}\\\\)|[@-Z\\\\-_])`,
  "g",
);
const TERMINAL_ACCESSIBILITY_MINIMUM_CONTRAST_RATIO = 4.5;

const readableDarkTerminalTheme = {
  background: "#0c0c0c",
  foreground: "#d4d4d4",
  cursor: "#ffffff",
  cursorAccent: "#000000",
  selectionBackground: "#264f78",
  selectionForeground: "#ffffff",
  selectionInactiveBackground: "#1f3f5b",
  black: "#000000",
  red: "#f14c4c",
  green: "#23d18b",
  yellow: "#f5f543",
  blue: "#5ea6ff",
  magenta: "#bc8cff",
  cyan: "#29b8db",
  white: "#e5e5e5",
  brightBlack: "#666666",
  brightRed: "#f48771",
  brightGreen: "#35d07f",
  brightYellow: "#ffff87",
  brightBlue: "#82c7ff",
  brightMagenta: "#d670d6",
  brightCyan: "#5ccfe6",
  brightWhite: "#ffffff",
};

const readableLightTerminalTheme = {
  background: "#f7f7f7",
  foreground: "#24292f",
  cursor: "#1f2328",
  cursorAccent: "#ffffff",
  selectionBackground: "#cfe4ff",
  selectionForeground: "#0b0f14",
  selectionInactiveBackground: "#d8d8d8",
  black: "#24292f",
  red: "#cf222e",
  green: "#1a7f37",
  yellow: "#9a6700",
  blue: "#0969da",
  magenta: "#8250df",
  cyan: "#1b7c83",
  white: "#f6f8fa",
  brightBlack: "#57606a",
  brightRed: "#a40e26",
  brightGreen: "#116329",
  brightYellow: "#7d4e00",
  brightBlue: "#218bff",
  brightMagenta: "#a475f9",
  brightCyan: "#3192aa",
  brightWhite: "#ffffff",
};

const getAppThemeMode = () => {
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    if (
      root.classList.contains("dark") ||
      root.dataset.theme === "dark" ||
      root.dataset.colorMode === "dark"
    ) {
      return "dark" as const;
    }
    if (
      root.classList.contains("light") ||
      root.dataset.theme === "light" ||
      root.dataset.colorMode === "light"
    ) {
      return "light" as const;
    }
  }

  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  return "dark" as const;
};

const getReadableTerminalTheme = (mode: "dark" | "light") =>
  mode === "light" ? readableLightTerminalTheme : readableDarkTerminalTheme;

const logTerminalThemeSnapshot = (
  mode: "dark" | "light",
  theme: typeof readableDarkTerminalTheme,
  minimumContrastRatio: number,
) => {
  if (!import.meta.env.DEV) return;

  console.debug("[TerminalDock] xterm theme", {
    mode,
    blue: theme.blue,
    brightBlue: theme.brightBlue,
    foreground: theme.foreground,
    background: theme.background,
    minimumContrastRatio,
  });
};

const applyTerminalTheme = (terminal: Terminal) => {
  const mode = getAppThemeMode();
  const theme = getReadableTerminalTheme(mode);
  terminal.options.theme = theme;
  terminal.options.minimumContrastRatio = TERMINAL_ACCESSIBILITY_MINIMUM_CONTRAST_RATIO;
  logTerminalThemeSnapshot(mode, theme, TERMINAL_ACCESSIBILITY_MINIMUM_CONTRAST_RATIO);
};

const cleanTerminalText = (value: string) =>
  value
    .replace(ANSI_CONTROL_PATTERN, "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/g, ""))
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (/^\d+(\.\d+)?[KMG]?\s+\(\d+%\)\s+ctrl\+p\s+commands$/i.test(trimmed)) {
        return false;
      }
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const TerminalSurface = ({
  tab,
  output,
  onReady,
  onSelectionChange,
}: {
  tab: TerminalTab;
  output: TerminalOutputChunk[];
  onReady?: (tabID: string, api: TerminalSurfaceApi | null) => void;
  onSelectionChange?: (tabID: string, selection: string) => void;
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const renderedIdsRef = useRef<Set<string>>(new Set());
  const runningRef = useRef(tab.status === "running");
  const outputRef = useRef(output);
  const outputSignature = useMemo(
    () => output.map((item) => item.id).join("|"),
    [output],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const initialThemeMode = getAppThemeMode();

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily:
        'Consolas, "Cascadia Mono", "Cascadia Code", "JetBrains Mono", monospace',
      fontSize: 14,
      lineHeight: 1.25,
      minimumContrastRatio: TERMINAL_ACCESSIBILITY_MINIMUM_CONTRAST_RATIO,
      drawBoldTextInBrightColors: false,
      altClickMovesCursor: false,
      rightClickSelectsWord: true,
      convertEol: false,
      allowProposedApi: false,
      disableStdin: tab.status !== "running",
      theme: getReadableTerminalTheme(initialThemeMode),
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host);
    fitAddon.fit();
    applyTerminalTheme(terminal);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    renderedIdsRef.current = new Set();
    onReady?.(tab.id, {
      getSelectionText: () => terminal.getSelection() ?? "",
      getVisibleText: () => {
        const buffer = terminal.buffer.active;
        const start = buffer.viewportY;
        const end = Math.min(buffer.length, start + terminal.rows);
        const lines: string[] = [];
        for (let row = start; row < end; row += 1) {
          const line = buffer.getLine(row);
          if (!line) continue;
          lines.push(line.translateToString(true));
        }
        return cleanTerminalText(lines.join("\n"));
      },
      getRecentOutputText: () =>
        cleanTerminalText(
          outputRef.current
            .slice(-80)
            .map((item) => item.content)
            .join(""),
        ).slice(-6000),
      focus: () => terminal.focus(),
    });

    const resize = () => {
      const currentTerminal = terminalRef.current;
      const currentFitAddon = fitAddonRef.current;
      if (!currentTerminal || !currentFitAddon || !window.electronAPI) return;
      currentFitAddon.fit();
      const payload: TerminalResizeParams = {
        tabID: tab.id,
        cols: currentTerminal.cols,
        rows: currentTerminal.rows,
      };
      void window.electronAPI
        .ipcInvoke("terminal:resize", payload)
        .catch(() => undefined);
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    const themeObserver =
      typeof MutationObserver !== "undefined" && typeof document !== "undefined"
        ? new MutationObserver(() => applyTerminalTheme(terminal))
        : undefined;

    themeObserver?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "data-color-mode"],
    });

    const colorSchemeQuery =
      typeof window !== "undefined" && window.matchMedia
        ? window.matchMedia("(prefers-color-scheme: dark)")
        : undefined;
    const handleColorSchemeChange = () => applyTerminalTheme(terminal);

    colorSchemeQuery?.addEventListener?.("change", handleColorSchemeChange);

    const dataDisposable = terminal.onData((data) => {
      if (!runningRef.current) return;
      void useTerminalDockStore
        .getState()
        .writeToTab(tab.id, data)
        .catch(() => undefined);
    });
    const selectionDisposable = terminal.onSelectionChange(() => {
      onSelectionChange?.(tab.id, terminal.getSelection() ?? "");
    });

    const focusListener = () => terminal.focus();
    host.addEventListener("click", focusListener);
    resize();
    terminal.focus();

    return () => {
      host.removeEventListener("click", focusListener);
      resizeObserver.disconnect();
      themeObserver?.disconnect();
      colorSchemeQuery?.removeEventListener?.("change", handleColorSchemeChange);
      dataDisposable.dispose();
      selectionDisposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      renderedIdsRef.current = new Set();
      onReady?.(tab.id, null);
    };
  }, [tab.id]);

  useEffect(() => {
    runningRef.current = tab.status === "running";
    if (terminalRef.current?.options) {
      terminalRef.current.options.disableStdin = !runningRef.current;
      if (runningRef.current) {
        terminalRef.current.focus();
      }
    }
  }, [tab.status]);

  useEffect(() => {
    outputRef.current = output;
    const terminal = terminalRef.current;
    if (!terminal) return;

    const renderedIds = renderedIdsRef.current;
    output.forEach((item) => {
      if (renderedIds.has(item.id)) return;
      terminal.write(item.content);
      renderedIds.add(item.id);
    });
    terminal.scrollToBottom();
  }, [output, outputSignature]);

  return <div ref={hostRef} className="terminal-dock-surface" />;
};

export default TerminalSurface;
