#!/usr/bin/env node
// teachback command-line entry point. See `teachback help`.
import { main } from '../src/cli.mjs';

process.exitCode = await main(process.argv.slice(2));
