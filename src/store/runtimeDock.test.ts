import { RuntimeAttachment, useRuntimeDockStore } from "./runtimeDock";

const conversationID = "si_test_conversation";

useRuntimeDockStore.getState().setPanelOpen(true);
useRuntimeDockStore.getState().addPlaceholderRuntime(conversationID);

const state = useRuntimeDockStore.getState();
const attachment: RuntimeAttachment =
  state.attachmentsByConversation[conversationID][0];

attachment.runtimeProfileID satisfies "shell-placeholder";
attachment.status satisfies "detached";
state.removeAttachment(conversationID, attachment.id);
