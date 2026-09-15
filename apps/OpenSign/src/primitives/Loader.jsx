import React from "react";

// Circular spinner: light gray track + a rotating/growing brand-colored arc,
// matching the reference GIF's motion (Material-style indeterminate
// progress). Built as inline SVG/CSS rather than the GIF itself so it's
// resolution-independent and recolorable via the stroke below.
const Loader = () => {
  return (
    <svg
      className="op-spinner inline-block"
      role="status"
      aria-label="Loading"
      width="96"
      height="96"
      viewBox="0 0 50 50"
    >
      <circle
        cx="25"
        cy="25"
        r="20"
        fill="none"
        stroke="#E5E7EB"
        strokeWidth="5"
      />
      <circle
        className="op-spinner-arc"
        cx="25"
        cy="25"
        r="20"
        fill="none"
        stroke="#8642FC"
        strokeWidth="5"
      />
    </svg>
  );
};

export default Loader;
