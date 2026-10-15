declare module "solc" {
  interface ImportCallbacks {
    import: (path: string) => { contents: string } | { error: string };
  }
  const solc: {
    compile(input: string, callbacks?: ImportCallbacks): string;
  };
  export default solc;
}
