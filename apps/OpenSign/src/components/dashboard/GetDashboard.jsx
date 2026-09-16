import { useState, useEffect, Suspense } from "react";
import { lazyWithRetry } from "../../utils";
const DashboardButton = lazyWithRetry(() => import("./DashboardButton"));
const DashboardCard = lazyWithRetry(() => import("./DashboardCard"));
const DashboardReport = lazyWithRetry(() => import("./DashboardReport"));
const buttonList = [
  {
    label: "Sign yourself",
    redirectId: "sHAnZphf69",
    redirectType: "Form",
    icon: "fa-light fa-pen-nib"
  },
  {
    label: "Request signatures",
    redirectId: "8mZzFxbG1z",
    redirectType: "Form",
    icon: "fa-light fa-paper-plane"
  }
];
// Matches DashboardCard's own icon+label+count layout so the Suspense
// fallback (shown only while that chunk itself is being fetched, e.g. on a
// hard refresh) doesn't flash mismatched "please wait" text inside the box.
const CardFallback = () => (
  <div className="flex items-center justify-start gap-5 animate-pulse">
    <span className="rounded-full bg-white/25 w-[60px] h-[60px] shrink-0" />
    <div className="space-y-2">
      <div className="h-4 w-24 rounded bg-white/25" />
      <div className="h-6 w-10 rounded bg-white/25" />
    </div>
  </div>
);

const GetDashboard = (props) => {
  const Button = ({ label, redirectId, redirectType, icon }) => (
    <DashboardButton
      Icon={icon}
      Label={label}
      Data={{ Redirect_type: redirectType, Redirect_id: redirectId }}
    />
  );
  const renderSwitchWithTour = (col) => {
    switch (col.widget.type) {
      case "Card":
        return (
          <div
            className={`${
              col?.widget?.bgColor ? col.widget.bgColor : "bg-[#2ed8b6]"
            } op-card relative overflow-hidden w-full h-[140px] px-3 pt-4 mb-3 shadow-md`}
            data-tut={col.widget.data.tourSection}
          >
            {/* Decorative flowing highlight, same direction as the card's
                gradient - purely cosmetic, sits behind the content. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -z-10 -bottom-10 -right-10 h-40 w-64 rotate-[-18deg] rounded-full bg-white/20 blur-2xl"
            />
            <Suspense fallback={<CardFallback />}>
              <DashboardCard
                Icon={col.widget.icon}
                Label={col.widget.label}
                Format={col.widget.format && col.widget.format}
                Data={col.widget.data}
                FilterData={col.widget.filter}
                TextColor={col.widget.textColor}
                TooltipIconColor={col.widget.tooltipIconColor}
              />
            </Suspense>
          </div>
        );
      case "report": {
        return (
          <div data-tut={col.widget.data.tourSection}>
            <Suspense fallback={null}>
              <div className="mb-3 md:mb-0">
                <DashboardReport
                  Record={col.widget}
                />
              </div>
            </Suspense>
          </div>
        );
      }
      default:
        return <></>;
    }
  };
  const renderSwitch = (col) => {
    switch (col.widget.type) {
      case "Card":
        return (
          <div
            className={`${
              col?.widget?.bgColor ? col.widget.bgColor : "bg-[#2ed8b6]"
            } op-card relative overflow-hidden w-full h-[140px] px-3 pt-4 mb-3 shadow-md`}
          >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -z-10 -bottom-10 -right-10 h-40 w-64 rotate-[-18deg] rounded-full bg-white/20 blur-2xl"
            />
            <Suspense fallback={<CardFallback />}>
              <DashboardCard
                Icon={col.widget.icon}
                Label={col.widget.label}
                Format={col.widget.format && col.widget.format}
                Data={col.widget.data}
                FilterData={col.widget.filter}
                TextColor={col.widget.textColor}
                TooltipIconColor={col.widget.tooltipIconColor}
              />
            </Suspense>
          </div>
        );
      case "report": {
        return (
          <Suspense fallback={null}>
            <div className="mb-3 md:mb-0">
              <DashboardReport
                Record={col.widget}
              />
            </div>
          </Suspense>
        );
      }
      default:
        return <></>;
    }
  };
  return (
    <div>
      <div className="mb-3">
        <div
          data-tut={"tourbutton"}
          className="flex flex-col md:flex-row gap-4"
        >
          {buttonList.map((btn) => (
            <Button
              key={btn.label}
              label={btn.label}
              redirectType={btn.redirectType}
              redirectId={btn.redirectId}
              icon={btn.icon}
            />
          ))}
        </div>
      </div>
      <div className="grid grid-cols-12 w-full gap-x-4">
        {props?.dashboard?.columns?.map((col, i) =>
          col.widget.data && col.widget.data.tourSection ? (
            <div key={i} className={col?.colsize}>
              {renderSwitchWithTour(col)}
            </div>
          ) : (
            <div key={i} className={col?.colsize}>
              {renderSwitch(col)}
            </div>
          )
        )}
      </div>
    </div>
  );
};

export default GetDashboard;
