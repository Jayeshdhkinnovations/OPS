import { useEffect, useState } from "react";
import AuthIllustration from "../components/AuthIllustration";
import Parse from "parse";
import Alert from "../primitives/Alert";
import { appInfo } from "../constant/appinfo";
import { useDispatch } from "react-redux";
import { fetchAppInfo } from "../redux/reducers/infoReducer";
import {
  emailRegex,
} from "../constant/const";
import { useTranslation } from "react-i18next";
import Loader from "../primitives/Loader";
import SelectLanguage from "../components/pdf/SelectLanguage";
import { useAuthNavigate } from "../hook/useAuthNavigate";

function ForgotPassword() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const authNavigate = useAuthNavigate();
  const [state, setState] = useState({ email: "", password: "", hideNav: "" });
  const [toast, setToast] = useState({ type: "", message: "" });
  const [isLoading, setIsLoading] = useState(false);
  const [image, setImage] = useState();

  const handleChange = (event) => {
    let { name, value } = event.target;
    if (name === "email") {
      value = value?.toLowerCase()?.replace(/\s/g, "");
    }
    setState({ ...state, [name]: value });
  };

  const resize = () => {
    let currentHideNav = window.innerWidth <= 760;
    if (currentHideNav !== state.hideNav) {
      setState({ ...state, hideNav: currentHideNav });
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!emailRegex.test(state.email)) {
      alert(t("valid-email-alert"));
    } else {
      setIsLoading(true);
      localStorage.setItem("appLogo", appInfo.applogo);
      localStorage.setItem("userSettings", JSON.stringify(appInfo.settings));
      if (state.email) {
        const username = state.email;
        try {
          await Parse.User.requestPasswordReset(username);
          setToast({ type: "success", message: t("reset-password-alert-1") });
        } catch (err) {
          console.log("err ", err.code);
          setToast({
            type: "danger",
            message: err.message || t("reset-password-alert-2")
          });
        } finally {
          setIsLoading(false);
          setTimeout(() => setToast({ type: "", message: "" }), 1000);
        }
      }
    }
  };

  useEffect(() => {
    dispatch(fetchAppInfo());
    saveLogo();
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
    // eslint-disable-next-line
  }, []);
  const saveLogo = async () => {
    try {
      await Parse.User.logOut();
    } catch (err) {
      console.log("err while logging out ", err);
    }
    setImage(appInfo?.applogo || undefined);
  };
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-[#F7F8FC] p-4 font-['Poppins'] sm:p-8">
      {isLoading && (
        <div className="fixed w-full h-full flex justify-center items-center bg-black bg-opacity-30 z-50">
          <Loader />
        </div>
      )}
      {toast?.message && <Alert type={toast.type}>{toast.message}</Alert>}

      <div className="op-auth-card relative flex w-full max-w-5xl overflow-hidden rounded-[26px] bg-white shadow-[0_40px_80px_-30px_rgba(70,60,160,0.28)]">
        {/* Left hero panel */}
        {!state.hideNav && (
          <div
            className="relative hidden w-[44%] shrink-0 flex-col overflow-hidden rounded-l-[26px] bg-gradient-to-br from-[#0B3D73] to-[#002864] px-8 py-[34px] md:flex"
          >
            <div className="relative z-20">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white shadow-md">
                  <i className="fa-light fa-signature text-lg text-[#0B3D73]" />
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
                Forgot Password
              </h2>
              <p className="mt-3 text-sm text-white/90">
                Enter your email to receive a password reset link.
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
            negative margin + large left corner radius, so the seam reads as
            one continuous curve instead of a straight line. */}
        <div className="relative z-20 flex w-full flex-col bg-white px-6 py-10 sm:px-10 md:w-[56%] md:-ml-[30px] md:rounded-[34px_16px_16px_34px] md:px-[46px] md:py-[38px] lg:px-[46px]">
          {!state.hideNav && (
            <div className="absolute right-[34px] top-[26px]">
              <SelectLanguage isProfile isLoginStyle />
            </div>
          )}
          <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-4">
            {state.hideNav && (
              <div className="mb-8 flex items-center gap-2.5">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#0B3D73] shadow-md">
                  <i className="fa-light fa-signature text-lg text-white" />
                </div>
                <div>
                  <span className="text-lg font-bold tracking-tight text-gray-800">
                    Sign Toowix
                  </span>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <h1 className="op-stagger-item text-2xl font-bold text-gray-800 tracking-tight" style={{ animationDelay: "0ms" }}>{t("welcome")}</h1>
              <p className="op-stagger-item mt-1 text-xs text-gray-400 font-medium" style={{ animationDelay: "40ms" }}>
                {t("reset-password-alert-3")}
              </p>

              <div className="op-stagger-item mt-8" style={{ animationDelay: "90ms" }}>
                <label className="sr-only">
                  {t("email")}
                </label>
                <input
                  type="email"
                  name="email"
                  placeholder={t("email")}
                  className="w-full border-0 border-b border-gray-200 bg-transparent px-0.5 py-3 text-[15px] text-gray-800 placeholder:text-gray-400 focus:border-[#0B3D73] focus:outline-none focus:ring-0 transition-colors"
                  value={state.email}
                  onChange={handleChange}
                  onInvalid={(e) =>
                    e.target.setCustomValidity(t("input-required"))
                  }
                  onInput={(e) => e.target.setCustomValidity("")}
                  required
                />
              </div>

              <button
                type="submit"
                className="op-stagger-item mt-8 w-full rounded-full bg-gradient-to-r from-[#1B4F91] to-[#0B3D73] py-[15px] px-6 text-[15px] font-bold text-white shadow-[0_12px_22px_-8px_rgba(91,94,247,0.7)] transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[0_16px_26px_-8px_rgba(91,94,247,0.8)] active:translate-y-0 focus:outline-none focus:ring-2 focus:ring-[#0B3D73] focus:ring-offset-2"
                style={{ animationDelay: "140ms" }}
              >
                {t("submit")}
              </button>

              <button
                type="button"
                onClick={() => authNavigate("/", { replace: true })}
                className="op-stagger-item w-full text-[#0B3D73] hover:underline text-sm font-semibold transition-colors duration-200 mt-4"
                style={{ animationDelay: "180ms" }}
              >
                {t("login")}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ForgotPassword;
