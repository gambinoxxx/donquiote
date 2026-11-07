// Logs which notification channels the worker has (never values).
import { getNotifyConfig, type NotifyConfig } from "@/lib/notify/config";
import type { Logger } from "./log";

export { getNotifyConfig };

export function logNotifyConfig(config: NotifyConfig, logger: Logger): void {
  logger({
    component: "notify",
    outcome: config.problems.length > 0 ? "warning" : "ready",
    push: config.channels.push ? "on" : "off",
    email: config.channels.email ? "on" : "off",
    recipients: config.recipients,
    ...(config.problems.length > 0 && { message: config.problems.join("; ") }),
  });
}
