import { useLatest } from "ahooks";
import { Button } from "antd";
import { t } from "i18next";
import { forwardRef, ForwardRefRenderFunction, memo, useState } from "react";

import CKEditor from "@/components/CKEditor";
import { getCleanText } from "@/components/CKEditor/utils";
import { useCodexConversation } from "@/hooks/useCodexConversation";
import i18n from "@/i18n";
import { IMSDK } from "@/layout/MainContentWrap";

import SendActionBar from "./SendActionBar";
import { useFileMessage } from "./SendActionBar/useFileMessage";
import { useSendMessage } from "./useSendMessage";

const sendActions = [
  { label: t("placeholder.sendWithEnter"), key: "enter" },
  { label: t("placeholder.sendWithShiftEnter"), key: "enterwithshift" },
];

i18n.on("languageChanged", () => {
  sendActions[0].label = t("placeholder.sendWithEnter");
  sendActions[1].label = t("placeholder.sendWithShiftEnter");
});

const ChatFooter: ForwardRefRenderFunction<unknown, unknown> = () => {
  const [html, setHtml] = useState("");
  const latestHtml = useLatest(html);

  const { getImageMessage } = useFileMessage();
  const { sendMessage } = useSendMessage();
  const { isCodexConversation, activeJob, queuedJobCount, cancel } =
    useCodexConversation();

  const onChange = (value: string) => {
    setHtml(value);
  };

  const enterToSend = async () => {
    const cleanText = getCleanText(latestHtml.current);
    const message = (await IMSDK.createTextMessage(cleanText)).data;
    setHtml("");
    if (!cleanText) return;

    sendMessage({ message });
  };

  return (
    <footer className="relative h-full bg-white py-px">
      <div className="flex h-full flex-col border-t border-t-[var(--gap-text)]">
        <SendActionBar sendMessage={sendMessage} getImageMessage={getImageMessage} />
        <div className="relative flex flex-1 flex-col overflow-hidden">
          {isCodexConversation && activeJob && (
            <div className="flex items-center justify-between border-b border-b-[var(--gap-text)] px-3 py-1 text-xs text-[var(--sub-text)]">
              <span>
                Codex is {activeJob.status}. New messages will queue
                {queuedJobCount > 0 ? ` (${queuedJobCount} waiting)` : ""}.
              </span>
              {activeJob.canCancel && (
                <Button size="small" danger onClick={() => void cancel()}>
                  Cancel
                </Button>
              )}
            </div>
          )}
          <CKEditor
            value={html}
            onEnter={() => void enterToSend()}
            onChange={onChange}
          />
          <div className="flex items-center justify-end py-2 pr-3">
            <Button
              className="w-fit px-6 py-1"
              type="primary"
              onClick={() => void enterToSend()}
            >
              {t("placeholder.send")}
            </Button>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default memo(forwardRef(ChatFooter));
