import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// nothing fancy here, just the react plugin, no backend, no router
export default defineConfig({
  plugins: [react()],
});
