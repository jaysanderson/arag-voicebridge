/** Rate-limit budgets that track the settings store rather than the boot-time value. */
/**
 * A per-route budget that follows the settings store.
 *
 * The platform reads `route.opts.rateLimit` on every request (it spreads it into the limiter), so
 * an object with getters stays live — whereas the plain `{ rps: voice.briefRps }` these routes
 * used froze the number at registration, which would have made the rate-limit settings editable
 * and inert.
 */
export function liveBudget(read: () => { rps: number; burst: number }): { rps: number; burst: number } {
  return {
    get rps() {
      return read().rps;
    },
    get burst() {
      return read().burst;
    },
  };
}
