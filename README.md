# FAIROs web interface — OpenAPI-aligned version

This version is aligned with the supplied FAIROs Assessment API OpenAPI 3.1 specification.

# Docker deployment

Run `docker compose up -d --build`, then open http://localhost:8080.

Set `API_BASE_URL` in a `.env` file next to `compose.yaml`, or run:

```bash
docker run --rm -p 8080:80 -e API_BASE_URL=https://prefairos.linkeddata.es fairos-web:latest
```

`config.js` is generated at container startup. Docker's API_BASE_URL overrides any previously saved browser API URL. The Settings dialog can temporarily change the URL until the page is reloaded; to change it persistently, update the container environment and recreate the container.

The API must allow the web origin via CORS, including the Location header if used for polling. Never put secrets in API_BASE_URL: the value is public to browsers.
