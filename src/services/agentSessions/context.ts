import { ViewType } from "@openim/wasm-client-sdk";
import type { MessageItem } from "@openim/wasm-client-sdk/lib/types/entity";

import { IMSDK } from "@/layout/MainContentWrap";
import { applyContextAttachmentPolicy } from "@/services/humanAgentCollaboration";
import {
  type ContextSource,
  exportContextAttachments,
  IMContextService,
} from "@/services/imContext";
import { offlineIMService } from "@/services/offlineIM";
import { useAgentSessionStore } from "@/store";
import type { AgentSession } from "@/types/agentSession";
import { getAuthMode } from "@/utils/storage";

type WorkspaceAttachmentExportResponse = {
  path: string;
  size?: number;
  sha256?: string;
};

export const loadRecentConversationMessages = async (
  conversationID: string,
  limit: number,
): Promise<MessageItem[]> => {
  const count = Math.min(Math.max(limit, 1), 200);
  if (getAuthMode() === "offline") {
    const result = await offlineIMService.listMessages({ conversationID, count });
    return result.messageList;
  }
  const { data } = await IMSDK.getAdvancedHistoryMessageList({
    conversationID,
    count,
    startClientMsgID: "",
    viewType: ViewType.History,
  });
  return data.messageList;
};

export const persistAgentContextBundle = async ({
  session,
  source,
  messages,
  includeAttachments = true,
}: {
  session: AgentSession;
  source: ContextSource;
  messages: MessageItem[];
  includeAttachments?: boolean;
}) => {
  const contextMessages = applyContextAttachmentPolicy(messages, includeAttachments);
  let bundle = IMContextService.createContextBundle({
    workspacePath: session.workspacePath,
    source,
    messages: contextMessages,
  });

  if (
    includeAttachments &&
    session.managedWorkspace &&
    bundle.attachments.length &&
    window.electronAPI
  ) {
    const attachments = await exportContextAttachments({
      attachments: bundle.attachments,
      copyFile: (sourcePath, relativePath, maxBytes) =>
        window.electronAPI!.ipcInvoke<WorkspaceAttachmentExportResponse>(
          "workspace:copyWorkspaceFile",
          { workspaceID: session.id, sourcePath, relativePath, maxBytes },
        ),
      downloadFile: (url, relativePath, maxBytes) =>
        window.electronAPI!.ipcInvoke<WorkspaceAttachmentExportResponse>(
          "workspace:downloadWorkspaceFile",
          { workspaceID: session.id, url, relativePath, maxBytes },
        ),
    });
    bundle = IMContextService.withContextAttachments(bundle, attachments);
  }

  const paths = await useAgentSessionStore.getState().writeSessionFiles(session.id, [
    { relativePath: bundle.files.markdownPath, content: bundle.markdown },
    {
      relativePath: bundle.files.manifestPath,
      content: JSON.stringify(bundle.manifest, null, 2),
    },
  ]);
  return { bundle, paths };
};
