// Split out of constant/Utils.js for the same reason as env.js and
// language.js: Utils imports pdf-lib, so a component in the entry graph
// importing one small helper from it pulled ~1.5MB of PDF engine into the
// first page load.
export const openInNewTab = (url, target) => {
  if (target) {
    window.open(url, target, "noopener,noreferrer");
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
};
