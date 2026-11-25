/// <reference types="vite/client" />
declare module 'ggwave' {
  const factory: () => Promise<unknown>;
  export default factory;
}
