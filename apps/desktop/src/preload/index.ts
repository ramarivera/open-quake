import { contextBridge } from "electron";

// SDK surface exposed to the renderer lands here (wayfinder ticket
// open-quake-2qs.5 / open-quake-2qs.6).
contextBridge.exposeInMainWorld("openQuake", { version: "0.0.0" });
