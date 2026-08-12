// Simple flat illustration for the auth hero panel, built to match the
// navy SignToowix theme (no mismatched off-brand colors like the old
// stock artwork). A signed document + checkmark seal, nothing more.
function AuthIllustration({ className = "" }) {
  return (
    <svg
      viewBox="0 0 300 230"
      className={className}
      role="img"
      aria-label="Illustration of a signed document"
    >
      <ellipse cx="150" cy="205" rx="95" ry="14" fill="#00193F" opacity="0.35" />

      <g transform="rotate(-4 150 110)">
        <rect x="70" y="20" width="160" height="190" rx="14" fill="#FFFFFF" />
        <rect x="70" y="20" width="160" height="190" rx="14" fill="#EAF1FF" opacity="0.4" />
        <rect x="96" y="50" width="108" height="8" rx="4" fill="#C7D6EE" />
        <rect x="96" y="70" width="108" height="8" rx="4" fill="#C7D6EE" />
        <rect x="96" y="90" width="76" height="8" rx="4" fill="#C7D6EE" />
        <rect x="96" y="122" width="90" height="7" rx="3.5" fill="#DCE6F6" />
        <rect x="96" y="140" width="60" height="7" rx="3.5" fill="#DCE6F6" />

        {/* signature */}
        <path
          d="M96 172c8-14 16-14 22-2s14 12 20-2 14-14 22-4 18 10 24-4"
          stroke="#0B3D73"
          strokeWidth="4"
          strokeLinecap="round"
          fill="none"
        />
      </g>

      {/* pen */}
      <g transform="rotate(40 205 150)">
        <rect x="198" y="90" width="12" height="86" rx="6" fill="#1B4F91" />
        <path d="M198 90h12l-6-16z" fill="#0B3D73" />
      </g>

      {/* seal / checkmark badge */}
      <circle cx="222" cy="150" r="26" fill="#0B3D73" />
      <circle cx="222" cy="150" r="26" fill="none" stroke="#FFFFFF" strokeWidth="3" opacity="0.5" />
      <path
        d="M210 150l8 8 16-16"
        stroke="#FFFFFF"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

export default AuthIllustration;
