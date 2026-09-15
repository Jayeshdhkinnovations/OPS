import React, { useState, useEffect } from "react";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import Loader from "./Loader";
import { useTranslation } from "react-i18next";

const LottieWithLoader = () => {
  const { t } = useTranslation();
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [animationSrc, setAnimationSrc] = useState(null);
  // Served locally (not the original lottie.host URL) - this is also where
  // its colors were recolored to the brand primary/secondary palette, so a
  // local copy is the source of truth now, not a byte-for-byte mirror of
  // the hosted original.
  const src = "/static/js/assets/animations/sign-checkmark.json";
  useEffect(() => {
    fetch(src)
      .then((response) => {
        if (!response.ok) {
          throw new Error("Network response was not ok");
        }
        return response.blob();
      })
      .then((blob) => {
        const objectURL = URL.createObjectURL(blob);
        setAnimationSrc(objectURL);
        setIsLoaded(true);
      })
      .catch((error) => {
        console.error("faild to load animation of send request:", error);
        setHasError(true);
      });
  }, [src]);

  return (
    <div>
      {!isLoaded && !hasError && (
        <div className="w-[120px] h-[120px] mx-auto">
          <Loader />
        </div>
      )}
      {hasError && <div className="error">{t("failed-animation")}</div>}
      {isLoaded && animationSrc && (
        <DotLottieReact
          src={animationSrc}
          autoplay
          className="w-[120px] h-[120px] md:w-[200px] md:h-[200px] mx-auto"
        />
      )}
    </div>
  );
};

export default LottieWithLoader;
