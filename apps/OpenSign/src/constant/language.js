// Split out of constant/Utils.js, which imports pdf-lib and is therefore
// ~1.5MB of PDF engine once bundled. ValidateRoute guards every route in the
// app and needed only this three-line helper, so importing it from Utils
// dragged the entire PDF stack into the entry chunk and made the login page
// wait on it.
export const saveLanguageInLocal = (i18n) => {
  const detectedLanguage = i18n.language || "en";
  localStorage.setItem("i18nextLng", detectedLanguage);
};
