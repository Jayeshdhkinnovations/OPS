import React, { useEffect } from "react";
import Parse from "parse";
import { Outlet } from "react-router";
import { saveLanguageInLocal } from "../constant/language";
import { useTranslation } from "react-i18next";
const ValidateRoute = () => {
  const { i18n } = useTranslation();
  useEffect(() => {
    (async () => {
      const token = localStorage.getItem("accesstoken");
      if (token) {
        try {
          // Validates the token directly against the server instead of
          // relying on Parse.User.current() being hydrated/in-namespace
          await Parse.User.become(token);
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

    if (applogo !== null) localStorage.setItem("appLogo", applogo);
    if (defaultmenuid !== null) localStorage.setItem("defaultmenuid", defaultmenuid);
    if (PageLanding !== null) localStorage.setItem("PageLanding", PageLanding);
    if (appdata !== null) localStorage.setItem("userSettings", appdata);
    if (baseUrl !== null) localStorage.setItem("baseUrl", baseUrl);
    if (appid !== null) localStorage.setItem("parseAppId", appid);
    if (favicon !== null) localStorage.setItem("favicon", favicon);
  };
  return <>{<Outlet />}</>;
};

export default ValidateRoute;
