import i18next from "i18next";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

function SelectLanguage(props) {
  const { i18n } = useTranslation();
  const languages = [
    { value: "en", text: "English" }, //english
    { value: "es", text: "Española" }, //spanish
    { value: "fr", text: "Français" }, //french
    { value: "it", text: "Italiano" }, //italian
    { value: "de", text: "Deutsch" }, //german
    { value: "hi", text: "हिन्दी" }, //hindi
    { value: "kr", text: "한국어" } //korean
  ];
  const defaultLanguage = i18next.language || "en";
  const [lang, setLang] = useState(defaultLanguage);
  // This function put query that helps to change the language
  const handleChangeLang = (e) => {
    setLang(e.target.value);
    i18n.changeLanguage(e.target.value);
    props?.updateExtUser && props.updateExtUser({ language: e.target.value });
  };
  if (props.isLoginStyle) {
    return (
      <div className="flex justify-end items-center text-gray-500 font-medium">
        <select
          value={lang}
          onChange={handleChangeLang}
          className="border-0 bg-transparent py-1 pl-1 pr-6 text-xs text-gray-500 hover:text-gray-700 focus:outline-none focus:ring-0 cursor-pointer appearance-none relative font-medium"
          style={{
            backgroundImage: `url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%236B7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='m6 8 4 4 4-4'/%3E%3C/svg%3E")`,
            backgroundPosition: 'right 0.25rem center',
            backgroundSize: '1.25em 1.25em',
            backgroundRepeat: 'no-repeat'
          }}
        >
          {languages.map((item) => {
            let textToShow = item.text;
            if (item.value === "en") textToShow = "English (USA)";
            return (
              <option key={item.value} value={item.value} className="bg-white text-gray-800">
                {textToShow}
              </option>
            );
          })}
        </select>
      </div>
    );
  }

  return (
    <div
      className={`${
        !props.isProfile && " mt-[9px] pb-2 md:pb-0 "
      } flex justify-center items-center text-base-content`}
    >
      <select
        value={lang}
        onChange={handleChangeLang}
        className={`${
          !props.isProfile ? " md:w-[15%] w-[50%]" : "w-[180px]"
        } op-select op-select-bordered op-select-sm `}
      >
        <option disabled>select</option>
        {languages.map((item) => {
          return (
            <option key={item.value} value={item.value}>
              {item.text}
            </option>
          );
        })}
      </select>
    </div>
  );
}

export default SelectLanguage;
