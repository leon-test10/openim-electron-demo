import { RuntimeAttachment, useRuntimeDockStore } from "./runtimeDock";
import { RuntimeProfileID } from "./type";

const conversationID = "si_test_conversation";

useRuntimeDockStore.getState().setPanelOpen(true);
useRuntimeDockStore.getState().addRuntime(conversationID);

const state = useRuntimeDockStore.getState();
const attachment: RuntimeAttachment =
  state.attachmentsByConversation[conversationID][0];

attachment.runtimeProfileID satisfies RuntimeProfileID;
if (attachment.runtimeProfileID !== "powershell-terminal") {
  throw new Error("default runtime should be powershell-terminal");
}
state.removeAttachment(conversationID, attachment.id);
