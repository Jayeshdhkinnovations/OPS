import logo from "../assets/images/logo.png";
import { getEnv } from "./env";

// serverUrl_fn() below resolves the ROOT server, which is what the tenant
// lookup at login has to talk to. Every authenticated call after login must
// instead go to the company's own mount (.../app/<slug>), which login stores
// in `baseUrl` - sending them to the root produces "Invalid session token",
// because the company's session does not exist there. Direct axios callers
// need this; the Parse SDK is already pointed at the right server.
export function apiServerUrl() {
  const stored = localStorage.getItem("baseUrl");
  if (stored) return stored.replace(/\/+$/, "");
  return serverUrl_fn();
}

export function serverUrl_fn() {
  const env = getEnv();
  const serverurl = env?.REACT_APP_SERVERURL
    ? env.REACT_APP_SERVERURL // env.REACT_APP_SERVERURL is used for prod
    : process.env.REACT_APP_SERVERURL; //  process.env.REACT_APP_SERVERURL is used for dev (locally)
  let baseUrl = serverurl ? serverurl : window.location.origin + "/api/app";

  // Dynamic subdomain routing helper:
  const host = window.location.hostname;
  const parts = host.split(".");

  const excludedSubdomains = ["www", "sign", "opensign"];

  // E.g., companyb.sign.toowix.com or companyb.localhost
  if (parts.length >= 3 && !excludedSubdomains.includes(parts[0])) {
    const slug = parts[0];
    if (!baseUrl.endsWith(`/${slug}`)) {
      baseUrl = `${baseUrl.replace(/\/$/, "")}/${slug}`;
    }
  } else if (
    parts.length === 2 &&
    parts[1] === "localhost" &&
    !excludedSubdomains.includes(parts[0])
  ) {
    const slug = parts[0];
    if (!baseUrl.endsWith(`/${slug}`)) {
      baseUrl = `${baseUrl.replace(/\/$/, "")}/${slug}`;
    }
  }

  return baseUrl;
}
export const appInfo = {
  applogo: logo,
  appId: process.env.REACT_APP_APPID ? process.env.REACT_APP_APPID : "opensign",
  baseUrl: serverUrl_fn(),
  defaultRole: "contracts_User",
  fev_Icon:
    "data:image/png;base64,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",
  googleClientId: process.env.REACT_APP_GOOGLECLIENTID
    ? `${process.env.REACT_APP_GOOGLECLIENTID}`
    : "",
  metaDescription:
    "The fastest way to sign PDFs & request signatures from others.",
  settings: [
    {
      role: "contracts_Admin",
      menuId: "VPh91h0ZHk",
      pageType: "dashboard",
      pageId: "35KBoSgoAK",
      extended_class: "contracts_Users"
    },
    {
      role: "contracts_OrgAdmin",
      menuId: "VPh91h0ZHk",
      pageType: "dashboard",
      pageId: "35KBoSgoAK",
      extended_class: "contracts_Users"
    },
    {
      role: "contracts_Editor",
      menuId: "H9vRfEYKhT",
      pageType: "dashboard",
      pageId: "35KBoSgoAK",
      extended_class: "contracts_Users"
    },
    {
      role: "contracts_User",
      menuId: "H9vRfEYKhT",
      pageType: "dashboard",
      pageId: "35KBoSgoAK",
      extended_class: "contracts_Users"
    }
  ]
};
