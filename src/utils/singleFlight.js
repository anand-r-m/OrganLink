/* Wraps an async action so a second call made while one is in flight is ignored. React state
   (`busy`) updates on the next render, so a fast double-click can slip past a state check; this
   guard is synchronous. */
export function singleFlight(fn) {
  let inFlight = false;
  return async (...args) => {
    if (inFlight) return undefined;
    inFlight = true;
    try {
      return await fn(...args);
    } finally {
      inFlight = false;
    }
  };
}
