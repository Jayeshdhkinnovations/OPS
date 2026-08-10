import { useEffect, useState } from "react";
import toowixLogo from "../assets/images/toowix-logo.png";
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
  const [sent, setSent] = useState(false);

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
          // Not Parse.User.requestPasswordReset: this page runs on the
          // shared login origin, whose database holds no accounts - every
          // user lives in their own company's database. That call therefore
          // found nobody and silently sent nothing. This cloud function
          // locates the company owning the address and has that company's
          // server send the mail, so the reset link points at the right one.
          await Parse.Cloud.run("requestpasswordreset", { email: username });
          // Confirm inside the card rather than via a toast that vanishes -
          // the user needs to know to go and check their inbox.
          setSent(true);
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
    <div className="flex min-h-screen w-full justify-center bg-[#F7F8FC] p-4 font-['Poppins'] sm:p-8">
      {isLoading && (
        <div className="fixed w-full h-full flex justify-center items-center bg-black bg-opacity-30 z-50">
          <Loader />
        </div>
      )}
      {toast?.message && <Alert type={toast.type}>{toast.message}</Alert>}

      <div className="op-auth-card relative m-auto flex w-full max-w-5xl overflow-hidden rounded-[26px] bg-white shadow-[0_40px_80px_-30px_rgba(70,60,160,0.28)]">
        {/* Left hero panel */}
        {!state.hideNav && (
          <div
            className="relative hidden w-[44%] shrink-0 flex-col overflow-hidden rounded-l-[26px] bg-gradient-to-br from-[#0B3D73] to-[#002864] px-8 py-[34px] md:flex"
          >
            <div className="relative z-20">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white shadow-md">
                  <img src={toowixLogo} alt="Sign Toowix" className="h-7 w-7 object-contain" />
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
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white shadow-md">
                  <img src={toowixLogo} alt="Sign Toowix" className="h-7 w-7 object-contain" />
                </div>
                <div>
                  <span className="text-lg font-bold tracking-tight text-gray-800">
                    Sign Toowix
                  </span>
                </div>
              </div>
            )}

            {sent ? (
              <div className="text-center">
                <div className="op-stagger-item mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#EAF1FF]" style={{ animationDelay: "0ms" }}>
                  <i className="fa-light fa-envelope-circle-check text-2xl text-[#0B3D73]" />
                </div>
                <h1 className="op-stagger-item mt-5 text-2xl font-bold tracking-tight text-gray-800" style={{ animationDelay: "60ms" }}>
                  Email sent
                </h1>
                <p className="op-stagger-item mt-2 text-sm text-gray-500" style={{ animationDelay: "100ms" }}>
                  We&apos;ve sent a password reset link to{" "}
                  <span className="font-semibold text-gray-700">{state.email}</span>.
                  Check your inbox and follow the link to set a new password.
                </p>
                <p className="op-stagger-item mt-2 text-xs text-gray-400" style={{ animationDelay: "130ms" }}>
                  Can&apos;t find it? Check your spam folder.
                </p>
                <button
                  type="button"
                  onClick={() => authNavigate("/", { replace: true })}
                  className="op-stagger-item mt-8 w-full rounded-full bg-gradient-to-r from-[#1B4F91] to-[#0B3D73] py-[15px] px-6 text-[15px] font-bold text-white transition-opacity duration-150 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[#0B3D73] focus:ring-offset-2"
                  style={{ animationDelay: "170ms" }}
                >
                  {t("login")}
                </button>
                <button
                  type="button"
                  onClick={() => setSent(false)}
                  className="op-stagger-item mt-3 w-full text-sm font-semibold text-[#0B3D73] transition-colors duration-200 hover:underline"
                  style={{ animationDelay: "200ms" }}
                >
                  Use a different email
                </button>
              </div>
            ) : (
            <form onSubmit={handleSubmit}>
              <h1 className="op-stagger-item text-2xl font-bold text-gray-800 tracking-tight" style={{ animationDelay: "0ms" }}>Forgot Password</h1>
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
                  className="w-full rounded-full border border-gray-300 bg-white text-gray-800 placeholder:text-gray-400 focus:border-[#0B3D73] focus:ring-2 focus:ring-[#0B3D73]/15 focus:outline-none transition-colors px-5 py-3 text-[15px]"
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
                className="op-stagger-item mt-8 w-full rounded-full bg-gradient-to-r from-[#1B4F91] to-[#0B3D73] py-[15px] px-6 text-[15px] font-bold text-white transition-opacity duration-150 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[#0B3D73] focus:ring-offset-2"
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
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ForgotPassword;
