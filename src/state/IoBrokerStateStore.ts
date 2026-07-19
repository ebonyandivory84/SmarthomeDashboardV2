import { useMemo, useSyncExternalStore } from "react";
import { StateSnapshot } from "../types/dashboard";

export class IoBrokerStateStore {
  private readonly values: StateSnapshot = {};
  private readonly revisions = new Map<string, number>();
  private readonly listeners = new Map<string, Set<() => void>>();

  applyBatch(incoming: StateSnapshot) {
    const pendingListeners = new Set<() => void>();

    for (const [stateId, value] of Object.entries(incoming)) {
      if (Object.is(this.values[stateId], value)) {
        continue;
      }
      this.values[stateId] = value;
      this.revisions.set(stateId, (this.revisions.get(stateId) || 0) + 1);
      this.listeners.get(stateId)?.forEach((listener) => pendingListeners.add(listener));
    }

    pendingListeners.forEach((listener) => listener());
  }

  pick(stateIds: string[]) {
    const snapshot: StateSnapshot = {};
    for (const stateId of stateIds) {
      snapshot[stateId] = this.values[stateId];
    }
    return snapshot;
  }

  getSnapshot() {
    return this.values;
  }

  getRevisionToken(stateIds: string[]) {
    return stateIds.map((stateId) => this.revisions.get(stateId) || 0).join(":");
  }

  subscribe(stateIds: string[], listener: () => void) {
    for (const stateId of stateIds) {
      let stateListeners = this.listeners.get(stateId);
      if (!stateListeners) {
        stateListeners = new Set();
        this.listeners.set(stateId, stateListeners);
      }
      stateListeners.add(listener);
    }

    return () => {
      for (const stateId of stateIds) {
        const stateListeners = this.listeners.get(stateId);
        stateListeners?.delete(listener);
        if (stateListeners?.size === 0) {
          this.listeners.delete(stateId);
        }
      }
    };
  }
}

export function useIoBrokerStateSelection(store: IoBrokerStateStore, stateIds: string[]) {
  const stateIdKey = stateIds.join("\u0000");
  const stableStateIds = useMemo(() => stateIds, [stateIdKey]);
  const revision = useSyncExternalStore(
    (listener) => store.subscribe(stableStateIds, listener),
    () => store.getRevisionToken(stableStateIds),
    () => store.getRevisionToken(stableStateIds)
  );

  return useMemo(() => store.pick(stableStateIds), [revision, stableStateIds, store]);
}
