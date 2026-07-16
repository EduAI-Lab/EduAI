#!/bin/bash
# Restart dev apps — delegates to go-live-reset for a clean start.
exec "$(dirname "$0")/go-live-reset.sh"
