# Recovery UI

React + TypeScript frontend. Install dependencies with `npm ci` **from the
repository root**; the root lockfile manages both npm workspaces.

Start the API in a separate terminal **from the repository root**:

```bash
npm run dev:backend
```

Start the frontend **from this `UI/` directory**:

```bash
npm run dev:frontend
```

Open http://localhost:5173. Vite proxies `/api` to http://localhost:3000.
Server settings are read from the root `.env`; Gemini settings are not used.

From `UI/`, `npm run build` emits to `../dist`, `npm run typecheck` checks the
frontend, and `npm run preview` previews the production build. Full setup and
production startup are documented in the [root README](../README.md).
