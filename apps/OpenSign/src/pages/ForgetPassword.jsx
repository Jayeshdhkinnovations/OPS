import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import login_img from "../assets/images/login_img.svg";
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

function ForgotPassword() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const navigate = useNavigate();
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
    <div className="flex min-h-screen w-full items-center justify-center bg-base-200 p-4 sm:p-8">
      {isLoading && (
        <div className="fixed w-full h-full flex justify-center items-center bg-black bg-opacity-30 z-50">
          <Loader />
        </div>
      )}
      {toast?.message && <Alert type={toast.type}>{toast.message}</Alert>}

      <div className="flex w-full max-w-5xl overflow-hidden rounded-[2rem] bg-base-100 shadow-xl">
        {!state.hideNav && (
          <div className="relative hidden w-1/2 shrink-0 overflow-hidden bg-gradient-to-br from-primary to-primary/70 md:flex md:flex-col md:justify-between md:p-10 lg:p-14">
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-base-100 shadow-lg">
                <i className="fa-light fa-signature text-2xl text-primary" />
              </div>
              <span className="text-2xl font-bold tracking-tight text-primary-content">
                sign.toowix.com
              </span>
            </div>

            <div className="relative z-10 my-10">
              <h2 className="text-3xl font-semibold leading-tight text-primary-content lg:text-4xl">
                Forgot your password?
              </h2>
              <p className="mt-3 max-w-sm text-sm text-primary-content/80">
                No problem - enter your email and we&apos;ll send you a link to
                reset it.
              </p>
            </div>

            <div className="relative mx-auto mt-4 w-full max-w-[420px]">
              <span className="op-animate-blob absolute -left-6 top-6 h-20 w-20 rounded-full bg-primary-content/20 blur-xl" />
              <span className="op-animate-blob absolute -right-4 bottom-4 h-24 w-24 rounded-full bg-primary-content/10 blur-2xl" />
              <span className="op-animate-float-slow absolute -left-2 top-2 grid h-11 w-11 place-items-center rounded-2xl bg-base-100 shadow-lg">
                <i className="fa-light fa-key text-lg text-primary" />
              </span>
              <span className="op-animate-float-medium absolute right-2 top-14 grid h-11 w-11 place-items-center rounded-2xl bg-base-100 shadow-lg">
                <i className="fa-light fa-envelope text-lg text-success" />
              </span>
              <img
                src={login_img}
                alt="Illustration of a person at a desk"
                className="relative z-[1] w-full drop-shadow-2xl"
              />
            </div>
          </div>
        )}

        <div className="flex w-full flex-col justify-center px-6 py-10 sm:px-12 md:w-1/2 lg:px-20">
          <div className="mx-auto w-full max-w-sm">
            {state.hideNav && (
              <div className="mb-8 flex items-center gap-2.5">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary shadow-md">
                  <i className="fa-light fa-signature text-lg text-primary-content" />
                </div>
                <span className="text-lg font-bold tracking-tight text-base-content">
                  sign.toowix.com
                </span>
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <h1 className="text-[28px] font-semibold text-base-content">{t("welcome")}</h1>
              <p className="mt-1 text-xs text-base-content/60">
                {t("reset-password-alert-3")}
              </p>

              <div className="mt-6">
                <label className="block text-xs font-medium text-base-content/70">
                  {t("email")}
                </label>
                <input
                  type="email"
                  name="email"
                  className="op-input op-input-bordered mt-1 w-full text-sm focus:outline-none hover:border-base-content"
                  value={state.email}
                  onChange={handleChange}
                  onInvalid={(e) =>
                    e.target.setCustomValidity(t("input-required"))
                  }
                  onInput={(e) => e.target.setCustomValidity("")}
                  required
                />
              </div>

              <button type="submit" className="op-btn op-btn-primary mt-6 w-full">
                {t("submit")}
              </button>
              <button
                type="button"
                onClick={() => navigate("/", { replace: true })}
                className="op-btn op-btn-ghost mt-2 w-full"
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
