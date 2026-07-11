import { Layout } from "antd";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Outlet } from "react-router-dom";

import AgentPanel from "@/components/AgentPanel";
import AgentTerminalPanel from "@/components/AgentTerminalPanel";
import { useAgentSessionStore } from "@/store";

import ConversationSider from "./ConversationSider";

const ResizeHandle = ({ direction }: { direction: "horizontal" | "vertical" }) => (
  <PanelResizeHandle
    className={
      direction === "horizontal"
        ? "w-1 shrink-0 bg-[var(--gap-text)] transition-colors hover:bg-[var(--primary)]"
        : "h-1 shrink-0 bg-[var(--gap-text)] transition-colors hover:bg-[var(--primary)]"
    }
  />
);

const ChatAndAgent = ({ agentOpen }: { agentOpen: boolean }) => {
  if (!agentOpen) return <Outlet />;
  return (
    <PanelGroup direction="horizontal" className="h-full min-w-0">
      <Panel defaultSize={66} minSize={32}>
        <Outlet />
      </Panel>
      <ResizeHandle direction="horizontal" />
      <Panel defaultSize={34} minSize={24} maxSize={58}>
        <AgentPanel />
      </Panel>
    </PanelGroup>
  );
};

export const Chat = () => {
  const agentOpen = useAgentSessionStore((state) => state.agentPanelOpen);
  const terminalOpen = useAgentSessionStore((state) => state.terminalPanelOpen);

  return (
    <Layout className="min-w-0 flex-row">
      <ConversationSider />
      <div className="min-w-0 flex-1">
        {terminalOpen ? (
          <PanelGroup direction="vertical" className="h-full">
            <Panel defaultSize={70} minSize={30}>
              <ChatAndAgent agentOpen={agentOpen} />
            </Panel>
            <ResizeHandle direction="vertical" />
            <Panel defaultSize={30} minSize={16} maxSize={65}>
              <AgentTerminalPanel />
            </Panel>
          </PanelGroup>
        ) : (
          <ChatAndAgent agentOpen={agentOpen} />
        )}
      </div>
    </Layout>
  );
};
