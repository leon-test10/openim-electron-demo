import { FC } from "react";
import { useTranslation } from "react-i18next";

import { IMessageItemProps } from ".";
import styles from "./message-item.module.scss";

const CatchMessageRender: FC<Partial<IMessageItemProps>> = () => {
  const { t } = useTranslation();

  return <div className={styles.bubble}>{t("messageDescription.catchMessage")}</div>;
};

export default CatchMessageRender;
