import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import { resolve } from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load ALL env vars (no prefix filter)
  const env = loadEnv(mode, process.cwd(), "");
  const devApiTarget = (
    env.REACT_APP_SERVERURL || "http://127.0.0.1:8081/app"
  ).replace(/\/app\/?$/, "");

  return {
    plugins: [
      react(),
      svgr() // Transform SVGs into React components
    ],
    resolve: { alias: {} }, // Add any necessary aliases here
    define: {
      // Replace process.env.REACT_APP_* with import.meta.env.VITE_*
      "process.env": Object.entries(env).reduce((acc, [key, value]) => {
        if (key.startsWith("REACT_APP_")) {
          acc[key] = value;
        }
        return acc;
      }, {})
    },
    build: {
      outDir: "build", // Keep the same output directory as CRA for compatibility
      // The default 500kB warning is noise here - the PDF and ONNX chunks are
      // legitimately large and are lazy-loaded, not on the login path.
      chunkSizeWarningLimit: 1500,
      rollupOptions: {
        // For public template as separate chunk
        input: {
          main: resolve(__dirname, "index.html")
        },
        output: {
          // Everything used to land in one ~3.4MB main chunk, so any app
          // change invalidated the whole download for returning visitors.
          // Splitting the big third-party libraries out gives them their own
          // long-lived, immutable-cached URLs.
          //
          // Only leaf libraries with no import back into app code are listed:
          // pulling an interdependent set (react + react-dom + router) apart
          // is what causes "cannot access before initialization" at runtime,
          // so react and its ecosystem are deliberately kept together.
          manualChunks(id) {
            if (!id.includes("node_modules")) return;
            if (
              /[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler|use-sync-external-store)[\\/]/.test(
                id
              )
            ) {
              return "vendor-react";
            }
            if (
              /[\\/]node_modules[\\/](pdfjs-dist|react-pdf|pdf-lib|@pdf-lib)[\\/]/.test(
                id
              )
            ) {
              return "vendor-pdf";
            }
            if (
              /[\\/]node_modules[\\/](onnxruntime-web|onnxruntime-common)[\\/]/.test(
                id
              )
            ) {
              return "vendor-onnx";
            }
            if (/[\\/]node_modules[\\/](i18next|react-i18next)/.test(id)) {
              return "vendor-i18n";
            }
            if (/[\\/]node_modules[\\/](parse)[\\/]/.test(id)) {
              return "vendor-parse";
            }
          }
        }
      }
    },
    server: {
      port: env.PORT || 3000, // Same port as CRA
      open: true,
      // Production serves the frontend and Parse API from the same origin,
      // so several auth flows correctly use /app. Mirror that arrangement
      // in Vite instead of returning index.html for API requests.
      proxy: {
        "/app": {
          target: devApiTarget,
          changeOrigin: true
        }
      }
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: "./setuptest.js" // if you have one
    }
  };
});
