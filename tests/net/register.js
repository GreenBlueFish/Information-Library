// tests/net/register.js
//
// Usage: node --import ./tests/net/register.js tests/run.js
// Registers tests/net/hooks.js so Node can import `https://` modules.

import { register } from "node:module";

register("./hooks.js", import.meta.url);
