import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PopupApp } from "./App";
import "../style.css";

createRoot(document.getElementById("root")!).render(<StrictMode><PopupApp/></StrictMode>);
