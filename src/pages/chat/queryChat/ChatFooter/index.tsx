import { CloseOutlined } from "@ant-design/icons";
import { SessionType } from "@openim/wasm-client-sdk";
import { useLatest } from "ahooks";
import { Button, message as antdMessage, Modal, Switch, Tooltip } from "antd";
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
import { BotTargetCandidate } from "@/services/botTrigger";
import {
  useConversationStore,
  usePendingAgentRequestStore,
  useTerminalDockStore,
  useUserStore,
} from "@/store";
import emitter, { PendingChatAttachmentParams } from "@/utils/events";

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
  const autoInjectEnabled = useTerminalDockStore((state) => state.autoInjectEnabled);
  const autoReplyEnabled = useTerminalDockStore((state) => state.autoReplyEnabled);
  const botContextMessageLimit = useTerminalDockStore(
    (state) => state.botContextMessageLimit,
  );
  const setAutoInjectEnabled = useTerminalDockStore(
    (state) => state.setAutoInjectEnabled,
  );
  const setAutoReplyEnabled = useTerminalDockStore(
    (state) => state.setAutoReplyEnabled,
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

  const { getFileMessage, getImageMessage } = useFileMessage();
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
    ? autoReplyEnabled && activeAgentRun
      ? "waiting for final answer"
      : "ready"
    : botDetectionEnabled || autoInjectEnabled || autoReplyEnabled
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

  const onAutoReplyChange = (checked: boolean) => {
    if (!checked) {
      setAutoReplyEnabled(false);
      return;
    }

    Modal.confirm({
      title: "Enable Auto Reply?",
      content: AUTO_REPLY_WARNING,
      okText: "Enable Auto Reply",
      cancelText: "Cancel",
      onOk: () => setAutoReplyEnabled(true),
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

      // Drain pending attachments (sync via ref to avoid React batching).
      const attachmentsToSend = [...pendingAttachmentsRef.current];
      if (attachmentsToSend.length > 0) {
        pendingAttachmentsRef.current = [];
        setPendingAttachments([]);
      }

      const message = (await IMSDK.createTextMessage(cleanText)).data;
      setHtml("");
      await sendMessage({ message });

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
    const attachmentsToSend = [...pendingAttachmentsRef.current];

    if (!cleanText && attachmentsToSend.length === 0) return;

    setHtml("");
    pendingAttachmentsRef.current = [];
    setPendingAttachments([]);

    if (cleanText) {
      const message = (await IMSDK.createTextMessage(cleanText)).data;
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
    <footer className="relative h-full bg-white py-px">
      <div className="flex h-full flex-col border-t border-t-[var(--gap-text)]">
        <SendActionBar sendMessage={sendMessage} getImageMessage={getImageMessage} />
        <div className="relative flex flex-1 flex-col overflow-hidden">
          <div
            className="mx-4 mt-2 flex flex-wrap items-center gap-3 rounded border border-[#e5e7eb] bg-[#f8fafc] px-3 py-2 text-xs text-[#475467]"
            data-testid="chat-agent-automation-bar"
          >
            <span className="font-medium text-[#344054]">Agent automation</span>
            <Tooltip title="Use this exact prefix to target your own local agent. Bare @bot will not trigger.">
              <Button
                size="small"
                type="text"
                className="!h-6 !px-1 text-xs"
                onClick={insertSelfBotMention}
                data-testid="chat-agent-mention-insert"
              >
                Use {selfMentionTemplate}
              </Button>
            </Tooltip>
            <Tooltip title="Detect @bot requests and inject approved prompts into the active terminal. Enabling this also enables Bot Requests detection.">
              <label className="flex items-center gap-1">
                <span>Auto Inject</span>
                <Switch
                  size="small"
                  checked={autoInjectEnabled}
                  onChange={onAutoInjectChange}
                  data-testid="terminal-auto-inject-toggle"
                />
              </label>
            </Tooltip>
            <Tooltip title="Send structured final_answer events from the active terminal workspace back to this IM conversation.">
              <label className="flex items-center gap-1">
                <span>Auto Reply</span>
                <Switch
                  size="small"
                  checked={autoReplyEnabled}
                  onChange={onAutoReplyChange}
                  data-testid="terminal-auto-reply-toggle"
                />
              </label>
            </Tooltip>
            <Tooltip title="Number of recent messages to include as context alongside each @bot trigger.">
              <label className="flex items-center gap-1">
                <span>Context msgs</span>
                <input
                  type="number"
                  className="w-14 rounded border border-[#d0d5dd] px-1 py-0.5 text-xs text-[#344054]"
                  min={1}
                  max={200}
                  step={1}
                  value={botContextMessageLimit}
                  onChange={(e) => {
                    const value = Number.parseInt(e.target.value, 10);
                    if (value >= 1 && value <= 200) {
                      setBotContextMessageLimit(value);
                    }
                  }}
                  data-testid="chat-agent-context-limit"
                />
              </label>
            </Tooltip>
            <span className="text-[#98a2b3]" data-testid="chat-agent-automation-state">
              {automationStateText}
            </span>
          </div>
          {pendingAttachments.length > 0 && (
            <div
              className="mx-4 mt-2 flex flex-wrap gap-2"
              data-testid="chat-footer-pending-attachments"
            >
              {pendingAttachments.map((attachment, index) => (
                <div
                  className="flex max-w-[280px] items-center gap-1 rounded border border-[#d0d5dd] bg-[#f8fafc] px-2 py-1 text-xs text-[#344054]"
                  key={`${attachment.filePath}-${index}`}
                  title={attachment.filePath}
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
              ))}
            </div>
          )}
          <div className="relative">
            <BotMentionAutocomplete
              candidates={botTargetCandidates}
              query={mentionQuery}
              visible={mentionVisible}
              onSelect={handleMentionSelect}
              onClose={() => setMentionVisible(false)}
            />
            <CKEditor value={html} onEnter={enterToSend} onChange={onChange} />
          </div>
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
