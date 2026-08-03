import { useState } from "react";
import Parse from "parse";
import { useNavigate } from "react-router";
import { appInfo } from "../constant/appinfo";
import { emailRegex } from "../constant/const";
import Loader from "../primitives/Loader";

// Deliberately NOT reusing AddAdmin.jsx's flow - that one creates a real
// _User immediately. This form submits to submitapproval instead, which
// only stores a pending request; nothing real gets created until a Super
// Admin approves it (see Approval page in SuperAdminConsole).
function Register() {
  const navigate = useNavigate();
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
    <div className="flex h-screen w-full items-center justify-center bg-base-200">
      {loading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <Loader />
        </div>
      )}
      <div className="op-card w-full max-w-md bg-base-100 p-8 shadow-md">
        <div className="mb-4 inline-block h-14 w-full overflow-hidden">
          <img src={appInfo.applogo} className="mx-auto h-full object-contain" alt="logo" />
        </div>
        <h1 className="mb-1 text-xl font-semibold text-base-content">Register your company</h1>
        <p className="mb-5 text-xs text-base-content/60">
          Submitted for approval - you'll get access once a Super Admin approves it.
        </p>
        {error && <div className="op-alert op-alert-error mb-4 text-xs">{error}</div>}
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <label className="block text-xs" htmlFor="name">Name</label>
            <input id="name" name="name" required value={form.name} onChange={handleChange}
              className="op-input op-input-bordered op-input-sm w-full text-xs" />
          </div>
          <div>
            <label className="block text-xs" htmlFor="email">Email</label>
            <input id="email" name="email" type="email" required value={form.email} onChange={handleChange}
              className="op-input op-input-bordered op-input-sm w-full text-xs" />
          </div>
          <div>
            <label className="block text-xs" htmlFor="phone">Phone</label>
            <input id="phone" name="phone" value={form.phone} onChange={handleChange}
              className="op-input op-input-bordered op-input-sm w-full text-xs" />
          </div>
          <div>
            <label className="block text-xs" htmlFor="companyName">Company</label>
            <input id="companyName" name="companyName" required value={form.companyName} onChange={handleChange}
              className="op-input op-input-bordered op-input-sm w-full text-xs" />
          </div>
          <div>
            <label className="block text-xs" htmlFor="jobTitle">Job title</label>
            <input id="jobTitle" name="jobTitle" value={form.jobTitle} onChange={handleChange}
              className="op-input op-input-bordered op-input-sm w-full text-xs" />
          </div>
          <div>
            <label className="block text-xs" htmlFor="password">Password</label>
            <input id="password" name="password" type="password" required value={form.password} onChange={handleChange}
              className="op-input op-input-bordered op-input-sm w-full text-xs" />
          </div>
          <button type="submit" disabled={loading} className="op-btn op-btn-primary mt-3 w-full">
            Submit for approval
          </button>
          <button type="button" onClick={() => navigate("/")} className="op-btn op-btn-ghost w-full">
            Back
          </button>
        </form>
      </div>
    </div>
  );
}

export default Register;
