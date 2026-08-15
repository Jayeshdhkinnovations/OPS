import { useState, useEffect } from "react";
import Parse from "parse";
import { Outlet } from "react-router";
import SessionExpiredModal from "./SessionExpiredModal";

const Validate = () => {
  const [isUserValid, setIsUserValid] = useState(true);
  useEffect(() => {
    (async () => {
      const token = localStorage.getItem("accesstoken");
      if (token) {
        try {
          // Validates the token directly against the server instead of a
          // localStorage-cached user id keyed by parseAppId - that cache can
          // be stale/missing across tenants and incorrectly report a valid
          // session as expired.
          await Parse.User.become(token);
          setIsUserValid(true);
        } catch (error) {
          // Session token is invalid or there was an error
          setIsUserValid(false);
        }
      }
    })();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return isUserValid ? <Outlet /> : <SessionExpiredModal />;
};

export default Validate;
