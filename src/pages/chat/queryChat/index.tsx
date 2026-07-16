import { InfoCircleOutlined } from "@ant-design/icons";
import { SessionType } from "@openim/wasm-client-sdk";
import { useUnmount } from "ahooks";
import { Layout } from "antd";
import { t } from "i18next";
import { useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

import { useConversationStore } from "@/store";

import ChatContent from "./ChatContent";
import ChatFooter from "./ChatFooter";
import ChatHeader from "./ChatHeader";
import MessageHistoryDrawer from "./MessageHistoryDrawer";
import useConversationState from "./useConversationState";

export const QueryChat = () => {
  const updateCurrentConversation = useConversationStore(
    (state) => state.updateCurrentConversation,
  );
  const currentConversation = useConversationStore(
    (state) => state.currentConversation,
  );
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);

  useConversationState();

  useUnmount(() => {
    updateCurrentConversation();
  });

  return (
    <Layout
      id="chat-container"
      className="relative h-full min-h-0 min-w-0 overflow-hidden"
    >
      <ChatHeader onOpenHistory={() => setHistoryDrawerOpen(true)} />
      <PanelGroup direction="vertical" className="min-h-0 flex-1">
        <Panel
          id="chat-messages-panel"
          order={0}
          defaultSize={75}
          minSize={35}
          className="min-h-0"
        >
          <ChatContent />
        </Panel>
        <PanelResizeHandle className="h-1 shrink-0 bg-[var(--gap-text)] transition-colors hover:bg-[var(--primary)]" />
        <Panel
          id="chat-footer"
          order={1}
          defaultSize={25}
          minSize={18}
          maxSize={60}
          className="min-h-0"
        >
          <ChatFooter />
        </Panel>
      </PanelGroup>
      <MessageHistoryDrawer
        conversationID={currentConversation?.conversationID}
        open={historyDrawerOpen}
        onClose={() => setHistoryDrawerOpen(false)}
      />
    </Layout>
  );
};
