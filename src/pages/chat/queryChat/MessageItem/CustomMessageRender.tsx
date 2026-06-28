import { FC } from "react";

import { parseFolderShareMessage } from "@/utils/folderShare";

import { IMessageItemProps } from ".";
import CatchMessageRender from "./CatchMsgRenderer";
import FolderMessageRender from "./FolderMessageRender";

const CustomMessageRender: FC<IMessageItemProps> = (props) => {
  if (parseFolderShareMessage(props.message)) {
    return <FolderMessageRender {...props} />;
  }

  return <CatchMessageRender {...props} />;
};

export default CustomMessageRender;
