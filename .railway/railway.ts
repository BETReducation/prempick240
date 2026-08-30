import { defineRailway, github, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const repo = github("BETReducation/prempick240", { checkSuites: false });

  const prempick240Volume = volume("prempick240-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "europe-west4-drams3a", sizeMB: 5000 });
  const syncScores = service("sync-scores", {
    source: repo,
    replicas: { "europe-west4-drams3a": 1 },
    startCommand: "node scripts/sync-scores.js",
    deploy: { cronSchedule: "*/15 * * * *" },
    env: {
      SITE_URL: "https://www.prempick240.com",
    },
  });
  const web = service("prempick240", {
    source: repo,
    replicas: { "europe-west4-drams3a": 1 },
    domains: ["www.prempick240.com"],
    volumeMounts: { "/data": prempick240Volume },
    env: { ADMIN_PASSWORD: preserve(), ADMIN_USER_PASSWORD: preserve(), APP_URL: preserve(), MAIL_FROM: preserve(), NODE_ENV: preserve(), PERSISTENT_DATA_DIR: preserve(), RESEND_API_KEY: preserve() },
  });

  return project("prempick240", {
    resources: [syncScores, web, prempick240Volume],
  });
});
