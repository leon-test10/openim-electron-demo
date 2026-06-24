export const byTestId = (testID: string) => `[data-testid="${testID}"]`;

export const messageItem = (clientMsgID: string) =>
  byTestId(`message-item-${clientMsgID}`);

export const messageActionTrigger = (clientMsgID: string) =>
  byTestId(`message-action-menu-trigger-${clientMsgID}`);

export const messageActionHost = (clientMsgID: string) =>
  byTestId(`message-action-host-${clientMsgID}`);
