import logo from "../assets/images/logo.png";
import { getEnv } from "./env";

// serverUrl_fn() below resolves the ROOT server, which is what the tenant
// lookup at login has to talk to. Every authenticated call after login must
// instead go to the company's own mount (.../app/<slug>), which login stores
// in `baseUrl` - sending them to the root produces "Invalid session token",
// because the company's session does not exist there. Direct axios callers
// need this; the Parse SDK is already pointed at the right server.
export function apiServerUrl() {
  const stored = localStorage.getItem("baseUrl");
  if (stored) return stored.replace(/\/+$/, "");
  return serverUrl_fn();
}

export function serverUrl_fn() {
  const env = getEnv();
  const serverurl = env?.REACT_APP_SERVERURL
    ? env.REACT_APP_SERVERURL // env.REACT_APP_SERVERURL is used for prod
    : process.env.REACT_APP_SERVERURL; //  process.env.REACT_APP_SERVERURL is used for dev (locally)
  let baseUrl = serverurl ? serverurl : window.location.origin + "/api/app";

  // Dynamic subdomain routing helper:
  const host = window.location.hostname;
  const parts = host.split(".");

  const excludedSubdomains = ["www", "sign", "opensign"];

  // E.g., companyb.sign.toowix.com or companyb.localhost
  if (parts.length >= 3 && !excludedSubdomains.includes(parts[0])) {
    const slug = parts[0];
    if (!baseUrl.endsWith(`/${slug}`)) {
      baseUrl = `${baseUrl.replace(/\/$/, "")}/${slug}`;
    }
  } else if (
    parts.length === 2 &&
    parts[1] === "localhost" &&
    !excludedSubdomains.includes(parts[0])
  ) {
    const slug = parts[0];
    if (!baseUrl.endsWith(`/${slug}`)) {
      baseUrl = `${baseUrl.replace(/\/$/, "")}/${slug}`;
    }
  }

  return baseUrl;
}
export const appInfo = {
  applogo: logo,
  appId: process.env.REACT_APP_APPID ? process.env.REACT_APP_APPID : "opensign",
  baseUrl: serverUrl_fn(),
  defaultRole: "contracts_User",
  fev_Icon:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAACXBIWXMAAD2EAAA9hAHVrK90AAAb+ElEQVR4nL2bB3hUZbrHJ4QSeu+dUJPMZJLpk0xP74WAuJa1gNJBsVxxpSgK7t513VXv6q67966ru8a9V10lEEBZSGPSO8lMeu8JhASSOWf+9/m+MzOZkAQUcL/neU0MwWfe3/l/bz3yeMMOXI4cwTjy3WFVr/6o5tbnx7QDza/rBq1v6hncr52wfT2lZ3FCb8GLhn5s0/VZzz2aB+xLqmx79uKBD3dkTwD9HEfo5/g3HriQfyZ4FE98TXPr418FAu8EwXoqwIoH5fxJPYO39AwO6PuwVd+FmIB2GPQ9SH4sGziUzOIlI/p3J5/JfyR5Kv1E/z4IcDh/XDuQ9G4IyAe1vKm3EGPv33kL3taz+IVuAD/TdiFc24YoXTviDR0I1l1D8qM5wIFvWcueswN4KR239l1IfjckadK/DcIRm+yPaW7+5rfBwJs6y8CbessDefJv2pw/qO1DlKoV4epWxGjbEaNrR5y+HUG6Hg7AwW9h2ZsMdu+ZQbyYjv69F75OSEh0BeBC7Cd3/pDyhvCkgbG8RZ+4xfognjpxnsh+h7oHoX5NiPBvQbS6FVGaNkRrOQCB2tsA7DsLdh8H4cae83+zq4DEhZ8GgAbjydfXNezJd4JBPrjlQdz3t2z2uH8XghWNiPRrQaR/CyJVrYhS2wDo2hGo6cZZJwDWfWepMXvPWAiEvt0XPqIQiBp+Cgiw/Uff0Fou/WcgcEJnYe4/2HFR/mFlO4JkDYhQNCNC2YwIPzsATgWxujYEqrtx9pHsEQCIYd9ZmxKS36GfNTHRlfdTHA0P449rB6veDqD3n73fSP+GzoIt8lYESuoRLmtEuLwJ4RRA8zAVxGrbEEABjFQAMXodiBJeSEPv7gvHKYQjF6liH+h5XFPtdkJnqb8fAOSJE+df1w0iXtqMQFEtwqUNCLMDUDQNqcCfU0GsphUBqq4xFcBBOGNl93EQru86//JPAmGXR+u0EzpL0ykC4B7SHnH+LduTjxc3IcC3BmHieoRKGhDmDEHZNEwFMTYAyXcAQCHsJRDOMjiUgo6d5/c+cAhHHoACThoYbJW0QO9djVDfOoSI6hBKIBAA0kaE3a4CAkDdCoN/510B2CFY9yczeP4SOnZd+PkDhbBDhAkn9EzNvQCgRY6BxRPSdugElQgR1iLYpxYhBIJNBaHDrsJQLIhRt8Dg14lvHh49BowCgcW+ZJY5+L21c+e5hAcGYYcoe8IbWsuPBkCc/2WAFfuU16DzqkCQdw01AiDYpgI7BE4FjcNUEKNqgU7Zib9uKfhBALj0mGTF/nNWy8GLg207z4dTCAn3mR123AMA4vwpA4vD6n4EeFXB4FWFQEE1B0HoBOEOKoj2b0GAsgOHwyuBA6fB7L2z88OUcOAcLAcu9rdtP6fhlMAVdPcBYPAHA6BBz8AFvUh+LbQeZgQSAPxqB4RRVSBrGKYCrjhqRYSqDWXbL1EIlh8OgcFz32PgwPe12dv+OY9CuNdCacePAGCP+CcNLBK8G6DeYEKAZyVno6iAAhCNlhG44oioINCvHS+EVIHZnwTrvjNOJfFdIXCF0r5L95ced/xAAOSJE9kTAFu9G6FaVwbDpgoYPCpgsAPgV42qglCnWBB+WyyIVpFg2IETkSYM7D1L44F1/5mhYmgMs+w9y+D5yxjYe+HCfXWOO+4A4ITOQo04TQLea+pbiPGsgb/7Veg3mKHfaIbeBmFMFVAIBED9cBXYS2TaJHEQdgbXIeVxI67tukDVgP1JY9hpYP+3LJ4/h/49yZUf7sAECoHHc7kvACd0g6zdaQLgVABLHT+uHcDTojbo15bDf00pdOvKoVtvckDglHBnFdwpI9jTYoiqHYGqLvwsoAUHwurwcmQtDkfV4rWYWhyOqcOrsXX4RVw9jsbX49SWGjZnRz4s+87UX3z8otvtcYB8n5AAV43m4njy1T73GBXAcRuAkwaG/WUgQIxAeEFxHY8KmhC4thzKVcXQrLnKOb+uHPoNJug3mmDYZHYoINCrEoGCKgR5VyPYoYBahJJrYFNAuKyBXoMIezD0b0aUqoWWx9GaVtojRGg7EKrtQoiuGyH6HoQariE04DrCgnoRHtyLiJAbCAvpY6MjWXzxWEkt3g2Z5KQAFzJLGOnp0MhvBIA39UwNKYVf8e9j94i7sM2jDoGry6FYWgT5skJIFxVCtqgYiqUl1JTLS6FccRV+K8vgt5qoohwqdxNUa81Qr6+AZkMlNBsrod1UBZ1nNXReNdDza2AQ1MLgXYcAn3oE+jYgUNSIIHETgiRNCJY2c42Spg0xWtIttiPO0I74gA7EB3Zic1AnEoK7kBDSjS2hPdga1s0+FMVgS8T1wmFO8jgnXzaUzk0QF0fFiEv2R4lKEvZKr8wgPx8BQcO7OD5ilakyaEUllIvyWcmCPEgW5kG+uACq5cVQLC7Cz7TV+PXLPXjnlWv4zSs9+A35epjYdc5evY537faLXs5e68Vvqd3Ab4/Y7OgN/O5oH2fHbHa0D++/3o8Xt/cg3K+FG5jYhiYx+g7EGDoRG9CJuMAuxAV1Iz64B5tDexAf2sNui7IgIfzaMABEBRGiq4dVgrLrft4N8Be2skrvZqgEZQ3xojyt7fecISS6imZnmWXziyFbkMcqFxXAb0kh/JYWQrG4EIZ1pfjy40F89wVw9jMrkv82mrHUzjp9HdM+G92+S2SxI6ETIYoWRGs5ANE6DkIsgeAA0I34EA7AQ5HOADjZBwnLXlf59EDsVcVIPMsZiafJIvEst0gFDVALarq3yTLWUSXwbFkjgZfoKpubW6FcUAL5gjxWsTAfikUFUNog+C8rwq9f7sa5z61I+iuLM59ylnQ3++vtxoxqpz9hcOZTBn//YAAPh7QhTNlCFRB1FxXEh3SzWyMt2Bx2PZ9nc2aLtMjbT1A9IPY0sVIvEyP1MmHIym8pvdsRIjL9iipf46gbEl2lc3IqFPNLIJufywFYWADl4gKHClQrivGYoRpPBtfiieBaPBlSR+0JYqH1eDK0AU+GNeCp8AY8HdGIpyObqG2Pbsb2mGZsj27B0/T7FmyPbcX2uFbsiG/DM/HteGZzO57d0oHN+laEykhAbB02OhumgoAuCoGoIC64m90aMUgAFPBsQU8nNP9D4d0M8uSHO2+iP5MLGqESVJ6+7RokukrmZFco5hVDNi+XlS/Ig0MFi4kKiqhJF5JAWATZ4mLIlxRDsawECkcwvAr/VWVQ2YKheq0ZmnUV0KyvhHZjFQ2GWg8SEGug86qFnl9Hg6FBWI8AnwYE+jYiVNaESL+RozOqAl0HB8FJBXFB3czWCAYJYX3pxItYSVmIUlBHHGVvd54DYLIoBM3QeJf/wwbA1XEFJLOdAMzPg2KBHQAXD8g1UCwpgnJJMZTLiuG3vAT+K0rhv+oqVKuvQr2mDGr3cmjWmqBdZ4Jugxm6jRXQb6qE3oOrC0J8amhK5CpD57Q4sjokdQFRwhCA21QQRI15KAKIC7vxKPFDK6zKkfHrIfUqGwNAucXPuwXRoopnRlwByezsCvncYkjn5lAAdhUQAASEfGEBwvlliPQxIYqYrxnRIjNiJBWIkVQiVlqFWFkV4uTViFPUIF5Zg3i/Wmz2r0WCug7h4hoKIthnjBJ5NAi22mAEhAACoYPdEnoL8cG9ecSDMF/TLuIcDXajOC/3KmNl/BqovasqTkV9Nd2eMXgOALMyK+RziigA2bxcUBXQa8DFg9d3t+Ob/7bgy48t+OpPP86+/rMFn38wgMdCGqH3rLYBsDVKo4zOxlKBcyyICehktoYyiA3piz2y8oibyruqRcqvJk/f6uy4zMsEJb8cgk0mRsJvQay09DGqeloZ2g65AuJZmRWy2UWQzsnmAMzjroF0Xh4Ma4rx7V8suPAFcOYz6x1T2WiW9AmD1H8Cx/Z0QbWukl6DIRXUD43OblNB5BixIFrfwSQE30Jc0PUr5PMHCs3vKL1bhz19Ob8cCn45fD3NcF9nZrYpavFhZO7/kd8fsXhNIABmEgCFkM7OZmVzc+CsAgLh6ZAafHzyBv50ymZv9420XxLrx5+djPz7//y6H+8d7UWsshYGzyraJAUJ76ACxzUYPkanxZGOKoFNCBpAbFBP4FZRqrtSUMVIOKetxGmZF3niZmzcUAG98Kr1D1GZGNz3XS9e/dumUbvGBDuAWYWQzM5mpXNyIJubC9m8oVggmp1H4wDNCMuK4L+8GKoVJVCtLIF6dSk0q69C414G7doyaO2NkqNTrIR2QwV0m0ifYBuaOE+NfsAA1a6CKE0bsznwFmL1Pf8inz3Ap+Ibf+8mSDzLGP4mMzZsqICPhxnbZMX4JCYDXc8mW/DKZeBg8qvk9y8OBb7bAEw3VkgJgFlZFIDUSQXyBVww5IxLi/7OEFaVchDW2CGQZolkApOjU+Ra5dvb5bsMUEdRQZSmjY0P6Ed80DVlnLAkQMRvwYYNZhr1H1MU4YMIIwofvwgL2SwdJO3y92D2f1dQl5A4ecx2OYGUwtMzzdKZBRyA2dmwq0A+P9ehApIN/JcWQr1iCIB2dQk0q0uhJhDW3EkFTvMC/h1UYMsIo6kgUtXCxOtvIlbXlcTj8cb5elYXP6aswCfR6WzFU9+D3X8GeP40cDCJLFQwsOcsi+cuwrIrKewuw9NEV9E0o1k6owDimZmshACYTQAMV4H/kgKIZueDPzWPVoekSRLOKIBkfhG07kQFV4erYP1wFVAIpF3mj6ICRywYPjQZHgtarHG6XoSou32eUhbtvPBwCRmMWPBcEnCAOH0Wg3vJ5Ni+UksBe+D8J3dxnpxEV9FUo1kyIx/iGZmsZFYWnFVAICgX5UMwJQdblWX456edMBX3o6ygH1990omfB1fAZ3bRbdfASQV0aDKGCkYbnY2SESKUzUyc7ibC1Z3/wJOnpnfuvNSMQ+dg2ZtkdTjttETB/vPAgQvt2PXtSuLhXd4xSOQATLcBmJkFySxOBSQWKBfmge+WjUOPVmHgFgtyrFbO6PesFR+eaoF4PjcwubMKbANU/hgD1LFXatZYdRcWCnq9cCjpCF5Kg2XPGctog1Pu6aeC2XNmH3U+0SnnjwXAd8oVs2RaPkTTjayYAuBUIJ+XA+HUbGxRlKL/BkMdJhDSv7uGjO+u49Yt1gHi9ydb4Tu3CLq1Y6nA/MNV4DRADZM3MnGamwhQdP43Dv/NnTnw3S3rPjI5PmMduUwlg9JLYPdfSIW93b37SaQAxNPyIJpmZMUzMmFXAQHgOSET337WQZ1kGSte21kLT7dcCGfkY3tEBZrrB+ifDQ5a8fOQSsgWlVDn70kFviNUYA2XNyNS2cZ6CDs8cCD5UxxKIy9QMKM4TzbJVhy4wOJAst+PWJgkuvpOvmIWTyUArlAA4hlEAVkQzciCZnkemmpvUSe/+7obm8Znw39ZAdQrCuExKQ9Ph1fAMsjJ4NvPu++gAhP0tvmhYUwV2JslGwRJgyVOdRMKcffv8NKXWrxwmUyFWdtYfNjugEr/xTRy99+lzjuXu3cDIJycYRZPzYXv1CusaLqRxAIKQDglE5H8QvRe5+T/26ON8JqUDdUyri5QryyCYFo+zn/dTf+8s92CKFE5rQ0M68ug31AG/fqRdYFDBWMtU7iMYA2XNSFM1npzd0AlHwfPpd3YlYKWp5JZmuefTwIz9CIFi4MXYD1woQY7fuSmKIEAcMswi6bYAEwzQjyduwai6VnQLM1FYw2ngLNfdGE9LxP+SwtARmf+ywrpVXjh8RouEAA4/Ew93F0KIJ5fAp85JZAvITsEk+0qDGUEwx3rgnpilhhlP4LlHW/9fFX640+sN0OzMJvRLcrBljWZ+N/QS8DBMzYA5P2By8C+5Ed+9MI0wQ5gci58p2RQAKLp5BpkQjYnGx7jjTj7RSd1zmKx4vieGnhMzKaFkd8Szkhx1FjLxYLc9Bv446/acDqxG395rwM7YmogW3wVOqIEuwo87CqoGlUFwb611lBxE8KlLV0BG01y0czCGuGsYojn5Fglc3IhnJWLtVPz8b46FXguicHzKWD3nz99jxuiRFfhxDSzaHIOfKZksL5Tr8CuAumsLPAnGbFVUYz+G1wKJOcPbzdDMiePOs+fkout/uVorOEAsKx1RKokIBTLriLAg7sKmnVkp1iBIMHoy5QgnxomUtaLYEn9UfHM/NdVC6pJYWaRk+p0bi4U83Ign5sD75m51pJHvgcOne/r3XGaf88AvCekmX3dcuAzOZ31ncIBoBCoCrLg4WrE3jgTbthiQWfrIPSrC+E9LRcfnWrG4MDw+qCrw4K6ylu42TeUJl/e3gDP6SUwbDQjUlIJ1RozFCvIZtk5FnBXIcS3HoE+9beeimjeqlpU2O47PQ+K+blWWpjZzG9+DtZPy2M+0uUDr5w+ds/vCiRQAKlmX7ds+LgRABlwVgGBIJ+bjU3jjIgXF+Nfp7vx5sFa+M7Iwb9O9zieOnHU/vRf21kP8bwiPBtbjZ4uDto3f+/GC0/Wo6ZigALKM/bj5R1NUK+r4BTgUEG1NVzcBtWG6pL//aPljc/etSBgTWGf95QsKBYMAZDPy2VFswoRuyq7EX++OOs+VuSJHIBJ2RC6pbM+kzNAVTCVxAJOBaQ4ks3NhnBqFjaNz8SmSZkO58kpK+zHW8/X42Y/p4QTzzXAm/QW84pRkNlHf0bUY0+XHCzu7/7Hs01QrjIj2JsDECioZsNFnWSjdD7pr+zXKV8DX/5x4ObDSvMtgVuWozyXzMpm/BeVI8i3no7F7uMkugrGp5p9JmZBOCnNBmCkCkhWUM7PgdfETPz9w1aH87npvXR0FupR4gDwmyNNEM4shHpVCcoKbzoCKDntLRZ8/Vk3TZnk7H+kAX6rzQgSOFTABnm3IM6//nLyZ2zdt38B2R1Ykz5lrfs313Nl+qxsMrJnIxVdZFZQ8GABuKVjuAoyKQSSEcg1eG6b2eF8aX4f1Mvy4TU5B49oyx29wqkXG+E1NR8hnlfR0jhoe+pW9F5j8FREDfgzSpCgqsIjgTU0Fji/ZEGugG5TLZ6ObmlI/jsz+NWfGDpXJOO1S18Dz21rhtrdhAi/JjZGfY00Svn3D8A1xewzIQveE1NZ4aR0+LhlwHeykwpmZMJ3Wib8Fuagxsw90WtdFsSKimks8JmRi91xFQ4wLz1RA/7UfET6lFGn7ee13Q20NgjyNEFFlqqryrntMimObEMTcg0MntVEAcxXfxpkyUqObI/+640+PLO5DdEqblgSLm9ko/17HgwAvmuKWTg+E94TCIA0DFfBFUhnZWI9Lx3vHat3OPPWc7XYOC4TmuX58JiQjQ/eaKI/v3WTxUP+5ZDO52YGpz/nqsSP3m6FaF4J9Ou5HkG/oZyu10cbmgQJqukE+dGQJhx+pguPhzcjwLsWegFXJdr6BDaKAmh6AADGOQGYmAaHCqZkkP4AwslXoFqcjaY6LtcXZ9+AaAZplripkWR2LkpyuGBXmtcHxaJCOjtULiEzxGJE+ZbT9br6bu2y06s2JCWS1bp6YzVdrYeI6xAmcW6UGtgov27ynsGDAHDZLHQ1QjA+hfWmAIZUIJl+Bet5aTj0sMnx9F99uhIbXYxQLcmD54QsHNw2JP8PTjTDa0rusNGZYnExNKu5AerQ6Kx8eLs8yugsWFjNbZN8R47RQ6UNbJSym4zPHgAAl8tmbzuACakYUkE6BbCWl4pPf9dMHexqH0TAmjxIZmZDMiuHKqCitJ8rkNoGEeZZDOm8fDo/pANUMjxdaZsg0wEqpwLnTnEsFTiqwxGjMwKgno1UdhEA958FvFwuVXiPM0LgmsJ6j0+F94Q0CCdyAMgV2MhLQ/I/uJlASc4N2iUK3DJphWifFZDz7i8a4OWWA9WyQjpB5hRQRLfLahsAMkTVuHMAuHeNuNdtSDAkKqCv2vBts0P+KC9f2lUgaWAjFJ0EgGloz3cPhZCGd3E83+VSpcDlCvjjLrOC8SlwVoFoagbW81Lxz0/aqJP1lTehX5mLsE0FjiaJnKxL12ksIBsl0imSPYJ4bj5kCwsgX1QIORmkkgXr0mIol5fAb0XpsK2y3+oy6EjHt85Mt8tklzB8gDq8XQ6R1LMR8g4SDCtEouwJ9wyAxzsyju9y6arAxcgBcE3BkArSIJ6aAXdeCk49V00dJXV/S8OAoy8gp7r8JgLXFkA0M4cOUMkUWb28EMd2tuG/jl/He69dw3tHruH9I9fx/lGbHbPZ0V78/vVenHy+GwEeZjwR2oiP3urD9ugmaDdW0owwmgpCxHVshLyTxIIi8mLUPTg+RIzvknrR2yULXi6XGcG4FAgoAE4F5Bp4T0yHbLYRBVd6h9X+5KSd60GAez6dHZIBqmJBHkSzcxEnKqeFywj7aqT960sg7TSwTVuLX73Ug4JLwAfHb9A+gQAYbYweLKpjIuU9CJU2nic+2F+O+tHy5/F4PAEv49dClzx4uVyyCMZdxjAVTEqjRZHX+DTI5hhx8mA1/u/Prfj47UbsCL0KwaRM+EzNosGQW6YMrdR2x9Th+M42HH2Ws2M72znbRawDx3Z34PjuTryxrxOHHm2lQTHBvwZv7O/CQ9q6oWsw2tDEt84SJe9FmLT1P6kvo6297n4SafvoxUtV0Bjgcpnhu1y2UhW4Do8FvpPT6VeSEdbx0qh5uF6hozNSJo9cpuTBZ2YOfGbmwnd2HkRz8iGeSyZFBZAsKIR0YRGki4ohW1IM2dISyJeVUgDkRQvFyjIaC+wl8qixwLfWEiHtRqioMXDEyvvHHVDpCHhpH/m4FIHvcmmAP+6y9fZYQCFM4eoCyUwjrQ6JOY/Rh1ZqHAC/xfl0aEJSIskMquVFUK8spk0SyQbaNaXQupOXL7nZIQFAMgKJBY5t0u1pkW6XawYipb0IETV9Y/Phfv6XOtC/vJJ30c3LJSWZg5Bq4Y+7bBG4pjCCCamM98Q0RjgpnRG6ZTA+kzMY3ylXGN9pRkY0PZMRzchkxDOzGNKeSmbnMNK5uYxsXi4jm5/HyBfkM/KF+YxiUQGjXFLIKJcWMX7Lihi/5cWM/4oSRrWylFGtLmXUa64yGvcyRrO2nNGuMzHa9SZGt9HM6DdVMHqPSsbgWckEeFUxgfxqS5CgZjBCfB0hPg05ho2lcx8AgNsg8C69z3dJtwrH5UHomm0Vjs+Gz4Qc+E7KhcgtD6LJ+RBPyYdkWgEk0wshnVEE6cxiyGaVQE6GoHNLoZh3Fcr5ZVAuLIPfonL4LzbBf4kJqmVmqJdXQLOiEpqVVdCuqoZuTTV07jXQr62FYV0dDBvqEbCxAYGbGhDo0YggryYE8ZsRLGhBqLDDGubTiQBBVVKQR90c+tF/+ALkbgeO10w9eKlCT96ld/njLqfzXVOMggkpRsHEVKNwYprRZ1KG0cctw+gzJcPoO/WK0Xea0SiebjRKZmYaJbOyjdLZ2Ubp3ByjdF6OUTY/1yhbkG9ULCgwKhfbbEmh0W9pkdFveZHRf0WJ0X9liVG9qtSoWVNq1LhfNWrcy4za9SajdoPJqNtgMho2mo2GTRVGg2flFYNX1WcGflU05zT5vPfn/P8DyQSSwSDGnAoAAAAASUVORK5CYII=",
  googleClientId: process.env.REACT_APP_GOOGLECLIENTID
    ? `${process.env.REACT_APP_GOOGLECLIENTID}`
    : "",
  metaDescription:
    "The fastest way to sign PDFs & request signatures from others.",
  settings: [
    {
      role: "contracts_Admin",
      menuId: "VPh91h0ZHk",
      pageType: "dashboard",
      pageId: "35KBoSgoAK",
      extended_class: "contracts_Users"
    },
    {
      role: "contracts_OrgAdmin",
      menuId: "VPh91h0ZHk",
      pageType: "dashboard",
      pageId: "35KBoSgoAK",
      extended_class: "contracts_Users"
    },
    {
      role: "contracts_Editor",
      menuId: "H9vRfEYKhT",
      pageType: "dashboard",
      pageId: "35KBoSgoAK",
      extended_class: "contracts_Users"
    },
    {
      role: "contracts_User",
      menuId: "H9vRfEYKhT",
      pageType: "dashboard",
      pageId: "35KBoSgoAK",
      extended_class: "contracts_Users"
    }
  ]
};
