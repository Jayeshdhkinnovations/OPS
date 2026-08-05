import { useEffect, useState } from "react";
import Parse from "parse";
import { useDispatch } from "react-redux";
import axios from "axios";
import { NavLink, useNavigate, useLocation } from "react-router";
import login_img from "../assets/images/login_img.svg";
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

function Login() {
  const appName =
    "OpenSign™";
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
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
  const [userDetails, setUserDetails] = useState({
    Company: "",
    Destination: ""
  });
  const [isModal, setIsModal] = useState(false);
  const [image, setImage] = useState();
  const [errMsg, setErrMsg] = useState();
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
      GetLoginData();
    }
  };
  const handleChange = (event) => {
    let { name, value } = event.target;
    if (name === "email") {
      value = value?.toLowerCase()?.replace(/\s/g, "");
    }
    setState({ ...state, [name]: value });
  };

  const handleLogin = async (
  ) => {
    const email = state?.email
    const password = state?.password

    if (!email || !password) {
      return;
    }
    localStorage.removeItem("accesstoken");
    await Parse.User.logOut().catch(() => { });
    try {
      setState({ ...state, loading: true });
      localStorage.setItem("appLogo", appInfo.applogo);
      const _user = await Parse.Cloud.run("loginuser", { email, password });
      if (_user && _user.error === "tenant_redirect" && _user.subdomain) {
        // Automatically route to the company-specific backend path
        const currentBaseUrl = localStorage.getItem("baseUrl") || "";
        const cleanBaseUrl = currentBaseUrl.replace(/\/app\/?$/, "");
        const newBaseUrl = `${cleanBaseUrl.replace(/\/$/, "")}/app/${_user.subdomain}/`;
        localStorage.setItem("baseUrl", newBaseUrl);
        Parse.serverURL = newBaseUrl;

        // Retry login against the dynamic tenant instance
        return handleLogin();
      }
      if (!_user) {
        setState({ ...state, loading: false });
        return;
      }
      // Get extended user data (including 2FA status) using cloud function
      try {
        await Parse.User.become(_user.sessionToken);
        setLocalVar(_user);
        await continueLoginFlow();
      } catch (error) {
        console.error("Error checking 2FA status:", error);
        showToast("danger", t("something-went-wrong-mssg"));
      }
    } catch (error) {
      console.error("Error while logging in user", error);
      if (error?.code === 1001) {
        showToast("danger", t("action-prohibited"));
      } else {
        showToast("danger", t("invalid-username-password-region"));
      }
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
        console.error("err in fetching extUser", err);
        showToast("danger", `${err.message}`);
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
      showToast("danger", t("something-went-wrong-mssg"));
      console.log("err", error);
      Parse.User.logOut().catch(() => { });
      localStorage.removeItem("accesstoken");
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
          className="flex min-h-screen w-full items-center justify-center bg-[#F7F8FC] p-4 font-['Poppins'] sm:p-8"
        >
          <div className="relative flex w-full max-w-5xl overflow-hidden rounded-[26px] bg-white shadow-[0_40px_80px_-30px_rgba(70,60,160,0.28)]">
            {/* Left hero panel */}
            {width >= 768 && (
              <div
                className="relative hidden w-[44%] shrink-0 flex-col overflow-hidden rounded-l-[26px] bg-gradient-to-br from-[#0B3D73] to-[#002864] px-8 py-[34px] md:flex"
              >
                <div className="relative z-20">
                  <div className="flex items-center gap-3">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white shadow-md">
                      {image ? (
                        <img src={image} alt="Logo" className="h-6 w-6 object-contain" />
                      ) : (
                        <i className="fa-light fa-signature text-lg text-[#5B5EF7]" />
                      )}
                    </div>
                    <div>
                      <span className="text-lg font-bold tracking-tight text-white block leading-none">
                        Sign Toowix
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
                  <img
                    src={login_img}
                    alt="Illustration"
                    className="relative z-[1] w-full drop-shadow-xl"
                  />
                </div>
              </div>
            )}

            {/* Right form panel - overlaps the hero panel's right edge with a
                negative margin + large left corner radius, so the seam reads
                as one continuous curve instead of a straight line. */}
            <div
              className="relative z-20 flex w-full flex-col bg-white px-6 py-10 sm:px-10 md:w-[56%] md:-ml-[30px] md:rounded-[34px_16px_16px_34px] md:px-[46px] md:py-[38px] lg:px-[46px]"
            >
              {width >= 768 && (
                <div className="absolute right-[34px] top-[26px]">
                  <SelectLanguage isProfile isLoginStyle />
                </div>
              )}
              <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-4">
                {width < 768 && (
                  <div className="mb-8 flex items-center gap-2.5">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#5B5EF7] shadow-md">
                      {image ? (
                        <img src={image} alt="Logo" className="h-6 w-6 object-contain filter invert" />
                      ) : (
                        <i className="fa-light fa-signature text-lg text-white" />
                      )}
                    </div>
                    <div>
                      <span className="text-lg font-bold tracking-tight text-gray-800">
                        Sign Toowix
                      </span>
                    </div>
                  </div>
                )}

                <form onSubmit={handleLoginBtn} aria-label="Login Form">
                  <h1 className="text-2xl font-bold text-gray-800 tracking-tight">{t("welcome")}</h1>
                  <p className="mt-1 text-xs text-gray-400 font-medium">{t("Login-to-your-account")}</p>

                  <div className="mt-8 flex flex-col gap-5">
                    <div>
                      <label className="sr-only" htmlFor="email">
                        {t("email")}
                      </label>
                      <input
                        id="email"
                        type="email"
                        placeholder="Email Address"
                        className="w-full border-0 border-b border-gray-200 bg-transparent px-0.5 py-3 text-[15px] text-gray-800 placeholder:text-gray-400 focus:border-[#5B5EF7] focus:outline-none focus:ring-0 transition-colors"
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

                    <div>
                      <label className="sr-only" htmlFor="password">
                        {t("password")}
                      </label>
                      <div className="relative">
                        <input
                          id="password"
                          type={state.passwordVisible ? "text" : "password"}
                          placeholder="Password"
                          className="w-full border-0 border-b border-gray-200 bg-transparent py-3 pl-0.5 pr-8 text-[15px] text-gray-800 placeholder:text-gray-400 focus:border-[#5B5EF7] focus:outline-none focus:ring-0 transition-colors"
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
                          className="absolute right-1 top-1/2 -translate-y-1/2 cursor-pointer text-gray-400 hover:text-gray-600 transition-colors"
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

                    <div className="flex items-center justify-between mt-2">
                      <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-500 font-semibold select-none">
                        <input
                          type="checkbox"
                          className="w-4 h-4 text-[#5B5EF7] border-gray-300 rounded focus:ring-[#5B5EF7] accent-[#5B5EF7]"
                          checked={state.rememberMe}
                          onChange={(e) => setState({ ...state, rememberMe: e.target.checked })}
                        />
                        Remember Me
                      </label>
                      <NavLink
                        to="/forgetpassword"
                        className="text-xs text-[#5B5EF7] hover:underline font-semibold focus:outline-none"
                      >
                        {t("forgot-password")}?
                      </NavLink>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="mt-6 w-full rounded-full bg-gradient-to-r from-[#7C84FF] to-[#5B5EF7] py-[15px] px-6 text-[15px] font-bold text-white shadow-[0_12px_22px_-8px_rgba(91,94,247,0.7)] transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[0_16px_26px_-8px_rgba(91,94,247,0.8)] active:translate-y-0 focus:outline-none focus:ring-2 focus:ring-[#5B5EF7] focus:ring-offset-2"
                    disabled={state.loading}
                  >
                    {state.loading ? t("loading") : "Sign In"}
                  </button>
                </form>

                <p className="mt-8 text-center text-xs text-gray-500 font-medium">
                  Don&apos;t have an account?{" "}
                  <NavLink to="/register" className="text-[#5B5EF7] font-bold hover:underline">
                    Create Account
                  </NavLink>
                </p>
              </div>
            </div>

            {state.alertMsg && (
              <Alert type={state.alertType}>{state.alertMsg}</Alert>
            )}
          </div>
        </div>
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
