export {}

declare global {
  interface Window {
    test: {
      test: () => Promise<string>
    }
  }
}
