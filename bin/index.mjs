#!/usr/bin/env node
import { cli } from '../dist/index.cjs';

cli({ cwd: process.cwd(), argv: process.argv });
