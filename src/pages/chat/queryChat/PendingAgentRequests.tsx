import { Button } from "antd";
import { FC } from "react";

import { PendingAgentRequest } from "@/services/botTrigger";
import { usePendingAgentRequestStore, useTerminalDockStore } from "@/store";
import emitter, { ContextAction } from "@/utils/events";

interface PendingAgentRequestsProps {
  conversationID?: string;
}

const PendingAgentRequests: FC<PendingAgentRequestsProps> = ({ conversationID }) => {
  const requests = usePendingAgentRequestStore((state) =>
    conversationID ? state.requestsByConversation[conversationID] ?? [] : [],
  );
  const markIgnored = usePendingAgentRequestStore((state) => state.markIgnored);
  const setPanelOpen = useTerminalDockStore((state) => state.setPanelOpen);
  const visibleRequests = requests.filter((request) => request.status === "pending");

  if (!conversationID || visibleRequests.length === 0) return null;

  const runRequestAction = (
    request: PendingAgentRequest,
    action: ContextAction | "ignore",
  ) => {
    if (action === "ignore") {
      markIgnored(request.conversationID, request.id);
      return;
    }

    setPanelOpen(true);
    window.setTimeout(() => {
      emitter.emit("BOT_AGENT_REQUEST_ACTION", {
        request,
        action,
      });
    }, 50);
  };

  return (
    <div className="sticky top-3 z-10 mx-4 mt-3 space-y-2">
      {visibleRequests.map((request) => (
        <div
          className="rounded-md border border-[#f5c26b] bg-[#fff8e7] px-3 py-2 text-xs text-[#5f3f00] shadow-sm"
          data-testid="pending-agent-request"
          key={request.id}
        >
          <div className="font-medium">Pending Agent Request</div>
          <div className="mt-1">
            From: {request.senderNickname || request.senderUserID || "Unknown"}
          </div>
          <div className="mt-1 line-clamp-2">Trigger: {request.triggerText}</div>
          <div className="mt-1">
            Context: recent {request.contextScope.recentLimit ?? 20} messages plus the
            trigger message
          </div>
          {request.isGroup && (
            <div
              className="mt-1 text-[#9a3412]"
              data-testid="pending-agent-group-warning"
            >
              This request came from a group chat. Review before sending to terminal.
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="small"
              onClick={() => runRequestAction(request, "preview")}
              data-testid="pending-agent-preview"
            >
              Preview Context
            </Button>
            <Button
              size="small"
              onClick={() => runRequestAction(request, "copy")}
              data-testid="pending-agent-copy"
            >
              Copy Prompt
            </Button>
            <Button
              size="small"
              type="primary"
              onClick={() => runRequestAction(request, "send")}
              data-testid="pending-agent-send"
            >
              Send to Terminal
            </Button>
            <Button
              size="small"
              danger
              onClick={() => runRequestAction(request, "ignore")}
              data-testid="pending-agent-ignore"
            >
              Ignore
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
};

export default PendingAgentRequests;
