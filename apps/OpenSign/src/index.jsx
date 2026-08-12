import ReactDOM from "react-dom/client";
import "./index.css";
import "./styles/dark-theme-improvements.css";
import App from "./App";
import { showUpgradeProgress, hideUpgradeProgress } from "./utils/upgradeProgress";
import { Provider } from "react-redux";
import { store } from "./redux/store";
import Parse from "parse";
import "./polyfills";
import { apiServerUrl } from "./constant/appinfo";
import "./i18n";
import { ScrollProvider } from "./context/ScrollPdfContext";

const appId =
  import.meta.env.VITE_APPID || process.env.REACT_APP_APPID || "opensign";
// This module runs on every page load, including a plain refresh - unlike
// serverUrl_fn(), which always resolves the ROOT server, apiServerUrl()
// prefers the company mount that login already stored. Using serverUrl_fn()
// here reset Parse back to root before Validate.jsx checked the session
// token, so the check ran against a server that had never heard of that
// session and always failed - "session expired" on every single refresh of
// an otherwise perfectly valid login.
const serverUrl = apiServerUrl();
Parse.initialize(appId);
Parse.serverURL = serverUrl;

if (localStorage.getItem("showUpgradeProgress")) {
  showUpgradeProgress();
}

const savedTheme = localStorage.getItem("theme");
if (savedTheme === "dark") {
  document.documentElement.setAttribute("data-theme", "opensigndark");
}


const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <Provider store={store}>
    <ScrollProvider>
      <App />
    </ScrollProvider>
  </Provider>
);

hideUpgradeProgress();
localStorage.removeItem("showUpgradeProgress");
