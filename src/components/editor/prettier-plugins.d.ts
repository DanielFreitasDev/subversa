// O prettier-plugin-java não publica tipos — declaração mínima para o
// `import()` dinâmico do format.ts.
declare module "prettier-plugin-java" {
  import type { Plugin } from "prettier";
  const plugin: Plugin;
  export default plugin;
}
