import React from "react";
import loaderGif from "../assets/images/sign logo..gif";

const Loader = () => {
  return (
    <img
      src={loaderGif}
      alt="Loading"
      role="status"
      aria-label="Loading"
      width="96"
      height="96"
      className="inline-block"
    />
  );
};

export default Loader;
