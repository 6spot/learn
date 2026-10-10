import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
for (const target of ['miniapp', 'cloud']) {
  const { runRuntimeSmoke } = require(`../dist/runtime/${target}/runtime-smoke.cjs`);
  console.log(JSON.stringify({ target, executionEnvironment: `Node ${process.version}`, ...runRuntimeSmoke() }, null, 2));
}
