import assert from "node:assert/strict";
import { localAccessAllowed } from "../server/local-access";

function request(host: string, headers: Record<string, string> = {}, method = "GET") {
  return new Request("http://localhost:3000/api/memory", { method, headers: { host, ...headers } });
}
assert.equal(localAccessAllowed(request("127.0.0.1:3000")), true);
assert.equal(localAccessAllowed(request("localhost:3000")), true);
assert.equal(localAccessAllowed(request("[::1]:3000")), true);
assert.equal(localAccessAllowed(request("attacker.example:3000")), false);
assert.equal(localAccessAllowed(request("127.0.0.1:3000", { origin: "https://attacker.example" })), false);
assert.equal(localAccessAllowed(request("127.0.0.1:3000", { "sec-fetch-site": "cross-site" })), false);
assert.equal(localAccessAllowed(request("127.0.0.1:3000", { "sec-fetch-site": "same-site" })), false);
assert.equal(localAccessAllowed(request("127.0.0.1:3000", { "sec-fetch-site": "same-origin" }, "POST")), false);
assert.equal(localAccessAllowed(request("127.0.0.1:3000", { "sec-fetch-site": "same-origin", origin: "http://127.0.0.1:3000" }, "POST")), true);
assert.equal(localAccessAllowed(request("127.0.0.1:3000", { origin: "http://127.0.0.1:3001" }, "POST")), false);
assert.equal(localAccessAllowed(request("127.0.0.1:3000", { origin: "null" }, "POST")), false);
assert.equal(localAccessAllowed(request("127.0.0.1:3000", { "sec-fetch-site": "cross-site" }), true), true);
assert.equal(localAccessAllowed(request("127.0.0.1:3000", { origin: "https://attacker.example" }), true), false);
console.log("✓ Acesso local: hosts, origens, portas, CSRF e retorno OAuth.");
