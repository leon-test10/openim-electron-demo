import { Layout } from "antd";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Outlet } from "react-router-dom";

import TerminalDock from "@/components/TerminalDock";
import { useTerminalDockStore } from "@/store";

import ConversationSider from "./ConversationSider";

export const Chat = () => {
  const panelOpen = useTerminalDockStore((state) => state.panelOpen);

  if (!panelOpen) {
    return (
      <Layout className="flex-row">
        <ConversationSider />
        <Outlet />
      </Layout>
    );
  }

  return (
    <PanelGroup direction="horizontal" className="h-full">
      <Panel defaultSize={68} minSize={40}>
        <Layout className="h-full flex-row">
          <ConversationSider />
          <Outlet />
        </Layout>
      </Panel>
      <PanelResizeHandle className="w-1 bg-[var(--gap-text)] transition-colors hover:bg-[var(--primary)]" />
      <Panel defaultSize={32} minSize={22} maxSize={60}>
        <TerminalDock />
      </Panel>
    </PanelGroup>
  );
};
