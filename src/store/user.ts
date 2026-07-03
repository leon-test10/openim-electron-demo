import { t } from "i18next";
import { create } from "zustand";

import { BusinessUserInfo, getBusinessUserInfo } from "@/api/login";
import { IMSDK } from "@/layout/MainContentWrap";
import router from "@/routes";
import { createOfflineSelfInfo } from "@/services/offlineIM";
import { feedbackToast } from "@/utils/common";
import {
  clearIMProfile,
  getAuthMode,
  getLocale,
  setLocale,
  setOfflineProfile,
} from "@/utils/storage";

import { useContactStore } from "./contact";
import { useConversationStore } from "./conversation";
import { AppSettings, IMConnectState, UserStore } from "./type";

export const useUserStore = create<UserStore>()((set, get) => ({
  authMode: getAuthMode(),
  syncState: "success",
  progress: 0,
  reinstall: true,
  isLogining: false,
  connectState: "success",
  selfInfo: {} as BusinessUserInfo,
  appSettings: {
    locale: getLocale(),
    closeAction: "miniSize",
  },
  updateSyncState: (syncState: IMConnectState) => {
    set({ syncState });
  },
  updateProgressState: (progress: number) => {
    set({ progress });
  },
  updateReinstallState: (reinstall: boolean) => {
    set({ reinstall });
  },
  updateIsLogining: (isLogining: boolean) => {
    set({ isLogining });
  },
  updateConnectState: (connectState: IMConnectState) => {
    set({ connectState });
  },
  updateAuthMode: (authMode) => {
    set({ authMode });
  },
  getSelfInfoByReq: () => {
    IMSDK.getSelfUserInfo()
      .then(({ data }) => {
        set(() => ({ selfInfo: data as unknown as BusinessUserInfo }));
        getBusinessUserInfo([data.userID]).then(({ data: { users } }) =>
          set((state) => ({ selfInfo: { ...state.selfInfo, ...users[0] } })),
        );
      })
      .catch((error) => {
        feedbackToast({ error, msg: t("toast.getSelfInfoFailed") });
        get().userLogout();
      });
  },
  updateSelfInfo: (info: Partial<BusinessUserInfo>) => {
    set((state) => ({ selfInfo: { ...state.selfInfo, ...info } }));
  },
  enterOfflineMode: async () => {
    await setOfflineProfile();
    set({
      authMode: "offline",
      selfInfo: createOfflineSelfInfo(),
      syncState: "success",
      connectState: "success",
      reinstall: false,
      progress: 0,
      isLogining: false,
    });
  },
  updateAppSettings: (settings: Partial<AppSettings>) => {
    if (settings.locale) {
      setLocale(settings.locale);
    }
    set((state) => ({ appSettings: { ...state.appSettings, ...settings } }));
  },
  userLogout: async (force?: boolean) => {
    if (!force && get().authMode !== "offline") await IMSDK.logout();
    clearIMProfile();
    set({ authMode: "im", selfInfo: {} as BusinessUserInfo, progress: 0 });
    useContactStore.getState().clearContactStore();
    useConversationStore.getState().clearConversationStore();
    router.navigate("/login");
  },
}));
