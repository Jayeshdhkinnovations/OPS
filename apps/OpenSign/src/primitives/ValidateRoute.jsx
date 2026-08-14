import React from "react";
import Parse from "parse";
import { Outlet } from "react-router";
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
  // Login.jsx (the page rendered under "/") already validates the stored
  // session itself and redirects to the dashboard - a second, independent
  // check here used to race against it: Parse.User.current()?.id isn't
  // populated until Login.jsx's own check finishes, so that query ran
  // against an undefined id, failed, and logged the user out from under a
  // perfectly valid session every time "/" was loaded directly.
  return <>{<Outlet />}</>;
};

export default ValidateRoute;
