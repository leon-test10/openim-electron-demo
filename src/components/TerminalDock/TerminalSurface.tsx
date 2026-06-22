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
  const runningRef = useRef(tab.status === "running");
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
      fontSize: 14,
      lineHeight: 1.25,
      convertEol: false,
      allowProposedApi: false,
      disableStdin: tab.status !== "running",
      theme: {
        background: "#0c0c0c",
        foreground: "#cccccc",
        cursor: "#f2f2f2",
        cursorAccent: "#0c0c0c",
        selectionBackground: "#264f78",
        black: "#000000",
        red: "#c50f1f",
        green: "#13a10e",
        yellow: "#c19c00",
        blue: "#f2f2f2",
        magenta: "#881798",
        cyan: "#3a96dd",
        white: "#cccccc",
        brightBlack: "#767676",
        brightRed: "#e74856",
        brightGreen: "#16c60c",
        brightYellow: "#f9f1a5",
        brightBlue: "#ffffff",
        brightMagenta: "#b4009e",
        brightCyan: "#61d6d6",
        brightWhite: "#f2f2f2",
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
      if (!runningRef.current) return;
      void useTerminalDockStore
        .getState()
        .writeToTab(tab.id, data)
        .catch(() => undefined);
    });

    const focusListener = () => terminal.focus();
    host.addEventListener("click", focusListener);
    resize();
    terminal.focus();

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
    runningRef.current = tab.status === "running";
    if (terminalRef.current?.options) {
      terminalRef.current.options.disableStdin = !runningRef.current;
      if (runningRef.current) {
        terminalRef.current.focus();
      }
    }
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
