import "@xterm/xterm/css/xterm.css";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useMemo, useRef } from "react";

import { useTerminalDockStore } from "@/store/terminalDock";
import { TerminalOutputChunk, TerminalTab } from "@/store/type";
import { TerminalResizeParams } from "@/types/globalExpose";

export type TerminalSurfaceApi = {
  getSelectionText: () => string;
  focus: () => void;
};

const TerminalSurface = ({
  tab,
  output,
  onReady,
}: {
  tab: TerminalTab;
  output: TerminalOutputChunk[];
  onReady?: (tabID: string, api: TerminalSurfaceApi | null) => void;
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const renderedIdsRef = useRef<Set<string>>(new Set());
  const outputSignature = useMemo(
    () => output.map((item) => item.id).join("|"),
    [output],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily:
        'Consolas, "Cascadia Mono", "Cascadia Code", "JetBrains Mono", monospace',
      fontSize: 12,
      lineHeight: 1.35,
      convertEol: false,
      allowProposedApi: false,
      disableStdin: tab.status !== "running",
      theme: {
        background: "#1e1e1e",
        foreground: "#d4d4d4",
        cursor: "#aeafad",
        cursorAccent: "#1e1e1e",
        selectionBackground: "#264f78",
        black: "#000000",
        red: "#cd3131",
        green: "#0dbc79",
        yellow: "#e5e510",
        blue: "#2472c8",
        magenta: "#bc3fbc",
        cyan: "#11a8cd",
        white: "#e5e5e5",
        brightBlack: "#666666",
        brightRed: "#f14c4c",
        brightGreen: "#23d18b",
        brightYellow: "#f5f543",
        brightBlue: "#3b8eea",
        brightMagenta: "#d670d6",
        brightCyan: "#29b8db",
        brightWhite: "#e5e5e5",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host);
    fitAddon.fit();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    renderedIdsRef.current = new Set();
    onReady?.(tab.id, {
      getSelectionText: () => terminal.getSelection() ?? "",
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

    const dataDisposable = terminal.onData((data) => {
      if (tab.status !== "running") return;
      void useTerminalDockStore
        .getState()
        .writeToTab(tab.id, data)
        .catch(() => undefined);
    });

    const focusListener = () => terminal.focus();
    host.addEventListener("click", focusListener);
    resize();

    return () => {
      host.removeEventListener("click", focusListener);
      resizeObserver.disconnect();
      dataDisposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      renderedIdsRef.current = new Set();
      onReady?.(tab.id, null);
    };
  }, [tab.id]);

  useEffect(() => {
    terminalRef.current?.options &&
      (terminalRef.current.options.disableStdin = tab.status !== "running");
  }, [tab.status]);

  useEffect(() => {
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
