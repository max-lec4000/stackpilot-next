import { useEffect, useState } from "react";
import { Icon } from "./Icon";
type Theme = "dark" | "light";
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return localStorage.getItem("stackpilot-theme") === "light"
        ? "light"
        : "dark";
    } catch {
      return "dark";
    }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("stackpilot-theme", theme);
    } catch {
      /* Storage can be disabled. */
    }
  }, [theme]);
  const next = theme === "dark" ? "Light" : "Dark";
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={`${next} Mode aktivieren`}
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
    >
      <Icon name={theme === "dark" ? "sun" : "moon"} /> {next}{" "}
      Mode
    </button>
  );
}
