import { CloseOutlined, PlusOutlined, PoweroffOutlined } from "@ant-design/icons";
import clsx from "clsx";

import { TerminalTab } from "@/store/type";

const statusClassName: Record<TerminalTab["status"], string> = {
  detached: "bg-[#858585]",
  starting: "bg-[#cca700]",
  running: "bg-[#89d185]",
  error: "bg-[#f14c4c]",
  stopped: "bg-[#858585]",
};

const TerminalTabs = ({
  tabs,
  activeTabID,
  onAdd,
  onSelect,
  onClose,
}: {
  tabs: TerminalTab[];
  activeTabID?: string;
  onAdd: () => void;
  onSelect: (tabID: string) => void;
  onClose: (tabID: string) => void;
}) => {
  return (
    <div className="terminal-dock-tabs">
      <button
        type="button"
        className="terminal-dock-icon-button h-8 w-8"
        onClick={onAdd}
        title="New Terminal"
        data-testid="terminal-new-tab"
      >
        <PlusOutlined rev={undefined} />
      </button>
      <div className="flex min-w-0 flex-1 overflow-x-auto">
        {tabs.map((tab) => {
          const active = tab.id === activeTabID;

          return (
            <button
              key={tab.id}
              type="button"
              className={clsx("terminal-dock-tab", active && "is-active")}
              onClick={() => onSelect(tab.id)}
              title={tab.cwd}
            >
              <span
                className={clsx(
                  "h-2 w-2 shrink-0 rounded-full",
                  statusClassName[tab.status],
                )}
              />
              <PoweroffOutlined className="text-[11px]" rev={undefined} />
              <span className="truncate">{tab.title}</span>
              <span
                className="terminal-dock-tab-close"
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(tab.id);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.stopPropagation();
                  onClose(tab.id);
                }}
              >
                <CloseOutlined rev={undefined} />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default TerminalTabs;
