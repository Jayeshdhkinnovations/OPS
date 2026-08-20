import { createSlice } from "@reduxjs/toolkit";
import { appInfo } from "../../constant/appinfo";

const infoSlice = createSlice({
  name: "info",
  initialState: {},
  reducers: {
    fetchAppInfo: () => {
      // Only seed baseUrl when nothing is stored yet - once login has
      // established the tenant-specific mount (.../app/<slug>/), this must
      // not overwrite it back to appInfo.baseUrl (the root server). This
      // reducer runs on every Login page mount (including the silent
      // redirect of an already-authenticated user), so an unconditional
      // write here clobbered the tenant baseUrl in localStorage on every
      // visit to "/" - the in-memory Parse.serverURL stayed correct for
      // that page load (so the immediate redirect still worked), but the
      // *next* reload re-initialized Parse.serverURL from the now-corrupted
      // root URL, producing "Invalid session token" (code 209) against a
      // server that never issued that tenant's session.
      if (!localStorage.getItem("baseUrl")) {
        localStorage.setItem("baseUrl", `${appInfo.baseUrl}/`);
      }
      localStorage.setItem("parseAppId", appInfo.appId);
      localStorage.setItem("appLogo", appInfo.applogo);
      localStorage.removeItem("userSettings");
      localStorage.setItem("userSettings", JSON.stringify(appInfo.settings));
      localStorage.setItem("fev_Icon", appInfo.fev_Icon);
      localStorage.setItem("favicon", appInfo.fev_Icon);
      return appInfo;
    }
  }
});
export const { fetchAppInfo } = infoSlice.actions;
export default infoSlice.reducer;
