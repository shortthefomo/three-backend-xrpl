#!/bin/bash
export NODE_ENV=production
export DEBUG=threexrp*
export DEBUG_COLORS=true
pm2 start ./src/main.js --name three-xrpl --time