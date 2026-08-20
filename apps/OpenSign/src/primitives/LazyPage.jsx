import React, { Suspense } from "react";
import Loader from "./Loader";

const LazyPage = ({ Page }) => {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center items-center h-[100vh]">
          <div className="grayscale brightness-50">
            <Loader />
          </div>
        </div>
      }
    >
      <Page />
    </Suspense>
  );
};

export default LazyPage;
