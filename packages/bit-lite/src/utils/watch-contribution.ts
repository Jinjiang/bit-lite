import type { ProxyRoute } from "bit-lite-proxy";
import type { VendorTask } from "bit-lite-vendors";

export type WatchCommandContribution<Task extends VendorTask = VendorTask> = {
  serviceId: string;
  tasks: Task[];
  routes: ProxyRoute[];
  /**
   * Idempotently stops every contributed task before releasing the
   * contribution's listeners and auxiliary resources.
   */
  dispose(): void | Promise<void>;
};
