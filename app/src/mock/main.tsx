// Mock entry for the browser dev server (`npm run mock`). vite.config.ts swaps
// the Teams-facing modules for the ones in this folder; everything else, from
// mount.tsx down, is the production code.
import { startSimulation } from "./store";
import "../mount";

startSimulation();
