import { useState } from "react";
import ModalUi from "../primitives/ModalUi";
import { SEAT_TIERS, DEFAULT_SEAT_TIER } from "../constant/seatTiers";

// Shown the first time someone signs in with a Google account that has no
// SignToowix workspace yet. Collects everything submitapproval's password
// form collects, minus name/email/password - Google already proved the
// email and gave us the name, and there is no password for this account to
// set (see provisionCompany.js for how sign-in is handled without one).
export default function GoogleSignupModal({ name, email, onSubmit, onClose, loading, error }) {
  const [companyName, setCompanyName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [phone, setPhone] = useState("");
  const [maxUsers, setMaxUsers] = useState(DEFAULT_SEAT_TIER);
  const [signupType, setSignupType] = useState("myself"); // "myself" | "team"

  const canSubmit = companyName.trim().length > 0;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!canSubmit || loading) return;
    onSubmit({
      companyName: companyName.trim(),
      jobTitle: jobTitle.trim(),
      phone: phone.trim(),
      maxUsers: signupType === "team" ? maxUsers : 1,
    });
  };

  return (
    <ModalUi isOpen={true} handleClose={onClose} showHeader={false}>
      <form onSubmit={handleSubmit} className="w-full max-w-sm mx-auto py-2">
        <h1 className="text-2xl font-bold text-gray-800 tracking-tight">Almost there</h1>
        <p className="mt-1 text-xs text-gray-400 font-medium">
          A few details to set up your workspace for <b className="text-gray-600">{email}</b>.
        </p>

        {error && (
          <div className="bg-red-50 text-red-600 rounded-lg p-3 mt-4 text-xs font-semibold border border-red-100">
            {error}
          </div>
        )}

        <div className="mt-6 flex flex-col gap-4">
          <input
            value={name}
            disabled
            className="w-full rounded-full border border-gray-200 bg-gray-50 text-gray-500 px-5 py-2.5 text-sm"
          />
          <input
            type="text"
            placeholder="Company name"
            required
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            className="w-full rounded-full border border-gray-300 bg-white text-gray-800 placeholder:text-gray-400 focus:border-[#0B3D73] focus:ring-2 focus:ring-[#0B3D73]/15 focus:outline-none transition-colors px-5 py-2.5 text-sm"
          />
          <div className="grid grid-cols-2 gap-4">
            <input
              type="text"
              placeholder="Job title"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              className="w-full rounded-full border border-gray-300 bg-white text-gray-800 placeholder:text-gray-400 focus:border-[#0B3D73] focus:ring-2 focus:ring-[#0B3D73]/15 focus:outline-none transition-colors px-5 py-2.5 text-sm"
            />
            <input
              type="tel"
              placeholder="Phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-full border border-gray-300 bg-white text-gray-800 placeholder:text-gray-400 focus:border-[#0B3D73] focus:ring-2 focus:ring-[#0B3D73]/15 focus:outline-none transition-colors px-5 py-2.5 text-sm"
            />
          </div>
          <div className="flex items-center gap-6 px-1">
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
            <div>
              <label className="sr-only" htmlFor="google-maxusers">Max Users</label>
              <select
                id="google-maxusers"
                value={maxUsers}
                onChange={(e) => setMaxUsers(Number(e.target.value))}
                className="w-full appearance-none rounded-full border border-gray-300 bg-white text-gray-800 focus:border-[#0B3D73] focus:ring-2 focus:ring-[#0B3D73]/15 focus:outline-none transition-colors px-5 py-2.5 text-sm bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%2016%2016%22%20fill%3D%22%239CA3AF%22%3E%3Cpath%20d%3D%22M4.5%206.5%208%2010l3.5-3.5z%22/%3E%3C/svg%3E')] bg-[length:16px_16px] bg-[right_1rem_center] bg-no-repeat pr-10"
              >
                {SEAT_TIERS.map((tier) => (
                  <option key={tier.value} value={tier.value}>
                    {tier.label} Users
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={!canSubmit || loading}
          className="mt-8 w-full rounded-full bg-gradient-to-r from-[#1B4F91] to-[#0B3D73] py-[15px] px-6 text-[15px] font-bold text-white transition-opacity duration-150 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[#0B3D73] focus:ring-offset-2 disabled:opacity-60"
        >
          {loading ? "Submitting..." : "Submit for approval"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="w-full text-gray-400 hover:underline text-sm font-semibold transition-colors duration-200 mt-3"
        >
          Cancel
        </button>
      </form>
    </ModalUi>
  );
}
