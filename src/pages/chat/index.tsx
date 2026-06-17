import { Layout } from "antd";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Outlet } from "react-router-dom";

import RuntimeDock from "@/components/RuntimeDock";
import { useRuntimeDockStore } from "@/store";

import ConversationSider from "./ConversationSider";

export const Chat = () => {
  const panelOpen = useRuntimeDockStore((state) => state.panelOpen);

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
      <Panel defaultSize={72} minSize={55}>
        <Layout className="h-full flex-row">
          <ConversationSider />
          <Outlet />
        </Layout>
      </Panel>
      <PanelResizeHandle className="w-1 bg-[var(--gap-text)] transition-colors hover:bg-[var(--primary)]" />
      <Panel defaultSize={28} minSize={22} maxSize={45}>
        <RuntimeDock />
      </Panel>
    </PanelGroup>
  );
};
