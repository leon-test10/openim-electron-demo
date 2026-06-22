import { Modal, ModalProps } from "antd";
import { ComponentType, FC, memo, ReactNode, useRef, useState } from "react";
import type { DraggableData, DraggableEvent, DraggableProps } from "react-draggable";
import Draggable from "react-draggable";

interface IDraggableModalWrapProps extends ModalProps {
  ignoreClasses?: string;
}

const DraggableComponent = Draggable as unknown as ComponentType<
  Partial<DraggableProps> & { children: ReactNode }
>;

const DraggableModalWrap: FC<IDraggableModalWrapProps> = (props) => {
  const [bounds, setBounds] = useState({ left: 0, top: 0, bottom: 0, right: 0 });
  const draggleRef = useRef<HTMLDivElement>(null);

  const onStart = (_event: DraggableEvent, uiData: DraggableData) => {
    const { clientWidth, clientHeight } = window.document.documentElement;
    const targetRect = draggleRef.current?.getBoundingClientRect();
    if (!targetRect) {
      return;
    }
    setBounds({
      left: -targetRect.left + uiData.x,
      right: clientWidth - (targetRect.right - uiData.x),
      top: -targetRect.top + uiData.y,
      bottom: clientHeight - (targetRect.bottom - uiData.y),
    });
  };

  return (
    <Modal
      {...props}
      modalRender={(modal) => (
        <DraggableComponent
          allowAnyClick
          cancel={props.ignoreClasses ?? ""}
          bounds={bounds}
          onStart={(event, uiData) => onStart(event, uiData)}
        >
          <div ref={draggleRef}>{modal}</div>
        </DraggableComponent>
      )}
    >
      {props.children}
    </Modal>
  );
};

export default memo(DraggableModalWrap);
