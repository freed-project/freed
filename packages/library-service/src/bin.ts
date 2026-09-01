#!/usr/bin/env node

import { runLibraryServiceCli } from "./cli-runtime.js";

process.exitCode = await runLibraryServiceCli(process.argv.slice(2));
