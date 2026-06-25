import { CloseOutlined } from "@ant-design/icons";
import { useLatest } from "ahooks";
import { Button, message as antdMessage } from "antd";
import { t } from "i18next";
import { forwardRef, ForwardRefRenderFunction, memo, useEffect, useState } from "react";

import CKEditor from "@/components/CKEditor";
import { getCleanText } from "@/components/CKEditor/utils";
import i18n from "@/i18n";
import { IMSDK } from "@/layout/MainContentWrap";
import emitter, { PendingChatAttachmentParams } from "@/utils/events";

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

const ChatFooter: ForwardRefRenderFunction<unknown, unknown> = (_, ref) => {
  const [html, setHtml] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<
    PendingChatAttachmentParams[]
  >([]);
  const latestHtml = useLatest(html);

  const { getFileMessage, getImageMessage } = useFileMessage();
  const { sendMessage } = useSendMessage();

  const onChange = (value: string) => {
    setHtml(value);
  };

  const escapeHtml = (text: string) =>
    text
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const textToDraftHtml = (text: string) =>
    text.trim() ? `<pre><code>${escapeHtml(text.trim())}</code></pre>` : "";

  useEffect(() => {
    const onAppend = (text: string) => {
      if (!text) return;
      setHtml((prev) => `${prev}${textToDraftHtml(text)}`);
    };

    const onReplace = (text: string) => {
      setHtml(textToDraftHtml(text));
    };

    const onSend = async (text: string) => {
      const cleanText = text.trim();
      if (!cleanText) return;
      const message = (await IMSDK.createTextMessage(cleanText)).data;
      setHtml("");
      sendMessage({ message });
    };
    const onPendingAttachment = (attachment: PendingChatAttachmentParams) => {
      setPendingAttachments((current) => [...current, attachment]);
    };

    emitter.on("APPEND_CHAT_INPUT", onAppend);
    emitter.on("REPLACE_CHAT_INPUT", onReplace);
    emitter.on("SEND_CHAT_INPUT", onSend);
    emitter.on("ADD_PENDING_CHAT_ATTACHMENT", onPendingAttachment);
    return () => {
      emitter.off("APPEND_CHAT_INPUT", onAppend);
      emitter.off("REPLACE_CHAT_INPUT", onReplace);
      emitter.off("SEND_CHAT_INPUT", onSend);
      emitter.off("ADD_PENDING_CHAT_ATTACHMENT", onPendingAttachment);
    };
  }, [sendMessage]);

  const removePendingAttachment = (index: number) => {
    setPendingAttachments((current) =>
      current.filter((_, currentIndex) => currentIndex !== index),
    );
  };

  const sendPendingAttachment = async (attachment: PendingChatAttachmentParams) => {
    const workspaceFile = await window.electronAPI?.getFileByPath(attachment.filePath);
    if (!workspaceFile) {
      throw new Error(`Cannot read workspace file: ${attachment.relativePath}`);
    }

    const fileWithPath = Object.assign(workspaceFile, {
      path: attachment.filePath,
    });
    const message =
      attachment.sendKind === "image"
        ? await getImageMessage(fileWithPath)
        : await getFileMessage(fileWithPath);

    await sendMessage({ message });
  };

  const enterToSend = async () => {
    const cleanText = getCleanText(latestHtml.current ?? "");
    const attachmentsToSend = [...pendingAttachments];

    if (!cleanText && attachmentsToSend.length === 0) return;

    setHtml("");
    setPendingAttachments([]);

    if (cleanText) {
      const message = (await IMSDK.createTextMessage(cleanText)).data;
      await sendMessage({ message });
    }

    for (const attachment of attachmentsToSend) {
      try {
        await sendPendingAttachment(attachment);
      } catch (error) {
        setPendingAttachments((current) => [...current, attachment]);
        const errorMessage = error instanceof Error ? error.message : String(error);
        antdMessage.error(errorMessage || "Failed to send workspace file");
      }
    }
  };

  return (
    <footer className="relative h-full bg-white py-px">
      <div className="flex h-full flex-col border-t border-t-[var(--gap-text)]">
        <SendActionBar sendMessage={sendMessage} getImageMessage={getImageMessage} />
        <div className="relative flex flex-1 flex-col overflow-hidden">
          {pendingAttachments.length > 0 && (
            <div className="mx-4 mt-2 flex flex-wrap gap-2">
              {pendingAttachments.map((attachment, index) => (
                <div
                  className="flex max-w-[280px] items-center gap-1 rounded border border-[#d0d5dd] bg-[#f8fafc] px-2 py-1 text-xs text-[#344054]"
                  key={`${attachment.filePath}-${index}`}
                  title={attachment.filePath}
                >
                  <span className="truncate">
                    Pending {attachment.sendKind}: {attachment.fileName}
                  </span>
                  <Button
                    size="small"
                    type="text"
                    className="!h-5 !w-5 shrink-0 !p-0"
                    icon={<CloseOutlined rev={undefined} />}
                    onClick={() => removePendingAttachment(index)}
                    aria-label={`Remove ${attachment.fileName}`}
                  />
                </div>
              ))}
            </div>
          )}
          <CKEditor value={html} onEnter={enterToSend} onChange={onChange} />
          <div className="flex items-center justify-end py-2 pr-3">
            <Button className="w-fit px-6 py-1" type="primary" onClick={enterToSend}>
              {t("placeholder.send")}
            </Button>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default memo(forwardRef(ChatFooter));
