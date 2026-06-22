import "@xterm/xterm/css/xterm.css";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useMemo, useRef } from "react";

import { RuntimeAttachment } from "@/store/runtimeDock";
import { RuntimeResizeParams } from "@/types/globalExpose";

export type TerminalSurfaceApi = {
  getSelectionText: () => string;
  clearSelection: () => void;
  focus: () => void;
};

const RuntimeTerminalSurface = ({
  attachment,
  onReady,
}: {
  attachment: RuntimeAttachment;
  onReady?: (attachmentID: string, api: TerminalSurfaceApi | null) => void;
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const renderedIdsRef = useRef<Set<string>>(new Set());

  const transcriptSignature = useMemo(
    () => attachment.transcript.map((item) => item.id).join("|"),
    [attachment.transcript],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily:
        'Consolas, "Cascadia Mono", "Cascadia Code", "JetBrains Mono", monospace',
      fontSize: 12,
      lineHeight: 1.4,
      theme: {
        background: "#020817",
        foreground: "#e2e8f0",
        cursor: "#7dd3fc",
        cursorAccent: "#020817",
        selectionBackground: "#334155",
        black: "#0f172a",
        red: "#fca5a5",
        green: "#86efac",
        yellow: "#fde68a",
        blue: "#93c5fd",
        magenta: "#d8b4fe",
        cyan: "#67e8f9",
        white: "#e2e8f0",
        brightBlack: "#475569",
        brightRed: "#fecaca",
        brightGreen: "#bbf7d0",
        brightYellow: "#fef3c7",
        brightBlue: "#bfdbfe",
        brightMagenta: "#e9d5ff",
        brightCyan: "#a5f3fc",
        brightWhite: "#f8fafc",
      },
      allowProposedApi: false,
      convertEol: false,
      disableStdin: attachment.status !== "running",
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host);
    fitAddon.fit();
    terminal.focus();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    renderedIdsRef.current = new Set();
    onReady?.(attachment.id, {
      getSelectionText: () => terminal.getSelection() ?? "",
      clearSelection: () => terminal.clearSelection(),
      focus: () => terminal.focus(),
    });

    const resize = () => {
      const currentTerminal = terminalRef.current;
      const currentFitAddon = fitAddonRef.current;
      if (!currentTerminal || !currentFitAddon || !window.electronAPI) return;
      currentFitAddon.fit();
      const payload: RuntimeResizeParams = {
        attachmentID: attachment.id,
        cols: currentTerminal.cols,
        rows: currentTerminal.rows,
      };
      void window.electronAPI
        .ipcInvoke("runtime:resize", payload)
        .catch(() => undefined);
    };

    const resizeObserver = new ResizeObserver(() => {
      resize();
    });
    resizeObserver.observe(host);

    const dataDisposable = terminal.onData((data) => {
      if (!window.electronAPI || attachment.status !== "running") return;
      void window.electronAPI
        .ipcInvoke("runtime:writeInput", {
          attachmentID: attachment.id,
          input: data,
        })
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
      onReady?.(attachment.id, null);
    };
  }, [attachment.id, attachment.status]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    if (attachment.transcript.length === 0) {
      terminal.clear();
      terminal.reset();
      renderedIdsRef.current = new Set();
      return;
    }

    const renderedIds = renderedIdsRef.current;
    attachment.transcript.forEach((item) => {
      if (renderedIds.has(item.id)) return;
      terminal.write(item.content);
      renderedIds.add(item.id);
    });

    terminal.scrollToBottom();
  }, [attachment.transcript, transcriptSignature]);

  return (
    <div ref={hostRef} className="h-72 rounded border border-[#1e293b] bg-[#020817]" />
  );
};

export default RuntimeTerminalSurface;
