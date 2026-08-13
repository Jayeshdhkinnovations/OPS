import { useState, useEffect } from "react";
import toowixLogo from "../assets/images/toowix-logo-white.svg";
import Parse from "parse";
import { NavLink, useNavigate } from "react-router";
import { useAuthNavigate } from "../hook/useAuthNavigate";
import { emailRegex } from "../constant/const";
import { SEAT_TIERS, DEFAULT_SEAT_TIER } from "../constant/seatTiers";
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
    maxUsers: DEFAULT_SEAT_TIER,
  });
  const [signupType, setSignupType] = useState("myself"); // "myself" | "team"
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);

  const confirmHasError =
    form.confirmPassword.length > 0 && form.password !== form.confirmPassword;

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
    if (signupType === "team" && (!form.maxUsers || Number(form.maxUsers) < 1)) {
      setError("Max users must be at least 1.");
      return;
    }
    setLoading(true);
    try {
      await Parse.Cloud.run("submitapproval", {
        ...form,
        maxUsers: signupType === "team" ? form.maxUsers : 1,
      });
      navigate("/waiting-approval", { state: { email: form.email } });
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-[100dvh] w-full items-center justify-center overflow-y-auto bg-[#F7F8FC] p-3 font-['Poppins'] sm:h-auto sm:min-h-screen sm:overflow-visible sm:p-8">
      {loading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <Loader />
        </div>
      )}

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
            negative margin + large left corner radius, so the seam reads as
            one continuous curve instead of a straight line. */}
        <div className="relative z-20 flex w-full flex-col bg-white px-4 py-4 sm:px-10 sm:py-10 md:w-[56%] md:-ml-[30px] md:rounded-[34px_16px_16px_34px] md:px-[46px] md:py-[38px] lg:px-[46px]">
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

            <h1 className="op-stagger-item text-2xl font-bold text-gray-800 tracking-tight" style={{ animationDelay: "0ms" }}>{t("create-account")}</h1>
            <p className="op-stagger-item mt-1 text-xs text-gray-400 font-medium" style={{ animationDelay: "40ms" }}>
              Submitted for approval - you&apos;ll get access once a Super Admin approves it.
            </p>

            {error && (
              <div className="bg-red-50 text-red-600 rounded-lg p-3 mt-4 text-xs font-semibold border border-red-100">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-2.5 sm:mt-6 sm:gap-4">
              <div className="op-stagger-item flex flex-col gap-2.5 sm:gap-4" style={{ animationDelay: "90ms" }}>
                <div>
                  <label className="sr-only" htmlFor="name">{t("name")}</label>
                  <input
                    id="name"
                    name="name"
                    placeholder={t("name")}
                    required
                    value={form.name}
                    onChange={handleChange}
                    className="w-full rounded-full border border-gray-300 bg-white text-gray-800 placeholder:text-gray-400 focus:border-[#0B3D73] focus:ring-2 focus:ring-[#0B3D73]/15 focus:outline-none transition-colors px-5 py-2 text-sm sm:py-2.5"
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
                    className="w-full rounded-full border border-gray-300 bg-white text-gray-800 placeholder:text-gray-400 focus:border-[#0B3D73] focus:ring-2 focus:ring-[#0B3D73]/15 focus:outline-none transition-colors px-5 py-2 text-sm sm:py-2.5"
                  />
                </div>
              </div>
              <div className="op-stagger-item grid grid-cols-2 gap-2.5 sm:gap-4" style={{ animationDelay: "140ms" }}>
                <div>
                  <label className="sr-only" htmlFor="phone">{t("phone")}</label>
                  <input
                    id="phone"
                    name="phone"
                    placeholder={t("phone")}
                    value={form.phone}
                    onChange={handleChange}
                    className="w-full rounded-full border border-gray-300 bg-white text-gray-800 placeholder:text-gray-400 focus:border-[#0B3D73] focus:ring-2 focus:ring-[#0B3D73]/15 focus:outline-none transition-colors px-5 py-2 text-sm sm:py-2.5"
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
                    className="w-full rounded-full border border-gray-300 bg-white text-gray-800 placeholder:text-gray-400 focus:border-[#0B3D73] focus:ring-2 focus:ring-[#0B3D73]/15 focus:outline-none transition-colors px-5 py-2 text-sm sm:py-2.5"
                  />
                </div>
              </div>
              <div className="op-stagger-item" style={{ animationDelay: "190ms" }}>
                <label className="sr-only" htmlFor="companyName">{t("company")}</label>
                <input
                  id="companyName"
                  name="companyName"
                  placeholder={t("company")}
                  required
                  value={form.companyName}
                  onChange={handleChange}
                  className="w-full rounded-full border border-gray-300 bg-white text-gray-800 placeholder:text-gray-400 focus:border-[#0B3D73] focus:ring-2 focus:ring-[#0B3D73]/15 focus:outline-none transition-colors px-5 py-2 text-sm sm:py-2.5"
                />
              </div>

              <div className="op-stagger-item flex items-center gap-6 px-1" style={{ animationDelay: "215ms" }}>
                <label className="flex items-center gap-2 text-sm text-gray-700 font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={signupType === "myself"}
                    onChange={() => setSignupType("myself")}
                    className="h-4 w-4 rounded border-gray-300 text-[#0B3D73] focus:ring-[#0B3D73]/30"
                  />
                  Myself
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700 font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={signupType === "team"}
                    onChange={() => setSignupType("team")}
                    className="h-4 w-4 rounded border-gray-300 text-[#0B3D73] focus:ring-[#0B3D73]/30"
                  />
                  Team
                </label>
              </div>

              {signupType === "team" && (
                <div className="op-stagger-item" style={{ animationDelay: "225ms" }}>
                  <label className="sr-only" htmlFor="maxUsers">Max Users</label>
                  {/* A fixed set of seat counts rather than a free number
                      input: every value here has to be provisioned on shared
                      hardware, so an open field invited requests (500, 1000)
                      that could never be honoured. */}
                  <select
                    id="maxUsers"
                    name="maxUsers"
                    required
                    value={form.maxUsers}
                    onChange={handleChange}
                    className="w-full appearance-none rounded-full border border-gray-300 bg-white text-gray-800 focus:border-[#0B3D73] focus:ring-2 focus:ring-[#0B3D73]/15 focus:outline-none transition-colors px-5 py-2 text-sm sm:py-2.5 bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%2016%2016%22%20fill%3D%22%239CA3AF%22%3E%3Cpath%20d%3D%22M4.5%206.5%208%2010l3.5-3.5z%22/%3E%3C/svg%3E')] bg-[length:16px_16px] bg-[right_1rem_center] bg-no-repeat pr-10"
                  >
                    {SEAT_TIERS.map((tier) => (
                      <option key={tier.value} value={tier.value}>
                        {tier.label} Users
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="op-stagger-item grid grid-cols-2 gap-2.5 sm:gap-4" style={{ animationDelay: "240ms" }}>
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
                      className="w-full rounded-full border border-gray-300 bg-white text-gray-800 placeholder:text-gray-400 focus:border-[#0B3D73] focus:ring-2 focus:ring-[#0B3D73]/15 focus:outline-none transition-colors px-5 py-2 text-sm sm:py-2.5"
                    />
                    <span
                      className="absolute right-4 top-1/2 -translate-y-1/2 cursor-pointer text-gray-400 hover:text-gray-600 transition-colors"
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
                      aria-invalid={confirmHasError}
                      aria-describedby="confirmPasswordStatus"
                      className={`w-full rounded-full border bg-white text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 transition-colors px-5 py-2 text-sm sm:py-2.5 ${
                        confirmHasError
                          ? "border-red-400 focus:border-red-500 focus:ring-red-500/15"
                          : "border-gray-300 focus:border-[#0B3D73] focus:ring-[#0B3D73]/15"
                      }`}
                    />
                    <span
                      className="absolute right-4 top-1/2 -translate-y-1/2 cursor-pointer text-gray-400 hover:text-gray-600 transition-colors"
                      onClick={() => setConfirmPasswordVisible(!confirmPasswordVisible)}
                    >
                      {confirmPasswordVisible ? (
                        <i className="fa-light fa-eye-slash text-base" />
                      ) : (
                        <i className="fa-light fa-eye text-base" />
                      )}
                    </span>
                  </div>
                  {confirmHasError && (
                    <p
                      id="confirmPasswordStatus"
                      aria-live="polite"
                      className="mt-1.5 pl-4 text-[11px] font-semibold text-red-500"
                    >
                      {t("password-not-match", "Passwords do not match")}
                    </p>
                  )}
                </div>
              </div>

              <div className="op-stagger-item mt-1 flex items-center gap-2 sm:mt-2" style={{ animationDelay: "290ms" }}>
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
                className="op-stagger-item mt-3 sm:mt-4 w-full rounded-full bg-gradient-to-r from-[#1B4F91] to-[#0B3D73] py-3 sm:py-[15px] px-6 text-[15px] font-bold text-white transition-opacity duration-150 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[#0B3D73] focus:ring-offset-2"
                style={{ animationDelay: "330ms" }}
              >
                {t("create-account")}
              </button>
            </form>

            <p className="op-stagger-item mt-4 sm:mt-8 text-center text-xs text-gray-500 font-medium" style={{ animationDelay: "370ms" }}>
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
