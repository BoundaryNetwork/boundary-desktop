import React from "react";
import { createRoot } from "react-dom/client";
import "@boundary-desktop/ui/styles.css"; // token(随 bundle 进 main.css)
import "./newtab.css";
import { NewTab } from "./NewTab";

createRoot(document.getElementById("root")!).render(<NewTab />);
