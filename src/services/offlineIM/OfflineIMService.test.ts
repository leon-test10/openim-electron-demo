/* eslint-disable @typescript-eslint/no-var-requires */
const assert = require("node:assert/strict");

const {
  OFFLINE_SELF_USER_ID,
  OfflineIMService,
  createMemoryOfflineIMStorage,
} = require("./OfflineIMService");

(async () => {
  let now = 1_800_000_000_000;
  const service = new OfflineIMService({
    storage: createMemoryOfflineIMStorage(),
    now: () => now,
  });

  await service.reset();

  const { friend, conversation } = await service.createVirtualFriend({
    nickname: "Local Agent",
    remark: "offline helper",
  });

  assert.equal(friend.nickname, "Local Agent");
  assert.equal(friend.remark, "offline helper");
  assert.equal(conversation.userID, friend.userID);
  assert.equal(
    conversation.conversationID,
    `offline_si_${OFFLINE_SELF_USER_ID}_${friend.userID}`,
  );

  const friendships = await service.listFriendships();
  assert.deepEqual(
    friendships.map((item: { ownerUserID: string; friendUserID: string }) => [
      item.ownerUserID,
      item.friendUserID,
    ]),
    [
      [OFFLINE_SELF_USER_ID, friend.userID],
      [friend.userID, OFFLINE_SELF_USER_ID],
    ],
  );

  const conversations = await service.listConversations();
  assert.equal(conversations.length, 1);
  assert.equal(conversations[0].showName, "Local Agent");

  now += 1000;
  const selfMessage = await service.createTextMessage({
    conversationID: conversation.conversationID,
    sender: "self",
    content: "hello offline",
  });

  now += 1000;
  const peerMessage = await service.createTextMessage({
    conversationID: conversation.conversationID,
    sender: "peer",
    content: "agent answer",
  });

  assert.equal(selfMessage.sendID, OFFLINE_SELF_USER_ID);
  assert.equal(selfMessage.recvID, friend.userID);
  assert.equal(peerMessage.sendID, friend.userID);
  assert.equal(peerMessage.recvID, OFFLINE_SELF_USER_ID);

  const messages = await service.listMessages({
    conversationID: conversation.conversationID,
    count: 20,
  });
  assert.deepEqual(
    messages.messageList.map(
      (item: { textElem?: { content?: string } }) => item.textElem?.content,
    ),
    ["hello offline", "agent answer"],
  );
  assert.equal(messages.isEnd, true);

  const foundMessages = await service.getMessagesByClientMsgIDs(
    conversation.conversationID,
    [peerMessage.clientMsgID],
  );
  assert.deepEqual(
    foundMessages.map((item: { clientMsgID: string }) => item.clientMsgID),
    [peerMessage.clientMsgID],
  );

  const updatedConversations = await service.listConversations();
  const latestMessage = JSON.parse(String(updatedConversations[0].latestMsg)) as {
    textElem?: { content?: string };
  };
  assert.equal(latestMessage.textElem?.content, "agent answer");
  assert.equal(updatedConversations[0].latestMsgSendTime, peerMessage.sendTime);

  now += 1000;
  const fileMessage = await service.createMessage({
    conversationID: conversation.conversationID,
    sender: "self",
    message: {
      contentType: 101,
      fileElem: {
        filePath: "C:\\workspace\\result.txt",
        fileName: "result.txt",
        fileSize: 12,
        sourceUrl: "",
      },
    },
  });
  assert.equal(fileMessage.sendID, OFFLINE_SELF_USER_ID);
  assert.equal(fileMessage.fileElem?.fileName, "result.txt");
  const messagesWithFile = await service.listMessages({
    conversationID: conversation.conversationID,
    count: 20,
  });
  assert.equal(
    messagesWithFile.messageList[messagesWithFile.messageList.length - 1]?.clientMsgID,
    fileMessage.clientMsgID,
  );

  console.log("OfflineIMService tests passed");
})();

export {};
