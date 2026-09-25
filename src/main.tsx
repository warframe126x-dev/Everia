import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { recoverPendingRestore, scheduleAutomaticBackup } from "./backup";
import { storage } from "./storage";
import { LocalizationProvider } from "./localization/Localization";

async function start() {
  try {
    await recoverPendingRestore();
    const locale = storage.loadLocale();
    document.documentElement.lang = locale;
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
    document.getElementById("root")!.textContent =
      `Everia could not recover an interrupted restore. Your data was preserved. ${error instanceof Error ? error.message : "Please retry."}`;
  }
}
void start();
