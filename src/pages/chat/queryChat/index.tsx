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
    <Layout id="chat-container" className="relative overflow-hidden">
      <ChatHeader onOpenHistory={() => setHistoryDrawerOpen(true)} />
      <PanelGroup direction="vertical">
        <Panel id="chat-main" order={0}>
          <ChatContent />
        </Panel>
        <PanelResizeHandle />
        <Panel
          id="chat-footer"
          order={1}
          defaultSize={25}
          maxSize={60}
          className="min-h-[200px]"
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
