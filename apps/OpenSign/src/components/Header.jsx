import { useState, useEffect } from "react";
import dp from "../assets/images/dp.png";
import FullScreenButton from "./FullScreenButton";
import ThemeToggle from "./ThemeToggle";
import { useNavigate } from "react-router";
import Parse from "parse";
import { useWindowSize } from "../hook/useWindowSize";
import {
  getAppLogo,
  openInNewTab,
  saveLanguageInLocal
} from "../constant/Utils";
import { useTranslation } from "react-i18next";
import { appInfo } from "../constant/appinfo";
import { useDispatch } from "react-redux";
import { toggleSidebar } from "../redux/reducers/sidebarReducer";
import { sessionStatus } from "../redux/reducers/userReducer";

const Header = ({ isConsole, setIsLoggingOut }) => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { width } = useWindowSize();
  const dispatch = useDispatch();
  const username = localStorage.getItem("username") || "";
  const image = localStorage.getItem("profileImg") || dp;
  const [isOpen, setIsOpen] = useState(false);
  const [applogo, setAppLogo] = useState("");
  const [isDarkTheme, setIsDarkTheme] = useState();

  const toggleDropdown = () => {
    setIsOpen(!isOpen);
    closeSidebar();
  };
  const closeSidebar = () => {
    if (width && width <= 768) {
      dispatch(toggleSidebar(false));
    }
  };

  useEffect(() => {
    initializeHead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    closeSidebar();
  }, [width]);

  const showSidebar = () => {
    dispatch(toggleSidebar());
  };


  async function initializeHead() {
      const applogo = await getAppLogo();
      if (applogo?.logo) {
        setAppLogo(applogo?.logo);
      } else {
        // Prefer this build's bundled logo over a stale localStorage value -
        // localStorage "appLogo" is written with the previous build's hashed
        // asset URL, which no longer resolves to anything after a rebuild.
        const logo = appInfo.applogo || localStorage.getItem("appLogo");
        setAppLogo(logo);
      }
  }
  const handleLogout = async () => {
    setIsOpen(false);
    setIsLoggingOut(true);
    try {
      await Parse.User.logOut();
    } catch (err) {
      console.log("Err while logging out", err);
    } finally {
      dispatch(sessionStatus(true));
    }
    let appdata = localStorage.getItem("userSettings");
    let applogo = localStorage.getItem("appLogo");
    let defaultmenuid = localStorage.getItem("defaultmenuid");
    let PageLanding = localStorage.getItem("PageLanding");
    let baseUrl = localStorage.getItem("baseUrl");
    let appid = localStorage.getItem("parseAppId");

    localStorage.clear();
    saveLanguageInLocal(i18n);
    if (applogo !== null) localStorage.setItem("appLogo", applogo);
    if (defaultmenuid !== null) localStorage.setItem("defaultmenuid", defaultmenuid);
    if (PageLanding !== null) localStorage.setItem("PageLanding", PageLanding);
    if (appdata !== null) localStorage.setItem("userSettings", appdata);
    if (baseUrl !== null) localStorage.setItem("baseUrl", baseUrl);
    if (appid !== null) localStorage.setItem("parseAppId", appid);
    // Deliberately NOT preserved across logout: keeping the old value meant a
    // rebuilt favicon never reached anyone who had already used the app, since
    // it is only seeded when absent. Dropping it here lets the current build
    // re-seed it on the next load.
    setIsLoggingOut(false);
    navigate("/");
  };

  //handle to close profile drop down menu onclick screen
  useEffect(() => {
    const closeMenuOnOutsideClick = (e) => {
      if (isOpen && !e.target.closest("#profile-menu")) {
        setIsOpen(false);
      }
    };

    document.addEventListener("click", closeMenuOnOutsideClick);

    return () => {
      // Cleanup the event listener when the component unmounts
      document.removeEventListener("click", closeMenuOnOutsideClick);
    };
  }, [isOpen]);


  useEffect(() => {
    const updateThemeStatus = () => {
      const isDarkTheme =
        document.documentElement.getAttribute("data-theme") === "opensigndark";
      setIsDarkTheme(isDarkTheme);
    };
    updateThemeStatus();

    const observer = new MutationObserver(() => {
      updateThemeStatus();
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"]
    });

    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div className="op-navbar bg-base-100 shadow touch-none">
        <div className="flex-none">
          <button
            className="op-btn op-btn-square op-btn-ghost focus:outline-none hover:bg-transparent op-btn-sm no-animation"
            onClick={showSidebar}
          >
            <i className="fa-light fa-bars text-xl text-base-content"></i>
          </button>
        </div>
        <div className="flex-1 ml-2">
          <div
            onClick={() => navigate("/dashboard/35KBoSgoAK")}
            className="h-[25px] md:h-[40px] w-auto overflow-hidden cursor-pointer"
          >
            {applogo && (
              <img
                className="object-contain h-full w-auto"
                src={
                      isDarkTheme
                      ? "/static/js/assets/images/logo-dark.png"
                      : applogo
                }
                alt="logo"
              />
            )}
          </div>
        </div>
        <div id="profile-menu" className="flex-none gap-2">
          <div>
              <FullScreenButton />
          </div>
          {width >= 768 && (
            <div
              onClick={toggleDropdown}
              className="cursor-pointer w-[35px] h-[35px] rounded-full ring-[1px] ring-offset-2 ring-gray-400 overflow-hidden"
            >
              <img
                className="w-[35px] h-[35px] object-contain"
                src={image}
                alt="img"
              />
            </div>
          )}
          {width >= 768 && (
            <div
              onClick={toggleDropdown}
              role="button"
              tabIndex="0"
              className="cursor-pointer text-base-content text-sm"
            >
              {username && username}
            </div>
          )}
          <div
            className="op-dropdown op-dropdown-open op-dropdown-end"
            id="profile-menu"
          >
            <div
              tabIndex={0}
              role="button"
              onClick={toggleDropdown}
              className="op-btn op-btn-ghost op-btn-xs w-[10px] h-[20px] hover:bg-transparent"
            >
              <i className="fa-light fa-angle-down text-base-content"></i>
            </div>
            <ul
              tabIndex={0}
              className={`mt-4 z-[1] p-2 shadow op-dropdown-open op-menu op-menu-sm op-dropdown-content text-base-content bg-base-100 rounded-box w-56 ${
                isOpen ? "" : "hidden"
              }`}
            >
              {!isConsole && (
                <>
                    <li
                      onClick={() =>
                        openInNewTab("https://sign.toowix.com/docs")
                      }
                    >
                      <span>
                        <i className="fa-light fa-book"></i> {t("docs")}
                      </span>
                    </li>
                  <li
                    onClick={() => {
                      setIsOpen(false);
                      navigate("/profile");
                    }}
                  >
                    <span>
                      <i className="fa-light fa-user"></i> {t("profile")}
                    </span>
                  </li>
                    <li
                      onClick={() => {
                        setIsOpen(false);
                        navigate("/changepassword");
                      }}
                    >
                      <span>
                        <i className="fa-light fa-lock"></i>{" "}
                        {t("change-password")}
                      </span>
                    </li>
                  <li
                    onClick={() => {
                      setIsOpen(false);
                      navigate("/verify-document");
                    }}
                  >
                    <span>
                      <i className="fa-light fa-check-square"></i>{" "}
                      {t("verify-document")}
                    </span>
                  </li>
                  <li>
                    <span>
                      <i className="fa-light fa-moon"></i>
                      {t("dark-mode")}
                      <span className="text-[10px] font-semibold bg-base-300 text-base-content px-1 rounded-md">
                        BETA
                      </span>
                      <ThemeToggle />
                    </span>
                  </li>
                </>
              )}
              <li onClick={handleLogout}>
                <span>
                  <i className="fa-light fa-arrow-right-from-bracket"></i>{" "}
                  {t("log-out")}
                </span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </>
  );
};

export default Header;
