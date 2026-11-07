// "Show test signals" — one device setting shared by the Alerts page and the
// chart. Stored in localStorage; private mode or blocked storage just means
// it isn't remembered.
export const SHOW_TEST_KEY = "donquixote.showTestSignals";

export function readShowTest(): boolean {
  try {
    return window.localStorage.getItem(SHOW_TEST_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveShowTest(on: boolean): void {
  try {
    window.localStorage.setItem(SHOW_TEST_KEY, on ? "1" : "0");
  } catch {
    // Not remembered this time.
  }
}
