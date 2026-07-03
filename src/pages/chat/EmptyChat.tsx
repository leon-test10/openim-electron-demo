import { Button, Input, Layout, Modal } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import empty_chat_bg from "@/assets/images/empty_chat_bg.png";
import { useContactStore, useConversationStore } from "@/store";
import { emit } from "@/utils/events";
import { getAuthMode } from "@/utils/storage";

export const EmptyChat = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const createOfflineVirtualFriend = useContactStore(
    (state) => state.createOfflineVirtualFriend,
  );
  const updateCurrentConversation = useConversationStore(
    (state) => state.updateCurrentConversation,
  );
  const [offlineModalOpen, setOfflineModalOpen] = useState(false);
  const [offlineNickname, setOfflineNickname] = useState("");
  const offline = getAuthMode() === "offline";
  const createNow = () => {
    emit("OPEN_CHOOSE_MODAL", {
      type: "CRATE_GROUP",
    });
  };

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

  if (offline) {
    return (
      <Layout className="no-mobile flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="mb-3 text-xl font-medium">Offline conversations</div>
          <div className="text-[var(--sub-text)]">
            Create a virtual friend to start a local-only conversation.
          </div>
          <img className="mx-auto mt-12" src={empty_chat_bg} alt="" width={320} />
          <div className="mt-16 flex justify-center">
            <Button
              className="px-8"
              type="primary"
              onClick={() => setOfflineModalOpen(true)}
              data-testid="offline-empty-create-friend-button"
            >
              Create Virtual Friend
            </Button>
          </div>
          <Modal
            title="Create Virtual Friend"
            open={offlineModalOpen}
            onCancel={() => setOfflineModalOpen(false)}
            onOk={() => void createOfflineFriend()}
            okButtonProps={{
              disabled: !offlineNickname.trim(),
              "data-testid": "offline-friend-create-confirm",
            }}
          >
            <Input
              autoFocus
              placeholder="Friend nickname"
              value={offlineNickname}
              onChange={(event) => setOfflineNickname(event.target.value)}
              onPressEnter={() => offlineNickname.trim() && void createOfflineFriend()}
              data-testid="offline-friend-nickname"
            />
          </Modal>
        </div>
      </Layout>
    );
  }

  return (
    <Layout className="no-mobile flex items-center justify-center bg-white">
      <div>
        <div className="mb-12 flex flex-col items-center">
          <div className="mb-3 text-xl font-medium">{t("placeholder.createGroup")}</div>
          <div className="text-[var(--sub-text)]">
            {t("placeholder.createGroupToast")}
          </div>
        </div>
        <img src={empty_chat_bg} alt="" width={320} />

        <div className="mt-28 flex justify-center">
          <Button className="px-8" type="primary" onClick={createNow}>
            {t("placeholder.createNow")}
          </Button>
        </div>
      </div>
    </Layout>
  );
};
