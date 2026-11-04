// Side-effect import for worker and script entry points (run with tsx):
// loads .env into process.env. Next.js loads env itself; never import this
// from app/.
import "dotenv/config";
