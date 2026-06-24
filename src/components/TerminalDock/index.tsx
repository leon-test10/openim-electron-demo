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
  SendOutlined,
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
import {
  ContextBundle,
  ContextSource,
  exportContextAttachments,
  IMContextService,
} from "@/services/imContext";
import {
  useConversationStore,
  useMessageSelectionStore,
  useTerminalDockStore,
} from "@/store";
import { TerminalContextBundleRecord, TerminalTab } from "@/store/type";
import emitter, { emit, IMContextActionParams } from "@/utils/events";

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

type TerminalSelectionFallbackState = {
  open: boolean;
  text: string;
  source: "screen" | "recent";
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
  const [contextMessageLimit, setContextMessageLimit] = useState("50");
  const [contextPreviewBundle, setContextPreviewBundle] = useState<ContextBundle>();
  const [workspaceTitle, setWorkspaceTitle] = useState("");
  const [selectionFallback, setSelectionFallback] =
    useState<TerminalSelectionFallbackState>({
      open: false,
      text: "",
      source: "screen",
    });
  const terminalApisRef = useRef<Map<string, TerminalSurfaceApi>>(new Map());
  const recentTerminalSelectionsRef = useRef<
    Map<string, { text: string; updatedAt: number }>
  >(new Map());
  const selectionFallbackHostRef = useRef<HTMLDivElement>(null);
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
  const activeTabOutput = activeTab ? outputByTab[activeTab.id] ?? [] : [];
  const activeTabOutputSignature = useMemo(
    () => activeTabOutput.map((item) => item.id).join("|"),
    [activeTabOutput],
  );

  const getCapturedTerminalText = useCallback(
    (tab: TerminalTab) => {
      const api = terminalApisRef.current.get(tab.id);
      if (!api) return undefined;

      const visibleText = api.getVisibleText();
      const recentOutputText = api.getRecentOutputText();
      const capturedText =
        captureSource === "screen"
          ? visibleText
          : captureSource === "raw"
          ? recentOutputText
          : visibleText.length >= 12
          ? visibleText
          : recentOutputText;

      return capturedText.trim();
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
        message.success("Terminal output captured to chat draft");
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
      failedAttachmentCount: finalizedBundle.stats.failedAttachmentCount,
      unsupportedAttachmentCount: finalizedBundle.stats.unsupportedAttachmentCount,
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

  const createRecentContext = async (
    options: { copyPrompt?: boolean; sendPrompt?: boolean } = {},
  ) => {
    const bundle = await buildRecentContextBundle();
    if (!bundle) {
      message.warning("No IM context available");
      return undefined;
    }

    const result = await persistContextBundle(bundle);
    if (!result) {
      message.warning("No active workspace");
      return undefined;
    }

    setContextPreviewBundle(result.bundle);
    if (options.copyPrompt) {
      await navigator.clipboard.writeText(result.bundle.promptText);
      message.success("Context prompt copied");
    } else {
      message.success(
        result.bundle.stats.attachmentCount > 0
          ? `Context created with ${result.bundle.stats.exportedAttachmentCount} exported attachments and ${result.bundle.stats.failedAttachmentCount} failed attachments`
          : "Context bundle created",
      );
    }

    if (options.sendPrompt) {
      if (!activeTab) {
        message.warning("No active terminal");
        return result;
      }
      await writeToTab(activeTab.id, `${result.bundle.promptText}\r\n`);
      terminalApisRef.current.get(activeTab.id)?.focus();
      message.success("Context prompt sent to terminal");
    }

    return result;
  };

  const createMessagesContext = async (
    options: { copyPrompt?: boolean; sendPrompt?: boolean } = {},
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

    setContextPreviewBundle(result.bundle);
    if (options.copyPrompt) {
      await navigator.clipboard.writeText(result.bundle.promptText);
      message.success("IM context prompt copied");
    } else {
      message.success(
        result.bundle.stats.attachmentCount > 0
          ? `IM context created with ${result.bundle.stats.exportedAttachmentCount} exported attachments and ${result.bundle.stats.failedAttachmentCount} failed attachments`
          : "IM context bundle created",
      );
    }

    if (options.sendPrompt) {
      if (!activeTab) {
        message.warning("No active terminal");
        return result;
      }
      await writeToTab(activeTab.id, `${result.bundle.promptText}\r\n`);
      terminalApisRef.current.get(activeTab.id)?.focus();
      message.success("IM context prompt sent to terminal");
    }

    return result;
  };

  useEffect(() => {
    const handleContextAction = (params: IMContextActionParams) => {
      setContextModalOpen(true);
      if (params.action === "preview") {
        void createMessagesContext({}, params);
        return;
      }
      if (params.action === "copy") {
        void createMessagesContext({ copyPrompt: true }, params);
        return;
      }
      if (params.action === "send") {
        void createMessagesContext({ sendPrompt: true }, params);
      }
    };

    emitter.on("IM_CONTEXT_ACTION", handleContextAction);
    emitter.on("TERMINAL_CONTEXT_ACTION", handleContextAction);
    return () => {
      emitter.off("IM_CONTEXT_ACTION", handleContextAction);
      emitter.off("TERMINAL_CONTEXT_ACTION", handleContextAction);
    };
  });

  const copyContextPrompt = async () => {
    if (!lastContextPrompt) {
      await createRecentContext({ copyPrompt: true });
      return;
    }
    await navigator.clipboard.writeText(lastContextPrompt);
    message.success("Context prompt copied");
  };

  const sendContextPrompt = async () => {
    if (!activeTab) {
      message.warning("No active terminal");
      return;
    }
    if (!lastContextPrompt) {
      message.warning("Create a context bundle first");
      return;
    }
    await writeToTab(activeTab.id, `${lastContextPrompt}\r\n`);
    terminalApisRef.current.get(activeTab.id)?.focus();
  };

  const copyContextRecordPrompt = async (record: TerminalContextBundleRecord) => {
    if (!activeWorkspace) return;
    setLastContextPrompt(activeWorkspace.id, record.promptText);
    await navigator.clipboard.writeText(record.promptText);
    message.success("Context prompt copied");
  };

  const sendContextRecordPrompt = async (record: TerminalContextBundleRecord) => {
    if (!activeWorkspace) return;
    if (!activeTab) {
      message.warning("No active terminal");
      return;
    }

    setLastContextPrompt(activeWorkspace.id, record.promptText);
    await writeToTab(activeTab.id, `${record.promptText}\r\n`);
    terminalApisRef.current.get(activeTab.id)?.focus();
    message.success("Context prompt sent to terminal");
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

      setSelectionFallback({
        open: true,
        text: fallbackText,
        source: visibleText.trim().length >= 12 ? "screen" : "recent",
      });
      return;
    }

    emit("APPEND_CHAT_INPUT", selection.trim());
    message.success("Selection added to IM input");
  };

  const appendSelectionFallbackToIM = () => {
    const textarea = selectionFallbackHostRef.current?.querySelector("textarea");
    const selectedText =
      textarea && textarea.selectionStart !== textarea.selectionEnd
        ? selectionFallback.text.slice(textarea.selectionStart, textarea.selectionEnd)
        : selectionFallback.text;
    const normalizedText = selectedText.trim();

    if (!normalizedText) {
      message.info("No terminal text selected");
      return;
    }

    emit("APPEND_CHAT_INPUT", normalizedText);
    setSelectionFallback({
      open: false,
      text: "",
      source: "screen",
    });
    message.success("Selection added to IM input");
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

  const contextMenuItems = [
    {
      key: "create-recent",
      label: "Create from recent messages...",
    },
    {
      key: "create-selected",
      label: `Create from selected messages${
        selectedMessages.length > 0 ? ` (${selectedMessages.length})` : ""
      }`,
      disabled: selectedMessages.length === 0,
    },
    {
      key: "copy-prompt",
      label: "Copy Prompt",
      disabled: !activeWorkspace || !conversationID,
    },
    {
      key: "send-prompt",
      label: "Send Prompt",
      disabled: !activeTab || !lastContextPrompt,
    },
    {
      key: "preview",
      label: "Preview current context",
      disabled: !contextPreviewBundle,
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

  const onContextMenuClick = ({ key }: { key: string }) => {
    if (key === "create-recent") {
      setContextModalOpen(true);
      return;
    }
    if (key === "create-selected") {
      void createMessagesContext({ copyPrompt: true });
      setContextModalOpen(true);
      return;
    }
    if (key === "copy-prompt") {
      void copyContextPrompt();
      return;
    }
    if (key === "send-prompt") {
      void sendContextPrompt();
      return;
    }
    if (key === "preview" && contextPreviewBundle) {
      setContextModalOpen(true);
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
        <Dropdown
          menu={{
            items: contextMenuItems,
            onClick: onContextMenuClick,
          }}
          trigger={["click"]}
          disabled={!activeWorkspace || !conversationID}
        >
          <Button
            size="small"
            type="default"
            className="terminal-dock-command-button"
            disabled={!activeWorkspace || !conversationID}
            icon={<FileTextOutlined rev={undefined} />}
            data-testid="terminal-context-menu"
          >
            Context <DownOutlined rev={undefined} />
          </Button>
        </Dropdown>
        <Tooltip title="Send the current generated prompt to the active terminal and press Enter">
          <Button
            size="small"
            type="default"
            className="terminal-dock-command-button"
            disabled={!activeTab || !lastContextPrompt}
            icon={<SendOutlined rev={undefined} />}
            onClick={() => void sendContextPrompt()}
          >
            Send Prompt
          </Button>
        </Tooltip>
        <Tooltip title="Append selected terminal text to the current IM draft. If a TUI blocks terminal selection, this opens a selectable screen snapshot.">
          <Button
            size="small"
            type="default"
            className="terminal-dock-command-button"
            disabled={!activeTab}
            icon={<CopyOutlined rev={undefined} />}
            onClick={selectionToIM}
          >
            Selection -&gt; IM
          </Button>
        </Tooltip>
        <Tooltip title="Capture current screen/output text into the current chat draft">
          <Button
            size="small"
            type="default"
            className="terminal-dock-command-button"
            disabled={!activeTab}
            icon={<CopyOutlined rev={undefined} />}
            onClick={() => captureTerminalOutput("manual")}
            data-testid="terminal-capture-output"
          >
            Capture Output
          </Button>
        </Tooltip>
        <div className="terminal-dock-toggle">
          <span>Output -&gt; Draft</span>
          <Switch
            size="small"
            checked={autoReceiveEnabled}
            disabled={!activeTab}
            onChange={setAutoReceiveEnabled}
            data-testid="terminal-output-draft-toggle"
          />
        </div>
        <div className="terminal-dock-toggle">
          <Tooltip title={AUTO_SEND_WARNING}>
            <span className="terminal-dock-toggle-label is-experimental">
              Draft -&gt; Chat (experimental)
            </span>
          </Tooltip>
          <Switch
            size="small"
            checked={autoSendEnabled}
            disabled={!activeTab || !autoReceiveEnabled}
            onChange={handleAutoSendChange}
            data-testid="terminal-draft-chat-toggle"
          />
        </div>
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
        title="Create Context"
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
            onClick={() => void createRecentContext()}
            data-testid="terminal-context-recent-preview"
          >
            Recent Preview
          </Button>,
          <Button
            key="selected"
            disabled={
              !activeWorkspace || !conversationID || selectedMessages.length === 0
            }
            onClick={() => void createMessagesContext()}
            data-testid="terminal-context-selected-preview"
          >
            Selected Preview
          </Button>,
          <Button
            key="copy"
            disabled={!activeWorkspace || !conversationID}
            onClick={() => void createRecentContext({ copyPrompt: true })}
            data-testid="terminal-context-copy-prompt"
          >
            Copy Prompt
          </Button>,
          <Button
            key="send"
            type="primary"
            disabled={!activeWorkspace || !conversationID || !activeTab}
            onClick={() => void createRecentContext({ sendPrompt: true })}
            data-testid="terminal-context-send-prompt"
          >
            Send Prompt
          </Button>,
        ]}
      >
        <div
          className="terminal-dock-context-builder"
          data-testid="terminal-context-modal"
        >
          <div className="terminal-dock-context-row">
            <div>
              <div className="text-xs text-[#cccccc]">Source</div>
              <div className="text-[11px] text-[#8c8c8c]">
                Recent messages or selected messages from the current conversation
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
              Create a preview to write a context bundle into the active workspace.
            </div>
          )}
          <div
            className="terminal-dock-context-history"
            data-testid="terminal-context-history"
          >
            <div className="terminal-dock-context-history-header">
              <div>
                <div className="text-xs text-[#cccccc]">Context History</div>
                <div className="text-[11px] text-[#8c8c8c]">
                  Latest workspace bundles. Files stay on disk; this list stores prompt
                  metadata only.
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
                        Copy Prompt
                      </Button>
                      <Button
                        size="small"
                        onClick={() => void copyContextRecordPath(record, "markdown")}
                      >
                        Copy MD
                      </Button>
                      <Button
                        size="small"
                        onClick={() => void copyContextRecordPath(record, "manifest")}
                      >
                        Copy Manifest
                      </Button>
                      <Button
                        size="small"
                        onClick={() =>
                          void copyContextRecordPath(record, "fullMarkdown")
                        }
                      >
                        Copy Full Path
                      </Button>
                      <Button
                        size="small"
                        disabled={!activeWorkspace}
                        onClick={() => void openContextRecordWorkspace()}
                      >
                        Open
                      </Button>
                      <Button
                        size="small"
                        type="primary"
                        disabled={!activeTab}
                        onClick={() => void sendContextRecordPrompt(record)}
                        data-testid="terminal-context-record-send"
                      >
                        Send
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
        title="Selection -> IM (TUI Fallback)"
        open={selectionFallback.open}
        width={760}
        okText="Append to IM"
        cancelText="Cancel"
        onCancel={() =>
          setSelectionFallback({
            open: false,
            text: "",
            source: "screen",
          })
        }
        onOk={appendSelectionFallbackToIM}
      >
        <div className="terminal-dock-template-list" ref={selectionFallbackHostRef}>
          <div className="text-xs text-[#8c8c8c]">
            {selectionFallback.source === "screen"
              ? "The active TUI did not expose a live terminal selection. Review the current visible screen snapshot below, highlight a portion if needed, then append it to IM."
              : "The active TUI did not expose a live terminal selection. Review the recent terminal output snapshot below, highlight a portion if needed, then append it to IM."}
          </div>
          <Input.TextArea
            autoSize={{ minRows: 16, maxRows: 24 }}
            value={selectionFallback.text}
            onChange={(event) =>
              setSelectionFallback((prev) => ({
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
