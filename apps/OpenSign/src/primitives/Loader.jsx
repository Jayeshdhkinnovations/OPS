import React from "react";
import loaderIcon from "../assets/images/toowix-logo-white.svg";

// Placeholder animation: the old animated GIF (previous brand's "T" mark) is
// gone, and there's no animated asset for the new mark yet - a CSS pulse on
// the new icon stands in until one is provided.
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
