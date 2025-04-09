<img width="1481" alt="Screenshot 2025-04-09 at 7 29 01 PM" src="https://github.com/user-attachments/assets/3e70e5f0-83a5-4030-b37d-7f6ed428a1ca" />
raphastacks@raphastacks-System-Product-Name:~/bitcoin-services/clarity-service$ ls -l
total 76
drwxrwxr-x   6 raphastacks raphastacks  4096 Apr  9 18:34 clarity-bitcoin-client
drwxrwxr-x   2 raphastacks raphastacks  4096 Apr  9 18:39 dist
drwxrwxr-x 109 raphastacks raphastacks  4096 Apr  9 18:35 node_modules
-rw-rw-r--   1 raphastacks raphastacks   647 Apr  9 19:15 package.json
-rw-rw-r--   1 raphastacks raphastacks 51866 Apr  9 18:35 package-lock.json
drwxrwxr-x   3 raphastacks raphastacks  4096 Apr  9 19:19 src
-rw-rw-r--   1 raphastacks raphastacks   539 Apr  9 19:15 tsconfig.json
raphastacks@raphastacks-System-Product-Name:~/bitcoin-services/clarity-service$ pm2 restart bitcoin-proof-service
Use --update-env to update environment variables
[PM2] Applying action restartProcessId on app [bitcoin-proof-service](ids: [ 0, 1 ])
[PM2] [bitcoin-proof-service](0) ✓
[PM2] [bitcoin-proof-service](1) ✓
┌────┬──────────────────────────┬─────────────┬─────────┬─────────┬──────────┬────────┬──────┬───────────┬──────────┬──────────┬──────────┬──────────┐
│ id │ name                     │ namespace   │ version │ mode    │ pid      │ uptime │ ↺    │ status    │ cpu      │ mem      │ user     │ watching │
├────┼──────────────────────────┼─────────────┼─────────┼─────────┼──────────┼────────┼──────┼───────────┼──────────┼──────────┼──────────┼──────────┤
│ 0  │ bitcoin-proof-service    │ default     │ 1.0.0   │ fork    │ 27571    │ 0s     │ 107  │ online    │ 0%       │ 47.8mb   │ rap… │ disabled │
│ 1  │ bitcoin-proof-service    │ default     │ 1.0.0   │ fork    │ 27582    │ 0s     │ 34   │ online    │ 0%       │ 12.1mb   │ rap… │ disabled │
└────┴──────────────────────────┴─────────────┴─────────┴─────────┴──────────┴────────┴──────┴───────────┴──────────┴──────────┴──────────┴──────────┘
raphastacks@raphastacks-System-Product-Name:~/bitcoin-services/clarity-service$ pm2 logs bitcoin-proof-service
[TAILING] Tailing last 15 lines for [bitcoin-proof-service] process (change the value with --lines option)
/home/raphastacks/.pm2/logs/bitcoin-proof-service-out.log last 15 lines:
0|bitcoin- | Bitcoin proof service running on port 3000
0|bitcoin- | RPC host: localhost
0|bitcoin- | Bitcoin proof service running on port 3000
0|bitcoin- | RPC host: localhost
0|bitcoin- | Processing request for txid: 615e29e597644188389ebd3e1b18230d63d35bdfdcaa4bcebb0b88a667f68376
0|bitcoin- | Bitcoin proof service running on port 3000
0|bitcoin- | RPC host: localhost

/home/raphastacks/.pm2/logs/bitcoin-proof-service-error.log last 15 lines:
0|bitcoin- |   code: 'ERR_MODULE_NOT_FOUND'
0|bitcoin- | }
0|bitcoin- | Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/home/raphastacks/bitcoin-services/clarity-service/node_modules/clarity-bitcoin-client/dist/bitcoin' imported from /home/raphastacks/bitcoin-services/clarity-service/node_modules/clarity-bitcoin-client/dist/index.js
0|bitcoin- |     at new NodeError (node:internal/errors:405:5)
0|bitcoin- |     at finalizeResolution (node:internal/modules/esm/resolve:327:11)
0|bitcoin- |     at moduleResolve (node:internal/modules/esm/resolve:980:10)
0|bitcoin- |     at defaultResolve (node:internal/modules/esm/resolve:1193:11)
0|bitcoin- |     at ModuleLoader.defaultResolve (node:internal/modules/esm/loader:403:12)
0|bitcoin- |     at ModuleLoader.resolve (node:internal/modules/esm/loader:372:25)
0|bitcoin- |     at ModuleLoader.getModuleJob (node:internal/modules/esm/loader:249:38)
0|bitcoin- |     at ModuleWrap.<anonymous> (node:internal/modules/esm/module_job:76:39)
0|bitcoin- |     at link (node:internal/modules/esm/module_job:75:36) {
