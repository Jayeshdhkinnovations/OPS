import { Outlet } from "react-router";

// This used to also call Parse.User.become(accesstoken) here on every mount
// of "/", "/login", "/register", "/waiting-approval", "/addadmin" and
// "/upgrade-2.1" - a second, fully redundant GET /users/me racing the one
// Login.jsx already makes itself (see its checkingSession/GetLoginData
// flow, which does the real become() + redirect + invalid-token cleanup).
// None of the other pages this wraps read Parse.User.current(), so that
// call had no effect for them either - it was a wasted round trip on every
// single load of the root URL for no observable behavior.
const ValidateRoute = () => {
  return <Outlet />;
};

export default ValidateRoute;
