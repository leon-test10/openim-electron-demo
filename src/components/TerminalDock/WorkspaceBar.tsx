import {
  CopyOutlined,
  ExportOutlined,
  FolderOpenOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { Button, Select, Tooltip } from "antd";

import { TerminalWorkspace } from "@/store/type";

const WorkspaceBar = ({
  workspaces,
  activeWorkspace,
  disabled,
  onCreateWorkspace,
  onChangeWorkspace,
  onOpenWorkspace,
  onCopyPath,
  onExportContext,
}: {
  workspaces: TerminalWorkspace[];
  activeWorkspace?: TerminalWorkspace;
  disabled: boolean;
  onCreateWorkspace: () => void;
  onChangeWorkspace: (workspaceID: string) => void;
  onOpenWorkspace: () => void;
  onCopyPath: () => void;
  onExportContext: () => void;
}) => {
  return (
    <div className="terminal-dock-workspace-bar">
      <Select
        size="small"
        className="min-w-0 flex-1"
        popupMatchSelectWidth={false}
        disabled={disabled || workspaces.length === 0}
        placeholder="Workspace"
        value={activeWorkspace?.id}
        options={workspaces.map((workspace) => ({
          value: workspace.id,
          label: workspace.title,
        }))}
        onChange={onChangeWorkspace}
      />
      <Tooltip title="New Workspace">
        <Button
          size="small"
          type="text"
          className="terminal-dock-icon-button"
          disabled={disabled}
          icon={<PlusOutlined rev={undefined} />}
          onClick={onCreateWorkspace}
        />
      </Tooltip>
      <Tooltip title="Open Workspace Folder">
        <Button
          size="small"
          type="text"
          className="terminal-dock-icon-button"
          disabled={disabled || !activeWorkspace}
          icon={<FolderOpenOutlined rev={undefined} />}
          onClick={onOpenWorkspace}
        />
      </Tooltip>
      <Tooltip title="Copy Workspace Path">
        <Button
          size="small"
          type="text"
          className="terminal-dock-icon-button"
          disabled={!activeWorkspace}
          icon={<CopyOutlined rev={undefined} />}
          onClick={onCopyPath}
        />
      </Tooltip>
      <Tooltip title="Export IM Context">
        <Button
          size="small"
          type="text"
          className="terminal-dock-icon-button"
          disabled={disabled || !activeWorkspace}
          icon={<ExportOutlined rev={undefined} />}
          onClick={onExportContext}
        />
      </Tooltip>
    </div>
  );
};

export default WorkspaceBar;
