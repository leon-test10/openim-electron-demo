import { useEffect, useState } from "react";

import TerminalDock from "@/components/TerminalDock";
import {
  useConversationStore,
  useMessageSelectionStore,
  useTerminalDockStore,
  useUserStore,
} from "@/store";
import { e2eConversation, e2eConversationID, e2eMessages } from "@/utils/e2eMockData";

import ChatHeader from "../chat/queryChat/ChatHeader";
import MessageHistoryDrawer from "../chat/queryChat/MessageHistoryDrawer";
import MessageItem from "../chat/queryChat/MessageItem";
import MessageSelectionToolbar from "../chat/queryChat/MessageSelectionToolbar";

const E2EHarness = () => {
  const [historyOpen, setHistoryOpen] = useState(false);
  const selectionActive = useMessageSelectionStore(
    (state) => state.activeConversationID === e2eConversationID,
  );

  useEffect(() => {
    useUserStore.setState((state) => ({
      ...state,
      selfInfo: {
        ...state.selfInfo,
        userID: "e2e_self",
        nickname: "E2E Self",
      },
    }));
    useConversationStore.setState({
      currentConversation: e2eConversation,
      conversationList: [e2eConversation],
    });
    useTerminalDockStore.getState().setPanelOpen(true);

    return () => {
      useMessageSelectionStore.getState().clearSelection(e2eConversationID);
      useTerminalDockStore.getState().setPanelOpen(false);
    };
  }, []);

  return (
    <div className="flex h-screen flex-col bg-white">
      <ChatHeader onOpenHistory={() => setHistoryOpen(true)} />
      <div
        className="relative min-h-0 flex-1 overflow-auto"
        data-testid="e2e-chat-area"
      >
        {selectionActive && (
          <MessageSelectionToolbar conversationID={e2eConversationID} />
        )}
        {e2eMessages.map((message) => (
          <MessageItem
            key={message.clientMsgID}
            conversationID={e2eConversationID}
            message={message}
            isSender={message.sendID === "e2e_self"}
          />
        ))}
      </div>
      <MessageHistoryDrawer
        conversationID={e2eConversationID}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
      />
      <TerminalDock />
    </div>
  );
};

export default E2EHarness;
