import { useEffect, useState } from "react";
import Parse from "parse";
import { useLocation, useNavigate } from "react-router";
import { appInfo } from "../constant/appinfo";

const POLL_MS = 5000;

function WaitingApproval() {
  const navigate = useNavigate();
  const location = useLocation();
  const email = location?.state?.email || "";
  const [status, setStatus] = useState("pending");

  useEffect(() => {
    if (!email) return;
    let cancelled = false;

    async function check() {
      try {
        const res = await Parse.Cloud.run("checkapprovalstatus", { email });
        if (!cancelled) setStatus(res.status);
      } catch {
        // keep showing pending, try again next tick
      }
    }

    check();
    const interval = setInterval(check, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [email]);

  return (
    <div className="flex h-screen w-full items-center justify-center bg-base-200">
      <div className="op-card w-full max-w-md bg-base-100 p-8 text-center shadow-md">
        <div className="mb-4 inline-block h-14 w-full overflow-hidden">
          <img src={appInfo.applogo} className="mx-auto h-full object-contain" alt="logo" />
        </div>

        {status === "pending" && (
          <>
            <h1 className="mb-2 text-xl font-semibold text-base-content">Waiting for approval</h1>
            <p className="mb-6 text-sm text-base-content/60">
              Your registration for <span className="font-medium">{email}</span> has been submitted.
              A Super Admin needs to approve it before you can log in - this page will update
              automatically once that happens.
            </p>
          </>
        )}

        {status === "approved" && (
          <>
            <h1 className="mb-2 text-xl font-semibold text-success">Approval done!</h1>
            <p className="mb-6 text-sm text-base-content/60">
              Your account is ready. Log in with <span className="font-medium">{email}</span> and
              the password you chose when registering.
            </p>
          </>
        )}

        {status === "rejected" && (
          <>
            <h1 className="mb-2 text-xl font-semibold text-error">Request not approved</h1>
            <p className="mb-6 text-sm text-base-content/60">
              Your registration wasn't approved. Contact your administrator for details.
            </p>
          </>
        )}

        <button type="button" onClick={() => navigate("/login")} className="op-btn op-btn-primary w-full">
          Go to Login
        </button>
      </div>
    </div>
  );
}

export default WaitingApproval;
