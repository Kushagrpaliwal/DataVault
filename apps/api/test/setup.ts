/**
 * The tests run against their own database.
 *
 * They create accounts, move items to the trash and write to the credit
 * tables, so they must not do that in the database a person is working in.
 * The address of the test database comes from the environment, and the
 * ordinary database is used when there is not one.
 */
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
