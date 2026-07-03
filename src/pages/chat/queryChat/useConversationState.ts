import { useLatest, useThrottleFn, useUpdateEffect } from "ahooks";
import { useEffect } from "react";
import { useParams } from "react-router-dom";

import { IMSDK } from "@/layout/MainContentWrap";
import { useConversationStore, useUserStore } from "@/store";
import { getAuthMode } from "@/utils/storage";

export default function useConversationState() {
  const syncState = useUserStore((state) => state.syncState);
  const latestSyncState = useLatest(syncState);
  const currentConversation = useConversationStore(
    (state) => state.currentConversation,
  );
  const conversationList = useConversationStore((state) => state.conversationList);
  const updateCurrentConversation = useConversationStore(
    (state) => state.updateCurrentConversation,
  );
  const latestCurrentConversation = useLatest(currentConversation);
  const { conversationID } = useParams();

  useEffect(() => {
    if (getAuthMode() !== "offline" || !conversationID) return;
    const routeConversation = conversationList.find(
      (item) => item.conversationID === conversationID,
    );
    if (!routeConversation) return;
    if (currentConversation?.conversationID === conversationID) return;
    void updateCurrentConversation(routeConversation);
  }, [conversationID, conversationList, currentConversation?.conversationID]);

  useUpdateEffect(() => {
    if (syncState !== "loading") {
      checkConversationState();
    }
  }, [syncState]);

  useUpdateEffect(() => {
    throttleCheckConversationState();
  }, [currentConversation?.unreadCount]);

  useEffect(() => {
    checkConversationState();
  }, [currentConversation?.conversationID]);

  const checkConversationState = () => {
    if (!latestCurrentConversation.current || latestSyncState.current === "loading")
      return;
    if (getAuthMode() === "offline") return;

    if (latestCurrentConversation.current.unreadCount > 0) {
      IMSDK.markConversationMessageAsRead(
        latestCurrentConversation.current.conversationID,
      );
    }
  };

  const { run: throttleCheckConversationState } = useThrottleFn(
    checkConversationState,
    { wait: 2000, leading: false },
  );

  return {
    currentConversation,
  };
}
