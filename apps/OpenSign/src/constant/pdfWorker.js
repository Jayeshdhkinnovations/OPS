import { pdfjs } from "react-pdf";

// This assignment used to sit at module scope in App.jsx, which pulled
// react-pdf (and therefore all ~1.5MB of pdfjs-dist) into the entry chunk -
// so every visitor downloaded the PDF engine just to see the login page.
//
// Living in its own module instead, it is imported by the components that
// actually render a PDF. Those all sit behind lazy routes, so the engine now
// loads with the first document view rather than on first paint, and the
// worker is still guaranteed to be configured before any <Document> mounts
// (the import runs before the importing module's body).
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/legacy/build/pdf.worker.min.mjs`;

export default pdfjs;
