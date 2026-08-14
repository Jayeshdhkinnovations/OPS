import React from "react";

// One animation on the whole mark, not three separately-choreographed ones -
// simpler, and guarantees every part of the logo moves together instead of
// only one piece visibly animating while the others sit still.
const style = `
  @keyframes op-loader-pulse {
    0%, 100% { transform: scale(0.82); opacity: 0.6; }
    50% { transform: scale(1); opacity: 1; }
  }
  .op-loader-mark {
    transform-box: fill-box;
    transform-origin: center;
    animation: op-loader-pulse 2s ease-in-out infinite;
  }
`;

const Loader = () => {
  return (
    <svg
      width="96"
      height="96"
      viewBox="0 0 440 440"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="status"
      aria-label="Loading"
      className="text-neutral"
    >
      <style>{style}</style>
      <g className="op-loader-mark" transform="translate(2 28.9998)">
        <path
          d="M70.378 173.745L125.361 72.6001H0L9.9 48.4C15.4 36.3 20.9 27.5 27.5 19.8C40.1115 5.08755 61.226 0.374046 70.4 4.62985e-05H317.35C317.737 -0.00246663 318.119 0.0973573 318.455 0.289422C318.791 0.481487 319.071 0.758986 319.266 1.09385C319.461 1.42872 319.564 1.80908 319.564 2.19647C319.565 2.58387 319.463 2.96456 319.27 3.30005C312.67 14.9655 300.515 37.1635 292.545 53.9C283.745 72.3745 272.745 78.1001 263.945 78.1001H216.629C204.314 78.1001 193.903 92.0316 190.229 99.0001L157.229 158.4C142.929 184.8 139.629 190.3 122.029 221.1C104.621 251.559 78.0285 260.7 65.9285 258.5C60.4285 256.3 56.3035 243.986 52.7285 228.8C48.3835 210.029 62.678 185.84 70.378 173.745Z"
          fill="currentColor"
        />
        <path
          transform="translate(91.0623 160.884)"
          d="M198 0H133.1C119.02 0 111.837 7.3315 110 11L86.9 48.4L46.2 119.9C38.5 130.9 28.6 147.4 20.9 152.9C11.264 159.78 2.574 154.363 0 152.9C2.2 159.131 8.3545 173.349 15.4 180.4C24.2 189.2 30.8 196.9 49.5 196.9C69.168 196.9 84.7 189.2 92.4 177.1L119.9 135.3L171.6 44C176.732 35.574 187 15.4 191.4 8.8C194.431 4.224 196.51 1.1 198 0Z"
          fill="currentColor"
        />
        <path
          transform="translate(217.491 133.395)"
          d="M217.8 0H152.9C138.826 0 131.637 7.326 129.8 11L106.7 48.4L66 119.9C58.3 130.9 28.6 183.7 20.9 189.2C11.264 196.086 2.574 190.669 0 189.2C2.2 195.432 7.744 209.204 14.3 216.7C22 225.5 31.9 234.465 49.5 235.4C67.1 236.335 81.4 232.1 92.4 213.4L139.7 135.3L191.4 44.033C196.532 35.6015 208.274 12.0065 212.3 6.633C215.6 2.1945 216.332 1.1 217.8 0Z"
          fill="currentColor"
        />
      </g>
    </svg>
  );
};

export default Loader;
