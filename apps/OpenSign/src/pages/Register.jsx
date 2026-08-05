import { useState, useEffect } from "react";
import Parse from "parse";
import { NavLink, useNavigate } from "react-router";
import { appInfo } from "../constant/appinfo";
import { emailRegex } from "../constant/const";
import Loader from "../primitives/Loader";
import login_img from "../assets/images/login_img.svg";
import { useWindowSize } from "../hook/useWindowSize";

// Deliberately NOT reusing AddAdmin.jsx's flow - that one creates a real
// _User immediately. This form submits to submitapproval instead, which
// only stores a pending request; nothing real gets created until a Super
// Admin approves it (see Approval page in SuperAdminConsole).
function Register() {
  const navigate = useNavigate();
  const { width } = useWindowSize();
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    companyName: "",
    jobTitle: "",
    password: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // Clear any stale session token from localStorage
    Parse.User.logOut().catch(() => {});
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
    <div className="flex min-h-screen w-full bg-base-100">
      {loading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <Loader />
        </div>
      )}

      {/* Left hero panel - same treatment as Login, so the flow feels continuous */}
      {width >= 768 && (
        <div className="relative hidden w-1/2 shrink-0 overflow-hidden bg-gradient-to-br from-primary to-primary/70 md:flex md:flex-col md:justify-between md:p-10 lg:p-14">
          <div className="w-[170px]">
            <img src={appInfo.applogo} className="h-auto w-full object-contain brightness-0 invert" alt="applogo" />
          </div>

          <div className="relative z-10 my-10">
            <h2 className="text-3xl font-semibold leading-tight text-primary-content lg:text-4xl">
              Bring your whole team onto OpenSign.
            </h2>
            <p className="mt-3 max-w-sm text-sm text-primary-content/80">
              Register your company - a Super Admin reviews and approves new
              accounts before access is granted.
            </p>
          </div>

          <div className="relative mx-auto mt-4 w-full max-w-[420px]">
            <span className="op-animate-blob absolute -left-6 top-6 h-20 w-20 rounded-full bg-primary-content/20 blur-xl" />
            <span className="op-animate-blob absolute -right-4 bottom-4 h-24 w-24 rounded-full bg-primary-content/10 blur-2xl" />
            <span className="op-animate-float-slow absolute -left-2 top-2 grid h-11 w-11 place-items-center rounded-2xl bg-base-100 shadow-lg">
              <i className="fa-light fa-building text-lg text-primary" />
            </span>
            <span className="op-animate-float-medium absolute right-2 top-14 grid h-11 w-11 place-items-center rounded-2xl bg-base-100 shadow-lg">
              <i className="fa-light fa-user-plus text-lg text-success" />
            </span>
            <span className="op-animate-float-fast absolute -right-4 bottom-10 grid h-11 w-11 place-items-center rounded-2xl bg-base-100 shadow-lg">
              <i className="fa-light fa-hourglass-half text-lg text-primary" />
            </span>
            <img
              src={login_img}
              alt="Illustration of a person setting up their workspace"
              className="relative z-[1] w-full drop-shadow-2xl"
            />
          </div>
        </div>
      )}

      {/* Right form panel */}
      <div className="flex w-full flex-col justify-center overflow-y-auto px-6 py-10 sm:px-12 md:w-1/2 lg:px-20">
        <div className="mx-auto w-full max-w-sm">
          {width < 768 && (
            <div className="mb-8 w-[170px]">
              <img src={appInfo.applogo} className="h-auto w-full object-contain" alt="applogo" />
            </div>
          )}

          <h1 className="text-[28px] font-semibold text-base-content">Create your account</h1>
          <p className="mt-1 text-xs text-base-content/60">
            Submitted for approval - you&apos;ll get access once a Super Admin approves it.
          </p>

          {error && (
            <div className="op-alert op-alert-error mt-4 text-xs">{error}</div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
            <div>
              <label className="block text-xs font-medium text-base-content/70" htmlFor="name">Name</label>
              <input id="name" name="name" required value={form.name} onChange={handleChange}
                className="op-input op-input-bordered mt-1 w-full text-sm focus:outline-none hover:border-base-content" />
            </div>
            <div>
              <label className="block text-xs font-medium text-base-content/70" htmlFor="email">Email</label>
              <input id="email" name="email" type="email" required value={form.email} onChange={handleChange}
                className="op-input op-input-bordered mt-1 w-full text-sm focus:outline-none hover:border-base-content" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-base-content/70" htmlFor="phone">Phone</label>
                <input id="phone" name="phone" value={form.phone} onChange={handleChange}
                  className="op-input op-input-bordered mt-1 w-full text-sm focus:outline-none hover:border-base-content" />
              </div>
              <div>
                <label className="block text-xs font-medium text-base-content/70" htmlFor="jobTitle">Job title</label>
                <input id="jobTitle" name="jobTitle" value={form.jobTitle} onChange={handleChange}
                  className="op-input op-input-bordered mt-1 w-full text-sm focus:outline-none hover:border-base-content" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-base-content/70" htmlFor="companyName">Company</label>
              <input id="companyName" name="companyName" required value={form.companyName} onChange={handleChange}
                className="op-input op-input-bordered mt-1 w-full text-sm focus:outline-none hover:border-base-content" />
            </div>
            <div>
              <label className="block text-xs font-medium text-base-content/70" htmlFor="password">Password</label>
              <input id="password" name="password" type="password" required value={form.password} onChange={handleChange}
                className="op-input op-input-bordered mt-1 w-full text-sm focus:outline-none hover:border-base-content" />
            </div>

            <button type="submit" disabled={loading} className="op-btn op-btn-primary mt-2 w-full">
              Submit for approval
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-base-content/60">
            Already have an account?{" "}
            <NavLink to="/login" className="op-link op-link-primary font-medium underline-offset-2">
              Sign in
            </NavLink>
          </p>
        </div>
      </div>
    </div>
  );
}

export default Register;
