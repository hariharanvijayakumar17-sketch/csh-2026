// Vitest setup for integration tests: steer the app's shared DB client
// (src/lib/db/client) at the throwaway test database BEFORE any module
// under test is imported. Runs before each test file's imports.
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ??
  "postgres://csh_dev:***@127.0.0.1:5432/csh2026_test";
