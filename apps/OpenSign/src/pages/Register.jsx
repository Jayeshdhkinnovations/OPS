import { useState, useEffect } from "react";
import Parse from "parse";
import { NavLink, useNavigate } from "react-router";
import { useAuthNavigate } from "../hook/useAuthNavigate";
import { emailRegex } from "../constant/const";
import Loader from "../primitives/Loader";
import AuthIllustration from "../components/AuthIllustration";
import { useWindowSize } from "../hook/useWindowSize";
import SelectLanguage from "../components/pdf/SelectLanguage";
import { useTranslation } from "react-i18next";

// Deliberately NOT reusing AddAdmin.jsx's flow - that one creates a real
// _User immediately. This form submits to submitapproval instead, which
// only stores a pending request; nothing real gets created until a Super
// Admin approves it (see Approval page in SuperAdminConsole).
function Register() {
  const navigate = useNavigate();
  const authNavigate = useAuthNavigate();
  const { t } = useTranslation();
  const { width } = useWindowSize();
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    companyName: "",
    jobTitle: "",
    password: "",
    confirmPassword: "",
    maxUsers: 5,
  });
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);

  useEffect(() => {
    // Clear any stale session token from localStorage
    Parse.User.logOut().catch(() => { });
  }, []);

  function handleChange(e) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!emailRegex.test(form.email)) {
      setError("Enter a valid email address.");
      return;
    }
    if (!form.password || form.password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (!form.maxUsers || Number(form.maxUsers) < 1) {
      setError("Max users must be at least 1.");
      return;
    }
    setLoading(true);
    try {
      await Parse.Cloud.run("submitapproval", form);
      navigate("/waiting-approval", { state: { email: form.email } });
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-[#F7F8FC] p-4 font-['Poppins'] sm:p-8">
      {loading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <Loader />
        </div>
      )}

      <div className="op-auth-card relative flex w-full max-w-5xl overflow-hidden rounded-[26px] bg-white shadow-[0_40px_80px_-30px_rgba(70,60,160,0.28)]">
        {/* Left hero panel */}
        {width >= 768 && (
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
          {width >= 768 && (
            <div className="absolute right-[34px] top-[26px]">
              <SelectLanguage isProfile isLoginStyle />
            </div>
          )}
          <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-4">
            {width < 768 && (
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

            <h1 className="op-stagger-item text-2xl font-bold text-gray-800 tracking-tight" style={{ animationDelay: "0ms" }}>{t("create-account")}</h1>
            <p className="op-stagger-item mt-1 text-xs text-gray-400 font-medium" style={{ animationDelay: "40ms" }}>
              Submitted for approval - you&apos;ll get access once a Super Admin approves it.
            </p>

            {error && (
              <div className="bg-red-50 text-red-600 rounded-lg p-3 mt-4 text-xs font-semibold border border-red-100">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
              <div className="op-stagger-item grid grid-cols-2 gap-4" style={{ animationDelay: "90ms" }}>
                <div>
                  <label className="sr-only" htmlFor="name">{t("name")}</label>
                  <input
                    id="name"
                    name="name"
                    placeholder={t("name")}
                    required
                    value={form.name}
                    onChange={handleChange}
                    className="w-full border-0 border-b border-gray-200 bg-transparent px-0.5 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 focus:border-[#0B3D73] focus:outline-none focus:ring-0 transition-colors"
                  />
                </div>
                <div>
                  <label className="sr-only" htmlFor="email">{t("email")}</label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    placeholder={t("email")}
                    required
                    value={form.email}
                    onChange={handleChange}
                    className="w-full border-0 border-b border-gray-200 bg-transparent px-0.5 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 focus:border-[#0B3D73] focus:outline-none focus:ring-0 transition-colors"
                  />
                </div>
              </div>
              <div className="op-stagger-item grid grid-cols-2 gap-4" style={{ animationDelay: "140ms" }}>
                <div>
                  <label className="sr-only" htmlFor="phone">{t("phone")}</label>
                  <input
                    id="phone"
                    name="phone"
                    placeholder={t("phone")}
                    value={form.phone}
                    onChange={handleChange}
                    className="w-full border-0 border-b border-gray-200 bg-transparent px-0.5 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 focus:border-[#0B3D73] focus:outline-none focus:ring-0 transition-colors"
                  />
                </div>
                <div>
                  <label className="sr-only" htmlFor="jobTitle">{t("job-title")}</label>
                  <input
                    id="jobTitle"
                    name="jobTitle"
                    placeholder={t("job-title")}
                    value={form.jobTitle}
                    onChange={handleChange}
                    className="w-full border-0 border-b border-gray-200 bg-transparent px-0.5 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 focus:border-[#0B3D73] focus:outline-none focus:ring-0 transition-colors"
                  />
                </div>
              </div>
              <div className="op-stagger-item grid grid-cols-2 gap-4" style={{ animationDelay: "190ms" }}>
                <div>
                  <label className="sr-only" htmlFor="companyName">{t("company")}</label>
                  <input
                    id="companyName"
                    name="companyName"
                    placeholder={t("company")}
                    required
                    value={form.companyName}
                    onChange={handleChange}
                    className="w-full border-0 border-b border-gray-200 bg-transparent px-0.5 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 focus:border-[#0B3D73] focus:outline-none focus:ring-0 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1" htmlFor="maxUsers">
                    Max Users
                  </label>
                  <input
                    id="maxUsers"
                    name="maxUsers"
                    type="number"
                    min="1"
                    max="1000"
                    placeholder="5"
                    required
                    value={form.maxUsers}
                    onChange={handleChange}
                    className="w-full border-0 border-b border-gray-200 bg-transparent px-0.5 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 focus:border-[#0B3D73] focus:outline-none focus:ring-0 transition-colors"
                  />
                </div>
              </div>
              <div className="op-stagger-item grid grid-cols-2 gap-4" style={{ animationDelay: "240ms" }}>
                <div>
                  <label className="sr-only" htmlFor="password">{t("password")}</label>
                  <div className="relative">
                    <input
                      id="password"
                      name="password"
                      type={passwordVisible ? "text" : "password"}
                      placeholder={t("password")}
                      required
                      value={form.password}
                      onChange={handleChange}
                      className="w-full border-0 border-b border-gray-200 bg-transparent px-0.5 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 focus:border-[#0B3D73] focus:outline-none focus:ring-0 transition-colors"
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
                  <label className="sr-only" htmlFor="confirmPassword">{t("confirm-password")}</label>
                  <div className="relative">
                    <input
                      id="confirmPassword"
                      name="confirmPassword"
                      type={confirmPasswordVisible ? "text" : "password"}
                      placeholder={t("confirm-password")}
                      required
                      value={form.confirmPassword}
                      onChange={handleChange}
                      className="w-full border-0 border-b border-gray-200 bg-transparent px-0.5 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 focus:border-[#0B3D73] focus:outline-none focus:ring-0 transition-colors"
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

              <div className="op-stagger-item mt-2 flex items-center gap-2" style={{ animationDelay: "290ms" }}>
                <input
                  type="checkbox"
                  id="agreeTerms"
                  className="w-4 h-4 text-[#0B3D73] border-gray-300 rounded focus:ring-[#0B3D73] accent-[#0B3D73] cursor-pointer"
                  checked={agreeTerms}
                  onChange={(e) => setAgreeTerms(e.target.checked)}
                  required
                />
                <label htmlFor="agreeTerms" className="cursor-pointer text-xs text-gray-500 font-semibold selection:bg-transparent select-none">
                  I agree to the{" "}
                  <a
                    href="https://www.opensignlabs.com/terms-and-conditions"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#0B3D73] hover:underline"
                  >
                    Terms
                  </a>{" "}
                  and{" "}
                  <a
                    href="https://www.opensignlabs.com/privacy-policy"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#0B3D73] hover:underline"
                  >
                    Privacy Policy
                  </a>
                </label>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="op-stagger-item mt-4 w-full rounded-full bg-gradient-to-r from-[#1B4F91] to-[#0B3D73] py-[15px] px-6 text-[15px] font-bold text-white shadow-[0_12px_22px_-8px_rgba(91,94,247,0.7)] transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[0_16px_26px_-8px_rgba(91,94,247,0.8)] active:translate-y-0 focus:outline-none focus:ring-2 focus:ring-[#0B3D73] focus:ring-offset-2"
                style={{ animationDelay: "330ms" }}
              >
                {t("create-account")}
              </button>
            </form>

            <p className="op-stagger-item mt-8 text-center text-xs text-gray-500 font-medium" style={{ animationDelay: "370ms" }}>
              Already have an account?{" "}
              <NavLink
                to="/login"
                onClick={(e) => {
                  e.preventDefault();
                  authNavigate("/login");
                }}
                className="text-[#0B3D73] font-bold hover:underline"
              >
                {t("login")}
              </NavLink>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Register;
