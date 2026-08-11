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
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAYAAACM/rhtAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAU+SURBVHgB7VjNa2NVFD/nvkRnZ/wLGheCiGBnIXQGBzNiGQXR6cJZ6KKZheCu7WIYXGhSFQYFaSuIgoskCzdupq5G3bSlyJSKNDrjx2oS/wGnQtGk7917/Z1zX9LQNuYDxU1OSe67793c87u/8/lKNJGJTGQi/6lwvweFyl6OWrTIWZ5n4jwZ9owLMsYbZvbkiQ1+rvcxykN9jnnvvrrU65y9Kdy68ugWjSCZU8Gt7OX8gdsjQ3mKmYCI2EF9BD3OsTOqWFUylOOPBLiCczoL4EW8zuUQtVuvjAauL8CE4jJbgMPBhQ9wRkGtEUwyeh29E8ZSvpzCUOAyl2VRYFPvxHaZxpATJp65cTsfZfmeKBYWWOTIlHodPvJrE4iUZ0bBBYis63V3DpirX1157CqNIScZZFfyFls6UWzUvEZ4ENViRhGfWpZTBvWeupsiDIT7ADSi+y1HY7F3KkBjaQ14qpTJiKJwT8HC152lyGTIWn8TvvYwJmkAABEujOEtrGsqwtQTZL/N155o0pjCI66nCyu7Rfyq0nEBo+bHSSJT3nz9ybGZ6ieZEdcjiF1JsolSBKacmNb7xtYb/z44GhXg+Rvfll3i8hokCtKJYZFaeIlGlEJpI9ciyrVa+G4TyXjmDO3XV+f2e9eZYTecKW3kwd68Txy5xOKD0Xq4pa1tL5z9kkaQmXe3y3+yuR9b32DKNOC897LZBxtxnH35+NqhGXQclQjswfEkJSJUvUQN+4SXjx9EL8BIK2Xm10/nmt3nSGM41QJZkszgOSQiSUX1nz5+sTYWwJnrG/kksUXNa0bAUUjElqs7bz3dPFKcbNhDNwWGEeQRMpXzmSgr1eNiZy94RwnYHpJrQeY0PwFplFk8TfdQAA+RGykJ5cxI9dC8iNrnXZc9E0Gx5akw02InIyc27ibo8x/eLnpL88peWBUWel+9s3JpayyA09e+mXaxnWepwzC083psMJkp7753sdmrWBsIDqlLr4mrveZlY1AErBoizfih3DjfNwMMDBJ/mGBT+JqFMRAYOjpqJge/r8lzaSxEMWnlSBXrFyMAjhRf+Oi7RdyfUty6ROu0FKhyffWFZj/9AxlEtF7u9ggIEBPBslY2TdOBSRbhbPnQEXR0a4WudRQXPtnL+9guOO0+WKKLQ4Qwqk679k/6BwMEY7ArcjLAGSe7139Yu1TrKEaaeRudTxo3+i1nadQ/mO01WwmeO6VHEB9Oj4sDl+vv92dPz0+DxNOmF4CIAGtts91uz3WfISIDpGDZwCC+o6gLTg6BFcXgbD5dq41E4/t3nqkNUj+QQfhbDQfOGTbrBw8ka83UtOi486gAxQAp9AaSGnFd71VssmbDxq4bP8Iga6ZyQ5XGgQB//uylKobq8fvGRxtObBs619DSQ3Xbuy7Dz1Z+LJL1eYWjqV39Ts5S2y0NZk/10BjyXOVOGTrzYebTyFCI1fpySD3PV34BMHWBYP40eoHzDzLx0I3FyABnP787jXJQSnNs6GXUwIhIc9hVbLNI7sRT0rimkYtB0jyv7rwZDjGMDF2LL99s5P5qtysoYwV9/1DRdKGmBciyKJ794u60P6QC5kWtEeGtTtcgzf+2c+3cSG3Z0Ayuzz2yj2YQ5Yhz4Q53bQv11Z3r59SnjMssGGNWwjufvnRypy3G/UUaUUYy8devPr4KNy+nbqehC2I2s5Tt9oMw5jIQ73vfrbXIBFplqtsLT43Ulul+NIboS32MIMlSc/Pq2f1TnuczJlvxzhW89fsuduv4J8DS5tLJtROZyEQm8j/L34PwoqTw+VbpAAAAAElFTkSuQmCC",
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
