import { useId } from "react";

export function PalaceIcon({ name }: { name: "create" | "search" | "settings" | "help" }) {
  const id = useId();
  return (
    <svg className={`khp-icon khp-icon-${name}`} viewBox="0 0 52 52" fill="none" aria-hidden="true">
      {name === "create" && (
        <>
          <path d="M13 9 8 12v26l17 5 8-4" fill="#063244" />
          <rect x="16" y="7" width="25" height="33" rx="5" fill="#0c4c60" />
          <path d="m28 13 7 9-7 10-7-10Z" fill="#33dff2" stroke="#b3ffff" />
          <path d="m28 13-2 9 2 10 3-10Z" fill="#b1ffff" />
          <circle cx="39" cy="38" r="10" fill="#27e4ed" stroke="#b1ffff" />
          <path d="M39 33v10m-5-5h10" stroke="#075365" strokeWidth="2.6" />
        </>
      )}
      {name === "search" && (
        <>
          <path d="m10 9 17-4 8 29-17 4Z" fill="#381761" />
          <rect x="18" y="11" width="23" height="30" rx="4" fill="#562884" />
          <path d="m29 17 6 7-6 8-6-8Z" fill="#d4a6ff" />
          <circle cx="17" cy="32" r="10" fill="#492269" stroke="#e6baff" strokeWidth="2.5" />
          <path d="m10 40-6 7" stroke="#e6baff" strokeWidth="4" />
          <path d="m13 32 3 3 5-6" stroke="#f0d9ff" />
        </>
      )}
      {name === "settings" && (
        <>
          <defs>
            <linearGradient id={id} x2="0.8" y2="1">
              <stop stopColor="#effaff" />
              <stop offset=".45" stopColor="#a3c8f6" />
              <stop offset="1" stopColor="#527eb8" />
            </linearGradient>
          </defs>
          <path
            d="m22 5-1 6-4 2-5-3-6 10 5 4v4l-5 4 6 10 5-3 4 2 1 6h12l1-6 4-2 5 3 6-10-5-4v-4l5-4-6-10-5 3-4-2-1-6Z"
            transform="translate(-2 -1)"
            fill="#122e50"
            stroke={`url(#${id})`}
            strokeWidth="2.8"
          />
          <circle cx="26" cy="25" r="9" fill="#08192f" stroke="#c6dfff" strokeWidth="2.5" />
          <circle cx="26" cy="25" r="4" fill="#81bbec" stroke="none" />
        </>
      )}
      {name === "help" && (
        <>
          <defs>
            <linearGradient id={id} x2="0.8" y2="1">
              <stop stopColor="#fff2c0" />
              <stop offset=".5" stopColor="#e6c17a" />
              <stop offset="1" stopColor="#a87939" />
            </linearGradient>
          </defs>
          <path
            d="M26 13C20 8 11 7 5 10v30c8-3 15-1 21 4 6-5 13-7 21-4V10c-6-3-15-2-21 3Z"
            fill="#142d49"
            stroke={`url(#${id})`}
            strokeWidth="2.5"
          />
          <path
            d="M26 14v29M10 16c4-1 8 0 11 2M10 23c4-1 8 0 11 2M10 30c4-1 8 0 11 2"
            stroke="#b8cde8"
            strokeWidth="2"
          />
          <path d="M33 9v19l5-4 5 4V9" fill="#d6b16c" stroke="#ffdfa0" strokeWidth="1.2" />
        </>
      )}
    </svg>
  );
}
