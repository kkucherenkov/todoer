import { NodeSqlite } from './node-sqlite.js';
import { sqlDatabaseContract } from './sql-database.contract.js';

sqlDatabaseContract('NodeSqlite', () => new NodeSqlite(':memory:'), {
  queuesInProcess: false,
});
