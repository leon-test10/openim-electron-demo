import { CloseOutlined } from "@ant-design/icons";
import { MessageType, SessionType } from "@openim/wasm-client-sdk";
import { MessageItem } from "@openim/wasm-client-sdk/lib/types/entity";
import { useLatest } from "ahooks";
import {
  Button,
  InputNumber,
  message as antdMessage,
  Modal,
  Switch,
  Tooltip,
} from "antd";
import { t } from "i18next";
import {
  forwardRef,
  ForwardRefRenderFunction,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import CKEditor from "@/components/CKEditor";
import { getCleanText } from "@/components/CKEditor/utils";
import useGroupMembers from "@/hooks/useGroupMembers";
import i18n from "@/i18n";
import { IMSDK } from "@/layout/MainContentWrap";
import { BotTargetCandidate, detectBotTrigger } from "@/services/botTrigger";
import {
  attachAgentRequestEnvelope,
  createAgentRequest,
  createContextPolicy,
} from "@/services/humanAgentCollaboration";
import {
  useAgentSessionStore,
  useConversationStore,
  useMessageSelectionStore,
  usePendingAgentRequestStore,
  useTerminalDockStore,
  useUserStore,
} from "@/store";
import emitter, { PendingChatAttachmentParams } from "@/utils/events";
import { parseFolderShareMessage } from "@/utils/folderShare";
import { recordLocalFileForMessage } from "@/utils/localFileCache";
import { recordLocalFolderShare } from "@/utils/localFolderShareCache";
import { getAuthMode } from "@/utils/storage";

import BotMentionAutocomplete from "./BotMentionAutocomplete";
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

const AUTO_INJECT_WARNING =
  "Auto Inject is experimental. Remote IM messages may trigger prompts to be injected into your local terminal. Only enable this in trusted conversations.";
const AUTO_REPLY_WARNING =
  "Auto Reply is experimental. Structured final_answer events may be sent back to the current IM conversation automatically. Only enable this when you trust the runtime and the conversation.";

const ChatFooter: ForwardRefRenderFunction<unknown, unknown> = (_, ref) => {
  const [html, setHtml] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<
    PendingChatAttachmentParams[]
  >([]);
  const pendingAttachmentsRef = useRef<PendingChatAttachmentParams[]>([]);
  const latestHtml = useLatest(html);
  const currentConversation = useConversationStore(
    (state) => state.currentConversation,
  );
  const selfInfo = useUserStore((state) => state.selfInfo);
  const botDetectionEnabled = usePendingAgentRequestStore(
    (state) => state.botDetectionEnabled,
  );
  const setBotDetectionEnabled = usePendingAgentRequestStore(
    (state) => state.setBotDetectionEnabled,
  );
  // The legacy Terminal Dock automation path is intentionally disabled. Agent
  // requests are routed globally and Agent output always requires IM confirmation.
  const autoInjectEnabled = false;
  const autoReplyTextEnabled = false;
  const autoFileAttachmentEnabled = false;
  const botContextMessageLimit = useTerminalDockStore(
    (state) => state.botContextMessageLimit,
  );
  const requesterContextMessageLimit = useAgentSessionStore(
    (state) =>
      state.botContextLimitByConversation[currentConversation?.conversationID ?? ""] ??
      20,
  );
  const requesterIncludeAttachments = useAgentSessionStore(
    (state) =>
      state.botIncludeAttachmentsByConversation[
        currentConversation?.conversationID ?? ""
      ] ?? true,
  );
  const selectedContextMessageCount = useMessageSelectionStore(
    (state) =>
      Object.keys(
        state.selectedMessagesByConversation[
          currentConversation?.conversationID ?? ""
        ] ?? {},
      ).length,
  );
  const setAutoInjectEnabled = useTerminalDockStore(
    (state) => state.setAutoInjectEnabled,
  );
  const setAutoReplyTextEnabled = useTerminalDockStore(
    (state) => state.setAutoReplyTextEnabled,
  );
  const setAutoFileAttachmentEnabled = useTerminalDockStore(
    (state) => state.setAutoFileAttachmentEnabled,
  );
  const setBotContextMessageLimit = useTerminalDockStore(
    (state) => state.setBotContextMessageLimit,
  );
  const activeWorkspaceID = useTerminalDockStore((state) => state.activeWorkspaceID);
  const workspaces = useTerminalDockStore((state) => state.workspaces);
  const tabsByWorkspace = useTerminalDockStore((state) => state.tabsByWorkspace);
  const activeTabByWorkspace = useTerminalDockStore(
    (state) => state.activeTabByWorkspace,
  );
  const activeAgentRunByWorkspace = useTerminalDockStore(
    (state) => state.activeAgentRunByWorkspace,
  );
  const { fetchState: groupMemberState } = useGroupMembers();

  const { getFileMessage, getFolderMessage, getImageMessage } = useFileMessage();
  const { sendMessage } = useSendMessage();

  const automationReady = useMemo(() => {
    if (!currentConversation?.conversationID || !activeWorkspaceID) return false;
    const activeWorkspace = workspaces.find(
      (workspace) => workspace.id === activeWorkspaceID,
    );
    const activeTabID = activeTabByWorkspace[activeWorkspaceID];
    const activeTab = tabsByWorkspace[activeWorkspaceID]?.find(
      (tab) => tab.id === activeTabID,
    );

    return Boolean(
      activeWorkspace?.linkedConversationIDs.includes(
        currentConversation.conversationID,
      ) && activeTab?.status === "running",
    );
  }, [
    activeTabByWorkspace,
    activeWorkspaceID,
    currentConversation?.conversationID,
    tabsByWorkspace,
    workspaces,
  ]);
  const activeAgentRun = activeWorkspaceID
    ? activeAgentRunByWorkspace[activeWorkspaceID]
    : undefined;
  const selfMentionTarget = selfInfo.nickname || selfInfo.userID;
  const selfMentionTemplate = selfMentionTarget
    ? `@bot @${selfMentionTarget}`
    : "@bot @<your user id>";
  const automationStateText = automationReady
    ? autoReplyTextEnabled && activeAgentRun
      ? "waiting for final answer"
      : "ready"
    : botDetectionEnabled ||
      autoInjectEnabled ||
      autoReplyTextEnabled ||
      autoFileAttachmentEnabled
    ? "needs linked running terminal"
    : "off";

  const botTargetCandidates = useMemo<BotTargetCandidate[]>(() => {
    const candidates: BotTargetCandidate[] = [
      { userID: selfInfo.userID, nickname: selfInfo.nickname },
    ];

    if (currentConversation?.conversationType === SessionType.Single) {
      candidates.push({
        userID: currentConversation.userID,
        nickname: currentConversation.showName,
      });
    } else {
      for (const member of groupMemberState.groupMemberList) {
        if (member.userID === selfInfo.userID) continue;
        if (candidates.some((c) => c.userID === member.userID)) continue;
        candidates.push({
          userID: member.userID,
          nickname: member.nickname,
        });
      }
    }

    return candidates.filter((c) => Boolean(c.userID));
  }, [
    currentConversation,
    groupMemberState.groupMemberList,
    selfInfo.nickname,
    selfInfo.userID,
  ]);

  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionVisible, setMentionVisible] = useState(false);
  const mentionStateRef = useRef<{ prefixHTML: string; prefixText: string }>({
    prefixHTML: "",
    prefixText: "",
  });

  const detectBotMention = (html: string) => {
    const clean = getCleanText(html);
    const botAtMatch = clean.match(/@bot\s*@(\S*)$/);
    if (botAtMatch) {
      const partial = botAtMatch[1];
      const mentionStart = clean.indexOf(botAtMatch[0]);
      const prefixClean = clean.slice(0, mentionStart);
      setMentionQuery(partial);
      setMentionVisible(true);
      mentionStateRef.current = {
        prefixText: prefixClean,
        prefixHTML: "",
      };
    } else {
      setMentionQuery("");
      setMentionVisible(false);
    }
  };

  const handleMentionSelect = (candidate: BotTargetCandidate) => {
    const displayName = candidate.nickname || candidate.userID;
    const mention = `@bot @${displayName} `;
    const prefix = mentionStateRef.current.prefixText;
    const newText = prefix ? `${prefix}${mention}` : mention;

    // Convert plain text to CKEditor HTML (paragraph-wrapped)
    const escaped = escapeHtml(newText);
    setHtml(`<p>${escaped}</p>`);
    setMentionVisible(false);
    setMentionQuery("");
  };

  const insertSelfBotMention = () => {
    setHtml((prev) => `${prev}${escapeHtml(`${selfMentionTemplate} `)}`);
  };

  const onAutoInjectChange = (checked: boolean) => {
    if (!checked) {
      setAutoInjectEnabled(false);
      return;
    }

    Modal.confirm({
      title: "Enable Auto Inject?",
      content: AUTO_INJECT_WARNING,
      okText: "Enable Auto Inject",
      cancelText: "Cancel",
      onOk: () => {
        setBotDetectionEnabled(true);
        setAutoInjectEnabled(true);
      },
    });
  };

  const onAutoReplyTextChange = (checked: boolean) => {
    if (!checked) {
      setAutoReplyTextEnabled(false);
      return;
    }

    Modal.confirm({
      title: "Enable Auto Reply Text?",
      content:
        "Auto Reply Text is experimental. New final_answer text from the active agent run may be sent automatically to the current IM conversation. Only enable this when you trust the runtime and the conversation.",
      okText: "Enable Auto Reply Text",
      cancelText: "Cancel",
      onOk: () => setAutoReplyTextEnabled(true),
    });
  };

  const onAutoFileAttachmentChange = (checked: boolean) => {
    if (!checked) {
      setAutoFileAttachmentEnabled(false);
      return;
    }

    Modal.confirm({
      title: "Enable Auto File Attachment?",
      content:
        "Auto File Attachment is experimental. Files listed under ## Output Files in the active run's final_answer.md may be sent automatically to the current IM conversation. Only enable this when you trust the runtime, workspace, and file outputs.",
      okText: "Enable Auto File Attachment",
      cancelText: "Cancel",
      onOk: () => setAutoFileAttachmentEnabled(true),
    });
  };

  const onChange = (value: string) => {
    setHtml(value);
    detectBotMention(value);
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

  const createTextMessage = async (text: string) => {
    const created =
      getAuthMode() === "offline"
        ? ({
            contentType: MessageType.TextMessage,
            textElem: { content: text },
          } as MessageItem)
        : (await IMSDK.createTextMessage(text)).data;
    if (!currentConversation?.conversationID || !selfInfo.userID) return created;
    const trigger = detectBotTrigger({
      text,
      currentUserID: selfInfo.userID,
      conversationType:
        currentConversation.conversationType === SessionType.Single
          ? "single"
          : "group",
      targetCandidates: botTargetCandidates,
    });
    if (!trigger?.targetUserID) return created;
    const selected =
      useMessageSelectionStore.getState().selectedMessagesByConversation[
        currentConversation.conversationID
      ] ?? {};
    const request = createAgentRequest({
      conversationID: currentConversation.conversationID,
      requesterUserID: selfInfo.userID,
      targetAgentID: trigger.targetUserID,
      instruction: trigger.instructionText,
      contextPolicy: createContextPolicy({
        ownerUserID: selfInfo.userID,
        recentMessageLimit: requesterContextMessageLimit,
        selectedMessageIDs: Object.keys(selected),
        includeAttachments: requesterIncludeAttachments,
        allowedConversationIDs: [currentConversation.conversationID],
      }),
    });
    const messageWithMetadata = created as MessageItem & { ex?: unknown };
    messageWithMetadata.ex = attachAgentRequestEnvelope(
      messageWithMetadata.ex,
      request,
    );
    return messageWithMetadata;
  };

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
      const attachmentsToSend = [...pendingAttachmentsRef.current];

      if (!cleanText && attachmentsToSend.length === 0) return;

      // Drain pending attachments
      if (attachmentsToSend.length > 0) {
        pendingAttachmentsRef.current = [];
        setPendingAttachments([]);
      }

      if (cleanText) {
        const message = await createTextMessage(cleanText);
        setHtml("");
        await sendMessage({
          message,
          offlineSender: getAuthMode() === "offline" ? "self" : undefined,
        });
      }

      for (const attachment of attachmentsToSend) {
        try {
          await sendPendingAttachment(attachment);
        } catch {
          pendingAttachmentsRef.current = [
            ...pendingAttachmentsRef.current,
            attachment,
          ];
          setPendingAttachments(pendingAttachmentsRef.current);
        }
      }
    };
    const onPendingAttachment = (attachment: PendingChatAttachmentParams) => {
      pendingAttachmentsRef.current = [...pendingAttachmentsRef.current, attachment];
      setPendingAttachments(pendingAttachmentsRef.current);
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
    pendingAttachmentsRef.current = pendingAttachmentsRef.current.filter(
      (_, currentIndex) => currentIndex !== index,
    );
    setPendingAttachments(pendingAttachmentsRef.current);
  };

  const sendPendingAttachment = async (attachment: PendingChatAttachmentParams) => {
    const nativePath =
      attachment.nativePath ??
      (attachment.source === "workspace" && attachment.relativePath && activeWorkspaceID
        ? (() => {
            const ws = useTerminalDockStore
              .getState()
              .workspaces.find((w) => w.id === activeWorkspaceID);
            return ws ? `${ws.rootPath}/${attachment.relativePath}` : undefined;
          })()
        : undefined);

    if (attachment.sendKind === "folder") {
      if (!nativePath) {
        throw new Error("Cannot send folder without a local path");
      }
      const scan = await window.electronAPI?.ipcInvoke<{
        folderName: string;
        itemCount: number;
        totalSize: number;
        files: Array<{
          relativePath: string;
          fileName: string;
          nativePath?: string;
          size: number;
          mimeType?: string;
        }>;
      }>("folder:scan", {
        ...(attachment.source === "workspace" && activeWorkspaceID
          ? {
              workspaceID: activeWorkspaceID,
              relativePath: attachment.relativePath,
            }
          : {
              nativePath,
              folderName: attachment.fileName,
            }),
      });
      if (!scan) throw new Error("Cannot scan folder");
      const message = await getFolderMessage({
        nativePath,
        folderName: scan.folderName || attachment.fileName,
        itemCount: scan.itemCount,
        totalSize: scan.totalSize,
        files: scan.files,
      });
      const sentMessage = await sendMessage({ message });
      if (!sentMessage) throw new Error("Failed to send folder");
      const manifest = parseFolderShareMessage(message);
      if (manifest?.shareID) {
        recordLocalFolderShare(manifest.shareID, manifest.folderName, nativePath);
      }
      return;
    }

    if (attachment.sendKind === "image") {
      const message = nativePath
        ? await getImageMessage({
            nativePath,
            fileName: attachment.fileName,
            fileSize: attachment.fileSize,
            mimeType: attachment.fileType,
          })
        : attachment.file
        ? await getImageMessage(attachment.file)
        : null;
      if (!message) throw new Error("Cannot create image message");
      const sentMessage = await sendMessage({ message });
      if (!sentMessage) throw new Error("Failed to send image");
      if (nativePath) {
        recordLocalFileForMessage(
          sentMessage.clientMsgID || message.clientMsgID,
          attachment.fileName,
          nativePath,
        );
      }
    } else {
      const message = nativePath
        ? await getFileMessage({
            nativePath,
            fileName: attachment.fileName,
            fileSize: attachment.fileSize,
            mimeType: attachment.fileType,
          })
        : attachment.file
        ? await getFileMessage(attachment.file)
        : null;
      if (!message) throw new Error("Cannot create file message");
      const sentMessage = await sendMessage({ message });
      if (!sentMessage) throw new Error("Failed to send file");
      if (nativePath) {
        recordLocalFileForMessage(
          sentMessage.clientMsgID || message.clientMsgID,
          attachment.fileName,
          nativePath,
        );
      }
    }
  };

  const enterToSend = async () => {
    const cleanText = getCleanText(latestHtml.current ?? "");
    const attachmentsToSend = [...pendingAttachmentsRef.current];

    if (!cleanText && attachmentsToSend.length === 0) return;

    setHtml("");
    pendingAttachmentsRef.current = [];
    setPendingAttachments([]);

    if (cleanText) {
      const message = await createTextMessage(cleanText);
      await sendMessage({ message });
    }

    for (const attachment of attachmentsToSend) {
      try {
        await sendPendingAttachment(attachment);
      } catch (error) {
        pendingAttachmentsRef.current = [...pendingAttachmentsRef.current, attachment];
        setPendingAttachments(pendingAttachmentsRef.current);
        const errorMessage = error instanceof Error ? error.message : String(error);
        antdMessage.error(errorMessage || "Failed to send workspace file");
      }
    }
  };

  return (
    <footer className="relative h-full min-h-0 bg-white py-px">
      <div className="flex h-full flex-col border-t border-t-[var(--gap-text)]">
        <SendActionBar />
        <div
          className="flex shrink-0 items-center gap-2 border-b border-black/5 px-4 py-1 text-xs text-[var(--sub-text)]"
          data-testid="requester-context-policy"
        >
          <span>Agent context authorized by you:</span>
          <InputNumber
            size="small"
            min={1}
            max={200}
            value={requesterContextMessageLimit}
            onChange={(value) => {
              if (!currentConversation?.conversationID || !value) return;
              const agentStore = useAgentSessionStore.getState();
              void agentStore.setBotPolicy(
                currentConversation.conversationID,
                agentStore.botPolicyByConversation[
                  currentConversation.conversationID
                ] ?? "review",
                value,
                requesterIncludeAttachments,
              );
            }}
            data-testid="requester-context-limit"
          />
          <span>
            recent messages
            {selectedContextMessageCount > 0
              ? `; ${selectedContextMessageCount} selected messages take priority`
              : ""}
          </span>
          <label className="ml-auto flex items-center gap-1">
            Include attachments
            <Switch
              size="small"
              checked={requesterIncludeAttachments}
              onChange={(checked) => {
                if (!currentConversation?.conversationID) return;
                const agentStore = useAgentSessionStore.getState();
                void agentStore.setBotPolicy(
                  currentConversation.conversationID,
                  agentStore.botPolicyByConversation[
                    currentConversation.conversationID
                  ] ?? "review",
                  requesterContextMessageLimit,
                  checked,
                );
              }}
              data-testid="requester-include-attachments"
            />
          </label>
        </div>
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          {pendingAttachments.length > 0 && (
            <div
              className="mx-4 mt-2 flex max-h-24 flex-wrap gap-2 overflow-y-auto"
              data-testid="chat-footer-pending-attachments"
            >
              {pendingAttachments.map((attachment, index) => {
                const displayPath =
                  attachment.nativePath ||
                  attachment.relativePath ||
                  attachment.fileName;
                return (
                  <div
                    className="flex max-w-[280px] items-center gap-1 rounded border border-[#d0d5dd] bg-[#f8fafc] px-2 py-1 text-xs text-[#344054]"
                    key={`${displayPath}-${index}`}
                    title={displayPath}
                    data-testid="chat-footer-pending-attachment"
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
                      data-testid="chat-footer-remove-pending-attachment"
                    />
                  </div>
                );
              })}
            </div>
          )}
          <div className="relative min-h-0 flex-1 overflow-y-auto">
            <BotMentionAutocomplete
              candidates={botTargetCandidates}
              query={mentionQuery}
              visible={mentionVisible}
              onSelect={handleMentionSelect}
              onClose={() => setMentionVisible(false)}
            />
            <CKEditor value={html} onEnter={enterToSend} onChange={onChange} />
          </div>
          <div className="flex shrink-0 items-center justify-end py-2 pr-3">
            <Button
              className="w-fit px-6 py-1"
              type="primary"
              onClick={enterToSend}
              data-testid="chat-footer-send"
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
