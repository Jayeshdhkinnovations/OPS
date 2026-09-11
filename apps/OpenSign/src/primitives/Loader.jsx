import React from "react";

// Served from public/ (not imported as a module) - vite-plugin-svgr runs
// every imported .svg through SVGO on the way through, which was stripping
// this file's gradient <defs> and rendering it as a flat black shape
// instead of the actual brand colors. A plain static path bypasses that
// pipeline entirely, so the file reaches the browser byte-for-byte.
const loaderIcon = "/static/js/assets/images/Toowix_Logo.svg";

// Placeholder animation: no animated asset for the new mark yet - a CSS
// pulse on the new icon stands in until one is provided.
const Loader = () => {
  return (
    <img
      src={loaderIcon}
      alt="Loading"
      role="status"
      aria-label="Loading"
      width="96"
      height="96"
      className="inline-block animate-pulse"
    />
  );
};

export default Loader;
