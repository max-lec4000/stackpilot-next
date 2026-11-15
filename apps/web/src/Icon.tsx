const shapes: Record<string, string> = {
  home: "M3 10 12 3l9 7v10H3V10Zm6 10v-7h6v7",
  discover: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z",
  requests: "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z",
  downloads: "M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4",
  apps: "M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z",
  settings: "M4 7h16M4 17h16M8 4v6m8 4v6",
  search: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 6 6",
  remote: "M14 3h7v7m0-7L10 14M10 5H4v15h15v-6",
  sources: "M8 12h8m-9-5 4-4 4 4M9 17l4 4 4-4M11 3v9m2 0v9",
  profiles: "M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-6 0v6",
  connections: "m9 15 6-6M7 14l-2 2a3 3 0 0 0 4 4l3-3M12 7l3-3a3 3 0 0 1 4 4l-2 2",
  safety: "m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6l8-3Zm-4 9 3 3 5-6",
  backups: "M5 8a8 8 0 1 1-1 7M5 3v5H0M12 7v5l3 2",
  diagnosis: "M3 12h4l3-7 4 14 3-7h4",
  history: "M4 5v5h5M4 10a8 8 0 1 1 0 5M12 7v5l3 2",
  audit: "M5 3h14v18H5V3Zm4 5h6m-6 4h6m-6 4h4",
  about: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 7v7m0-11v1",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-6v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1",
  moon: "M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z",
  music: "M9 18V5l11-2v13M9 8l11-2M9 18c0 2-6 4-6 1s6-4 6-1Zm11-2c0 2-6 4-6 1s6-4 6-1Z",
};
export function Icon({ name }: { name: keyof typeof shapes }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={shapes[name] || shapes.apps} /></svg>;
}
