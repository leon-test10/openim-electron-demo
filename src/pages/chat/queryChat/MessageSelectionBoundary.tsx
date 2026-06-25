import { Button } from "antd";
import { FC } from "react";

interface MessageSelectionBoundaryProps {
  anchored: boolean;
  onClick: () => void;
}

const MessageSelectionBoundary: FC<MessageSelectionBoundaryProps> = ({
  anchored,
  onClick,
}) => {
  return (
    <div className="relative px-5 py-2" data-testid="message-selection-boundary">
      <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-[#d0d5dd]" />
      <div className="relative z-[1] flex">
        <Button
          className="!rounded-full !border-[#d0d5dd] !bg-white !px-6 !text-[#1677ff] shadow-sm"
          onClick={onClick}
          data-testid="message-selection-boundary-toggle"
        >
          {anchored ? "Cancel select below messages" : "Select below messages"}
        </Button>
      </div>
    </div>
  );
};

export default MessageSelectionBoundary;
