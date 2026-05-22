#!/usr/bin/env node
import { start } from './lib/index.mjs'

start().catch((err) => {
    console.error(err)
    process.exit(1)
})
