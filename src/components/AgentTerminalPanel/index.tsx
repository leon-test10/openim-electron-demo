import "@xterm/xterm/css/xterm.css";

import { CloseOutlined, StopOutlined } from "@ant-design/icons";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { Button, Empty, message } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { useAgentSessionStore } from "@/store";

type TerminalEvent = {
  tabID: string;
  type: "started" | "stdout" | "exit" | "error" | "stopped";
  data?: string;
};

const AgentTerminalPanel = ({
  conversationIDOverride,
}: {
  conversationIDOverride?: string;
}) => {
  const { conversationID: routeConversationID } = useParams();
  const conversationID = conversationIDOverride ?? routeConversationID;
  const sessions = useAgentSessionStore((state) => state.sessions);
  const activeMap = useAgentSessionStore((state) => state.activeSessionByConversation);
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal>();
  const fitRef = useRef<FitAddon>();
  const [status, setStatus] = useState("detached");

  const activeSession = useMemo(() => {
    const available = sessions.filter(
      (session) => session.conversationID === conversationID && !session.archived,
    );
    return (
      available.find((session) => session.id === activeMap[conversationID ?? ""]) ??
      available.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)[0]
    );
  }, [activeMap, conversationID, sessions]);
  const tabID = activeSession ? `agent-terminal-${activeSession.id}` : undefined;

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !tabID || !activeSession || !window.electronAPI) return;
    host.replaceChildren();
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: false,
      fontFamily: 'Consolas, "Cascadia Mono", monospace',
      fontSize: 13,
      theme: {
        background: "#0c0c0c",
        foreground: "#d4d4d4",
        cursor: "#ffffff",
        blue: "#5ea6ff",
        green: "#23d18b",
        red: "#f14c4c",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    fit.fit();
    terminalRef.current = terminal;
    fitRef.current = fit;
    let disposed = false;

    const unsubscribe = window.electronAPI.subscribe(
      "terminal:event",
      (event: TerminalEvent) => {
        if (event.tabID !== tabID) return;
        if (event.data) terminal.write(event.data);
        setStatus(
          event.type === "started" || event.type === "stdout" ? "running" : event.type,
        );
      },
    );
    const input = terminal.onData((data) => {
      void window.electronAPI?.ipcInvoke("terminal:write", { tabID, data });
    });
    const resize = () => {
      if (disposed) return;
      try {
        fit.fit();
        void window.electronAPI?.ipcInvoke("terminal:resize", {
          tabID,
          cols: terminal.cols,
          rows: terminal.rows,
        });
      } catch {
        // The panel may be temporarily zero-sized while resizing.
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    setStatus("starting");
    void window.electronAPI
      .ipcInvoke<{
        instance?: { status: string; lastError?: string };
        output: string;
      }>("agent-session:openTerminal", {
        sessionID: activeSession.id,
        cols: terminal.cols,
        rows: terminal.rows,
      })
      .then((result) => {
        if (disposed) return;
        if (result.output) terminal.write(result.output);
        setStatus(result.instance?.status ?? "error");
        if (result.instance?.lastError)
          terminal.writeln(`\r\n${result.instance.lastError}`);
        terminal.focus();
      })
      .catch((error) => {
        if (disposed) return;
        setStatus("error");
        terminal.writeln(
          `\r\n${error instanceof Error ? error.message : String(error)}`,
        );
      });

    return () => {
      disposed = true;
      observer.disconnect();
      input.dispose();
      unsubscribe();
      terminal.dispose();
      terminalRef.current = undefined;
      fitRef.current = undefined;
    };
  }, [activeSession?.id, tabID]);

  if (!activeSession) {
    return (
      <div className="flex h-full items-center justify-center bg-[#0c0c0c]">
        <Empty description="Create an Agent session to attach the terminal" />
      </div>
    );
  }

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-[#0c0c0c] text-[#d4d4d4]"
      data-testid="agent-terminal-panel"
    >
      <header className="flex h-8 shrink-0 items-center justify-between border-b border-[#2b2b2b] px-3 text-xs">
        <span className="truncate">
          OpenCode TUI · {activeSession.title} · {status}
        </span>
        <div>
          <Button
            type="text"
            size="small"
            className="!text-[#d4d4d4]"
            icon={<StopOutlined rev={undefined} />}
            onClick={() => {
              if (!tabID) return;
              void window.electronAPI?.ipcInvoke("terminal:stop", tabID).then(() => {
                setStatus("stopped");
                message.success("Attached terminal stopped");
              });
            }}
          />
          <Button
            type="text"
            size="small"
            className="!text-[#d4d4d4]"
            icon={<CloseOutlined rev={undefined} />}
            onClick={() =>
              void useAgentSessionStore
                .getState()
                .setPanelState({ terminalPanelOpen: false })
            }
          />
        </div>
      </header>
      <div
        ref={hostRef}
        className="min-h-0 flex-1 overflow-hidden p-1 [&_.xterm]:h-full"
      />
    </section>
  );
};

export default AgentTerminalPanel;
