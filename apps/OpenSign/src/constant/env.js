// Split out of constant/Utils.js for the same reason as language.js: Utils
// imports pdf-lib, and appinfo.js needed only this one-line accessor. Going
// through Utils for it pulled ~1.5MB of PDF engine into the entry chunk,
// because appinfo is reachable from the app entry.
export function getEnv() {
  return window?.RUNTIME_ENV || {};
}
