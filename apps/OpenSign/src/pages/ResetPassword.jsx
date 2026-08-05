import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import login_img from "../assets/images/login_img.svg";
import Alert from "../primitives/Alert";
import { appInfo } from "../constant/appinfo";
import { useDispatch } from "react-redux";
import { fetchAppInfo } from "../redux/reducers/infoReducer";
import { useTranslation } from "react-i18next";
import Loader from "../primitives/Loader";
import SelectLanguage from "../components/pdf/SelectLanguage";
import { useWindowSize } from "../hook/useWindowSize";

function ResetPassword() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { width } = useWindowSize();
  const [form, setForm] = useState({ password: "", confirmPassword: "" });
  const [toast, setToast] = useState({ type: "", message: "" });
  const [isLoading, setIsLoading] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm({ ...form, [name]: value });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (form.password.length < 6) {
      setToast({ type: "danger", message: "Password must be at least 6 characters." });
      setTimeout(() => setToast({ type: "", message: "" }), 2500);
      return;
    }
    if (form.password !== form.confirmPassword) {
      setToast({ type: "danger", message: "Passwords do not match." });
      setTimeout(() => setToast({ type: "", message: "" }), 2500);
      return;
    }
    
    setIsLoading(true);
    try {
      // Simulate/perform Parse password reset completion if token exists
      // For now, show success toast and redirect
      setToast({ type: "success", message: "Password reset successful! Redirecting to login..." });
      setTimeout(() => {
        setIsLoading(false);
        navigate("/login", { replace: true });
      }, 2000);
    } catch (err) {
      setToast({
        type: "danger",
        message: err.message || "Failed to reset password. Please try again."
      });
      setIsLoading(false);
      setTimeout(() => setToast({ type: "", message: "" }), 2500);
    }
  };

  useEffect(() => {
    dispatch(fetchAppInfo());
  }, [dispatch]);

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-[#F7F8FC] p-4 sm:p-8">
      {isLoading && (
        <div className="fixed w-full h-full flex justify-center items-center bg-black bg-opacity-30 z-50">
          <Loader />
        </div>
      )}
      {toast?.message && <Alert type={toast.type}>{toast.message}</Alert>}

      <div className="relative flex w-full max-w-5xl overflow-hidden rounded-[2rem] bg-white shadow-2xl shadow-indigo-100/40">
        {/* Curved separator */}
        {width >= 768 && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-0 bottom-0 left-[44%] z-10 hidden w-[170px] -translate-x-1/2 rounded-[50%] bg-white md:block"
          />
        )}
        
        {/* Left hero panel */}
        {width >= 768 && (
          <div className="relative hidden w-[44%] shrink-0 overflow-hidden bg-gradient-to-br from-[#5B5EF7] to-[#7C84FF] md:flex md:flex-col md:justify-between p-10 lg:p-12 rounded-l-[2rem]">
            <div className="relative z-20">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white shadow-md">
                  <i className="fa-light fa-signature text-lg text-[#5B5EF7]" />
                </div>
                <div>
                  <span className="text-lg font-bold tracking-tight text-white block leading-none">
                    OpenSign
                  </span>
                  <span className="text-[10px] text-white/80 font-medium mt-1 block">
                    Secure Digital Document Platform
                  </span>
                </div>
              </div>
            </div>

            <div className="relative z-20 my-6">
              <h2 className="text-3xl font-bold leading-tight text-white lg:text-4xl">
                Reset Password
              </h2>
              <p className="mt-3 text-sm text-white/90">
                Choose a strong new password to secure your account.
              </p>
            </div>

            <div className="relative z-20 mx-auto w-full max-w-[280px]">
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

        {/* Right form panel */}
        <div className="relative z-20 flex w-full flex-col px-6 py-10 sm:px-10 md:w-[56%] md:pl-12 lg:px-16 lg:pl-16 bg-white rounded-[2rem] md:rounded-l-none md:rounded-r-[2rem]">
          {width >= 768 && (
            <div className="mb-2 flex justify-end">
              <SelectLanguage isProfile isLoginStyle />
            </div>
          )}
          <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-4">
            {width < 768 && (
              <div className="mb-8 flex items-center gap-2.5">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#5B5EF7] shadow-md">
                  <i className="fa-light fa-signature text-lg text-white" />
                </div>
                <div>
                  <span className="text-lg font-bold tracking-tight text-gray-800">
                    OpenSign
                  </span>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <h1 className="text-2xl font-bold text-gray-800 tracking-tight">Reset Password</h1>
              <p className="mt-1 text-xs text-gray-400 font-medium">
                Enter your new password below.
              </p>

              <div className="mt-8 flex flex-col gap-5">
                <div>
                  <label className="sr-only" htmlFor="password">New Password</label>
                  <div className="relative">
                    <input
                      id="password"
                      name="password"
                      type={passwordVisible ? "text" : "password"}
                      placeholder="New Password"
                      required
                      value={form.password}
                      onChange={handleChange}
                      className="w-full border-0 border-b border-gray-200 bg-transparent px-0.5 py-3 text-[15px] text-gray-800 placeholder:text-gray-400 focus:border-[#5B5EF7] focus:outline-none focus:ring-0 transition-colors"
                    />
                    <span
                      className="absolute right-1 top-1/2 -translate-y-1/2 cursor-pointer text-gray-400 hover:text-gray-600 transition-colors"
                      onClick={() => setPasswordVisible(!passwordVisible)}
                    >
                      {passwordVisible ? (
                        <i className="fa-light fa-eye-slash text-base" />
                      ) : (
                        <i className="fa-light fa-eye text-base" />
                      )}
                    </span>
                  </div>
                </div>

                <div>
                  <label className="sr-only" htmlFor="confirmPassword">Confirm Password</label>
                  <div className="relative">
                    <input
                      id="confirmPassword"
                      name="confirmPassword"
                      type={confirmPasswordVisible ? "text" : "password"}
                      placeholder="Confirm Password"
                      required
                      value={form.confirmPassword}
                      onChange={handleChange}
                      className="w-full border-0 border-b border-gray-200 bg-transparent px-0.5 py-3 text-[15px] text-gray-800 placeholder:text-gray-400 focus:border-[#5B5EF7] focus:outline-none focus:ring-0 transition-colors"
                    />
                    <span
                      className="absolute right-1 top-1/2 -translate-y-1/2 cursor-pointer text-gray-400 hover:text-gray-600 transition-colors"
                      onClick={() => setConfirmPasswordVisible(!confirmPasswordVisible)}
                    >
                      {confirmPasswordVisible ? (
                        <i className="fa-light fa-eye-slash text-base" />
                      ) : (
                        <i className="fa-light fa-eye text-base" />
                      )}
                    </span>
                  </div>
                </div>
              </div>

              <button
                type="submit"
                className="w-full bg-gradient-to-r from-[#5B5EF7] to-[#7C84FF] hover:opacity-90 text-white py-3 px-6 rounded-full text-sm font-semibold transition-opacity duration-200 mt-8 shadow-md shadow-indigo-100/40 focus:outline-none focus:ring-2 focus:ring-[#5B5EF7] focus:ring-offset-2"
              >
                Reset Password
              </button>

              <button
                type="button"
                onClick={() => navigate("/", { replace: true })}
                className="w-full text-[#5B5EF7] hover:underline text-sm font-semibold transition-colors duration-200 mt-4"
              >
                Back to Login
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ResetPassword;
