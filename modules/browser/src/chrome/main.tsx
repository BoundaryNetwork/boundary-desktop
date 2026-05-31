import React from "react";
import { createRoot } from "react-dom/client";
import "@boundary-desktop/ui/styles.css"; // 框架样式契约:token + bd-*(随 bundle 进 main.css)
import { Toolbar } from "./Toolbar";

createRoot(document.getElementById("root")!).render(<Toolbar />);
