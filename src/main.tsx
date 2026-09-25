import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { recoverPendingRestore, scheduleAutomaticBackup } from "./backup";
import { storage } from "./storage";
import { LocalizationProvider } from "./localization/Localization";
import { recoveryExplanation } from "./localization/bootstrap";

async function start() {
  try {
    await recoverPendingRestore();
    const locale = storage.loadLocale();
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <LocalizationProvider initialLocale={locale}>
          <App />
        </LocalizationProvider>
      </StrictMode>,
    );
    // A backup failure is reported by the core, never allowed to block the library.
    setTimeout(() => void scheduleAutomaticBackup(), 5000);
    setInterval(() => void scheduleAutomaticBackup(), 60 * 60 * 1000);
  } catch (error) {
    console.error("Everia restore recovery failed:", error);
    document.getElementById("root")!.textContent = recoveryExplanation();
  }
}
void start();
