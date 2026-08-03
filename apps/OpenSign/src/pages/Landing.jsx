import { useNavigate } from "react-router";
import { appInfo } from "../constant/appinfo";

function Landing() {
  const navigate = useNavigate();

  return (
    <div className="flex h-screen w-full items-center justify-center bg-base-200">
      <div className="op-card w-full max-w-md bg-base-100 p-10 text-center shadow-md">
        <div className="mb-6 inline-block h-16 w-full overflow-hidden">
          <img src={appInfo.applogo} className="mx-auto h-full object-contain" alt="logo" />
        </div>
        <h1 className="mb-2 text-2xl font-semibold text-base-content">Welcome to OpenSign™</h1>
        <p className="mb-8 text-sm text-base-content/60">
          Sign in to your account, or register a new company.
        </p>
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => navigate("/login")}
            className="op-btn op-btn-primary w-full"
          >
            Login
          </button>
          <button
            type="button"
            onClick={() => navigate("/register")}
            className="op-btn op-btn-outline w-full"
          >
            Register
          </button>
        </div>
      </div>
    </div>
  );
}

export default Landing;
