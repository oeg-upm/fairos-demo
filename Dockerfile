FROM nginx:stable-alpine

# Copy the original web application
COPY src/ /usr/share/nginx/html/

COPY --chmod=755 docker/40-fairos-config.sh \
    /docker-entrypoint.d/40-fairos-config.sh

RUN sed -i 's/\r$//' /docker-entrypoint.d/40-fairos-config.sh

# Expose the Nginx HTTP port
EXPOSE 80

# Start Nginx
CMD ["nginx", "-g", "daemon off;"]
