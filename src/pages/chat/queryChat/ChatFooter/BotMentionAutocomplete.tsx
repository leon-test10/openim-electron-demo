import clsx from "clsx";
import { memo, useCallback, useEffect, useRef } from "react";

import { BotTargetCandidate } from "@/services/botTrigger";

import styles from "./botMention.module.scss";

interface BotMentionAutocompleteProps {
  candidates: BotTargetCandidate[];
  query: string;
  visible: boolean;
  onSelect: (candidate: BotTargetCandidate) => void;
  onClose: () => void;
}

const BotMentionAutocomplete = ({
  candidates,
  query,
  visible,
  onSelect,
  onClose,
}: BotMentionAutocompleteProps) => {
  const listRef = useRef<HTMLUListElement>(null);
  const highlightRef = useRef<number>(0);

  const filtered = candidates
    .filter((candidate) => {
      if (!query) return true;
      const lower = query.toLocaleLowerCase();
      return (
        candidate.nickname?.toLocaleLowerCase().includes(lower) ||
        candidate.userID.toLocaleLowerCase().includes(lower)
      );
    })
    .slice(0, 8);

  // Reset highlight when candidates change
  useEffect(() => {
    highlightRef.current = 0;
  }, [query, filtered.length]);

  const selectIndex = useCallback(
    (index: number) => {
      const candidate = filtered[index];
      if (candidate) {
        onSelect(candidate);
      }
    },
    [filtered, onSelect],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!visible) return;

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          highlightRef.current = Math.min(
            highlightRef.current + 1,
            filtered.length - 1,
          );
          listRef.current
            ?.querySelector(`[data-index="${highlightRef.current}"]`)
            ?.scrollIntoView({ block: "nearest" });
          break;

        case "ArrowUp":
          event.preventDefault();
          highlightRef.current = Math.max(highlightRef.current - 1, 0);
          listRef.current
            ?.querySelector(`[data-index="${highlightRef.current}"]`)
            ?.scrollIntoView({ block: "nearest" });
          break;

        case "Enter":
        case "Tab":
          event.preventDefault();
          selectIndex(highlightRef.current);
          break;

        case "Escape":
          event.preventDefault();
          onClose();
          break;
      }
    },
    [visible, filtered.length, selectIndex, onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [handleKeyDown]);

  if (!visible || filtered.length === 0) return null;

  return (
    <div className={styles.popover} data-testid="bot-mention-autocomplete">
      <ul ref={listRef} className={styles.list}>
        {filtered.map((candidate, index) => (
          <li
            key={candidate.userID}
            data-index={index}
            className={clsx(styles.item, {
              [styles.highlighted]: index === highlightRef.current,
            })}
            onMouseEnter={() => {
              highlightRef.current = index;
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              selectIndex(index);
            }}
          >
            <span className={styles.nickname}>
              {candidate.nickname || candidate.userID}
            </span>
            {candidate.nickname && (
              <span className={styles.userID}>@{candidate.userID}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default memo(BotMentionAutocomplete);
