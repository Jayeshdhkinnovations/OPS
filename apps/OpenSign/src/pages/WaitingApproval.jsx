import { useEffect, useState } from "react";
import Parse from "parse";
import { useLocation } from "react-router";
import { useAuthNavigate } from "../hook/useAuthNavigate";
import toowixLogo from "../assets/images/toowix-logo.png";

const POLL_MS = 5000;

const STATUS_ICON = {
  pending: (
    <div className="grid h-16 w-16 place-items-center rounded-full bg-[#EAF1FF]">
      <i className="fa-light fa-hourglass-half animate-pulse text-2xl text-[#0B3D73]" />
    </div>
  ),
  approved: (
    <div className="grid h-16 w-16 place-items-center rounded-full bg-[#0B3D73]">
      <i className="fa-light fa-check text-2xl text-white" />
    </div>
  ),
  rejected: (
    <div className="grid h-16 w-16 place-items-center rounded-full bg-red-50">
      <i className="fa-light fa-xmark text-2xl text-red-600" />
    </div>
  ),
};

function WaitingApproval() {
  const authNavigate = useAuthNavigate();
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
    <div className="flex h-[100dvh] w-full items-center justify-center overflow-y-auto bg-[#F7F8FC] p-4 font-['Poppins'] sm:h-auto sm:min-h-screen sm:overflow-visible sm:p-8">
      <div className="op-auth-card w-full max-w-md rounded-[26px] bg-white p-10 text-center shadow-[0_40px_80px_-30px_rgba(70,60,160,0.28)]">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white shadow-sm">
            <img src={toowixLogo} alt="SignToowix" className="h-7 w-7 object-contain" />
          </div>
          <span className="text-lg font-bold tracking-tight text-gray-800">
            SignToowix
          </span>
        </div>

        <div className="op-stagger-item mb-6 flex justify-center" style={{ animationDelay: "0ms" }}>
          {STATUS_ICON[status]}
        </div>

        {status === "pending" && (
          <div className="op-stagger-item" style={{ animationDelay: "60ms" }}>
            <h1 className="mb-2 text-xl font-bold text-gray-800 tracking-tight">Waiting for approval</h1>
            <p className="mb-8 text-sm text-gray-500">
              Your registration for <span className="font-semibold text-gray-700">{email}</span> has been submitted.
              A Super Admin needs to approve it before you can log in - this page updates
              automatically once that happens.
            </p>
          </div>
        )}

        {status === "approved" && (
          <div className="op-stagger-item" style={{ animationDelay: "60ms" }}>
            <h1 className="mb-2 text-xl font-bold text-gray-800 tracking-tight">Approval done!</h1>
            <p className="mb-8 text-sm text-gray-500">
              Your account is ready. Log in with <span className="font-semibold text-gray-700">{email}</span> and
              the password you chose when registering.
            </p>
          </div>
        )}

        {status === "rejected" && (
          <div className="op-stagger-item" style={{ animationDelay: "60ms" }}>
            <h1 className="mb-2 text-xl font-bold text-gray-800 tracking-tight">Request not approved</h1>
            <p className="mb-8 text-sm text-gray-500">
              Your registration wasn't approved. Contact your administrator for details.
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={() => authNavigate("/login")}
          className="op-stagger-item w-full rounded-full bg-gradient-to-r from-[#1B4F91] to-[#0B3D73] py-[15px] px-6 text-[15px] font-bold text-white transition-opacity duration-150 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[#0B3D73] focus:ring-offset-2"
          style={{ animationDelay: "120ms" }}
        >
          Go to Login
        </button>
      </div>
    </div>
  );
}

export default WaitingApproval;
