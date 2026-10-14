// Entry point. Checks the Node version first, because the built-in SQLite module the app uses only exists in
// Node 22.13+ and older versions otherwise fail with a confusing "cannot find module" error.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`Meal Prep needs Node 22.13 or newer (you have ${process.versions.node}). Install the current LTS from https://nodejs.org and try again.`);
  process.exit(1);
}
await import('./main.js');
