import { useEffect, useState } from "react";
import toowixLogo from "../assets/images/toowix-logo-white.svg";
import Parse from "parse";
import { useDispatch } from "react-redux";
import axios from "axios";
import { NavLink, useNavigate, useLocation } from "react-router";
import AuthIllustration from "../components/AuthIllustration";
import { useWindowSize } from "../hook/useWindowSize";
import ModalUi from "../primitives/ModalUi";
import {
  emailRegex,
} from "../constant/const";
import Alert from "../primitives/Alert";
import { appInfo } from "../constant/appinfo";
import { fetchAppInfo } from "../redux/reducers/infoReducer";
import { showTenant } from "../redux/reducers/ShowTenant";
import {
  getAppLogo,
  saveLanguageInLocal,
  usertimezone
} from "../constant/Utils";
import Loader from "../primitives/Loader";
import { useTranslation } from "react-i18next";
import SelectLanguage from "../components/pdf/SelectLanguage";
import { useAuthNavigate } from "../hook/useAuthNavigate";
import { signInWithGoogle } from "../constant/firebase";
import GoogleSignupModal from "../components/GoogleSignupModal";

function Login() {
  const appName =
    "SignToowix";
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const authNavigate = useAuthNavigate();
  const location = useLocation();
  const dispatch = useDispatch();
  const { width } = useWindowSize();
  const [state, setState] = useState({
    email: "",
    password: "",
    rememberMe: false,
    alertType: "success",
    alertMsg: "",
    passwordVisible: false,
    loading: false,
    thirdpartyLoader: false,
  });
  // Three-state auth lifecycle for the very first render, distinct from
  // `state.loading` (which also drives the Sign In/Verify button spinner
  // during an actual form submission - reusing it here would make the whole
  // page vanish mid-submit too). Starts true only when there is a token to
  // check, so a genuinely logged-out visitor never sees a checking phase at
  // all. Flipped false exactly once, in checkUserExt below, after session
  // restoration has fully resolved one way or the other - never on a timer.
  const [checkingSession, setCheckingSession] = useState(
    () => !!localStorage.getItem("accesstoken")
  );
  const [userDetails, setUserDetails] = useState({
    Company: "",
    Destination: ""
  });
  const [isModal, setIsModal] = useState(false);
  const [image, setImage] = useState();
  const [errMsg, setErrMsg] = useState();
  const [otpStep, setOtpStep] = useState(false);
  const [pendingUserId, setPendingUserId] = useState(null);
  const [otpValue, setOtpValue] = useState("");
  const [otpError, setOtpError] = useState("");
  const [otpSecondsLeft, setOtpSecondsLeft] = useState(0);
  const [otpResending, setOtpResending] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  // Holds the verified Firebase token + identity between "we don't know
  // this email yet" and the signup modal's submit - re-used rather than
  // re-opening the Google popup a second time just to collect a company name.
  const [googlePending, setGooglePending] = useState(null);
  const [googleSignupError, setGoogleSignupError] = useState("");

  // Countdown matches the backend's 5-minute OTP expiry (see
  // twoFactorAuth.js OTP_TTL_MS) - purely a UI clock, the server is still
  // the source of truth on whether a code is actually still valid.
  useEffect(() => {
    if (!otpStep || otpSecondsLeft <= 0) return;
    const timer = setInterval(() => {
      setOtpSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [otpStep, otpSecondsLeft > 0]);
  useEffect(() => {
    handleUserExist();
    // eslint-disable-next-line
  }, []);

  const handleUserExist = async () => {
    checkUserExt();
  };


  const setLocalVar = (user) => {
    localStorage.setItem("accesstoken", user.sessionToken);
    localStorage.setItem("UserInformation", JSON.stringify(user));
    localStorage.setItem("userEmail", user.email);
    if (user.ProfilePic) {
      localStorage.setItem("profileImg", user.ProfilePic);
    } else {
      localStorage.setItem("profileImg", "");
    }
  };

  const showToast = (type, msg) => {
    setState({ ...state, loading: false, alertType: type, alertMsg: msg });
    setTimeout(() => setState({ ...state, alertMsg: "" }), 2000);
  };

  const checkUserExt = async () => {
    const app = await getAppLogo();
    if (app?.error === "invalid_json") {
      setErrMsg(t("server-down", { appName: appName }));
    } else if (
      app?.user === "not_exist"
    ) {
      navigate("/addadmin");
    }
    if (app?.logo) {
      setImage(app?.logo);
    } else {
      setImage(appInfo?.applogo || undefined);
    }
    dispatch(fetchAppInfo());
    if (localStorage.getItem("accesstoken")) {
      setState({ ...state, loading: true });
      // GetLoginData already handles every outcome internally (navigates
      // away on success, clears the token and resets state.loading on
      // failure) - awaiting it here only adds the one thing it doesn't do
      // itself: telling this component the checking phase is over, whichever
      // way it went, so the login form can finally be considered for render.
      try {
        await GetLoginData();
      } finally {
        setCheckingSession(false);
      }
    } else {
      setCheckingSession(false);
    }
  };
  const handleChange = (event) => {
    let { name, value } = event.target;
    if (name === "email") {
      value = value?.toLowerCase()?.replace(/\s/g, "");
    }
    setState({ ...state, [name]: value });
  };

  // `isRetry` is set only by the tenant_redirect path below, which has
  // already pointed Parse.serverURL at the right company mount - resetting
  // to root there would loop forever.
  const handleLogin = async (isRetry = false) => {
    const email = state?.email
    const password = state?.password

    if (!email || !password) {
      return;
    }
    if (!isRetry) {
      // Always start a fresh attempt at the root /app mount. A previous
      // session can leave a tenant-specific baseUrl (/app/<subdomain>/) in
      // localStorage; starting from that skips the tenant lookup entirely,
      // so signing in as a user from a *different* company always failed.
      // Built from window.location.origin, not the stored baseUrl - an
      // empty/broken baseUrl otherwise produced a relative URL here
      // ("/app/" with no host), which every later session check against
      // this server then failed against ("Invalid session token").
      Parse.serverURL = `${window.location.origin}/app/`;
    }
    localStorage.removeItem("accesstoken");
    await Parse.User.logOut().catch(() => { });
    try {
      setState({ ...state, loading: true });
      localStorage.setItem("appLogo", appInfo.applogo);
      const _user = await Parse.Cloud.run("loginuser", { email, password });
      if (_user && _user.error === "tenant_redirect" && _user.subdomain) {
        // A retry attempt is already running against the company instance
        // the first redirect pointed at - it has no business redirecting
        // again. Recursing here regardless of `isRetry` is what turned a
        // backend bug (a company container mis-detecting itself as root and
        // handing back tenant_redirect pointing at itself) into an infinite
        // loginuser loop instead of a single failed attempt. That backend
        // bug is now fixed, so this should never trigger in practice - it's
        // the terminating condition that keeps a future regression from
        // becoming a silent infinite loop again instead of a visible error.
        if (isRetry) {
          console.error(
            "loginuser returned tenant_redirect again on retry - not recursing",
            _user.subdomain
          );
          setState({ ...state, loading: false });
          showToast("danger", t("something-went-wrong-mssg"));
          return;
        }
        // Automatically route to the company-specific backend path.
        // Strip any existing /app or /app/<tenant> suffix first - matching
        // only a trailing /app meant a second redirect compounded into
        // /app/x/app/x/, which 404s and sticks around in localStorage.
        const newBaseUrl = `${window.location.origin}/app/${_user.subdomain}/`;
        localStorage.setItem("baseUrl", newBaseUrl);
        Parse.serverURL = newBaseUrl;

        // Retry login against the dynamic tenant instance
        return handleLogin(true);
      }
      if (_user && _user.error === "account_suspended") {
        setState({ ...state, loading: false });
        showToast("danger", "Your account is suspended. Please contact admin.");
        return;
      }
      if (!_user) {
        setState({ ...state, loading: false });
        return;
      }
      // Password verified, but this account has 2FA on - the server withheld
      // the real session token and emailed a code instead. Switch to the OTP
      // step; the session only gets handed over once verifyloginotp confirms it.
      if (_user.requires2fa) {
        setPendingUserId(_user.userId);
        setOtpStep(true);
        setOtpSecondsLeft(300);
        setOtpError("");
        setState({ ...state, loading: false });
        return;
      }
      await completeLogin(_user);
    } catch (error) {
      console.error("Error while logging in user", error);
      if (error?.code === 1001) {
        showToast("danger", t("action-prohibited"));
      } else {
        showToast("danger", t("invalid-username-password-region"));
      }
    }
  };

  // Shared by the direct-login success path and the post-OTP path - both end
  // up with the same `_user` shape (including a real sessionToken) and finish
  // the same way.
  const completeLogin = async (_user) => {
    try {
      const baseUrl = localStorage.getItem("baseUrl");
      if (baseUrl) {
        Parse.serverURL = baseUrl;
      }
      await Parse.User.become(_user.sessionToken);
      setLocalVar(_user);
      await continueLoginFlow();
    } catch (error) {
      console.error("Error completing login:", error);
      showToast("danger", t("something-went-wrong-mssg"));
    }
  };

  const handleLoginBtn = async (event) => {
    event.preventDefault();
    if (!emailRegex.test(state.email)) {
      alert(t("valid-email-alert"));
      return;
    }
    await handleLogin();
  };

  // Entry point for the "Sign in with Google" button - opens Google's
  // account picker, then asks the root instance whether this Google account
  // is already linked anywhere (known), mid-approval (pending), or new.
  const handleGoogleClick = async () => {
    setGoogleLoading(true);
    try {
      const idToken = await signInWithGoogle();

      // handleLogin already does this before its own attempt - the Parse
      // SDK auto-attaches whatever session token it has cached (from a
      // previous, possibly different-company session in this browser) to
      // every Cloud.run call. Left in place, that stale token gets sent
      // alongside googlelogin and the server rejects the whole request
      // with "Invalid session token" before the cloud function even runs.
      localStorage.removeItem("accesstoken");
      await Parse.User.logOut().catch(() => {});

      // Same "always start the lookup from root" reasoning as handleLogin -
      // a leftover tenant-specific baseUrl would skip the lookup entirely.
      // Built from window.location.origin, not the stored baseUrl - see
      // the matching comment in handleLogin for why.
      Parse.serverURL = `${window.location.origin}/app/`;

      const res = await Parse.Cloud.run("googleloginlookup", { idToken });

      if (res.status === "known") {
        const newBaseUrl = `${window.location.origin}/app/${res.subdomain}/`;
        localStorage.setItem("baseUrl", newBaseUrl);
        Parse.serverURL = newBaseUrl;

        const _user = await Parse.Cloud.run("googlelogin", { idToken });
        if (_user.requires2fa) {
          setPendingUserId(_user.userId);
          setOtpStep(true);
          setOtpSecondsLeft(300);
          setOtpError("");
          return;
        }
        await completeLogin(_user);
        return;
      }

      if (res.status === "pending") {
        authNavigate("/waiting-approval", { state: { email: res.email } });
        return;
      }

      // status === "new": nothing to sign in to yet - collect the details
      // the password signup form would normally have asked for.
      setGoogleSignupError("");
      setGooglePending({ idToken, email: res.email, name: res.name });
    } catch (error) {
      console.error("Google sign-in error", error);
      if (error?.code !== "auth/popup-closed-by-user" && error?.code !== "auth/cancelled-popup-request") {
        showToast("danger", t("something-went-wrong-mssg"));
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleGoogleSignupSubmit = async ({ companyName, jobTitle, phone, maxUsers }) => {
    setGoogleLoading(true);
    setGoogleSignupError("");
    try {
      await Parse.Cloud.run("submitapprovalgoogle", {
        idToken: googlePending.idToken,
        companyName,
        jobTitle,
        phone,
        maxUsers,
      });
      const submittedEmail = googlePending.email;
      setGooglePending(null);
      authNavigate("/waiting-approval", { state: { email: submittedEmail } });
    } catch (error) {
      console.error("Google signup error", error);
      setGoogleSignupError(error?.message || t("something-went-wrong-mssg"));
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleVerifyOtpBtn = async (event) => {
    event.preventDefault();
    setOtpError("");
    setState({ ...state, loading: true });
    const baseUrl = localStorage.getItem("baseUrl");
    if (baseUrl) {
      Parse.serverURL = baseUrl;
    }
    try {
      const _user = await Parse.Cloud.run("verifyloginotp", {
        userId: pendingUserId,
        otp: otpValue,
      });
      setOtpStep(false);
      setOtpValue("");
      setPendingUserId(null);
      await completeLogin(_user);
    } catch (error) {
      setState({ ...state, loading: false });
      setOtpError(error.message || t("invalid-username-password-region"));
    }
  };

  const handleResendOtp = async () => {
    setOtpResending(true);
    setOtpError("");
    const baseUrl = localStorage.getItem("baseUrl");
    if (baseUrl) {
      Parse.serverURL = baseUrl;
    }
    try {
      // loginuser re-runs the password check and (since 2FA is still on)
      // generates+emails a brand new code, overwriting the old one server-side.
      const _user = await Parse.Cloud.run("loginuser", {
        email: state.email,
        password: state.password,
      });
      if (_user?.requires2fa) {
        setPendingUserId(_user.userId);
        setOtpValue("");
        setOtpSecondsLeft(300);
      }
    } catch (error) {
      setOtpError(error.message || t("something-went-wrong-mssg"));
    } finally {
      setOtpResending(false);
    }
  };

  const handleCancelOtp = () => {
    setOtpStep(false);
    setPendingUserId(null);
    setOtpSecondsLeft(0);
    setOtpValue("");
    setOtpError("");
  };

  const setThirdpartyLoader = (value) => {
    setState({ ...state, thirdpartyLoader: value });
  };

  const thirdpartyLoginfn = async (sessionToken) => {
    const baseUrl = localStorage.getItem("baseUrl");
    const parseAppId = localStorage.getItem("parseAppId");
    const res = await axios.get(baseUrl + "users/me", {
      headers: {
        "X-Parse-Session-Token": sessionToken,
        "X-Parse-Application-Id": parseAppId
      }
    });
    await Parse.User.become(sessionToken).then(() => {
      window.localStorage.setItem("accesstoken", sessionToken);
    });
    if (res.data) {
      let _user = res.data;
      setLocalVar(_user);
      // Check extended class user role and tenentId
      try {
        const userSettings = appInfo.settings;
        const extUser = await Parse.Cloud.run("getUserDetails");
        if (extUser) {
          const IsDisabled = extUser?.get("IsDisabled") || false;
          if (!IsDisabled) {
            const userRole = extUser?.get("UserRole");
            const menu =
              userRole && userSettings.find((menu) => menu.role === userRole);
            if (menu) {
              const _currentRole = userRole;
              const redirectUrl =
                location?.state?.from || `/${menu.pageType}/${menu.pageId}`;
              const _role = _currentRole.replace("contracts_", "");
              const extInfo = JSON.parse(JSON.stringify(extUser));
              localStorage.setItem("_user_role", _role);
              localStorage.setItem("Extand_Class", JSON.stringify([extUser]));
              localStorage.setItem("userEmail", extInfo?.Email);
              localStorage.setItem("username", extInfo?.Name);
              if (extInfo?.TenantId) {
                const tenant = {
                  Id: extInfo?.TenantId?.objectId || "",
                  Name: extInfo?.TenantId?.TenantName || ""
                };
                localStorage.setItem("TenantId", tenant?.Id);
                dispatch(showTenant(tenant?.Name));
                localStorage.setItem("TenantName", tenant?.Name);
              }
              localStorage.setItem("PageLanding", menu.pageId);
              localStorage.setItem("defaultmenuid", menu.menuId);
              localStorage.setItem("pageType", menu.pageType);
              navigate(redirectUrl);
            } else {
              showToast("danger", t("role-not-found"));
              logOutUser();
            }
          } else {
            showToast("danger", t("do-not-access-contact-admin"));
            logOutUser();
          }
        } else {
          showToast("danger", t("user-not-found"));
          logOutUser();
        }
      } catch (error) {
        console.error("err in fetching extUser", error);
        showToast("danger", `${error.message}`);
        const payload = { sessionToken: _user.sessionToken };
        handleSubmitbtn(payload);
      } finally {
        setThirdpartyLoader(false);
      }
    }
  };

  const GetLoginData = async () => {
    setState({ ...state, loading: true });
    try {
      const user = await Parse.User.become(localStorage.getItem("accesstoken"));
      const _user = user.toJSON();
      setLocalVar(_user);
      const userSettings = appInfo.settings;
      const extUser = await Parse.Cloud.run("getUserDetails");
      if (extUser) {
        const IsDisabled = extUser?.get("IsDisabled") || false;
        if (!IsDisabled) {
          const userRole = extUser.get("UserRole");
          const _currentRole = userRole;
          const menu =
            userRole && userSettings.find((menu) => menu.role === userRole);
          if (menu) {
            const extInfo = JSON.parse(JSON.stringify(extUser));
            const _role = _currentRole.replace("contracts_", "");
            localStorage.setItem("_user_role", _role);
            const redirectUrl =
              location?.state?.from || `/${menu.pageType}/${menu.pageId}`;
            localStorage.setItem("Extand_Class", JSON.stringify([extUser]));
            localStorage.setItem("userEmail", extInfo.Email);
            localStorage.setItem("username", extInfo.Name);
            if (extInfo?.TenantId) {
              const tenant = {
                Id: extInfo?.TenantId?.objectId || "",
                Name: extInfo?.TenantId?.TenantName || ""
              };
              localStorage.setItem("TenantId", tenant?.Id);
              dispatch(showTenant(tenant?.Name));
              localStorage.setItem("TenantName", tenant?.Name);
            }
            localStorage.setItem("PageLanding", menu.pageId);
            localStorage.setItem("defaultmenuid", menu.menuId);
            localStorage.setItem("pageType", menu.pageType);
            navigate(redirectUrl);
          } else {
            setState({ ...state, loading: false });
            logOutUser();
          }
        } else {
          showToast("danger", t("do-not-access-contact-admin"));
          logOutUser();
        }
      } else {
        showToast("danger", t("user-not-found"));
        logOutUser();
      }
    } catch (error) {
      console.log("err", error);
      // An expired/invalid stored session is an ordinary condition (token
      // outlived its session, or the account no longer exists) - just clear
      // it and let the user sign in again. Only surface the scary toast for
      // genuinely unexpected failures, otherwise every returning visitor
      // with a stale token gets an error on a page they only wanted to
      // log in from.
      const isStaleSession =
        error?.code === Parse.Error.INVALID_SESSION_TOKEN ||
        error?.code === Parse.Error.OBJECT_NOT_FOUND;
      if (!isStaleSession) {
        showToast("danger", t("something-went-wrong-mssg"));
      }
      Parse.User.logOut().catch(() => { });
      localStorage.removeItem("accesstoken");
      setState((s) => ({ ...s, loading: false }));
    }
  };

  const togglePasswordVisibility = () => {
    setState({ ...state, passwordVisible: !state.passwordVisible });
  };

  const handleSubmitbtn = async (e) => {
    e.preventDefault();
    if (userDetails.Destination && userDetails.Company) {
      setThirdpartyLoader(true);
      const payload = { sessionToken: localStorage.getItem("accesstoken") };
      const userInformation = JSON.parse(
        localStorage.getItem("UserInformation")
      );
      if (payload && payload.sessionToken) {
        const params = {
          userDetails: {
            name: userInformation.name,
            email: userInformation.email,
            phone: userInformation?.phone || "",
            role: "contracts_User",
            company: userDetails.Company,
            jobTitle: userDetails.Destination,
            timezone: usertimezone
          }
        };
        const userSignUp = await Parse.Cloud.run("usersignup", params);
        if (userSignUp && userSignUp.sessionToken) {
          const LocalUserDetails = {
            name: userInformation.name,
            email: userInformation.email,
            phone: userInformation?.phone || "",
            company: userDetails.Company,
            jobTitle: userDetails.JobTitle
          };
          localStorage.setItem("userDetails", JSON.stringify(LocalUserDetails));
          thirdpartyLoginfn(userSignUp.sessionToken);
        } else {
          alert(userSignUp.message);
        }
      } else if (
        payload &&
        payload.message.replace(/ /g, "_") === "Internal_server_err"
      ) {
        alert(t("server-error"));
      }
    } else {
      showToast("warning", t("fill-required-details!"));
    }
  };

  const logOutUser = async () => {
    setIsModal(false);
    try {
      await Parse.User.logOut();
    } catch (err) {
      console.log("Err while logging out", err);
    }
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

  const continueLoginFlow = async () => {
    try {
      const baseUrl = localStorage.getItem("baseUrl");
      if (baseUrl) {
        Parse.serverURL = baseUrl;
      }
      const userSettings = appInfo.settings;
      const extUser = await Parse.Cloud.run("getUserDetails");
      if (extUser) {
        const IsDisabled = extUser?.get("IsDisabled") || false;
        if (!IsDisabled) {
          const userRole = extUser?.get("UserRole");
          const menu =
            userRole && userSettings?.find((menu) => menu.role === userRole);
          if (menu) {
            const _currentRole = userRole;
            const redirectUrl =
              location?.state?.from || `/${menu.pageType}/${menu.pageId}`;
            const _role = _currentRole.replace("contracts_", "");
            localStorage.setItem("_user_role", _role);
            const checkLanguage = extUser?.get("Language");
            if (checkLanguage) {
              checkLanguage && i18n.changeLanguage(checkLanguage);
            }
            const extInfo = JSON.parse(JSON.stringify(extUser));
            // Continue with storing user data and redirecting
            localStorage.setItem("Extand_Class", JSON.stringify([extUser]));
            localStorage.setItem("userEmail", extInfo.Email);
            localStorage.setItem("username", extInfo.Name);
            if (extInfo?.TenantId) {
              const tenant = {
                Id: extInfo?.TenantId?.objectId || "",
                Name: extInfo?.TenantId?.TenantName || ""
              };
              localStorage.setItem("TenantId", tenant?.Id);
              dispatch(showTenant(tenant?.Name));
              localStorage.setItem("TenantName", tenant?.Name);
            }
            localStorage.setItem("PageLanding", menu.pageId);
            localStorage.setItem("defaultmenuid", menu.menuId);
            localStorage.setItem("pageType", menu.pageType);
            setState({ ...state, loading: false });
            navigate(redirectUrl);
          } else {
            setState({ ...state, loading: false });
            setIsModal(true);
          }
        } else {
          showToast("danger", t("do-not-access-contact-admin"));
          logOutUser();
        }
      } else {
        showToast("danger", t("user-not-found"));
        logOutUser();
      }
    } catch (error) {
      console.error("Error during login flow", error);
      showToast("danger", error.message || t("something-went-wrong-mssg"));
    }
  };

  return errMsg ? (
    <div className="h-screen flex justify-center text-center items-center p-4 text-gray-500 text-base">
      {errMsg}
    </div>
  ) : checkingSession ? (
    // Same Loader asset used everywhere else in the app - shown in place of
    // the login form for as long as a stored token is still being
    // validated, so a valid session never flashes the login page before the
    // dashboard redirect lands. No backdrop change here, just the mark
    // itself darkened (grayscale + reduced brightness) so it reads clearly
    // against the plain page background instead of looking washed out.
    <div className="flex justify-center items-center h-[100vh]">
      <div className="scale-150 grayscale brightness-50">
        <Loader />
      </div>
    </div>
  ) : (
    <>
      {state.loading && (
        <div
          aria-live="assertive"
          className="fixed w-full h-full flex justify-center items-center bg-black bg-opacity-30 z-50"
        >
          <Loader />
        </div>
      )}
      {appInfo && appInfo.appId ? (
        <>
        <div
          aria-labelledby="loginHeading"
          role="region"
          className="flex h-[100dvh] w-full items-center justify-center overflow-y-auto bg-[#F7F8FC] p-3 font-['Poppins'] sm:h-auto sm:min-h-screen sm:overflow-visible sm:p-8"
        >
          <div className="op-auth-card relative m-auto flex w-full max-w-5xl overflow-hidden rounded-[26px] bg-white shadow-[0_40px_80px_-30px_rgba(70,60,160,0.28)]">
            {/* Left hero panel */}
            {width >= 768 && (
              <div
                className="relative hidden w-[44%] shrink-0 flex-col overflow-hidden rounded-l-[26px] bg-gradient-to-br from-[#0B3D73] to-[#002864] px-8 py-[34px] md:flex"
              >
                <div className="relative z-20">
                  <div className="flex items-center gap-3">
                    <img src={toowixLogo} alt="SignToowix" className="h-9 w-9 object-contain shrink-0" />
                    <div>
                      <span className="text-lg font-bold tracking-tight text-white block leading-none">
                        SignToowix
                      </span>
                      <span className="text-[10px] text-white/80 font-medium mt-1 block">
                        Secure Digital Document Platform
                      </span>
                    </div>
                  </div>
                </div>

                <div className="relative z-20 mt-10 -ml-4">
                  <h2 className="text-xl font-bold leading-snug text-white lg:text-2xl">
                    Sign Documents Securely From Anywhere.
                  </h2>
                  <p className="mt-3 text-sm text-white/90">
                    Create, send, sign and manage documents online with enterprise-grade security.
                  </p>
                </div>

                <div className="relative z-20 mx-auto mt-auto w-full max-w-[280px]">
                  <span className="op-animate-blob absolute -left-6 top-6 h-20 w-20 rounded-full bg-white/20 blur-xl" />
                  <span className="op-animate-blob absolute -right-4 bottom-4 h-24 w-24 rounded-full bg-white/10 blur-2xl" />
                  <AuthIllustration className="relative z-[1] w-full drop-shadow-xl" />
                </div>
              </div>
            )}

            {/* Right form panel - overlaps the hero panel's right edge with a
                negative margin + large left corner radius, so the seam reads
                as one continuous curve instead of a straight line. */}
            <div
              className="relative z-20 flex w-full flex-col bg-white px-4 py-4 sm:px-10 sm:py-10 md:w-[56%] md:-ml-[30px] md:rounded-[34px_16px_16px_34px] md:px-[46px] md:py-[38px] lg:px-[46px]"
            >
              {width >= 768 && (
                <div className="absolute right-[34px] top-[26px]">
                  <SelectLanguage isProfile isLoginStyle />
                </div>
              )}
              <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-1 sm:py-4">
                {width < 768 && (
                  <div className="mb-4 flex items-center gap-2.5 sm:mb-8">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#0B3D73]">
                      <img src={toowixLogo} alt="SignToowix" className="h-6 w-6 object-contain" />
                    </div>
                    <div>
                      <span className="text-lg font-bold tracking-tight text-gray-800">
                        SignToowix
                      </span>
                    </div>
                  </div>
                )}

                {otpStep ? (
                <form onSubmit={handleVerifyOtpBtn} aria-label="Two-factor verification form">
                  <h1 className="op-stagger-item text-2xl font-bold text-gray-800 tracking-tight" style={{ animationDelay: "0ms" }}>Enter verification code</h1>
                  <p className="op-stagger-item mt-1 text-xs text-gray-400 font-medium" style={{ animationDelay: "40ms" }}>
                    We sent a 6-digit code to your email. It expires in 5 minutes.
                  </p>

                  <div className="op-stagger-item mt-8" style={{ animationDelay: "90ms" }}>
                    <label className="sr-only" htmlFor="otp">One-time code</label>
                    <input
                      id="otp"
                      type="tel"
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      placeholder="6-digit code"
                      className="w-full rounded-full border border-gray-300 bg-white text-gray-800 placeholder:text-gray-400 focus:border-[#0B3D73] focus:ring-2 focus:ring-[#0B3D73]/15 focus:outline-none transition-colors py-3 pl-5 pr-12 text-[15px] tracking-[4px] placeholder:tracking-normal"
                      value={otpValue}
                      onChange={(e) => setOtpValue(e.target.value.replace(/\D/g, ""))}
                      required
                      autoFocus
                    />
                    {otpError && (
                      <p className="mt-2 text-xs text-red-600">{otpError}</p>
                    )}
                    <div className="mt-3 flex items-center justify-between text-xs">
                      <span className={otpSecondsLeft > 0 ? "text-gray-400" : "text-red-600 font-semibold"}>
                        {otpSecondsLeft > 0
                          ? `Code expires in ${String(Math.floor(otpSecondsLeft / 60)).padStart(1, "0")}:${String(otpSecondsLeft % 60).padStart(2, "0")}`
                          : "Code expired"}
                      </span>
                      <button
                        type="button"
                        onClick={handleResendOtp}
                        disabled={otpResending || otpSecondsLeft > 0}
                        className="font-semibold text-[#0B3D73] hover:underline disabled:text-gray-300 disabled:no-underline disabled:cursor-not-allowed"
                      >
                        {otpResending ? "Resending..." : "Resend code"}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="op-stagger-item mt-3 sm:mt-6 w-full rounded-full bg-gradient-to-r from-[#1B4F91] to-[#0B3D73] py-3 sm:py-[15px] px-6 text-[15px] font-bold text-white transition-opacity duration-150 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[#0B3D73] focus:ring-offset-2 disabled:opacity-60"
                    style={{ animationDelay: "140ms" }}
                    disabled={state.loading || otpSecondsLeft <= 0}
                  >
                    {state.loading ? t("loading") : t("verify")}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelOtp}
                    className="op-stagger-item mt-3 w-full text-center text-xs text-gray-500 hover:underline font-semibold"
                    style={{ animationDelay: "180ms" }}
                  >
                    {t("cancel")}
                  </button>
                </form>
                ) : (
                <form onSubmit={handleLoginBtn} aria-label="Login Form">
                  <h1 className="op-stagger-item text-2xl font-bold text-gray-800 tracking-tight" style={{ animationDelay: "0ms" }}>{t("welcome")}</h1>
                  <p className="op-stagger-item mt-1 text-xs text-gray-400 font-medium" style={{ animationDelay: "40ms" }}>{t("Login-to-your-account")}</p>

                  <div className="mt-4 flex flex-col gap-3 sm:mt-8 sm:gap-5">
                    <div className="op-stagger-item" style={{ animationDelay: "90ms" }}>
                      <label className="sr-only" htmlFor="email">
                        {t("email")}
                      </label>
                      <input
                        id="email"
                        type="email"
                        placeholder="Email Address"
                        className="w-full rounded-full border border-gray-300 bg-white text-gray-800 placeholder:text-gray-400 focus:border-[#0B3D73] focus:ring-2 focus:ring-[#0B3D73]/15 focus:outline-none transition-colors px-5 py-3 text-[15px]"
                        name="email"
                        autoComplete="username"
                        value={state.email}
                        onChange={handleChange}
                        required
                        onInvalid={(e) =>
                          e.target.setCustomValidity(t("input-required"))
                        }
                        onInput={(e) => e.target.setCustomValidity("")}
                      />
                    </div>

                    <div className="op-stagger-item" style={{ animationDelay: "140ms" }}>
                      <label className="sr-only" htmlFor="password">
                        {t("password")}
                      </label>
                      <div className="relative">
                        <input
                          id="password"
                          type={state.passwordVisible ? "text" : "password"}
                          placeholder="Password"
                          className="w-full rounded-full border border-gray-300 bg-white text-gray-800 placeholder:text-gray-400 focus:border-[#0B3D73] focus:ring-2 focus:ring-[#0B3D73]/15 focus:outline-none transition-colors py-3 pl-5 pr-12 text-[15px]"
                          name="password"
                          value={state.password}
                          autoComplete="current-password"
                          onChange={handleChange}
                          onInvalid={(e) =>
                            e.target.setCustomValidity(t("input-required"))
                          }
                          onInput={(e) => e.target.setCustomValidity("")}
                          required
                        />
                        <span
                          className="absolute right-4 top-1/2 -translate-y-1/2 cursor-pointer text-gray-400 hover:text-gray-600 transition-colors"
                          onClick={togglePasswordVisibility}
                        >
                          {state.passwordVisible ? (
                            <i className="fa-light fa-eye-slash text-base" />
                          ) : (
                            <i className="fa-light fa-eye text-base" />
                          )}
                        </span>
                      </div>
                    </div>

                    <div className="op-stagger-item flex items-center justify-between mt-2" style={{ animationDelay: "190ms" }}>
                      <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-500 font-semibold select-none">
                        <input
                          type="checkbox"
                          className="w-4 h-4 text-[#0B3D73] border-gray-300 rounded focus:ring-[#0B3D73] accent-[#0B3D73]"
                          checked={state.rememberMe}
                          onChange={(e) => setState({ ...state, rememberMe: e.target.checked })}
                        />
                        Remember Me
                      </label>
                      <NavLink
                        to="/forgetpassword"
                        onClick={(e) => {
                          e.preventDefault();
                          authNavigate("/forgetpassword");
                        }}
                        className="text-xs text-[#0B3D73] hover:underline font-semibold focus:outline-none"
                      >
                        {t("forgot-password")}?
                      </NavLink>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="op-stagger-item mt-3 sm:mt-6 w-full rounded-full bg-gradient-to-r from-[#1B4F91] to-[#0B3D73] py-3 sm:py-[15px] px-6 text-[15px] font-bold text-white transition-opacity duration-150 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[#0B3D73] focus:ring-offset-2"
                    style={{ animationDelay: "240ms" }}
                    disabled={state.loading}
                  >
                    {state.loading ? t("loading") : "Sign In"}
                  </button>
                </form>
                )}

                {!otpStep && (
                <p className="op-stagger-item mt-4 sm:mt-8 text-center text-xs text-gray-500 font-medium" style={{ animationDelay: "280ms" }}>
                  Don&apos;t have an account?{" "}
                  <NavLink
                    to="/register"
                    onClick={(e) => {
                      e.preventDefault();
                      authNavigate("/register");
                    }}
                    className="text-[#0B3D73] font-bold hover:underline"
                  >
                    Create Account
                  </NavLink>
                </p>
                )}

                {!otpStep && (
                <button
                  type="button"
                  onClick={handleGoogleClick}
                  disabled={googleLoading}
                  className="op-stagger-item mt-3 w-full flex items-center justify-center gap-2.5 rounded-full border border-gray-300 bg-white py-[13px] px-6 text-sm font-semibold text-gray-700 transition-colors duration-150 hover:bg-gray-50 disabled:opacity-60"
                  style={{ animationDelay: "300ms" }}
                >
                  <svg width="18" height="18" viewBox="0 0 18 18">
                    <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.56 2.7-3.87 2.7-6.62Z"/>
                    <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.95v2.33A9 9 0 0 0 9 18Z"/>
                    <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.66 9c0-.59.1-1.16.29-1.7V4.97H.95A9 9 0 0 0 0 9c0 1.45.35 2.83.95 4.03l3-2.33Z"/>
                    <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .95 4.97l3 2.33C4.66 5.17 6.65 3.58 9 3.58Z"/>
                  </svg>
                  {googleLoading ? "Please wait..." : "Sign in with Google"}
                </button>
                )}
              </div>
            </div>

            {state.alertMsg && (
              <Alert type={state.alertType}>{state.alertMsg}</Alert>
            )}
          </div>
        </div>
        {googlePending && (
          <GoogleSignupModal
            name={googlePending.name}
            email={googlePending.email}
            loading={googleLoading}
            error={googleSignupError}
            onSubmit={handleGoogleSignupSubmit}
            onClose={() => setGooglePending(null)}
          />
        )}
        <ModalUi
            isOpen={isModal}
            title={t("additional-info")}
            showClose={false}
          >
            <form className="px-4 py-3 text-base-content">
              <div className="mb-3">
                <label
                  htmlFor="Company"
                  style={{ display: "flex" }}
                  className="block text-xs font-semibold"
                >
                  {t("company")}{" "}
                  <span className="text-[red] text-[13px]">*</span>
                </label>
                <input
                  type="text"
                  className="op-input op-input-bordered op-input-sm focus:outline-none hover:border-base-content w-full text-xs"
                  id="Company"
                  value={userDetails.Company}
                  onChange={(e) =>
                    setUserDetails({
                      ...userDetails,
                      Company: e.target.value
                    })
                  }
                  onInvalid={(e) =>
                    e.target.setCustomValidity(t("input-required"))
                  }
                  onInput={(e) => e.target.setCustomValidity("")}
                  required
                />
              </div>
              <div className="mb-3">
                <label
                  htmlFor="JobTitle"
                  style={{ display: "flex" }}
                  className="block text-xs font-semibold"
                >
                  {t("job-title")}
                  <span className="text-[red] text-[13px]">*</span>
                </label>
                <input
                  type="text"
                  className="op-input op-input-bordered op-input-sm focus:outline-none hover:border-base-content w-full text-xs"
                  id="JobTitle"
                  value={userDetails.Destination}
                  onChange={(e) =>
                    setUserDetails({
                      ...userDetails,
                      Destination: e.target.value
                    })
                  }
                  onInvalid={(e) =>
                    e.target.setCustomValidity(t("input-required"))
                  }
                  onInput={(e) => e.target.setCustomValidity("")}
                  required
                />
              </div>
              <div className="mt-4 gap-2 flex flex-row">
                <button
                  type="button"
                  className="op-btn op-btn-primary"
                  onClick={(e) => handleSubmitbtn(e)}
                >
                  {t("login")}
                </button>
                <button
                  type="button"
                  className="op-btn op-btn-ghost text-base-content"
                  onClick={logOutUser}
                >
                  {t("cancel")}
                </button>
              </div>
            </form>
          </ModalUi>
        </>
      ) : (
        <div
          aria-live="assertive"
          className="fixed w-full h-full flex justify-center items-center z-50"
        >
          <Loader />
        </div>
      )}
    </>
  );
}
export default Login;
