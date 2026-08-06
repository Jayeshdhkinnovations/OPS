import { useNavigate } from "react-router";

// Wraps react-router navigation with the native View Transitions API so
// moving between Login/Register/Forgot Password crossfades+slides instead of
// hard-cutting. Purely presentational - the actual navigation call and its
// target are unchanged, this only decides *how* the DOM swap is painted.
// Browsers without support (Firefox, older Safari) just navigate instantly,
// same as before this existed - no broken or degraded behavior either way.
export function useAuthNavigate() {
  const navigate = useNavigate();

  return (to, options) => {
    const html = document.documentElement;
    if (typeof document.startViewTransition !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      navigate(to, options);
      return;
    }
    html.classList.add("op-auth-transition");
    const transition = document.startViewTransition(() => {
      navigate(to, options);
    });
    transition.finished.finally(() => {
      html.classList.remove("op-auth-transition");
    });
  };
}
