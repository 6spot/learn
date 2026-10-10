/** Narrow declarations for this development host; extend as actual APIs are integrated. */
declare function App(options: { onLaunch?: () => void }): void;
declare function Page<Data extends object>(options: {
  data: Data;
  onLoad?: (this: { setData(data: Partial<Data>): void }) => void;
  onRun?: (this: { setData(data: Partial<Data>): void }) => void;
}): void;
