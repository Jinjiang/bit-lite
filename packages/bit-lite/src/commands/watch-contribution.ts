import type { ProxyRoute } from "bit-lite-proxy";
import type { VendorTask } from "bit-lite-vendors";

export type WatchCommandContribution<Task extends VendorTask = VendorTask> = {
  serviceId: string;
  tasks: Task[];
  routes: ProxyRoute[];
  dispose(): void | Promise<void>;
};
