import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import axios from "axios";
import {
  emailRegex,
} from "../constant/const";
import {
  contractUsers,
  saveLanguageInLocal
} from "../constant/Utils";
import logo from "../assets/images/logo.png";
import toowixLogo from "../assets/images/toowix-logo-white.svg";
import { appInfo } from "../constant/appinfo";
import Parse from "parse";
import { useTranslation } from "react-i18next";
import SelectLanguage from "../components/pdf/SelectLanguage";
import LoaderWithMsg from "../primitives/LoaderWithMsg";
import Loader from "../primitives/Loader";
import Alert from "../primitives/Alert";
import AuthIllustration from "../components/AuthIllustration";
import { useWindowSize } from "../hook/useWindowSize";

function GuestLogin() {
  const { t, i18n } = useTranslation();
  const { id, userMail, contactBookId, base64url } = useParams();
  const navigate = useNavigate();
  const { width } = useWindowSize();
  const [email, setEmail] = useState(
    userMail?.toLowerCase()?.replace(/\s/g, "")
  );
  const [OTP, setOTP] = useState("");
  const [EnterOTP, setEnterOtp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isLoading, setIsLoading] = useState({
    isLoad: true,
    message: t("loading-mssg")
  });
  const [appLogo, setAppLogo] = useState("");
  const [documentId, setDocumentId] = useState(id);
  const [contactId, setContactId] = useState(contactBookId);
  const [sendmail, setSendmail] = useState();
  const [contact, setContact] = useState({
    name: "",
    phone: "",
    email: "",
    jobTitle: "",
    company: ""
  });
  const [isOptionalDetails, setIsOptionalDetails] = useState(false);
  const [otpError, setOtpError] = useState("");
  const [toast, setToast] = useState({ type: "", msg: "" });

  const showToast = (type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast({ type: "", msg: "" }), 2500);
  };

  const navigateToDoc = async (docId, contactId) => {
    try {
      const docDetails = await Parse.Cloud.run("getDocument", {
        docId: docId
      });
      if (!docDetails.error) {
        if (sendmail === "false") {
          navigate(
            `/load/recipientSignPdf/${docId}/${contactId}?sendmail=${sendmail}`
          );
        } else {
          navigate(`/load/recipientSignPdf/${docId}/${contactId}`);
        }
        return true;
      } else {
        setIsLoading({ isLoad: false });
        return false;
      }
    } catch (err) {
      console.log("err while getting doc", err);
      return false;
    }
  };

  useEffect(() => {
    handleServerUrl();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Repoints this page (and the Parse SDK) at the company that actually owns
  // the document. `rootServer` already ends in a slash and looks like
  // https://host/app/ - the company's mount is that same path plus the slug.
  const pointAtOwningCompany = async (docId, rootServer, parseAppId) => {
    try {
      Parse.initialize(parseAppId);
      Parse.serverURL = rootServer;
      const res = await Parse.Cloud.run("resolvesignertenant", { docId });
      if (res?.subdomain) {
        const companyServer = `${rootServer.replace(/\/+$/, "")}/${res.subdomain}/`;
        localStorage.setItem("baseUrl", companyServer);
        localStorage.setItem("parseAppId", parseAppId);
        Parse.serverURL = companyServer;
      }
    } catch (err) {
      // Fall through on the root mount rather than blocking the signer - a
      // single-company deployment resolves to nothing and still works.
      console.log("could not resolve owning company", err);
    }
  };


  //function generate serverUrl and parseAppId from url and save it in local storage
  const handleServerUrl = async () => {
    // Prefer the deployment's configured logo; the bundled OpenSign mark is
    // only a fallback, and this page is the first thing an external signer
    // ever sees of the brand.
    setAppLogo(appInfo?.applogo || logo);
    const favicon = localStorage.getItem("favicon");

    localStorage.clear(); // Clears everything
    localStorage.setItem("favicon", favicon);
    localStorage.setItem("appname", "SignToowix");
    //save isGuestSigner true in local to handle login flow header in mobile view
    localStorage.setItem("isGuestSigner", true);
    saveLanguageInLocal(i18n);
    const parseId = appInfo.appId;
    const newServer = `${appInfo.baseUrl}/`;
    localStorage.setItem("baseUrl", newServer);
    localStorage.setItem("parseAppId", parseId);
    //this condition is used decode base64 to string and get userEmail,documentId, contactBoookId data.
    if (!id) {
      //`atob` function is used to decode base64
      const decodebase64 = atob(base64url);
      //split url in array from '/'
      const checkSplit = decodebase64.split("/");
      // The emailed link carries no company, so this page starts out pointed
      // at the root instance - whose database holds no documents. Ask the
      // root which company owns this document and re-point Parse at that
      // company's mount before anything else runs, otherwise every lookup
      // below misses and the signer is dead-ended on an OTP prompt.
      await pointAtOwningCompany(checkSplit[0], newServer, parseId);
      setDocumentId(checkSplit[0]);
      setContact((prev) => ({
        ...prev,
        email: checkSplit[1]?.toLowerCase()?.replace(/\s/g, "")
      }));
      setEmail(checkSplit[1]?.toLowerCase()?.replace(/\s/g, ""));
      const contactId = checkSplit?.[2];
      setSendmail(checkSplit[3]);
      if (!contactId) {
        const params = {
          email: checkSplit[1]?.toLowerCase()?.replace(/\s/g, ""),
          docId: checkSplit[0]
        };
        try {
          const linkContactRes = await Parse.Cloud.run(
            "linkcontacttodoc",
            params
          );
          setContactId(linkContactRes?.contactId);
          setIsLoading({ isLoad: false });
        } catch (err) {
          setIsLoading({ isLoad: false });
          console.log("Err in link ext contact", err);
        }
      } else {
        setContactId(checkSplit[2]);
        setIsLoading({ isLoad: false });
      }
    }
  };

  //send email OTP function
  const SendOtp = async (targetContactId = contactId) => {
    setLoading(true);
    setEmail(email?.toLowerCase()?.replace(/\s/g, ""));
    try {
      const params = {
        email: email?.toLowerCase()?.replace(/\s/g, "")?.toString(),
        docId: documentId,
        contactId: targetContactId,
      };
      const Otp = await Parse.Cloud.run("SendOTPMailV1", params);
      if (Otp) {
        setLoading(false);
        setEnterOtp(true);
      }
    } catch (error) {
      showToast("danger", t("something-went-wrong-mssg"));
      setLoading(false);
    }
  };

  const handleSendOTPBtn = async (e) => {
    e.preventDefault();
    await SendOtp();
  };

  //verify OTP send on via email
  const VerifyOTP = async (e) => {
    e.preventDefault();
    const serverUrl =
      localStorage.getItem("baseUrl") && localStorage.getItem("baseUrl");
    const parseId =
      localStorage.getItem("parseAppId") && localStorage.getItem("parseAppId");
    if (OTP) {
      setLoading(true);
      setOtpError("");
      try {
        let url = `${serverUrl}functions/AuthLoginAsMail`;
        const headers = {
          "Content-Type": "application/json",
          "X-Parse-Application-Id": parseId
        };
        let body = {
          email: email?.toLowerCase()?.replace(/\s/g, ""),
          otp: OTP,
          docId: documentId,
          contactId: contactId
        };
        let user = await axios.post(url, body, { headers: headers });
        if (user.data.result === "Invalid Otp") {
          setOtpError(t("invalid-otp"));
          setLoading(false);
        } else if (user.data.result === "user not found!") {
          setOtpError(t("user-not-found"));
          setLoading(false);
        } else {
          let _user = user.data.result;
          await Parse.User.become(_user.sessionToken);
          const parseId = localStorage.getItem("parseAppId");
          if (_user) {
            localStorage.setItem("accesstoken", _user?.sessionToken);
            localStorage.setItem("UserInformation", JSON.stringify(_user));
            localStorage.setItem(
              `Parse/${parseId}/currentUser`,
              JSON.stringify(_user)
            );
          }
          const contractUserDetails = await contractUsers();
          if (contractUserDetails && contractUserDetails.length > 0) {
            localStorage.setItem(
              "Extand_Class",
              JSON.stringify(contractUserDetails)
            );
          }
          setLoading(false);
          if (sendmail === "false") {
            navigate(
              `/load/recipientSignPdf/${documentId}/${contactId}?sendmail=${sendmail}`
            );
          } else {
            navigate(`/load/recipientSignPdf/${documentId}/${contactId}`);
          }
        }
      } catch (error) {
        console.log("err ", error);
        setLoading(false);
      }
    } else {
      setOtpError(t("enter-otp-alert"));
    }
  };


  const handleUserData = async (e) => {
    e.preventDefault();
    if (!emailRegex.test(contact.email?.toLowerCase()?.replace(/\s/g, ""))) {
      showToast("danger", t("valid-email-alert"));
    } else {
      const params = { ...contact, docId: documentId };
      try {
        setLoading(true);
        const linkContactRes = await Parse.Cloud.run(
          "linkcontacttodoc",
          params
        );
        setContactId(linkContactRes.contactId);
        await SendOtp(linkContactRes.contactId);
      } catch (err) {
        setLoading(false);
        showToast("danger", t("something-went-wrong-mssg"));
        console.log("Err in link ext contact", err);
      }
    }
  };

  const handleInputChange = (e) => {
    if (e.target.name === "email") {
      setContact((prev) => ({
        ...prev,
        [e.target.name]: e.target.value?.toLowerCase()?.replace(/\s/g, "")
      }));
    } else {
      setContact((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    }
  };

  // Same tenant-logo-aware fallback GuestLogin has always used: an actual
  // configured deployment logo takes over the whole brand slot; only the
  // "we have nothing configured" case falls back to the SignToowix mark.
  const hasTenantLogo = Boolean(appLogo) && appLogo !== logo;

  return (
    <div>
      {toast.msg && <Alert type={toast.type}>{toast.msg}</Alert>}

      {isLoading.isLoad ? (
        <LoaderWithMsg isLoading={isLoading} />
      ) : (
        <div
          aria-label="Guest signer authentication"
          role="region"
          className="flex h-[100dvh] w-full items-center justify-center overflow-y-auto bg-[#F7F8FC] p-3 font-['Poppins'] sm:h-auto sm:min-h-screen sm:overflow-visible sm:p-8"
        >
          <div className="op-auth-card relative m-auto flex w-full max-w-5xl overflow-hidden rounded-[26px] bg-white shadow-[0_40px_80px_-30px_rgba(70,60,160,0.28)]">
            {/* Left hero panel - identical structure/tokens to Login/Register/ResetPassword */}
            {width >= 768 && (
              <div className="relative hidden w-[44%] shrink-0 flex-col overflow-hidden rounded-l-[26px] bg-gradient-to-br from-[#0B3D73] to-[#002864] px-8 py-[34px] md:flex">
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
                    {t("welcome")}
                  </h2>
                  <p className="mt-3 text-sm text-white/90">
                    {t("get-otp-alert")}
                  </p>
                </div>

                <div className="relative z-20 mx-auto mt-auto w-full max-w-[280px]">
                  <span className="op-animate-blob absolute -left-6 top-6 h-20 w-20 rounded-full bg-white/20 blur-xl" />
                  <span className="op-animate-blob absolute -right-4 bottom-4 h-24 w-24 rounded-full bg-white/10 blur-2xl" />
                  <AuthIllustration className="relative z-[1] w-full drop-shadow-xl" />
                </div>
              </div>
            )}

            {/* Right form panel */}
            <div className="relative z-20 flex w-full flex-col bg-white px-4 py-4 sm:px-10 sm:py-10 md:w-[56%] md:-ml-[30px] md:rounded-[34px_16px_16px_34px] md:px-[46px] md:py-[38px] lg:px-[46px]">
              {width >= 768 && (
                <div className="absolute right-[34px] top-[26px]">
                  <SelectLanguage isProfile isLoginStyle />
                </div>
              )}
              <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-1 sm:py-4">
                {/* Brand/tenant logo header - mobile only, exactly like Login:
                    the left hero panel already carries the SignToowix mark on
                    desktop, so repeating it here would show it twice on the
                    same screen. A configured tenant logo still takes the slot
                    on mobile; otherwise the same white SignToowix mark Login
                    uses in its own mobile header. */}
                {width < 768 && (
                  <div className="mb-4 flex items-center gap-2.5 sm:mb-8">
                    {hasTenantLogo ? (
                      <div className="h-9 max-w-[200px] overflow-hidden">
                        <img src={appLogo} alt="logo" className="h-full object-contain" />
                      </div>
                    ) : (
                      <>
                        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#0B3D73]">
                          <img src={toowixLogo} alt="SignToowix" className="h-6 w-6 object-contain" />
                        </div>
                        <span className="text-lg font-bold tracking-tight text-gray-800">
                          SignToowix
                        </span>
                      </>
                    )}
                  </div>
                )}

                {EnterOTP ? (
                  loading ? (
                    <div className="flex h-[220px] items-center justify-center">
                      <Loader />
                    </div>
                  ) : (
                    <form onSubmit={VerifyOTP} aria-label={t("otp-verification")}>
                      <h1 className="op-stagger-item text-2xl font-bold text-gray-800 tracking-tight" style={{ animationDelay: "0ms" }}>
                        {t("otp-verification")}
                      </h1>
                      <p className="op-stagger-item mt-1 text-xs text-gray-400 font-medium" style={{ animationDelay: "40ms" }}>
                        {t("get-otp-alert")}
                      </p>

                      <div className="op-stagger-item mt-8" style={{ animationDelay: "90ms" }}>
                        <label className="sr-only" htmlFor="guestDocOtp">
                          {t("enter-otp")}
                        </label>
                        <input
                          id="guestDocOtp"
                          onInvalid={(e) =>
                            e.target.setCustomValidity(t("input-required"))
                          }
                          onInput={(e) => e.target.setCustomValidity("")}
                          required
                          type="tel"
                          inputMode="numeric"
                          pattern="[0-9]{6}"
                          maxLength={6}
                          autoFocus
                          className="w-full rounded-full border border-gray-300 bg-white text-gray-800 placeholder:text-gray-400 focus:border-[#0B3D73] focus:ring-2 focus:ring-[#0B3D73]/15 focus:outline-none transition-colors py-3 pl-5 pr-5 text-[15px] tracking-[4px] placeholder:tracking-normal"
                          placeholder={t("otp-placeholder")}
                          value={OTP}
                          onChange={(e) => {
                            setOTP(e.target.value.replace(/\D/g, ""));
                            setOtpError("");
                          }}
                        />
                        {otpError && (
                          <p className="mt-2 text-xs text-red-600">{otpError}</p>
                        )}
                        <div className="mt-3 flex items-center justify-between text-xs">
                          <span className="text-gray-400">{t("otp-expires-10-min")}</span>
                          <button
                            type="button"
                            onClick={(e) => handleSendOTPBtn(e)}
                            disabled={loading}
                            className="font-semibold text-[#0B3D73] hover:underline disabled:text-gray-300 disabled:no-underline disabled:cursor-not-allowed"
                          >
                            {t("resend")}
                          </button>
                        </div>
                      </div>

                      <button
                        type="submit"
                        className="op-stagger-item mt-3 sm:mt-6 w-full rounded-full bg-gradient-to-r from-[#1B4F91] to-[#0B3D73] py-3 sm:py-[15px] px-6 text-[15px] font-bold text-white transition-opacity duration-150 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[#0B3D73] focus:ring-offset-2 disabled:opacity-60"
                        style={{ animationDelay: "140ms" }}
                        disabled={loading}
                      >
                        {loading ? t("loading") : t("verify")}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEnterOtp(false);
                          setOTP("");
                          setOtpError("");
                        }}
                        className="op-stagger-item mt-3 w-full text-center text-xs text-gray-500 hover:underline font-semibold"
                        style={{ animationDelay: "180ms" }}
                      >
                        {t("cancel")}
                      </button>
                    </form>
                  )
                ) : contactId ? (
                  <div className="w-full">
                    <h1 className="op-stagger-item text-2xl font-bold text-gray-800 tracking-tight" style={{ animationDelay: "0ms" }}>
                      {t("welcome")}
                    </h1>
                    <p className="op-stagger-item mt-1 text-xs text-gray-400 font-medium" style={{ animationDelay: "40ms" }}>
                      {t("get-otp-alert")}
                    </p>
                    <div className="op-stagger-item mt-4 sm:mt-8" style={{ animationDelay: "90ms" }}>
                      <label className="sr-only" htmlFor="guestEmail">
                        {t("email")}
                      </label>
                      <input
                        id="guestEmail"
                        type="email"
                        name="email"
                        value={email}
                        className="w-full rounded-full border border-gray-300 bg-gray-50 text-gray-700 px-5 py-3 text-[15px] disabled:opacity-100"
                        disabled
                      />
                    </div>
                    <button
                      className="op-stagger-item mt-3 sm:mt-6 w-full rounded-full bg-gradient-to-r from-[#1B4F91] to-[#0B3D73] py-3 sm:py-[15px] px-6 text-[15px] font-bold text-white transition-opacity duration-150 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[#0B3D73] focus:ring-offset-2 disabled:opacity-60"
                      style={{ animationDelay: "140ms" }}
                      onClick={(e) => {
                        e.preventDefault();
                        SendOtp();
                      }}
                      disabled={loading}
                    >
                      {loading ? t("loading") : t("get-verification-code")}
                    </button>
                  </div>
                ) : (
                  <div className="w-full">
                    <h1 className="op-stagger-item text-2xl font-bold text-gray-800 tracking-tight" style={{ animationDelay: "0ms" }}>
                      {t("welcome")}
                    </h1>
                    <p className="op-stagger-item mt-1 text-xs text-gray-400 font-medium" style={{ animationDelay: "40ms" }}>
                      {t("provide-your-details")}
                    </p>
                    <form className="mt-4 sm:mt-8" onSubmit={handleUserData}>
                      <div className="op-stagger-item mb-3" style={{ animationDelay: "90ms" }}>
                        <label
                          htmlFor="name"
                          className="block text-xs font-semibold text-gray-600 mb-1.5"
                        >
                          {t("name")}
                          <span className="text-red-500"> *</span>
                        </label>
                        <input
                          type="text"
                          name="name"
                          value={contact.name}
                          onChange={handleInputChange}
                          className="w-full rounded-full border border-gray-300 bg-white text-gray-800 placeholder:text-gray-400 focus:border-[#0B3D73] focus:ring-2 focus:ring-[#0B3D73]/15 focus:outline-none transition-colors px-5 py-3 text-[15px]"
                          disabled={loading}
                          onInvalid={(e) =>
                            e.target.setCustomValidity(t("input-required"))
                          }
                          onInput={(e) => e.target.setCustomValidity("")}
                          placeholder={t("enter-name")}
                          required
                        />
                      </div>
                      <div className="op-stagger-item mb-3" style={{ animationDelay: "140ms" }}>
                        <label
                          htmlFor="detailsEmail"
                          className="block text-xs font-semibold text-gray-600 mb-1.5"
                        >
                          {t("email")}
                          <span className="text-red-500"> *</span>
                        </label>
                        <input
                          id="detailsEmail"
                          type="email"
                          name="email"
                          value={contact.email}
                          onChange={handleInputChange}
                          className="w-full rounded-full border border-gray-300 bg-gray-50 text-gray-700 px-5 py-3 text-[15px] disabled:opacity-100"
                          placeholder={t("enter-email")}
                          required
                          disabled
                        />
                      </div>
                      {isOptionalDetails && (
                        <>
                          <div className="mb-3">
                            <label
                              htmlFor="phone"
                              className="block text-xs font-semibold text-gray-600 mb-1.5"
                            >
                              {t("phone")}
                            </label>
                            <input
                              type="text"
                              name="phone"
                              value={contact.phone}
                              onChange={handleInputChange}
                              className="w-full rounded-full border border-gray-300 bg-white text-gray-800 placeholder:text-gray-400 focus:border-[#0B3D73] focus:ring-2 focus:ring-[#0B3D73]/15 focus:outline-none transition-colors px-5 py-3 text-[15px]"
                              disabled={loading}
                              placeholder={t("phone-optional")}
                            />
                          </div>
                          <div className="mb-3">
                            <label
                              htmlFor="company"
                              className="block text-xs font-semibold text-gray-600 mb-1.5"
                            >
                              {t("company")}
                            </label>
                            <input
                              type="text"
                              id="company"
                              name="company"
                              value={contact.company}
                              onChange={handleInputChange}
                              className="w-full rounded-full border border-gray-300 bg-white text-gray-800 placeholder:text-gray-400 focus:border-[#0B3D73] focus:ring-2 focus:ring-[#0B3D73]/15 focus:outline-none transition-colors px-5 py-3 text-[15px]"
                              disabled={loading}
                              placeholder={t("phone-optional")}
                            />
                          </div>
                          <div className="mb-3">
                            <label
                              htmlFor="jobTitle"
                              className="block text-xs font-semibold text-gray-600 mb-1.5"
                            >
                              {t("job-title")}
                            </label>
                            <input
                              type="text"
                              id="jobTitle"
                              name="jobTitle"
                              value={contact.jobTitle}
                              onChange={handleInputChange}
                              className="w-full rounded-full border border-gray-300 bg-white text-gray-800 placeholder:text-gray-400 focus:border-[#0B3D73] focus:ring-2 focus:ring-[#0B3D73]/15 focus:outline-none transition-colors px-5 py-3 text-[15px]"
                              disabled={loading}
                              placeholder={t("phone-optional")}
                            />
                          </div>
                        </>
                      )}
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          setIsOptionalDetails(!isOptionalDetails);
                        }}
                        className="op-stagger-item text-xs font-semibold text-gray-400 no-underline hover:underline hover:text-gray-600 focus:outline-none max-w-fit"
                        style={{ animationDelay: "190ms" }}
                      >
                        {isOptionalDetails
                          ? t("hide-optional-details")
                          : t("optional-details")}
                      </button>
                      <button
                        type="submit"
                        className="op-stagger-item mt-3 sm:mt-6 w-full rounded-full bg-gradient-to-r from-[#1B4F91] to-[#0B3D73] py-3 sm:py-[15px] px-6 text-[15px] font-bold text-white transition-opacity duration-150 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[#0B3D73] focus:ring-offset-2 disabled:opacity-60"
                        style={{ animationDelay: "240ms" }}
                        disabled={loading}
                      >
                        {loading ? t("loading") : t("next")}
                      </button>
                    </form>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default GuestLogin;
