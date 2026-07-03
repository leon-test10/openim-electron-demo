import { useRequest } from "ahooks";
import { Button, Empty, Input, Modal, Spin } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { GroupedVirtuoso, GroupedVirtuosoHandle } from "react-virtuoso";

import { useContactStore, useConversationStore, useUserStore } from "@/store";
import { formatContactsByWorker } from "@/utils/contactsFormat";
import { emit } from "@/utils/events";

import AlphabetIndex from "./AlphabetIndex";
import FriendListItem from "./FriendListItem";

export const MyFriends = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const authMode = useUserStore((state) => state.authMode);
  const friendList = useContactStore((state) => state.friendList);
  const createOfflineVirtualFriend = useContactStore(
    (state) => state.createOfflineVirtualFriend,
  );
  const conversationList = useConversationStore((state) => state.conversationList);
  const updateCurrentConversation = useConversationStore(
    (state) => state.updateCurrentConversation,
  );
  const [offlineModalOpen, setOfflineModalOpen] = useState(false);
  const [offlineNickname, setOfflineNickname] = useState("");
  const virtuoso = useRef<GroupedVirtuosoHandle>(null);
  const alphabetRef = useRef<{ updateCurrentLetter: (letter: string) => void }>(null);
  const offline = authMode === "offline";

  const { data: sectionData, cancel } = useRequest(
    () => formatContactsByWorker(friendList),
    {
      refreshDeps: [friendList],
    },
  );

  useEffect(() => {
    return () => {
      cancel();
    };
  }, []);

  const scrollToLetter = useCallback(
    (idx: number) => {
      const prevNum = sectionData?.groupCounts.slice(0, idx).reduce((a, b) => a + b, 0);
      console.log(prevNum);

      virtuoso.current?.scrollToIndex({
        index: prevNum ?? 0,
        // behavior: "smooth",
      });
    },
    [sectionData?.groupCounts],
  );

  const showUserCard = useCallback(
    (userID: string) => {
      if (offline) {
        const conversation = conversationList.find((item) => item.userID === userID);
        if (!conversation) return;
        updateCurrentConversation(conversation);
        navigate(`/chat/${conversation.conversationID}`);
        return;
      }
      emit("OPEN_USER_CARD", {
        userID,
      });
    },
    [conversationList, navigate, offline, updateCurrentConversation],
  );

  const createOfflineFriend = async () => {
    const conversation = await createOfflineVirtualFriend({
      nickname: offlineNickname,
    });
    setOfflineModalOpen(false);
    setOfflineNickname("");
    if (!conversation) return;
    await updateCurrentConversation(conversation);
    navigate(`/chat/${conversation.conversationID}`);
  };

  const determineCurrentGroup = (startIndex: number) => {
    if (!sectionData) return;

    let currentItemIndex = 0;

    for (
      let groupIndex = 0;
      groupIndex < sectionData.groupCounts.length;
      groupIndex++
    ) {
      const groupItemCount = sectionData.groupCounts[groupIndex];

      if (startIndex < currentItemIndex + groupItemCount) {
        alphabetRef.current?.updateCurrentLetter(sectionData.indexList[groupIndex]);
        break;
      }

      currentItemIndex += groupItemCount;
    }
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-white">
      <div className="m-5.5 flex items-center justify-between">
        <div className="text-base font-extrabold">{t("placeholder.myFriend")}</div>
        {offline && (
          <Button
            type="primary"
            onClick={() => setOfflineModalOpen(true)}
            data-testid="offline-contact-create-friend-button"
          >
            Create Virtual Friend
          </Button>
        )}
      </div>
      {!sectionData ? (
        <Spin />
      ) : !sectionData.groupCounts.length ? (
        <Empty className="mt-[30%]" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <div className="ml-4 mt-4 flex-1 overflow-auto pr-4">
          <AlphabetIndex
            ref={alphabetRef}
            indexList={sectionData.indexList}
            scrollToLetter={scrollToLetter}
          />

          <GroupedVirtuoso
            ref={virtuoso}
            groupCounts={sectionData.groupCounts}
            groupContent={(index) => (
              <div>
                <div className="bg-white px-3.5 pb-1 text-sm text-[#8E9AB0FF]">
                  {sectionData.indexList[index]}
                </div>
                <div className="mx-3.5 mb-3 h-px w-full bg-[#E8EAEFFF] bg-white" />
              </div>
            )}
            itemContent={(index) => {
              return (
                <FriendListItem
                  key={sectionData.totalList[index].userID}
                  friend={sectionData.totalList[index]}
                  showUserCard={showUserCard}
                />
              );
            }}
            rangeChanged={({ startIndex }) => determineCurrentGroup(startIndex)}
            className="no-scrollbar h-full overflow-x-hidden"
          />
        </div>
      )}
      <Modal
        title="Create Virtual Friend"
        open={offlineModalOpen}
        onCancel={() => setOfflineModalOpen(false)}
        onOk={() => void createOfflineFriend()}
        okButtonProps={{
          disabled: !offlineNickname.trim(),
          "data-testid": "offline-contact-friend-create-confirm",
        }}
      >
        <Input
          autoFocus
          placeholder="Friend nickname"
          value={offlineNickname}
          onChange={(event) => setOfflineNickname(event.target.value)}
          onPressEnter={() => offlineNickname.trim() && void createOfflineFriend()}
          data-testid="offline-contact-friend-nickname"
        />
      </Modal>
    </div>
  );
};
