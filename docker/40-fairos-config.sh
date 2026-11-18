#!/bin/sh
set -eu
# JSON encode the environment value safely using available Alpine tools.
API_BASE_URL="${API_BASE_URL:-https://prefairos.linkeddata.es}"
export API_BASE_URL
escaped=$(printf '%s' "$API_BASE_URL" | sed 's/\\/\\\\/g; s/"/\\"/g')
printf 'window.APP_CONFIG = { API_BASE_URL: "%s" };\n' "$escaped" > /usr/share/nginx/html/config.js
