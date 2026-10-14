// Only the staging verification backup command gets a no-prune retention override.
// No container runtime config, source, SQL migration, subscription or billing change.
const child = require('node:child_process');
const original = child.execSync;
let backups = 0;
child.execSync = function(command, ...options) {
  if (command === 'docker compose exec app node scripts/backup_db.mjs') {
    backups++;
    command = 'docker compose exec -e BACKUP_KEEP=100000 app node scripts/backup_db.mjs';
  }
  return original.call(this, command, ...options);
};
require('node:module').syncBuiltinESMExports();
process.on('exit', code => {
  if (code === 0 && backups !== 1) { process.stderr.write('Expected exactly one protected staging backup command\n'); process.exitCode = 1; }
});
