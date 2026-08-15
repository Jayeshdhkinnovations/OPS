import { sessionStatus } from "../redux/reducers/userReducer";
import { store } from "../redux/store";

export function withSessionValidation(fn) {
  return async (...args) => {
    try {
      const tenantId = localStorage.getItem("TenantId");
      // Read the token directly from localStorage instead of
      // Parse.User.current()?.getSessionToken?.() - the SDK's cached
      // currentUser is keyed by a namespace shared across tenants, so on a
      // fresh reload it can be stale, missing, or belong to a different
      // company than the token actually stored for this session.
      const sessionToken = localStorage.getItem("accesstoken");

      if (!tenantId || !sessionToken) {
        store.dispatch(sessionStatus(false));
        throw new Error("invalid session token");
      }

      return await fn(...args);
    } catch (error) {
      if (error?.message === "invalid session token") {
        console.error("invalid session or missing tenantId", error);
        store.dispatch(sessionStatus(false));
        return;
      } else {
        throw error; // important: don't silently swallow errors
      }
    }
  };
}
