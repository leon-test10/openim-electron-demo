import { CloseOutlined } from "@ant-design/icons";
import { GroupItem, WSEvent } from "@openim/wasm-client-sdk/lib/types/entity";
import { Button, Input, InputRef, Spin } from "antd";
import { t } from "i18next";
import {
  forwardRef,
  ForwardRefRenderFunction,
  memo,
  useEffect,
  useRef,
  useState,
} from "react";

import { message } from "@/AntdGlobalComp";
import { BusinessUserInfo, searchBusinessUserInfo } from "@/api/login";
import DraggableModalWrap from "@/components/DraggableModalWrap";
import OIMAvatar from "@/components/OIMAvatar";
import { OverlayVisibleHandle, useOverlayVisible } from "@/hooks/useOverlayVisible";
import { CardInfo } from "@/pages/common/UserCardModal";
import { useContactStore } from "@/store";
import { feedbackToast } from "@/utils/common";

import { IMSDK } from "../MainContentWrap";

interface ISearchUserOrGroupProps {
  isSearchGroup: boolean;
  openUserCardWithData: (data: CardInfo) => void;
  openGroupCardWithData: (data: GroupItem) => void;
}

interface SearchResultItem {
  user: BusinessUserInfo;
  isFriend: boolean;
}

const SearchUserOrGroup: ForwardRefRenderFunction<
  OverlayVisibleHandle,
  ISearchUserOrGroupProps
> = ({ isSearchGroup, openUserCardWithData, openGroupCardWithData }, ref) => {
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const inputRef = useRef<InputRef>(null);
  const { isOverlayOpen, closeOverlay } = useOverlayVisible(ref);

  useEffect(() => {
    if (isOverlayOpen) {
      setTimeout(() => inputRef.current?.focus());
    }
  }, [isOverlayOpen]);

  const resetSearch = () => {
    setSearchResults([]);
    setHasSearched(false);
  };

  const searchData = async () => {
    if (!keyword) return;
    setLoading(true);
    setHasSearched(true);

    if (isSearchGroup) {
      try {
        const { data } = await IMSDK.getSpecifiedGroupsInfo([keyword]);
        const groupInfo = data[0];
        setLoading(false);
        if (!groupInfo) {
          message.warning(t("empty.noSearchResults"));
          return;
        }
        openGroupCardWithData(groupInfo);
      } catch (error) {
        setLoading(false);
        if ((error as WSEvent).errCode === 1004) {
          message.warning(t("empty.noSearchResults"));
          return;
        }
        feedbackToast({ error });
      }
    } else {
      try {
        const {
          data: { total, users },
        } = await searchBusinessUserInfo(keyword);
        setLoading(false);

        if (!total || users.length === 0) {
          setSearchResults([]);
          message.warning(t("empty.noSearchResults"));
          return;
        }

        const friendList = useContactStore.getState().friendList;
        const friendUserIDs = new Set(friendList.map((f) => f.userID));

        const results: SearchResultItem[] = users.map((user) => ({
          user,
          isFriend: friendUserIDs.has(user.userID),
        }));

        setSearchResults(results);
      } catch (error) {
        setLoading(false);
        if ((error as WSEvent).errCode === 1004) {
          message.warning(t("empty.noSearchResults"));
          return;
        }
        feedbackToast({ error });
      }
    }
  };

  const onSelectUser = (item: SearchResultItem) => {
    if (item.isFriend) {
      // Already a friend, still open card to view info
      const friendInfo = useContactStore
        .getState()
        .friendList.find((f) => f.userID === item.user.userID);
      openUserCardWithData({
        ...(friendInfo ?? {}),
        ...item.user,
      });
      return;
    }
    openUserCardWithData({
      ...item.user,
    });
  };

  const highlightMatch = (text: string) => {
    if (!keyword || !text) return text;
    const idx = text.toLowerCase().indexOf(keyword.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <span className="text-[var(--primary)]">
          {text.slice(idx, idx + keyword.length)}
        </span>
        {text.slice(idx + keyword.length)}
      </>
    );
  };

  const renderResultItem = (item: SearchResultItem) => {
    const { user, isFriend } = item;
    const subInfo = user.phoneNumber || user.email || user.userID;

    return (
      <div
        key={user.userID}
        className="flex cursor-pointer items-center rounded-md px-3 py-2.5 hover:bg-[var(--primary-active)]"
        onClick={() => onSelectUser(item)}
      >
        <OIMAvatar size={40} src={user.faceURL} text={user.nickname} />
        <div className="ml-3 flex-1 overflow-hidden">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium" title={user.nickname}>
              {user.nickname ? highlightMatch(user.nickname) : user.userID}
            </span>
            {isFriend && (
              <span className="shrink-0 rounded bg-[var(--primary-active)] px-1.5 py-0.5 text-[10px] text-[var(--sub-text)]">
                {t("placeholder.alreadyFriend")}
              </span>
            )}
          </div>
          <div
            className="mt-0.5 truncate text-xs text-[var(--sub-text)]"
            title={subInfo}
          >
            {highlightMatch(subInfo)}
          </div>
        </div>
        {!isFriend && (
          <span className="ml-2 shrink-0 text-xs text-[var(--primary)]">
            {t("placeholder.add")}
          </span>
        )}
      </div>
    );
  };

  return (
    <DraggableModalWrap
      title={null}
      footer={null}
      open={isOverlayOpen}
      closable={false}
      width={380}
      onCancel={closeOverlay}
      styles={{
        mask: {
          opacity: 0,
          transition: "none",
        },
      }}
      afterClose={() => {
        setKeyword("");
        resetSearch();
      }}
      ignoreClasses=".ignore-drag, .cursor-pointer"
      className="no-padding-modal"
      maskTransitionName=""
    >
      <div className="flex h-12 items-center justify-between bg-[var(--gap-text)] px-5.5">
        <div>
          {isSearchGroup ? t("placeholder.addGroup") : t("placeholder.addFriends")}
        </div>
        <CloseOutlined
          className="cursor-pointer text-[var(--sub-text)]"
          rev={undefined}
          onClick={closeOverlay}
        />
      </div>
      <div className="ignore-drag">
        <div className="border-b border-[var(--gap-text)] px-5.5 py-4">
          <Input.Search
            ref={inputRef}
            className="no-addon-search"
            placeholder={t("placeholder.searchUserHint")}
            value={keyword}
            addonAfter={null}
            spellCheck={false}
            onChange={(e) => {
              setKeyword(e.target.value);
              if (hasSearched) resetSearch();
            }}
            onSearch={searchData}
          />
        </div>
        <div className="flex justify-end px-5.5 py-2.5">
          <Button
            loading={loading}
            className="px-6"
            type="primary"
            disabled={!keyword}
            onClick={searchData}
          >
            {t("confirm")}
          </Button>
          <Button
            className="ml-3 border-0 bg-[var(--chat-bubble)] px-6"
            onClick={closeOverlay}
          >
            {t("cancel")}
          </Button>
        </div>

        {/* Search Results */}
        {hasSearched && !loading && (
          <div className="border-t border-[var(--gap-text)]">
            {searchResults.length > 0 ? (
              <div className="px-2 py-1">
                <div className="mb-1 px-3 pt-2 text-xs text-[var(--sub-text)]">
                  {t("placeholder.searchResultsCount", {
                    count: searchResults.length,
                  })}
                </div>
                <div className="max-h-[320px] overflow-y-auto">
                  {searchResults.map(renderResultItem)}
                </div>
              </div>
            ) : (
              <div className="px-5.5 py-12 text-center text-sm text-[var(--sub-text)]">
                {t("empty.noSearchResults")}
              </div>
            )}
          </div>
        )}

        {loading && (
          <div className="flex justify-center py-10">
            <Spin />
          </div>
        )}
      </div>
    </DraggableModalWrap>
  );
};

export default memo(forwardRef(SearchUserOrGroup));
