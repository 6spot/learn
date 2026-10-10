import { getLearnApp } from '../../lib/application.js';
interface Instance { setData(data: Record<string, unknown>): void }
const subscriptions = new WeakMap<Instance, () => void>();
declare function Component(options: { data: object; lifetimes: {
  attached(this: Instance): void; detached(this: Instance): void };
  methods: { onRetry(): void; onRefresh(): void; onUpdate(): void } }): void;
Component({
  data: { message: '', checking: false, canRefresh: false, updateMessage: '', canUpdate: false },
  lifetimes: {
    attached() {
      const session = getLearnApp().compatibility;
      const sync = () => this.setData({ ...session.view });
      subscriptions.set(this, session.subscribe(sync)); sync();
    },
    detached() { subscriptions.get(this)?.(); subscriptions.delete(this); },
  },
  methods: {
    onRetry() { void getLearnApp().compatibility.retry(); },
    onRefresh() { void getLearnApp().compatibility.refreshResources(); },
    onUpdate() { void getLearnApp().compatibility.requestUpdate(); },
  },
});
