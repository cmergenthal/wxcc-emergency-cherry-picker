import { cp, mkdir } from 'node:fs/promises';
// Only public runtime files are packaged; private JSON data/config never enters this directory.
await mkdir('dist/api', { recursive: true });
for (const name of ['.htaccess', 'store.php', 'common.php', 'config.example.php', 'webhook.php', 'caller-ids.php', 'transfer-state.php', 'transfer-hold.php']) {
  await cp(`api/${name}`, `dist/api/${name}`);
}
await cp('img', 'dist/img', { recursive: true });
await cp('public', 'dist', { recursive: true });

for (const name of ['emergency-header-layout.json', 'EMERGENCY-HEADER.md']) {
  await cp(name, `dist/${name}`);
}
