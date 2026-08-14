import React, { useEffect } from "react";
import Parse from "parse";
import { Outlet } from "react-router";
import { saveLanguageInLocal } from "../constant/language";
import { useTranslation } from "react-i18next";
// A hard reload landing directly on a dashboard route (rather than through
// Login.jsx) must restore the company-specific server before anything below
// this guard gets a chance to run - React fires a nested route's own
// child-component effects (report/user data fetches, etc.) BEFORE this
// guard's own useEffect, so doing the restore there was always too late.
// Done here, at module scope during render, it happens before Outlet's
// children even mount.
if (typeof window !== "undefined" && localStorage.getItem("accesstoken")) {
  const storedBaseUrl = localStorage.getItem("baseUrl");
  if (storedBaseUrl) {
    Parse.serverURL = storedBaseUrl;
  }
}

const ValidateRoute = () => {
  const { i18n } = useTranslation();
  useEffect(() => {
    (async () => {
      if (localStorage.getItem("accesstoken")) {
        try {
          // Use the session token to validate the user
          const userQuery = new Parse.Query(Parse.User);
          const user = await userQuery.get(Parse?.User?.current()?.id, {
            sessionToken: localStorage.getItem("accesstoken")
          });
          if (!user) {
            handlelogout();
          }
        } catch (error) {
          console.log("err in validate route", error);
          handlelogout();
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const handlelogout = async () => {
    let appdata = localStorage.getItem("userSettings");
    let applogo = localStorage.getItem("appLogo");
    let defaultmenuid = localStorage.getItem("defaultmenuid");
    let PageLanding = localStorage.getItem("PageLanding");
    let baseUrl = localStorage.getItem("baseUrl");
    let appid = localStorage.getItem("parseAppId");
    let favicon = localStorage.getItem("favicon");

    localStorage.clear();
    saveLanguageInLocal(i18n);

    localStorage.setItem("appLogo", applogo);
    localStorage.setItem("defaultmenuid", defaultmenuid);
    localStorage.setItem("PageLanding", PageLanding);
    localStorage.setItem("userSettings", appdata);
    localStorage.setItem("baseUrl", baseUrl);
    localStorage.setItem("parseAppId", appid);
    localStorage.setItem("favicon", favicon);
  };
  return <>{<Outlet />}</>;
};

export default ValidateRoute;
