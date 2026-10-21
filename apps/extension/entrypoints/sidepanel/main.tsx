import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SidePanelApp } from "./App";
import "../style.css";

createRoot(document.getElementById("root")!).render(<StrictMode><SidePanelApp/></StrictMode>);
