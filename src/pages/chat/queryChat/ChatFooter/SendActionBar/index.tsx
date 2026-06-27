import { Popover, PopoverProps, Upload } from "antd";
import { TooltipPlacement } from "antd/es/tooltip";
import clsx from "clsx";
import i18n, { t } from "i18next";
import { UploadRequestOption } from "rc-upload/lib/interface";
import { memo, ReactNode, useCallback, useState } from "react";
import React from "react";

import fileIconSvg from "@/assets/images/chatFooter/file.png";
import image from "@/assets/images/chatFooter/image.png";
import rtc from "@/assets/images/chatFooter/rtc.png";
import { useConversationStore } from "@/store";
import emitter, { PendingChatAttachmentParams } from "@/utils/events";

import CallPopContent from "./CallPopContent";

const sendActionList = [
  {
    id: "image" as const,
    title: t("placeholder.image"),
    icon: image,
    accept: "image/*",
    kind: "image" as const,
    comp: null,
    placement: undefined as TooltipPlacement | undefined,
  },
  {
    id: "file" as const,
    title: "文件",
    icon: fileIconSvg,
    accept: "*",
    kind: "file" as const,
    comp: null,
    placement: undefined as TooltipPlacement | undefined,
  },
  {
    id: "rtc" as const,
    title: t("placeholder.call"),
    icon: rtc,
    accept: undefined,
    kind: undefined,
    comp: <CallPopContent />,
    placement: "top" as TooltipPlacement | undefined,
  },
];

i18n.on("languageChanged", () => {
  sendActionList[0].title = t("placeholder.image");
  sendActionList[2].title = t("placeholder.call");
});

const SendActionBar = () => {
  const [visibleState, setVisibleState] = useState(false);
  const isGroupSession = useConversationStore((state) =>
    Boolean(state.currentConversation?.groupID),
  );

  const closePop = () => setVisibleState(false);

  const onNativeFilePick = useCallback(async () => {
    if (!window.electronAPI) return;
    const files = await window.electronAPI.ipcInvoke<
      Array<{
        nativePath: string;
        fileName: string;
        fileSize: number;
        mimeType?: string;
      }>
    >("file:selectFiles");
    if (!files || files.length === 0) return;

    for (const f of files) {
      const attachment: PendingChatAttachmentParams = {
        source: "picker",
        fileName: f.fileName,
        nativePath: f.nativePath,
        fileType: f.mimeType ?? "",
        fileSize: f.fileSize,
        sendKind: "file",
      };
      emitter.emit("ADD_PENDING_CHAT_ATTACHMENT", attachment);
    }
  }, []);

  const fileHandle = (options: UploadRequestOption, kind: "image" | "file") => {
    const file = options.file as File & { path?: string };
    const attachment: PendingChatAttachmentParams = {
      source: "picker",
      fileName: file.name,
      nativePath: file.path,
      fileType: file.type,
      fileSize: file.size,
      sendKind: kind,
      file,
    };
    emitter.emit("ADD_PENDING_CHAT_ATTACHMENT", attachment);
  };

  return (
    <div className="flex items-center px-4.5 pt-2">
      {sendActionList.map((action) => {
        if (action.id === "rtc" && isGroupSession) {
          return null;
        }
        const popProps: PopoverProps = {
          placement: action.placement as TooltipPlacement,
          content:
            action.comp &&
            React.cloneElement(action.comp as React.ReactElement, {
              closePop,
            }),
          title: null,
          arrow: false,
          trigger: "click",
          // @ts-ignore
          open: action.comp ? visibleState : false,
          onOpenChange: (visible) => setVisibleState(visible),
        };

        // File icon: use Electron dialog when available, fall back to Upload
        if (action.id === "file" && window.electronAPI) {
          return (
            <div
              key={action.id}
              className="mr-5 flex cursor-pointer items-center"
              onClick={() => void onNativeFilePick()}
              title="选择文件"
            >
              <img src={action.icon} width={20} alt={action.title} />
            </div>
          );
        }

        return (
          <ActionWrap
            popProps={popProps}
            key={action.id}
            accept={action.accept}
            fileHandle={(opts) => fileHandle(opts, action.kind || "file")}
          >
            <div
              className={clsx("flex cursor-pointer items-center last:mr-0", {
                "mr-5": !action.accept,
              })}
            >
              <img src={action.icon} width={20} alt={action.title} />
            </div>
          </ActionWrap>
        );
      })}
    </div>
  );
};

export default memo(SendActionBar);

const ActionWrap = ({
  accept,
  popProps,
  children,
  fileHandle,
}: {
  accept?: string;
  children: ReactNode;
  popProps?: PopoverProps;
  fileHandle: (options: UploadRequestOption) => void;
}) => {
  return accept ? (
    <Upload
      showUploadList={false}
      customRequest={fileHandle}
      accept={accept}
      multiple
      className="mr-5 flex"
    >
      {children}
    </Upload>
  ) : (
    <Popover {...popProps}>{children}</Popover>
  );
};
