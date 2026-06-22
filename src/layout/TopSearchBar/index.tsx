import { ApiOutlined, SearchOutlined } from "@ant-design/icons";
import { CbEvents, MessageType } from "@openim/wasm-client-sdk";
import {
  GroupItem,
  MessageItem,
  RtcInvite,
  WSEvent,
} from "@openim/wasm-client-sdk/lib/types/entity";
import { Button, Input, InputRef, Popover, Spin, Tooltip } from "antd";
import i18n, { t } from "i18next";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { getBusinessUserInfo, searchBusinessUserInfo } from "@/api/login";
import add_friend from "@/assets/images/topSearchBar/add_friend.png";
import add_group from "@/assets/images/topSearchBar/add_group.png";
import create_group from "@/assets/images/topSearchBar/create_group.png";
import show_more from "@/assets/images/topSearchBar/show_more.png";
import OIMAvatar from "@/components/OIMAvatar";
import WindowControlBar from "@/components/WindowControlBar";
import { CustomType } from "@/constants";
import { OverlayVisibleHandle } from "@/hooks/useOverlayVisible";
import ChooseModal, { ChooseModalState } from "@/pages/common/ChooseModal";
import GroupCardModal from "@/pages/common/GroupCardModal";
import RtcCallModal from "@/pages/common/RtcCallModal";
import { InviteData } from "@/pages/common/RtcCallModal/data";
import UserCardModal, { CardInfo } from "@/pages/common/UserCardModal";
import {
  useContactStore,
  useConversationStore,
  useTerminalDockStore,
  useUserStore,
} from "@/store";
import emitter, { OpenUserCardParams } from "@/utils/events";
import { formatMessageByType } from "@/utils/imCommon";

import { IMSDK } from "../MainContentWrap";
import SearchUserOrGroup from "./SearchUserOrGroup";

type UserCardState = OpenUserCardParams & {
  cardInfo?: CardInfo;
};

// ───── Unified contact result (local friend OR business API) ─────
interface ContactResult {
  userID: string;
  nickname: string;
  faceURL: string;
  remark?: string;
  phoneNumber?: string;
  email?: string;
  isFriend: boolean;
}

// ───── Message match result ─────
interface MsgMatchResult {
  conversationID: string;
  conversationType: number;
  showName: string;
  faceURL: string;
  messageCount: number;
  messageList: MessageItem[];
}

interface SearchItem {
  kind: "contact" | "group" | "message";
  data: ContactResult | GroupItem | MsgMatchResult;
}

const CONV_BATCH_SIZE = 20;
const MAX_MSG_RESULTS = 50;
const SEARCH_DEBOUNCE_MS = 300;

const TopSearchBar = () => {
  const userCardRef = useRef<OverlayVisibleHandle>(null);
  const groupCardRef = useRef<OverlayVisibleHandle>(null);
  const chooseModalRef = useRef<OverlayVisibleHandle>(null);
  const searchModalRef = useRef<OverlayVisibleHandle>(null);
  const rtcRef = useRef<OverlayVisibleHandle>(null);
  const searchInputRef = useRef<InputRef>(null);
  const searchPanelRef = useRef<HTMLDivElement>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>();
  const [chooseModalState, setChooseModalState] = useState<ChooseModalState>({
    type: "CRATE_GROUP",
  });
  const [userCardState, setUserCardState] = useState<UserCardState>();
  const [groupCardData, setGroupCardData] = useState<
    GroupItem & { inGroup?: boolean }
  >();
  const [actionVisible, setActionVisible] = useState(false);
  const [isSearchGroup, setIsSearchGroup] = useState(false);
  const [inviteData, setInviteData] = useState<InviteData>({} as InviteData);

  // ───── Global search state ─────
  const [searchKeyword, setSearchKeyword] = useState("");
  const [searchResults, setSearchResults] = useState<SearchItem[]>([]);
  const [showSearchPanel, setShowSearchPanel] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchedConvCount, setSearchedConvCount] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();
  const toggleTerminalDock = useTerminalDockStore((state) => state.togglePanel);
  const terminalDockOpen = useTerminalDockStore((state) => state.panelOpen);
  const isChatRoute = location.pathname.startsWith("/chat");

  // ───── Event listeners ─────
  useEffect(() => {
    const userCardHandler = (params: OpenUserCardParams) => {
      setUserCardState({ ...params });
      userCardRef.current?.openOverlay();
    };
    const chooseModalHandler = (params: ChooseModalState) => {
      setChooseModalState({ ...params });
      chooseModalRef.current?.openOverlay();
    };
    const callRtcHandler = (inviteData: InviteData) => {
      if (rtcRef.current?.isOverlayOpen) return;
      setInviteData(inviteData);
      rtcRef.current?.openOverlay();
    };
    const newMessageHandler = ({ data }: WSEvent<MessageItem[]>) => {
      if (rtcRef.current?.isOverlayOpen) return;
      let rtcInvite: RtcInvite | undefined;
      data.forEach((message) => {
        if (message.contentType === MessageType.CustomMessage) {
          const customData = JSON.parse(message.customElem!.data);
          if (customData.customType === CustomType.CallingInvite) {
            rtcInvite = customData.data;
          }
        }
      });
      if (rtcInvite) {
        getBusinessUserInfo([rtcInvite.inviterUserID]).then(({ data: { users } }) => {
          if (users.length === 0) return;
          setInviteData({
            invitation: rtcInvite!,
            participant: {
              userInfo: {
                nickname: users[0].nickname,
                faceURL: users[0].faceURL,
                userID: users[0].userID,
                ex: "",
              },
            },
          });
          rtcRef.current?.openOverlay();
        });
      }
    };

    emitter.on("OPEN_USER_CARD", userCardHandler);
    emitter.on("OPEN_GROUP_CARD", openGroupCardWithData);
    emitter.on("OPEN_CHOOSE_MODAL", chooseModalHandler);
    emitter.on("OPEN_RTC_MODAL", callRtcHandler);
    IMSDK.on(CbEvents.OnRecvNewMessages, newMessageHandler);
    return () => {
      emitter.off("OPEN_USER_CARD", userCardHandler);
      emitter.off("OPEN_GROUP_CARD", openGroupCardWithData);
      emitter.off("OPEN_CHOOSE_MODAL", chooseModalHandler);
      emitter.off("OPEN_RTC_MODAL", callRtcHandler);
      IMSDK.off(CbEvents.OnRecvNewMessages, newMessageHandler);
    };
  }, []);

  // Close search panel on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        searchPanelRef.current &&
        !searchPanelRef.current.contains(e.target as Node) &&
        searchInputRef.current?.input &&
        !searchInputRef.current.input.contains(e.target as Node)
      ) {
        setShowSearchPanel(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // ───── Debounced auto-search ─────
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);

    if (!searchKeyword.trim()) {
      setSearchResults([]);
      setShowSearchPanel(false);
      setSearchedConvCount(0);
      return;
    }

    debounceTimer.current = setTimeout(() => {
      startSearch(searchKeyword.trim());
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [searchKeyword]);

  // ───── Search logic ─────
  const startSearch = async (keyword: string, isLoadMore = false) => {
    if (!keyword) return;

    if (isLoadMore) {
      setLoadingMore(true);
    } else {
      setSearchLoading(true);
      setShowSearchPanel(true);
      setSearchedConvCount(0);
    }

    const prevResults = isLoadMore ? searchResults : [];
    const results: SearchItem[] = [...prevResults];
    const friendUserIDs = new Set(
      useContactStore.getState().friendList.map((f) => f.userID),
    );

    // ── 1. Local friends (fast, from SQLite) ──
    if (!isLoadMore) {
      try {
        const friendRes = await IMSDK.searchFriends({
          keywordList: [keyword],
          isSearchUserID: true,
          isSearchNickname: true,
          isSearchRemark: true,
        });
        console.log(
          "[search] local friends:",
          friendRes.data?.length ?? 0,
          "results",
          friendRes.data?.map((f) => f.nickname),
        );
        if (friendRes.data?.length) {
          friendRes.data.forEach((f) => {
            results.push({
              kind: "contact",
              data: {
                userID: f.userID,
                nickname: f.nickname || f.userID,
                faceURL: f.faceURL || "",
                remark: f.remark,
                isFriend: true,
              },
            });
          });
        }
      } catch (err) {
        console.error("[search] searchFriends failed:", err);
      }
    }

    // ── 2. Business API search (nickname / phone / email on server) ──
    if (!isLoadMore) {
      try {
        const bizRes = await searchBusinessUserInfo(keyword, 10);
        const bizUsers = bizRes.data?.users ?? [];
        console.log(
          "[search] business API:",
          bizUsers.length,
          "results",
          bizUsers.map((u) => u.nickname),
        );

        // Deduplicate & merge with local friend info
        const existingIDs = new Set(
          results
            .filter((r) => r.kind === "contact")
            .map((r) => (r.data as ContactResult).userID),
        );

        bizUsers.forEach((u) => {
          if (existingIDs.has(u.userID)) return;
          existingIDs.add(u.userID);
          results.push({
            kind: "contact",
            data: {
              userID: u.userID,
              nickname: u.nickname || u.userID,
              faceURL: u.faceURL || "",
              phoneNumber: u.phoneNumber,
              email: u.email,
              isFriend: friendUserIDs.has(u.userID),
            },
          });
        });
      } catch (err) {
        console.error("[search] searchBusinessUserInfo failed:", err);
      }
    }

    // ── 3. Groups (local) ──
    if (!isLoadMore) {
      try {
        const groupRes = await IMSDK.searchGroups({
          keywordList: [keyword],
          isSearchGroupID: true,
          isSearchGroupName: true,
        });
        console.log("[search] groups:", groupRes.data?.length ?? 0, "results");
        if (groupRes.data?.length) {
          groupRes.data.forEach((g) => results.push({ kind: "group", data: g }));
        }
      } catch (err) {
        console.error("[search] searchGroups failed:", err);
      }
    }

    // ── 4. Messages — fetch recent messages from each conversation & filter ──
    const convList = useConversationStore.getState().conversationList;
    const totalConvs = convList.length;
    const startIdx = isLoadMore ? searchedConvCount : 0;
    const endIdx = Math.min(startIdx + CONV_BATCH_SIZE, totalConvs);
    const batch = convList.slice(startIdx, endIdx);

    const kwLower = keyword.toLowerCase();

    console.log(
      `[search] message search in conversations ${startIdx}-${endIdx}/${totalConvs}`,
    );

    for (const conv of batch) {
      if (results.filter((r) => r.kind === "message").length >= MAX_MSG_RESULTS) break;

      try {
        const { data: historyData } = await IMSDK.getAdvancedHistoryMessageList({
          conversationID: conv.conversationID,
          count: 50,
          startClientMsgID: "",
          viewType: 0, // ViewType.History
        });

        const matches: MessageItem[] = [];
        for (const msg of historyData.messageList) {
          if (
            msg.contentType === MessageType.TextMessage &&
            msg.textElem?.content?.toLowerCase().includes(kwLower)
          ) {
            matches.push(msg);
            if (matches.length >= 5) break;
          }
        }

        if (matches.length > 0) {
          console.log(`[search]   ${conv.showName}: ${matches.length} msgs matched`);
          results.push({
            kind: "message",
            data: {
              conversationID: conv.conversationID,
              conversationType: conv.conversationType,
              showName: conv.showName,
              faceURL: conv.faceURL,
              messageCount: matches.length,
              messageList: matches,
            } as MsgMatchResult,
          });
        }
      } catch (err) {
        console.error(`[search] getHistory error (${conv.showName}):`, err);
      }
    }

    console.log(
      `[search] DONE — contacts: ${
        results.filter((r) => r.kind === "contact").length
      }, groups: ${results.filter((r) => r.kind === "group").length}, messages: ${
        results.filter((r) => r.kind === "message").length
      }`,
    );

    setSearchResults(results);
    setSearchedConvCount(endIdx);
    setSearchLoading(false);
    setLoadingMore(false);
  };

  const onLoadMoreMessages = () => {
    startSearch(searchKeyword.trim(), true);
  };

  // ───── Click handlers ─────
  const onSearchResultClick = (item: SearchItem) => {
    setShowSearchPanel(false);

    if (item.kind === "contact") {
      const c = item.data as ContactResult;
      setUserCardState({
        userID: c.userID,
        isSelf: c.userID === useUserStore.getState().selfInfo.userID,
        cardInfo: {
          userID: c.userID,
          nickname: c.nickname,
          faceURL: c.faceURL,
          phoneNumber: c.phoneNumber,
          email: c.email,
          remark: c.remark,
        },
      });
      userCardRef.current?.openOverlay();
    } else if (item.kind === "group") {
      const group = item.data as GroupItem;
      const inGroup = useContactStore
        .getState()
        .groupList.some((g) => g.groupID === group.groupID);
      setGroupCardData({ ...group, inGroup });
      groupCardRef.current?.openOverlay();
    } else if (item.kind === "message") {
      const msgResult = item.data as MsgMatchResult;
      const conv = useConversationStore
        .getState()
        .conversationList.find((c) => c.conversationID === msgResult.conversationID);
      if (conv) {
        useConversationStore.getState().updateCurrentConversation(conv);
        navigate(`/chat/${conv.conversationID}`);
      }
    }
  };

  const actionClick = (idx: number) => {
    switch (idx) {
      case 0:
      case 1:
        setIsSearchGroup(Boolean(idx));
        searchModalRef.current?.openOverlay();
        break;
      case 2:
        setChooseModalState({ type: "CRATE_GROUP" });
        chooseModalRef.current?.openOverlay();
        break;
      default:
        break;
    }
    setActionVisible(false);
  };

  const openUserCardWithData = useCallback((cardInfo: CardInfo) => {
    searchModalRef.current?.closeOverlay();
    setUserCardState({
      userID: cardInfo.userID,
      cardInfo,
      isSelf: cardInfo.userID === useUserStore.getState().selfInfo.userID,
    });
    userCardRef.current?.openOverlay();
  }, []);

  const openGroupCardWithData = useCallback((group: GroupItem) => {
    searchModalRef.current?.closeOverlay();
    const inGroup = useContactStore
      .getState()
      .groupList.some((g) => g.groupID === group.groupID);
    setGroupCardData({ ...group, inGroup });
    groupCardRef.current?.openOverlay();
  }, []);

  // ───── UI helpers ─────
  const highlightText = (text: string | undefined) => {
    if (!text || !searchKeyword) return text || "";
    const str = String(text);
    const idx = str.toLowerCase().indexOf(searchKeyword.toLowerCase());
    if (idx === -1) return str;
    return (
      <>
        {str.slice(0, idx)}
        <span className="text-[var(--primary)]">
          {str.slice(idx, idx + searchKeyword.length)}
        </span>
        {str.slice(idx + searchKeyword.length)}
      </>
    );
  };

  const renderContactRow = (item: SearchItem) => {
    const c = item.data as ContactResult;
    const subLines: string[] = [];
    if (c.phoneNumber) subLines.push(c.phoneNumber);
    if (c.email) subLines.push(c.email);
    if (!subLines.length) subLines.push(c.userID);

    return (
      <div
        key={`c-${c.userID}`}
        className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 hover:bg-[var(--primary-active)]"
        onClick={() => onSearchResultClick(item)}
      >
        <OIMAvatar size={36} src={c.faceURL} text={c.nickname} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm">{highlightText(c.nickname)}</span>
            {c.isFriend && (
              <span className="shrink-0 rounded bg-[var(--primary-active)] px-1.5 py-0.5 text-[10px] text-[var(--sub-text)]">
                {t("placeholder.alreadyFriend")}
              </span>
            )}
          </div>
          <div className="truncate text-xs text-[var(--sub-text)]">
            {highlightText(subLines.join(" · "))}
          </div>
        </div>
        <span className="shrink-0 text-[10px] text-[var(--sub-text)]">
          {t("placeholder.contacts")}
        </span>
      </div>
    );
  };

  const renderGroupRow = (item: SearchItem) => {
    const group = item.data as GroupItem;
    return (
      <div
        key={`g-${group.groupID}`}
        className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 hover:bg-[var(--primary-active)]"
        onClick={() => onSearchResultClick(item)}
      >
        <OIMAvatar size={36} src={group.faceURL} text={group.groupName} isgroup />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm">{highlightText(group.groupName)}</div>
          <div className="truncate text-xs text-[var(--sub-text)]">
            {highlightText(group.groupID)}
            {group.memberCount !== undefined
              ? ` · ${group.memberCount} ${t("placeholder.member")}`
              : ""}
          </div>
        </div>
        <span className="shrink-0 text-[10px] text-[var(--sub-text)]">
          {t("placeholder.group")}
        </span>
      </div>
    );
  };

  const renderMessageRow = (item: SearchItem) => {
    const m = item.data as MsgMatchResult;
    const firstMsg = m.messageList?.[0];
    const preview = firstMsg ? formatMessageByType(firstMsg) : "";
    return (
      <div
        key={`m-${m.conversationID}`}
        className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 hover:bg-[var(--primary-active)]"
        onClick={() => onSearchResultClick(item)}
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--primary-active)]">
          <SearchOutlined className="text-[var(--sub-text)]" rev={undefined} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm">{highlightText(m.showName)}</div>
          <div className="truncate text-xs text-[var(--sub-text)]">
            {highlightText(preview)}
          </div>
        </div>
        <span className="shrink-0 text-[10px] text-[var(--sub-text)]">
          {m.messageCount} {t("pieces")}
        </span>
      </div>
    );
  };

  // ───── Grouping ─────
  const contacts = searchResults.filter((r) => r.kind === "contact");
  const groups = searchResults.filter((r) => r.kind === "group");
  const messages = searchResults.filter((r) => r.kind === "message");

  const totalConvs = useConversationStore((s) => s.conversationList).length;
  const canLoadMore = searchedConvCount > 0 && searchedConvCount < totalConvs;

  return (
    <div className="no-mobile app-drag relative flex h-10 min-h-[40px] items-center bg-[var(--top-search-bar)] dark:bg-[#141414]">
      <div className="flex w-full items-center justify-center">
        <div
          className="app-no-drag relative flex h-[26px] w-1/3 items-center"
          ref={searchPanelRef}
        >
          <Input
            ref={searchInputRef}
            size="small"
            className="h-full w-full rounded-md border-0 bg-[rgba(255,255,255,0.2)] text-white placeholder:text-[rgba(255,255,255,0.5)]"
            placeholder={t("placeholder.globalSearch")}
            prefix={
              <SearchOutlined
                className="text-[rgba(255,255,255,0.5)]"
                rev={undefined}
              />
            }
            value={searchKeyword}
            spellCheck={false}
            onChange={(e) => setSearchKeyword(e.target.value)}
            onPressEnter={() => startSearch(searchKeyword.trim())}
            onFocus={() => {
              if (searchKeyword.trim() && searchResults.length > 0) {
                setShowSearchPanel(true);
              }
            }}
            allowClear={{
              clearIcon: <span className="text-[rgba(255,255,255,0.5)]">✕</span>,
            }}
          />

          {showSearchPanel && (
            <div className="absolute left-0 top-full z-50 mt-1 w-[420px] overflow-hidden rounded-lg border border-[var(--gap-text)] bg-white shadow-lg dark:bg-[#1f1f1f]">
              {searchLoading ? (
                <div className="flex justify-center py-10">
                  <Spin />
                </div>
              ) : !searchKeyword.trim() ? null : searchResults.length === 0 ? (
                <div className="py-12 text-center text-sm text-[var(--sub-text)]">
                  {t("empty.noSearchResults")}
                </div>
              ) : (
                <div className="max-h-[440px] overflow-y-auto">
                  {contacts.length > 0 && (
                    <div>
                      <div className="sticky top-0 z-10 bg-[var(--gap-text)] px-4 py-1.5 text-xs font-medium text-[var(--sub-text)]">
                        {t("placeholder.contacts")}
                        <span className="ml-1 opacity-60">({contacts.length})</span>
                      </div>
                      {contacts.map((r) => renderContactRow(r))}
                    </div>
                  )}
                  {groups.length > 0 && (
                    <div>
                      <div className="sticky top-0 z-10 bg-[var(--gap-text)] px-4 py-1.5 text-xs font-medium text-[var(--sub-text)]">
                        {t("placeholder.group")}
                        <span className="ml-1 opacity-60">({groups.length})</span>
                      </div>
                      {groups.map((r) => renderGroupRow(r))}
                    </div>
                  )}
                  {messages.length > 0 && (
                    <div>
                      <div className="sticky top-0 z-10 bg-[var(--gap-text)] px-4 py-1.5 text-xs font-medium text-[var(--sub-text)]">
                        {t("placeholder.message")}
                        <span className="ml-1 opacity-60">({messages.length})</span>
                      </div>
                      {messages.map((r) => renderMessageRow(r))}
                    </div>
                  )}
                  {canLoadMore && (
                    <div className="border-t border-[var(--gap-text)] px-4 py-2">
                      <Button
                        type="link"
                        size="small"
                        loading={loadingMore}
                        className="w-full text-xs text-[var(--sub-text)]"
                        onClick={onLoadMoreMessages}
                      >
                        {t("placeholder.searchMoreMessages", {
                          remaining: totalConvs - searchedConvCount,
                        })}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {isChatRoute && (
          <Tooltip title="Terminal">
            <Button
              type="text"
              size="small"
              className="app-no-drag ml-3 flex h-7 w-7 items-center justify-center text-white hover:text-white"
              icon={<ApiOutlined rev={undefined} />}
              aria-pressed={terminalDockOpen}
              onClick={toggleTerminalDock}
            />
          </Tooltip>
        )}

        <Popover
          content={<ActionPopContent actionClick={actionClick} />}
          arrow={false}
          title={null}
          trigger="click"
          placement="bottom"
          open={actionVisible}
          onOpenChange={(vis) => setActionVisible(vis)}
        >
          <img
            className="app-no-drag ml-8 cursor-pointer"
            width={20}
            src={show_more}
            alt=""
          />
        </Popover>
      </div>
      <WindowControlBar />
      <UserCardModal ref={userCardRef} {...userCardState} />
      <GroupCardModal ref={groupCardRef} groupData={groupCardData} />
      <ChooseModal ref={chooseModalRef} state={chooseModalState} />
      <SearchUserOrGroup
        ref={searchModalRef}
        isSearchGroup={isSearchGroup}
        openUserCardWithData={openUserCardWithData}
        openGroupCardWithData={openGroupCardWithData}
      />
      <RtcCallModal ref={rtcRef} inviteData={inviteData} />
    </div>
  );
};

export default TopSearchBar;

// ───── Action menu ─────
const actionMenuList = [
  { idx: 0, title: t("placeholder.addFriends"), icon: add_friend },
  { idx: 1, title: t("placeholder.addGroup"), icon: add_group },
  { idx: 2, title: t("placeholder.createGroup"), icon: create_group },
];

i18n.on("languageChanged", () => {
  actionMenuList[0].title = t("placeholder.addFriends");
  actionMenuList[1].title = t("placeholder.addGroup");
  actionMenuList[2].title = t("placeholder.createGroup");
});

const ActionPopContent = ({ actionClick }: { actionClick: (idx: number) => void }) => (
  <div className="p-1">
    {actionMenuList.map((action) => (
      <div
        className="flex cursor-pointer items-center rounded px-3 py-2 text-xs hover:bg-[var(--primary-active)]"
        key={action.idx}
        onClick={() => actionClick?.(action.idx)}
      >
        <img width={20} src={action.icon} alt="" />
        <div className="ml-3">{action.title}</div>
      </div>
    ))}
  </div>
);
