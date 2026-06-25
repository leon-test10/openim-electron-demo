import "./terminalDock.css";

import {
  CloseOutlined,
  CodeOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownOutlined,
  FileTextOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SettingOutlined,
  StopOutlined,
} from "@ant-design/icons";
import { ViewType } from "@openim/wasm-client-sdk";
import {
  Button,
  Checkbox,
  Dropdown,
  Empty,
  Input,
  message,
  Modal,
  Switch,
  Tooltip,
} from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { IMSDK } from "@/layout/MainContentWrap";
import { PendingAgentRequest } from "@/services/botTrigger";
import {
  ContextBundle,
  ContextSource,
  exportContextAttachments,
  IMContextService,
} from "@/services/imContext";
import {
  useConversationStore,
  useMessageSelectionStore,
  usePendingAgentRequestStore,
  useTerminalDockStore,
} from "@/store";
import { TerminalContextBundleRecord, TerminalTab } from "@/store/type";
import emitter, {
  BotAgentRequestActionParams,
  emit,
  IMContextActionParams,
} from "@/utils/events";

import TerminalSurface, { TerminalSurfaceApi } from "./TerminalSurface";
import TerminalTabs from "./TerminalTabs";
import WorkspaceBar from "./WorkspaceBar";

type ContextExportResult = {
  prompt: string;
  files: string[];
  bundle: ContextBundle;
};

type WorkspaceAttachmentExportResponse = {
  path?: string;
  size?: number;
  sha256?: string;
};

type SelectionReplyReviewState = {
  open: boolean;
  text: string;
  source: "selection" | "screen" | "recent";
};

type ContextActionMode = "preview" | "copy" | "send";

type WorkspaceAttachmentCandidate = {
  relativePath: string;
  absolutePath: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  sendKind: "image" | "file";
};

const getTabStats = (tab?: TerminalTab) => {
  if (!tab) return "No terminal";
  return `${tab.shell} | ${tab.status}`;
};

const RECENT_SELECTION_TTL = 60_000;
const AUTO_CAPTURE_DEBOUNCE = 1200;
const AUTO_SEND_MIN_LENGTH = 8;
const AUTO_SEND_MIN_INTERVAL = 5000;
const AUTO_SEND_WARNING =
  "Terminal output may include logs, local paths, command output, or sensitive data. Auto-sending terminal output is experimental.";

const joinWorkspacePath = (rootPath: string, relativePath: string) => {
  if (!rootPath) return relativePath;
  return `${rootPath.replace(/[\\/]+$/, "")}\\${relativePath.replaceAll("/", "\\")}`;
};

const getFileNameFromPath = (filePath: string) =>
  filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath;

const getFileExtension = (filePath: string) =>
  getFileNameFromPath(filePath).split(".").pop()?.toLowerCase() ?? "";

const IMAGE_FILE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp"]);

const inferWorkspaceAttachmentKind = (fileName: string, fileType?: string) => {
  if (fileType?.startsWith("image/")) return "image";
  return IMAGE_FILE_EXTENSIONS.has(getFileExtension(fileName)) ? "image" : "file";
};

const formatFileSize = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "Unknown size";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const getStoredOutputFallback = (
  outputByTab: Record<string, Array<{ content: string }>>,
  tabID: string,
) => {
  const tabOutput = outputByTab[tabID] ?? [];
  const fallbackOutput =
    tabOutput.length > 0
      ? tabOutput
      : Object.values(outputByTab)
          .filter((chunks) => chunks.length > 0)
          .at(-1) ?? [];

  return fallbackOutput
    .slice(-80)
    .map((item) => item.content)
    .join("")
    .replace(/\r/g, "\n")
    .trim();
};

const hashText = (value: string) => {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(16);
};

const isPromptOrBannerLine = (line: string) => {
  const trimmed = line.trim();
  if (!trimmed) return true;

  return [
    /^(?:ps\s+)?[a-z]:\\.*[>#]\s*$/i,
    /^[a-z]:\\(?:[^<>:"|?*\r\n]+\\?)*$/i,
    /^windows powershell$/i,
    /^powershell \d+(\.\d+)*$/i,
    /^microsoft windows \[version .*]$/i,
    /^copyright \(c\) microsoft corporation\./i,
    /^copyright \(c\) microsoft corporation\. all rights reserved\./i,
    /^try the new cross-platform powershell https:\/\/aka\.ms\/pscore6$/i,
  ].some((pattern) => pattern.test(trimmed));
};

const shouldSkipAutoSend = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (trimmed.length < AUTO_SEND_MIN_LENGTH) return true;

  const lines = trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return true;
  return lines.every(isPromptOrBannerLine);
};

const TerminalDock = () => {
  const { conversationID: routeConversationID } = useParams();
  const currentConversation = useConversationStore(
    (state) => state.currentConversation,
  );
  const selectedMessagesByConversation = useMessageSelectionStore(
    (state) => state.selectedMessagesByConversation,
  );
  const botDetectionEnabled = usePendingAgentRequestStore(
    (state) => state.botDetectionEnabled,
  );
  const setBotDetectionEnabled = usePendingAgentRequestStore(
    (state) => state.setBotDetectionEnabled,
  );
  const pendingRequestsByConversation = usePendingAgentRequestStore(
    (state) => state.requestsByConversation,
  );
  const markPendingRequestSent = usePendingAgentRequestStore((state) => state.markSent);
  const panelOpen = useTerminalDockStore((state) => state.panelOpen);
  const setPanelOpen = useTerminalDockStore((state) => state.setPanelOpen);
  const workspaces = useTerminalDockStore((state) => state.workspaces);
  const activeWorkspaceID = useTerminalDockStore((state) => state.activeWorkspaceID);
  const tabsByWorkspace = useTerminalDockStore((state) => state.tabsByWorkspace);
  const activeTabByWorkspace = useTerminalDockStore(
    (state) => state.activeTabByWorkspace,
  );
  const outputByTab = useTerminalDockStore((state) => state.outputByTab);
  const lastContextPromptByWorkspace = useTerminalDockStore(
    (state) => state.lastContextPromptByWorkspace,
  );
  const contextBundlesByWorkspace = useTerminalDockStore(
    (state) => state.contextBundlesByWorkspace,
  );
  const commandTemplates = useTerminalDockStore((state) => state.commandTemplates);
  const autoReceiveEnabled = useTerminalDockStore((state) => state.autoReceiveEnabled);
  const autoSendEnabled = useTerminalDockStore((state) => state.autoSendEnabled);
  const captureSource = useTerminalDockStore((state) => state.captureSource);
  const lastCapturedTextByTab = useTerminalDockStore(
    (state) => state.lastCapturedTextByTab,
  );
  const createWorkspace = useTerminalDockStore((state) => state.createWorkspace);
  const setActiveWorkspace = useTerminalDockStore((state) => state.setActiveWorkspace);
  const linkConversationToWorkspace = useTerminalDockStore(
    (state) => state.linkConversationToWorkspace,
  );
  const createTab = useTerminalDockStore((state) => state.createTab);
  const setActiveTab = useTerminalDockStore((state) => state.setActiveTab);
  const startTab = useTerminalDockStore((state) => state.startTab);
  const restartTab = useTerminalDockStore((state) => state.restartTab);
  const interruptTab = useTerminalDockStore((state) => state.interruptTab);
  const stopTab = useTerminalDockStore((state) => state.stopTab);
  const writeToTab = useTerminalDockStore((state) => state.writeToTab);
  const clearTabOutput = useTerminalDockStore((state) => state.clearTabOutput);
  const removeTab = useTerminalDockStore((state) => state.removeTab);
  const handleTerminalEvent = useTerminalDockStore(
    (state) => state.handleTerminalEvent,
  );
  const setLastContextPrompt = useTerminalDockStore(
    (state) => state.setLastContextPrompt,
  );
  const addContextBundleRecord = useTerminalDockStore(
    (state) => state.addContextBundleRecord,
  );
  const clearContextBundleHistory = useTerminalDockStore(
    (state) => state.clearContextBundleHistory,
  );
  const updateCommandTemplate = useTerminalDockStore(
    (state) => state.updateCommandTemplate,
  );
  const addCommandTemplate = useTerminalDockStore((state) => state.addCommandTemplate);
  const removeCommandTemplate = useTerminalDockStore(
    (state) => state.removeCommandTemplate,
  );
  const resetCommandTemplates = useTerminalDockStore(
    (state) => state.resetCommandTemplates,
  );
  const setAutoReceiveEnabled = useTerminalDockStore(
    (state) => state.setAutoReceiveEnabled,
  );
  const setAutoSendEnabled = useTerminalDockStore((state) => state.setAutoSendEnabled);
  const setLastCapturedText = useTerminalDockStore(
    (state) => state.setLastCapturedText,
  );

  const [workspaceModalOpen, setWorkspaceModalOpen] = useState(false);
  const [commandModalOpen, setCommandModalOpen] = useState(false);
  const [contextModalOpen, setContextModalOpen] = useState(false);
  const [replyDebugModalOpen, setReplyDebugModalOpen] = useState(false);
  const [workspaceAttachmentCandidate, setWorkspaceAttachmentCandidate] =
    useState<WorkspaceAttachmentCandidate>();
  const [contextMessageLimit, setContextMessageLimit] = useState("50");
  const [contextPreviewBundle, setContextPreviewBundle] = useState<ContextBundle>();
  const [workspaceFileInput, setWorkspaceFileInput] = useState("");
  const [workspaceTitle, setWorkspaceTitle] = useState("");
  const [selectionReplyReview, setSelectionReplyReview] =
    useState<SelectionReplyReviewState>({
      open: false,
      text: "",
      source: "selection",
    });
  const terminalApisRef = useRef<Map<string, TerminalSurfaceApi>>(new Map());
  const recentTerminalSelectionsRef = useRef<
    Map<string, { text: string; updatedAt: number }>
  >(new Map());
  const selectionReplyReviewHostRef = useRef<HTMLDivElement>(null);
  const lastDraftHashByTabRef = useRef<Map<string, string>>(new Map());
  const lastSentHashByTabRef = useRef<Map<string, string>>(new Map());
  const lastSentAtByTabRef = useRef<Map<string, number>>(new Map());
  const conversationID = currentConversation?.conversationID ?? routeConversationID;
  const selectedMessages = useMemo(
    () =>
      conversationID
        ? Object.values(selectedMessagesByConversation[conversationID] ?? {})
        : [],
    [conversationID, selectedMessagesByConversation],
  );
  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceID),
    [activeWorkspaceID, workspaces],
  );
  const tabs = activeWorkspaceID ? tabsByWorkspace[activeWorkspaceID] ?? [] : [];
  const activeTabID = activeWorkspaceID
    ? activeTabByWorkspace[activeWorkspaceID]
    : undefined;
  const activeTab = tabs.find((tab) => tab.id === activeTabID) ?? tabs[0];
  const terminalAvailable = Boolean(window.electronAPI);
  const lastContextPrompt = activeWorkspaceID
    ? lastContextPromptByWorkspace[activeWorkspaceID]
    : undefined;
  const contextBundleHistory = activeWorkspaceID
    ? contextBundlesByWorkspace[activeWorkspaceID] ?? []
    : [];
  const pendingRequestCount = conversationID
    ? (pendingRequestsByConversation[conversationID] ?? []).filter(
        (request) => request.status === "pending",
      ).length
    : 0;
  const activeTabOutput = activeTab ? outputByTab[activeTab.id] ?? [] : [];
  const activeTabOutputSignature = useMemo(
    () => activeTabOutput.map((item) => item.id).join("|"),
    [activeTabOutput],
  );

  const getCapturedTerminalText = useCallback(
    (tab: TerminalTab) => {
      const api = terminalApisRef.current.get(tab.id);
      const latestOutputByTab = useTerminalDockStore.getState().outputByTab;
      if (!api) {
        const fallbackOutput = getStoredOutputFallback(latestOutputByTab, tab.id);
        return fallbackOutput || undefined;
      }

      const visibleText = api.getVisibleText();
      const recentOutputText = api.getRecentOutputText();
      const storedOutputText = getStoredOutputFallback(latestOutputByTab, tab.id);
      const capturedText =
        captureSource === "screen"
          ? visibleText || storedOutputText
          : captureSource === "raw"
          ? recentOutputText || storedOutputText
          : visibleText.length >= 12
          ? visibleText
          : recentOutputText || storedOutputText;

      return capturedText?.trim();
    },
    [captureSource],
  );

  const captureTerminalOutput = useCallback(
    (mode: "manual" | "auto") => {
      if (!activeTab) return;

      const normalizedText = getCapturedTerminalText(activeTab);
      if (typeof normalizedText !== "string") {
        if (mode === "manual") message.info("No active terminal surface");
        return;
      }

      if (!normalizedText) {
        if (mode === "manual") {
          message.info("No terminal output captured");
        }
        return;
      }

      const nextDraftHash = hashText(normalizedText);
      if (
        lastCapturedTextByTab[activeTab.id] === normalizedText ||
        lastDraftHashByTabRef.current.get(activeTab.id) === nextDraftHash
      ) {
        if (mode === "manual") {
          message.info("Terminal output already captured");
        }
        return;
      }

      lastDraftHashByTabRef.current.set(activeTab.id, nextDraftHash);
      setLastCapturedText(activeTab.id, normalizedText);
      emit("REPLACE_CHAT_INPUT", normalizedText);
      if (mode === "manual") {
        message.success("Reply draft replaced with captured terminal output");
      }
    },
    [activeTab, getCapturedTerminalText, lastCapturedTextByTab, setLastCapturedText],
  );

  useEffect(() => {
    if (!window.electronAPI) return undefined;
    return window.electronAPI.subscribe("terminal:event", handleTerminalEvent);
  }, [handleTerminalEvent]);

  useEffect(() => {
    if (!activeWorkspaceID || activeTabID || tabs.length === 0) return;
    setActiveTab(activeWorkspaceID, tabs[0].id);
  }, [activeTabID, activeWorkspaceID, setActiveTab, tabs]);

  useEffect(() => {
    if (!autoReceiveEnabled || !activeTab || !activeTabOutputSignature) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      captureTerminalOutput("auto");
    }, AUTO_CAPTURE_DEBOUNCE);

    return () => window.clearTimeout(timer);
  }, [activeTab, activeTabOutputSignature, autoReceiveEnabled, captureTerminalOutput]);

  useEffect(() => {
    if (
      !autoReceiveEnabled ||
      !autoSendEnabled ||
      !activeTab ||
      !activeTabOutputSignature
    ) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      const normalizedText = getCapturedTerminalText(activeTab);
      if (!normalizedText || shouldSkipAutoSend(normalizedText)) return;

      const textHash = hashText(normalizedText);
      const now = Date.now();
      const lastDraftHash = lastDraftHashByTabRef.current.get(activeTab.id);
      const lastSentHash = lastSentHashByTabRef.current.get(activeTab.id);
      const lastSentAt = lastSentAtByTabRef.current.get(activeTab.id) ?? 0;

      if (lastDraftHash !== textHash) {
        lastDraftHashByTabRef.current.set(activeTab.id, textHash);
        setLastCapturedText(activeTab.id, normalizedText);
        emit("REPLACE_CHAT_INPUT", normalizedText);
      }

      if (lastSentHash === textHash || now - lastSentAt < AUTO_SEND_MIN_INTERVAL) {
        return;
      }

      emit("SEND_CHAT_INPUT", normalizedText);
      lastSentHashByTabRef.current.set(activeTab.id, textHash);
      lastSentAtByTabRef.current.set(activeTab.id, now);
      message.success("Draft sent to chat");
    }, AUTO_SEND_MIN_INTERVAL);

    return () => window.clearTimeout(timer);
  }, [
    activeTab,
    activeTabOutputSignature,
    autoReceiveEnabled,
    autoSendEnabled,
    getCapturedTerminalText,
    setLastCapturedText,
  ]);

  const onCreateWorkspace = async () => {
    const workspaceID = await createWorkspace(workspaceTitle.trim() || undefined);
    setWorkspaceModalOpen(false);
    setWorkspaceTitle("");
    if (!workspaceID) {
      message.error("Failed to create workspace");
    }
  };

  const onCreateTab = async () => {
    if (!activeWorkspace) return;
    const tabID = await createTab(activeWorkspace.id);
    if (tabID) await startTab(tabID);
  };

  const onRunCommandTemplate = async (templateID: string) => {
    if (!activeWorkspace) return;
    const template = commandTemplates.find((item) => item.id === templateID);
    if (!template?.command.trim()) {
      message.warning("Command template is empty");
      return;
    }

    const tabID = await createTab(activeWorkspace.id, {
      title: template.id === "opencode" ? "opencode" : template.title,
    });
    if (!tabID) return;

    try {
      await startTab(tabID);
      await writeToTab(tabID, `${template.command.trim()}\r\n`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      message.error(errorMessage);
    }
  };

  const copyWorkspacePath = async () => {
    if (!activeWorkspace) return;
    await navigator.clipboard.writeText(activeWorkspace.rootPath);
    message.success("Workspace path copied");
  };

  const openWorkspaceFolder = async () => {
    if (!activeWorkspace || !window.electronAPI) return;
    const result = await window.electronAPI.ipcInvoke<string>(
      "terminal:openWorkspace",
      activeWorkspace.id,
    );
    if (result) message.warning(result);
  };

  const buildRecentContextBundle = async (): Promise<ContextBundle | undefined> => {
    if (!activeWorkspace || !conversationID || !window.electronAPI) {
      return undefined;
    }

    const limit = Math.min(
      Math.max(Number.parseInt(contextMessageLimit, 10) || 50, 1),
      200,
    );
    linkConversationToWorkspace(activeWorkspace.id, conversationID);

    const { data } = await IMSDK.getAdvancedHistoryMessageList({
      count: limit,
      startClientMsgID: "",
      conversationID,
      viewType: ViewType.History,
    });

    return IMContextService.createContextBundle({
      workspacePath: activeWorkspace.rootPath,
      source: {
        kind: "recentMessages",
        conversationID,
        limit,
      },
      messages: data.messageList,
    });
  };

  const buildMessagesContextBundle = (
    params?: IMContextActionParams,
  ): ContextBundle | undefined => {
    const sourceConversationID = params?.source.conversationID ?? conversationID;
    const sourceKind = params?.source.kind ?? "selectedMessages";

    if (!activeWorkspace || !sourceConversationID || selectedMessages.length === 0) {
      return undefined;
    }

    const messageIDSet = new Set(params?.source.messageIDs ?? []);
    const messages =
      messageIDSet.size > 0
        ? selectedMessages.filter((item) => messageIDSet.has(item.clientMsgID))
        : selectedMessages;

    if (messages.length === 0) return undefined;

    const source: ContextSource = {
      kind: sourceKind,
      conversationID: sourceConversationID,
      messageIDs: messages.map((item) => item.clientMsgID),
      keyword: params?.source.keyword,
    };

    linkConversationToWorkspace(activeWorkspace.id, sourceConversationID);
    return IMContextService.createContextBundle({
      workspacePath: activeWorkspace.rootPath,
      source,
      messages,
    });
  };

  const buildBotTriggerContextBundle = (
    request: PendingAgentRequest,
  ): ContextBundle | undefined => {
    if (!activeWorkspace) return undefined;
    if (request.contextMessages.length === 0) return undefined;

    linkConversationToWorkspace(activeWorkspace.id, request.conversationID);
    return IMContextService.createContextBundle({
      workspacePath: activeWorkspace.rootPath,
      source: {
        kind: "botTrigger",
        conversationID: request.conversationID,
        triggerMessageID: request.triggerMessageID,
        triggerText: request.triggerText,
        messageIDs: request.contextMessages.map((message) => message.clientMsgID),
        recentLimit: request.contextScope.recentLimit ?? request.contextMessages.length,
      },
      messages: request.contextMessages,
    });
  };

  const persistContextBundle = async (
    bundle: ContextBundle,
  ): Promise<ContextExportResult | undefined> => {
    if (!activeWorkspace || !window.electronAPI) return undefined;

    const finalizedBundle =
      bundle.attachments.length > 0
        ? IMContextService.withContextAttachments(
            bundle,
            await exportContextAttachments({
              attachments: bundle.attachments,
              copyFile: (sourcePath, relativePath, maxBytes) =>
                window.electronAPI!.ipcInvoke<WorkspaceAttachmentExportResponse>(
                  "workspace:copyWorkspaceFile",
                  {
                    workspaceID: activeWorkspace.id,
                    sourcePath,
                    relativePath,
                    maxBytes,
                  },
                ),
              downloadFile: (url, relativePath, maxBytes) =>
                window.electronAPI!.ipcInvoke<WorkspaceAttachmentExportResponse>(
                  "workspace:downloadWorkspaceFile",
                  {
                    workspaceID: activeWorkspace.id,
                    url,
                    relativePath,
                    maxBytes,
                  },
                ),
            }),
          )
        : bundle;

    await window.electronAPI.ipcInvoke("workspace:writeWorkspaceFile", {
      workspaceID: activeWorkspace.id,
      relativePath: finalizedBundle.files.markdownPath,
      content: finalizedBundle.markdown,
    });
    await window.electronAPI.ipcInvoke("workspace:writeWorkspaceFile", {
      workspaceID: activeWorkspace.id,
      relativePath: finalizedBundle.files.manifestPath,
      content: JSON.stringify(finalizedBundle.manifest, null, 2),
    });

    setLastContextPrompt(activeWorkspace.id, finalizedBundle.promptText);
    addContextBundleRecord(activeWorkspace.id, {
      id: finalizedBundle.id,
      workspaceID: activeWorkspace.id,
      createdAt: finalizedBundle.createdAt,
      sourceKind: finalizedBundle.source.kind,
      conversationID: finalizedBundle.source.conversationID,
      messageCount: finalizedBundle.stats.messageCount,
      attachmentCount: finalizedBundle.stats.attachmentCount,
      exportedAttachmentCount: finalizedBundle.stats.exportedAttachmentCount,
      referencedAttachmentCount: finalizedBundle.stats.referencedAttachmentCount,
      failedAttachmentCount: finalizedBundle.stats.failedAttachmentCount,
      unsupportedAttachmentCount: finalizedBundle.stats.unsupportedAttachmentCount,
      skippedAttachmentCount: finalizedBundle.stats.skippedAttachmentCount,
      approxChars: finalizedBundle.stats.approxChars,
      markdownPath: finalizedBundle.files.markdownPath,
      manifestPath: finalizedBundle.files.manifestPath,
      promptText: finalizedBundle.promptText,
    });

    return {
      prompt: finalizedBundle.promptText,
      files: [finalizedBundle.files.markdownPath, finalizedBundle.files.manifestPath],
      bundle: finalizedBundle,
    };
  };

  const sendPromptToTerminal = async (promptText: string) => {
    if (!activeTab) {
      message.warning("No active terminal");
      return false;
    }

    await writeToTab(activeTab.id, `${promptText}\r\n`);
    terminalApisRef.current.get(activeTab.id)?.focus();
    message.success("Context prompt sent to terminal");
    return true;
  };

  const applyContextActionResult = async (
    result: ContextExportResult,
    action: ContextActionMode,
  ) => {
    setContextPreviewBundle(result.bundle);
    setWorkspaceFileInput(result.bundle.files.markdownPath);

    if (action === "copy") {
      await navigator.clipboard.writeText(result.bundle.promptText);
      message.success("Context prompt copied");
      return true;
    }

    if (action === "send") {
      return sendPromptToTerminal(result.bundle.promptText);
    }

    message.success(
      result.bundle.stats.attachmentCount > 0
        ? `Context preview updated with ${result.bundle.stats.exportedAttachmentCount} exported, ${result.bundle.stats.skippedAttachmentCount} skipped, and ${result.bundle.stats.failedAttachmentCount} failed attachments`
        : "Context preview updated",
    );
    return true;
  };

  const copyPreviewedContext = async () => {
    if (!contextPreviewBundle) {
      message.warning("Preview a context first");
      return;
    }
    await navigator.clipboard.writeText(contextPreviewBundle.promptText);
    message.success("Previewed context copied");
  };

  const sendPreviewedContext = async () => {
    if (!contextPreviewBundle) {
      message.warning("Preview a context first");
      return;
    }
    await sendPromptToTerminal(contextPreviewBundle.promptText);
  };

  const prepareWorkspaceAttachment = async (relativePath?: string) => {
    if (!activeWorkspace) {
      message.warning("No active workspace");
      return;
    }

    const normalizedRelativePath = (relativePath ?? workspaceFileInput).trim();
    if (!normalizedRelativePath) {
      message.warning("Enter a workspace file path");
      return;
    }

    const absolutePath = joinWorkspacePath(
      activeWorkspace.rootPath,
      normalizedRelativePath,
    );

    try {
      setWorkspaceFileInput(normalizedRelativePath);
      const file = await window.electronAPI?.getFileByPath(absolutePath);
      const fileName = file?.name || getFileNameFromPath(normalizedRelativePath);
      const fileType = file?.type || "application/octet-stream";
      const fileSize = file?.size ?? 0;

      setWorkspaceAttachmentCandidate({
        relativePath: normalizedRelativePath,
        absolutePath,
        fileName,
        fileType,
        fileSize,
        sendKind: inferWorkspaceAttachmentKind(fileName, fileType),
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      message.error(errorMessage || "Failed to attach workspace file");
    }
  };

  const attachWorkspaceFile = () => {
    if (!workspaceAttachmentCandidate) return;

    try {
      emit("ADD_PENDING_CHAT_ATTACHMENT", {
        source: "workspace",
        fileName: workspaceAttachmentCandidate.fileName,
        filePath: workspaceAttachmentCandidate.absolutePath,
        relativePath: workspaceAttachmentCandidate.relativePath,
        fileType: workspaceAttachmentCandidate.fileType,
        fileSize: workspaceAttachmentCandidate.fileSize,
        sendKind: workspaceAttachmentCandidate.sendKind,
      });
      setWorkspaceFileInput(workspaceAttachmentCandidate.relativePath);
      setWorkspaceAttachmentCandidate(undefined);
      message.success("Workspace file added to draft attachments");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      message.error(errorMessage || "Failed to attach workspace file");
    }
  };

  const runRecentContextAction = async (action: ContextActionMode = "preview") => {
    const bundle = await buildRecentContextBundle();
    if (!bundle) {
      message.warning("No recent messages available");
      return undefined;
    }

    const result = await persistContextBundle(bundle);
    if (!result) {
      message.warning("No active workspace");
      return undefined;
    }

    await applyContextActionResult(result, action);

    return result;
  };

  const runSelectedContextAction = async (
    action: ContextActionMode = "preview",
    params?: IMContextActionParams,
  ) => {
    const bundle = buildMessagesContextBundle(params);
    if (!bundle) {
      message.warning("No selected messages");
      return undefined;
    }

    const result = await persistContextBundle(bundle);
    if (!result) {
      message.warning("No active workspace");
      return undefined;
    }

    await applyContextActionResult(result, action);

    return result;
  };

  const runBotAgentRequestAction = async (params: BotAgentRequestActionParams) => {
    const { request, action } = params;

    if (action === "ignore" || action === "copy") {
      message.warning("Bot requests support review and manual send only.");
      return;
    }

    const bundle = buildBotTriggerContextBundle(request);
    if (!bundle) {
      message.warning("No bot trigger context available");
      return;
    }

    const result = await persistContextBundle(bundle);
    if (!result) {
      message.warning("No active workspace");
      return;
    }

    if (action === "preview") {
      setContextModalOpen(true);
    }

    const succeeded = await applyContextActionResult(result, action);
    if (action === "send" && succeeded) {
      markPendingRequestSent(request.conversationID, request.id);
    }
  };

  useEffect(() => {
    const handleContextAction = (params: IMContextActionParams) => {
      if (params.action === "preview") {
        setContextModalOpen(true);
        void runSelectedContextAction("preview", params);
        return;
      }

      if (params.action === "copy") {
        void runSelectedContextAction("copy", params);
        return;
      }

      void runSelectedContextAction("send", params);
    };

    emitter.on("IM_CONTEXT_ACTION", handleContextAction);
    emitter.on("TERMINAL_CONTEXT_ACTION", handleContextAction);
    emitter.on("BOT_AGENT_REQUEST_ACTION", runBotAgentRequestAction);
    return () => {
      emitter.off("IM_CONTEXT_ACTION", handleContextAction);
      emitter.off("TERMINAL_CONTEXT_ACTION", handleContextAction);
      emitter.off("BOT_AGENT_REQUEST_ACTION", runBotAgentRequestAction);
    };
  }, [runBotAgentRequestAction, runSelectedContextAction]);

  const copyLastContextPrompt = async () => {
    if (!lastContextPrompt) {
      message.warning("No last context prompt");
      return;
    }
    await navigator.clipboard.writeText(lastContextPrompt);
    message.success("Last context prompt copied");
  };

  const sendLastContextPrompt = async () => {
    if (!lastContextPrompt) {
      message.warning("No last context prompt");
      return;
    }
    await sendPromptToTerminal(lastContextPrompt);
  };

  const copyContextRecordPrompt = async (record: TerminalContextBundleRecord) => {
    if (!activeWorkspace) return;
    setLastContextPrompt(activeWorkspace.id, record.promptText);
    await navigator.clipboard.writeText(record.promptText);
    message.success("Context prompt copied");
  };

  const sendContextRecordPrompt = async (record: TerminalContextBundleRecord) => {
    if (!activeWorkspace) return;
    setLastContextPrompt(activeWorkspace.id, record.promptText);
    await sendPromptToTerminal(record.promptText);
  };

  const copyContextRecordPath = async (
    record: TerminalContextBundleRecord,
    pathKind: "markdown" | "manifest" | "fullMarkdown",
  ) => {
    if (!activeWorkspace) return;

    const pathToCopy =
      pathKind === "manifest"
        ? record.manifestPath
        : pathKind === "fullMarkdown"
        ? joinWorkspacePath(activeWorkspace.rootPath, record.markdownPath)
        : record.markdownPath;

    await navigator.clipboard.writeText(pathToCopy);
    message.success("Context path copied");
  };

  const openContextRecordWorkspace = async () => {
    await openWorkspaceFolder();
  };

  const selectionToIM = () => {
    if (!activeTab) return;
    const terminalSelection = terminalApisRef.current
      .get(activeTab.id)
      ?.getSelectionText();
    const browserSelection = window.getSelection()?.toString();
    const recentSelection = recentTerminalSelectionsRef.current.get(activeTab.id);
    const recentSelectionText =
      recentSelection && Date.now() - recentSelection.updatedAt < RECENT_SELECTION_TTL
        ? recentSelection.text
        : "";
    const selection = terminalSelection || recentSelectionText || browserSelection;
    if (!selection?.trim()) {
      const api = terminalApisRef.current.get(activeTab.id);
      if (!api) {
        message.info("No active terminal surface");
        return;
      }

      const visibleText = api.getVisibleText();
      const recentOutputText = api.getRecentOutputText();
      const fallbackText =
        visibleText.trim().length >= 12 ? visibleText.trim() : recentOutputText.trim();

      if (!fallbackText) {
        message.info("No terminal selection");
        return;
      }

      setSelectionReplyReview({
        open: true,
        text: fallbackText,
        source: visibleText.trim().length >= 12 ? "screen" : "recent",
      });
      return;
    }

    setSelectionReplyReview({
      open: true,
      text: selection.trim(),
      source: "selection",
    });
  };

  const confirmSelectionReply = () => {
    const textarea = selectionReplyReviewHostRef.current?.querySelector("textarea");
    const selectedText =
      textarea && textarea.selectionStart !== textarea.selectionEnd
        ? selectionReplyReview.text.slice(
            textarea.selectionStart,
            textarea.selectionEnd,
          )
        : selectionReplyReview.text;
    const normalizedText = selectedText.trim();

    if (!normalizedText) {
      message.info("No terminal text selected");
      return;
    }

    emit("APPEND_CHAT_INPUT", normalizedText);
    setSelectionReplyReview({
      open: false,
      text: "",
      source: "selection",
    });
    message.success("Reply draft updated from selection");
  };

  const handleAutoSendChange = (enabled: boolean) => {
    if (!enabled) {
      setAutoSendEnabled(false);
      return;
    }

    Modal.confirm({
      title: "Enable Draft -> Chat (experimental)?",
      content: AUTO_SEND_WARNING,
      okText: "Enable",
      cancelText: "Cancel",
      onOk: () => setAutoSendEnabled(true),
      onCancel: () => setAutoSendEnabled(false),
    });
  };

  const runMenuItems = [
    ...commandTemplates
      .filter((template) => template.enabled)
      .map((template) => ({
        key: `template:${template.id}`,
        label: template.title,
      })),
    { type: "divider" as const },
    {
      key: "powershell",
      label: "Run PowerShell",
    },
    {
      key: "new-terminal",
      label: "New Terminal",
    },
    { type: "divider" as const },
    {
      key: "templates",
      label: "Command Templates",
      icon: <SettingOutlined rev={undefined} />,
    },
  ];

  const onRunMenuClick = ({ key }: { key: string }) => {
    if (key.startsWith("template:")) {
      void onRunCommandTemplate(key.replace("template:", ""));
      return;
    }

    if (key === "powershell" || key === "new-terminal") {
      void onCreateTab();
      return;
    }

    if (key === "templates") {
      setCommandModalOpen(true);
    }
  };

  if (!panelOpen) return null;

  return (
    <aside className="terminal-dock" data-testid="terminal-dock">
      <div className="terminal-dock-header">
        <div className="flex min-w-0 items-center gap-2">
          <CodeOutlined className="text-[#89d185]" rev={undefined} />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium text-[#ffffff]">
              Terminal
            </div>
            <div className="truncate text-[11px] text-[#9d9d9d]">
              {activeWorkspace?.title ?? "No workspace"}
            </div>
          </div>
        </div>
        <Tooltip title="Close Terminal">
          <Button
            type="text"
            size="small"
            className="terminal-dock-icon-button"
            icon={<CloseOutlined rev={undefined} />}
            onClick={() => setPanelOpen(false)}
          />
        </Tooltip>
      </div>

      <WorkspaceBar
        workspaces={workspaces}
        activeWorkspace={activeWorkspace}
        disabled={!terminalAvailable}
        onCreateWorkspace={() => setWorkspaceModalOpen(true)}
        onChangeWorkspace={setActiveWorkspace}
        onOpenWorkspace={() => void openWorkspaceFolder()}
        onCopyPath={() => void copyWorkspacePath()}
        onExportContext={() => setContextModalOpen(true)}
      />

      <div className="terminal-dock-toolbar">
        <div
          className="terminal-dock-toolbar-group"
          data-testid="terminal-runtime-controls"
        >
          <span className="terminal-dock-toolbar-label">Runtime controls</span>
          <Dropdown
            menu={{
              items: runMenuItems,
              onClick: onRunMenuClick,
            }}
            trigger={["click"]}
            disabled={!terminalAvailable || !activeWorkspace}
          >
            <Button
              size="small"
              type="default"
              className="terminal-dock-command-button"
              disabled={!terminalAvailable || !activeWorkspace}
              icon={<PlayCircleOutlined rev={undefined} />}
              data-testid="terminal-run-profile"
            >
              Run <DownOutlined rev={undefined} />
            </Button>
          </Dropdown>
          <Tooltip title="Start selected terminal">
            <Button
              size="small"
              type="default"
              className="terminal-dock-command-button"
              disabled={!activeTab || activeTab.status === "running"}
              icon={<PlayCircleOutlined rev={undefined} />}
              onClick={() => activeTab && void startTab(activeTab.id)}
              data-testid="terminal-start"
            >
              Start
            </Button>
          </Tooltip>
          <Tooltip title="Restart">
            <Button
              size="small"
              type="text"
              className="terminal-dock-icon-button"
              disabled={!activeTab}
              icon={<ReloadOutlined rev={undefined} />}
              onClick={() => activeTab && void restartTab(activeTab.id)}
            />
          </Tooltip>
          <Tooltip title="Interrupt">
            <Button
              size="small"
              type="text"
              className="terminal-dock-icon-button"
              disabled={!activeTab || activeTab.status !== "running"}
              icon={<PauseCircleOutlined rev={undefined} />}
              onClick={() => activeTab && void interruptTab(activeTab.id)}
            />
          </Tooltip>
          <Tooltip title="Stop">
            <Button
              size="small"
              type="text"
              className="terminal-dock-icon-button"
              disabled={!activeTab || activeTab.status !== "running"}
              icon={<StopOutlined rev={undefined} />}
              onClick={() => activeTab && void stopTab(activeTab.id)}
            />
          </Tooltip>
          <Tooltip title="Clear Terminal">
            <Button
              size="small"
              type="default"
              className="terminal-dock-command-button"
              disabled={!activeTab}
              icon={<DeleteOutlined rev={undefined} />}
              onClick={() => activeTab && clearTabOutput(activeTab.id)}
            >
              Clear
            </Button>
          </Tooltip>
        </div>

        <div
          className="terminal-dock-toolbar-group"
          data-testid="terminal-im-agent-group"
        >
          <span className="terminal-dock-toolbar-label">IM -&gt; Agent</span>
          <div className="terminal-dock-toggle">
            <Tooltip title="Detect @bot and /bot messages as pending agent requests. Detection only creates a pending card.">
              <span>Bot Requests</span>
            </Tooltip>
            <Switch
              size="small"
              checked={botDetectionEnabled}
              onChange={setBotDetectionEnabled}
              data-testid="terminal-bot-detection-toggle"
            />
          </div>
          {pendingRequestCount > 0 && (
            <span
              className="terminal-dock-pending-count"
              data-testid="terminal-pending-agent-count"
            >
              Pending: {pendingRequestCount}
            </span>
          )}
          <Tooltip title="Advanced / Debug Context Files">
            <Button
              size="small"
              type="text"
              className="terminal-dock-icon-button"
              disabled={!activeWorkspace || !conversationID}
              icon={<FileTextOutlined rev={undefined} />}
              onClick={() => setContextModalOpen(true)}
              data-testid="terminal-context-advanced"
            >
              Advanced
            </Button>
          </Tooltip>
        </div>

        <div
          className="terminal-dock-toolbar-group"
          data-testid="terminal-agent-im-group"
        >
          <span className="terminal-dock-toolbar-label">Agent -&gt; IM</span>
          <Tooltip title="Review selected terminal text before inserting it into the current reply draft. If a TUI blocks terminal selection, this opens a selectable screen snapshot.">
            <Button
              size="small"
              type="default"
              className="terminal-dock-command-button"
              disabled={!activeTab}
              icon={<CopyOutlined rev={undefined} />}
              onClick={selectionToIM}
              data-testid="terminal-use-selection-reply"
            >
              Use Selection as Reply
            </Button>
          </Tooltip>
          <Tooltip title="Attach a file from the active workspace to the current conversation after confirmation">
            <Button
              size="small"
              type="default"
              className="terminal-dock-command-button"
              disabled={!activeWorkspace || !workspaceFileInput.trim()}
              icon={<FileTextOutlined rev={undefined} />}
              onClick={() => void prepareWorkspaceAttachment()}
              data-testid="terminal-attach-workspace-file"
            >
              Attach Workspace File
            </Button>
          </Tooltip>
          <Tooltip title="Debug reply handoff tools">
            <Button
              size="small"
              type="text"
              className="terminal-dock-icon-button"
              disabled={!activeTab}
              onClick={() => setReplyDebugModalOpen(true)}
              data-testid="terminal-reply-debug"
            >
              Debug
            </Button>
          </Tooltip>
        </div>
      </div>

      {activeWorkspace ? (
        <>
          <TerminalTabs
            tabs={tabs}
            activeTabID={activeTab?.id}
            onAdd={() => void onCreateTab()}
            onSelect={(tabID) => setActiveTab(activeWorkspace.id, tabID)}
            onClose={(tabID) => void removeTab(activeWorkspace.id, tabID)}
          />
          <div className="min-h-0 flex-1 bg-[#1e1e1e]">
            {activeTab ? (
              <TerminalSurface
                tab={activeTab}
                output={activeTabOutput}
                onReady={(tabID, api) => {
                  if (!api) {
                    terminalApisRef.current.delete(tabID);
                    recentTerminalSelectionsRef.current.delete(tabID);
                    return;
                  }
                  terminalApisRef.current.set(tabID, api);
                }}
                onSelectionChange={(tabID, selection) => {
                  if (!selection.trim()) return;
                  recentTerminalSelectionsRef.current.set(tabID, {
                    text: selection,
                    updatedAt: Date.now(),
                  });
                }}
              />
            ) : (
              <div className="terminal-dock-empty">
                <div>
                  <div className="text-sm text-[#cccccc]">No terminal tab</div>
                  <Button
                    className="mt-3"
                    size="small"
                    type="primary"
                    onClick={() => void onCreateTab()}
                  >
                    New Terminal
                  </Button>
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="terminal-dock-empty">
          {!terminalAvailable ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="Terminal is available only in the Electron client"
            />
          ) : (
            <div>
              <div className="text-sm text-[#cccccc]">No workspace</div>
              <div className="mt-1 text-xs text-[#9d9d9d]">
                Create a workspace to run CLI agents in a terminal.
              </div>
              <Button
                className="mt-3"
                size="small"
                type="primary"
                onClick={() => setWorkspaceModalOpen(true)}
              >
                New Workspace
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="terminal-dock-status">
        <span className="truncate">{activeWorkspace?.rootPath ?? "No workspace"}</span>
        <span className="shrink-0">{getTabStats(activeTab)}</span>
      </div>

      <Modal
        title="New Workspace"
        open={workspaceModalOpen}
        onCancel={() => setWorkspaceModalOpen(false)}
        onOk={() => void onCreateWorkspace()}
        okButtonProps={{
          disabled: !terminalAvailable,
          "data-testid": "terminal-workspace-ok",
        }}
      >
        <Input
          autoFocus
          placeholder="Workspace name"
          value={workspaceTitle}
          onChange={(event) => setWorkspaceTitle(event.target.value)}
          onPressEnter={() => void onCreateWorkspace()}
          data-testid="terminal-workspace-name"
        />
      </Modal>

      <Modal
        title="Command Templates"
        open={commandModalOpen}
        onCancel={() => setCommandModalOpen(false)}
        footer={[
          <Button key="add" onClick={addCommandTemplate}>
            Add Template
          </Button>,
          <Button key="reset" onClick={resetCommandTemplates}>
            Reset
          </Button>,
          <Button key="close" type="primary" onClick={() => setCommandModalOpen(false)}>
            Close
          </Button>,
        ]}
      >
        <div className="terminal-dock-template-list">
          {commandTemplates.map((template) => (
            <div key={template.id} className="terminal-dock-template-item">
              <div className="terminal-dock-template-row">
                <Checkbox
                  checked={template.enabled}
                  onChange={(event) =>
                    updateCommandTemplate(template.id, {
                      enabled: event.target.checked,
                    })
                  }
                >
                  Enabled
                </Checkbox>
                <Button
                  size="small"
                  danger
                  disabled={template.id === "opencode"}
                  icon={<DeleteOutlined rev={undefined} />}
                  onClick={() => removeCommandTemplate(template.id)}
                />
              </div>
              <Input
                size="small"
                placeholder="Menu title"
                value={template.title}
                onChange={(event) =>
                  updateCommandTemplate(template.id, {
                    title: event.target.value,
                  })
                }
              />
              <Input
                size="small"
                placeholder="Command to inject"
                value={template.command}
                onChange={(event) =>
                  updateCommandTemplate(template.id, {
                    command: event.target.value,
                  })
                }
              />
              <Input
                size="small"
                placeholder="Description"
                value={template.description}
                onChange={(event) =>
                  updateCommandTemplate(template.id, {
                    description: event.target.value,
                  })
                }
              />
            </div>
          ))}
        </div>
      </Modal>

      <Modal
        title="Advanced / Debug Context Files"
        open={contextModalOpen}
        width={820}
        onCancel={() => setContextModalOpen(false)}
        footer={[
          <Button key="close" onClick={() => setContextModalOpen(false)}>
            Close
          </Button>,
          <Button
            key="preview"
            disabled={!activeWorkspace || !conversationID}
            onClick={() => void runRecentContextAction("preview")}
            data-testid="terminal-context-recent-preview"
          >
            Preview Recent
          </Button>,
          <Button
            key="selected"
            disabled={
              !activeWorkspace || !conversationID || selectedMessages.length === 0
            }
            onClick={() => void runSelectedContextAction("preview")}
            data-testid="terminal-context-selected-preview"
          >
            Preview Selected
          </Button>,
          <Button
            key="copy"
            disabled={!lastContextPrompt}
            onClick={() => void copyLastContextPrompt()}
            data-testid="terminal-context-copy-last-prompt"
          >
            Copy Last Prompt
          </Button>,
          <Button
            key="send-last"
            disabled={!lastContextPrompt || !activeTab}
            onClick={() => void sendLastContextPrompt()}
            data-testid="terminal-context-send-last-prompt"
          >
            Send Last Prompt
          </Button>,
          <Button
            key="copy-preview"
            disabled={!contextPreviewBundle}
            onClick={() => void copyPreviewedContext()}
            data-testid="terminal-context-copy-prompt"
          >
            Copy Previewed Context
          </Button>,
          <Button
            key="send-preview"
            type="primary"
            disabled={!contextPreviewBundle || !activeTab}
            onClick={() => void sendPreviewedContext()}
            data-testid="terminal-context-send-prompt"
          >
            Send Previewed Context
          </Button>,
        ]}
      >
        <div
          className="terminal-dock-context-builder"
          data-testid="terminal-context-modal"
        >
          <div className="terminal-dock-context-row">
            <div>
              <div className="text-xs text-[#cccccc]">Preview Source</div>
              <div className="text-[11px] text-[#8c8c8c]">
                Advanced preview and file export for recent messages or the current{" "}
                selection. Use this to inspect, reuse, or debug generated context files.
              </div>
            </div>
            <Input
              className="terminal-dock-context-limit"
              size="small"
              value={contextMessageLimit}
              onChange={(event) => setContextMessageLimit(event.target.value)}
              placeholder="50"
            />
          </div>
          <div className="terminal-dock-context-stats">
            <span>{selectedMessages.length} selected messages</span>
          </div>
          {contextPreviewBundle ? (
            <>
              <div className="terminal-dock-context-stats">
                <span>{contextPreviewBundle.stats.messageCount} messages</span>
                <span>{contextPreviewBundle.stats.attachmentCount} attachments</span>
                <span>
                  {contextPreviewBundle.stats.exportedAttachmentCount} exported
                </span>
                <span>{contextPreviewBundle.stats.skippedAttachmentCount} skipped</span>
                <span>{contextPreviewBundle.stats.failedAttachmentCount} failed</span>
                <span>{contextPreviewBundle.stats.approxChars} chars</span>
              </div>
              <div className="terminal-dock-context-files">
                <div>{contextPreviewBundle.files.markdownPath}</div>
                <div>{contextPreviewBundle.files.manifestPath}</div>
              </div>
              <Input.TextArea
                readOnly
                className="terminal-dock-context-preview"
                value={contextPreviewBundle.markdown}
                data-testid="terminal-context-markdown-preview"
                autoSize={{ minRows: 14, maxRows: 22 }}
              />
              <Input.TextArea
                readOnly
                className="terminal-dock-context-preview"
                value={contextPreviewBundle.promptText}
                data-testid="terminal-context-prompt-preview"
                autoSize={{ minRows: 5, maxRows: 8 }}
              />
            </>
          ) : (
            <div className="terminal-dock-context-empty">
              Build a preview to inspect or write context files into the active
              workspace.
            </div>
          )}
          <div className="terminal-dock-context-history">
            <div className="terminal-dock-context-history-header">
              <div>
                <div className="text-xs text-[#cccccc]">Attach Workspace File</div>
                <div className="text-[11px] text-[#8c8c8c]">
                  Attach a file from the active workspace to the current chat. Use a
                  relative path such as a generated markdown or manifest file.
                </div>
              </div>
            </div>
            <div className="terminal-dock-context-row">
              <Input
                size="small"
                placeholder="context/bundle_xxx.md"
                value={workspaceFileInput}
                onChange={(event) => setWorkspaceFileInput(event.target.value)}
                data-testid="terminal-workspace-file-input"
              />
              <Button
                size="small"
                disabled={!activeWorkspace || !workspaceFileInput.trim()}
                onClick={() => void prepareWorkspaceAttachment()}
                data-testid="terminal-workspace-file-attach"
              >
                Attach Workspace File
              </Button>
            </div>
            {contextPreviewBundle && (
              <div className="terminal-dock-context-files">
                <button
                  type="button"
                  className="terminal-dock-link-button"
                  onClick={() =>
                    setWorkspaceFileInput(contextPreviewBundle.files.markdownPath)
                  }
                >
                  Use Markdown
                </button>
                <button
                  type="button"
                  className="terminal-dock-link-button"
                  onClick={() =>
                    setWorkspaceFileInput(contextPreviewBundle.files.manifestPath)
                  }
                >
                  Use Manifest
                </button>
              </div>
            )}
          </div>
          <div
            className="terminal-dock-context-history"
            data-testid="terminal-context-history"
          >
            <div className="terminal-dock-context-history-header">
              <div>
                <div className="text-xs text-[#cccccc]">Context File History</div>
                <div className="text-[11px] text-[#8c8c8c]">
                  Advanced / debug history for generated workspace bundles. Files stay
                  on disk; this list stores prompt metadata only.
                </div>
              </div>
              <Button
                size="small"
                disabled={!activeWorkspace || contextBundleHistory.length === 0}
                onClick={() =>
                  activeWorkspace && clearContextBundleHistory(activeWorkspace.id)
                }
              >
                Clear History
              </Button>
            </div>
            {contextBundleHistory.length > 0 ? (
              <div className="terminal-dock-context-history-list">
                {contextBundleHistory.map((record) => (
                  <div key={record.id} className="terminal-dock-context-history-item">
                    <div className="min-w-0 flex-1">
                      <div className="terminal-dock-context-history-title">
                        <span data-testid="terminal-context-record-source">
                          {record.sourceKind}
                        </span>
                        <span>{new Date(record.createdAt).toLocaleString()}</span>
                      </div>
                      <div className="terminal-dock-context-history-meta">
                        <span>{record.messageCount} messages</span>
                        <span>{record.attachmentCount} attachments</span>
                        <span>{record.exportedAttachmentCount} exported</span>
                        <span>{record.skippedAttachmentCount} skipped</span>
                        <span>{record.failedAttachmentCount} failed</span>
                        <span>{record.approxChars} chars</span>
                      </div>
                      <div className="terminal-dock-context-history-path">
                        {record.markdownPath}
                      </div>
                      <div className="terminal-dock-context-history-path">
                        {record.manifestPath}
                      </div>
                    </div>
                    <div className="terminal-dock-context-history-actions">
                      <Button
                        size="small"
                        onClick={() => void copyContextRecordPrompt(record)}
                        data-testid="terminal-context-record-copy-prompt"
                      >
                        Copy This Prompt
                      </Button>
                      <Button
                        size="small"
                        onClick={() => void copyContextRecordPath(record, "markdown")}
                      >
                        Copy This MD
                      </Button>
                      <Button
                        size="small"
                        onClick={() => void copyContextRecordPath(record, "manifest")}
                      >
                        Copy This Manifest
                      </Button>
                      <Button
                        size="small"
                        onClick={() =>
                          void copyContextRecordPath(record, "fullMarkdown")
                        }
                      >
                        Copy This Full Path
                      </Button>
                      <Button
                        size="small"
                        disabled={!activeWorkspace}
                        onClick={() => void openContextRecordWorkspace()}
                      >
                        Open This Context
                      </Button>
                      <Button
                        size="small"
                        onClick={() =>
                          void prepareWorkspaceAttachment(record.markdownPath)
                        }
                        data-testid="terminal-context-record-attach-markdown"
                      >
                        Attach MD
                      </Button>
                      <Button
                        size="small"
                        onClick={() =>
                          void prepareWorkspaceAttachment(record.manifestPath)
                        }
                      >
                        Attach Manifest
                      </Button>
                      <Button
                        size="small"
                        type="primary"
                        disabled={!activeTab}
                        onClick={() => void sendContextRecordPrompt(record)}
                        data-testid="terminal-context-record-send"
                      >
                        Send This Context
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="terminal-dock-context-empty">
                No context bundles in this workspace yet.
              </div>
            )}
          </div>
        </div>
      </Modal>

      <Modal
        title="Reply Debug Tools"
        open={replyDebugModalOpen}
        onCancel={() => setReplyDebugModalOpen(false)}
        footer={[
          <Button key="close" onClick={() => setReplyDebugModalOpen(false)}>
            Close
          </Button>,
        ]}
      >
        <div
          className="terminal-dock-template-list"
          data-testid="terminal-reply-debug-modal"
        >
          <div className="text-xs text-[#8c8c8c]">
            Debug-only terminal-to-reply helpers. Manual capture is safer; automatic
            capture and automatic send remain off by default.
          </div>
          <div className="terminal-dock-debug-row">
            <div>
              <div className="text-xs text-[#262626]">Capture Output</div>
              <div className="text-[11px] text-[#8c8c8c]">
                Replace the current reply draft with the latest terminal output
                snapshot.
              </div>
            </div>
            <Button
              size="small"
              disabled={!activeTab}
              icon={<CopyOutlined rev={undefined} />}
              onClick={() => captureTerminalOutput("manual")}
              data-testid="terminal-capture-output"
            >
              Capture to Draft
            </Button>
          </div>
          <div className="terminal-dock-debug-row">
            <div>
              <div className="text-xs text-[#262626]">Auto Capture Output</div>
              <div className="text-[11px] text-[#8c8c8c]">
                Keep the latest terminal snapshot in the reply draft. Off by default.
              </div>
            </div>
            <Switch
              size="small"
              checked={autoReceiveEnabled}
              disabled={!activeTab}
              onChange={setAutoReceiveEnabled}
              data-testid="terminal-output-draft-toggle"
            />
          </div>
          <div className="terminal-dock-debug-row">
            <div>
              <div className="text-xs text-[#262626]">Draft -&gt; Chat</div>
              <div className="text-[11px] text-[#8c8c8c]">
                Experimental auto-send. Requires Auto Capture and explicit confirmation.
              </div>
            </div>
            <Switch
              size="small"
              checked={autoSendEnabled}
              disabled={!activeTab || !autoReceiveEnabled}
              onChange={handleAutoSendChange}
              data-testid="terminal-draft-chat-toggle"
            />
          </div>
        </div>
      </Modal>

      <Modal
        title="Confirm Workspace Attachment"
        open={Boolean(workspaceAttachmentCandidate)}
        okText="Attach"
        cancelText="Cancel"
        onCancel={() => setWorkspaceAttachmentCandidate(undefined)}
        onOk={attachWorkspaceFile}
        okButtonProps={{
          "data-testid": "terminal-workspace-file-confirm",
        }}
      >
        {workspaceAttachmentCandidate && (
          <div
            className="terminal-dock-template-list"
            data-testid="terminal-workspace-file-confirmation"
          >
            <div className="text-xs text-[#8c8c8c]">
              Review the workspace file before attaching it back to the current chat.
            </div>
            <div className="terminal-dock-context-files">
              <div>File name: {workspaceAttachmentCandidate.fileName}</div>
              <div>Relative path: {workspaceAttachmentCandidate.relativePath}</div>
              <div>
                Type:{" "}
                {workspaceAttachmentCandidate.fileType || "application/octet-stream"}
              </div>
              <div>Size: {formatFileSize(workspaceAttachmentCandidate.fileSize)}</div>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        title="Use Selection as Reply"
        open={selectionReplyReview.open}
        width={760}
        okText="Use as Reply"
        cancelText="Cancel"
        okButtonProps={{
          "data-testid": "terminal-selection-reply-confirm",
        }}
        onCancel={() =>
          setSelectionReplyReview({
            open: false,
            text: "",
            source: "selection",
          })
        }
        onOk={confirmSelectionReply}
      >
        <div
          className="terminal-dock-template-list"
          ref={selectionReplyReviewHostRef}
          data-testid="terminal-selection-reply-review"
        >
          <div className="text-xs text-[#8c8c8c]">
            {selectionReplyReview.source === "selection"
              ? "Review the selected terminal text before using it as the current reply draft."
              : selectionReplyReview.source === "screen"
              ? "The active TUI did not expose a live terminal selection. Review the current visible screen snapshot below, highlight a portion if needed, then use it as the reply draft."
              : "The active TUI did not expose a live terminal selection. Review the recent terminal output snapshot below, highlight a portion if needed, then use it as the reply draft."}
          </div>
          <Input.TextArea
            autoSize={{ minRows: 16, maxRows: 24 }}
            value={selectionReplyReview.text}
            onChange={(event) =>
              setSelectionReplyReview((prev) => ({
                ...prev,
                text: event.target.value,
              }))
            }
            style={{
              fontFamily:
                'Consolas, "Cascadia Mono", "Cascadia Code", "JetBrains Mono", monospace',
            }}
          />
        </div>
      </Modal>
    </aside>
  );
};

export default TerminalDock;
